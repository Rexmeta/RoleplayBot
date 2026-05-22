import {
  SimulationState,
  SimulationStatePatch,
  TurnScore,
  NpcEmotions,
  ScenarioStage,
} from './simulationTypes';
import type { NpcBehaviorHarness, DifficultyProfile } from '../../../shared/schema/scenarios';
import { inferStageTransition } from './engine/inferStageTransition';

/**
 * Re-export engine-layer functions so existing callers keep working unchanged.
 * The canonical implementations now live in engine/inferStageTransition.ts and
 * engine/triggerIncident.ts.
 */
export {
  inferStageTransition as inferStagePatchFromState,
  resolveStageTransition,
} from './engine/inferStageTransition';

export {
  inferIncidentCandidate,
  evaluateIncidentProbability,
} from './engine/triggerIncident';

// ---------------------------------------------------------------------------
// Emotion-delta helpers — remain in this module (used by evaluateUserResponse)
// ---------------------------------------------------------------------------

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

  if (bounds.minTrustToYield !== undefined && trust < bounds.minTrustToYield) {
    result.anger = (result.anger ?? 0) + 3;
    result.trust = (result.trust ?? 0) - 2;
  }

  if (bounds.maxAngerBeforeWalkout !== undefined && anger >= bounds.maxAngerBeforeWalkout) {
    result.anger = (result.anger ?? 0) + 5;
    result.trust = (result.trust ?? 0) - 5;
  }

  if (bounds.maxPatienceTurns !== undefined && currentState.summary.totalTurns >= bounds.maxPatienceTurns) {
    if ((result.trust ?? 0) > 0) {
      result.trust = Math.floor((result.trust ?? 0) * 0.5);
    }
  }

  return result;
}

export function buildRuleFallbackPatch(
  turnScore: TurnScore,
  state: SimulationState,
  toolCallCount: number
): SimulationStatePatch | null {
  if (toolCallCount > 0) return null;

  // NOTE: emotion deltas are NOT included here — already applied via server_evaluation patch.
  // This fallback is limited to stage transitions only.
  const newStage: ScenarioStage | null = inferStageTransition(state);

  if (!newStage) return null;

  return { targetStage: newStage };
}
