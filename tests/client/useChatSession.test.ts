// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
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

vi.mock('@/lib/queryClient', () => ({
  apiRequest: vi.fn().mockResolvedValue({
    json: vi.fn().mockResolvedValue({}),
  }),
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
