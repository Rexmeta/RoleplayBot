/**
 * Integration tests: voice-session NPC state flows through npcAffectiveState
 *
 * Confirms that after the emotion migration:
 *  1. update_npc_affective_state tool calls produce npcAffectiveStateDelta patches
 *     (never npcEmotionDelta or direct npcEmotions writes)
 *  2. npcAffectiveState is the sole source of truth for NPC emotional state
 *  3. The evaluation path (applySimulationPatch with npcAffectiveStateDelta) updates
 *     npcAffectiveState correctly
 *  4. analyzeEmotion (emotionAnalyzer) only returns UI labels — no NPC state side effects
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  handleToolCall,
} from '../../../server/services/simulation/simulationToolHandler';
import {
  applySimulationPatch,
  getSessionState,
  clearSessionContext,
  getOrCreateSessionContext,
} from '../../../server/services/simulation/simulationEngine';
import {
  createDefaultSimulationState,
  DEFAULT_NPC_AFFECTIVE_STATE,
} from '../../../server/services/simulation/simulationTypes';
import {
  analyzeEmotion,
  analyzeUserEmotion,
  NEUTRAL_USER_AFFECT,
} from '../../../server/services/voice/emotionAnalyzer';

// ── helpers ────────────────────────────────────────────────────────────────

const RUN_ID = 'voice-affective-test-001';
const TURN_ID = 'turn:1';

const baseCtx = {
  personaRunId: RUN_ID,
  turnId: TURN_ID,
  turnIndex: 1,
  currentTurnIncidentFired: false,
  toolCallCountThisTurn: 0,
  emotionCallCountThisTurn: 0,
  language: 'en' as const,
};

beforeEach(() => {
  clearSessionContext(RUN_ID);
});

// ── 1. Tool routes through npcAffectiveStateDelta ──────────────────────────

describe('update_npc_affective_state tool — patch format', () => {
  it('returns success and a statePatch containing npcAffectiveStateDelta', () => {
    const result = handleToolCall('update_npc_affective_state', {
      intensityDelta: 10,
      reason: 'user was rude',
    }, baseCtx);

    expect(result.success).toBe(true);
    expect(result.statePatch).toBeDefined();
    // Must use the new affective delta key — never the old npcEmotionDelta
    expect(result.statePatch).toHaveProperty('npcAffectiveStateDelta');
    expect((result.statePatch as any).npcEmotionDelta).toBeUndefined();
  });

  it('npcAffectiveStateDelta contains the expected sub-layer keys for each delta type', () => {
    const result = handleToolCall('update_npc_affective_state', {
      intensityDelta: 5,
      valenceDelta: -3,
      confusionDelta: 8,
      trustDelta: -7,
      interestDelta: 4,
      reason: 'complex interaction',
    }, baseCtx);

    expect(result.success).toBe(true);
    const delta = result.statePatch?.npcAffectiveStateDelta!;
    expect(delta.affective?.intensity).toBe(5);
    expect(delta.affective?.valence).toBe(-3);
    expect(delta.cognitive?.confusion).toBe(8);
    expect(delta.relational?.trust).toBe(-7);
    expect(delta.motivational?.interest).toBe(4);
  });
});

// ── 2. npcAffectiveState is the sole source of truth ──────────────────────

describe('update_npc_affective_state tool — state mutation', () => {
  it('increments npcAffectiveState.affective.intensity by the delta', () => {
    const result = handleToolCall('update_npc_affective_state', {
      intensityDelta: 15,
      reason: 'escalation',
    }, baseCtx);

    expect(result.success).toBe(true);
    const state = result.currentState!;
    expect(state.npcAffectiveState.affective.intensity).toBe(
      DEFAULT_NPC_AFFECTIVE_STATE.affective.intensity + 15
    );
  });

  it('updates npcAffectiveState.affective.intensity with intensity delta', () => {
    const result = handleToolCall('update_npc_affective_state', {
      intensityDelta: 20,
      reason: 'customer upset',
    }, baseCtx);

    expect(result.success).toBe(true);
    const state = result.currentState!;
    expect(state.npcAffectiveState.affective.intensity).toBe(
      DEFAULT_NPC_AFFECTIVE_STATE.affective.intensity + 20
    );
  });

  it('updates npcAffectiveState.relational.trust with trust delta', () => {
    const result = handleToolCall('update_npc_affective_state', {
      trustDelta: -15,
      reason: 'broken promise',
    }, baseCtx);

    expect(result.success).toBe(true);
    const state = result.currentState!;
    expect(state.npcAffectiveState.relational.trust).toBe(
      DEFAULT_NPC_AFFECTIVE_STATE.relational.trust - 15
    );
  });

  it('updates npcAffectiveState.cognitive.confusion with confusion delta', () => {
    const result = handleToolCall('update_npc_affective_state', {
      confusionDelta: 12,
      reason: 'unclear policy',
    }, baseCtx);

    expect(result.success).toBe(true);
    const state = result.currentState!;
    expect(state.npcAffectiveState.cognitive.confusion).toBe(
      DEFAULT_NPC_AFFECTIVE_STATE.cognitive.confusion + 12
    );
  });

  it('updates npcAffectiveState.motivational.interest with interest delta', () => {
    const result = handleToolCall('update_npc_affective_state', {
      interestDelta: -8,
      reason: 'disengaged customer',
    }, baseCtx);

    expect(result.success).toBe(true);
    const state = result.currentState!;
    expect(state.npcAffectiveState.motivational.interest).toBe(
      DEFAULT_NPC_AFFECTIVE_STATE.motivational.interest - 8
    );
  });
});

// ── 3. Cumulative deltas accumulate in npcAffectiveState ──────────────────

describe('update_npc_affective_state tool — cumulative calls', () => {
  it('accumulates deltas across two calls in npcAffectiveState', () => {
    handleToolCall('update_npc_affective_state', {
      intensityDelta: 10,
      reason: 'first escalation',
    }, baseCtx);

    const result2 = handleToolCall('update_npc_affective_state', {
      intensityDelta: 10,
      reason: 'second escalation',
    }, { ...baseCtx, emotionCallCountThisTurn: 1 });

    expect(result2.success).toBe(true);
    const state = result2.currentState!;
    const expected = DEFAULT_NPC_AFFECTIVE_STATE.affective.intensity + 20;
    expect(state.npcAffectiveState.affective.intensity).toBe(expected);
  });

  it('session state reflects the latest npcAffectiveState after multiple patches', () => {
    // Apply two patches via the engine directly (simulating evaluation path)
    applySimulationPatch(RUN_ID, {
      source: 'server_evaluation',
      priority: 'normal',
      turnId: TURN_ID,
      patch: { npcAffectiveStateDelta: { relational: { trust: -10 } } },
    });
    applySimulationPatch(RUN_ID, {
      source: 'gemini_tool',
      priority: 'normal',
      turnId: TURN_ID,
      patch: { npcAffectiveStateDelta: { relational: { trust: -5 } } },
    });

    const state = getSessionState(RUN_ID)!;
    const expectedTrust = DEFAULT_NPC_AFFECTIVE_STATE.relational.trust - 15;
    expect(state.npcAffectiveState.relational.trust).toBe(expectedTrust);
  });
});

// ── 4. Clamping keeps values in valid range ────────────────────────────────

describe('update_npc_affective_state tool — clamping', () => {
  it('clamps npcAffectiveState.affective.intensity to [0, 100]', () => {
    // Use applySimulationPatch directly (no per-delta cap) to push intensity near the ceiling
    applySimulationPatch(RUN_ID, {
      source: 'server_evaluation',
      priority: 'normal',
      turnId: TURN_ID,
      patch: { npcAffectiveStateDelta: { affective: { intensity: 80 } } },
    });

    // Now use the tool — the engine must clamp the accumulated value at 100
    const result = handleToolCall('update_npc_affective_state', {
      intensityDelta: 30, // default maxDeltaPerCall; (80+30) + 30 default = 140 → clamped to 100
      reason: 'overflow attempt',
    }, baseCtx);

    expect(result.success).toBe(true);
    expect(result.currentState!.npcAffectiveState.affective.intensity).toBe(100);
  });

  it('clamps npcAffectiveState.relational.trust to minimum 0', () => {
    applySimulationPatch(RUN_ID, {
      source: 'server_evaluation',
      priority: 'normal',
      turnId: TURN_ID,
      patch: { npcAffectiveStateDelta: { relational: { trust: -200 } } },
    });

    const state = getSessionState(RUN_ID)!;
    expect(state.npcAffectiveState.relational.trust).toBe(0);
  });
});

// ── 5. Evaluation path uses npcAffectiveStateDelta ─────────────────────────

describe('evaluation path (applySimulationPatch) — npcAffectiveState as source of truth', () => {
  it('applySimulationPatch with npcAffectiveStateDelta updates affective state', () => {
    const state = applySimulationPatch(RUN_ID, {
      source: 'server_evaluation',
      priority: 'normal',
      turnId: TURN_ID,
      patch: {
        npcAffectiveStateDelta: {
          affective: { intensity: 25 },
          cognitive: { confusion: 15 },
          relational: { trust: -20 },
          motivational: { interest: 10 },
        },
      },
    });

    expect(state.npcAffectiveState.affective.intensity).toBe(
      DEFAULT_NPC_AFFECTIVE_STATE.affective.intensity + 25
    );
    expect(state.npcAffectiveState.cognitive.confusion).toBe(
      DEFAULT_NPC_AFFECTIVE_STATE.cognitive.confusion + 15
    );
    expect(state.npcAffectiveState.relational.trust).toBe(
      DEFAULT_NPC_AFFECTIVE_STATE.relational.trust - 20
    );
    expect(state.npcAffectiveState.motivational.interest).toBe(
      DEFAULT_NPC_AFFECTIVE_STATE.motivational.interest + 10
    );
  });

  it('npcAffectiveState is updated correctly after evaluation patch', () => {
    const state = applySimulationPatch(RUN_ID, {
      source: 'server_evaluation',
      priority: 'normal',
      turnId: TURN_ID,
      patch: {
        npcAffectiveStateDelta: {
          affective: { intensity: 18 },
          relational: { trust: -12 },
          cognitive: { confusion: 9 },
          motivational: { interest: -6 },
        },
      },
    });

    expect(state.npcAffectiveState.affective.intensity).toBe(DEFAULT_NPC_AFFECTIVE_STATE.affective.intensity + 18);
    expect(state.npcAffectiveState.relational.trust).toBe(DEFAULT_NPC_AFFECTIVE_STATE.relational.trust - 12);
    expect(state.npcAffectiveState.cognitive.confusion).toBe(DEFAULT_NPC_AFFECTIVE_STATE.cognitive.confusion + 9);
    expect(state.npcAffectiveState.motivational.interest).toBe(DEFAULT_NPC_AFFECTIVE_STATE.motivational.interest - 6);
  });

  it('a patch without npcAffectiveStateDelta does not change affective values', () => {
    // Establish baseline with known values
    applySimulationPatch(RUN_ID, {
      source: 'server_evaluation',
      priority: 'normal',
      turnId: TURN_ID,
      patch: { npcAffectiveStateDelta: { affective: { intensity: 20 } } },
    });

    const before = getSessionState(RUN_ID)!;
    const intensityBefore = before.npcAffectiveState.affective.intensity;

    // Apply a patch that changes stage only — no emotion delta
    const after = applySimulationPatch(RUN_ID, {
      source: 'server_rule',
      priority: 'normal',
      turnId: TURN_ID,
      patch: { targetStage: 'conflict' },
    });

    expect(after.npcAffectiveState.affective.intensity).toBe(intensityBefore);
  });
});

// ── 6. analyzeEmotion has no NPC state side effects ────────────────────────

describe('analyzeEmotion (emotionAnalyzer) — UI label only, no state writes', () => {
  it('returns an emotion label and reason string without modifying npcAffectiveState', async () => {
    // Set up a known state
    applySimulationPatch(RUN_ID, {
      source: 'server_evaluation',
      priority: 'normal',
      turnId: TURN_ID,
      patch: { npcAffectiveStateDelta: { relational: { trust: 10 } } },
    });
    const stateBefore = getSessionState(RUN_ID)!;
    const trustBefore = stateBefore.npcAffectiveState.relational.trust;

    // analyzeEmotion with genAI=null falls back to text analysis — no network call needed
    const { emotion, emotionReason } = await analyzeEmotion(
      'I am very frustrated with this!',
      'Test Persona',
      'en',
      null
    );

    // Returns a label (string)
    expect(typeof emotion).toBe('string');
    expect(emotion.length).toBeGreaterThan(0);
    expect(typeof emotionReason).toBe('string');

    // Session state must be unchanged
    const stateAfter = getSessionState(RUN_ID)!;
    expect(stateAfter.npcAffectiveState.relational.trust).toBe(trustBefore);
  });

  it('analyzeUserEmotion returns a UserAffectState without touching npcAffectiveState', async () => {
    applySimulationPatch(RUN_ID, {
      source: 'server_evaluation',
      priority: 'normal',
      turnId: TURN_ID,
      patch: { npcAffectiveStateDelta: { affective: { intensity: 5 } } },
    });
    const stateBefore = getSessionState(RUN_ID)!;
    const intensityBefore = stateBefore.npcAffectiveState.affective.intensity;

    // genAI=null returns NEUTRAL_USER_AFFECT without any API call
    const affect = await analyzeUserEmotion(
      'This is taking too long.',
      '',
      'Test Persona',
      'en',
      null
    );

    expect(affect).toMatchObject({
      primaryEmotion: NEUTRAL_USER_AFFECT.primaryEmotion,
    });

    // No side effects on session state
    const stateAfter = getSessionState(RUN_ID)!;
    expect(stateAfter.npcAffectiveState.affective.intensity).toBe(intensityBefore);
  });
});

// ── 7. Invalid args return success: false ──────────────────────────────────

describe('update_npc_affective_state tool — validation', () => {
  it('returns success:false when reason field is missing', () => {
    const result = handleToolCall('update_npc_affective_state', {
      intensityDelta: 10,
      // reason intentionally omitted
    }, baseCtx);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('returns success:false for an unknown tool name', () => {
    const result = handleToolCall('update_npc_emotion_delta', {
      angerDelta: 10,
      reason: 'legacy tool',
    }, baseCtx);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unknown tool/i);
  });
});

// ── 8. Affective-only fields carry forward without a delta ─────────────────

describe('affective-only fields (rapport, cooperativeness, valence, load) — carry-forward', () => {
  it('rapport is preserved when only intensity is patched', () => {
    // Set a non-default rapport
    applySimulationPatch(RUN_ID, {
      source: 'server_evaluation',
      priority: 'normal',
      turnId: TURN_ID,
      patch: { npcAffectiveStateDelta: { relational: { rapport: 15 } } },
    });

    // Now patch intensity — rapport must still reflect the previous delta
    const state = applySimulationPatch(RUN_ID, {
      source: 'gemini_tool',
      priority: 'normal',
      turnId: TURN_ID,
      patch: { npcAffectiveStateDelta: { affective: { intensity: 10 } } },
    });

    expect(state.npcAffectiveState.relational.rapport).toBe(
      DEFAULT_NPC_AFFECTIVE_STATE.relational.rapport + 15
    );
  });
});
