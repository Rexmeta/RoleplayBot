import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Feedback } from "@shared/schema";
import { getDifficultyTag } from "./reportUtils";

interface DevelopmentPlanProps {
  feedback: Feedback;
  conversationId: string;
  checkedItems: Record<string, boolean>;
  onToggleCheck: (key: string) => void;
}

export function DevelopmentPlan({ feedback, checkedItems, onToggleCheck }: DevelopmentPlanProps) {
  const { t } = useTranslation();
  const plan = feedback.detailedFeedback?.developmentPlan;

  if (!plan) {
    return (
      <div className="space-y-6">
        <h2 className="print-section-title hidden print:block">📈 {t('report.tabs.development', '개발 계획')}</h2>
        <Card className="border-dashed">
          <CardContent className="text-center py-8 text-slate-400">
            <p className="text-sm">{t('report.developmentPlanLoading', '개발 계획이 준비 중입니다.')}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const sections = [
    {
      key: 'short',
      label: '단기 목표 (1-2주)',
      timeLabel: '1-2주',
      icon: 'fas fa-calendar-week',
      items: plan.shortTerm || [],
      accentColor: 'green',
      testId: 'short-term-plan',
    },
    {
      key: 'medium',
      label: '중기 목표 (1-2개월)',
      timeLabel: '1-2개월',
      icon: 'fas fa-calendar-alt',
      items: plan.mediumTerm || [],
      accentColor: 'blue',
      testId: 'medium-term-plan',
    },
    {
      key: 'long',
      label: '장기 목표 (3-6개월)',
      timeLabel: '3-6개월',
      icon: 'fas fa-calendar',
      items: plan.longTerm || [],
      accentColor: 'purple',
      testId: 'long-term-plan',
    },
  ];

  const accentMap: Record<string, { hdr: string; badge: string; bg: string; check: string; row: string; cardBorder: string; checkboxOn: string; checkboxHover: string }> = {
    green: { hdr: 'text-green-700', badge: 'bg-green-100 text-green-700 border-green-200', bg: 'bg-green-50', check: 'text-green-600', row: 'border-green-100', cardBorder: 'border-l-4 border-l-green-500', checkboxOn: 'bg-green-500 border-green-500', checkboxHover: 'border-slate-300 hover:border-green-400' },
    blue: { hdr: 'text-blue-700', badge: 'bg-blue-100 text-blue-700 border-blue-200', bg: 'bg-blue-50', check: 'text-blue-600', row: 'border-blue-100', cardBorder: 'border-l-4 border-l-blue-500', checkboxOn: 'bg-blue-500 border-blue-500', checkboxHover: 'border-slate-300 hover:border-blue-400' },
    purple: { hdr: 'text-purple-700', badge: 'bg-purple-100 text-purple-700 border-purple-200', bg: 'bg-purple-50', check: 'text-purple-600', row: 'border-purple-100', cardBorder: 'border-l-4 border-l-purple-500', checkboxOn: 'bg-purple-500 border-purple-500', checkboxHover: 'border-slate-300 hover:border-purple-400' },
  };

  return (
    <div className="space-y-6">
      <h2 className="print-section-title hidden print:block">📈 {t('report.tabs.development', '개발 계획')}</h2>

      {sections.map(section => {
        const ac = accentMap[section.accentColor];
        return (
          <Card key={section.key} className={ac.cardBorder} data-testid={section.testId}>
            <CardHeader className="pb-3">
              <CardTitle className={`${ac.hdr} flex items-center gap-2`}>
                <i className={`${section.icon}`}></i>
                {section.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {section.items.map((item, idx) => {
                const itemKey = `${section.key}_${idx}`;
                const isChecked = !!checkedItems[itemKey];
                const diff = getDifficultyTag(item);
                return (
                  <div
                    key={idx}
                    className={`rounded-xl border p-4 transition-all ${ac.row} ${isChecked ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      <button
                        onClick={() => onToggleCheck(itemKey)}
                        className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${isChecked ? ac.checkboxOn : ac.checkboxHover}`}
                        aria-label={isChecked ? '완료 취소' : '완료 표시'}
                      >
                        {isChecked && <i className="fas fa-check text-white text-xs"></i>}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <h4 className={`font-semibold text-sm ${isChecked ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                            {item.goal}
                          </h4>
                          <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${diff.cls}`}>
                            {diff.label}
                          </span>
                          <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${ac.badge}`}>
                            {section.timeLabel}
                          </span>
                        </div>
                        <ul className="space-y-1 mb-2">
                          {item.actions.map((action, aIdx) => (
                            <li key={aIdx} className="text-xs text-slate-600 flex items-start gap-1.5">
                              <i className="fas fa-chevron-right mt-0.5 text-slate-400 flex-shrink-0" style={{ fontSize: '0.6rem' }}></i>
                              {action}
                            </li>
                          ))}
                        </ul>
                        <div className={`text-xs ${ac.check} ${ac.bg} px-2 py-1 rounded inline-block`}>
                          측정지표: {item.measurable}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {section.items.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-4">목표 항목이 없습니다.</p>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <i className="fas fa-book-open text-corporate-600 mr-2"></i>
            {t('report.recommendedResources', '추천 학습 자료 및 리소스')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="recommended-resources">
            {(plan.recommendedResources || []).map((resource, index) => (
              <div key={index} className="flex items-start space-x-3 p-3 bg-slate-50 rounded-lg">
                <i className="fas fa-bookmark text-corporate-500 mt-1"></i>
                <p className="text-slate-700 text-sm">{resource}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
