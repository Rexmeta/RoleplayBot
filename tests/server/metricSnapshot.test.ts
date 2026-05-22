import { describe, it, expect } from 'vitest';
import { computeMetricSnapshot } from '../../server/routes/routerHelpers';
import type { MetricSnapshotInput } from '../../server/routes/routerHelpers';

function baseInput(overrides: Partial<MetricSnapshotInput> = {}): MetricSnapshotInput {
  return {
    trackedMetrics: [],
    emotionTimeline: [],
    simTurnScores: [],
    simIncidents: [],
    conversationDurationSeconds: 0,
    userMessages: [],
    ...overrides,
  };
}

// ─── angerMax ──────────────────────────────────────────────────────────────────

describe('computeMetricSnapshot – angerMax', () => {
  it('returns the highest anger value from the timeline', () => {
    const result = computeMetricSnapshot(baseInput({
      trackedMetrics: ['angerMax'],
      emotionTimeline: [{ anger: 30 }, { anger: 80 }, { anger: 50 }],
    }));
    expect(result.angerMax).toBe(80);
  });

  it('returns null when no anger values are present', () => {
    const result = computeMetricSnapshot(baseInput({
      trackedMetrics: ['angerMax'],
      emotionTimeline: [{ trust: 70 }, {}],
    }));
    expect(result.angerMax).toBeNull();
  });

  it('returns null for an empty timeline', () => {
    const result = computeMetricSnapshot(baseInput({ trackedMetrics: ['angerMax'] }));
    expect(result.angerMax).toBeNull();
  });
});

// ─── trustMin / trustMax ───────────────────────────────────────────────────────

describe('computeMetricSnapshot – trustMin', () => {
  it('returns the lowest trust value', () => {
    const result = computeMetricSnapshot(baseInput({
      trackedMetrics: ['trustMin'],
      emotionTimeline: [{ trust: 60 }, { trust: 20 }, { trust: 45 }],
    }));
    expect(result.trustMin).toBe(20);
  });

  it('returns null when no trust values exist', () => {
    const result = computeMetricSnapshot(baseInput({
      trackedMetrics: ['trustMin'],
      emotionTimeline: [{ anger: 50 }],
    }));
    expect(result.trustMin).toBeNull();
  });
});

describe('computeMetricSnapshot – trustMax', () => {
  it('returns the highest trust value', () => {
    const result = computeMetricSnapshot(baseInput({
      trackedMetrics: ['trustMax'],
      emotionTimeline: [{ trust: 60 }, { trust: 90 }, { trust: 45 }],
    }));
    expect(result.trustMax).toBe(90);
  });
});

// ─── trustAverage ──────────────────────────────────────────────────────────────

describe('computeMetricSnapshot – trustAverage', () => {
  it('returns a rounded average of trust values', () => {
    const result = computeMetricSnapshot(baseInput({
      trackedMetrics: ['trustAverage'],
      emotionTimeline: [{ trust: 10 }, { trust: 20 }, { trust: 30 }],
    }));
    expect(result.trustAverage).toBe(20);
  });

  it('rounds to nearest integer', () => {
    const result = computeMetricSnapshot(baseInput({
      trackedMetrics: ['trustAverage'],
      emotionTimeline: [{ trust: 10 }, { trust: 11 }],
    }));
    expect(result.trustAverage).toBe(11);
  });

  it('returns null for an empty timeline', () => {
    const result = computeMetricSnapshot(baseInput({ trackedMetrics: ['trustAverage'] }));
    expect(result.trustAverage).toBeNull();
  });

  it('ignores entries where trust is undefined', () => {
    const result = computeMetricSnapshot(baseInput({
      trackedMetrics: ['trustAverage'],
      emotionTimeline: [{ anger: 50 }, { trust: 40 }],
    }));
    expect(result.trustAverage).toBe(40);
  });
});

// ─── angerAverage ─────────────────────────────────────────────────────────────

