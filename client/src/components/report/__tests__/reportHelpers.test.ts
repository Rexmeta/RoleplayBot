import { describe, it, expect } from 'vitest';
import {
  renderHeader,
  renderScoreCards,
  renderPracticeGuides,
  renderDevelopmentPlan,
  renderStrategyEvaluation,
  renderFooter,
} from '../generatePrintableContent';

const XSS = '<script>alert("xss")</script>';
const XSS_ESCAPED_LT = '&lt;';
const XSS_ESCAPED_GT = '&gt;';

function assertNoRawXss(html: string, label: string) {
  expect(html, `${label}: raw <script> must not appear`).not.toContain('<script>');
  expect(html, `${label}: raw </script> must not appear`).not.toContain('</script>');
  expect(html, `${label}: escaped < must appear`).toContain(XSS_ESCAPED_LT);
  expect(html, `${label}: escaped > must appear`).toContain(XSS_ESCAPED_GT);
}

function makeBaseFeedback(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'test-id',
    conversationId: 'conv-001',
    personaRunId: null,
    overallScore: 78,
    scores: [],
    detailedFeedback: {
      overallScore: 78,
      scores: [],
      strengths: [],
      improvements: [],
      nextSteps: [],
      summary: '',
    },
    createdAt: new Date('2026-01-15T10:00:00Z'),
    ...overrides,
  };
}

function makeBaseScenario(overrides: Record<string, unknown> = {}): any {
  return { title: 'Sales Negotiation', ...overrides };
}

function makeBasePersona(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'p1',
    name: 'Kim Jiyeon',
    department: 'Sales',
    position: 'Manager',
    ...overrides,
  };
}

const noopTranslate = (_key: string | undefined, fallback: string) => fallback;

describe('renderHeader', () => {
  it('happy path: renders user name, scenario title, persona info, grade and score', () => {
    const html = renderHeader({
      feedback: makeBaseFeedback({ overallScore: 85 }),
      scenario: makeBaseScenario(),
      persona: makeBasePersona(),
      userName: 'Alice',
    });

    expect(html).toContain('Alice');
    expect(html).toContain('님 맞춤 보고서');
    expect(html).toContain('Sales Negotiation');
    expect(html).toContain('85.0점');
    expect(html).toContain('report-header');
  });

  it('shows correct grade for score >= 80 (A)', () => {
    const html = renderHeader({
      feedback: makeBaseFeedback({ overallScore: 82 }),
      scenario: makeBaseScenario(),
      persona: makeBasePersona(),
      userName: 'Bob',
    });
    expect(html).toContain('>A<');
  });

  it('shows correct grade for score < 60 (D)', () => {
    const html = renderHeader({
      feedback: makeBaseFeedback({ overallScore: 50 }),
      scenario: makeBaseScenario(),
      persona: makeBasePersona(),
      userName: 'Bob',
    });
    expect(html).toContain('>D<');
  });

  it('handles missing overallScore (defaults to 0)', () => {
    const html = renderHeader({
      feedback: makeBaseFeedback({ overallScore: null }),
      scenario: makeBaseScenario(),
      persona: makeBasePersona(),
      userName: 'Test',
    });
    expect(html).toContain('0.0점');
  });

  it('XSS: escapes userName', () => {
    const html = renderHeader({
      feedback: makeBaseFeedback(),
      scenario: makeBaseScenario(),
      persona: makeBasePersona(),
      userName: XSS,
    });
    assertNoRawXss(html, 'userName');
  });

  it('XSS: escapes scenario title', () => {
    const html = renderHeader({
      feedback: makeBaseFeedback(),
      scenario: makeBaseScenario({ title: XSS }),
      persona: makeBasePersona(),
      userName: 'Safe',
    });
    assertNoRawXss(html, 'scenario.title');
  });

  it('XSS: escapes persona info fields', () => {
    const html = renderHeader({
      feedback: makeBaseFeedback(),
      scenario: makeBaseScenario(),
      persona: makeBasePersona({ name: XSS, department: XSS, position: XSS }),
      userName: 'Safe',
    });
    assertNoRawXss(html, 'persona fields');
  });
});

