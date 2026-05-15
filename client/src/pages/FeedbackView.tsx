import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import PersonalDevelopmentReport from "@/components/PersonalDevelopmentReport";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { Users, ArrowRight } from "lucide-react";

interface SwitchLogEntry {
  turn: number;
  fromPersonaIndex: number;
  toPersonaIndex: number;
  fromPersonaId: string;
  toPersonaId: string;
  reason: string;
  transitionLine: string;
  timestamp: string;
}

function PersonaParticipationSummary({ switchLog, scenarioPersonas, totalTurnCount }: { switchLog: SwitchLogEntry[]; scenarioPersonas: any[]; totalTurnCount: number }) {
  const { t } = useTranslation();
  if (!switchLog.length || !scenarioPersonas.length) return null;

  const participantIndices = Array.from(new Set([0, ...switchLog.map(e => e.toPersonaIndex)]));
  const participants = participantIndices.map(i => scenarioPersonas[i]).filter(Boolean);

  // Calculate per-persona turn counts using the switch log
  const personaTurnCounts: Record<number, number> = {};
  const sortedSwitches = [...switchLog].sort((a, b) => a.turn - b.turn);
  let prevTurn = 0;
  let prevIdx = 0;
  for (const sw of sortedSwitches) {
    personaTurnCounts[prevIdx] = (personaTurnCounts[prevIdx] ?? 0) + (sw.turn - prevTurn);
    prevTurn = sw.turn;
    prevIdx = sw.toPersonaIndex;
  }
  personaTurnCounts[prevIdx] = (personaTurnCounts[prevIdx] ?? 0) + (totalTurnCount - prevTurn);

  return (
    <div className="mx-auto max-w-4xl px-4 py-4">
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4 text-indigo-600" />
          <span className="text-sm font-semibold text-indigo-700">
            {t('feedback.personaParticipants', { defaultValue: '대화 참여 페르소나' })}
          </span>
          <Badge variant="outline" className="ml-auto text-xs text-indigo-600 border-indigo-300">
            {participants.length}{t('feedback.personaCount', { defaultValue: '명 참여' })}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {participants.map((p, i) => (
            <div key={p.id || i} className="flex items-center gap-1.5">
              {i > 0 && <ArrowRight className="w-3 h-3 text-indigo-400 flex-shrink-0" />}
              <div className="flex items-center gap-1.5 bg-white border border-indigo-200 rounded-lg px-3 py-1.5 shadow-sm">
                <span className="text-sm font-medium text-slate-700">{p.name}</span>
                {p.position && <span className="text-xs text-slate-400">· {p.position}</span>}
                <span className="text-xs text-indigo-500 font-mono tabular-nums">
                  {personaTurnCounts[participantIndices[i]] ?? 0}{t('feedback.turnsShort', { defaultValue: '턴' })}
                </span>
                {i === 0 && (
                  <Badge variant="outline" className="text-[10px] text-green-600 border-green-300 px-1 py-0 h-4">
                    {t('feedback.primaryPersona', { defaultValue: '시작' })}
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>
        {switchLog.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {switchLog.map((entry, i) => {
              const fromP = scenarioPersonas[entry.fromPersonaIndex];
              const toP = scenarioPersonas[entry.toPersonaIndex];
              return (
                <div key={i} className="flex items-start gap-2 text-xs text-slate-500">
                  <span className="text-indigo-400 font-mono flex-shrink-0">Turn {entry.turn + 1}</span>
                  <span className="flex-shrink-0">{fromP?.name ?? `#${entry.fromPersonaIndex}`}</span>
                  <ArrowRight className="w-3 h-3 flex-shrink-0 mt-0.5 text-indigo-400" />
                  <span className="flex-shrink-0 font-medium text-slate-600">{toP?.name ?? `#${entry.toPersonaIndex}`}</span>
                  {entry.reason && <span className="text-slate-400 italic truncate">— {entry.reason}</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function FeedbackView() {
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const [, params] = useRoute("/feedback/:conversationId");
  const [, navigate] = useLocation();
  const conversationId = params?.conversationId;
  const returnTo = new URLSearchParams(window.location.search).get('returnTo') || null;

  const { data: conversation, isLoading: conversationLoading } = useQuery<any>({
    queryKey: ["/api/conversations", conversationId],
    enabled: !!conversationId,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  });

  const { data: scenario, isLoading: scenarioLoading, isError: scenarioError } = useQuery<any>({
    queryKey: ["/api/scenarios", conversation?.scenarioId],
    enabled: !!conversation?.scenarioId,
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
    retry: false,
  });

  const isLoading = conversationLoading || (scenarioLoading && !scenarioError);

  const { effectiveScenario, effectivePersona, isScenarioMissing } = useMemo(() => {
    if (!conversation) return { effectiveScenario: null, effectivePersona: null, isScenarioMissing: false };

    if (scenario) {
      const persona = scenario.personas?.find((p: any) => p.id === conversation.personaId);
      if (persona) {
        return { effectiveScenario: scenario, effectivePersona: persona, isScenarioMissing: false };
      }
      if (conversation.personaSnapshot) {
        return { effectiveScenario: scenario, effectivePersona: conversation.personaSnapshot, isScenarioMissing: false };
      }
    }

    if (conversation.personaSnapshot || conversation.scenarioName) {
      const fallbackScenario = {
        id: conversation.scenarioId,
        title: conversation.scenarioName || conversation.scenarioId || '삭제된 시나리오',
        description: '',
        difficulty: conversation.difficulty || 2,
        personas: conversation.personaSnapshot ? [conversation.personaSnapshot] : [],
        isDeleted: true,
      };
      const fallbackPersona = conversation.personaSnapshot || {
        id: conversation.personaId,
        name: '알 수 없는 페르소나',
      };
      return { effectiveScenario: fallbackScenario, effectivePersona: fallbackPersona, isScenarioMissing: true };
    }

    return { effectiveScenario: null, effectivePersona: null, isScenarioMissing: true };
  }, [conversation, scenario]);

  if (isLoading || !conversation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">{t('feedback.loading')}</p>
        </div>
      </div>
    );
  }

  if (!effectiveScenario || !effectivePersona) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <p className="text-red-600">{t('feedback.scenarioNotFound')}</p>
          <p className="text-sm text-gray-500 mt-2">
            Scenario ID: {conversation.scenarioId}, Persona ID: {conversation.personaId}
          </p>
          <Button 
            onClick={() => window.location.href = '/mypage'}
            className="mt-4"
          >
            {t('conversation.backToMyPage')}
          </Button>
        </div>
      </div>
    );
  }

  const showDeletedBanner = effectiveScenario.isDeleted || isScenarioMissing;

  const isAdminOrOperator = currentUser?.role === 'admin' || currentUser?.role === 'operator';
  const isViewingOtherUser = isAdminOrOperator && conversation?.userId && conversation.userId !== currentUser?.id;
  const isAdminView = !!isViewingOtherUser;

  const personaSwitchLog: SwitchLogEntry[] = Array.isArray(conversation?.personaSwitchLog) ? conversation.personaSwitchLog : [];
  const scenarioPersonas: any[] = effectiveScenario?.personas ?? [];

  return (
    <div>
      {isAdminView && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 flex items-center justify-between">
          <span className="text-sm text-blue-800">관리자 열람 모드 — 읽기 전용입니다.</span>
          <Button size="sm" variant="outline" onClick={() => returnTo ? navigate(returnTo) : window.history.back()}>뒤로 가기</Button>
        </div>
      )}
      {showDeletedBanner && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-2 text-center">
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 mr-2">삭제된 시나리오</Badge>
          <span className="text-sm text-yellow-800">이 시나리오는 삭제되었지만, 피드백 리포트는 계속 열람할 수 있습니다.</span>
        </div>
      )}
      {personaSwitchLog.length > 0 && (
        <PersonaParticipationSummary switchLog={personaSwitchLog} scenarioPersonas={scenarioPersonas} totalTurnCount={conversation?.turnCount ?? 0} />
      )}
      <PersonalDevelopmentReport
        scenario={effectiveScenario}
        persona={effectivePersona}
        conversationId={conversationId || ""}
        onRetry={() => window.location.reload()}
        onSelectNewScenario={() => window.location.href = '/home'}
        isAdminView={isAdminView}
      />
    </div>
  );
}
