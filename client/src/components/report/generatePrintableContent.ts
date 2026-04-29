import type { Feedback } from "@shared/schema";
import type { ComplexScenario, ScenarioPersona } from "@/lib/scenario-system";
import {
  escapeHtml,
  toTenPoint,
  getOverallGrade,
  getPersonaFullInfo,
} from "./reportUtils";
import { reportStyles } from "./reportStyles";

interface GenerateOptions {
  feedback: Feedback;
  scenario: ComplexScenario;
  persona: ScenarioPersona;
  conversationId: string;
  userName: string;
  getTranslatedDimensionName: (key: string | undefined, fallback: string) => string;
}

export function renderHeader(opts: {
  feedback: Feedback;
  scenario: ComplexScenario;
  persona: ScenarioPersona;
  userName: string;
}): string {
  const { feedback, scenario, persona, userName } = opts;
  const overallGrade = getOverallGrade(feedback.overallScore || 0);
  const personaInfo = getPersonaFullInfo(persona);
  return `
      <div class="report-header">
        <h1 class="report-title">${escapeHtml(userName)}님 맞춤 보고서</h1>
        <p class="report-header-subtitle">시나리오 : ${escapeHtml(scenario.title)}</p>
        <p class="report-header-meta">대화 상대 : ${escapeHtml(personaInfo)}</p>
        <div class="flex-end">
          <div class="report-score-box">
            <div class="report-grade">${escapeHtml(overallGrade.grade)}</div>
            <div class="report-score-value">${Number(feedback.overallScore || 0).toFixed(1)}점</div>
            <div class="report-score-label">종합 점수</div>
          </div>
        </div>
      </div>`;
}

export function renderScoreCards(opts: {
  feedback: Feedback;
  getTranslatedDimensionName: (key: string | undefined, fallback: string) => string;
}): string {
  const { feedback, getTranslatedDimensionName } = opts;
  const scores = feedback.scores || [];
  const strengths = feedback.detailedFeedback?.strengths || [];
  const improvements = feedback.detailedFeedback?.improvements || [];
  const nextSteps = feedback.detailedFeedback?.nextSteps || [];
  const conversationDuration = feedback.detailedFeedback?.conversationDuration;
  const averageResponseTime = feedback.detailedFeedback?.averageResponseTime;
  const timePerformance = feedback.detailedFeedback?.timePerformance;

  const timeBlock = conversationDuration != null ? `
        <div class="time-analysis-card">
          <h3 class="time-analysis-heading">⏱️ 대화 시간 분석</h3>
          <div class="grid-3col-time">
            <div><div class="time-value-blue">${Math.floor(conversationDuration / 60)}:${(conversationDuration % 60).toString().padStart(2, '0')}</div><div class="time-label-blue">총 대화 시간</div></div>
            ${averageResponseTime != null ? `<div><div class="time-value-green">${escapeHtml(String(averageResponseTime))}초</div><div class="time-label-green">평균 응답 시간</div></div>` : ''}
            ${timePerformance ? `<div><div class="time-rating-${timePerformance.rating === 'excellent' ? 'excellent' : timePerformance.rating === 'good' ? 'good' : timePerformance.rating === 'average' ? 'average' : 'poor'}">${timePerformance.rating === 'excellent' ? '🎯 우수' : timePerformance.rating === 'good' ? '✅ 좋음' : timePerformance.rating === 'average' ? '🔶 보통' : '⚠️ 개선필요'}</div><div class="time-feedback">${escapeHtml(timePerformance.feedback)}</div></div>` : ''}
          </div>
        </div>` : '';

  const scoreCardsBlock = `
        <div class="grid-score-cards">
          ${scores.map(score => {
            const sNum = toTenPoint(typeof score.score === 'number' ? score.score : 0, (score as any).maxScore || 10);
            const statusLabel = sNum >= 8 ? '✅ 역량 확인됨' : sNum >= 5 ? '🔶 기본 수준' : '⚠️ 집중 개선 필요';
            const statusClass = sNum >= 8 ? 'score-status-high' : sNum >= 5 ? 'score-status-mid' : 'score-status-low';
            return `<div class="score-card">
              <div class="score-card-header">
                <span class="score-name">${escapeHtml(getTranslatedDimensionName(score.category, score.name))}</span>
                <span class="score-badge">${Number(sNum).toFixed(1)}/10</span>
              </div>
              <span class="${statusClass}">${statusLabel}</span>
              <p class="score-feedback">${escapeHtml(score.feedback)}</p>
            </div>`;
          }).join('')}
        </div>`;

  const evalBlock = `
        <div class="eval-container">
          <h3 class="eval-heading">📈 종합 평가</h3>
          <div class="grid-3col-12">
            <div class="eval-card-green">
              <h4 class="eval-card-title-green">✅ 주요 강점</h4>
              ${strengths.map(s => `<div class="eval-item-green">• ${escapeHtml(s)}</div>`).join('')}
            </div>
            <div class="eval-card-orange">
              <h4 class="eval-card-title-orange">⬆️ 개선 포인트</h4>
              ${improvements.map(s => `<div class="eval-item-orange">• ${escapeHtml(s)}</div>`).join('')}
            </div>
            <div class="eval-card-blue">
              <h4 class="eval-card-title-blue">➡️ 다음 단계</h4>
              ${nextSteps.map(s => `<div class="eval-item-blue">• ${escapeHtml(s)}</div>`).join('')}
            </div>
          </div>
          ${feedback.detailedFeedback?.ranking ? `<div class="ranking-block"><p class="ranking-text">${escapeHtml(feedback.detailedFeedback.ranking)}</p></div>` : ''}
        </div>`;

  return `
      <div class="report-section">
        <h2 class="section-heading section-heading-indigo">📊 성과 분석</h2>
        ${timeBlock}
        ${scoreCardsBlock}
        ${evalBlock}
      </div>`;
}

