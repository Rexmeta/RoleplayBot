import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { CalendarDays, Star, TrendingUp, MessageSquare, Award, History, BarChart3, Target, Trash2, Loader2, HelpCircle, Lightbulb, CheckCircle, AlertCircle, ArrowRight, Minus, TrendingDown, Users, Filter } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { AppHeader } from "@/components/AppHeader";
import { type ScenarioRun, type PersonaRun, type Feedback } from "@shared/schema";
import { format } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { StrategyReflection } from "@/components/StrategyReflection";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip, Legend, ResponsiveContainer } from "recharts";

type EvaluationDimension = {
  id: string;
  key: string;
  name: string;
  description: string;
  icon?: string;
  color?: string;
  weight: number;
  minScore: number;
  maxScore: number;
};

type EvaluationCriteriaSet = {
  id: string;
  name: string;
  description?: string;
  dimensions: EvaluationDimension[];
};

const DEFAULT_DIMENSION_ICONS: Record<string, string> = {
  clarityLogic: "🎯",
  listeningEmpathy: "👂",
  appropriatenessAdaptability: "⚡",
  persuasivenessImpact: "🎪",
  strategicCommunication: "🎲"
};

const DEFAULT_DIMENSION_NAMES: Record<string, string> = {
  clarityLogic: "명확성 & 논리성",
  listeningEmpathy: "경청 & 공감",
  appropriatenessAdaptability: "적절성 & 상황 대응",
  persuasivenessImpact: "설득력 & 영향력",
  strategicCommunication: "전략적 커뮤니케이션"
};

const FA_TO_EMOJI: Record<string, string> = {
  'fa-solid fa-bullseye': '🎯',
  'fa-solid fa-heart': '❤️',
  'fa-solid fa-arrows-rotate': '🔄',
  'fa-solid fa-chart-line': '📈',
  'fa-solid fa-chess': '♟️',
  'fa-solid fa-comments': '💬',
  'fa-solid fa-handshake': '🤝',
  'fa-solid fa-brain': '🧠',
  'fa-solid fa-lightbulb': '💡',
  'fa-solid fa-star': '⭐',
};

const getDisplayIcon = (icon: string): string => {
  if (!icon) return '📊';
  if (icon.startsWith('fa-')) {
    return FA_TO_EMOJI[icon] || '📊';
  }
  return icon;
};

type ActiveTab = "roleplay-history" | "roleplay-analytics" | "personax-history";

