import { describe, it, expect } from 'vitest';
import { sortMessagesByTurnIndex } from '../../client/src/lib/messageSort';
import type { ConversationMessage } from '../../shared/schema';

function makeMsg(overrides: Partial<ConversationMessage> & { timestamp: string }): ConversationMessage {
  return {
    sender: 'ai',
    message: 'text',
    emotion: undefined,
    emotionReason: undefined,
    ...overrides,
  } as ConversationMessage;
}

describe('sortMessagesByTurnIndex', () => {
  it('sorts messages in ascending turnIndex order', () => {
    const msgs = [
      makeMsg({ timestamp: '2025-01-01T00:00:02Z', turnIndex: 2 }),
      makeMsg({ timestamp: '2025-01-01T00:00:00Z', turnIndex: 0 }),
      makeMsg({ timestamp: '2025-01-01T00:00:01Z', turnIndex: 1 }),
    ];
    const result = sortMessagesByTurnIndex(msgs);
    expect(result.map(m => m.turnIndex)).toEqual([0, 1, 2]);
  });

  it('places messages with null turnIndex last', () => {
    const msgs = [
      makeMsg({ timestamp: '2025-01-01T00:00:00Z', turnIndex: undefined }),
      makeMsg({ timestamp: '2025-01-01T00:00:01Z', turnIndex: 1 }),
      makeMsg({ timestamp: '2025-01-01T00:00:02Z', turnIndex: 0 }),
    ];
    const result = sortMessagesByTurnIndex(msgs);
    expect(result[0].turnIndex).toBe(0);
    expect(result[1].turnIndex).toBe(1);
    expect(result[2].turnIndex).toBeUndefined();
  });

  it('null turnIndex messages do NOT tie with turnIndex 0 — they sort after it', () => {
    const greeting = makeMsg({ timestamp: '2025-01-01T00:00:00Z', turnIndex: 0 });
    const nullMsg  = makeMsg({ timestamp: '2025-01-01T00:00:00Z', turnIndex: undefined });
    const result = sortMessagesByTurnIndex([nullMsg, greeting]);
    expect(result[0]).toBe(greeting);
    expect(result[1]).toBe(nullMsg);
  });

  it('breaks ties within the same turnIndex by timestamp ascending', () => {
    const msgs = [
      makeMsg({ timestamp: '2025-01-01T00:00:02Z', turnIndex: 1, message: 'later' }),
      makeMsg({ timestamp: '2025-01-01T00:00:00Z', turnIndex: 1, message: 'earlier' }),
    ];
    const result = sortMessagesByTurnIndex(msgs);
    expect(result[0].message).toBe('earlier');
    expect(result[1].message).toBe('later');
  });

  it('handles a reverse-ordered input array correctly', () => {
    const msgs = [
      makeMsg({ timestamp: '2025-01-01T00:00:04Z', turnIndex: 4 }),
      makeMsg({ timestamp: '2025-01-01T00:00:03Z', turnIndex: 3 }),
      makeMsg({ timestamp: '2025-01-01T00:00:02Z', turnIndex: 2 }),
      makeMsg({ timestamp: '2025-01-01T00:00:01Z', turnIndex: 1 }),
      makeMsg({ timestamp: '2025-01-01T00:00:00Z', turnIndex: 0 }),
    ];
    const result = sortMessagesByTurnIndex(msgs);
    expect(result.map(m => m.turnIndex)).toEqual([0, 1, 2, 3, 4]);
  });

  it('does not mutate the original array', () => {
    const msgs = [
      makeMsg({ timestamp: '2025-01-01T00:00:01Z', turnIndex: 1 }),
      makeMsg({ timestamp: '2025-01-01T00:00:00Z', turnIndex: 0 }),
    ];
    const original = [...msgs];
    sortMessagesByTurnIndex(msgs);
    expect(msgs[0]).toBe(original[0]);
    expect(msgs[1]).toBe(original[1]);
  });

  it('returns an empty array unchanged', () => {
    expect(sortMessagesByTurnIndex([])).toEqual([]);
  });

  it('handles a single message', () => {
    const msg = makeMsg({ timestamp: '2025-01-01T00:00:00Z', turnIndex: 5 });
    expect(sortMessagesByTurnIndex([msg])).toEqual([msg]);
  });

  it('multiple null-turnIndex messages are ordered by timestamp among themselves', () => {
    const msgs = [
      makeMsg({ timestamp: '2025-01-01T00:00:03Z', turnIndex: undefined, message: 'c' }),
      makeMsg({ timestamp: '2025-01-01T00:00:01Z', turnIndex: undefined, message: 'a' }),
      makeMsg({ timestamp: '2025-01-01T00:00:02Z', turnIndex: undefined, message: 'b' }),
    ];
    const result = sortMessagesByTurnIndex(msgs);
    expect(result.map(m => m.message)).toEqual(['a', 'b', 'c']);
  });
});
