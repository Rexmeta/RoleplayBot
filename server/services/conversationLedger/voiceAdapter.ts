import { randomUUID } from "node:crypto";
import type { LedgerPayload, LedgerAck } from "../../../shared/conversationLedger";
import type { RealtimeSession } from "../voice/types";
import { applyLedgerCommand, readLedgerProjection } from "./service";
import { ledgerContextWindow } from "./transcript";
import { LedgerError } from "./policy";

type Emit = (message: any) => void;
const active = new Map<string, Set<VoiceLedgerAdapter>>();

/**
 * One ordered queue per provider connection; only transitions are persisted.
 * Audio/delta rendering remains provisional and is never a durable ACK.
 */
export class VoiceLedgerAdapter {
  private tail: Promise<unknown> = Promise.resolve();
  private aiId: string | null = null;
  private userId: string | null = null;
  private pending = new Set<Promise<unknown>>();
  readonly generation: number;
  private constructor(readonly runId: string, readonly personaId: string, generation: number, private emit: Emit) {
    this.generation = generation;
  }
  static async open(runId: string, personaId: string, emit: Emit) {
    const view = await readLedgerProjection(runId);
    if (view.version !== 1 || view.status !== "active") throw new LedgerError("ledger_closed");
    await applyLedgerCommand(runId, {
      eventId: randomUUID(), generation: view.generation, payload: { kind: "connection.open" },
    }, "server");
    const adapter = new VoiceLedgerAdapter(runId, personaId, view.generation + 1, emit);
    const set = active.get(runId) ?? new Set();
    set.add(adapter); active.set(runId, set);
    return adapter;
  }
  transition(payload: LedgerPayload): Promise<LedgerAck> {
    // The same envelope is kept through a retry; finality is never guessed.
    const command = { eventId: randomUUID(), generation: this.generation, payload };
    const operation = this.tail.then(async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          const ack = await applyLedgerCommand(this.runId, command, "server");
          this.emit({ type: "ledger.ack", ack, generation: this.generation });
          return ack;
        } catch (error) {
          if (error instanceof LedgerError || attempt >= 2) throw error;
          await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
        }
      }
    });
    this.tail = operation.catch(() => {
      this.emit({ type: "ledger.error", reason: "record_not_acknowledged" });
    });
    return operation;
  }
  beginUser(id: string, captureGeneration: number, captureSequence: number, provider: "gemini" | "openai") {
    this.userId = id;
    return this.transition({
      kind: "utterance.register", utteranceId: id, speaker: "user", mode: "voice",
      personaId: this.personaId, provider, captureGeneration, captureSequence,
    });
  }
  capture(id: string, gap?: "connection_lost" | "capture_gap" | "overlapping_capture" | "capture_timeout") {
    return this.transition(gap ? { kind: "capture.gap", utteranceId: id, reason: gap }
      : { kind: "capture.commit", utteranceId: id });
  }
  provider(id: string, text: string, final: boolean, providerEventId?: string | null) {
    return this.transition(final
      ? { kind: "provider.final", utteranceId: id, text, providerEventId: providerEventId ?? undefined }
      : { kind: "provider.interrupted", utteranceId: id, text });
  }
  stt(id: string, text: string | null, failure?: string, model?: string) {
    const reason = failure ? failure === "stt_rollout_disabled" ? "stt_disabled"
      : failure === "segmented_utterance_confirmation_required" ? "segmented_capture" : "stt_failed" : undefined;
    return this.transition({
      kind: "recognition.stt", utteranceId: id, text, reason,
      model: ["gpt-4o-mini-transcribe", "gpt-4o-transcribe", "whisper-1"].includes(model ?? "")
        ? model as "gpt-4o-mini-transcribe" | "gpt-4o-transcribe" | "whisper-1" : undefined,
    });
  }
  ensureAi(provider: "gemini" | "openai") {
    if (!this.aiId) {
      this.aiId = randomUUID();
      void this.transition({
        kind: "utterance.register", utteranceId: this.aiId, speaker: "ai", mode: "voice",
        personaId: this.personaId, provider, responseTo: this.userId ?? undefined,
      }).catch(() => {});
    }
    return this.aiId;
  }
  completeAi(provider: "gemini" | "openai", text: string) {
    const id = this.ensureAi(provider);
    this.aiId = null;
    const committed = this.provider(id, text, true);
    // Provider callbacks need not await emotion analysis to register/finalize.
    void committed.catch(() => {});
    return { id, committed };
  }
  interruptAi(text: string) {
    const id = this.aiId;
    this.aiId = null;
    if (id) void this.provider(id, text, false).catch(() => {});
    return id;
  }
  clientCommand(command: unknown) {
    const operation = this.tail.then(() => applyLedgerCommand(this.runId, command, "client"));
    this.tail = operation.catch(() => this.emit({ type: "ledger.error", reason: "command_not_acknowledged" }));
    void operation.then(ack => this.emit({ type: "ledger.ack", ack, generation: this.generation })).catch(() => {});
  }
  track(work: Promise<unknown>) {
    this.pending.add(work);
    void work.finally(() => this.pending.delete(work)).catch(() => {});
  }
  async drain() {
    await Promise.all([this.tail, ...Array.from(this.pending)]);
    await this.tail; // work may enqueue a final evidence transition while finishing
  }
  async lost() {
    await this.transition({ kind: "connection.lost" }).catch(() => {});
    active.get(this.runId)?.delete(this);
  }
}

export async function drainLedgerVoice(runId: string, timeoutMs = 10000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all(Array.from(active.get(runId) ?? []).map(adapter => adapter.drain())),
      new Promise(resolve => { timer = setTimeout(resolve, timeoutMs); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function attachVoiceLedger(session: RealtimeSession, emit: Emit) {
  session.ledgerAdapter = await VoiceLedgerAdapter.open(session.personaRunId, session.personaId, emit);
  session.recentMessages = await ledgerContextWindow(session.personaRunId);
}
