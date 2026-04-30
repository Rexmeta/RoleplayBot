import WebSocket from 'ws';
import { GoogleGenAI } from '@google/genai';
import { RealtimeSession } from './types';
import { filterThinkingText } from './textFilter';

type SendToClient = (session: RealtimeSession, message: any) => void;

const CONTEXT_WINDOW_SIZE = 30;

export async function summarizeOlderMessages(
  messages: Array<{ role: 'user' | 'ai'; content: string }>,
  userLanguage: string
): Promise<string> {
  const geminiApiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    console.warn('⚠️ No Gemini API key for summarization, skipping');
    return messages.map(m => `${m.role === 'user' ? '사용자' : 'AI'}: ${m.content}`).join('\n');
  }

  const genAI = new GoogleGenAI({ apiKey: geminiApiKey });
  const conversationText = messages
    .map(m => `${m.role === 'user' ? '사용자' : 'AI'}: ${m.content}`)
    .join('\n');

  const langInstruction = userLanguage === 'ko'
    ? '한국어로 요약해 주세요.'
    : userLanguage === 'ja'
      ? '日本語で要約してください。'
      : userLanguage === 'zh'
        ? '请用中文总结。'
        : 'Please summarize in English.';

  const prompt = `다음 대화 내용을 핵심 맥락 중심으로 간결하게 요약해 주세요. AI가 이전 대화를 기억하는 데 필요한 핵심 사실, 감정 흐름, 주요 합의나 갈등 포인트만 포함하세요. ${langInstruction}\n\n대화:\n${conversationText}`;

  try {
    const response = await genAI.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    const summary = response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    console.log(`📝 [Summarizer] Summarized ${messages.length} messages into ${summary.length} chars`);
    return summary;
  } catch (err) {
    console.error('❌ [Summarizer] Failed to summarize older messages:', err);
    return messages.map(m => `${m.role === 'user' ? '사용자' : 'AI'}: ${m.content}`).join('\n');
  }
}

