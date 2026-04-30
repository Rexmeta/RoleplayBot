import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleGeminiClose } from '../../server/services/voice/geminiReconnector';
import type { RealtimeSession } from '../../server/services/voice/types';
import WebSocket from 'ws';

function makeSession(overrides: Partial<RealtimeSession> = {}): RealtimeSession {
  return {
    id: 'session-1',
    conversationId: 'conv-1',
    scenarioId: 'scenario-1',
    personaId: 'persona-1',
    personaName: 'TestPersona',
    userId: 'user-1',
    clientWs: {
      readyState: WebSocket.OPEN,
      close: vi.fn(),
      send: vi.fn(),
    } as unknown as WebSocket,
    geminiSession: null,
    currentTranscript: '',
    userTranscriptBuffer: '',
    audioBuffer: [],
    startTime: Date.now(),
    lastActivityTime: Date.now(),
    totalUserTranscriptLength: 0,
    totalAiTranscriptLength: 0,
    realtimeModel: 'gemini-live',
    hasReceivedFirstAIResponse: false,
    hasTriggeredFirstGreeting: false,
    firstGreetingRetryCount: 0,
    isInterrupted: false,
    turnSeq: 0,
    cancelledTurnSeq: 0,
    sessionResumptionToken: null,
    isReconnecting: false,
    reconnectAttempts: 0,
    systemInstructions: 'instructions',
    voiceGender: 'female',
    recentMessages: [],
    selectedVoice: null,
    goAwayWarningTime: null,
    pendingClientReady: null,
    userLanguage: 'ko',
    ...overrides,
  };
}

