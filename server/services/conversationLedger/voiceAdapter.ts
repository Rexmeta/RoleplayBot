import { randomUUID } from "node:crypto";
import type { LedgerPayload, LedgerAck } from "../../../shared/conversationLedger";
import type { RealtimeSession } from "../voice/types";
import { applyLedgerCommand, readLedgerProjection } from "./service";
import { ledgerContextWindow } from "./transcript";
import { LedgerError } from "./policy";
import { waitForVoiceFinalization, type FinalizationBarrierResult } from '../voice/finalizationBarrier';
import { ledgerCommandSchema } from '../../../shared/conversationLedger';
import { db } from '../../storage/db';
import { personaRuns } from '../../../shared/schema/conversations';
import { eq } from 'drizzle-orm';

type Emit = (message: any) => void;
const active = new Map<string, Set<VoiceLedgerAdapter>>();
const closing = new Map<string, Promise<FinalizationBarrierResult>>();
const finalizingCommands = new Map<string, Promise<LedgerAck>>();

/** Admission closes synchronously, before any finalization storage await. */
export function beginVoiceFinalization(session: RealtimeSession): void {
  if (session.finalizationState) return;
  session.finalizationState = 'closing';
  session.finalizationOutputGeneration = session.providerOutputInProgress ? session.turnSeq : undefined;
}

/**
 * One ordered queue per provider connection; only transitions are persisted.
 * Audio/delta rendering remains provisional and is never a durable ACK.
 */
export class VoiceLedgerAdapter {
  private tail: Promise<unknown> = Promise.resolve();
  private aiId: string | null = null;
  private userId: string | null = null;
  private pending = new Set<Promise<unknown>>();
  private playbackPending = new Set<string>();
  session?: RealtimeSession;
  disconnected = false;
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
      this.playbackPending.add(this.aiId);
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
    void operation.then(ack => {
      const payload = (command as any)?.payload;
      if (payload?.kind === 'playback.observed' && ['completed', 'interrupted', 'not_played', 'failed', 'unknown'].includes(payload.state)) {
        this.playbackPending.delete(payload.utteranceId);
      }
      this.emit({ type: "ledger.ack", ack, generation: this.generation });
    }).catch(() => {});
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
    this.disconnected = true;
    await this.transition({ kind: "connection.lost" }).catch(() => {});
    active.get(this.runId)?.delete(this);
  }
  beginFinalization() {
    if (!this.session) return;
    beginVoiceFinalization(this.session);
  }
  async readyToFreeze() {
    const before = this.tail;
    await before;
    const session = this.session;
    return before === this.tail && this.pending.size === 0 && this.playbackPending.size === 0 &&
      !session?.providerOutputInProgress && !session?.userTranscriptBuffer.trim() &&
      !session?.activeUserTranscriptTurnId && !session?.pendingGeminiProvisionalTurnId;
  }
}

export async function finalizeLedgerVoiceCommand(runId: string, input: unknown) {
  const parsed = ledgerCommandSchema.safeParse(input);
  if (!parsed.success || parsed.data.payload.kind !== 'session.close') throw new LedgerError('invalid_ledger_command', 400);
  const command = parsed.data;
  // Also close admission immediately when the close arrived over HTTP rather
  // than this socket. A repeated close must not recapture a later output.
  for (const adapter of Array.from(active.get(runId) ?? [])) {
    if (adapter.generation === command.generation) adapter.beginFinalization();
  }
  const view = await readLedgerProjection(runId);
  if (view.version !== 1 || command.generation !== view.generation) throw new LedgerError('stale_connection_generation');
  const existing = finalizingCommands.get(runId);
  if (existing) return existing.then(ack => ({ ...ack, eventId: command.eventId, duplicate: true }));
  const [parent] = await db.select({ runtime: personaRuns.duplexRuntime }).from(personaRuns).where(eq(personaRuns.id, runId));
  if (parent?.runtime?.finalization) return applyLedgerCommand(runId, command, 'client');
  // Re-check after the DB read so competing first close requests share both
  // the deadline and the freeze transaction, not just the drain promise.
  const raced = finalizingCommands.get(runId);
  if (raced) return raced.then(ack => ({ ...ack, eventId: command.eventId, duplicate: true }));
  const work = drainLedgerVoice(runId, 10000, parent?.runtime?.config.evaluationSnapshot)
    .then(barrier => applyLedgerCommand(runId, command, 'client', undefined, { barrier }));
  finalizingCommands.set(runId, work);
  try { return await work; }
  finally { if (finalizingCommands.get(runId) === work) finalizingCommands.delete(runId); }
}

export async function drainLedgerVoice(runId: string, timeoutMs = 10000, forceEnhanced = false) {
  const existing = closing.get(runId);
  if (existing) return existing;
  const adapters = Array.from(active.get(runId) ?? []);
  const enhanced = forceEnhanced || adapters.some(adapter => adapter.session?.duplexRuntime?.config.evaluationSnapshot);
  if (enhanced) {
    adapters.forEach(adapter => adapter.beginFinalization());
    const work = waitForVoiceFinalization(
      async () => (await Promise.all(adapters.map(adapter => adapter.readyToFreeze()))).every(Boolean),
      () => adapters.length === 0 || adapters.some(adapter => adapter.disconnected), timeoutMs,
    ).then(result => {
      adapters.forEach(adapter => { if (adapter.session) adapter.session.finalizationState = 'frozen'; });
      return result;
    });
    closing.set(runId, work);
    // Bounded lifecycle; the persisted snapshot handles subsequent close requests.
    void work.finally(() => { closing.delete(runId); }).catch(() => {});
    return work;
  }
  const startedAt = Date.now();
  let outcome: FinalizationBarrierResult['outcome'] = 'settled';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all(Array.from(active.get(runId) ?? []).map(adapter => adapter.drain())),
      new Promise(resolve => { timer = setTimeout(() => { outcome = 'timeout'; resolve(undefined); }, timeoutMs); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
  return { startedAt, deadlineAt: startedAt + timeoutMs, timeoutMs, outcome };
}

export async function attachVoiceLedger(session: RealtimeSession, emit: Emit) {
  session.ledgerAdapter = await VoiceLedgerAdapter.open(session.personaRunId, session.personaId, emit);
  session.ledgerAdapter.session = session;
  session.recentMessages = await ledgerContextWindow(session.personaRunId);
}
