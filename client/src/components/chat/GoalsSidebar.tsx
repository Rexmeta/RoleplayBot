import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Brain, ChevronDown, Target, UserRound } from "lucide-react";
import { formatElapsedTime } from "@/hooks/chat/useConversationTimer";
import type { ComplexScenario } from "@/lib/scenario-system";
import SimulationPanel, { STAGE_COLORS, EMOTION_COLORS } from "@/components/SimulationPanel";
import type { SimulationState, Incident, TurnScore, NpcAffectiveState } from "@/hooks/useSimulationState";

const STAGE_TEXT_COLORS: Record<string, string> = {
  intro: 'text-blue-600',
  conflict: 'text-yellow-600',
  negotiation: 'text-orange-600',
  escalation: 'text-red-600',
  resolution: 'text-green-600',
};

const STAGE_BG_COLORS: Record<string, string> = {
  intro: 'bg-blue-50 border-blue-200',
  conflict: 'bg-yellow-50 border-yellow-200',
  negotiation: 'bg-orange-50 border-orange-200',
  escalation: 'bg-red-50 border-red-200',
  resolution: 'bg-green-50 border-green-200',
};


function getDominantAffective(npcAffectiveState: NpcAffectiveState): { key: string; value: number } | null {
  const flat: Record<string, number> = {
    intensity: npcAffectiveState.affective.intensity,
    confusion: npcAffectiveState.cognitive.confusion,
    trust: npcAffectiveState.relational.trust,
    interest: npcAffectiveState.motivational.interest,
  };
  const entries = Object.entries(flat);
  return entries.reduce((best, [key, value]) => (value > best.value ? { key, value } : best), { key: entries[0][0], value: entries[0][1] });
}

function NpcCollapsedPreview({ simulationState }: { simulationState: SimulationState }) {
  const { t } = useTranslation();
  const { stage, npcAffectiveState } = simulationState;
  const dominant = npcAffectiveState ? getDominantAffective(npcAffectiveState) : null;
  const stageDotColor = STAGE_COLORS[stage] ?? 'bg-slate-400';
  const stageTextColor = STAGE_TEXT_COLORS[stage] ?? 'text-slate-600';
  const stageBgColor = STAGE_BG_COLORS[stage] ?? 'bg-slate-50 border-slate-200';
  const stageLabel = t(`simulation.stages.${stage}`, { defaultValue: stage });

  return (
    <div className="flex items-center gap-1.5 ml-1">
      <span className={`inline-flex items-center gap-1 border rounded px-1.5 py-0.5 text-[10px] font-medium leading-none ${stageBgColor} ${stageTextColor}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${stageDotColor}`} />
        {stageLabel}
      </span>
      {dominant && (
        <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 leading-none">
          <span className={`w-2 h-2 rounded-full ${EMOTION_COLORS[dominant.key] ?? 'bg-slate-400'}`} />
          <span>{t(`simulation.affectiveState.${dominant.key}`, { defaultValue: dominant.key })}</span>
          <span className="font-mono text-slate-400">{dominant.value}%</span>
        </span>
      )}
    </div>
  );
}

type DesktopSection = 'role' | 'goals' | 'npc';

interface DesktopAccordionSectionProps {
  id: DesktopSection;
  className?: string;
  title: React.ReactNode;
  titleTrailing?: React.ReactNode;
  summary: React.ReactNode;
  icon: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  bodyClassName?: string;
}

function DesktopAccordionSection({
  id,
  className = '',
  title,
  titleTrailing,
  summary,
  icon,
  isOpen,
  onToggle,
  children,
  bodyClassName = '',
}: DesktopAccordionSectionProps) {
  const bodyId = `desktop-info-${id}-body`;

  return (
    <section className={`bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden shrink-0 ${className}`}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-corporate-500 transition-colors duration-200"
        aria-expanded={isOpen}
        aria-controls={bodyId}
        data-testid={`desktop-info-section-${id}-toggle`}
      >
        <span className="text-slate-600 shrink-0" aria-hidden="true">{icon}</span>
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold text-slate-800 shrink-0">{title}</span>
            {titleTrailing}
            <span className="min-w-0 truncate">{summary}</span>
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 text-slate-500 shrink-0 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      {isOpen && (
        <div id={bodyId} className={`border-t border-slate-100 ${bodyClassName}`} data-testid={`desktop-info-section-${id}-body`}>
          {children}
        </div>
      )}
    </section>
  );
}

interface GoalsSidebarProps {
  scenario: ComplexScenario;
  personaName: string;
  personaDept?: string;
  personaRole?: string;
  elapsedTime: number;
  isGoalsExpanded: boolean;
  onToggleGoals: () => void;
  variant: 'sidebar' | 'overlay';
  isSimulationEnabled?: boolean;
  simulationState?: SimulationState | null;
  newIncident?: Incident | null;
  latestTurnScore?: TurnScore | null;
  evaluationSkipped?: boolean;
  hasActiveIncident?: boolean;
  desktopSection?: DesktopSection | null;
  onToggleDesktopSection?: (section: DesktopSection | null) => void;
}

