import { createHash, randomUUID } from "node:crypto";
import { and, eq, asc, gt, sql } from "drizzle-orm";
import { db } from "../../storage/db";
import { personaRuns, chatMessages, conversations, voiceUtterances } from "../../../shared/schema/conversations";
import {
  conversationLedgerRuns as runs, conversationLedgerUtterances as utterances,
  conversationLedgerEvents as events, conversationLedgerSnapshots as snapshots,
  type LedgerUtterance, type LedgerRun,
} from "../../../shared/schema/conversationLedger";
import { ledgerCommandSchema, CLIENT_LEDGER_COMMANDS, type LedgerActor, type LedgerAck } from "../../../shared/conversationLedger";
import { LedgerError, snapshotBlockers, transitionUtterance } from "./policy";
import { snapshotFeedbackInput } from "./feedbackBinding";

type Connection = Pick<typeof db, "transaction">;
function digest(value: unknown) {
  const ordered = (node: any): any => Array.isArray(node) ? node.map(ordered) :
    node !== null && typeof node === "object"
      ? Object.fromEntries(Object.keys(node).sort().map(key => [key, ordered(node[key])]))
      : node;
  return createHash("sha256").update(JSON.stringify(ordered(JSON.parse(JSON.stringify(value))))).digest("hex");
}
const runFilter = (id: string) => eq(runs.personaRunId, id);
const utteranceFilter = (id: string, utteranceId: string) =>
  and(eq(utterances.personaRunId, id), eq(utterances.id, utteranceId));

async function lock(tx: any, runId: string) {
  // Shares the per-run lock with recognition evidence and feedback publication.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${runId}))`);
}

/**
 * Preparation API only: adapters must enroll a NEW, empty run after capturing
 * its runtime snapshots. No automatic enrollment, legacy import or rollout.
 */
export async function initializeLedger(
  runId: string, personaId: string, recognitionRequired: boolean,
  boundContext: Record<string, unknown>, connection: Connection = db,
) {
  if (!boundContext.scenarioSnapshot || !boundContext.personaSnapshot || !boundContext.rubricSnapshot) {
    throw new LedgerError("bound_evaluation_context_required", 400);
  }
  return connection.transaction(async tx => {
    await lock(tx, runId);
    const [existing] = await tx.select().from(runs).where(runFilter(runId));
    if (existing) {
      if (digest(existing.boundContext) !== digest(boundContext) ||
          existing.personaId !== personaId || existing.recognitionRequired !== recognitionRequired) {
        throw new LedgerError("ledger_binding_immutable");
      }
      return existing;
    }
    const [parent] = await tx.select({
      id: personaRuns.id, personaId: personaRuns.personaId,
      status: personaRuns.status, conversationId: personaRuns.conversationId,
    }).from(personaRuns).where(eq(personaRuns.id, runId));
    if (!parent || parent.status !== "active" || parent.personaId !== personaId) {
      throw new LedgerError("new_active_run_required");
    }
    const [message] = await tx.select({ id: chatMessages.id }).from(chatMessages)
      .where(eq(chatMessages.personaRunId, runId)).limit(1);
    const [evidence] = await tx.select({ id: voiceUtterances.id }).from(voiceUtterances)
      .where(eq(voiceUtterances.personaRunId, runId)).limit(1);
    const legacy = parent.conversationId
      ? await tx.select({ messages: conversations.messages }).from(conversations)
        .where(eq(conversations.id, parent.conversationId)) : [];
    if (message || evidence || legacy[0]?.messages?.length) throw new LedgerError("legacy_run_not_empty");
    const [created] = await tx.insert(runs).values({
      personaRunId: runId, personaId, recognitionRequired, boundContext,
    }).returning();
    await tx.update(personaRuns).set({ transcriptProtocol: "ledger-v1",
      personaSnapshot: boundContext.personaSnapshot as Record<string, any> }).where(eq(personaRuns.id, runId));
    return created;
  });
}

