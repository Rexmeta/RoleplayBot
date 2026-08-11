import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── hoisted generateContent mock ────────────────────────────────────────────
const geminiMock = vi.hoisted(() => ({ generateContent: vi.fn() }));

vi.mock('@google/genai', () => ({
  GoogleGenAI: function MockGoogleGenAI() {
    return { models: { generateContent: geminiMock.generateContent } };
  },
}));

vi.mock('../../server/services/aiUsageTracker', () => ({
  trackUsage: vi.fn(),
  extractGeminiTokens: vi.fn().mockReturnValue({ promptTokens: 100, completionTokens: 50 }),
  getModelPricingKey: vi.fn().mockReturnValue('gemini-2.5-flash'),
}));

vi.mock('../../server/utils/mbtiLoader', () => ({
  enrichPersonaWithMBTI: vi.fn().mockImplementation((p: any) => p),
}));

vi.mock('../../server/utils/globalMBTICache', () => ({
  GlobalMBTICache: {
    getInstance: vi.fn().mockReturnValue({
      getMBTIPersona: vi.fn().mockReturnValue(null),
    }),
  },
}));

vi.mock('../../server/utils/concurrency', () => ({
  retryWithBackoff: vi.fn().mockImplementation((fn: () => any) => fn()),
  feedbackSemaphore: { run: vi.fn().mockImplementation((fn: () => any) => fn()), active: 0, pending: 0 },
  conversationSemaphore: { run: vi.fn().mockImplementation((fn: () => any) => fn()), active: 0, pending: 0 },
}));

import { OptimizedGeminiProvider } from '../../server/services/providers/optimizedGeminiProvider';
import type { ConversationMessage } from '../../shared/schema/types';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeGeminiResponse(jsonPayload: object): object {
  return {
    text: JSON.stringify(jsonPayload),
  };
}

function makePersona(): any {
  return {
    name: '김민준',
    role: '팀장',
    mbti: null,
    stance: '원칙 준수',
    goal: '성과 달성',
    tradeoff: '',
    experience: '10년',
    department: '영업팀',
  };
}

function makeScenario(): any {
  return {
    id: 1,
    title: '협상 시나리오',
    difficulty: 2,
    targetTurns: 10,
    context: {
      situation: '납기 협상 상황',
      playerRole: { position: '영업 담당자' },
    },
    objectives: ['납기 단축', '비용 절감'],
  };
}

