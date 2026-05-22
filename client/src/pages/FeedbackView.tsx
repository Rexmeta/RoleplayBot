import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import PersonalDevelopmentReport from "@/components/PersonalDevelopmentReport";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { Users, ArrowRight, Star, TrendingUp, ThumbsUp, AlertCircle, ChevronRight, Trophy, XCircle, Clock } from "lucide-react";

type TerminationReason = 'success' | 'failure' | 'timeout';

function TerminationOutcomeBanner({ reason }: { reason: TerminationReason }) {
  const { t } = useTranslation();

  const config = {
    success: {
      icon: <Trophy className="w-5 h-5 flex-shrink-0" />,
      label: t('termination.success', '목표 달성'),
      description: t('termination.successDesc', '시나리오 목표를 성공적으로 완료했습니다.'),
      classes: 'bg-emerald-50 border-emerald-300 text-emerald-800',
      badgeClasses: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    },
    failure: {
      icon: <XCircle className="w-5 h-5 flex-shrink-0" />,
      label: t('termination.failure', '시나리오 실패'),
      description: t('termination.failureDesc', '종료 조건(실패)이 발동되어 세션이 종료되었습니다.'),
      classes: 'bg-red-50 border-red-300 text-red-800',
      badgeClasses: 'bg-red-100 text-red-800 border-red-300',
    },
    timeout: {
      icon: <Clock className="w-5 h-5 flex-shrink-0" />,
      label: t('termination.timeout', '시간 제한 도달'),
      description: t('termination.timeoutDesc', '제한 시간(또는 최대 턴 수)에 도달하여 세션이 종료되었습니다.'),
      classes: 'bg-amber-50 border-amber-300 text-amber-800',
      badgeClasses: 'bg-amber-100 text-amber-800 border-amber-300',
    },
  };

  const c = config[reason];
  if (!c) return null;

  return (
    <div className={`border-b px-4 py-3 flex items-center gap-3 ${c.classes}`}>
      {c.icon}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Badge variant="outline" className={`flex-shrink-0 font-semibold ${c.badgeClasses}`}>
          {c.label}
        </Badge>
        <span className="text-sm">{c.description}</span>
      </div>
    </div>
  );
}

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
                <div key={i} className="space-y-0.5">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="text-indigo-400 font-mono flex-shrink-0">Turn {entry.turn + 1}</span>
                    <span className="flex-shrink-0">{fromP?.name ?? `#${entry.fromPersonaIndex}`}</span>
                    <ArrowRight className="w-3 h-3 flex-shrink-0 text-indigo-400" />
                    <span className="flex-shrink-0 font-medium text-slate-600">{toP?.name ?? `#${entry.toPersonaIndex}`}</span>
                    {entry.reason && <span className="text-slate-400 italic truncate">· {entry.reason}</span>}
                  </div>
                  {entry.transitionLine && (
                    <div className="ml-16 text-xs text-slate-500 bg-white border border-indigo-100 rounded px-2 py-1 italic">
                      "{entry.transitionLine}"
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

interface PersonaSegmentFeedback {
  personaIndex: number;
  personaName: string;
  turnStart: number;
  turnEnd: number;
  feedback: {
    overallScore: number | null;
    summary: string;
    strengths: string[];
    improvements: string[];
    nextSteps: string[];
  };
}

function PersonaSegmentFeedbackPanel({ segments }: { segments: PersonaSegmentFeedback[] }) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-4xl px-4 py-6 space-y-6">
      {segments.map((seg, i) => (
        <div key={i} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-slate-200 px-5 py-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
              {seg.personaIndex + 1}
            </div>
            <div>
              <div className="font-semibold text-slate-800 text-sm">{seg.personaName}</div>
              <div className="text-xs text-slate-500">
                {t('feedback.segment.turns', { defaultValue: `Turn ${seg.turnStart + 1} – ${seg.turnEnd + 1}` })}
              </div>
            </div>
            {seg.feedback.overallScore != null && (
              <div className="ml-auto flex items-center gap-1">
                <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                <span className="text-lg font-bold text-slate-800">{seg.feedback.overallScore}</span>
                <span className="text-xs text-slate-400">/100</span>
              </div>
            )}
          </div>
          <div className="p-5 space-y-4">
            {seg.feedback.summary && (
              <p className="text-sm text-slate-600 leading-relaxed">{seg.feedback.summary}</p>
            )}
            {seg.feedback.strengths.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 text-green-700 font-medium text-xs mb-2">
                  <ThumbsUp className="w-3.5 h-3.5" />
                  {t('feedback.segment.strengths', { defaultValue: '잘한 점' })}
                </div>
                <ul className="space-y-1">
                  {seg.feedback.strengths.map((s, j) => (
                    <li key={j} className="flex items-start gap-2 text-sm text-slate-700">
                      <ChevronRight className="w-3.5 h-3.5 text-green-500 mt-0.5 flex-shrink-0" />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {seg.feedback.improvements.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 text-amber-700 font-medium text-xs mb-2">
                  <TrendingUp className="w-3.5 h-3.5" />
                  {t('feedback.segment.improvements', { defaultValue: '개선할 점' })}
                </div>
                <ul className="space-y-1">
                  {seg.feedback.improvements.map((s, j) => (
                    <li key={j} className="flex items-start gap-2 text-sm text-slate-700">
                      <ChevronRight className="w-3.5 h-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {seg.feedback.nextSteps.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 text-blue-700 font-medium text-xs mb-2">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {t('feedback.segment.nextSteps', { defaultValue: '다음 단계' })}
                </div>
                <ul className="space-y-1">
                  {seg.feedback.nextSteps.map((s, j) => (
                    <li key={j} className="flex items-start gap-2 text-sm text-slate-700">
                      <ChevronRight className="w-3.5 h-3.5 text-blue-500 mt-0.5 flex-shrink-0" />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      ))}
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

  const { data: feedbackResult } = useQuery<any>({
    queryKey: ["/api/conversations", conversationId, "feedback"],
    enabled: !!conversationId,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
    retry: false,
  });

  const personaSegmentFeedbacks: PersonaSegmentFeedback[] =
    Array.isArray(feedbackResult?.detailedFeedback?.personaSegmentFeedbacks)
      ? feedbackResult.detailedFeedback.personaSegmentFeedbacks
      : [];

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

  const terminationReason = (conversation?.simulationState?.terminationReason ?? null) as TerminationReason | null;

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
      {terminationReason && <TerminationOutcomeBanner reason={terminationReason} />}
      {personaSwitchLog.length > 0 && (
        <PersonaParticipationSummary switchLog={personaSwitchLog} scenarioPersonas={scenarioPersonas} totalTurnCount={conversation?.turnCount ?? 0} />
      )}
      {personaSegmentFeedbacks.length > 0 ? (
        <Tabs defaultValue="overall" className="w-full">
          <div className="sticky top-0 z-10 bg-white border-b border-slate-200 shadow-sm">
            <div className="mx-auto max-w-4xl px-4">
              <TabsList className="h-11 bg-transparent border-none gap-0 p-0">
                <TabsTrigger
                  value="overall"
                  className="h-11 px-5 rounded-none border-b-2 border-transparent data-[state=active]:border-indigo-600 data-[state=active]:text-indigo-700 data-[state=active]:bg-transparent text-sm font-medium text-slate-500"
                >
                  전체 종합
                </TabsTrigger>
                <TabsTrigger
                  value="per-persona"
                  className="h-11 px-5 rounded-none border-b-2 border-transparent data-[state=active]:border-indigo-600 data-[state=active]:text-indigo-700 data-[state=active]:bg-transparent text-sm font-medium text-slate-500"
                >
                  <Users className="w-3.5 h-3.5 mr-1.5" />
                  페르소나별
                  <Badge variant="outline" className="ml-1.5 text-[10px] px-1.5 py-0 h-4 border-indigo-300 text-indigo-600">
                    {personaSegmentFeedbacks.length}
                  </Badge>
                </TabsTrigger>
              </TabsList>
            </div>
          </div>
          <TabsContent value="overall" className="mt-0">
            <PersonalDevelopmentReport
              scenario={effectiveScenario}
              persona={effectivePersona}
              conversationId={conversationId || ""}
              onRetry={() => window.location.reload()}
              onSelectNewScenario={() => window.location.href = '/home'}
              isAdminView={isAdminView}
            />
          </TabsContent>
          <TabsContent value="per-persona" className="mt-0">
            <PersonaSegmentFeedbackPanel segments={personaSegmentFeedbacks} />
          </TabsContent>
        </Tabs>
      ) : (
        <PersonalDevelopmentReport
          scenario={effectiveScenario}
          persona={effectivePersona}
          conversationId={conversationId || ""}
          onRetry={() => window.location.reload()}
          onSelectNewScenario={() => window.location.href = '/home'}
          isAdminView={isAdminView}
        />
      )}
    </div>
  );
}
