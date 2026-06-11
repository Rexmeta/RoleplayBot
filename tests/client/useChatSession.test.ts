// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef } from 'react';
import { useChatSession } from '../../client/src/hooks/chat/useChatSession';

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const mockApiRequest = vi.fn().mockResolvedValue({
  json: vi.fn().mockResolvedValue({}),
});

vi.mock('@/lib/queryClient', () => ({
  get apiRequest() { return mockApiRequest; },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

function buildDefaultOptions(overrides: Partial<Parameters<typeof useChatSession>[0]> = {}) {
  return {
    conversationId: 'conv-123',
    localMessages: [],
    pendingUserText: '',
    isPersonaMode: false,
    isNearingEnd: false,
    currentTurn: 5,
    targetTurns: 10,
    onChatComplete: vi.fn(),
    onExit: vi.fn(),
    onConversationEnding: vi.fn(),
    disconnectVoice: vi.fn(),
    resetPhase: vi.fn(),
    setLocalMessages: vi.fn(),
    setConversationStartTime: vi.fn(),
    setElapsedTime: vi.fn(),
    showMicPromptReset: vi.fn(),
    ...overrides,
  };
}

function renderChatSession(overrides: Partial<Parameters<typeof useChatSession>[0]> = {}) {
  const options = buildDefaultOptions(overrides);
  const { result } = renderHook(() => useChatSession(options));
  return { result, options };
}

describe('useChatSession — almost done warning flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('starts with showAlmostDoneDialog = false', () => {
      const { result } = renderChatSession();
      expect(result.current.showAlmostDoneDialog).toBe(false);
    });

    it('starts with showEndConversationDialog = false', () => {
      const { result } = renderChatSession();
      expect(result.current.showEndConversationDialog).toBe(false);
    });
  });

  describe('dialog shows at ≥80% progress (isNearingEnd = true)', () => {
    it('sets showAlmostDoneDialog to true when isNearingEnd is true and not in persona mode', () => {
      const { result } = renderChatSession({ isNearingEnd: true });

      act(() => {
        result.current.handleEndRealtimeConversation();
      });

      expect(result.current.showAlmostDoneDialog).toBe(true);
    });

    it('does NOT open the end conversation dialog when isNearingEnd is true', () => {
      const { result } = renderChatSession({ isNearingEnd: true });

      act(() => {
        result.current.handleEndRealtimeConversation();
      });

      expect(result.current.showEndConversationDialog).toBe(false);
    });
  });

  describe('dialog does NOT show below 80% (isNearingEnd = false)', () => {
    it('does not open almost done dialog when isNearingEnd is false', () => {
      const { result } = renderChatSession({ isNearingEnd: false });

      act(() => {
        result.current.handleEndRealtimeConversation();
      });

      expect(result.current.showAlmostDoneDialog).toBe(false);
    });

    it('opens the end conversation dialog directly when isNearingEnd is false', () => {
      const { result } = renderChatSession({ isNearingEnd: false });

      act(() => {
        result.current.handleEndRealtimeConversation();
      });

      expect(result.current.showEndConversationDialog).toBe(true);
    });
  });

  describe('"keep going" closes the almost done dialog', () => {
    it('sets showAlmostDoneDialog to false', () => {
      const { result } = renderChatSession({ isNearingEnd: true });

      act(() => {
        result.current.handleEndRealtimeConversation();
      });
      expect(result.current.showAlmostDoneDialog).toBe(true);

      act(() => {
        result.current.handleAlmostDoneKeepGoing();
      });

      expect(result.current.showAlmostDoneDialog).toBe(false);
    });

    it('does not open the end conversation dialog after keep going', () => {
      const { result } = renderChatSession({ isNearingEnd: true });

      act(() => {
        result.current.handleEndRealtimeConversation();
      });
      act(() => {
        result.current.handleAlmostDoneKeepGoing();
      });

      expect(result.current.showEndConversationDialog).toBe(false);
    });
  });

  describe('"exit anyway" proceeds to end conversation dialog', () => {
    it('closes the almost done dialog', () => {
      const { result } = renderChatSession({ isNearingEnd: true });

      act(() => {
        result.current.handleEndRealtimeConversation();
      });
      act(() => {
        result.current.handleAlmostDoneConfirmExit();
      });

      expect(result.current.showAlmostDoneDialog).toBe(false);
    });

    it('opens the end conversation dialog', () => {
      const { result } = renderChatSession({ isNearingEnd: true });

      act(() => {
        result.current.handleEndRealtimeConversation();
      });
      act(() => {
        result.current.handleAlmostDoneConfirmExit();
      });

      expect(result.current.showEndConversationDialog).toBe(true);
    });
  });

  describe('persona mode bypasses the warning entirely', () => {
    it('does not show almost done dialog in persona mode even if isNearingEnd is true', () => {
      const onExit = vi.fn();
      const disconnectVoice = vi.fn();
      const { result } = renderChatSession({
        isPersonaMode: true,
        isNearingEnd: true,
        onExit,
        disconnectVoice,
      });

      act(() => {
        result.current.handleEndRealtimeConversation();
      });

      expect(result.current.showAlmostDoneDialog).toBe(false);
      expect(onExit).toHaveBeenCalled();
    });
  });
});

