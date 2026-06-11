import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: vi.fn(),
        },
      };
      constructor(_opts: any) {}
    },
  };
});

vi.mock('../../server/services/aiUsageTracker', () => ({
  trackUsage: vi.fn(),
  extractOpenAITokens: vi.fn().mockReturnValue({ promptTokens: 100, completionTokens: 50 }),
  getModelPricingKey: vi.fn().mockReturnValue('gpt-4'),
}));

vi.mock('../../server/utils/concurrency', () => ({
  retryWithBackoff: vi.fn().mockImplementation((fn: () => any) => fn()),
  feedbackSemaphore: { run: vi.fn().mockImplementation((fn: () => any) => fn()), active: 0, pending: 0 },
  conversationSemaphore: { run: vi.fn().mockImplementation((fn: () => any) => fn()), active: 0, pending: 0 },
}));

import { OpenAIProvider } from '../../server/services/providers/openaiProvider';
import type { ConversationMessage } from '../../shared/schema/types';

const VALID_FEEDBACK_JSON = {
  overallScore: 65,
  scores: {
    clarityLogic: 7,
    listeningEmpathy: 5,
    appropriatenessAdaptability: 6,
    persuasivenessImpact: 4,
    strategicCommunication: 8,
  },
  evidence: {
    clarityLogic: [{ turnIndex: 1, quote: '네, 이해합니다', behaviorObserved: '적극적 경청', rubricBand: '보통 (6점)', reason: '명확한 응답' }],
    listeningEmpathy: [{ turnIndex: 2, quote: '알겠습니다', behaviorObserved: '공감 표현', rubricBand: '보통 (5점)', reason: '기본 공감' }],
    appropriatenessAdaptability: [{ turnIndex: 3, quote: '맞습니다', behaviorObserved: '상황 대응', rubricBand: '보통 (6점)', reason: '적절한 대응' }],
    persuasivenessImpact: [{ turnIndex: 1, quote: '제 의견은', behaviorObserved: '주장 제시', rubricBand: '미흡 (4점)', reason: '근거 부족' }],
    strategicCommunication: [{ turnIndex: 4, quote: '전략적으로', behaviorObserved: '전략 제시', rubricBand: '우수 (8점)', reason: '전략적 접근' }],
  },
  dimensionFeedback: {
    clarityLogic: '명확한 의사 표현을 보였습니다. 논리적 구성이 체계적이었습니다.',
    listeningEmpathy: '경청 능력이 기본 수준입니다. 공감 표현이 다소 형식적이었습니다.',
    appropriatenessAdaptability: '상황에 맞는 대응을 보였습니다. 유연성은 다소 부족했습니다.',
    persuasivenessImpact: '설득력이 부족했습니다. 근거 제시가 미흡했습니다.',
    strategicCommunication: '전략적 접근이 돋보였습니다. 목표 지향적 소통을 했습니다.',
  },
  strengths: ['명확한 의사 표현', '전략적 접근 방식', '차분한 대화 태도'],
  improvements: ['경청 능력 향상 필요', '설득력 강화 필요', '공감 표현 다양화'],
  nextSteps: ['적극적 경청 훈련', '논리적 설득 연습', '공감 표현 다양화'],
  summary: '전반적으로 기본적인 커뮤니케이션 능력을 갖추고 있으나, 경청과 설득력에서 개선이 필요합니다. 전략적 소통 능력은 우수합니다.',
  ranking: '기본 역량은 갖추고 있으나 경청과 설득력에서 성장이 필요합니다. 전략적 접근은 강점입니다.',
  behaviorGuides: [
    { situation: '갈등 상황', action: '경청 후 응답', example: '말씀 잘 들었습니다', impact: '신뢰 형성' },
  ],
  conversationGuides: [
    { scenario: '협상', goodExample: '공감 먼저', badExample: '즉시 반박', keyPoints: ['경청', '공감'] },
  ],
  developmentPlan: {
    shortTerm: [{ goal: '경청 능력', actions: ['훈련'], measurable: '주 3회' }],
    mediumTerm: [{ goal: '설득력', actions: ['연습'], measurable: '월 1회' }],
    longTerm: [{ goal: '전략적 소통', actions: ['실무 적용'], measurable: '분기 평가' }],
    recommendedResources: ['커뮤니케이션 서적'],
  },
};

