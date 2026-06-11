import WebSocket from 'ws';
import { GoogleGenAI } from '@google/genai';
import { RealtimeSession, PendingOutgoingMessage, MAX_PENDING_MESSAGES } from './types';
import { filterThinkingText } from './textFilter';

function pushPending(session: RealtimeSession, msg: PendingOutgoingMessage): void {
  session.pendingMessages.push(msg);
  if (session.pendingMessages.length > MAX_PENDING_MESSAGES) {
    session.pendingMessages.splice(0, session.pendingMessages.length - MAX_PENDING_MESSAGES);
  }
}

type SendToClient = (session: RealtimeSession, message: any) => void;

const CONTEXT_WINDOW_SIZE = 30;

export async function summarizeOlderMessages(
  messages: Array<{ role: 'user' | 'ai'; content: string }>,
  userLanguage: string
): Promise<string> {
  const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
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
  sendToClient: SendToClient,
  proactiveReconnect?: (session: RealtimeSession) => void
): void {
  const session = sessions.get(sessionId);
  if (!session) {
    console.error(`Session not found: ${sessionId}`);
    return;
  }

  session.lastActivityTime = Date.now();

  if (!session.geminiSession) {
    if (message.type === 'client.ready') {
      console.log(`⏸️ Gemini not ready yet, buffering client.ready message for session: ${sessionId}`);
      session.pendingClientReady = message;
      if (message.isResuming === true) session.pendingIsResuming = true;
      if (message.hasExistingConversation === true) session.pendingHasExistingConversation = true;
      return;
    }
    console.warn(`⚠️ Gemini not connected for session: ${sessionId}, dropping message type: ${message.type}`);
    return;
  }

  switch (message.type) {
    case 'input_audio_buffer.append': {
      const audioLength = message.audio ? message.audio.length : 0;
      console.log(`🎤 Received audio chunk: ${audioLength} bytes (base64)`);
      if (session.suppressAIUntilUserSpeaks) {
        session.suppressAIUntilUserSpeaks = false;
        console.log('🔊 User started speaking — lifting suppressAIUntilUserSpeaks');
      }
      const audioPayload = {
        audio: { data: message.audio, mimeType: 'audio/pcm;rate=16000' },
      };
      pushPending(session, { index: session.outgoingMessageIndex++, payload: { type: 'realtimeInput', data: audioPayload } });
      session.geminiSession.sendRealtimeInput(audioPayload);
      break;
    }

    case 'input_audio_buffer.commit':
      console.log('📤 User stopped recording, sending END_OF_TURN event');
      pushPending(session, { index: session.outgoingMessageIndex++, payload: { type: 'realtimeInput', data: { event: 'END_OF_TURN' } } });
      session.geminiSession.sendRealtimeInput({ event: 'END_OF_TURN' });
      break;

    case 'response.create': {
      // If we just sent clientContent (text input with turnComplete:true), the
      // model will already respond — an extra END_OF_TURN causes a spurious
      // "..." (ctrl46 dots) reply that confuses conversation state. Skip it.
      const msSinceClientContent = Date.now() - session.lastClientContentSentAt;
      if (session.lastClientContentSentAt > 0 && msSinceClientContent < 800) {
        console.log(`⏭️ Skipping redundant response.create (${msSinceClientContent}ms after clientContent)`);
        break;
      }
      console.log('🔄 Explicit response request, sending END_OF_TURN event');
      pushPending(session, { index: session.outgoingMessageIndex++, payload: { type: 'realtimeInput', data: { event: 'END_OF_TURN' } } });
      session.geminiSession.sendRealtimeInput({ event: 'END_OF_TURN' });
      break;
    }

    case 'conversation.item.create':
      if (message.item && message.item.content) {
        const text = message.item.content[0]?.text || '';
        if (text.trim()) {
          // Count text turns so the greeting-dedup guard does not suppress the
          // AI's first reply when the user types before speaking in voice mode.
          session.userTurnsCompleted++;
          console.log(`📝 Text turn received, userTurnsCompleted=${session.userTurnsCompleted}`);
        }
        const clientContentPayload = {
          turns: [{ role: 'user', parts: [{ text }] }],
          turnComplete: true,
        };
        // Record the time so response.create arriving right after can be skipped
        // (clientContent already includes turnComplete:true — the extra END_OF_TURN
        //  causes Gemini to emit spurious ctrl46/dots responses).
        session.lastClientContentSentAt = Date.now();
        pushPending(session, { index: session.outgoingMessageIndex++, payload: { type: 'clientContent', data: clientContentPayload } });
        session.geminiSession.sendClientContent(clientContentPayload);
      }
      break;

    case 'client.ready': {
      const clientReadyTime = Date.now();
      console.log(`⏱️ [TIMING] client.ready 수신: ${new Date(clientReadyTime).toISOString()}`);

      if (session.greetingTimeoutId !== null) {
        clearTimeout(session.greetingTimeoutId);
        session.greetingTimeoutId = null;
        console.log('⏰ client.ready로 인사 타임아웃 취소됨');
      }

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

        if (proactiveReconnect && !session.usingReconnectInstructions) {
          // System prompt still contains greeting instructions — swap it out before
          // the user speaks.  Update session.recentMessages from the client-supplied
          // previousMessages so injectReconnectContext uses the freshest data and the
          // DB timing race (messages not yet committed) cannot cause a re-greeting.
          if (previousMessages && previousMessages.length > 0) {
            session.recentMessages = previousMessages.map(m => ({ role: m.role, text: m.content }));
          }
          console.log('🔀 hasExistingConversation — triggering proactiveReconnect for reconnect-safe system prompt');
          proactiveReconnect(session);
        } else {
          // Already on reconnect-safe prompt (or no proactiveReconnect callback in test
          // contexts) — inject context directly to the existing Gemini session.
          const geminiSessionRef = session.geminiSession;
          const userLanguage = session.userLanguage;
          const userLabel = session.userName && session.userName !== '사용자' ? session.userName : '사용자';
          const personaLabel = session.personaName || 'AI';
          const voiceSwitchInstruction = `[사용자가 음성 모드로 전환했습니다. 당신은 ${personaLabel}입니다. 지금까지 텍스트 대화에서 유지해온 캐릭터, 말투, 분위기, 감정 상태를 그대로 이어받아 주세요. 새로 인사하거나 재연결을 언급하지 마세요. 사용자가 먼저 발화할 때까지 조용히 대기하세요. 사용자가 발화하면 이전 대화의 톤과 맥락을 자연스럽게 이어서 음성에 맞게 간결하게 말하세요.]`;

          (async () => {
            let contextMessage: string;

            if (previousMessages && previousMessages.length > 0) {
              if (previousMessages.length > CONTEXT_WINDOW_SIZE) {
                const olderMessages = previousMessages.slice(0, previousMessages.length - CONTEXT_WINDOW_SIZE);
                const recentMessages = previousMessages.slice(-CONTEXT_WINDOW_SIZE);

                console.log(`📝 [Summarizer] Text-to-voice: summarizing ${olderMessages.length} older messages`);
                const summary = await summarizeOlderMessages(olderMessages, userLanguage);

                const recentSummary = recentMessages.map(m =>
                  `${m.role === 'user' ? userLabel : personaLabel}: ${m.content}`
                ).join('\n');

                contextMessage = `[이전 대화 요약]\n${summary}\n\n[최근 대화 내용]\n${recentSummary}\n\n${voiceSwitchInstruction}`;
              } else {
                const conversationSummary = previousMessages.map(m =>
                  `${m.role === 'user' ? userLabel : personaLabel}: ${m.content}`
                ).join('\n');

                contextMessage = `[이전 텍스트 대화 내용]\n${conversationSummary}\n\n${voiceSwitchInstruction}`;
              }
            } else {
              contextMessage = `[이미 텍스트로 대화가 진행 중이었습니다.]\n\n${voiceSwitchInstruction}`;
            }

            // turnComplete: false — the instruction text already tells Gemini to wait;
            // setting true would cause an immediate unsolicited AI response.
            const ctxPayload = { turns: [{ role: 'user', parts: [{ text: contextMessage }] }], turnComplete: false };
            pushPending(session, { index: session.outgoingMessageIndex++, payload: { type: 'clientContent', data: ctxPayload } });
            // Suppress any unsolicited AI audio that Gemini may generate in response
            // to this turnComplete:false context injection (Gemini sometimes ignores
            // the false flag and speaks the context aloud, causing a duplicate audio).
            session.suppressAIUntilUserSpeaks = true;
            console.log('🔇 suppressAIUntilUserSpeaks=true (text-to-voice context injected)');
            geminiSessionRef.sendClientContent(ctxPayload);
          })().catch(err => console.error('❌ Failed to build/send text-to-voice context:', err));
        }
      } else if (isResuming) {
        session.hasTriggeredFirstGreeting = true;
        session.hasReceivedFirstAIResponse = true;

        if (proactiveReconnect) {
          // For ALL isResuming paths: reconnect with reconnect-safe system instructions.
          // Context injection (from session.recentMessages) is handled inside proactiveReconnect,
          // ensuring the greeting-oriented system prompt is replaced before the user speaks.
          console.log('🔀 isResuming — triggering proactiveReconnect for reconnect-safe system prompt');
          proactiveReconnect(session);
        } else {
          // Fallback: no proactiveReconnect callback (e.g., test contexts or direct callers).
          // Inject context or silence directive directly to the existing Gemini session.
          if (!previousMessages || previousMessages.length === 0) {
            console.log('🔄 isResuming fallback: no previous messages — injecting silence directive');
            const silentContext = session.userLanguage === 'ko'
              ? '[재연결. 인사하지 말고 사용자가 먼저 발화할 때까지 침묵하세요.]'
              : '[Reconnected. Do NOT greet. Wait silently for the user to speak first.]';
            const silencePayload = { turns: [{ role: 'user', parts: [{ text: silentContext }] }], turnComplete: false };
            pushPending(session, { index: session.outgoingMessageIndex++, payload: { type: 'clientContent', data: silencePayload } });
            session.geminiSession.sendClientContent(silencePayload);
          } else {
            console.log(`🔄 isResuming fallback: injecting resume context (${previousMessages.length} messages)`);
            const geminiSessionRef = session.geminiSession;
            const userLanguage = session.userLanguage;
            const userLabel = session.userName && session.userName !== '사용자' ? session.userName : '사용자';
            const resumePersonaLabel = session.personaName || 'AI';

            (async () => {
              let resumeContext: string;
              if (previousMessages.length > CONTEXT_WINDOW_SIZE) {
                const olderMessages = previousMessages.slice(0, previousMessages.length - CONTEXT_WINDOW_SIZE);
                const recentMessages = previousMessages.slice(-CONTEXT_WINDOW_SIZE);
                const summary = await summarizeOlderMessages(olderMessages, userLanguage);
                const recentSummary = recentMessages.map(m =>
                  `${m.role === 'user' ? userLabel : resumePersonaLabel}: ${m.content}`
                ).join('\n');
                resumeContext = `[당신은 ${resumePersonaLabel}입니다. 이전 대화 요약]\n${summary}\n\n[최근 대화 내용]\n${recentSummary}\n\n[대화 재개 - 인사하지 마세요. 사용자가 먼저 말할 때까지 침묵을 유지하세요.]`;
              } else {
                const conversationSummary = previousMessages.map(m =>
                  `${m.role === 'user' ? userLabel : resumePersonaLabel}: ${m.content}`
                ).join('\n');
                resumeContext = `[당신은 ${resumePersonaLabel}입니다. 이전 대화 내용]\n${conversationSummary}\n\n[대화 재개 - 인사하지 마세요. 사용자가 먼저 말할 때까지 침묵을 유지하세요.]`;
              }
              const resumePayload = { turns: [{ role: 'user', parts: [{ text: resumeContext }] }], turnComplete: false };
              pushPending(session, { index: session.outgoingMessageIndex++, payload: { type: 'clientContent', data: resumePayload } });
              geminiSessionRef.sendClientContent(resumePayload);
            })().catch(err => console.error('❌ Failed to build/send resume context:', err));
          }
        }
      } else {
        console.log('🎬 Client ready (fresh start) - triggering AI greeting');
        session.hasTriggeredFirstGreeting = true;
        const greetingText: Record<string, string> = {
          ko: '안녕하세요',
          en: 'Hello',
          ja: 'こんにちは',
          zh: '你好',
        };
        const trigger = greetingText[session.userLanguage] ?? '안녕하세요';
        const greetingPayload = {
          turns: [{ role: 'user', parts: [{ text: trigger }] }],
          turnComplete: true,
        };
        pushPending(session, { index: session.outgoingMessageIndex++, payload: { type: 'clientContent', data: greetingPayload } });
        session.geminiSession.sendClientContent(greetingPayload);
      }
      break;
    }

    case 'response.cancel':
      if (session.isInterrupted) {
        console.log(`⚡ Duplicate barge-in cancel — re-syncing client with turnSeq=${session.turnSeq}`);
        sendToClient(session, { type: 'response.ready', turnSeq: session.turnSeq });
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

      // Increment turnSeq so that any in-flight audio.delta packets from the
      // cancelled turn (which carry the old turnSeq) are filtered out by the
      // client-side turnSeq guard once response.ready is received.
      session.turnSeq++;
      console.log(`📊 Turn seq incremented to ${session.turnSeq} (post-barge-in)`);

      sendToClient(session, { type: 'response.interrupted' });
      sendToClient(session, { type: 'response.ready', turnSeq: session.turnSeq });
      break;

    case 'ping':
      sendToClient(session, { type: 'pong' });
      break;

    default:
      console.log(`Unknown client message type: ${message.type}`);
  }
}