/** Minimal valid feedback JSON that the Gemini provider can parse */
const BASE_FEEDBACK_JSON = {
  overallScore: 65,
  scores: {
    clarityLogic: 7,
    listeningEmpathy: 5,
    appropriatenessAdaptability: 6,
    persuasivenessImpact: 4,
    strategicCommunication: 8,
  },
  evidence: {
    clarityLogic: [{ turnIndex: 1, quote: '네, 이해합니다', behaviorObserved: '경청', rubricBand: '보통 (6점)', reason: '명확한 응답' }],
    listeningEmpathy: [{ turnIndex: 2, quote: '알겠습니다', behaviorObserved: '공감', rubricBand: '보통 (5점)', reason: '기본 공감' }],
    appropriatenessAdaptability: [{ turnIndex: 3, quote: '맞습니다', behaviorObserved: '상황 대응', rubricBand: '보통 (6점)', reason: '적절한 대응' }],
    persuasivenessImpact: [{ turnIndex: 1, quote: '제 의견은', behaviorObserved: '주장 제시', rubricBand: '미흡 (4점)', reason: '근거 부족' }],
    strategicCommunication: [{ turnIndex: 4, quote: '전략적으로', behaviorObserved: '전략', rubricBand: '우수 (8점)', reason: '전략적 접근' }],
  },
  dimensionFeedback: {
    clarityLogic: '명확한 의사 표현을 보였습니다.',
    listeningEmpathy: '경청 능력이 기본 수준입니다.',
    appropriatenessAdaptability: '상황에 맞는 대응을 보였습니다.',
    persuasivenessImpact: '설득력이 부족했습니다.',
    strategicCommunication: '전략적 접근이 돋보였습니다.',
  },
  strengths: ['명확한 의사 표현', '전략적 접근'],
  improvements: ['경청 능력 향상', '설득력 강화'],
  nextSteps: ['적극적 경청 훈련', '논리적 설득 연습'],
  summary: '전반적으로 기본적인 커뮤니케이션 능력을 갖추고 있습니다.',
  ranking: '기본 역량은 갖추고 있으나 성장이 필요합니다.',
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

/**
 * Build conversation messages with one interrupted AI turn followed by a
 * defensive user reply. The system's `analyzeBargeIn` will classify this as
 * a single negative barge-in event.
 */
function makeMessagesWithInterruption(): ConversationMessage[] {
  return [
    { id: 1, conversationId: 1, sender: 'user', message: '안녕하세요, 일정 조율이 필요합니다.', timestamp: new Date('2024-01-01T10:00:00Z') },
    { id: 2, conversationId: 1, sender: 'ai', message: '네, 현재 일정은 다음과 같습니다.', timestamp: new Date('2024-01-01T10:01:00Z'), interrupted: true },
    { id: 3, conversationId: 1, sender: 'user', message: '아니요, 그건 이미 완료되었습니다.', timestamp: new Date('2024-01-01T10:02:00Z') },
    { id: 4, conversationId: 1, sender: 'ai', message: '그렇군요. 계속 진행하겠습니다.', timestamp: new Date('2024-01-01T10:03:00Z'), interrupted: false },
    { id: 5, conversationId: 1, sender: 'user', message: '네, 그렇게 해주세요.', timestamp: new Date('2024-01-01T10:04:00Z') },
  ] as ConversationMessage[];
}

function makeMessagesNoInterruption(): ConversationMessage[] {
  return [
    { id: 1, conversationId: 1, sender: 'user', message: '안녕하세요, 일정 조율이 필요합니다.', timestamp: new Date('2024-01-01T10:00:00Z') },
    { id: 2, conversationId: 1, sender: 'ai', message: '네, 현재 일정은 다음과 같습니다.', timestamp: new Date('2024-01-01T10:01:00Z'), interrupted: false },
    { id: 3, conversationId: 1, sender: 'user', message: '알겠습니다. 감사합니다.', timestamp: new Date('2024-01-01T10:02:00Z') },
  ] as ConversationMessage[];
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('OptimizedGeminiProvider — barge-in count recalculation', () => {
  let provider: OptimizedGeminiProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OptimizedGeminiProvider('fake-api-key');
  });

  it('recalculates count from events when AI provides an inflated count', async () => {
    // AI says count=99 but events array has only 1 entry
    const aiPayload = {
      ...BASE_FEEDBACK_JSON,
      bargeInAnalysis: {
        count: 99,
        positiveCount: 50,
        negativeCount: 49,
        neutralCount: 0,
        rate: 0.99,
        events: [
          { turnIndex: 1, aiMessage: '네, 현재 일정은...', userMessage: '아니요, 그건 이미 완료되었습니다.', assessment: 'negative', severity: 3 },
        ],
        summary: '말 끊기가 감지되었습니다.',
      },
    };
    geminiMock.generateContent.mockResolvedValue(makeGeminiResponse(aiPayload));

    const feedback = await provider.generateFeedback(
      makeScenario(),
      makeMessagesWithInterruption(),
      makePersona(),
      undefined,
      undefined,
      'ko'
    );

    expect(feedback.bargeInAnalysis).toBeDefined();
    // count must equal events.length (1), not AI-provided 99
    expect(feedback.bargeInAnalysis!.count).toBe(feedback.bargeInAnalysis!.events.length);
    expect(feedback.bargeInAnalysis!.count).toBe(1);
  });

  it('recalculates positiveCount/negativeCount/neutralCount from events when AI values are wrong', async () => {
    // AI provides 2 events both assessed as 'negative', but tells wrong positiveCount/negativeCount
    const aiPayload = {
      ...BASE_FEEDBACK_JSON,
      bargeInAnalysis: {
        count: 99,
        positiveCount: 99,
        negativeCount: 0,
        neutralCount: 0,
        rate: 0.5,
        events: [
          { turnIndex: 1, aiMessage: '안녕하세요.', userMessage: '아니요, 그렇지 않습니다.', assessment: 'negative', severity: 3 },
          { turnIndex: 3, aiMessage: '다음으로 넘어가겠습니다.', userMessage: '잠깐만요, 아직 끝나지 않았어요.', assessment: 'negative', severity: 2 },
        ],
        summary: '부정적 말 끊기가 발생했습니다.',
      },
    };
    geminiMock.generateContent.mockResolvedValue(makeGeminiResponse(aiPayload));

    const messages: ConversationMessage[] = [
      { id: 1, conversationId: 1, sender: 'user', message: '시작합니다.', timestamp: new Date('2024-01-01T10:00:00Z') },
      { id: 2, conversationId: 1, sender: 'ai', message: '안녕하세요.', timestamp: new Date('2024-01-01T10:01:00Z'), interrupted: true },
      { id: 3, conversationId: 1, sender: 'user', message: '아니요, 그렇지 않습니다.', timestamp: new Date('2024-01-01T10:02:00Z') },
      { id: 4, conversationId: 1, sender: 'ai', message: '다음으로 넘어가겠습니다.', timestamp: new Date('2024-01-01T10:03:00Z'), interrupted: true },
      { id: 5, conversationId: 1, sender: 'user', message: '잠깐만요, 아직 끝나지 않았어요.', timestamp: new Date('2024-01-01T10:04:00Z') },
    ] as ConversationMessage[];

    const feedback = await provider.generateFeedback(
      makeScenario(),
      messages,
      makePersona(),
      undefined,
      undefined,
      'ko'
    );

    expect(feedback.bargeInAnalysis).toBeDefined();
    const bi = feedback.bargeInAnalysis!;
    // counts must be derived from events, not from AI-provided values
    expect(bi.count).toBe(2);
    expect(bi.negativeCount).toBe(2);
    expect(bi.positiveCount).toBe(0);
    expect(bi.neutralCount).toBe(0);
    // sum invariant must hold
    expect(bi.positiveCount + bi.negativeCount + bi.neutralCount).toBe(bi.count);
  });

  it('count equals events.length for mixed assessment events when AI count is wrong', async () => {
    const aiPayload = {
      ...BASE_FEEDBACK_JSON,
      bargeInAnalysis: {
        count: 0,
        positiveCount: 0,
        negativeCount: 0,
        neutralCount: 0,
        rate: 0.3,
        events: [
          { turnIndex: 1, aiMessage: '방법 A를 고려해야 합니다.', userMessage: '방법 B가 훨씬 비용 효율적이라고 생각합니다.', assessment: 'positive', severity: 1 },
          { turnIndex: 3, aiMessage: '어떻게 생각하시나요?', userMessage: '동의하지 않습니다.', assessment: 'negative', severity: 3 },
          { turnIndex: 5, aiMessage: '계속할게요.', userMessage: '네.', assessment: 'neutral', severity: 2 },
        ],
        summary: '다양한 말 끊기가 감지되었습니다.',
      },
    };
    geminiMock.generateContent.mockResolvedValue(makeGeminiResponse(aiPayload));

    const messages: ConversationMessage[] = [
      { id: 1, conversationId: 1, sender: 'user', message: '시작합니다.', timestamp: new Date('2024-01-01T10:00:00Z') },
      { id: 2, conversationId: 1, sender: 'ai', message: '방법 A를 고려해야 합니다.', timestamp: new Date('2024-01-01T10:01:00Z'), interrupted: true },
      { id: 3, conversationId: 1, sender: 'user', message: '방법 B가 훨씬 비용 효율적이라고 생각합니다.', timestamp: new Date('2024-01-01T10:02:00Z') },
      { id: 4, conversationId: 1, sender: 'ai', message: '어떻게 생각하시나요?', timestamp: new Date('2024-01-01T10:03:00Z'), interrupted: true },
      { id: 5, conversationId: 1, sender: 'user', message: '동의하지 않습니다.', timestamp: new Date('2024-01-01T10:04:00Z') },
      { id: 6, conversationId: 1, sender: 'ai', message: '계속할게요.', timestamp: new Date('2024-01-01T10:05:00Z'), interrupted: true },
      { id: 7, conversationId: 1, sender: 'user', message: '네.', timestamp: new Date('2024-01-01T10:06:00Z') },
    ] as ConversationMessage[];

    const feedback = await provider.generateFeedback(
      makeScenario(),
      messages,
      makePersona(),
      undefined,
      undefined,
      'ko'
    );

    expect(feedback.bargeInAnalysis).toBeDefined();
    const bi = feedback.bargeInAnalysis!;
    expect(bi.count).toBe(bi.events.length);
    expect(bi.positiveCount).toBe(bi.events.filter(e => e.assessment === 'positive').length);
    expect(bi.negativeCount).toBe(bi.events.filter(e => e.assessment === 'negative').length);
    expect(bi.neutralCount).toBe(bi.events.filter(e => e.assessment === 'neutral').length);
    expect(bi.positiveCount + bi.negativeCount + bi.neutralCount).toBe(bi.count);
  });

  it('falls back to system-calculated events when AI provides empty events array', async () => {
    // AI acknowledges barge-in (count=5) but provides no events — system events should be used
    const aiPayload = {
      ...BASE_FEEDBACK_JSON,
      bargeInAnalysis: {
        count: 5,
        positiveCount: 3,
        negativeCount: 2,
        neutralCount: 0,
        rate: 0.5,
        events: [],
        summary: '말 끊기가 발생했습니다.',
      },
    };
    geminiMock.generateContent.mockResolvedValue(makeGeminiResponse(aiPayload));

    const feedback = await provider.generateFeedback(
      makeScenario(),
      makeMessagesWithInterruption(),
      makePersona(),
      undefined,
      undefined,
      'ko'
    );

    expect(feedback.bargeInAnalysis).toBeDefined();
    const bi = feedback.bargeInAnalysis!;
    // system-derived events (from the interrupted message) are used
    expect(bi.count).toBe(bi.events.length);
    expect(bi.events.length).toBeGreaterThan(0);
    expect(bi.count).not.toBe(5);
  });

  it('sets bargeInAnalysis to undefined when no interrupted turns and AI provides no bargeInAnalysis', async () => {
    const aiPayload = { ...BASE_FEEDBACK_JSON };
    geminiMock.generateContent.mockResolvedValue(makeGeminiResponse(aiPayload));

    const feedback = await provider.generateFeedback(
      makeScenario(),
      makeMessagesNoInterruption(),
      makePersona(),
      undefined,
      undefined,
      'ko'
    );

    expect(feedback.bargeInAnalysis).toBeUndefined();
  });

  it('does not double-count a barge-in when the same interrupted turn appears in both messages and events', async () => {
    // Scenario: a single interrupted AI turn triggers one barge-in event.
    // Even if the AI inflates the count, the post-process must produce count === events.length.
    const aiPayload = {
      ...BASE_FEEDBACK_JSON,
      bargeInAnalysis: {
        count: 5,           // inflated
        positiveCount: 0,
        negativeCount: 5,
        neutralCount: 0,
        rate: 0.5,
        events: [
          {
            turnIndex: 1,
            aiMessage: '네, 현재 일정은 다음과 같습니다.',
            userMessage: '아니요, 그건 이미 완료되었습니다.',
            assessment: 'negative',
            severity: 3,
          },
        ],
        summary: '말 끊기가 감지되었습니다.',
      },
    };
    geminiMock.generateContent.mockResolvedValue(makeGeminiResponse(aiPayload));

    const feedback = await provider.generateFeedback(
      makeScenario(),
      makeMessagesWithInterruption(),
      makePersona(),
      undefined,
      undefined,
      'ko'
    );

    // Only 1 event → count must be 1, not the AI-provided 5
    expect(feedback.bargeInAnalysis).toBeDefined();
    expect(feedback.bargeInAnalysis!.count).toBe(1);
    expect(feedback.bargeInAnalysis!.negativeCount).toBe(1);
    expect(feedback.bargeInAnalysis!.positiveCount).toBe(0);
  });

  it('count/positiveCount/negativeCount/neutralCount are consistent with events regardless of AI values', async () => {
    const aiPayload = {
      ...BASE_FEEDBACK_JSON,
      bargeInAnalysis: {
        count: 100,
        positiveCount: 33,
        negativeCount: 33,
        neutralCount: 34,
        rate: 0.9,
        events: [
          { turnIndex: 1, aiMessage: '방법 A를 사용합시다.', userMessage: '방법 B가 더 효율적입니다.', assessment: 'positive', severity: 1 },
          { turnIndex: 3, aiMessage: '어떻게 생각하시나요?', userMessage: '잘 모르겠습니다.', assessment: 'neutral', severity: 2 },
        ],
        summary: '말 끊기 요약',
      },
    };
    geminiMock.generateContent.mockResolvedValue(makeGeminiResponse(aiPayload));

    const feedback = await provider.generateFeedback(
      makeScenario(),
      makeMessagesWithInterruption(),
      makePersona(),
      undefined,
      undefined,
      'ko'
    );

    expect(feedback.bargeInAnalysis).toBeDefined();
    const bi = feedback.bargeInAnalysis!;
    // All summary counts must be derived from events array
    expect(bi.count).toBe(bi.events.length);
    expect(bi.positiveCount).toBe(bi.events.filter(e => e.assessment === 'positive').length);
    expect(bi.negativeCount).toBe(bi.events.filter(e => e.assessment === 'negative').length);
    expect(bi.neutralCount).toBe(bi.events.filter(e => e.assessment === 'neutral').length);
    // AI-provided 100 must NOT appear
    expect(bi.count).not.toBe(100);
  });
});
