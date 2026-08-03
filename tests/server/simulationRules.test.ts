import { describe, it, expect, beforeEach } from 'vitest';
import {
  inferEmotionPatchFromEvaluation,
  buildRuleFallbackPatch,
  applyNpcBehaviorHarnessModifiers,
} from '../../server/services/simulation/simulationRules';
import { clearSessionContext } from '../../server/services/simulation/simulationEngine';
import {
  createDefaultSimulationState,
  TurnScore,
  NpcAffectiveState,
} from '../../server/services/simulation/simulationTypes';

const RUN_ID = 'rules-test-001';

beforeEach(() => {
  clearSessionContext(RUN_ID);
});

function makeTurnScore(total: number, overrides?: Partial<TurnScore>): TurnScore {
  return {
    turnId: 'ts-1',
    turnIndex: 0,
    clarity: total,
    empathy: total,
    logic: total,
    ownership: total,
    actionPlan: total,
    total,
    evaluationMethod: 'llm',
    evaluationConfidence: 80,
    ...overrides,
  };
}

describe('inferEmotionPatchFromEvaluation', () => {
  it('increases trust and decreases intensity for high score', () => {
    const state = createDefaultSimulationState();
    const delta = inferEmotionPatchFromEvaluation(makeTurnScore(85), state);
    // Now returns DeepPartial<NpcAffectiveState>
    expect(delta.relational?.trust ?? 0).toBeGreaterThan(0);
    expect(delta.affective?.intensity ?? 0).toBeLessThan(0);
  });

  it('increases intensity and decreases trust for low score', () => {
    const state = createDefaultSimulationState();
    const delta = inferEmotionPatchFromEvaluation(makeTurnScore(25), state);
    expect(delta.affective?.intensity ?? 0).toBeGreaterThan(0);
    expect(delta.relational?.trust ?? 0).toBeLessThan(0);
  });

  it('adds extra trust penalty for low empathy', () => {
    const state = createDefaultSimulationState();
    const highEmpathyDelta = inferEmotionPatchFromEvaluation(makeTurnScore(85, { empathy: 90 }), state);
    const lowEmpathyDelta = inferEmotionPatchFromEvaluation(makeTurnScore(85, { empathy: 30 }), state);
    expect((lowEmpathyDelta.relational?.trust ?? 0)).toBeLessThan((highEmpathyDelta.relational?.trust ?? 0));
  });
});

describe('buildRuleFallbackPatch', () => {
  it('returns null when tool calls were made', () => {
    const state = createDefaultSimulationState();
    const ts = makeTurnScore(75);
    const patch = buildRuleFallbackPatch(ts, state, 2);
    expect(patch).toBeNull();
  });

  it('returns null when no tool calls but no stage transition needed (default state)', () => {
    // buildRuleFallbackPatch no longer applies emotion deltas (would double-apply with
    // server_evaluation patch). It only handles stage transitions. Default intro state
    // with score=90 and normal anger/trust does not trigger a stage change.
    const state = createDefaultSimulationState();
    const ts = makeTurnScore(90);
    const patch = buildRuleFallbackPatch(ts, state, 0);
    expect(patch).toBeNull();
  });

  it('returns a stage-only patch when state triggers a stage transition', () => {
    // Simulate a state where anger is high and trust is low → should suggest stage advance
    const state = {
      ...createDefaultSimulationState(),
      stage: 'conflict' as const,
      pressureLevel: 4,
      npcEmotions: { anger: 85, trust: 20, confusion: 30, interest: 20 },
      summary: { totalTurns: 6, totalIncidents: 0, averageScore: 40, maxAnger: 85, minTrust: 20 },
    };
    const ts = makeTurnScore(30);
    const patch = buildRuleFallbackPatch(ts, state, 0);
    expect(patch).not.toBeNull();
    expect(patch!.npcAffectiveStateDelta).toBeUndefined();
    expect(patch!.targetStage).toBeDefined();
  });
});

describe('applyNpcBehaviorHarnessModifiers — legacy state safety', () => {
  it('does not crash when npcAffectiveState is absent (legacy state) and negotiationBounds is set', () => {
    // Regression: this would throw "Cannot read properties of undefined (reading 'affective')"
    // before the guard was added.
    const legacyState = {
      ...createDefaultSimulationState(),
      npcEmotions: { anger: 85, trust: 20, confusion: 30, interest: 40 },
      npcAffectiveState: undefined as any,
    };

    const harness = {
      negotiationBounds: {
        maxAngerBeforeWalkout: 80,
        minTrustToYield: 30,
      },
    };

    expect(() => {
      applyNpcBehaviorHarnessModifiers({}, harness, legacyState);
    }).not.toThrow();
  });

  it('reads intensity and trust from flat npcEmotions when npcAffectiveState is absent', () => {
    const legacyState = {
      ...createDefaultSimulationState(),
      npcEmotions: { anger: 85, trust: 20, confusion: 30, interest: 40 },
      npcAffectiveState: undefined as any,
    };

    const harness = {
      negotiationBounds: {
        maxAngerBeforeWalkout: 80, // anger=85 ≥ 80 → should trigger extra intensity/trust penalty
        minTrustToYield: 30,       // trust=20 < 30 → should also trigger
      },
    };

    const result = applyNpcBehaviorHarnessModifiers({}, harness, legacyState);

    // Both conditions fired, so affective intensity and relational trust penalties must be present
    expect((result.affective?.intensity ?? 0)).toBeGreaterThan(0);
    expect((result.relational?.trust ?? 0)).toBeLessThan(0);
  });
});

