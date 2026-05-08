import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { Feedback } from "@shared/schema";
import { EVIDENCE_SCORE_CAP } from "@shared/schema/types";
import {
  toTenPoint,
  getScoreHex,
  getScoreBorderColor,
  getScoreLabel,
  getTranslatedDimensionName,
} from "./reportUtils";

interface EvidenceItem {
  turnIndex: number;
  quote: string;
  behaviorObserved: string;
  rubricBand: string;
  reason: string;
  isSystemFallback?: boolean;
}

function EvidenceSection({ evidence, evidenceCapped }: { evidence: EvidenceItem[]; evidenceCapped?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  if (!evidence || evidence.length === 0) return null;
  const realItems = evidence.filter(e => !e.isSystemFallback);
  const hasFallbackOnly = realItems.length === 0;
  if (hasFallbackOnly) {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1">
        <span>⚠️</span>
        <span>
          근거 발화 미제공{evidenceCapped ? ` — 최대 ${EVIDENCE_SCORE_CAP}점으로 자동 제한됨` : ''}
        </span>
      </div>
    );
  }
  return (
    <div className="mt-2">
      <button
        onClick={() => setIsOpen(v => !v)}
        className="flex items-center gap-1.5 text-[11px] font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
      >
        <i className={`fas fa-chevron-${isOpen ? 'up' : 'down'} text-[9px]`}></i>
        <i className="fas fa-quote-left text-[9px] opacity-70"></i>
        근거 발화 {realItems.length}건
      </button>
      {isOpen && (
        <div className="mt-2 space-y-2">
          {realItems.map((ev, idx) => (
            <div key={idx} className="bg-indigo-50 border border-indigo-100 rounded-lg p-2.5 text-xs">
              <div className="flex items-start gap-2 mb-1.5">
                <span className="flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-indigo-200 text-indigo-700 text-[10px] font-bold">
                  {ev.turnIndex}
                </span>
                <blockquote className="text-slate-700 italic leading-snug flex-1">"{ev.quote}"</blockquote>
              </div>
              <div className="pl-7 space-y-0.5">
                <p className="text-slate-600"><span className="font-medium text-slate-700">관찰:</span> {ev.behaviorObserved}</p>
                <p className="text-slate-600"><span className="font-medium text-slate-700">기준:</span> <span className="text-indigo-700 font-medium">{ev.rubricBand}</span></p>
                <p className="text-slate-500 text-[11px]">{ev.reason}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminAdjustmentLog({ adj }: { adj: NonNullable<Feedback['detailedFeedback']>['scoreAdjustments'] }) {
  const [open, setOpen] = useState(false);
  if (!adj) return null;
  const rows: { label: string; value: string | number | null | undefined }[] = [
    { label: 'baseScore', value: adj.baseScore },
    { label: 'nonVerbalPenalty', value: adj.nonVerbalPenalty },
    { label: 'nonVerbalCount', value: adj.nonVerbalCount },
    { label: 'noisePenalty', value: adj.noisePenalty },
    { label: 'bargeInAdjustment', value: adj.bargeInAdjustment },
    { label: 'bargeInCount', value: adj.bargeInCount },
    { label: 'completionPenalty', value: adj.completionPenalty },
    { label: 'completionRatio', value: adj.completionRatio },
    { label: 'evidencePenalty', value: adj.evidencePenalty },
    { label: 'evidenceCappedDimensions', value: adj.evidenceCappedDimensions?.join(', ') ?? '—' },
    { label: 'scoreCap', value: adj.scoreCap },
    { label: 'finalScore', value: adj.finalScore },
  ];
  return (
    <div className="mt-3 border border-dashed border-amber-300 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2 bg-amber-50 text-amber-800 text-xs font-semibold hover:bg-amber-100 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <i className="fas fa-shield-halved text-amber-600"></i>
          관리자 전용 — 보정 상세 로그
        </span>
        <i className={`fas fa-chevron-${open ? 'up' : 'down'} text-amber-500`}></i>
      </button>
      {open && (
        <div className="px-4 py-3 bg-white">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left py-1 pr-4 text-slate-500 font-medium w-1/2">필드</th>
                <th className="text-right py-1 text-slate-700 font-medium">값</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.label} className="border-b border-slate-50 last:border-0">
                  <td className="py-1 pr-4 font-mono text-slate-500">{r.label}</td>
                  <td className="py-1 text-right font-mono text-slate-800">
                    {r.value == null ? <span className="text-slate-300">null</span> : String(r.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface CappedDimensionItem {
  key: string;
  name: string;
  cappedScore: number;
  originalScore: number | null;
}

interface AdjRow {
  label: string;
  value: number;
  reason: string;
  icon: string;
  colorClass: string;
  cappedDimensionItems?: CappedDimensionItem[];
}

interface ScoreOverviewProps {
  feedback: Feedback;
  feedbackHistory: any[];
  conversationId: string;
  scoreAnimKey: number;
  reportStatus?: string;
  confidence?: number;
}

export function ScoreOverview({
  feedback,
  feedbackHistory,
  conversationId,
  scoreAnimKey,
  reportStatus,
  confidence,
}: ScoreOverviewProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [evidencePenaltyExpanded, setEvidencePenaltyExpanded] = useState(false);
  const isAdmin = user?.role === 'admin';

  const getPrevSessionDelta = (category: string): number | null => {
    if (feedbackHistory.length < 2) return null;
    const currentIdx = feedbackHistory.findIndex((h: any) => h.personaRunId === conversationId);
    if (currentIdx < 0) return null;
    const currentSession = feedbackHistory[currentIdx];
    const prevSession = feedbackHistory[currentIdx + 1];
    if (!prevSession || !currentSession) return null;
    const prevScore = prevSession.scores?.find((s: any) => s.category === category)?.score;
    const currScore = currentSession.scores?.find((s: any) => s.category === category)?.score;
    if (prevScore === undefined || currScore === undefined) return null;
    return currScore - prevScore;
  };

  const isCurrentSessionInHistory = feedbackHistory.some((h: any) => h.personaRunId === conversationId);

  const radarData = (feedback.scores || []).map(s => {
    const maxScore = (s as any).maxScore || 10;
    return {
      subject: getTranslatedDimensionName(t, s.category, s.name),
      value: toTenPoint(s.score ?? 0, maxScore),
      fullMark: 10,
    };
  });

  const CustomRadarTick = ({ payload, x, y, cx, cy }: any) => {
    const item = radarData.find(d => d.subject === payload.value);
    const score = item?.value ?? 0;
    const color = getScoreHex(score);
    const midX = cx ?? 0;
    const anchor = Math.abs(x - midX) < 10 ? 'middle' : x > midX ? 'start' : 'end';
    return (
      <g>
        <text x={x} y={y - 7} textAnchor={anchor} fill="#64748b" fontSize={10}>{payload.value}</text>
        <text x={x} y={y + 8} textAnchor={anchor} fill={color} fontSize={12} fontWeight="700">{Number(score).toFixed(1)}/10</text>
      </g>
    );
  };

  const isReplay = scoreAnimKey > 0;
  const flowDelay = (index: number): React.CSSProperties => ({
    opacity: 0,
    animation: `fadeInUp 0.5s ease-out ${isReplay ? 0.6 + index * 0.13 : 3.3 + index * 0.13}s forwards`,
  });

  const adj = feedback.detailedFeedback?.scoreAdjustments;
  const hasAdjustments = adj && (
    adj.nonVerbalPenalty !== 0 ||
    (adj.noisePenalty != null && adj.noisePenalty !== 0) ||
    adj.bargeInAdjustment !== 0 ||
    adj.completionPenalty !== 0 ||
    (adj.evidencePenalty ?? 0) !== 0 ||
    adj.scoreCap !== null
  );

  // noisePenalty is the canonical noise/non-verbal field when present; show only one row
  // to avoid double-counting the same underlying penalty.
  const adjRows: AdjRow[] = adj ? [
    ...(adj.noisePenalty != null ? [{
      label: '노이즈/비언어적 감점',
      value: -adj.noisePenalty,
      reason: adj.nonVerbalCount != null && adj.nonVerbalCount > 0
        ? `${adj.nonVerbalCount}개의 비언어적 표현 감지`
        : adj.noisePenalty > 0
          ? '대화 중 노이즈 또는 방해 요소 감지'
          : '해당 없음',
      icon: 'fas fa-waveform-lines',
      colorClass: adj.noisePenalty > 0 ? 'text-rose-600' : 'text-slate-400',
    }] : [{
      label: '비언어적 표현 감점',
      value: -adj.nonVerbalPenalty,
      reason: adj.nonVerbalCount != null && adj.nonVerbalCount > 0
        ? `${adj.nonVerbalCount}개의 비언어적 표현 감지`
        : '해당 없음 (감지된 표현 없음)',
      icon: 'fas fa-volume-xmark',
      colorClass: adj.nonVerbalPenalty > 0 ? 'text-rose-600' : 'text-slate-400',
    }]),
    {
      label: '말 끊기 조정',
      value: adj.bargeInAdjustment,
      reason: adj.bargeInCount != null && adj.bargeInCount > 0
        ? `${adj.bargeInCount}회 말 끊기 감지`
        : '해당 없음 (말 끊기 없음)',
      icon: 'fas fa-comment-slash',
      colorClass: adj.bargeInAdjustment < 0 ? 'text-rose-600' : adj.bargeInAdjustment > 0 ? 'text-emerald-600' : 'text-slate-400',
    },
    {
      label: '대화 완성도 패널티',
      value: -adj.completionPenalty,
      reason: adj.completionRatio != null
        ? `대화 완성도 ${adj.completionRatio}%`
        : '해당 없음',
      icon: 'fas fa-hourglass-half',
      colorClass: adj.completionPenalty > 0 ? 'text-amber-600' : 'text-slate-400',
    },
    ...(((adj.evidencePenalty ?? 0) > 0 || (adj.evidenceCappedDimensions?.length ?? 0) > 0) ? [{
      label: 'Evidence 부족 패널티',
      value: -(adj.evidencePenalty ?? 0),
      reason: adj.evidenceCappedDimensions && adj.evidenceCappedDimensions.length > 0
        ? `${adj.evidenceCappedDimensions.length}개 차원 근거 발화 미제공으로 점수 상한 적용`
        : '근거 발화 미제공 차원 있음',
      icon: 'fas fa-file-circle-xmark',
      colorClass: (adj.evidencePenalty ?? 0) > 0 ? 'text-rose-600' : 'text-slate-400',
      cappedDimensionItems: (adj.evidenceCappedDimensions ?? []).map(dimKey => {
        const scoreEntry = feedback.scores?.find(s => s.category === dimKey);
        const maxScore = scoreEntry?.maxScore ?? 10;
        const cappedScore = toTenPoint(scoreEntry?.score ?? EVIDENCE_SCORE_CAP, maxScore);
        const originalScore = scoreEntry?.originalScore != null
          ? toTenPoint(scoreEntry.originalScore, maxScore)
          : null;
        return {
          key: dimKey,
          name: scoreEntry ? getTranslatedDimensionName(t, scoreEntry.category, scoreEntry.name) : dimKey,
          cappedScore,
          originalScore,
        };
      }),
    }] : []),
  ] : [];

  const confidencePct = confidence != null ? Math.round(confidence * 100) : null;
  const confidenceLabel =
    reportStatus === 'valid' ? '높음' :
    reportStatus === 'low_confidence' ? '낮음' :
    reportStatus === 'system_fallback' ? '오류' : null;
  const confidenceColor =
    reportStatus === 'valid' ? 'text-emerald-700 bg-emerald-50 border-emerald-200' :
    reportStatus === 'low_confidence' ? 'text-amber-700 bg-amber-50 border-amber-200' :
    'text-slate-600 bg-slate-50 border-slate-200';

  return (
    <div className="space-y-6">
      <h2 className="print-section-title hidden print:block">📊 {t('report.tabs.scores', '성과 분석')}</h2>

      {/* 신뢰도 배지 */}
      {confidencePct != null && confidenceLabel && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium ${confidenceColor}`} data-testid="confidence-badge">
          <i className={`fas ${reportStatus === 'valid' ? 'fa-circle-check' : 'fa-triangle-exclamation'} text-[11px]`}></i>
          <span>평가 신뢰도: <strong>{confidenceLabel}</strong> ({confidencePct}%)</span>
          <div className="flex-1 h-1.5 bg-current/10 rounded-full overflow-hidden ml-1">
            <div className="h-full rounded-full bg-current opacity-60 transition-all duration-700" style={{ width: `${confidencePct}%` }} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        <div className="flex flex-col gap-3">
          {(feedback.scores?.length ?? 0) > 0 && (
            <Card className="flex flex-col flex-1 shadow-sm" data-testid="radar-chart-card">
              <CardHeader className="pb-1 pt-4 px-4 flex-shrink-0">
                <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-2">
                  <i className="fas fa-chart-area text-indigo-400"></i>
                  역량 레이더 차트
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col flex-1 min-h-0 pt-2 px-2 pb-4">
                <div className="flex-1 min-h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart
                      data={radarData}
                      cx="50%"
                      cy="50%"
                      outerRadius="52%"
                    >
                      <PolarGrid stroke="#e2e8f0" />
                      <PolarAngleAxis
                        dataKey="subject"
                        tick={<CustomRadarTick />}
                        tickLine={false}
                      />
                      <PolarRadiusAxis angle={30} domain={[0, 10]} tick={false} axisLine={false} />
                      <Radar
                        name="역량"
                        dataKey="value"
                        stroke="#6366f1"
                        fill="#6366f1"
                        fillOpacity={0.25}
                        strokeWidth={2}
                      />
                      <Tooltip
                        formatter={(value: any) => [Number(value).toFixed(1), '점수']}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {feedback.detailedFeedback?.evaluationCriteriaSetName && (
            <div className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg px-3 py-2 flex items-center gap-2">
              <i className="fas fa-clipboard-list text-indigo-400"></i>
              평가 기준: {feedback.detailedFeedback.evaluationCriteriaSetName}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 content-start">
          {(feedback.scores || []).map((score, index) => {
            const maxScore = (score as any).maxScore || 10;
            const scoreNum = toTenPoint(score.score ?? 0, maxScore);
            const hexColor = getScoreHex(scoreNum);
            const borderCls = getScoreBorderColor(scoreNum);
            const levelLabel = getScoreLabel(t, scoreNum);
            const progressPct = Math.round((scoreNum / 10) * 100);
            const delta = isCurrentSessionInHistory ? getPrevSessionDelta(score.category) : null;

            return (
              <div
                key={index}
                className={`border-l-4 ${borderCls} bg-white rounded-r-xl shadow-sm p-3`}
                data-testid={`score-card-${index}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-sm font-semibold text-slate-800 truncate">
                      {getTranslatedDimensionName(t, score.category, score.name)}
                    </span>
                    {(score as any).weight && <span className="text-xs text-slate-400 flex-shrink-0">({(score as any).weight}%)</span>}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                    {delta !== null && (
                      <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${
                        delta > 0 ? 'bg-emerald-50 text-emerald-700' :
                        delta < 0 ? 'bg-rose-50 text-rose-700' :
                        'bg-slate-100 text-slate-500'
                      }`}>
                        {delta > 0 ? `↑+${delta.toFixed(1)}` : delta < 0 ? `↓${delta.toFixed(1)}` : '→'}
                      </span>
                    )}
                    <span
                      className="text-sm font-bold px-2 py-0.5 rounded-full text-white"
                      style={{ backgroundColor: hexColor }}
                    >
                      {Number(scoreNum).toFixed(1)}/10
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-1000 ease-out"
                      style={{ width: `${progressPct}%`, backgroundColor: hexColor, opacity: 0.75 }}
                    />
                  </div>
                  <span className="text-[11px] text-slate-400 w-14 text-right flex-shrink-0">{levelLabel}</span>
                </div>
                {score.evidenceCapped && (
                  <div className="flex items-center gap-1.5 mb-1.5 text-[11px] font-medium text-rose-600 bg-rose-50 border border-rose-200 rounded px-2 py-0.5 w-fit">
                    <i className="fas fa-circle-exclamation text-[10px]"></i>
                    근거 발화 미제공 — 최대 {EVIDENCE_SCORE_CAP}/10 상한 적용
                  </div>
                )}
                <p className="text-xs text-slate-600 leading-relaxed" data-testid={`score-feedback-${index}`}>{score.feedback}</p>
                {score.evidence && score.evidence.length > 0 && (
                  <EvidenceSection evidence={score.evidence} evidenceCapped={score.evidenceCapped} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <Card
        className="transform transition-all duration-500 hover:shadow-lg"
        style={{ opacity: 0, animation: `fadeInUp 0.8s ease-out 2.5s forwards` }}
      >
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center">
            <i className="fas fa-chart-line text-corporate-600 mr-2"></i>
            {t('report.overallEvaluation', '종합 평가')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4">
            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
              <h4 className="font-bold text-green-800 mb-3 flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-green-500 text-white text-xs">
                  <i className="fas fa-thumbs-up"></i>
                </span>
                {t('report.mainStrengths', '주요 강점')}
              </h4>
              <ul className="space-y-2" data-testid="strengths-list">
                {feedback.detailedFeedback?.strengths?.map((strength, idx) => (
                  <li key={idx} className="flex items-start gap-3">
                    <span className="flex-shrink-0 inline-flex items-center justify-center w-5 h-5 mt-0.5 rounded-full bg-green-200 text-green-700 text-xs font-bold">{idx + 1}</span>
                    <span className="text-sm text-green-900 leading-relaxed">{strength}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
              <h4 className="font-bold text-orange-800 mb-3 flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-orange-500 text-white text-xs">
                  <i className="fas fa-arrow-up"></i>
                </span>
                {t('report.improvementPoints', '개선 포인트')}
              </h4>
              <ul className="space-y-2" data-testid="improvements-list">
                {feedback.detailedFeedback?.improvements?.map((improvement, idx) => {
                  const priorityLabels = ['즉시 실천', '단기', '지속'];
                  const priorityColors = [
                    'bg-red-100 text-red-700 border-red-200',
                    'bg-yellow-100 text-yellow-700 border-yellow-200',
                    'bg-slate-100 text-slate-600 border-slate-200',
                  ];
                  const priorityLabel = priorityLabels[idx] ?? '지속';
                  const priorityColor = priorityColors[idx] ?? priorityColors[2];
                  return (
                    <li key={idx} className="flex items-start gap-3">
                      <span className="flex-shrink-0 inline-flex items-center justify-center w-5 h-5 mt-0.5 rounded-full bg-orange-200 text-orange-700 text-xs font-bold">{idx + 1}</span>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-orange-900 leading-relaxed">{improvement}</span>
                        <span className={`ml-2 inline-block text-xs px-1.5 py-0.5 rounded border ${priorityColor} font-medium align-middle`}>{priorityLabel}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <h4 className="font-bold text-blue-800 mb-3 flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-500 text-white text-xs">
                  <i className="fas fa-forward"></i>
                </span>
                {t('report.nextSteps', '다음 단계')}
              </h4>
              <ul className="space-y-2" data-testid="next-steps-list">
                {feedback.detailedFeedback?.nextSteps?.map((step, idx) => (
                  <li key={idx} className="flex items-start gap-3">
                    <span className="flex-shrink-0 inline-flex items-center justify-center h-5 px-1.5 mt-0.5 rounded bg-blue-500 text-white text-xs font-bold whitespace-nowrap">Step {idx + 1}</span>
                    <span className="text-sm text-blue-900 leading-relaxed">{step}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="bg-indigo-50 border-l-4 border-indigo-500 rounded-r-xl p-4" data-testid="ranking-summary">
            <div className="flex items-center gap-2 mb-2">
              <i className="fas fa-comment-dots text-indigo-500"></i>
              <span className="text-sm font-bold text-indigo-800">{t('report.overallOpinion', '종합 의견')}</span>
            </div>
            <p className="text-sm text-indigo-900 leading-relaxed">
              {feedback.detailedFeedback?.ranking}
            </p>
          </div>
        </CardContent>
      </Card>

      {adj && (
        <Card
          key={scoreAnimKey}
          className="transform transition-all duration-500 hover:shadow-lg screen-only"
          style={{ opacity: 0, animation: `fadeInUp 0.8s ease-out ${isReplay ? 0.3 : 3}s forwards` }}
        >
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2">
              <i className="fas fa-calculator text-indigo-500"></i>
              점수 산출 내역
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-0">
            <div
              className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-4 py-3"
              style={flowDelay(0)}
            >
              <div className="flex items-center gap-2">
                <i className="fas fa-robot text-indigo-400"></i>
                <span className="text-sm font-medium text-slate-700">루브릭 기반 역량 점수</span>
              </div>
              <span className="text-sm font-bold text-indigo-700">{Number(adj.baseScore).toFixed(1)}점</span>
            </div>

            {adjRows.map((row, rowIndex) => {
              const cappedItems: CappedDimensionItem[] = row.cappedDimensionItems ?? [];
              const isEvidenceRow = cappedItems.length > 0 || row.cappedDimensionItems !== undefined;
              return (
                <div key={row.label} style={flowDelay(1 + rowIndex)}>
                  <div className="flex justify-center items-center py-1">
                    <div className="flex flex-col items-center gap-0">
                      <div className="w-px h-3 bg-slate-300"></div>
                      <i className={`fas fa-chevron-down text-xs ${row.value < 0 ? 'text-rose-400' : row.value > 0 ? 'text-emerald-400' : 'text-slate-300'}`}></i>
                    </div>
                  </div>
                  <div className={`rounded-xl border overflow-hidden ${
                    row.value < 0 ? 'bg-rose-50 border-rose-200' :
                    row.value > 0 ? 'bg-emerald-50 border-emerald-200' :
                    'bg-slate-50 border-slate-200'
                  }`}>
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <i className={`${row.icon} text-sm flex-shrink-0 ${row.colorClass}`}></i>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-700">{row.label}</p>
                          <p className="text-xs text-slate-500 truncate">{row.reason}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                        <span className={`text-sm font-bold ${row.colorClass}`}>
                          {row.value === 0 ? '±0' : row.value > 0 ? `+${Number.isInteger(row.value) ? row.value : Number(row.value).toFixed(1)}` : `${Number.isInteger(row.value) ? row.value : Number(row.value).toFixed(1)}`}점
                        </span>
                        {isEvidenceRow && cappedItems.length > 0 && (
                          <button
                            onClick={() => setEvidencePenaltyExpanded(v => !v)}
                            className="flex items-center gap-1 text-[11px] font-medium text-rose-600 hover:text-rose-800 bg-rose-100 hover:bg-rose-200 border border-rose-200 rounded px-2 py-0.5 transition-colors"
                          >
                            <i className={`fas fa-chevron-${evidencePenaltyExpanded ? 'up' : 'down'} text-[9px]`}></i>
                            상세
                          </button>
                        )}
                      </div>
                    </div>
                    {isEvidenceRow && evidencePenaltyExpanded && cappedItems.length > 0 && (
                      <div className="border-t border-rose-200 px-4 py-3 space-y-2">
                        <p className="text-[11px] font-semibold text-rose-700 uppercase tracking-wide mb-1">점수 상한 적용된 차원</p>
                        {cappedItems.map(item => (
                          <div key={item.key} className="flex items-center justify-between bg-white border border-rose-100 rounded-lg px-3 py-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <i className="fas fa-circle-exclamation text-rose-400 text-xs flex-shrink-0"></i>
                              <span className="text-xs font-medium text-slate-700 truncate">{item.name}</span>
                            </div>
                            <div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
                              {item.originalScore != null && (
                                <>
                                  <span className="text-xs text-slate-400 line-through">{Number(item.originalScore).toFixed(1)}</span>
                                  <i className="fas fa-arrow-right text-[9px] text-rose-400"></i>
                                </>
                              )}
                              <span className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded px-1.5 py-0.5">
                                {Number(item.cappedScore).toFixed(1)}/10
                              </span>
                              <span className="text-[10px] text-rose-500">상한</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {adj.scoreCap !== null && (
              <div style={flowDelay(1 + adjRows.length)}>
                <div className="flex justify-center items-center py-1">
                  <div className="flex flex-col items-center gap-0">
                    <div className="w-px h-3 bg-slate-300"></div>
                    <i className="fas fa-chevron-down text-xs text-amber-400"></i>
                  </div>
                </div>
                <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <i className="fas fa-arrow-down-wide-short text-amber-500 text-sm flex-shrink-0"></i>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-700">대화량 부족 캡</p>
                      <p className="text-xs text-slate-500">역량별 최고 점수 {Number(adj.scoreCap).toFixed(1)}점으로 제한</p>
                    </div>
                  </div>
                  <span className="text-sm font-bold text-amber-600 flex-shrink-0 ml-3">적용됨</span>
                </div>
              </div>
            )}

            {!hasAdjustments && adj.scoreCap === null && (
              <div style={flowDelay(1 + adjRows.length)}>
                <div className="flex justify-center items-center py-1">
                  <div className="flex flex-col items-center gap-0">
                    <div className="w-px h-3 bg-slate-300"></div>
                    <i className="fas fa-chevron-down text-xs text-slate-300"></i>
                  </div>
                </div>
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-500">
                  <i className="fas fa-check-circle text-slate-400"></i>
                  <span className="text-sm">조정 없음 — 기본 점수가 그대로 적용되었습니다.</span>
                </div>
              </div>
            )}

            <div className="flex justify-center items-center py-1" style={flowDelay(2 + adjRows.length)}>
              <div className="flex flex-col items-center gap-0">
                <div className="w-px h-3 bg-indigo-300"></div>
                <i className="fas fa-chevron-down text-xs text-indigo-400"></i>
              </div>
            </div>

            <div
              className="flex items-center justify-between bg-indigo-50 border-2 border-indigo-300 rounded-xl px-4 py-3"
              style={flowDelay(3 + adjRows.length)}
            >
              <div className="flex items-center gap-2">
                <i className="fas fa-flag-checkered text-indigo-500"></i>
                <span className="text-sm font-bold text-indigo-800">최종 점수</span>
              </div>
              <span className="text-base font-extrabold text-indigo-700">{Number(adj.finalScore).toFixed(1)}점</span>
            </div>

            {isAdmin && (
              <AdminAdjustmentLog adj={adj} />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