export function handleClientMessage(
  sessionId: string,
  message: any,
  sessions: Map<string, RealtimeSession>,
  sendToClient: SendToClient
): void {
  const session = sessions.get(sessionId);
  if (!session) {
    console.error(`Session not found: ${sessionId}`);
    return;
  }

  session.lastActivityTime = Date.now();

  if (!session.isConnected || !session.geminiSession) {
    if (message.type === 'client.ready') {
      console.log(`⏸️ Gemini not ready yet, buffering client.ready message for session: ${sessionId}`);
      session.pendingClientReady = message;
      return;
    }
    console.warn(`⚠️ Gemini not connected for session: ${sessionId}, dropping message type: ${message.type}`);
    return;
  }

  switch (message.type) {
    case 'input_audio_buffer.append': {
      const audioLength = message.audio ? message.audio.length : 0;
      console.log(`🎤 Received audio chunk: ${audioLength} bytes (base64)`);
      session.geminiSession.sendRealtimeInput({
        audio: {
          data: message.audio,
          mimeType: 'audio/pcm;rate=16000',
        },
      });
      break;
    }

    case 'input_audio_buffer.commit':
      console.log('📤 User stopped recording, sending END_OF_TURN event');
      session.geminiSession.sendRealtimeInput({ event: 'END_OF_TURN' });
      break;

    case 'response.create':
      console.log('🔄 Explicit response request, sending END_OF_TURN event');
      session.geminiSession.sendRealtimeInput({ event: 'END_OF_TURN' });
      break;

    case 'conversation.item.create':
      if (message.item && message.item.content) {
        const text = message.item.content[0]?.text || '';
        session.geminiSession.sendClientContent({
          turns: [{ role: 'user', parts: [{ text }] }],
          turnComplete: true,
        });
      }
      break;

    case 'client.ready': {
      const clientReadyTime = Date.now();
      console.log(`⏱️ [TIMING] client.ready 수신: ${new Date(clientReadyTime).toISOString()}`);

      const hasExistingConversation = message.hasExistingConversation === true;
      const isResuming = message.isResuming === true;
      const clientPreviousMessages = message.previousMessages as Array<{ role: 'user' | 'ai'; content: string }> | undefined;
      const previousMessages: Array<{ role: 'user' | 'ai'; content: string }> | undefined =
        (clientPreviousMessages && clientPreviousMessages.length > 0)
          ? clientPreviousMessages
          : session.recentMessages.length > 0
            ? session.recentMessages.map(m => ({ role: m.role, content: m.text }))
            : undefined;
      if (!clientPreviousMessages?.length && previousMessages?.length) {
        console.log(`📚 [client.ready] Using ${previousMessages.length} server-preloaded messages as context fallback`);
      }

      if (hasExistingConversation) {
        console.log('🔇 Text-to-voice transition: skipping greeting, injecting context');

        session.hasTriggeredFirstGreeting = true;
        session.hasReceivedFirstAIResponse = true;

        const geminiSessionRef = session.geminiSession;
        const userLanguage = session.userLanguage;
        const userLabel = session.userName && session.userName !== '사용자' ? session.userName : '사용자';
        const voiceSwitchInstruction = `[사용자가 음성 모드로 전환했습니다. 지금까지 텍스트 대화에서 유지해온 캐릭터, 말투, 분위기, 감정 상태를 그대로 이어받아 주세요. 새로 인사하거나 재연결을 언급하지 마세요. 사용자가 먼저 발화할 때까지 조용히 대기하세요. 사용자가 발화하면 이전 대화의 톤과 맥락을 자연스럽게 이어서 음성에 맞게 간결하게 말하세요.]`;

        (async () => {
          let contextMessage: string;

          if (previousMessages && previousMessages.length > 0) {
            if (previousMessages.length > CONTEXT_WINDOW_SIZE) {
              const olderMessages = previousMessages.slice(0, previousMessages.length - CONTEXT_WINDOW_SIZE);
              const recentMessages = previousMessages.slice(-CONTEXT_WINDOW_SIZE);

              console.log(`📝 [Summarizer] Text-to-voice: summarizing ${olderMessages.length} older messages`);
              const summary = await summarizeOlderMessages(olderMessages, userLanguage);

              const recentSummary = recentMessages.map(m =>
                `${m.role === 'user' ? userLabel : '당신'}: ${m.content}`
              ).join('\n');

              contextMessage = `[이전 대화 요약]\n${summary}\n\n[최근 대화 내용]\n${recentSummary}\n\n${voiceSwitchInstruction}`;
            } else {
              const conversationSummary = previousMessages.map(m =>
                `${m.role === 'user' ? userLabel : '당신'}: ${m.content}`
              ).join('\n');

              contextMessage = `[이전 텍스트 대화 내용]\n${conversationSummary}\n\n${voiceSwitchInstruction}`;
            }
          } else {
            contextMessage = `[이미 텍스트로 대화가 진행 중이었습니다.]\n\n${voiceSwitchInstruction}`;
          }

          geminiSessionRef.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: contextMessage }] }],
            turnComplete: true,
          });
          geminiSessionRef.sendRealtimeInput({ event: 'END_OF_TURN' });
        })().catch(err => console.error('❌ Failed to build/send text-to-voice context:', err));
      } else if (isResuming && previousMessages && previousMessages.length > 0) {
        console.log(`🔄 Resuming voice conversation with ${previousMessages.length} previous messages`);
        const hadPreviousAIResponse = previousMessages.some(m => m.role === 'ai');

        session.hasTriggeredFirstGreeting = true;
        if (hadPreviousAIResponse) {
          session.hasReceivedFirstAIResponse = true;
        }

        const geminiSessionRef = session.geminiSession;
        const userLanguage = session.userLanguage;
        const userLabel = session.userName && session.userName !== '사용자' ? session.userName : '사용자';

        (async () => {
          let resumeContext: string;

          if (previousMessages.length > CONTEXT_WINDOW_SIZE) {
            const olderMessages = previousMessages.slice(0, previousMessages.length - CONTEXT_WINDOW_SIZE);
            const recentMessages = previousMessages.slice(-CONTEXT_WINDOW_SIZE);

            console.log(`📝 [Summarizer] Messages exceed ${CONTEXT_WINDOW_SIZE} — summarizing ${olderMessages.length} older messages`);
            const summary = await summarizeOlderMessages(olderMessages, userLanguage);

            const recentSummary = recentMessages.map(m =>
              `${m.role === 'user' ? userLabel : '당신'}: ${m.content}`
            ).join('\n');

            resumeContext = `[이전 대화 요약]\n${summary}\n\n[최근 대화 내용]\n${recentSummary}\n\n[대화 재개 - 이전 대화 맥락을 기억하세요. 재연결되었음을 언급하거나 인사하지 마세요. "다시 연결되었네요", "어디까지 얘기했죠?" 같은 표현은 절대 하지 마세요. 사용자가 먼저 말할 때까지 침묵을 유지하고, 사용자가 발화하면 이전 대화 맥락을 자연스럽게 이어서 반응하세요.]`;
          } else {
            const conversationSummary = previousMessages.map(m =>
              `${m.role === 'user' ? userLabel : '당신'}: ${m.content}`
            ).join('\n');

            resumeContext = `[이전 대화 내용 - 이 대화를 이어서 진행합니다]\n${conversationSummary}\n\n[대화 재개 - 이전 대화 맥락을 기억하세요. 재연결되었음을 언급하거나 인사하지 마세요. "다시 연결되었네요", "어디까지 얘기했죠?" 같은 표현은 절대 하지 마세요. 사용자가 먼저 말할 때까지 침묵을 유지하고, 사용자가 발화하면 이전 대화 맥락을 자연스럽게 이어서 반응하세요.]`;
          }

          console.log(`📤 Sending resume context to Gemini (had previous AI response: ${hadPreviousAIResponse})`);

          geminiSessionRef.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: resumeContext }] }],
            turnComplete: true,
          });
          geminiSessionRef.sendRealtimeInput({ event: 'END_OF_TURN' });
        })().catch(err => console.error('❌ Failed to build/send resume context:', err));
      } else {
        console.log('🎬 Client ready signal received - triggering first greeting...');

        if (session.hasTriggeredFirstGreeting || session.hasReceivedFirstAIResponse) {
          console.log('⏭️ First greeting already triggered or received, skipping duplicate trigger');
          break;
        }

        session.hasTriggeredFirstGreeting = true;

        const greetingText = `안녕하세요`;
        console.log(`📤 Sending greeting trigger: "${greetingText}"`);

        session.geminiSession.sendClientContent({
          turns: [{ role: 'user', parts: [{ text: greetingText }] }],
          turnComplete: true,
        });

        console.log('📤 Sending END_OF_TURN to trigger AI greeting response...');
        session.geminiSession.sendRealtimeInput({ event: 'END_OF_TURN' });
      }
      break;
    }

    case 'response.cancel':
      if (session.isInterrupted) {
        console.log(`⚡ Barge-in already active (cancelledTurn=${session.cancelledTurnSeq}), ignoring duplicate cancel`);
        break;
      }

      console.log(`⚡ Barge-in: Canceling turn ${session.turnSeq}`);
      session.isInterrupted = true;
      session.cancelledTurnSeq = session.turnSeq;

      if (session.currentTranscript.trim()) {
        const partialTranscript = filterThinkingText(session.currentTranscript, session.userLanguage);
        if (partialTranscript) {
          console.log(`📝 Saving partial AI transcript before barge-in: "${partialTranscript.substring(0, 50)}..."`);
          sendToClient(session, {
            type: 'ai.transcription.done',
            text: partialTranscript + '...',
            emotion: '중립',
            emotionReason: '사용자가 대화를 중단했습니다',
            interrupted: true,
          });
        }
      }

      session.currentTranscript = '';

      sendToClient(session, { type: 'response.interrupted' });
      break;

    case 'ping':
      sendToClient(session, { type: 'pong' });
      break;

    default:
      console.log(`Unknown client message type: ${message.type}`);
  }
}
