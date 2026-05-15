import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetChatMessagesByPersonaRun = vi.fn();
const mockGetUser = vi.fn();
const mockGetSystemSetting = vi.fn();
const mockGetUserPersonaById = vi.fn();

vi.mock('../../server/storage', () => ({
  storage: {
    getChatMessagesByPersonaRun: mockGetChatMessagesByPersonaRun,
    getUser: mockGetUser,
    getSystemSetting: mockGetSystemSetting,
    getUserPersonaById: mockGetUserPersonaById,
  },
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve([])) })) })) })),
  },
  pool: undefined,
  checkDatabaseConnection: vi.fn(),
}));

const mockGetAllScenarios = vi.fn();
const mockGetPersonaByMBTI = vi.fn();

vi.mock('../../server/services/fileManager', () => ({
  fileManager: {
    getAllScenarios: mockGetAllScenarios,
    getPersonaByMBTI: mockGetPersonaByMBTI,
  },
}));

vi.mock('../../server/services/voice/systemPromptBuilder', () => ({
  buildSystemInstructions: vi.fn(() => 'mock system instructions'),
  buildReconnectSystemInstructions: vi.fn((instructions: string) => instructions + '\n[reconnect]'),
}));

vi.mock('../../server/services/voice/prompts/userPersonaPrompt', () => ({
  buildUserPersonaInstructions: vi.fn(() => 'mock user persona instructions'),
}));

vi.mock('../../server/services/voice/sessionManager', () => ({
  startCleanupScheduler: vi.fn(() => null),
  trackSessionUsage: vi.fn(),
  getActiveSessionCount: vi.fn(() => 0),
  getSessionStatus: vi.fn(() => []),
}));

const mockLiveConnect = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(function () {
    return {
      live: { connect: mockLiveConnect },
    };
  }),
  Modality: { AUDIO: 'AUDIO' },
}));

function makeScenario() {
  return {
    id: 'scenario-1',
    title: 'Test Scenario',
    difficulty: 4,
    context: { playerRole: { position: '담당자' } },
    personas: [
      {
        id: 'persona-1',
        name: 'TestPersona',
        position: 'Manager',
        gender: 'female',
        personaRef: 'INTJ.json',
      },
    ],
  };
}

function makeDbMessages(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    sender: i % 2 === 0 ? 'user' : 'ai',
    message: `message content ${i + 1} from DB`,
  }));
}

