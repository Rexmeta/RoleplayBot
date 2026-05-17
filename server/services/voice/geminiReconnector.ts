import WebSocket from 'ws';
import { RealtimeSession } from './types';
import { buildReconnectSystemInstructions } from './systemPromptBuilder';

type SendToClient = (session: RealtimeSession, message: any) => void;
type ConnectToGemini = (session: RealtimeSession, systemInstructions: string, gender: 'male' | 'female') => Promise<void>;
type TrackSessionUsage = (session: RealtimeSession) => void;

const MAX_RECONNECT_ATTEMPTS = 5;

// Close codes / reason patterns that indicate a fatal API-level error.
// In these cases reconnecting would never succeed, so we stop immediately.
const FATAL_CLOSE_CODES = new Set([1008, 1011]);
const FATAL_REASON_PATTERNS = [
  'not found for API version',
  'not supported for bidiGenerateContent',
  'unsupported',
  'invalid model',
  'permission_denied',
  'PERMISSION_DENIED',
  'billing',
];

function isFatalClose(event: any): boolean {
  if (FATAL_CLOSE_CODES.has(event.code)) return true;
  const reason: string = event.reason ?? '';
  return FATAL_REASON_PATTERNS.some(p => reason.includes(p));
}

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
  const isFatal = !isNormalClose && isFatalClose(event);

  if (isFatal) {
    console.error(`🚫 [Reconnector] Fatal close detected (code=${event.code}). Stopping reconnect. Reason: ${event.reason}`);
    sendToClient(session, {
      type: 'error',
      error: `AI 연결 오류로 대화를 시작할 수 없습니다 (${event.reason || event.code}). 잠시 후 다시 시도해주세요.`,
      recoverable: false,
    });
    if (session.clientWs && session.clientWs.readyState === WebSocket.OPEN) {
      session.clientWs.close(1000, 'Gemini fatal error');
    }
    trackSessionUsage(session);
    sessions.delete(session.id);
    return;
  }

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
            sess.usingReconnectInstructions = true;
            console.log(`✅ Gemini 재연결 성공!`);
            sendToClient(sess, { type: 'session.reconnected' });

            if (sess.geminiSession) {
              if (sess.pendingMessages.length > 0) {
                const isGreetingTrigger = (msg: any) =>
                  msg.payload.type === 'clientContent' &&
                  msg.payload.data?.turns?.length === 1 &&
                  msg.payload.data.turns[0]?.parts?.length === 1 &&
                  /^안녕하세요\s*$/.test(msg.payload.data.turns[0].parts[0]?.text ?? '');

                const isEndOfTurnInput = (msg: any) =>
                  msg.payload.type === 'realtimeInput' &&
                  msg.payload.data?.event === 'END_OF_TURN';

                const filtered: typeof sess.pendingMessages = [];
                let skipNextEot = false;
                for (const msg of sess.pendingMessages) {
                  if (skipNextEot) {
                    skipNextEot = false;
                    if (isEndOfTurnInput(msg)) continue;
                  }
                  if (isGreetingTrigger(msg)) {
                    skipNextEot = true;
                    continue;
                  }
                  filtered.push(msg);
                }

                const removedCount = sess.pendingMessages.length - filtered.length;
                if (removedCount > 0) {
                  console.log(`🚫 인사 트리거+EOT 메시지 ${removedCount}개 필터링 (재전송 방지)`);
                }
                if (filtered.length > 0) {
                  console.log(`📤 재연결 후 미확인 메시지 ${filtered.length}개 재전송...`);
                  for (const pending of filtered) {
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
                  console.log('🔀 재연결: 모든 pending 메시지 필터링됨 — 컨텍스트 복원으로 폴백');
                  const recentMsgs = sess.recentMessages || [];
                  const reconnectUserLabel2 = sess.userName && sess.userName !== '사용자' ? sess.userName : '사용자';
                  const personaLabel2 = sess.personaName || 'AI';
                  let fallbackReconnectText: string;
                  if (recentMsgs.length > 0) {
                    const historyText2 = recentMsgs.map(m =>
                      `${m.role === 'user' ? reconnectUserLabel2 : personaLabel2}: ${m.text}`
                    ).join('\n');
                    fallbackReconnectText = `[SYSTEM CONTEXT UPDATE — DO NOT READ ALOUD OR ANNOUNCE THIS MESSAGE. You are ${personaLabel2}. The connection was briefly interrupted and has now been restored. The following is the prior conversation history for your context only. Do NOT mention the reconnection. Do NOT greet. Wait silently until the user speaks first, then continue as ${personaLabel2} from where you left off:\n\n${historyText2}]`;
                  } else {
                    fallbackReconnectText = '[SYSTEM CONTEXT UPDATE — DO NOT READ ALOUD OR ANNOUNCE THIS MESSAGE. The connection was briefly interrupted and has been restored. Do NOT greet or announce the reconnection. Wait silently until the user speaks first.]';
                  }
                  sess.geminiSession.sendClientContent({
                    turns: [{ role: 'user', parts: [{ text: fallbackReconnectText }] }],
                    turnComplete: false,
                  });
                }
              } else {
                console.log('📤 재연결 후 대화 재개 트리거...');
                const recentMsgs = sess.recentMessages || [];
                const reconnectUserLabel = sess.userName && sess.userName !== '사용자' ? sess.userName : '사용자';
                let reconnectText: string;
                if (recentMsgs.length > 0) {
                  const personaLabel = sess.personaName || 'AI';
                  const historyText = recentMsgs.map(m =>
                    `${m.role === 'user' ? reconnectUserLabel : personaLabel}: ${m.text}`
                  ).join('\n');
                  reconnectText = `[SYSTEM CONTEXT UPDATE — DO NOT READ ALOUD OR ANNOUNCE THIS MESSAGE. You are ${personaLabel}. The connection was briefly interrupted due to a technical issue and has now been restored. The following is the prior conversation history for your context only. Do NOT mention the reconnection. Do NOT greet. Wait silently until the user speaks first, then continue as ${personaLabel} from where you left off:\n\n${historyText}]`;
                  console.log(`📜 재연결 컨텍스트 복원: ${recentMsgs.length}개 메시지`);
                } else {
                  reconnectText = '[SYSTEM CONTEXT UPDATE — DO NOT READ ALOUD OR ANNOUNCE THIS MESSAGE. The connection was briefly interrupted and has been restored. Do NOT greet or announce the reconnection. Wait silently until the user speaks first.]';
                }

                sess.geminiSession.sendClientContent({
                  turns: [{ role: 'user', parts: [{ text: reconnectText }] }],
                  turnComplete: false,
                });
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
