import { db } from "../../storage/db";
import { eq, and } from "drizzle-orm";
import { conversationLedgerRuns as runs, conversationLedgerSnapshots as snapshots } from "../../../shared/schema/conversationLedger";
import type { LedgerRun } from "../../../shared/schema/conversationLedger";
import type { LedgerUtterance } from "../../../shared/schema/conversationLedger";
import { LedgerError } from "./policy";
import { ledgerChatMessage, hasLedgerProtocol } from "./transcript";

export function snapshotFeedbackInput(run: LedgerRun, snapshot: typeof snapshots.$inferSelect) {
  const rows = snapshot.content.utterances as LedgerUtterance[];
  const binding = snapshot.content.boundContext as Record<string, any>;
  return {
    conversationId: run.personaRunId,
    conversation: {
      id: run.personaRunId, transcriptProtocol: "ledger-v1",
      scenarioId: binding.scenarioSnapshot.id, personaId: run.personaId,
      personaSnapshot: binding.personaSnapshot, createdAt: run.createdAt, completedAt: new Date(),
      status: "completed", mode: "mixed", difficulty: binding.difficulty ?? binding.scenarioSnapshot.difficulty ?? 4,
      turnCount: rows.filter(row => row.speaker === "user").length,
      messages: rows.map(row => ({
        ...ledgerChatMessage(row), timestamp: row.createdAt, utteranceId: row.id,
      })),
    },
    scenario: binding.scenarioSnapshot, persona: binding.personaSnapshot,
    language: binding.language ?? "ko", evaluationHarnessSnapshot: binding.evaluationHarnessSnapshot,
    transcriptSnapshot: { id: snapshot.id, revision: snapshot.revision, hash: snapshot.hash },
  };
}

export async function readLedgerFeedbackInput(runId: string, connection: Pick<typeof db, "select" | "transaction"> = db) {
  if (!await hasLedgerProtocol(runId, connection)) return null;
  return connection.transaction(async tx => {
    const [run] = await tx.select().from(runs).where(eq(runs.personaRunId, runId));
    if (!run) throw new LedgerError("ledger_protocol_storage_missing");
    await tx.execute((await import("drizzle-orm")).sql`SELECT pg_advisory_xact_lock(hashtext(${runId}))`);
    const [current] = await tx.select().from(runs).where(eq(runs.personaRunId, runId));
    const [snapshot] = await tx.select().from(snapshots).where(and(
      eq(snapshots.personaRunId, runId), eq(snapshots.revision, current.cursor),
    ));
    if (!snapshot || current.status !== "closed" || snapshot.blockedReasons.length) {
      throw new LedgerError("snapshot_evaluation_pending");
    }
    return snapshotFeedbackInput(current, snapshot);
  });
}
