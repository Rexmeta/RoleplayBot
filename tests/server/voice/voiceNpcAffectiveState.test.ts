/**
 * Integration tests: voice-session NPC state flows through npcAffectiveState
 *
 * Ownership boundary:
 *  - simulationEngine.test.ts  owns: delta application, clamping, accumulation,
 *    stage rules, scoring, carry-forward across layers
 *  - simulationToolHandler.test.ts  owns: tool arg validation, per-call clamping,
 *    per-turn cap, stage/incident tool rules
 *
 * This file confirms the cross-cutting contract that matters for voice sessions:
 *  1. update_npc_affective_state tool routes through npcAffectiveStateDelta
 *     (never npcEmotionDelta or direct npcEmotions writes)
 *  2. npcAffectiveState is the sole source of truth — the delta sub-layer structure
 *     is correctly mapped for all four sub-layers in a single representative call
 *  3. The evaluation path (applySimulationPatch) integrates with the tool path
 *     without double-counting (state accumulates across both sources)
 *  4. analyzeEmotion / analyzeUserEmotion produce UI labels with no NPC state
 *     side effects (the voice layer reads state, it never writes through the
 *     emotion analyzer)
 *  5. Affective-only fields (rapport, etc.) carry forward when unrelated layers
 *     are patched
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  handleToolCall,
} from '../../../server/services/simulation/simulationToolHandler';
import {
  applySimulationPatch,
  getSessionState,
  clearSessionContext,
} from '../../../server/services/simulation/simulationEngine';
import {
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

// ── 1. Tool routes through npcAffectiveStateDelta (patch format contract) ──
//
// simulationToolHandler.test.ts owns exhaustive arg validation and clamping.
// Here we only confirm the patch shape — the key for the voice-session
// integration boundary that must never regress to the legacy npcEmotionDelta.

describe('update_npc_affective_state tool — patch format', () => {
  it('returns success and a statePatch containing npcAffectiveStateDelta (not the legacy npcEmotionDelta)', () => {
    const result = handleToolCall('update_npc_affective_state', {
      intensityDelta: 10,
      reason: 'user was rude',
    }, baseCtx);

    expect(result.success).toBe(true);
    expect(result.statePatch).toBeDefined();
    expect(result.statePatch).toHaveProperty('npcAffectiveStateDelta');
    expect((result.statePatch as any).npcEmotionDelta).toBeUndefined();
  });

  it('all four sub-layer delta keys (affective/cognitive/relational/motivational) map correctly in one call', () => {
    // Representative multi-layer call — sub-layer clamping & per-call cap are
    // tested exhaustively in simulationToolHandler.test.ts.
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

// ── 2. Tool and evaluation paths accumulate into the same state store ───────
//
// Confirms that the voice tool path and the server-side evaluation path both
// write to the same in-memory session state without overwriting each other.
// The per-source accumulation semantics are tested in simulationEngine.test.ts;
// here we only confirm the cross-source integration boundary.

describe('update_npc_affective_state tool — integration with evaluation path', () => {
  it('tool delta and evaluation delta accumulate independently into shared session state', () => {
    // Evaluation path fires first (e.g., after the previous turn)
    applySimulationPatch(RUN_ID, {
      source: 'server_evaluation',
      priority: 'normal',
      turnId: TURN_ID,
      patch: { npcAffectiveStateDelta: { relational: { trust: -10 } } },
    });

    // Tool call fires during the AI response
    const result = handleToolCall('update_npc_affective_state', {
      trustDelta: -5,
      reason: 'follow-up tool call',
    }, baseCtx);

    expect(result.success).toBe(true);
    const state = getSessionState(RUN_ID)!;
    // Both deltas must accumulate: default 50 - 10 (eval) - 5 (tool) = 35
    expect(state.npcAffectiveState.relational.trust).toBe(
      DEFAULT_NPC_AFFECTIVE_STATE.relational.trust - 15
    );
  });

  it('a stage-only patch (no npcAffectiveStateDelta) does not alter affective values', () => {
    applySimulationPatch(RUN_ID, {
      source: 'server_evaluation',
      priority: 'normal',
      turnId: TURN_ID,
      patch: { npcAffectiveStateDelta: { affective: { intensity: 20 } } },
    });
    const intensityAfterFirst = getSessionState(RUN_ID)!.npcAffectiveState.affective.intensity;

    const after = applySimulationPatch(RUN_ID, {
      source: 'server_rule',
      priority: 'normal',
      turnId: TURN_ID,
      patch: { targetStage: 'conflict' },
    });

    expect(after.npcAffectiveState.affective.intensity).toBe(intensityAfterFirst);
  });
});

// ── 3. analyzeEmotion has no NPC state side effects ────────────────────────
//
// The voice layer calls analyzeEmotion to derive a UI label for display only.
// It must never write to the NPC simulation state as a side effect.

describe('analyzeEmotion (emotionAnalyzer) — UI label only, no state writes', () => {
  it('returns a non-empty emotion label string without modifying npcAffectiveState', async () => {
    applySimulationPatch(RUN_ID, {
      source: 'server_evaluation',
      priority: 'normal',
      turnId: TURN_ID,
      patch: { npcAffectiveStateDelta: { relational: { trust: 10 } } },
    });
    const trustBefore = getSessionState(RUN_ID)!.npcAffectiveState.relational.trust;

    const { emotion, emotionReason } = await analyzeEmotion(
      'I am very frustrated with this!',
      'Test Persona',
      'en',
      null
    );

    expect(typeof emotion).toBe('string');
    expect(emotion.length).toBeGreaterThan(0);
    expect(typeof emotionReason).toBe('string');

    // No side effect on session state
    expect(getSessionState(RUN_ID)!.npcAffectiveState.relational.trust).toBe(trustBefore);
  });

  it('analyzeUserEmotion returns a UserAffectState without touching npcAffectiveState', async () => {
    applySimulationPatch(RUN_ID, {
      source: 'server_evaluation',
      priority: 'normal',
      turnId: TURN_ID,
      patch: { npcAffectiveStateDelta: { affective: { intensity: 5 } } },
    });
    const intensityBefore = getSessionState(RUN_ID)!.npcAffectiveState.affective.intensity;

    const affect = await analyzeUserEmotion(
      'This is taking too long.',
      '',
      'Test Persona',
      'en',
      null
    );

    expect(affect).toMatchObject({ primaryEmotion: NEUTRAL_USER_AFFECT.primaryEmotion });
    expect(getSessionState(RUN_ID)!.npcAffectiveState.affective.intensity).toBe(intensityBefore);
  });
});

// ── 4. Affective-only fields carry forward when unrelated layers are patched ─
//
// This is the voice-specific regression boundary: if a tool call or evaluation
// patch touches only one sub-layer, fields in other sub-layers must not be reset
// to their defaults. Full carry-forward coverage lives in simulationEngine.test.ts.

describe('affective-only fields (rapport, cooperativeness, valence, load) — carry-forward', () => {
  it('rapport is preserved when only intensity is patched via a subsequent tool call', () => {
    applySimulationPatch(RUN_ID, {
      source: 'server_evaluation',
      priority: 'normal',
      turnId: TURN_ID,
      patch: { npcAffectiveStateDelta: { relational: { rapport: 15 } } },
    });

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
