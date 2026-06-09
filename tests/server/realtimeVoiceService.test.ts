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
const mockConnectOpenAIRealtime = vi.fn();

vi.mock('../../server/services/voice/openaiRealtimeAdapter', () => ({
  connectOpenAIRealtime: mockConnectOpenAIRealtime,
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn(function () {
    return {
      live: { connect: mockLiveConnect },
    };
  }),
  Modality: { AUDIO: 'AUDIO' },
  ActivityHandling: {
    START_OF_ACTIVITY_INTERRUPTS: 'START_OF_ACTIVITY_INTERRUPTS',
    NO_INTERRUPTION: 'NO_INTERRUPTION',
    ACTIVITY_HANDLING_UNSPECIFIED: 'ACTIVITY_HANDLING_UNSPECIFIED',
  },
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

  describe('connectToGemini — no auto-greeting (user speaks first)', () => {
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

    it('no greeting is sent after 3 seconds even when client.ready never arrives — timeout removed', async () => {
      const fakeWs = { readyState: 1, send: vi.fn() };
      await service.createSession(
        SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any
      );

      expect(mockGeminiSession.sendClientContent).not.toHaveBeenCalled();

      vi.advanceTimersByTime(3000);

      expect(mockGeminiSession.sendClientContent).not.toHaveBeenCalled();
      expect(mockGeminiSession.sendRealtimeInput).not.toHaveBeenCalled();
    });

    it('no greeting is sent when hasTriggeredFirstGreeting is true and 3 seconds pass', async () => {
      const fakeWs = { readyState: 1, send: vi.fn() };
      await service.createSession(
        SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any
      );

      const session = (service as any).sessions.get(SESSION_ID);
      session.hasTriggeredFirstGreeting = true;

      vi.advanceTimersByTime(3000);

      expect(mockGeminiSession.sendClientContent).not.toHaveBeenCalled();
    });

    it('no greeting is sent when pendingClientReady.hasExistingConversation is set', async () => {
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

    it('replayed client.ready (fresh start) does NOT auto-trigger greeting — user speaks first', async () => {
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

      expect(mockGeminiSession.sendClientContent).not.toHaveBeenCalled();
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
      // Fresh start: no auto-greeting — user speaks first
      expect(mockGeminiSession.sendClientContent).not.toHaveBeenCalled();
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
      // Fresh start: no auto-greeting — user speaks first
      expect(mockGeminiSession.sendClientContent).not.toHaveBeenCalled();
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

    it('no auto-greeting when client.ready arrives — user speaks first, 3-second timeout removed', async () => {
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
      expect(greetingCalls).toHaveLength(0);
    });

    it('no auto-greeting even when 3 seconds pass with no client.ready — timeout removed', async () => {
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
      expect(greetingCalls).toHaveLength(0);
    });

    it('hasTriggeredFirstGreeting is true after client.ready, and no sendClientContent is called', async () => {
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
      expect(callsBeforeTimeout).toBe(0);
    });

    it('second client.ready is skipped because hasTriggeredFirstGreeting is already true', async () => {
      const fakeWs = { readyState: 1, send: vi.fn() };
      await service.createSession(
        SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any
      );

      service.handleClientMessage(SESSION_ID, { type: 'client.ready' });

      const session = (service as any).sessions.get(SESSION_ID);
      expect(session.hasTriggeredFirstGreeting).toBe(true);

      service.handleClientMessage(SESSION_ID, { type: 'client.ready' });

      expect(mockGeminiSession.sendClientContent).not.toHaveBeenCalled();
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

// ---------------------------------------------------------------------------
// OpenAI reconnect integration — full round-trip
// ---------------------------------------------------------------------------
// These tests exercise the wiring between realtimeVoiceService.connectToOpenAI
// → openaiReconnector.handleOpenAIClose → connectToOpenAI (retry) using mock
// WebSocket pairs.  They complement the unit-level openaiReconnector tests by
// verifying that the orchestrator layer correctly threads the callbacks so that
// an unexpected OpenAI close triggers the full reconnect cycle end-to-end.
// ---------------------------------------------------------------------------

describe('OpenAI reconnect integration — full round-trip (unexpected close → reconnect cycle)', () => {
  const SESSION_ID = 'openai-session-id';
  const CONVERSATION_ID = 'openai-conv-id';
  const SCENARIO_ID = 'scenario-1';
  const PERSONA_ID = 'persona-1';
  const USER_ID = 'user-1';

  let RealtimeVoiceService: any;
  let service: any;
  let fakeWs: { readyState: number; send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
  let capturedOnClose: ((event: { code: number; reason: string }) => void) | null;

  function makeFakeAdapter() {
    return {
      sendRealtimeInput: vi.fn(),
      sendClientContent: vi.fn(),
      sendToolResponse: vi.fn(),
      close: vi.fn(),
    };
  }

  function parseSentMessages() {
    return fakeWs.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    // Use OpenAI-only environment (no Gemini key) so createSession routes to connectToOpenAI
    process.env.OPENAI_API_KEY = 'test-openai-key';
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_API_KEY;

    mockGetUser.mockResolvedValue({ name: '테스터' });
    mockGetPersonaByMBTI.mockResolvedValue(null);
    // Return an OpenAI realtime model so the service uses connectToOpenAI
    mockGetSystemSetting.mockResolvedValue({ value: 'gpt-4o-realtime-preview' });
    mockGetAllScenarios.mockResolvedValue([makeScenario()]);
    mockGetChatMessagesByPersonaRun.mockResolvedValue([]);

    capturedOnClose = null;

    // Default mock: capture onClose callback and return a fake adapter
    mockConnectOpenAIRealtime.mockImplementation(
      (_model: any, _session: any, _sendToClient: any, onClose: any) => {
        capturedOnClose = onClose;
        return Promise.resolve(makeFakeAdapter());
      }
    );

    fakeWs = { readyState: 1, send: vi.fn(), close: vi.fn() };

    vi.resetModules();
    const mod = await import('../../server/services/realtimeVoiceService');
    RealtimeVoiceService = mod.RealtimeVoiceService;
    service = new RealtimeVoiceService();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.OPENAI_API_KEY;
    // Restore Gemini key so other test suites don't break
    process.env.GOOGLE_API_KEY = 'test-api-key';
    vi.clearAllMocks();
  });

  it('unexpected close triggers reconnect: client receives session.reconnecting then session.reconnected', async () => {
    await service.createSession(SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any);

    expect(capturedOnClose).not.toBeNull();

    const session = (service as any).sessions.get(SESSION_ID);
    expect(session).toBeDefined();

    // Prepare second adapter for the reconnect call
    mockConnectOpenAIRealtime.mockImplementationOnce(
      (_model: any, _session: any, _sendToClient: any, onClose: any) => {
        capturedOnClose = onClose;
        return Promise.resolve(makeFakeAdapter());
      }
    );

    // Trigger unexpected close (code 1006 = abnormal closure — not in FATAL_CLOSE_CODES)
    capturedOnClose!({ code: 1006, reason: '' });

    // Reconnector immediately sends session.reconnecting before the delay fires
    const msgsAfterClose = parseSentMessages();
    const reconnectingMsg = msgsAfterClose.find((m: any) => m.type === 'session.reconnecting');
    expect(reconnectingMsg).toBeDefined();
    expect(reconnectingMsg.attempt).toBe(1);
    expect(reconnectingMsg.maxAttempts).toBe(5);

    // Session state must reflect active reconnect
    expect(session.isReconnecting).toBe(true);
    expect(session.reconnectAttempts).toBe(1);

    // Advance past attempt-1 delay (2^0 * 1000 = 1000 ms) and flush async work
    await vi.advanceTimersByTimeAsync(1000);

    // session.reconnected must have been sent after successful reconnect
    const msgsAfterReconnect = parseSentMessages();
    const reconnectedMsg = msgsAfterReconnect.find((m: any) => m.type === 'session.reconnected');
    expect(reconnectedMsg).toBeDefined();

    // Session state must be reset to idle after successful reconnect
    expect(session.isReconnecting).toBe(false);
    expect(session.reconnectAttempts).toBe(0);
  });

  it('session stays in sessions map during the entire reconnect cycle', async () => {
    await service.createSession(SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any);

    mockConnectOpenAIRealtime.mockImplementationOnce(
      (_model: any, _sess: any, _stc: any, onClose: any) => {
        capturedOnClose = onClose;
        return Promise.resolve(makeFakeAdapter());
      }
    );

    capturedOnClose!({ code: 1006, reason: '' });

    // Session must still be present while isReconnecting is true
    expect((service as any).sessions.has(SESSION_ID)).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);

    // Session must still be present after successful reconnect
    expect((service as any).sessions.has(SESSION_ID)).toBe(true);
  });

  it('connectToOpenAI (connectOpenAIRealtime) is called exactly twice: initial + reconnect', async () => {
    await service.createSession(SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any);

    expect(mockConnectOpenAIRealtime).toHaveBeenCalledTimes(1);

    mockConnectOpenAIRealtime.mockImplementationOnce(
      (_model: any, _sess: any, _stc: any, onClose: any) => {
        capturedOnClose = onClose;
        return Promise.resolve(makeFakeAdapter());
      }
    );

    capturedOnClose!({ code: 1006, reason: '' });
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockConnectOpenAIRealtime).toHaveBeenCalledTimes(2);
  });

  it('isReconnecting is false and reconnectAttempts is 0 before the first close', async () => {
    await service.createSession(SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any);

    const session = (service as any).sessions.get(SESSION_ID);
    expect(session.isReconnecting).toBe(false);
    expect(session.reconnectAttempts).toBe(0);
  });

  it('fatal close code does NOT trigger reconnect — sends error event and no session.reconnecting', async () => {
    await service.createSession(SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any);

    // Code 1008 (Policy Violation) is in FATAL_CLOSE_CODES
    capturedOnClose!({ code: 1008, reason: 'Policy violation' });

    await vi.advanceTimersByTimeAsync(2000);

    const msgs = parseSentMessages();
    expect(msgs.some((m: any) => m.type === 'session.reconnecting')).toBe(false);
    expect(msgs.some((m: any) => m.type === 'session.reconnected')).toBe(false);
    // A non-recoverable error must have been sent to the client
    const errorMsg = msgs.find((m: any) => m.type === 'error');
    expect(errorMsg).toBeDefined();
    expect(errorMsg.recoverable).toBe(false);
    // Session must be cleaned up after a fatal error
    expect((service as any).sessions.has(SESSION_ID)).toBe(false);
  });

  it('normal close (code 1000) does NOT trigger reconnect — sends session.terminated', async () => {
    await service.createSession(SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any);

    capturedOnClose!({ code: 1000, reason: 'Normal closure' });

    await vi.advanceTimersByTimeAsync(2000);

    const msgs = parseSentMessages();
    expect(msgs.some((m: any) => m.type === 'session.reconnecting')).toBe(false);
    const terminated = msgs.find((m: any) => m.type === 'session.terminated');
    expect(terminated).toBeDefined();
  });

  it('second connectToOpenAI call on reconnect uses the same session object', async () => {
    await service.createSession(SESSION_ID, CONVERSATION_ID, SCENARIO_ID, PERSONA_ID, USER_ID, fakeWs as any);

    let reconnectSessionArg: any = null;
    mockConnectOpenAIRealtime.mockImplementationOnce(
      (_model: any, sess: any, _stc: any, onClose: any) => {
        reconnectSessionArg = sess;
        capturedOnClose = onClose;
        return Promise.resolve(makeFakeAdapter());
      }
    );

    const session = (service as any).sessions.get(SESSION_ID);
    capturedOnClose!({ code: 1006, reason: '' });
    await vi.advanceTimersByTimeAsync(1000);

    // The reconnect must reuse the existing session object (same reference)
    expect(reconnectSessionArg).toBe(session);
  });
});
