import WebSocket from 'ws';
import { RealtimeSession } from './types';
import { buildReconnectSystemInstructions } from './systemPromptBuilder';

type SendToClient = (session: RealtimeSession, message: any) => void;
type ConnectToGemini = (session: RealtimeSession, systemInstructions: string, gender: 'male' | 'female') => Promise<void>;
type TrackSessionUsage = (session: RealtimeSession) => void;

const MAX_RECONNECT_ATTEMPTS = 5;

export function handleGeminiClose(
  event: any,
  session: RealtimeSession,
  sessions: Map<string, RealtimeSession>,
  sendToClient: SendToClient,
  connectToGemini: ConnectToGemini,
  trackSessionUsage: TrackSessionUsage
): void {
  console.log(`🔌 Gemini WebSocket closed for session: ${session.id}`, event.reason);
  session.geminiSession = null;

  const isNormalClose = event.code === 1000 || event.reason === 'Normal closure';

  const canReconnect =
    !isNormalClose &&
    session.clientWs &&
    session.clientWs.readyState === WebSocket.OPEN &&
    session.reconnectAttempts < MAX_RECONNECT_ATTEMPTS &&
    !session.isReconnecting;

  if (canReconnect) {
    const sessionId = session.id;

    const attemptReconnect = (attemptNumber: number) => {
      const currentSession = sessions.get(sessionId);
      if (!currentSession) {
        console.log('❌ 재연결 취소: 세션이 존재하지 않음');
        return;
      }
      if (currentSession.clientWs.readyState !== WebSocket.OPEN) {
        console.log('❌ 재연결 취소: 클라이언트 연결 종료됨');
        trackSessionUsage(currentSession);
        sessions.delete(sessionId);
        return;
      }

      currentSession.isReconnecting = true;
      currentSession.reconnectAttempts = attemptNumber;
      console.log(`🔄 자동 재연결 시도 ${attemptNumber}/${MAX_RECONNECT_ATTEMPTS}...`);

      sendToClient(currentSession, {
        type: 'session.reconnecting',
        attempt: attemptNumber,
        maxAttempts: MAX_RECONNECT_ATTEMPTS,
      });

      const delay = Math.pow(2, attemptNumber - 1) * 1000;

      setTimeout(() => {
        const sess = sessions.get(sessionId);
        if (!sess || sess.clientWs.readyState !== WebSocket.OPEN) {
          console.log('❌ 재연결 취소: 클라이언트 연결 종료됨');
          if (sess) {
            trackSessionUsage(sess);
            sessions.delete(sessionId);
          }
          return;
        }

        console.log(`🔌 Gemini 재연결 중... (attempt ${attemptNumber})`);
        const reconnectInstructions = buildReconnectSystemInstructions(sess.systemInstructions, sess.userLanguage);
        connectToGemini(sess, reconnectInstructions, sess.voiceGender)
          .then(() => {
            sess.isReconnecting = false;
            sess.reconnectAttempts = 0;
            sess.isInterrupted = false;
            sess.cancelledTurnSeq = -1;
            sess.currentTranscript = '';
            console.log(`✅ Gemini 재연결 성공!`);
            sendToClient(sess, { type: 'session.reconnected' });

            if (sess.geminiSession) {
              if (sess.pendingMessages.length > 0) {
                console.log(`📤 재연결 후 미확인 메시지 ${sess.pendingMessages.length}개 재전송...`);
                for (const pending of sess.pendingMessages) {
                  try {
                    if (pending.payload.type === 'realtimeInput') {
                      sess.geminiSession.sendRealtimeInput(pending.payload.data);
                    } else if (pending.payload.type === 'clientContent') {
                      sess.geminiSession.sendClientContent(pending.payload.data);
                    }
                  } catch (replayErr) {
                    console.warn(`⚠️ 메시지 재전송 실패 (index=${pending.index}):`, replayErr);
                  }
                }
              } else {
                console.log('📤 재연결 후 대화 재개 트리거...');
                const recentMsgs = sess.recentMessages || [];
                const reconnectUserLabel = sess.userName && sess.userName !== '사용자' ? sess.userName : '사용자';
                let reconnectText: string;
                if (recentMsgs.length > 0) {
                  const historyText = recentMsgs.map(m =>
                    `${m.role === 'user' ? reconnectUserLabel : '당신'}: ${m.text}`
                  ).join('\n');
                  reconnectText = `[SYSTEM CONTEXT UPDATE — DO NOT READ ALOUD OR ANNOUNCE THIS MESSAGE. The connection was briefly interrupted due to a technical issue and has now been restored. The following is the prior conversation history for your context only. Do not mention the reconnection. Do not greet. Continue speaking mid-conversation exactly where you left off:\n\n${historyText}]`;
                  console.log(`📜 재연결 컨텍스트 복원: ${recentMsgs.length}개 메시지`);
                } else {
                  reconnectText = '[SYSTEM CONTEXT UPDATE — DO NOT READ ALOUD OR ANNOUNCE THIS MESSAGE. The connection was briefly interrupted and has been restored. Continue the conversation naturally without mentioning the reconnection or greeting.]';
                }

                sess.geminiSession.sendClientContent({
                  turns: [{ role: 'user', parts: [{ text: reconnectText }] }],
                  turnComplete: true,
                });
                sess.geminiSession.sendRealtimeInput({ event: 'END_OF_TURN' });
              }
            }
          })
          .catch((error) => {
            console.error(`❌ Gemini 재연결 실패 (attempt ${attemptNumber}):`, error);
            sess.isReconnecting = false;

            if (attemptNumber < MAX_RECONNECT_ATTEMPTS) {
              console.log(`🔄 다음 재시도 스케줄링... (${attemptNumber + 1}/${MAX_RECONNECT_ATTEMPTS})`);
              attemptReconnect(attemptNumber + 1);
            } else {
              console.log(`❌ 최대 재시도 횟수 초과 - 세션 종료`);
              sendToClient(sess, {
                type: 'error',
                error: 'AI 연결을 복구할 수 없습니다. 대화를 다시 시작해주세요.',
                recoverable: false,
              });

              if (sess.clientWs && sess.clientWs.readyState === WebSocket.OPEN) {
                sess.clientWs.close(1000, 'Gemini reconnection failed');
              }
              trackSessionUsage(sess);
              sessions.delete(sessionId);
              console.log(`♻️  Session cleaned up after failed reconnection: ${sessionId}`);
            }
          });
      }, delay);
    };

    attemptReconnect(1);
    return;
  }

  if (isNormalClose) {
    sendToClient(session, {
      type: 'session.terminated',
      reason: 'Gemini connection closed',
    });
  } else {
    console.log(`⚠️ Unexpected Gemini disconnection: code=${event.code}, reason=${event.reason}`);
    sendToClient(session, {
      type: 'error',
      error: 'AI 연결이 일시적으로 끊어졌습니다. 대화를 종료하고 다시 시작해주세요.',
      recoverable: false,
    });
  }

  if (session.clientWs && session.clientWs.readyState === WebSocket.OPEN) {
    session.clientWs.close(1000, 'Gemini session ended');
  }

  trackSessionUsage(session);
  sessions.delete(session.id);
  console.log(`♻️  Session cleaned up: ${session.id}`);
}
