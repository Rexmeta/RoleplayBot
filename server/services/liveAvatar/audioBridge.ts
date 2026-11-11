import type { AvatarPcmFrame, LiveAvatarState, LiveAvatarTransport } from "../../../shared/avatar/liveAvatar";

export type BridgeFailure = "invalid_pcm" | "stale_audio" | "queue_overflow" | "transport_failed" | "transport_timeout";
type Operation = { run: (signal: AbortSignal) => Promise<void>; durationMs: number; enqueuedAt: number };

/**
 * Transport-independent lifecycle for a future VERIFIED renderer contract.
 * Not activated by config or diagnostic success. The current AvatarRouter
 * adapter intentionally cannot supply a transport, so no real PCM reaches it.
 *
 * Single audio owner: only accept frames after media readiness is confirmed;
 * callers retain local output until then and restore it on onFallback.
 */
export class LiveAvatarAudioBridge {
  state: LiveAvatarState = "connecting";
  private generation = 0;
  private turn = -1;
  private lastSequence = -1;
  private queue: Operation[] = [];
  private queuedMs = 0;
  private pumping = false;
  private abort = new AbortController();
  private closePromise: Promise<void> | null = null;
  private finished = false;
  private flushAcknowledged = true;

  constructor(
    private readonly transport: LiveAvatarTransport,
    private readonly onFallback: (reason: BridgeFailure) => void,
    private readonly limits = { maxBufferedMs: 1000, maxQueueAgeMs: 1500, operationTimeoutMs: 1000 },
  ) {}

  get currentGeneration(): number { return this.generation; }
  get ownsAudio(): boolean { return this.state === "ready"; }

  /** Called only by verified media playback readiness, never by HTTP status. */
  mediaReady(): void {
    if (this.state === "connecting" && this.flushAcknowledged) this.state = "ready";
  }

  /** Nonblocking enqueue. Never await external transport in the voice handler. */
  push(frame: AvatarPcmFrame): boolean {
    if (!this.ownsAudio) return false;
    if (frame.source !== "ai" || frame.encoding !== "pcm_s16le" ||
        frame.sampleRate !== 24000 || frame.channels !== 1 ||
        !Number.isSafeInteger(frame.turnSeq) || frame.turnSeq < 0 ||
        !Number.isSafeInteger(frame.sequence) || frame.sequence < 0 ||
        !Number.isSafeInteger(frame.generation) ||
        !(frame.data instanceof Uint8Array) || frame.data.byteLength === 0 ||
        frame.data.byteLength % 2 !== 0) {
      this.fail("invalid_pcm");
      return false;
    }
    if (frame.generation !== this.generation || frame.turnSeq < this.turn ||
        (frame.turnSeq === this.turn && (frame.sequence <= this.lastSequence || this.finished))) return false;
    if (frame.turnSeq > this.turn) {
      this.turn = frame.turnSeq;
      this.lastSequence = -1;
      this.finished = false;
    }
    const durationMs = frame.data.byteLength / 2 / 24000 * 1000;
    if (this.queuedMs + durationMs > this.limits.maxBufferedMs || this.queue.length >= 128) {
      this.fail("queue_overflow");
      return false;
    }
    this.lastSequence = frame.sequence;
    const copied = { ...frame, data: frame.data.slice() };
    this.enqueue({ run: signal => this.transport.sendAudio(copied, signal), durationMs, enqueuedAt: Date.now() });
    return true;
  }

  finishTurn(turnSeq: number): void {
    if (!this.ownsAudio || turnSeq !== this.turn || this.finished) return;
    this.finished = true;
    this.enqueue({ run: signal => this.transport.finishTurn(turnSeq, signal), durationMs: 0, enqueuedAt: Date.now() });
  }

  /**
   * Interruption stops local ownership FIRST, invalidates queued/in-flight
   * work, and fails closed. Reusing a remote stream before flush acknowledgement
   * risks speaking stale audio; the next session needs fresh media readiness.
   */
  interrupt(): void {
    if (this.state === "closed" || this.state === "fallback") return;
    this.generation++;
    this.state = "connecting";
    this.finished = true;
    this.flushAcknowledged = false;
    this.abort.abort();
    this.abort = new AbortController();
    this.queue = [];
    this.queuedMs = 0;
    const generation = this.generation;
    this.enqueue({
      run: async signal => {
        await this.transport.interrupt(generation, signal);
        if (!signal.aborted && generation === this.generation) this.flushAcknowledged = true;
        // Do not regain ownership until the media layer attests readiness again.
      },
      durationMs: 0, enqueuedAt: Date.now(),
    });
  }

  /** Persona switch/reconnect must close this bridge and create a fresh one. */
  close(): Promise<void> {
    this.state = "closed";
    this.abort.abort();
    this.queue = [];
    this.queuedMs = 0;
    return this.closeTransport();
  }

  private closeTransport(): Promise<void> {
    if (!this.closePromise) {
      // Cleanup must not block the existing conversation if a provider hangs.
      this.closePromise = new Promise<void>(resolve => {
        const timer = setTimeout(resolve, this.limits.operationTimeoutMs);
        Promise.resolve().then(() => this.transport.close()).catch(() => {}).finally(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    return this.closePromise;
  }

  private fail(reason: BridgeFailure): void {
    if (this.state === "closed" || this.state === "fallback") return;
    this.state = "fallback";
    this.abort.abort();
    this.queue = [];
    this.queuedMs = 0;
    void this.closeTransport();
    this.onFallback(reason);
  }

  private enqueue(op: Operation): void {
    this.queue.push(op);
    this.queuedMs += op.durationMs;
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length && this.state !== "closed" && this.state !== "fallback") {
        const op = this.queue.shift()!;
        const generation = this.generation;
        if (Date.now() - op.enqueuedAt > this.limits.maxQueueAgeMs) { this.fail("stale_audio"); return; }
        const signal = this.abort.signal;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let removeAbort = () => {};
        try {
          await Promise.race([
            Promise.resolve().then(() => {
              if (signal.aborted) return;
              return op.run(signal);
            }),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error("transport_timeout")), this.limits.operationTimeoutMs);
            }),
            new Promise<void>(resolve => {
              const listener = () => resolve();
              signal.addEventListener("abort", listener, { once: true });
              removeAbort = () => signal.removeEventListener("abort", listener);
              if (signal.aborted) resolve();
            }),
          ]);
        } catch (error) {
          if (!signal.aborted) this.fail(error instanceof Error && error.message === "transport_timeout" ? "transport_timeout" : "transport_failed");
        } finally {
          if (timer) clearTimeout(timer);
          removeAbort();
          if (generation === this.generation) this.queuedMs = Math.max(0, this.queuedMs - op.durationMs);
        }
      }
    } finally {
      this.pumping = false;
    }
  }
}