describe('renderScoreCards', () => {
  it('happy path: renders section heading and score card', () => {
    const feedback = makeBaseFeedback({
      scores: [{ name: 'Communication', category: 'comm', score: 8, feedback: 'Good job', maxScore: 10 }],
      detailedFeedback: {
        strengths: ['Clarity'],
        improvements: ['Tone'],
        nextSteps: ['Practice'],
        scores: [],
        overallScore: 78,
        summary: '',
      },
    });
    const html = renderScoreCards({ feedback, getTranslatedDimensionName: noopTranslate });

    expect(html).toContain('📊 성과 분석');
    expect(html).toContain('Communication');
    expect(html).toContain('Good job');
    expect(html).toContain('8.0/10');
    expect(html).toContain('✅ 역량 확인됨');
  });

  it('shows correct status label for mid score (5-7)', () => {
    const feedback = makeBaseFeedback({
      scores: [{ name: 'Focus', category: 'focus', score: 6, feedback: 'Decent', maxScore: 10 }],
    });
    const html = renderScoreCards({ feedback, getTranslatedDimensionName: noopTranslate });
    expect(html).toContain('🔶 기본 수준');
  });

  it('shows correct status label for low score (< 5)', () => {
    const feedback = makeBaseFeedback({
      scores: [{ name: 'Empathy', category: 'emp', score: 3, feedback: 'Needs work', maxScore: 10 }],
    });
    const html = renderScoreCards({ feedback, getTranslatedDimensionName: noopTranslate });
    expect(html).toContain('⚠️ 집중 개선 필요');
  });

  it('renders time analysis block when conversationDuration is present', () => {
    const feedback = makeBaseFeedback({
      detailedFeedback: {
        strengths: [],
        improvements: [],
        nextSteps: [],
        scores: [],
        overallScore: 78,
        summary: '',
        conversationDuration: 185,
        averageResponseTime: 4,
        timePerformance: { rating: 'good', feedback: 'Well paced' },
      },
    });
    const html = renderScoreCards({ feedback, getTranslatedDimensionName: noopTranslate });

    expect(html).toContain('⏱️ 대화 시간 분석');
    expect(html).toContain('3:05');
    expect(html).toContain('4초');
    expect(html).toContain('✅ 좋음');
    expect(html).toContain('Well paced');
  });

  it('omits time block when conversationDuration is absent', () => {
    const html = renderScoreCards({ feedback: makeBaseFeedback(), getTranslatedDimensionName: noopTranslate });
    expect(html).not.toContain('대화 시간 분석');
  });

  it('renders strengths, improvements and nextSteps', () => {
    const feedback = makeBaseFeedback({
      detailedFeedback: {
        strengths: ['Strong opener'],
        improvements: ['Eye contact'],
        nextSteps: ['Role play'],
        scores: [],
        overallScore: 78,
        summary: '',
      },
    });
    const html = renderScoreCards({ feedback, getTranslatedDimensionName: noopTranslate });

    expect(html).toContain('Strong opener');
    expect(html).toContain('Eye contact');
    expect(html).toContain('Role play');
  });

  it('handles empty scores array gracefully', () => {
    const html = renderScoreCards({ feedback: makeBaseFeedback(), getTranslatedDimensionName: noopTranslate });
    expect(typeof html).toBe('string');
    expect(html).toContain('report-section');
  });

  it('XSS: escapes score.feedback', () => {
    const feedback = makeBaseFeedback({
      scores: [{ name: 'Test', category: 'test', score: 7, feedback: XSS }],
    });
    const html = renderScoreCards({ feedback, getTranslatedDimensionName: noopTranslate });
    assertNoRawXss(html, 'score.feedback');
  });

  it('XSS: escapes score.name via getTranslatedDimensionName', () => {
    const feedback = makeBaseFeedback({
      scores: [{ name: XSS, category: undefined, score: 7, feedback: 'ok' }],
    });
    const html = renderScoreCards({ feedback, getTranslatedDimensionName: noopTranslate });
    assertNoRawXss(html, 'score.name');
  });

  it('XSS: escapes strengths/improvements/nextSteps', () => {
    const feedback = makeBaseFeedback({
      detailedFeedback: {
        strengths: [XSS],
        improvements: [XSS],
        nextSteps: [XSS],
        scores: [],
        overallScore: 78,
        summary: '',
      },
    });
    const html = renderScoreCards({ feedback, getTranslatedDimensionName: noopTranslate });
    assertNoRawXss(html, 'eval items');
  });

  it('XSS: escapes timePerformance.feedback', () => {
    const feedback = makeBaseFeedback({
      detailedFeedback: {
        strengths: [],
        improvements: [],
        nextSteps: [],
        scores: [],
        overallScore: 78,
        summary: '',
        conversationDuration: 60,
        timePerformance: { rating: 'excellent', feedback: XSS },
      },
    });
    const html = renderScoreCards({ feedback, getTranslatedDimensionName: noopTranslate });
    assertNoRawXss(html, 'timePerformance.feedback');
  });

  it('XSS: escapes ranking', () => {
    const feedback = makeBaseFeedback({
      detailedFeedback: {
        strengths: [],
        improvements: [],
        nextSteps: [],
        scores: [],
        overallScore: 78,
        summary: '',
        ranking: XSS,
      },
    });
    const html = renderScoreCards({ feedback, getTranslatedDimensionName: noopTranslate });
    assertNoRawXss(html, 'ranking');
  });
});