async function snapshotInTransaction(tx: any, run: LedgerRun) {
  const [existing] = await tx.select().from(snapshots).where(
    and(eq(snapshots.personaRunId, run.personaRunId), eq(snapshots.revision, run.cursor)),
  );
  if (existing) return existing;
  const rows: LedgerUtterance[] = await tx.select().from(utterances)
    .where(eq(utterances.personaRunId, run.personaRunId)).orderBy(asc(utterances.sequence));
  const content = { version: run.version, revision: run.cursor, boundContext: run.boundContext, utterances: rows };
  const [snapshot] = await tx.insert(snapshots).values({
    id: randomUUID(), personaRunId: run.personaRunId, revision: run.cursor,
    hash: digest(content), content, blockedReasons: snapshotBlockers(run, rows),
  }).returning();
  return snapshot;
}

/** Resolves only after COMMIT. Callers must never send durable ACK before awaiting it. */
export async function applyLedgerCommand(
  runId: string, input: unknown, actor: LedgerActor, connection: Connection = db,
): Promise<LedgerAck> {
  const parsed = ledgerCommandSchema.safeParse(input);
  if (!parsed.success) throw new LedgerError("invalid_ledger_command", 400);
  const command = parsed.data;
  if (actor === "client" && !CLIENT_LEDGER_COMMANDS.has(command.payload.kind)) {
    throw new LedgerError("server_only_ledger_command", 403);
  }
  return connection.transaction(async tx => {
    await lock(tx, runId);
    const [run] = await tx.select().from(runs).where(runFilter(runId));
    if (!run) throw new LedgerError("ledger_not_enrolled");
    const [prior] = await tx.select().from(events).where(
      and(eq(events.personaRunId, runId), eq(events.eventId, command.eventId)),
    );
    const payloadHash = digest(command);
    if (prior) {
      if (prior.payloadHash !== payloadHash) throw new LedgerError("event_identity_conflict");
      return { ...prior.ack, duplicate: true };
    }
    if (command.generation !== run.generation) throw new LedgerError("stale_connection_generation");
    if (run.cursor >= 10000) throw new LedgerError("ledger_event_limit");
    const payload = command.payload;
    if (run.status === "closed" && [
      "connection.open", "utterance.register", "text.submit", "capture.commit", "capture.gap",
    ].includes(payload.kind)) throw new LedgerError("ledger_closed");
    const sequence = run.cursor + 1;
    const patch: Partial<LedgerRun> = { cursor: sequence };
    let row: LedgerUtterance | undefined;
    if (payload.kind === "connection.open" || payload.kind === "connection.lost") {
      if (payload.kind === "connection.open") {
        patch.generation = run.generation + 1;
        patch.captureGeneration = null; patch.captureSequence = null;
      }
      // No raw audio is retained or promised recoverable on connection loss.
      await tx.update(utterances).set({
        captureState: "gap", captureReason: "connection_lost",
        updatedSequence: sequence, revision: sql`${utterances.revision} + 1`,
      }).where(and(eq(utterances.personaRunId, runId), eq(utterances.captureState, "collecting")));
    } else if (payload.kind === "utterance.register" || payload.kind === "text.submit") {
      const [existing] = await tx.select().from(utterances).where(utteranceFilter(runId, payload.utteranceId));
      if (existing) throw new LedgerError("utterance_already_registered");
      const isText = payload.kind === "text.submit";
      const speaker = isText ? "user" : payload.speaker;
      const mode = isText ? "text" : payload.mode;
      const capturing = speaker === "user" && mode === "voice";
      if (!isText && capturing) {
        if (payload.captureGeneration === undefined || payload.captureSequence === undefined) {
          throw new LedgerError("capture_identity_required", 400);
        }
        if (run.captureGeneration !== null && payload.captureGeneration < run.captureGeneration) {
          throw new LedgerError("stale_capture_generation");
        }
        if (run.captureGeneration === payload.captureGeneration) {
          if (payload.captureSequence <= (run.captureSequence ?? 0)) throw new LedgerError("stale_capture_sequence");
          patch.captureGaps = run.captureGaps + Math.max(0, payload.captureSequence - (run.captureSequence ?? 0) - 1);
        } else if (run.captureGeneration === null) {
          patch.captureGaps = run.captureGaps + payload.captureSequence - 1;
        }
        patch.captureGeneration = payload.captureGeneration;
        patch.captureSequence = payload.captureSequence;
        await tx.update(utterances).set({
          captureState: "gap", captureReason: "overlapping_capture",
          updatedSequence: sequence, revision: sql`${utterances.revision} + 1`,
        }).where(and(eq(utterances.personaRunId, runId), eq(utterances.captureState, "collecting")));
      }
      if (!isText && payload.responseTo) {
        const [parent] = await tx.select().from(utterances).where(utteranceFilter(runId, payload.responseTo));
        if (!parent || parent.speaker !== "user" || speaker !== "ai") throw new LedgerError("invalid_response_to");
      }
      if (!isText && payload.providerResponseId) {
        const [mapped] = await tx.select().from(utterances).where(and(
          eq(utterances.personaRunId, runId), eq(utterances.provider, payload.provider),
          eq(utterances.providerResponseId, payload.providerResponseId),
        ));
        if (mapped) throw new LedgerError("provider_identity_conflict");
      }
      [row] = await tx.insert(utterances).values({
        id: payload.utteranceId, personaRunId: runId, sequence, updatedSequence: sequence,
        generation: run.generation, speaker, mode, personaId: isText ? run.personaId : payload.personaId,
        responseTo: isText ? null : payload.responseTo,
        provider: isText ? "text" : payload.provider,
        providerResponseId: isText ? null : payload.providerResponseId,
        captureGeneration: isText ? null : payload.captureGeneration,
        captureSequence: isText ? null : payload.captureSequence,
        captureState: capturing ? "collecting" : "not_required",
        providerState: isText ? "final" : "pending",
        recognitionState: capturing && run.recognitionRequired ? "pending" : "not_required",
        playbackState: speaker === "ai" && mode === "voice" ? "not_observed" : "not_required",
        providerText: isText ? payload.text : "", canonicalText: isText ? payload.text : null,
      }).returning();
    } else if (payload.kind === "session.close") {
      patch.status = "closed";
      await tx.update(utterances).set({
        captureState: "gap", captureReason: "connection_lost",
        updatedSequence: sequence, revision: sql`${utterances.revision} + 1`,
      }).where(and(eq(utterances.personaRunId, runId), eq(utterances.captureState, "collecting")));
    } else {
      const [current] = await tx.select().from(utterances).where(utteranceFilter(runId, payload.utteranceId));
      if (!current) throw new LedgerError("utterance_not_registered", 404);
      // User confirmation/playback observations may reconcile a committed old
      // connection. Provider/capture writes must belong to the original lifetime.
      if (!["recognition.confirm", "playback.observed", "recognition.stt"].includes(payload.kind) &&
          current.generation !== run.generation) throw new LedgerError("stale_utterance_generation");
      if (payload.kind === "provider.final" && payload.providerEventId) {
        const [mapped] = await tx.select().from(utterances).where(and(
          eq(utterances.personaRunId, runId), eq(utterances.provider, current.provider),
          eq(utterances.providerEventId, payload.providerEventId),
        ));
        if (mapped && mapped.id !== current.id) throw new LedgerError("provider_identity_conflict");
      }
      const next = transitionUtterance(current, payload);
      [row] = await tx.update(utterances).set({
        ...next, revision: current.revision + 1, updatedSequence: sequence,
      }).where(utteranceFilter(runId, current.id)).returning();
    }
    const [updatedRun] = await tx.update(runs).set(patch).where(runFilter(runId)).returning();
    const snapshot = updatedRun.status === "closed" ? await snapshotInTransaction(tx, updatedRun) : null;
    if (snapshot) {
      const pending = snapshot.blockedReasons.length > 0;
      await tx.update(personaRuns).set({
        status: "completed", completedAt: new Date(), score: null,
        feedbackStatus: pending ? "error" : "queued",
        feedbackError: pending ? "snapshot_evaluation_pending" : null,
        feedbackQueuedAt: new Date(), feedbackExpiresAt: new Date(Date.now() + 180000),
        feedbackJobStartedAt: null, feedbackWorkerToken: null, feedbackCompletedAt: null,
        feedbackJobToken: randomUUID(), feedbackJobPayload: snapshotFeedbackInput(updatedRun, snapshot),
      }).where(eq(personaRuns.id, runId));
    }
    const ack: LedgerAck = {
      eventId: command.eventId, cursor: sequence, utteranceRevision: row?.revision ?? null,
      snapshotId: snapshot?.id ?? null, duplicate: false,
    };
    await tx.insert(events).values({ personaRunId: runId, eventId: command.eventId, sequence, command, payloadHash, ack });
    return ack;
  });
}

