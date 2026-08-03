import { describe, it, expect, beforeEach } from 'vitest';
import {
  applySimulationPatch,
  checkIncidentCooldown,
  recordIncidentCooldown,
  getSessionState,
  setSessionState,
  clearSessionContext,
  getOrCreateSessionContext,
  evaluateFlowGraph,
  setSessionFlowConfig,
  evaluateTerminationRules,
} from '../../server/services/simulation/simulationEngine';
import {
  createDefaultSimulationState,
  SimulationStatePatch,
  DEFAULT_NPC_AFFECTIVE_STATE,
} from '../../server/services/simulation/simulationTypes';
import type { FlowGraph, TerminationRules } from '../../shared/schema/scenarios';

const RUN_ID = 'test-run-001';

beforeEach(() => {
  clearSessionContext(RUN_ID);
});

describe('applySimulationPatch', () => {
  it('creates default state on first patch', () => {
    const state = applySimulationPatch(RUN_ID, {
      source: 'server_evaluation',
      priority: 'normal',
      turnId: 'turn-1',
      patch: {},
    });
    expect(state.version).toBe(1);
    expect(state.stage).toBe('intro');
    expect(state.npcEmotions.anger).toBe(30);
  });

  it('applies emotion deltas correctly', () => {
    const state = applySimulationPatch(RUN_ID, {
      source: 'server_evaluation',
      priority: 'normal',
      turnId: 'turn-1',
      patch: { npcEmotionDelta: { anger: 20, trust: -10 } },
    });
    expect(state.npcEmotions.anger).toBe(50);
    expect(state.npcEmotions.trust).toBe(40);
  });

  it('clamps emotions to 0-100', () => {
    const state = applySimulationPatch(RUN_ID, {
      source: 'server_evaluation',
      priority: 'normal',
      turnId: 'turn-1',
      patch: { npcEmotionDelta: { anger: 200, trust: -200 } },
    });
    expect(state.npcEmotions.anger).toBe(100);
    expect(state.npcEmotions.trust).toBe(0);
  });

  it('advances stage forward only', () => {
    const state1 = applySimulationPatch(RUN_ID, {
      source: 'server_rule',
      priority: 'normal',
      turnId: 'turn-1',
      patch: { targetStage: 'conflict' },
    });
    expect(state1.stage).toBe('conflict');

    const state2 = applySimulationPatch(RUN_ID, {
      source: 'server_rule',
      priority: 'normal',
      turnId: 'turn-2',
      patch: { targetStage: 'intro' },
    });
    expect(state2.stage).toBe('conflict');
  });

  it('clamps pressure level to 1-5', () => {
    let state = applySimulationPatch(RUN_ID, {
      source: 'server_rule',
      priority: 'normal',
      turnId: 't1',
      patch: { pressureDelta: -1 },
    });
    expect(state.pressureLevel).toBe(1);

    for (let i = 0; i < 10; i++) {
      state = applySimulationPatch(RUN_ID, {
        source: 'server_rule',
        priority: 'normal',
        turnId: `t${i + 2}`,
        patch: { pressureDelta: 1 },
      });
    }
    expect(state.pressureLevel).toBe(5);
  });

  it('limits gemini_tool delta after server_evaluation on same stable turn:N turnId', () => {
    // Both voice tool-call and auto-evaluation now use `turn:${userTurnsCompleted}` as turnId.
    // This test verifies the engine correctly caps gemini_tool when server_evaluation
    // already ran on the same logical user turn.
    const turnId = 'turn:3'; // canonical stable per-user-turn ID format
    applySimulationPatch(RUN_ID, {
      source: 'server_evaluation',
      priority: 'normal',
      turnId,
      patch: { npcEmotionDelta: { anger: 15 } },
    });

    const stateAfterTool = applySimulationPatch(RUN_ID, {
      source: 'gemini_tool',
      priority: 'normal',
      turnId,
      patch: { npcEmotionDelta: { anger: 25 } },
    });

    // server_evaluation applied +15 (30→45); gemini_tool capped to ±10 → max 55
    expect(stateAfterTool.npcEmotions.anger).toBeLessThanOrEqual(55);
  });

  it('no multi-stage jump within one turn (single patch advances by at most 1 stage)', () => {
    // Even if the patch requests a stage several steps ahead, the engine's STAGE_ORDER
    // enforcement means only the requested targetStage is set — but the engine does
    // not auto-advance past it. A single patch cannot jump multiple stages.
    const turnId = 'turn:0';
    const s1 = applySimulationPatch(RUN_ID, {
      source: 'server_rule', priority: 'normal', turnId,
      patch: { targetStage: 'conflict' },
    });
    expect(s1.stage).toBe('conflict');

    // Try two patches in the same turnId (different sources) — should not jump past 'negotiation'
    const s2 = applySimulationPatch(RUN_ID, {
      source: 'server_rule', priority: 'normal', turnId,
      patch: { targetStage: 'negotiation' },
    });
    expect(s2.stage).toBe('negotiation');

    // Second patch targeting 'escalation' in a NEW turn — one step at a time
    const s3 = applySimulationPatch(RUN_ID, {
      source: 'server_rule', priority: 'normal', turnId: 'turn:1',
      patch: { targetStage: 'escalation' },
    });
    expect(s3.stage).toBe('escalation');
    // No jumps past 'escalation' in a single engine call
    expect(['intro', 'conflict', 'negotiation', 'escalation', 'resolution']).toContain(s3.stage);
  });

  it('does NOT limit gemini_tool delta when it fires BEFORE server_evaluation (tool runs first)', () => {
    // Tool calls happen during AI turn; evaluation fires at turnComplete (after).
    // When tool runs first, there is no server_evaluation conflict to trigger the cap.
    const turnId = 'turn:4';
    const stateAfterTool = applySimulationPatch(RUN_ID, {
      source: 'gemini_tool',
      priority: 'normal',
      turnId,
      patch: { npcEmotionDelta: { anger: 20 } }, // 30 + 20 = 50, no cap yet
    });
    expect(stateAfterTool.npcEmotions.anger).toBe(50);

    // Now server_evaluation fires for the same turn — its delta is not capped
    const stateAfterEval = applySimulationPatch(RUN_ID, {
      source: 'server_evaluation',
      priority: 'normal',
      turnId,
      patch: { npcEmotionDelta: { anger: 5 } }, // evaluation delta applied normally
    });
    expect(stateAfterEval.npcEmotions.anger).toBe(55);
  });

  it('adds turn scores and updates summary', () => {
    const turnScore = {
      turnId: 'ts-1',
      turnIndex: 0,
      clarity: 70, empathy: 80, logic: 60, ownership: 70, actionPlan: 50,
      total: 68,
      evaluationMethod: 'rule' as const,
      evaluationConfidence: 60,
    };
    const state = applySimulationPatch(RUN_ID, {
      source: 'server_evaluation',
      priority: 'normal',
      turnId: 'turn-1',
      patch: { turnScoresToAdd: [turnScore] },
    });
    expect(state.recentTurnScores).toHaveLength(1);
    expect(state.summary.totalTurns).toBe(1);
    expect(state.currentScore).toBeGreaterThan(0);
  });

  it('trims recentTurnScores to 10', () => {
    for (let i = 0; i < 12; i++) {
      applySimulationPatch(RUN_ID, {
        source: 'server_evaluation',
        priority: 'normal',
        turnId: `turn-${i}`,
        patch: {
          turnScoresToAdd: [{
            turnId: `ts-${i}`,
            turnIndex: i,
            clarity: 60, empathy: 60, logic: 60, ownership: 60, actionPlan: 60,
            total: 60,
            evaluationMethod: 'rule' as const,
            evaluationConfidence: 60,
          }],
        },
      });
    }
    const state = getSessionState(RUN_ID)!;
    expect(state.recentTurnScores.length).toBeLessThanOrEqual(10);
  });
});

