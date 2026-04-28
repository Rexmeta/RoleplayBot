import WebSocket from 'ws';
import { RealtimeSession } from './types';

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
  session.isConnected = false;

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
        connectToGemini(sess, sess.systemInstructions, sess.voiceGender)
          .then(() => {
            sess.isReconnecting = false;
            sess.reconnectAttempts = 0;
            console.log(`✅ Gemini 재연결 성공!`);
            sendToClient(sess, { type: 'session.reconnected' });

            if (sess.geminiSession) {
              console.log('📤 재연결 후 대화 재개 트리거...');
              const recentMsgs = sess.recentMessages || [];
              let reconnectText: string;
              if (recentMsgs.length > 0) {
                const historyText = recentMsgs.map(m =>
                  `${m.role === 'user' ? '사용자' : '당신'}: ${m.text}`
                ).join('\n');
                reconnectText = `[일시적인 기술 문제로 연결이 잠깐 끊어졌지만 복구되었습니다. 방금 전 나눈 대화 내용을 기억하세요:\n${historyText}\n\n이 대화를 자연스럽게 이어서 진행하세요. "다시 연결됐네요" 정도로 짧게 언급하고 바로 대화를 이어가세요.]`;
                console.log(`📜 재연결 컨텍스트 복원: ${recentMsgs.length}개 메시지`);
              } else {
                reconnectText = '(기술적 문제가 해결되었습니다. 이전 대화를 이어서 간단히 확인 질문을 해주세요.)';
              }

              sess.geminiSession.sendClientContent({
                turns: [{ role: 'user', parts: [{ text: reconnectText }] }],
                turnComplete: true,
              });
              sess.geminiSession.sendRealtimeInput({ event: 'END_OF_TURN' });
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
