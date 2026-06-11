import { describe, it, expect } from 'vitest';
import {
  analyzeBargeIn,
  BARGE_IN_POSITIVE_BONUS,
  BARGE_IN_NEGATIVE_PENALTY,
  BARGE_IN_MIN_ADJUSTMENT,
  BARGE_IN_MAX_ADJUSTMENT,
} from '../../server/services/evaluationEngine';
import type { ConversationMessage } from '../../shared/schema/types';

function aiMsg(text: string, interrupted = false): ConversationMessage {
  return {
    sender: 'ai',
    message: text,
    timestamp: new Date().toISOString(),
    interrupted,
  };
}

function userMsg(text: string): ConversationMessage {
  return {
    sender: 'user',
    message: text,
    timestamp: new Date().toISOString(),
    interrupted: false,
  };
}

// ─── No barge-in ─────────────────────────────────────────────────────────────

describe('analyzeBargeIn — no barge-in events', () => {
  it('returns zero counts and empty events for messages with no interrupted flag', () => {
    const msgs = [aiMsg('Hello there.'), userMsg('Hi!'), aiMsg('How are you?'), userMsg('Fine.') ];
    const result = analyzeBargeIn(msgs);
    expect(result.count).toBe(0);
    expect(result.events).toHaveLength(0);
    expect(result.positiveCount).toBe(0);
    expect(result.negativeCount).toBe(0);
    expect(result.neutralCount).toBe(0);
  });

  it('uses "no barge-in detected" summary when count is 0', () => {
    const msgs = [aiMsg('Good morning.'), userMsg('Morning!')];
    const result = analyzeBargeIn(msgs);
    expect(result.summary).toBe('말 끊기(Barge-in)가 감지되지 않았습니다.');
  });

  it('returns rate 0 when there are no events', () => {
    const msgs = [aiMsg('Fine.'), userMsg('OK.')];
    const result = analyzeBargeIn(msgs);
    expect(result.rate).toBe(0);
  });
});

// ─── Question interrupted → negative / severity 3 ────────────────────────────

describe('analyzeBargeIn — question interrupted', () => {
  it('classifies interruption of an English question as negative severity-3', () => {
    const msgs = [
      aiMsg('What do you think about this approach?', true),
      userMsg('I think we should just go ahead.'),
    ];
    const result = analyzeBargeIn(msgs);
    expect(result.count).toBe(1);
    expect(result.negativeCount).toBe(1);
    expect(result.events[0].assessment).toBe('negative');
    expect(result.events[0].severity).toBe(3);
  });

  it('classifies interruption of a Korean question (어떻) as negative severity-3', () => {
    const msgs = [
      aiMsg('이 부분에 대해 어떻게 생각하시나요?', true),
      userMsg('그냥 진행하면 될 것 같아요.'),
    ];
    const result = analyzeBargeIn(msgs);
    expect(result.events[0].assessment).toBe('negative');
    expect(result.events[0].severity).toBe(3);
  });

  it('classifies interruption of AI message containing "?" as negative severity-3', () => {
    const msgs = [
      aiMsg('Do you agree?', true),
      userMsg('Yes I do.'),
    ];
    const result = analyzeBargeIn(msgs);
    expect(result.events[0].assessment).toBe('negative');
    expect(result.events[0].severity).toBe(3);
  });

  it('question keyword "why" triggers negative classification', () => {
    const msgs = [
      aiMsg('Why did you choose this path?', true),
      userMsg('Because I felt like it.'),
    ];
    const result = analyzeBargeIn(msgs);
    expect(result.events[0].assessment).toBe('negative');
    expect(result.events[0].severity).toBe(3);
  });
});

// ─── Wrap-up interrupted → negative / severity 2 ─────────────────────────────

