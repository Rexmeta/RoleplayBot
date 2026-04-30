import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { summarizeOlderMessages } from '../../server/services/voice/clientMessageHandler';
import { handleClientMessage } from '../../server/services/voice/clientMessageHandler';
import type { RealtimeSession } from '../../server/services/voice/types';

const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(function () {
    return {
      models: {
        generateContent: mockGenerateContent,
      },
    };
  }),
}));

function makeMessages(count: number): Array<{ role: 'user' | 'ai'; content: string }> {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'ai',
    content: `message ${i + 1}`,
  }));
}

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
    isConnected: true,
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

describe('summarizeOlderMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('fallback when API key is absent', () => {
    it('returns joined messages when no API key is set', async () => {
      const messages = [
        { role: 'user' as const, content: '안녕하세요' },
        { role: 'ai' as const, content: '반갑습니다' },
      ];

      const result = await summarizeOlderMessages(messages, 'ko');

      expect(result).toBe('사용자: 안녕하세요\nAI: 반갑습니다');
    });

    it('formats user messages with 사용자 prefix', async () => {
      const messages = [{ role: 'user' as const, content: 'hello' }];
      const result = await summarizeOlderMessages(messages, 'en');
      expect(result).toContain('사용자: hello');
    });

    it('formats ai messages with AI prefix', async () => {
      const messages = [{ role: 'ai' as const, content: 'hello back' }];
      const result = await summarizeOlderMessages(messages, 'en');
      expect(result).toContain('AI: hello back');
    });

    it('does not call Gemini when API key is absent', async () => {
      await summarizeOlderMessages(makeMessages(5), 'ko');
      expect(mockGenerateContent).not.toHaveBeenCalled();
    });
  });

  describe('successful Gemini summarization', () => {
    beforeEach(() => {
      process.env.GOOGLE_API_KEY = 'test-api-key';
      mockGenerateContent.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [{ text: '  이전 대화 요약 내용  ' }],
            },
          },
        ],
      });
    });

    it('returns trimmed summary text from Gemini response', async () => {
      const messages = makeMessages(5);
      const result = await summarizeOlderMessages(messages, 'ko');
      expect(result).toBe('이전 대화 요약 내용');
    });

    it('calls generateContent with gemini-2.0-flash model', async () => {
      const messages = makeMessages(3);
      await summarizeOlderMessages(messages, 'en');

      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'gemini-2.0-flash' })
      );
    });

    it('uses GEMINI_API_KEY as fallback when GOOGLE_API_KEY is absent', async () => {
      delete process.env.GOOGLE_API_KEY;
      process.env.GEMINI_API_KEY = 'gemini-key';

      const { GoogleGenAI } = await import('@google/genai');
      const messages = makeMessages(3);
      await summarizeOlderMessages(messages, 'ko');
      expect(GoogleGenAI).toHaveBeenCalledWith({ apiKey: 'gemini-key' });

      delete process.env.GEMINI_API_KEY;
    });

    it('returns empty string when candidates array is missing', async () => {
      mockGenerateContent.mockResolvedValue({});

      const messages = makeMessages(3);
      const result = await summarizeOlderMessages(messages, 'ko');
      expect(result).toBe('');
    });
  });

  describe('language-specific prompt instructions', () => {
    beforeEach(() => {
      process.env.GOOGLE_API_KEY = 'test-api-key';
      mockGenerateContent.mockResolvedValue({
        candidates: [{ content: { parts: [{ text: 'summary' }] } }],
      });
    });

    it('includes Korean instruction for ko language', async () => {
      await summarizeOlderMessages(makeMessages(2), 'ko');
      const callArg = mockGenerateContent.mock.calls[0][0];
      const prompt = callArg.contents[0].parts[0].text;
      expect(prompt).toContain('한국어로 요약해 주세요.');
    });

    it('includes Japanese instruction for ja language', async () => {
      await summarizeOlderMessages(makeMessages(2), 'ja');
      const callArg = mockGenerateContent.mock.calls[0][0];
      const prompt = callArg.contents[0].parts[0].text;
      expect(prompt).toContain('日本語で要約してください。');
    });

    it('includes Chinese instruction for zh language', async () => {
      await summarizeOlderMessages(makeMessages(2), 'zh');
      const callArg = mockGenerateContent.mock.calls[0][0];
      const prompt = callArg.contents[0].parts[0].text;
      expect(prompt).toContain('请用中文总结。');
    });

    it('defaults to English instruction for unknown language', async () => {
      await summarizeOlderMessages(makeMessages(2), 'en');
      const callArg = mockGenerateContent.mock.calls[0][0];
      const prompt = callArg.contents[0].parts[0].text;
      expect(prompt).toContain('Please summarize in English.');
    });
  });

  describe('fallback when Gemini API call fails', () => {
    beforeEach(() => {
      process.env.GOOGLE_API_KEY = 'test-api-key';
      mockGenerateContent.mockRejectedValue(new Error('Network error'));
    });

    it('falls back to joined messages on API error', async () => {
      const messages = [
        { role: 'user' as const, content: '질문' },
        { role: 'ai' as const, content: '답변' },
      ];

      const result = await summarizeOlderMessages(messages, 'ko');

      expect(result).toBe('사용자: 질문\nAI: 답변');
    });

    it('does not throw when Gemini call fails', async () => {
      const messages = makeMessages(5);
      await expect(summarizeOlderMessages(messages, 'ko')).resolves.toBeDefined();
    });

    it('returns string (not undefined or null) on API error', async () => {
      const result = await summarizeOlderMessages(makeMessages(3), 'ko');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });
});

