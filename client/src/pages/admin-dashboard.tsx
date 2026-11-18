import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminWorkspace, WorkspacePanel, type WorkspaceSectionDef } from "@/components/admin/contentEditor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { AppHeader } from "@/components/AppHeader";
import { useState, useEffect } from "react";
import { Activity, BarChart3, Brain, Filter, Heart, Languages, Library, LineChart, ListChecks, RefreshCw, ShoppingBag, Users } from "lucide-react";
import { authFetch } from "@/lib/authFetch";
import { TranslationDashboard } from "@/components/admin/TranslationDashboard";
import { StoreRevenueTab } from "@/components/admin/StoreRevenueTab";
import { OverviewTab } from "@/components/admin/OverviewTab";
import { PerformanceTab } from "@/components/admin/PerformanceTab";
import { ScenariosTab } from "@/components/admin/ScenariosTab";
import { MbtiTab } from "@/components/admin/MbtiTab";
import { TrendsTab } from "@/components/admin/TrendsTab";
import { EmotionsTab } from "@/components/admin/EmotionsTab";
import { ContentTab } from "@/components/admin/ContentTab";
import { ParticipantsTab } from "@/components/admin/ParticipantsTab";
import { ApiUsageTab } from "@/components/admin/ApiUsageTab";
import type {
  AnalyticsOverview,
  PerformanceData,
  TrendsData,
  Participant,
} from "@/components/admin/adminTypes";

interface Category {
  id: string;
  name: string;
}

const DASHBOARD_SECTIONS: WorkspaceSectionDef[] = [
  { id: "participants", label: "참석자", description: "참석자별 훈련 이력과 점수를 확인합니다.", group: "교육 결과", icon: Users },
  { id: "overview", label: "개요", description: "전체 세션 수, 완료율, 인기 시나리오를 한눈에 봅니다.", group: "교육 결과", icon: BarChart3 },
  { id: "performance", label: "성과", description: "점수 분포와 카테고리별 평균 성과를 비교합니다.", group: "교육 결과", icon: ListChecks },
  { id: "trends", label: "트렌드", description: "기간별 세션 수와 점수 변화를 확인합니다.", group: "교육 결과", icon: LineChart },
  { id: "scenarios", label: "시나리오", description: "시나리오별 성과, 인기도, 난이도 사용 현황입니다.", group: "콘텐츠 분석", icon: Library },
  { id: "mbti", label: "MBTI", description: "페르소나 MBTI 유형별 사용량과 성과입니다.", group: "콘텐츠 분석", icon: Brain },
  { id: "emotions", label: "감정", description: "대화 중 나타난 감정 분포를 분석합니다.", group: "콘텐츠 분석", icon: Heart },
  { id: "content", label: "컨텐츠", description: "등록된 시나리오와 페르소나 현황입니다.", group: "콘텐츠 분석", icon: Library },
  { id: "api-usage", label: "API 사용", description: "AI API 호출량과 비용을 확인합니다.", group: "운영", icon: Activity },
  { id: "store-revenue", label: "스토어", description: "스토어 판매와 매출 현황입니다.", group: "운영", icon: ShoppingBag },
  { id: "translations", label: "번역", description: "콘텐츠 번역 진행 현황을 관리합니다.", group: "운영", icon: Languages },
];

const ANALYTICS_STALE_TIME = 1000 * 60 * 2;
const ANALYTICS_REFETCH_INTERVAL = 1000 * 60 * 2;

