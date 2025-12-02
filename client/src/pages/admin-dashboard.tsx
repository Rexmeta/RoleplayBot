import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

interface AnalyticsOverview {
  totalSessions: number;
  completedSessions: number;
  averageScore: number;
  completionRate: number;
  totalUsers: number;
  activeUsers: number;
  participationRate: number;
  scenarioStats: Record<string, { count: number; name: string; difficulty: number }>;
  mbtiUsage: Record<string, number>;
  totalScenarios: number;
  // 확장 지표
  dau: number;
  wau: number;
  mau: number;
  sessionsPerUser: number;
  newUsers: number;
  returningUsers: number;
  returningRate: number;
  scenarioAverages: Array<{ id: string; name: string; averageScore: number; sessionCount: number }>;
  mbtiAverages: Array<{ mbti: string; averageScore: number; sessionCount: number }>;
  topActiveUsers: Array<{ userId: string; sessionCount: number }>;
  topScenarios: Array<{ id: string; name: string; count: number; difficulty: number }>;
  hardestScenarios: Array<{ id: string; name: string; averageScore: number; sessionCount: number }>;
}

interface PerformanceData {
  scoreRanges: {
    excellent: number;
    good: number;
    average: number;
    needsImprovement: number;
    poor: number;
  };
  categoryPerformance: Record<string, {
    total: number;
    count: number;
    name: string;
    average: number;
  }>;
  scenarioPerformance: Record<string, {
    scores: number[];
    name: string;
    average: number;
    sessionCount: number;
    difficulty: number;
    personaCount: number;
  }>;
  mbtiPerformance: Record<string, { scores: number[]; count: number; average: number }>;
  topStrengths: Array<{ text: string; count: number }>;
  topImprovements: Array<{ text: string; count: number }>;
  highestScore: number;
  averageScore: number;
  feedbackCompletionRate: number;
  totalFeedbacks: number;
  recentSessions: Array<{
    id: number;
    score: number;
    scenarioName: string;
    mbti: string;
    userId: string;
    completedAt: string;
    difficulty: number;
  }>;
}

interface TrendsData {
  dailyUsage: Array<{
    date: string;
    sessions: number;
    completed: number;
  }>;
  performanceTrends: Array<{
    session: number;
    score: number;
    date: string;
  }>;
}

