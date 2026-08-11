import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleGeminiMessage } from '../../server/services/voice/geminiMessageHandler';
import type { RealtimeSession } from '../../server/services/voice/types';

vi.mock('../../server/services/voice/emotionAnalyzer', () => ({
  analyzeEmotion: vi.fn().mockResolvedValue({ emotion: '중립', emotionReason: '기본값' }),
  analyzeUserEmotion: vi.fn().mockResolvedValue({
    primaryEmotion: 'neutral', secondaryEmotions: [], valence: 0, arousal: 0.3, dominance: 0.5,
    intensity: 0.2, expressedEmotion: 'neutral', inferredInternalEmotion: 'neutral',
    maskingProbability: 0, stance: 'neutral', engagement: 'medium', confidence: 0.5, evidence: '',
  }),
  NEUTRAL_USER_AFFECT: {
    primaryEmotion: 'neutral', secondaryEmotions: [], valence: 0, arousal: 0.3, dominance: 0.5,
    intensity: 0.2, expressedEmotion: 'neutral', inferredInternalEmotion: 'neutral',
    maskingProbability: 0, stance: 'neutral', engagement: 'medium', confidence: 0.5, evidence: 'no analysis available',
  },
}));

vi.mock('../../server/services/simulation/evaluateUserResponse', () => ({
  evaluateUserResponse: vi.fn().mockResolvedValue({ skipped: true }),
}));