function makeOpenAIResponse(jsonPayload: object) {
  return {
    choices: [{ message: { content: JSON.stringify(jsonPayload) } }],
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  };
}

function makePersona() {
  return {
    id: 'communication',
    name: '김민준',
    role: '팀장',
    personality: '원칙적',
    responseStyle: '직접적',
    background: '10년 경력',
    goals: ['성과 달성'],
  } as any;
}

function makeScenario() {
  return {
    id: 1,
    title: '협상 시나리오',
    targetTurns: 10,
    minValidTurns: 4,
  } as any;
}

function makeMessages(opts: { withInterruptions: boolean }): ConversationMessage[] {
  const base: ConversationMessage[] = [
    { id: 1, conversationId: 1, sender: 'user', message: '안녕하세요, 이번 프로젝트 일정에 대해 논의하고 싶습니다.', timestamp: new Date('2024-01-01T10:00:00Z') },
    { id: 2, conversationId: 1, sender: 'ai', message: '네, 현재 일정은 다음과 같습니다. 먼저 요구사항 분석이 필요한데요, 어떻게 생각하시나요?', timestamp: new Date('2024-01-01T10:01:00Z'), interrupted: opts.withInterruptions },
    { id: 3, conversationId: 1, sender: 'user', message: '아니요, 그건 이미 완료되었습니다. 바로 개발을 시작하면 됩니다.', timestamp: new Date('2024-01-01T10:02:00Z') },
    { id: 4, conversationId: 1, sender: 'ai', message: '그렇군요. 개발 일정은 약 6주가 필요합니다.', timestamp: new Date('2024-01-01T10:03:00Z'), interrupted: false },
    { id: 5, conversationId: 1, sender: 'user', message: '6주는 너무 길어요. 4주 안에 가능할까요? 비용도 고려해야 하고 팀 역량도 있습니다.', timestamp: new Date('2024-01-01T10:04:00Z') },
    { id: 6, conversationId: 1, sender: 'ai', message: '4주는 어렵지만 협의해볼 수 있습니다.', timestamp: new Date('2024-01-01T10:05:00Z') },
    { id: 7, conversationId: 1, sender: 'user', message: '그렇다면 리소스를 늘려서 진행하는 방안도 검토해 주세요.', timestamp: new Date('2024-01-01T10:06:00Z') },
    { id: 8, conversationId: 1, sender: 'ai', message: '알겠습니다. 검토해보겠습니다.', timestamp: new Date('2024-01-01T10:07:00Z') },
    { id: 9, conversationId: 1, sender: 'user', message: '좋습니다. 다음 주까지 결과를 알려주세요.', timestamp: new Date('2024-01-01T10:08:00Z') },
  ];
  return base;
}