describe('analyzeBargeIn — wrap-up interrupted', () => {
  it('classifies interruption of Korean wrap-up phrase as negative severity-2', () => {
    const msgs = [
      aiMsg('정리하자면 우리가 오늘 논의한 내용은...', true),
      userMsg('잠깐, 그것도 중요하지 않아요?'),
    ];
    const result = analyzeBargeIn(msgs);
    expect(result.count).toBe(1);
    expect(result.negativeCount).toBe(1);
    expect(result.events[0].assessment).toBe('negative');
    expect(result.events[0].severity).toBe(2);
  });

  it('classifies interruption of "in summary" as negative severity-2', () => {
    const msgs = [
      aiMsg('In summary, the project has three main phases.', true),
      userMsg('Actually I have a concern about that.'),
    ];
    const result = analyzeBargeIn(msgs);
    expect(result.events[0].assessment).toBe('negative');
    expect(result.events[0].severity).toBe(2);
  });

  it('classifies "to conclude" wrap-up interruption as negative severity-2', () => {
    const msgs = [
      aiMsg('To conclude, we need better communication.', true),
      userMsg('I see what you mean.'),
    ];
    const result = analyzeBargeIn(msgs);
    expect(result.events[0].assessment).toBe('negative');
    expect(result.events[0].severity).toBe(2);
  });
});

// ─── Defensive response → negative / severity 3 ──────────────────────────────

describe('analyzeBargeIn — defensive response', () => {
  it('classifies "아니요" defensive interjection as negative severity-3', () => {
    const msgs = [
      aiMsg('이 방법이 효과적입니다.', true),
      userMsg('아니요, 그건 잘못된 생각이에요.'),
    ];
    const result = analyzeBargeIn(msgs);
    expect(result.events[0].assessment).toBe('negative');
    expect(result.events[0].severity).toBe(3);
  });

  it('classifies "wait," defensive English interjection as negative severity-3', () => {
    const msgs = [
      aiMsg('This plan will definitely work.', true),
      userMsg('Wait, that does not seem right.'),
    ];
    const result = analyzeBargeIn(msgs);
    expect(result.events[0].assessment).toBe('negative');
    expect(result.events[0].severity).toBe(3);
  });

  it('classifies "actually" defensive English interjection as negative severity-3', () => {
    const msgs = [
      aiMsg('The deadline is next Friday.', true),
      userMsg('Actually, the deadline was moved to Thursday.'),
    ];
    const result = analyzeBargeIn(msgs);
    expect(result.events[0].assessment).toBe('negative');
    expect(result.events[0].severity).toBe(3);
  });

  it('classifies "no," defensive interjection as negative severity-3', () => {
    const msgs = [
      aiMsg('Everything looks good from our side.', true),
      userMsg('No, there are still several outstanding issues to address.'),
    ];
    const result = analyzeBargeIn(msgs);
    expect(result.events[0].assessment).toBe('negative');
    expect(result.events[0].severity).toBe(3);
  });
});

// ─── Substantive interjection → positive / severity 1 ────────────────────────

describe('analyzeBargeIn — substantive interjection', () => {
  it('classifies long, non-defensive interjection as positive severity-1', () => {
    const msgs = [
      aiMsg('We could try option A here.', true),
      userMsg('I believe option B would be more cost-effective given our current budget constraints.'),
    ];
    const result = analyzeBargeIn(msgs);
    expect(result.events[0].assessment).toBe('positive');
    expect(result.events[0].severity).toBe(1);
    expect(result.positiveCount).toBe(1);
  });

  it('does not classify as positive when user message starts with "네" filler', () => {
    const msgs = [
      aiMsg('We should review the report.', true),
      userMsg('네 그렇군요 알겠습니다 잘 이해했어요.'),
    ];
    const result = analyzeBargeIn(msgs);
    expect(result.events[0].assessment).not.toBe('positive');
  });

  it('does not classify short message (≤30 chars) as positive', () => {
    const msgs = [
      aiMsg('We could try option A.', true),
      userMsg('Sure, let us do that.'),
    ];
    const result = analyzeBargeIn(msgs);
    expect(result.events[0].assessment).not.toBe('positive');
  });
});

// ─── Neutral / short interjection ────────────────────────────────────────────

