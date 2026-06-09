import WebSocket from 'ws';
import { RealtimeSession, PendingOutgoingMessage } from './types';
import { analyzeEmotion } from './emotionAnalyzer';
import { GoogleGenAI } from '@google/genai';

type SendToClient = (session: RealtimeSession, message: any) => void;

const MALE_VOICES = ['alloy', 'echo', 'onyx', 'ash'];
const FEMALE_VOICES = ['nova', 'shimmer', 'coral'];

function getOpenAIVoice(gender: 'male' | 'female', index: number): string {
  const voices = gender === 'female' ? FEMALE_VOICES : MALE_VOICES;
  return voices[index % voices.length];
}

// Events we deliberately ignore to keep logs quiet
const SILENT_EVENT_TYPES = new Set([
  'input_audio_buffer.committed',
  'conversation.item.created',
  'response.created',
  'response.output_item.added',
  'response.content_part.added',
  'response.audio.done',
  'response.content_part.done',
  'response.output_item.done',
  'rate_limits.updated',
  'conversation.created',
  'input_audio_buffer.cleared',
]);

export interface OpenAIRealtimeSessionAdapter {
  sendRealtimeInput(data: any): void;
  sendClientContent(data: any): void;
  sendToolResponse?(data: any): void;
  close(): void;
}

/**
 * Resample PCM16 audio from 16 kHz (client) to 24 kHz (OpenAI Realtime API).
 * Uses linear interpolation. Input/output are base64-encoded little-endian int16 samples.
 */
function resample16kTo24k(inputBase64: string): string {
  const inputBuf = Buffer.from(inputBase64, 'base64');
  const inputSamples = Math.floor(inputBuf.length / 2);
  if (inputSamples === 0) return inputBase64;

  const outputSamples = Math.floor(inputSamples * 3 / 2); // 16k * 1.5 = 24k
  const outputBuf = Buffer.allocUnsafe(outputSamples * 2);

  for (let i = 0; i < outputSamples; i++) {
    const inPos = i * 16000 / 24000;
    const inIdx = Math.floor(inPos);
    const frac = inPos - inIdx;
    const s0 = inIdx < inputSamples ? inputBuf.readInt16LE(inIdx * 2) : 0;
    const s1 = inIdx + 1 < inputSamples ? inputBuf.readInt16LE((inIdx + 1) * 2) : s0;
    const sample = Math.round(s0 + frac * (s1 - s0));
    outputBuf.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), i * 2);
  }

  return outputBuf.toString('base64');
}

