import WebSocket from 'ws';
import { RealtimeSession } from './types';
import { filterThinkingText } from './textFilter';

type SendToClient = (session: RealtimeSession, message: any) => void;

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

      const isResuming = message.isResuming === true;
      const previousMessages = message.previousMessages as Array<{ role: 'user' | 'ai'; content: string }> | undefined;

      if (isResuming && previousMessages && previousMessages.length > 0) {
        console.log(`🔄 Resuming conversation with ${previousMessages.length} previous messages`);
        const hadPreviousAIResponse = previousMessages.some(m => m.role === 'ai');
        const conversationSummary = previousMessages.map(m =>
          `${m.role === 'user' ? '사용자' : '당신'}: ${m.content}`
        ).join('\n');

        const resumeContext = `[이전 대화 내용 - 이 대화를 이어서 진행합니다]\n${conversationSummary}\n\n[대화 재개 - 이전 대화 맥락을 기억하세요. 재연결되었음을 언급하거나 인사하지 마세요. "다시 연결되었네요", "어디까지 얘기했죠?" 같은 표현은 절대 하지 마세요. 사용자가 먼저 말할 때까지 침묵을 유지하고, 사용자가 발화하면 이전 대화 맥락을 자연스럽게 이어서 반응하세요.]`;

        console.log(`📤 Sending resume context to Gemini (had previous AI response: ${hadPreviousAIResponse})`);

        session.hasTriggeredFirstGreeting = true;
        if (hadPreviousAIResponse) {
          session.hasReceivedFirstAIResponse = true;
        }

        session.geminiSession.sendClientContent({
          turns: [{ role: 'user', parts: [{ text: resumeContext }] }],
          turnComplete: true,
        });
        session.geminiSession.sendRealtimeInput({ event: 'END_OF_TURN' });
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
