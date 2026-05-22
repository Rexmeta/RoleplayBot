import { describe, it, expect, beforeEach } from 'vitest';
import { inferStageTransition, resolveStageTransition } from '../../../server/services/simulation/engine/inferStageTransition';
import { createDefaultSimulationState } from '../../../server/services/simulation/simulationTypes';
import type { FlowGraph } from '../../../shared/schema/scenarios';
import { clearSessionContext } from '../../../server/services/simulation/simulationEngine';

beforeEach(() => {
  clearSessionContext('test-run');
});

describe('inferStageTransition', () => {
  it('transitions intro → conflict after 2 turns', () => {
    const state = createDefaultSimulationState();
    state.stage = 'intro';
    state.summary.totalTurns = 2;
    expect(inferStageTransition(state)).toBe('conflict');
  });

  it('does not transition intro → conflict before 2 turns', () => {
    const state = createDefaultSimulationState();
    state.stage = 'intro';
    state.summary.totalTurns = 1;
    expect(inferStageTransition(state)).toBeNull();
  });

  it('transitions conflict → negotiation on high anger', () => {
    const state = createDefaultSimulationState();
    state.stage = 'conflict';
    state.npcEmotions.anger = 75;
    expect(inferStageTransition(state)).toBe('negotiation');
  });

  it('transitions conflict → negotiation on high pressure', () => {
    const state = createDefaultSimulationState();
    state.stage = 'conflict';
    state.pressureLevel = 4;
    expect(inferStageTransition(state)).toBe('negotiation');
  });

  it('transitions negotiation → escalation when anger high and trust very low', () => {
    const state = createDefaultSimulationState();
    state.stage = 'negotiation';
    state.npcEmotions.anger = 90;
    state.npcEmotions.trust = 20;
    expect(inferStageTransition(state)).toBe('escalation');
  });

  it('transitions negotiation → resolution when trust high and anger low', () => {
    const state = createDefaultSimulationState();
    state.stage = 'negotiation';
    state.npcEmotions.trust = 70;
    state.npcEmotions.anger = 30;
    expect(inferStageTransition(state)).toBe('resolution');
  });

  it('transitions escalation → resolution when trust high and anger low', () => {
    const state = createDefaultSimulationState();
    state.stage = 'escalation';
    state.npcEmotions.trust = 70;
    state.npcEmotions.anger = 30;
    expect(inferStageTransition(state)).toBe('resolution');
  });

  it('returns null when no transition condition is met', () => {
    const state = createDefaultSimulationState();
    state.stage = 'conflict';
    state.npcEmotions.anger = 30;
    state.pressureLevel = 1;
    expect(inferStageTransition(state)).toBeNull();
  });
});

describe('resolveStageTransition', () => {
  it('uses rule-based logic when no flowGraph provided', () => {
    const state = createDefaultSimulationState();
    state.stage = 'intro';
    state.summary.totalTurns = 3;
    expect(resolveStageTransition(state, null)).toBe('conflict');
  });

  it('uses flowGraph when provided', () => {
    const state = createDefaultSimulationState();
    state.stage = 'intro';
    state.summary.totalTurns = 5;

    const flowGraph: FlowGraph = {
      stages: [
        {
          id: 'intro',
          goal: 'Establish context',
          exitConditions: [{ type: 'turn_count', operator: 'gte', value: 3 }],
          exitConditionsLogic: 'all',
          nextStage: 'conflict',
        },
        {
          id: 'conflict',
          goal: 'Handle conflict',
          exitConditions: [],
          exitConditionsLogic: 'all',
          nextStage: 'resolution',
        },
      ],
    };

    expect(resolveStageTransition(state, flowGraph)).toBe('conflict');
  });

  it('flowGraph returns null when exit conditions not met', () => {
    const state = createDefaultSimulationState();
    state.stage = 'intro';
    state.summary.totalTurns = 1;

    const flowGraph: FlowGraph = {
      stages: [
        {
          id: 'intro',
          goal: 'Establish context',
          exitConditions: [{ type: 'turn_count', operator: 'gte', value: 5 }],
          exitConditionsLogic: 'all',
          nextStage: 'conflict',
        },
      ],
    };

    expect(resolveStageTransition(state, flowGraph)).toBeNull();
  });
});