describe('renderPracticeGuides', () => {
  it('returns empty string when no guides are present', () => {
    const html = renderPracticeGuides({ feedback: makeBaseFeedback() });
    expect(html).toBe('');
  });

  it('happy path: renders behavior guide fields', () => {
    const feedback = makeBaseFeedback({
      detailedFeedback: {
        strengths: [],
        improvements: [],
        nextSteps: [],
        scores: [],
        overallScore: 78,
        summary: '',
        behaviorGuides: [{
          situation: 'Client raises objection',
          action: 'Acknowledge and reframe',
          example: 'I understand your concern, let me address that…',
          impact: 'Reduces defensiveness',
        }],
      },
    });
    const html = renderPracticeGuides({ feedback });

    expect(html).toContain('🗂️ 실천 가이드');
    expect(html).toContain('💡 행동 개선 포인트');
    expect(html).toContain('Client raises objection');
    expect(html).toContain('Acknowledge and reframe');
    expect(html).toContain('I understand your concern');
    expect(html).toContain('Reduces defensiveness');
  });

  it('happy path: renders conversation guide fields and keyPoints', () => {
    const feedback = makeBaseFeedback({
      detailedFeedback: {
        strengths: [],
        improvements: [],
        nextSteps: [],
        scores: [],
        overallScore: 78,
        summary: '',
        conversationGuides: [{
          scenario: 'Opening call',
          goodExample: 'Hello, I\'m calling about…',
          badExample: 'Hey, you got a minute?',
          keyPoints: ['Clarity', 'Respect'],
        }],
      },
    });
    const html = renderPracticeGuides({ feedback });

    expect(html).toContain('💬 대화 스크립트 예시');
    expect(html).toContain('Opening call');
    expect(html).toContain('Hello, I&#039;m calling about');
    expect(html).toContain('Hey, you got a minute?');
    expect(html).toContain('Clarity');
    expect(html).toContain('Respect');
  });

  it('renders only behavior block when conversationGuides is empty', () => {
    const feedback = makeBaseFeedback({
      detailedFeedback: {
        strengths: [],
        improvements: [],
        nextSteps: [],
        scores: [],
        overallScore: 78,
        summary: '',
        behaviorGuides: [{ situation: 'S', action: 'A', example: '', impact: '' }],
        conversationGuides: [],
      },
    });
    const html = renderPracticeGuides({ feedback });
    expect(html).toContain('행동 개선');
    expect(html).not.toContain('대화 스크립트 예시');
  });

  it('renders only conversation block when behaviorGuides is empty', () => {
    const feedback = makeBaseFeedback({
      detailedFeedback: {
        strengths: [],
        improvements: [],
        nextSteps: [],
        scores: [],
        overallScore: 78,
        summary: '',
        behaviorGuides: [],
        conversationGuides: [{ scenario: 'S', goodExample: 'G', badExample: 'B', keyPoints: [] }],
      },
    });
    const html = renderPracticeGuides({ feedback });
    expect(html).not.toContain('행동 개선');
    expect(html).toContain('대화 스크립트 예시');
  });

  it('omits example/impact blocks when those fields are falsy', () => {
    const feedback = makeBaseFeedback({
      detailedFeedback: {
        strengths: [],
        improvements: [],
        nextSteps: [],
        scores: [],
        overallScore: 78,
        summary: '',
        behaviorGuides: [{ situation: 'Sit', action: 'Act', example: '', impact: '' }],
      },
    });
    const html = renderPracticeGuides({ feedback });
    expect(html).not.toContain('실제 예시');
    expect(html).not.toContain('기대 효과');
  });

  it('XSS: escapes behaviorGuide fields', () => {
    const feedback = makeBaseFeedback({
      detailedFeedback: {
        strengths: [],
        improvements: [],
        nextSteps: [],
        scores: [],
        overallScore: 78,
        summary: '',
        behaviorGuides: [{
          situation: XSS,
          action: XSS,
          example: XSS,
          impact: XSS,
        }],
      },
    });
    const html = renderPracticeGuides({ feedback });
    assertNoRawXss(html, 'behaviorGuide fields');
  });

  it('XSS: escapes conversationGuide fields and keyPoints', () => {
    const feedback = makeBaseFeedback({
      detailedFeedback: {
        strengths: [],
        improvements: [],
        nextSteps: [],
        scores: [],
        overallScore: 78,
        summary: '',
        conversationGuides: [{
          scenario: XSS,
          goodExample: XSS,
          badExample: XSS,
          keyPoints: [XSS],
        }],
      },
    });
    const html = renderPracticeGuides({ feedback });
    assertNoRawXss(html, 'conversationGuide fields');
  });
});

