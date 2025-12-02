import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CalendarDays, Star, TrendingUp, MessageSquare, Award, History, BarChart3, Users, Target, Trash2, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { type ScenarioRun, type PersonaRun, type Feedback } from "@shared/schema";
import { format } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { StrategyReflection } from "@/components/StrategyReflection";

export default function MyPage() {
  const [selectedView, setSelectedView] = useState<"history" | "stats">("history");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [scenarioRunToDelete, setScenarioRunToDelete] = useState<string | null>(null);
  const [strategyReflectionRunId, setStrategyReflectionRunId] = useState<string | null>(null);
  const { user } = useAuth();
  const { toast } = useToast();

  // 사용자의 시나리오 실행 기록 조회 (personaRuns 포함)
  const { data: scenarioRuns = [], isLoading: scenarioRunsLoading } = useQuery<(ScenarioRun & { personaRuns: PersonaRun[] })[]>({
    queryKey: ['/api/scenario-runs'],
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  });

  // 시나리오 데이터 조회
  const { data: scenarios = [] } = useQuery<any[]>({
    queryKey: ['/api/scenarios'],
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
  });

  // 시나리오 Map
  const scenariosMap = useMemo(() => 
    new Map(scenarios.map(s => [s.id, s])),
    [scenarios]
  );

  // 통계 계산
  const stats = useMemo(() => {
    const completedRuns = scenarioRuns.filter(sr => sr.status === 'completed');
    
    // ✨ personaRuns의 평균 점수 계산
    const allPersonaRuns = scenarioRuns.flatMap(sr => sr.personaRuns || []);
    const completedPersonaRuns = allPersonaRuns.filter(pr => pr.status === 'completed' && pr.score !== null && pr.score !== undefined);
    const averageScore = completedPersonaRuns.length > 0
      ? Math.round(completedPersonaRuns.reduce((sum, pr) => sum + (pr.score || 0), 0) / completedPersonaRuns.length)
      : 0;
    
    console.log('📊 MyPage Stats Debug:', {
      totalScenarioRuns: scenarioRuns.length,
      completedScenarioRuns: completedRuns.length,
      allPersonaRuns: allPersonaRuns.length,
      completedPersonaRuns: completedPersonaRuns.length,
      averageScore,
      personaRunsData: allPersonaRuns.slice(0, 3).map(pr => ({ status: pr.status, score: pr.score }))
    });
    
    return {
      totalScenarioRuns: scenarioRuns.length,
      completedScenarioRuns: completedRuns.length,
      averageScore,
      totalFeedbacks: completedPersonaRuns.length, // 완료된 persona run = feedback
    };
  }, [scenarioRuns]);

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-green-600";
    if (score >= 60) return "text-yellow-600";
    return "text-red-600";
  };

  const getScoreBadge = (score: number) => {
    if (score >= 80) return "우수";
    if (score >= 60) return "보통";
    return "개선 필요";
  };

  // 시나리오 실행 삭제 mutation
  const deleteMutation = useMutation({
    mutationFn: async (scenarioRunId: string) => {
      return await apiRequest('DELETE', `/api/scenario-runs/${scenarioRunId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/scenario-runs'] });
      toast({
        title: "삭제 완료",
        description: "시나리오 실행 기록이 삭제되었습니다.",
      });
      setDeleteDialogOpen(false);
      setScenarioRunToDelete(null);
    },
    onError: (error) => {
      console.error("삭제 실패:", error);
      toast({
        title: "삭제 실패",
        description: "시나리오 실행 기록을 삭제할 수 없습니다.",
        variant: "destructive",
      });
    },
  });

  const handleDeleteClick = (scenarioRunId: string, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    setScenarioRunToDelete(scenarioRunId);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (scenarioRunToDelete) {
      deleteMutation.mutate(scenarioRunToDelete);
    }
  };

  // 전략 회고 제출 mutation
  const submitStrategyReflectionMutation = useMutation({
    mutationFn: async ({ runId, reflection, personaIds }: { runId: string; reflection: string; personaIds: string[] }) => {
      return await apiRequest('POST', `/api/scenario-runs/${runId}/strategy-reflection`, {
        strategyReflection: reflection,
        conversationOrder: personaIds
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/scenario-runs'] });
      toast({
        title: "전략 회고 제출 완료",
        description: "전략 회고가 성공적으로 저장되었습니다.",
      });
      setStrategyReflectionRunId(null);
    },
    onError: (error) => {
      console.error("전략 회고 제출 실패:", error);
      toast({
        title: "제출 실패",
        description: "전략 회고를 저장할 수 없습니다.",
        variant: "destructive",
      });
    },
  });

  // 시나리오 정보 가져오기
  const getScenarioInfo = (scenarioId: string) => {
    const scenario = scenariosMap.get(scenarioId);
    return {
      title: scenario?.title || scenarioId,
      difficulty: scenario?.difficulty || 1,
      personas: scenario?.personas || [],
    };
  };

  // 시나리오별 시도 번호 계산 (persona_run이 있는 모든 scenario_run 포함)
  const scenarioAttemptNumbers = useMemo(() => {
    const attemptMap = new Map<string, number>();
    const scenarioCounters = new Map<string, number>();
    
    // ✨ persona_run이 있는 scenario_run을 시간순으로 정렬 (완료 여부 무관)
    const chronologicalRuns = [...scenarioRuns]
      .filter(sr => sr.personaRuns && sr.personaRuns.length > 0)
      .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
    
    chronologicalRuns.forEach(run => {
      const scenarioId = run.scenarioId;
      const currentCount = (scenarioCounters.get(scenarioId) || 0) + 1;
      scenarioCounters.set(scenarioId, currentCount);
      attemptMap.set(run.id, currentCount);
    });
    
    return attemptMap;
  }, [scenarioRuns]);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <p className="text-slate-600">로그인이 필요합니다.</p>
          <Button onClick={() => window.location.href = '/home'} className="mt-4">
            홈으로 이동
          </Button>
        </div>
      </div>
    );
  }

  if (scenarioRunsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-blue-600" />
          <p className="text-lg text-slate-700 font-medium">데이터를 불러오는 중...</p>
          <p className="text-sm text-slate-500 mt-2">잠시만 기다려주세요</p>
        </div>
      </div>
    );
  }

  // ✨ persona_run이 있는 모든 scenario_run을 표시 (완료/진행중/시작 전 모두 포함)
  const displayableScenarioRuns = scenarioRuns
    .filter(sr => {
      // persona_run이 하나라도 있으면 표시 (상태 무관)
      return sr.personaRuns && sr.personaRuns.length > 0;
    })
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <img
                src={`https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || user.email || 'User')}&background=6366f1&color=fff&size=80`}
                alt="프로필"
                className="w-16 h-16 rounded-full object-cover"
                data-testid="profile-image"
              />
              <div>
                <h1 className="text-2xl font-bold text-slate-900" data-testid="user-name">
                  {user.name || user.email?.split('@')[0] || '사용자'}님의 MyPage
                </h1>
                <p className="text-slate-600" data-testid="user-email">{user.email}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Button
                onClick={() => window.location.href = '/home'}
                variant="outline"
                data-testid="scenario-list-button"
                className="flex items-center gap-2"
              >
                <i className="fas fa-list"></i>
                시나리오 리스트
              </Button>
              <Link href="/admin-dashboard">
                <Button
                  variant="outline"
                  className="flex items-center gap-2"
                  data-testid="admin-dashboard-button"
                >
                  <Users className="w-4 h-4" />
                  관리자 대시보드
                </Button>
              </Link>
              <Link href="/analytics">
                <Button
                  variant="default"
                  className="flex items-center gap-2"
                  data-testid="analytics-button"
                >
                  <BarChart3 className="w-4 h-4" />
                  종합 분석
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-8">
        <Tabs value={selectedView} onValueChange={(v) => setSelectedView(v as any)} className="space-y-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="history" className="flex items-center gap-2" data-testid="history-tab">
              <History className="w-4 h-4" />
              대화 기록
            </TabsTrigger>
            <TabsTrigger value="stats" className="flex items-center gap-2" data-testid="stats-tab">
              <TrendingUp className="w-4 h-4" />
              학습 통계
            </TabsTrigger>
          </TabsList>

          {/* 대화 기록 탭 */}
          <TabsContent value="history" className="space-y-6">
            <Card>
              <CardContent className="pt-6">
                {displayableScenarioRuns.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="text-slate-600">아직 완료한 대화 기록이 없습니다.</div>
                    <Button 
                      onClick={() => window.location.href = '/home'}
                      className="mt-4"
                      data-testid="start-conversation-button"
                    >
                      첫 대화 시작하기
                    </Button>
                  </div>
                ) : (
                  <Accordion type="multiple" className="w-full">
                    {displayableScenarioRuns.map((scenarioRun) => {
                      const scenarioInfo = getScenarioInfo(scenarioRun.scenarioId);
                      const attemptNumber = scenarioAttemptNumbers.get(scenarioRun.id) || 1;
                      
                      // ✨ 시나리오 완료 조건
                      // - 페르소나 1개: status='completed'만 체크 (전략 회고 불필요)
                      // - 페르소나 2개 이상: status='completed' AND 전략회고 제출됨
                      const hasMultiplePersonas = scenarioInfo.personas?.length > 1;
                      const isScenarioCompleted = hasMultiplePersonas 
                        ? (scenarioRun.status === 'completed' && !!scenarioRun.strategyReflection)
                        : scenarioRun.status === 'completed';
                      
                      return (
                        <AccordionItem 
                          key={scenarioRun.id} 
                          value={scenarioRun.id} 
                          data-testid={`scenario-run-${scenarioRun.id}`}
                        >
                          <div className="flex items-center justify-between border-b">
                            <AccordionTrigger className="hover:no-underline flex-1">
                              <div className="flex items-center gap-3 flex-wrap">
                                <CalendarDays className="w-4 h-4 text-slate-500" />
                                <span className="text-sm text-slate-600">
                                  {format(new Date(scenarioRun.startedAt), 'yyyy년 MM월 dd일 HH:mm')}
                                </span>
                                <h3 className="font-semibold text-slate-900 text-left">{scenarioInfo.title}</h3>
                                <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                                  난이도 {scenarioRun.difficulty || scenarioInfo.difficulty}
                                </Badge>
                                <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                                  #{attemptNumber}회 시도
                                </Badge>
                                {isScenarioCompleted ? (
                                  <Badge className="bg-green-600">완료</Badge>
                                ) : (
                                  <Badge className="bg-yellow-600">진행 중</Badge>
                                )}
                              </div>
                            </AccordionTrigger>
                            <button
                              onClick={(e) => handleDeleteClick(scenarioRun.id, e)}
                              className="p-2 text-red-600 hover:text-red-700 hover:bg-red-50 rounded transition-colors mr-2"
                              data-testid={`delete-scenario-run-${scenarioRun.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                          <AccordionContent>
                            <ScenarioRunDetails 
                              scenarioRun={scenarioRun} 
                              scenarioInfo={scenarioInfo}
                              personaRuns={scenarioRun.personaRuns || []}
                              setStrategyReflectionRunId={setStrategyReflectionRunId}
                            />
                          </AccordionContent>
                        </AccordionItem>
                      );
                    })}
                  </Accordion>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 학습 통계 탭 */}
          <TabsContent value="stats" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-slate-600">전체 시나리오 실행</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-3">
                    <MessageSquare className="w-8 h-8 text-blue-600" />
                    <div className="text-3xl font-bold text-slate-900" data-testid="total-scenario-runs">
                      {stats.totalScenarioRuns}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-slate-600">완료한 시나리오</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-3">
                    <Award className="w-8 h-8 text-green-600" />
                    <div className="text-3xl font-bold text-slate-900" data-testid="completed-scenario-runs">
                      {stats.completedScenarioRuns}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-slate-600">평균 점수</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-3">
                    <Star className="w-8 h-8 text-yellow-500" />
                    <div className={`text-3xl font-bold ${getScoreColor(stats.averageScore)}`} data-testid="average-score">
                      {stats.averageScore}
                    </div>
                  </div>
                  <div className="mt-2 text-sm text-slate-600">
                    {getScoreBadge(stats.averageScore)}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-slate-600">총 피드백</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-3">
                    <TrendingUp className="w-8 h-8 text-purple-600" />
                    <div className="text-3xl font-bold text-slate-900" data-testid="total-feedbacks">
                      {stats.totalFeedbacks}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>학습 인사이트</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {stats.totalFeedbacks === 0 ? (
                  <p className="text-slate-600">
                    더 많은 시나리오를 완료하면 상세한 학습 통계와 성장 추이를 확인할 수 있습니다.
                  </p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg border border-blue-200">
                      <span className="text-sm text-slate-700">총 학습 시간</span>
                      <span className="font-semibold text-slate-900">{stats.completedScenarioRuns} 시나리오 완료</span>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg border border-green-200">
                      <span className="text-sm text-slate-700">평균 성과</span>
                      <span className={`font-semibold ${getScoreColor(stats.averageScore)}`}>
                        {stats.averageScore}점 ({getScoreBadge(stats.averageScore)})
                      </span>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-purple-50 rounded-lg border border-purple-200">
                      <span className="text-sm text-slate-700">누적 피드백</span>
                      <span className="font-semibold text-slate-900">{stats.totalFeedbacks}개</span>
                    </div>
                    <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                      <p className="text-sm text-slate-700 mb-2">💡 추천</p>
                      <p className="text-sm text-slate-600">
                        {stats.averageScore >= 80 
                          ? "훌륭한 성과를 보이고 있습니다! 더 어려운 시나리오에 도전해보세요."
                          : stats.averageScore >= 60
                          ? "꾸준히 발전하고 있습니다. 피드백을 참고하여 개선 영역을 집중해보세요."
                          : "다양한 시나리오를 반복해서 경험하면 좋아질 것입니다. 계속 도전해보세요!"}
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* 삭제 확인 다이얼로그 */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>시나리오 실행 기록 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              이 시나리오 실행 기록을 삭제하시겠습니까? 관련된 모든 대화와 피드백이 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteConfirm}
              className="bg-red-600 hover:bg-red-700"
              data-testid="confirm-delete-button"
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 전략 회고 다이얼로그 */}
      {strategyReflectionRunId && (() => {
        const scenarioRun = scenarioRuns.find(sr => sr.id === strategyReflectionRunId);
        if (!scenarioRun) return null;
        
        const scenario = scenariosMap.get(scenarioRun.scenarioId);
        if (!scenario) return null;
        
        const completedPersonaRuns = scenarioRun.personaRuns.filter(pr => pr.status === 'completed');
        const completedPersonaIds = completedPersonaRuns.map(pr => pr.personaId);
        
        return (
          <Dialog open={true} onOpenChange={() => setStrategyReflectionRunId(null)}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <StrategyReflection
                personas={scenario.personas || []}
                completedPersonaIds={completedPersonaIds}
                onSubmit={async (reflection) => {
                  await submitStrategyReflectionMutation.mutateAsync({
                    runId: strategyReflectionRunId,
                    reflection,
                    personaIds: completedPersonaIds
                  });
                }}
                scenarioTitle={scenario.title}
              />
            </DialogContent>
          </Dialog>
        );
      })()}
    </div>
  );
}

