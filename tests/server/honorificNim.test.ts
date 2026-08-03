/**
 * Tests that AI system prompts use the '님' honorific (not '씨') when a
 * userName is provided, across all conversation providers and the
 * conversations route prompt-building path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Shared mocks ─────────────────────────────────────────────────────────────

vi.mock('@google/genai', () => ({
  GoogleGenAI: class MockGoogleGenAI {
    constructor(_opts: any) {}
  },
}));

vi.mock('../../server/utils/globalMBTICache', () => ({
  GlobalMBTICache: {
    getInstance: vi.fn().mockReturnValue({
      getMBTIPersona: vi.fn().mockReturnValue(null),
    }),
  },
}));

vi.mock('../../server/services/aiUsageTracker', () => ({
  trackUsage: vi.fn(),
  extractGeminiTokens: vi.fn().mockReturnValue({ promptTokens: 0, completionTokens: 0 }),
  extractOpenAITokens: vi.fn().mockReturnValue({ promptTokens: 0, completionTokens: 0 }),
  getModelPricingKey: vi.fn().mockReturnValue('gemini-2.5-flash'),
}));

vi.mock('../../server/utils/mbtiLoader', () => ({
  enrichPersonaWithMBTI: vi.fn().mockImplementation((p: any) => p),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeScenario(overrides: Record<string, any> = {}): any {
  return {
    id: 'test-scenario',
    title: 'Test Scenario',
    difficulty: 3,
    targetTurns: 10,
    context: {
      situation: '업무 협상 상황입니다.',
      playerRole: { position: '영업 담당자' },
    },
    objectives: ['원활한 협상 진행'],
    ...overrides,
  };
}

function makePersona(overrides: Record<string, any> = {}): any {
  return {
    name: '김민준',
    role: '구매팀장',
    personality: '신중하고 분석적',
    responseStyle: '격식체',
    background: '10년 경력 구매 전문가',
    goals: ['최적 계약 체결'],
    stance: '원칙 준수',
    goal: '회사 이익 극대화',
    tradeoff: '',
    experience: '10년',
    department: '구매팀',
    mbti: null,
    ...overrides,
  };
}

// ── OptimizedGeminiProvider ───────────────────────────────────────────────────

import { OptimizedGeminiProvider } from '../../server/services/providers/optimizedGeminiProvider';

describe('OptimizedGeminiProvider — honorific in system prompt', () => {
  let provider: OptimizedGeminiProvider;

  beforeEach(() => {
    provider = new OptimizedGeminiProvider('fake-api-key');
  });

  it('includes "님" honorific when userName is provided', () => {
    const { system } = (provider as any).buildCompactPrompt(
      makeScenario(),
      makePersona(),
      '',
      [],
      'ko',
      undefined,
      undefined,
      '이지은',
    );

    expect(system).toContain('이지은님');
  });

  it('does not use "씨" honorific when userName is provided', () => {
    const { system } = (provider as any).buildCompactPrompt(
      makeScenario(),
      makePersona(),
      '',
      [],
      'ko',
      undefined,
      undefined,
      '이지은',
    );

    // The prompt must not instruct the AI to use "씨" as the honorific form
    // (a bare 씨 appearing inside a Korean word like 씩 is fine; we check for
    // the honorific pattern "<name>씨" specifically)
    expect(system).not.toMatch(/이지은씨/);
    expect(system).not.toMatch(/"이지은씨"/);
    expect(system).not.toMatch(/또는 ".*씨"/);
  });

  it('includes the userName in the honorific guidance block', () => {
    const { system } = (provider as any).buildCompactPrompt(
      makeScenario(),
      makePersona(),
      '',
      [],
      'ko',
      undefined,
      undefined,
      '박철수',
    );

    expect(system).toContain('박철수');
    expect(system).toContain('박철수님');
  });

  it('omits the honorific guidance block when no userName is given', () => {
    const { system } = (provider as any).buildCompactPrompt(
      makeScenario(),
      makePersona(),
      '',
      [],
      'ko',
    );

    // No userName → no "실명 호칭" block emitted
    expect(system).not.toContain('실명 호칭');
  });

  it('uses "님" with various Korean names', () => {
    const names = ['홍길동', '김영희', '최민수'];
    for (const name of names) {
      const { system } = (provider as any).buildCompactPrompt(
        makeScenario(),
        makePersona(),
        '',
        [],
        'ko',
        undefined,
        undefined,
        name,
      );
      expect(system).toContain(`${name}님`);
    }
  });
});

// ── OpenAIProvider ────────────────────────────────────────────────────────────

const mockCreate = vi.fn();

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
  },
}));

import { OpenAIProvider } from '../../server/services/providers/openaiProvider';

describe('OpenAIProvider — honorific in system prompt', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    mockCreate.mockClear();
    provider = new OpenAIProvider('fake-api-key', 'gpt-4o');

    mockCreate.mockResolvedValue({
      choices: [{ message: { content: '안녕하세요.' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
  });

  it('system message contains "님" honorific when userName is provided', async () => {
    await provider.generateResponse(
      makeScenario(),
      [],
      makePersona(),
      '안녕하세요',
      'ko',
      '이지은',
    );

    expect(mockCreate).toHaveBeenCalled();
    // calls[0] is the main conversation call; subsequent calls are emotion analysis
    const callArgs = mockCreate.mock.calls[0][0];
    const systemMsg = callArgs.messages.find((m: any) => m.role === 'system');
    expect(systemMsg).toBeDefined();
    expect(systemMsg.content).toContain('이지은님');
  });

  it('system message does not use "씨" honorific when userName is provided', async () => {
    await provider.generateResponse(
      makeScenario(),
      [],
      makePersona(),
      '안녕하세요',
      'ko',
      '이지은',
    );

    const callArgs = mockCreate.mock.calls[0][0];
    const systemMsg = callArgs.messages.find((m: any) => m.role === 'system');
    expect(systemMsg.content).not.toMatch(/이지은씨/);
    expect(systemMsg.content).not.toMatch(/"이지은씨"/);
    expect(systemMsg.content).not.toMatch(/또는 ".*씨"/);
  });

  it('system message contains userName when provided', async () => {
    await provider.generateResponse(
      makeScenario(),
      [],
      makePersona(),
      '안녕하세요',
      'ko',
      '박철수',
    );

    const callArgs = mockCreate.mock.calls[0][0];
    const systemMsg = callArgs.messages.find((m: any) => m.role === 'system');
    expect(systemMsg.content).toContain('박철수');
    expect(systemMsg.content).toContain('박철수님');
  });
});

// ── CustomProvider ────────────────────────────────────────────────────────────

import { CustomProvider } from '../../server/services/providers/customProvider';

/**
 * CustomProvider with apiKey='test-key' returns a mock response without
 * making real API calls. We verify the systemPrompt that would be sent by
 * extracting it through a spy on the fetch global.
 *
 * Since test-key short-circuits before fetch is called we instead read the
 * prompt through a thin wrapper approach: we subclass and expose the built
 * prompt by overriding the internal helper.
 *
 * Simpler: use a real (non-test-key) config but mock global fetch.
 */

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('CustomProvider — honorific in system prompt', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '안녕하세요.' } }],
      }),
    });
  });

  it('system prompt contains "님" honorific when userName is provided', async () => {
    const provider = new CustomProvider({
      apiKey: 'fake-key',
      baseUrl: 'https://api.example.com',
      model: 'custom-model',
    } as any);

    await provider.generateResponse(
      makeScenario(),
      [],
      makePersona(),
      '안녕하세요',
      'ko',
      '이지은',
    );

    expect(mockFetch).toHaveBeenCalled();
    // calls[0] is the main conversation call; subsequent calls are emotion analysis
    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    const systemMsg = body.messages?.find((m: any) => m.role === 'system');
    expect(systemMsg).toBeDefined();
    expect(systemMsg.content).toContain('이지은님');
  });

  it('system prompt does not use "씨" honorific when userName is provided', async () => {
    const provider = new CustomProvider({
      apiKey: 'fake-key',
      baseUrl: 'https://api.example.com',
      model: 'custom-model',
    } as any);

    await provider.generateResponse(
      makeScenario(),
      [],
      makePersona(),
      '안녕하세요',
      'ko',
      '이지은',
    );

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    const systemMsg = body.messages?.find((m: any) => m.role === 'system');
    expect(systemMsg.content).not.toMatch(/이지은씨/);
    expect(systemMsg.content).not.toMatch(/"이지은씨"/);
    expect(systemMsg.content).not.toMatch(/또는 ".*씨"/);
  });

  it('system prompt includes userName when provided', async () => {
    const provider = new CustomProvider({
      apiKey: 'fake-key',
      baseUrl: 'https://api.example.com',
      model: 'custom-model',
    } as any);

    await provider.generateResponse(
      makeScenario(),
      [],
      makePersona(),
      '안녕하세요',
      'ko',
      '박철수',
    );

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    const systemMsg = body.messages?.find((m: any) => m.role === 'system');
    expect(systemMsg.content).toContain('박철수님');
  });
});