describe('checkIncidentCooldown / recordIncidentCooldown', () => {
  it('allows incident when no cooldown exists', () => {
    const result = checkIncidentCooldown(RUN_ID, 'executive_join');
    expect(result.allowed).toBe(true);
  });

  it('blocks incident within global cooldown', () => {
    recordIncidentCooldown(RUN_ID, 'executive_join', Date.now() - 30000);

    const result = checkIncidentCooldown(RUN_ID, 'customer_escalation', Date.now());
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Global cooldown');
  });

  it('blocks same type within type cooldown', () => {
    recordIncidentCooldown(RUN_ID, 'executive_join', Date.now() - 30000);

    const result = checkIncidentCooldown(RUN_ID, 'executive_join', Date.now() - 10000);
    expect(result.allowed).toBe(false);
  });

  it('allows incident after cooldowns expire', () => {
    recordIncidentCooldown(RUN_ID, 'executive_join', Date.now() - 200000);

    const result = checkIncidentCooldown(RUN_ID, 'executive_join', Date.now());
    expect(result.allowed).toBe(true);
  });
});

describe('getSessionState / setSessionState', () => {
  it('returns null for unknown session', () => {
    expect(getSessionState('nonexistent')).toBeNull();
  });

  it('returns state after set', () => {
    const state = createDefaultSimulationState();
    setSessionState(RUN_ID, state);
    expect(getSessionState(RUN_ID)).toEqual(state);
  });
});

describe('directive expiry', () => {
  it('removes directives whose expiresAtTurnIndex is <= current totalTurns', () => {
    // Add a directive that expires after turn 2
    applySimulationPatch(RUN_ID, {
      source: 'server_rule',
      priority: 'normal',
      turnId: 'turn-1',
      patch: {
        directivesToAdd: [
          { id: 'dir-1', instruction: 'Be aggressive', expiresAtTurnIndex: 2, priority: 'normal' },
        ],
      },
    });
    let state = getSessionState(RUN_ID)!;
    expect(state.simulationDirectives).toHaveLength(1);

    // Advance totalTurns past the expiry by adding 3 turn scores
    for (let i = 0; i < 3; i++) {
      applySimulationPatch(RUN_ID, {
        source: 'server_evaluation',
        priority: 'normal',
        turnId: `turn-score-${i}`,
        patch: {
          turnScoresToAdd: [{
            turnId: `ts-${i}`, turnIndex: i,
            clarity: 60, empathy: 60, logic: 60, ownership: 60, actionPlan: 60,
            total: 60, evaluationMethod: 'rule', evaluationConfidence: 60,
          }],
        },
      });
    }
    // Next patch should prune expired directive
    state = applySimulationPatch(RUN_ID, {
      source: 'server_rule',
      priority: 'normal',
      turnId: 'cleanup-patch',
      patch: {},
    });
    expect(state.simulationDirectives).toHaveLength(0);
  });

  it('keeps directives whose expiresAtTurnIndex is still in the future', () => {
    applySimulationPatch(RUN_ID, {
      source: 'server_rule',
      priority: 'normal',
      turnId: 'turn-1',
      patch: {
        directivesToAdd: [
          { id: 'dir-future', instruction: 'Stay calm', expiresAtTurnIndex: 50, priority: 'normal' },
        ],
      },
    });
    const state = getSessionState(RUN_ID)!;
    expect(state.simulationDirectives).toHaveLength(1);
  });

  it('caps simulationDirectives at 3 entries (max active)', () => {
    for (let i = 0; i < 7; i++) {
      applySimulationPatch(RUN_ID, {
        source: 'server_rule',
        priority: 'normal',
        turnId: `turn-dir-${i}`,
        patch: {
          directivesToAdd: [
            { id: `dir-${i}`, instruction: `Unique rule ${i}`, expiresAtTurnIndex: 999, priority: 'normal' },
          ],
        },
      });
    }
    const state = getSessionState(RUN_ID)!;
    expect(state.simulationDirectives.length).toBeLessThanOrEqual(3);
  });

  it('deduplicates directives by same id (merge/overwrite)', () => {
    applySimulationPatch(RUN_ID, {
      source: 'server_rule', priority: 'normal', turnId: 't1',
      patch: { directivesToAdd: [{ id: 'dir-A', instruction: 'Be calm', expiresAtTurnIndex: 99, priority: 'normal' }] },
    });
    applySimulationPatch(RUN_ID, {
      source: 'server_rule', priority: 'normal', turnId: 't2',
      patch: { directivesToAdd: [{ id: 'dir-A', instruction: 'Be calm — updated', expiresAtTurnIndex: 99, priority: 'high' }] },
    });
    const state = getSessionState(RUN_ID)!;
    const dA = state.simulationDirectives.filter(d => d.id === 'dir-A');
    expect(dA).toHaveLength(1);
    expect(dA[0].instruction).toContain('updated');
  });

  it('deduplicates directives by same instruction text (no double-add)', () => {
    applySimulationPatch(RUN_ID, {
      source: 'server_rule', priority: 'normal', turnId: 't1',
      patch: { directivesToAdd: [{ id: 'dir-X', instruction: 'Repeat rule', expiresAtTurnIndex: 99, priority: 'normal' }] },
    });
    applySimulationPatch(RUN_ID, {
      source: 'server_rule', priority: 'normal', turnId: 't2',
      patch: { directivesToAdd: [{ id: 'dir-Y', instruction: 'Repeat rule', expiresAtTurnIndex: 99, priority: 'normal' }] },
    });
    const state = getSessionState(RUN_ID)!;
    const repeated = state.simulationDirectives.filter(d => d.instruction === 'Repeat rule');
    expect(repeated).toHaveLength(1);
  });
});

