// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChatMessages } from '../../client/src/hooks/chat/useChatMessages';
import type { ConversationMessage } from '../../shared/schema';

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    reset: vi.fn(),
  }),
  useQueryClient: () => ({
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

vi.mock('@/lib/queryClient', () => ({
  apiRequest: vi.fn().mockResolvedValue({ json: vi.fn().mockResolvedValue({}) }),
  queryClient: { invalidateQueries: vi.fn() },
}));

function makeMsg(overrides: Partial<ConversationMessage> & { timestamp: string }): ConversationMessage {
  return {
    sender: 'ai',
    message: 'text',
    emotion: undefined,
    emotionReason: undefined,
    ...overrides,
  } as ConversationMessage;
}


describe('useChatMessages — sync effect sorting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sorts serverMessages by turnIndex ascending before setting localMessages', () => {
    const serverMessages = [
      makeMsg({ timestamp: '2025-01-01T00:00:02Z', turnIndex: 2, message: 'msg2' }),
      makeMsg({ timestamp: '2025-01-01T00:00:00Z', turnIndex: 0, message: 'msg0' }),
      makeMsg({ timestamp: '2025-01-01T00:00:01Z', turnIndex: 1, message: 'msg1' }),
    ];

    const { result } = renderHook(() =>
      useChatMessages({ conversationId: 'conv-1', serverMessages })
    );

    expect(result.current.localMessages.map(m => m.message)).toEqual(['msg0', 'msg1', 'msg2']);
  });

  it('places messages with null turnIndex last', () => {
    const serverMessages = [
      makeMsg({ timestamp: '2025-01-01T00:00:00Z', turnIndex: undefined, message: 'no-index' }),
      makeMsg({ timestamp: '2025-01-01T00:00:01Z', turnIndex: 1,         message: 'msg1' }),
      makeMsg({ timestamp: '2025-01-01T00:00:00Z', turnIndex: 0,         message: 'msg0' }),
    ];

    const { result } = renderHook(() =>
      useChatMessages({ conversationId: 'conv-1', serverMessages })
    );

    const messages = result.current.localMessages;
    expect(messages[0].message).toBe('msg0');
    expect(messages[1].message).toBe('msg1');
    expect(messages[2].message).toBe('no-index');
  });

  it('handles an already-sorted input without reordering', () => {
    const serverMessages = [
      makeMsg({ timestamp: '2025-01-01T00:00:00Z', turnIndex: 0, message: 'a' }),
      makeMsg({ timestamp: '2025-01-01T00:00:01Z', turnIndex: 1, message: 'b' }),
      makeMsg({ timestamp: '2025-01-01T00:00:02Z', turnIndex: 2, message: 'c' }),
    ];

    const { result } = renderHook(() =>
      useChatMessages({ conversationId: 'conv-1', serverMessages })
    );

    expect(result.current.localMessages.map(m => m.message)).toEqual(['a', 'b', 'c']);
  });

  it('re-sorts when serverMessages prop changes to a new reverse-ordered array', () => {
    let msgs = [
      makeMsg({ timestamp: '2025-01-01T00:00:01Z', turnIndex: 1, message: 'b' }),
      makeMsg({ timestamp: '2025-01-01T00:00:00Z', turnIndex: 0, message: 'a' }),
    ];

    const { result, rerender } = renderHook(
      ({ serverMessages }: { serverMessages: ConversationMessage[] }) =>
        useChatMessages({ conversationId: 'conv-1', serverMessages }),
      { initialProps: { serverMessages: msgs } }
    );

    expect(result.current.localMessages.map(m => m.message)).toEqual(['a', 'b']);

    const newMsgs = [
      makeMsg({ timestamp: '2025-01-01T00:00:02Z', turnIndex: 2, message: 'c' }),
      makeMsg({ timestamp: '2025-01-01T00:00:01Z', turnIndex: 1, message: 'b' }),
      makeMsg({ timestamp: '2025-01-01T00:00:00Z', turnIndex: 0, message: 'a' }),
    ];

    act(() => {
      rerender({ serverMessages: newMsgs });
    });

    expect(result.current.localMessages.map(m => m.message)).toEqual(['a', 'b', 'c']);
  });
});

describe('useChatMessages — realtime user turn identity', () => {
  it('suppresses a replayed turn even when another message arrived in between', () => {
    const { result } = renderHook(() =>
      useChatMessages({ conversationId: 'conv-voice' })
    );

    act(() => {
      result.current.addRealtimeUserMessage('정상 원문', 'voice-user:s:1');
      result.current.addRealtimeAiMessage('AI 응답');
      result.current.addRealtimeUserMessage('다른 언어로 바뀐 stale 값', 'voice-user:s:1');
    });

    expect(result.current.localMessages.map(m => m.message)).toEqual(['정상 원문', 'AI 응답']);
  });

  it('keeps legitimate repeated speech when each provider turn ID is different', () => {
    const { result } = renderHook(() =>
      useChatMessages({ conversationId: 'conv-repeat' })
    );

    act(() => {
      result.current.addRealtimeUserMessage('네', 'voice-user:s:1');
      result.current.addRealtimeUserMessage('네', 'voice-user:s:2');
    });

    expect(result.current.localMessages.map(m => m.message)).toEqual(['네', '네']);
    expect(result.current.localMessages.every(m => m.voiceTranscriptFinal === true)).toBe(true);
  });

  it('retains hydrated voice turn identity so a replay after reload is suppressed', () => {
    const hydrated = [
      makeMsg({
        sender: 'user',
        message: '저장된 원문',
        timestamp: '2026-01-01T00:00:00Z',
        turnIndex: 0,
        voiceTurnId: 'voice-user:hydrated:1',
        voiceTranscriptFinal: true,
      }),
    ];
    const { result } = renderHook(() =>
      useChatMessages({ conversationId: 'conv-hydrated', serverMessages: hydrated })
    );

    act(() => {
      result.current.addRealtimeUserMessage('stale replay', 'voice-user:hydrated:1');
    });

    expect(result.current.localMessages.map(m => m.message)).toEqual(['저장된 원문']);
  });

  it('replaces a provisional flush with the provider-final transcript for the same turn', () => {
    const { result } = renderHook(() =>
      useChatMessages({ conversationId: 'conv-provisional' })
    );

    act(() => {
      result.current.addRealtimeUserMessage('부분 전사', 'voice-user:session:9', false);
      result.current.addRealtimeUserMessage(
        '부분 전사가 아닌 제공자 최종 원문',
        'voice-user:session:9',
        true,
      );
    });

    expect(result.current.localMessages).toHaveLength(1);
    expect(result.current.localMessages[0]).toMatchObject({
      message: '부분 전사가 아닌 제공자 최종 원문',
      voiceTurnId: 'voice-user:session:9',
      voiceTranscriptFinal: true,
    });
  });
});
