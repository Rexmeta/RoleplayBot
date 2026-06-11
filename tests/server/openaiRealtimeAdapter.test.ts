import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMessageHandler } from '../../server/services/voice/openaiRealtimeAdapter';
import type { RealtimeSession } from '../../server/services/voice/types';

vi.mock('../../server/services/voice/emotionAnalyzer', () => ({
  analyzeEmotion: vi.fn().mockResolvedValue({ emotion: '중립', emotionReason: '기본값' }),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({})),
}));

function makeSession(overrides: Partial<RealtimeSession> = {}): RealtimeSession {
  return {
    id: 'test-session',
    personaRunId: 'run-1',
    scenarioId: 'scenario-1',
    personaId: 'persona-1',
    personaName: 'TestPersona',
    userId: 'user-1',
    userName: 'Test User',
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
    realtimeModel: 'openai-realtime',
    hasReceivedFirstAIResponse: false,
    hasReceivedFirstAIAudio: false,
    hasTriggeredFirstGreeting: false,
    firstGreetingRetryCount: 0,
    isInterrupted: false,
    turnSeq: 0,
    cancelledTurnSeq: -1,
    sessionResumptionToken: null,
    isReconnecting: false,
    reconnectAttempts: 0,
    systemInstructions: 'instructions',
    voiceGender: 'female',
    recentMessages: [],
    selectedVoice: null,
    goAwayWarningTime: null,
    pendingClientReady: null,
    pendingMessages: [],
    outgoingMessageIndex: 0,
    userLanguage: 'ko',
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
    pendingHasExistingConversation: false,
    usingReconnectInstructions: false,
    activePersonaIndex: 0,
    voiceId: null,
    scenarioPersonas: null,
    ...overrides,
  };
}

