import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { CalendarDays, Star, TrendingUp, MessageSquare, Award, History, BarChart3, Users, Target } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { type Conversation, type Feedback, type User } from "@shared/schema";
import { format } from "date-fns";

export default function MyPage() {
  const [selectedView, setSelectedView] = useState<"history" | "stats">("history");
  const { user } = useAuth();

  // 사용자의 대화 기록 조회
  const { data: conversations = [], isLoading: conversationsLoading } = useQuery<Conversation[]>({
    queryKey: ['/api/conversations'],
    enabled: !!user,
  });

  // 사용자의 피드백 기록 조회  
  const { data: feedbacks = [], isLoading: feedbacksLoading } = useQuery<Feedback[]>({
    queryKey: ['/api/feedbacks'],
    enabled: !!user,
  });

  // 시나리오 데이터 조회
  const { data: scenarios = [] } = useQuery<any[]>({
    queryKey: ['/api/scenarios'],
  });

  // 통계 계산
  const stats = {
    totalConversations: conversations.length,
    completedConversations: conversations.filter((c: Conversation) => c.status === 'completed').length,
    averageScore: feedbacks.length > 0 
      ? Math.round(feedbacks.reduce((sum: number, f: Feedback) => sum + f.overallScore, 0) / feedbacks.length)
      : 0,
    totalFeedbacks: feedbacks.length,
  };

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
    const scenario = scenarios.find(s => s.id === conversation.scenarioId);
    if (!scenario) return conversation.scenarioId || '일반 대화';
    
    const persona = scenario.personas?.find((p: any) => p.id === conversation.personaId);
    if (!persona) return scenario.title || '일반 대화';
    
    // undefined 방지: 각 필드가 존재하는 경우만 포함
    const parts = [];
    if (persona.department) parts.push(persona.department);
    if (persona.name) parts.push(persona.name);
    if (persona.role) parts.push(persona.role);
    const personaInfo = parts.join(' ');
    const mbtiInfo = persona.mbti ? ` (${persona.mbti})` : '';
    
    return `${scenario.title} - ${personaInfo}${mbtiInfo}`;
  };

  // 대화 리스트를 최근 날짜 순으로 정렬
  const sortedConversations = [...conversations].sort((a, b) => 
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  // 시나리오별로 대화 그룹화
  const conversationsByScenario = sortedConversations.reduce((acc, conversation) => {
    const scenarioId = conversation.scenarioId;
    if (!acc[scenarioId]) {
      acc[scenarioId] = [];
    }
    acc[scenarioId].push(conversation);
    return acc;
  }, {} as Record<string, typeof sortedConversations>);

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

  // 시나리오 정보 가져오기
  const getScenarioInfo = (scenarioId: string) => {
    const scenario = scenarios.find(s => s.id === scenarioId);
    return {
      title: scenario?.title || scenarioId,
      difficulty: scenario?.difficulty || 1,
    };
  };

  // 시나리오의 모든 페르소나와의 대화가 완료되었는지 확인
  const isScenarioFullyCompleted = (scenarioId: string) => {
    const scenario = scenarios.find(s => s.id === scenarioId);
    if (!scenario || !scenario.personas) return false;
    
    const scenarioConversations = conversationsByScenario[scenarioId] || [];
    const completedPersonaIds = scenarioConversations
      .filter(c => c.status === 'completed')
      .map(c => c.personaId);
    
    return scenario.personas.length === completedPersonaIds.length;
  };

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
              <Button
                onClick={() => window.location.href = '/home'}
                variant="outline"
                data-testid="back-to-home-button"
              >
                홈으로 돌아가기
              </Button>
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
                {conversationsLoading ? (
                  <div className="text-center py-8">
                    <div className="text-slate-600">대화 기록을 불러오는 중...</div>
                  </div>
                ) : conversations.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="text-slate-600">아직 대화 기록이 없습니다.</div>
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
                    {Object.entries(conversationsByScenario).map(([scenarioId, scenarioConversations]) => {
                      const scenarioInfo = getScenarioInfo(scenarioId);
                      const scenario = scenarios.find(s => s.id === scenarioId);
                      const completedCount = scenarioConversations.filter(c => c.status === 'completed').length;
                      const totalPersonas = scenario?.personas?.length || 0;
                      const isFullyCompleted = isScenarioFullyCompleted(scenarioId);
                      
                      return (
                        <AccordionItem key={scenarioId} value={scenarioId} data-testid={`scenario-${scenarioId}`}>
                          <AccordionTrigger className="hover:no-underline">
                            <div className="flex items-center justify-between w-full pr-4">
                              <div className="flex items-center gap-3">
                                <Users className="w-5 h-5 text-blue-600" />
                                <h3 className="font-semibold text-slate-900 text-left">{scenarioInfo.title}</h3>
                                <Badge variant="outline">난이도 {scenarioInfo.difficulty}</Badge>
                                {isFullyCompleted && (
                                  <Badge className="bg-green-600">완료</Badge>
                                )}
                              </div>
                              <div className="text-sm text-slate-600">
                                {completedCount}/{totalPersonas} 대화 완료
                              </div>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent>
                            <div className="space-y-3 pt-3">
                              {/* 전략 평가 버튼 (시나리오 완료 시에만 표시) */}
                              {isFullyCompleted && (
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
                              )}
                              
                              {/* 날짜별 대화 상대 리스트 */}
                              {(() => {
                                const conversationsByDate = groupConversationsByDate(scenarioConversations);
                                const sortedDates = Object.keys(conversationsByDate).sort((a, b) => 
                                  new Date(b).getTime() - new Date(a).getTime()
                                );
                                
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
                                      
                                      {/* 해당 날짜의 대화 상대들 */}
                                      {dateConversations.map((conversation: Conversation) => {
                                        const scenario = scenarios.find(s => s.id === conversation.scenarioId);
                                        const persona = scenario?.personas?.find((p: any) => p.id === conversation.personaId);
                                        const relatedFeedback = feedbacks.find((f: Feedback) => f.conversationId === conversation.id);
                                        
                                        return (
                                          <div 
                                            key={conversation.id}
                                            className="border rounded-lg p-4 bg-white hover:bg-slate-50 transition-colors ml-6"
                                            data-testid={`conversation-${conversation.id}`}
                                          >
                                            <div className="flex items-center justify-between mb-3">
                                              <div className="flex items-center gap-2 flex-wrap">
                                                {/* 이름 */}
                                                <h4 className="font-semibold text-slate-900 text-base">
                                                  {persona?.name || '알 수 없음'}
                                                </h4>
                                                
                                                {/* 부서 */}
                                                {persona?.department && (
                                                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                                                    {persona.department}
                                                  </Badge>
                                                )}
                                                
                                                {/* 직급/직위 */}
                                                {(persona?.position || persona?.role) && (
                                                  <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                                                    {persona?.position || persona?.role}
                                                  </Badge>
                                                )}
                                                
                                                {/* MBTI */}
                                                {persona?.mbti && (
                                                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                                                    {persona.mbti}
                                                  </Badge>
                                                )}
                                                
                                                {/* 경력 */}
                                                {persona?.experience && (
                                                  <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">
                                                    {persona.experience}
                                                  </Badge>
                                                )}
                                                
                                                {/* 상태 뱃지 */}
                                                <Badge variant={conversation.status === 'completed' ? 'default' : 'secondary'}>
                                                  {conversation.status === 'completed' ? '완료' : '진행중'}
                                                </Badge>
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
                                                    onClick={() => window.location.href = `/scenario/${conversation.scenarioId}/persona/${conversation.personaId}/chat/${conversation.id}`}
                                                    data-testid={`continue-conversation-${conversation.id}`}
                                                  >
                                                    대화 이어하기
                                                  </Button>
                                                )}
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
    </div>
  );
}