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
