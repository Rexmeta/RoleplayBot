import { trackUsage } from '../aiUsageTracker';
import { RealtimeSession, SESSION_TIMEOUT_MS, MAX_CONCURRENT_SESSIONS } from './types';

export function startCleanupScheduler(
  intervalMs: number,
  sessions: Map<string, RealtimeSession>,
  closeSession: (sessionId: string) => void
): NodeJS.Timeout {
  const handle = setInterval(() => {
    cleanupInactiveSessions(sessions, closeSession);
  }, intervalMs);
  console.log(`🧹 Session cleanup scheduler started (interval: ${intervalMs / 1000}s)`);
  return handle;
}

export function cleanupInactiveSessions(
  sessions: Map<string, RealtimeSession>,
  closeSession: (sessionId: string) => void
): void {
  const now = Date.now();
  const sessionsToClose: string[] = [];

  sessions.forEach((session, sessionId) => {
    if (now - session.lastActivityTime > SESSION_TIMEOUT_MS) {
      console.log(`⏰ Session ${sessionId} inactive for ${Math.round((now - session.lastActivityTime) / 60000)}min, marking for cleanup`);
      sessionsToClose.push(sessionId);
    }
  });

  for (const sessionId of sessionsToClose) {
    closeSession(sessionId);
  }

  if (sessionsToClose.length > 0) {
    console.log(`🧹 Cleaned up ${sessionsToClose.length} inactive sessions. Active: ${sessions.size}`);
  }
}

export function trackSessionUsage(session: RealtimeSession): void {
  if ((session as any)._usageTracked) return;
  (session as any)._usageTracked = true;

  const durationMs = Date.now() - session.startTime;
  const estimatedUserTokens = Math.ceil(session.totalUserTranscriptLength / 2);
  const estimatedAiTokens = Math.ceil(session.totalAiTranscriptLength / 2);
  const audioTokenMultiplier = 1.5;
  const totalPromptTokens = Math.ceil(estimatedUserTokens * audioTokenMultiplier);
  const totalCompletionTokens = Math.ceil(estimatedAiTokens * audioTokenMultiplier);

  if (totalPromptTokens > 0 || totalCompletionTokens > 0) {
    trackUsage({
      feature: 'realtime', model: session.realtimeModel, provider: 'gemini',
      promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens,
      userId: session.userId, conversationId: session.conversationId, durationMs,
      metadata: {
        scenarioId: session.scenarioId, personaId: session.personaId,
        totalUserTranscriptLength: session.totalUserTranscriptLength,
        totalAiTranscriptLength: session.totalAiTranscriptLength,
        estimationMethod: 'transcript_length_based',
      }
    });
    console.log(`📊 Realtime usage tracked: ${totalPromptTokens} prompt + ${totalCompletionTokens} completion tokens, duration: ${Math.round(durationMs / 1000)}s`);
  }
}

export function getActiveSessionCount(sessions: Map<string, RealtimeSession>): number {
  return sessions.size;
}

export function getSessionStatus(sessions: Map<string, RealtimeSession>): {
  activeSessions: number;
  maxSessions: number;
  availableSlots: number;
  utilizationPercent: number;
  sessions: Array<{ id: string; personaName: string; durationSec: number; isConnected: boolean }>;
} {
  const now = Date.now();
  const activeSessions = sessions.size;
  return {
    activeSessions,
    maxSessions: MAX_CONCURRENT_SESSIONS,
    availableSlots: Math.max(0, MAX_CONCURRENT_SESSIONS - activeSessions),
    utilizationPercent: Math.round((activeSessions / MAX_CONCURRENT_SESSIONS) * 100),
    sessions: Array.from(sessions.values()).map(session => ({
      id: session.id.split('-').slice(0, 2).join('-') + '...',
      personaName: session.personaName,
      durationSec: Math.round((now - session.startTime) / 1000),
      isConnected: session.isConnected,
    })),
  };
}