describe('computeMetricSnapshot – angerAverage', () => {
  it('returns a rounded average of anger values', () => {
    const result = computeMetricSnapshot(baseInput({
      trackedMetrics: ['angerAverage'],
      emotionTimeline: [{ anger: 40 }, { anger: 60 }],
    }));
    expect(result.angerAverage).toBe(50);
  });

  it('returns null when no anger values exist', () => {
    const result = computeMetricSnapshot(baseInput({
      trackedMetrics: ['angerAverage'],
      emotionTimeline: [],
    }));
    expect(result.angerAverage).toBeNull();
  });
});

// ─── empathyAverage ───────────────────────────────────────────────────────────

describe('computeMetricSnapshot – empathyAverage', () => {
  it('returns a rounded average of empathy turn scores', () => {
    const result = computeMetricSnapshot(baseInput({
      trackedMetrics: ['empathyAverage'],
      simTurnScores: [
        { turnIndex: 1, turnScore: { empathy: 3, clarity: 4 } },
        { turnIndex: 2, turnScore: { empathy: 5 } },
        { turnIndex: 3, turnScore: { empathy: 4 } },
      ],
    }));
    expect(result.empathyAverage).toBe(4);
  });

  it('returns null when no turns have empathy scores', () => {
    const result = computeMetricSnapshot(baseInput({
      trackedMetrics: ['empathyAverage'],
      simTurnScores: [{ turnIndex: 1, turnScore: { clarity: 4 } }],
    }));
    expect(result.empathyAverage).toBeNull();
  });
});

// ─── escalationCount ──────────────────────────────────────────────────────────

describe('computeMetricSnapshot – escalationCount', () => {
  it('counts only escalation-type incidents', () => {
    const result = computeMetricSnapshot(baseInput({
      trackedMetrics: ['escalationCount'],
      simIncidents: [
        { turnIndex: 1, type: 'customer_escalation', severity: 'high' },
        { turnIndex: 2, type: 'manager_interrupt', severity: 'medium' },
        { turnIndex: 3, type: 'some_other_event', severity: 'low' },
        { turnIndex: 4, type: 'executive_join', severity: 'high' },
      ],
    }));
    expect(result.escalationCount).toBe(3);
  });

  it('returns 0 when there are no escalation incidents', () => {
    const result = computeMetricSnapshot(baseInput({
      trackedMetrics: ['escalationCount'],
      simIncidents: [{ turnIndex: 1, type: 'some_other_event', severity: 'low' }],
    }));
    expect(result.escalationCount).toBe(0);
  });

  it('returns 0 when simIncidents is empty', () => {
    const result = computeMetricSnapshot(baseInput({ trackedMetrics: ['escalationCount'] }));
    expect(result.escalationCount).toBe(0);
  });
});

// ─── interruptionCount ────────────────────────────────────────────────────────

describe('computeMetricSnapshot – interruptionCount', () => {
  it('returns the total number of simulation incidents', () => {
    const result = computeMetricSnapshot(baseInput({
      trackedMetrics: ['interruptionCount'],
      simIncidents: [
        { turnIndex: 1, type: 'a', severity: 'low' },
        { turnIndex: 2, type: 'b', severity: 'medium' },
      ],
    }));
    expect(result.interruptionCount).toBe(2);
  });

  it('returns 0 when there are no incidents', () => {
    const result = computeMetricSnapshot(baseInput({ trackedMetrics: ['interruptionCount'] }));
    expect(result.interruptionCount).toBe(0);
  });
});

// ─── timeToResolution ─────────────────────────────────────────────────────────

describe('computeMetricSnapshot – timeToResolution', () => {
  it('returns rounded conversation duration in seconds', () => {
    const result = computeMetricSnapshot(baseInput({
      trackedMetrics: ['timeToResolution'],
      conversationDurationSeconds: 123.7,
    }));
    expect(result.timeToResolution).toBe(124);
  });

  it('rounds down for .4 fractional values', () => {
    const result = computeMetricSnapshot(baseInput({
      trackedMetrics: ['timeToResolution'],
      conversationDurationSeconds: 90.4,
    }));
    expect(result.timeToResolution).toBe(90);
  });
});

