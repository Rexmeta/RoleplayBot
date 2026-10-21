import { cultureSnapshotSchema } from "../../../shared/cultureMap";
import { RUNTIME_PERSONA_PROFILE_KEY, EVALUATION_CRITERIA_SNAPSHOT_KEY } from "../runtimeScenario";

/** Culture-enabled native runs freeze their complete runtime context once.
 * Legacy/OFF runs keep the old live path; published runs already have snapshots.
 */
export async function captureCultureRunSnapshot(scenario: any, language: string = "ko") {
  if (!scenario?.personas?.some((actor: any) => actor.culture?.enabled === true)) return null;
  for (const actor of scenario.personas) {
    if (actor.culture?.enabled === true) cultureSnapshotSchema.parse(actor.culture);
  }
  const { fileManager } = await import("../fileManager");
  const { loadEvaluationCriteria } = await import("../../routes/routerHelpers");
  const personas = await Promise.all(scenario.personas.map(async (actor: any) => {
    const type = actor.mbti ?? actor.personaRef?.replace(/\.json$/i, "");
    const profile = actor[RUNTIME_PERSONA_PROFILE_KEY] ?? (type ? await fileManager.getPersonaByMBTI(type) : null);
    return { ...actor, [RUNTIME_PERSONA_PROFILE_KEY]: profile ?? actor };
  }));
  const criteria = scenario[EVALUATION_CRITERIA_SNAPSHOT_KEY]
    ?? await loadEvaluationCriteria(scenario, language as "ko" | "en" | "ja" | "zh");
  return JSON.parse(JSON.stringify({ ...scenario, personas, [EVALUATION_CRITERIA_SNAPSHOT_KEY]: criteria }));
}

export async function resolveAgentCultureScenario(session: { personaRunId?: string | null; scenarioId: string }, live: any) {
  const { storage } = await import("../../storage");
  const { resolveRuntimeScenario } = await import("../runtimeScenario");
  const personaRun = session.personaRunId ? await storage.getPersonaRun(session.personaRunId) : null;
  const run = personaRun?.scenarioRunId ? await storage.getScenarioRun(personaRun.scenarioRunId) : null;
  return resolveRuntimeScenario(run ?? { scenarioId: session.scenarioId }, live);
}