describe('handleClientMessage — 30-message threshold boundary', () => {
  let sessions: Map<string, RealtimeSession>;
  let sendToClient: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessions = new Map();
    sendToClient = vi.fn();
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_API_KEY;
    mockGenerateContent.mockResolvedValue({
      candidates: [{ content: { parts: [{ text: 'AI generated summary' }] } }],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function makeGeminiSession() {
    return {
      sendClientContent: vi.fn(),
      sendRealtimeInput: vi.fn(),
    };
  }

  describe('isResuming path', () => {
    it('uses full history without summarization when messages ≤ 30', async () => {
      const geminiSession = makeGeminiSession();
      const session = makeSession({
        geminiSession: geminiSession as any,
        isConnected: true,
        userLanguage: 'ko',
      });
      sessions.set('test-session', session);

      handleClientMessage(
        'test-session',
        {
          type: 'client.ready',
          isResuming: true,
          hasExistingConversation: false,
          previousMessages: makeMessages(30),
        },
        sessions,
        sendToClient
      );

      await vi.waitFor(() => {
        expect(geminiSession.sendClientContent).toHaveBeenCalled();
      });

      const callArg = geminiSession.sendClientContent.mock.calls[0][0];
      const contextText = callArg.turns[0].parts[0].text;
      expect(contextText).toContain('[이전 대화 내용');
      expect(contextText).not.toContain('[이전 대화 요약]');
    });

    it('triggers summarization when messages > 30', async () => {
      process.env.GOOGLE_API_KEY = 'test-key';
      const geminiSession = makeGeminiSession();
      const session = makeSession({
        geminiSession: geminiSession as any,
        isConnected: true,
        userLanguage: 'ko',
      });
      sessions.set('test-session', session);

      handleClientMessage(
        'test-session',
        {
          type: 'client.ready',
          isResuming: true,
          hasExistingConversation: false,
          previousMessages: makeMessages(31),
        },
        sessions,
        sendToClient
      );

      await vi.waitFor(() => {
        expect(geminiSession.sendClientContent).toHaveBeenCalled();
      });

      const callArg = geminiSession.sendClientContent.mock.calls[0][0];
      const contextText = callArg.turns[0].parts[0].text;
      expect(contextText).toContain('[이전 대화 요약]');
      expect(contextText).toContain('[최근 대화 내용]');
    });

    it('boundary: exactly 30 messages uses full history (no summarization)', async () => {
      const geminiSession = makeGeminiSession();
      const session = makeSession({
        geminiSession: geminiSession as any,
        isConnected: true,
        userLanguage: 'ko',
      });
      sessions.set('test-session', session);

      handleClientMessage(
        'test-session',
        {
          type: 'client.ready',
          isResuming: true,
          hasExistingConversation: false,
          previousMessages: makeMessages(30),
        },
        sessions,
        sendToClient
      );

      await vi.waitFor(() => {
        expect(geminiSession.sendClientContent).toHaveBeenCalled();
      });

      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it('boundary: 31 messages triggers summarization call', async () => {
      process.env.GOOGLE_API_KEY = 'test-key';
      const geminiSession = makeGeminiSession();
      const session = makeSession({
        geminiSession: geminiSession as any,
        isConnected: true,
        userLanguage: 'ko',
      });
      sessions.set('test-session', session);

      handleClientMessage(
        'test-session',
        {
          type: 'client.ready',
          isResuming: true,
          hasExistingConversation: false,
          previousMessages: makeMessages(31),
        },
        sessions,
        sendToClient
      );

      await vi.waitFor(() => {
        expect(geminiSession.sendClientContent).toHaveBeenCalled();
      });

      expect(mockGenerateContent).toHaveBeenCalled();
    });
  });

  describe('hasExistingConversation (text-to-voice) path', () => {
    it('uses full history for text-to-voice transition when messages ≤ 30', async () => {
      const geminiSession = makeGeminiSession();
      const session = makeSession({
        geminiSession: geminiSession as any,
        isConnected: true,
        userLanguage: 'ko',
      });
      sessions.set('test-session', session);

      handleClientMessage(
        'test-session',
        {
          type: 'client.ready',
          isResuming: false,
          hasExistingConversation: true,
          previousMessages: makeMessages(30),
        },
        sessions,
        sendToClient
      );

      await vi.waitFor(() => {
        expect(geminiSession.sendClientContent).toHaveBeenCalled();
      });

      const callArg = geminiSession.sendClientContent.mock.calls[0][0];
      const contextText = callArg.turns[0].parts[0].text;
      expect(contextText).toContain('[이전 텍스트 대화 내용]');
      expect(contextText).not.toContain('[이전 대화 요약]');
    });

    it('triggers summarization for text-to-voice transition when messages > 30', async () => {
      process.env.GOOGLE_API_KEY = 'test-key';
      const geminiSession = makeGeminiSession();
      const session = makeSession({
        geminiSession: geminiSession as any,
        isConnected: true,
        userLanguage: 'ko',
      });
      sessions.set('test-session', session);

      handleClientMessage(
        'test-session',
        {
          type: 'client.ready',
          isResuming: false,
          hasExistingConversation: true,
          previousMessages: makeMessages(31),
        },
        sessions,
        sendToClient
      );

      await vi.waitFor(() => {
        expect(geminiSession.sendClientContent).toHaveBeenCalled();
      });

      const callArg = geminiSession.sendClientContent.mock.calls[0][0];
      const contextText = callArg.turns[0].parts[0].text;
      expect(contextText).toContain('[이전 대화 요약]');
      expect(contextText).toContain('[최근 대화 내용]');
    });
  });

  describe('server-preloaded recentMessages fallback (no client previousMessages)', () => {
    it('isResuming: uses session.recentMessages when client sends no previousMessages', async () => {
      const geminiSession = makeGeminiSession();
      const preloadedMessages = [
        { role: 'user' as const, text: '안녕하세요' },
        { role: 'ai' as const, text: '네, 반갑습니다' },
      ];
      const session = makeSession({
        geminiSession: geminiSession as any,
        isConnected: true,
        userLanguage: 'ko',
        recentMessages: preloadedMessages,
      });
      sessions.set('test-session', session);

      handleClientMessage(
        'test-session',
        {
          type: 'client.ready',
          isResuming: true,
          hasExistingConversation: false,
        },
        sessions,
        sendToClient
      );

      await vi.waitFor(() => {
        expect(geminiSession.sendClientContent).toHaveBeenCalled();
      });

      const callArg = geminiSession.sendClientContent.mock.calls[0][0];
      const contextText = callArg.turns[0].parts[0].text;
      expect(contextText).toContain('[이전 대화 내용');
      expect(contextText).toContain('안녕하세요');
      expect(contextText).toContain('네, 반갑습니다');
    });

    it('isResuming: uses session.recentMessages when client sends empty previousMessages array', async () => {
      const geminiSession = makeGeminiSession();
      const preloadedMessages = [
        { role: 'user' as const, text: '서버에서 불러온 메시지' },
        { role: 'ai' as const, text: '서버 응답 내용' },
      ];
      const session = makeSession({
        geminiSession: geminiSession as any,
        isConnected: true,
        userLanguage: 'ko',
        recentMessages: preloadedMessages,
      });
      sessions.set('test-session', session);

      handleClientMessage(
        'test-session',
        {
          type: 'client.ready',
          isResuming: true,
          hasExistingConversation: false,
          previousMessages: [],
        },
        sessions,
        sendToClient
      );

      await vi.waitFor(() => {
        expect(geminiSession.sendClientContent).toHaveBeenCalled();
      });

      const callArg = geminiSession.sendClientContent.mock.calls[0][0];
      const contextText = callArg.turns[0].parts[0].text;
      expect(contextText).toContain('서버에서 불러온 메시지');
      expect(contextText).toContain('서버 응답 내용');
    });

    it('isResuming: client previousMessages take precedence over session.recentMessages', async () => {
      const geminiSession = makeGeminiSession();
      const preloadedMessages = [
        { role: 'user' as const, text: '서버 메시지' },
      ];
      const session = makeSession({
        geminiSession: geminiSession as any,
        isConnected: true,
        userLanguage: 'ko',
        recentMessages: preloadedMessages,
      });
      sessions.set('test-session', session);

      handleClientMessage(
        'test-session',
        {
          type: 'client.ready',
          isResuming: true,
          hasExistingConversation: false,
          previousMessages: [
            { role: 'user', content: '클라이언트 메시지' },
            { role: 'ai', content: '클라이언트 AI 응답' },
          ],
        },
        sessions,
        sendToClient
      );

      await vi.waitFor(() => {
        expect(geminiSession.sendClientContent).toHaveBeenCalled();
      });

      const callArg = geminiSession.sendClientContent.mock.calls[0][0];
      const contextText = callArg.turns[0].parts[0].text;
      expect(contextText).toContain('클라이언트 메시지');
      expect(contextText).not.toContain('서버 메시지');
    });

    it('isResuming: falls back to greeting when both previousMessages and recentMessages are empty', async () => {
      const geminiSession = makeGeminiSession();
      const session = makeSession({
        geminiSession: geminiSession as any,
        isConnected: true,
        userLanguage: 'ko',
        recentMessages: [],
      });
      sessions.set('test-session', session);

      handleClientMessage(
        'test-session',
        {
          type: 'client.ready',
          isResuming: true,
          hasExistingConversation: false,
          previousMessages: [],
        },
        sessions,
        sendToClient
      );

      await vi.waitFor(() => {
        expect(geminiSession.sendClientContent).toHaveBeenCalled();
      });

      const callArg = geminiSession.sendClientContent.mock.calls[0][0];
      const contextText = callArg.turns[0].parts[0].text;
      expect(contextText).toBe('안녕하세요');
    });

    it('hasExistingConversation: uses session.recentMessages when client sends no previousMessages', async () => {
      const geminiSession = makeGeminiSession();
      const preloadedMessages = [
        { role: 'user' as const, text: '텍스트 채팅 메시지' },
        { role: 'ai' as const, text: '텍스트 채팅 AI 응답' },
      ];
      const session = makeSession({
        geminiSession: geminiSession as any,
        isConnected: true,
        userLanguage: 'ko',
        recentMessages: preloadedMessages,
      });
      sessions.set('test-session', session);

      handleClientMessage(
        'test-session',
        {
          type: 'client.ready',
          isResuming: false,
          hasExistingConversation: true,
        },
        sessions,
        sendToClient
      );

      await vi.waitFor(() => {
        expect(geminiSession.sendClientContent).toHaveBeenCalled();
      });

      const callArg = geminiSession.sendClientContent.mock.calls[0][0];
      const contextText = callArg.turns[0].parts[0].text;
      expect(contextText).toContain('[이전 텍스트 대화 내용]');
      expect(contextText).toContain('텍스트 채팅 메시지');
      expect(contextText).toContain('텍스트 채팅 AI 응답');
    });

    it('hasExistingConversation: uses session.recentMessages when client sends empty previousMessages', async () => {
      const geminiSession = makeGeminiSession();
      const preloadedMessages = [
        { role: 'user' as const, text: '서버 텍스트 히스토리' },
      ];
      const session = makeSession({
        geminiSession: geminiSession as any,
        isConnected: true,
        userLanguage: 'ko',
        recentMessages: preloadedMessages,
      });
      sessions.set('test-session', session);

      handleClientMessage(
        'test-session',
        {
          type: 'client.ready',
          isResuming: false,
          hasExistingConversation: true,
          previousMessages: [],
        },
        sessions,
        sendToClient
      );

      await vi.waitFor(() => {
        expect(geminiSession.sendClientContent).toHaveBeenCalled();
      });

      const callArg = geminiSession.sendClientContent.mock.calls[0][0];
      const contextText = callArg.turns[0].parts[0].text;
      expect(contextText).toContain('서버 텍스트 히스토리');
    });

    it('hasExistingConversation: client previousMessages take precedence over session.recentMessages', async () => {
      const geminiSession = makeGeminiSession();
      const session = makeSession({
        geminiSession: geminiSession as any,
        isConnected: true,
        userLanguage: 'ko',
        recentMessages: [{ role: 'user' as const, text: '서버 히스토리' }],
      });
      sessions.set('test-session', session);

      handleClientMessage(
        'test-session',
        {
          type: 'client.ready',
          isResuming: false,
          hasExistingConversation: true,
          previousMessages: [
            { role: 'user', content: '클라이언트 텍스트 대화' },
          ],
        },
        sessions,
        sendToClient
      );

      await vi.waitFor(() => {
        expect(geminiSession.sendClientContent).toHaveBeenCalled();
      });

      const callArg = geminiSession.sendClientContent.mock.calls[0][0];
      const contextText = callArg.turns[0].parts[0].text;
      expect(contextText).toContain('클라이언트 텍스트 대화');
      expect(contextText).not.toContain('서버 히스토리');
    });
  });

  describe('graceful fallback when summarization fails', () => {
    it('isResuming: still sends context to Gemini even when summarization API fails', async () => {
      process.env.GOOGLE_API_KEY = 'bad-key';
      mockGenerateContent.mockRejectedValue(new Error('API failure'));

      const geminiSession = makeGeminiSession();
      const session = makeSession({
        geminiSession: geminiSession as any,
        isConnected: true,
        userLanguage: 'ko',
      });
      sessions.set('test-session', session);

      handleClientMessage(
        'test-session',
        {
          type: 'client.ready',
          isResuming: true,
          hasExistingConversation: false,
          previousMessages: makeMessages(31),
        },
        sessions,
        sendToClient
      );

      await vi.waitFor(() => {
        expect(geminiSession.sendClientContent).toHaveBeenCalled();
      });

      const callArg = geminiSession.sendClientContent.mock.calls[0][0];
      const contextText = callArg.turns[0].parts[0].text;
      expect(typeof contextText).toBe('string');
      expect(contextText.length).toBeGreaterThan(0);
    });
  });
});
