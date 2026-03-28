import { useTranslation } from "react-i18next";
import { formatElapsedTime } from "@/hooks/chat/useConversationTimer";
import { emotionEmojis } from "@/hooks/chat/useEmotionState";
import type { ComplexScenario } from "@/lib/scenario-system";

interface GoalsSidebarProps {
  scenario: ComplexScenario;
  personaName: string;
  personaDept?: string;
  personaRole?: string;
  latestEmotion?: string;
  elapsedTime: number;
  isAdmin?: boolean;
  isGoalsExpanded: boolean;
  onToggleGoals: () => void;
  variant: 'sidebar' | 'overlay';
}

export function GoalsSidebar({
  scenario,
  personaName,
  personaDept,
  personaRole,
  latestEmotion,
  elapsedTime,
  isAdmin,
  isGoalsExpanded,
  onToggleGoals,
  variant,
}: GoalsSidebarProps) {
  const { t } = useTranslation();

  const hasGoals = scenario?.objectives || scenario?.context?.playerRoleText || scenario?.context?.playerRole?.responsibility;

  if (variant === 'sidebar') {
    return (
      <div className="hidden xl:flex flex-col w-[480px] 2xl:w-[560px] bg-gradient-to-b from-slate-50 to-slate-100 border-r border-slate-200 p-4 overflow-y-auto z-30">
        <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-slate-100 mb-4">
          <div className="flex items-center space-x-2">
            <span className="text-sm font-semibold text-slate-800">{personaDept} {personaRole} {personaName}</span>
            {isAdmin && latestEmotion && (
              <span className="text-lg">{emotionEmojis[latestEmotion] || '😐'}</span>
            )}
          </div>
          <div className="flex items-center space-x-3 text-xs text-slate-500 mt-2">
            <span className="flex items-center" data-testid="text-elapsed-time-sidebar">
              <i className="fas fa-clock mr-1"></i>
              {formatElapsedTime(elapsedTime)}
            </span>
          </div>
        </div>

        {hasGoals && (
          <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 mb-4 text-xs leading-relaxed space-y-3">
            {(scenario.context?.playerRoleText || scenario.context?.playerRole?.responsibility) && (
              <div>
                <div className="font-semibold text-corporate-600 mb-1.5 flex items-center justify-between">
                  <span>👤 {t('chat.yourRole')}</span>
                  <span className="text-slate-500 font-normal">
                    {scenario.context?.playerRole?.position}
                    {scenario.context?.playerRole?.experience && ` (${scenario.context.playerRole.experience})`}
                  </span>
                </div>
                <div className="bg-slate-50 text-slate-700 rounded px-2 py-1.5">
                  {scenario.context?.playerRoleText || scenario.context?.playerRole?.responsibility}
                </div>
              </div>
            )}
            {scenario.objectives && scenario.objectives.length > 0 && (
              <div>
                <div className="font-semibold text-blue-600 mb-1.5">🎯 {t('chat.achievementGoals')}</div>
                <div className="space-y-1.5">
                  {scenario.objectives.map((objective: string, index: number) => (
                    <div key={index} className="flex items-start space-x-2">
                      <span className="text-blue-500 text-xs mt-0.5">•</span>
                      <span className="flex-1 text-slate-700">{objective}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="absolute top-4 left-4 z-20 space-y-3 xl:hidden">
      <div className="bg-white/90 backdrop-blur-sm rounded-full px-4 py-2 shadow-lg">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <span className="text-sm font-medium text-slate-700">{personaDept} {personaRole} {personaName}</span>
            {isAdmin && latestEmotion && (
              <span className="text-lg">{emotionEmojis[latestEmotion] || '😐'}</span>
            )}
          </div>
          <div className="flex items-center space-x-2 text-xs text-slate-500">
            <span className="flex items-center" data-testid="text-elapsed-time">
              <i className="fas fa-clock mr-1 text-xs"></i>
              {formatElapsedTime(elapsedTime)}
            </span>
            <span className="text-slate-300">•</span>
          </div>
        </div>
      </div>

      {hasGoals && (
        <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-lg transition-all duration-300 max-w-sm xl:hidden">
          <button
            onClick={onToggleGoals}
            className="w-full p-2 flex items-center justify-between hover:bg-white/90 transition-all duration-200 rounded-lg"
            data-testid="button-toggle-goals"
          >
            <div className="flex items-center space-x-2">
              <i className="fas fa-user-tie text-corporate-600 text-sm"></i>
              <span className="text-sm font-medium text-slate-800">{t('chat.yourRoleAndGoals')}</span>
            </div>
            <i className={`fas ${isGoalsExpanded ? 'fa-chevron-up' : 'fa-chevron-down'} text-slate-600 text-xs transition-transform duration-200`}></i>
          </button>

          {isGoalsExpanded && (
            <div className="px-3 pb-3 border-t border-slate-100/50">
              <div className="text-xs leading-relaxed space-y-3 mt-3">
                {(scenario.context?.playerRoleText || scenario.context?.playerRole?.responsibility) && (
                  <div>
                    <div className="font-semibold text-corporate-600 mb-1.5 flex items-center justify-between">
                      <span>👤 {t('chat.yourRole')}</span>
                      <span className="text-slate-500 font-normal">
                        {scenario.context?.playerRole?.position}
                        {scenario.context?.playerRole?.experience && ` (${scenario.context.playerRole.experience})`}
                      </span>
                    </div>
                    <div className="bg-slate-50 text-slate-700 rounded px-2 py-1.5">
                      {scenario.context?.playerRoleText || scenario.context?.playerRole?.responsibility}
                    </div>
                  </div>
                )}
                {scenario.objectives && scenario.objectives.length > 0 && (
                  <div>
                    <div className="font-semibold text-blue-600 mb-1.5">🎯 {t('chat.achievementGoals')}</div>
                    <div className="space-y-1.5">
                      {scenario.objectives.map((objective: string, index: number) => (
                        <div key={index} className="flex items-start space-x-2">
                          <span className="text-blue-500 text-xs mt-0.5">•</span>
                          <span className="flex-1 text-slate-700">{objective}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
