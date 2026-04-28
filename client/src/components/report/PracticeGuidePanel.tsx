import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import type { Feedback } from "@shared/schema";

interface PracticeGuidePanelProps {
  feedback: Feedback;
}

export function PracticeGuidePanel({ feedback }: PracticeGuidePanelProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-8">
      <h2 className="print-section-title hidden print:block">🗂️ {t('report.tabs.practiceGuide', '실천 가이드')}</h2>

      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center justify-center w-9 h-9 rounded-full bg-amber-100">
            <i className="fas fa-lightbulb text-amber-500 text-base"></i>
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-800">{t('report.section.behaviorPoints', '행동 개선 포인트')}</h3>
            <p className="text-xs text-slate-500">{t('report.section.behaviorPointsDesc', '이번 대화에서 발견된 상황별 구체적 행동 가이드입니다.')}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5">
          {(feedback.detailedFeedback?.behaviorGuides?.length ?? 0) > 0
            ? feedback.detailedFeedback!.behaviorGuides!.map((guide, index) => (
              <Card key={index} className="border border-amber-100 shadow-sm hover:shadow-md transition-shadow" data-testid={`behavior-guide-${index}`}>
                <CardContent className="p-5 space-y-4">
                  <div className="flex items-center gap-3">
                    <span className="flex-shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-500 text-white text-xs font-bold">
                      {index + 1}
                    </span>
                    <h4 className="font-semibold text-slate-800 text-base leading-snug">{guide.situation}</h4>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="bg-corporate-50 rounded-lg p-3 border border-corporate-100">
                      <p className="text-xs font-semibold text-corporate-600 mb-1.5 uppercase tracking-wide">{t('report.recommendedAction', '권장 행동')}</p>
                      <p className="text-sm text-slate-700 leading-relaxed">{guide.action}</p>
                    </div>
                    <div className="bg-green-50 rounded-lg p-3 border border-green-100 relative">
                      <p className="text-xs font-semibold text-green-600 mb-1.5 uppercase tracking-wide">{t('report.specificExample', '실제 예시')}</p>
                      <p className="text-sm text-green-800 italic leading-relaxed">"{guide.example}"</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-2 pt-1 border-t border-slate-100">
                    <i className="fas fa-arrow-trend-up text-blue-400 mt-0.5 flex-shrink-0"></i>
                    <p className="text-sm text-slate-600"><span className="font-medium text-blue-700">{t('report.expectedEffect', '기대 효과')}: </span>{guide.impact}</p>
                  </div>
                </CardContent>
              </Card>
            ))
            : (
              <Card className="border-dashed">
                <CardContent className="text-center py-8 text-slate-400">
                  <i className="fas fa-info-circle text-2xl mb-2 block"></i>
                  <p className="text-sm">{t('report.behaviorGuideLoading', '구체적인 행동 가이드가 준비 중입니다.')}</p>
                </CardContent>
              </Card>
            )
          }
        </div>
      </div>

      <div className="relative flex items-center gap-4 py-2">
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-slate-200 to-slate-200"></div>
        <span className="flex-shrink-0 inline-flex items-center gap-2 px-4 py-1.5 bg-slate-100 rounded-full text-xs font-medium text-slate-500">
          <i className="fas fa-comments text-slate-400"></i>
          {t('report.section.conversationExamples', '대화 스크립트 예시')}
        </span>
        <div className="flex-1 h-px bg-gradient-to-l from-transparent via-slate-200 to-slate-200"></div>
      </div>

      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center justify-center w-9 h-9 rounded-full bg-cyan-100">
            <i className="fas fa-comments text-cyan-500 text-base"></i>
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-800">{t('report.section.conversationScript', '대화 스크립트 예시')}</h3>
            <p className="text-xs text-slate-500">{t('report.section.conversationScriptDesc', '좋은 표현과 피해야 할 표현을 비교하여 실전 대화력을 높이세요.')}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5">
          {(feedback.detailedFeedback?.conversationGuides?.length ?? 0) > 0
            ? feedback.detailedFeedback!.conversationGuides!.map((guide, index) => (
              <Card key={index} className="border border-cyan-100 shadow-sm hover:shadow-md transition-shadow" data-testid={`conversation-guide-${index}`}>
                <CardContent className="p-5 space-y-4">
                  <div className="flex items-center gap-3">
                    <span className="flex-shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full bg-cyan-500 text-white text-xs font-bold">
                      {index + 1}
                    </span>
                    <h4 className="font-semibold text-slate-800 text-base leading-snug">{guide.scenario}</h4>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                      <p className="text-xs font-semibold text-green-700 mb-2 flex items-center gap-1">
                        <i className="fas fa-check-circle"></i>
                        {t('report.goodExample', '이렇게 말하세요')}
                      </p>
                      <p className="text-sm text-green-800 leading-relaxed">{guide.goodExample}</p>
                    </div>
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                      <p className="text-xs font-semibold text-red-700 mb-2 flex items-center gap-1">
                        <i className="fas fa-times-circle"></i>
                        {t('report.badExample', '이런 표현은 피하세요')}
                      </p>
                      <p className="text-sm text-red-800 leading-relaxed">{guide.badExample}</p>
                    </div>
                  </div>

                  {(guide.keyPoints || []).length > 0 && (
                    <div className="pt-2 border-t border-slate-100">
                      <p className="text-xs font-semibold text-slate-500 mb-2">🔑 {t('report.keyPoints', '핵심 포인트')}</p>
                      <div className="flex flex-wrap gap-2">
                        {(guide.keyPoints || []).map((point, pIdx) => (
                          <span key={pIdx} className="text-xs bg-sky-100 text-sky-800 border border-sky-200 px-2.5 py-0.5 rounded-full">
                            {point}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
            : (
              <Card className="border-dashed">
                <CardContent className="text-center py-8 text-slate-400">
                  <i className="fas fa-info-circle text-2xl mb-2 block"></i>
                  <p className="text-sm">{t('report.conversationGuideLoading', '맞춤형 대화 가이드가 준비 중입니다.')}</p>
                </CardContent>
              </Card>
            )
          }
        </div>
      </div>
    </div>
  );
}