function getRelativeTime(timestamp: number): string {
  if (!timestamp) return '';
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 10) return '방금 업데이트됨';
  if (diffSec < 60) return `${diffSec}초 전 업데이트`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}분 전 업데이트`;
  const hours = Math.floor(mins / 60);
  return `${hours}시간 전 업데이트`;
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('participants');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [, setRelativeTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setRelativeTick(n => n + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === 'string' && key.startsWith('/api/admin/analytics');
      },
    });
    setIsRefreshing(false);
  };

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['/api/categories'],
  });

  const categoryParam = selectedCategoryId !== 'all' ? `?categoryId=${selectedCategoryId}` : '';

  const { data: overview, isLoading: overviewLoading, isFetching: overviewFetching, dataUpdatedAt: overviewUpdatedAt } = useQuery<AnalyticsOverview>({
    queryKey: ["/api/admin/analytics/overview", selectedCategoryId],
    queryFn: () => authFetch(`/api/admin/analytics/overview${categoryParam}`),
    staleTime: ANALYTICS_STALE_TIME,
    gcTime: 1000 * 60 * 30,
    refetchInterval: ANALYTICS_REFETCH_INTERVAL,
  });

  const { data: performance, isLoading: performanceLoading, isFetching: performanceFetching, dataUpdatedAt: performanceUpdatedAt } = useQuery<PerformanceData>({
    queryKey: ["/api/admin/analytics/performance", selectedCategoryId],
    queryFn: () => authFetch(`/api/admin/analytics/performance${categoryParam}`),
    staleTime: ANALYTICS_STALE_TIME,
    gcTime: 1000 * 60 * 30,
    refetchInterval: ANALYTICS_REFETCH_INTERVAL,
  });

  const { data: trends, isLoading: trendsLoading, isFetching: trendsFetching, dataUpdatedAt: trendsUpdatedAt } = useQuery<TrendsData>({
    queryKey: ["/api/admin/analytics/trends", selectedCategoryId],
    queryFn: () => authFetch(`/api/admin/analytics/trends${categoryParam}`),
    staleTime: ANALYTICS_STALE_TIME,
    gcTime: 1000 * 60 * 30,
    refetchInterval: ANALYTICS_REFETCH_INTERVAL,
  });

  const { data: scenarios = [] } = useQuery({
    queryKey: ['/api/scenarios', selectedCategoryId],
    queryFn: () => authFetch(`/api/scenarios${categoryParam}`),
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
  });

  const { data: personas = [] } = useQuery({
    queryKey: ['/api/admin/personas'],
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
    select: (data: unknown) => Array.isArray(data) ? data : [],
  });

  const { data: participantsData, isLoading: participantsLoading } = useQuery<{ participants: Participant[] }>({
    queryKey: ['/api/admin/analytics/participants', selectedCategoryId],
    queryFn: () => authFetch(`/api/admin/analytics/participants${categoryParam}`),
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 15,
  });

  if (overviewLoading || performanceLoading || trendsLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-corporate-600"></div>
      </div>
    );
  }

  const scoreDistributionData = performance ? [
    { name: "탁월 (90-100)", value: performance.scoreRanges.excellent, color: "#10b981" },
    { name: "우수 (80-89)", value: performance.scoreRanges.good, color: "#3b82f6" },
    { name: "보통 (70-79)", value: performance.scoreRanges.average, color: "#f59e0b" },
    { name: "개선 필요 (60-69)", value: performance.scoreRanges.needsImprovement, color: "#f97316" },
    { name: "미흡 (<60)", value: performance.scoreRanges.poor, color: "#ef4444" }
  ] : [];

  const categoryData = performance ? Object.entries(performance.categoryPerformance).map(([_, data]) => ({
    category: data.name,
    average: data.average,
    count: data.count
  })) : [];

  const scenarioPopularityData = overview ? Object.entries(overview.scenarioStats).map(([_, data]) => ({
    name: data.name,
    sessions: data.count,
    difficulty: data.difficulty
  })) : [];

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

  const difficultyPopularityData = overview?.difficultyUsage
    ? overview.difficultyUsage.map((d: any) => ({ difficulty: `Lv${d.level}`, count: d.count }))
    : [];

  const scenarioDifficultyData = scenarios.reduce((acc: any[], scenario: any) => {
    const personaCount = scenario.personas?.length || 0;
    if (personaCount === 0) return acc;
    const sessionCount = overview?.scenarioStats?.[scenario.id]?.count || 0;
    const existing = acc.find(d => d.personaCount === personaCount);
    if (existing) existing.count += sessionCount;
    else acc.push({ personaCount, count: sessionCount });
    return acc;
  }, []).sort((a: any, b: any) => a.personaCount - b.personaCount);

  const analyticsTimestamps = [
    overviewUpdatedAt,
    performanceUpdatedAt,
    trendsUpdatedAt,
  ].filter(t => t > 0);
  const oldestUpdatedAt = analyticsTimestamps.length > 0 ? Math.min(...analyticsTimestamps) : 0;
  const anyAnalyticsFetching =
    overviewFetching || performanceFetching || trendsFetching;

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader
        title="운영자 대시보드"
        subtitle="교육 결과 분석 및 성과 현황"
      />
      <AdminWorkspace
        testId="admin-dashboard"
        idPrefix="admin-dashboard"
        title="운영자 대시보드"
        breadcrumb="교육 결과 분석"
        sections={DASHBOARD_SECTIONS}
        active={activeTab}
        onActiveChange={setActiveTab}
        footerNote="조회 전용 화면입니다. 데이터는 2분마다 자동으로 갱신됩니다."
        headerActions={<>
          {oldestUpdatedAt > 0 && (
            <span
              className="hidden text-xs text-slate-500 tabular-nums md:inline"
              data-testid="last-updated-label"
              aria-live="polite"
            >
              {anyAnalyticsFetching || isRefreshing ? '갱신 중...' : getRelativeTime(oldestUpdatedAt)}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing || anyAnalyticsFetching}
            data-testid="refresh-dashboard-btn"
            className="flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing || anyAnalyticsFetching ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{isRefreshing || anyAnalyticsFetching ? '갱신 중...' : '새로고침'}</span>
          </Button>
        </>}
        toolbar={(user?.role === 'admin' || (user?.role === 'operator' && user?.assignedCategoryId)) ? <>
        {user?.role === 'admin' && (
          <div className="flex flex-wrap items-center gap-3 w-full p-4 bg-white rounded-lg border shadow-sm">
            <Filter className="w-5 h-5 text-slate-500" />
            <span className="text-sm font-medium text-slate-700">카테고리 필터:</span>
            <Select value={selectedCategoryId} onValueChange={setSelectedCategoryId}>
              <SelectTrigger className="w-full sm:w-[200px]" data-testid="category-filter-select">
                <SelectValue placeholder="전체 카테고리" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 카테고리</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedCategoryId !== 'all' && (
              <span className="text-xs text-slate-500">선택된 카테고리의 데이터만 표시됩니다</span>
            )}
          </div>
        )}

        {user?.role === 'operator' && user?.assignedCategoryId && (
          <div className="flex items-center gap-3 w-full p-4 bg-blue-50 rounded-lg border border-blue-200">
            <Filter className="w-5 h-5 text-blue-500" />
            <span className="text-sm font-medium text-blue-700">
              {categories.find(c => String(c.id) === String(user.assignedCategoryId))?.name || '할당된 카테고리'} 카테고리 데이터만 표시됩니다
            </span>
          </div>
        )}
        </> : undefined}
      >
          <WorkspacePanel id="participants">
            <ParticipantsTab
              participantsData={participantsData}
              participantsLoading={participantsLoading}
            />
          </WorkspacePanel>

          <WorkspacePanel id="overview">
            <OverviewTab
              overview={overview}
              scenarioPopularityData={scenarioPopularityData}
              mbtiUsageData={mbtiUsageData}
            />
          </WorkspacePanel>

          <WorkspacePanel id="performance">
            <PerformanceTab
              performance={performance}
              trends={trends}
              scoreDistributionData={scoreDistributionData}
              categoryData={categoryData}
            />
          </WorkspacePanel>

          <WorkspacePanel id="scenarios">
            <ScenariosTab
              scenarioPerformanceData={scenarioPerformanceData}
              scenarioPopularityData={scenarioPopularityData}
              difficultyPopularityData={difficultyPopularityData}
              scenarioDifficultyData={scenarioDifficultyData}
            />
          </WorkspacePanel>

          <WorkspacePanel id="mbti">
            <MbtiTab
              overview={overview}
              performance={performance}
              mbtiUsageData={mbtiUsageData}
            />
          </WorkspacePanel>

          <WorkspacePanel id="emotions">
            <EmotionsTab selectedCategoryId={selectedCategoryId} />
          </WorkspacePanel>

          <WorkspacePanel id="trends">
            <TrendsTab trends={trends} />
          </WorkspacePanel>

          <WorkspacePanel id="content">
            <ContentTab
              scenarios={scenarios}
              personas={personas}
              overview={overview}
            />
          </WorkspacePanel>

          <WorkspacePanel id="api-usage">
            <ApiUsageTab userRole={user?.role} />
          </WorkspacePanel>

          <WorkspacePanel id="store-revenue">
            <StoreRevenueTab />
          </WorkspacePanel>

          <WorkspacePanel id="translations">
            <TranslationDashboard />
          </WorkspacePanel>
      </AdminWorkspace>
    </div>
  );
}