export default function MyPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("roleplay-history");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [scenarioRunToDelete, setScenarioRunToDelete] = useState<string | null>(null);
  const [strategyReflectionRunId, setStrategyReflectionRunId] = useState<string | null>(null);
  const [selectedCriteriaSet, setSelectedCriteriaSet] = useState<string>("all");
  const { user } = useAuth();
  const { toast } = useToast();

  // 사용자의 피드백 조회
  const { data: feedbacks = [] } = useQuery<any[]>({
    queryKey: ['/api/feedbacks'],
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  });

  // 사용자의 시나리오 실행 기록 조회 (personaRuns 포함)
  const { data: rawScenarioRuns = [], isLoading: scenarioRunsLoading } = useQuery<(ScenarioRun & { personaRuns: PersonaRun[] })[]>({
    queryKey: ['/api/scenario-runs'],
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  });

  // 피드백 점수를 personaRun에 매핑
  const scenarioRuns = useMemo(() => {
    if (!feedbacks || feedbacks.length === 0) {
      return rawScenarioRuns;
    }

    // personaRunId -> feedback 점수 맵 생성
    const feedbackScores: Record<string, number> = {};
    feedbacks.forEach(f => {
      if (f.personaRunId) {
        feedbackScores[f.personaRunId] = f.overallScore || 0;
      }
    });

    // personaRun의 score가 null이면 피드백에서 가져오기
    return rawScenarioRuns.map(sr => ({
      ...sr,
      personaRuns: (sr.personaRuns || []).map(pr => ({
        ...pr,
        score: pr.score !== null ? pr.score : (feedbackScores[pr.id] || 0)
      }))
    }));
  }, [rawScenarioRuns, feedbacks]);

  // 시나리오 데이터 조회
  const { data: scenarios = [] } = useQuery<any[]>({
    queryKey: ['/api/scenarios'],
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
  });

  // 종합 분석 데이터 조회
  const { data: analyticsData } = useQuery<any>({
    queryKey: ['/api/analytics/summary'],
    enabled: !!user,
    staleTime: 1000 * 60,
    gcTime: 1000 * 60 * 5,
  });

  // 평가 기준 조회 (동적 차원 메타데이터)
  const { data: evaluationCriteria } = useQuery<EvaluationCriteriaSet>({
    queryKey: ['/api/evaluation-criteria/active'],
    staleTime: 1000 * 60 * 10,
  });

  const getDimensionName = useCallback((key: string): string => {
    const dimension = evaluationCriteria?.dimensions?.find(d => d.key === key);
    return dimension?.name || DEFAULT_DIMENSION_NAMES[key] || key;
  }, [evaluationCriteria]);

  const getDimensionIcon = useCallback((key: string): string => {
    const dimension = evaluationCriteria?.dimensions?.find(d => d.key === key);
    if (dimension?.icon) {
      const iconMap: Record<string, string> = {
        'fa-solid fa-bullseye': '🎯',
        'fa-solid fa-heart': '👂',
        'fa-solid fa-arrows-rotate': '⚡',
        'fa-solid fa-chart-line': '🎪',
        'fa-solid fa-chess': '🎲'
      };
      return iconMap[dimension.icon] || DEFAULT_DIMENSION_ICONS[key] || '📊';
    }
    return DEFAULT_DIMENSION_ICONS[key] || '📊';
  }, [evaluationCriteria]);

  // 시나리오 Map
  const scenariosMap = useMemo(() => 
    new Map(scenarios.map(s => [s.id, s])),
    [scenarios]
  );

  // 통계 계산
  const stats = useMemo(() => {
    const completedRuns = scenarioRuns.filter(sr => sr.status === 'completed');
    
    // ✨ feedbacks를 직접 기반으로 계산 (Analytics와 동일)
    const averageScore = feedbacks.length > 0
      ? Math.round(feedbacks.reduce((sum, f) => sum + (f.overallScore || 0), 0) / feedbacks.length)
      : 0;
    
    console.log('📊 MyPage Stats Debug:', {
      totalScenarioRuns: scenarioRuns.length,
      completedScenarioRuns: completedRuns.length,
      totalFeedbacks: feedbacks.length,
      averageScore,
    });
    
    return {
      totalScenarioRuns: scenarioRuns.length,
      completedScenarioRuns: completedRuns.length,
      averageScore,
      totalFeedbacks: feedbacks.length, // 모든 피드백 수
    };
  }, [scenarioRuns, feedbacks]);

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

  // 롤플레이X (시나리오 기반) vs 페르소나X (자유 대화) 분리
  // PersonaX: __free_chat__ 또는 __user_persona__:* (특수 prefix로 시작하는 모든 ID)
  const isPersonaXScenario = (scenarioId: string) => scenarioId.startsWith('__');
  const roleplayRuns = displayableScenarioRuns.filter(sr => !isPersonaXScenario(sr.scenarioId));
  const personaXRuns = displayableScenarioRuns.filter(sr => isPersonaXScenario(sr.scenarioId));

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader 
        variant="mypage"
        userName={user.name || user.email?.split('@')[0] || '사용자'}
        userEmail={user.email}
        rightContent={
          <Button
            onClick={() => window.location.href = '/home'}
            variant="outline"
            data-testid="scenario-list-button"
            className="hidden sm:flex items-center gap-2"
          >
            <i className="fas fa-list"></i>
            시나리오 리스트
          </Button>
        }
      />

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-8">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ActiveTab)} className="space-y-4 sm:space-y-6">
          <TabsList className="grid w-full grid-cols-3 h-auto">
            <TabsTrigger value="roleplay-history" className="flex flex-col sm:flex-row items-center gap-1 sm:gap-2 py-2 px-1 text-xs sm:text-sm leading-tight" data-testid="history-tab">
              <MessageSquare className="w-4 h-4 flex-shrink-0" />
              <span className="text-center">롤플레이X<br className="sm:hidden" /> 대화기록</span>
            </TabsTrigger>
            <TabsTrigger value="roleplay-analytics" className="flex flex-col sm:flex-row items-center gap-1 sm:gap-2 py-2 px-1 text-xs sm:text-sm leading-tight" data-testid="analytics-tab">
              <BarChart3 className="w-4 h-4 flex-shrink-0" />
              <span className="text-center">롤플레이X<br className="sm:hidden" /> 종합분석</span>
            </TabsTrigger>
            <TabsTrigger value="personax-history" className="flex flex-col sm:flex-row items-center gap-1 sm:gap-2 py-2 px-1 text-xs sm:text-sm leading-tight">
              <Users className="w-4 h-4 flex-shrink-0" />
              <span className="text-center">페르소나X<br className="sm:hidden" /> 대화기록</span>
            </TabsTrigger>
          </TabsList>

          {/* 롤플레이X 대화기록 탭 */}
          <TabsContent value="roleplay-history" className="space-y-6">
                <Card>
                  <CardContent className="pt-6">
                    {roleplayRuns.length === 0 ? (
                      <div className="text-center py-8">
                        <div className="text-slate-600">아직 롤플레이X 대화 기록이 없습니다.</div>
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
                        {roleplayRuns.map((scenarioRun) => {
                          const scenarioInfo = getScenarioInfo(scenarioRun.scenarioId);
                          const attemptNumber = scenarioAttemptNumbers.get(scenarioRun.id) || 1;
                          
                          const hasMultiplePersonas = scenarioInfo.personas?.length > 1;
                          const isScenarioCompleted = hasMultiplePersonas 
                            ? (scenarioRun.status === 'completed' && !!scenarioRun.strategyReflection)
                            : scenarioRun.status === 'completed';
                          
                          return (
                            <AccordionItem 
                              key={scenarioRun.id} 
                              value={scenarioRun.id} 
                              data-testid={`scenario-run-${scenarioRun.id}`}
                              className="border rounded-xl mb-3 overflow-hidden shadow-sm"
                            >
                              <div className="flex items-center justify-between border-b">
                                <AccordionTrigger className="hover:no-underline flex-1 py-3">
                                  <div className="flex flex-col items-start gap-1 text-left w-full pr-1">
                                    <h3 className="font-semibold text-slate-900">{scenarioInfo.title}</h3>
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-xs text-slate-500 flex items-center gap-1">
                                        <CalendarDays className="w-3 h-3" />
                                        {format(new Date(scenarioRun.startedAt), 'yy.MM.dd HH:mm')}
                                      </span>
                                      <Badge variant="outline" className="text-xs py-0 bg-purple-50 text-purple-700 border-purple-200">
                                        난이도 {scenarioRun.difficulty || scenarioInfo.difficulty}
                                      </Badge>
                                      <Badge variant="outline" className="text-xs py-0 bg-blue-50 text-blue-700 border-blue-200">
                                        #{attemptNumber}회
                                      </Badge>
                                      {(scenarioRun as any).isScenarioDeleted && (
                                        <Badge variant="outline" className="text-xs py-0 bg-red-50 text-red-600 border-red-200">삭제됨</Badge>
                                      )}
                                      {isScenarioCompleted ? (
                                        <Badge className="text-xs py-0 bg-green-600">완료</Badge>
                                      ) : (
                                        <Badge className="text-xs py-0 bg-yellow-600">진행 중</Badge>
                                      )}
                                    </div>
                                  </div>
                                </AccordionTrigger>
                                <button
                                  onClick={(e) => handleDeleteClick(scenarioRun.id, e)}
                                  className="min-w-[44px] min-h-[44px] flex items-center justify-center text-red-600 hover:text-red-700 active:text-red-800 hover:bg-red-50 active:bg-red-100 rounded transition-colors mr-1"
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
                                  isScenarioDeleted={(scenarioRun as any).isScenarioDeleted || false}
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

          {/* 롤플레이X 종합분석 탭 */}
          <TabsContent value="roleplay-analytics" className="space-y-6">
            {!analyticsData ? (
              <div className="text-center py-8">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                <p className="text-slate-600">분석 데이터를 불러오는 중...</p>
              </div>
            ) : (
              <>
                <TooltipProvider>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
                    {/* Overall Score */}
                    <Card>
                      <CardHeader className="pb-2 sm:pb-3">
                        <CardTitle className="text-xs sm:text-sm font-medium text-slate-600 flex items-center gap-1.5">
                          <Award className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
                          <span className="truncate">종합 점수</span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <div className="flex flex-wrap items-end gap-2">
                          <div className="text-3xl sm:text-4xl font-bold text-slate-900">
                            {analyticsData.averageScore}
                          </div>
                          <div className={`px-2 py-0.5 rounded-full text-xs font-semibold mb-1 ${analyticsData.overallGrade?.startsWith('A') ? 'text-green-600 bg-green-50' : analyticsData.overallGrade === 'B' ? 'text-blue-600 bg-blue-50' : analyticsData.overallGrade === 'C' ? 'text-yellow-600 bg-yellow-50' : 'text-red-600 bg-red-50'}`}>
                            {analyticsData.overallGrade} 등급
                          </div>
                        </div>
                        <Progress value={analyticsData.averageScore} className="mt-3" />
                      </CardContent>
                    </Card>

                    {/* Sessions Count */}
                    <Card>
                      <CardHeader className="pb-2 sm:pb-3">
                        <CardTitle className="text-xs sm:text-sm font-medium text-slate-600 flex items-center gap-1.5">
                          <BarChart3 className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
                          <span className="truncate">완료 시나리오</span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <div className="text-2xl sm:text-4xl font-bold text-slate-900 tabular-nums">
                          {analyticsData.completedSessions !== undefined ? `${analyticsData.completedSessions}/${analyticsData.totalSessions}` : analyticsData.totalSessions}
                        </div>
                        <p className="text-xs text-slate-500 mt-2 truncate">
                          {analyticsData.lastSessionDate && (
                            <>마지막: {new Date(analyticsData.lastSessionDate).toLocaleDateString('ko-KR')}</>
                          )}
                        </p>
                      </CardContent>
                    </Card>

                    {/* Progress Trend */}
                    <Card>
                      <CardHeader className="pb-2 sm:pb-3">
                        <CardTitle className="text-xs sm:text-sm font-medium text-slate-600 flex items-center gap-1.5">
                          <Target className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
                          <span className="truncate">성장 추세</span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {analyticsData.progressTrend === 'improving' ? <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-green-600 flex-shrink-0" /> : analyticsData.progressTrend === 'declining' ? <TrendingDown className="w-4 h-4 sm:w-5 sm:h-5 text-red-600 flex-shrink-0" /> : <Minus className="w-4 h-4 sm:w-5 sm:h-5 text-slate-600 flex-shrink-0" />}
                          <div className={`px-2 py-0.5 rounded-full text-xs font-semibold ${analyticsData.progressTrend === 'improving' ? 'text-green-600 bg-green-50' : analyticsData.progressTrend === 'declining' ? 'text-red-600 bg-red-50' : 'text-slate-600 bg-slate-50'}`}>
                            {analyticsData.progressTrend === 'improving' ? '성장 중' : analyticsData.progressTrend === 'declining' ? '하락 중' : analyticsData.progressTrend === 'stable' ? '안정적' : '중립'}
                          </div>
                        </div>
                        <p className="text-xs text-slate-500 mt-2">
                          {analyticsData.progressTrend === 'improving' && '실력 향상 중'}
                          {analyticsData.progressTrend === 'declining' && '연습 필요'}
                          {analyticsData.progressTrend === 'stable' && '안정적 수준'}
                          {analyticsData.progressTrend === 'neutral' && '데이터 수집 중'}
                        </p>
                      </CardContent>
                    </Card>

                    {/* Total Feedbacks */}
                    <Card>
                      <CardHeader className="pb-2 sm:pb-3">
                        <CardTitle className="text-xs sm:text-sm font-medium text-slate-600 flex items-center gap-1.5">
                          <MessageSquare className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
                          <span className="truncate">총 피드백</span>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <div className="text-3xl sm:text-4xl font-bold text-slate-900 tabular-nums">
                          {analyticsData.totalFeedbacks || 0}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                </TooltipProvider>

                {/* Category Breakdown */}
                <Card>
                  <CardHeader>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div>
                        <CardTitle>카테고리별 평균 점수</CardTitle>
                        <CardDescription>
                          {analyticsData.criteriaDetails && analyticsData.criteriaDetails.length > 0 
                            ? `${analyticsData.criteriaDetails.length}개 평가 기준 종합 분석 (10점 만점)`
                            : '평가 항목별 종합 분석 (10점 만점)'}
                        </CardDescription>
                      </div>
                      {analyticsData.usedCriteriaSets && analyticsData.usedCriteriaSets.length >= 1 && (
                        <div className="flex items-center gap-2">
                          <Filter className="w-4 h-4 text-slate-500 flex-shrink-0" />
                          <Select value={selectedCriteriaSet} onValueChange={setSelectedCriteriaSet}>
                            <SelectTrigger className="w-full sm:w-[240px]">
                              <SelectValue placeholder="평가 기준 세트 선택" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">전체 평가 기준 ({analyticsData.totalFeedbacks}회)</SelectItem>
                              {analyticsData.usedCriteriaSets.map((criteriaSet: any) => (
                                <SelectItem key={criteriaSet.id} value={criteriaSet.id}>
                                  {criteriaSet.name} ({criteriaSet.feedbackCount}회)
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-6">
                      {/* 새로운 criteriaDetails 사용 (있는 경우) */}
                      {analyticsData.criteriaDetails && analyticsData.criteriaDetails.length > 0 ? (
                        (selectedCriteriaSet === "all" 
                          ? analyticsData.criteriaDetails 
                          : analyticsData.criteriaDetailsBySet?.[selectedCriteriaSet] || []
                        ).map((criteria: any) => (
                          <div key={criteria.key}>
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="text-xl">{getDisplayIcon(criteria.icon)}</span>
                                <span className="font-medium text-slate-900">
                                  {criteria.name}
                                </span>
                                <Badge variant="outline" className="text-xs bg-slate-50">
                                  {criteria.evaluationCount}회 평가
                                </Badge>
                              </div>
                              <span className="text-lg font-semibold text-slate-900">
                                {criteria.averageScore.toFixed(1)} / 10.0
                              </span>
                            </div>
                            <Progress value={criteria.averageScore * 10} className="h-3" />
                          </div>
                        ))
                      ) : (
                        /* 기존 categoryAverages 호환 (구버전 데이터) */
                        Object.entries(analyticsData.categoryAverages || {}).map(([key, value]) => (
                          <div key={key}>
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="text-xl">{getDimensionIcon(key)}</span>
                                <span className="font-medium text-slate-900">
                                  {getDimensionName(key)}
                                </span>
                              </div>
                              <span className="text-lg font-semibold text-slate-900">
                                {(value as number).toFixed(1)} / 10.0
                              </span>
                            </div>
                            <Progress value={(value as number) * 10} className="h-3" />
                          </div>
                        ))
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Score History Chart */}
                {analyticsData.scoreHistory && analyticsData.scoreHistory.length > 1 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>점수 변화 추이</CardTitle>
                      <CardDescription>날짜별 평균 점수 추이 (0~100 점)</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="w-full h-80">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart
                            data={Object.entries(
                              analyticsData.scoreHistory.reduce((acc: Record<string, any>, entry: any) => {
                                const dateKey = entry.date;
                                if (!acc[dateKey]) {
                                  acc[dateKey] = { scores: [], date: dateKey };
                                }
                                acc[dateKey].scores.push(entry.score);
                                return acc;
                              }, {})
                            )
                            .sort((a, b) => a[0].localeCompare(b[0]))
                            .map(([_, data]: [string, { date: string; scores: number[] }]) => {
                              const [year, month, day] = data.date.split('-');
                              return {
                                date: `${month}.${day}`,
                                score: Math.round(data.scores.reduce((a: number, b: number) => a + b, 0) / data.scores.length),
                                count: data.scores.length
                              };
                            })}
                            margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="date" stroke="#64748b" style={{ fontSize: '12px' }} />
                            <YAxis stroke="#64748b" domain={[0, 100]} style={{ fontSize: '12px' }} />
                            <ChartTooltip
                              contentStyle={{
                                backgroundColor: '#fff',
                                border: '1px solid #e2e8f0',
                                borderRadius: '8px',
                                padding: '8px 12px'
                              }}
                              formatter={(value: any) => [`${value}점`, '평균 점수']}
                              labelStyle={{ color: '#1e293b' }}
                            />
                            <Legend wrapperStyle={{ paddingTop: '20px' }} formatter={() => '일일 평균 점수'} />
                            <Line
                              type="monotone"
                              dataKey="score"
                              stroke="#2563eb"
                              strokeWidth={3}
                              dot={{ fill: '#2563eb', r: 6 }}
                              activeDot={{ r: 8 }}
                              isAnimationActive={true}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="mt-6 grid grid-cols-3 gap-4 text-sm">
                        <div className="p-3 bg-slate-50 rounded-lg">
                          <div className="text-slate-600 mb-1">최고 점수</div>
                          <div className="text-2xl font-bold text-slate-900">
                            {Math.max(...analyticsData.scoreHistory.map((e: any) => e.score))}
                          </div>
                        </div>
                        <div className="p-3 bg-slate-50 rounded-lg">
                          <div className="text-slate-600 mb-1">최저 점수</div>
                          <div className="text-2xl font-bold text-slate-900">
                            {Math.min(...analyticsData.scoreHistory.map((e: any) => e.score))}
                          </div>
                        </div>
                        <div className="p-3 bg-slate-50 rounded-lg">
                          <div className="text-slate-600 mb-1">점수 범위</div>
                          <div className="text-2xl font-bold text-slate-900">
                            {Math.max(...analyticsData.scoreHistory.map((e: any) => e.score)) - Math.min(...analyticsData.scoreHistory.map((e: any) => e.score))}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Strengths and Improvements */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Top Strengths */}
                  {analyticsData.topStrengths && analyticsData.topStrengths.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-green-600">주요 강점</CardTitle>
                        <CardDescription>가장 자주 나타나는 강점 패턴</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-4">
                          {analyticsData.topStrengths.map((strength: any, index: number) => (
                            <div key={index} className="pb-3 border-b last:border-b-0">
                              <div className="flex items-center gap-3 mb-2">
                                <Badge className="bg-green-50 text-green-700 border-green-200 shrink-0">
                                  {strength.count}회
                                </Badge>
                                <p className="font-semibold text-slate-900 text-sm">{strength.category}</p>
                              </div>
                              {strength.items && strength.items.length > 0 && (
                                <div className="ml-12 space-y-1">
                                  {strength.items.map((item: string, itemIndex: number) => (
                                    <p key={itemIndex} className="text-xs text-slate-600 leading-relaxed">
                                      • {item}
                                    </p>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Top Improvements */}
                  {analyticsData.topImprovements && analyticsData.topImprovements.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-orange-600">개선 필요 영역</CardTitle>
                        <CardDescription>지속적으로 나타나는 개선점</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-4">
                          {analyticsData.topImprovements.map((improvement: any, index: number) => (
                            <div key={index} className="pb-3 border-b last:border-b-0">
                              <div className="flex items-center gap-3 mb-2">
                                <Badge className="bg-orange-50 text-orange-700 border-orange-200 shrink-0">
                                  {improvement.count}회
                                </Badge>
                                <p className="font-semibold text-slate-900 text-sm">{improvement.category}</p>
                              </div>
                              {improvement.items && improvement.items.length > 0 && (
                                <div className="ml-12 space-y-1">
                                  {improvement.items.map((item: string, itemIndex: number) => (
                                    <p key={itemIndex} className="text-xs text-slate-600 leading-relaxed">
                                      • {item}
                                    </p>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </>
            )}
          </TabsContent>

          {/* 페르소나X 대화기록 탭 */}
          <TabsContent value="personax-history" className="space-y-6">
            <Card>
              <CardContent className="pt-6">
                {personaXRuns.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="text-slate-600">아직 페르소나X 대화 기록이 없습니다.</div>
                    <Button
                      onClick={() => window.location.href = '/home'}
                      className="mt-4"
                    >
                      페르소나와 대화 시작하기
                    </Button>
                  </div>
                ) : (
                  <Accordion type="multiple" className="w-full">
                    {personaXRuns.map((scenarioRun) => {
                      const attemptNumber = scenarioAttemptNumbers.get(scenarioRun.id) || 1;
                      const firstPersonaRun = scenarioRun.personaRuns?.[0];
                      const personaDisplayName = firstPersonaRun?.personaName || firstPersonaRun?.personaId || '페르소나';
                      const isCompleted = scenarioRun.status === 'completed';

                      return (
                        <AccordionItem
                          key={scenarioRun.id}
                          value={scenarioRun.id}
                          data-testid={`scenario-run-${scenarioRun.id}`}
                        >
                          <div className="flex items-center justify-between border-b">
                            <AccordionTrigger className="hover:no-underline flex-1 py-3">
                              <div className="flex flex-col items-start gap-1 text-left w-full pr-1">
                                <h3 className="font-semibold text-slate-900">{personaDisplayName}</h3>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-xs text-slate-500 flex items-center gap-1">
                                    <CalendarDays className="w-3 h-3" />
                                    {format(new Date(scenarioRun.startedAt), 'yy.MM.dd HH:mm')}
                                  </span>
                                  <Badge variant="outline" className="text-xs py-0 bg-blue-50 text-blue-700 border-blue-200">
                                    #{attemptNumber}회
                                  </Badge>
                                  {isCompleted ? (
                                    <Badge className="text-xs py-0 bg-green-600">완료</Badge>
                                  ) : (
                                    <Badge className="text-xs py-0 bg-yellow-600">진행 중</Badge>
                                  )}
                                </div>
                              </div>
                            </AccordionTrigger>
                            <button
                              onClick={(e) => handleDeleteClick(scenarioRun.id, e)}
                              className="p-2 text-red-600 hover:text-red-700 hover:bg-red-50 rounded transition-colors mr-2 flex-shrink-0"
                              data-testid={`delete-scenario-run-${scenarioRun.id}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                          <AccordionContent>
                            <ScenarioRunDetails
                              scenarioRun={scenarioRun}
                              scenarioInfo={{ title: personaDisplayName, difficulty: 1, personas: [] }}
                              personaRuns={scenarioRun.personaRuns || []}
                              setStrategyReflectionRunId={setStrategyReflectionRunId}
                              isScenarioDeleted={false}
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
  setStrategyReflectionRunId,
  isScenarioDeleted = false
}: { 
  scenarioRun: ScenarioRun; 
  scenarioInfo: any; 
  personaRuns: PersonaRun[];
  setStrategyReflectionRunId: (id: string) => void;
  isScenarioDeleted?: boolean;
}) {
  const [showStrategyFeedback, setShowStrategyFeedback] = useState(false);
  
  // ✨ 개선: 이미 부모에서 받아온 personaRuns 사용 (중복 쿼리 제거)
  const { data: scenarios = [] } = useQuery<any[]>({
    queryKey: ['/api/scenarios'],
    staleTime: 1000 * 60 * 30,
  });

  const scenario = scenarios.find(s => s.id === scenarioRun.scenarioId);

  const completedPersonaRuns = personaRuns.filter(pr => pr.status === 'completed');
  const hasMultiplePersonas = scenario?.personas && scenario.personas.length >= 2;
  const showStrategyReflectionButton = hasMultiplePersonas && !scenarioRun.strategyReflection && completedPersonaRuns.length >= 2;

  // sequenceAnalysis 데이터 (전략 평가 결과)
  const sequenceAnalysis = scenarioRun.sequenceAnalysis as {
    strategicScore?: number;
    strategicRationale?: string;
    sequenceEffectiveness?: string;
    alternativeApproaches?: string[];
    strategicInsights?: string;
    strengths?: string[];
    improvements?: string[];
  } | null;

  const getScoreGrade = (score: number) => {
    if (score >= 90) return { grade: 'S', color: 'text-purple-600 bg-purple-100', label: '탁월함' };
    if (score >= 80) return { grade: 'A', color: 'text-green-600 bg-green-100', label: '우수함' };
    if (score >= 70) return { grade: 'B', color: 'text-blue-600 bg-blue-100', label: '양호함' };
    if (score >= 60) return { grade: 'C', color: 'text-yellow-600 bg-yellow-100', label: '보통' };
    return { grade: 'D', color: 'text-red-600 bg-red-100', label: '개선 필요' };
  };

  return (
    <div className="space-y-4 pt-3">
      {/* 전략 회고가 있는 경우 */}
      {scenarioRun.strategyReflection && (
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h5 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <Target className="w-4 h-4 text-green-600" />
                전략 회고
              </h5>
              {sequenceAnalysis && (
                <div className="flex items-center gap-2 flex-wrap">
                  {sequenceAnalysis.strategicScore !== undefined && (
                    <Badge className={`${getScoreGrade(sequenceAnalysis.strategicScore).color} border-0 font-bold`}>
                      {getScoreGrade(sequenceAnalysis.strategicScore).grade} ({sequenceAnalysis.strategicScore}점)
                    </Badge>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowStrategyFeedback(true)}
                    className="text-xs bg-white hover:bg-purple-50 border-purple-300 text-purple-700"
                    data-testid={`strategy-feedback-button-${scenarioRun.id}`}
                  >
                    <Lightbulb className="w-3 h-3 mr-1" />
                    AI 전략 평가 보기
                  </Button>
                </div>
              )}
            </div>
            <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">
              {scenarioRun.strategyReflection}
            </p>
          </div>
        </div>
      )}
      
      {/* 전략 회고 작성 버튼 */}
      {showStrategyReflectionButton && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1">
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
              className="bg-blue-600 hover:bg-blue-700 w-full sm:w-auto"
            >
              회고 작성
            </Button>
          </div>
        </div>
      )}
      
      {/* 전략 평가 다이얼로그 */}
      <Dialog open={showStrategyFeedback} onOpenChange={setShowStrategyFeedback}>
        <DialogContent className="w-[95vw] max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Lightbulb className="w-5 h-5 text-purple-600" />
              AI 전략 평가
            </DialogTitle>
          </DialogHeader>
          
          {sequenceAnalysis && (
            <div className="space-y-6 mt-4">
              {/* 전략 점수 */}
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

              {/* 전략적 근거 */}
              {sequenceAnalysis.strategicRationale && (
                <div className="p-4 bg-slate-50 rounded-lg border">
                  <h4 className="font-semibold text-slate-800 mb-2 flex items-center gap-2">
                    <Target className="w-4 h-4 text-slate-600" />
                    전략적 근거
                  </h4>
                  <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                    {sequenceAnalysis.strategicRationale}
                  </p>
                </div>
              )}

              {/* 순서 효과성 */}
              {sequenceAnalysis.sequenceEffectiveness && (
                <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                  <h4 className="font-semibold text-blue-800 mb-2 flex items-center gap-2">
                    <ArrowRight className="w-4 h-4 text-blue-600" />
                    대화 순서 효과성
                  </h4>
                  <p className="text-sm text-blue-700 leading-relaxed whitespace-pre-wrap">
                    {sequenceAnalysis.sequenceEffectiveness}
                  </p>
                </div>
              )}

              {/* 강점 & 개선점 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {sequenceAnalysis.strengths && sequenceAnalysis.strengths.length > 0 && (
                  <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                    <h4 className="font-semibold text-green-800 mb-3 flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-green-600" />
                      강점
                    </h4>
                    <ul className="space-y-2">
                      {sequenceAnalysis.strengths.map((strength, idx) => (
                        <li key={idx} className="text-sm text-green-700 flex items-start gap-2">
                          <span className="text-green-500 mt-1">•</span>
                          <span>{strength}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {sequenceAnalysis.improvements && sequenceAnalysis.improvements.length > 0 && (
                  <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
                    <h4 className="font-semibold text-amber-800 mb-3 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-600" />
                      개선점
                    </h4>
                    <ul className="space-y-2">
                      {sequenceAnalysis.improvements.map((improvement, idx) => (
                        <li key={idx} className="text-sm text-amber-700 flex items-start gap-2">
                          <span className="text-amber-500 mt-1">•</span>
                          <span>{improvement}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* 대안적 접근법 */}
              {sequenceAnalysis.alternativeApproaches && sequenceAnalysis.alternativeApproaches.length > 0 && (
                <div className="p-4 bg-indigo-50 rounded-lg border border-indigo-200">
                  <h4 className="font-semibold text-indigo-800 mb-3 flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-indigo-600" />
                    대안적 접근법
                  </h4>
                  <ul className="space-y-2">
                    {sequenceAnalysis.alternativeApproaches.map((approach, idx) => (
                      <li key={idx} className="text-sm text-indigo-700 flex items-start gap-2">
                        <span className="font-semibold text-indigo-500">{idx + 1}.</span>
                        <span>{approach}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 전략적 통찰 */}
              {sequenceAnalysis.strategicInsights && (
                <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
                  <h4 className="font-semibold text-purple-800 mb-2 flex items-center gap-2">
                    <Star className="w-4 h-4 text-purple-600" />
                    전략적 통찰
                  </h4>
                  <p className="text-sm text-purple-700 leading-relaxed whitespace-pre-wrap">
                    {sequenceAnalysis.strategicInsights}
                  </p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
      
      {/* 삭제된 시나리오 안내 메시지 */}
      {isScenarioDeleted && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-3">
          <div className="flex items-center gap-2 text-red-700">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm font-medium">이 시나리오는 삭제되어 새로운 대화를 시작할 수 없습니다. 기존 대화 기록과 피드백은 계속 확인할 수 있습니다.</span>
          </div>
        </div>
      )}

      {/* 모든 페르소나들 (시작 전/진행 중/완료) */}
      <div className="space-y-2">
        <h5 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <Users className="w-4 h-4 text-blue-600" />
          페르소나 목록 ({isScenarioDeleted ? personaRuns.length : (scenario?.personas?.length || 0)}개)
        </h5>
        <div className="space-y-2">
          {isScenarioDeleted ? (
            personaRuns.map((personaRun: PersonaRun) => {
              const isCompleted = personaRun.status === 'completed';
              const isActive = personaRun.status === 'active';
              const snapshot = personaRun.personaSnapshot as any;
              
              return (
                <div 
                  key={personaRun.id}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 bg-white border rounded-lg hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold ${
                      isCompleted ? 'bg-green-100 text-green-600' :
                      isActive ? 'bg-yellow-100 text-yellow-600' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {personaRun.phase || '?'}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-slate-900">
                        {personaRun.personaName || snapshot?.name || personaRun.personaId}
                      </span>
                      {personaRun.mbtiType && (
                        <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
                          {personaRun.mbtiType}
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-xs">
                        {personaRun.turnCount}턴
                      </Badge>
                      <Badge className={`text-xs ${isCompleted ? 'bg-green-600' : isActive ? 'bg-yellow-600' : 'bg-gray-400'}`}>
                        {isCompleted ? '완료' : isActive ? '진행 중' : '시작 전'}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pl-9 sm:pl-0">
                    {personaRun.score !== null && personaRun.score !== undefined && (
                      <div className="flex items-center gap-1">
                        <Star className="w-4 h-4 text-yellow-500" />
                        <span className={`font-semibold text-sm ${personaRun.score >= 80 ? 'text-green-600' : personaRun.score >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                          {personaRun.score}점
                        </span>
                      </div>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.location.href = `/chat/${personaRun.id}`}
                    >
                      대화 보기
                    </Button>
                    {isCompleted && (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => window.location.href = `/feedback/${personaRun.id}`}
                      >
                        피드백 보기
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            scenario?.personas?.map((persona: any, index: number) => {
            const personaRun = personaRuns.find(pr => pr.personaId === persona.id);
            const isCompleted = personaRun?.status === 'completed';
            const isActive = personaRun?.status === 'active';
            const isNotStarted = !personaRun;
            
            return (
              <div 
                key={persona.id}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 bg-white border rounded-lg hover:bg-slate-50 transition-colors"
                data-testid={`persona-${persona.id}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold ${
                    isCompleted ? 'bg-green-100 text-green-600' :
                    isActive ? 'bg-yellow-100 text-yellow-600' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {personaRun?.phase || '?'}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-medium text-slate-900">
                      {persona.department && <span className="text-slate-600 font-normal">{persona.department} </span>}
                      {persona.name}
                      {(persona.position || persona.role) && (
                        <span className="text-slate-600 font-normal"> {persona.position || persona.role}</span>
                      )}
                    </span>
                    {persona.mbti && (
                      <Badge variant="outline" className="text-xs bg-green-50 text-green-700 border-green-200">
                        {persona.mbti}
                      </Badge>
                    )}
                    {personaRun && (
                      <Badge variant="outline" className="text-xs">
                        {personaRun.turnCount}턴
                      </Badge>
                    )}
                    <Badge className={`text-xs ${
                      isCompleted ? 'bg-green-600' :
                      isActive ? 'bg-yellow-600' :
                      'bg-gray-400'
                    }`}>
                      {isCompleted ? '완료' : isActive ? '진행 중' : '시작 전'}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-2 pl-9 sm:pl-0">
                  {personaRun?.score !== null && personaRun?.score !== undefined && (
                    <div className="flex items-center gap-1">
                      <Star className="w-4 h-4 text-yellow-500" />
                      <span className={`font-semibold text-sm ${personaRun.score >= 80 ? 'text-green-600' : personaRun.score >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                        {personaRun.score}점
                      </span>
                    </div>
                  )}
                  {isNotStarted ? (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => window.location.href = `/home?scenarioId=${scenarioRun.scenarioId}&scenarioRunId=${scenarioRun.id}`}
                      data-testid={`start-persona-${persona.id}`}
                    >
                      페르소나 선택
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
                        계속하기
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
            );
          })
          )}
          {!isScenarioDeleted && (!scenario?.personas || scenario.personas.length === 0) && (
            <div className="text-center py-4 text-slate-500">
              시나리오 정보를 불러올 수 없습니다.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