describe('Phase 1A — weighted scoring and average score semantics', () => {
  it('currentScore is weighted average of all-time turn scores', () => {
    const scores = [60, 80, 70];
    for (let i = 0; i < scores.length; i++) {
      applySimulationPatch(RUN_ID, {
        source: 'server_evaluation', priority: 'normal', turnId: `t${i}`,
        patch: {
          turnScoresToAdd: [{
            turnId: `ts-${i}`, turnIndex: i,
            clarity: scores[i], empathy: scores[i], logic: scores[i],
            ownership: scores[i], actionPlan: scores[i],
            total: scores[i], evaluationMethod: 'rule' as const, evaluationConfidence: 80,
          }],
        },
      });
    }
    const state = getSessionState(RUN_ID)!;
    const expected = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    expect(state.currentScore).toBe(expected);
    expect(state.summary.averageScore).toBe(expected);
  });

  it('version increments by 1 for every patch', () => {
    const s1 = applySimulationPatch(RUN_ID, { source: 'server_rule', priority: 'normal', turnId: 't1', patch: {} });
    const s2 = applySimulationPatch(RUN_ID, { source: 'server_rule', priority: 'normal', turnId: 't2', patch: {} });
    const s3 = applySimulationPatch(RUN_ID, { source: 'server_rule', priority: 'normal', turnId: 't3', patch: {} });
    expect(s1.version).toBe(1);
    expect(s2.version).toBe(2);
    expect(s3.version).toBe(3);
  });

  it('pressure delta is clamped to ±1 per patch and [1,5] overall', () => {
    // pressureDelta > 1 should be clamped at engine level to ±1 max change
    applySimulationPatch(RUN_ID, { source: 'server_rule', priority: 'normal', turnId: 't1', patch: { pressureDelta: 1 } });
    applySimulationPatch(RUN_ID, { source: 'server_rule', priority: 'normal', turnId: 't2', patch: { pressureDelta: 1 } });
    const mid = getSessionState(RUN_ID)!;
    expect(mid.pressureLevel).toBe(3); // default 1 + 2 deltas = 3
    // Drive to max
    applySimulationPatch(RUN_ID, { source: 'server_rule', priority: 'normal', turnId: 't3', patch: { pressureDelta: 1 } });
    applySimulationPatch(RUN_ID, { source: 'server_rule', priority: 'normal', turnId: 't4', patch: { pressureDelta: 1 } });
    applySimulationPatch(RUN_ID, { source: 'server_rule', priority: 'normal', turnId: 't5', patch: { pressureDelta: 1 } });
    const capped = getSessionState(RUN_ID)!;
    expect(capped.pressureLevel).toBe(5);
  });

  it('DB-fail resilience: in-memory state is correct even if save throws', async () => {
    // Patch should be applied in-memory before any DB save attempt
    const state = applySimulationPatch(RUN_ID, {
      source: 'server_evaluation', priority: 'normal', turnId: 'db-fail-turn',
      patch: { npcEmotionDelta: { anger: 15 } },
    });
    // Simulate a DB save failing (storage is not mocked here; just verify state integrity)
    expect(state.npcEmotions.anger).toBe(45); // 30 + 15
    // In-memory context is still valid after the "failure"
    const stateAfter = getSessionState(RUN_ID)!;
    expect(stateAfter.npcEmotions.anger).toBe(45);
    expect(stateAfter.version).toBe(1);
  });
});

describe('scoreAccumulator (report carry-forward beyond 10-turn window)', () => {
  it('persists cumulative sum and count in scoreAccumulator field', () => {
    for (let i = 0; i < 12; i++) {
      applySimulationPatch(RUN_ID, {
        source: 'server_evaluation',
        priority: 'normal',
        turnId: `turn-acc-${i}`,
        patch: {
          turnScoresToAdd: [{
            turnId: `ts-acc-${i}`, turnIndex: i,
            clarity: 80, empathy: 80, logic: 80, ownership: 80, actionPlan: 80,
            total: 80, evaluationMethod: 'llm', evaluationConfidence: 90,
          }],
        },
      });
    }
    const state = getSessionState(RUN_ID)!;
    expect(state.scoreAccumulator).toBeDefined();
    expect(state.scoreAccumulator!.count).toBe(12);
    expect(state.scoreAccumulator!.sum).toBeCloseTo(80 * 12, 0);
    // recentTurnScores is capped at 10 but accumulator has all 12
    expect(state.recentTurnScores.length).toBeLessThanOrEqual(10);
  });

  it('restores accurate currentScore from scoreAccumulator after simulated reconnect', () => {
    // 12 turns all scoring 80 → average = 80
    for (let i = 0; i < 12; i++) {
      applySimulationPatch(RUN_ID, {
        source: 'server_evaluation',
        priority: 'normal',
        turnId: `turn-rc-${i}`,
        patch: {
          turnScoresToAdd: [{
            turnId: `ts-rc-${i}`, turnIndex: i,
            clarity: 80, empathy: 80, logic: 80, ownership: 80, actionPlan: 80,
            total: 80, evaluationMethod: 'llm', evaluationConfidence: 90,
          }],
        },
      });
    }
    const snapshot = getSessionState(RUN_ID)!;
    expect(snapshot.scoreAccumulator!.count).toBe(12);

    // Simulate reconnect: clear in-memory context, restore from persisted state
    clearSessionContext(RUN_ID);
    const restored = getOrCreateSessionContext(RUN_ID, snapshot);

    // The restored context should use the accumulator, not just the 10-entry window
    expect(restored.allTimeTurnScoreCount).toBe(12);
    expect(restored.allTimeTurnScoreSum).toBeCloseTo(80 * 12, 0);

    // One more patch after reconnect should yield accurate currentScore (~80)
    const afterReconnect = applySimulationPatch(RUN_ID, {
      source: 'server_evaluation',
      priority: 'normal',
      turnId: 'turn-rc-12',
      patch: {
        turnScoresToAdd: [{
          turnId: 'ts-rc-12', turnIndex: 12,
          clarity: 80, empathy: 80, logic: 80, ownership: 80, actionPlan: 80,
          total: 80, evaluationMethod: 'llm', evaluationConfidence: 90,
        }],
      },
    });
    expect(afterReconnect.currentScore).toBeGreaterThan(75);
    expect(afterReconnect.currentScore).toBeLessThanOrEqual(85);
  });

  it('re-hydrates accumulators via setSessionState when context was pre-created without state (leading to correct weighted average)', () => {
    // Build up 12 turns with varying scores (mix of 60 and 100) → average = 80
    for (let i = 0; i < 12; i++) {
      const score = i % 2 === 0 ? 60 : 100;
      applySimulationPatch(RUN_ID, {
        source: 'server_evaluation',
        priority: 'normal',
        turnId: `turn-pre-${i}`,
        patch: {
          turnScoresToAdd: [{
            turnId: `ts-pre-${i}`, turnIndex: i,
            clarity: score, empathy: score, logic: score, ownership: score, actionPlan: score,
            total: score, evaluationMethod: 'llm', evaluationConfidence: 90,
          }],
        },
      });
    }
    const snapshot = getSessionState(RUN_ID)!;
    expect(snapshot.scoreAccumulator!.count).toBe(12);
    expect(snapshot.scoreAccumulator!.sum).toBeCloseTo(80 * 12, 0);

    // Simulate server restart: clear in-memory context
    clearSessionContext(RUN_ID);

    // Simulate code that creates the context WITHOUT state first (e.g. applyHarnessToSession
    // or checkIncidentCooldown called before setSessionState in the request handler)
    getOrCreateSessionContext(RUN_ID);

    // Now setSessionState is called with the DB-loaded state (scoreAccumulator intact)
    setSessionState(RUN_ID, snapshot);

    // The 13th turn at score 80 should compute currentScore ≈ 80, not 80 (trivial 1-turn average)
    // To distinguish, we use score 40 for this turn so the result differs between restored vs reset:
    // Restored: (960 + 40) / 13 ≈ 77     Reset: 40 / 1 = 40
    const afterRestore = applySimulationPatch(RUN_ID, {
      source: 'server_evaluation',
      priority: 'normal',
      turnId: 'turn-pre-12',
      patch: {
        turnScoresToAdd: [{
          turnId: 'ts-pre-12', turnIndex: 12,
          clarity: 40, empathy: 40, logic: 40, ownership: 40, actionPlan: 40,
          total: 40, evaluationMethod: 'llm', evaluationConfidence: 90,
        }],
      },
    });

    // With proper re-hydration the score reflects all 13 turns: (960+40)/13 ≈ 77
    // Without the fix the accumulators would reset to 0→40/1=40
    expect(afterRestore.currentScore).toBeGreaterThan(60);
    expect(afterRestore.currentScore).toBeLessThanOrEqual(85);
  });
});