export function renderPracticeGuides(opts: {
  feedback: Feedback;
}): string {
  const { feedback } = opts;
  const behaviorGuides = feedback.detailedFeedback?.behaviorGuides || [];
  const conversationGuides = feedback.detailedFeedback?.conversationGuides || [];

  if (behaviorGuides.length === 0 && conversationGuides.length === 0) return '';

  const behaviorBlock = behaviorGuides.length > 0 ? `
        <div class="mb-24">
          <h3 class="subsection-heading">💡 행동 개선 포인트</h3>
          ${behaviorGuides.map((guide, idx) => `
            <div class="guide-card-yellow">
              <div class="flex-center-gap">
                <span class="guide-num-badge-yellow">${idx + 1}</span>
                <h4 class="guide-title-yellow">${escapeHtml(guide.situation)}</h4>
              </div>
              <div class="guide-card-inner-grid">
                <div class="guide-action-block">
                  <p class="guide-action-label">권장 행동</p>
                  <p class="guide-action-text">${escapeHtml(guide.action)}</p>
                </div>
                ${guide.example ? `<div class="guide-example-block"><p class="guide-example-label">실제 예시</p><p class="guide-example-text">"${escapeHtml(guide.example)}"</p></div>` : ''}
              </div>
              ${guide.impact ? `<div class="guide-impact"><strong>기대 효과: </strong>${escapeHtml(guide.impact)}</div>` : ''}
            </div>
          `).join('')}
        </div>` : '';

  const conversationBlock = conversationGuides.length > 0 ? `
        <div>
          <h3 class="subsection-heading">💬 대화 스크립트 예시</h3>
          ${conversationGuides.map((guide, idx) => `
            <div class="guide-card-teal">
              <div class="flex-center-gap">
                <span class="guide-num-badge-teal">${idx + 1}</span>
                <h4 class="guide-title-teal">${escapeHtml(guide.scenario)}</h4>
              </div>
              <div class="guide-card-inner-grid">
                <div class="guide-good-block">
                  <p class="guide-good-label">✅ 이렇게 말하세요</p>
                  <p class="guide-good-text">${escapeHtml(guide.goodExample)}</p>
                </div>
                <div class="guide-bad-block">
                  <p class="guide-bad-label">❌ 이런 표현은 피하세요</p>
                  <p class="guide-bad-text">${escapeHtml(guide.badExample)}</p>
                </div>
              </div>
              ${(guide.keyPoints || []).length > 0 ? `
                <div class="guide-key-points">
                  <p class="guide-key-points-label">🔑 핵심 포인트</p>
                  <div class="flex-wrap-gap">
                    ${(guide.keyPoints || []).map((point: string) => `<span class="guide-key-point-badge">${escapeHtml(point)}</span>`).join('')}
                  </div>
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>` : '';

  return `
      <div class="report-section-break">
        <h2 class="section-heading section-heading-amber">🗂️ 실천 가이드</h2>
        ${behaviorBlock}
        ${conversationBlock}
      </div>`;
}

export function renderDevelopmentPlan(opts: {
  feedback: Feedback;
}): string {
  const { feedback } = opts;
  const developmentPlan = feedback.detailedFeedback?.developmentPlan;

  if (!developmentPlan) return '';

  const termCards = [
    { key: 'shortTerm', label: '📅 단기 목표 (1-2주)', cardClass: 'plan-card-short' },
    { key: 'mediumTerm', label: '📆 중기 목표 (1-2개월)', cardClass: 'plan-card-medium' },
    { key: 'longTerm', label: '🗓️ 장기 목표 (3-6개월)', cardClass: 'plan-card-long' },
  ].map(ps => `
            <div class="${ps.cardClass}">
              <h3 class="plan-card-title">${ps.label}</h3>
              ${((developmentPlan as any)[ps.key] || []).map((item: any) => `
                <div class="plan-item-card">
                  <h4 class="plan-card-goal">${escapeHtml(item.goal)}</h4>
                  <ul class="plan-actions-list">
                    ${(item.actions || []).map((a: string) => `<li class="plan-action-item">→ ${escapeHtml(a)}</li>`).join('')}
                  </ul>
                  ${item.measurable ? `<div class="plan-card-meas">측정지표: ${escapeHtml(item.measurable)}</div>` : ''}
                </div>
              `).join('')}
            </div>`).join('');

  const resourcesBlock = (developmentPlan.recommendedResources || []).length > 0 ? `
          <div class="resource-section">
            <h3 class="resource-heading">📚 추천 학습 자료</h3>
            <div class="resource-grid">
              ${(developmentPlan.recommendedResources || []).map((r: string) => `<div class="resource-item">📖 ${escapeHtml(r)}</div>`).join('')}
            </div>
          </div>` : '';

  return `
      <div class="report-section-break">
        <h2 class="section-heading section-heading-violet">📈 개발 계획</h2>
        <div class="grid-3col-16 mb-20">
          ${termCards}
        </div>
        ${resourcesBlock}
      </div>`;
}

export function renderStrategyEvaluation(opts: {
  feedback: Feedback;
}): string {
  const { feedback } = opts;
  const sequenceAnalysis = feedback.detailedFeedback?.sequenceAnalysis;

  if (!sequenceAnalysis) return '';

  const alternativesBlock = (sequenceAnalysis.alternativeApproaches || []).length > 0 ? `
            <div>
              <h4 class="strategy-title-green">🛤️ 대안적 접근법</h4>
              ${(sequenceAnalysis.alternativeApproaches || []).map((a: string, i: number) => `
                <div class="strategy-alt-item">
                  <span class="strategy-alt-badge">${i + 1}</span>
                  <p class="strategy-alt-text">${escapeHtml(a)}</p>
                </div>
              `).join('')}
            </div>` : '';

  return `
      <div class="report-section page-no-break">
        <h2 class="section-heading section-heading-pink">🎮 전략 평가</h2>
        <div class="strategy-panel">
          <div class="flex-between-center">
            <h3 class="strategy-score-label">전략 점수</h3>
            <span class="strategy-score-badge">
              ${escapeHtml(sequenceAnalysis.strategicScore != null ? Number(sequenceAnalysis.strategicScore).toFixed(1) : '평가 대기중')}
            </span>
          </div>
          ${sequenceAnalysis.strategicRationale ? `<p class="strategy-rationale">${escapeHtml(sequenceAnalysis.strategicRationale)}</p>` : ''}
          ${sequenceAnalysis.sequenceEffectiveness ? `<div class="strategy-subsection"><h4 class="strategy-title-blue">🎯 순서 선택의 효과성</h4><p class="strategy-text-box">${escapeHtml(sequenceAnalysis.sequenceEffectiveness)}</p></div>` : ''}
          ${sequenceAnalysis.strategicInsights ? `<div class="strategy-subsection"><h4 class="strategy-title-yellow">💡 전략적 통찰</h4><p class="strategy-insights-box">${escapeHtml(sequenceAnalysis.strategicInsights)}</p></div>` : ''}
          ${alternativesBlock}
        </div>
      </div>`;
}

export function renderFooter(opts: {
  feedback: Feedback;
  conversationId: string;
}): string {
  const { feedback, conversationId } = opts;
  const dateStr = feedback.createdAt
    ? new Date(feedback.createdAt).toLocaleDateString('ko-KR')
    : new Date().toLocaleDateString('ko-KR');
  return `
      <div class="report-footer">
        발행: ${dateStr} · 보고서 ID: ${escapeHtml(conversationId.slice(0, 8).toUpperCase())} · AI 기반 개인 맞춤 개발 보고서
      </div>`;
}

export function generatePrintableContent(opts: GenerateOptions): string {
  const { feedback, scenario, persona, conversationId, userName, getTranslatedDimensionName } = opts;

  return `
    <style>${reportStyles}</style>
    <div class="report-container">
      ${renderHeader({ feedback, scenario, persona, userName })}
      ${renderScoreCards({ feedback, getTranslatedDimensionName })}
      ${renderPracticeGuides({ feedback })}
      ${renderDevelopmentPlan({ feedback })}
      ${renderStrategyEvaluation({ feedback })}
      ${renderFooter({ feedback, conversationId })}
    </div>
  `;
}
