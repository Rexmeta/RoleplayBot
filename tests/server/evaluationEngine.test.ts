import { describe, it, expect } from 'vitest';
import {
  calcEffectiveRatio,
  checkMinValidTurns,
  COMPLETION_PENALTY_TIERS,
  SCORE_CAP_TIERS,
  BASELINE_CHARS_PER_TURN,
} from '../../server/services/evaluationEngine';
import type { ConversationMessage } from '../../shared/schema/types';

function makeMessages(count: number, charsEach = 50): ConversationMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    conversationId: 1,
    sender: 'user' as const,
    message: 'a'.repeat(charsEach),
    timestamp: new Date(),
    interrupted: false,
  }));
}

// ─── calcEffectiveRatio ──────────────────────────────────────────────────────

describe('calcEffectiveRatio', () => {
  it('returns 1.0 when turns match the scenario target exactly', () => {
    const msgs = makeMessages(10);
    expect(calcEffectiveRatio(msgs, false, 10)).toBe(1.0);
  });

  it('caps at 1.0 when turns exceed target', () => {
    const msgs = makeMessages(20);
    expect(calcEffectiveRatio(msgs, false, 10)).toBe(1.0);
  });

  it('returns ratio < 1 for partial completion (text mode, turn-based)', () => {
    const msgs = makeMessages(5);
    const ratio = calcEffectiveRatio(msgs, false, 10);
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(1);
  });

  it('uses character volume when content is dense enough to exceed turn ratio (text mode)', () => {
    // 2 turns out of 10 = 0.2 turnRatio, but each message has BASELINE_CHARS_PER_TURN chars
    // so contentRatio for 2 msgs should be 2/10 = 0.2 at baseline
    // Give them 5x the baseline chars → contentRatio = 10/10 = 1.0
    const msgs = makeMessages(2, BASELINE_CHARS_PER_TURN * 5);
    const ratio = calcEffectiveRatio(msgs, false, 10);
    expect(ratio).toBe(1.0);
  });

  it('uses scenario target turns instead of global constant when provided', () => {
    // 8 sparse messages (5 chars each) → turnRatio = 8/10 = 0.8, contentRatio = 40/(400)=0.1 → max = 0.8
    const msgs = makeMessages(8, 5);
    const ratioScenario = calcEffectiveRatio(msgs, false, 10);
    expect(ratioScenario).toBeCloseTo(0.8, 1);
    // With a different target (e.g. 16), ratio = max(0.5, 0.0625) = 0.5 → different result
    const ratioOther = calcEffectiveRatio(msgs, false, 16);
    expect(ratioOther).not.toBeCloseTo(ratioScenario, 1);
  });

  it('voice mode also uses max(turnRatio, contentRatio)', () => {
    // 2 turns out of 10 = 0.2, but heavy content => contentRatio = 1.0
    const msgs = makeMessages(2, BASELINE_CHARS_PER_TURN * 5);
    const ratio = calcEffectiveRatio(msgs, true, 10);
    expect(ratio).toBe(1.0);
  });
});

// ─── checkMinValidTurns ──────────────────────────────────────────────────────

describe('checkMinValidTurns', () => {
  it('returns true when turn count meets the minimum', () => {
    expect(checkMinValidTurns(makeMessages(4), 4)).toBe(true);
  });

  it('returns true when turn count exceeds the minimum', () => {
    expect(checkMinValidTurns(makeMessages(6), 4)).toBe(true);
  });

  it('returns false when turn count is below the minimum', () => {
    expect(checkMinValidTurns(makeMessages(3), 4)).toBe(false);
  });

  it('returns false for empty message list when minValidTurns > 0', () => {
    expect(checkMinValidTurns([], 1)).toBe(false);
  });
});

// ─── 80% no-penalty tier ─────────────────────────────────────────────────────

describe('COMPLETION_PENALTY_TIERS 80% tier', () => {
  it('has a tier at threshold 0.8', () => {
    const tier = COMPLETION_PENALTY_TIERS.find(t => t.threshold === 0.8);
    expect(tier).toBeDefined();
  });

  it('80% tier has lower penalty than 70% tier', () => {
    const t70 = COMPLETION_PENALTY_TIERS.find(t => t.threshold === 0.7)!;
    const t80 = COMPLETION_PENALTY_TIERS.find(t => t.threshold === 0.8)!;
    expect(t80.textPenalty).toBeLessThan(t70.textPenalty);
    expect(t80.voicePenalty).toBeLessThan(t70.voicePenalty);
  });

  it('tiers are ordered by ascending threshold', () => {
    const thresholds = COMPLETION_PENALTY_TIERS.map(t => t.threshold);
    const sorted = [...thresholds].sort((a, b) => a - b);
    expect(thresholds).toEqual(sorted);
  });
});

describe('SCORE_CAP_TIERS 80% tier', () => {
  it('has a tier at maxRatio 0.8', () => {
    const tier = SCORE_CAP_TIERS.find(t => t.maxRatio === 0.8);
    expect(tier).toBeDefined();
  });

  it('80% tier allows higher max score than 70% tier', () => {
    const t70 = SCORE_CAP_TIERS.find(t => t.maxRatio === 0.7)!;
    const t80 = SCORE_CAP_TIERS.find(t => t.maxRatio === 0.8)!;
    expect(t80.maxScore).toBeGreaterThan(t70.maxScore);
  });
});