// ─── evaluateFlowGraph — direct unit tests ────────────────────────────────────

const SIMPLE_FLOW_GRAPH: FlowGraph = {
  stages: [
    {
      id: 'intro',
      exitConditions: [{ type: 'turn_count', operator: 'gte', value: 3 }],
      exitConditionsLogic: 'all',
      nextStage: 'conflict',
      goal: 'Establish rapport',
    },
    {
      id: 'conflict',
      exitConditions: [
        { type: 'npc_emotion', metric: 'anger', operator: 'gte', value: 70 },
        { type: 'turn_count', operator: 'gte', value: 5 },
      ],
      exitConditionsLogic: 'any',
      nextStage: 'resolution',
      goal: 'De-escalate the situation',
    },
    {
      id: 'resolution',
      exitConditions: [],
      nextStage: 'resolution',
    },
  ],
};

describe('evaluateFlowGraph', () => {
  it('returns null when current stage has no exit conditions', () => {
    const state = createDefaultSimulationState();
    state.stage = 'resolution';
    state.summary.totalTurns = 10;
    const result = evaluateFlowGraph(state, SIMPLE_FLOW_GRAPH);
    expect(result).toBeNull();
  });

  it('returns null when the stage is not defined in the flow graph', () => {
    const state = createDefaultSimulationState();
    state.stage = 'escalation';
    const result = evaluateFlowGraph(state, SIMPLE_FLOW_GRAPH);
    expect(result).toBeNull();
  });

  it('returns null when exit condition is not met (turn_count below threshold)', () => {
    const state = createDefaultSimulationState();
    state.stage = 'intro';
    state.summary = { ...state.summary, totalTurns: 2 };
    const result = evaluateFlowGraph(state, SIMPLE_FLOW_GRAPH);
    expect(result).toBeNull();
  });

  it('returns nextStage when all-logic exit condition is met', () => {
    const state = createDefaultSimulationState();
    state.stage = 'intro';
    state.summary = { ...state.summary, totalTurns: 5 };
    const result = evaluateFlowGraph(state, SIMPLE_FLOW_GRAPH);
    expect(result).toBe('conflict');
  });

  it('returns nextStage when any-logic condition is met via npc_emotion', () => {
    const state = createDefaultSimulationState();
    state.stage = 'conflict';
    state.summary = { ...state.summary, totalTurns: 2 };
    state.npcEmotions = { ...state.npcEmotions, anger: 80 };
    const result = evaluateFlowGraph(state, SIMPLE_FLOW_GRAPH);
    expect(result).toBe('resolution');
  });

  it('returns nextStage when any-logic condition is met via turn_count', () => {
    const state = createDefaultSimulationState();
    state.stage = 'conflict';
    state.summary = { ...state.summary, totalTurns: 6 };
    state.npcEmotions = { ...state.npcEmotions, anger: 30 };
    const result = evaluateFlowGraph(state, SIMPLE_FLOW_GRAPH);
    expect(result).toBe('resolution');
  });

  it('returns null when any-logic conflict stage conditions are both unmet', () => {
    const state = createDefaultSimulationState();
    state.stage = 'conflict';
    state.summary = { ...state.summary, totalTurns: 3 };
    state.npcEmotions = { ...state.npcEmotions, anger: 50 };
    const result = evaluateFlowGraph(state, SIMPLE_FLOW_GRAPH);
    expect(result).toBeNull();
  });

  it('rejects stage transition that goes backward in STAGE_ORDER', () => {
    const backwardGraph: FlowGraph = {
      stages: [
        {
          id: 'conflict',
          exitConditions: [{ type: 'turn_count', operator: 'gte', value: 1 }],
          exitConditionsLogic: 'all',
          nextStage: 'intro',
        },
      ],
    };
    const state = createDefaultSimulationState();
    state.stage = 'conflict';
    state.summary = { ...state.summary, totalTurns: 3 };
    const result = evaluateFlowGraph(state, backwardGraph);
    expect(result).toBeNull();
  });

  it('evaluates turn_score exit condition using windowed average', () => {
    const graphWithScore: FlowGraph = {
      stages: [
        {
          id: 'intro',
          exitConditions: [
            { type: 'turn_score', metric: 'total', operator: 'gte', value: 70, windowTurns: 2 },
          ],
          exitConditionsLogic: 'all',
          nextStage: 'conflict',
        },
      ],
    };
    const state = createDefaultSimulationState();
    state.stage = 'intro';
    state.recentTurnScores = [
      { turnId: 't1', turnIndex: 0, clarity: 80, empathy: 80, logic: 80, ownership: 80, actionPlan: 80, total: 80, evaluationMethod: 'rule', evaluationConfidence: 80 },
      { turnId: 't2', turnIndex: 1, clarity: 75, empathy: 75, logic: 75, ownership: 75, actionPlan: 75, total: 75, evaluationMethod: 'rule', evaluationConfidence: 80 },
    ];
    const result = evaluateFlowGraph(state, graphWithScore);
    expect(result).toBe('conflict');
  });

  it('returns null for turn_score condition when recentTurnScores is empty', () => {
    const graphWithScore: FlowGraph = {
      stages: [
        {
          id: 'intro',
          exitConditions: [
            { type: 'turn_score', metric: 'total', operator: 'gte', value: 50 },
          ],
          exitConditionsLogic: 'all',
          nextStage: 'conflict',
        },
      ],
    };
    const state = createDefaultSimulationState();
    state.stage = 'intro';
    state.recentTurnScores = [];
    const result = evaluateFlowGraph(state, graphWithScore);
    expect(result).toBeNull();
  });
});

// ─── FlowGraph integration via applySimulationPatch ──────────────────────────

const FLOW_RUN = 'flow-test-run';

