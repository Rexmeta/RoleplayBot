import type { ComplexScenario } from '@/lib/scenario-system';

export const EVALUATION_CRITERIA_SNAPSHOT_KEY = '_evaluationCriteriaSnapshot';
export const RUNTIME_PERSONA_PROFILE_KEY = '_runtimeProfile';

type ScenarioRunLike = {
  scenarioId: string;
  scenarioSnapshot?: unknown;
  evaluationHarnessSnapshot?: unknown;
};

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * A published run snapshot is authoritative for runtime behavior. Live scenario
 * data is retained only for legacy and unpublished runs that have no snapshot.
 */
export function resolveRuntimeScenario(
  scenarioRun: ScenarioRunLike,
  liveScenario?: ComplexScenario | Record<string, any> | null,
): Record<string, any> | null {
  if (isRecord(scenarioRun.scenarioSnapshot)) {
    return {
      ...scenarioRun.scenarioSnapshot,
      id: scenarioRun.scenarioSnapshot.id ?? scenarioRun.scenarioId,
      evaluationHarness: isRecord(scenarioRun.evaluationHarnessSnapshot)
        ? scenarioRun.evaluationHarnessSnapshot
        : scenarioRun.scenarioSnapshot.evaluationHarness ?? null,
    };
  }
  // No binding means a legacy/OFF run: later authoring must not add culture
  // to an already running native conversation. New cultural runs are frozen.
  if (liveScenario?.personas?.some((actor: any) => actor.culture !== undefined)) {
    return { ...liveScenario, personas: liveScenario.personas.map((actor: any) => {
      const { culture: _culture, ...legacyActor } = actor;
      return legacyActor;
    }) };
  }
  return liveScenario ? { ...liveScenario } : null;
}

export function findRuntimePersona(scenario: Record<string, any>, personaId: string): any | null {
  const personas = Array.isArray(scenario.personas) ? scenario.personas : [];
  const normalizedPersonaId = personaId.toLowerCase();
  return personas.find((persona: any) =>
    persona?.id === personaId ||
    persona?.id?.toLowerCase() === normalizedPersonaId ||
    persona?.personaRef?.replace('.json', '').toLowerCase() === normalizedPersonaId
  ) ?? null;
}

export function getSnapshotEvaluationCriteria(scenario: Record<string, any> | null): any | null {
  const snapshot = scenario?.[EVALUATION_CRITERIA_SNAPSHOT_KEY];
  return isRecord(snapshot) && Array.isArray(snapshot.dimensions) ? snapshot : null;
}

export function assertImportedSnapshotComplete(snapshot: Record<string, any>): void {
  if (snapshot.contentxPackageId && !getSnapshotEvaluationCriteria(snapshot)) {
    throw new Error('Imported scenario snapshot is missing its published evaluation criteria');
  }
  if (
    snapshot.contentxPackageId &&
    Array.isArray(snapshot.personas) &&
    snapshot.personas.some((persona: any) => !isRecord(persona?.[RUNTIME_PERSONA_PROFILE_KEY]))
  ) {
    throw new Error('Imported scenario snapshot is missing a published persona runtime profile');
  }
}

export function buildRuntimePersonaProfile(
  scenarioPersona: Record<string, any>,
  liveMbtiPersona?: Record<string, any> | null,
  snapshotBound = false,
): Record<string, any> {
  const profile = snapshotBound
    ? (scenarioPersona[RUNTIME_PERSONA_PROFILE_KEY] ?? scenarioPersona)
    : (liveMbtiPersona ?? scenarioPersona);
  const communicationPatterns = profile.communication_patterns ?? profile.communicationPatterns ?? {};
  const background = profile.background ?? {};
  return {
    id: scenarioPersona.id,
    name: scenarioPersona.name,
    role: scenarioPersona.position ?? scenarioPersona.role,
    department: scenarioPersona.department,
    personality: profile.communication_style ?? profile.communicationStyle ?? scenarioPersona.personality ?? scenarioPersona.stance ?? '균형 잡힌 의사소통',
    responseStyle: communicationPatterns.opening_style ?? scenarioPersona.responseStyle ?? scenarioPersona.entryLine ?? '상황에 맞는 방식으로 대화 시작',
    goals: communicationPatterns.win_conditions ?? scenarioPersona.goals ?? [scenarioPersona.goal ?? '목표 달성'],
    background: background.personal_values?.join?.(', ') ?? background.personalValues?.join?.(', ') ?? scenarioPersona.background ?? scenarioPersona.experience ?? '전문성',
  };
}