export function createMessageHandler(
  session: RealtimeSession,
  sendToClient: SendToClient
) {
  let aiTranscriptBuffer = '';
  let sessionReadySent = false;
  let accumulatedUserTranscript = '';

  return function handleMessage(msg: any): void {
    session.lastActivityTime = Date.now();

    switch (msg.type) {
      case 'session.created':
      case 'session.updated': {
        if (!sessionReadySent) {
          sessionReadySent = true;
          sendToClient(session, { type: 'session.ready', sessionId: session.id });
          sendToClient(session, { type: 'session.configured' });
          console.log(`✅ [OpenAI Realtime] Session ready: ${session.id}`);
        }
        break;
      }

      case 'response.audio.delta': {
        if (msg.delta) {
          // Suppress audio when barge-in is active and this turn's audio has been cancelled.
          // The client also gates on turnSeq, but dropping server-side avoids unnecessary
          // network traffic and matches the Gemini handler's behaviour.
          if (session.isInterrupted && session.turnSeq <= session.cancelledTurnSeq) {
            break;
          }
          // If new audio arrives for a turn that has advanced past the cancelled turn,
          // the race is resolved — clear the interrupted flag and resync the client.
          if (session.isInterrupted && session.turnSeq > session.cancelledTurnSeq) {
            session.isInterrupted = false;
            session.cancelledTurnSeq = -1;
            sendToClient(session, { type: 'response.ready', turnSeq: session.turnSeq });
          }
          if (!session.hasReceivedFirstAIAudio) {
            session.hasReceivedFirstAIAudio = true;
            session.hasReceivedFirstAIResponse = true;
          }
          // Emit using the same contract as geminiMessageHandler: audio.delta + delta + turnSeq
          sendToClient(session, {
            type: 'audio.delta',
            delta: msg.delta,
            turnSeq: session.turnSeq,
          });
        }
        break;
      }

      case 'response.audio_transcript.delta': {
        if (msg.delta) {
          // Provisional barge-in guard: if new AI transcript arrives while the session is
          // still marked as interrupted (race condition where the new response beats the
          // response.cancelled event), clear the interrupted state immediately and resync
          // the client's expectedTurnSeq — mirrors Gemini handler's outputTranscription guard.
          if (session.isInterrupted) {
            console.log(`[OpenAI Realtime] New transcript arrived while interrupted — clearing barge-in state, sending response.ready (turnSeq=${session.turnSeq})`);
            session.isInterrupted = false;
            session.cancelledTurnSeq = -1;
            sendToClient(session, { type: 'response.ready', turnSeq: session.turnSeq });
          }
          aiTranscriptBuffer += msg.delta;
          session.currentTranscript += msg.delta;
          if (!session.hasReceivedFirstTranscriptDelta) {
            session.hasReceivedFirstTranscriptDelta = true;
            session.firstGreetingRetryCount = 3;
          }
          sendToClient(session, { type: 'ai.transcription.delta', text: msg.delta });
        }
        break;
      }

      case 'response.done': {
        const fullTranscript = aiTranscriptBuffer.trim();
        aiTranscriptBuffer = '';
        session.currentTranscript = '';
        const wasInterrupted = session.isInterrupted;
        session.isInterrupted = false;
        session.cancelledTurnSeq = -1;
        session.turnSeq++;
        session.toolCallCountThisTurn = 0;
        session.emotionCallCountThisTurn = 0;
        session.currentTurnIncidentFired = false;

        // If barge-in was active but no response.cancelled arrived (race: AI finished just before
        // the cancel reached OpenAI), resync the client's expectedTurnSeq here so the next
        // response's audio is not dropped indefinitely.
        if (wasInterrupted) {
          sendToClient(session, { type: 'response.ready', turnSeq: session.turnSeq });
        }

        // Signal end-of-response so client stops the AI speaking animation
        sendToClient(session, { type: 'response.done' });

        if (fullTranscript) {
          if (session.recentMessages) {
            session.recentMessages.push({ role: 'ai', text: fullTranscript.slice(0, 300) });
            if (session.recentMessages.length > 30) {
              session.recentMessages.splice(0, session.recentMessages.length - 30);
            }
          }

          // Async emotion analysis using Gemini (even when voice provider is OpenAI)
          const geminiApiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
          if (geminiApiKey) {
            const gai = new GoogleGenAI({ apiKey: geminiApiKey });
            analyzeEmotion(fullTranscript, session.userLanguage, gai)
              .then(({ emotion, emotionReason }) => {
                sendToClient(session, {
                  type: 'ai.transcription.done',
                  text: fullTranscript,
                  emotion,
                  emotionReason,
                  turnSeq: session.turnSeq,
                });
              })
              .catch((e: any) => {
                console.warn('[OpenAI Realtime] Emotion analysis failed:', e);
                sendToClient(session, {
                  type: 'ai.transcription.done',
                  text: fullTranscript,
                  emotion: '중립',
                  emotionReason: '',
                  turnSeq: session.turnSeq,
                });
              });
          } else {
            sendToClient(session, {
              type: 'ai.transcription.done',
              text: fullTranscript,
              emotion: '중립',
              emotionReason: '',
              turnSeq: session.turnSeq,
            });
          }
        }
        break;
      }

      case 'conversation.item.input_audio_transcription.delta': {
        if (msg.delta) {
          accumulatedUserTranscript += msg.delta;
          session.userTranscriptBuffer = accumulatedUserTranscript;
          sendToClient(session, {
            type: 'user.transcription.delta',
            text: msg.delta,
            accumulated: accumulatedUserTranscript,
          });
        }
        break;
      }

      case 'conversation.item.input_audio_transcription.completed': {
        const userText = (msg.transcript || accumulatedUserTranscript).trim();
        accumulatedUserTranscript = '';
        session.userTranscriptBuffer = '';
        session.userTurnsCompleted++;
        session.lastEvaluatedUserTurnIndex = -1;

        if (userText) {
          // Match Gemini handler contract: type 'user.transcription' with transcript field
          sendToClient(session, { type: 'user.transcription', transcript: userText });
          if (session.recentMessages) {
            session.recentMessages.push({ role: 'user', text: userText.slice(0, 300) });
            if (session.recentMessages.length > 30) {
              session.recentMessages.splice(0, session.recentMessages.length - 30);
            }
          }
        }
        break;
      }

      case 'input_audio_buffer.speech_started': {
        session.userSpeechStarted = true;
        // Match Gemini handler contract: type 'user.speaking.started'
        sendToClient(session, { type: 'user.speaking.started' });
        break;
      }

      case 'response.cancelled': {
        aiTranscriptBuffer = '';
        session.currentTranscript = '';

        // Increment turnSeq for the cancelled response (mirrors Gemini's turnComplete behaviour).
        // response.cancelled is sent instead of response.done for barge-in, so we must advance
        // the sequence here; otherwise the next response's audio.delta events will carry the
        // same turnSeq as the cancelled turn and the client will silently drop them.
        session.turnSeq++;
        session.toolCallCountThisTurn = 0;
        session.emotionCallCountThisTurn = 0;
        session.currentTurnIncidentFired = false;

        // Clear the interrupted flag and resync the client's expectedTurnSeq so subsequent
        // audio.delta events (turnSeq >= new value) are accepted and not dropped.
        if (session.isInterrupted) {
          session.isInterrupted = false;
          session.cancelledTurnSeq = -1;
        }

        // evaluationInProgress guard: not needed here because the OpenAI adapter does not
        // call evaluateUserResponse (evaluation is Gemini-handler-only). No concurrency
        // risk exists on the OpenAI path.

        sendToClient(session, {
          type: 'response.ready',
          turnSeq: session.turnSeq,
        });
        sendToClient(session, { type: 'response.interrupted' });
        break;
      }

      case 'error': {
        console.error('[OpenAI Realtime] API error:', JSON.stringify(msg.error));
        sendToClient(session, {
          type: 'error',
          error: msg.error?.message || 'OpenAI Realtime API error',
        });
        break;
      }

      default: {
        if (!SILENT_EVENT_TYPES.has(msg.type)) {
          console.log(`[OpenAI Realtime] Unhandled event: ${msg.type}`);
        }
      }
    }
  };
}