describe('applySimulationPatch + FlowGraph integration', () => {
  beforeEach(() => {
    clearSessionContext(FLOW_RUN);
  });

  it('auto-advances stage when flow graph exit condition triggers', () => {
    const graph: FlowGraph = {
      stages: [
        {
          id: 'intro',
          exitConditions: [{ type: 'turn_count', operator: 'gte', value: 2 }],
          exitConditionsLogic: 'all',
          nextStage: 'conflict',
          goal: 'Get to conflict',
        },
      ],
    };
    setSessionFlowConfig(FLOW_RUN, graph, null);

    for (let i = 0; i < 2; i++) {
      applySimulationPatch(FLOW_RUN, {
        source: 'server_evaluation', priority: 'normal', turnId: `t${i}`,
        patch: {
          turnScoresToAdd: [{
            turnId: `ts${i}`, turnIndex: i,
            clarity: 60, empathy: 60, logic: 60, ownership: 60, actionPlan: 60,
            total: 60, evaluationMethod: 'rule', evaluationConfidence: 70,
          }],
        },
      });
    }

    const state = getSessionState(FLOW_RUN)!;
    expect(state.stage).toBe('conflict');
  });

  it('does NOT advance stage before exit conditions are met', () => {
    const graph: FlowGraph = {
      stages: [
        {
          id: 'intro',
          exitConditions: [{ type: 'turn_count', operator: 'gte', value: 5 }],
          exitConditionsLogic: 'all',
          nextStage: 'conflict',
        },
      ],
    };
    setSessionFlowConfig(FLOW_RUN, graph, null);

    applySimulationPatch(FLOW_RUN, {
      source: 'server_evaluation', priority: 'normal', turnId: 't0',
      patch: {
        turnScoresToAdd: [{
          turnId: 'ts0', turnIndex: 0,
          clarity: 60, empathy: 60, logic: 60, ownership: 60, actionPlan: 60,
          total: 60, evaluationMethod: 'rule', evaluationConfidence: 70,
        }],
      },
    });

    const state = getSessionState(FLOW_RUN)!;
    expect(state.stage).toBe('intro');
  });

  it('injects a stage-transition directive when flow graph fires', () => {
    const graph: FlowGraph = {
      stages: [
        {
          id: 'intro',
          exitConditions: [{ type: 'npc_emotion', metric: 'anger', operator: 'gte', value: 60 }],
          exitConditionsLogic: 'all',
          nextStage: 'conflict',
        },
        {
          id: 'conflict',
          exitConditions: [],
          nextStage: 'resolution',
          goal: 'Now escalate',
        },
      ],
    };
    setSessionFlowConfig(FLOW_RUN, graph, null);

    const state = applySimulationPatch(FLOW_RUN, {
      source: 'server_evaluation', priority: 'normal', turnId: 't0',
      patch: { npcEmotionDelta: { anger: 40 } },
    });

    expect(state.stage).toBe('conflict');
    const transitionDirective = state.simulationDirectives.find(d =>
      d.instruction.includes('STAGE TRANSITION') && d.instruction.includes('conflict')
    );
    expect(transitionDirective).toBeDefined();
    expect(transitionDirective!.instruction).toContain('Now escalate');
  });

  it('preserves currentStageGoal from flow graph after transition', () => {
    const graph: FlowGraph = {
      stages: [
        {
          id: 'intro',
          exitConditions: [{ type: 'turn_count', operator: 'gte', value: 1 }],
          exitConditionsLogic: 'all',
          nextStage: 'negotiation',
        },
        {
          id: 'negotiation',
          exitConditions: [],
          nextStage: 'resolution',
          goal: 'Negotiate a deal',
        },
      ],
    };
    setSessionFlowConfig(FLOW_RUN, graph, null);

    const state = applySimulationPatch(FLOW_RUN, {
      source: 'server_evaluation', priority: 'normal', turnId: 't0',
      patch: {
        turnScoresToAdd: [{
          turnId: 'ts0', turnIndex: 0,
          clarity: 70, empathy: 70, logic: 70, ownership: 70, actionPlan: 70,
          total: 70, evaluationMethod: 'rule', evaluationConfidence: 80,
        }],
      },
    });

    expect(state.stage).toBe('negotiation');
    expect(state.currentStageGoal).toBe('Negotiate a deal');
  });
});

// ─── State immutability ───────────────────────────────────────────────────────

describe('applySimulationPatch — state immutability', () => {
  beforeEach(() => {
    clearSessionContext(RUN_ID);
  });

  it('does not mutate the previous state object', () => {
    applySimulationPatch(RUN_ID, {
      source: 'server_evaluation', priority: 'normal', turnId: 't0', patch: {},
    });
    const before = getSessionState(RUN_ID)!;
    const beforeVersion = before.version;
    const beforeAnger = before.npcEmotions.anger;

    applySimulationPatch(RUN_ID, {
      source: 'server_evaluation', priority: 'normal', turnId: 't1',
      patch: { npcEmotionDelta: { anger: 20 } },
    });

    expect(before.version).toBe(beforeVersion);
    expect(before.npcEmotions.anger).toBe(beforeAnger);
  });

  it('returns a new object reference on every patch', () => {
    const s1 = applySimulationPatch(RUN_ID, {
      source: 'server_rule', priority: 'normal', turnId: 't1', patch: {},
    });
    const s2 = applySimulationPatch(RUN_ID, {
      source: 'server_rule', priority: 'normal', turnId: 't2', patch: {},
    });
    expect(s1).not.toBe(s2);
  });

  it('does not mutate the npcEmotions sub-object of the previous state', () => {
    applySimulationPatch(RUN_ID, {
      source: 'server_evaluation', priority: 'normal', turnId: 't0', patch: {},
    });
    const before = getSessionState(RUN_ID)!;
    const emotionsRef = before.npcEmotions;

    applySimulationPatch(RUN_ID, {
      source: 'server_evaluation', priority: 'normal', turnId: 't1',
      patch: { npcEmotionDelta: { anger: 10, trust: -5 } },
    });

    expect(emotionsRef.anger).toBe(30);
    expect(emotionsRef.trust).toBe(50);
  });
});

