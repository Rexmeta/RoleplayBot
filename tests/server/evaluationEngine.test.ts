import { describe, it, expect } from 'vitest';
import {
  calcEffectiveRatio,
  checkMinValidTurns,
  analyzeNonVerbalPatterns,
  NON_VERBAL_PENALTY_CAP,
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

// ─── analyzeNonVerbalPatterns ─────────────────────────────────────────────────

function makeMsg(text: string, id = 1): ConversationMessage {
  return {
    id,
    conversationId: 1,
    sender: 'user' as const,
    message: text,
    timestamp: new Date(),
    interrupted: false,
  };
}

describe('analyzeNonVerbalPatterns — no patterns', () => {
  it('returns zeros and empty patterns when all messages are normal', () => {
    const msgs = [
      makeMsg('안녕하세요, 반갑습니다.', 1),
      makeMsg('오늘 회의 내용을 공유해드리겠습니다.', 2),
    ];
    const result = analyzeNonVerbalPatterns(msgs);
    expect(result.count).toBe(0);
    expect(result.patterns).toHaveLength(0);
    expect(result.penaltyPoints).toBe(0);
  });

  it('returns zeros for empty message list', () => {
    const result = analyzeNonVerbalPatterns([]);
    expect(result.count).toBe(0);
    expect(result.patterns).toHaveLength(0);
    expect(result.penaltyPoints).toBe(0);
  });
});

describe('analyzeNonVerbalPatterns — short response (< 3 chars)', () => {
  it('detects a 1-character response and adds 2 penalty points', () => {
    const result = analyzeNonVerbalPatterns([makeMsg('a')]);
    expect(result.count).toBe(1);
    expect(result.penaltyPoints).toBe(2);
    expect(result.patterns[0]).toContain('짧은 응답');
    expect(result.patterns[0]).toContain('a');
  });

  it('detects a 2-character response and adds 2 penalty points', () => {
    const result = analyzeNonVerbalPatterns([makeMsg('ok')]);
    expect(result.count).toBe(1);
    expect(result.penaltyPoints).toBe(2);
    expect(result.patterns[0]).toContain('짧은 응답');
  });
});

describe('analyzeNonVerbalPatterns — meaningless one-liner (3-5 chars, no compound Korean)', () => {
  it('detects a 3-char Latin word and adds 1 penalty point', () => {
    const result = analyzeNonVerbalPatterns([makeMsg('hey')]);
    expect(result.count).toBe(1);
    expect(result.penaltyPoints).toBe(1);
    expect(result.patterns[0]).toContain('무의미한 단답');
  });

  it('detects ㅋㅋㅋ jamo laughter (not a full syllable block) and adds 1 penalty point', () => {
    // ㅋ is Hangul Compatibility Jamo (U+314B), not in the 가-힣 syllable range,
    // so "ㅋㅋㅋ" (length 3) escapes the < 3 guard and matches the meaningless pattern.
    const result = analyzeNonVerbalPatterns([makeMsg('ㅋㅋㅋ')]);
    expect(result.count).toBe(1);
    expect(result.penaltyPoints).toBe(1);
    expect(result.patterns[0]).toContain('무의미한 단답');
  });
});

describe('analyzeNonVerbalPatterns — ellipsis / silence marker', () => {
  // "..." (length 3) is caught by the preceding "무의미한 단답" branch (dots are
  // in the short-text regex character class). A run of ≥ 6 dots escapes that
  // branch and lands in the dedicated silence-marker branch.
  it('detects a 6-dot sequence and adds 3 penalty points', () => {
    const result = analyzeNonVerbalPatterns([makeMsg('......')]);
    expect(result.count).toBe(1);
    expect(result.penaltyPoints).toBe(3);
    expect(result.patterns[0]).toContain('침묵 표시');
  });

  it('detects an arbitrary pure-dot string and adds 3 penalty points', () => {
    const result = analyzeNonVerbalPatterns([makeMsg('...........')]);
    expect(result.count).toBe(1);
    expect(result.penaltyPoints).toBe(3);
    expect(result.patterns[0]).toContain('침묵 표시');
  });
});

describe('analyzeNonVerbalPatterns — filler sounds', () => {
  // Single-syllable fillers ("음", "어") have length 1 and are caught by the
  // "짧은 응답" branch first. Repeated forms ("음음음") have ≥ 2 syllables,
  // so they skip the "무의미한 단답" branch and reach the filler-sound branch.
  it('detects repeated Korean filler "음음음" and adds 2 penalty points', () => {
    const result = analyzeNonVerbalPatterns([makeMsg('음음음')]);
    expect(result.count).toBe(1);
    expect(result.penaltyPoints).toBe(2);
    expect(result.patterns[0]).toContain('비언어적 표현');
  });

  it('detects repeated Korean filler "어어어" and adds 2 penalty points', () => {
    const result = analyzeNonVerbalPatterns([makeMsg('어어어')]);
    expect(result.count).toBe(1);
    expect(result.penaltyPoints).toBe(2);
    expect(result.patterns[0]).toContain('비언어적 표현');
  });

  it('detects long English filler "ummmmm" (≥ 6 chars) and adds 2 penalty points', () => {
    // "umm" / "ummm" / "ummmm" are ≤ 5 lowercase chars and are caught by the
    // "무의미한 단답" branch. Six or more chars escape it and reach filler detection.
    const result = analyzeNonVerbalPatterns([makeMsg('ummmmm')]);
    expect(result.count).toBe(1);
    expect(result.penaltyPoints).toBe(2);
    expect(result.patterns[0]).toContain('비언어적 표현');
  });

  it('detects long English filler "hmmmmm" (≥ 6 chars) and adds 2 penalty points', () => {
    const result = analyzeNonVerbalPatterns([makeMsg('hmmmmm')]);
    expect(result.count).toBe(1);
    expect(result.penaltyPoints).toBe(2);
    expect(result.patterns[0]).toContain('비언어적 표현');
  });
});

describe('analyzeNonVerbalPatterns — skip keyword branch reachability', () => {
  // The skip-keyword branch ("침묵", "skip", "스킵") is checked first in the
  // if-else chain so it is always reached before shorter-text guards.
  it('"침묵" is caught by the skip branch and penalised +5', () => {
    const result = analyzeNonVerbalPatterns([makeMsg('침묵')]);
    expect(result.count).toBe(1);
    expect(result.patterns[0]).toContain('스킵');
    expect(result.penaltyPoints).toBe(5);
  });

  it('"스킵" is caught by the skip branch and penalised +5', () => {
    const result = analyzeNonVerbalPatterns([makeMsg('스킵')]);
    expect(result.count).toBe(1);
    expect(result.patterns[0]).toContain('스킵');
    expect(result.penaltyPoints).toBe(5);
  });

  it('"skip" is caught by the skip branch and penalised +5', () => {
    const result = analyzeNonVerbalPatterns([makeMsg('skip')]);
    expect(result.count).toBe(1);
    expect(result.patterns[0]).toContain('스킵');
    expect(result.penaltyPoints).toBe(5);
  });
});

describe('analyzeNonVerbalPatterns — multiple matches accumulate', () => {
  it('accumulates penalty across several non-verbal messages', () => {
    const msgs = [
      makeMsg('a', 1),        // 짧은 응답  +2
      makeMsg('......', 2),   // 침묵 표시  +3
      makeMsg('음음음', 3),   // 비언어적 표현 +2
    ];
    const result = analyzeNonVerbalPatterns(msgs);
    expect(result.count).toBe(3);
    expect(result.penaltyPoints).toBe(2 + 3 + 2);
    expect(result.patterns).toHaveLength(3);
  });

  it('includes the original message text inside each pattern label', () => {
    const msgs = [makeMsg('a', 1), makeMsg('hey', 2)];
    const result = analyzeNonVerbalPatterns(msgs);
    expect(result.patterns[0]).toContain('"a"');
    expect(result.patterns[1]).toContain('"hey"');
  });
});

describe('analyzeNonVerbalPatterns — penalty cap', () => {
  it('caps total penalty at NON_VERBAL_PENALTY_CAP even when raw total exceeds it', () => {
    const msgs = Array.from({ length: 10 }, (_, i) => makeMsg('침묵', i + 1));
    const result = analyzeNonVerbalPatterns(msgs);
    expect(result.penaltyPoints).toBe(NON_VERBAL_PENALTY_CAP);
    expect(result.count).toBe(10);
  });

  it('NON_VERBAL_PENALTY_CAP is a positive finite number', () => {
    expect(NON_VERBAL_PENALTY_CAP).toBeGreaterThan(0);
    expect(Number.isFinite(NON_VERBAL_PENALTY_CAP)).toBe(true);
  });
});

describe('analyzeNonVerbalPatterns — voice mode bypass', () => {
  it('returns zeros in realtime_voice mode regardless of message content', () => {
    const msgs = [makeMsg('a'), makeMsg('...'), makeMsg('침묵')];
    const result = analyzeNonVerbalPatterns(msgs, { mode: 'realtime_voice' });
    expect(result.count).toBe(0);
    expect(result.patterns).toHaveLength(0);
    expect(result.penaltyPoints).toBe(0);
  });

  it('returns zeros in tts mode regardless of message content', () => {
    const msgs = [makeMsg('a'), makeMsg('...'), makeMsg('침묵')];
    const result = analyzeNonVerbalPatterns(msgs, { mode: 'tts' });
    expect(result.count).toBe(0);
    expect(result.patterns).toHaveLength(0);
    expect(result.penaltyPoints).toBe(0);
  });

  it('runs analysis normally in text mode', () => {
    const result = analyzeNonVerbalPatterns([makeMsg('a')], { mode: 'text' });
    expect(result.count).toBe(1);
    expect(result.penaltyPoints).toBe(2);
  });

  it('runs analysis normally when conversation is null', () => {
    const result = analyzeNonVerbalPatterns([makeMsg('a')], null);
    expect(result.count).toBe(1);
    expect(result.penaltyPoints).toBe(2);
  });
});
