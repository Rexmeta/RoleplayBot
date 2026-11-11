import { and, eq, sql } from "drizzle-orm";
import { db, storage } from "../../storage";
import { chatMessages, personaRuns, voiceUtterances } from "../../../shared/schema/conversations";
import { conversationLedgerRuns, conversationLedgerUtterances } from "../../../shared/schema/conversationLedger";
import { applyLedgerCommand, readLedgerProjection } from "../conversationLedger/service";
import { usesLedger } from "../conversationLedger/transcript";
import { enqueueFeedbackJob } from "../feedbackGenerationService";
import { checkAndCompleteScenario } from "../../routes/routerHelpers";
import { TavusError } from "./client";
import { transcriptIdentity, type TavusMessage } from "./transcriptAdapter";
import type { resolveTavusContext } from "./context";

/** Reserve a fresh run before provider creation. Existing Gemini/text evidence is never replaced. */
export async function reserveTavusRun(runId: string) {
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${runId}))`);
    const [run] = await tx.select().from(personaRuns).where(eq(personaRuns.id, runId));
    const [message] = await tx.select({ id: chatMessages.id }).from(chatMessages)
      .where(eq(chatMessages.personaRunId, runId)).limit(1);
    const [evidence] = await tx.select({ id: voiceUtterances.id }).from(voiceUtterances)
      .where(eq(voiceUtterances.personaRunId, runId)).limit(1);
    if (!run || run.status !== "active" || message || evidence) throw new TavusError("tavus_fresh_run_required");
    if (usesLedger(run)) {
      const [ledger] = await tx.select().from(conversationLedgerRuns).where(eq(conversationLedgerRuns.personaRunId, runId));
      const [utterance] = await tx.select({ id: conversationLedgerUtterances.id }).from(conversationLedgerUtterances)
        .where(eq(conversationLedgerUtterances.personaRunId, runId)).limit(1);
      if (!ledger || ledger.status !== "open" || utterance) throw new TavusError("tavus_fresh_run_required");
    }
    await tx.update(personaRuns).set({ mode: "tavus_full" }).where(eq(personaRuns.id, runId));
  });
}

/** Imports provider-authenticated TEXT, not independently verified audio or certified playback. */
export async function importTavusTranscript(
  binding: Awaited<ReturnType<typeof resolveTavusContext>>,
  providerConversationId: string, messages: TavusMessage[],
) {
  const runId = binding.run.id;
  if (usesLedger(binding.run)) {
    const view = await readLedgerProjection(runId);
    if (view.version === "legacy") throw new TavusError("tavus_ledger_missing");
    if (view.utterances.some(row => row.provider !== "tavus")) throw new TavusError("tavus_mixed_transcript");
    // Text is the import transport. Do not forge capture/STT verification or playback observations.
    for (let index = 0; index < messages.length; index++) {
      const message = messages[index];
      const utteranceId = transcriptIdentity(providerConversationId, index);
      await applyLedgerCommand(runId, {
        eventId: transcriptIdentity(providerConversationId, index, "register"), generation: view.generation,
        payload: { kind: "utterance.register", utteranceId, speaker: message.sender, mode: "text",
          personaId: binding.run.personaId, provider: "tavus",
          providerResponseId: `${providerConversationId}:${index}` },
      }, "server");
      await applyLedgerCommand(runId, {
        eventId: transcriptIdentity(providerConversationId, index, "final"), generation: view.generation,
        payload: { kind: "provider.final", utteranceId, text: message.message,
          metadata: { sourceTimestamp: message.timestamp } },
      }, "server");
    }
    await applyLedgerCommand(runId, {
      eventId: transcriptIdentity(providerConversationId, -1, "close"), generation: view.generation,
      payload: { kind: "session.close", reason: "user_end" },
    }, "server");
  } else {
    await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${runId}))`);
      for (let index = 0; index < messages.length; index++) {
        const message = messages[index];
        const messageId = transcriptIdentity(providerConversationId, index);
        const [existing] = await tx.select({ id: chatMessages.id }).from(chatMessages).where(and(
          eq(chatMessages.personaRunId, runId), eq(chatMessages.turnIndex, index), eq(chatMessages.sender, message.sender),
        ));
        if (existing && existing.id !== messageId) throw new TavusError("tavus_mixed_transcript");
        await tx.insert(chatMessages).values({
          id: messageId, personaRunId: runId, sender: message.sender, message: message.message,
          turnIndex: index, createdAt: new Date(message.timestamp),
        }).onConflictDoNothing();
      }
    });
  }
  // Retain even AI-only final history, but never score a learner who did not speak.
  if (messages.some(message => message.sender === "user")) {
    const job = await enqueueFeedbackJob({
      conversationId: runId,
      conversation: { id: runId, mode: "realtime_voice", messages,
        transcriptSource: { provider: "tavus", conversationId: providerConversationId, kind: "final_transcript" } },
      scenario: binding.scenario, persona: binding.persona, language: binding.language,
      evaluationHarnessSnapshot: binding.evaluationHarnessSnapshot,
    });
    if (!["queued", "generating", "completed"].includes(job.status)) {
      throw new TavusError("tavus_feedback_enqueue_failed", 503);
    }
  }
  await storage.updatePersonaRun(runId, {
    status: "completed", completedAt: new Date(), turnCount: messages.filter(m => m.sender === "user").length,
  });
  await checkAndCompleteScenario(binding.run.scenarioRunId);
}