export async function readLedgerProjection(runId: string, after = 0, connection: Connection = db) {
  return connection.transaction(async tx => {
    await lock(tx, runId);
    const [run] = await tx.select().from(runs).where(runFilter(runId));
    if (!run) return { version: "legacy" as const, cursor: 0, generation: 0, status: "legacy", utterances: [] };
    if (!Number.isSafeInteger(after) || after < 0 || after > run.cursor) throw new LedgerError("invalid_ledger_cursor", 400);
    const rows = await tx.select().from(utterances).where(
      and(eq(utterances.personaRunId, runId), gt(utterances.updatedSequence, after)),
    ).orderBy(asc(utterances.sequence));
    return { version: run.version, cursor: run.cursor, generation: run.generation, status: run.status, utterances: rows };
  });
}

export async function readLedgerSnapshot(runId: string, id: string) {
  const [snapshot] = await db.select().from(snapshots).where(
    and(eq(snapshots.personaRunId, runId), eq(snapshots.id, id)),
  );
  if (!snapshot) throw new LedgerError("snapshot_not_found", 404);
  return snapshot;
}

/**
 * Final publication fence for the future feedback adapter. Validation and
 * report publication share the transaction/run lock; no check-then-publish gap.
 * Preparing a snapshot is NOT authorization to score unresolved evidence.
 */
