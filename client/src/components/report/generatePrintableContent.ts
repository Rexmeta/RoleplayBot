import type { Feedback } from "@shared/schema";
import type { ComplexScenario, ScenarioPersona } from "@/lib/scenario-system";
import {
  escapeHtml,
  toTenPoint,
  getOverallGrade,
  getPersonaFullInfo,
} from "./reportUtils";

interface GenerateOptions {
  feedback: Feedback;
  scenario: ComplexScenario;
  persona: ScenarioPersona;
  conversationId: string;
  userName: string;
  getTranslatedDimensionName: (key: string | undefined, fallback: string) => string;
}

export function generatePrintableContent(opts: GenerateOptions): string {
  const {
    feedback,
    scenario,
    conversationId,
    userName,
    getTranslatedDimensionName,
  } = opts;

  const overallGrade = getOverallGrade(feedback.overallScore || 0);
  const scores = feedback.scores || [];
  const strengths = feedback.detailedFeedback?.strengths || [];
  const improvements = feedback.detailedFeedback?.improvements || [];
  const nextSteps = feedback.detailedFeedback?.nextSteps || [];
  const behaviorGuides = feedback.detailedFeedback?.behaviorGuides || [];
  const conversationGuides = feedback.detailedFeedback?.conversationGuides || [];
  const developmentPlan = feedback.detailedFeedback?.developmentPlan;
  const sequenceAnalysis = feedback.detailedFeedback?.sequenceAnalysis;
  const conversationDuration = feedback.detailedFeedback?.conversationDuration;
  const averageResponseTime = feedback.detailedFeedback?.averageResponseTime;
  const timePerformance = feedback.detailedFeedback?.timePerformance;

  const personaInfo = getPersonaFullInfo(opts.persona);

  return `
    <style>
      /* ── Layout ── */
      .report-container { font-family: 'Noto Sans KR', sans-serif; max-width: 800px; margin: 0 auto; }
      .report-section { margin-bottom: 32px; }
      .report-section-break { margin-bottom: 32px; page-break-before: always; }
      .grid-2col { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 10px; }
      .grid-3col-12 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
      .grid-3col-16 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
      .grid-3col-time { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; text-align: center; }
      .grid-score-cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin-bottom: 24px; }
      .flex-between { display: flex; justify-content: space-between; }
      .flex-end { display: flex; justify-content: flex-end; margin-top: 16px; }
      .flex-between-center { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
      .flex-center-gap { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
      .flex-wrap-gap { display: flex; flex-wrap: wrap; gap: 6px; }

      /* ── Header ── */
      .report-header { background: linear-gradient(135deg, #4f46e5, #6366f1); color: white; padding: 24px; border-radius: 12px; margin-bottom: 24px; }
      .report-title { font-size: 24px; font-weight: bold; margin-bottom: 8px; }
      .report-header-subtitle { opacity: 0.9; margin-bottom: 4px; }
      .report-header-meta { font-size: 14px; opacity: 0.8; margin-bottom: 12px; }
      .report-score-box { background: white; padding: 16px 24px; border-radius: 8px; text-align: center; }
      .report-grade { font-size: 28px; font-weight: bold; color: #16a34a; }
      .report-score-value { font-size: 14px; color: #4b5563; }
      .report-score-label { font-size: 11px; color: #6b7280; }

      /* ── Section headings ── */
      .section-heading { font-size: 20px; font-weight: bold; color: #1f2937; padding-bottom: 8px; margin-bottom: 16px; border-bottom-width: 2px; border-bottom-style: solid; }
      .section-heading-indigo { border-bottom-color: #4f46e5; }
      .section-heading-amber { border-bottom-color: #f59e0b; margin-bottom: 20px; }
      .section-heading-violet { border-bottom-color: #8b5cf6; }
      .section-heading-pink { border-bottom-color: #ec4899; }

      /* ── Time analysis ── */
      .time-analysis-card { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
      .time-analysis-heading { font-size: 15px; font-weight: 600; color: #0369a1; margin-bottom: 10px; }
      .time-value-blue { font-size: 20px; font-weight: bold; color: #0284c7; }
      .time-label-blue { font-size: 13px; color: #0369a1; }
      .time-value-green { font-size: 20px; font-weight: bold; color: #16a34a; }
      .time-label-green { font-size: 13px; color: #15803d; }
      .time-feedback { font-size: 11px; color: #9a3412; }

      /* ── Score cards ── */
      .score-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; }
      .score-card-header { display: flex; justify-content: space-between; margin-bottom: 6px; }
      .score-name { font-size: 13px; font-weight: 600; color: #374151; }
      .score-badge { background: #dbeafe; color: #1e40af; padding: 2px 7px; border-radius: 4px; font-size: 12px; font-weight: 600; }
      .score-feedback { font-size: 12px; color: #4b5563; line-height: 1.5; margin: 6px 0 0 0; }

      /* ── Overall evaluation ── */
      .eval-container { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; }
      .eval-heading { font-size: 16px; font-weight: 600; margin-bottom: 12px; }
      .eval-card-green { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px; }
      .eval-card-orange { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 14px; }
      .eval-card-blue { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 14px; }
      .eval-card-title-green { font-size: 13px; font-weight: 700; color: #166534; margin-bottom: 8px; }
      .eval-card-title-orange { font-size: 13px; font-weight: 700; color: #9a3412; margin-bottom: 8px; }
      .eval-card-title-blue { font-size: 13px; font-weight: 700; color: #1e40af; margin-bottom: 8px; }
      .eval-item-green { font-size: 12px; color: #166534; margin-bottom: 4px; }
      .eval-item-orange { font-size: 12px; color: #7c2d12; margin-bottom: 4px; }
      .eval-item-blue { font-size: 12px; color: #1e3a8a; margin-bottom: 4px; }
      .ranking-block { margin-top: 12px; padding: 12px; background: #f0f4ff; border-left: 4px solid #4f46e5; border-radius: 0 6px 6px 0; }
      .ranking-text { font-size: 13px; color: #312e81; line-height: 1.6; margin: 0; }

      /* ── Practice guide shared ── */
      .subsection-heading { font-size: 15px; font-weight: 700; color: #1f2937; margin-bottom: 14px; }
      .guide-card-inner-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 10px; }

      /* ── Behavior guides ── */
      .guide-card-yellow { background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 14px; margin-bottom: 12px; page-break-inside: avoid; }
      .guide-num-badge-yellow { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; background: #f59e0b; color: white; border-radius: 50%; font-size: 11px; font-weight: 700; flex-shrink: 0; }
      .guide-title-yellow { font-size: 14px; font-weight: 600; color: #92400e; margin: 0; }
      .guide-action-block { background: #eff6ff; border: 1px solid #bfdbfe; padding: 10px; border-radius: 6px; }
      .guide-action-label { font-size: 11px; font-weight: 700; color: #4f46e5; margin: 0 0 4px 0; }
      .guide-action-text { font-size: 12px; color: #374151; margin: 0; line-height: 1.5; }
      .guide-example-block { background: #f0fdf4; border: 1px solid #bbf7d0; padding: 10px; border-radius: 6px; }
      .guide-example-label { font-size: 11px; font-weight: 700; color: #16a34a; margin: 0 0 4px 0; }
      .guide-example-text { font-size: 12px; color: #166534; margin: 0; line-height: 1.5; font-style: italic; }
      .guide-impact { border-top: 1px solid #fde68a; padding-top: 8px; font-size: 12px; color: #374151; }

      /* ── Conversation guides ── */
      .guide-card-teal { background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 8px; padding: 14px; margin-bottom: 12px; page-break-inside: avoid; }
      .guide-num-badge-teal { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; background: #06b6d4; color: white; border-radius: 50%; font-size: 11px; font-weight: 700; flex-shrink: 0; }
      .guide-title-teal { font-size: 14px; font-weight: 600; color: #0f766e; margin: 0; }
      .guide-good-block { background: #dcfce7; border: 1px solid #86efac; padding: 10px; border-radius: 6px; }
      .guide-good-label { font-size: 11px; font-weight: 700; color: #16a34a; margin: 0 0 4px 0; }
      .guide-good-text { font-size: 12px; color: #166534; margin: 0; line-height: 1.5; }
      .guide-bad-block { background: #fef2f2; border: 1px solid #fecaca; padding: 10px; border-radius: 6px; }
      .guide-bad-label { font-size: 11px; font-weight: 700; color: #dc2626; margin: 0 0 4px 0; }
      .guide-bad-text { font-size: 12px; color: #991b1b; margin: 0; line-height: 1.5; }
      .guide-key-points { border-top: 1px solid #99f6e4; padding-top: 8px; }
      .guide-key-points-label { font-size: 11px; font-weight: 700; color: #6b7280; margin: 0 0 6px 0; }
      .guide-key-point-badge { font-size: 11px; background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; padding: 3px 10px; border-radius: 20px; }

      /* ── Development plan ── */
      .plan-card-short { background: #f0fdf4; border-left: 4px solid #22c55e; padding: 16px; border-radius: 0 8px 8px 0; }
      .plan-card-short .plan-card-title { color: #16a34a; }
      .plan-card-short .plan-card-goal { color: #16a34a; }
      .plan-card-short .plan-card-meas { background: #dcfce7; color: #166534; }
      .plan-card-medium { background: #eff6ff; border-left: 4px solid #3b82f6; padding: 16px; border-radius: 0 8px 8px 0; }
      .plan-card-medium .plan-card-title { color: #2563eb; }
      .plan-card-medium .plan-card-goal { color: #2563eb; }
      .plan-card-medium .plan-card-meas { background: #dbeafe; color: #1e40af; }
      .plan-card-long { background: #faf5ff; border-left: 4px solid #a855f7; padding: 16px; border-radius: 0 8px 8px 0; }
      .plan-card-long .plan-card-title { color: #7c3aed; }
      .plan-card-long .plan-card-goal { color: #7c3aed; }
      .plan-card-long .plan-card-meas { background: #f3e8ff; color: #6b21a8; }
      .plan-card-title { font-size: 15px; font-weight: 600; margin-bottom: 12px; }
      .plan-item-card { background: white; padding: 12px; border-radius: 4px; margin-bottom: 8px; }
      .plan-card-goal { font-size: 13px; font-weight: 600; margin-bottom: 8px; }
      .plan-actions-list { list-style: none; padding: 0; margin: 0 0 8px 0; }
      .plan-action-item { font-size: 12px; color: #4b5563; }
      .plan-card-meas { font-size: 11px; padding: 4px 8px; border-radius: 4px; }
      .resource-section { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
      .resource-heading { font-size: 15px; font-weight: 600; color: #374151; margin-bottom: 12px; }
      .resource-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
      .resource-item { background: white; padding: 8px 12px; border-radius: 4px; font-size: 13px; color: #4b5563; }

      /* ── Strategy evaluation ── */
      .strategy-panel { background: #fdf4ff; border-left: 4px solid #a855f7; padding: 20px; border-radius: 0 8px 8px 0; }
      .strategy-score-label { font-size: 16px; font-weight: 600; color: #7c3aed; }
      .strategy-score-badge { background: #e9d5ff; color: #7c3aed; padding: 8px 16px; border-radius: 8px; font-size: 18px; font-weight: bold; }
      .strategy-rationale { font-size: 14px; color: #6b21a8; margin-bottom: 16px; }
      .strategy-subsection { margin-bottom: 16px; }
      .strategy-title-blue { font-size: 14px; font-weight: 600; color: #2563eb; margin-bottom: 8px; }
      .strategy-text-box { font-size: 13px; color: #374151; background: white; padding: 12px; border-radius: 4px; }
      .strategy-title-yellow { font-size: 14px; font-weight: 600; color: #eab308; margin-bottom: 8px; }
      .strategy-insights-box { font-size: 13px; color: #374151; background: #fef9c3; padding: 12px; border-radius: 4px; border-left: 4px solid #eab308; }
      .strategy-title-green { font-size: 14px; font-weight: 600; color: #16a34a; margin-bottom: 8px; }
      .strategy-alt-item { display: flex; align-items: flex-start; gap: 8px; background: #dcfce7; padding: 12px; border-radius: 4px; margin-bottom: 8px; }
      .strategy-alt-badge { background: #22c55e; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px; }
      .strategy-alt-text { font-size: 13px; color: #166534; margin: 0; }

      /* ── Score status badges ── */
      .score-status-high { color: #166534; background: #dcfce7; border-radius: 20px; padding: 1px 8px; font-size: 10px; font-weight: 600; }
      .score-status-mid  { color: #9a3412; background: #ffedd5; border-radius: 20px; padding: 1px 8px; font-size: 10px; font-weight: 600; }
      .score-status-low  { color: #991b1b; background: #fee2e2; border-radius: 20px; padding: 1px 8px; font-size: 10px; font-weight: 600; }

      /* ── Time rating badges ── */
      .time-rating-excellent { font-size: 16px; font-weight: 600; color: #16a34a; }
      .time-rating-good      { font-size: 16px; font-weight: 600; color: #2563eb; }
      .time-rating-average   { font-size: 16px; font-weight: 600; color: #d97706; }
      .time-rating-poor      { font-size: 16px; font-weight: 600; color: #dc2626; }

      /* ── Footer ── */
      .report-footer { text-align: center; padding-top: 20px; border-top: 1px solid #e2e8f0; color: #9ca3af; font-size: 12px; }

      /* ── Utility spacing ── */
      .mb-24 { margin-bottom: 24px; }
      .mb-20 { margin-bottom: 20px; }
      .page-no-break { page-break-inside: avoid; }
    </style>
    <div class="report-container">

      <!-- 헤더 -->
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
      </div>

      <!-- 1. 성과 분석 -->
      <div class="report-section">
        <h2 class="section-heading section-heading-indigo">📊 성과 분석</h2>

        ${conversationDuration != null ? `
        <div class="time-analysis-card">
          <h3 class="time-analysis-heading">⏱️ 대화 시간 분석</h3>
          <div class="grid-3col-time">
            <div><div class="time-value-blue">${Math.floor(conversationDuration / 60)}:${(conversationDuration % 60).toString().padStart(2, '0')}</div><div class="time-label-blue">총 대화 시간</div></div>
            ${averageResponseTime != null ? `<div><div class="time-value-green">${escapeHtml(String(averageResponseTime))}초</div><div class="time-label-green">평균 응답 시간</div></div>` : ''}
            ${timePerformance ? `<div><div class="time-rating-${timePerformance.rating === 'excellent' ? 'excellent' : timePerformance.rating === 'good' ? 'good' : timePerformance.rating === 'average' ? 'average' : 'poor'}">${timePerformance.rating === 'excellent' ? '🎯 우수' : timePerformance.rating === 'good' ? '✅ 좋음' : timePerformance.rating === 'average' ? '🔶 보통' : '⚠️ 개선필요'}</div><div class="time-feedback">${escapeHtml(timePerformance.feedback)}</div></div>` : ''}
          </div>
        </div>` : ''}

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
        </div>

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
        </div>
      </div>

      <!-- 2. 실천 가이드 -->
      ${(behaviorGuides.length > 0 || conversationGuides.length > 0) ? `
      <div class="report-section-break">
        <h2 class="section-heading section-heading-amber">🗂️ 실천 가이드</h2>

        ${behaviorGuides.length > 0 ? `
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
        </div>` : ''}

        ${conversationGuides.length > 0 ? `
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
        </div>` : ''}
      </div>` : ''}

      <!-- 3. 개발 계획 -->
      ${developmentPlan ? `
      <div class="report-section-break">
        <h2 class="section-heading section-heading-violet">📈 개발 계획</h2>
        <div class="grid-3col-16 mb-20">
          ${[
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
            </div>
          `).join('')}
        </div>
        ${(developmentPlan.recommendedResources || []).length > 0 ? `
          <div class="resource-section">
            <h3 class="resource-heading">📚 추천 학습 자료</h3>
            <div class="resource-grid">
              ${(developmentPlan.recommendedResources || []).map((r: string) => `<div class="resource-item">📖 ${escapeHtml(r)}</div>`).join('')}
            </div>
          </div>
        ` : ''}
      </div>` : ''}

      <!-- 4. 전략 평가 -->
      ${sequenceAnalysis ? `
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
          ${(sequenceAnalysis.alternativeApproaches || []).length > 0 ? `
            <div>
              <h4 class="strategy-title-green">🛤️ 대안적 접근법</h4>
              ${(sequenceAnalysis.alternativeApproaches || []).map((a: string, i: number) => `
                <div class="strategy-alt-item">
                  <span class="strategy-alt-badge">${i + 1}</span>
                  <p class="strategy-alt-text">${escapeHtml(a)}</p>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      </div>` : ''}

      <!-- 푸터 -->
      <div class="report-footer">
        발행: ${feedback.createdAt ? new Date(feedback.createdAt).toLocaleDateString('ko-KR') : new Date().toLocaleDateString('ko-KR')} · 보고서 ID: ${escapeHtml(conversationId.slice(0, 8).toUpperCase())} · AI 기반 개인 맞춤 개발 보고서
      </div>
    </div>
  `;
}
