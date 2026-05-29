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
    totalCachedTokens: 0,
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
    hasReceivedFirstTranscriptDelta: false,
    greetingResponseCount: 0,
    userTurnsCompleted: 0,
    userSpeechStarted: false,
    usingReconnectInstructions: false,
    activePersonaIndex: 0,
    voiceId: null,
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

    it('suppresses audio.delta when isInterrupted=true and turnSeq matches cancelledTurnSeq', () => {
      session.isInterrupted = true;
      session.turnSeq = 2;
      session.cancelledTurnSeq = 2;

      handleGeminiMessage(
        session,
        { data: 'base64audiodata==' },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(sendToClient).not.toHaveBeenCalled();
      expect(session.isInterrupted).toBe(true);
    });

    it('forwards audio.delta and clears isInterrupted when turnSeq exceeds cancelledTurnSeq', () => {
      session.isInterrupted = true;
      session.turnSeq = 3;
      session.cancelledTurnSeq = 2;

      handleGeminiMessage(
        session,
        { data: 'newturnaudio==' },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.isInterrupted).toBe(false);
      expect(session.cancelledTurnSeq).toBe(-1);
      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'audio.delta', delta: 'newturnaudio==', turnSeq: 3 })
      );
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

    it('skips top-level audio.delta when inlineData is present in modelTurn, even when isInterrupted=true', () => {
      // Both top-level message.data AND inlineData in modelTurn are present,
      // and a barge-in is active. The top-level bytes must be suppressed due
      // to hasInlineDataInModelTurn taking priority — not merely due to the
      // barge-in guard. This ensures inlineData remains the sole audio source.
      session.isInterrupted = true;
      session.turnSeq = 5;
      session.cancelledTurnSeq = 3; // turnSeq > cancelledTurnSeq → barge-in would clear, but inlineData guard fires first

      handleGeminiMessage(
        session,
        {
          data: 'toplevelaudio==',
          serverContent: {
            modelTurn: {
              parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'inlineaudio==' } }],
            },
          },
        },
        sendToClient,
        null,
        proactiveReconnect
      );

      // No audio.delta for top-level bytes — inlineData path owns the audio
      expect(sendToClient).not.toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'audio.delta', delta: 'toplevelaudio==' })
      );
    });

    it('skips top-level audio when inlineData is present in modelTurn even when NOT interrupted', () => {
      session.isInterrupted = false;

      handleGeminiMessage(
        session,
        {
          data: 'toplevel==',
          serverContent: {
            modelTurn: {
              parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'inline==' } }],
            },
          },
        },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(sendToClient).not.toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'audio.delta', delta: 'toplevel==' })
      );
    });

    it('sets hasReceivedFirstAIAudio=true on first top-level audio delivery', () => {
      session.hasReceivedFirstAIAudio = false;
      session.isInterrupted = false;

      handleGeminiMessage(session, { data: 'firstchunk==' }, sendToClient, null, proactiveReconnect);

      expect(session.hasReceivedFirstAIAudio).toBe(true);
    });
  });

  describe('audio data (inlineData path)', () => {
    it('forwards audio.delta (from inlineData) when not interrupted', () => {
      session.isInterrupted = false;

      handleGeminiMessage(
        session,
        {
          serverContent: {
            modelTurn: {
              parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'inlineaudio==' } }],
            },
          },
        },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'audio.delta', delta: 'inlineaudio==' })
      );
    });

    it('suppresses audio.delta when isInterrupted=true and turnSeq <= cancelledTurnSeq', () => {
      session.isInterrupted = true;
      session.turnSeq = 4;
      session.cancelledTurnSeq = 4;

      handleGeminiMessage(
        session,
        {
          serverContent: {
            modelTurn: {
              parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'suppressedaudio==' } }],
            },
          },
        },
        sendToClient,
        null,
        proactiveReconnect
      );

      const audioCalls = sendToClient.mock.calls.filter(([, msg]) => msg.type === 'audio.delta');
      expect(audioCalls).toHaveLength(0);
      expect(session.isInterrupted).toBe(true);
    });

    it('clears isInterrupted and forwards audio.delta when turnSeq > cancelledTurnSeq', () => {
      session.isInterrupted = true;
      session.turnSeq = 5;
      session.cancelledTurnSeq = 4;

      handleGeminiMessage(
        session,
        {
          serverContent: {
            modelTurn: {
              parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'newturndata==' } }],
            },
          },
        },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.isInterrupted).toBe(false);
      expect(session.cancelledTurnSeq).toBe(-1);
      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'audio.delta', delta: 'newturndata==', turnSeq: 5 })
      );
    });

    it('sets hasReceivedFirstAIAudio=true and hasReceivedFirstAIResponse=true on first inlineData audio delivery', () => {
      session.hasReceivedFirstAIAudio = false;
      session.hasReceivedFirstAIResponse = false;

      handleGeminiMessage(
        session,
        {
          serverContent: {
            modelTurn: {
              parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'inlinefirst==' } }],
            },
          },
        },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.hasReceivedFirstAIAudio).toBe(true);
      expect(session.hasReceivedFirstAIResponse).toBe(true);
    });

    it('does not set hasReceivedFirstAIAudio when inlineData is suppressed by barge-in guard', () => {
      session.hasReceivedFirstAIAudio = false;
      session.isInterrupted = true;
      session.turnSeq = 2;
      session.cancelledTurnSeq = 2;

      handleGeminiMessage(
        session,
        {
          serverContent: {
            modelTurn: {
              parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'stale==' } }],
            },
          },
        },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.hasReceivedFirstAIAudio).toBe(false);
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

    it('suppresses inlineData audio when barge-in is active and turnSeq matches cancelledTurnSeq', () => {
      session.isInterrupted = true;
      session.turnSeq = 2;
      session.cancelledTurnSeq = 2;

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

      const audioCalls = sendToClient.mock.calls.filter(([, msg]) => msg.type === 'audio.delta');
      expect(audioCalls).toHaveLength(0);
      expect(session.isInterrupted).toBe(true);
    });

    it('plays inlineData audio and clears isInterrupted when turnSeq exceeds cancelledTurnSeq', () => {
      session.isInterrupted = true;
      session.turnSeq = 3;
      session.cancelledTurnSeq = 2;

      handleGeminiMessage(
        session,
        {
          serverContent: {
            modelTurn: {
              parts: [{ inlineData: { data: 'newturnaudio==', mimeType: 'audio/pcm' } }],
            },
          },
        },
        sendToClient,
        null,
        proactiveReconnect
      );

      const audioCalls = sendToClient.mock.calls.filter(([, msg]) => msg.type === 'audio.delta');
      expect(audioCalls).toHaveLength(1);
      expect(audioCalls[0][1]).toMatchObject({ type: 'audio.delta', delta: 'newturnaudio==' });
      expect(session.isInterrupted).toBe(false);
      expect(session.cancelledTurnSeq).toBe(-1);
    });

    it('suppresses inlineData audio when duplicate greeting guard is active (greetingResponseCount>=1, userTurnsCompleted=0, userSpeechStarted=false)', () => {
      session.greetingResponseCount = 1;
      session.userTurnsCompleted = 0;
      session.userSpeechStarted = false;

      handleGeminiMessage(
        session,
        {
          serverContent: {
            modelTurn: {
              parts: [{ inlineData: { data: 'greetaudio==', mimeType: 'audio/pcm' } }],
            },
          },
        },
        sendToClient,
        null,
        proactiveReconnect
      );

      const audioCalls = sendToClient.mock.calls.filter(([, msg]) => msg.type === 'audio.delta');
      expect(audioCalls).toHaveLength(0);
    });

    it('allows inlineData audio once userSpeechStarted=true even when greetingResponseCount>=1 and userTurnsCompleted=0', () => {
      session.greetingResponseCount = 1;
      session.userTurnsCompleted = 0;
      session.userSpeechStarted = true;

      handleGeminiMessage(
        session,
        {
          serverContent: {
            modelTurn: {
              parts: [{ inlineData: { data: 'useraudio==', mimeType: 'audio/pcm' } }],
            },
          },
        },
        sendToClient,
        null,
        proactiveReconnect
      );

      const audioCalls = sendToClient.mock.calls.filter(([, msg]) => msg.type === 'audio.delta');
      expect(audioCalls).toHaveLength(1);
      expect(audioCalls[0][1]).toMatchObject({ type: 'audio.delta', delta: 'useraudio==' });
    });

    it('allows inlineData audio when greetingResponseCount=0 regardless of userSpeechStarted', () => {
      session.greetingResponseCount = 0;
      session.userTurnsCompleted = 0;
      session.userSpeechStarted = false;

      handleGeminiMessage(
        session,
        {
          serverContent: {
            modelTurn: {
              parts: [{ inlineData: { data: 'firstgreet==', mimeType: 'audio/pcm' } }],
            },
          },
        },
        sendToClient,
        null,
        proactiveReconnect
      );

      const audioCalls = sendToClient.mock.calls.filter(([, msg]) => msg.type === 'audio.delta');
      expect(audioCalls).toHaveLength(1);
    });

    it('does not suppress audio when userTurnsCompleted >= 1, even if greetingResponseCount >= 1', () => {
      session.greetingResponseCount = 1;
      session.userTurnsCompleted = 1;
      session.userSpeechStarted = false;

      handleGeminiMessage(
        session,
        {
          serverContent: {
            modelTurn: {
              parts: [{ inlineData: { data: 'postgreeting==', mimeType: 'audio/pcm' } }],
            },
          },
        },
        sendToClient,
        null,
        proactiveReconnect
      );

      const audioCalls = sendToClient.mock.calls.filter(([, msg]) => msg.type === 'audio.delta');
      expect(audioCalls).toHaveLength(1);
    });

    it('does not set hasReceivedFirstAIAudio when inlineData is suppressed by greeting guard', () => {
      session.hasReceivedFirstAIAudio = false;
      session.greetingResponseCount = 1;
      session.userTurnsCompleted = 0;
      session.userSpeechStarted = false;

      handleGeminiMessage(
        session,
        {
          serverContent: {
            modelTurn: {
              parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'dupgreet==' } }],
            },
          },
        },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.hasReceivedFirstAIAudio).toBe(false);
    });

    it('does not set hasReceivedFirstAIAudio when inlineData is suppressed by thinking text guard', () => {
      session.hasReceivedFirstAIAudio = false;

      handleGeminiMessage(
        session,
        {
          serverContent: {
            modelTurn: {
              parts: [
                { text: "I'm focusing on the response" },
                { inlineData: { mimeType: 'audio/pcm', data: 'thinkingaudio==' } },
              ],
            },
          },
        },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.hasReceivedFirstAIAudio).toBe(false);
    });
  });

  describe('audio suppression guard combinations (inlineData path)', () => {
    it('barge-in active (stale turn) + greeting guard both active: barge-in fires first and suppresses', () => {
      session.isInterrupted = true;
      session.turnSeq = 2;
      session.cancelledTurnSeq = 2;
      session.greetingResponseCount = 1;
      session.userTurnsCompleted = 0;
      session.userSpeechStarted = false;

      handleGeminiMessage(
        session,
        {
          serverContent: {
            modelTurn: {
              parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'combined==' } }],
            },
          },
        },
        sendToClient,
        null,
        proactiveReconnect
      );

      const audioCalls = sendToClient.mock.calls.filter(([, msg]) => msg.type === 'audio.delta');
      expect(audioCalls).toHaveLength(0);
      // Barge-in fires via continue — isInterrupted stays true
      expect(session.isInterrupted).toBe(true);
    });

    it('barge-in clears on new turn but greeting guard still suppresses audio', () => {
      session.isInterrupted = true;
      session.turnSeq = 3;
      session.cancelledTurnSeq = 2;
      session.greetingResponseCount = 1;
      session.userTurnsCompleted = 0;
      session.userSpeechStarted = false;

      handleGeminiMessage(
        session,
        {
          serverContent: {
            modelTurn: {
              parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'newturndupgreet==' } }],
            },
          },
        },
        sendToClient,
        null,
        proactiveReconnect
      );

      // Barge-in is cleared because turnSeq > cancelledTurnSeq
      expect(session.isInterrupted).toBe(false);
      expect(session.cancelledTurnSeq).toBe(-1);
      // Greeting guard fires next and suppresses the audio
      const audioCalls = sendToClient.mock.calls.filter(([, msg]) => msg.type === 'audio.delta');
      expect(audioCalls).toHaveLength(0);
    });

    it('barge-in active (stale turn) + thinking text both present: barge-in fires first and suppresses', () => {
      session.isInterrupted = true;
      session.turnSeq = 2;
      session.cancelledTurnSeq = 2;

      handleGeminiMessage(
        session,
        {
          serverContent: {
            modelTurn: {
              parts: [
                { text: "I'm focusing on the response" },
                { inlineData: { mimeType: 'audio/pcm', data: 'thinkbargein==' } },
              ],
            },
          },
        },
        sendToClient,
        null,
        proactiveReconnect
      );

      const audioCalls = sendToClient.mock.calls.filter(([, msg]) => msg.type === 'audio.delta');
      expect(audioCalls).toHaveLength(0);
      // Barge-in fires via continue — isInterrupted stays true
      expect(session.isInterrupted).toBe(true);
    });

    it('barge-in clears on new turn but thinking text guard still suppresses audio', () => {
      session.isInterrupted = true;
      session.turnSeq = 3;
      session.cancelledTurnSeq = 2;

      handleGeminiMessage(
        session,
        {
          serverContent: {
            modelTurn: {
              parts: [
                { text: "I'm focusing on the response" },
                { inlineData: { mimeType: 'audio/pcm', data: 'thinknewturn==' } },
              ],
            },
          },
        },
        sendToClient,
        null,
        proactiveReconnect
      );

      // Barge-in is cleared
      expect(session.isInterrupted).toBe(false);
      expect(session.cancelledTurnSeq).toBe(-1);
      // Thinking text guard fires and suppresses the audio
      const audioCalls = sendToClient.mock.calls.filter(([, msg]) => msg.type === 'audio.delta');
      expect(audioCalls).toHaveLength(0);
    });

    it('greeting guard + thinking text both active: both suppress (guards are independent continue statements)', () => {
      session.isInterrupted = false;
      session.greetingResponseCount = 1;
      session.userTurnsCompleted = 0;
      session.userSpeechStarted = false;

      handleGeminiMessage(
        session,
        {
          serverContent: {
            modelTurn: {
              parts: [
                { text: "I'm focusing on the response" },
                { inlineData: { mimeType: 'audio/pcm', data: 'greetthink==' } },
              ],
            },
          },
        },
        sendToClient,
        null,
        proactiveReconnect
      );

      const audioCalls = sendToClient.mock.calls.filter(([, msg]) => msg.type === 'audio.delta');
      expect(audioCalls).toHaveLength(0);
    });

    it('all three guards inactive: audio plays through', () => {
      session.isInterrupted = false;
      session.greetingResponseCount = 0;
      session.userTurnsCompleted = 0;
      session.userSpeechStarted = false;

      handleGeminiMessage(
        session,
        {
          serverContent: {
            modelTurn: {
              parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'clean==' } }],
            },
          },
        },
        sendToClient,
        null,
        proactiveReconnect
      );

      const audioCalls = sendToClient.mock.calls.filter(([, msg]) => msg.type === 'audio.delta');
      expect(audioCalls).toHaveLength(1);
      expect(audioCalls[0][1]).toMatchObject({ type: 'audio.delta', delta: 'clean==' });
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

  describe('retry duplicate greeting prevention', () => {
    it('retry response sets hasReceivedFirstAIResponse when modelTurn arrives after retry', () => {
      session.hasReceivedFirstAIResponse = false;
      session.firstGreetingRetryCount = 1;

      handleGeminiMessage(
        session,
        {
          serverContent: {
            modelTurn: { parts: [{ text: '안녕하세요, 무슨 일이시죠?' }] },
          },
        },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.hasReceivedFirstAIResponse).toBe(true);
    });

    it('does NOT trigger another retry when AI has responded (hasReceivedFirstAIResponse = true)', () => {
      session.hasReceivedFirstAIResponse = true;
      session.currentTranscript = '';
      session.firstGreetingRetryCount = 1;
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

      expect(session.geminiSession.sendClientContent).not.toHaveBeenCalled();
      const greetingRetryCalls = sendToClient.mock.calls.filter(
        ([, msg]) => msg.type === 'greeting.retry'
      );
      expect(greetingRetryCalls).toHaveLength(0);
    });

    it('combined modelTurn + turnComplete payload: hasReceivedFirstAIResponse set and no spurious retry', async () => {
      session.hasReceivedFirstAIResponse = false;
      session.firstGreetingRetryCount = 0;
      session.geminiSession = {
        sendClientContent: vi.fn(),
        sendRealtimeInput: vi.fn(),
      };

      handleGeminiMessage(
        session,
        {
          serverContent: {
            modelTurn: { parts: [{ text: '안녕하세요, 만나서 반갑습니다.' }] },
            turnComplete: true,
          },
        },
        sendToClient,
        null,
        proactiveReconnect
      );

      await vi.runAllTimersAsync();

      expect(session.hasReceivedFirstAIResponse).toBe(true);
      expect(session.geminiSession.sendClientContent).not.toHaveBeenCalled();

      const doneCalls = sendToClient.mock.calls.filter(([, msg]) => msg.type === 'ai.transcription.done');
      expect(doneCalls).toHaveLength(1);
    });

    it('client receives ai.transcription.done only once for a single retry-triggered AI response', async () => {
      session.hasReceivedFirstAIResponse = false;
      session.firstGreetingRetryCount = 1;

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
      expect(session.currentTranscript).toBe('안녕하세요!');

      handleGeminiMessage(
        session,
        { serverContent: { turnComplete: true } },
        sendToClient,
        null,
        proactiveReconnect
      );

      await vi.runAllTimersAsync();

      const doneCalls = sendToClient.mock.calls.filter(([, msg]) => msg.type === 'ai.transcription.done');
      expect(doneCalls).toHaveLength(1);
    });
  });

  describe('retry race condition: triple greeting prevention', () => {
    it('does not retry when a transcript delta has already arrived', () => {
      session.hasReceivedFirstAIResponse = false;
      session.hasReceivedFirstTranscriptDelta = true;
      session.firstGreetingRetryCount = 3;
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

      expect(session.geminiSession.sendClientContent).not.toHaveBeenCalled();
      const retryCalls = sendToClient.mock.calls.filter(([, msg]) => msg.type === 'greeting.retry');
      expect(retryCalls).toHaveLength(0);
    });

    it('closes the retry gate and sets firstGreetingRetryCount=3 on first transcript delta', () => {
      session.hasReceivedFirstTranscriptDelta = false;
      session.firstGreetingRetryCount = 0;

      handleGeminiMessage(
        session,
        { serverContent: { outputTranscription: { text: '안녕하세요!' } } },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.hasReceivedFirstTranscriptDelta).toBe(true);
      expect(session.firstGreetingRetryCount).toBe(3);
    });

    it('true race: two no-content turnComplete retries then delayed greeting — ai.transcription.done emitted exactly once', async () => {
      // Simulate the exact race described in the task:
      // 1. Greeting trigger sent (hasTriggeredFirstGreeting=true, no response yet)
      // 2. Gemini fires turnComplete with no content twice → retry triggers sent
      // 3. Gemini eventually delivers the greeting response
      session.hasReceivedFirstAIResponse = false;
      session.hasReceivedFirstTranscriptDelta = false;
      session.firstGreetingRetryCount = 0;
      session.greetingResponseCount = 0;
      session.userTurnsCompleted = 0;
      session.currentTranscript = '';
      session.geminiSession = {
        sendClientContent: vi.fn(),
        sendRealtimeInput: vi.fn(),
      };

      // First empty turnComplete → should trigger retry #1
      handleGeminiMessage(
        session,
        { serverContent: { turnComplete: true } },
        sendToClient,
        null,
        proactiveReconnect
      );
      expect(session.firstGreetingRetryCount).toBe(1);
      expect(session.geminiSession.sendClientContent).toHaveBeenCalledTimes(1);

      // Second empty turnComplete → should trigger retry #2
      handleGeminiMessage(
        session,
        { serverContent: { turnComplete: true } },
        sendToClient,
        null,
        proactiveReconnect
      );
      expect(session.firstGreetingRetryCount).toBe(2);
      expect(session.geminiSession.sendClientContent).toHaveBeenCalledTimes(2);

      // Gemini now delivers the greeting transcript delta
      handleGeminiMessage(
        session,
        { serverContent: { outputTranscription: { text: '안녕하세요! 만나서 반갑습니다.' } } },
        sendToClient,
        null,
        proactiveReconnect
      );
      expect(session.hasReceivedFirstTranscriptDelta).toBe(true);
      // Retry gate now closed
      expect(session.firstGreetingRetryCount).toBe(3);

      // First turnComplete with the greeting content
      session.hasReceivedFirstAIResponse = true;
      handleGeminiMessage(
        session,
        { serverContent: { turnComplete: true } },
        sendToClient,
        null,
        proactiveReconnect
      );
      await vi.runAllTimersAsync();

      // Retry #1 response arrives (different text, different turnComplete)
      session.currentTranscript = '네, 안녕하세요! 무엇을 도와드릴까요?';
      handleGeminiMessage(
        session,
        { serverContent: { turnComplete: true } },
        sendToClient,
        null,
        proactiveReconnect
      );
      await vi.runAllTimersAsync();

      // Retry #2 response arrives (yet another different text)
      session.currentTranscript = '여기 있습니다. 어떻게 도와드릴까요?';
      handleGeminiMessage(
        session,
        { serverContent: { turnComplete: true } },
        sendToClient,
        null,
        proactiveReconnect
      );
      await vi.runAllTimersAsync();

      // Only one greeting should have been sent to the client
      const doneCalls = sendToClient.mock.calls.filter(([, msg]) => msg.type === 'ai.transcription.done');
      expect(doneCalls).toHaveLength(1);
    });

    it('allows normal second-turn AI response after user speaks', async () => {
      // Greeting emitted (greetingResponseCount=1), then user speaks (userTurnsCompleted=1),
      // then AI responds again — should be allowed (maxAllowed = 1+1 = 2)
      session.hasReceivedFirstAIResponse = true;
      session.greetingResponseCount = 1;
      session.userTurnsCompleted = 0;
      session.userTranscriptBuffer = '감사합니다, 잘 부탁드려요.';
      session.currentTranscript = '저도 잘 부탁드립니다!';

      handleGeminiMessage(
        session,
        { serverContent: { turnComplete: true } },
        sendToClient,
        null,
        proactiveReconnect
      );
      await vi.runAllTimersAsync();

      // userTurnsCompleted should now be 1, greetingResponseCount should be 2
      expect(session.userTurnsCompleted).toBe(1);
      const doneCalls = sendToClient.mock.calls.filter(([, msg]) => msg.type === 'ai.transcription.done');
      expect(doneCalls).toHaveLength(1);
    });

    it('greetingResponseCount guard is scoped to greeting phase — allows AI responses after user speaks', async () => {
      // After user speaks (userTurnsCompleted >= 1), the greeting guard no longer applies.
      // A normal AI response should be emitted even if greetingResponseCount > 0.
      session.hasReceivedFirstAIResponse = true;
      session.greetingResponseCount = 1;
      session.userTurnsCompleted = 1;
      session.currentTranscript = '사용자 발화 이후 정상적인 AI 응답입니다.';

      handleGeminiMessage(
        session,
        { serverContent: { turnComplete: true } },
        sendToClient,
        null,
        proactiveReconnect
      );
      await vi.runAllTimersAsync();

      const doneCalls = sendToClient.mock.calls.filter(([, msg]) => msg.type === 'ai.transcription.done');
      expect(doneCalls).toHaveLength(1);
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

  describe('barge-in state reset via inputTranscription (VAD-confirmed user speech)', () => {
    it('resets isInterrupted to false when VAD confirms user speech after barge-in', () => {
      session.isInterrupted = true;
      session.cancelledTurnSeq = 2;
      session.userTranscriptBuffer = '';

      handleGeminiMessage(
        session,
        { serverContent: { inputTranscription: { text: '새로운 발화' } } },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.isInterrupted).toBe(false);
    });

    it('resets cancelledTurnSeq to -1 when VAD confirms user speech after barge-in', () => {
      session.isInterrupted = true;
      session.cancelledTurnSeq = 2;
      session.userTranscriptBuffer = '';

      handleGeminiMessage(
        session,
        { serverContent: { inputTranscription: { text: '새로운 발화' } } },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.cancelledTurnSeq).toBe(-1);
    });

    it('does not reset isInterrupted on subsequent transcription chunks (only on first)', () => {
      session.isInterrupted = false;
      session.cancelledTurnSeq = -1;
      session.userTranscriptBuffer = '이미 쌓인';

      handleGeminiMessage(
        session,
        { serverContent: { inputTranscription: { text: ' 추가 내용' } } },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.isInterrupted).toBe(false);
      expect(session.cancelledTurnSeq).toBe(-1);
    });

    it('stale cancelled-turn audio (top-level data) is still suppressed while isInterrupted is true', () => {
      session.isInterrupted = true;
      session.cancelledTurnSeq = 1;

      handleGeminiMessage(
        session,
        { data: 'stale-cancelled-audio==' },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(sendToClient).not.toHaveBeenCalled();
      expect(session.isInterrupted).toBe(true);
    });

    it('stale cancelled-turn audio is suppressed while isInterrupted is true, regardless of userTranscriptBuffer state', () => {
      session.isInterrupted = true;
      session.cancelledTurnSeq = 1;
      session.userTranscriptBuffer = 'already receiving user transcript';

      handleGeminiMessage(
        session,
        { data: 'late-stale-audio==' },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(sendToClient).not.toHaveBeenCalled();
    });

    it('does not reset isInterrupted when inputTranscription text is empty', () => {
      session.isInterrupted = true;
      session.cancelledTurnSeq = 3;
      session.userTranscriptBuffer = '';

      handleGeminiMessage(
        session,
        { serverContent: { inputTranscription: { text: '' } } },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.isInterrupted).toBe(true);
      expect(session.cancelledTurnSeq).toBe(3);
    });

    it('turnComplete path: resets cancelledTurnSeq to -1 when clearing isInterrupted', () => {
      session.isInterrupted = true;
      session.turnSeq = 1;
      session.cancelledTurnSeq = 1;

      handleGeminiMessage(
        session,
        { serverContent: { turnComplete: true } },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.isInterrupted).toBe(false);
      expect(session.cancelledTurnSeq).toBe(-1);
    });

    it('outputTranscription path: resets cancelledTurnSeq to -1 when clearing isInterrupted', () => {
      session.isInterrupted = true;
      session.cancelledTurnSeq = 2;

      handleGeminiMessage(
        session,
        { serverContent: { outputTranscription: { text: '새 AI 응답' } } },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.isInterrupted).toBe(false);
      expect(session.cancelledTurnSeq).toBe(-1);
    });
  });

  describe('persona switch voice state updates', () => {
    it('updates voiceId, voiceGender, and clears selectedVoice when persona has a voiceId', async () => {
      session = makeSession({
        voiceGender: 'male',
        voiceId: null,
        selectedVoice: 'Puck',
        activePersonaIndex: 0,
        personaSwitchPending: true,
        scenarioPersonas: [
          { id: 'p0', name: 'PersonaA', gender: 'male' },
          { id: 'p1', name: 'PersonaB', gender: 'female', voiceId: 'XrExE9yKIg1WjnnlVkGX' },
        ],
        geminiSession: { sendToolResponse: vi.fn() } as any,
      });

      const toolCallMessage = {
        toolCall: {
          functionCalls: [{
            id: 'fc1',
            name: 'switch_persona',
            args: {
              targetPersonaIndex: 1,
              reason: 'test',
              transitionLine: 'Hello from PersonaB',
            },
          }],
        },
      };

      handleGeminiMessage(session, toolCallMessage, sendToClient, null, proactiveReconnect);
      await vi.runAllTimersAsync();

      expect(session.activePersonaIndex).toBe(1);
      expect(session.voiceGender).toBe('female');
      expect(session.voiceId).toBe('XrExE9yKIg1WjnnlVkGX');
      expect(session.selectedVoice).toBeNull();
    });

    it('clears voiceId to null when switched persona has no voiceId', async () => {
      session = makeSession({
        voiceGender: 'male',
        voiceId: 'some-old-voice-id',
        selectedVoice: 'Puck',
        activePersonaIndex: 0,
        personaSwitchPending: true,
        scenarioPersonas: [
          { id: 'p0', name: 'PersonaA', gender: 'male', voiceId: 'some-old-voice-id' },
          { id: 'p1', name: 'PersonaB', gender: 'female' },
        ],
        geminiSession: { sendToolResponse: vi.fn() } as any,
      });

      const toolCallMessage = {
        toolCall: {
          functionCalls: [{
            id: 'fc2',
            name: 'switch_persona',
            args: {
              targetPersonaIndex: 1,
              reason: 'test',
              transitionLine: '',
            },
          }],
        },
      };

      handleGeminiMessage(session, toolCallMessage, sendToClient, null, proactiveReconnect);
      await vi.runAllTimersAsync();

      expect(session.activePersonaIndex).toBe(1);
      expect(session.voiceGender).toBe('female');
      expect(session.voiceId).toBeNull();
      expect(session.selectedVoice).toBeNull();
    });
  });

  describe('2-step persona switch state machine', () => {
    const multiPersonaBase = () => ({
      hasReceivedFirstAIResponse: true,
      scenarioPersonas: [
        { id: 'p0', name: 'PersonaA', gender: 'male' },
        { id: 'p1', name: 'PersonaB', gender: 'female' },
      ] as any,
      activePersonaIndex: 0,
      geminiSession: { sendToolResponse: vi.fn(), sendClientContent: vi.fn() } as any,
    });

    const switchToolMsg = (personaSwitchPendingOnSession?: boolean) => ({
      toolCall: {
        functionCalls: [{
          id: 'fc-test',
          name: 'switch_persona',
          args: { targetPersonaIndex: 1, reason: 'test', transitionLine: 'Hi from B' },
        }],
      },
    });

    it('(b) allows switch_persona when awaitingPersonaSwitch=true (announcement was made, user consent keyword missed by heuristic)', async () => {
      // Bug 2 fix: awaitingPersonaSwitch=true means AI already announced the switch;
      // even without explicit personaSwitchPending, the switch should be ALLOWED
      // so heuristic failures don't permanently block the switch.
      session = makeSession({
        ...multiPersonaBase(),
        awaitingPersonaSwitch: true,
        personaSwitchPending: false,
      });

      handleGeminiMessage(session, switchToolMsg(), sendToClient, null, proactiveReconnect);
      await vi.runAllTimersAsync();

      // Switch should succeed because AI already announced it (awaitingPersonaSwitch=true)
      expect(session.activePersonaIndex).toBe(1);
      // sendToolResponse should have been called with success:true (normal Gemini ACK),
      // NOT a blocking error. Verify the response is a success, not an error.
      expect(session.geminiSession.sendToolResponse).toHaveBeenCalled();
      const callArg = (session.geminiSession.sendToolResponse as any).mock.calls[0][0];
      expect(callArg.functionResponses[0].response.success).toBe(true);
      expect(callArg.functionResponses[0].response.error).toBeUndefined();
    });

    it('(b2) blocks switch_persona when both personaSwitchPending=false and awaitingPersonaSwitch=false (completely unannounced)', async () => {
      session = makeSession({
        ...multiPersonaBase(),
        awaitingPersonaSwitch: false,
        personaSwitchPending: false,
        currentTranscript: '',
      });

      handleGeminiMessage(session, switchToolMsg(), sendToClient, null, proactiveReconnect);
      await vi.runAllTimersAsync();

      // Switch should be blocked — activePersonaIndex stays 0
      expect(session.activePersonaIndex).toBe(0);
      // sendToolResponse should have been called with an error message
      expect(session.geminiSession.sendToolResponse).toHaveBeenCalled();
    });

    it('(b3) allows switch_persona when both flags are false but currentTranscript contains announcement keywords + persona name (heuristic-miss recovery)', async () => {
      // Bug 2 fix (third allow condition): even when both flags are false,
      // if the current AI transcript contains a switch keyword + the non-active
      // persona's name, the switch should be allowed (heuristic miss recovery).
      session = makeSession({
        ...multiPersonaBase(),
        awaitingPersonaSwitch: false,
        personaSwitchPending: false,
        // Transcript contains 'transfer' (English keyword) + 'PersonaB' (non-active persona name)
        currentTranscript: 'Let me transfer you to PersonaB who can help with this.',
      });

      handleGeminiMessage(session, switchToolMsg(), sendToClient, null, proactiveReconnect);
      await vi.runAllTimersAsync();

      // Switch should succeed because transcript contains intent signal
      expect(session.activePersonaIndex).toBe(1);
      // sendToolResponse called with success:true (not an error)
      expect(session.geminiSession.sendToolResponse).toHaveBeenCalled();
      const callArg = (session.geminiSession.sendToolResponse as any).mock.calls[0][0];
      expect(callArg.functionResponses[0].response.success).toBe(true);
      expect(callArg.functionResponses[0].response.error).toBeUndefined();
    });

    it('(c) allows switch_persona once user consent has been detected (personaSwitchPending=true)', async () => {
      session = makeSession({
        ...multiPersonaBase(),
        awaitingPersonaSwitch: true,
        personaSwitchPending: true,
      });

      handleGeminiMessage(session, switchToolMsg(), sendToClient, null, proactiveReconnect);
      await vi.runAllTimersAsync();

      // Switch should succeed
      expect(session.activePersonaIndex).toBe(1);
      expect(session.personaSwitchPending).toBe(false);
      expect(session.awaitingPersonaSwitch).toBe(false);
    });

    it('(d-consent) sets personaSwitchPending=true when user responds with consent keywords', () => {
      session = makeSession({
        ...multiPersonaBase(),
        awaitingPersonaSwitch: true,
        personaSwitchPending: false,
        userLanguage: 'en',
        userTranscriptBuffer: 'Yes, please go ahead and connect me.',
      });

      handleGeminiMessage(
        session,
        { serverContent: { turnComplete: true } },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.personaSwitchPending).toBe(true);
      expect(session.awaitingPersonaSwitch).toBe(true);
    });

    it('(d-decline) clears awaitingPersonaSwitch and emits persona.switch_pending_cleared when user declines', () => {
      session = makeSession({
        ...multiPersonaBase(),
        awaitingPersonaSwitch: true,
        personaSwitchPending: false,
        userLanguage: 'en',
        userTranscriptBuffer: 'No, that is ok, I am fine talking to you.',
      });

      handleGeminiMessage(
        session,
        { serverContent: { turnComplete: true } },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.awaitingPersonaSwitch).toBe(false);
      expect(session.personaSwitchPending).toBe(false);
      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'persona.switch_pending_cleared' })
      );
    });

    it('(d-offtopic) keeps awaitingPersonaSwitch=true when user response is off-topic', () => {
      session = makeSession({
        ...multiPersonaBase(),
        awaitingPersonaSwitch: true,
        personaSwitchPending: false,
        userLanguage: 'en',
        userTranscriptBuffer: 'Can you tell me more about the refund process?',
      });

      handleGeminiMessage(
        session,
        { serverContent: { turnComplete: true } },
        sendToClient,
        null,
        proactiveReconnect
      );

      // Ambiguous — neither consented nor declined, so still waiting
      expect(session.awaitingPersonaSwitch).toBe(true);
      expect(session.personaSwitchPending).toBe(false);
      expect(sendToClient).not.toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'persona.switch_pending_cleared' })
      );
    });
  });
});
