import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleOpenAIClose } from '../../server/services/voice/openaiReconnector';
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
    realtimeModel: 'openai-realtime',
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
    pendingMessages: [],
    outgoingMessageIndex: 0,
    hasReceivedFirstAIAudio: false,
    hasReceivedFirstTranscriptDelta: false,
    greetingResponseCount: 0,
    userTurnsCompleted: 0,
    userSpeechStarted: false,
    simulationState: null,
    scenarioRunId: null,
    toolCallCountThisTurn: 0,
    emotionCallCountThisTurn: 0,
    currentTurnIncidentFired: false,
    lastEvaluatedUserTurnIndex: -1,
    lastEvaluatedUserTurnId: null,
    lastFinalizedUserTranscriptHash: null,
    lastClientContentSentAt: 0,
    greetingTimeoutId: null,
    pendingIsResuming: false,
    userName: 'testuser',
    ...overrides,
  };
}

describe('handleOpenAIClose', () => {
  let session: RealtimeSession;
  let sessions: Map<string, RealtimeSession>;
  let sendToClient: ReturnType<typeof vi.fn>;
  let connectToOpenAI: ReturnType<typeof vi.fn>;
  let trackSessionUsage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    session = makeSession();
    sessions = new Map([['session-1', session]]);
    sendToClient = vi.fn();
    connectToOpenAI = vi.fn().mockResolvedValue(undefined);
    trackSessionUsage = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('normal close (code 1000)', () => {
    it('sends session.terminated and cleans up', () => {
      handleOpenAIClose(
        { code: 1000, reason: 'Normal closure' },
        session,
        sessions,
        sendToClient,
        connectToOpenAI,
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
      handleOpenAIClose(
        { code: 1000, reason: 'Normal closure' },
        session,
        sessions,
        sendToClient,
        connectToOpenAI,
        trackSessionUsage
      );

      expect(session.clientWs.close).toHaveBeenCalled();
    });

    it('does not attempt reconnection on normal close', () => {
      handleOpenAIClose(
        { code: 1000, reason: 'Normal closure' },
        session,
        sessions,
        sendToClient,
        connectToOpenAI,
        trackSessionUsage
      );

      vi.runAllTimers();
      expect(connectToOpenAI).not.toHaveBeenCalled();
    });

    it('treats "Normal closure" reason string as normal close even with non-1000 code', () => {
      handleOpenAIClose(
        { code: 1001, reason: 'Normal closure' },
        session,
        sessions,
        sendToClient,
        connectToOpenAI,
        trackSessionUsage
      );

      vi.runAllTimers();
      expect(connectToOpenAI).not.toHaveBeenCalled();
      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'session.terminated' })
      );
    });
  });

  describe('fatal close codes — no retry', () => {
    const FATAL_CODES = [1008, 1011, 4001, 4003, 4004];

    for (const code of FATAL_CODES) {
      it(`sends irrecoverable error and closes client for fatal code ${code}`, () => {
        handleOpenAIClose(
          { code, reason: 'some error' },
          session,
          sessions,
          sendToClient,
          connectToOpenAI,
          trackSessionUsage
        );

        expect(sendToClient).toHaveBeenCalledWith(
          session,
          expect.objectContaining({ type: 'error', recoverable: false })
        );
        expect(trackSessionUsage).toHaveBeenCalledWith(session);
        expect(sessions.has('session-1')).toBe(false);
      });

      it(`does not attempt reconnect for fatal code ${code}`, () => {
        handleOpenAIClose(
          { code, reason: 'some error' },
          session,
          sessions,
          sendToClient,
          connectToOpenAI,
          trackSessionUsage
        );

        vi.runAllTimers();
        expect(connectToOpenAI).not.toHaveBeenCalled();
      });
    }

    it('detects fatal close by reason: invalid api key', () => {
      handleOpenAIClose(
        { code: 1006, reason: 'invalid api key provided' },
        session,
        sessions,
        sendToClient,
        connectToOpenAI,
        trackSessionUsage
      );

      vi.runAllTimers();
      expect(connectToOpenAI).not.toHaveBeenCalled();
      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'error', recoverable: false })
      );
    });

    it('detects fatal close by reason: unauthorized (case-insensitive)', () => {
      handleOpenAIClose(
        { code: 1006, reason: 'Unauthorized access' },
        session,
        sessions,
        sendToClient,
        connectToOpenAI,
        trackSessionUsage
      );

      vi.runAllTimers();
      expect(connectToOpenAI).not.toHaveBeenCalled();
    });

    it('detects fatal close by reason: billing', () => {
      handleOpenAIClose(
        { code: 1006, reason: 'billing limit exceeded' },
        session,
        sessions,
        sendToClient,
        connectToOpenAI,
        trackSessionUsage
      );

      vi.runAllTimers();
      expect(connectToOpenAI).not.toHaveBeenCalled();
    });
  });

  describe('unexpected close — reconnection flow', () => {
    it('clears geminiSession immediately on close', () => {
      session.geminiSession = {} as any;

      handleOpenAIClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToOpenAI,
        trackSessionUsage
      );

      expect(session.geminiSession).toBeNull();
    });

    it('sends session.reconnecting on first attempt', () => {
      handleOpenAIClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToOpenAI,
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

    it('calls connectToOpenAI after the backoff delay', async () => {
      handleOpenAIClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToOpenAI,
        trackSessionUsage
      );

      await vi.runAllTimersAsync();
      expect(connectToOpenAI).toHaveBeenCalled();
    });

    it('sends session.reconnected after successful reconnect', async () => {
      handleOpenAIClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToOpenAI,
        trackSessionUsage
      );

      await vi.runAllTimersAsync();

      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'session.reconnected' })
      );
    });

    it('resets reconnectAttempts and isReconnecting after successful reconnect', async () => {
      handleOpenAIClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToOpenAI,
        trackSessionUsage
      );

      await vi.runAllTimersAsync();

      expect(session.reconnectAttempts).toBe(0);
      expect(session.isReconnecting).toBe(false);
    });

    it('resets userSpeechStarted to false after successful reconnect', async () => {
      session.userSpeechStarted = true;

      handleOpenAIClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToOpenAI,
        trackSessionUsage
      );

      await vi.runAllTimersAsync();

      expect(session.userSpeechStarted).toBe(false);
    });

    it('resets isInterrupted and cancelledTurnSeq after successful reconnect', async () => {
      session.isInterrupted = true;
      session.cancelledTurnSeq = 3;

      handleOpenAIClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToOpenAI,
        trackSessionUsage
      );

      await vi.runAllTimersAsync();

      expect(session.isInterrupted).toBe(false);
      expect(session.cancelledTurnSeq).toBe(-1);
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
      connectToOpenAI.mockImplementation(async (sess: RealtimeSession) => {
        sess.geminiSession = mockGeminiSession;
      });

      handleOpenAIClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToOpenAI,
        trackSessionUsage
      );

      await vi.runAllTimersAsync();

      expect(mockGeminiSession.sendClientContent).toHaveBeenCalled();
      const [callArg] = mockGeminiSession.sendClientContent.mock.calls[0];
      expect(callArg.turns[0].parts[0].text).toContain('안녕하세요');
      expect(callArg.turns[0].parts[0].text).toContain('반갑습니다');
    });

    it('does not send context injection when recentMessages is empty', async () => {
      session.recentMessages = [];
      const mockGeminiSession = {
        sendClientContent: vi.fn(),
        sendRealtimeInput: vi.fn(),
      };
      connectToOpenAI.mockImplementation(async (sess: RealtimeSession) => {
        sess.geminiSession = mockGeminiSession;
      });

      handleOpenAIClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToOpenAI,
        trackSessionUsage
      );

      await vi.runAllTimersAsync();

      expect(mockGeminiSession.sendClientContent).not.toHaveBeenCalled();
      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'session.reconnected' })
      );
    });
  });

  describe('exponential backoff', () => {
    it('uses 1 s delay for the first attempt (2^0 * 1000)', () => {
      handleOpenAIClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToOpenAI,
        trackSessionUsage
      );

      expect(connectToOpenAI).not.toHaveBeenCalled();
      vi.advanceTimersByTime(500);
      expect(connectToOpenAI).not.toHaveBeenCalled();
      vi.advanceTimersByTime(600);
      expect(connectToOpenAI).toHaveBeenCalled();
    });

    it('uses 2 s delay for the second attempt (2^1 * 1000)', async () => {
      connectToOpenAI.mockRejectedValueOnce(new Error('first fail')).mockResolvedValue(undefined);

      handleOpenAIClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToOpenAI,
        trackSessionUsage
      );

      vi.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();

      const callsBefore = connectToOpenAI.mock.calls.length;
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
      expect(connectToOpenAI.mock.calls.length).toBe(callsBefore);

      vi.advanceTimersByTime(600);
      await Promise.resolve();
      expect(connectToOpenAI.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  describe('max reconnect attempts exceeded', () => {
    it('sends irrecoverable error and cleans up after 5 failures', async () => {
      session.reconnectAttempts = 0;
      connectToOpenAI.mockRejectedValue(new Error('Connection failed'));

      handleOpenAIClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToOpenAI,
        trackSessionUsage
      );

      await vi.runAllTimersAsync();

      const errorCalls = sendToClient.mock.calls.filter(
        ([, msg]: [any, any]) => msg.type === 'error' && msg.recoverable === false
      );
      expect(errorCalls.length).toBeGreaterThan(0);
      expect(sessions.has('session-1')).toBe(false);
    });

    it('closes the client WebSocket after max attempts exceeded', async () => {
      connectToOpenAI.mockRejectedValue(new Error('fail'));

      handleOpenAIClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToOpenAI,
        trackSessionUsage
      );

      await vi.runAllTimersAsync();

      expect(session.clientWs.close).toHaveBeenCalled();
    });

    it('does not attempt reconnect when reconnectAttempts >= MAX_RECONNECT_ATTEMPTS', () => {
      session.reconnectAttempts = 5;

      handleOpenAIClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToOpenAI,
        trackSessionUsage
      );

      vi.runAllTimers();
      expect(connectToOpenAI).not.toHaveBeenCalled();
    });

    it('calls trackSessionUsage after max attempts exceeded', async () => {
      connectToOpenAI.mockRejectedValue(new Error('fail'));

      handleOpenAIClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToOpenAI,
        trackSessionUsage
      );

      await vi.runAllTimersAsync();

      expect(trackSessionUsage).toHaveBeenCalled();
    });
  });

  describe('client disconnect cancels reconnect', () => {
    it('does not connect when client WS is already closed before first attempt', () => {
      session.clientWs = {
        readyState: WebSocket.CLOSED,
        close: vi.fn(),
        send: vi.fn(),
      } as unknown as WebSocket;

      handleOpenAIClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToOpenAI,
        trackSessionUsage
      );

      vi.runAllTimers();
      expect(connectToOpenAI).not.toHaveBeenCalled();
    });

    it('cancels reconnect if client disconnects between the close event and the backoff delay', async () => {
      handleOpenAIClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToOpenAI,
        trackSessionUsage
      );

      (session.clientWs as any).readyState = WebSocket.CLOSED;

      await vi.runAllTimersAsync();
      expect(connectToOpenAI).not.toHaveBeenCalled();
    });

    it('cancels reconnect if session is removed from the map (client gone)', async () => {
      handleOpenAIClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToOpenAI,
        trackSessionUsage
      );

      sessions.delete('session-1');

      await vi.runAllTimersAsync();
      expect(connectToOpenAI).not.toHaveBeenCalled();
    });

    it('cleans up the session and tracks usage when client disconnects mid-reconnect', async () => {
      handleOpenAIClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToOpenAI,
        trackSessionUsage
      );

      (session.clientWs as any).readyState = WebSocket.CLOSED;

      await vi.runAllTimersAsync();
      expect(trackSessionUsage).toHaveBeenCalled();
      expect(sessions.has('session-1')).toBe(false);
    });
  });

  describe('already reconnecting guard', () => {
    it('does not start a new reconnect attempt if isReconnecting is true', () => {
      session.isReconnecting = true;

      handleOpenAIClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToOpenAI,
        trackSessionUsage
      );

      vi.runAllTimers();
      expect(connectToOpenAI).not.toHaveBeenCalled();
    });
  });

  describe('pendingMessages replay after reconnect', () => {
    it('replays a realtimeInput pending message to the new session', async () => {
      const realtimePayload = { media: { data: 'audio-chunk-base64' } };
      session.pendingMessages = [
        { index: 0, payload: { type: 'realtimeInput', data: realtimePayload } },
      ];
      const mockGeminiSession = {
        sendClientContent: vi.fn(),
        sendRealtimeInput: vi.fn(),
      };
      connectToOpenAI.mockImplementation(async (sess: RealtimeSession) => {
        sess.geminiSession = mockGeminiSession;
      });

      handleOpenAIClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToOpenAI,
        trackSessionUsage
      );

      await vi.runAllTimersAsync();

      expect(mockGeminiSession.sendRealtimeInput).toHaveBeenCalledWith(realtimePayload);
      expect(mockGeminiSession.sendClientContent).not.toHaveBeenCalled();
    });

    it('replays a clientContent pending message to the new session', async () => {
      const clientContentPayload = {
        turns: [{ role: 'user', parts: [{ text: '계속 진행해요' }] }],
        turnComplete: true,
      };
      session.pendingMessages = [
        { index: 0, payload: { type: 'clientContent', data: clientContentPayload } },
      ];
      const mockGeminiSession = {
        sendClientContent: vi.fn(),
        sendRealtimeInput: vi.fn(),
      };
      connectToOpenAI.mockImplementation(async (sess: RealtimeSession) => {
        sess.geminiSession = mockGeminiSession;
      });

      handleOpenAIClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToOpenAI,
        trackSessionUsage
      );

      await vi.runAllTimersAsync();

      expect(mockGeminiSession.sendClientContent).toHaveBeenCalledWith(clientContentPayload);
      expect(mockGeminiSession.sendRealtimeInput).not.toHaveBeenCalled();
    });

    it('replays multiple pending messages in order', async () => {
      const payload1 = { media: { data: 'chunk-1' } };
      const payload2 = { media: { data: 'chunk-2' } };
      const payload3 = {
        turns: [{ role: 'user', parts: [{ text: 'hello' }] }],
        turnComplete: true,
      };
      session.pendingMessages = [
        { index: 0, payload: { type: 'realtimeInput', data: payload1 } },
        { index: 1, payload: { type: 'realtimeInput', data: payload2 } },
        { index: 2, payload: { type: 'clientContent', data: payload3 } },
      ];
      const callOrder: string[] = [];
      const mockGeminiSession = {
        sendClientContent: vi.fn(() => callOrder.push('clientContent')),
        sendRealtimeInput: vi.fn(() => callOrder.push('realtimeInput')),
      };
      connectToOpenAI.mockImplementation(async (sess: RealtimeSession) => {
        sess.geminiSession = mockGeminiSession;
      });

      handleOpenAIClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToOpenAI,
        trackSessionUsage
      );

      await vi.runAllTimersAsync();

      expect(mockGeminiSession.sendRealtimeInput).toHaveBeenCalledTimes(2);
      expect(mockGeminiSession.sendClientContent).toHaveBeenCalledTimes(1);
      expect(mockGeminiSession.sendRealtimeInput).toHaveBeenNthCalledWith(1, payload1);
      expect(mockGeminiSession.sendRealtimeInput).toHaveBeenNthCalledWith(2, payload2);
      expect(mockGeminiSession.sendClientContent).toHaveBeenCalledWith(payload3);
      expect(callOrder).toEqual(['realtimeInput', 'realtimeInput', 'clientContent']);
    });

    it('filters greeting + EOT messages from pendingMessages replay', async () => {
      const greetingPayload = {
        turns: [{ role: 'user', parts: [{ text: '안녕하세요' }] }],
      };
      const eotPayload = { event: 'END_OF_TURN' };
      const realPayload = { media: { data: 'real-audio' } };
      session.pendingMessages = [
        { index: 0, payload: { type: 'clientContent', data: greetingPayload } },
        { index: 1, payload: { type: 'realtimeInput', data: eotPayload } },
        { index: 2, payload: { type: 'realtimeInput', data: realPayload } },
      ];
      const mockGeminiSession = {
        sendClientContent: vi.fn(),
        sendRealtimeInput: vi.fn(),
      };
      connectToOpenAI.mockImplementation(async (sess: RealtimeSession) => {
        sess.geminiSession = mockGeminiSession;
      });

      handleOpenAIClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToOpenAI,
        trackSessionUsage
      );

      await vi.runAllTimersAsync();

      expect(mockGeminiSession.sendClientContent).not.toHaveBeenCalledWith(
        expect.objectContaining({ turns: expect.arrayContaining([expect.objectContaining({ parts: expect.arrayContaining([expect.objectContaining({ text: '안녕하세요' })]) })]) })
      );
      expect(mockGeminiSession.sendRealtimeInput).toHaveBeenCalledWith(realPayload);
    });

    it('falls back to context text when pendingMessages is empty', async () => {
      session.pendingMessages = [];
      session.recentMessages = [
        { role: 'user', text: '안녕하세요' },
        { role: 'ai', text: '반갑습니다' },
      ];
      const mockGeminiSession = {
        sendClientContent: vi.fn(),
        sendRealtimeInput: vi.fn(),
      };
      connectToOpenAI.mockImplementation(async (sess: RealtimeSession) => {
        sess.geminiSession = mockGeminiSession;
      });

      handleOpenAIClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToOpenAI,
        trackSessionUsage
      );

      await vi.runAllTimersAsync();

      expect(mockGeminiSession.sendClientContent).toHaveBeenCalledOnce();
      const [callArg] = mockGeminiSession.sendClientContent.mock.calls[0];
      expect(callArg.turns[0].parts[0].text).toContain('안녕하세요');
      expect(callArg.turns[0].parts[0].text).toContain('반갑습니다');
    });

    it('does not replay pending messages when geminiSession is null after reconnect', async () => {
      session.pendingMessages = [
        { index: 0, payload: { type: 'realtimeInput', data: { media: { data: 'x' } } } },
      ];
      connectToOpenAI.mockImplementation(async (_sess: RealtimeSession) => {
      });

      handleOpenAIClose(
        { code: 1006, reason: 'Abnormal closure' },
        session,
        sessions,
        sendToClient,
        connectToOpenAI,
        trackSessionUsage
      );

      await vi.runAllTimersAsync();

      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'session.reconnected' })
      );
    });
  });
});
