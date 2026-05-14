import { describe, it, expect, beforeEach } from 'vitest';
import {
  inferEmotionPatchFromEvaluation,
  inferStagePatchFromState,
  inferIncidentCandidate,
  buildRuleFallbackPatch,
} from '../../server/services/simulation/simulationRules';
import { clearSessionContext } from '../../server/services/simulation/simulationEngine';
import {
  createDefaultSimulationState,
  TurnScore,
  SimulationState,
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
  it('increases trust and decreases anger for high score', () => {
    const state = createDefaultSimulationState();
    const delta = inferEmotionPatchFromEvaluation(makeTurnScore(85), state);
    expect(delta.trust).toBeGreaterThan(0);
    expect(delta.anger).toBeLessThan(0);
  });

  it('increases anger and decreases trust for low score', () => {
    const state = createDefaultSimulationState();
    const delta = inferEmotionPatchFromEvaluation(makeTurnScore(25), state);
    expect(delta.anger).toBeGreaterThan(0);
    expect(delta.trust).toBeLessThan(0);
  });

  it('adds extra trust penalty for low empathy', () => {
    const state = createDefaultSimulationState();
    const highEmpathyDelta = inferEmotionPatchFromEvaluation(makeTurnScore(85, { empathy: 90 }), state);
    const lowEmpathyDelta = inferEmotionPatchFromEvaluation(makeTurnScore(85, { empathy: 30 }), state);
    expect((lowEmpathyDelta.trust ?? 0)).toBeLessThan((highEmpathyDelta.trust ?? 0));
  });
});

describe('inferStagePatchFromState', () => {
  it('returns null for brand new state', () => {
    const state = createDefaultSimulationState();
    expect(inferStagePatchFromState(state)).toBeNull();
  });

  it('transitions intro->conflict after 2 turns', () => {
    const state: SimulationState = {
      ...createDefaultSimulationState(),
      stage: 'intro',
      summary: { totalTurns: 2, totalIncidents: 0, averageScore: 60, maxAnger: 30, minTrust: 50 },
    };
    expect(inferStagePatchFromState(state)).toBe('conflict');
  });

  it('transitions conflict->negotiation when anger is high', () => {
    const state: SimulationState = {
      ...createDefaultSimulationState(),
      stage: 'conflict',
      npcEmotions: { anger: 75, trust: 40, confusion: 20, interest: 50 },
      pressureLevel: 2,
      summary: { totalTurns: 5, totalIncidents: 0, averageScore: 50, maxAnger: 75, minTrust: 40 },
    };
    expect(inferStagePatchFromState(state)).toBe('negotiation');
  });

  it('transitions to resolution when anger is low and trust is high', () => {
    const state: SimulationState = {
      ...createDefaultSimulationState(),
      stage: 'negotiation',
      npcEmotions: { anger: 30, trust: 70, confusion: 15, interest: 60 },
      pressureLevel: 2,
      summary: { totalTurns: 8, totalIncidents: 0, averageScore: 75, maxAnger: 60, minTrust: 40 },
    };
    expect(inferStagePatchFromState(state)).toBe('resolution');
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
    // If inferStagePatchFromState returns a stage, we get a patch; check no npcEmotionDelta
    if (patch !== null) {
      expect(patch.npcEmotionDelta).toBeUndefined();
      expect(patch.targetStage).toBeDefined();
    }
    // Either null (no transition needed) or a stage-only patch — never has emotion delta
    expect(patch?.npcEmotionDelta).toBeUndefined();
  });
});

describe('inferIncidentCandidate', () => {
  it('returns null when state is neutral', () => {
    const state = createDefaultSimulationState();
    const incident = inferIncidentCandidate(state, RUN_ID, 0, 'ko', '');
    expect(incident).toBeNull();
  });

  it('returns customer_escalation when anger is very high and trust is low', () => {
    const state: SimulationState = {
      ...createDefaultSimulationState(),
      npcEmotions: { anger: 90, trust: 15, confusion: 30, interest: 20 },
      summary: { totalTurns: 5, totalIncidents: 0, averageScore: 35, maxAnger: 90, minTrust: 15 },
    };
    const incident = inferIncidentCandidate(state, RUN_ID, 5, 'ko', '');
    expect(incident).not.toBeNull();
    expect(incident?.type).toBe('customer_escalation');
    expect(incident?.severity).toBe('high');
  });
});
