import { describe, it, expect } from 'vitest';

/**
 * Pure unit tests for the addRealtimeUserMessage dedup guard logic.
 *
 * The guard inside useChatMessages#addRealtimeUserMessage suppresses a user
 * transcript only when it is identical to the immediately-preceding user turn
 * (adjacent dedup).  This targets reconnect-replay duplicates — which always
 * arrive consecutively — while preserving legitimate repeated short utterances
 * (e.g. "네" or "알겠습니다" said multiple times throughout a conversation).
 *
 * Rather than spinning up the full hook via renderHook (which is heavy), we
 * directly exercise the updater function that mirrors what setLocalMessages
 * receives.
 */

type LocalMessage = { sender: 'user' | 'ai'; message: string; timestamp: string };

/** Mirrors the setLocalMessages updater in addRealtimeUserMessage */
function dedupUpdater(transcript: string) {
  return (prev: LocalMessage[]): LocalMessage[] => {
    const lastMsg = prev.length > 0 ? prev[prev.length - 1] : null;
    if (lastMsg && lastMsg.sender === 'user' && lastMsg.message === transcript) {
      return prev;
    }
    return [
      ...prev,
      { sender: 'user', message: transcript, timestamp: new Date().toISOString() },
    ];
  };
}

describe('addRealtimeUserMessage — adjacent dedup updater', () => {
  it('appends the first occurrence of a user transcript', () => {
    const result = dedupUpdater('안녕하세요')([]);
    expect(result).toHaveLength(1);
    expect(result[0].message).toBe('안녕하세요');
    expect(result[0].sender).toBe('user');
  });

  it('suppresses a consecutive duplicate (reconnect replay)', () => {
    const prev: LocalMessage[] = [
      { sender: 'user', message: '중복 발화입니다', timestamp: '2025-01-01T00:00:00Z' },
    ];
    const result = dedupUpdater('중복 발화입니다')(prev);
    // Must return the same array reference (no mutation)
    expect(result).toBe(prev);
    expect(result).toHaveLength(1);
  });

  it('allows a second, different user transcript through', () => {
    const prev: LocalMessage[] = [
      { sender: 'user', message: '첫 번째 발화', timestamp: '2025-01-01T00:00:00Z' },
    ];
    const result = dedupUpdater('두 번째 발화')(prev);
    expect(result).toHaveLength(2);
    expect(result[1].message).toBe('두 번째 발화');
  });

  it('does not suppress an AI message that happens to have the same text', () => {
    // An AI turn with the same text as the incoming user transcript must NOT
    // block the user message — only a matching *user* last turn does.
    const prev: LocalMessage[] = [
      { sender: 'ai', message: '동일한 텍스트', timestamp: '2025-01-01T00:00:00Z' },
    ];
    const result = dedupUpdater('동일한 텍스트')(prev);
    expect(result).toHaveLength(2);
    expect(result[1].sender).toBe('user');
  });

  it('allows a repeated short utterance when separated by an AI turn (non-adjacent)', () => {
    // User says "네" → AI responds → user says "네" again.
    // The last *overall* message is an AI turn, so the second "네" must be kept.
    const prev: LocalMessage[] = [
      { sender: 'user', message: '네', timestamp: '2025-01-01T00:00:00Z' },
      { sender: 'ai',   message: '알겠습니다.', timestamp: '2025-01-01T00:00:01Z' },
    ];
    const result = dedupUpdater('네')(prev);
    expect(result).toHaveLength(3);
    expect(result[2].sender).toBe('user');
    expect(result[2].message).toBe('네');
  });

  it('is safe when replay delivers the same transcript three times — stored only once', () => {
    let state: LocalMessage[] = [];
    state = dedupUpdater('반복 발화')(state);
    state = dedupUpdater('반복 발화')(state);
    state = dedupUpdater('반복 발화')(state);
    expect(state).toHaveLength(1);
  });

  it('allows the same phrase again after a different phrase intervenes', () => {
    // "네" → "아니요" → "네": the second "네" must be stored because the last
    // user message at that point is "아니요", not "네".
    let state: LocalMessage[] = [];
    state = dedupUpdater('네')(state);
    state = dedupUpdater('아니요')(state);
    state = dedupUpdater('네')(state);
    expect(state).toHaveLength(3);
    expect(state.map(m => m.message)).toEqual(['네', '아니요', '네']);
  });
});

