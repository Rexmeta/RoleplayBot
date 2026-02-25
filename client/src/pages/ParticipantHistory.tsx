import { useState, useMemo, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  CalendarDays, Star, Users, ArrowLeft, Target, Lightbulb,
  CheckCircle, AlertCircle, ArrowRight, History, Award
} from "lucide-react";
import { format } from "date-fns";
import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/hooks/useAuth";
import { type ScenarioRun, type PersonaRun } from "@shared/schema";

export default function ParticipantHistory() {
  const [, params] = useRoute("/admin/participant/:userId");
  const [, navigate] = useLocation();
  const { user: currentUser } = useAuth();
  const userId = params?.userId;

  const [strategyDialogRunId, setStrategyDialogRunId] = useState<string | null>(null);

  const token = localStorage.getItem("authToken");
  const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const { data: rawScenarioRuns = [], isLoading: runsLoading } = useQuery<(ScenarioRun & { personaRuns: PersonaRun[]; isScenarioDeleted?: boolean })[]>({
    queryKey: ["/api/admin/users", userId, "scenario-runs"],
    queryFn: () => fetch(`/api/admin/users/${userId}/scenario-runs`, { credentials: "include", headers: authHeaders }).then(r => r.json()),
    enabled: !!userId,
    staleTime: 1000 * 60 * 5,
  });

  const { data: feedbacks = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/users", userId, "feedbacks"],
    queryFn: () => fetch(`/api/admin/users/${userId}/feedbacks`, { credentials: "include", headers: authHeaders }).then(r => r.json()),
    enabled: !!userId,
    staleTime: 1000 * 60 * 5,
  });

  const { data: scenarios = [] } = useQuery<any[]>({
    queryKey: ["/api/scenarios"],
    staleTime: 1000 * 60 * 30,
  });

  const scenariosMap = useMemo(() => new Map(scenarios.map((s: any) => [s.id, s])), [scenarios]);

  const scenarioRuns = useMemo(() => {
    if (!feedbacks.length) return rawScenarioRuns;
    const feedbackScores: Record<string, number> = {};
    feedbacks.forEach((f: any) => {
      if (f.personaRunId) feedbackScores[f.personaRunId] = f.overallScore || 0;
    });
    return rawScenarioRuns.map(sr => ({
      ...sr,
      personaRuns: (sr.personaRuns || []).map(pr => ({
        ...pr,
        score: pr.score !== null ? pr.score : (feedbackScores[pr.id] || null),
      })),
    }));
  }, [rawScenarioRuns, feedbacks]);

  const scenarioAttemptNumbers = useMemo(() => {
    const attemptMap = new Map<string, number>();
    const counters = new Map<string, number>();
    [...scenarioRuns]
      .filter(sr => sr.personaRuns && sr.personaRuns.length > 0)
      .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())
      .forEach(run => {
        const n = (counters.get(run.scenarioId) || 0) + 1;
        counters.set(run.scenarioId, n);
        attemptMap.set(run.id, n);
      });
    return attemptMap;
  }, [scenarioRuns]);

  const displayable = useMemo(() =>
    scenarioRuns
      .filter(sr => sr.personaRuns && sr.personaRuns.length > 0)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()),
    [scenarioRuns]
  );

  const getScenarioInfo = useCallback((scenarioId: string) => {
    const s = scenariosMap.get(scenarioId);
    return { title: s?.title || scenarioId, difficulty: s?.difficulty || 1, personas: s?.personas || [] };
  }, [scenariosMap]);

  const getScoreGrade = (score: number) => {
    if (score >= 90) return { grade: "S", color: "text-purple-600 bg-purple-100", label: "탁월함" };
    if (score >= 80) return { grade: "A", color: "text-green-600 bg-green-100", label: "우수함" };
    if (score >= 70) return { grade: "B", color: "text-blue-600 bg-blue-100", label: "양호함" };
    if (score >= 60) return { grade: "C", color: "text-yellow-600 bg-yellow-100", label: "보통" };
    return { grade: "D", color: "text-red-600 bg-red-100", label: "개선 필요" };
  };

  const totalCompleted = scenarioRuns.filter(sr => sr.status === "completed").length;
  const allPersonaRuns = scenarioRuns.flatMap(sr => sr.personaRuns || []);
  const scoredRuns = allPersonaRuns.filter(pr => pr.score !== null && pr.score !== undefined);
  const avgScore = scoredRuns.length > 0
    ? Math.round(scoredRuns.reduce((acc, pr) => acc + (pr.score || 0), 0) / scoredRuns.length)
    : null;

  const participantName = (rawScenarioRuns[0] as any)?.userName || userId;

  if (!currentUser || (currentUser.role !== "admin" && currentUser.role !== "operator")) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-red-600">접근 권한이 없습니다.</p>
      </div>
    );
  }

  if (runsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-corporate-600 mx-auto mb-4"></div>
          <p className="text-slate-600">데이터를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  const strategyRun = strategyDialogRunId ? scenarioRuns.find(sr => sr.id === strategyDialogRunId) : null;
  const sequenceAnalysis = strategyRun?.sequenceAnalysis as any;

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader
        variant="mypage"
        userName={currentUser.name || currentUser.email}
        userEmail={currentUser.email}
        rightContent={
          <Button
            variant="outline"
            onClick={() => navigate("/admin")}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            대시보드로 돌아가기
          </Button>
        }
      />

      <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <History className="w-6 h-6 text-corporate-600" />
              참석자 훈련 이력
            </h1>
            <p className="text-slate-500 mt-1">사용자: <span className="font-semibold text-slate-700">{participantName}</span></p>
          </div>
          <div className="flex gap-4">
            <div className="text-center p-3 bg-white rounded-lg border">
              <div className="text-2xl font-bold text-corporate-600">{displayable.length}</div>
              <div className="text-xs text-slate-500">전체 세션</div>
            </div>
            <div className="text-center p-3 bg-white rounded-lg border">
              <div className="text-2xl font-bold text-green-600">{totalCompleted}</div>
              <div className="text-xs text-slate-500">완료 세션</div>
            </div>
            {avgScore !== null && (
              <div className="text-center p-3 bg-white rounded-lg border">
                <div className="text-2xl font-bold text-blue-600">{avgScore}점</div>
                <div className="text-xs text-slate-500">평균 점수</div>
              </div>
            )}
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold text-slate-700 flex items-center gap-2">
              <Award className="w-4 h-4 text-corporate-600" />
              대화 기록 ({displayable.length}개)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {displayable.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                <History className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>아직 훈련 기록이 없습니다.</p>
              </div>
            ) : (
              <Accordion type="multiple" className="w-full">
                {displayable.map(scenarioRun => {
                  const scenarioInfo = getScenarioInfo(scenarioRun.scenarioId);
                  const attemptNumber = scenarioAttemptNumbers.get(scenarioRun.id) || 1;
                  const hasMultiplePersonas = scenarioInfo.personas?.length > 1;
                  const isCompleted = hasMultiplePersonas
                    ? scenarioRun.status === "completed" && !!scenarioRun.strategyReflection
                    : scenarioRun.status === "completed";
                  const personaRuns = scenarioRun.personaRuns || [];
                  const runScores = personaRuns.filter(pr => pr.score !== null && pr.score !== undefined);
                  const runAvg = runScores.length > 0
                    ? Math.round(runScores.reduce((a, pr) => a + (pr.score || 0), 0) / runScores.length)
                    : null;

                  return (
                    <AccordionItem key={scenarioRun.id} value={scenarioRun.id}>
                      <AccordionTrigger className="hover:no-underline">
                        <div className="flex items-center gap-3 flex-wrap text-left">
                          <CalendarDays className="w-4 h-4 text-slate-400 shrink-0" />
                          <span className="text-sm text-slate-500">
                            {format(new Date(scenarioRun.startedAt), "yyyy년 MM월 dd일 HH:mm")}
                          </span>
                          <span className="font-semibold text-slate-900">{scenarioInfo.title}</span>
                          <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                            난이도 {scenarioRun.difficulty || scenarioInfo.difficulty}
                          </Badge>
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                            #{attemptNumber}회 시도
                          </Badge>
                          {(scenarioRun as any).isScenarioDeleted && (
                            <Badge variant="outline" className="bg-red-50 text-red-600 border-red-200">삭제된 시나리오</Badge>
                          )}
                          {isCompleted ? (
                            <Badge className="bg-green-600">완료</Badge>
                          ) : (
                            <Badge className="bg-yellow-600">진행 중</Badge>
                          )}
                          {runAvg !== null && (
                            <span className={`text-sm font-bold ${runAvg >= 80 ? "text-green-600" : runAvg >= 60 ? "text-yellow-600" : "text-red-500"}`}>
                              {runAvg}점
                            </span>
                          )}
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-4 pt-3">
                          {scenarioRun.strategyReflection && (
                            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex-1">
                                  <h5 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                                    <Target className="w-4 h-4 text-green-600" />
                                    전략 회고
                                  </h5>
                                  <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">
                                    {scenarioRun.strategyReflection}
                                  </p>
                                </div>
                                {sequenceAnalysis && strategyDialogRunId === scenarioRun.id ? null : (
                                  scenarioRun.sequenceAnalysis && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => setStrategyDialogRunId(scenarioRun.id)}
                                      className="text-xs shrink-0 border-purple-300 text-purple-700 hover:bg-purple-50"
                                    >
                                      <Lightbulb className="w-3 h-3 mr-1" />
                                      AI 전략 평가
                                    </Button>
                                  )
                                )}
                              </div>
                            </div>
                          )}

                          {(scenarioRun as any).isScenarioDeleted && (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                              <div className="flex items-center gap-2 text-red-700 text-sm">
                                <AlertCircle className="w-4 h-4 shrink-0" />
                                이 시나리오는 삭제되었습니다. 대화 기록과 피드백은 계속 열람 가능합니다.
                              </div>
                            </div>
                          )}

                          <div className="space-y-2">
                            <h5 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                              <Users className="w-4 h-4 text-blue-600" />
                              페르소나 목록 ({personaRuns.length}개)
                            </h5>
                            <div className="space-y-2">
                              {personaRuns.map(pr => {
                                const isRunCompleted = pr.status === "completed";
                                const isRunActive = pr.status === "active";
                                const snapshot = pr.personaSnapshot as any;
                                const matchedPersona = scenarioInfo.personas?.find((p: any) => p.id === pr.personaId);
                                const displayName = matchedPersona
                                  ? `${matchedPersona.department ? matchedPersona.department + " " : ""}${matchedPersona.name}${matchedPersona.position ? " " + matchedPersona.position : ""}`
                                  : (pr.personaName || snapshot?.name || pr.personaId);

                                return (
                                  <div
                                    key={pr.id}
                                    className="flex items-center justify-between p-3 bg-white border rounded-lg hover:bg-slate-50"
                                  >
                                    <div className="flex items-center gap-3">
                                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                                        isRunCompleted ? "bg-green-100 text-green-600" :
                                        isRunActive ? "bg-yellow-100 text-yellow-600" :
                                        "bg-gray-100 text-gray-600"
                                      }`}>
                                        {pr.phase || "?"}
                                      </div>
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-medium text-slate-900">{displayName}</span>
                                        {(pr.mbtiType || matchedPersona?.mbti) && (
                                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                                            {pr.mbtiType || matchedPersona?.mbti}
                                          </Badge>
                                        )}
                                        <Badge variant="outline" className="text-xs">{pr.turnCount}턴</Badge>
                                        <Badge className={
                                          isRunCompleted ? "bg-green-600" :
                                          isRunActive ? "bg-yellow-600" : "bg-gray-400"
                                        }>
                                          {isRunCompleted ? "완료" : isRunActive ? "진행 중" : "시작 전"}
                                        </Badge>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                      {pr.score !== null && pr.score !== undefined && (
                                        <div className="flex items-center gap-1">
                                          <Star className="w-4 h-4 text-yellow-500" />
                                          <span className={`font-semibold text-sm ${
                                            pr.score >= 80 ? "text-green-600" :
                                            pr.score >= 60 ? "text-yellow-600" : "text-red-600"
                                          }`}>
                                            {pr.score}점
                                          </span>
                                        </div>
                                      )}
                                      <div className="flex gap-2">
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => navigate(`/chat/${pr.id}?returnTo=/admin/participant/${userId}`)}
                                        >
                                          대화 보기
                                        </Button>
                                        {isRunCompleted && (
                                          <Button
                                            variant="default"
                                            size="sm"
                                            className="bg-corporate-600 hover:bg-corporate-700"
                                            onClick={() => navigate(`/feedback/${pr.id}?returnTo=/admin/participant/${userId}`)}
                                          >
                                            피드백 보기
                                          </Button>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            )}
          </CardContent>
        </Card>
      </main>

      {/* AI 전략 평가 다이얼로그 */}
      <Dialog open={!!strategyDialogRunId} onOpenChange={open => !open && setStrategyDialogRunId(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Lightbulb className="w-5 h-5 text-purple-600" />
              AI 전략 평가
            </DialogTitle>
          </DialogHeader>
          {sequenceAnalysis && (
            <div className="space-y-6 mt-4">
              {sequenceAnalysis.strategicScore !== undefined && (
                <div className="text-center p-6 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl border border-purple-200">
                  <div className="text-5xl font-bold text-purple-700 mb-2">
                    {sequenceAnalysis.strategicScore}
                    <span className="text-2xl text-purple-500">/100</span>
                  </div>
                  <Badge className={`${getScoreGrade(sequenceAnalysis.strategicScore).color} text-sm px-3 py-1`}>
                    {getScoreGrade(sequenceAnalysis.strategicScore).label}
                  </Badge>
                </div>
              )}
              {sequenceAnalysis.strategicRationale && (
                <div className="p-4 bg-slate-50 rounded-lg border">
                  <h4 className="font-semibold text-slate-800 mb-2 flex items-center gap-2">
                    <Target className="w-4 h-4" />전략적 근거
                  </h4>
                  <p className="text-sm text-slate-600 whitespace-pre-wrap">{sequenceAnalysis.strategicRationale}</p>
                </div>
              )}
              {sequenceAnalysis.sequenceEffectiveness && (
                <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <h4 className="font-semibold text-blue-800 mb-2 flex items-center gap-2">
                    <ArrowRight className="w-4 h-4" />대화 순서 효과성
                  </h4>
                  <p className="text-sm text-blue-700 whitespace-pre-wrap">{sequenceAnalysis.sequenceEffectiveness}</p>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {sequenceAnalysis.strengths?.length > 0 && (
                  <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                    <h4 className="font-semibold text-green-800 mb-3 flex items-center gap-2">
                      <CheckCircle className="w-4 h-4" />강점
                    </h4>
                    <ul className="space-y-1">
                      {sequenceAnalysis.strengths.map((s: string, i: number) => (
                        <li key={i} className="text-sm text-green-700 flex gap-2"><span>•</span><span>{s}</span></li>
                      ))}
                    </ul>
                  </div>
                )}
                {sequenceAnalysis.improvements?.length > 0 && (
                  <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
                    <h4 className="font-semibold text-amber-800 mb-3 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4" />개선점
                    </h4>
                    <ul className="space-y-1">
                      {sequenceAnalysis.improvements.map((s: string, i: number) => (
                        <li key={i} className="text-sm text-amber-700 flex gap-2"><span>•</span><span>{s}</span></li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              {sequenceAnalysis.strategicInsights && (
                <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
                  <h4 className="font-semibold text-purple-800 mb-2 flex items-center gap-2">
                    <Star className="w-4 h-4" />전략적 통찰
                  </h4>
                  <p className="text-sm text-purple-700 whitespace-pre-wrap">{sequenceAnalysis.strategicInsights}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
