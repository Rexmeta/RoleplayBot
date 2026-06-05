import WebSocket from 'ws';
import { RealtimeSession } from './types';
import { buildReconnectSystemInstructions } from './systemPromptBuilder';

type SendToClient = (session: RealtimeSession, message: any) => void;
type ConnectToOpenAI = (session: RealtimeSession) => Promise<void>;
type TrackSessionUsage = (session: RealtimeSession) => void;

const MAX_RECONNECT_ATTEMPTS = 5;

const FATAL_CLOSE_CODES = new Set([1008, 1011, 4001, 4003, 4004]);
const FATAL_REASON_PATTERNS = [
  'invalid api key',
  'authentication',
  'unauthorized',
  'permission_denied',
  'billing',
  'quota',
  'model not found',
  'invalid model',
];

function isFatalClose(event: { code: number; reason: string }): boolean {
  if (FATAL_CLOSE_CODES.has(event.code)) return true;
  const reason = (event.reason ?? '').toLowerCase();
  return FATAL_REASON_PATTERNS.some(p => reason.includes(p));
}

export function handleOpenAIClose(
  event: { code: number; reason: string },
  session: RealtimeSession,
  sessions: Map<string, RealtimeSession>,
  sendToClient: SendToClient,
  connectToOpenAI: ConnectToOpenAI,
  trackSessionUsage: TrackSessionUsage
): void {
  console.log(`🔌 [OpenAI Reconnector] WS closed for session: ${session.id} code=${event.code}`);
  session.geminiSession = null;

  const isNormalClose = event.code === 1000 || event.reason === 'Normal closure';
  const isFatal = !isNormalClose && isFatalClose(event);

  if (isFatal) {
    console.error(`🚫 [OpenAI Reconnector] Fatal close (code=${event.code}): ${event.reason}`);
    sendToClient(session, {
      type: 'error',
      error: `AI 연결 오류 (${event.reason || event.code}). 잠시 후 다시 시도해주세요.`,
      recoverable: false,
    });
    if (session.clientWs?.readyState === WebSocket.OPEN) {
      session.clientWs.close(1000, 'OpenAI fatal error');
    }
    trackSessionUsage(session);
    sessions.delete(session.id);
    return;
  }

  const canReconnect =
    !isNormalClose &&
    session.clientWs?.readyState === WebSocket.OPEN &&
    session.reconnectAttempts < MAX_RECONNECT_ATTEMPTS &&
    !session.isReconnecting;

  if (canReconnect) {
    const sessionId = session.id;

    const attemptReconnect = (attemptNumber: number) => {
      const currentSession = sessions.get(sessionId);
      if (!currentSession) {
        console.log('❌ [OpenAI Reconnector] Session gone, cancelling reconnect');
        return;
      }
      if (currentSession.clientWs.readyState !== WebSocket.OPEN) {
        console.log('❌ [OpenAI Reconnector] Client disconnected, cancelling reconnect');
        trackSessionUsage(currentSession);
        sessions.delete(sessionId);
        return;
      }

      currentSession.isReconnecting = true;
      currentSession.reconnectAttempts = attemptNumber;
      console.log(`🔄 [OpenAI Reconnector] Attempt ${attemptNumber}/${MAX_RECONNECT_ATTEMPTS}...`);

      sendToClient(currentSession, {
        type: 'session.reconnecting',
        attempt: attemptNumber,
        maxAttempts: MAX_RECONNECT_ATTEMPTS,
      });

      const delay = Math.pow(2, attemptNumber - 1) * 1000;

      setTimeout(() => {
        const sess = sessions.get(sessionId);
        if (!sess || sess.clientWs.readyState !== WebSocket.OPEN) {
          console.log('❌ [OpenAI Reconnector] Cancelled (client gone)');
          if (sess) { trackSessionUsage(sess); sessions.delete(sessionId); }
          return;
        }

        const reconnectInstructions = buildReconnectSystemInstructions(sess.systemInstructions, sess.userLanguage);
        sess.systemInstructions = reconnectInstructions;
        sess.usingReconnectInstructions = true;

        connectToOpenAI(sess)
          .then(() => {
            sess.isReconnecting = false;
            sess.reconnectAttempts = 0;
            sess.isInterrupted = false;
            sess.cancelledTurnSeq = -1;
            sess.currentTranscript = '';
            sess.userSpeechStarted = false;
            console.log('✅ [OpenAI Reconnector] Reconnected!');
            sendToClient(sess, { type: 'session.reconnected' });

            if (!sess.geminiSession) return;

            // Replay pending unacked messages (mirrors Gemini reconnector)
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

              const removed = sess.pendingMessages.length - filtered.length;
              if (removed > 0) {
                console.log(`🚫 [OpenAI Reconnector] Filtered ${removed} greeting+EOT messages`);
              }

              if (filtered.length > 0) {
                console.log(`📤 [OpenAI Reconnector] Replaying ${filtered.length} pending messages...`);
                for (const pending of filtered) {
                  try {
                    if (pending.payload.type === 'realtimeInput') {
                      sess.geminiSession.sendRealtimeInput(pending.payload.data);
                    } else if (pending.payload.type === 'clientContent') {
                      sess.geminiSession.sendClientContent(pending.payload.data);
                    }
                  } catch (replayErr) {
                    console.warn(`⚠️ [OpenAI Reconnector] Replay failed (index=${pending.index}):`, replayErr);
                  }
                }
                return;
              }
            }

            // Inject context on reconnect (same fallback as Gemini reconnector)
            const recentMsgs = sess.recentMessages || [];
            if (recentMsgs.length > 0) {
              const userLabel = sess.userName && sess.userName !== '사용자' ? sess.userName : '사용자';
              const personaLabel = sess.personaName || 'AI';
              const historyText = recentMsgs.map(m =>
                `${m.role === 'user' ? userLabel : personaLabel}: ${m.text}`
              ).join('\n');
              const contextText = `[SYSTEM CONTEXT UPDATE — DO NOT READ ALOUD OR ANNOUNCE THIS MESSAGE. You are ${personaLabel}. The connection was briefly interrupted and has been restored. Here is the prior conversation for context only. Do NOT mention the reconnection. Wait silently until the user speaks first.\n\n${historyText}]`;
              sess.geminiSession.sendClientContent({
                turns: [{ role: 'user', parts: [{ text: contextText }] }],
                turnComplete: false,
              });
            }
          })
          .catch((error: any) => {
            console.error(`❌ [OpenAI Reconnector] Failed (attempt ${attemptNumber}):`, error);
            sess.isReconnecting = false;

            if (attemptNumber < MAX_RECONNECT_ATTEMPTS) {
              attemptReconnect(attemptNumber + 1);
            } else {
              console.log('❌ [OpenAI Reconnector] Max attempts exceeded');
              sendToClient(sess, {
                type: 'error',
                error: 'AI 연결을 복구할 수 없습니다. 대화를 다시 시작해주세요.',
                recoverable: false,
              });
              if (sess.clientWs?.readyState === WebSocket.OPEN) {
                sess.clientWs.close(1000, 'OpenAI reconnection failed');
              }
              trackSessionUsage(sess);
              sessions.delete(sessionId);
            }
          });
      }, delay);
    };

    attemptReconnect(1);
    return;
  }

  if (isNormalClose) {
    sendToClient(session, { type: 'session.terminated', reason: 'OpenAI connection closed' });
  } else {
    console.log(`⚠️ [OpenAI Reconnector] Unexpected close: code=${event.code}`);
    sendToClient(session, {
      type: 'error',
      error: 'AI 연결이 일시적으로 끊어졌습니다. 대화를 종료하고 다시 시작해주세요.',
      recoverable: false,
    });
  }

  if (session.clientWs?.readyState === WebSocket.OPEN) {
    session.clientWs.close(1000, 'OpenAI session ended');
  }
  trackSessionUsage(session);
  sessions.delete(session.id);
  console.log(`♻️ [OpenAI Reconnector] Session cleaned up: ${session.id}`);
}
