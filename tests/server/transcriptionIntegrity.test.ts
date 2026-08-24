import { describe, expect, it, vi } from 'vitest';
import {
  finalizeUserTranscript,
  normalizeVoiceLanguage,
  providerTranscriptionLanguage,
} from '../../server/services/voice/transcriptionIntegrity';
import type { RealtimeSession } from '../../server/services/voice/types';

function makeSession(): RealtimeSession {
  return {
    id: 'session-user-conversation-1',
    personaRunId: 'run-1',
    scenarioId: 'scenario-1',
    personaId: 'persona-1',
    personaName: 'Persona',
    userId: 'user-1',
    userName: 'User',
    clientWs: {} as any,
    geminiSession: null,
    currentTranscript: '',
    userTranscriptBuffer: '',
    audioBuffer: [],
    startTime: 0,
    lastActivityTime: 0,
    totalUserTranscriptLength: 0,
    totalAiTranscriptLength: 0,
    totalCachedTokens: 0,
    realtimeModel: 'gemini-3.1-flash-live-preview',
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
    systemInstructions: '',
    voiceGender: 'female',
    recentMessages: [],
    selectedVoice: null,
    goAwayWarningTime: null,
    pendingClientReady: null,
    userLanguage: 'ko',
    pendingMessages: [],
    outgoingMessageIndex: 0,
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
    lastAudioCommitSentAt: 0,
    audioSourceThisTurn: null,
  };
}

describe('transcription integrity', () => {
  it.each([
    ['ko', 'ko'],
    ['en', 'en'],
    ['ja', 'ja'],
    ['zh', 'zh'],
    ['KO', 'ko'],
    [undefined, 'ko'],
  ])('normalizes %j to %s', (input, expected) => {
    expect(normalizeVoiceLanguage(input)).toBe(expected);
  });

  it('maps the same normalized language to each provider contract', () => {
    expect(providerTranscriptionLanguage('ko', 'gemini')).toBe('ko-KR');
    expect(providerTranscriptionLanguage('ko', 'openai')).toBe('ko');
    expect(providerTranscriptionLanguage('zh', 'gemini')).toBe('zh-CN');
    expect(providerTranscriptionLanguage('zh', 'openai')).toBe('zh');
  });

  it('emits the provider transcript byte-for-byte without filtering or translation', () => {
    const session = makeSession();
    const send = vi.fn();
    const raw = '  네, PO-42 Jane입니다.  ';
    const result = finalizeUserTranscript(session, raw, send, {
      provider: 'gemini',
      source: 'fixture.final',
    });

    expect(result.emitted).toBe(true);
    expect(send).toHaveBeenCalledWith(session, expect.objectContaining({ transcript: raw }));
    expect(session.recentMessages[0].text).toBe(raw);
  });

  it('logs only transcript hash and length, never the transcript content', () => {
    const session = makeSession();
    const send = vi.fn();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const raw = '개인정보가 포함될 수 있는 원문';

    finalizeUserTranscript(session, raw, send, {
      provider: 'gemini',
      source: 'fixture.diagnostic',
    });

    const diagnostic = log.mock.calls.map(args => args.join(' ')).join('\n');
    expect(diagnostic).not.toContain(raw);
    expect(diagnostic).toContain(`"length":${raw.length}`);
    expect(diagnostic).toMatch(/"hash":"[a-f0-9]{16}"/);
    log.mockRestore();
  });

  it('deduplicates a provider replay by event ID without content-based deletion', () => {
    const session = makeSession();
    const send = vi.fn();
    finalizeUserTranscript(session, '정상 한국어 원문', send, {
      provider: 'openai',
      source: 'fixture.final',
      providerEventId: 'item-1',
    });
    finalizeUserTranscript(session, '后来的错误字符串', send, {
      provider: 'openai',
      source: 'fixture.replay',
      providerEventId: 'item-1',
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(session.recentMessages.map(m => m.text)).toEqual(['정상 한국어 원문']);
  });

  it('preserves legitimate repeated short utterances when turn IDs differ', () => {
    const session = makeSession();
    const send = vi.fn();
    finalizeUserTranscript(session, '네', send, { provider: 'gemini', source: 'turn.1' });
    finalizeUserTranscript(session, '네', send, { provider: 'gemini', source: 'turn.2' });

    expect(send).toHaveBeenCalledTimes(2);
    const turnIds = send.mock.calls.map(([, event]) => event.turnId);
    expect(new Set(turnIds).size).toBe(2);
  });

  it('lets a provider final supersede a provisional flush under the same turn ID', () => {
    const session = makeSession();
    const send = vi.fn();
    session.activeUserTranscriptProviderEventId = 'provider-item-7';

    finalizeUserTranscript(session, '부분 전사', send, {
      provider: 'openai',
      source: 'fixture.barge-flush',
      final: false,
    });
    finalizeUserTranscript(session, '부분 전사가 아닌 제공자 최종 원문', send, {
      provider: 'openai',
      source: 'fixture.provider-completed',
      providerEventId: 'provider-item-7',
    });

    const events = send.mock.calls.map(([, event]) => event);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ transcript: '부분 전사', final: false });
    expect(events[1]).toMatchObject({
      transcript: '부분 전사가 아닌 제공자 최종 원문',
      final: true,
    });
    expect(events[0].turnId).toBe(events[1].turnId);
    expect(session.recentMessages.map(message => message.text)).toEqual([
      '부분 전사가 아닌 제공자 최종 원문',
    ]);
  });

  it('retains Gemini logical turn identity across a provisional flush without an item ID', () => {
    const session = makeSession();
    const send = vi.fn();
    session.currentClientSpeechSeq = 7;

    finalizeUserTranscript(session, '부분 전사', send, {
      provider: 'gemini',
      source: 'fixture.barge-flush',
      final: false,
    });
    finalizeUserTranscript(session, 'Gemini 제공자 최종 원문', send, {
      provider: 'gemini',
      source: 'fixture.turn-complete',
    });

    const events = send.mock.calls.map(([, event]) => event);
    expect(events).toHaveLength(2);
    expect(events[0].turnId).toBe(events[1].turnId);
    expect(events[0].final).toBe(false);
    expect(events[1]).toMatchObject({
      transcript: 'Gemini 제공자 최종 원문',
      final: true,
    });
  });
});