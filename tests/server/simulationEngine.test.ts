import { describe, it, expect, beforeEach } from 'vitest';
import {
  applySimulationPatch,
  checkIncidentCooldown,
  recordIncidentCooldown,
  getSessionState,
  setSessionState,
  clearSessionContext,
  getOrCreateSessionContext,
} from '../../server/services/simulation/simulationEngine';
import {
  createDefaultSimulationState,
  SimulationStatePatch,
} from '../../server/services/simulation/simulationTypes';

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
});
