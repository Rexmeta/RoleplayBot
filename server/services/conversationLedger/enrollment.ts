import { initializeLedger } from "./service";
import { assertImportedSnapshotComplete, EVALUATION_CRITERIA_SNAPSHOT_KEY, buildRuntimePersonaProfile, RUNTIME_PERSONA_PROFILE_KEY } from "../runtimeScenario";

/**
 * Default-off rollout. The flag is consulted only at creation; run presence and
 * transcriptProtocol remain the permanent authority for every later operation.
 */
export function ledgerRolloutEnabled() {
  return process.env.CONVERSATION_LEDGER_V1_ENABLED === "true";
}

/** Inputs must be server-resolved runtime content, never request persona snapshots. */
export async function enrollNewWebRun(
  runId: string, personaId: string, scenario: any, scenarioPersona: any,
  harness: unknown, language: string, snapshotBound: boolean, difficulty: number,
) {
  assertImportedSnapshotComplete(scenario);
  const { storage } = await import("../../storage");
  const { fileManager } = await import("../fileManager");
  const mbti = scenarioPersona.mbti ?? scenarioPersona.personaRef?.replace(".json", "");
  const liveProfile = !snapshotBound && mbti ? await fileManager.getPersonaByMBTI(mbti) : null;
  const personaSnapshot = buildRuntimePersonaProfile(scenarioPersona, liveProfile, snapshotBound);
  let rubricSnapshot = scenario[EVALUATION_CRITERIA_SNAPSHOT_KEY];
  if (!rubricSnapshot && !snapshotBound) {
    const { loadEvaluationCriteria } = await import("../../routes/routerHelpers");
    rubricSnapshot = await loadEvaluationCriteria(scenario, language as "ko" | "en" | "ja" | "zh");
  }
  // A real rubric must be bound, not a placeholder/default invented by enrollment.
  if (!rubricSnapshot) throw new Error("ledger_bound_rubric_unavailable");
  const personas = await Promise.all((scenario.personas ?? [scenarioPersona]).map(async (persona: any) => {
    const type = persona.mbti ?? persona.personaRef?.replace(".json", "");
    const profile = snapshotBound ? null : type ? await fileManager.getPersonaByMBTI(type) : null;
    return { ...persona, [RUNTIME_PERSONA_PROFILE_KEY]: buildRuntimePersonaProfile(persona, profile, snapshotBound) };
  }));
  const scenarioSnapshot = { ...scenario, personas, [EVALUATION_CRITERIA_SNAPSHOT_KEY]: rubricSnapshot };
  return initializeLedger(runId, personaId, language === "ko", {
    scenarioSnapshot, personaSnapshot, rubricSnapshot, evaluationHarnessSnapshot: harness ?? null,
    language, difficulty,
  });
}