export function GoalsSidebar({
  scenario,
  personaName,
  personaDept,
  personaRole,
  elapsedTime,
  isGoalsExpanded,
  onToggleGoals,
  variant,
  isSimulationEnabled,
  simulationState,
  newIncident,
  latestTurnScore,
  evaluationSkipped,
  hasActiveIncident,
  desktopSection = 'goals',
  onToggleDesktopSection,
}: GoalsSidebarProps) {
  const { t } = useTranslation();
  const npcBodyRef = useRef<HTMLDivElement>(null);
  const role = scenario.context?.playerRole;
  const hasRole = !!(scenario.context?.playerRoleText || role?.responsibility || role?.position);
  const objectives = scenario.objectives ?? [];
  const hasObjectives = objectives.length > 0;
  const toggleDesktopSection = (section: DesktopSection) => {
    onToggleDesktopSection?.(desktopSection === section ? null : section);
  };

  const rolePosition = role?.position || personaRole || t('common.unknown', { defaultValue: '—' });
  const personaIdentityLabel = [personaDept || personaRole, personaName]
    .filter(Boolean)
    .join(' ') || t('common.unknown', { defaultValue: '—' });
  const roleSummary = (
    <span className="text-[11px] text-slate-500 font-normal truncate">
      {rolePosition}
    </span>
  );
  const goalsSummary = (
    <span className="text-[11px] text-blue-600 font-normal whitespace-nowrap">
      {t('chat.goalCount', { count: objectives.length })}
    </span>
  );
  const npcSummary = simulationState ? (
    <NpcCollapsedPreview simulationState={simulationState} />
  ) : (
    <span className="text-[11px] text-slate-400 font-normal">
      {t('chat.waiting', { defaultValue: '...' })}
    </span>
  );

  if (variant === 'sidebar') {
    return (
      <div className="hidden lg:flex flex-col w-[480px] 2xl:w-[560px] bg-gradient-to-b from-slate-50 to-slate-100 border-r border-slate-200 p-4 z-30 h-full overflow-hidden">
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
          {hasRole && (
            <DesktopAccordionSection
              id="role"
              className="order-2"
              title={t('chat.yourRole')}
              summary={roleSummary}
              icon={<UserRound className="h-4 w-4" />}
              isOpen={desktopSection === 'role'}
              onToggle={() => toggleDesktopSection('role')}
            >
              <div className="p-4 space-y-2 text-xs leading-relaxed max-h-48 overflow-y-auto">
                <div className="flex items-center justify-between gap-2 text-corporate-600 font-semibold">
                  <span>{t('chat.roleDetails')}</span>
                  <span className="text-slate-500 font-normal text-right">
                    {role?.position || personaRole}
                    {role?.experience && ` (${role.experience})`}
                  </span>
                </div>
                {role?.department && (
                  <div className="text-slate-500">{role.department}</div>
                )}
                <div className="bg-slate-50 text-slate-700 rounded px-2 py-1.5">
                  {scenario.context?.playerRoleText || role?.responsibility}
                </div>
              </div>
            </DesktopAccordionSection>
          )}

          {hasObjectives && (
            <DesktopAccordionSection
              id="goals"
              className="order-3"
              title={t('chat.achievementGoals')}
              summary={goalsSummary}
              icon={<Target className="h-4 w-4" />}
              isOpen={desktopSection === 'goals'}
              onToggle={() => toggleDesktopSection('goals')}
            >
              <div className="p-4 text-xs leading-relaxed max-h-64 overflow-y-auto">
                <div className="space-y-2">
                  {objectives.map((objective: string, index: number) => (
                    <div key={index} className="flex items-start gap-2">
                      <span className="text-blue-500 text-xs mt-0.5" aria-hidden="true">•</span>
                      <span className="flex-1 text-slate-700">{objective}</span>
                    </div>
                  ))}
                </div>
              </div>
            </DesktopAccordionSection>
          )}

          {isSimulationEnabled && (
            <DesktopAccordionSection
              id="npc"
              className="order-1"
              title={personaIdentityLabel}
              titleTrailing={
                <span className="flex items-center gap-1 text-xs font-normal text-slate-500 whitespace-nowrap" data-testid="text-elapsed-time-sidebar">
                  <i className="fas fa-clock" aria-hidden="true"></i>
                  {formatElapsedTime(elapsedTime)}
                </span>
              }
              summary={
                <span className="flex items-center min-w-0">
                  {hasActiveIncident && (
                    <span
                      className="w-2 h-2 bg-orange-400 rounded-full animate-pulse shrink-0 mr-1.5"
                      title={t('chat.activeIncident')}
                      aria-label={t('chat.activeIncident')}
                    />
                  )}
                  {npcSummary}
                </span>
              }
              icon={<Brain className="h-4 w-4" />}
              isOpen={desktopSection === 'npc'}
              onToggle={() => toggleDesktopSection('npc')}
              bodyClassName="pb-2"
            >
              <div ref={npcBodyRef} className="max-h-[min(55vh,28rem)] overflow-y-auto">
                {simulationState ? (
                  <SimulationPanel
                    state={simulationState}
                    newIncident={newIncident}
                    latestTurnScore={latestTurnScore}
                    evaluationSkipped={evaluationSkipped}
                    hasActiveIncident={hasActiveIncident}
                    isVisible={desktopSection === 'npc'}
                    className="border-0 rounded-none bg-transparent"
                  />
                ) : (
                  <div className="px-4 py-3 text-xs text-slate-400 text-center">
                    {t('simulation.waitingForData', { defaultValue: 'Waiting for NPC data...' })}
                  </div>
                )}
              </div>
            </DesktopAccordionSection>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="absolute top-16 left-4 z-20 space-y-3 lg:hidden" style={{ maxWidth: 'min(100vw - 32px, 384px)' }}>
      {(hasRole || hasObjectives) && (
        <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-lg transition-all duration-300 lg:hidden">
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