export default function AdminDashboard() {
  const { data: overview, isLoading: overviewLoading } = useQuery<AnalyticsOverview>({
    queryKey: ["/api/admin/analytics/overview"],
    staleTime: 1000 * 60 * 10, // 10분간 캐시 유지 (통계 데이터)
    gcTime: 1000 * 60 * 30,     // 30분간 메모리 유지
  });

  const { data: performance, isLoading: performanceLoading } = useQuery<PerformanceData>({
    queryKey: ["/api/admin/analytics/performance"],
    staleTime: 1000 * 60 * 10, // 10분간 캐시 유지 (통계 데이터)
    gcTime: 1000 * 60 * 30,     // 30분간 메모리 유지
  });

  const { data: trends, isLoading: trendsLoading } = useQuery<TrendsData>({
    queryKey: ["/api/admin/analytics/trends"],
    staleTime: 1000 * 60 * 10, // 10분간 캐시 유지 (통계 데이터)
    gcTime: 1000 * 60 * 30,     // 30분간 메모리 유지
  });

  // 현재 시나리오 구조에 맞게 시나리오 데이터 가져오기
  const { data: scenarios = [] } = useQuery({
    queryKey: ['/api/scenarios'],
    queryFn: () => fetch('/api/scenarios').then(res => res.json()),
    staleTime: 1000 * 60 * 30, // 30분간 캐시 유지 (시나리오는 자주 변경되지 않음)
    gcTime: 1000 * 60 * 60,     // 1시간 메모리 유지
  });

  // MBTI 페르소나 데이터 가져오기
  const { data: personas = [] } = useQuery({
    queryKey: ['/api/admin/personas'],
    queryFn: () => fetch('/api/admin/personas').then(res => res.json()),
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
  });

  if (overviewLoading || performanceLoading || trendsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-corporate-600"></div>
      </div>
    );
  }

  // Prepare data for charts
  const scoreDistributionData = performance ? [
    { name: "탁월 (90-100)", value: performance.scoreRanges.excellent, color: "#10b981" },
    { name: "우수 (80-89)", value: performance.scoreRanges.good, color: "#3b82f6" },
    { name: "보통 (70-79)", value: performance.scoreRanges.average, color: "#f59e0b" },
    { name: "개선 필요 (60-69)", value: performance.scoreRanges.needsImprovement, color: "#f97316" },
    { name: "미흡 (<60)", value: performance.scoreRanges.poor, color: "#ef4444" }
  ] : [];

  const categoryData = performance ? Object.entries(performance.categoryPerformance).map(([key, data]) => ({
    category: data.name,
    average: data.average,
    count: data.count
  })) : [];

  const scenarioPopularityData = overview ? Object.entries(overview.scenarioStats).map(([scenarioId, data]) => {
    return {
      name: data.name,
      sessions: data.count,
      difficulty: data.difficulty
    };
  }) : [];

  // MBTI 사용 분석 데이터
  const mbtiUsageData = overview ? Object.entries(overview.mbtiUsage).map(([mbtiId, count]) => ({
    name: mbtiId.toUpperCase(),
    count,
    percentage: Math.round((count / overview.totalSessions) * 100)
  })) : [];

  const scenarioPerformanceData = performance ? Object.entries(performance.scenarioPerformance).map(([scenarioId, data]) => {
    const scenario = scenarios.find((s: any) => s.id === scenarioId);
    return {
      name: data.name || scenario?.title || scenarioId,
      average: data.average,
      sessionCount: data.sessionCount,
      difficulty: data.difficulty || scenario?.difficulty || 1,
      personaCount: data.personaCount || 0
    };
  }) : [];

  // 난이도별 선택 인기도 계산 - 사용자가 선택한 난이도 기반
  const difficultyPopularityData = overview?.difficultyUsage ? 
    overview.difficultyUsage.map((d: any) => ({
      difficulty: `Lv${d.level}`,
      count: d.count
    })) : [];

  // 페르소나 수별 인기도 계산 - 유저가 선택한 수(세션 수) 기준
  const scenarioDifficultyData = scenarios.reduce((acc: any[], scenario: any) => {
    const personaCount = scenario.personas?.length || 0;
    if (personaCount === 0) return acc;
    
    const stats = overview?.scenarioStats?.[scenario.id];
    const sessionCount = stats?.count || 0;
    
    const existing = acc.find(d => d.personaCount === personaCount);
    if (existing) {
      existing.count += sessionCount;
    } else {
      acc.push({
        personaCount,
        count: sessionCount
      });
    }
    return acc;
  }, []).sort((a: any, b: any) => a.personaCount - b.personaCount);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="container mx-auto p-6 space-y-6" data-testid="admin-dashboard">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link href="/home" className="flex items-center space-x-2 text-corporate-600 hover:text-corporate-700" data-testid="back-to-home">
            <i className="fas fa-arrow-left"></i>
            <span className="text-sm">홈으로</span>
          </Link>
          <div className="border-l border-slate-300 pl-4">
            <h1 className="text-3xl font-bold text-slate-900" data-testid="dashboard-title">관리자 대시보드</h1>
            <p className="text-slate-600 mt-2">교육 결과 분석 및 성과 현황</p>
          </div>
        </div>
        <div className="flex space-x-3">
          <Link href="/admin-management">
            <Button className="bg-corporate-600 hover:bg-corporate-700" data-testid="link-management">
              <i className="fas fa-cogs mr-2"></i>
              콘텐츠 관리
            </Button>
          </Link>
        </div>
      </div>

      {/* Detailed Analytics */}
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="overview" data-testid="tab-overview">개요</TabsTrigger>
          <TabsTrigger value="performance" data-testid="tab-performance">성과 분석</TabsTrigger>
          <TabsTrigger value="scenarios" data-testid="tab-scenarios">시나리오 분석</TabsTrigger>
          <TabsTrigger value="mbti" data-testid="tab-mbti">MBTI 분석</TabsTrigger>
          <TabsTrigger value="trends" data-testid="tab-trends">트렌드 분석</TabsTrigger>
          <TabsTrigger value="content" data-testid="tab-content">컨텐츠 현황</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          {/* Top Overview Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="card-enhanced" data-testid="card-session-summary">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">훈련 세션</CardTitle>
                <i className="fas fa-chart-line text-blue-600"></i>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="session-summary">
                  {overview?.completedSessions || 0}/{overview?.totalSessions || 0}
                </div>
                <p className="text-xs text-slate-600">완료율 {overview?.completionRate || 0}%</p>
              </CardContent>
            </Card>

            <Card className="card-enhanced" data-testid="card-average-score">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">평균 점수</CardTitle>
                <i className="fas fa-star text-yellow-600"></i>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="average-score">{overview?.averageScore || 0}점</div>
                <p className="text-xs text-slate-600">전체 세션 평균</p>
              </CardContent>
            </Card>

            <Card className="card-enhanced" data-testid="card-participation">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">참여인수</CardTitle>
                <i className="fas fa-users text-green-600"></i>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="participation-rate">{overview?.participationRate || 0}%</div>
                <p className="text-xs text-slate-600">{overview?.activeUsers || 0}/{overview?.totalUsers || 0} 사용자</p>
              </CardContent>
            </Card>
          </div>

          {/* Extended Metrics - 사용자 활동 기간 분석 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* DAU/WAU/MAU 탭 카드 */}
            <Card className="card-enhanced" data-testid="card-dau-wau-mau">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <i className="fas fa-calendar text-purple-600"></i>
                  사용자 활동 기간
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="dau" className="w-full">
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="dau" data-testid="tab-dau">일간</TabsTrigger>
                    <TabsTrigger value="wau" data-testid="tab-wau">주간</TabsTrigger>
                    <TabsTrigger value="mau" data-testid="tab-mau">월간</TabsTrigger>
                  </TabsList>
                  <TabsContent value="dau" className="mt-4">
                    <div className="text-3xl font-bold text-purple-600" data-testid="dau-value">{overview?.dau || 0}명</div>
                    <p className="text-sm text-slate-600 mt-2">오늘 활동한 사용자</p>
                  </TabsContent>
                  <TabsContent value="wau" className="mt-4">
                    <div className="text-3xl font-bold text-indigo-600" data-testid="wau-value">{overview?.wau || 0}명</div>
                    <p className="text-sm text-slate-600 mt-2">이번 주 활동한 사용자</p>
                  </TabsContent>
                  <TabsContent value="mau" className="mt-4">
                    <div className="text-3xl font-bold text-teal-600" data-testid="mau-value">{overview?.mau || 0}명</div>
                    <p className="text-sm text-slate-600 mt-2">이번 달 활동한 사용자</p>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            {/* Sessions Per User */}
            <Card className="card-enhanced" data-testid="card-sessions-per-user">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">인당 세션</CardTitle>
                <i className="fas fa-user-clock text-orange-600"></i>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="sessions-per-user-value">{overview?.sessionsPerUser || 0}회</div>
                <p className="text-xs text-slate-600">유저당 평균 세션 수</p>
              </CardContent>
            </Card>
          </div>

          {/* User Engagement Metrics - 유저 참여 분석 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="card-enhanced" data-testid="card-new-users">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">신규 유저</CardTitle>
                <i className="fas fa-user-plus text-green-600"></i>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="new-users-value">{overview?.newUsers || 0}명</div>
                <p className="text-xs text-slate-600">1회 세션 참여 유저</p>
              </CardContent>
            </Card>

            <Card className="card-enhanced" data-testid="card-returning-users">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">재방문 유저</CardTitle>
                <i className="fas fa-user-check text-blue-600"></i>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="returning-users-value">{overview?.returningUsers || 0}명</div>
                <p className="text-xs text-slate-600">2회 이상 세션 참여</p>
              </CardContent>
            </Card>

            <Card className="card-enhanced" data-testid="card-returning-rate">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">재방문율</CardTitle>
                <i className="fas fa-redo text-yellow-600"></i>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="returning-rate-value">{overview?.returningRate || 0}%</div>
                <p className="text-xs text-slate-600">재방문 유저 비율</p>
              </CardContent>
            </Card>
          </div>

          {/* Rankings - 랭킹 분석 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Top Active Users */}
            <Card className="card-enhanced" data-testid="card-top-users">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <i className="fas fa-trophy text-yellow-500"></i>
                  활동 유저 Top 5
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {overview?.topActiveUsers?.slice(0, 5).map((user, index) => (
                    <div key={user.userId} className="flex justify-between items-center p-2 bg-slate-50 rounded" data-testid={`top-user-${index}`}>
                      <span className="flex items-center gap-2">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                          index === 0 ? 'bg-yellow-400 text-yellow-900' :
                          index === 1 ? 'bg-gray-300 text-gray-700' :
                          index === 2 ? 'bg-orange-300 text-orange-800' :
                          'bg-slate-200 text-slate-600'
                        }`}>
                          {index + 1}
                        </span>
                        <span className="text-sm truncate max-w-[100px]">{user.userId.slice(0, 8)}...</span>
                      </span>
                      <span className="text-sm font-semibold text-corporate-600">{user.sessionCount}회</span>
                    </div>
                  )) || <p className="text-slate-500 text-sm">데이터 없음</p>}
                </div>
              </CardContent>
            </Card>

            {/* Top Scenarios */}
            <Card className="card-enhanced" data-testid="card-top-scenarios">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <i className="fas fa-fire text-red-500"></i>
                  인기 시나리오 Top 5
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {overview?.topScenarios?.map((scenario, index) => (
                    <div key={scenario.id} className="flex justify-between items-center p-2 bg-slate-50 rounded" data-testid={`top-scenario-${index}`}>
                      <span className="flex items-center gap-2">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                          index === 0 ? 'bg-red-400 text-white' :
                          index === 1 ? 'bg-red-300 text-red-800' :
                          'bg-slate-200 text-slate-600'
                        }`}>
                          {index + 1}
                        </span>
                        <span className="text-sm truncate max-w-[120px]">{scenario.name}</span>
                      </span>
                      <span className="text-sm font-semibold text-green-600">{scenario.count}회</span>
                    </div>
                  )) || <p className="text-slate-500 text-sm">데이터 없음</p>}
                </div>
              </CardContent>
            </Card>

            {/* Hardest Scenarios */}
            <Card className="card-enhanced" data-testid="card-hardest-scenarios">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <i className="fas fa-skull text-slate-600"></i>
                  어려운 시나리오 Top 5
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {overview?.hardestScenarios?.map((scenario, index) => (
                    <div key={scenario.id} className="flex justify-between items-center p-2 bg-slate-50 rounded" data-testid={`hardest-scenario-${index}`}>
                      <span className="flex items-center gap-2">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                          index === 0 ? 'bg-slate-700 text-white' :
                          index === 1 ? 'bg-slate-500 text-white' :
                          'bg-slate-200 text-slate-600'
                        }`}>
                          {index + 1}
                        </span>
                        <span className="text-sm truncate max-w-[120px]">{scenario.name}</span>
                      </span>
                      <span className="text-sm font-semibold text-red-600">{scenario.averageScore}점</span>
                    </div>
                  )) || <p className="text-slate-500 text-sm">데이터 없음</p>}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="performance" className="space-y-6">
          {/* 1. 핵심 성과 요약 카드 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="card-enhanced" data-testid="card-perf-average">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">전체 평균 점수</CardTitle>
                <i className="fas fa-chart-bar text-blue-600"></i>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-blue-600" data-testid="perf-average-value">
                  {performance?.averageScore || 0}점
                </div>
                <p className="text-xs text-slate-600 mt-1">전체 {performance?.totalFeedbacks || 0}건 평가 기준</p>
              </CardContent>
            </Card>

            <Card className="card-enhanced" data-testid="card-perf-highest">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">최고 점수</CardTitle>
                <i className="fas fa-trophy text-yellow-500"></i>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-yellow-600" data-testid="perf-highest-value">
                  {performance?.highestScore || 0}점
                </div>
                <p className="text-xs text-slate-600 mt-1">역대 최고 기록</p>
              </CardContent>
            </Card>

            <Card className="card-enhanced" data-testid="card-perf-completion">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">평가 완료율</CardTitle>
                <i className="fas fa-check-circle text-green-600"></i>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-green-600" data-testid="perf-completion-value">
                  {performance?.feedbackCompletionRate || 0}%
                </div>
                <p className="text-xs text-slate-600 mt-1">피드백 완료된 세션</p>
              </CardContent>
            </Card>
          </div>

          {/* 2. 점수 분석 섹션 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Score Distribution */}
            <Card className="card-enhanced" data-testid="card-score-distribution">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <i className="fas fa-pie-chart text-purple-600"></i>
                  점수 분포
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={scoreDistributionData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {scoreDistributionData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Score Trend Line Chart */}
            <Card className="card-enhanced" data-testid="card-score-trend">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <i className="fas fa-chart-line text-indigo-600"></i>
                  점수 추이 (최근 20건)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={trends?.performanceTrends || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="session" label={{ value: "세션", position: "insideBottom", offset: -5 }} />
                    <YAxis domain={[0, 100]} label={{ value: "점수", angle: -90, position: "insideLeft" }} />
                    <Tooltip formatter={(value) => [`${value}점`, "점수"]} />
                    <Line type="monotone" dataKey="score" stroke="#6366f1" strokeWidth={2} dot={{ fill: "#6366f1" }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* 3. 카테고리 분석 + 강점/개선점 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Category Performance */}
            <Card data-testid="card-category-performance">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <i className="fas fa-tags text-blue-600"></i>
                  카테고리별 성과
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={categoryData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" domain={[0, 5]} />
                    <YAxis dataKey="category" type="category" width={80} tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(value) => [`${value}점`, "평균"]} />
                    <Bar dataKey="average" fill="#3b82f6" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Top Strengths */}
            <Card className="card-enhanced" data-testid="card-top-strengths">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <i className="fas fa-thumbs-up text-green-600"></i>
                  강점 Top 5
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {performance?.topStrengths?.length ? performance.topStrengths.map((item, index) => (
                    <div key={index} className="flex items-start gap-3 p-2 bg-green-50 rounded-lg" data-testid={`strength-${index}`}>
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                        index === 0 ? 'bg-green-500 text-white' :
                        index === 1 ? 'bg-green-400 text-white' :
                        'bg-green-200 text-green-700'
                      }`}>
                        {index + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-700 line-clamp-2">{item.text}</p>
                        <p className="text-xs text-green-600 mt-1">{item.count}회 언급</p>
                      </div>
                    </div>
                  )) : <p className="text-slate-500 text-sm text-center py-4">데이터 없음</p>}
                </div>
              </CardContent>
            </Card>

            {/* Top Improvements */}
            <Card className="card-enhanced" data-testid="card-top-improvements">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <i className="fas fa-arrow-up text-orange-600"></i>
                  개선점 Top 5
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {performance?.topImprovements?.length ? performance.topImprovements.map((item, index) => (
                    <div key={index} className="flex items-start gap-3 p-2 bg-orange-50 rounded-lg" data-testid={`improvement-${index}`}>
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                        index === 0 ? 'bg-orange-500 text-white' :
                        index === 1 ? 'bg-orange-400 text-white' :
                        'bg-orange-200 text-orange-700'
                      }`}>
                        {index + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-700 line-clamp-2">{item.text}</p>
                        <p className="text-xs text-orange-600 mt-1">{item.count}회 언급</p>
                      </div>
                    </div>
                  )) : <p className="text-slate-500 text-sm text-center py-4">데이터 없음</p>}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 4. 세부 성과 테이블 */}
          <Card className="card-enhanced" data-testid="card-recent-sessions">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <i className="fas fa-list-alt text-slate-600"></i>
                최근 세션 상세 (최근 20건)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-slate-50">
                      <th className="p-3 text-left font-semibold">점수</th>
                      <th className="p-3 text-left font-semibold">시나리오</th>
                      <th className="p-3 text-left font-semibold">MBTI</th>
                      <th className="p-3 text-left font-semibold">난이도</th>
                      <th className="p-3 text-left font-semibold">사용자</th>
                      <th className="p-3 text-left font-semibold">완료일</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performance?.recentSessions?.map((session, index) => {
                      const difficultyLabels: Record<number, string> = { 1: '매우 쉬움', 2: '기본', 3: '도전형', 4: '고난도' };
                      const scoreColor = session.score >= 90 ? 'text-green-600' :
                                        session.score >= 80 ? 'text-blue-600' :
                                        session.score >= 70 ? 'text-yellow-600' :
                                        session.score >= 60 ? 'text-orange-600' : 'text-red-600';
                      return (
                        <tr key={session.id} className="border-b hover:bg-slate-50" data-testid={`session-row-${index}`}>
                          <td className={`p-3 font-bold ${scoreColor}`}>{session.score}점</td>
                          <td className="p-3 truncate max-w-[150px]">{session.scenarioName}</td>
                          <td className="p-3">
                            <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs font-bold">
                              {session.mbti}
                            </span>
                          </td>
                          <td className="p-3">
                            <span className={`px-2 py-1 rounded text-xs ${
                              session.difficulty === 4 ? 'bg-red-100 text-red-700' :
                              session.difficulty === 3 ? 'bg-orange-100 text-orange-700' :
                              session.difficulty === 2 ? 'bg-blue-100 text-blue-700' :
                              'bg-green-100 text-green-700'
                            }`}>
                              {difficultyLabels[session.difficulty] || '기본'}
                            </span>
                          </td>
                          <td className="p-3 text-slate-500">{session.userId}...</td>
                          <td className="p-3 text-slate-500">
                            {new Date(session.completedAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </td>
                        </tr>
                      );
                    })}
                    {(!performance?.recentSessions || performance.recentSessions.length === 0) && (
                      <tr><td colSpan={6} className="p-4 text-center text-slate-500">최근 세션 데이터가 없습니다.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="scenarios" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Scenario Popularity */}
            <Card data-testid="card-scenario-popularity">
              <CardHeader>
                <CardTitle>시나리오 인기도</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={scenarioPopularityData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="sessions" fill="#10b981" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Scenario Performance */}
            <Card data-testid="card-scenario-performance">
              <CardHeader>
                <CardTitle>시나리오별 성과</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={scenarioPerformanceData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis domain={[0, 100]} />
                    <Tooltip />
                    <Bar dataKey="average" fill="#f59e0b" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Difficulty Popularity */}
            <Card data-testid="card-difficulty-popularity">
              <CardHeader>
                <CardTitle>난이도 선택 인기도</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={difficultyPopularityData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="difficulty" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" fill="#8b5cf6" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Persona Count Popularity */}
            <Card data-testid="card-persona-count-popularity">
              <CardHeader>
                <CardTitle>페르소나 수 별 인기도</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={scenarioDifficultyData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="personaCount" label={{ value: "페르소나 수", position: "insideBottom", offset: -5 }} />
                    <YAxis label={{ value: "세션 수", angle: -90, position: "insideLeft" }} />
                    <Tooltip formatter={(value) => [`${value}회`, "세션 수"]} labelFormatter={(label) => `${label}명의 페르소나`} />
                    <Bar dataKey="count" fill="#8b5cf6" name="세션 수" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Scenario Details Table */}
          <Card data-testid="card-scenario-details">
            <CardHeader>
              <CardTitle>시나리오 상세 분석</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">시나리오</th>
                      <th className="text-left p-2">평균 점수</th>
                      <th className="text-left p-2">세션 수</th>
                      <th className="text-left p-2">난이도</th>
                      <th className="text-left p-2">페르소나 수</th>
                      <th className="text-left p-2">상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scenarioPerformanceData.map((scenario, index) => (
                      <tr key={index} className="border-b hover:bg-slate-50" data-testid={`scenario-row-${index}`}>
                        <td className="p-2 font-medium">{scenario.name}</td>
                        <td className="p-2">
                          <span className={`font-semibold ${
                            scenario.average >= 80 ? 'text-green-600' :
                            scenario.average >= 70 ? 'text-blue-600' :
                            scenario.average >= 60 ? 'text-yellow-600' : 'text-red-600'
                          }`}>
                            {scenario.average}점
                          </span>
                        </td>
                        <td className="p-2">{scenario.sessionCount}회</td>
                        <td className="p-2">
                          {'★'.repeat(Math.min(scenario.difficulty, 4))}{'☆'.repeat(Math.max(0, 4-scenario.difficulty))}
                        </td>
                        <td className="p-2">{scenario.personaCount || 0}명</td>
                        <td className="p-2">
                          <span className={`px-2 py-1 rounded-full text-xs ${
                            scenario.average >= 75 ? 'bg-green-100 text-green-800' :
                            scenario.average >= 65 ? 'bg-yellow-100 text-yellow-800' :
                            'bg-red-100 text-red-800'
                          }`}>
                            {scenario.average >= 75 ? '우수' : scenario.average >= 65 ? '보통' : '개선 필요'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mbti" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* MBTI Usage Distribution */}
            <Card data-testid="card-mbti-usage">
              <CardHeader>
                <CardTitle>MBTI 유형별 사용량</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={mbtiUsageData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip formatter={(value, name) => [`${value}회`, name === 'count' ? '사용 횟수' : name]} />
                    <Bar dataKey="count" fill="#8b5cf6" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* MBTI Performance Chart */}
            <Card data-testid="card-mbti-performance">
              <CardHeader>
                <CardTitle>MBTI 유형별 성과</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={performance ? Object.entries(performance.mbtiPerformance).map(([mbti, data]) => ({
                    name: mbti.toUpperCase(),
                    average: data.average,
                    count: data.count
                  })) : []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis domain={[0, 100]} />
                    <Tooltip formatter={(value, name) => [
                      name === 'average' ? `${value}점` : `${value}회`,
                      name === 'average' ? '평균 점수' : '세션 수'
                    ]} />
                    <Bar dataKey="average" fill="#06b6d4" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* MBTI Details Table */}
          <Card data-testid="card-mbti-details">
            <CardHeader>
              <CardTitle>MBTI 상세 분석</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">MBTI 유형</th>
                      <th className="text-left p-2">평균 점수</th>
                      <th className="text-left p-2">세션 수</th>
                      <th className="text-left p-2">사용 비율</th>
                      <th className="text-left p-2">성과 레벨</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performance ? Object.entries(performance.mbtiPerformance).map(([mbti, data], index) => {
                      const usageCount = overview?.mbtiUsage[mbti] || 0;
                      const usagePercentage = overview?.totalSessions ? Math.round((usageCount / overview.totalSessions) * 100) : 0;
                      
                      return (
                        <tr key={index} className="border-b hover:bg-slate-50" data-testid={`mbti-row-${index}`}>
                          <td className="p-2 font-medium">{mbti.toUpperCase()}</td>
                          <td className="p-2">
                            <span className={`font-semibold ${
                              data.average >= 80 ? 'text-green-600' :
                              data.average >= 70 ? 'text-blue-600' :
                              data.average >= 60 ? 'text-yellow-600' : 'text-red-600'
                            }`}>
                              {data.average}점
                            </span>
                          </td>
                          <td className="p-2">{data.count}회</td>
                          <td className="p-2">{usagePercentage}%</td>
                          <td className="p-2">
                            <span className={`px-2 py-1 rounded-full text-xs ${
                              data.average >= 80 ? 'bg-green-100 text-green-800' :
                              data.average >= 70 ? 'bg-blue-100 text-blue-800' :
                              data.average >= 60 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'
                            }`}>
                              {data.average >= 80 ? '탁월' : 
                               data.average >= 70 ? '우수' : 
                               data.average >= 60 ? '보통' : '개선 필요'}
                            </span>
                          </td>
                        </tr>
                      );
                    }) : []}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trends" className="space-y-6">
          <div className="grid grid-cols-1 gap-6">
            {/* Daily Usage Trends */}
            <Card data-testid="card-daily-usage">
              <CardHeader>
                <CardTitle>일일 사용량 추이 (최근 30일)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={trends?.dailyUsage || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="sessions" stroke="#3b82f6" name="시작된 세션" />
                    <Line type="monotone" dataKey="completed" stroke="#10b981" name="완료된 세션" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Performance Trends */}
            <Card data-testid="card-performance-trends">
              <CardHeader>
                <CardTitle>성과 트렌드 (최근 20세션)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={trends?.performanceTrends || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="session" />
                    <YAxis domain={[0, 100]} />
                    <Tooltip />
                    <Line type="monotone" dataKey="score" stroke="#f59e0b" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Content Registration Status */}
        <TabsContent value="content" className="space-y-6">
          {/* 1. 콘텐츠 요약 카드 (4개) */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="card-enhanced" data-testid="card-total-scenarios">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">총 시나리오</CardTitle>
                <i className="fas fa-folder text-blue-600"></i>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-blue-600">{scenarios.length}개</div>
                <p className="text-xs text-slate-600">등록된 시나리오 수</p>
              </CardContent>
            </Card>

            <Card className="card-enhanced" data-testid="card-total-personas">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">총 페르소나</CardTitle>
                <i className="fas fa-user-circle text-purple-600"></i>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-purple-600">{personas.length}개</div>
                <p className="text-xs text-slate-600">등록된 MBTI 페르소나 수</p>
              </CardContent>
            </Card>

            <Card className="card-enhanced" data-testid="card-avg-personas-per-scenario">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">평균 페르소나/시나리오</CardTitle>
                <i className="fas fa-users-cog text-green-600"></i>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  {scenarios.length > 0 
                    ? (scenarios.reduce((sum: number, s: any) => sum + (s.personas?.length || 0), 0) / scenarios.length).toFixed(1)
                    : 0}명
                </div>
                <p className="text-xs text-slate-600">시나리오당 평균 페르소나</p>
              </CardContent>
            </Card>

            <Card className="card-enhanced" data-testid="card-content-coverage">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">MBTI 커버리지</CardTitle>
                <i className="fas fa-check-double text-teal-600"></i>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-teal-600">
                  {new Set(personas.map((p: any) => p.mbti?.toUpperCase()).filter(Boolean)).size}/16
                </div>
                <p className="text-xs text-slate-600">등록된 MBTI 유형 수</p>
              </CardContent>
            </Card>
          </div>

          {/* 2. 콘텐츠 분포 분석 차트 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 시나리오별 페르소나 수 분포 */}
            <Card className="card-enhanced" data-testid="card-scenario-persona-dist">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <i className="fas fa-chart-bar text-blue-600"></i>
                  시나리오별 페르소나 수
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={scenarios.map((s: any) => ({ 
                    name: s.title?.substring(0, 10) + (s.title?.length > 10 ? '...' : ''),
                    count: s.personas?.length || 0 
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} />
                    <Tooltip formatter={(value) => [`${value}명`, "페르소나"]} />
                    <Bar dataKey="count" fill="#3b82f6" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* MBTI 유형별 페르소나 분포 */}
            <Card className="card-enhanced" data-testid="card-mbti-dist">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <i className="fas fa-brain text-purple-600"></i>
                  MBTI 유형별 페르소나 분포
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={
                    Object.entries(
                      personas.reduce((acc: Record<string, number>, p: any) => {
                        const mbti = p.mbti?.toUpperCase() || 'N/A';
                        acc[mbti] = (acc[mbti] || 0) + 1;
                        return acc;
                      }, {})
                    ).map(([mbti, count]) => ({ mbti, count }))
                  }>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="mbti" tick={{ fontSize: 10 }} />
                    <YAxis allowDecimals={false} />
                    <Tooltip formatter={(value) => [`${value}개`, "페르소나"]} />
                    <Bar dataKey="count" fill="#8b5cf6" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* 3. 콘텐츠 목록 테이블 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card data-testid="card-scenario-list">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <i className="fas fa-list text-blue-600"></i>
                  시나리오 목록
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-100 sticky top-0">
                      <tr>
                        <th className="p-2 text-left">시나리오명</th>
                        <th className="p-2 text-center">페르소나</th>
                        <th className="p-2 text-center">사용 횟수</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scenarios.map((scenario: any, index: number) => {
                        const usageCount = overview?.scenarioStats?.[scenario.id]?.count || 0;
                        return (
                          <tr key={scenario.id} className="border-b hover:bg-slate-50" data-testid={`content-scenario-row-${index}`}>
                            <td className="p-2 font-medium truncate max-w-[180px]" title={scenario.title}>
                              {scenario.title}
                            </td>
                            <td className="p-2 text-center">{scenario.personas?.length || 0}명</td>
                            <td className="p-2 text-center font-semibold text-corporate-600">{usageCount}회</td>
                          </tr>
                        );
                      })}
                      {scenarios.length === 0 && (
                        <tr><td colSpan={3} className="p-4 text-center text-slate-500">등록된 시나리오가 없습니다.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Persona List Table */}
            <Card data-testid="card-persona-list">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <i className="fas fa-users text-purple-600"></i>
                  MBTI 페르소나 목록
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-100 sticky top-0">
                      <tr>
                        <th className="p-2 text-left">MBTI</th>
                        <th className="p-2 text-left">이름</th>
                        <th className="p-2 text-center">사용 횟수</th>
                      </tr>
                    </thead>
                    <tbody>
                      {personas.map((persona: any, index: number) => {
                        const mbtiKey = persona.mbti ? persona.mbti.toLowerCase() : '';
                        const usageCount = mbtiKey ? (overview?.mbtiUsage?.[mbtiKey] || 0) : 0;
                        return (
                          <tr key={persona.id || index} className="border-b hover:bg-slate-50" data-testid={`content-persona-row-${index}`}>
                            <td className="p-2">
                              <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs font-bold">
                                {persona.mbti?.toUpperCase() || 'N/A'}
                              </span>
                            </td>
                            <td className="p-2 font-medium">{persona.name || persona.mbti?.toUpperCase()}</td>
                            <td className="p-2 text-center font-semibold text-corporate-600">{usageCount}회</td>
                          </tr>
                        );
                      })}
                      {personas.length === 0 && (
                        <tr><td colSpan={3} className="p-4 text-center text-slate-500">등록된 페르소나가 없습니다.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

      </Tabs>
      </div>
    </div>
  );
}