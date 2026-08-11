import { describe, it, expect, vi } from 'vitest';
import { prepareConversationHistory } from '../../server/services/conversationContextBuilder';

// ---------------------------------------------------------------------------
// Mocks required by OptimizedGeminiProvider
// ---------------------------------------------------------------------------
vi.mock('@google/genai', () => ({
  GoogleGenAI: class MockGoogleGenAI {
    constructor(_opts: any) {}
  },
}));
vi.mock('../../server/utils/globalMBTICache', () => ({
  GlobalMBTICache: {
    getInstance: vi.fn().mockReturnValue({ getMBTIPersona: vi.fn().mockReturnValue(null) }),
  },
}));
vi.mock('../../server/utils/aiUsageLogger', () => ({
  trackUsage: vi.fn(), extractGeminiTokens: vi.fn(), getModelPricingKey: vi.fn(),
}));
vi.mock('../../server/services/aiUsageTracker', () => ({
  trackUsage: vi.fn(),
  extractGeminiTokens: vi.fn().mockReturnValue({ inputTokens: 0, outputTokens: 0 }),
  getModelPricingKey: vi.fn().mockReturnValue('gemini-2.5-flash'),
}));
vi.mock('../../server/utils/mbtiLoader', () => ({
  enrichPersonaWithMBTI: vi.fn().mockImplementation((p: any) => p),
}));

import { OptimizedGeminiProvider } from '../../server/services/providers/optimizedGeminiProvider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const personas = [
  { name: '김민준' },
  { name: '이서연' },
];

const switchLog = [
  { turn: 2, fromPersonaIndex: 0, toPersonaIndex: 1 },
];

const messages = [
  { sender: 'user', message: '안녕하세요', turnIndex: 0 } as any,
  { sender: 'ai',   message: '반갑습니다', turnIndex: 1 } as any,
  { sender: 'user', message: '도움이 필요해요', turnIndex: 2 } as any,
  { sender: 'ai',   message: '알겠습니다', turnIndex: 3 } as any,
];

function makeScenario(overrides: Record<string, any> = {}): any {
  return {
    id: 1,
    title: 'Test',
    difficulty: 2,
    context: { situation: '협상 상황', playerRole: { position: '영업 담당자' } },
    objectives: ['목표1'],
    ...overrides,
  };
}

function makePersona(overrides: Record<string, any> = {}): any {
  return { name: '김민준', role: '구매팀장', mbti: null, stance: '', goal: '', tradeoff: '', experience: '', department: '', ...overrides };
}

// ---------------------------------------------------------------------------
// conversationContextBuilder: mode='none' disables multi-persona labeling
// ---------------------------------------------------------------------------
describe("personaSwitchMode='none' — conversationContextBuilder", () => {
  it('treats AI messages as single persona even with a switch log present', () => {
    const history = prepareConversationHistory(
      messages, '김민준', undefined, undefined, switchLog, personas, 'none'
    );
    expect(history).not.toContain('이서연');
    expect(history).not.toContain('이전 담당자 발언');
    expect(history).not.toContain('다중 발언');
    expect(history).toContain('김민준 - 당신의 발언');
  });

  it('produces the same result as when called without a switch log', () => {
    const withNone = prepareConversationHistory(
      messages, '김민준', undefined, undefined, switchLog, personas, 'none'
    );
    const withoutLog = prepareConversationHistory(
      messages, '김민준', undefined, undefined, [], personas, undefined
    );
    expect(withNone).toEqual(withoutLog);
  });
});

// ---------------------------------------------------------------------------
// OptimizedGeminiProvider.buildCompactPrompt: mode='none' omits switchPersona
// ---------------------------------------------------------------------------
describe("personaSwitchMode='none' — provider prompt generation", () => {
  it('omits switchPersona from the JSON format instruction when mode is none', () => {
    const provider = new OptimizedGeminiProvider('fake-key');
    const scenario = makeScenario({
      personaSwitchMode: 'none',
      allPersonas: personas,
      activePersonaIndex: 0,
    });

    const { system } = (provider as any).buildCompactPrompt(
      scenario,
      makePersona(),
      '',
      [],
      'ko',
      undefined,
      undefined,
      undefined,
      undefined,
      personas,
      0,
      undefined, // no streamingMetaInstruction — let it compute from scenario
    );

    // With none mode, switchPersona must NOT appear in the JSON format hint
    expect(system).not.toContain('switchPersona');
  });

  it('includes switchPersona in the JSON format instruction for replace mode', () => {
    const provider = new OptimizedGeminiProvider('fake-key');
    const scenario = makeScenario({
      personaSwitchMode: 'replace',
      allPersonas: personas,
      activePersonaIndex: 0,
    });

    const { system } = (provider as any).buildCompactPrompt(
      scenario,
      makePersona(),
      '',
      [],
      'ko',
      undefined,
      undefined,
      undefined,
      undefined,
      personas,
      0,
      undefined,
    );

    expect(system).toContain('switchPersona');
  });
});