// ---------------------------------------------------------------------------
// Barge-in AI message replacement (onMessageComplete dedup)
// ---------------------------------------------------------------------------

type AiMessage = { sender: 'user' | 'ai'; message: string; timestamp: string; interrupted?: boolean };

/**
 * Mirrors the setLocalMessages updater inside ChatWindow's onMessageComplete.
 * interrupted = true  → the server sent a partial/cancelled AI turn
 * interrupted = false → the AI finished speaking naturally (or resumed)
 */
function aiMessageUpdater(message: string, interrupted: boolean) {
  return (prev: AiMessage[]): AiMessage[] => {
    // Exact-content dedup
    if (prev.some(m => m.sender === 'ai' && m.message === message)) return prev;
    // Barge-in replacement (must run before phase dedup so greeting barge-ins work)
    const lastMsg = prev.length > 0 ? prev[prev.length - 1] : null;
    if (lastMsg && lastMsg.sender === 'ai' && lastMsg.interrupted) {
      return [
        ...prev.slice(0, -1),
        { sender: 'ai', message, timestamp: new Date().toISOString(), interrupted },
      ];
    }
    // Phase dedup (greeting): AI has spoken but user hasn't — suppress retry duplicates
    const hasAi = prev.some(m => m.sender === 'ai');
    const hasUser = prev.some(m => m.sender === 'user');
    if (hasAi && !hasUser) return prev;
    return [...prev, { sender: 'ai', message, timestamp: new Date().toISOString(), interrupted }];
  };
}

describe('onMessageComplete — barge-in AI turn replacement', () => {
  it('interrupted partial AI turn is stored with interrupted=true', () => {
    const state = aiMessageUpdater('안녕하세요, 일정은...', true)([]);
    expect(state).toHaveLength(1);
    expect(state[0].interrupted).toBe(true);
  });

  it('resumed AI turn replaces the interrupted one — single AI entry remains', () => {
    let state: AiMessage[] = [];
    // Interrupted partial turn
    state = aiMessageUpdater('안녕하세요, 일정은...', true)(state);
    expect(state).toHaveLength(1);
    expect(state[0].interrupted).toBe(true);
    // Resumed / completed turn
    state = aiMessageUpdater('안녕하세요, 일정을 다시 안내하겠습니다.', false)(state);
    expect(state).toHaveLength(1);
    expect(state[0].message).toBe('안녕하세요, 일정을 다시 안내하겠습니다.');
    expect(state[0].interrupted).toBe(false);
  });

  it('normal (non-interrupted) AI turns are appended rather than replaced', () => {
    let state: AiMessage[] = [
      { sender: 'user', message: '안녕하세요', timestamp: '2025-01-01T00:00:00Z' },
    ];
    state = aiMessageUpdater('반갑습니다.', false)(state);
    state = aiMessageUpdater('무엇을 도와드릴까요?', false)(state);
    expect(state).toHaveLength(3);
    const aiMsgs = state.filter(m => m.sender === 'ai');
    expect(aiMsgs).toHaveLength(2);
  });

  it('does not replace when last AI message was NOT interrupted', () => {
    // Simulate a realistic mid-conversation state: user has already spoken, so
    // phase-dedup is inactive and two distinct completed AI turns should both be kept.
    let state: AiMessage[] = [
      { sender: 'user', message: '일정이 어떻게 됩니까?', timestamp: '2025-01-01T00:00:00Z' },
    ];
    state = aiMessageUpdater('첫 번째 완전한 응답.', false)(state);
    state = aiMessageUpdater('두 번째 완전한 응답.', false)(state);
    const aiMsgs = state.filter(m => m.sender === 'ai');
    expect(aiMsgs).toHaveLength(2);
    expect(aiMsgs[0].interrupted).toBe(false);
    expect(aiMsgs[1].interrupted).toBe(false);
  });
});