describe('createMessageHandler — barge-in state machine', () => {
  let session: RealtimeSession;
  let sendToClient: ReturnType<typeof vi.fn>;
  let handleMessage: ReturnType<typeof createMessageHandler>;

  beforeEach(() => {
    session = makeSession();
    sendToClient = vi.fn();
    handleMessage = createMessageHandler(session, sendToClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── response.audio.delta suppression ────────────────────────────────────────

  describe('response.audio.delta', () => {
    it('forwards audio.delta to client when not interrupted', () => {
      session.isInterrupted = false;

      handleMessage({ type: 'response.audio.delta', delta: 'AUDIODATA==' });

      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'audio.delta', delta: 'AUDIODATA==', turnSeq: 0 })
      );
    });

    it('suppresses audio.delta when isInterrupted=true and turnSeq <= cancelledTurnSeq', () => {
      session.isInterrupted = true;
      session.turnSeq = 2;
      session.cancelledTurnSeq = 2;

      handleMessage({ type: 'response.audio.delta', delta: 'AUDIODATA==' });

      const audioCalls = sendToClient.mock.calls.filter(
        ([, msg]) => msg.type === 'audio.delta'
      );
      expect(audioCalls).toHaveLength(0);
    });

    it('suppresses audio.delta when turnSeq is strictly less than cancelledTurnSeq', () => {
      session.isInterrupted = true;
      session.turnSeq = 1;
      session.cancelledTurnSeq = 3;

      handleMessage({ type: 'response.audio.delta', delta: 'AUDIODATA==' });

      const audioCalls = sendToClient.mock.calls.filter(
        ([, msg]) => msg.type === 'audio.delta'
      );
      expect(audioCalls).toHaveLength(0);
    });

    it('forwards audio.delta and clears interrupted state when turnSeq > cancelledTurnSeq', () => {
      session.isInterrupted = true;
      session.turnSeq = 3;
      session.cancelledTurnSeq = 2;

      handleMessage({ type: 'response.audio.delta', delta: 'AUDIODATA==' });

      expect(session.isInterrupted).toBe(false);
      expect(session.cancelledTurnSeq).toBe(-1);

      const audioCalls = sendToClient.mock.calls.filter(
        ([, msg]) => msg.type === 'audio.delta'
      );
      expect(audioCalls).toHaveLength(1);
      expect(audioCalls[0][1]).toMatchObject({ type: 'audio.delta', delta: 'AUDIODATA==', turnSeq: 3 });
    });

    it('sends response.ready before audio.delta when clearing interrupted state on audio', () => {
      session.isInterrupted = true;
      session.turnSeq = 5;
      session.cancelledTurnSeq = 4;

      handleMessage({ type: 'response.audio.delta', delta: 'AUDIODATA==' });

      const callTypes = sendToClient.mock.calls.map(([, msg]) => msg.type);
      const readyIdx = callTypes.indexOf('response.ready');
      const audioIdx = callTypes.indexOf('audio.delta');
      expect(readyIdx).toBeGreaterThanOrEqual(0);
      expect(audioIdx).toBeGreaterThan(readyIdx);
    });

    it('emits response.ready with correct turnSeq when clearing interrupted state on audio', () => {
      session.isInterrupted = true;
      session.turnSeq = 5;
      session.cancelledTurnSeq = 4;

      handleMessage({ type: 'response.audio.delta', delta: 'AUDIODATA==' });

      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'response.ready', turnSeq: 5 })
      );
    });

    it('does not send audio.delta when delta is empty/falsy', () => {
      handleMessage({ type: 'response.audio.delta', delta: '' });
      handleMessage({ type: 'response.audio.delta' });

      expect(sendToClient).not.toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'audio.delta' })
      );
    });
  });

  // ─── response.cancelled (barge-in confirmed) ─────────────────────────────────

  describe('response.cancelled', () => {
    it('increments turnSeq on barge-in', () => {
      session.turnSeq = 2;

      handleMessage({ type: 'response.cancelled' });

      expect(session.turnSeq).toBe(3);
    });

    it('sends response.ready with the incremented turnSeq', () => {
      session.turnSeq = 1;

      handleMessage({ type: 'response.cancelled' });

      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'response.ready', turnSeq: 2 })
      );
    });

    it('sends response.interrupted after response.ready', () => {
      handleMessage({ type: 'response.cancelled' });

      const callTypes = sendToClient.mock.calls.map(([, msg]) => msg.type);
      const readyIdx = callTypes.indexOf('response.ready');
      const interruptedIdx = callTypes.indexOf('response.interrupted');
      expect(readyIdx).toBeGreaterThanOrEqual(0);
      expect(interruptedIdx).toBeGreaterThan(readyIdx);
    });

    it('clears isInterrupted flag after response.cancelled', () => {
      session.isInterrupted = true;
      session.cancelledTurnSeq = 1;

      handleMessage({ type: 'response.cancelled' });

      expect(session.isInterrupted).toBe(false);
      expect(session.cancelledTurnSeq).toBe(-1);
    });

    it('resets per-turn counters on response.cancelled', () => {
      session.toolCallCountThisTurn = 3;
      session.emotionCallCountThisTurn = 2;
      session.currentTurnIncidentFired = true;

      handleMessage({ type: 'response.cancelled' });

      expect(session.toolCallCountThisTurn).toBe(0);
      expect(session.emotionCallCountThisTurn).toBe(0);
      expect(session.currentTurnIncidentFired).toBe(false);
    });

    it('clears the current transcript buffer on response.cancelled', () => {
      session.currentTranscript = 'partial transcript';

      handleMessage({ type: 'response.cancelled' });

      expect(session.currentTranscript).toBe('');
    });
  });

  // ─── response.audio_transcript.delta barge-in guard ─────────────────────────

  describe('response.audio_transcript.delta — barge-in guard', () => {
    it('clears isInterrupted when transcript arrives while interrupted', () => {
      session.isInterrupted = true;
      session.cancelledTurnSeq = 1;
      session.turnSeq = 2;

      handleMessage({ type: 'response.audio_transcript.delta', delta: 'Hello' });

      expect(session.isInterrupted).toBe(false);
      expect(session.cancelledTurnSeq).toBe(-1);
    });

    it('sends response.ready with current turnSeq when clearing interrupt via transcript', () => {
      session.isInterrupted = true;
      session.turnSeq = 3;

      handleMessage({ type: 'response.audio_transcript.delta', delta: 'Hi there' });

      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'response.ready', turnSeq: 3 })
      );
    });

    it('does not send response.ready when not interrupted', () => {
      session.isInterrupted = false;

      handleMessage({ type: 'response.audio_transcript.delta', delta: 'Normal text' });

      const readyCalls = sendToClient.mock.calls.filter(([, msg]) => msg.type === 'response.ready');
      expect(readyCalls).toHaveLength(0);
    });

    it('always forwards ai.transcription.delta to client', () => {
      handleMessage({ type: 'response.audio_transcript.delta', delta: 'Some text' });

      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'ai.transcription.delta', text: 'Some text' })
      );
    });
  });

  // ─── response.done barge-in race recovery ────────────────────────────────────

  describe('response.done — barge-in race recovery', () => {
    it('sends response.ready when response.done arrives while wasInterrupted', () => {
      session.isInterrupted = true;
      session.turnSeq = 1;

      handleMessage({ type: 'response.done' });

      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'response.ready', turnSeq: 2 })
      );
    });

    it('increments turnSeq on response.done', () => {
      session.turnSeq = 4;

      handleMessage({ type: 'response.done' });

      expect(session.turnSeq).toBe(5);
    });

    it('clears isInterrupted on response.done', () => {
      session.isInterrupted = true;

      handleMessage({ type: 'response.done' });

      expect(session.isInterrupted).toBe(false);
    });

    it('does NOT send response.ready when response.done arrives normally (not interrupted)', () => {
      session.isInterrupted = false;
      session.turnSeq = 2;

      handleMessage({ type: 'response.done' });

      const readyCalls = sendToClient.mock.calls.filter(([, msg]) => msg.type === 'response.ready');
      expect(readyCalls).toHaveLength(0);
    });

    it('always sends response.done event to client', () => {
      handleMessage({ type: 'response.done' });

      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'response.done' })
      );
    });

    it('resets per-turn counters on response.done', () => {
      session.toolCallCountThisTurn = 2;
      session.emotionCallCountThisTurn = 1;
      session.currentTurnIncidentFired = true;

      handleMessage({ type: 'response.done' });

      expect(session.toolCallCountThisTurn).toBe(0);
      expect(session.emotionCallCountThisTurn).toBe(0);
      expect(session.currentTurnIncidentFired).toBe(false);
    });
  });

  // ─── Full barge-in sequence ───────────────────────────────────────────────────

  describe('full barge-in sequence', () => {
    it('suppresses audio during barge-in then resumes after response.cancelled resync', () => {
      // Turn 0 is in progress — AI is speaking
      session.turnSeq = 0;
      session.cancelledTurnSeq = -1;
      session.isInterrupted = false;

      // Normal audio arrives
      handleMessage({ type: 'response.audio.delta', delta: 'CHUNK1==' });
      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'audio.delta', turnSeq: 0 })
      );
      sendToClient.mockClear();

      // User barges in — client sets isInterrupted + cancelledTurnSeq externally
      session.isInterrupted = true;
      session.cancelledTurnSeq = 0;

      // Stale audio for the cancelled turn should be suppressed
      handleMessage({ type: 'response.audio.delta', delta: 'STALE==' });
      expect(sendToClient).not.toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'audio.delta' })
      );
      sendToClient.mockClear();

      // OpenAI confirms the cancellation
      handleMessage({ type: 'response.cancelled' });
      // turnSeq is now 1, isInterrupted cleared
      expect(session.turnSeq).toBe(1);
      expect(session.isInterrupted).toBe(false);
      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'response.ready', turnSeq: 1 })
      );
      sendToClient.mockClear();

      // New audio for turn 1 should flow through
      handleMessage({ type: 'response.audio.delta', delta: 'NEWCHUNK==' });
      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'audio.delta', delta: 'NEWCHUNK==', turnSeq: 1 })
      );
    });

    it('handles race: response.done arrives instead of response.cancelled after barge-in', () => {
      session.isInterrupted = true;
      session.cancelledTurnSeq = 0;
      session.turnSeq = 0;

      // AI finished speaking before cancel reached OpenAI
      handleMessage({ type: 'response.done' });

      // Should still advance and resync
      expect(session.turnSeq).toBe(1);
      expect(session.isInterrupted).toBe(false);
      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'response.ready', turnSeq: 1 })
      );
    });

    it('handles race: new transcript arrives before response.cancelled clears interrupt', () => {
      session.isInterrupted = true;
      session.cancelledTurnSeq = 0;
      session.turnSeq = 1; // already incremented (e.g. from a prior cancel)

      // New transcript arrives while still marked as interrupted
      handleMessage({ type: 'response.audio_transcript.delta', delta: 'New response' });

      expect(session.isInterrupted).toBe(false);
      expect(session.cancelledTurnSeq).toBe(-1);
      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'response.ready', turnSeq: 1 })
      );
    });

    it('handles race: new audio arrives for advanced turn before response.cancelled', () => {
      session.isInterrupted = true;
      session.cancelledTurnSeq = 0;
      session.turnSeq = 1; // already incremented

      // New audio for turn 1 > cancelledTurnSeq 0 → should clear and forward
      handleMessage({ type: 'response.audio.delta', delta: 'NEWCHUNK==' });

      expect(session.isInterrupted).toBe(false);
      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'response.ready', turnSeq: 1 })
      );
      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'audio.delta', delta: 'NEWCHUNK==', turnSeq: 1 })
      );
    });
  });

  // ─── session.ready / session.configured ──────────────────────────────────────

  describe('session.created / session.updated', () => {
    it('sends session.ready and session.configured on first session.created', () => {
      handleMessage({ type: 'session.created' });

      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'session.ready', sessionId: 'test-session' })
      );
      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'session.configured' })
      );
    });

    it('sends session.ready only once even if session.updated follows', () => {
      handleMessage({ type: 'session.created' });
      sendToClient.mockClear();
      handleMessage({ type: 'session.updated' });

      const readyCalls = sendToClient.mock.calls.filter(([, msg]) => msg.type === 'session.ready');
      expect(readyCalls).toHaveLength(0);
    });
  });

  // ─── error event ─────────────────────────────────────────────────────────────

  describe('error event', () => {
    it('forwards error message to client', () => {
      handleMessage({ type: 'error', error: { message: 'Rate limit exceeded' } });

      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'error', error: 'Rate limit exceeded' })
      );
    });

    it('sends fallback error message when error.message is absent', () => {
      handleMessage({ type: 'error', error: {} });

      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'error', error: 'OpenAI Realtime API error' })
      );
    });
  });

  // ─── user speech / transcript events ─────────────────────────────────────────

  describe('input_audio_buffer.speech_started', () => {
    it('sends user.speaking.started and sets userSpeechStarted', () => {
      handleMessage({ type: 'input_audio_buffer.speech_started' });

      expect(session.userSpeechStarted).toBe(true);
      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'user.speaking.started' })
      );
    });
  });

  describe('conversation.item.input_audio_transcription.completed', () => {
    it('sends user.transcription and increments userTurnsCompleted', () => {
      handleMessage({
        type: 'conversation.item.input_audio_transcription.completed',
        transcript: 'Hello AI',
      });

      expect(session.userTurnsCompleted).toBe(1);
      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'user.transcription', transcript: 'Hello AI' })
      );
    });

    it('uses accumulated buffer when msg.transcript is absent', () => {
      handleMessage({ type: 'conversation.item.input_audio_transcription.delta', delta: 'par' });
      handleMessage({ type: 'conversation.item.input_audio_transcription.delta', delta: 'tial' });
      handleMessage({ type: 'conversation.item.input_audio_transcription.completed' });

      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'user.transcription', transcript: 'partial' })
      );
    });
  });

  // ─── Barge-in user transcript buffer guard ────────────────────────────────────

  describe('conversation.item.input_audio_transcription.delta — barge-in guard', () => {
    it('discards delta and does not forward to client when isInterrupted=true', () => {
      session.isInterrupted = true;

      handleMessage({ type: 'conversation.item.input_audio_transcription.delta', delta: 'stale text' });

      expect(sendToClient).not.toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'user.transcription.delta' })
      );
    });

    it('does not accumulate delta into buffer when isInterrupted=true', () => {
      session.isInterrupted = true;

      handleMessage({ type: 'conversation.item.input_audio_transcription.delta', delta: 'stale text' });

      expect(session.userTranscriptBuffer).toBe('');
    });

    it('accumulates delta normally when isInterrupted=false', () => {
      session.isInterrupted = false;

      handleMessage({ type: 'conversation.item.input_audio_transcription.delta', delta: 'good text' });

      expect(session.userTranscriptBuffer).toBe('good text');
      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'user.transcription.delta', text: 'good text', accumulated: 'good text' })
      );
    });

    it('discards multiple stale deltas during barge-in then accumulates cleanly after interrupt clears', () => {
      session.isInterrupted = true;
      session.cancelledTurnSeq = 0;
      session.turnSeq = 0;

      handleMessage({ type: 'conversation.item.input_audio_transcription.delta', delta: 'stale1 ' });
      handleMessage({ type: 'conversation.item.input_audio_transcription.delta', delta: 'stale2 ' });

      // Barge-in confirmed: response.cancelled resets buffer and clears interrupt
      handleMessage({ type: 'response.cancelled' });

      // Now new user speech comes in — should accumulate without stale prefix
      handleMessage({ type: 'conversation.item.input_audio_transcription.delta', delta: 'real speech' });

      expect(session.userTranscriptBuffer).toBe('real speech');
      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'user.transcription.delta', text: 'real speech', accumulated: 'real speech' })
      );
    });

    it('response.cancelled resets accumulatedUserTranscript so next turn starts clean', () => {
      // Simulate a partial buffer that accumulated before the barge-in guard was hit
      session.isInterrupted = false;
      handleMessage({ type: 'conversation.item.input_audio_transcription.delta', delta: 'partial ' });
      expect(session.userTranscriptBuffer).toBe('partial ');

      // Barge-in occurs
      session.isInterrupted = true;
      session.cancelledTurnSeq = 0;

      // Cancellation arrives — buffer must be wiped
      handleMessage({ type: 'response.cancelled' });

      expect(session.userTranscriptBuffer).toBe('');

      // Subsequent delta (with interrupt now cleared) starts fresh
      handleMessage({ type: 'conversation.item.input_audio_transcription.delta', delta: 'fresh' });
      expect(session.userTranscriptBuffer).toBe('fresh');
    });

    it('completed event after barge-in cancel does not emit stale transcript', () => {
      session.isInterrupted = true;
      handleMessage({ type: 'conversation.item.input_audio_transcription.delta', delta: 'stale' });

      // Barge-in confirmed
      handleMessage({ type: 'response.cancelled' });

      // completed arrives with no transcript and an empty buffer — should not emit user.transcription
      handleMessage({ type: 'conversation.item.input_audio_transcription.completed' });

      const transcriptCalls = sendToClient.mock.calls.filter(([, msg]) => msg.type === 'user.transcription');
      expect(transcriptCalls).toHaveLength(0);
    });
  });
});