export async function withCurrentLedgerSnapshot<T>(
  runId: string, snapshotId: string, hash: string,
  publish: (tx: any, snapshot: typeof snapshots.$inferSelect) => Promise<T>,
  connection: Connection = db,
): Promise<T> {
  return connection.transaction(async tx => {
    await lock(tx, runId);
    const snapshot = await assertCurrentLedgerSnapshot(tx, runId, snapshotId, hash);
    return publish(tx, snapshot);
  });
}

/** Caller must hold the run advisory lock in this same transaction. */
export async function assertCurrentLedgerSnapshot(tx: any, runId: string, snapshotId: string, hash: string) {
  const [run] = await tx.select().from(runs).where(runFilter(runId));
  const [snapshot] = await tx.select().from(snapshots).where(and(
    eq(snapshots.personaRunId, runId), eq(snapshots.id, snapshotId),
  ));
  if (!run || !snapshot) throw new LedgerError("snapshot_not_found", 404);
  if (snapshot.hash !== hash) throw new LedgerError("snapshot_hash_mismatch");
  if (run.cursor !== snapshot.revision) throw new LedgerError("snapshot_revision_stale");
  if (run.status !== "closed" || snapshot.blockedReasons.length) throw new LedgerError("snapshot_evaluation_pending");
  return snapshot;
}