// 시나리오 실행 상세 컴포넌트
function ScenarioRunDetails({ 
  scenarioRun, 
  scenarioInfo, 
  personaRuns,
  setStrategyReflectionRunId
}: { 
  scenarioRun: ScenarioRun; 
  scenarioInfo: any; 
  personaRuns: PersonaRun[];
  setStrategyReflectionRunId: (id: string) => void;
}) {
  // ✨ 개선: 이미 부모에서 받아온 personaRuns 사용 (중복 쿼리 제거)
  const { data: scenarios = [] } = useQuery<any[]>({
    queryKey: ['/api/scenarios'],
    staleTime: 1000 * 60 * 30,
  });

  const scenario = scenarios.find(s => s.id === scenarioRun.scenarioId);

  const completedPersonaRuns = personaRuns.filter(pr => pr.status === 'completed');
  const hasMultiplePersonas = scenario?.personas && scenario.personas.length >= 2;
  const showStrategyReflectionButton = hasMultiplePersonas && !scenarioRun.strategyReflection && completedPersonaRuns.length >= 2;

  return (
    <div className="space-y-4 pt-3">
      {/* 전략 회고 */}
      {scenarioRun.strategyReflection ? (
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-5">
          <h5 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
            <Target className="w-4 h-4 text-green-600" />
            전략 회고
          </h5>
          <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">
            {scenarioRun.strategyReflection}
          </p>
        </div>
      ) : showStrategyReflectionButton && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-5">
          <div className="flex items-center justify-between">
            <div>
              <h5 className="text-sm font-semibold text-slate-700 mb-1 flex items-center gap-2">
                <Target className="w-4 h-4 text-blue-600" />
                전략 회고 작성
              </h5>
              <p className="text-xs text-slate-600">
                {completedPersonaRuns.length}명의 페르소나와 대화를 완료했습니다. 전략적 대화 순서를 회고해보세요.
              </p>
            </div>
            <Button
              variant="default"
              size="sm"
              onClick={() => setStrategyReflectionRunId(scenarioRun.id)}
              data-testid={`strategy-reflection-button-${scenarioRun.id}`}
              className="bg-blue-600 hover:bg-blue-700"
            >
              회고 작성
            </Button>
          </div>
        </div>
      )}
      
      {/* 모든 페르소나들 (시작 전/진행 중/완료) */}
      <div className="space-y-2">
        <h5 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <Users className="w-4 h-4 text-blue-600" />
          페르소나 목록 ({scenario?.personas?.length || 0}개)
        </h5>
        <div className="space-y-2">
          {scenario?.personas?.map((persona: any, index: number) => {
            const personaRun = personaRuns.find(pr => pr.personaId === persona.id);
            const isCompleted = personaRun?.status === 'completed';
            const isActive = personaRun?.status === 'active';
            const isNotStarted = !personaRun;
            
            return (
              <div 
                key={persona.id}
                className="flex items-center justify-between p-3 bg-white border rounded-lg hover:bg-slate-50 transition-colors"
                data-testid={`persona-${persona.id}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    isCompleted ? 'bg-green-100 text-green-600' :
                    isActive ? 'bg-yellow-100 text-yellow-600' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {personaRun?.phase || '?'}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-slate-900">
                      {persona.department && <span className="text-slate-600 font-normal">{persona.department} </span>}
                      {persona.name}
                      {(persona.position || persona.role) && (
                        <span className="text-slate-600 font-normal"> {persona.position || persona.role}</span>
                      )}
                    </span>
                    {persona.mbti && (
                      <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                        {persona.mbti}
                      </Badge>
                    )}
                    {personaRun && (
                      <Badge variant="outline" className="text-xs">
                        {personaRun.turnCount}턴
                      </Badge>
                    )}
                    <Badge className={
                      isCompleted ? 'bg-green-600' :
                      isActive ? 'bg-yellow-600' :
                      'bg-gray-400'
                    }>
                      {isCompleted ? '완료' : isActive ? '진행 중' : '시작 전'}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {personaRun?.score !== null && personaRun?.score !== undefined && (
                    <div className="flex items-center gap-1">
                      <Star className="w-4 h-4 text-yellow-500" />
                      <span className={`font-semibold ${personaRun.score >= 80 ? 'text-green-600' : personaRun.score >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                        {personaRun.score}점
                      </span>
                    </div>
                  )}
                  <div className="flex gap-2">
                    {isNotStarted ? (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => window.location.href = `/home?scenarioId=${scenarioRun.scenarioId}&scenarioRunId=${scenarioRun.id}`}
                        data-testid={`start-persona-${persona.id}`}
                      >
                        대화하기
                      </Button>
                    ) : isActive ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => window.location.href = `/chat/${personaRun.id}`}
                          data-testid={`view-chat-${personaRun.id}`}
                        >
                          대화 보기
                        </Button>
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => window.location.href = `/home?resumePersonaRunId=${personaRun.id}`}
                          data-testid={`resume-persona-${personaRun.id}`}
                          className="bg-yellow-600 hover:bg-yellow-700"
                        >
                          대화 계속하기
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => window.location.href = `/chat/${personaRun.id}`}
                          data-testid={`view-chat-${personaRun.id}`}
                        >
                          대화 보기
                        </Button>
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => window.location.href = `/feedback/${personaRun.id}`}
                          data-testid={`view-feedback-${personaRun.id}`}
                        >
                          피드백 보기
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {(!scenario?.personas || scenario.personas.length === 0) && (
            <div className="text-center py-4 text-slate-500">
              시나리오 정보를 불러올 수 없습니다.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
