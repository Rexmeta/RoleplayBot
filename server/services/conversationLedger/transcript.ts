import { randomUUID } from "node:crypto";
import { db } from "../../storage/db";
import { eq } from "drizzle-orm";
import { personaRuns } from "../../../shared/schema/conversations";
import type { ChatMessage } from "../../../shared/schema/conversations";
import type { LedgerUtterance } from "../../../shared/schema/conversationLedger";
import { applyLedgerCommand, readLedgerProjection } from "./service";
import { LedgerError } from "./policy";
import { conversationLedgerRuns } from "../../../shared/schema/conversationLedger";
import type { LedgerPayload } from "../../../shared/conversationLedger";

export function usesLedger(run: { transcriptProtocol?: string } | null | undefined): boolean {
  return run?.transcriptProtocol === "ledger-v1";
}

/** Only the run's persisted protocol decides authority, never a current rollout flag. */
export async function hasLedgerProtocol(runId: string, connection: Pick<typeof db, "select"> = db): Promise<boolean> {
  const [row] = await connection.select({ transcriptProtocol: personaRuns.transcriptProtocol })
    .from(personaRuns).where(eq(personaRuns.id, runId)).limit(1);
  return usesLedger(row);
}

export function ledgerChatMessage(row: LedgerUtterance): ChatMessage & { ledger: LedgerUtterance } {
  return {
    id: row.id, personaRunId: row.personaRunId, sender: row.speaker,
    message: row.canonicalText ?? row.providerText,
    turnIndex: row.sequence, createdAt: row.createdAt,
    emotion: row.metadata?.emotion ?? null, emotionReason: row.metadata?.emotionReason ?? null,
    userAffect: row.metadata?.userAffect ?? null,
    interrupted: row.providerState === "interrupted" || row.playbackState === "interrupted",
    voiceTurnId: row.mode === "voice" && row.speaker === "user" ? row.id : null,
    voiceTranscriptFinal: row.providerState === "final", ledger: row,
  };
}

export async function ledgerChatMessages(runId: string): Promise<Array<ChatMessage & { ledger: LedgerUtterance }>> {
  const view = await readLedgerProjection(runId);
  if (view.version === "legacy") throw new LedgerError("ledger_protocol_storage_missing");
  return view.utterances.map(ledgerChatMessage);
}

export async function ledgerRuntimeBinding(runId: string) {
  if (!await hasLedgerProtocol(runId)) return null;
  const [run] = await db.select().from(conversationLedgerRuns)
    .where(eq(conversationLedgerRuns.personaRunId, runId));
  if (!run) throw new LedgerError("ledger_protocol_storage_missing");
  return run.boundContext as Record<string, any>;
}

/** Provider context is a bounded canonical window, not the full evaluation transcript. */
export async function ledgerContextWindow(runId: string, maxChars = 12000) {
  const view = await readLedgerProjection(runId);
  if (view.version === "legacy") throw new LedgerError("ledger_protocol_storage_missing");
  let remaining = maxChars;
  const result: Array<{ role: "user" | "ai"; text: string }> = [];
  for (const row of [...view.utterances].reverse()) {
    if (!row.canonicalText || row.captureState === "gap" ||
        (row.speaker === "ai" && row.mode === "voice" && row.playbackState !== "completed")) continue;
    if (row.canonicalText.length > remaining) break;
    result.unshift({ role: row.speaker as "user" | "ai", text: row.canonicalText });
    remaining -= row.canonicalText.length;
  }
  return result;
}

export async function serverLedgerTransition(runId: string, generation: number, payload: LedgerPayload) {
  return applyLedgerCommand(runId, { eventId: randomUUID(), generation, payload }, "server");
}

/** Called only after a server generation has a registered response entity. */
export async function finalizeGeneratedLedgerMessage(
  runId: string, generation: number, id: string, text: string,
  metadata?: { emotion?: string; emotionReason?: string; userAffect?: Record<string, unknown> },
) {
  const ack = await serverLedgerTransition(runId, generation, {
    kind: "provider.final", utteranceId: id, text, metadata,
  });
  const row = (await ledgerChatMessages(runId)).find(message => message.id === id);
  if (!row) throw new LedgerError("utterance_not_registered", 404);
  return { row, ack };
}
