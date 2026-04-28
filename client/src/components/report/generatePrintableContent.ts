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
    </style>
    <div style="font-family: 'Noto Sans KR', sans-serif; max-width: 800px; margin: 0 auto;">

      <!-- 헤더 -->
      <div style="background: linear-gradient(135deg, #4f46e5, #6366f1); color: white; padding: 24px; border-radius: 12px; margin-bottom: 24px;">
        <h1 style="font-size: 24px; font-weight: bold; margin-bottom: 8px;">${escapeHtml(userName)}님 맞춤 보고서</h1>
        <p style="opacity: 0.9; margin-bottom: 4px;">시나리오 : ${escapeHtml(scenario.title)}</p>
        <p style="font-size: 14px; opacity: 0.8; margin-bottom: 12px;">대화 상대 : ${escapeHtml(personaInfo)}</p>
        <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
          <div style="background: white; padding: 16px 24px; border-radius: 8px; text-align: center;">
            <div style="font-size: 28px; font-weight: bold; color: #16a34a;">${escapeHtml(overallGrade.grade)}</div>
            <div style="font-size: 14px; color: #4b5563;">${Number(feedback.overallScore || 0).toFixed(1)}점</div>
            <div style="font-size: 11px; color: #6b7280;">종합 점수</div>
          </div>
        </div>
      </div>

      <!-- 1. 성과 분석 -->
      <div style="margin-bottom: 32px;">
        <h2 style="font-size: 20px; font-weight: bold; color: #1f2937; border-bottom: 2px solid #4f46e5; padding-bottom: 8px; margin-bottom: 16px;">📊 성과 분석</h2>

        ${conversationDuration != null ? `
        <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
          <h3 style="font-size: 15px; font-weight: 600; color: #0369a1; margin-bottom: 10px;">⏱️ 대화 시간 분석</h3>
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; text-align: center;">
            <div><div style="font-size: 20px; font-weight: bold; color: #0284c7;">${Math.floor(conversationDuration / 60)}:${(conversationDuration % 60).toString().padStart(2, '0')}</div><div style="font-size: 13px; color: #0369a1;">총 대화 시간</div></div>
            ${averageResponseTime != null ? `<div><div style="font-size: 20px; font-weight: bold; color: #16a34a;">${escapeHtml(String(averageResponseTime))}초</div><div style="font-size: 13px; color: #15803d;">평균 응답 시간</div></div>` : ''}
            ${timePerformance ? `<div><div style="font-size: 16px; font-weight: 600; color: ${timePerformance.rating === 'excellent' ? '#16a34a' : timePerformance.rating === 'good' ? '#2563eb' : timePerformance.rating === 'average' ? '#d97706' : '#dc2626'};">${timePerformance.rating === 'excellent' ? '🎯 우수' : timePerformance.rating === 'good' ? '✅ 좋음' : timePerformance.rating === 'average' ? '🔶 보통' : '⚠️ 개선필요'}</div><div style="font-size: 11px; color: #9a3412;">${escapeHtml(timePerformance.feedback)}</div></div>` : ''}
          </div>
        </div>` : ''}

        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin-bottom: 24px;">
          ${scores.map(score => {
            const sNum = toTenPoint(typeof score.score === 'number' ? score.score : 0, (score as any).maxScore || 10);
            const statusLabel = sNum >= 8 ? '✅ 역량 확인됨' : sNum >= 5 ? '🔶 기본 수준' : '⚠️ 집중 개선 필요';
            const statusBg = sNum >= 8 ? '#dcfce7' : sNum >= 5 ? '#ffedd5' : '#fee2e2';
            const statusColor = sNum >= 8 ? '#166534' : sNum >= 5 ? '#9a3412' : '#991b1b';
            return `<div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                <span style="font-size: 13px; font-weight: 600; color: #374151;">${escapeHtml(getTranslatedDimensionName(score.category, score.name))}</span>
                <span style="background: #dbeafe; color: #1e40af; padding: 2px 7px; border-radius: 4px; font-size: 12px; font-weight: 600;">${Number(sNum).toFixed(1)}/10</span>
              </div>
              <span style="font-size: 10px; font-weight: 600; color: ${escapeHtml(statusColor)}; background: ${escapeHtml(statusBg)}; border-radius: 20px; padding: 1px 8px;">${statusLabel}</span>
              <p style="font-size: 12px; color: #4b5563; line-height: 1.5; margin: 6px 0 0 0;">${escapeHtml(score.feedback)}</p>
            </div>`;
          }).join('')}
        </div>

        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px;">
          <h3 style="font-size: 16px; font-weight: 600; margin-bottom: 12px;">📈 종합 평가</h3>
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;">
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px;">
              <h4 style="font-size: 13px; font-weight: 700; color: #166534; margin-bottom: 8px;">✅ 주요 강점</h4>
              ${strengths.map(s => `<div style="font-size: 12px; color: #166534; margin-bottom: 4px;">• ${escapeHtml(s)}</div>`).join('')}
            </div>
            <div style="background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 14px;">
              <h4 style="font-size: 13px; font-weight: 700; color: #9a3412; margin-bottom: 8px;">⬆️ 개선 포인트</h4>
              ${improvements.map(s => `<div style="font-size: 12px; color: #7c2d12; margin-bottom: 4px;">• ${escapeHtml(s)}</div>`).join('')}
            </div>
            <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 14px;">
              <h4 style="font-size: 13px; font-weight: 700; color: #1e40af; margin-bottom: 8px;">➡️ 다음 단계</h4>
              ${nextSteps.map(s => `<div style="font-size: 12px; color: #1e3a8a; margin-bottom: 4px;">• ${escapeHtml(s)}</div>`).join('')}
            </div>
          </div>
          ${feedback.detailedFeedback?.ranking ? `<div style="margin-top: 12px; padding: 12px; background: #f0f4ff; border-left: 4px solid #4f46e5; border-radius: 0 6px 6px 0;"><p style="font-size: 13px; color: #312e81; line-height: 1.6; margin: 0;">${escapeHtml(feedback.detailedFeedback.ranking)}</p></div>` : ''}
        </div>
      </div>

      <!-- 2. 실천 가이드 -->
      ${(behaviorGuides.length > 0 || conversationGuides.length > 0) ? `
      <div style="margin-bottom: 32px; page-break-before: always;">
        <h2 style="font-size: 20px; font-weight: bold; color: #1f2937; border-bottom: 2px solid #f59e0b; padding-bottom: 8px; margin-bottom: 20px;">🗂️ 실천 가이드</h2>

        ${behaviorGuides.length > 0 ? `
        <div style="margin-bottom: 24px;">
          <h3 style="font-size: 15px; font-weight: 700; color: #1f2937; margin-bottom: 14px;">💡 행동 개선 포인트</h3>
          ${behaviorGuides.map((guide, idx) => `
            <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 14px; margin-bottom: 12px; page-break-inside: avoid;">
              <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                <span style="display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; background: #f59e0b; color: white; border-radius: 50%; font-size: 11px; font-weight: 700; flex-shrink: 0;">${idx + 1}</span>
                <h4 style="font-size: 14px; font-weight: 600; color: #92400e; margin: 0;">${escapeHtml(guide.situation)}</h4>
              </div>
              <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 10px;">
                <div style="background: #eff6ff; border: 1px solid #bfdbfe; padding: 10px; border-radius: 6px;">
                  <p style="font-size: 11px; font-weight: 700; color: #4f46e5; margin: 0 0 4px 0;">권장 행동</p>
                  <p style="font-size: 12px; color: #374151; margin: 0; line-height: 1.5;">${escapeHtml(guide.action)}</p>
                </div>
                ${guide.example ? `<div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 10px; border-radius: 6px;"><p style="font-size: 11px; font-weight: 700; color: #16a34a; margin: 0 0 4px 0;">실제 예시</p><p style="font-size: 12px; color: #166534; margin: 0; line-height: 1.5; font-style: italic;">"${escapeHtml(guide.example)}"</p></div>` : ''}
              </div>
              ${guide.impact ? `<div style="border-top: 1px solid #fde68a; padding-top: 8px; font-size: 12px; color: #374151;"><strong>기대 효과: </strong>${escapeHtml(guide.impact)}</div>` : ''}
            </div>
          `).join('')}
        </div>` : ''}

        ${conversationGuides.length > 0 ? `
        <div>
          <h3 style="font-size: 15px; font-weight: 700; color: #1f2937; margin-bottom: 14px;">💬 대화 스크립트 예시</h3>
          ${conversationGuides.map((guide, idx) => `
            <div style="background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 8px; padding: 14px; margin-bottom: 12px; page-break-inside: avoid;">
              <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                <span style="display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; background: #06b6d4; color: white; border-radius: 50%; font-size: 11px; font-weight: 700; flex-shrink: 0;">${idx + 1}</span>
                <h4 style="font-size: 14px; font-weight: 600; color: #0f766e; margin: 0;">${escapeHtml(guide.scenario)}</h4>
              </div>
              <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 10px;">
                <div style="background: #dcfce7; border: 1px solid #86efac; padding: 10px; border-radius: 6px;">
                  <p style="font-size: 11px; font-weight: 700; color: #16a34a; margin: 0 0 4px 0;">✅ 이렇게 말하세요</p>
                  <p style="font-size: 12px; color: #166534; margin: 0; line-height: 1.5;">${escapeHtml(guide.goodExample)}</p>
                </div>
                <div style="background: #fef2f2; border: 1px solid #fecaca; padding: 10px; border-radius: 6px;">
                  <p style="font-size: 11px; font-weight: 700; color: #dc2626; margin: 0 0 4px 0;">❌ 이런 표현은 피하세요</p>
                  <p style="font-size: 12px; color: #991b1b; margin: 0; line-height: 1.5;">${escapeHtml(guide.badExample)}</p>
                </div>
              </div>
              ${(guide.keyPoints || []).length > 0 ? `
                <div style="border-top: 1px solid #99f6e4; padding-top: 8px;">
                  <p style="font-size: 11px; font-weight: 700; color: #6b7280; margin: 0 0 6px 0;">🔑 핵심 포인트</p>
                  <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                    ${(guide.keyPoints || []).map((point: string) => `<span style="font-size: 11px; background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; padding: 3px 10px; border-radius: 20px;">${escapeHtml(point)}</span>`).join('')}
                  </div>
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>` : ''}
      </div>` : ''}

      <!-- 3. 개발 계획 -->
      ${developmentPlan ? `
      <div style="margin-bottom: 32px; page-break-before: always;">
        <h2 style="font-size: 20px; font-weight: bold; color: #1f2937; border-bottom: 2px solid #8b5cf6; padding-bottom: 8px; margin-bottom: 16px;">📈 개발 계획</h2>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 20px;">
          ${[
            { key: 'shortTerm', label: '📅 단기 목표 (1-2주)', cardClass: 'plan-card-short' },
            { key: 'mediumTerm', label: '📆 중기 목표 (1-2개월)', cardClass: 'plan-card-medium' },
            { key: 'longTerm', label: '🗓️ 장기 목표 (3-6개월)', cardClass: 'plan-card-long' },
          ].map(ps => `
            <div class="${ps.cardClass}">
              <h3 class="plan-card-title" style="font-size: 15px; font-weight: 600; margin-bottom: 12px;">${ps.label}</h3>
              ${((developmentPlan as any)[ps.key] || []).map((item: any) => `
                <div style="background: white; padding: 12px; border-radius: 4px; margin-bottom: 8px;">
                  <h4 class="plan-card-goal" style="font-size: 13px; font-weight: 600; margin-bottom: 8px;">${escapeHtml(item.goal)}</h4>
                  <ul style="list-style: none; padding: 0; margin: 0 0 8px 0;">
                    ${(item.actions || []).map((a: string) => `<li style="font-size: 12px; color: #4b5563;">→ ${escapeHtml(a)}</li>`).join('')}
                  </ul>
                  ${item.measurable ? `<div class="plan-card-meas" style="font-size: 11px; padding: 4px 8px; border-radius: 4px;">측정지표: ${escapeHtml(item.measurable)}</div>` : ''}
                </div>
              `).join('')}
            </div>
          `).join('')}
        </div>
        ${(developmentPlan.recommendedResources || []).length > 0 ? `
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px;">
            <h3 style="font-size: 15px; font-weight: 600; color: #374151; margin-bottom: 12px;">📚 추천 학습 자료</h3>
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">
              ${(developmentPlan.recommendedResources || []).map((r: string) => `<div style="background: white; padding: 8px 12px; border-radius: 4px; font-size: 13px; color: #4b5563;">📖 ${escapeHtml(r)}</div>`).join('')}
            </div>
          </div>
        ` : ''}
      </div>` : ''}

      <!-- 4. 전략 평가 -->
      ${sequenceAnalysis ? `
      <div style="margin-bottom: 32px; page-break-inside: avoid;">
        <h2 style="font-size: 20px; font-weight: bold; color: #1f2937; border-bottom: 2px solid #ec4899; padding-bottom: 8px; margin-bottom: 16px;">🎮 전략 평가</h2>
        <div style="background: #fdf4ff; border-left: 4px solid #a855f7; padding: 20px; border-radius: 0 8px 8px 0;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <h3 style="font-size: 16px; font-weight: 600; color: #7c3aed;">전략 점수</h3>
            <span style="background: #e9d5ff; color: #7c3aed; padding: 8px 16px; border-radius: 8px; font-size: 18px; font-weight: bold;">
              ${escapeHtml(sequenceAnalysis.strategicScore != null ? Number(sequenceAnalysis.strategicScore).toFixed(1) : '평가 대기중')}
            </span>
          </div>
          ${sequenceAnalysis.strategicRationale ? `<p style="font-size: 14px; color: #6b21a8; margin-bottom: 16px;">${escapeHtml(sequenceAnalysis.strategicRationale)}</p>` : ''}
          ${sequenceAnalysis.sequenceEffectiveness ? `<div style="margin-bottom: 16px;"><h4 style="font-size: 14px; font-weight: 600; color: #2563eb; margin-bottom: 8px;">🎯 순서 선택의 효과성</h4><p style="font-size: 13px; color: #374151; background: white; padding: 12px; border-radius: 4px;">${escapeHtml(sequenceAnalysis.sequenceEffectiveness)}</p></div>` : ''}
          ${sequenceAnalysis.strategicInsights ? `<div style="margin-bottom: 16px;"><h4 style="font-size: 14px; font-weight: 600; color: #eab308; margin-bottom: 8px;">💡 전략적 통찰</h4><p style="font-size: 13px; color: #374151; background: #fef9c3; padding: 12px; border-radius: 4px; border-left: 4px solid #eab308;">${escapeHtml(sequenceAnalysis.strategicInsights)}</p></div>` : ''}
          ${(sequenceAnalysis.alternativeApproaches || []).length > 0 ? `
            <div>
              <h4 style="font-size: 14px; font-weight: 600; color: #16a34a; margin-bottom: 8px;">🛤️ 대안적 접근법</h4>
              ${(sequenceAnalysis.alternativeApproaches || []).map((a: string, i: number) => `
                <div style="display: flex; align-items: flex-start; gap: 8px; background: #dcfce7; padding: 12px; border-radius: 4px; margin-bottom: 8px;">
                  <span style="background: #22c55e; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px;">${i + 1}</span>
                  <p style="font-size: 13px; color: #166534; margin: 0;">${escapeHtml(a)}</p>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      </div>` : ''}

      <!-- 푸터 -->
      <div style="text-align: center; padding-top: 20px; border-top: 1px solid #e2e8f0; color: #9ca3af; font-size: 12px;">
        발행: ${feedback.createdAt ? new Date(feedback.createdAt).toLocaleDateString('ko-KR') : new Date().toLocaleDateString('ko-KR')} · 보고서 ID: ${escapeHtml(conversationId.slice(0, 8).toUpperCase())} · AI 기반 개인 맞춤 개발 보고서
      </div>
    </div>
  `;
}