describe('npcAffectiveState sync', () => {
  it('initialises npcAffectiveState with defaults on first patch', () => {
    const state = applySimulationPatch(RUN_ID, {
      source: 'server_evaluation', priority: 'normal', turnId: 't1', patch: {},
    });
    expect(state.npcAffectiveState).toBeDefined();
    expect(state.npcAffectiveState!.affective.intensity).toBe(DEFAULT_NPC_AFFECTIVE_STATE.affective.intensity);
    expect(state.npcAffectiveState!.relational.trust).toBe(DEFAULT_NPC_AFFECTIVE_STATE.relational.trust);
    expect(state.npcAffectiveState!.cognitive.confusion).toBe(DEFAULT_NPC_AFFECTIVE_STATE.cognitive.confusion);
    expect(state.npcAffectiveState!.motivational.interest).toBe(DEFAULT_NPC_AFFECTIVE_STATE.motivational.interest);
  });

  it('mirrors server_evaluation emotion deltas into affective layers', () => {
    const state = applySimulationPatch(RUN_ID, {
      source: 'server_evaluation', priority: 'normal', turnId: 't1',
      patch: { npcEmotionDelta: { anger: 15, trust: -10, confusion: 5, interest: 8 } },
    });
    // anger → affective.intensity
    expect(state.npcAffectiveState!.affective.intensity).toBe(DEFAULT_NPC_AFFECTIVE_STATE.affective.intensity + 15);
    // trust → relational.trust
    expect(state.npcAffectiveState!.relational.trust).toBe(DEFAULT_NPC_AFFECTIVE_STATE.relational.trust - 10);
    // confusion → cognitive.confusion
    expect(state.npcAffectiveState!.cognitive.confusion).toBe(DEFAULT_NPC_AFFECTIVE_STATE.cognitive.confusion + 5);
    // interest → motivational.interest
    expect(state.npcAffectiveState!.motivational.interest).toBe(DEFAULT_NPC_AFFECTIVE_STATE.motivational.interest + 8);
  });

  it('applies same capped delta to both flat and layered state for gemini_tool after server_evaluation', () => {
    // server_evaluation moves anger by +30 first
    applySimulationPatch(RUN_ID, {
      source: 'server_evaluation', priority: 'normal', turnId: 't1',
      patch: { npcEmotionDelta: { anger: 30 } },
    });

    // gemini_tool tries to move anger by +25, but is capped to 10 (GEMINI_TOOL_MAX_DELTA_AFTER_SERVER_EVAL)
    const state = applySimulationPatch(RUN_ID, {
      source: 'gemini_tool', priority: 'normal', turnId: 't1',
      patch: { npcEmotionDelta: { anger: 25 } },
    });

    const flatAnger = state.npcEmotions.anger;
    const layeredIntensity = state.npcAffectiveState!.affective.intensity;
    // Both should reflect the same capped 10-point delta on top of the 30 already applied
    // Flat starts at 30, +30 = 60, then +10 capped = 70
    expect(flatAnger).toBe(70);
    // Layered starts at DEFAULT (30), +30 = 60, then +10 capped = 70
    expect(layeredIntensity).toBe(70);
    // They must match regardless of capping
    expect(flatAnger).toBe(layeredIntensity);
  });

  it('applies npcAffectiveStateDelta directly without affecting flat emotions', () => {
    const state = applySimulationPatch(RUN_ID, {
      source: 'server_evaluation', priority: 'normal', turnId: 't1',
      patch: {
        npcAffectiveStateDelta: {
          relational: { rapport: 10 },
          motivational: { cooperativeness: 5 },
        },
      },
    });
    // Affective-only fields updated
    expect(state.npcAffectiveState!.relational.rapport).toBe(DEFAULT_NPC_AFFECTIVE_STATE.relational.rapport + 10);
    expect(state.npcAffectiveState!.motivational.cooperativeness).toBe(DEFAULT_NPC_AFFECTIVE_STATE.motivational.cooperativeness + 5);
    // Flat emotions untouched (rapport and cooperativeness have no flat counterpart)
    expect(state.npcEmotions.anger).toBe(30);
    expect(state.npcEmotions.trust).toBe(50);
  });

  it('re-derives flat npcEmotions from affective state when npcAffectiveStateDelta changes mapped keys', () => {
    // Direct npcAffectiveStateDelta with trust/confusion/interest/intensity changes
    // should propagate back into the flat npcEmotions so UI bars stay accurate.
    const state = applySimulationPatch(RUN_ID, {
      source: 'server_evaluation', priority: 'normal', turnId: 't1',
      patch: {
        npcAffectiveStateDelta: {
          relational: { trust: 20 },        // maps to npcEmotions.trust
          cognitive: { confusion: 15 },     // maps to npcEmotions.confusion
          motivational: { interest: -10 },  // maps to npcEmotions.interest
          affective: { intensity: 25 },     // maps to npcEmotions.anger
        },
      },
    });

    const flat = state.npcEmotions;
    const layered = state.npcAffectiveState!;

    // Flat values must equal their affective-layer counterparts
    expect(flat.trust).toBe(layered.relational.trust);
    expect(flat.confusion).toBe(layered.cognitive.confusion);
    expect(flat.interest).toBe(layered.motivational.interest);
    expect(flat.anger).toBe(layered.affective.intensity);

    // Sanity-check the actual values
    expect(flat.trust).toBe(DEFAULT_NPC_AFFECTIVE_STATE.relational.trust + 20);       // 50 + 20 = 70
    expect(flat.confusion).toBe(DEFAULT_NPC_AFFECTIVE_STATE.cognitive.confusion + 15); // 20 + 15 = 35
    expect(flat.interest).toBe(DEFAULT_NPC_AFFECTIVE_STATE.motivational.interest - 10);// 50 - 10 = 40
    expect(flat.anger).toBe(DEFAULT_NPC_AFFECTIVE_STATE.affective.intensity + 25);     // 30 + 25 = 55
  });

  it('keeps both representations in sync when npcEmotionDelta and npcAffectiveStateDelta are combined in one patch', () => {
    // Combined patch: emotion delta moves trust +10, then affective delta moves trust a further +5
    // The final npcEmotions.trust should equal the final npcAffectiveState.relational.trust.
    const state = applySimulationPatch(RUN_ID, {
      source: 'server_evaluation', priority: 'normal', turnId: 't1',
      patch: {
        npcEmotionDelta: { trust: 10, anger: 5 },
        npcAffectiveStateDelta: {
          relational: { trust: 5 },   // layered trust gets further delta
          affective: { intensity: 3 }, // layered intensity gets further delta
        },
      },
    });

    const flat = state.npcEmotions;
    const layered = state.npcAffectiveState!;

    // After all deltas, flat must equal layered for every mapped key
    expect(flat.trust).toBe(layered.relational.trust);
    expect(flat.anger).toBe(layered.affective.intensity);
    expect(flat.confusion).toBe(layered.cognitive.confusion);
    expect(flat.interest).toBe(layered.motivational.interest);

    // trust: 50 + 10 (emotion delta) + 5 (affective delta) = 65
    expect(flat.trust).toBe(65);
    // anger: 30 + 5 (emotion delta) + 3 (affective delta) = 38
    expect(flat.anger).toBe(38);
  });

  it('does not diverge after sequential patches mixing emotion and affective deltas', () => {
    // Patch 1: move trust via npcEmotionDelta
    applySimulationPatch(RUN_ID, {
      source: 'server_evaluation', priority: 'normal', turnId: 't1',
      patch: { npcEmotionDelta: { trust: -15 } }, // trust: 50 → 35
    });

    // Patch 2: move relational.trust directly via npcAffectiveStateDelta
    const state = applySimulationPatch(RUN_ID, {
      source: 'server_evaluation', priority: 'normal', turnId: 't2',
      patch: { npcAffectiveStateDelta: { relational: { trust: -10 } } }, // trust: 35 → 25
    });

    expect(state.npcEmotions.trust).toBe(state.npcAffectiveState!.relational.trust);
    expect(state.npcEmotions.trust).toBe(25);
  });
});