function buildSessionConfig(session: RealtimeSession): object {
  const voice = getOpenAIVoice(session.voiceGender, session.activePersonaIndex);
  const langCodeMap: Record<string, string> = {
    ko: 'ko', en: 'en', ja: 'ja', zh: 'zh',
  };
  const lang = langCodeMap[session.userLanguage] || 'ko';

  session.selectedVoice = voice;

  return {
    modalities: ['audio', 'text'],
    instructions: session.systemInstructions,
    voice,
    input_audio_format: 'pcm16',
    output_audio_format: 'pcm16',
    input_audio_transcription: {
      model: 'whisper-1',
      language: lang,
    },
    turn_detection: {
      type: 'server_vad',
      threshold: 0.5,
      prefix_padding_ms: 300,
      silence_duration_ms: 600,
      create_response: true,
    },
    temperature: 0.8,
    max_response_output_tokens: 4096,
  };
}

export function connectOpenAIRealtime(
  model: string,
  session: RealtimeSession,
  sendToClient: SendToClient,
  onClose: (event: { code: number; reason: string }) => void
): Promise<OpenAIRealtimeSessionAdapter> {
  return new Promise((resolve, reject) => {
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return reject(new Error('OPENAI_API_KEY is not set'));
    }

    const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;
    console.log(`🔌 [OpenAI Realtime] Connecting: session=${session.id}, model=${model}`);

    const ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });

    let resolved = false;
    let closed = false;

    const rejectTimeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.terminate();
        reject(new Error('OpenAI Realtime connection timed out (15s)'));
      }
    }, 15000);

    const handleMessage = createMessageHandler(session, sendToClient);

    function sendToOpenAI(message: any): void {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    }

    const adapter: OpenAIRealtimeSessionAdapter = {
      sendRealtimeInput(data: any) {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (data.audio) {
          // Client sends PCM16 at 16kHz; resample to 24kHz for OpenAI Realtime API
          const rawAudio = typeof data.audio === 'object' ? data.audio.data : data.audio;
          const resampled = resample16kTo24k(rawAudio);
          sendToOpenAI({ type: 'input_audio_buffer.append', audio: resampled });
        } else if (data.event === 'END_OF_TURN') {
          // When server_vad is active, committing manually still works for text turns
          sendToOpenAI({ type: 'input_audio_buffer.commit' });
          sendToOpenAI({ type: 'response.create' });
        }
      },
      sendClientContent(data: any) {
        if (ws.readyState !== WebSocket.OPEN) return;
        const turns: Array<{ role?: string; parts?: Array<{ text?: string }> }> = data.turns || [];
        for (const turn of turns) {
          const text = turn.parts?.[0]?.text || '';
          if (text) {
            sendToOpenAI({
              type: 'conversation.item.create',
              item: {
                type: 'message',
                role: 'user',
                content: [{ type: 'input_text', text }],
              },
            });
          }
        }
        if (data.turnComplete) {
          sendToOpenAI({ type: 'response.create' });
        }
      },
      sendToolResponse(_data: any) {
        console.log('[OpenAI Realtime] Tool responses not supported in OpenAI Realtime mode');
      },
      close() {
        if (!closed) {
          closed = true;
          try { ws.close(1000, 'Normal closure'); } catch (_) {}
        }
      },
    };

    ws.on('open', () => {
      clearTimeout(rejectTimeout);
      console.log(`✅ [OpenAI Realtime] WebSocket connected for session: ${session.id}`);

      sendToOpenAI({
        type: 'session.update',
        session: buildSessionConfig(session),
      });

      if (!resolved) {
        resolved = true;
        resolve(adapter);
      }
    });

    ws.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        handleMessage(msg);
      } catch (e) {
        console.error('[OpenAI Realtime] Failed to parse message:', e);
      }
    });

    ws.on('close', (code: number, reason: Buffer) => {
      if (closed) return;
      closed = true;
      const reasonStr = reason?.toString() || '';
      console.log(`🔌 [OpenAI Realtime] WS closed: code=${code}, reason=${reasonStr}`);
      onClose({ code, reason: reasonStr });
    });

    ws.on('error', (err: Error) => {
      clearTimeout(rejectTimeout);
      console.error('[OpenAI Realtime] WebSocket error:', err.message);
      if (!resolved) {
        resolved = true;
        reject(err);
      } else {
        sendToClient(session, { type: 'error', error: `OpenAI Realtime error: ${err.message}` });
      }
    });
  });
}
