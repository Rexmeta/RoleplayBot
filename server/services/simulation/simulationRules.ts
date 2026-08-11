import {
  SimulationState,
  SimulationStatePatch,
  TurnScore,
  NpcAffectiveState,
  DeepPartial,
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
): DeepPartial<NpcAffectiveState> {
  let trustDelta = 0;
  let intensityDelta = 0;
  let interestDelta = 0;
  let confusionDelta = 0;
  const total = turnScore.total;

  if (total >= 80) {
    trustDelta = 5;
    intensityDelta = -5;
    interestDelta = 5;
    confusionDelta = -3;
  } else if (total >= 60) {
    trustDelta = 2;
    intensityDelta = -2;
    interestDelta = 2;
  } else if (total >= 40) {
    confusionDelta = 3;
    interestDelta = -2;
  } else {
    intensityDelta = 5;
    trustDelta = -5;
    confusionDelta = 5;
    interestDelta = -5;
  }

  if (turnScore.empathy < 40) trustDelta -= 3;
  if (turnScore.empathy >= 80) trustDelta += 3;
  if (turnScore.actionPlan < 30) intensityDelta += 5;
  if (turnScore.clarity < 30) confusionDelta += 5;

  const delta: DeepPartial<NpcAffectiveState> = {};
  if (intensityDelta !== 0) delta.affective = { intensity: intensityDelta };
  if (confusionDelta !== 0) delta.cognitive = { confusion: confusionDelta };
  if (trustDelta !== 0) delta.relational = { trust: trustDelta };
  if (interestDelta !== 0) delta.motivational = { interest: interestDelta };

  return delta;
}

/**
 * Applies NpcBehaviorHarness negotiation bounds as additional emotion delta modifiers.
 * Called after the baseline emotion delta is computed to layer harness-specific adjustments.
 */
/**
 * Normalizes a raw persisted NpcBehaviorHarness object, migrating legacy field names
 * produced before the affective-layer rename:
 *   negotiationBounds.minTrustToYield        → minRelationalTrustToYield
 *   negotiationBounds.maxAngerBeforeWalkout  → maxAffectiveIntensityBeforeWalkout
 *   trigger.trustDelta                       → relationalTrustDelta
 *   trigger.angerDelta                       → affectiveIntensityDelta
 *
 * Safe to call on already-migrated objects (no-op if new keys are present).
 */
export function normalizeNpcBehaviorHarness(raw: any): NpcBehaviorHarness {
  if (!raw || typeof raw !== 'object') return raw;
  const out: any = { ...raw };

  if (out.negotiationBounds && typeof out.negotiationBounds === 'object') {
    const b: any = { ...out.negotiationBounds };
    if ('minTrustToYield' in b && !('minRelationalTrustToYield' in b)) {
      b.minRelationalTrustToYield = b.minTrustToYield;
      delete b.minTrustToYield;
    }
    if ('maxAngerBeforeWalkout' in b && !('maxAffectiveIntensityBeforeWalkout' in b)) {
      b.maxAffectiveIntensityBeforeWalkout = b.maxAngerBeforeWalkout;
      delete b.maxAngerBeforeWalkout;
    }
    out.negotiationBounds = b;
  }

  const normalizeTriggers = (triggers: any[]): any[] =>
    (triggers ?? []).map((t: any) => {
      const nt = { ...t };
      if ('trustDelta' in nt && !('relationalTrustDelta' in nt)) {
        nt.relationalTrustDelta = nt.trustDelta;
        delete nt.trustDelta;
      }
      if ('angerDelta' in nt && !('affectiveIntensityDelta' in nt)) {
        nt.affectiveIntensityDelta = nt.angerDelta;
        delete nt.angerDelta;
      }
      return nt;
    });

  if (Array.isArray(out.trustTriggers)) out.trustTriggers = normalizeTriggers(out.trustTriggers);
  if (Array.isArray(out.escalationTriggers)) out.escalationTriggers = normalizeTriggers(out.escalationTriggers);

  return out as NpcBehaviorHarness;
}

export function applyNpcBehaviorHarnessModifiers(
  baseDelta: DeepPartial<NpcAffectiveState>,
  harness: NpcBehaviorHarness | undefined | null,
  currentState: SimulationState
): DeepPartial<NpcAffectiveState> {
  if (!harness) return baseDelta;
  const normalized = normalizeNpcBehaviorHarness(harness);
  if (!normalized?.negotiationBounds) return baseDelta;
  const bounds = normalized.negotiationBounds;
  const intensity = currentState.npcAffectiveState.affective.intensity;
  const trust = currentState.npcAffectiveState.relational.trust;

  // Deep-merge helper for affective state deltas
  const merge = (a: DeepPartial<NpcAffectiveState>, b: DeepPartial<NpcAffectiveState>): DeepPartial<NpcAffectiveState> => ({
    affective: a.affective || b.affective ? {
      intensity: (a.affective?.intensity ?? 0) + (b.affective?.intensity ?? 0) || undefined,
      valence: (a.affective?.valence ?? 0) + (b.affective?.valence ?? 0) || undefined,
    } : undefined,
    cognitive: a.cognitive || b.cognitive ? {
      confusion: (a.cognitive?.confusion ?? 0) + (b.cognitive?.confusion ?? 0) || undefined,
      load: (a.cognitive?.load ?? 0) + (b.cognitive?.load ?? 0) || undefined,
    } : undefined,
    relational: a.relational || b.relational ? {
      trust: (a.relational?.trust ?? 0) + (b.relational?.trust ?? 0) || undefined,
      rapport: (a.relational?.rapport ?? 0) + (b.relational?.rapport ?? 0) || undefined,
    } : undefined,
    motivational: a.motivational || b.motivational ? {
      interest: (a.motivational?.interest ?? 0) + (b.motivational?.interest ?? 0) || undefined,
      cooperativeness: (a.motivational?.cooperativeness ?? 0) + (b.motivational?.cooperativeness ?? 0) || undefined,
    } : undefined,
  });

  let result = baseDelta;

  if (bounds.minRelationalTrustToYield !== undefined && trust < bounds.minRelationalTrustToYield) {
    result = merge(result, { affective: { intensity: 3 }, relational: { trust: -2 } });
  }

  if (bounds.maxAffectiveIntensityBeforeWalkout !== undefined && intensity >= bounds.maxAffectiveIntensityBeforeWalkout) {
    result = merge(result, { affective: { intensity: 5 }, relational: { trust: -5 } });
  }

  if (bounds.maxPatienceTurns !== undefined && currentState.summary.totalTurns >= bounds.maxPatienceTurns) {
    const prevTrust = result.relational?.trust ?? 0;
    if (prevTrust > 0) {
      result = { ...result, relational: { ...result.relational, trust: Math.floor(prevTrust * 0.5) } };
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
