import { useTranslation } from "react-i18next";
import { formatElapsedTime } from "@/hooks/chat/useConversationTimer";
import type { ComplexScenario } from "@/lib/scenario-system";

interface MessengerInfoCardsProps {
  scenario: ComplexScenario;
  elapsedTime: number;
  turnCount: number;
  maxTurns: number;
}

export function MessengerInfoCards({ scenario, elapsedTime, turnCount, maxTurns }: MessengerInfoCardsProps) {
  const { t } = useTranslation();

  return (
    <div className="lg:w-[22rem] xl:w-[26rem] flex-shrink-0 space-y-3 lg:h-[calc(100dvh-8rem)] lg:overflow-y-auto">
      <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm hover:shadow-md transition-all duration-300">
        <h4 className="font-semibold text-slate-700 mb-3 flex items-center text-sm">
          <div className="w-7 h-7 bg-corporate-100 rounded-lg flex items-center justify-center mr-2">
            <i className="fas fa-user-tie text-corporate-600 text-xs"></i>
          </div>
          {t('chat.yourRoleAndGoals')}
        </h4>
        <div className="text-sm grid grid-cols-1 gap-3">
          {(scenario.context?.playerRoleText || scenario.context?.playerRole?.responsibility) && (
            <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 rounded-xl p-3">
              <div className="text-xs font-semibold text-corporate-600 mb-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <i className="fas fa-id-badge"></i>
                  {t('chat.yourRole')}
                </span>
                <span className="text-slate-500 font-normal bg-white px-2 py-0.5 rounded-full text-xs">
                  {scenario.context?.playerRole?.position}
                </span>
              </div>
              <div className="text-slate-700 leading-relaxed text-sm">
                {scenario.context?.playerRoleText || scenario.context?.playerRole?.responsibility}
              </div>
            </div>
          )}
          {scenario.objectives && scenario.objectives.length > 0 && (
            <div className="bg-gradient-to-br from-blue-50 to-blue-100/30 rounded-xl p-3">
              <div className="text-xs font-semibold text-blue-600 mb-1.5 flex items-center gap-1.5">
                <i className="fas fa-bullseye"></i>
                {t('chat.achievementGoals')}
              </div>
              <div className="space-y-1.5">
                {scenario.objectives.slice(0, 2).map((objective: string, index: number) => (
                  <div key={index} className="flex items-start gap-2">
                    <span className="w-5 h-5 bg-blue-500 text-white rounded-full flex items-center justify-center text-xs flex-shrink-0 mt-0.5">{index + 1}</span>
                    <span className="flex-1 text-slate-700 leading-relaxed text-sm">{objective}</span>
                  </div>
                ))}
                {scenario.objectives.length > 2 && (
                  <div className="text-xs text-slate-500 pl-7">
                    {t('chat.moreGoals', { count: scenario.objectives.length - 2 })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-1 gap-3">
        <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm hover:shadow-md transition-all duration-300 group">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 bg-blue-100 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
              <i className="fas fa-stopwatch text-blue-600 text-xs"></i>
            </div>
            <h4 className="font-semibold text-slate-700 text-xs">{t('chat.elapsedTime')}</h4>
          </div>
          <p className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-blue-500 bg-clip-text text-transparent" data-testid="sidebar-elapsed-time">
            {formatElapsedTime(elapsedTime)}
          </p>
          <p className="text-xs text-slate-500 mt-1.5 flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${
              elapsedTime < 300 ? 'bg-green-400' :
              elapsedTime < 600 ? 'bg-blue-400' :
              elapsedTime < 900 ? 'bg-amber-400' : 'bg-red-400'
            }`}></span>
            {elapsedTime < 300 ? t('chat.efficientProgress') :
             elapsedTime < 600 ? t('chat.appropriateSpeed') :
             elapsedTime < 900 ? t('chat.timeManagementNeeded') : t('chat.quickFinishRecommended')}
          </p>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm hover:shadow-md transition-all duration-300 group">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 bg-amber-100 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
              <i className="fas fa-sync-alt text-amber-600 text-xs"></i>
            </div>
            <h4 className="font-semibold text-slate-700 text-xs">{t('chat.remainingTurns')}</h4>
          </div>
          <p className="text-2xl font-bold bg-gradient-to-r from-amber-600 to-amber-500 bg-clip-text text-transparent">{maxTurns - turnCount}</p>
          <p className="text-xs text-slate-500 mt-1.5">{t('chat.autoEvaluateOnEnd')}</p>
        </div>
      </div>
    </div>
  );
}