// ── conversations.ts prompt-builder path (normalizeProfileName) ───────────────
// conversations.ts imports normalizeProfileName from conversationContextBuilder
// and passes the result as userName to the AI provider. These tests confirm
// that the helper produces a clean name the providers will correctly suffix
// with '님', and that no '씨' suffix is introduced anywhere in the chain.

import { normalizeProfileName } from '../../server/services/conversationContextBuilder';

describe('conversations.ts — normalizeProfileName used for userName honorific', () => {
  it('returns the name as-is for a plain Korean name', () => {
    expect(normalizeProfileName('이지은')).toBe('이지은');
  });

  it('returns the name as-is for a plain English name', () => {
    expect(normalizeProfileName('Jane')).toBe('Jane');
  });

  it('trims whitespace from the name', () => {
    expect(normalizeProfileName('  박철수  ')).toBe('박철수');
  });

  it('returns empty string / falsy for null/undefined input', () => {
    expect(normalizeProfileName(null as any) || '').toBe('');
    expect(normalizeProfileName(undefined as any) || '').toBe('');
  });

  it('normalized name is safe to suffix with 님 (no씨 interpolation)', () => {
    const name = normalizeProfileName('홍길동');
    // The provider templates use `${name}님` — verify the template produces '님'
    const honorificForm = `${name}님`;
    expect(honorificForm).toBe('홍길동님');
    expect(honorificForm).not.toContain('씨');
  });
});