describe('renderDevelopmentPlan', () => {
  it('returns empty string when no developmentPlan is present', () => {
    const html = renderDevelopmentPlan({ feedback: makeBaseFeedback() });
    expect(html).toBe('');
  });

  it('happy path: renders all term cards and resource section', () => {
    const feedback = makeBaseFeedback({
      detailedFeedback: {
        strengths: [],
        improvements: [],
        nextSteps: [],
        scores: [],
        overallScore: 78,
        summary: '',
        developmentPlan: {
          shortTerm: [{ goal: 'Short goal', actions: ['Action A'], measurable: 'Metric A' }],
          mediumTerm: [{ goal: 'Medium goal', actions: ['Action B', 'Action C'], measurable: '' }],
          longTerm: [{ goal: 'Long goal', actions: [], measurable: '' }],
          recommendedResources: ['Book A', 'Course B'],
        },
      },
    });
    const html = renderDevelopmentPlan({ feedback });

    expect(html).toContain('📈 개발 계획');
    expect(html).toContain('📅 단기 목표 (1-2주)');
    expect(html).toContain('📆 중기 목표 (1-2개월)');
    expect(html).toContain('🗓️ 장기 목표 (3-6개월)');
    expect(html).toContain('Short goal');
    expect(html).toContain('Action A');
    expect(html).toContain('Metric A');
    expect(html).toContain('Medium goal');
    expect(html).toContain('Long goal');
    expect(html).toContain('📚 추천 학습 자료');
    expect(html).toContain('Book A');
    expect(html).toContain('Course B');
  });

  it('omits resource section when recommendedResources is empty', () => {
    const feedback = makeBaseFeedback({
      detailedFeedback: {
        strengths: [],
        improvements: [],
        nextSteps: [],
        scores: [],
        overallScore: 78,
        summary: '',
        developmentPlan: {
          shortTerm: [],
          mediumTerm: [],
          longTerm: [],
          recommendedResources: [],
        },
      },
    });
    const html = renderDevelopmentPlan({ feedback });
    expect(html).not.toContain('추천 학습 자료');
  });

  it('omits measurable block when measurable field is falsy', () => {
    const feedback = makeBaseFeedback({
      detailedFeedback: {
        strengths: [],
        improvements: [],
        nextSteps: [],
        scores: [],
        overallScore: 78,
        summary: '',
        developmentPlan: {
          shortTerm: [{ goal: 'Goal', actions: ['Step'], measurable: '' }],
          mediumTerm: [],
          longTerm: [],
          recommendedResources: [],
        },
      },
    });
    const html = renderDevelopmentPlan({ feedback });
    expect(html).not.toContain('측정지표');
  });

  it('XSS: escapes goal, actions, measurable, and resources', () => {
    const feedback = makeBaseFeedback({
      detailedFeedback: {
        strengths: [],
        improvements: [],
        nextSteps: [],
        scores: [],
        overallScore: 78,
        summary: '',
        developmentPlan: {
          shortTerm: [{ goal: XSS, actions: [XSS], measurable: XSS }],
          mediumTerm: [],
          longTerm: [],
          recommendedResources: [XSS],
        },
      },
    });
    const html = renderDevelopmentPlan({ feedback });
    assertNoRawXss(html, 'developmentPlan fields');
  });
});

