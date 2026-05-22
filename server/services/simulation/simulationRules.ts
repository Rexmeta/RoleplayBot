import {
  SimulationState,
  SimulationStatePatch,
  TurnScore,
  Incident,
  IncidentType,
  ScenarioStage,
  NpcEmotions,
} from './simulationTypes';
import type { NpcBehaviorHarness, DifficultyProfile } from '../../../shared/schema/scenarios';
import { checkIncidentCooldown } from './simulationEngine';
import { renderIncidentMessage } from './incidentTemplates';
import { v4 as uuidv4 } from 'uuid';

export function inferEmotionPatchFromEvaluation(
  turnScore: TurnScore,
  currentState: SimulationState
): Partial<Record<keyof NpcEmotions, number>> {
  const delta: Partial<Record<keyof NpcEmotions, number>> = {};
  const total = turnScore.total;

  if (total >= 80) {
    delta.trust = 5;
    delta.anger = -5;
    delta.interest = 5;
    delta.confusion = -3;
  } else if (total >= 60) {
    delta.trust = 2;
    delta.anger = -2;
    delta.interest = 2;
  } else if (total >= 40) {
    delta.confusion = 3;
    delta.interest = -2;
  } else {
    delta.anger = 5;
    delta.trust = -5;
    delta.confusion = 5;
    delta.interest = -5;
  }

  if (turnScore.empathy < 40) delta.trust = (delta.trust ?? 0) - 3;
  if (turnScore.empathy >= 80) delta.trust = (delta.trust ?? 0) + 3;
  if (turnScore.actionPlan < 30) delta.anger = (delta.anger ?? 0) + 5;
  if (turnScore.clarity < 30) delta.confusion = (delta.confusion ?? 0) + 5;

  return delta;
}

export function inferStagePatchFromState(state: SimulationState): ScenarioStage | null {
  const { anger, trust } = state.npcEmotions;
  const pressure = state.pressureLevel;
  const stage = state.stage;
  const { totalTurns } = state.summary;

  if (stage === 'intro' && totalTurns >= 2) return 'conflict';
  if (stage === 'conflict' && (anger >= 70 || pressure >= 4)) return 'negotiation';
  if (stage === 'negotiation' && anger >= 85 && trust <= 25) return 'escalation';
  // escalation -> negotiation (backward) is omitted: engine's stageAllowed() blocks backward transitions
  if ((stage === 'negotiation' || stage === 'escalation') && trust >= 65 && anger <= 35) return 'resolution';

  return null;
}

export function inferIncidentCandidate(
  state: SimulationState,
  personaRunId: string,
  currentTurnIndex: number,
  language: 'ko' | 'en' | 'ja' | 'zh' = 'ko',
  scenarioContext = ''
): Incident | null {
  const { anger, trust } = state.npcEmotions;
  const pressure = state.pressureLevel;

  let type: IncidentType | null = null;
  let severity: 'low' | 'medium' | 'high' = 'medium';

  if (anger >= 85 && trust <= 20) {
    type = 'customer_escalation';
    severity = 'high';
  } else if (pressure >= 4 && state.stage === 'negotiation') {
    type = 'deadline_pressure';
    severity = 'medium';
  } else if (anger >= 70 && state.summary.totalTurns >= 5) {
    type = 'manager_interrupt';
    severity = 'medium';
  } else if (trust <= 25 && pressure >= 3) {
    type = 'compliance_warning';
    severity = 'low';
  }

  if (!type) return null;

  const cooldown = checkIncidentCooldown(personaRunId, type);
  if (!cooldown.allowed) return null;

  const message = renderIncidentMessage(type, severity, scenarioContext, language);

  return {
    id: uuidv4(),
    type,
    severity,
    message,
    turnIndex: currentTurnIndex,
    triggeredBy: 'server_rule',
    createdAt: new Date().toISOString(),
    resolved: false,
  };
}

/**
 * Applies NpcBehaviorHarness negotiation bounds as additional emotion delta modifiers.
 * Called after the baseline emotion delta is computed to layer harness-specific adjustments.
 */
export function applyNpcBehaviorHarnessModifiers(
  baseDelta: Partial<Record<keyof NpcEmotions, number>>,
  harness: NpcBehaviorHarness | undefined | null,
  currentState: SimulationState
): Partial<Record<keyof NpcEmotions, number>> {
  if (!harness?.negotiationBounds) return baseDelta;
  const result = { ...baseDelta };
  const bounds = harness.negotiationBounds;
  const { anger, trust } = currentState.npcEmotions;

  // If trust is below the yield threshold, the NPC becomes more resistant — amplify anger
  if (bounds.minTrustToYield !== undefined && trust < bounds.minTrustToYield) {
    result.anger = (result.anger ?? 0) + 3;
    result.trust = (result.trust ?? 0) - 2;
  }

  // If anger is above the walkout threshold, escalate faster
  if (bounds.maxAngerBeforeWalkout !== undefined && anger >= bounds.maxAngerBeforeWalkout) {
    result.anger = (result.anger ?? 0) + 5;
    result.trust = (result.trust ?? 0) - 5;
  }

  // If max patience turns exceeded, suppress positive trust recovery
  if (bounds.maxPatienceTurns !== undefined && currentState.summary.totalTurns >= bounds.maxPatienceTurns) {
    if ((result.trust ?? 0) > 0) {
      result.trust = Math.floor((result.trust ?? 0) * 0.5);
    }
  }

  return result;
}

/**
 * Scales incident probability thresholds using difficultyProfile.incidentProbability.
 * Returns true if the incident should be allowed given the scaled probability, false to suppress.
 * incidentProbability > 1.0 → lower thresholds (more incidents)
 * incidentProbability < 1.0 → higher thresholds (fewer incidents)
 */
export function evaluateIncidentProbability(
  baseAllowed: boolean,
  difficultyProfile: DifficultyProfile | undefined | null
): boolean {
  if (!baseAllowed) return false;
  const prob = difficultyProfile?.incidentProbability ?? 1.0;
  if (prob >= 1.0) return true;
  return Math.random() < prob;
}

export function buildRuleFallbackPatch(
  turnScore: TurnScore,
  state: SimulationState,
  toolCallCount: number
): SimulationStatePatch | null {
  if (toolCallCount > 0) return null;

  // NOTE: emotion deltas are NOT included here because they are already applied
  // upstream via the server_evaluation patch (evaluateUserResponse().emotionDelta).
  // Including them again would double-apply and cause ~2x drift on no-tool turns.
  // This fallback patch is limited to stage transitions and pressure changes only.
  const newStage = inferStagePatchFromState(state);

  if (!newStage) return null;

  return {
    ...(newStage ? { targetStage: newStage } : {}),
  };
}
