import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('../../server/utils/aiUsageLogger', () => ({
  trackUsage: vi.fn(),
  extractGeminiTokens: vi.fn(),
  getModelPricingKey: vi.fn(),
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

function makeScenario(overrides: Record<string, any> = {}): any {
  return {
    id: 1,
    title: 'Test Scenario',
    difficulty: 2,
    targetTurns: 10,
    context: {
      situation: '거래처와의 납기 협상 상황으로 15% 비용 절감이 요구됩니다.',
      playerRole: { position: '영업 담당자' },
    },
    objectives: ['납기 30일 단축', '15% 원가 절감', '품질 등급 A 유지'],
    ...overrides,
  };
}

function makePersona(overrides: Record<string, any> = {}): any {
  return {
    name: '김민준',
    role: '구매팀장',
    mbti: null,
    stance: '원칙 준수',
    goal: '회사 이익 극대화',
    tradeoff: '',
    experience: '10년',
    department: '구매팀',
    ...overrides,
  };
}

describe('OptimizedGeminiProvider — buildCompactPrompt', () => {
  let provider: OptimizedGeminiProvider;

  beforeEach(() => {
    provider = new OptimizedGeminiProvider('fake-api-key');
  });

  it('wraps situation/objectives in a 【배경 컨텍스트】 block', () => {
    const { system } = (provider as any).buildCompactPrompt(
      makeScenario(),
      makePersona(),
      '',
      [],
      'ko'
    );

    expect(system).toContain('【배경 컨텍스트');
    expect(system).toContain('대화 중 직접 언급 금지');
  });

  it('includes the metric-quoting prohibition warning in the prompt', () => {
    const { system } = (provider as any).buildCompactPrompt(
      makeScenario(),
      makePersona(),
      '',
      [],
      'ko'
    );

    expect(system).toMatch(/수치.*직접 언급 금지|퍼센트.*읽거나|이 수치를 그대로 읽/);
  });

  it('scenario situation text is present (AI needs to know it) but inside the guarded block', () => {
    const scenario = makeScenario({
      context: {
        situation: '30% 매출 목표와 함께 진행되는 협상입니다.',
        playerRole: { position: '팀장' },
      },
    });

    const { system } = (provider as any).buildCompactPrompt(
      scenario,
      makePersona(),
      '',
      [],
      'ko'
    );

    const contextBlockStart = system.indexOf('【배경 컨텍스트');
    const contextBlockEnd = system.indexOf('⚠️', contextBlockStart);

    expect(contextBlockStart).toBeGreaterThan(-1);
    expect(system.slice(contextBlockStart, contextBlockEnd)).toContain('30% 매출 목표');
    expect(contextBlockEnd).toBeGreaterThan(contextBlockStart);
  });

  it('objectives containing percentages are inside the guarded block, not in bare instructions', () => {
    const scenario = makeScenario({
      objectives: ['15% 원가 절감 필수', '납기 45일 단축'],
    });

    const { system } = (provider as any).buildCompactPrompt(
      scenario,
      makePersona(),
      '',
      [],
      'ko'
    );

    const contextBlockStart = system.indexOf('【배경 컨텍스트');
    const prohibitionLine = system.indexOf('⚠️', contextBlockStart);

    expect(system.slice(contextBlockStart, prohibitionLine + 200)).toContain('15% 원가 절감 필수');

    const afterContext = system.slice(prohibitionLine + 200);
    expect(afterContext).not.toContain('15% 원가 절감 필수');
  });

  it('English mode prompt includes English prohibition on quoting scenario metrics', () => {
    const { system } = (provider as any).buildCompactPrompt(
      makeScenario(),
      makePersona(),
      '',
      [],
      'en'
    );

    expect(system).toMatch(/\u3010배경 컨텍스트|background context|직접 언급 금지/i);
  });

  it('first AI greeting should not contain bare percentage or time metric strings', () => {
    const scenario = makeScenario({
      context: {
        situation: '300% 이상의 성장률을 달성해야 하는 긴박한 상황입니다.',
        playerRole: { position: '신입사원' },
      },
      objectives: ['300% 목표 달성', '6개월 내 완료'],
    });

    const { system } = (provider as any).buildCompactPrompt(
      scenario,
      makePersona(),
      '',
      [],
      'ko'
    );

    const contextBlockStart = system.indexOf('【배경 컨텍스트');
    const contextBlockEnd = system.indexOf('\n\n**핵심 성격', contextBlockStart);

    const outsideContext = system.slice(0, contextBlockStart) + system.slice(contextBlockEnd);
    expect(outsideContext).not.toContain('300% 이상');
    expect(outsideContext).not.toContain('6개월 내 완료');
  });

  it('prohibition statement is always present regardless of scenario content', () => {
    const minimalScenario = makeScenario({
      context: { situation: '일반적인 업무 상황입니다.', playerRole: undefined },
      objectives: [],
    });

    const { system } = (provider as any).buildCompactPrompt(
      minimalScenario,
      makePersona(),
      '',
      [],
      'ko'
    );

    expect(system).toContain('⚠️');
    expect(system).toContain('배경 지식');
  });
});
