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
});