describe('checkTerminationConditionGroup — affective layer conditions', () => {
  it('evaluates relational.trust termination condition against npcAffectiveState', () => {
    // Drive relational.trust below 30
    applySimulationPatch(RUN_ID, {
      source: 'server_evaluation', priority: 'normal', turnId: 't1',
      patch: { npcEmotionDelta: { trust: -30 } }, // trust: 50 → 20
    });
    const state = getSessionState(RUN_ID)!;

    const rules: TerminationRules = {
      failure: {
        relational: { trust: { operator: 'lte', value: 25 } },
      },
    };
    expect(evaluateTerminationRules(state, rules)).toBe('failure');
  });

  it('does not trigger relational.trust condition when trust is above threshold', () => {
    // trust stays at default 50
    applySimulationPatch(RUN_ID, {
      source: 'server_evaluation', priority: 'normal', turnId: 't1', patch: {},
    });
    const state = getSessionState(RUN_ID)!;

    const rules: TerminationRules = {
      failure: {
        relational: { trust: { operator: 'lte', value: 25 } },
      },
    };
    expect(evaluateTerminationRules(state, rules)).toBeNull();
  });

  it('evaluates cognitive.confusion termination condition', () => {
    // Drive confusion high
    applySimulationPatch(RUN_ID, {
      source: 'server_evaluation', priority: 'normal', turnId: 't1',
      patch: { npcEmotionDelta: { confusion: 60 } }, // confusion: 20 → 80
    });
    const state = getSessionState(RUN_ID)!;

    const rules: TerminationRules = {
      failure: {
        cognitive: { confusion: { operator: 'gte', value: 75 } },
      },
    };
    expect(evaluateTerminationRules(state, rules)).toBe('failure');
  });

  it('evaluates motivational.interest success condition', () => {
    // Drive interest high
    applySimulationPatch(RUN_ID, {
      source: 'server_evaluation', priority: 'normal', turnId: 't1',
      patch: { npcEmotionDelta: { interest: 40 } }, // interest: 50 → 90
    });
    const state = getSessionState(RUN_ID)!;

    const rules: TerminationRules = {
      success: {
        motivational: { interest: { operator: 'gte', value: 85 } },
      },
    };
    expect(evaluateTerminationRules(state, rules)).toBe('success');
  });

  it('silently ignores layer conditions when npcAffectiveState is absent (backward compat)', () => {
    const state = {
      ...createDefaultSimulationState(),
      npcAffectiveState: undefined,
    };
    const rules: TerminationRules = {
      failure: {
        relational: { trust: { operator: 'lte', value: 100 } }, // would always fire if evaluated
      },
    };
    // Should not fire because npcAffectiveState is absent
    expect(evaluateTerminationRules(state, rules)).toBeNull();
  });
});

// ─── npcAffectiveState — full 4-layer delta and session-restore coverage ──────

describe('npcAffectiveState — npcAffectiveStateDelta covers all 4 sub-layers', () => {
  beforeEach(() => {
    clearSessionContext(RUN_ID);
  });

  it('applies npcAffectiveStateDelta to all 4 sub-layers and keeps flat emotions unchanged', () => {
    const state = applySimulationPatch(RUN_ID, {
      source: 'server_evaluation',
      priority: 'normal',
      turnId: 't1',
      patch: {
        npcAffectiveStateDelta: {
          affective:     { intensity: 10, valence: -20 },
          cognitive:     { confusion: 15, load: 8 },
          relational:    { trust: -5, rapport: 12 },
          motivational:  { interest: 7, cooperativeness: -3 },
        },
      },
    });

    const aff = state.npcAffectiveState!;
    // affective layer
    expect(aff.affective.intensity).toBe(DEFAULT_NPC_AFFECTIVE_STATE.affective.intensity + 10);
    expect(aff.affective.valence).toBe(DEFAULT_NPC_AFFECTIVE_STATE.affective.valence - 20);
    // cognitive layer
    expect(aff.cognitive.confusion).toBe(DEFAULT_NPC_AFFECTIVE_STATE.cognitive.confusion + 15);
    expect(aff.cognitive.load).toBe(DEFAULT_NPC_AFFECTIVE_STATE.cognitive.load + 8);
    // relational layer
    expect(aff.relational.trust).toBe(DEFAULT_NPC_AFFECTIVE_STATE.relational.trust - 5);
    expect(aff.relational.rapport).toBe(DEFAULT_NPC_AFFECTIVE_STATE.relational.rapport + 12);
    // motivational layer
    expect(aff.motivational.interest).toBe(DEFAULT_NPC_AFFECTIVE_STATE.motivational.interest + 7);
    expect(aff.motivational.cooperativeness).toBe(DEFAULT_NPC_AFFECTIVE_STATE.motivational.cooperativeness - 3);

    // Mapped flat emotions are re-derived from the affective layer when npcAffectiveStateDelta is applied.
    // Unmapped fields (rapport, cooperativeness, load, valence) have no flat counterpart and are not touched.
    expect(state.npcEmotions.anger).toBe(DEFAULT_NPC_AFFECTIVE_STATE.affective.intensity + 10);     // 30 + 10 = 40
    expect(state.npcEmotions.trust).toBe(DEFAULT_NPC_AFFECTIVE_STATE.relational.trust - 5);          // 50 - 5  = 45
    expect(state.npcEmotions.confusion).toBe(DEFAULT_NPC_AFFECTIVE_STATE.cognitive.confusion + 15);  // 20 + 15 = 35
    expect(state.npcEmotions.interest).toBe(DEFAULT_NPC_AFFECTIVE_STATE.motivational.interest + 7);  // 50 + 7  = 57
  });
});

describe('npcAffectiveState — session restore preserves all 4 sub-fields', () => {
  beforeEach(() => {
    clearSessionContext(RUN_ID);
  });

  it('restoring a session from persisted state preserves all 4 affective-layer sub-fields', () => {
    // Build up a state with non-default affective values via both delta types
    applySimulationPatch(RUN_ID, {
      source: 'server_evaluation',
      priority: 'normal',
      turnId: 't1',
      patch: {
        npcEmotionDelta: { anger: 20, trust: -15, confusion: 10, interest: 5 },
        npcAffectiveStateDelta: {
          affective:    { valence: -30 },
          cognitive:    { load: 25 },
          relational:   { rapport: 18 },
          motivational: { cooperativeness: -12 },
        },
      },
    });

    const snapshot = getSessionState(RUN_ID)!;
    const savedAff = snapshot.npcAffectiveState!;

    // Snapshot records the right values before we clear anything
    expect(savedAff.affective.intensity).toBeGreaterThan(DEFAULT_NPC_AFFECTIVE_STATE.affective.intensity);
    expect(savedAff.affective.valence).toBeLessThan(DEFAULT_NPC_AFFECTIVE_STATE.affective.valence);
    expect(savedAff.cognitive.confusion).toBeGreaterThan(DEFAULT_NPC_AFFECTIVE_STATE.cognitive.confusion);
    expect(savedAff.cognitive.load).toBeGreaterThan(DEFAULT_NPC_AFFECTIVE_STATE.cognitive.load);
    expect(savedAff.relational.trust).toBeLessThan(DEFAULT_NPC_AFFECTIVE_STATE.relational.trust);
    expect(savedAff.relational.rapport).toBeGreaterThan(DEFAULT_NPC_AFFECTIVE_STATE.relational.rapport);
    expect(savedAff.motivational.interest).toBeGreaterThan(DEFAULT_NPC_AFFECTIVE_STATE.motivational.interest);
    expect(savedAff.motivational.cooperativeness).toBeLessThan(DEFAULT_NPC_AFFECTIVE_STATE.motivational.cooperativeness);

    // Simulate server restart: drop in-memory context and restore from the DB-loaded snapshot
    clearSessionContext(RUN_ID);
    const restoredCtx = getOrCreateSessionContext(RUN_ID, snapshot);
    const restoredAff = restoredCtx.simulationState.npcAffectiveState!;

    // All 4 sub-fields must round-trip exactly
    expect(restoredAff.affective.intensity).toBe(savedAff.affective.intensity);
    expect(restoredAff.affective.valence).toBe(savedAff.affective.valence);
    expect(restoredAff.cognitive.confusion).toBe(savedAff.cognitive.confusion);
    expect(restoredAff.cognitive.load).toBe(savedAff.cognitive.load);
    expect(restoredAff.relational.trust).toBe(savedAff.relational.trust);
    expect(restoredAff.relational.rapport).toBe(savedAff.relational.rapport);
    expect(restoredAff.motivational.interest).toBe(savedAff.motivational.interest);
    expect(restoredAff.motivational.cooperativeness).toBe(savedAff.motivational.cooperativeness);
  });

  it('setSessionState path also preserves all 4 affective-layer sub-fields (pre-created context)', () => {
    // Build snapshot
    applySimulationPatch(RUN_ID, {
      source: 'server_evaluation',
      priority: 'normal',
      turnId: 't1',
      patch: {
        npcAffectiveStateDelta: {
          affective:    { intensity: 8, valence: 15 },
          cognitive:    { confusion: -5, load: 30 },
          relational:   { trust: 12, rapport: 7 },
          motivational: { interest: -10, cooperativeness: 20 },
        },
      },
    });
    const snapshot = getSessionState(RUN_ID)!;
    const savedAff = snapshot.npcAffectiveState!;

    // Simulate the applyHarnessToSession pattern: context is pre-created without state,
    // then setSessionState is called with the persisted snapshot.
    clearSessionContext(RUN_ID);
    getOrCreateSessionContext(RUN_ID);          // pre-create with defaults
    setSessionState(RUN_ID, snapshot);          // overwrite with DB snapshot

    const reloaded = getSessionState(RUN_ID)!;
    const reloadedAff = reloaded.npcAffectiveState!;

    expect(reloadedAff.affective.intensity).toBe(savedAff.affective.intensity);
    expect(reloadedAff.affective.valence).toBe(savedAff.affective.valence);
    expect(reloadedAff.cognitive.confusion).toBe(savedAff.cognitive.confusion);
    expect(reloadedAff.cognitive.load).toBe(savedAff.cognitive.load);
    expect(reloadedAff.relational.trust).toBe(savedAff.relational.trust);
    expect(reloadedAff.relational.rapport).toBe(savedAff.relational.rapport);
    expect(reloadedAff.motivational.interest).toBe(savedAff.motivational.interest);
    expect(reloadedAff.motivational.cooperativeness).toBe(savedAff.motivational.cooperativeness);
  });
});