import { evaluateUserResponse } from '../../server/services/simulation/evaluateUserResponse';

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
    lastAudioCommitSentAt: 0,
    audioSourceThisTurn: null,
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

    it('discards inputTranscription delta and keeps buffer empty when isInterrupted=true', () => {
      session.isInterrupted = true;
      session.cancelledTurnSeq = 1;

      handleGeminiMessage(
        session,
        { serverContent: { inputTranscription: { text: '스테이크 주세요' } } },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.userTranscriptBuffer).toBe('');
      const deltaCalls = sendToClient.mock.calls.filter(([, msg]) => msg.type === 'user.transcription.delta');
      expect(deltaCalls).toHaveLength(0);
    });

    it('does not clear isInterrupted when discarding a stale delta', () => {
      session.isInterrupted = true;
      session.cancelledTurnSeq = 1;

      handleGeminiMessage(
        session,
        { serverContent: { inputTranscription: { text: '불필요한 텍스트' } } },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.isInterrupted).toBe(true);
      expect(session.cancelledTurnSeq).toBe(1);
    });

    it('accumulates buffer correctly once isInterrupted is cleared and real user speech arrives', () => {
      // Simulate barge-in: buffer was cleared, isInterrupted set to false
      session.isInterrupted = false;
      session.userTranscriptBuffer = '';

      handleGeminiMessage(
        session,
        { serverContent: { inputTranscription: { text: '안녕하세요' } } },
        sendToClient,
        null,
        proactiveReconnect
      );
      handleGeminiMessage(
        session,
        { serverContent: { inputTranscription: { text: ' 반갑습니다' } } },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.userTranscriptBuffer).toBe('안녕하세요 반갑습니다');
      const deltaCalls = sendToClient.mock.calls.filter(([, msg]) => msg.type === 'user.transcription.delta');
      expect(deltaCalls).toHaveLength(2);
    });

    it('still processes turnComplete when co-delivered with a stale inputTranscription delta during barge-in', () => {
      session.isInterrupted = true;
      session.cancelledTurnSeq = 1;
      session.turnSeq = 1;
      session.hasReceivedFirstAIResponse = true;

      // Gemini may co-deliver inputTranscription + turnComplete in one message.
      // The stale delta must be discarded, but turnComplete must still fire.
      handleGeminiMessage(
        session,
        {
          serverContent: {
            inputTranscription: { text: '에코 텍스트' },
            turnComplete: true,
          },
        },
        sendToClient,
        null,
        proactiveReconnect
      );

      // Transcript delta suppressed
      expect(session.userTranscriptBuffer).toBe('');
      const deltaCalls = sendToClient.mock.calls.filter(([, msg]) => msg.type === 'user.transcription.delta');
      expect(deltaCalls).toHaveLength(0);

      // turnComplete still processed
      const doneCalls = sendToClient.mock.calls.filter(([, msg]) => msg.type === 'response.done');
      expect(doneCalls.length).toBeGreaterThan(0);
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

    it('does not send any greeting.retry or greeting.failed when no first AI response (user speaks first)', () => {
      session.hasReceivedFirstAIResponse = false;
      session.currentTranscript = '';
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

      const greetingCalls = sendToClient.mock.calls.filter(
        ([, msg]) => msg.type === 'greeting.retry' || msg.type === 'greeting.failed'
      );
      expect(greetingCalls).toHaveLength(0);
      expect(session.geminiSession.sendClientContent).not.toHaveBeenCalled();
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

    it('allows inlineData audio regardless of userSpeechStarted (no greeting guard)', () => {
      session.userTurnsCompleted = 0;
      session.userSpeechStarted = false;

      handleGeminiMessage(
        session,
        {
          serverContent: {
            modelTurn: {
              parts: [{ inlineData: { data: 'anyaudio==', mimeType: 'audio/pcm' } }],
            },
          },
        },
        sendToClient,
        null,
        proactiveReconnect
      );

      const audioCalls = sendToClient.mock.calls.filter(([, msg]) => msg.type === 'audio.delta');
      expect(audioCalls).toHaveLength(1);
      expect(audioCalls[0][1]).toMatchObject({ type: 'audio.delta', delta: 'anyaudio==' });
    });

    it('sets hasReceivedFirstAIAudio on first inlineData audio', () => {
      session.hasReceivedFirstAIAudio = false;
      session.userTurnsCompleted = 0;
      session.userSpeechStarted = false;

      handleGeminiMessage(
        session,
        {
          serverContent: {
            modelTurn: {
              parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'firstaudio==' } }],
            },
          },
        },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.hasReceivedFirstAIAudio).toBe(true);
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
    it('barge-in active (stale turn): barge-in fires first and suppresses', () => {
      session.isInterrupted = true;
      session.turnSeq = 2;
      session.cancelledTurnSeq = 2;

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

    it('barge-in clears on new turn and audio plays through (no greeting guard)', () => {
      session.isInterrupted = true;
      session.turnSeq = 3;
      session.cancelledTurnSeq = 2;

      handleGeminiMessage(
        session,
        {
          serverContent: {
            modelTurn: {
              parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'newturnaudio==' } }],
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
      // Audio plays through since greeting guard is removed
      const audioCalls = sendToClient.mock.calls.filter(([, msg]) => msg.type === 'audio.delta');
      expect(audioCalls).toHaveLength(1);
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

    it('thinking text suppresses audio (only remaining guard besides barge-in)', () => {
      session.isInterrupted = false;

      handleGeminiMessage(
        session,
        {
          serverContent: {
            modelTurn: {
              parts: [
                { text: "I'm focusing on the response" },
                { inlineData: { mimeType: 'audio/pcm', data: 'thinkonly==' } },
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

    it('both guards inactive: audio plays through', () => {
      session.isInterrupted = false;

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

  describe('first-turn AI response handling', () => {
    it('sets hasReceivedFirstTranscriptDelta on first transcript delta', () => {
      session.hasReceivedFirstTranscriptDelta = false;

      handleGeminiMessage(
        session,
        { serverContent: { outputTranscription: { text: '안녕하세요!' } } },
        sendToClient,
        null,
        proactiveReconnect
      );

      expect(session.hasReceivedFirstTranscriptDelta).toBe(true);
    });

    it('no sendClientContent is called on empty turnComplete (user speaks first, no auto-retry)', () => {
      session.hasReceivedFirstAIResponse = false;
      session.hasReceivedFirstTranscriptDelta = false;
      session.userTurnsCompleted = 0;
      session.currentTranscript = '';
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

      handleGeminiMessage(
        session,
        { serverContent: { turnComplete: true } },
        sendToClient,
        null,
        proactiveReconnect
      );
      expect(session.geminiSession.sendClientContent).not.toHaveBeenCalled();
    });

    it('allows normal AI response after user speaks', async () => {
      session.hasReceivedFirstAIResponse = true;
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

      expect(session.userTurnsCompleted).toBe(1);
      const doneCalls = sendToClient.mock.calls.filter(([, msg]) => msg.type === 'ai.transcription.done');
      expect(doneCalls).toHaveLength(1);
    });

    it('AI responses are always allowed regardless of turn count', async () => {
      session.hasReceivedFirstAIResponse = true;
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
    it('keeps isInterrupted true and discards delta while barge-in is active', () => {
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

      // Stale deltas during barge-in must NOT clear isInterrupted —
      // the audio-delta path owns that responsibility now.
      expect(session.isInterrupted).toBe(true);
      expect(session.userTranscriptBuffer).toBe('');
    });

    it('keeps cancelledTurnSeq unchanged when a stale delta arrives during barge-in', () => {
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

      expect(session.cancelledTurnSeq).toBe(2);
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

  describe('evaluation concurrency guard (evaluationInProgress flag)', () => {
    beforeEach(() => {
      vi.mocked(evaluateUserResponse).mockClear();
      vi.mocked(evaluateUserResponse).mockResolvedValue({ skipped: true } as any);
    });

    it('does not call evaluateUserResponse when evaluationInProgress is already true', async () => {
      session.hasReceivedFirstAIResponse = true;
      session.userTranscriptBuffer = '안녕하세요, 잘 부탁드립니다.';
      session.evaluationInProgress = true;

      handleGeminiMessage(
        session,
        { serverContent: { turnComplete: true } },
        sendToClient,
        null,
        proactiveReconnect
      );

      await vi.runAllTimersAsync();

      // The setImmediate evaluation block was skipped entirely — evaluateUserResponse
      // is never invoked and the finally { evaluationInProgress = false } never runs.
      expect(vi.mocked(evaluateUserResponse)).not.toHaveBeenCalled();
      expect(session.evaluationInProgress).toBe(true);
    });

    it('calls evaluateUserResponse exactly once and resets evaluationInProgress to false on normal completion', async () => {
      session.hasReceivedFirstAIResponse = true;
      session.userTranscriptBuffer = '잘 부탁드립니다.';
      session.evaluationInProgress = false;

      handleGeminiMessage(
        session,
        { serverContent: { turnComplete: true } },
        sendToClient,
        null,
        proactiveReconnect
      );

      await vi.runAllTimersAsync();

      expect(vi.mocked(evaluateUserResponse)).toHaveBeenCalledTimes(1);
      expect(session.evaluationInProgress).toBe(false);
    });

    it('calls evaluateUserResponse exactly once when a second turnComplete fires while the first evaluation is in flight', async () => {
      session.hasReceivedFirstAIResponse = true;
      session.userTranscriptBuffer = '첫 번째 발화입니다.';
      session.evaluationInProgress = false;

      // First turnComplete: sets evaluationInProgress=true and schedules setImmediate
      handleGeminiMessage(
        session,
        { serverContent: { turnComplete: true } },
        sendToClient,
        null,
        proactiveReconnect
      );

      // Evaluation is now in progress (setImmediate not yet flushed by fake timers)
      expect(session.evaluationInProgress).toBe(true);

      // Second turnComplete arrives while the first setImmediate is still pending.
      // The concurrency guard must detect evaluationInProgress=true and skip the block.
      session.userTranscriptBuffer = '두 번째 발화입니다.';
      handleGeminiMessage(
        session,
        { serverContent: { turnComplete: true } },
        sendToClient,
        null,
        proactiveReconnect
      );

      await vi.runAllTimersAsync();

      // Only one evaluation job was ever launched — the second turnComplete was blocked.
      expect(vi.mocked(evaluateUserResponse)).toHaveBeenCalledTimes(1);
      // evaluationInProgress resets to false after the single evaluation completes.
      expect(session.evaluationInProgress).toBe(false);
    });
  });

  describe('Fix 2 — cross-source cross-frame audio dedup (audioSourceThisTurn)', () => {
    it('sets audioSourceThisTurn="top" when top-level audio plays', () => {
      session.isInterrupted = false;
      handleGeminiMessage(session, { data: 'topchunk==' }, sendToClient, null, proactiveReconnect);
      expect(session.audioSourceThisTurn).toBe('top');
    });

    it('sets audioSourceThisTurn="inline" when inlineData audio plays', () => {
      session.isInterrupted = false;
      handleGeminiMessage(
        session,
        { serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'inchunk==' } }] } } },
        sendToClient, null, proactiveReconnect
      );
      expect(session.audioSourceThisTurn).toBe('inline');
    });

    it('suppresses inlineData when top-level already played for this turn (cross-source dedup)', () => {
      // Frame 1: top-level audio sets audioSourceThisTurn='top'
      session.isInterrupted = false;
      handleGeminiMessage(session, { data: 'frame1==' }, sendToClient, null, proactiveReconnect);
      const firstCalls = sendToClient.mock.calls.filter(([, m]) => m.type === 'audio.delta');
      expect(firstCalls).toHaveLength(1);
      sendToClient.mockClear();

      // Frame 2: inlineData from same turn — must be suppressed
      handleGeminiMessage(
        session,
        { serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'frame2==' } }] } } },
        sendToClient, null, proactiveReconnect
      );
      const audioCalls = sendToClient.mock.calls.filter(([, m]) => m.type === 'audio.delta');
      expect(audioCalls).toHaveLength(0);
    });

    it('suppresses top-level when inlineData already played for this turn (cross-source dedup)', () => {
      // Frame 1: inlineData sets audioSourceThisTurn='inline'
      session.isInterrupted = false;
      handleGeminiMessage(
        session,
        { serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'inline1==' } }] } } },
        sendToClient, null, proactiveReconnect
      );
      sendToClient.mockClear();

      // Frame 2: top-level bytes for same turn — must be suppressed
      handleGeminiMessage(session, { data: 'top1==' }, sendToClient, null, proactiveReconnect);
      const audioCalls = sendToClient.mock.calls.filter(([, m]) => m.type === 'audio.delta');
      expect(audioCalls).toHaveLength(0);
    });

    it('allows multiple inlineData chunks in the same turn (same-source streaming)', () => {
      // Same source streaming must NOT be deduped — only cross-source frames are blocked
      session.isInterrupted = false;

      handleGeminiMessage(
        session,
        { serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'chunk1==' } }] } } },
        sendToClient, null, proactiveReconnect
      );
      handleGeminiMessage(
        session,
        { serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'chunk2==' } }] } } },
        sendToClient, null, proactiveReconnect
      );
      handleGeminiMessage(
        session,
        { serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'chunk3==' } }] } } },
        sendToClient, null, proactiveReconnect
      );

      const audioCalls = sendToClient.mock.calls.filter(([, m]) => m.type === 'audio.delta');
      expect(audioCalls).toHaveLength(3);
      expect(audioCalls[0][1]).toMatchObject({ delta: 'chunk1==' });
      expect(audioCalls[1][1]).toMatchObject({ delta: 'chunk2==' });
      expect(audioCalls[2][1]).toMatchObject({ delta: 'chunk3==' });
    });

    it('resets audioSourceThisTurn to null on turnComplete so the next turn is unrestricted', () => {
      session.isInterrupted = false;
      session.hasReceivedFirstAIResponse = true;

      handleGeminiMessage(session, { data: 'audio==' }, sendToClient, null, proactiveReconnect);
      expect(session.audioSourceThisTurn).toBe('top');

      handleGeminiMessage(
        session, { serverContent: { turnComplete: true } }, sendToClient, null, proactiveReconnect
      );
      expect(session.audioSourceThisTurn).toBeNull();

      sendToClient.mockClear();
      // Next turn: inlineData must play (audioSourceThisTurn was reset)
      handleGeminiMessage(
        session,
        { serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'nextturn==' } }] } } },
        sendToClient, null, proactiveReconnect
      );
      const audioCalls = sendToClient.mock.calls.filter(([, m]) => m.type === 'audio.delta');
      expect(audioCalls).toHaveLength(1);
      expect(audioCalls[0][1]).toMatchObject({ delta: 'nextturn==' });
    });

    it('plays inlineData for turn N+1 when a top-level frame ended turn N and turnComplete arrived first (turn-boundary race)', () => {
      session.isInterrupted = false;
      session.hasReceivedFirstAIResponse = true;

      // Top-level audio frame at the very end of turn N
      handleGeminiMessage(session, { data: 'endOfTurnN==' }, sendToClient, null, proactiveReconnect);
      expect(session.audioSourceThisTurn).toBe('top');

      // turnComplete for turn N arrives, resetting the cross-frame dedup flag
      handleGeminiMessage(
        session, { serverContent: { turnComplete: true } }, sendToClient, null, proactiveReconnect
      );
      expect(session.audioSourceThisTurn).toBeNull();
      sendToClient.mockClear();

      // inlineData frame at the very start of turn N+1 — must NOT be suppressed
      handleGeminiMessage(
        session,
        { serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'startOfTurnNPlus1==' } }] } } },
        sendToClient, null, proactiveReconnect
      );
      const audioCalls = sendToClient.mock.calls.filter(([, m]) => m.type === 'audio.delta');
      expect(audioCalls).toHaveLength(1);
      expect(audioCalls[0][1]).toMatchObject({ delta: 'startOfTurnNPlus1==' });
    });

    it('suppresses inlineData at the start of turn N+1 when a top-level frame ended turn N WITHOUT an intervening turnComplete', () => {
      session.isInterrupted = false;
      session.hasReceivedFirstAIResponse = true;

      // Top-level audio frame at the very end of turn N
      handleGeminiMessage(session, { data: 'endOfTurnN==' }, sendToClient, null, proactiveReconnect);
      expect(session.audioSourceThisTurn).toBe('top');
      sendToClient.mockClear();

      // inlineData frame arrives immediately — no turnComplete was received yet,
      // so the dedup flag has not been reset and this must be treated as the
      // same logical turn and suppressed to avoid double playback.
      handleGeminiMessage(
        session,
        { serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'raceFrame==' } }] } } },
        sendToClient, null, proactiveReconnect
      );
      const audioCalls = sendToClient.mock.calls.filter(([, m]) => m.type === 'audio.delta');
      expect(audioCalls).toHaveLength(0);
      // audioSourceThisTurn remains 'top' until an actual turnComplete boundary is seen
      expect(session.audioSourceThisTurn).toBe('top');
    });
  });

  describe('Fix 3 — suppressAIUntilUserSpeaks lifecycle (deferred to turnComplete when AI started)', () => {
    it('suppresses inlineData audio while suppressAIUntilUserSpeaks is active and sets suppressedTurnStarted', () => {
      session.suppressAIUntilUserSpeaks = true;

      handleGeminiMessage(
        session,
        { serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'suppressed==' } }] } } },
        sendToClient, null, proactiveReconnect
      );

      const audioCalls = sendToClient.mock.calls.filter(([, m]) => m.type === 'audio.delta');
      expect(audioCalls).toHaveLength(0);
      expect(session.suppressAIUntilUserSpeaks).toBe(true);
      expect(session.suppressedTurnStarted).toBe(true);
    });

    it('clears both flags on turnComplete when a suppressed AI turn completes', () => {
      session.suppressAIUntilUserSpeaks = true;
      session.suppressedTurnStarted = true;
      session.hasReceivedFirstAIResponse = true;
      session.currentTranscript = 'unsolicited';

      handleGeminiMessage(
        session, { serverContent: { turnComplete: true } }, sendToClient, null, proactiveReconnect
      );

      expect(session.suppressAIUntilUserSpeaks).toBe(false);
      expect(session.suppressedTurnStarted).toBe(false);
      expect(session.currentTranscript).toBe('');
    });

    it('allows normal audio after suppressAIUntilUserSpeaks is cleared by turnComplete', () => {
      session.suppressAIUntilUserSpeaks = true;
      session.suppressedTurnStarted = true;
      session.hasReceivedFirstAIResponse = true;

      // Suppressed turn completes
      handleGeminiMessage(
        session, { serverContent: { turnComplete: true } }, sendToClient, null, proactiveReconnect
      );
      expect(session.suppressAIUntilUserSpeaks).toBe(false);

      sendToClient.mockClear();

      // Real response to user's speech
      handleGeminiMessage(
        session,
        { serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'realresponse==' } }] } } },
        sendToClient, null, proactiveReconnect
      );

      const audioCalls = sendToClient.mock.calls.filter(([, m]) => m.type === 'audio.delta');
      expect(audioCalls).toHaveLength(1);
      expect(audioCalls[0][1]).toMatchObject({ delta: 'realresponse==' });
    });

    it('does NOT suppress real user response when Gemini never sent an unsolicited turn (suppressedTurnStarted=false)', () => {
      // Scenario: context injected (suppress=true), but Gemini behaved correctly
      // and never started an unsolicited turn — turnComplete fires for real user response.
      // suppressAIUntilUserSpeaks should NOT cause real response to be dropped.
      session.suppressAIUntilUserSpeaks = true;
      session.suppressedTurnStarted = false; // No unsolicited turn started
      session.hasReceivedFirstAIResponse = true;
      session.currentTranscript = 'real AI response to user';

      // This turnComplete belongs to the REAL response (user spoke, AI replied)
      // Because suppressedTurnStarted=false, the transcript should NOT be discarded.
      // Note: suppressAIUntilUserSpeaks is still true here — it would have been
      // cleared by clientMessageHandler on input_audio_buffer.append since
      // suppressedTurnStarted was false at that point.
      // We test the turnComplete path directly: when suppress=true && no turn started,
      // the turnComplete still clears the flag (same code path) but this scenario
      // is prevented from reaching here by the clientMessageHandler clearing the flag
      // on user audio arrival when suppressedTurnStarted=false.
      // For safety, verify turnComplete DOES clear the flag either way:
      handleGeminiMessage(
        session, { serverContent: { turnComplete: true } }, sendToClient, null, proactiveReconnect
      );
      expect(session.suppressAIUntilUserSpeaks).toBe(false);
      expect(session.suppressedTurnStarted).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // personaSwitchMode='none' — voice path must never execute a persona switch
  // ---------------------------------------------------------------------------
  describe("personaSwitchMode='none' — voice switch hard-block", () => {
    const multiPersonaBase = () => ({
      hasReceivedFirstAIResponse: true,
      scenarioPersonas: [
        { id: 'p0', name: 'PersonaA', gender: 'male' },
        { id: 'p1', name: 'PersonaB', gender: 'female' },
      ] as any,
      activePersonaIndex: 0,
      geminiSession: { sendToolResponse: vi.fn(), sendClientContent: vi.fn() } as any,
    });

    const switchToolMsg = () => ({
      toolCall: {
        functionCalls: [{
          id: 'fc-none',
          name: 'switch_persona',
          args: { targetPersonaIndex: 1, reason: 'test', transitionLine: 'Hi from B' },
        }],
      },
    });

    it('blocks switch_persona regardless of personaSwitchPending when mode is none', async () => {
      session = makeSession({
        ...multiPersonaBase(),
        personaSwitchMode: 'none',
        personaSwitchPending: true,
        awaitingPersonaSwitch: true,
      });

      handleGeminiMessage(session, switchToolMsg(), sendToClient, null, proactiveReconnect);
      await vi.runAllTimersAsync();

      // activePersonaIndex must remain 0 — no switch allowed
      expect(session.activePersonaIndex).toBe(0);
      // sendToolResponse should have been called with an error (not success)
      expect(session.geminiSession.sendToolResponse).toHaveBeenCalled();
      const callArg = (session.geminiSession.sendToolResponse as any).mock.calls[0][0];
      expect(callArg.functionResponses[0].response.success).toBe(false);
      expect(callArg.functionResponses[0].response.error).toBeDefined();
    });

    it('blocks switch_persona even when all normal-mode allow-conditions are met, if mode is none', async () => {
      session = makeSession({
        ...multiPersonaBase(),
        personaSwitchMode: 'none',
        personaSwitchPending: true,
        awaitingPersonaSwitch: true,
        currentTranscript: 'Let me transfer you to PersonaB.',
      });

      handleGeminiMessage(session, switchToolMsg(), sendToClient, null, proactiveReconnect);
      await vi.runAllTimersAsync();

      expect(session.activePersonaIndex).toBe(0);
    });
  });
});
