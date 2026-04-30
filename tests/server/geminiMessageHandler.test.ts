import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleGeminiMessage } from '../../server/services/voice/geminiMessageHandler';
import type { RealtimeSession } from '../../server/services/voice/types';

vi.mock('../../server/services/voice/emotionAnalyzer', () => ({
  analyzeEmotion: vi.fn().mockResolvedValue({ emotion: '중립', emotionReason: '기본값' }),
}));

function makeSession(overrides: Partial<RealtimeSession> = {}): RealtimeSession {
  return {
    id: 'test-session',
    conversationId: 'conv-1',
    scenarioId: 'scenario-1',
    personaId: 'persona-1',
    personaName: 'TestPersona',
    userId: 'user-1',
    clientWs: {} as any,
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

describe('handleGeminiMessage', () => {
  let session: RealtimeSession;
  let sendToClient: ReturnType<typeof vi.fn>;
  let proactiveReconnect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    session = makeSession();
    sendToClient = vi.fn();
    proactiveReconnect = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('goAway handling', () => {
    it('triggers proactive reconnect when timeLeft > 3 and not already reconnecting', () => {
      handleGeminiMessage(
        session,
        { goAway: { timeLeft: 10 } },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(proactiveReconnect).toHaveBeenCalledWith(session);
      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'session.refreshing' })
      );
    });

    it('sends session.warning when timeLeft <= 3', () => {
      handleGeminiMessage(
        session,
        { goAway: { timeLeft: 2 } },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(proactiveReconnect).not.toHaveBeenCalled();
      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'session.warning', timeLeft: 2 })
      );
    });

    it('does not trigger proactive reconnect when session is already reconnecting', () => {
      session.isReconnecting = true;

      handleGeminiMessage(
        session,
        { goAway: { timeLeft: 10 } },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(proactiveReconnect).not.toHaveBeenCalled();
      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'session.warning' })
      );
    });

    it('stores goAway warning time on session', () => {
      const before = Date.now();
      handleGeminiMessage(
        session,
        { goAway: { timeLeft: 5 } },
        sendToClient,
        null,
        proactiveReconnect
      );
      expect(session.goAwayWarningTime).toBeGreaterThanOrEqual(before);
    });
  });

  describe('sessionResumption handling', () => {
    it('stores the resumption token on the session', () => {
      handleGeminiMessage(
        session,
        { sessionResumption: { handle: 'token-abc-123' } },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.sessionResumptionToken).toBe('token-abc-123');
      expect(sendToClient).not.toHaveBeenCalled();
    });

    it('ignores sessionResumption without a handle', () => {
      handleGeminiMessage(
        session,
        { sessionResumption: {} },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.sessionResumptionToken).toBeNull();
    });
  });

  describe('audio data (top-level message.data)', () => {
    it('forwards audio.delta to client when not interrupted', () => {
      session.isInterrupted = false;

      handleGeminiMessage(
        session,
        { data: 'base64audiodata==' },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'audio.delta', delta: 'base64audiodata==' })
      );
    });

    it('suppresses audio.delta when barge-in is active', () => {
      session.isInterrupted = true;

      handleGeminiMessage(
        session,
        { data: 'base64audiodata==' },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(sendToClient).not.toHaveBeenCalled();
    });

    it('includes current turnSeq in audio.delta message', () => {
      session.turnSeq = 3;

      handleGeminiMessage(
        session,
        { data: 'audio==' },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ turnSeq: 3 })
      );
    });
  });

  describe('inputTranscription', () => {
    it('accumulates transcript text in userTranscriptBuffer', () => {
      handleGeminiMessage(
        session,
        { serverContent: { inputTranscription: { text: '안녕' } } },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.userTranscriptBuffer).toBe('안녕');
    });

    it('sends user.speaking.started on first non-empty transcript chunk', () => {
      handleGeminiMessage(
        session,
        { serverContent: { inputTranscription: { text: '안녕' } } },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'user.speaking.started' })
      );
    });

    it('does not send user.speaking.started when buffer is already populated', () => {
      session.userTranscriptBuffer = '기존 내용';

      handleGeminiMessage(
        session,
        { serverContent: { inputTranscription: { text: ' 추가' } } },
        sendToClient,
        null,
        proactiveReconnect
      );

      const speakingStartedCalls = sendToClient.mock.calls.filter(
        ([, msg]) => msg.type === 'user.speaking.started'
      );
      expect(speakingStartedCalls).toHaveLength(0);
    });

    it('sends user.transcription.delta with accumulated text', () => {
      handleGeminiMessage(
        session,
        { serverContent: { inputTranscription: { text: '테스트' } } },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({
          type: 'user.transcription.delta',
          text: '테스트',
          accumulated: '테스트',
        })
      );
    });

    it('accumulates multiple chunks correctly', () => {
      handleGeminiMessage(
        session,
        { serverContent: { inputTranscription: { text: '안녕' } } },
        sendToClient,
        null,
        proactiveReconnect
      );
      handleGeminiMessage(
        session,
        { serverContent: { inputTranscription: { text: '하세요' } } },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.userTranscriptBuffer).toBe('안녕하세요');
    });
  });

  describe('turnComplete handling', () => {
    it('increments turnSeq on turn complete', () => {
      session.turnSeq = 2;
      session.hasReceivedFirstAIResponse = true;
      session.currentTranscript = '';

      handleGeminiMessage(
        session,
        { serverContent: { turnComplete: true } },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.turnSeq).toBe(3);
    });

    it('sends response.done on turn complete', () => {
      session.hasReceivedFirstAIResponse = true;

      handleGeminiMessage(
        session,
        { serverContent: { turnComplete: true } },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'response.done' })
      );
    });

    it('clears barge-in flag when new turn exceeds cancelled turn', () => {
      session.isInterrupted = true;
      session.turnSeq = 1;
      session.cancelledTurnSeq = 1;
      session.hasReceivedFirstAIResponse = true;

      handleGeminiMessage(
        session,
        { serverContent: { turnComplete: true } },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.isInterrupted).toBe(false);
      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'response.ready' })
      );
    });

    it('flushes userTranscriptBuffer as user.transcription message', () => {
      session.hasReceivedFirstAIResponse = true;
      session.userTranscriptBuffer = '  안녕하세요  ';

      handleGeminiMessage(
        session,
        { serverContent: { turnComplete: true } },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'user.transcription', transcript: '안녕하세요' })
      );
      expect(session.userTranscriptBuffer).toBe('');
    });

    it('pushes user message into recentMessages on turn complete', () => {
      session.hasReceivedFirstAIResponse = true;
      session.userTranscriptBuffer = '질문입니다';

      handleGeminiMessage(
        session,
        { serverContent: { turnComplete: true } },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.recentMessages).toContainEqual({ role: 'user', text: '질문입니다' });
    });

    it('retries greeting when no first AI response and retry count < 3', () => {
      session.hasReceivedFirstAIResponse = false;
      session.currentTranscript = '';
      session.firstGreetingRetryCount = 0;
      session.geminiSession = {
        sendClientContent: vi.fn(),
        sendRealtimeInput: vi.fn(),
      };

      handleGeminiMessage(
        session,
        { serverContent: { turnComplete: true } },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'greeting.retry', retryCount: 1 })
      );
      expect(session.firstGreetingRetryCount).toBe(1);
    });

    it('sends greeting.failed after 3 failed retries', () => {
      session.hasReceivedFirstAIResponse = false;
      session.currentTranscript = '';
      session.firstGreetingRetryCount = 3;

      handleGeminiMessage(
        session,
        { serverContent: { turnComplete: true } },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'greeting.failed' })
      );
    });
  });

  describe('modelTurn handling', () => {
    it('marks hasReceivedFirstAIResponse on first model turn', () => {
      session.hasReceivedFirstAIResponse = false;

      handleGeminiMessage(
        session,
        {
          serverContent: {
            modelTurn: { parts: [{ text: '안녕하세요!' }] },
          },
        },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.hasReceivedFirstAIResponse).toBe(true);
    });

    it('sends ai.transcription.delta for each text part', () => {
      handleGeminiMessage(
        session,
        {
          serverContent: {
            modelTurn: { parts: [{ text: '안녕하세요' }] },
          },
        },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'ai.transcription.delta', text: '안녕하세요' })
      );
    });

    it('accumulates text into currentTranscript', () => {
      handleGeminiMessage(
        session,
        {
          serverContent: {
            modelTurn: { parts: [{ text: '반갑' }, { text: '습니다' }] },
          },
        },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.currentTranscript).toBe('반갑습니다');
    });

    it('forwards inlineData audio when not interrupted', () => {
      handleGeminiMessage(
        session,
        {
          serverContent: {
            modelTurn: {
              parts: [{ inlineData: { data: 'audio==', mimeType: 'audio/pcm' } }],
            },
          },
        },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'audio.delta', delta: 'audio==' })
      );
    });

    it('suppresses inlineData audio when barge-in is active', () => {
      session.isInterrupted = true;

      handleGeminiMessage(
        session,
        {
          serverContent: {
            modelTurn: {
              parts: [{ inlineData: { data: 'audio==', mimeType: 'audio/pcm' } }],
            },
          },
        },
        sendToClient,
        null,
        proactiveReconnect
      );

      const audioCalls = sendToClient.mock.calls.filter(
        ([, msg]) => msg.type === 'audio.delta'
      );
      expect(audioCalls).toHaveLength(0);
    });

    it('suppresses audio for parts when thinking text is detected', () => {
      handleGeminiMessage(
        session,
        {
          serverContent: {
            modelTurn: {
              parts: [
                { text: "I'm focusing on the response" },
                { inlineData: { data: 'audio==', mimeType: 'audio/pcm' } },
              ],
            },
          },
        },
        sendToClient,
        null,
        proactiveReconnect
      );

      const audioCalls = sendToClient.mock.calls.filter(
        ([, msg]) => msg.type === 'audio.delta'
      );
      expect(audioCalls).toHaveLength(0);
    });
  });

  describe('outputTranscription handling', () => {
    it('accumulates outputTranscription into currentTranscript when no modelTurn', () => {
      handleGeminiMessage(
        session,
        { serverContent: { outputTranscription: { text: '안녕하세요' } } },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.currentTranscript).toBe('안녕하세요');
    });

    it('tracks total AI transcript length', () => {
      handleGeminiMessage(
        session,
        { serverContent: { outputTranscription: { text: '테스트' } } },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.totalAiTranscriptLength).toBe(3);
    });

    it('clears barge-in flag when new AI response starts while interrupted', () => {
      session.isInterrupted = true;

      handleGeminiMessage(
        session,
        { serverContent: { outputTranscription: { text: '다시 시작합니다' } } },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.isInterrupted).toBe(false);
      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'response.ready' })
      );
    });

    it('sends ai.transcription.delta after filtering Korean content', () => {
      handleGeminiMessage(
        session,
        { serverContent: { outputTranscription: { text: '안녕하세요' } } },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'ai.transcription.delta', text: '안녕하세요' })
      );
    });

    it('does not send ai.transcription.delta when text is pure thinking text', () => {
      handleGeminiMessage(
        session,
        { serverContent: { outputTranscription: { text: "I'm focusing on the response" } } },
        sendToClient,
        null,
        proactiveReconnect
      );

      const deltaCalls = sendToClient.mock.calls.filter(
        ([, msg]) => msg.type === 'ai.transcription.delta'
      );
      expect(deltaCalls).toHaveLength(0);
    });
  });

  describe('lastActivityTime update', () => {
    it('updates lastActivityTime on every call', () => {
      const oldTime = session.lastActivityTime;
      vi.advanceTimersByTime(100);

      handleGeminiMessage(
        session,
        { sessionResumption: { handle: 'tok' } },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.lastActivityTime).toBeGreaterThan(oldTime);
    });
  });
});