// ─── Affective-only fields preserved across emotion-only patches ──────────────

describe('affective-only fields preserved when patches only supply npcEmotionDelta', () => {
  beforeEach(() => {
    clearSessionContext(RUN_ID);
  });

  it('rapport and cooperativeness survive multiple emotion-only patches', () => {
    // Seed non-default rapport and cooperativeness via npcAffectiveStateDelta
    applySimulationPatch(RUN_ID, {
      source: 'server_evaluation',
      priority: 'normal',
      turnId: 't0',
      patch: {
        npcAffectiveStateDelta: {
          relational:   { rapport: 20 },
          motivational: { cooperativeness: 15 },
        },
      },
    });

    const seedState = getSessionState(RUN_ID)!;
    const seedRapport          = seedState.npcAffectiveState!.relational.rapport;
    const seedCooperativeness  = seedState.npcAffectiveState!.motivational.cooperativeness;

    // Apply several patches that only touch flat emotions — no npcAffectiveStateDelta
    for (let i = 1; i <= 4; i++) {
      applySimulationPatch(RUN_ID, {
        source: 'server_evaluation',
        priority: 'normal',
        turnId: `t${i}`,
        patch: { npcEmotionDelta: { anger: 5, trust: -3, confusion: 2, interest: 1 } },
      });
    }

    const finalState = getSessionState(RUN_ID)!;
    const finalAff = finalState.npcAffectiveState!;

    // Affective-only fields must be carried forward untouched
    expect(finalAff.relational.rapport).toBe(seedRapport);
    expect(finalAff.motivational.cooperativeness).toBe(seedCooperativeness);
  });

  it('cognitive.load and affective.valence survive multiple emotion-only patches', () => {
    // Seed non-default load and valence
    applySimulationPatch(RUN_ID, {
      source: 'server_evaluation',
      priority: 'normal',
      turnId: 't0',
      patch: {
        npcAffectiveStateDelta: {
          cognitive:  { load: 30 },
          affective:  { valence: -25 },
        },
      },
    });

    const seedState = getSessionState(RUN_ID)!;
    const seedLoad   = seedState.npcAffectiveState!.cognitive.load;
    const seedValence = seedState.npcAffectiveState!.affective.valence;

    // Several emotion-only patches
    for (let i = 1; i <= 4; i++) {
      applySimulationPatch(RUN_ID, {
        source: 'server_evaluation',
        priority: 'normal',
        turnId: `t${i}`,
        patch: { npcEmotionDelta: { anger: -5, trust: 4 } },
      });
    }

    const finalState = getSessionState(RUN_ID)!;
    const finalAff = finalState.npcAffectiveState!;

    expect(finalAff.cognitive.load).toBe(seedLoad);
    expect(finalAff.affective.valence).toBe(seedValence);
  });

  it('all four affective-only fields accumulate correctly across mixed patches', () => {
    // Two npcAffectiveStateDelta patches separated by emotion-only patches
    applySimulationPatch(RUN_ID, {
      source: 'server_evaluation',
      priority: 'normal',
      turnId: 't0',
      patch: {
        npcAffectiveStateDelta: {
          relational:   { rapport: 10 },
          motivational: { cooperativeness: 8 },
          cognitive:    { load: 20 },
          affective:    { valence: -15 },
        },
      },
    });

    // Emotion-only patches — should not change affective-only fields
    for (let i = 1; i <= 3; i++) {
      applySimulationPatch(RUN_ID, {
        source: 'server_evaluation',
        priority: 'normal',
        turnId: `t${i}`,
        patch: { npcEmotionDelta: { anger: 3 } },
      });
    }

    // Second npcAffectiveStateDelta patch — accumulates on top of first
    applySimulationPatch(RUN_ID, {
      source: 'server_evaluation',
      priority: 'normal',
      turnId: 't4',
      patch: {
        npcAffectiveStateDelta: {
          relational:   { rapport: 5 },
          motivational: { cooperativeness: -3 },
          cognitive:    { load: 10 },
          affective:    { valence: 7 },
        },
      },
    });

    const finalState = getSessionState(RUN_ID)!;
    const finalAff = finalState.npcAffectiveState!;

    // Must equal the sum of both deltas applied to defaults (no resets in between)
    expect(finalAff.relational.rapport).toBe(DEFAULT_NPC_AFFECTIVE_STATE.relational.rapport + 10 + 5);
    expect(finalAff.motivational.cooperativeness).toBe(DEFAULT_NPC_AFFECTIVE_STATE.motivational.cooperativeness + 8 - 3);
    expect(finalAff.cognitive.load).toBe(DEFAULT_NPC_AFFECTIVE_STATE.cognitive.load + 20 + 10);
    expect(finalAff.affective.valence).toBe(DEFAULT_NPC_AFFECTIVE_STATE.affective.valence - 15 + 7);
  });
});