describe('renderStrategyEvaluation', () => {
  it('returns empty string when no sequenceAnalysis is present', () => {
    const html = renderStrategyEvaluation({ feedback: makeBaseFeedback() });
    expect(html).toBe('');
  });

  it('happy path: renders strategic score and all text blocks', () => {
    const feedback = makeBaseFeedback({
      detailedFeedback: {
        strengths: [],
        improvements: [],
        nextSteps: [],
        scores: [],
        overallScore: 78,
        summary: '',
        sequenceAnalysis: {
          strategicScore: 8.5,
          strategicRationale: 'Well reasoned approach',
          sequenceEffectiveness: 'Optimal ordering',
          strategicInsights: 'Key insight here',
          alternativeApproaches: ['Try approach X', 'Consider Y'],
        },
      },
    });
    const html = renderStrategyEvaluation({ feedback });

    expect(html).toContain('🎮 전략 평가');
    expect(html).toContain('8.5');
    expect(html).toContain('Well reasoned approach');
    expect(html).toContain('Optimal ordering');
    expect(html).toContain('Key insight here');
    expect(html).toContain('🛤️ 대안적 접근법');
    expect(html).toContain('Try approach X');
    expect(html).toContain('Consider Y');
  });

  it('shows "평가 대기중" when strategicScore is null', () => {
    const feedback = makeBaseFeedback({
      detailedFeedback: {
        strengths: [],
        improvements: [],
        nextSteps: [],
        scores: [],
        overallScore: 78,
        summary: '',
        sequenceAnalysis: {
          strategicScore: null,
        },
      },
    });
    const html = renderStrategyEvaluation({ feedback });
    expect(html).toContain('평가 대기중');
  });

  it('omits optional subsections when their fields are absent', () => {
    const feedback = makeBaseFeedback({
      detailedFeedback: {
        strengths: [],
        improvements: [],
        nextSteps: [],
        scores: [],
        overallScore: 78,
        summary: '',
        sequenceAnalysis: { strategicScore: 7 },
      },
    });
    const html = renderStrategyEvaluation({ feedback });
    expect(html).not.toContain('순서 선택의 효과성');
    expect(html).not.toContain('전략적 통찰');
    expect(html).not.toContain('대안적 접근법');
  });

  it('omits alternatives block when alternativeApproaches is empty', () => {
    const feedback = makeBaseFeedback({
      detailedFeedback: {
        strengths: [],
        improvements: [],
        nextSteps: [],
        scores: [],
        overallScore: 78,
        summary: '',
        sequenceAnalysis: {
          strategicScore: 7,
          strategicRationale: 'Good',
          alternativeApproaches: [],
        },
      },
    });
    const html = renderStrategyEvaluation({ feedback });
    expect(html).not.toContain('대안적 접근법');
  });

  it('XSS: escapes strategicRationale, sequenceEffectiveness, strategicInsights, alternativeApproaches', () => {
    const feedback = makeBaseFeedback({
      detailedFeedback: {
        strengths: [],
        improvements: [],
        nextSteps: [],
        scores: [],
        overallScore: 78,
        summary: '',
        sequenceAnalysis: {
          strategicScore: 5,
          strategicRationale: XSS,
          sequenceEffectiveness: XSS,
          strategicInsights: XSS,
          alternativeApproaches: [XSS],
        },
      },
    });
    const html = renderStrategyEvaluation({ feedback });
    assertNoRawXss(html, 'sequenceAnalysis fields');
  });
});

describe('renderFooter', () => {
  it('happy path: renders date, truncated ID, and footer text', () => {
    const feedback = makeBaseFeedback({ createdAt: new Date('2026-01-15T10:00:00Z') });
    const html = renderFooter({ feedback, conversationId: 'abcdefgh1234' });

    expect(html).toContain('report-footer');
    expect(html).toContain('ABCDEFGH');
    expect(html).toContain('AI 기반 개인 맞춤 개발 보고서');
    expect(html).toContain('발행:');
  });

  it('truncates conversationId to 8 characters uppercased', () => {
    const html = renderFooter({
      feedback: makeBaseFeedback(),
      conversationId: 'xyz12345longerthanneeded',
    });
    expect(html).toContain('XYZ12345');
    expect(html).not.toContain('LONGERTHANNEEDED');
  });

  it('uses current date when createdAt is null', () => {
    const feedback = makeBaseFeedback({ createdAt: null });
    const html = renderFooter({ feedback, conversationId: 'abc12345' });
    const currentYear = new Date().getFullYear().toString();
    expect(html).toContain(currentYear);
  });

  it('XSS: escapes conversationId in footer', () => {
    const xssId = `${XSS}ZZZZZZZZ`;
    const html = renderFooter({ feedback: makeBaseFeedback(), conversationId: xssId });
    expect(html).not.toContain('<script>');
    expect(html).toContain(XSS_ESCAPED_LT);
  });
});