describe('OpenAIProvider — barge-in analysis in feedback path', () => {
  let provider: OpenAIProvider;
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    provider = new OpenAIProvider('fake-api-key', 'gpt-4');
    const OpenAI = (await import('openai')).default;
    mockCreate = (new OpenAI({} as any) as any).chat.completions.create;
    (provider as any).client.chat.completions.create = mockCreate;
    mockCreate.mockResolvedValue(makeOpenAIResponse(VALID_FEEDBACK_JSON));
  });

  it('sets bargeInAnalysis when interrupted AI turns are present', async () => {
    const messages = makeMessages({ withInterruptions: true });
    const feedback = await provider.generateFeedback(
      makeScenario(),
      messages,
      makePersona(),
      undefined,
      undefined,
      'ko'
    );

    expect(feedback.bargeInAnalysis).toBeDefined();
    expect(feedback.bargeInAnalysis!.count).toBeGreaterThan(0);
  });

  it('reflects bargeInCount in scoreAdjustments when interruptions occur', async () => {
    const messages = makeMessages({ withInterruptions: true });
    const feedback = await provider.generateFeedback(
      makeScenario(),
      messages,
      makePersona(),
      undefined,
      undefined,
      'ko'
    );

    expect(feedback.scoreAdjustments).toBeDefined();
    expect(feedback.scoreAdjustments!.bargeInCount).toBeGreaterThan(0);
  });

  it('reflects bargeInAdjustment (non-zero) in scoreAdjustments when interruptions occur', async () => {
    const messages = makeMessages({ withInterruptions: true });
    const feedback = await provider.generateFeedback(
      makeScenario(),
      messages,
      makePersona(),
      undefined,
      undefined,
      'ko'
    );

    expect(feedback.scoreAdjustments).toBeDefined();
    expect(feedback.scoreAdjustments!.bargeInAdjustment).not.toBe(0);
  });

  it('bargeInAdjustment matches the expected negative penalty for a defensive barge-in', async () => {
    const messages = makeMessages({ withInterruptions: true });
    const feedback = await provider.generateFeedback(
      makeScenario(),
      messages,
      makePersona(),
      undefined,
      undefined,
      'ko'
    );

    // The interrupted AI message is followed by a defensive user message starting with "아니요"
    // which is classified as negative → penalty of -3 per negative barge-in
    expect(feedback.scoreAdjustments!.bargeInAdjustment).toBe(-3);
  });

  it('sets bargeInAnalysis.negativeCount > 0 for a defensive interruption', async () => {
    const messages = makeMessages({ withInterruptions: true });
    const feedback = await provider.generateFeedback(
      makeScenario(),
      messages,
      makePersona(),
      undefined,
      undefined,
      'ko'
    );

    expect(feedback.bargeInAnalysis!.negativeCount).toBeGreaterThan(0);
  });

  it('leaves bargeInAnalysis undefined when no interrupted turns exist', async () => {
    const messages = makeMessages({ withInterruptions: false });
    const feedback = await provider.generateFeedback(
      makeScenario(),
      messages,
      makePersona(),
      undefined,
      undefined,
      'ko'
    );

    expect(feedback.bargeInAnalysis).toBeUndefined();
  });

  it('sets bargeInCount to 0 in scoreAdjustments when no interruptions', async () => {
    const messages = makeMessages({ withInterruptions: false });
    const feedback = await provider.generateFeedback(
      makeScenario(),
      messages,
      makePersona(),
      undefined,
      undefined,
      'ko'
    );

    expect(feedback.scoreAdjustments!.bargeInCount).toBe(0);
  });

  it('sets bargeInAdjustment to 0 in scoreAdjustments when no interruptions', async () => {
    const messages = makeMessages({ withInterruptions: false });
    const feedback = await provider.generateFeedback(
      makeScenario(),
      messages,
      makePersona(),
      undefined,
      undefined,
      'ko'
    );

    expect(feedback.scoreAdjustments!.bargeInAdjustment).toBe(0);
  });

  it('applies bargeInAdjustment to overallScore (finalScore differs from baseScore by adjustment)', async () => {
    const messages = makeMessages({ withInterruptions: true });
    const feedback = await provider.generateFeedback(
      makeScenario(),
      messages,
      makePersona(),
      undefined,
      undefined,
      'ko'
    );

    const adj = feedback.scoreAdjustments!;
    // finalScore = baseScore - evidencePenalty - completionPenalty + bargeInAdjustment
    const expected = adj.baseScore
      - (adj.evidencePenalty ?? 0)
      - (adj.completionPenalty ?? 0)
      + adj.bargeInAdjustment;
    expect(feedback.scoreAdjustments!.finalScore).toBe(expected);
  });

  it('bargeInAnalysis contains the event with the interrupted turn details', async () => {
    const messages = makeMessages({ withInterruptions: true });
    const feedback = await provider.generateFeedback(
      makeScenario(),
      messages,
      makePersona(),
      undefined,
      undefined,
      'ko'
    );

    expect(feedback.bargeInAnalysis!.events.length).toBeGreaterThan(0);
    const event = feedback.bargeInAnalysis!.events[0];
    expect(event).toHaveProperty('aiMessage');
    expect(event).toHaveProperty('userMessage');
    expect(event).toHaveProperty('assessment');
    expect(['positive', 'negative', 'neutral']).toContain(event.assessment);
  });
});