describe('analyzeBargeIn — neutral interjection', () => {
  it('classifies short non-filler, non-defensive message as neutral severity-2', () => {
    const msgs = [
      aiMsg('Let us move on to the next topic.', true),
      userMsg('Sure.'),
    ];
    const result = analyzeBargeIn(msgs);
    expect(result.events[0].assessment).toBe('neutral');
    expect(result.events[0].severity).toBe(2);
    expect(result.neutralCount).toBe(1);
  });

  it('increments neutralCount for neutral events', () => {
    const msgs = [
      aiMsg('Moving along.', true),
      userMsg('OK.'),
      aiMsg('Next item.', true),
      userMsg('Sure.'),
    ];
    const result = analyzeBargeIn(msgs);
    expect(result.neutralCount).toBe(2);
    expect(result.negativeCount).toBe(0);
    expect(result.positiveCount).toBe(0);
  });
});

// ─── Rate calculation ─────────────────────────────────────────────────────────

describe('analyzeBargeIn — rate calculation', () => {
  it('rate equals events / total AI turns (rounded to 2 decimals)', () => {
    const msgs = [
      aiMsg('Message one.', true),
      userMsg('OK.'),
      aiMsg('Message two.'),
      userMsg('Fine.'),
      aiMsg('Message three.', true),
      userMsg('Right.'),
      aiMsg('Message four.'),
      userMsg('Sure.'),
    ];
    const result = analyzeBargeIn(msgs);
    expect(result.count).toBe(2);
    const expectedRate = Math.round((2 / 4) * 100) / 100;
    expect(result.rate).toBe(expectedRate);
  });

  it('rate is 0 when there are no AI turns', () => {
    const msgs = [userMsg('Hello.'), userMsg('Anyone there?')];
    const result = analyzeBargeIn(msgs);
    expect(result.rate).toBe(0);
  });

  it('rate is 1.0 when every AI turn was interrupted', () => {
    const msgs = [
      aiMsg('First.', true),
      userMsg('OK.'),
      aiMsg('Second.', true),
      userMsg('Sure.'),
    ];
    const result = analyzeBargeIn(msgs);
    expect(result.rate).toBe(1);
  });
});

// ─── netScoreAdjustment calculation and clamping ──────────────────────────────

describe('analyzeBargeIn — netScoreAdjustment', () => {
  it('positive barge-in produces a positive score adjustment', () => {
    const msgs = [
      aiMsg('We should review the report more carefully.', true),
      userMsg('I believe adding a dedicated review step would significantly improve quality.'),
    ];
    const result = analyzeBargeIn(msgs);
    expect(result.netScoreAdjustment).toBe(BARGE_IN_POSITIVE_BONUS);
  });

  it('negative barge-in produces a negative score adjustment', () => {
    const msgs = [
      aiMsg('How do you feel about this?', true),
      userMsg('I feel fine.'),
    ];
    const result = analyzeBargeIn(msgs);
    expect(result.netScoreAdjustment).toBe(-BARGE_IN_NEGATIVE_PENALTY);
  });

  it('clamps adjustment to BARGE_IN_MIN_ADJUSTMENT when many negative events', () => {
    const pairs: ConversationMessage[] = [];
    for (let i = 0; i < 10; i++) {
      pairs.push(aiMsg('What do you think?', true));
      pairs.push(userMsg('I agree.'));
    }
    const result = analyzeBargeIn(pairs);
    expect(result.netScoreAdjustment).toBe(BARGE_IN_MIN_ADJUSTMENT);
  });

  it('clamps adjustment to BARGE_IN_MAX_ADJUSTMENT when many positive events', () => {
    const pairs: ConversationMessage[] = [];
    for (let i = 0; i < 20; i++) {
      pairs.push(aiMsg('We should review the report more carefully here.', true));
      pairs.push(userMsg('I believe adding a dedicated review step would significantly improve the overall quality of our deliverables.'));
    }
    const result = analyzeBargeIn(pairs);
    expect(result.netScoreAdjustment).toBe(BARGE_IN_MAX_ADJUSTMENT);
  });

  it('mixed positive and negative adjustments are summed before clamping', () => {
    const msgs: ConversationMessage[] = [
      aiMsg('We should review the report more carefully.', true),
      userMsg('I believe adding a dedicated review step would significantly improve quality here.'),
      aiMsg('What do you think about that plan?', true),
      userMsg('I think it works.'),
    ];
    const result = analyzeBargeIn(msgs);
    const expected = Math.max(
      BARGE_IN_MIN_ADJUSTMENT,
      Math.min(BARGE_IN_MAX_ADJUSTMENT, BARGE_IN_POSITIVE_BONUS - BARGE_IN_NEGATIVE_PENALTY)
    );
    expect(result.netScoreAdjustment).toBe(expected);
  });
});

