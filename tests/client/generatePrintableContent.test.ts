import { describe, it, expect } from 'vitest';
import { generatePrintableContent } from '../../client/src/components/report/generatePrintableContent';

const XSS = '<script>alert(1)</script>';
const XSS_ATTR = '"onload="alert(1)';
const ESCAPED_LT = '&lt;';
const ESCAPED_GT = '&gt;';
const ESCAPED_QUOT = '&quot;';

function assertEscaped(html: string, payload: string, fieldLabel: string) {
  expect(html, `${fieldLabel}: raw payload should not appear`).not.toContain(payload);
  expect(html, `${fieldLabel}: escaped < should appear`).toContain(ESCAPED_LT);
  expect(html, `${fieldLabel}: escaped > should appear`).toContain(ESCAPED_GT);
}

function makeBaseOpts(overrides: Record<string, unknown> = {}) {
  return {
    feedback: {
      overallScore: 75,
      scores: [],
      detailedFeedback: {
        strengths: [],
        improvements: [],
        nextSteps: [],
        behaviorGuides: [],
        conversationGuides: [],
      },
      createdAt: null,
    } as any,
    scenario: { title: 'Safe Title' } as any,
    persona: {} as any,
    conversationId: 'abc12345',
    userName: 'SafeUser',
    getTranslatedDimensionName: (_key: string | undefined, fallback: string) => fallback,
    ...overrides,
  };
}

