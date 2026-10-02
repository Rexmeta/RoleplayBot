import { createHash } from 'node:crypto';
import type { RealtimeSession } from './types';
import { recordProviderEvidence } from './recognitionEvidence';

export const SUPPORTED_VOICE_LANGUAGES = ['ko', 'en', 'ja', 'zh'] as const;
export type SupportedVoiceLanguage = typeof SUPPORTED_VOICE_LANGUAGES[number];
export type RealtimeVoiceProvider = 'gemini' | 'openai';

type SendToClient = (session: RealtimeSession, message: any) => void;

export function normalizeVoiceLanguage(value: unknown): SupportedVoiceLanguage {
  return typeof value === 'string' &&
    (SUPPORTED_VOICE_LANGUAGES as readonly string[]).includes(value)
    ? value as SupportedVoiceLanguage
    : 'ko';
}

export function providerTranscriptionLanguage(
  language: SupportedVoiceLanguage,
  provider: RealtimeVoiceProvider,
): string {
  if (provider === 'openai') return language;
  return {
    ko: 'ko-KR',
    en: 'en-US',
    ja: 'ja-JP',
    zh: 'zh-CN',
  }[language];
}

export function realtimeVoiceProvider(session: RealtimeSession): RealtimeVoiceProvider {
  return session.realtimeModel.startsWith('gpt-') ? 'openai' : 'gemini';
}

function shortHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
}

function sessionFingerprint(session: RealtimeSession): string {
  return shortHash(session.id).slice(0, 10);
}

export function recordVoiceSessionConfiguration(
  session: RealtimeSession,
  provider: RealtimeVoiceProvider,
  providerLanguageCode: string,
): void {
  console.log('[voice-session-config]', JSON.stringify({
    provider,
    session: sessionFingerprint(session),
    language: session.userLanguage,
    providerLanguageCode: provider === 'openai' ? providerLanguageCode : null,
    explicitTranscriptionLanguageSupported: provider === 'openai',
    model: session.realtimeModel,
    reconnect: session.isReconnecting || session.usingReconnectInstructions,
  }));
}

export function recordUserTranscriptDiagnostic(
  session: RealtimeSession,
  details: {
    stage: 'provider.delta' | 'provider.final' | 'server.provisional' | 'server.final' | 'server.duplicate';
    provider: RealtimeVoiceProvider;
    source: string;
    transcript: string;
    turnId?: string | null;
    providerEventId?: string | null;
  },
): void {
  console.log('[voice-transcript]', JSON.stringify({
    stage: details.stage,
    provider: details.provider,
    session: sessionFingerprint(session),
    turnId: details.turnId ?? null,
    providerEventId: details.providerEventId ? shortHash(details.providerEventId) : null,
    source: details.source,
    language: session.userLanguage,
    length: details.transcript.length,
    hash: shortHash(details.transcript),
    bufferLength: session.userTranscriptBuffer.length,
    turnSeq: session.turnSeq,
  }));
}

export function ensureUserTranscriptTurn(session: RealtimeSession): string {
  if (session.activeUserTranscriptTurnId) return session.activeUserTranscriptTurnId;
  const next = (session.userTranscriptTurnCounter ?? 0) + 1;
  session.userTranscriptTurnCounter = next;
  session.activeUserTranscriptTurnId = `voice-user:${sessionFingerprint(session)}:${next}`;
  return session.activeUserTranscriptTurnId;
}

export interface FinalizeUserTranscriptOptions {
  provider: RealtimeVoiceProvider;
  source: string;
  providerEventId?: string | null;
  emitToClient?: boolean;
  /** Only provider-authoritative completion signals may set this to true. */
  final?: boolean;
}

export interface FinalizeUserTranscriptResult {
  emitted: boolean;
  turnId: string | null;
}

/**
 * Finalizes exactly one logical user turn without changing the provider text.
 * Whitespace is inspected only to reject an empty event; the emitted, cached,
 * and persisted value remains byte-for-byte equal to the provider transcript.
 */
