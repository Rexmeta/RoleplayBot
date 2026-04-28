import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Feedback } from "@shared/schema";

interface StrategyPanelProps {
  feedback: Feedback;
}

export function StrategyPanel({ feedback }: StrategyPanelProps) {
  const { t } = useTranslation();
  const analysis = feedback.detailedFeedback?.sequenceAnalysis;

  if (!analysis) return null;

  return (
    <div className="space-y-6">
      <h2 className="print-section-title hidden print:block">🎮 {t('report.tabs.strategy', '전략 평가')}</h2>
      <Card className="border-l-4 border-l-purple-500">
        <CardHeader>
          <CardTitle className="flex items-center text-xl">
            <i className="fas fa-chess text-purple-600 mr-3"></i>
            {t('report.strategicAnalysis', '전략적 선택 분석')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-purple-50 p-6 rounded-lg">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-purple-900">{t('report.strategyScore', '전략 점수')}</h3>
              <Badge variant="outline" className="text-2xl font-bold bg-purple-100 text-purple-700 px-4 py-2">
                {analysis.strategicScore != null
                  ? Number(analysis.strategicScore).toFixed(1)
                  : t('report.awaitingEvaluation', '평가 대기중')}
              </Badge>
            </div>
            <p className="text-purple-700">
              {analysis.strategicRationale || t('report.strategyNotGenerated', '전략 평가가 아직 생성되지 않았습니다.')}
            </p>
          </div>

          {analysis.sequenceEffectiveness && (
            <div>
              <h3 className="text-lg font-semibold text-slate-900 mb-3 flex items-center">
                <i className="fas fa-bullseye text-blue-500 mr-2"></i>
                {t('report.sequenceEffectiveness', '순서 선택의 효과성')}
              </h3>
              <p className="text-slate-700 bg-slate-50 p-4 rounded-lg">{analysis.sequenceEffectiveness}</p>
            </div>
          )}

          {analysis.strategicInsights && (
            <div>
              <h3 className="text-lg font-semibold text-slate-900 mb-3 flex items-center">
                <i className="fas fa-lightbulb text-yellow-500 mr-2"></i>
                {t('report.strategicInsights', '전략적 통찰')}
              </h3>
              <p className="text-slate-700 bg-yellow-50 p-4 rounded-lg border-l-4 border-yellow-400">{analysis.strategicInsights}</p>
            </div>
          )}

          {analysis.alternativeApproaches && analysis.alternativeApproaches.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold text-slate-900 mb-3 flex items-center">
                <i className="fas fa-route text-green-500 mr-2"></i>
                {t('report.alternativeApproaches', '대안적 접근법')}
              </h3>
              <div className="space-y-3">
                {analysis.alternativeApproaches.map((approach: string, index: number) => (
                  <div key={index} className="flex items-start space-x-3 bg-green-50 p-4 rounded-lg">
                    <Badge className="bg-green-500 text-white mt-1">{index + 1}</Badge>
                    <p className="text-slate-700 flex-1">{approach}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
