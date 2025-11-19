import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { CalendarDays, Star, TrendingUp, MessageSquare, Award, History, BarChart3, Users, Target, Trash2, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { type Conversation, type Feedback, type User } from "@shared/schema";
import { format } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function MyPage() {
  const [selectedView, setSelectedView] = useState<"history" | "stats">("history");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [conversationToDelete, setConversationToDelete] = useState<string | null>(null);
  const { user } = useAuth();
  const { toast } = useToast();

  // 사용자의 대화 기록 조회
  const { data: conversations = [], isLoading: conversationsLoading } = useQuery<Conversation[]>({
    queryKey: ['/api/conversations'],
    enabled: !!user,
    staleTime: 1000 * 60 * 5, // 5분간 캐시 유지
    gcTime: 1000 * 60 * 10,   // 10분간 메모리 유지
  });

  // 사용자의 피드백 기록 조회  
  const { data: feedbacks = [], isLoading: feedbacksLoading } = useQuery<Feedback[]>({
    queryKey: ['/api/feedbacks'],
    enabled: !!user,
    staleTime: 1000 * 60 * 5, // 5분간 캐시 유지
    gcTime: 1000 * 60 * 10,   // 10분간 메모리 유지
  });

  // 시나리오 데이터 조회
  const { data: scenarios = [] } = useQuery<any[]>({
    queryKey: ['/api/scenarios'],
    staleTime: 1000 * 60 * 30, // 30분간 캐시 유지 (시나리오는 자주 변경되지 않음)
    gcTime: 1000 * 60 * 60,     // 1시간 메모리 유지
  });

  // ⚡ 성능 최적화: Map 기반 O(1) 조회
  const scenariosMap = useMemo(() => 
    new Map(scenarios.map(s => [s.id, s])),
    [scenarios]
  );

  const feedbacksMap = useMemo(() => 
    new Map(feedbacks.map(f => [f.conversationId, f])),
    [feedbacks]
  );

  // 통계 계산
  const stats = useMemo(() => ({
    totalConversations: conversations.length,
    completedConversations: conversations.filter((c: Conversation) => c.status === 'completed').length,
    averageScore: feedbacks.length > 0 
      ? Math.round(feedbacks.reduce((sum: number, f: Feedback) => sum + f.overallScore, 0) / feedbacks.length)
      : 0,
    totalFeedbacks: feedbacks.length,
  }), [conversations, feedbacks]);

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

  // 대화 제목 생성: "시나리오 제목 + 페르소나 소속, 이름, 직급, MBTI"
  const getConversationTitle = (conversation: Conversation) => {
    const scenario = scenariosMap.get(conversation.scenarioId); // ⚡ O(1) 조회
    if (!scenario) return conversation.scenarioId || '일반 대화';
    
    // 1순위: 대화 생성 시점의 페르소나 스냅샷 사용 (과거 기록 보호)
    // 2순위: 현재 시나리오에서 페르소나 찾기 (하위 호환성)
    const persona = (conversation as any).personaSnapshot 
      || scenario.personas?.find((p: any) => p.id === conversation.personaId);
    
    if (!persona) return scenario.title || '일반 대화';
    
    // undefined 방지: 각 필드가 존재하는 경우만 포함
    const parts = [];
    if (persona.department) parts.push(persona.department);
    if (persona.name) parts.push(persona.name);
    if (persona.role || persona.position) parts.push(persona.role || persona.position);
    const personaInfo = parts.join(' ');
    const mbtiInfo = persona.mbti ? ` (${persona.mbti})` : '';
    
    return `${scenario.title} - ${personaInfo}${mbtiInfo}`;
  };

  // ⚡ 성능 최적화: 대화 리스트를 최근 날짜 순으로 정렬 (메모이제이션)
  const sortedConversations = useMemo(() => 
    [...conversations].sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    ),
    [conversations]
  );

  // ⚡ 성능 최적화: 시나리오별로 대화 그룹화 (메모이제이션)
  const conversationsByScenario = useMemo(() => 
    sortedConversations.reduce((acc, conversation) => {
      const scenarioId = conversation.scenarioId;
      if (!acc[scenarioId]) {
        acc[scenarioId] = [];
      }
      acc[scenarioId].push(conversation);
      return acc;
    }, {} as Record<string, typeof sortedConversations>),
    [sortedConversations]
  );
  
  // ⚡ 성능 최적화: 각 시나리오의 최근 대화 시간을 기준으로 시나리오 정렬 (메모이제이션)
  const sortedScenarioIds = useMemo(() => 
    Object.keys(conversationsByScenario).sort((scenarioIdA, scenarioIdB) => {
      const conversationsA = conversationsByScenario[scenarioIdA];
      const conversationsB = conversationsByScenario[scenarioIdB];
      
      // 각 시나리오 그룹에서 가장 최근 대화 찾기
      const latestA = Math.max(...conversationsA.map(c => new Date(c.createdAt).getTime()));
      const latestB = Math.max(...conversationsB.map(c => new Date(c.createdAt).getTime()));
      
      // 최근 대화가 있는 시나리오를 먼저 표시
      return latestB - latestA;
    }),
    [conversationsByScenario]
  );

  // 날짜 문자열 생성 함수 (YYYY-MM-DD 형식)
  const getDateKey = (date: Date | string) => {
    const d = new Date(date);
    return format(d, 'yyyy-MM-dd');
  };

  // 날짜를 한글로 표시 (YYYY년 MM월 DD일)
  const getDateLabel = (dateKey: string) => {
    const [year, month, day] = dateKey.split('-');
    return `${year}년 ${month}월 ${day}일`;
  };

  // 대화 삭제 mutation
  const deleteMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      return await apiRequest('DELETE', `/api/conversations/${conversationId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
      queryClient.invalidateQueries({ queryKey: ['/api/feedbacks'] });
      toast({
        title: "삭제 완료",
        description: "대화 기록이 삭제되었습니다.",
      });
      setDeleteDialogOpen(false);
      setConversationToDelete(null);
    },
    onError: (error) => {
      console.error("삭제 실패:", error);
      toast({
        title: "삭제 실패",
        description: "대화 기록을 삭제할 수 없습니다.",
        variant: "destructive",
      });
    },
  });

  const handleDeleteClick = (conversationId: string) => {
    setConversationToDelete(conversationId);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (conversationToDelete) {
      deleteMutation.mutate(conversationToDelete);
    }
  };

  // 시나리오별 대화를 날짜별로 다시 그룹화
  const groupConversationsByDate = (conversations: typeof sortedConversations) => {
    return conversations.reduce((acc, conversation) => {
      const dateKey = getDateKey(conversation.createdAt);
      if (!acc[dateKey]) {
        acc[dateKey] = [];
      }
      acc[dateKey].push(conversation);
      return acc;
    }, {} as Record<string, typeof sortedConversations>);
  };

  // 세션 타입 정의
  type Session = {
    sessionKey: string;           // "날짜_시나리오ID"
    date: string;                 // "2025-11-19"
    scenarioId: string;
    scenarioTitle: string;
    difficulty: number;
    startTime: Date;              // 그날 첫 대화 시작 시간
    attemptNumber: number;        // 1차, 2차, 3차...
    isCompleted: boolean;         // 모든 대화 완료 여부
    conversations: Conversation[]; // 이 세션의 모든 대화
    strategyReflection?: string;
  };

  // ⚡ 세션 그룹핑: 날짜 + 시나리오로 대화를 세션으로 묶기
  const sessions = useMemo(() => {
    // 완료된 대화만 필터링
    const completedConversations = sortedConversations.filter(c => c.status === 'completed');
    
    // 1단계: 세션별로 그룹핑 (날짜_시나리오ID)
    const sessionMap = new Map<string, Conversation[]>();
    
    completedConversations.forEach(conversation => {
      const dateKey = getDateKey(conversation.createdAt);
      const sessionKey = `${dateKey}_${conversation.scenarioId}`;
      
      if (!sessionMap.has(sessionKey)) {
        sessionMap.set(sessionKey, []);
      }
      sessionMap.get(sessionKey)!.push(conversation);
    });

    // 2단계: 시나리오별로 세션을 그룹핑하여 시도 차수 계산
    const scenarioSessions = new Map<string, Session[]>();
    
    sessionMap.forEach((conversations, sessionKey) => {
      const [date, scenarioId] = sessionKey.split('_');
      const scenario = scenariosMap.get(scenarioId);
      
      // 세션의 시작 시간 = 가장 빠른 대화 시간
      const sortedByTime = [...conversations].sort((a, b) => 
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      
      // 전략 회고가 있는지 확인
      const conversationWithStrategy = conversations.find(c => c.strategyReflection);
      
      const session: Session = {
        sessionKey,
        date,
        scenarioId,
        scenarioTitle: scenario?.title || scenarioId,
        difficulty: scenario?.difficulty || 1,
        startTime: new Date(sortedByTime[0].createdAt),
        attemptNumber: 0, // 나중에 계산
        isCompleted: conversations.every(c => c.status === 'completed'),
        conversations: sortedByTime,
        strategyReflection: conversationWithStrategy?.strategyReflection || undefined,
      };
      
      if (!scenarioSessions.has(scenarioId)) {
        scenarioSessions.set(scenarioId, []);
      }
      scenarioSessions.get(scenarioId)!.push(session);
    });

    // 3단계: 각 시나리오 내에서 날짜순으로 정렬하여 시도 차수 부여
    const allSessions: Session[] = [];
    
    scenarioSessions.forEach((sessions, scenarioId) => {
      // 날짜순 정렬 (오래된 것부터)
      const sortedSessions = sessions.sort((a, b) => 
        a.startTime.getTime() - b.startTime.getTime()
      );
      
      // 시도 차수 부여
      sortedSessions.forEach((session, index) => {
        session.attemptNumber = index + 1;
        allSessions.push(session);
      });
    });

    // 4단계: 전체 세션을 시간 역순으로 정렬 (최신이 맨 위)
    return allSessions.sort((a, b) => 
      b.startTime.getTime() - a.startTime.getTime()
    );
  }, [sortedConversations, scenariosMap]);

  // 시나리오 정보 가져오기
  const getScenarioInfo = (scenarioId: string) => {
    const scenario = scenariosMap.get(scenarioId); // ⚡ O(1) 조회
    return {
      title: scenario?.title || scenarioId,
      difficulty: scenario?.difficulty || 1,
    };
  };

  // 시나리오의 모든 페르소나와의 대화가 완료되었는지 확인
  const isScenarioFullyCompleted = (scenarioId: string) => {
    const scenario = scenariosMap.get(scenarioId); // ⚡ O(1) 조회
    if (!scenario || !scenario.personas) return false;
    
    const scenarioConversations = conversationsByScenario[scenarioId] || [];
    const completedPersonaIds = scenarioConversations
      .filter(c => c.status === 'completed')
      .map(c => c.personaId);
    
    return scenario.personas.length === completedPersonaIds.length;
  };

  // ⚡ 통합 로딩 상태
  const isLoading = conversationsLoading || feedbacksLoading;

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

  if (isLoading) {
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
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="w-5 h-5" />
                  시나리오별 대화 기록
                </CardTitle>
              </CardHeader>
              <CardContent>
                {sessions.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="text-slate-600">아직 완료된 대화 기록이 없습니다.</div>
                    <Button 
                      onClick={() => window.location.href = '/home'}
                      className="mt-4"
                      data-testid="start-conversation-button"
                    >
                      첫 대화 시작하기
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* 세션별 대화 기록 카드 리스트 (시간 역순) */}
                    {sessions.map((session) => {
                      const scenario = scenariosMap.get(session.scenarioId);
                      
                      return (
                        <div 
                          key={session.sessionKey} 
                          className="border border-slate-200 rounded-lg bg-white overflow-hidden"
                          data-testid={`session-${session.sessionKey}`}
                        >
                          {/* 세션 헤더 */}
                          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-slate-200 p-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3 flex-wrap">
                                <CalendarDays className="w-5 h-5 text-blue-600" />
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-slate-600">
                                      {getDateLabel(session.date)} {format(session.startTime, 'HH:mm')}
                                    </span>
                                  </div>
                                  <h3 className="font-semibold text-slate-900 mt-1">{session.scenarioTitle}</h3>
                                </div>
                                <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                                  #{session.attemptNumber}회 시도
                                </Badge>
                                <Badge variant="outline">난이도 {session.difficulty}</Badge>
                                {session.isCompleted && (
                                  <Badge className="bg-green-600">완료</Badge>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* 세션 내용 */}
                          <div className="p-4 space-y-4">
                            {/* 전략 회고 (있으면 표시) */}
                            {session.strategyReflection && (
                              <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-4">
                                <div className="space-y-3">
                                  <div className="flex items-center gap-3">
                                    <Target className="w-5 h-5 text-green-600" />
                                    <h4 className="font-semibold text-slate-900">전략 회고</h4>
                                  </div>
                                  
                                  {/* 대화 순서 표시 */}
                                  {session.conversations[0]?.conversationOrder && (() => {
                                    const orderedPersonas = session.conversations[0].conversationOrder
                                      .map((personaId: string) => scenario?.personas?.find((p: any) => p.id === personaId))
                                      .filter(p => p !== undefined);
                                    
                                    return orderedPersonas.length > 0 && (
                                  return (
                                    <div className="bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 rounded-lg p-4 mb-4">
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                          <Target className="w-5 h-5 text-purple-600" />
                                          <div>
                                            <h4 className="font-semibold text-slate-900">대화 순서 전략 평가</h4>
                                            <p className="text-sm text-slate-600">모든 대화를 완료했습니다. 전략적 선택을 분석해보세요.</p>
                                          </div>
                                        </div>
                                        <Button 
                                          variant="default"
                                          className="bg-purple-600 hover:bg-purple-700"
                                          data-testid={`strategy-analysis-${scenarioId}`}
                                          onClick={() => window.location.href = `/strategy/${scenarioId}`}
                                        >
                                          전략 평가 보기
                                        </Button>
                                      </div>
                                    </div>
                                  );
                                }
                                
                                return null; // 전략 회고는 날짜별 섹션에서 표시
                              })()}
                              
                              {/* 날짜별 대화 상대 리스트 */}
                              {(() => {
                                const conversationsByDate = groupConversationsByDate(scenarioConversations);
                                const sortedDates = Object.keys(conversationsByDate).sort((a, b) => 
                                  new Date(b).getTime() - new Date(a).getTime()
                                );
                                
                                // 전략 회고가 있는 대화 찾기
                                const conversationWithStrategy = scenarioConversations.find(c => c.strategyReflection);
                                const strategyDate = conversationWithStrategy ? getDateKey(conversationWithStrategy.createdAt) : null;
                                
                                return sortedDates.map((dateKey) => {
                                  const dateConversations = conversationsByDate[dateKey];
                                  
                                  return (
                                    <div key={dateKey} className="space-y-3">
                                      {/* 날짜 헤더 */}
                                      <div className="flex items-center gap-2 mt-4 mb-2">
                                        <CalendarDays className="w-4 h-4 text-slate-500" />
                                        <h5 className="text-sm font-semibold text-slate-700">
                                          {getDateLabel(dateKey)}
                                        </h5>
                                        <div className="flex-1 h-px bg-slate-200"></div>
                                      </div>
                                      
                                      {/* 이 날짜에 전략 회고가 제출되었다면 표시 */}
                                      {strategyDate === dateKey && conversationWithStrategy && conversationWithStrategy.strategyReflection && (() => {
                                        // 대화 순서 표시를 위한 페르소나 배열 생성
                                        const orderedPersonas = (conversationWithStrategy.conversationOrder || [])
                                          .map(personaId => scenario?.personas?.find((p: any) => p.id === personaId))
                                          .filter(p => p !== undefined);
                                        
                                        return (
                                          <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-5 mb-4 ml-6">
                                            <div className="space-y-4">
                                              <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                                                  <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                  </svg>
                                                </div>
                                                <div className="flex-1">
                                                  <h4 className="font-semibold text-slate-900">전략 회고 제출 완료</h4>
                                                  <p className="text-sm text-slate-600">
                                                    {format(new Date(conversationWithStrategy.createdAt), 'HH:mm')}에 제출됨
                                                  </p>
                                                </div>
                                              </div>
                                              
                                              {/* 대화 순서 표시 */}
                                              {orderedPersonas.length > 0 && (
                                                <div className="bg-white rounded-lg p-4 space-y-2">
                                                  <h5 className="text-sm font-semibold text-slate-700 mb-3">대화 순서</h5>
                                                  <div className="flex items-center gap-2 flex-wrap">
                                                    {orderedPersonas.map((persona: any, index: number) => (
                                                      <div key={persona.id} className="flex items-center gap-2">
                                                        <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 rounded-lg border border-blue-200">
                                                          <span className="text-xs font-bold text-blue-600">{index + 1}</span>
                                                          <span className="text-sm text-slate-700">{persona.name}</span>
                                                        </div>
                                                        {index < orderedPersonas.length - 1 && (
                                                          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                                          </svg>
                                                        )}
                                                      </div>
                                                    ))}
                                                  </div>
                                                </div>
                                              )}
                                              
                                              {/* 전략 회고 내용 */}
                                              <div className="bg-white rounded-lg p-4">
                                                <h5 className="text-sm font-semibold text-slate-700 mb-2">전략 회고</h5>
                                                <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">
                                                  {conversationWithStrategy.strategyReflection}
                                                </p>
                                              </div>
                                            </div>
                                          </div>
                                        );
                                      })()}
                                      
                                      {/* 해당 날짜의 대화 상대들 - 완료된 대화만 표시 */}
                                      {dateConversations
                                        .filter((c: Conversation) => c.status === 'completed')
                                        .map((conversation: Conversation) => {
                                        const scenario = scenariosMap.get(conversation.scenarioId); // ⚡ O(1) 조회
                                        // 1순위: 대화 생성 시점의 페르소나 스냅샷, 2순위: 현재 시나리오에서 찾기 (하위 호환성)
                                        const persona = (conversation as any).personaSnapshot 
                                          || scenario?.personas?.find((p: any) => p.id === conversation.personaId);
                                        const relatedFeedback = feedbacksMap.get(conversation.id); // ⚡ O(1) 조회
                                        
                                        // 같은 페르소나와의 시도 번호 계산 (같은 날짜 내에서)
                                        const samePersonaConversations = dateConversations
                                          .filter((c: Conversation) => 
                                            c.personaId === conversation.personaId && 
                                            c.status === 'completed'
                                          )
                                          .sort((a, b) => 
                                            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
                                          );
                                        
                                        const attemptNumber = samePersonaConversations.findIndex(
                                          c => c.id === conversation.id
                                        ) + 1;
                                        const hasMultipleAttempts = samePersonaConversations.length > 1;
                                        
                                        return (
                                          <div 
                                            key={conversation.id}
                                            className="border rounded-lg p-4 bg-white hover:bg-slate-50 transition-colors ml-6"
                                            data-testid={`conversation-${conversation.id}`}
                                          >
                                            <div className="flex items-center justify-between mb-3">
                                              <div className="flex items-center gap-2 flex-wrap">
                                                {/* 부서 (텍스트) + 이름 + 직급/직위 (텍스트) */}
                                                <h4 className="font-semibold text-slate-900 text-base">
                                                  {persona?.department && <span className="text-slate-600 font-normal">{persona.department} </span>}
                                                  {persona?.name || '알 수 없음'}
                                                  {(persona?.position || persona?.role) && <span className="text-slate-600 font-normal"> {persona?.position || persona?.role}</span>}
                                                </h4>
                                                
                                                {/* MBTI (뱃지) */}
                                                {persona?.mbti && (
                                                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                                                    {persona.mbti}
                                                  </Badge>
                                                )}
                                                
                                                {/* 경력 (뱃지) */}
                                                {persona?.experience && (
                                                  <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">
                                                    {persona.experience}
                                                  </Badge>
                                                )}
                                                
                                                {/* 상태 뱃지 */}
                                                <Badge variant={conversation.status === 'completed' ? 'default' : 'secondary'}>
                                                  {conversation.status === 'completed' ? '완료' : '진행중'}
                                                </Badge>
                                                
                                                {/* 시도 번호 뱃지 (같은 페르소나와 여러 번 대화한 경우만) */}
                                                {hasMultipleAttempts && (
                                                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                                                    #{attemptNumber}회 시도
                                                  </Badge>
                                                )}
                                              </div>
                                              <div className="flex items-center gap-2 text-sm text-slate-600">
                                                {format(new Date(conversation.createdAt), 'HH:mm')}
                                              </div>
                                            </div>
                                            
                                            <div className="flex items-center justify-between">
                                              <div className="flex items-center gap-4 text-sm">
                                                {conversation.status === 'completed' && relatedFeedback && (
                                                  <div className="flex items-center gap-1">
                                                    <Star className="w-4 h-4 text-yellow-500" />
                                                    <span className={`font-medium ${getScoreColor(relatedFeedback.overallScore)}`}>
                                                      {relatedFeedback.overallScore}점
                                                    </span>
                                                    <Badge variant="outline" className="ml-1">
                                                      {getScoreBadge(relatedFeedback.overallScore)}
                                                    </Badge>
                                                  </div>
                                                )}
                                                <div className="text-slate-600">
                                                  메시지 {conversation.messages.length}개
                                                </div>
                                              </div>
                                              
                                              <div className="flex gap-2">
                                                <Button
                                                  variant="outline"
                                                  size="sm"
                                                  onClick={() => window.location.href = `/chat/${conversation.id}`}
                                                  data-testid={`view-conversation-${conversation.id}`}
                                                >
                                                  대화 보기
                                                </Button>
                                                {conversation.status === 'completed' ? (
                                                  <Button
                                                    variant="default"
                                                    size="sm"
                                                    onClick={() => window.location.href = `/feedback/${conversation.id}`}
                                                    data-testid={`view-feedback-${conversation.id}`}
                                                  >
                                                    피드백 보기
                                                  </Button>
                                                ) : (
                                                  <Button
                                                    variant="default"
                                                    size="sm"
                                                    onClick={() => window.location.href = `/chat/${conversation.id}`}
                                                    data-testid={`continue-conversation-${conversation.id}`}
                                                  >
                                                    대화 이어하기
                                                  </Button>
                                                )}
                                                <Button
                                                  variant="outline"
                                                  size="sm"
                                                  onClick={() => handleDeleteClick(conversation.id)}
                                                  data-testid={`delete-conversation-${conversation.id}`}
                                                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                                >
                                                  <Trash2 className="w-4 h-4" />
                                                </Button>
                                              </div>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  );
                                });
                              })()}
                            </div>
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
            {/* 통계 카드들 */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-slate-600">총 대화 수</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-slate-900" data-testid="total-conversations">
                    {stats.totalConversations}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-slate-600">완료한 대화</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600" data-testid="completed-conversations">
                    {stats.completedConversations}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-slate-600">평균 점수</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className={`text-2xl font-bold ${getScoreColor(stats.averageScore)}`} data-testid="average-score">
                    {stats.averageScore}점
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-slate-600">받은 피드백</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-blue-600" data-testid="total-feedbacks">
                    {stats.totalFeedbacks}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* 종합 분석 안내 */}
            {stats.totalFeedbacks > 0 && (
              <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900 mb-2 flex items-center gap-2">
                        <BarChart3 className="w-5 h-5 text-blue-600" />
                        전체 이력을 종합한 상세 분석 리포트
                      </h3>
                      <p className="text-slate-600 text-sm">
                        카테고리별 평균, 성장 추이, 강점/약점 패턴을 확인하고 맞춤형 개선 방향을 받아보세요.
                      </p>
                    </div>
                    <Link href="/analytics">
                      <Button size="lg" data-testid="view-analytics-button">
                        종합 분석 보기
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* 최근 피드백 */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Award className="w-5 h-5" />
                  최근 피드백
                </CardTitle>
              </CardHeader>
              <CardContent>
                {feedbacksLoading ? (
                  <div className="text-center py-8">
                    <div className="text-slate-600">피드백을 불러오는 중...</div>
                  </div>
                ) : feedbacks.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="text-slate-600">아직 받은 피드백이 없습니다.</div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {feedbacks.slice(0, 5).map((feedback: Feedback) => (
                      <div 
                        key={feedback.id} 
                        className="border rounded-lg p-4"
                        data-testid={`feedback-${feedback.id}`}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className={`text-xl font-bold ${getScoreColor(feedback.overallScore)}`}>
                              {feedback.overallScore}점
                            </span>
                            <Badge variant="outline">
                              {getScoreBadge(feedback.overallScore)}
                            </Badge>
                          </div>
                          <div className="text-sm text-slate-600">
                            {format(new Date(feedback.createdAt), 'yyyy.MM.dd')}
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                          <div>
                            <div className="text-slate-600">명확성·논리</div>
                            <div className="font-medium">{feedback.detailedFeedback.scores.clarityLogic}/5</div>
                          </div>
                          <div>
                            <div className="text-slate-600">경청·공감</div>
                            <div className="font-medium">{feedback.detailedFeedback.scores.listeningEmpathy}/5</div>
                          </div>
                          <div>
                            <div className="text-slate-600">적절성·적응</div>
                            <div className="font-medium">{feedback.detailedFeedback.scores.appropriatenessAdaptability}/5</div>
                          </div>
                          <div>
                            <div className="text-slate-600">설득력·영향</div>
                            <div className="font-medium">{feedback.detailedFeedback.scores.persuasivenessImpact}/5</div>
                          </div>
                          <div>
                            <div className="text-slate-600">전략적 소통</div>
                            <div className="font-medium">{feedback.detailedFeedback.scores.strategicCommunication}/5</div>
                          </div>
                        </div>

                        {feedback.detailedFeedback.strengths && feedback.detailedFeedback.strengths.length > 0 && (
                          <div className="mt-3 pt-3 border-t">
                            <div className="text-sm text-slate-600 mb-1">주요 강점</div>
                            <div className="text-sm text-slate-900">
                              {feedback.detailedFeedback.strengths.join(', ')}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
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
            <AlertDialogTitle>대화 기록 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              정말로 이 대화 기록을 삭제하시겠습니까?
              <br />
              <span className="font-semibold text-red-600">삭제된 대화와 피드백은 복구할 수 없습니다.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="cancel-delete">취소</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-red-600 hover:bg-red-700"
              data-testid="confirm-delete"
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}