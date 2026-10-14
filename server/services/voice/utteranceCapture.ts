import type { RealtimeSession } from './types';
import { ensureUserTranscriptTurn, realtimeVoiceProvider, finalizeUserTranscript } from './transcriptionIntegrity';
import { registerUtterance, recordSttEvidence } from './recognitionEvidence';
import { MAX_UTTERANCE_BYTES, transcribeKoreanUtterance } from './dedicatedTranscription';

type Send = (session: RealtimeSession, message: any) => void;
let bufferedBytes = 0;
let activeRequests = 0;
const GLOBAL_AUDIO_LIMIT = 32 * 1024 * 1024;

async function bounded<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('recognition_dependency_timeout')), 10000); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

export function beginRecognitionCapture(session: RealtimeSession, send: Send) {
  if (!session.voiceRecognitionRequired && !session.ledgerAdapter) return;
  if (session.recognitionCapture?.generation === session.currentClientCaptureGeneration &&
    session.recognitionCapture?.speechSeq === session.currentClientSpeechSeq) return;
  if (session.recognitionBoundary?.generation === session.currentClientCaptureGeneration &&
    session.recognitionBoundary?.speechSeq === session.currentClientSpeechSeq) return;
  if (session.recognitionCapture) finishRecognitionCapture(session, send, 'overlapping_capture');
  if (session.recognitionBoundary) {
    if (session.userTranscriptBuffer?.trim()) finalizeUserTranscript(session, session.userTranscriptBuffer, send, {
      provider: realtimeVoiceProvider(session), source: 'server.new_speech_boundary', final: false,
    });
    session.activeUserTranscriptTurnId = null;
    session.activeUserTranscriptProviderEventId = null;
    session.pendingGeminiProvisionalTurnId = null;
    session.pendingGeminiProvisionalSpeechSeq = null;
    session.pendingGeminiProvisionalTranscript = null;
  }
  session.recognitionBoundary = {
    generation: session.currentClientCaptureGeneration ?? 0,
    speechSeq: session.currentClientSpeechSeq ?? 0,
  };
  const turnId = ensureUserTranscriptTurn(session);
  session.recognitionTurnIds ??= new Set();
  session.recognitionTurnIds.add(turnId);
  const registered = session.ledgerAdapter
    ? session.ledgerAdapter.beginUser(turnId, session.currentClientCaptureGeneration ?? 0,
      session.currentClientSpeechSeq ?? 1, realtimeVoiceProvider(session)).then(() => {})
    : registerUtterance({
    id: turnId, personaRunId: session.personaRunId, language: session.userLanguage,
    provider: realtimeVoiceProvider(session),
    captureGeneration: session.currentClientCaptureGeneration ?? 0,
    speechSeq: session.currentClientSpeechSeq ?? 0,
  });
  session.recognitionRegistrations ??= new Map();
  session.recognitionRegistrations.set(turnId, registered);
  // A DB failure is explicit, never interpreted as recognition success.
  void registered.catch(() => send(session, {
    type: 'voice.recognition.error', reason: 'evidence_storage_failed',
    message: '인식 확인 기록을 저장하지 못했습니다. 평가를 진행하지 말고 다시 시도해 주세요.',
  }));
  const timer = setTimeout(() => finishRecognitionCapture(session, send, 'capture_timeout'), 65000);
  timer.unref?.();
  session.recognitionCapture = {
    turnId, generation: session.currentClientCaptureGeneration ?? 0,
    speechSeq: session.currentClientSpeechSeq ?? 0,
    chunks: [], bytes: 0, registered, timer,
  };
}

export function appendRecognitionAudio(session: RealtimeSession, base64: unknown) {
  const capture = session.recognitionCapture;
  if (!capture || capture.failed) return;
  if (typeof base64 !== 'string' || base64.length > 128000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    capture.failed = 'invalid_audio'; return;
  }
  const chunk = Buffer.from(base64, 'base64');
  if (chunk.length % 2 || capture.bytes + chunk.length > MAX_UTTERANCE_BYTES ||
    bufferedBytes + chunk.length > GLOBAL_AUDIO_LIMIT) {
    chunk.fill(0); capture.failed = 'audio_resource_limit'; return;
  }
  capture.chunks.push(chunk); capture.bytes += chunk.length; bufferedBytes += chunk.length;
}

export function finishRecognitionCapture(session: RealtimeSession, send: Send, failure?: string) {
  const capture = session.recognitionCapture;
  if (!capture) return;
  session.recognitionCapture = undefined;
  clearTimeout(capture.timer);
  const pcm = Buffer.concat(capture.chunks);
  for (const chunk of capture.chunks) chunk.fill(0);
  capture.chunks = [];
  // Retain the budget through the STT request, not just through capture.
  const processing = (async () => {
    let requested = false;
    let released = false;
    const release = () => {
      if (!released) { pcm.fill(0); bufferedBytes -= capture.bytes; released = true; }
      if (requested) { activeRequests--; requested = false; }
    };
    let model: string | undefined;
    let segments = 1;
    const processingStarted = Date.now();
    try {
      await bounded(capture.registered);
      let reason = failure || capture.failed;
      if (session.ledgerAdapter) {
        const gap = reason || capture.bytes === 0
          ? ["connection_lost", "overlapping_capture", "capture_timeout"].includes(reason ?? "")
            ? reason as "connection_lost" | "overlapping_capture" | "capture_timeout" : "capture_gap"
          : undefined;
        await session.ledgerAdapter.capture(capture.turnId, gap);
        if (!session.voiceRecognitionRequired) { release(); return; }
      }
      let candidate: string | null = null;
      const rollout = await bounded(import('../../storage').then(m => m.storage.getSystemSetting('ai', 'voice_stt_enabled')));
      if (!reason && rollout?.value !== 'true') reason = 'stt_rollout_disabled';
      if (!reason && activeRequests >= 8) reason = 'stt_capacity_limit';
      if (!reason) {
        requested = true; activeRequests++;
        candidate = await transcribeKoreanUtterance(pcm, info => { model = info.model; segments = info.segments; });
        if (segments > 1) reason = 'segmented_utterance_confirmation_required';
      }
      release(); // No raw audio survives a slow evidence-store operation.
      if (session.ledgerAdapter) {
        await session.ledgerAdapter.stt(capture.turnId, candidate, reason, model);
        return;
      }
      const row = await recordSttEvidence(capture.turnId, candidate, reason, model);
      console.info('[voice-recognition-metric]', {
        provider: 'openai', language: 'ko', status: row.status,
        audioMs: Math.round(capture.bytes / 32), reason: row.reason, model,
        latencyMs: Date.now() - processingStarted, segments,
      });
      send(session, { type: 'voice.recognition', evidence: row });
    } catch (error) {
      release();
      // Do not log provider errors: they can include audio/transcript request data.
      const allowed = ['stt_not_configured', 'unsupported_stt_model', 'empty_stt_result', 'invalid_utterance_audio'];
      const code = error instanceof Error && allowed.includes(error.message) ? error.message : 'stt_failed';
      if (session.ledgerAdapter) {
        await session.ledgerAdapter.stt(capture.turnId, null, code).catch(() => {});
        return;
      }
      await recordSttEvidence(capture.turnId, null, code).then(row =>
        send(session, { type: 'voice.recognition', evidence: row }),
      ).catch(() => send(session, { type: 'voice.recognition.error', reason: 'evidence_storage_failed' }));
    } finally {
      release();
    }
  })();
  session.ledgerAdapter?.track(processing);
}