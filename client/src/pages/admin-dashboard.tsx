import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { AppHeader } from "@/components/AppHeader";
import { useState, useEffect } from "react";
import { Filter, RefreshCw } from "lucide-react";
import { authFetch } from "@/lib/authFetch";
import { TranslationDashboard } from "@/components/admin/TranslationDashboard";
import { OverviewTab } from "@/components/admin/OverviewTab";
import { PerformanceTab } from "@/components/admin/PerformanceTab";
import { ScenariosTab } from "@/components/admin/ScenariosTab";
import { MbtiTab } from "@/components/admin/MbtiTab";
import { TrendsTab } from "@/components/admin/TrendsTab";
import { EmotionsTab } from "@/components/admin/EmotionsTab";
import { ContentTab } from "@/components/admin/ContentTab";
import { ParticipantsTab } from "@/components/admin/ParticipantsTab";
import type {
  AnalyticsOverview,
  PerformanceData,
  TrendsData,
  EmotionData,
  ScenarioEmotionData,
  DifficultyEmotionData,
  Participant,
} from "@/components/admin/adminTypes";

interface Category {
  id: string;
  name: string;
}

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
  const [showMobileTabMenu, setShowMobileTabMenu] = useState(false);
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

  const { data: performance, isLoading: performanceLoading } = useQuery<PerformanceData>({
    queryKey: ["/api/admin/analytics/performance", selectedCategoryId],
    queryFn: () => authFetch(`/api/admin/analytics/performance${categoryParam}`),
    staleTime: ANALYTICS_STALE_TIME,
    gcTime: 1000 * 60 * 30,
    refetchInterval: ANALYTICS_REFETCH_INTERVAL,
  });

  const { data: trends, isLoading: trendsLoading } = useQuery<TrendsData>({
    queryKey: ["/api/admin/analytics/trends", selectedCategoryId],
    queryFn: () => authFetch(`/api/admin/analytics/trends${categoryParam}`),
    staleTime: ANALYTICS_STALE_TIME,
    gcTime: 1000 * 60 * 30,
    refetchInterval: ANALYTICS_REFETCH_INTERVAL,
  });

  const { data: emotions, isLoading: emotionsLoading } = useQuery<EmotionData>({
    queryKey: ["/api/admin/analytics/emotions", selectedCategoryId],
    queryFn: () => authFetch(`/api/admin/analytics/emotions${categoryParam}`),
    staleTime: ANALYTICS_STALE_TIME,
    gcTime: 1000 * 60 * 30,
    refetchInterval: ANALYTICS_REFETCH_INTERVAL,
  });

  const { data: scenarioEmotions } = useQuery<ScenarioEmotionData>({
    queryKey: ["/api/admin/analytics/emotions/by-scenario", selectedCategoryId],
    queryFn: () => authFetch(`/api/admin/analytics/emotions/by-scenario${categoryParam}`),
    staleTime: ANALYTICS_STALE_TIME,
    gcTime: 1000 * 60 * 30,
    refetchInterval: ANALYTICS_REFETCH_INTERVAL,
  });

  const { data: difficultyEmotions } = useQuery<DifficultyEmotionData>({
    queryKey: ["/api/admin/analytics/emotions/by-difficulty", selectedCategoryId],
    queryFn: () => authFetch(`/api/admin/analytics/emotions/by-difficulty${categoryParam}`),
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

  if (overviewLoading || performanceLoading || trendsLoading || emotionsLoading) {
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

  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader
        title="운영자 대시보드"
        subtitle="교육 결과 분석 및 성과 현황"
        showBackButton
      />
      <div className="container mx-auto p-3 md:p-6 space-y-6" data-testid="admin-dashboard">
        <div className="flex items-center justify-end gap-3">
          {overviewUpdatedAt > 0 && (
            <span
              className="text-xs text-slate-500 tabular-nums"
              data-testid="last-updated-label"
              aria-live="polite"
            >
              {overviewFetching || isRefreshing ? '갱신 중...' : getRelativeTime(overviewUpdatedAt)}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing || overviewFetching}
            data-testid="refresh-dashboard-btn"
            className="flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing || overviewFetching ? 'animate-spin' : ''}`} />
            {isRefreshing || overviewFetching ? '갱신 중...' : '새로고침'}
          </Button>
        </div>

        {user?.role === 'admin' && (
          <div className="flex flex-wrap items-center gap-3 p-4 bg-white rounded-lg border shadow-sm">
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
          <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <Filter className="w-5 h-5 text-blue-500" />
            <span className="text-sm font-medium text-blue-700">
              {categories.find(c => String(c.id) === String(user.assignedCategoryId))?.name || '할당된 카테고리'} 카테고리 데이터만 표시됩니다
            </span>
          </div>
        )}

        <Tabs defaultValue="participants" className="space-y-6" onValueChange={() => setShowMobileTabMenu(false)}>
          <TabsList className="hidden md:grid w-full grid-cols-9">
            <TabsTrigger value="participants" data-testid="tab-participants">참석자 관리</TabsTrigger>
            <TabsTrigger value="overview" data-testid="tab-overview">개요</TabsTrigger>
            <TabsTrigger value="performance" data-testid="tab-performance">성과 분석</TabsTrigger>
            <TabsTrigger value="scenarios" data-testid="tab-scenarios">시나리오 분석</TabsTrigger>
            <TabsTrigger value="mbti" data-testid="tab-mbti">MBTI 분석</TabsTrigger>
            <TabsTrigger value="emotions" data-testid="tab-emotions">감정 분석</TabsTrigger>
            <TabsTrigger value="trends" data-testid="tab-trends">트렌드 분석</TabsTrigger>
            <TabsTrigger value="content" data-testid="tab-content">컨텐츠 현황</TabsTrigger>
            <TabsTrigger value="translations" data-testid="tab-translations">번역 관리</TabsTrigger>
          </TabsList>

          <div className="md:hidden space-y-2">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="participants" data-testid="mobile-tab-participants-primary">참석자</TabsTrigger>
              <TabsTrigger value="overview" data-testid="mobile-tab-overview">개요</TabsTrigger>
              <TabsTrigger value="performance" data-testid="mobile-tab-performance">성과</TabsTrigger>
              <button
                type="button"
                onClick={() => setShowMobileTabMenu(!showMobileTabMenu)}
                className={`inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${showMobileTabMenu ? 'bg-indigo-600 text-white' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}
                data-testid="mobile-tab-more"
              >
                <i className={`fas ${showMobileTabMenu ? 'fa-times' : 'fa-ellipsis-h'} mr-1`}></i>
                {showMobileTabMenu ? '닫기' : '더보기'}
              </button>
            </TabsList>

            {showMobileTabMenu && (
              <div className="bg-slate-100 rounded-lg p-2 animate-in slide-in-from-top duration-200">
                <TabsList className="grid w-full grid-cols-6 gap-2 bg-transparent">
                  <TabsTrigger value="scenarios" className="bg-white" data-testid="mobile-tab-scenarios">시나리오</TabsTrigger>
                  <TabsTrigger value="mbti" className="bg-white" data-testid="mobile-tab-mbti">MBTI</TabsTrigger>
                  <TabsTrigger value="emotions" className="bg-white" data-testid="mobile-tab-emotions">감정</TabsTrigger>
                  <TabsTrigger value="trends" className="bg-white" data-testid="mobile-tab-trends">트렌드</TabsTrigger>
                  <TabsTrigger value="content" className="bg-white" data-testid="mobile-tab-content">컨텐츠</TabsTrigger>
                  <TabsTrigger value="translations" className="bg-white" data-testid="mobile-tab-translations">번역</TabsTrigger>
                </TabsList>
              </div>
            )}
          </div>

          <TabsContent value="participants" className="space-y-6">
            <ParticipantsTab
              participantsData={participantsData}
              participantsLoading={participantsLoading}
            />
          </TabsContent>

          <TabsContent value="overview" className="space-y-6">
            <OverviewTab
              overview={overview}
              scenarioPopularityData={scenarioPopularityData}
              mbtiUsageData={mbtiUsageData}
            />
          </TabsContent>

          <TabsContent value="performance" className="space-y-6">
            <PerformanceTab
              performance={performance}
              trends={trends}
              scoreDistributionData={scoreDistributionData}
              categoryData={categoryData}
            />
          </TabsContent>

          <TabsContent value="scenarios" className="space-y-6">
            <ScenariosTab
              scenarioPerformanceData={scenarioPerformanceData}
              scenarioPopularityData={scenarioPopularityData}
              difficultyPopularityData={difficultyPopularityData}
              scenarioDifficultyData={scenarioDifficultyData}
            />
          </TabsContent>

          <TabsContent value="mbti" className="space-y-6">
            <MbtiTab
              overview={overview}
              performance={performance}
              mbtiUsageData={mbtiUsageData}
            />
          </TabsContent>

          <TabsContent value="emotions" className="space-y-6">
            <EmotionsTab
              emotions={emotions}
              scenarioEmotions={scenarioEmotions}
              difficultyEmotions={difficultyEmotions}
            />
          </TabsContent>

          <TabsContent value="trends" className="space-y-6">
            <TrendsTab trends={trends} />
          </TabsContent>

          <TabsContent value="content" className="space-y-6">
            <ContentTab
              scenarios={scenarios}
              personas={personas}
              overview={overview}
            />
          </TabsContent>

          <TabsContent value="translations" className="space-y-6">
            <TranslationDashboard />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