// ─── Summary generation ───────────────────────────────────────────────────────

describe('analyzeBargeIn — summary text', () => {
  it('no events → fixed no-barge-in summary', () => {
    const result = analyzeBargeIn([]);
    expect(result.summary).toBe('말 끊기(Barge-in)가 감지되지 않았습니다.');
  });

  it('negative majority → summary mentions negativeCount and total', () => {
    const msgs = [
      aiMsg('What is your opinion?', true),
      userMsg('I disagree.'),
      aiMsg('How does that work?', true),
      userMsg('It does not.'),
      aiMsg('We should proceed.', true),
      userMsg('I believe proceeding now would be really beneficial to the entire team and the project timeline.'),
    ];
    const result = analyzeBargeIn(msgs);
    expect(result.negativeCount).toBeGreaterThan(result.positiveCount);
    expect(result.summary).toContain(String(result.events.length));
    expect(result.summary).toContain(String(result.negativeCount));
  });

  it('positive majority → summary mentions positiveCount', () => {
    const msgs = [
      aiMsg('Let us proceed with option A.', true),
      userMsg('I believe option B is more cost-effective given our current budget constraints and timeline.'),
      aiMsg('We can also look at option C.', true),
      userMsg('Option C has several advantages that we should seriously consider before making our final decision.'),
    ];
    const result = analyzeBargeIn(msgs);
    expect(result.positiveCount).toBeGreaterThanOrEqual(result.negativeCount);
    expect(result.positiveCount).toBeGreaterThan(0);
    expect(result.summary).toContain(String(result.positiveCount));
  });

  it('all neutral → summary mentions total count and neutral framing', () => {
    const msgs = [
      aiMsg('OK.', true),
      userMsg('Sure.'),
    ];
    const result = analyzeBargeIn(msgs);
    expect(result.neutralCount).toBe(1);
    expect(result.summary).toContain(String(result.events.length));
  });
});

// ─── turnIndex tracking ───────────────────────────────────────────────────────

describe('analyzeBargeIn — turnIndex in events', () => {
  it('records correct turnIndex for each barge-in event', () => {
    const msgs = [
      aiMsg('First AI turn.', true),
      userMsg('OK.'),
      aiMsg('Second AI turn.'),
      userMsg('Sure.'),
      aiMsg('Third AI turn.', true),
      userMsg('Right.'),
    ];
    const result = analyzeBargeIn(msgs);
    expect(result.events[0].turnIndex).toBe(1);
    expect(result.events[1].turnIndex).toBe(3);
  });
});

// ─── Message truncation ───────────────────────────────────────────────────────

describe('analyzeBargeIn — message truncation in events', () => {
  it('truncates aiMessage to 120 chars + ellipsis when over 120 chars', () => {
    const longAi = 'A'.repeat(200);
    const msgs = [aiMsg(longAi, true), userMsg('OK.')];
    const result = analyzeBargeIn(msgs);
    expect(result.events[0].aiMessage).toHaveLength(123);
    expect(result.events[0].aiMessage.endsWith('...')).toBe(true);
  });

  it('does not append ellipsis when aiMessage is exactly 120 chars', () => {
    const exactAi = 'B'.repeat(120);
    const msgs = [aiMsg(exactAi, true), userMsg('OK.')];
    const result = analyzeBargeIn(msgs);
    expect(result.events[0].aiMessage).toBe(exactAi);
    expect(result.events[0].aiMessage.endsWith('...')).toBe(false);
  });

  it('ignores interrupted flag when there is no following user message', () => {
    const msgs = [aiMsg('Trailing AI message.', true)];
    const result = analyzeBargeIn(msgs);
    expect(result.count).toBe(0);
  });
});
