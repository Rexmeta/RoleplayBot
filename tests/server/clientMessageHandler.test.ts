import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { summarizeOlderMessages } from '../../server/services/voice/clientMessageHandler';
import { handleClientMessage } from '../../server/services/voice/clientMessageHandler';
import type { RealtimeSession } from '../../server/services/voice/types';
import { makeSession } from './helpers/voiceSession';

vi.mock('../../server/services/voice/textFilter', () => ({
  filterThinkingText: vi.fn((text: string) => text),
}));

import { filterThinkingText } from '../../server/services/voice/textFilter';

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
      expect(contextText).toContain('이전 대화 내용');
      expect(contextText).not.toContain('[이전 대화 요약]');
    });

    it('triggers summarization when messages > 30', async () => {
      process.env.GOOGLE_API_KEY = 'test-key';
      const geminiSession = makeGeminiSession();
      const session = makeSession({
        geminiSession: geminiSession as any,
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
      expect(contextText).toContain('이전 대화 요약');
      expect(contextText).toContain('[최근 대화 내용]');
    });

    it('boundary: exactly 30 messages uses full history (no summarization)', async () => {
      const geminiSession = makeGeminiSession();
      const session = makeSession({
        geminiSession: geminiSession as any,
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
      expect(contextText).toContain('이전 대화 내용');
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

    it('isResuming: sends silence directive (no greeting) when both previousMessages and recentMessages are empty', async () => {
      const geminiSession = makeGeminiSession();
      const session = makeSession({
        geminiSession: geminiSession as any,
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
      expect(contextText).not.toBe('안녕하세요');
      expect(contextText).toContain('재연결');
      expect(contextText).toContain('침묵');
      expect(callArg.turnComplete).toBe(false);
    });

    it('isResuming: empty history → hasTriggeredFirstGreeting and hasReceivedFirstAIResponse are both set to true', async () => {
      const geminiSession = makeGeminiSession();
      const session = makeSession({
        geminiSession: geminiSession as any,
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
        },
        sessions,
        sendToClient
      );

      await vi.waitFor(() => {
        expect(geminiSession.sendClientContent).toHaveBeenCalled();
      });

      expect(session.hasTriggeredFirstGreeting).toBe(true);
      expect(session.hasReceivedFirstAIResponse).toBe(true);
    });

    it('isResuming: empty history → END_OF_TURN is NOT sent (no greeting forced)', async () => {
      const geminiSession = makeGeminiSession();
      const session = makeSession({
        geminiSession: geminiSession as any,
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

      expect(geminiSession.sendRealtimeInput).not.toHaveBeenCalled();
    });

    it('hasExistingConversation: uses session.recentMessages when client sends no previousMessages', async () => {
      const geminiSession = makeGeminiSession();
      const preloadedMessages = [
        { role: 'user' as const, text: '텍스트 채팅 메시지' },
        { role: 'ai' as const, text: '텍스트 채팅 AI 응답' },
      ];
      const session = makeSession({
        geminiSession: geminiSession as any,
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

describe('handleClientMessage — guard logic and switch-case branches', () => {
  let sendToClient: ReturnType<typeof vi.fn>;

  function makeGeminiSession() {
    return {
      sendClientContent: vi.fn(),
      sendRealtimeInput: vi.fn(),
      close: vi.fn(),
    };
  }


  beforeEach(() => {
    sendToClient = vi.fn();
    vi.clearAllMocks();
    vi.mocked(filterThinkingText).mockImplementation((text: string) => text);
  });

  describe('missing session guard', () => {
    it('returns early and logs an error when the session does not exist', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const sessions = new Map<string, RealtimeSession>();

      handleClientMessage('no-such-session', { type: 'ping' }, sessions, sendToClient);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Session not found'));
      expect(sendToClient).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('does not throw when the session is missing', () => {
      expect(() =>
        handleClientMessage('no-such-session', { type: 'ping' }, new Map(), sendToClient)
      ).not.toThrow();
    });
  });

  describe('lastActivityTime is always updated', () => {
    it('updates lastActivityTime before branching on geminiSession presence', () => {
      const before = 0;
      const session = makeSession({ geminiSession: makeGeminiSession(), lastActivityTime: before });
      const sessions = new Map([[session.id, session]]);

      handleClientMessage(session.id, { type: 'ping' }, sessions, sendToClient);

      expect(session.lastActivityTime).toBeGreaterThan(before);
    });
  });

  describe('geminiSession absent — buffering vs. dropping', () => {
    it('buffers client.ready when geminiSession is null', () => {
      const session = makeSession({ geminiSession: null });
      const sessions = new Map([[session.id, session]]);
      const msg = { type: 'client.ready' };

      handleClientMessage(session.id, msg, sessions, sendToClient);

      expect(session.pendingClientReady).toBe(msg);
      expect(sendToClient).not.toHaveBeenCalled();
    });

    it('buffers client.ready based solely on geminiSession being null', () => {
      const sessionA = makeSession({ geminiSession: null });
      const sessionsA = new Map([[sessionA.id, sessionA]]);
      const msgA = { type: 'client.ready' };
      handleClientMessage(sessionA.id, msgA, sessionsA, sendToClient);
      expect(sessionA.pendingClientReady).toBe(msgA);

      const sessionB = makeSession({ id: 'guard-session-b', geminiSession: null });
      const sessionsB = new Map([[sessionB.id, sessionB]]);
      const msgB = { type: 'client.ready', hasExistingConversation: false };
      handleClientMessage(sessionB.id, msgB, sessionsB, sendToClient);
      expect(sessionB.pendingClientReady).toEqual(msgB);

      expect(sendToClient).not.toHaveBeenCalled();
    });

    it('drops input_audio_buffer.append (not buffered) when geminiSession is null', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const session = makeSession({ geminiSession: null });
      const sessions = new Map([[session.id, session]]);

      handleClientMessage(session.id, { type: 'input_audio_buffer.append', audio: 'abc' }, sessions, sendToClient);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('dropping message type'));
      expect(session.pendingClientReady).toBeNull();
      expect(sendToClient).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('drops input_audio_buffer.commit when geminiSession is null', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const session = makeSession({ geminiSession: null });
      const sessions = new Map([[session.id, session]]);

      handleClientMessage(session.id, { type: 'input_audio_buffer.commit' }, sessions, sendToClient);

      expect(warnSpy).toHaveBeenCalled();
      expect(sendToClient).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('drops response.cancel when geminiSession is null', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const session = makeSession({ geminiSession: null });
      const sessions = new Map([[session.id, session]]);

      handleClientMessage(session.id, { type: 'response.cancel' }, sessions, sendToClient);

      expect(warnSpy).toHaveBeenCalled();
      expect(sendToClient).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('drops ping when geminiSession is null (ping is not buffered)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const session = makeSession({ geminiSession: null });
      const sessions = new Map([[session.id, session]]);

      handleClientMessage(session.id, { type: 'ping' }, sessions, sendToClient);

      expect(warnSpy).toHaveBeenCalled();
      expect(sendToClient).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe('switch-case: input_audio_buffer.append', () => {
    it('calls sendRealtimeInput with audio data and correct mimeType', () => {
      const geminiSession = makeGeminiSession();
      const session = makeSession({ geminiSession });
      const sessions = new Map([[session.id, session]]);

      handleClientMessage(
        session.id,
        { type: 'input_audio_buffer.append', audio: 'base64data' },
        sessions,
        sendToClient
      );

      expect(geminiSession.sendRealtimeInput).toHaveBeenCalledWith({
        audio: { data: 'base64data', mimeType: 'audio/pcm;rate=16000' },
      });
      expect(geminiSession.sendClientContent).not.toHaveBeenCalled();
    });

    it('does not call sendToClient for audio messages', () => {
      const geminiSession = makeGeminiSession();
      const session = makeSession({ geminiSession });
      const sessions = new Map([[session.id, session]]);

      handleClientMessage(
        session.id,
        { type: 'input_audio_buffer.append', audio: 'data' },
        sessions,
        sendToClient
      );

      expect(sendToClient).not.toHaveBeenCalled();
    });

  });

  describe('switch-case: input_audio_buffer.commit', () => {
    it('calls sendRealtimeInput with END_OF_TURN event', () => {
      const geminiSession = makeGeminiSession();
      const session = makeSession({ geminiSession });
      const sessions = new Map([[session.id, session]]);

      handleClientMessage(session.id, { type: 'input_audio_buffer.commit' }, sessions, sendToClient);

      expect(geminiSession.sendRealtimeInput).toHaveBeenCalledWith({ event: 'END_OF_TURN' });
      expect(geminiSession.sendClientContent).not.toHaveBeenCalled();
      expect(sendToClient).not.toHaveBeenCalled();
    });
  });

  describe('switch-case: response.create', () => {
    it('calls sendRealtimeInput with END_OF_TURN event', () => {
      const geminiSession = makeGeminiSession();
      const session = makeSession({ geminiSession });
      const sessions = new Map([[session.id, session]]);

      handleClientMessage(session.id, { type: 'response.create' }, sessions, sendToClient);

      expect(geminiSession.sendRealtimeInput).toHaveBeenCalledWith({ event: 'END_OF_TURN' });
      expect(geminiSession.sendClientContent).not.toHaveBeenCalled();
      expect(sendToClient).not.toHaveBeenCalled();
    });
  });

  describe('switch-case: conversation.item.create', () => {
    it('calls sendClientContent with the text extracted from item content', () => {
      const geminiSession = makeGeminiSession();
      const session = makeSession({ geminiSession });
      const sessions = new Map([[session.id, session]]);

      handleClientMessage(
        session.id,
        { type: 'conversation.item.create', item: { content: [{ text: 'hello world' }] } },
        sessions,
        sendToClient
      );

      expect(geminiSession.sendClientContent).toHaveBeenCalledWith({
        turns: [{ role: 'user', parts: [{ text: 'hello world' }] }],
        turnComplete: true,
      });
      expect(geminiSession.sendRealtimeInput).not.toHaveBeenCalled();
    });

    it('does not call sendClientContent when item is missing', () => {
      const geminiSession = makeGeminiSession();
      const session = makeSession({ geminiSession });
      const sessions = new Map([[session.id, session]]);

      handleClientMessage(session.id, { type: 'conversation.item.create' }, sessions, sendToClient);

      expect(geminiSession.sendClientContent).not.toHaveBeenCalled();
    });

    it('does not call sendClientContent when item.content is missing', () => {
      const geminiSession = makeGeminiSession();
      const session = makeSession({ geminiSession });
      const sessions = new Map([[session.id, session]]);

      handleClientMessage(session.id, { type: 'conversation.item.create', item: {} }, sessions, sendToClient);

      expect(geminiSession.sendClientContent).not.toHaveBeenCalled();
    });
  });

  describe('switch-case: client.ready (new session, no prior context)', () => {
    it('does NOT auto-trigger greeting — user speaks first (no sendClientContent or sendRealtimeInput)', () => {
      const geminiSession = makeGeminiSession();
      const session = makeSession({ geminiSession });
      const sessions = new Map([[session.id, session]]);

      handleClientMessage(session.id, { type: 'client.ready' }, sessions, sendToClient);

      expect(geminiSession.sendClientContent).not.toHaveBeenCalled();
      expect(geminiSession.sendRealtimeInput).not.toHaveBeenCalled();
    });

    it('marks hasTriggeredFirstGreeting as true after sending the greeting', () => {
      const geminiSession = makeGeminiSession();
      const session = makeSession({ geminiSession });
      const sessions = new Map([[session.id, session]]);

      handleClientMessage(session.id, { type: 'client.ready' }, sessions, sendToClient);

      expect(session.hasTriggeredFirstGreeting).toBe(true);
    });

    it('skips greeting when hasTriggeredFirstGreeting is already true', () => {
      const geminiSession = makeGeminiSession();
      const session = makeSession({ geminiSession, hasTriggeredFirstGreeting: true });
      const sessions = new Map([[session.id, session]]);

      handleClientMessage(session.id, { type: 'client.ready' }, sessions, sendToClient);

      expect(geminiSession.sendClientContent).not.toHaveBeenCalled();
      expect(geminiSession.sendRealtimeInput).not.toHaveBeenCalled();
    });

    it('skips greeting when hasReceivedFirstAIResponse is already true', () => {
      const geminiSession = makeGeminiSession();
      const session = makeSession({ geminiSession, hasReceivedFirstAIResponse: true });
      const sessions = new Map([[session.id, session]]);

      handleClientMessage(session.id, { type: 'client.ready' }, sessions, sendToClient);

      expect(geminiSession.sendClientContent).not.toHaveBeenCalled();
    });
  });

  describe('switch-case: response.cancel (barge-in)', () => {
    it('sets isInterrupted to true', () => {
      const geminiSession = makeGeminiSession();
      const session = makeSession({ geminiSession });
      const sessions = new Map([[session.id, session]]);

      handleClientMessage(session.id, { type: 'response.cancel' }, sessions, sendToClient);

      expect(session.isInterrupted).toBe(true);
    });

    it('records cancelledTurnSeq from current turnSeq', () => {
      const geminiSession = makeGeminiSession();
      const session = makeSession({ geminiSession, turnSeq: 5 });
      const sessions = new Map([[session.id, session]]);

      handleClientMessage(session.id, { type: 'response.cancel' }, sessions, sendToClient);

      expect(session.cancelledTurnSeq).toBe(5);
    });

    it('sends response.interrupted to the client', () => {
      const geminiSession = makeGeminiSession();
      const session = makeSession({ geminiSession });
      const sessions = new Map([[session.id, session]]);

      handleClientMessage(session.id, { type: 'response.cancel' }, sessions, sendToClient);

      expect(sendToClient).toHaveBeenCalledWith(session, { type: 'response.interrupted' });
    });

    it('clears currentTranscript after barge-in', () => {
      const geminiSession = makeGeminiSession();
      const session = makeSession({ geminiSession, currentTranscript: '안녕하세요' });
      const sessions = new Map([[session.id, session]]);

      handleClientMessage(session.id, { type: 'response.cancel' }, sessions, sendToClient);

      expect(session.currentTranscript).toBe('');
    });

    it('sends partial AI transcript when currentTranscript is non-empty and filterThinkingText returns text', () => {
      const geminiSession = makeGeminiSession();
      const session = makeSession({ geminiSession, currentTranscript: '안녕하세요 반갑습니다' });
      const sessions = new Map([[session.id, session]]);

      vi.mocked(filterThinkingText).mockReturnValue('안녕하세요 반갑습니다');

      handleClientMessage(session.id, { type: 'response.cancel' }, sessions, sendToClient);

      expect(sendToClient).toHaveBeenCalledWith(
        session,
        expect.objectContaining({ type: 'ai.transcription.done', interrupted: true })
      );
    });

    it('does not send partial transcript when filterThinkingText returns empty string', () => {
      const geminiSession = makeGeminiSession();
      const session = makeSession({ geminiSession, currentTranscript: '**thinking**' });
      const sessions = new Map([[session.id, session]]);

      vi.mocked(filterThinkingText).mockReturnValue('');

      handleClientMessage(session.id, { type: 'response.cancel' }, sessions, sendToClient);

      expect(sendToClient).toHaveBeenCalledTimes(1);
      expect(sendToClient).toHaveBeenCalledWith(session, { type: 'response.interrupted' });
    });

    it('ignores duplicate cancel when isInterrupted is already true', () => {
      const geminiSession = makeGeminiSession();
      const session = makeSession({ geminiSession, isInterrupted: true, cancelledTurnSeq: 2 });
      const sessions = new Map([[session.id, session]]);

      handleClientMessage(session.id, { type: 'response.cancel' }, sessions, sendToClient);

      expect(sendToClient).not.toHaveBeenCalled();
    });
  });

  describe('switch-case: ping', () => {
    it('calls sendToClient with pong message', () => {
      const geminiSession = makeGeminiSession();
      const session = makeSession({ geminiSession });
      const sessions = new Map([[session.id, session]]);

      handleClientMessage(session.id, { type: 'ping' }, sessions, sendToClient);

      expect(sendToClient).toHaveBeenCalledWith(session, { type: 'pong' });
    });

    it('does not call any geminiSession methods for ping', () => {
      const geminiSession = makeGeminiSession();
      const session = makeSession({ geminiSession });
      const sessions = new Map([[session.id, session]]);

      handleClientMessage(session.id, { type: 'ping' }, sessions, sendToClient);

      expect(geminiSession.sendClientContent).not.toHaveBeenCalled();
      expect(geminiSession.sendRealtimeInput).not.toHaveBeenCalled();
    });
  });

  describe('switch-case: unknown message type', () => {
    it('logs unknown type without calling sendToClient or geminiSession methods', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const geminiSession = makeGeminiSession();
      const session = makeSession({ geminiSession });
      const sessions = new Map([[session.id, session]]);

      handleClientMessage(session.id, { type: 'some.made.up.type' }, sessions, sendToClient);

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown client message type'));
      expect(sendToClient).not.toHaveBeenCalled();
      expect(geminiSession.sendClientContent).not.toHaveBeenCalled();
      expect(geminiSession.sendRealtimeInput).not.toHaveBeenCalled();
      logSpy.mockRestore();
    });
  });
});