describe('generatePrintableContent XSS escaping', () => {

  it('escapes XSS in userName', () => {
    const html = generatePrintableContent(makeBaseOpts({ userName: XSS }));
    assertEscaped(html, XSS, 'userName');
  });

  it('escapes double-quote XSS in userName', () => {
    const html = generatePrintableContent(makeBaseOpts({ userName: XSS_ATTR }));
    expect(html).not.toContain('"onload="');
    expect(html).toContain(ESCAPED_QUOT);
  });

  it('escapes XSS in scenario.title', () => {
    const html = generatePrintableContent(makeBaseOpts({
      scenario: { title: XSS } as any,
    }));
    assertEscaped(html, XSS, 'scenario.title');
  });

  it('escapes XSS in averageResponseTime', () => {
    const html = generatePrintableContent(makeBaseOpts({
      feedback: {
        overallScore: 75,
        scores: [],
        detailedFeedback: {
          strengths: [],
          improvements: [],
          nextSteps: [],
          behaviorGuides: [],
          conversationGuides: [],
          conversationDuration: 120,
          averageResponseTime: '<img src=x onerror=alert(1)>' as any,
        },
        createdAt: null,
      } as any,
    }));
    expect(html).not.toContain('<img src=x');
    expect(html).toContain(ESCAPED_LT);
  });

  it('escapes XSS in timePerformance.feedback', () => {
    const html = generatePrintableContent(makeBaseOpts({
      feedback: {
        overallScore: 75,
        scores: [],
        detailedFeedback: {
          strengths: [],
          improvements: [],
          nextSteps: [],
          behaviorGuides: [],
          conversationGuides: [],
          conversationDuration: 60,
          timePerformance: {
            rating: 'excellent',
            feedback: XSS,
          },
        },
        createdAt: null,
      } as any,
    }));
    assertEscaped(html, XSS, 'timePerformance.feedback');
  });

  it('escapes XSS in score.feedback', () => {
    const html = generatePrintableContent(makeBaseOpts({
      feedback: {
        overallScore: 75,
        scores: [{ name: 'Communication', category: 'comm', score: 7, feedback: XSS }],
        detailedFeedback: {
          strengths: [],
          improvements: [],
          nextSteps: [],
          behaviorGuides: [],
          conversationGuides: [],
        },
        createdAt: null,
      } as any,
    }));
    assertEscaped(html, XSS, 'score.feedback');
  });

  it('escapes XSS in score.name (dimension name)', () => {
    const html = generatePrintableContent(makeBaseOpts({
      feedback: {
        overallScore: 75,
        scores: [{ name: XSS, category: undefined, score: 7, feedback: 'ok' }],
        detailedFeedback: {
          strengths: [],
          improvements: [],
          nextSteps: [],
          behaviorGuides: [],
          conversationGuides: [],
        },
        createdAt: null,
      } as any,
      getTranslatedDimensionName: (_key: string | undefined, fallback: string) => fallback,
    }));
    assertEscaped(html, XSS, 'score.name');
  });

  it('escapes XSS in strengths', () => {
    const html = generatePrintableContent(makeBaseOpts({
      feedback: {
        overallScore: 75,
        scores: [],
        detailedFeedback: {
          strengths: [XSS],
          improvements: [],
          nextSteps: [],
          behaviorGuides: [],
          conversationGuides: [],
        },
        createdAt: null,
      } as any,
    }));
    assertEscaped(html, XSS, 'strengths');
  });

  it('escapes XSS in improvements', () => {
    const html = generatePrintableContent(makeBaseOpts({
      feedback: {
        overallScore: 75,
        scores: [],
        detailedFeedback: {
          strengths: [],
          improvements: [XSS],
          nextSteps: [],
          behaviorGuides: [],
          conversationGuides: [],
        },
        createdAt: null,
      } as any,
    }));
    assertEscaped(html, XSS, 'improvements');
  });

  it('escapes XSS in nextSteps', () => {
    const html = generatePrintableContent(makeBaseOpts({
      feedback: {
        overallScore: 75,
        scores: [],
        detailedFeedback: {
          strengths: [],
          improvements: [],
          nextSteps: [XSS],
          behaviorGuides: [],
          conversationGuides: [],
        },
        createdAt: null,
      } as any,
    }));
    assertEscaped(html, XSS, 'nextSteps');
  });

  it('escapes XSS in ranking', () => {
    const html = generatePrintableContent(makeBaseOpts({
      feedback: {
        overallScore: 75,
        scores: [],
        detailedFeedback: {
          strengths: [],
          improvements: [],
          nextSteps: [],
          behaviorGuides: [],
          conversationGuides: [],
          ranking: XSS,
        },
        createdAt: null,
      } as any,
    }));
    assertEscaped(html, XSS, 'ranking');
  });

  it('escapes XSS in behaviorGuide.situation, action, example, impact', () => {
    const html = generatePrintableContent(makeBaseOpts({
      feedback: {
        overallScore: 75,
        scores: [],
        detailedFeedback: {
          strengths: [],
          improvements: [],
          nextSteps: [],
          behaviorGuides: [{
            situation: `${XSS}-situation`,
            action: `${XSS}-action`,
            example: `${XSS}-example`,
            impact: `${XSS}-impact`,
          }],
          conversationGuides: [],
        },
        createdAt: null,
      } as any,
    }));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('</script>');
    expect(html).toContain(ESCAPED_LT);
    expect(html).toContain(ESCAPED_GT);
  });

  it('escapes XSS in conversationGuide.scenario, goodExample, badExample, keyPoints', () => {
    const html = generatePrintableContent(makeBaseOpts({
      feedback: {
        overallScore: 75,
        scores: [],
        detailedFeedback: {
          strengths: [],
          improvements: [],
          nextSteps: [],
          behaviorGuides: [],
          conversationGuides: [{
            scenario: `${XSS}-scenario`,
            goodExample: `${XSS}-good`,
            badExample: `${XSS}-bad`,
            keyPoints: [`${XSS}-key`],
          }],
        },
        createdAt: null,
      } as any,
    }));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('</script>');
    expect(html).toContain(ESCAPED_LT);
    expect(html).toContain(ESCAPED_GT);
  });

  it('escapes XSS in developmentPlan goal, actions, measurable, recommendedResources', () => {
    const html = generatePrintableContent(makeBaseOpts({
      feedback: {
        overallScore: 75,
        scores: [],
        detailedFeedback: {
          strengths: [],
          improvements: [],
          nextSteps: [],
          behaviorGuides: [],
          conversationGuides: [],
          developmentPlan: {
            shortTerm: [{
              goal: `${XSS}-goal`,
              actions: [`${XSS}-action`],
              measurable: `${XSS}-measurable`,
            }],
            mediumTerm: [],
            longTerm: [],
            recommendedResources: [`${XSS}-resource`],
          },
        },
        createdAt: null,
      } as any,
    }));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('</script>');
    expect(html).toContain(ESCAPED_LT);
    expect(html).toContain(ESCAPED_GT);
  });

  it('escapes XSS in sequenceAnalysis fields', () => {
    const html = generatePrintableContent(makeBaseOpts({
      feedback: {
        overallScore: 75,
        scores: [],
        detailedFeedback: {
          strengths: [],
          improvements: [],
          nextSteps: [],
          behaviorGuides: [],
          conversationGuides: [],
          sequenceAnalysis: {
            strategicScore: 8,
            strategicRationale: `${XSS}-rationale`,
            sequenceEffectiveness: `${XSS}-effectiveness`,
            strategicInsights: `${XSS}-insights`,
            alternativeApproaches: [`${XSS}-approach`],
          },
        },
        createdAt: null,
      } as any,
    }));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('</script>');
    expect(html).toContain(ESCAPED_LT);
    expect(html).toContain(ESCAPED_GT);
  });

  it('escapes XSS in conversationId shown in footer', () => {
    const xssId = `${XSS}ZZZZZZZZ`;
    const html = generatePrintableContent(makeBaseOpts({ conversationId: xssId }));
    expect(html).not.toContain('<script>');
    expect(html).toContain(ESCAPED_LT);
  });

  it('handles null/undefined values without throwing', () => {
    const html = generatePrintableContent(makeBaseOpts({ userName: undefined as any }));
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });
});