describe('RealtimeVoiceService — session.recentMessages population on createSession', () => {
  let RealtimeVoiceService: any;
  let service: any;
  const SESSION_ID = 'test-session-id';
  const CONVERSATION_ID = 'test-conv-id';
  const SCENARIO_ID = 'scenario-1';
  const PERSONA_ID = 'persona-1';
  const USER_ID = 'user-1';

  beforeEach(async () => {
    vi.clearAllMocks();

    process.env.GOOGLE_API_KEY = 'test-api-key';

    mockGetUser.mockResolvedValue({ name: '테스터' });
    mockGetPersonaByMBTI.mockResolvedValue(null);
    mockGetSystemSetting.mockResolvedValue(null);
    mockGetAllScenarios.mockResolvedValue([makeScenario()]);

    mockLiveConnect.mockImplementation(({ callbacks }) => {
      setTimeout(() => callbacks?.onopen?.(), 0);
      return Promise.resolve({
        sendClientContent: vi.fn(),
        sendRealtimeInput: vi.fn(),
        close: vi.fn(),
      });
    });

    vi.resetModules();
    const mod = await import('../../server/services/realtimeVoiceService');
    RealtimeVoiceService = mod.RealtimeVoiceService;
    service = new RealtimeVoiceService();
  });

  afterEach(() => {
    delete process.env.GOOGLE_API_KEY;
    vi.clearAllMocks();
  });

  describe('createSession (scenario persona)', () => {
    it('populates session.recentMessages when DB has messages', async () => {
      const dbMessages = makeDbMessages(5);
      mockGetChatMessagesByPersonaRun.mockResolvedValue(dbMessages);

      const fakeWs = { readyState: 1, send: vi.fn() };
      await service.createSession(
        SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any
      );

      const session = (service as any).sessions.get(SESSION_ID);
      expect(session).toBeDefined();
      expect(session.recentMessages).toHaveLength(5);
      expect(session.recentMessages[0]).toEqual({ role: 'user', text: 'message content 1 from DB' });
      expect(session.recentMessages[1]).toEqual({ role: 'ai', text: 'message content 2 from DB' });
    });

    it('stores empty recentMessages when DB returns no messages', async () => {
      mockGetChatMessagesByPersonaRun.mockResolvedValue([]);

      const fakeWs = { readyState: 1, send: vi.fn() };
      await service.createSession(
        SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any
      );

      const session = (service as any).sessions.get(SESSION_ID);
      expect(session).toBeDefined();
      expect(session.recentMessages).toEqual([]);
    });

    it('limits session.recentMessages to the last 30 DB messages', async () => {
      const dbMessages = makeDbMessages(50);
      mockGetChatMessagesByPersonaRun.mockResolvedValue(dbMessages);

      const fakeWs = { readyState: 1, send: vi.fn() };
      await service.createSession(
        SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any
      );

      const session = (service as any).sessions.get(SESSION_ID);
      expect(session.recentMessages).toHaveLength(30);
      expect(session.recentMessages[0].text).toBe('message content 21 from DB');
    });

    it('truncates long message text to 300 characters', async () => {
      const longText = 'a'.repeat(500);
      mockGetChatMessagesByPersonaRun.mockResolvedValue([{ sender: 'user', message: longText }]);

      const fakeWs = { readyState: 1, send: vi.fn() };
      await service.createSession(
        SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any
      );

      const session = (service as any).sessions.get(SESSION_ID);
      expect(session.recentMessages[0].text).toHaveLength(300);
    });

    it('stores empty recentMessages when DB throws', async () => {
      mockGetChatMessagesByPersonaRun.mockRejectedValue(new Error('DB error'));

      const fakeWs = { readyState: 1, send: vi.fn() };
      await service.createSession(
        SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any
      );

      const session = (service as any).sessions.get(SESSION_ID);
      expect(session.recentMessages).toEqual([]);
    });

    it('calls getChatMessagesByPersonaRun with the correct conversationId', async () => {
      mockGetChatMessagesByPersonaRun.mockResolvedValue([]);

      const fakeWs = { readyState: 1, send: vi.fn() };
      await service.createSession(
        SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any
      );

      expect(mockGetChatMessagesByPersonaRun).toHaveBeenCalledWith(CONVERSATION_ID);
    });

    it('maps sender "ai" to role "ai" and any other sender to role "user"', async () => {
      mockGetChatMessagesByPersonaRun.mockResolvedValue([
        { sender: 'user', message: 'hello' },
        { sender: 'ai', message: 'world' },
        { sender: 'system', message: 'note' },
      ]);

      const fakeWs = { readyState: 1, send: vi.fn() };
      await service.createSession(
        SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any
      );

      const session = (service as any).sessions.get(SESSION_ID);
      expect(session.recentMessages[0].role).toBe('user');
      expect(session.recentMessages[1].role).toBe('ai');
      expect(session.recentMessages[2].role).toBe('user');
    });
  });

  describe('connectToGemini — 3-second auto-greeting timeout', () => {
    let mockGeminiSession: any;

    beforeEach(() => {
      vi.useFakeTimers();

      mockGeminiSession = {
        sendClientContent: vi.fn(),
        sendRealtimeInput: vi.fn(),
        close: vi.fn(),
      };

      mockLiveConnect.mockImplementation(({ callbacks }: { callbacks: any }) => {
        setTimeout(() => callbacks?.onopen?.(), 0);
        return Promise.resolve(mockGeminiSession);
      });

      mockGetChatMessagesByPersonaRun.mockResolvedValue([]);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('sends greeting after 3 seconds when client.ready never arrives', async () => {
      const fakeWs = { readyState: 1, send: vi.fn() };
      await service.createSession(
        SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any
      );

      expect(mockGeminiSession.sendClientContent).not.toHaveBeenCalled();

      vi.advanceTimersByTime(3000);

      expect(mockGeminiSession.sendClientContent).toHaveBeenCalledOnce();
      expect(mockGeminiSession.sendClientContent).toHaveBeenCalledWith(
        expect.objectContaining({
          turns: [{ role: 'user', parts: [{ text: '안녕하세요' }] }],
          turnComplete: true,
        })
      );
      expect(mockGeminiSession.sendRealtimeInput).toHaveBeenCalledWith({ event: 'END_OF_TURN' });
    });

    it('does NOT send greeting when hasTriggeredFirstGreeting is already true', async () => {
      const fakeWs = { readyState: 1, send: vi.fn() };
      await service.createSession(
        SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any
      );

      const session = (service as any).sessions.get(SESSION_ID);
      session.hasTriggeredFirstGreeting = true;

      vi.advanceTimersByTime(3000);

      expect(mockGeminiSession.sendClientContent).not.toHaveBeenCalled();
    });

    it('does NOT send greeting when pendingClientReady.hasExistingConversation is set', async () => {
      const fakeWs = { readyState: 1, send: vi.fn() };
      await service.createSession(
        SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any
      );

      const session = (service as any).sessions.get(SESSION_ID);
      session.pendingClientReady = { hasExistingConversation: true };

      vi.advanceTimersByTime(3000);

      expect(mockGeminiSession.sendClientContent).not.toHaveBeenCalled();
    });
  });

  describe('buffered client.ready replay (client arrives before Gemini connects)', () => {
    function makeGeminiSession() {
      return {
        sendClientContent: vi.fn(),
        sendRealtimeInput: vi.fn(),
        close: vi.fn(),
      };
    }

    async function flushMicrotasks() {
      await new Promise<void>(resolve => setTimeout(resolve, 20));
    }

    it('sets session.pendingClientReady when client.ready arrives before Gemini session is open', async () => {
      let connectResolve!: (v: any) => void;
      let capturedCallbacks: any;

      mockLiveConnect.mockImplementation(({ callbacks }: { callbacks: any }) => {
        capturedCallbacks = callbacks;
        return new Promise(resolve => { connectResolve = resolve; });
      });

      mockGetChatMessagesByPersonaRun.mockResolvedValue([]);
      const fakeWs = { readyState: 1, send: vi.fn() };

      const createPromise = service.createSession(
        SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any
      );

      await flushMicrotasks();

      const session = (service as any).sessions.get(SESSION_ID);
      expect(session).toBeDefined();
      expect(session.geminiSession).toBeNull();

      service.handleClientMessage(SESSION_ID, { type: 'client.ready' });

      expect(session.pendingClientReady).toEqual({ type: 'client.ready' });

      capturedCallbacks.onopen();
      connectResolve(makeGeminiSession());
      await createPromise;
    });

    it('clears session.pendingClientReady after Gemini connects and replays the message', async () => {
      let connectResolve!: (v: any) => void;
      let capturedCallbacks: any;

      mockLiveConnect.mockImplementation(({ callbacks }: { callbacks: any }) => {
        capturedCallbacks = callbacks;
        return new Promise(resolve => { connectResolve = resolve; });
      });

      mockGetChatMessagesByPersonaRun.mockResolvedValue([]);
      const fakeWs = { readyState: 1, send: vi.fn() };

      const createPromise = service.createSession(
        SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any
      );

      await flushMicrotasks();

      service.handleClientMessage(SESSION_ID, { type: 'client.ready' });

      const session = (service as any).sessions.get(SESSION_ID);
      expect(session.pendingClientReady).not.toBeNull();

      capturedCallbacks.onopen();
      connectResolve(makeGeminiSession());
      await createPromise;

      expect(session.pendingClientReady).toBeNull();
    });

    it('replayed client.ready triggers greeting via sendClientContent', async () => {
      let connectResolve!: (v: any) => void;
      let capturedCallbacks: any;
      const mockGeminiSession = makeGeminiSession();

      mockLiveConnect.mockImplementation(({ callbacks }: { callbacks: any }) => {
        capturedCallbacks = callbacks;
        return new Promise(resolve => { connectResolve = resolve; });
      });

      mockGetChatMessagesByPersonaRun.mockResolvedValue([]);
      const fakeWs = { readyState: 1, send: vi.fn() };

      const createPromise = service.createSession(
        SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any
      );

      await flushMicrotasks();

      service.handleClientMessage(SESSION_ID, { type: 'client.ready' });

      capturedCallbacks.onopen();
      connectResolve(mockGeminiSession);
      await createPromise;

      expect(mockGeminiSession.sendClientContent).toHaveBeenCalled();
    });

    it('replayed client.ready with isResuming calls proactiveReconnect (which uses session.recentMessages)', async () => {
      let connectResolve!: (v: any) => void;
      let capturedCallbacks: any;
      const mockGeminiSession = makeGeminiSession();

      mockLiveConnect.mockImplementation(({ callbacks }: { callbacks: any }) => {
        capturedCallbacks = callbacks;
        return new Promise(resolve => { connectResolve = resolve; });
      });

      const spy = vi.spyOn(service, 'proactiveReconnect' as any).mockResolvedValue(undefined);

      const dbMessages = makeDbMessages(3);
      mockGetChatMessagesByPersonaRun.mockResolvedValue(dbMessages);
      const fakeWs = { readyState: 1, send: vi.fn() };

      const createPromise = service.createSession(
        SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any
      );

      await flushMicrotasks();

      const session = (service as any).sessions.get(SESSION_ID);
      expect(session.recentMessages).toHaveLength(3);

      service.handleClientMessage(SESSION_ID, {
        type: 'client.ready',
        isResuming: true,
      });

      expect(session.pendingClientReady).not.toBeNull();

      capturedCallbacks.onopen();
      connectResolve(mockGeminiSession);
      await createPromise;

      expect(session.pendingClientReady).toBeNull();
      // proactiveReconnect should have been called — it handles context injection
      // from session.recentMessages with reconnect-safe system instructions
      expect(spy).toHaveBeenCalledWith(session);
    });

    it('still buffers client.ready when onopen fires before connect() resolves (geminiSession is null)', async () => {
      let connectResolve!: (v: any) => void;
      let capturedCallbacks: any;
      const mockGeminiSession = makeGeminiSession();

      mockLiveConnect.mockImplementation(({ callbacks }: { callbacks: any }) => {
        capturedCallbacks = callbacks;
        return new Promise(resolve => { connectResolve = resolve; });
      });

      mockGetChatMessagesByPersonaRun.mockResolvedValue([]);
      const fakeWs = { readyState: 1, send: vi.fn() };

      const createPromise = service.createSession(
        SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any
      );

      await flushMicrotasks();

      capturedCallbacks.onopen();

      const session = (service as any).sessions.get(SESSION_ID);
      expect(session.geminiSession).toBeNull();

      service.handleClientMessage(SESSION_ID, { type: 'client.ready' });
      expect(session.pendingClientReady).not.toBeNull();
      expect(mockGeminiSession.sendClientContent).not.toHaveBeenCalled();

      connectResolve(mockGeminiSession);
      await createPromise;

      expect(session.pendingClientReady).toBeNull();
      expect(mockGeminiSession.sendClientContent).toHaveBeenCalled();
    });

    it('does not re-buffer replayed client.ready when connect() resolves before onopen fires', async () => {
      let connectResolve!: (v: any) => void;
      let capturedCallbacks: any;
      const mockGeminiSession = makeGeminiSession();

      mockLiveConnect.mockImplementation(({ callbacks }: { callbacks: any }) => {
        capturedCallbacks = callbacks;
        return new Promise(resolve => { connectResolve = resolve; });
      });

      mockGetChatMessagesByPersonaRun.mockResolvedValue([]);
      const fakeWs = { readyState: 1, send: vi.fn() };

      const createPromise = service.createSession(
        SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any
      );

      await flushMicrotasks();

      service.handleClientMessage(SESSION_ID, { type: 'client.ready' });

      const session = (service as any).sessions.get(SESSION_ID);
      expect(session.pendingClientReady).not.toBeNull();

      connectResolve(mockGeminiSession);
      await flushMicrotasks();
      capturedCallbacks.onopen();
      await createPromise;

      expect(session.pendingClientReady).toBeNull();
      expect(mockGeminiSession.sendClientContent).toHaveBeenCalled();
    });

    it('replayed client.ready with hasExistingConversation uses session.recentMessages as fallback', async () => {
      let connectResolve!: (v: any) => void;
      let capturedCallbacks: any;
      const mockGeminiSession = makeGeminiSession();

      mockLiveConnect.mockImplementation(({ callbacks }: { callbacks: any }) => {
        capturedCallbacks = callbacks;
        return new Promise(resolve => { connectResolve = resolve; });
      });

      const dbMessages = makeDbMessages(2);
      mockGetChatMessagesByPersonaRun.mockResolvedValue(dbMessages);
      const fakeWs = { readyState: 1, send: vi.fn() };

      const createPromise = service.createSession(
        SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any
      );

      await flushMicrotasks();

      const session = (service as any).sessions.get(SESSION_ID);
      expect(session.recentMessages).toHaveLength(2);

      service.handleClientMessage(SESSION_ID, {
        type: 'client.ready',
        hasExistingConversation: true,
      });

      expect(session.pendingClientReady).not.toBeNull();

      capturedCallbacks.onopen();
      connectResolve(mockGeminiSession);
      await createPromise;

      expect(session.pendingClientReady).toBeNull();

      await flushMicrotasks();

      expect(mockGeminiSession.sendClientContent).toHaveBeenCalled();
      const callArg = mockGeminiSession.sendClientContent.mock.calls[0][0];
      const sentText: string = callArg.turns[0].parts[0].text;
      expect(sentText).toContain('message content 1 from DB');
      expect(sentText).toContain('message content 2 from DB');
    });
  });

  describe('first-greeting race condition: client.ready vs 3-second timeout', () => {
    let mockGeminiSession: any;

    beforeEach(() => {
      vi.useFakeTimers();

      mockGeminiSession = {
        sendClientContent: vi.fn(),
        sendRealtimeInput: vi.fn(),
        close: vi.fn(),
      };

      mockLiveConnect.mockImplementation(({ callbacks }: { callbacks: any }) => {
        setTimeout(() => callbacks?.onopen?.(), 0);
        return Promise.resolve(mockGeminiSession);
      });

      mockGetChatMessagesByPersonaRun.mockResolvedValue([]);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('greeting is sent exactly once when client.ready arrives before the 3-second timeout', async () => {
      const fakeWs = { readyState: 1, send: vi.fn() };
      await service.createSession(
        SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any
      );

      service.handleClientMessage(SESSION_ID, { type: 'client.ready' });
      vi.advanceTimersByTime(3000);

      const greetingCalls = mockGeminiSession.sendClientContent.mock.calls.filter(
        (call: any[]) => {
          const payload = call[0];
          return payload?.turns?.[0]?.parts?.[0]?.text === '안녕하세요';
        }
      );
      expect(greetingCalls).toHaveLength(1);
    });

    it('greeting is sent exactly once when timeout fires before client.ready arrives', async () => {
      const fakeWs = { readyState: 1, send: vi.fn() };
      await service.createSession(
        SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any
      );

      vi.advanceTimersByTime(3000);
      service.handleClientMessage(SESSION_ID, { type: 'client.ready' });

      const greetingCalls = mockGeminiSession.sendClientContent.mock.calls.filter(
        (call: any[]) => {
          const payload = call[0];
          return payload?.turns?.[0]?.parts?.[0]?.text === '안녕하세요';
        }
      );
      expect(greetingCalls).toHaveLength(1);
    });

    it('hasTriggeredFirstGreeting is true after client.ready, so timeout is skipped', async () => {
      const fakeWs = { readyState: 1, send: vi.fn() };
      await service.createSession(
        SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any
      );

      service.handleClientMessage(SESSION_ID, { type: 'client.ready' });

      const session = (service as any).sessions.get(SESSION_ID);
      expect(session.hasTriggeredFirstGreeting).toBe(true);

      const callsBeforeTimeout = mockGeminiSession.sendClientContent.mock.calls.length;
      vi.advanceTimersByTime(3000);

      expect(mockGeminiSession.sendClientContent.mock.calls.length).toBe(callsBeforeTimeout);
    });

    it('hasTriggeredFirstGreeting is true after timeout, so second client.ready is skipped', async () => {
      const fakeWs = { readyState: 1, send: vi.fn() };
      await service.createSession(
        SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any
      );

      vi.advanceTimersByTime(3000);

      const session = (service as any).sessions.get(SESSION_ID);
      expect(session.hasTriggeredFirstGreeting).toBe(true);

      const callsAfterTimeout = mockGeminiSession.sendClientContent.mock.calls.length;

      service.handleClientMessage(SESSION_ID, { type: 'client.ready' });

      expect(mockGeminiSession.sendClientContent.mock.calls.length).toBe(callsAfterTimeout);
    });
  });

  describe('createUserPersonaSession', () => {
    const USER_PERSONA_SCENARIO_ID = '__user_persona__:upersona-1';

    beforeEach(() => {
      mockGetUserPersonaById.mockResolvedValue({
        id: 'upersona-1',
        name: 'MockUserPersona',
        gender: 'male',
      });
    });

    it('populates session.recentMessages for user persona sessions', async () => {
      const dbMessages = makeDbMessages(3);
      mockGetChatMessagesByPersonaRun.mockResolvedValue(dbMessages);

      const fakeWs = { readyState: 1, send: vi.fn() };
      await service.createSession(
        SESSION_ID, CONVERSATION_ID, USER_PERSONA_SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any
      );

      const session = (service as any).sessions.get(SESSION_ID);
      expect(session).toBeDefined();
      expect(session.recentMessages).toHaveLength(3);
      expect(session.recentMessages[0]).toEqual({ role: 'user', text: 'message content 1 from DB' });
    });

    it('stores empty recentMessages for user persona session when DB returns none', async () => {
      mockGetChatMessagesByPersonaRun.mockResolvedValue([]);

      const fakeWs = { readyState: 1, send: vi.fn() };
      await service.createSession(
        SESSION_ID, CONVERSATION_ID, USER_PERSONA_SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any
      );

      const session = (service as any).sessions.get(SESSION_ID);
      expect(session.recentMessages).toEqual([]);
    });

    it('limits user persona session.recentMessages to last 30 DB messages', async () => {
      mockGetChatMessagesByPersonaRun.mockResolvedValue(makeDbMessages(45));

      const fakeWs = { readyState: 1, send: vi.fn() };
      await service.createSession(
        SESSION_ID, CONVERSATION_ID, USER_PERSONA_SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any
      );

      const session = (service as any).sessions.get(SESSION_ID);
      expect(session.recentMessages).toHaveLength(30);
    });

    it('calls getChatMessagesByPersonaRun with correct conversationId for user persona', async () => {
      mockGetChatMessagesByPersonaRun.mockResolvedValue([]);

      const fakeWs = { readyState: 1, send: vi.fn() };
      await service.createSession(
        SESSION_ID, CONVERSATION_ID, USER_PERSONA_SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any
      );

      expect(mockGetChatMessagesByPersonaRun).toHaveBeenCalledWith(CONVERSATION_ID);
    });
  });

  describe('proactiveReconnect — greeting trigger + EOT filter', () => {
    let session: any;
    let newGeminiSession: any;

    beforeEach(async () => {
      mockGetChatMessagesByPersonaRun.mockResolvedValue([]);
      const fakeWs = { readyState: 1, send: vi.fn() };
      await service.createSession(SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any);
      session = (service as any).sessions.get(SESSION_ID);

      newGeminiSession = { sendClientContent: vi.fn(), sendRealtimeInput: vi.fn(), close: vi.fn() };
      mockLiveConnect.mockResolvedValue(newGeminiSession);
    });

    it('filters greeting trigger + paired END_OF_TURN from pendingMessages on proactiveReconnect', async () => {
      const greetingPayload = { turns: [{ role: 'user', parts: [{ text: '안녕하세요' }] }], turnComplete: true };
      const eotPayload = { event: 'END_OF_TURN' };
      session.pendingMessages = [
        { index: 0, payload: { type: 'clientContent', data: greetingPayload } },
        { index: 1, payload: { type: 'realtimeInput', data: eotPayload } },
      ];
      session.isReconnecting = false;
      session.geminiSession = { sendClientContent: vi.fn(), sendRealtimeInput: vi.fn(), close: vi.fn() };

      await (service as any).proactiveReconnect(session);

      expect(newGeminiSession.sendClientContent).not.toHaveBeenCalledWith(
        expect.objectContaining({ turns: [{ role: 'user', parts: [{ text: '안녕하세요' }] }] })
      );
      expect(newGeminiSession.sendRealtimeInput).not.toHaveBeenCalled();
    });

    it('preserves non-greeting pending messages while filtering greeting + EOT on proactiveReconnect', async () => {
      const greetingPayload = { turns: [{ role: 'user', parts: [{ text: '안녕하세요' }] }], turnComplete: true };
      const eotPayload = { event: 'END_OF_TURN' };
      const realPayload = { turns: [{ role: 'user', parts: [{ text: '업무 질문입니다' }] }], turnComplete: false };
      session.pendingMessages = [
        { index: 0, payload: { type: 'clientContent', data: greetingPayload } },
        { index: 1, payload: { type: 'realtimeInput', data: eotPayload } },
        { index: 2, payload: { type: 'clientContent', data: realPayload } },
      ];
      session.isReconnecting = false;
      session.geminiSession = { sendClientContent: vi.fn(), sendRealtimeInput: vi.fn(), close: vi.fn() };

      await (service as any).proactiveReconnect(session);

      expect(newGeminiSession.sendClientContent).toHaveBeenCalledWith(realPayload);
      expect(newGeminiSession.sendClientContent).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleClientMessage — isResuming + empty history triggers proactiveReconnect (common path)', () => {
    it('calls proactiveReconnect when client.ready isResuming=true arrives after Gemini is connected with no preload', async () => {
      mockGetChatMessagesByPersonaRun.mockResolvedValue([]);

      const spy = vi.spyOn(service, 'proactiveReconnect' as any).mockResolvedValue(undefined);

      const fakeWs = { readyState: 1, send: vi.fn() };
      await service.createSession(SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any);

      // At this point Gemini is connected (session.geminiSession is set).
      // Simulate the common reconnect flow: client sends isResuming=true with no previousMessages.
      service.handleClientMessage(SESSION_ID, {
        type: 'client.ready',
        isResuming: true,
      });

      expect(spy).toHaveBeenCalled();
    });

    it('calls proactiveReconnect when client.ready isResuming=true has previousMessages (all isResuming → reconnect-safe prompt)', async () => {
      mockGetChatMessagesByPersonaRun.mockResolvedValue([]);

      const spy = vi.spyOn(service, 'proactiveReconnect' as any).mockResolvedValue(undefined);

      const fakeWs = { readyState: 1, send: vi.fn() };
      await service.createSession(SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any);

      service.handleClientMessage(SESSION_ID, {
        type: 'client.ready',
        isResuming: true,
        previousMessages: [
          { role: 'user', content: 'hello' },
          { role: 'ai', content: 'hi there' },
        ],
      });

      // ALL isResuming paths call proactiveReconnect for reconnect-safe system instructions
      expect(spy).toHaveBeenCalled();
    });

    it('isResuming + previousMessages: proactiveReconnect called, greeting flag set, no 안녕하세요 to Gemini', async () => {
      mockGetChatMessagesByPersonaRun.mockResolvedValue([]);

      const spy = vi.spyOn(service, 'proactiveReconnect' as any).mockResolvedValue(undefined);

      const fakeWs = { readyState: 1, send: vi.fn() };
      await service.createSession(SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any);

      const session = (service as any).sessions.get(SESSION_ID);
      const geminiSession = session.geminiSession;
      geminiSession.sendClientContent.mockClear();

      service.handleClientMessage(SESSION_ID, {
        type: 'client.ready',
        isResuming: true,
        previousMessages: [
          { role: 'user', content: 'hello there' },
          { role: 'ai', content: 'hi nice to meet you' },
        ],
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(session.hasTriggeredFirstGreeting).toBe(true);
      // proactiveReconnect handles reconnect-safe prompt + context injection
      expect(spy).toHaveBeenCalled();
      // No greeting trigger sent directly by clientMessageHandler
      const allTexts: string[] = geminiSession.sendClientContent.mock.calls.map(
        (call: any[]) => call[0]?.turns?.[0]?.parts?.[0]?.text ?? ''
      );
      expect(allTexts.every((t: string) => !t.includes('안녕하세요'))).toBe(true);
    });
  });

  describe('createSession — pendingIsResuming triggers proactiveReconnect when preloadedMessages empty', () => {
    it('calls proactiveReconnect when pendingIsResuming=true and no DB messages', async () => {
      mockGetChatMessagesByPersonaRun.mockResolvedValue([]);

      // Spy on the private method; replace it with a no-op so it doesn't actually reconnect
      const spy = vi.spyOn(service, 'proactiveReconnect' as any).mockResolvedValue(undefined);

      // After the session is added to the map, set pendingIsResuming=true before connectToGemini resolves
      mockLiveConnect.mockImplementation(({ callbacks }: any) => {
        // Session is already in this.sessions at this point (set before connectToGemini is called)
        const sess = (service as any).sessions.get(SESSION_ID);
        if (sess) sess.pendingIsResuming = true;
        setTimeout(() => callbacks?.onopen?.(), 0);
        return Promise.resolve({ sendClientContent: vi.fn(), sendRealtimeInput: vi.fn(), close: vi.fn() });
      });

      const fakeWs = { readyState: 1, send: vi.fn() };
      await service.createSession(SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any);

      expect(spy).toHaveBeenCalled();
    });

    it('does NOT call proactiveReconnect when preloadedMessages exist even if pendingIsResuming=true', async () => {
      mockGetChatMessagesByPersonaRun.mockResolvedValue(makeDbMessages(2));

      const spy = vi.spyOn(service, 'proactiveReconnect' as any).mockResolvedValue(undefined);

      mockLiveConnect.mockImplementation(({ callbacks }: any) => {
        const sess = (service as any).sessions.get(SESSION_ID);
        if (sess) sess.pendingIsResuming = true;
        setTimeout(() => callbacks?.onopen?.(), 0);
        return Promise.resolve({ sendClientContent: vi.fn(), sendRealtimeInput: vi.fn(), close: vi.fn() });
      });

      const fakeWs = { readyState: 1, send: vi.fn() };
      await service.createSession(SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any);

      expect(spy).not.toHaveBeenCalled();
    });

    it('after proactiveReconnect completes, subsequent isResuming event takes context-injection fast path (no close/reconnect)', async () => {
      mockGetChatMessagesByPersonaRun.mockResolvedValue([]);

      const fakeWs = { readyState: 1, send: vi.fn() };
      await service.createSession(SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any);

      const session = (service as any).sessions.get(SESSION_ID);
      const firstGeminiSession = session.geminiSession;

      // Manually trigger proactiveReconnect (simulating goAway or unexpected close)
      // by calling it directly and waiting for it to complete
      await (service as any).proactiveReconnect(session);

      // After proactiveReconnect, usingReconnectInstructions should be true
      expect(session.usingReconnectInstructions).toBe(true);
      const secondGeminiSession = session.geminiSession;
      expect(secondGeminiSession).not.toBeNull();

      // Reset close call tracking on second session
      secondGeminiSession.close.mockClear();
      secondGeminiSession.sendClientContent.mockClear();

      // Now send another isResuming client.ready — should take fast path (context-only)
      service.handleClientMessage(SESSION_ID, { type: 'client.ready', isResuming: true });

      await new Promise(resolve => setTimeout(resolve, 10));

      // The second geminiSession should NOT have been closed (fast path, no reconnect)
      expect(secondGeminiSession.close).not.toHaveBeenCalled();
      // Context injection should have happened
      const allTexts: string[] = secondGeminiSession.sendClientContent.mock.calls.map(
        (call: any[]) => call[0]?.turns?.[0]?.parts?.[0]?.text ?? ''
      );
      expect(allTexts.some((t: string) => t.includes('SYSTEM CONTEXT UPDATE'))).toBe(true);
      // No greeting trigger
      expect(allTexts.every((t: string) => !t.includes('안녕하세요'))).toBe(true);
    });

    it('buffered client.ready(isResuming) + preloaded messages — no redundant reconnect: geminiSession NOT closed, context injected', async () => {
      // Simulates: client.ready(isResuming=true) arrives while Gemini is connecting,
      // AND the DB already has messages (preloadedMessages.length > 0).
      // createSession uses reconnect-safe instructions (isResume:true) on initial connect.
      // The buffered client.ready is replayed → proactiveReconnect is called →
      // usingReconnectInstructions guard fires → no close/reopen, only context injection.
      mockGetChatMessagesByPersonaRun.mockResolvedValue(makeDbMessages(3));

      let capturedMockSession: any;
      mockLiveConnect.mockImplementation(({ callbacks }: any) => {
        const sess = (service as any).sessions.get(SESSION_ID);
        // Simulate client.ready(isResuming=true) arriving while connection is in-flight
        if (sess) sess.pendingClientReady = { type: 'client.ready', isResuming: true };
        setTimeout(() => callbacks?.onopen?.(), 0);
        capturedMockSession = { sendClientContent: vi.fn(), sendRealtimeInput: vi.fn(), close: vi.fn() };
        return Promise.resolve(capturedMockSession);
      });

      const fakeWs = { readyState: 1, send: vi.fn() };
      await service.createSession(SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any);

      await new Promise(resolve => setTimeout(resolve, 10));

      const session = (service as any).sessions.get(SESSION_ID);

      // The Gemini session should NOT have been closed (no redundant reconnect)
      expect(capturedMockSession.close).not.toHaveBeenCalled();

      // usingReconnectInstructions flag set because initial connect used isResume:true
      expect(session.usingReconnectInstructions).toBe(true);

      // Context should have been injected (sendClientContent called with SYSTEM CONTEXT UPDATE)
      const allTexts: string[] = capturedMockSession.sendClientContent.mock.calls.map(
        (call: any[]) => call[0]?.turns?.[0]?.parts?.[0]?.text ?? ''
      );
      const contextCall = allTexts.find((t: string) => t.includes('SYSTEM CONTEXT UPDATE'));
      expect(contextCall).toBeDefined();
      // Context includes the pre-loaded message history
      expect(contextCall).toContain('message content 1 from DB');

      // First greeting flag set (no greeting sent)
      expect(session.hasTriggeredFirstGreeting).toBe(true);
      // No greeting trigger (안녕하세요) ever sent
      expect(allTexts.every((t: string) => !t.includes('안녕하세요'))).toBe(true);
    });
  });
});
