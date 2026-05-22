import { describe, it, expect, beforeEach } from 'vitest';
import { handleToolCall } from '../../server/services/simulation/simulationToolHandler';
import { clearSessionContext, getSessionState } from '../../server/services/simulation/simulationEngine';
import { createDefaultSimulationState } from '../../server/services/simulation/simulationTypes';

const RUN_ID = 'tool-test-001';

const BASE_CTX = {
  personaRunId: RUN_ID,
  turnId: 'turn-1',
  turnIndex: 0,
  currentTurnIncidentFired: false,
  toolCallCountThisTurn: 0,
  emotionCallCountThisTurn: 0,
  language: 'ko' as const,
};

beforeEach(() => {
  clearSessionContext(RUN_ID);
});

describe('handleToolCall — unknown tool', () => {
  it('returns success:false for unknown tool names', () => {
    const result = handleToolCall('nonexistent_tool', {}, BASE_CTX);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unknown tool/);
  });
});

describe('handleToolCall — update_npc_emotion', () => {
  it('returns success:true and applies emotion delta', () => {
    const result = handleToolCall('update_npc_emotion', {
      angerDelta: 10,
      trustDelta: -5,
      reason: 'User was rude',
    }, BASE_CTX);
    expect(result.success).toBe(true);
    const state = getSessionState(RUN_ID)!;
    expect(state.npcEmotions.anger).toBe(40); // default 30 + 10
    expect(state.npcEmotions.trust).toBe(45); // default 50 - 5
  });

  it('clamps extreme delta instead of rejecting', () => {
    const result = handleToolCall('update_npc_emotion', {
      angerDelta: 999,
      reason: 'extreme',
    }, BASE_CTX);
    expect(result.success).toBe(true);
    const state = getSessionState(RUN_ID)!;
    expect(state.npcEmotions.anger).toBe(60); // default 30 + clamped 30
  });

  it('rejects missing reason field', () => {
    const result = handleToolCall('update_npc_emotion', {
      angerDelta: 5,
    }, BASE_CTX);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid args/);
  });

  it('enforces max 2 emotion updates per turn', () => {
    const ctx = { ...BASE_CTX, emotionCallCountThisTurn: 2 };
    const result = handleToolCall('update_npc_emotion', {
      angerDelta: 5,
      reason: 'extra update',
    }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Maximum 2 emotion updates');
  });

  it('clamps delta at ±30 boundary (harness enforcement)', () => {
    const atBoundary = handleToolCall('update_npc_emotion', {
      angerDelta: 30,
      trustDelta: -30,
      reason: 'boundary test',
    }, BASE_CTX);
    expect(atBoundary.success).toBe(true);

    clearSessionContext(RUN_ID);
    const overBoundary = handleToolCall('update_npc_emotion', {
      angerDelta: 31,
      reason: 'over boundary',
    }, BASE_CTX);
    expect(overBoundary.success).toBe(true);
    const state = getSessionState(RUN_ID)!;
    expect(state.npcEmotions.anger).toBe(60); // default 30 + clamped 30 (not 31)
  });
});

describe('handleToolCall — update_scenario_state', () => {
  it('advances stage correctly', () => {
    const result = handleToolCall('update_scenario_state', {
      targetStage: 'conflict',
      reason: 'tension escalated',
    }, BASE_CTX);
    expect(result.success).toBe(true);
    const state = getSessionState(RUN_ID)!;
    expect(state.stage).toBe('conflict');
  });

  it('rejects backward stage transition (engine blocks it)', () => {
    handleToolCall('update_scenario_state', {
      targetStage: 'conflict',
      reason: 'advance',
    }, BASE_CTX);
    const afterConflict = getSessionState(RUN_ID)!;
    expect(afterConflict.stage).toBe('conflict');

    handleToolCall('update_scenario_state', {
      targetStage: 'intro',
      reason: 'backward attempt',
    }, { ...BASE_CTX, turnId: 'turn-2' });
    const afterBackward = getSessionState(RUN_ID)!;
    expect(afterBackward.stage).toBe('conflict'); // engine blocks backward
  });

  it('rejects invalid pressureDelta (must be -1, 0, or 1)', () => {
    const result = handleToolCall('update_scenario_state', {
      pressureDelta: 5,
      reason: 'invalid pressure',
    }, BASE_CTX);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid args/);
  });

  it('rejects invalid stage name', () => {
    const result = handleToolCall('update_scenario_state', {
      targetStage: 'chaos',
      reason: 'bad stage',
    }, BASE_CTX);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid args/);
  });
});

describe('handleToolCall — trigger_incident', () => {
  it('creates an incident with correct fields', () => {
    const result = handleToolCall('trigger_incident', {
      type: 'executive_join',
      severity: 'high',
      reason: 'CEO walked in',
    }, BASE_CTX);
    expect(result.success).toBe(true);
    expect(result.incident).toBeDefined();
    expect(result.incident!.type).toBe('executive_join');
    expect(result.incident!.severity).toBe('high');
    expect(result.incident!.resolved).toBe(false);
  });

  it('blocks second incident in same turn (currentTurnIncidentFired=true)', () => {
    const result = handleToolCall('trigger_incident', {
      type: 'customer_escalation',
      severity: 'medium',
      reason: 'second attempt',
    }, { ...BASE_CTX, currentTurnIncidentFired: true });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Only one incident per turn');
  });

  it('blocks incident within global cooldown', () => {
    // First incident — allowed
    const first = handleToolCall('trigger_incident', {
      type: 'deadline_pressure',
      severity: 'medium',
      reason: 'first',
    }, BASE_CTX);
    expect(first.success).toBe(true);

    // Same type again immediately — blocked by type cooldown
    const second = handleToolCall('trigger_incident', {
      type: 'deadline_pressure',
      severity: 'medium',
      reason: 'second',
    }, { ...BASE_CTX, turnId: 'turn-2', turnIndex: 1 });
    expect(second.success).toBe(false);
    expect(second.error).toBeDefined();
  });

  it('rejects incident type not in allowedTypes', () => {
    const result = handleToolCall('trigger_incident', {
      type: 'alien_invasion',
      severity: 'high',
      reason: 'bad type',
    }, BASE_CTX);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not allowed/);
  });

  it('increases pressure for high severity incident', () => {
    const before = createDefaultSimulationState();
    handleToolCall('trigger_incident', {
      type: 'budget_cut',
      severity: 'high',
      reason: 'budget slashed',
    }, BASE_CTX);
    const after = getSessionState(RUN_ID)!;
    expect(after.pressureLevel).toBeGreaterThan(before.pressureLevel);
  });
});
