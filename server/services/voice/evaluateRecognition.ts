import { db } from '../../storage';
import { voiceUtterances, simulationEvents } from '@shared/schema';
import { eq, sql } from 'drizzle-orm';
import { recognitionResolved } from './recognitionPolicy';
import { evaluateUserResponse } from '../simulation/evaluateUserResponse';
import { getSessionState, getSessionHarnessConfig, getSessionEvaluationHarness } from '../simulation/simulationEngine';

/** Score canonical speech only. Publication is fenced against a newer confirmation. */
export async function evaluateRecognition(id: string) {
  const [evidence] = await db.select().from(voiceUtterances).where(eq(voiceUtterances.id, id)).limit(1);
  if (!evidence || !recognitionResolved(evidence)) return;
  const state = getSessionState(evidence.personaRunId);
  // If the runtime is no longer active, final feedback evaluates the confirmed
  // history against the bound snapshot. Do not recreate a live harness from mutable data.
  if (!state) return;
  const harness = getSessionHarnessConfig(evidence.personaRunId);
  const result = await evaluateUserResponse({
    personaRunId: evidence.personaRunId, turnId: evidence.id, turnIndex: evidence.speechSeq - 1,
    userText: evidence.canonicalText!, aiText: '', simulationState: state,
    language: 'ko', evaluationHarness: getSessionEvaluationHarness(evidence.personaRunId),
    npcBehaviorHarness: harness?.npcBehaviorHarness ?? undefined,
  });
  if (result.skipped) return;
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${evidence.personaRunId}))`);
    const [latest] = await tx.select().from(voiceUtterances).where(eq(voiceUtterances.id, id)).limit(1);
    if (!latest || latest.revision !== evidence.revision || !recognitionResolved(latest)) return;
    const existing = await tx.select().from(simulationEvents).where(eq(simulationEvents.personaRunId, evidence.personaRunId));
    if (existing.some(e => e.turnId === id && (e.result as any)?.recognitionRevision === evidence.revision)) return;
    await tx.insert(simulationEvents).values({
      personaRunId: evidence.personaRunId, turnId: id, turnIndex: evidence.speechSeq - 1,
      eventType: 'auto_evaluation', includeInReport: true,
      result: { turnScore: result.turnScore, recognitionRevision: evidence.revision, source: evidence.source },
      stateVersionBefore: state.version, stateVersionAfter: state.version,
    });
  });
}