export function finalizeUserTranscript(
  session: RealtimeSession,
  transcript: string,
  sendToClient: SendToClient,
  options: FinalizeUserTranscriptOptions,
): FinalizeUserTranscriptResult {
  const isFinal = options.final !== false;
  const providerEventId =
    options.providerEventId ||
    session.activeUserTranscriptProviderEventId ||
    null;
  const providerEventTurns = session.userTranscriptProviderEventTurns ??=
    Object.create(null) as Record<string, string>;
  const finalizedProviderEvents = session.finalizedUserTranscriptProviderEvents ??=
    Object.create(null) as Record<string, string>;
  const canReuseGeminiProvisional = (
    options.provider === 'gemini' &&
    !!session.pendingGeminiProvisionalTurnId &&
    session.pendingGeminiProvisionalSpeechSeq != null &&
    session.pendingGeminiProvisionalSpeechSeq === session.currentClientSpeechSeq
  );

  if (
    isFinal &&
    providerEventId &&
    Object.prototype.hasOwnProperty.call(finalizedProviderEvents, providerEventId)
  ) {
    const turnId = finalizedProviderEvents[providerEventId];
    recordUserTranscriptDiagnostic(session, {
      stage: 'server.duplicate',
      provider: options.provider,
      source: options.source,
      transcript,
      turnId,
      providerEventId,
    });
    session.userTranscriptBuffer = '';
    session.activeUserTranscriptProviderEventId = null;
    return { emitted: false, turnId };
  }

  if (transcript.trim().length === 0) {
    session.userTranscriptBuffer = '';
    session.activeUserTranscriptTurnId = null;
    session.activeUserTranscriptProviderEventId = null;
    return { emitted: false, turnId: null };
  }

  let turnId: string;
  if (
    providerEventId &&
    Object.prototype.hasOwnProperty.call(providerEventTurns, providerEventId)
  ) {
    turnId = providerEventTurns[providerEventId];
  } else if (canReuseGeminiProvisional) {
    turnId = session.pendingGeminiProvisionalTurnId!;
  } else {
    turnId = ensureUserTranscriptTurn(session);
  }
  if (isFinal && session.finalizedUserTranscriptTurnIds?.includes(turnId)) {
    recordUserTranscriptDiagnostic(session, {
      stage: 'server.duplicate',
      provider: options.provider,
      source: options.source,
      transcript,
      turnId,
      providerEventId,
    });
    session.userTranscriptBuffer = '';
    session.activeUserTranscriptTurnId = null;
    session.activeUserTranscriptProviderEventId = null;
    return { emitted: false, turnId };
  }

  recordUserTranscriptDiagnostic(session, {
    stage: isFinal ? 'server.final' : 'server.provisional',
    provider: options.provider,
    source: options.source,
    transcript,
    turnId,
    providerEventId,
  });

  if (session.userLanguage === 'ko' && session.recognitionTurnIds?.has(turnId)) {
    // Keep provider text immutable and separate from the canonical candidate.
    const registration = session.recognitionRegistrations?.get(turnId) ?? Promise.resolve();
    void registration.then(() => recordProviderEvidence(turnId, transcript, isFinal))
      .then(evidence => sendToClient(session, { type: 'voice.recognition', evidence }))
      .catch(() => sendToClient(session, { type: 'voice.recognition.error', reason: 'evidence_storage_failed' }));
  }

  if (options.emitToClient !== false) {
    sendToClient(session, {
      type: 'user.transcription',
      transcript,
      turnId,
      provider: options.provider,
      source: options.source,
      language: session.userLanguage,
      final: isFinal,
      ...(providerEventId ? { providerEventId } : {}),
    });
  }

  if (providerEventId) providerEventTurns[providerEventId] = turnId;
  if (!isFinal && options.provider === 'gemini') {
    session.pendingGeminiProvisionalTurnId = turnId;
    session.pendingGeminiProvisionalTranscript = transcript;
    session.pendingGeminiProvisionalSpeechSeq = session.currentClientSpeechSeq ?? null;
  }
  if (isFinal) {
    session.finalizedUserTranscriptTurnIds ??= [];
    session.finalizedUserTranscriptTurnIds.push(turnId);
    if (session.finalizedUserTranscriptTurnIds.length > 100) {
      session.finalizedUserTranscriptTurnIds.splice(0, session.finalizedUserTranscriptTurnIds.length - 100);
    }
    if (providerEventId) finalizedProviderEvents[providerEventId] = turnId;
    if (!session.voiceRecognitionRequired) session.recentMessages.push({ role: 'user', text: transcript.slice(0, 300) });
    if (session.recentMessages.length > 30) session.recentMessages.shift();
    session.userTurnsCompleted++;
    if (options.provider === 'gemini' && session.pendingGeminiProvisionalTurnId === turnId) {
      session.pendingGeminiProvisionalTurnId = null;
      session.pendingGeminiProvisionalTranscript = null;
      session.pendingGeminiProvisionalSpeechSeq = null;
    }
  }
  session.userTranscriptBuffer = '';
  session.activeUserTranscriptTurnId = null;
  session.activeUserTranscriptProviderEventId = null;
  session.userSpeechStarted = false;
  return { emitted: true, turnId };
}