// ─── flushRealtimeMessages failure-mode tests ─────────────────────────────────

describe('flushRealtimeMessages — pending guard preserved on failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiRequest.mockResolvedValue({ json: vi.fn().mockResolvedValue({}) });
  });

  it('keeps hasPendingLocalRef=true after a flush error so server refetch cannot overwrite local messages', async () => {
    // Arrange: hasPendingLocalRef starts true (voice messages are unsaved)
    const hasPendingLocalRef = { current: true };
    const localMessagesRef = { current: [
      { sender: 'ai'   as const, message: 'Hello', timestamp: '2025-01-01T00:00:00Z' },
      { sender: 'user' as const, message: 'Hi',    timestamp: '2025-01-01T00:00:01Z' },
    ]};

    // Make apiRequest reject to simulate network/server failure
    const networkError = new Error('Network error');
    mockApiRequest.mockRejectedValueOnce(networkError);

    const { result } = renderHook(() =>
      useChatSession(buildDefaultOptions({ hasPendingLocalRef, localMessagesRef }))
    );

    // Act: flush fails
    let caughtError: unknown;
    await act(async () => {
      try {
        await result.current.flushRealtimeMessages(false);
      } catch (e) {
        caughtError = e;
      }
    });

    // Assert: error was re-thrown (caller can detect failure)
    expect(caughtError).toBe(networkError);
    // Assert: pending guard is still latched — a server refetch must not overwrite local messages
    expect(hasPendingLocalRef.current).toBe(true);
  });

  it('clears hasPendingLocalRef=false only after a successful flush', async () => {
    const hasPendingLocalRef = { current: true };
    const localMessagesRef = { current: [
      { sender: 'ai'   as const, message: 'Hello', timestamp: '2025-01-01T00:00:00Z' },
    ]};

    mockApiRequest.mockResolvedValueOnce({ json: vi.fn().mockResolvedValue({}) });

    const { result } = renderHook(() =>
      useChatSession(buildDefaultOptions({ hasPendingLocalRef, localMessagesRef }))
    );

    await act(async () => {
      await result.current.flushRealtimeMessages(false);
    });

    // Successful save: guard must be cleared so server sync can resume
    expect(hasPendingLocalRef.current).toBe(false);
  });

  it('keeps hasPendingLocalRef=true across multiple consecutive flush failures (no bounded fallback)', async () => {
    const hasPendingLocalRef = { current: true };
    const localMessagesRef = { current: [
      { sender: 'user' as const, message: 'Important message', timestamp: '2025-01-01T00:00:00Z' },
    ]};

    // Simulate 5 consecutive failures (previously the 3-failure threshold cleared the guard)
    mockApiRequest.mockRejectedValue(new Error('Server unreachable'));

    const { result } = renderHook(() =>
      useChatSession(buildDefaultOptions({ hasPendingLocalRef, localMessagesRef }))
    );

    for (let i = 0; i < 5; i++) {
      await act(async () => {
        try { await result.current.flushRealtimeMessages(false); } catch {}
      });
    }

    // After 5 failures, local messages are still protected — guard must remain true
    expect(hasPendingLocalRef.current).toBe(true);
  });
});
