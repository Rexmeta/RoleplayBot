import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { scenarios } from "@/lib/scenarios";

interface AnalyticsOverview {
  totalSessions: number;
  completedSessions: number;
  averageScore: number;
  completionRate: number;
  scenarioStats: Record<string, number>;
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
  });

  const { data: performance, isLoading: performanceLoading } = useQuery<PerformanceData>({
    queryKey: ["/api/admin/analytics/performance"],
  });

  const { data: trends, isLoading: trendsLoading } = useQuery<TrendsData>({
    queryKey: ["/api/admin/analytics/trends"],
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

  const scenarioPopularityData = overview ? Object.entries(overview.scenarioStats).map(([scenarioId, count]) => {
    const scenario = scenarios.find(s => s.id === scenarioId);
    return {
      name: scenario?.name || scenarioId,
      sessions: count,
      difficulty: scenario?.difficulty || 1
    };
  }) : [];

  const scenarioPerformanceData = performance ? Object.entries(performance.scenarioPerformance).map(([scenarioId, data]) => {
    const scenario = scenarios.find(s => s.id === scenarioId);
    return {
      name: data.name,
      average: data.average,
      sessionCount: data.sessionCount,
      difficulty: scenario?.difficulty || 1
    };
  }) : [];

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="container mx-auto p-6 space-y-6" data-testid="admin-dashboard">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link href="/" className="flex items-center space-x-2 text-corporate-600 hover:text-corporate-700" data-testid="back-to-home">
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
          <div className="bg-corporate-50 border border-corporate-200 rounded-lg px-4 py-2">
            <span className="text-sm text-corporate-700 font-medium">실시간 업데이트</span>
          </div>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="card-enhanced" data-testid="card-total-sessions">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">총 훈련 세션</CardTitle>
            <i className="fas fa-chart-line text-blue-600"></i>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="total-sessions">{overview?.totalSessions || 0}</div>
            <p className="text-xs text-slate-600">전체 시작된 세션</p>
          </CardContent>
        </Card>

        <Card className="card-enhanced" data-testid="card-completed-sessions">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">완료된 세션</CardTitle>
            <i className="fas fa-check-circle text-green-600"></i>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="completed-sessions">{overview?.completedSessions || 0}</div>
            <p className="text-xs text-slate-600">완료율: {overview?.completionRate || 0}%</p>
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

        <Card className="card-enhanced" data-testid="card-completion-rate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">완료율</CardTitle>
            <i className="fas fa-percentage text-purple-600"></i>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="completion-rate">{overview?.completionRate || 0}%</div>
            <p className="text-xs text-slate-600">세션 완주 비율</p>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Analytics */}
      <Tabs defaultValue="performance" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="performance" data-testid="tab-performance">성과 분석</TabsTrigger>
          <TabsTrigger value="scenarios" data-testid="tab-scenarios">시나리오 분석</TabsTrigger>
          <TabsTrigger value="trends" data-testid="tab-trends">트렌드 분석</TabsTrigger>
        </TabsList>

        <TabsContent value="performance" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Score Distribution */}
            <Card className="card-enhanced" data-testid="card-score-distribution">
              <CardHeader>
                <CardTitle>점수 분포</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
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

            {/* Category Performance */}
            <Card data-testid="card-category-performance">
              <CardHeader>
                <CardTitle>카테고리별 성과</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={categoryData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="category" angle={-45} textAnchor="end" height={80} />
                    <YAxis domain={[0, 5]} />
                    <Tooltip />
                    <Bar dataKey="average" fill="#3b82f6" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
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
                          {'★'.repeat(scenario.difficulty)}{'☆'.repeat(3-scenario.difficulty)}
                        </td>
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

      </Tabs>
      </div>
    </div>
  );
}