import type { RealtimeSession } from './types';
import { OUTPUT_TRACE_TTL_MS } from '@shared/voiceOutputDiagnostic';

const WIRE_LIMIT = 200;
type Send = (session: RealtimeSession, message: any) => void;
export function enableOutputDiagnostic(session: RealtimeSession): void {
  // A repeated client.ready must not extend the budget or lifetime.
  if (session.outputDiagnostic) return;
  session.outputDiagnostic = { startedAt: Date.now(), emitted: 0, frameSeq: 0, chunkSeq: 0 };
}
/** Optional observer only: the original handler still makes all playback/dedup decisions. */
export function observeOutputFrame(session: RealtimeSession, message: any, send: Send): Send {
  const trace = session.outputDiagnostic;
  if (!trace || trace.emitted >= WIRE_LIMIT || Date.now() - trace.startedAt >= OUTPUT_TRACE_TTL_MS) return send;
  const providerAtMs = Date.now();
  const frameSeq = ++trace.frameSeq;
  const parts = message.serverContent?.modelTurn?.parts;
  let inlineLength = 0;
  let inlineCount = 0;
  if (Array.isArray(parts)) {
    for (const part of parts) {
      if (typeof part.inlineData?.data === 'string') {
        inlineLength += part.inlineData.data.length;
        inlineCount++;
      }
    }
  }
  const base = { frameSeq, providerAtMs, turnSeq: session.turnSeq,
    cancelledTurnSeq: session.cancelledTurnSeq,
    providerGeneration: session.providerConnectionGeneration ?? 0 };
  function permitted(): boolean {
    return trace!.emitted < WIRE_LIMIT && Date.now() - trace!.startedAt < OUTPUT_TRACE_TTL_MS;
  }
  // One bounded metadata frame per audio-bearing provider message, including suppressed ones.
  if ((message.data || inlineCount) && permitted()) {
    trace.emitted++;
    try {
      send(session, { type: 'output.diagnostic', diagnostic: {
        ...base, serverAtMs: Date.now(), topLength: typeof message.data === 'string' ? message.data.length : 0,
        inlineLength, inlineCount, interrupted: Number(session.isInterrupted),
        source: session.audioSourceThisTurn === 'top' ? 1 : session.audioSourceThisTurn === 'inline' ? 2 : 0,
      } });
    } catch { /* Diagnostics must not interrupt the provider handler. */ }
  }
  return (s, outgoing) => {
    if (['audio.delta', 'audio.done', 'response.done', 'response.ready', 'response.interrupted'].includes(outgoing.type) && permitted()) {
      trace!.emitted++;
      outgoing = { ...outgoing, diagnostic: { ...base, turnSeq: s.turnSeq,
        serverAtMs: Date.now(), chunkSeq: outgoing.type === 'audio.delta' ? ++trace!.chunkSeq : trace!.chunkSeq,
        source: s.audioSourceThisTurn === 'top' ? 1 : s.audioSourceThisTurn === 'inline' ? 2 : 0 } };
    }
    send(s, outgoing);
  };
}