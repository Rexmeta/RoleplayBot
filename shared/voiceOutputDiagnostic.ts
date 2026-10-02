/** Numeric metadata only. Never pass audio, transcripts, device IDs or provider handles here. */
export const OUTPUT_TRACE_LIMIT = 600;
export const OUTPUT_TRACE_TTL_MS = 60_000;
export const OUTPUT_TRACE_EVENTS = [
  'provider-frame', 'receive', 'schedule', 'ended', 'stop', 'drop',
  'provider-done', 'ready', 'vad-cancel', 'error', 'disconnect',
] as const;
export type OutputTraceEvent = typeof OUTPUT_TRACE_EVENTS[number];
const fields = [
  'frameSeq', 'chunkSeq', 'turnSeq', 'cancelledTurnSeq', 'providerGeneration',
  'providerAtMs', 'serverAtMs', 'topLength', 'inlineLength', 'inlineCount',
  'source', 'interrupted', 'expectedTurnSeq', 'base64Length', 'durationMs',
  'arrivalGapMs', 'queueWaitMs', 'processingMs', 'contextTimeMs',
  'startMs', 'endMs', 'bufferedMs', 'gapMs', 'pendingSources',
  'contextState', 'outputSelected', 'actuallyPlaying', 'reason',
] as const;
export type OutputTraceFields = Partial<Record<typeof fields[number], number>>;

export class VoiceOutputTrace {
  private rows: Array<OutputTraceFields & { event: OutputTraceEvent; atMs: number }> = [];
  private start: number;
  private stopped = false;
  constructor(private clock: () => number = () => performance.now()) {
    this.start = clock();
  }
  get active(): boolean {
    return !this.stopped && this.rows.length < OUTPUT_TRACE_LIMIT
      && this.clock() - this.start < OUTPUT_TRACE_TTL_MS;
  }
  record(event: OutputTraceEvent, data: OutputTraceFields = {}): void {
    if (!this.active || !OUTPUT_TRACE_EVENTS.includes(event)) return;
    if (!data || typeof data !== 'object') data = {};
    const row: OutputTraceFields & { event: OutputTraceEvent; atMs: number } = {
      event, atMs: this.clock() - this.start,
    };
    // Runtime allowlist also protects against untyped websocket payloads.
    for (const key of fields) {
      if (typeof data[key] === 'number' && Number.isFinite(data[key])) row[key] = data[key];
    }
    this.rows.push(row);
  }
  stop(): void { this.stopped = true; }
  snapshot() {
    return { version: 1, active: this.active, limit: OUTPUT_TRACE_LIMIT,
      ttlMs: OUTPUT_TRACE_TTL_MS, rows: this.rows.map(row => ({ ...row })) };
  }
}