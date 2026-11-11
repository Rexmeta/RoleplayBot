import { z } from "zod";
import { setTimeout as delay } from "node:timers/promises";
import type { AvatarProjectClient } from "./projectClient";

/** Bounded, at-most-once PCM clips. This is not a provider streaming protocol. */
export class ConversationAvatarAudio {
  ready = false;
  private pending = Buffer.alloc(0);
  private queuedBytes = 0;
  private queue: Buffer[] = [];
  private pumping = false;
  private controller = new AbortController();
  private turn = -1;
  private turnFinished = false;
  constructor(
    private client: AvatarProjectClient, private userId: string, private sessionId: string,
    private fallback: () => void,
    private wait = (ms: number, signal: AbortSignal) => delay(ms, undefined, { signal }),
    private onDrained: () => void = () => {},
  ) {}

  push(data: string, turn: number, sampleRate: number): boolean {
    if (!this.ready) return false;
    if (turn < this.turn) return false;
    if (sampleRate !== 24000 || !Number.isSafeInteger(turn) || typeof data !== "string" ||
        data.length > 320000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
      this.fail(); return false;
    }
    if (turn > this.turn) { this.finish(); this.turn = turn; this.turnFinished = false; }
    const pcm = Buffer.from(data, "base64");
    if (!pcm.length || pcm.length % 2 || this.pending.length + this.queuedBytes + pcm.length > 384000) {
      this.fail(); return false;
    }
    this.pending = Buffer.concat([this.pending, pcm]);
    // One-second clips reduce startup latency while bounding renderer backlog.
    while (this.pending.length >= 48000) {
      this.enqueue(this.pending.subarray(0, 48000));
      this.pending = this.pending.subarray(48000);
    }
    return true;
  }

  finish() {
    if (!this.ready) return;
    this.turnFinished = true;
    if (this.pending.length >= 960) this.enqueue(this.pending);
    // Pad only the final sub-20ms tail to the provider's minimum clip duration.
    else if (this.pending.length) this.enqueue(Buffer.concat([this.pending, Buffer.alloc(960 - this.pending.length)]));
    this.pending = Buffer.alloc(0);
    if (!this.pumping && !this.queue.length) this.onDrained();
  }
  close() {
    this.ready = false;
    this.controller.abort();
    this.queue = [];
    this.pending = Buffer.alloc(0);
    this.queuedBytes = 0;
  }
  private fail() { this.close(); this.fallback(); }
  private enqueue(pcm: Buffer) {
    this.queue.push(pcm);
    this.queuedBytes += pcm.length;
    void this.pump();
  }
  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length && !this.controller.signal.aborted) {
        const pcm = this.queue.shift()!;
        await this.client.call(this.userId, `/sessions/${this.sessionId}/audio`,
          z.object({ accepted: z.literal(true) }), { pcmBase64: pcm.toString("base64") }, this.controller.signal);
        await this.wait(pcm.length / 48, this.controller.signal);
        this.queuedBytes -= pcm.length;
      }
    } catch {
      if (!this.controller.signal.aborted) this.fail();
    } finally {
      this.pumping = false;
      if (!this.controller.signal.aborted && this.turnFinished && !this.queue.length && !this.pending.length) this.onDrained();
    }
  }
}