describe('handleGeminiClose', () => {
  let session: RealtimeSession;
  let sessions: Map<string, RealtimeSession>;
  let sendToClient: ReturnType<typeof vi.fn>;
  let connectToGemini: ReturnType<typeof vi.fn>;
  let trackSessionUsage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    session = makeSession();
    sessions = new Map([['session-1', session]]);
    sendToClient = vi.fn();
    connectToGemini = vi.fn().mockResolvedValue(undefined);
    trackSessionUsage = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('normal close (code 1000)', () => {
    it('sends session.terminated and cleans up', () => {
      handleGeminiClose(
        { code: 1000, reason: 'Normal closure' },
        session,
        sessions,
        sendToClient,
        connectToGemini,
        trackSessionUsage
      );

      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'session.terminated' })
      );
      expect(trackSessionUsage).toHaveBeenCalledWith(session);
      expect(sessions.has('session-1')).toBe(false);
    });

    it('closes the client WebSocket on normal close', () => {
      handleGeminiClose(
        { code: 1000, reason: 'Normal closure' },
        session,
        sessions,
        sendToClient,
        connectToGemini,
        trackSessionUsage
      );

      expect(session.clientWs.close).toHaveBeenCalled();
    });

    it('does not attempt reconnection on normal close', () => {
      handleGeminiClose(
        { code: 1000, reason: 'Normal closure' },
        session,
        sessions,
        sendToClient,
        connectToGemini,
        trackSessionUsage
      );

      vi.runAllTimers();
      expect(connectToGemini).not.toHaveBeenCalled();
    });
  });

  describe('unexpected close – reconnection flow', () => {
    it('clears geminiSession immediately on close', () => {
      session.geminiSession = {} as any;
      handleGeminiClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToGemini,
        trackSessionUsage
      );

      expect(session.geminiSession).toBeNull();
    });

    it('sends session.reconnecting on first attempt', () => {
      handleGeminiClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToGemini,
        trackSessionUsage
      );

      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({
          type: 'session.reconnecting',
          attempt: 1,
          maxAttempts: 5,
        })
      );
    });

    it('calls connectToGemini after the backoff delay', async () => {
      handleGeminiClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToGemini,
        trackSessionUsage
      );

      await vi.runAllTimersAsync();
      expect(connectToGemini).toHaveBeenCalled();
    });

    it('sends session.reconnected after successful reconnect', async () => {
      handleGeminiClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToGemini,
        trackSessionUsage
      );

      await vi.runAllTimersAsync();

      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'session.reconnected' })
      );
    });

    it('resets reconnectAttempts to 0 after successful reconnect', async () => {
      handleGeminiClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToGemini,
        trackSessionUsage
      );

      await vi.runAllTimersAsync();

      expect(session.reconnectAttempts).toBe(0);
      expect(session.isReconnecting).toBe(false);
    });

    it('restores conversation context from recentMessages after reconnect', async () => {
      session.recentMessages = [
        { role: 'user', text: '안녕하세요' },
        { role: 'ai', text: '반갑습니다' },
      ];
      const mockGeminiSession = {
        sendClientContent: vi.fn(),
        sendRealtimeInput: vi.fn(),
      };
      connectToGemini.mockImplementation(async (sess: RealtimeSession) => {
        sess.geminiSession = mockGeminiSession;
      });

      handleGeminiClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToGemini,
        trackSessionUsage
      );

      await vi.runAllTimersAsync();

      expect(mockGeminiSession.sendClientContent).toHaveBeenCalled();
      const [callArg] = mockGeminiSession.sendClientContent.mock.calls[0];
      expect(callArg.turns[0].parts[0].text).toContain('안녕하세요');
      expect(callArg.turns[0].parts[0].text).toContain('반갑습니다');
    });

    it('sends a generic reconnect message when recentMessages is empty', async () => {
      session.recentMessages = [];
      const mockGeminiSession = {
        sendClientContent: vi.fn(),
        sendRealtimeInput: vi.fn(),
      };
      connectToGemini.mockImplementation(async (sess: RealtimeSession) => {
        sess.geminiSession = mockGeminiSession;
      });

      handleGeminiClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToGemini,
        trackSessionUsage
      );

      await vi.runAllTimersAsync();

      const [callArg] = mockGeminiSession.sendClientContent.mock.calls[0];
      expect(callArg.turns[0].parts[0].text).toContain('기술적 문제');
    });
  });

  describe('exponential backoff', () => {
    it('uses 1s delay for first attempt (2^0 * 1000)', () => {
      handleGeminiClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToGemini,
        trackSessionUsage
      );

      expect(connectToGemini).not.toHaveBeenCalled();
      vi.advanceTimersByTime(500);
      expect(connectToGemini).not.toHaveBeenCalled();
      vi.advanceTimersByTime(600);
      expect(connectToGemini).toHaveBeenCalled();
    });
  });

  describe('max reconnect attempts exceeded', () => {
    it('sends irrecoverable error and cleans up after 5 failures', async () => {
      session.reconnectAttempts = 0;
      connectToGemini.mockRejectedValue(new Error('Connection failed'));

      handleGeminiClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToGemini,
        trackSessionUsage
      );

      await vi.runAllTimersAsync();

      const errorCalls = sendToClient.mock.calls.filter(
        ([, msg]) => msg.type === 'error' && msg.recoverable === false
      );
      expect(errorCalls.length).toBeGreaterThan(0);
    });

    it('does not attempt reconnect when reconnectAttempts >= MAX_RECONNECT_ATTEMPTS', () => {
      session.reconnectAttempts = 5;

      handleGeminiClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToGemini,
        trackSessionUsage
      );

      vi.runAllTimers();
      expect(connectToGemini).not.toHaveBeenCalled();
    });
  });

  describe('client disconnected during reconnect', () => {
    it('cancels reconnect attempt if client WS is no longer open', () => {
      session.clientWs = {
        readyState: WebSocket.CLOSED,
        close: vi.fn(),
        send: vi.fn(),
      } as unknown as WebSocket;

      handleGeminiClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToGemini,
        trackSessionUsage
      );

      vi.runAllTimers();
      expect(connectToGemini).not.toHaveBeenCalled();
    });
  });

  describe('already reconnecting', () => {
    it('does not start a new reconnect attempt if isReconnecting is true', () => {
      session.isReconnecting = true;

      handleGeminiClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToGemini,
        trackSessionUsage
      );

      vi.runAllTimers();
      expect(connectToGemini).not.toHaveBeenCalled();
    });
  });
});