// ─── totalTurns ───────────────────────────────────────────────────────────────

describe('computeMetricSnapshot – totalTurns', () => {
  it('returns the number of user messages', () => {
    const result = computeMetricSnapshot(baseInput({
      trackedMetrics: ['totalTurns'],
      userMessages: [{ message: 'hi' }, { message: 'ok' }, { message: 'thanks' }],
    }));
    expect(result.totalTurns).toBe(3);
  });

  it('returns 0 when there are no user messages', () => {
    const result = computeMetricSnapshot(baseInput({ trackedMetrics: ['totalTurns'] }));
    expect(result.totalTurns).toBe(0);
  });
});

// ─── turnsToFirstActionPlan ───────────────────────────────────────────────────

describe('computeMetricSnapshot – turnsToFirstActionPlan', () => {
  it('returns 1-based turn index of first message containing an action-plan keyword (Korean)', () => {
    const result = computeMetricSnapshot(baseInput({
      trackedMetrics: ['turnsToFirstActionPlan'],
      userMessages: [
        { message: '안녕하세요' },
        { message: '문제 해결책을 말씀드리겠습니다' },
        { message: '추가로 계획을 세우겠습니다' },
      ],
    }));
    expect(result.turnsToFirstActionPlan).toBe(2);
  });

  it('returns 1-based turn index for English keywords', () => {
    const result = computeMetricSnapshot(baseInput({
      trackedMetrics: ['turnsToFirstActionPlan'],
      userMessages: [
        { message: 'Let me think...' },
        { message: 'Here is my action plan for the issue.' },
      ],
    }));
    expect(result.turnsToFirstActionPlan).toBe(2);
  });

  it('returns null when no action-plan keyword is found', () => {
    const result = computeMetricSnapshot(baseInput({
      trackedMetrics: ['turnsToFirstActionPlan'],
      userMessages: [{ message: 'hello' }, { message: 'goodbye' }],
    }));
    expect(result.turnsToFirstActionPlan).toBeNull();
  });

  it('returns null for empty user messages', () => {
    const result = computeMetricSnapshot(baseInput({ trackedMetrics: ['turnsToFirstActionPlan'] }));
    expect(result.turnsToFirstActionPlan).toBeNull();
  });

  it('is case-insensitive for English keywords', () => {
    const result = computeMetricSnapshot(baseInput({
      trackedMetrics: ['turnsToFirstActionPlan'],
      userMessages: [{ message: 'Here is my Plan of Action.' }],
    }));
    expect(result.turnsToFirstActionPlan).toBe(1);
  });
});

// ─── unknown metric ───────────────────────────────────────────────────────────

describe('computeMetricSnapshot – unknown metric', () => {
  it('silently ignores unknown metric names', () => {
    const result = computeMetricSnapshot(baseInput({
      trackedMetrics: ['unknownMetric'],
      emotionTimeline: [{ anger: 50 }],
    }));
    expect(result).not.toHaveProperty('unknownMetric');
    expect(Object.keys(result)).toHaveLength(0);
  });
});

// ─── multiple metrics in one call ────────────────────────────────────────────

describe('computeMetricSnapshot – multiple metrics', () => {
  it('computes several metrics simultaneously', () => {
    const result = computeMetricSnapshot(baseInput({
      trackedMetrics: ['angerMax', 'trustAverage', 'totalTurns', 'escalationCount'],
      emotionTimeline: [{ anger: 30, trust: 60 }, { anger: 70, trust: 80 }],
      userMessages: [{ message: 'a' }, { message: 'b' }],
      simIncidents: [{ turnIndex: 1, type: 'customer_escalation', severity: 'high' }],
    }));
    expect(result.angerMax).toBe(70);
    expect(result.trustAverage).toBe(70);
    expect(result.totalTurns).toBe(2);
    expect(result.escalationCount).toBe(1);
  });
});
