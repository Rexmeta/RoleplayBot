import { useState, useMemo, useEffect, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ComplexScenario } from "@/lib/scenario-system";
import { Search, SlidersHorizontal, Folder, X, PanelLeftClose, PanelLeftOpen, Users, Clock, Play, SearchX } from "lucide-react";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
import { toMediaUrl } from "@/lib/mediaUrl";
import { queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { ScenarioLibraryCard } from "@/components/scenario-library/ScenarioLibraryCard";
import { ScenarioFilterPanel, SKILL_OPTIONS, DEPARTMENT_OPTIONS, type ScenarioFilters } from "@/components/scenario-library/ScenarioFilterPanel";

interface Category {
  id: string;
  name: string;
  description: string;
  order: number;
}

interface ScenarioSelectorProps {
  onScenarioSelect: (scenario: ComplexScenario) => void;
  detailScenario?: ComplexScenario | null;
  onDetailScenarioChange?: (scenario: ComplexScenario | null) => void;
  playerProfile?: {
    position: string;
    department: string;
    experience: string;
  };
  /** Optional content rendered below exploration filters (e.g. compact dashboard) */
  sidebarContent?: ReactNode;
}

const EMPTY_FILTERS: ScenarioFilters = {
  difficulty: "",
  personaCount: "",
  searchText: "",
  department: "",
  skillType: "",
  categoryId: "all",
  bookmarkedOnly: false,
};

const SKILL_WEIGHTS: Record<string, number> = {
  '논리적설명': 20, '구조화': 20, '체계적대화': 20, '메시지구성': 20, '논리': 20,
  '공감': 20, '감정이해': 20, '배려': 20, '경청': 20, '이해': 20,
  '적절한소통': 20, '상황판단': 20, '유연성': 20, '적응력': 20, '상황대응': 20,
  '설득': 20, '영향력': 20, '근거제시': 20, '설득력': 20, '논증': 20,
  '전략적소통': 20, '목표지향': 20, '협상': 20, '갈등해결': 20, '주도성': 20,
  '문제해결': 15, '전문성': 15, '의사소통': 15, '팀워크': 10, '리더십': 10,
};

// 원본 배열을 변경하지 않도록 복사 후 정렬
const sortSkillsByImportance = (skills: string[]): string[] =>
  [...skills].sort((a, b) => (SKILL_WEIGHTS[b] || 0) - (SKILL_WEIGHTS[a] || 0));

const authHeaders = (): Record<string, string> => {
  const token = localStorage.getItem("authToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export default function ScenarioSelector({
  onScenarioSelect,
  detailScenario: controlledDetailScenario,
  onDetailScenarioChange,
  sidebarContent,
}: ScenarioSelectorProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const currentLang = i18n.language || 'ko';

  const [filters, setFilters] = useState<ScenarioFilters>(EMPTY_FILTERS);
  const patchFilters = (patch: Partial<ScenarioFilters>) => setFilters((prev) => ({ ...prev, ...patch }));

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);
  // 사이드바 콘텐츠를 한 곳에만 렌더링하기 위한 뷰포트 판별 (lg 기준)
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(min-width: 1024px)').matches
      : true
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, []);

  const [localDetailScenario, setLocalDetailScenario] = useState<ComplexScenario | null>(null);
  const detailScenario = controlledDetailScenario === undefined ? localDetailScenario : controlledDetailScenario;
  const setDetailScenario = onDetailScenarioChange ?? setLocalDetailScenario;
  const detailId = detailScenario?.id ?? null;

  const { data: scenarios = [], isLoading: scenariosLoading, isError: scenariosError, refetch: refetchScenarios } = useQuery({
    queryKey: ['/api/scenarios'],
    queryFn: async () => {
      const res = await fetch('/api/scenarios', { credentials: 'include', headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to load scenarios");
      const body = await res.json();
      if (!Array.isArray(body)) throw new Error("Invalid scenario list");
      return body;
    },
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['/api/categories'],
    queryFn: () => fetch('/api/categories').then(res => res.json()),
    staleTime: 1000 * 60 * 30,
  });

  // 상세 보기 중인 시나리오의 번역 (공용 API)
  const { data: detailTranslation } = useQuery({
    queryKey: ['/api/scenarios', detailId, 'translations', currentLang],
    queryFn: async () => {
      if (!detailId || currentLang === 'ko') return null;
      const res = await fetch(`/api/scenarios/${detailId}/translations/${currentLang}`, {
        credentials: 'include',
        headers: authHeaders(),
      });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!detailId && currentLang !== 'ko',
    staleTime: 1000 * 60 * 10,
  });

  const tr = (scenarioId: string | number, field: 'title' | 'description' | 'situation', original: string | undefined) => {
    if (currentLang === 'ko' || !detailTranslation || String(detailId) !== String(scenarioId)) return original;
    return detailTranslation[field] || original;
  };
  const trSkills = (scenarioId: string | number, original: string[]) => {
    if (currentLang === 'ko' || !detailTranslation || String(detailId) !== String(scenarioId)) return original;
    return detailTranslation.skills?.length > 0 ? detailTranslation.skills : original;
  };

  const { data: bookmarks = [] } = useQuery<{ id: string; userId: string; scenarioId: string }[]>({
    queryKey: ['/api/bookmarks', user?.id],
    queryFn: () =>
      fetch('/api/bookmarks', { credentials: 'include', headers: authHeaders() }).then(res => (res.ok ? res.json() : [])),
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
  });

  const { data: scenarioStats = [] } = useQuery<{ scenarioId: string; completionCount: number; averageScore: number | null }[]>({
    queryKey: ['/api/scenarios/stats'],
    queryFn: () => fetch('/api/scenarios/stats').then(res => res.json()),
    staleTime: 1000 * 60 * 10,
  });

  const bookmarkedIds = useMemo(() => new Set(bookmarks.map((b) => b.scenarioId)), [bookmarks]);
  const statsMap = useMemo(() => new Map(scenarioStats.map((s) => [s.scenarioId, s] as const)), [scenarioStats]);

  const bookmarkMutation = useMutation({
    mutationFn: async ({ scenarioId, isBookmarked }: { scenarioId: string; isBookmarked: boolean }) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', ...authHeaders() };
      if (isBookmarked) {
        const res = await fetch(`/api/bookmarks/${encodeURIComponent(scenarioId)}`, { method: 'DELETE', credentials: 'include', headers });
        if (!res.ok) throw new Error('북마크 삭제에 실패했습니다.');
      } else {
        const res = await fetch('/api/bookmarks', { method: 'POST', credentials: 'include', headers, body: JSON.stringify({ scenarioId }) });
        if (!res.ok) throw new Error('북마크 추가에 실패했습니다.');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/bookmarks', user?.id] });
    },
    onError: () => {
      toast({ title: '오류', description: '북마크 처리 중 오류가 발생했습니다.', variant: 'destructive' });
    },
  });

  const handleBookmarkToggle = (e: React.MouseEvent, scenarioId: string) => {
    e.stopPropagation();
    if (!user) return;
    bookmarkMutation.mutate({ scenarioId, isBookmarked: bookmarkedIds.has(scenarioId) });
  };

  const getCategoryName = (categoryId: string | undefined): string =>
    (categoryId && categories.find(c => c.id === categoryId)?.name) || '';

  const scenarioList: ComplexScenario[] = Array.isArray(scenarios) ? scenarios : [];

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    scenarioList.forEach((s: any) => {
      if (s.categoryId) counts[s.categoryId] = (counts[s.categoryId] || 0) + 1;
    });
    return counts;
  }, [scenarioList]);

  const filteredScenarios = scenarioList.filter((scenario: ComplexScenario) => {
    if (filters.bookmarkedOnly && !bookmarkedIds.has(String(scenario.id))) return false;
    if (filters.categoryId && filters.categoryId !== 'all' && (scenario as any).categoryId !== filters.categoryId) return false;
    if (filters.searchText) {
      const q = filters.searchText.toLowerCase();
      if (!scenario.title?.toLowerCase().includes(q) && !scenario.description?.toLowerCase().includes(q)) return false;
    }
    if (filters.personaCount && filters.personaCount !== 'all') {
      const count = scenario.personas?.length || 0;
      const target = parseInt(filters.personaCount, 10);
      // "6" 옵션은 6명 이상을 의미
      if (target >= 6 ? count < 6 : count !== target) return false;
    }
    if (filters.department && filters.department !== 'all') {
      const dep = filters.department.toLowerCase();
      if (!scenario.personas?.some((p: any) => typeof p === 'object' && p.department?.toLowerCase().includes(dep))) return false;
    }
    if (filters.skillType && filters.skillType !== 'all') {
      const sk = filters.skillType.toLowerCase();
      if (!scenario.skills?.some((s: string) => s.toLowerCase().includes(sk))) return false;
    }
    return true;
  });

  const resetFilters = () => setFilters(EMPTY_FILTERS);

  // 활성 필터 칩
  const activeChips: { key: string; label: string; clear: () => void }[] = [];
  if (filters.searchText) activeChips.push({ key: 'search', label: `"${filters.searchText}"`, clear: () => patchFilters({ searchText: '' }) });
  if (filters.bookmarkedOnly) activeChips.push({ key: 'bookmarked', label: t('scenario.favorites', '즐겨찾기'), clear: () => patchFilters({ bookmarkedOnly: false }) });
  if (filters.categoryId && filters.categoryId !== 'all') activeChips.push({ key: 'category', label: getCategoryName(filters.categoryId) || filters.categoryId, clear: () => patchFilters({ categoryId: 'all' }) });
  if (filters.skillType && filters.skillType !== 'all') {
    const opt = SKILL_OPTIONS.find(s => s.value === filters.skillType);
    activeChips.push({ key: 'skill', label: opt ? t(opt.key) : filters.skillType, clear: () => patchFilters({ skillType: '' }) });
  }
  if (filters.personaCount && filters.personaCount !== 'all') {
    const n = parseInt(filters.personaCount, 10);
    activeChips.push({ key: 'persona-count', label: n >= 6 ? t('scenario.personaCount6Plus') : t('scenario.personaCountN', { count: n }), clear: () => patchFilters({ personaCount: '' }) });
  }
  if (filters.department && filters.department !== 'all') {
    const opt = DEPARTMENT_OPTIONS.find(d => d.value === filters.department);
    activeChips.push({ key: 'department', label: opt ? t(opt.key) : filters.department, clear: () => patchFilters({ department: '' }) });
  }
  const activeFilterCount = activeChips.length;

  const panelProps = {
    filters,
    onChange: patchFilters,
    categories,
    categoryCounts,
    totalCount: scenarioList.length,
    bookmarkCount: scenarioList.filter(s => bookmarkedIds.has(String(s.id))).length,
    canBookmark: !!user,
  };

  return (
    <div className="min-h-[100dvh] bg-[hsl(222_40%_97%)] px-3 py-5 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-7xl">
        <div className={`lg:grid lg:gap-8 ${sidebarCollapsed ? 'lg:grid-cols-[48px_minmax(0,1fr)]' : 'lg:grid-cols-[252px_minmax(0,1fr)]'}`}>
          {/* Desktop sidebar */}
          {isDesktop && <aside className="hidden lg:block" aria-label={t('scenario.exploreSidebar', '시나리오 탐색')} data-testid="scenario-sidebar">
            <div className="sticky top-4 max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain pb-4 [scrollbar-width:thin]">
              {sidebarCollapsed ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setSidebarCollapsed(false)}
                  aria-label={t('scenario.expandSidebar', '탐색 패널 펼치기')}
                  aria-expanded={false}
                  className="relative h-11 w-11 rounded-xl border-slate-200 bg-white text-indigo-800"
                  data-testid="sidebar-toggle"
                >
                  <PanelLeftOpen className="h-4 w-4" />
                  {activeFilterCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-700 px-1 text-[10px] font-bold text-white">{activeFilterCount}</span>
                  )}
                </Button>
              ) : (
                <div className="space-y-5">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-semibold uppercase tracking-[0.1em] text-indigo-900/70">{t('scenario.explore', '탐색')}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setSidebarCollapsed(true)}
                      aria-label={t('scenario.collapseSidebar', '탐색 패널 접기')}
                      aria-expanded={true}
                      className="h-9 w-9 rounded-lg text-slate-500 hover:bg-indigo-50 hover:text-indigo-800"
                      data-testid="sidebar-toggle"
                    >
                      <PanelLeftClose className="h-4 w-4" />
                    </Button>
                  </div>
                  <ScenarioFilterPanel {...panelProps} />
                  {sidebarContent}
                </div>
              )}
            </div>
          </aside>}

          {/* Main */}
          <section className="min-w-0" aria-label={t('scenario.library', '라이브러리')}>
            <header className="mb-5">
              <div className="mt-4 flex gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                  <Input
                    type="search"
                    placeholder={t('scenario.searchPlaceholder')}
                    aria-label={t('scenario.searchPlaceholder')}
                    value={filters.searchText}
                    onChange={(e) => patchFilters({ searchText: e.target.value })}
                    className="h-11 rounded-xl border-slate-200 bg-white pl-10 text-sm shadow-sm focus-visible:ring-indigo-500"
                    data-testid="filter-search"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsMobileFilterOpen(true)}
                  className="relative h-11 rounded-xl border-slate-200 bg-white px-3 text-slate-700 lg:hidden"
                  aria-label={t('scenario.mobileFilterToggle')}
                  data-testid="mobile-filter-toggle"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  <span className="ml-1.5 hidden sm:inline">{t('scenario.filter', '필터')}</span>
                  {activeFilterCount > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-indigo-700 px-1 text-[10px] font-bold text-white">{activeFilterCount}</span>
                  )}
                </Button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-slate-600" data-testid="scenario-result-count" aria-live="polite">
                  {t('scenario.totalCount', { count: filteredScenarios.length })}
                </span>
                {activeChips.map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={chip.clear}
                    aria-label={`${chip.label} ${t('scenario.removeFilter', '필터 제거')}`}
                    className="inline-flex min-h-[30px] items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 pl-3 pr-2 text-xs font-medium text-indigo-900 transition-colors hover:bg-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    data-testid={`active-filter-${chip.key}`}
                  >
                    {chip.label}
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                ))}
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="min-h-[30px] px-1 text-xs font-medium text-slate-500 underline-offset-2 hover:text-indigo-800 hover:underline"
                    data-testid="reset-filters"
                  >
                    {t('scenario.reset')}
                  </button>
                )}
              </div>
            </header>

            {/* Mobile: compact sidebar content (resume, summary) above grid */}
            {sidebarContent && !isDesktop && <div className="mb-5">{sidebarContent}</div>}

            {scenariosLoading ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="scenario-grid-loading">
                {[0, 1, 2, 3].map(i => (
                  <div key={i} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    <Skeleton className="h-32 rounded-none" />
                    <div className="space-y-2 p-4">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : scenariosError ? (
              <div className="rounded-2xl border border-rose-200 bg-white p-8 text-center">
                <p className="font-medium text-slate-800">{t('scenario.loadError', '시나리오를 불러오지 못했습니다.')}</p>
                <Button variant="outline" className="mt-4" onClick={() => refetchScenarios()}>{t('common.retry', '다시 시도')}</Button>
              </div>
            ) : filteredScenarios.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-indigo-200 bg-white/70 px-6 py-14 text-center" data-testid="scenario-empty">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 text-indigo-700">
                  <SearchX className="h-5 w-5" aria-hidden />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-slate-800">{t('scenario.noResults')}</h3>
                <p className="mt-1 text-sm text-slate-500">{t('scenario.noResultsHint')}</p>
                <Button onClick={resetFilters} variant="outline" className="mt-5">{t('scenario.filterReset')}</Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="scenario-grid">
                {filteredScenarios.map((scenario: ComplexScenario) => (
                  <ScenarioLibraryCard
                    key={scenario.id}
                    scenario={scenario}
                    title={tr(scenario.id, 'title', scenario.title) || scenario.title}
                    description={tr(scenario.id, 'description', scenario.description) || ''}
                    skills={sortSkillsByImportance(trSkills(scenario.id, scenario.skills || []))}
                    categoryName={getCategoryName((scenario as any).categoryId)}
                    isBookmarked={bookmarkedIds.has(String(scenario.id))}
                    canBookmark={!!user}
                    stats={statsMap.get(String(scenario.id))}
                    onBookmarkToggle={(e) => handleBookmarkToggle(e, String(scenario.id))}
                    onOpenDetail={() => setDetailScenario(scenario)}
                    onStart={() => onScenarioSelect(scenario)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Mobile filter drawer: only closes via explicit apply/close */}
      <Sheet open={isMobileFilterOpen} onOpenChange={setIsMobileFilterOpen}>
        <SheetContent
          side="left"
          className="flex w-[88vw] max-w-sm flex-col gap-0 bg-[hsl(222_40%_98%)] p-0"
          onInteractOutside={(e) => e.preventDefault()}
          data-testid="mobile-filter-drawer"
        >
          <SheetHeader className="border-b border-slate-200 px-5 py-4 text-left">
            <SheetTitle className="text-base">{t('scenario.filter', '필터')}</SheetTitle>
            <SheetDescription className="text-xs">{t('scenario.totalCount', { count: filteredScenarios.length })}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 py-5">
            <ScenarioFilterPanel {...panelProps} idPrefix={isDesktop ? "mobile-" : ""} />
          </div>
          <div className="flex gap-2 border-t border-slate-200 bg-white p-4">
            <Button variant="outline" className="h-11 flex-1" onClick={resetFilters} data-testid="mobile-reset-filters">
              {t('scenario.reset')}
            </Button>
            <Button className="h-11 flex-[2] bg-indigo-700 text-white hover:bg-indigo-800" onClick={() => setIsMobileFilterOpen(false)} data-testid="mobile-filter-apply">
              {t('scenario.showResults', { count: filteredScenarios.length, defaultValue: `결과 ${filteredScenarios.length}개 보기` })}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* 상세 내용 보기 Sheet */}
      <Sheet open={!!detailScenario} onOpenChange={(open) => !open && setDetailScenario(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto p-0" data-testid="scenario-detail-sheet">
          {detailScenario && (() => {
            const desc = tr(detailScenario.id, 'description', detailScenario.description);
            const situation = tr(detailScenario.id, 'situation', detailScenario.context?.situation);
            const allSkills = sortSkillsByImportance(trSkills(detailScenario.id, detailScenario.skills || []));
            const image = toMediaUrl((detailScenario as any).thumbnail || detailScenario.image);
            const categoryName = getCategoryName((detailScenario as any).categoryId);
            return (
              <>
                <div className="relative aspect-[16/9] max-h-[40dvh] w-full flex-shrink-0 overflow-hidden bg-gradient-to-br from-indigo-200 via-blue-100 to-slate-100">
                  {image && <img src={image} alt="" decoding="async" sizes="(min-width: 640px) 32rem, 100vw" className="absolute inset-0 h-full w-full object-cover object-center" />}
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-900/30 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-5">
                    <SheetHeader>
                      <SheetTitle className="text-white text-xl font-bold leading-tight text-left" data-testid="scenario-detail-title">
                        {tr(detailScenario.id, 'title', detailScenario.title)}
                      </SheetTitle>
                      <SheetDescription className="sr-only">{t('scenario.overview')}</SheetDescription>
                    </SheetHeader>
                    {categoryName && (
                      <Badge className="mt-1.5 w-fit bg-white/95 text-indigo-800 text-xs hover:bg-white">
                        <Folder className="h-3 w-3 mr-1" />
                        {categoryName}
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="p-5 space-y-5">
                  <div className="flex flex-wrap gap-2 text-sm">
                    {(() => {
                      const hasLiveAvatar = (detailScenario.personas || []).some((p: any) => p?.liveAvatarConfigured === true);
                      const label = t('scenario.hasLiveAvatar', '라이브 아바타 포함');
                      return (
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1.5 font-medium text-indigo-900"
                          title={hasLiveAvatar ? label : undefined}
                        >
                          <Users className={`h-3.5 w-3.5 ${hasLiveAvatar ? "text-emerald-600" : ""}`} aria-hidden />
                          {t('scenario.personaCountN', { count: (detailScenario.personas || []).length })}
                          {hasLiveAvatar && <span className="sr-only">{label}</span>}
                        </span>
                      );
                    })()}
                    {detailScenario.estimatedTime && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1.5 font-medium text-indigo-900">
                        <Clock className="h-3.5 w-3.5" aria-hidden />
                        {detailScenario.estimatedTime}
                      </span>
                    )}
                  </div>

                  {desc && (
                    <section>
                      <h4 className="mb-2 text-sm font-semibold text-slate-800">{t('scenario.overview')}</h4>
                      <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap rounded-lg bg-slate-50 p-3">{desc}</p>
                    </section>
                  )}

                  {situation && (
                    <section>
                      <h4 className="mb-2 text-sm font-semibold text-slate-800">{t('scenario.situation')}</h4>
                      <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap rounded-lg border border-amber-100 bg-amber-50 p-3">{situation}</p>
                    </section>
                  )}

                  {(detailScenario.context?.playerRoleText || detailScenario.context?.playerRole?.position) && (
                    <section>
                      <h4 className="mb-2 text-sm font-semibold text-slate-800">{t('scenario.yourRole')}</h4>
                      <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 p-3">
                        {detailScenario.context?.playerRoleText ? (
                          <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{detailScenario.context.playerRoleText}</p>
                        ) : (
                          <>
                            <p className="text-sm font-medium text-slate-700">{detailScenario.context?.playerRole?.position}</p>
                            {detailScenario.context?.playerRole?.experience && (
                              <p className="text-xs text-slate-500 mt-0.5">{detailScenario.context.playerRole.experience}</p>
                            )}
                          </>
                        )}
                      </div>
                    </section>
                  )}

                  {allSkills.length > 0 && (
                    <section>
                      <h4 className="mb-2 text-sm font-semibold text-slate-800">{t('scenario.keyCompetencies')}</h4>
                      <div className="flex flex-wrap gap-2">
                        {allSkills.map((skill: string, index: number) => (
                          <Badge
                            key={index}
                            variant="secondary"
                            className={`text-xs ${index < 2 ? 'bg-indigo-100 text-indigo-800 border-indigo-200' : 'bg-slate-100 text-slate-700 border-slate-200'}`}
                          >
                            {skill}
                          </Badge>
                        ))}
                      </div>
                    </section>
                  )}

                  <div className="pt-2 pb-safe">
                    <Button
                      onClick={() => { setDetailScenario(null); onScenarioSelect(detailScenario); }}
                      className="h-11 w-full bg-indigo-700 text-white font-medium hover:bg-indigo-800"
                      data-testid="button-detail-start-scenario"
                    >
                      <Play className="mr-2 h-4 w-4" aria-hidden />
                      {t('scenario.startScenario')}
                    </Button>
                  </div>
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>
    </div>
  );
}
