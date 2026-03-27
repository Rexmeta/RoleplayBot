import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ComplexScenario, getDifficultyLabel } from "@/lib/scenario-system";
import { Loader2, Search, Filter, ChevronDown, ChevronUp, Folder, Bookmark, BookmarkCheck, Star, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
import { toMediaUrl } from "@/lib/mediaUrl";
import { queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

interface Category {
  id: string;
  name: string;
  description: string;
  order: number;
}

interface ScenarioSelectorProps {
  onScenarioSelect: (scenario: ComplexScenario) => void;
  playerProfile?: {
    position: string;
    department: string;
    experience: string;
  };
}

export default function ScenarioSelector({ onScenarioSelect, playerProfile }: ScenarioSelectorProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const currentLang = i18n.language || 'ko';
  
  // 필터 상태
  const [filters, setFilters] = useState({
    difficulty: '',
    personaCount: '',
    searchText: '',
    department: '',
    skillType: '',
    categoryId: '',
    bookmarkedOnly: false,
  });
  
  // 상세 검색 표시 여부
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  
  // 펼쳐진 시나리오 상태 관리 (한 번에 하나만 펼치기)
  const [expandedScenarioId, setExpandedScenarioId] = useState<string | number | null>(null);

  // 상세 보기 Sheet 상태
  const [detailScenario, setDetailScenario] = useState<ComplexScenario | null>(null);
  
  const toggleScenarioExpand = (scenarioId: string | number, e: React.MouseEvent) => {
    e.stopPropagation();
    const isCurrentlyExpanded = expandedScenarioId === scenarioId;
    setExpandedScenarioId(prev => prev === scenarioId ? null : scenarioId);
    
    // 카드 클릭 시 카테고리 뱃지가 화면 상단에 위치하도록 스크롤 (펼침 애니메이션 완료 후)
    if (!isCurrentlyExpanded) {
      setTimeout(() => {
        const card = document.querySelector(`[data-testid="scenario-card-${scenarioId}"]`)?.closest('.group');
        if (card) {
          const rect = card.getBoundingClientRect();
          // 카드 상단이 화면 최상단에 위치하도록 스크롤 (헤더 고려하여 약간 여백)
          const scrollTop = window.scrollY + rect.top - 16;
          window.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' });
        }
      }, 400);
    }
  };

  // JSON 파일에서 실시간으로 시나리오와 페르소나 데이터 가져오기
  const { data: scenarios = [], isLoading: scenariosLoading } = useQuery({
    queryKey: ['/api/scenarios'],
    queryFn: () => {
      const token = localStorage.getItem("authToken");
      const headers: Record<string, string> = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      return fetch('/api/scenarios', { 
        credentials: 'include',
        headers 
      }).then(res => res.json());
    }
  });

  // 카테고리 목록 가져오기
  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['/api/categories'],
    queryFn: () => fetch('/api/categories').then(res => res.json()),
    staleTime: 1000 * 60 * 30,
  });

  // 펼쳐진 시나리오의 번역 가져오기 (공용 API 사용)
  const { data: expandedScenarioTranslation } = useQuery({
    queryKey: ['/api/scenarios', expandedScenarioId, 'translations', currentLang],
    queryFn: async () => {
      if (!expandedScenarioId || currentLang === 'ko') return null;
      const token = localStorage.getItem("authToken");
      const headers: Record<string, string> = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetch(`/api/scenarios/${expandedScenarioId}/translations/${currentLang}`, {
        credentials: 'include',
        headers
      });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!expandedScenarioId && currentLang !== 'ko',
    staleTime: 1000 * 60 * 10,
  });

  // 시나리오 ID로 번역된 skills 가져오기
  const getTranslatedSkills = (scenarioId: string | number, originalSkills: string[]): string[] => {
    if (currentLang === 'ko' || !expandedScenarioTranslation) {
      return originalSkills;
    }
    // 현재 펼쳐진 시나리오의 번역만 사용
    if (String(expandedScenarioId) === String(scenarioId) && expandedScenarioTranslation.skills?.length > 0) {
      return expandedScenarioTranslation.skills;
    }
    return originalSkills;
  };

  // 번역된 제목 가져오기
  const getTranslatedTitle = (scenarioId: string | number, originalTitle: string): string => {
    if (currentLang === 'ko' || !expandedScenarioTranslation) {
      return originalTitle;
    }
    if (String(expandedScenarioId) === String(scenarioId) && expandedScenarioTranslation.title) {
      return expandedScenarioTranslation.title;
    }
    return originalTitle;
  };

  // 번역된 설명 가져오기
  const getTranslatedDescription = (scenarioId: string | number, originalDescription: string): string => {
    if (currentLang === 'ko' || !expandedScenarioTranslation) {
      return originalDescription;
    }
    if (String(expandedScenarioId) === String(scenarioId) && expandedScenarioTranslation.description) {
      return expandedScenarioTranslation.description;
    }
    return originalDescription;
  };

  // 번역된 상황 정보 가져오기
  const getTranslatedSituation = (scenarioId: string | number, originalSituation: string | undefined): string | undefined => {
    if (currentLang === 'ko' || !expandedScenarioTranslation || !originalSituation) {
      return originalSituation;
    }
    if (String(expandedScenarioId) === String(scenarioId) && expandedScenarioTranslation.situation) {
      return expandedScenarioTranslation.situation;
    }
    return originalSituation;
  };

  // 사용자 북마크 목록 조회 (로그인 시에만, 사용자별 캐시 키로 계정 전환 시 교차 오염 방지)
  const { data: bookmarks = [] } = useQuery<{ id: string; userId: string; scenarioId: string }[]>({
    queryKey: ['/api/bookmarks', user?.id],
    queryFn: () => {
      const token = localStorage.getItem("authToken");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      return fetch('/api/bookmarks', { credentials: 'include', headers }).then(res => {
        if (!res.ok) return [];
        return res.json();
      });
    },
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
  });

  // 시나리오 완료 통계 조회
  const { data: scenarioStats = [] } = useQuery<{ scenarioId: string; completionCount: number; averageScore: number | null }[]>({
    queryKey: ['/api/scenarios/stats'],
    queryFn: () => fetch('/api/scenarios/stats').then(res => res.json()),
    staleTime: 1000 * 60 * 10,
  });

  // 북마크된 scenarioId Set
  const bookmarkedIds = new Set(bookmarks.map((b) => b.scenarioId));

  // 북마크 통계 맵
  const statsMap = new Map(scenarioStats.map((s) => [s.scenarioId, s] as const));

  // 북마크 토글 mutation
  const bookmarkMutation = useMutation({
    mutationFn: async ({ scenarioId, isBookmarked }: { scenarioId: string; isBookmarked: boolean }) => {
      const token = localStorage.getItem("authToken");
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (isBookmarked) {
        const res = await fetch(`/api/bookmarks/${encodeURIComponent(scenarioId)}`, {
          method: 'DELETE',
          credentials: 'include',
          headers,
        });
        if (!res.ok) throw new Error('북마크 삭제에 실패했습니다.');
      } else {
        const res = await fetch('/api/bookmarks', {
          method: 'POST',
          credentials: 'include',
          headers,
          body: JSON.stringify({ scenarioId }),
        });
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
    const isBookmarked = bookmarkedIds.has(scenarioId);
    bookmarkMutation.mutate({ scenarioId, isBookmarked });
  };

  // MBTI 기본 특성을 시나리오 내에서 직접 처리 (외부 API 호출 없이)
  const personasLoading = false; // 로딩 상태 제거

  const handleScenarioClick = (scenario: ComplexScenario) => {
    // 바로 페르소나 선택 화면으로 이동
    onScenarioSelect(scenario);
  };

  // 카테고리별 배지 색상 팔레트
  const categoryColorMap: Record<string, string> = {
    'default': 'bg-blue-600/90',
  };

  // 카테고리 이름 조회 헬퍼 함수
  const getCategoryName = (categoryId: string | undefined): string => {
    if (!categoryId) return '';
    const category = categories.find(c => c.id === categoryId);
    return category?.name || '';
  };

  // 카테고리별 뱃지 색상 조회 함수
  const getCategoryBadgeColor = (categoryId: string | undefined): string => {
    if (!categoryId) return 'bg-slate-600/90';
    
    // 다양한 색상 팔레트
    const colorPalette = [
      'bg-blue-600/90',      // 0
      'bg-purple-600/90',    // 1
      'bg-pink-600/90',      // 2
      'bg-red-600/90',       // 3
      'bg-orange-600/90',    // 4
      'bg-amber-600/90',     // 5
      'bg-yellow-600/90',    // 6
      'bg-green-600/90',     // 7
      'bg-emerald-600/90',   // 8
      'bg-teal-600/90',      // 9
      'bg-cyan-600/90',      // 10
      'bg-sky-600/90',       // 11
      'bg-indigo-600/90',    // 12
      'bg-violet-600/90',    // 13
      'bg-fuchsia-600/90',   // 14
      'bg-rose-600/90',      // 15
      'bg-red-700/90',       // 16
      'bg-orange-700/90',    // 17
      'bg-green-700/90',     // 18
      'bg-blue-700/90',      // 19
    ];
    
    // 카테고리 배열에서 인덱스 찾아서 색상 선택 (더 안정적)
    const categoryIndex = categories.findIndex(c => c.id === categoryId);
    const colorIndex = categoryIndex >= 0 ? categoryIndex % colorPalette.length : Math.abs(categoryId.charCodeAt(0)) % colorPalette.length;
    return colorPalette[colorIndex];
  };

  // 필터링된 시나리오 목록
  const filteredScenarios = scenarios.filter((scenario: ComplexScenario) => {
    // 북마크 필터
    if (filters.bookmarkedOnly) {
      if (!bookmarkedIds.has(String(scenario.id))) {
        return false;
      }
    }

    // 카테고리 필터
    if (filters.categoryId && filters.categoryId !== 'all') {
      if ((scenario as any).categoryId !== filters.categoryId) {
        return false;
      }
    }
    
    // 검색어 필터
    if (filters.searchText && !scenario.title.toLowerCase().includes(filters.searchText.toLowerCase()) && 
        !scenario.description.toLowerCase().includes(filters.searchText.toLowerCase())) {
      return false;
    }
    
    // 페르소나 수 필터
    if (filters.personaCount && filters.personaCount !== 'all') {
      const personaCount = scenario.personas?.length || 0;
      const filterCount = parseInt(filters.personaCount);
      if (personaCount !== filterCount) {
        return false;
      }
    }
    
    // 부서 필터
    if (filters.department && filters.department !== 'all') {
      const hasMatchingDepartment = scenario.personas?.some((persona: any) => 
        typeof persona === 'object' && persona.department?.toLowerCase().includes(filters.department.toLowerCase())
      );
      if (!hasMatchingDepartment) {
        return false;
      }
    }
    
    // 스킬 유형 필터
    if (filters.skillType && filters.skillType !== 'all') {
      const hasMatchingSkill = scenario.skills?.some((skill: string) =>
        skill.toLowerCase().includes(filters.skillType.toLowerCase())
      );
      if (!hasMatchingSkill) {
        return false;
      }
    }
    
    return true;
  });

  // 필터 초기화
  const resetFilters = () => {
    setFilters({
      difficulty: '',
      personaCount: '',
      searchText: '',
      department: '',
      skillType: '',
      categoryId: 'all',
      bookmarkedOnly: false,
    });
  };

  // 스코어링 가중치 기반 역량 정렬 (높은 가중치 순)
  const sortSkillsByImportance = (skills: string[]): string[] => {
    const skillWeights: Record<string, number> = {
      // 명확성 & 논리성 (20%)
      '논리적설명': 20, '구조화': 20, '체계적대화': 20, '메시지구성': 20, '논리': 20,
      // 경청 & 공감 (20%) 
      '공감': 20, '감정이해': 20, '배려': 20, '경청': 20, '이해': 20,
      // 적절성 & 상황 대응 (20%)
      '적절한소통': 20, '상황판단': 20, '유연성': 20, '적응력': 20, '상황대응': 20,
      // 설득력 & 영향력 (20%)
      '설득': 20, '영향력': 20, '근거제시': 20, '설득력': 20, '논증': 20,
      // 전략적 커뮤니케이션 (20%)
      '전략적소통': 20, '목표지향': 20, '협상': 20, '갈등해결': 20, '주도성': 20,
      // 기타 일반 역량
      '문제해결': 15, '전문성': 15, '의사소통': 15, '팀워크': 10, '리더십': 10
    };

    return skills.sort((a, b) => {
      const weightA = skillWeights[a] || 0;
      const weightB = skillWeights[b] || 0;
      return weightB - weightA; // 높은 가중치 순으로 정렬
    });
  };

  const getRecommendationLevel = (scenario: ComplexScenario): { level: string; color: string; reason: string } => {
    if (playerProfile?.department === "개발팀" && scenario.id === "app-delay-crisis") {
      return {
        level: t('scenario.stronglyRecommended'),
        color: "green",
        reason: t('scenario.optimizedForDev')
      };
    }
    return {
      level: t('scenario.recommended'),
      color: "blue", 
      reason: t('scenario.usefulForAll')
    };
  };

  if (scenariosLoading || personasLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-6 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p className="text-slate-600">{t('scenario.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}       

        <div className="max-w-4xl mx-auto">
          
          {/* 필터 섹션 */}
          <div className="mb-6 p-4 bg-white rounded-lg border border-slate-300 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-slate-600" />
                <h3 className="text-sm font-medium text-slate-700">{t('scenario.totalCount', { count: filteredScenarios.length })}</h3>
              </div>
              <div className="flex items-center gap-2">
                {user && (
                  <Button
                    variant={filters.bookmarkedOnly ? "default" : "outline"}
                    size="sm"
                    onClick={() => setFilters(prev => ({ ...prev, bookmarkedOnly: !prev.bookmarkedOnly }))}
                    className={`h-7 px-2 text-xs flex items-center gap-1 ${filters.bookmarkedOnly ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-500' : 'text-slate-600 hover:text-slate-900'}`}
                    data-testid="filter-bookmarked"
                  >
                    <Bookmark className="h-3 w-3" />
                    즐겨찾기
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                  className="text-slate-600 hover:text-slate-900 h-7 px-2 text-xs flex items-center gap-1"
                  data-testid="toggle-advanced-filters"
                >
                  {t('scenario.advancedSearch')}
                  {showAdvancedFilters ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={resetFilters}
                  className="text-slate-600 hover:text-slate-900 h-7 px-2 text-xs"
                  data-testid="reset-filters"
                >
                  {t('scenario.reset')}
                </Button>
              </div>
            </div>
            
            {/* 기본 필터 (항상 표시) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              {/* 검색어 */}
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  placeholder={t('scenario.searchPlaceholder')}
                  value={filters.searchText}
                  onChange={(e) => setFilters(prev => ({ ...prev, searchText: e.target.value }))}
                  className="pl-10 h-9 text-sm"
                  data-testid="filter-search"
                />
              </div>
              
              {/* 카테고리 필터 */}
              <Select value={filters.categoryId || undefined} onValueChange={(value) => setFilters(prev => ({ ...prev, categoryId: value }))}>
                <SelectTrigger data-testid="filter-category" className="h-9 text-sm">
                  <div className="flex items-center gap-2">
                    <Folder className="h-4 w-4 text-slate-400" />
                    <SelectValue placeholder={t('scenario.category')} />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('scenario.allCategories')}</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              {/* 스킬 유형 */}
              <Select value={filters.skillType || undefined} onValueChange={(value) => setFilters(prev => ({ ...prev, skillType: value }))}>
                <SelectTrigger data-testid="filter-skill-type" className="h-9 text-sm">
                  <SelectValue placeholder={t('scenario.coreSkill')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('scenario.all')}</SelectItem>
                  <SelectItem value="협상">{t('scenario.negotiation')}</SelectItem>
                  <SelectItem value="의사소통">{t('scenario.communication')}</SelectItem>
                  <SelectItem value="갈등해결">{t('scenario.conflictResolution')}</SelectItem>
                  <SelectItem value="리더십">{t('scenario.leadership')}</SelectItem>
                  <SelectItem value="문제해결">{t('scenario.problemSolving')}</SelectItem>
                  <SelectItem value="팀워크">{t('scenario.teamwork')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {/* 고급 필터 (토글로 표시/숨김) */}
            {showAdvancedFilters && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3 border-t border-slate-200">
                {/* 페르소나 수 */}
                <Select value={filters.personaCount || undefined} onValueChange={(value) => setFilters(prev => ({ ...prev, personaCount: value }))}>
                  <SelectTrigger data-testid="filter-persona-count" className="h-9 text-sm">
                    <SelectValue placeholder={t('scenario.personaCount')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('scenario.all')}</SelectItem>
                    <SelectItem value="1">{t('scenario.personaCountN', { count: 1 })}</SelectItem>
                    <SelectItem value="2">{t('scenario.personaCountN', { count: 2 })}</SelectItem>
                    <SelectItem value="3">{t('scenario.personaCountN', { count: 3 })}</SelectItem>
                    <SelectItem value="4">{t('scenario.personaCountN', { count: 4 })}</SelectItem>
                    <SelectItem value="5">{t('scenario.personaCountN', { count: 5 })}</SelectItem>
                    <SelectItem value="6">{t('scenario.personaCount6Plus')}</SelectItem>
                  </SelectContent>
                </Select>
                
                {/* 부서 */}
                <Select value={filters.department || undefined} onValueChange={(value) => setFilters(prev => ({ ...prev, department: value }))}>
                  <SelectTrigger data-testid="filter-department" className="h-9 text-sm">
                    <SelectValue placeholder={t('scenario.department')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('scenario.all')}</SelectItem>
                    <SelectItem value="개발팀">{t('scenario.devTeam')}</SelectItem>
                    <SelectItem value="마케팅팀">{t('scenario.marketingTeam')}</SelectItem>
                    <SelectItem value="QA팀">{t('scenario.qaTeam')}</SelectItem>
                    <SelectItem value="고객서비스팀">{t('scenario.csTeam')}</SelectItem>
                    <SelectItem value="경영진">{t('scenario.management')}</SelectItem>
                    <SelectItem value="물류팀">{t('scenario.logisticsTeam')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            
            {/* 필터 적용 상태 표시 */}
            {(filters.searchText || filters.personaCount || filters.department || filters.skillType || (filters.categoryId && filters.categoryId !== 'all') || filters.bookmarkedOnly) && (
              <div className="mt-3 pt-3 border-t border-slate-200">
                <div className="flex items-center justify-center">
                  <span className="text-xs text-blue-600">{t('scenario.filterApplied')}</span>
                </div>
              </div>
            )}
          </div>
          
          <div className="space-y-4">
            {filteredScenarios.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">🔍</div>
                <h3 className="text-xl font-medium text-slate-600 mb-2">{t('scenario.noResults')}</h3>
                <p className="text-slate-500 mb-4">{t('scenario.noResultsHint')}</p>
                <Button onClick={resetFilters} variant="outline">
                  {t('scenario.filterReset')}
                </Button>
              </div>
            ) : (
              filteredScenarios.map((scenario: ComplexScenario) => {
              const recommendation = getRecommendationLevel(scenario);
              const isExpanded = expandedScenarioId === scenario.id;
              
              return (
                <Card 
                  key={scenario.id} 
                  className="overflow-hidden group relative border-0 shadow-lg hover:shadow-2xl transition-all duration-500"
                >
                  {/* 배경 이미지 레이어 - 줌 인 효과 */}
                  <div
                    className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-all duration-700 ease-out group-hover:scale-110 group-hover:brightness-110"
                    style={{
                      backgroundImage: `url(${toMediaUrl((scenario as any).thumbnail || scenario.image) || 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=800&h=400&fit=crop&auto=format'})`,
                    }}
                  />
                  
                  {/* 그라데이션 오버레이 - 호버시 밝아지는 효과 */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20 group-hover:from-black/70 group-hover:via-black/30 group-hover:to-transparent transition-all duration-500" />
                  
                  {/* 시나리오 카드 콘텐츠 */}
                  <div
                    className="relative cursor-pointer min-h-[14rem]"
                    onClick={() => toggleScenarioExpand(scenario.id, { stopPropagation: () => {} } as React.MouseEvent)}
                    data-testid={`scenario-card-${scenario.id}`}
                  >
                    {/* 상단 배지 영역 */}
                    <div className="absolute top-4 left-4 right-4 flex items-start justify-between z-10">
                      {/* 카테고리 배지 */}
                      {getCategoryName((scenario as any).categoryId) && (
                        <Badge className={`${getCategoryBadgeColor((scenario as any).categoryId)} text-white text-xs backdrop-blur-md shadow-lg`}>
                          <Folder className="h-3 w-3 mr-1" />
                          {getCategoryName((scenario as any).categoryId)}
                        </Badge>
                      )}
                      
                      <div className="flex items-center gap-1.5">
                        {/* 북마크 버튼 (로그인 시에만) */}
                        {user && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => handleBookmarkToggle(e, String(scenario.id))}
                            className="w-8 h-8 p-0 bg-white/20 hover:bg-white/40 backdrop-blur-md rounded-full transition-all duration-300"
                            data-testid={`button-bookmark-${scenario.id}`}
                          >
                            {bookmarkedIds.has(String(scenario.id)) ? (
                              <BookmarkCheck className="w-4 h-4 text-amber-400" />
                            ) : (
                              <Bookmark className="w-4 h-4 text-white" />
                            )}
                          </Button>
                        )}

                        {/* 펼치기/접기 버튼 */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => toggleScenarioExpand(scenario.id, e)}
                          className="w-8 h-8 p-0 bg-white/20 hover:bg-white/40 backdrop-blur-md rounded-full transition-all duration-300"
                          data-testid={`button-expand-scenario-${scenario.id}`}
                        >
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4 text-white" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-white" />
                          )}
                        </Button>
                      </div>
                    </div>
                    
                    {/* 메인 콘텐츠 - 항상 보이는 영역 */}
                    <div className="absolute bottom-0 left-0 right-0 p-5 text-white">
                      <h2 className="text-xl font-bold mb-2 drop-shadow-lg line-clamp-2 group-hover:text-white transition-colors duration-300">
                        {getTranslatedTitle(scenario.id, scenario.title)}
                      </h2>
                      
                      {/* 설명 미리보기 (500자 제한) */}
                      {!isExpanded && scenario.description && (() => {
                        const desc = getTranslatedDescription(scenario.id, scenario.description);
                        return (
                          <p className="text-xs text-gray-200 mb-3 leading-relaxed line-clamp-3 drop-shadow-md">
                            {desc.length > 500 
                              ? desc.substring(0, 500) + '...' 
                              : desc}
                            {desc.length > 500 && (
                              <span className="text-blue-300 ml-1 font-medium">{t('scenario.viewMore')} ▼</span>
                            )}
                          </p>
                        );
                      })()}
                      
                      <div className="flex items-center gap-3 text-sm flex-wrap">
                        <div className="flex items-center gap-1.5 bg-white/20 backdrop-blur-md rounded-full px-3 py-1.5 shadow-sm">
                          <i className="fas fa-users text-xs"></i>
                          <span className="font-medium">{t('scenario.personaCountN', { count: (scenario.personas || []).length })}</span>
                        </div>
                        <div className="flex items-center gap-1.5 bg-white/20 backdrop-blur-md rounded-full px-3 py-1.5 shadow-sm">
                          <i className="fas fa-clock text-xs"></i>
                          <span className="font-medium">{scenario.estimatedTime}</span>
                        </div>
                        {/* 완료 통계 배지 */}
                        {(() => {
                          const stats = statsMap.get(String(scenario.id));
                          if (!stats || stats.completionCount === 0) return null;
                          return (
                            <>
                              <div className="flex items-center gap-1.5 bg-green-500/30 backdrop-blur-md rounded-full px-3 py-1.5 shadow-sm">
                                <Users className="h-3 w-3" />
                                <span className="font-medium text-xs">{stats.completionCount}회 완료</span>
                              </div>
                              {stats.averageScore != null && (
                                <div className="flex items-center gap-1.5 bg-yellow-500/30 backdrop-blur-md rounded-full px-3 py-1.5 shadow-sm">
                                  <Star className="h-3 w-3" />
                                  <span className="font-medium text-xs">평균 {stats.averageScore}점</span>
                                </div>
                              )}
                            </>
                          );
                        })()}
                        <Badge variant="outline" className="bg-white/20 text-white border-white/40 backdrop-blur-md">
                          {recommendation.level}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  
                  {/* 펼쳐지는 요약 정보 영역 */}
                  <div 
                    className={`relative transition-all duration-500 ease-in-out ${
                      isExpanded ? 'max-h-[800px] opacity-100' : 'max-h-0 opacity-0 overflow-hidden'
                    }`}
                  >
                    <div className="bg-gradient-to-b from-slate-900 to-slate-800 p-5 text-white">
                      {/* 시나리오 개요 요약 (150자) */}
                      {scenario.description && (() => {
                        const desc = getTranslatedDescription(scenario.id, scenario.description);
                        const isTruncated = desc.length > 150;
                        return (
                          <div className="bg-white/5 rounded-lg p-3 mb-4">
                            <h4 className="font-medium text-white mb-2 flex items-center text-xs">
                              <i className="fas fa-file-alt mr-2 text-blue-400"></i>
                              {t('scenario.overview')}
                            </h4>
                            <p className="text-gray-300 text-xs leading-relaxed">
                              {isTruncated ? desc.substring(0, 150) + '...' : desc}
                            </p>
                          </div>
                        );
                      })()}

                      {/* 상황 요약 (3줄 제한) */}
                      {scenario.context?.situation && (
                        <div className="bg-white/5 rounded-lg p-3 mb-4">
                          <h4 className="font-medium text-white mb-2 flex items-center text-xs">
                            <i className="fas fa-exclamation-triangle mr-2 text-yellow-400"></i>
                            {t('scenario.situation')}
                          </h4>
                          <p className="text-gray-300 text-xs leading-relaxed line-clamp-3">
                            {getTranslatedSituation(scenario.id, scenario.context?.situation)}
                          </p>
                        </div>
                      )}

                      {/* 역량 태그 (최대 4개) */}
                      {(() => {
                        const allSkills = sortSkillsByImportance(getTranslatedSkills(scenario.id, scenario.skills || []));
                        const visibleSkills = allSkills.slice(0, 4);
                        const remaining = allSkills.length - 4;
                        return (
                          <div className="flex flex-wrap gap-1.5 mb-4">
                            {visibleSkills.map((skill: string, index: number) => (
                              <Badge
                                key={index}
                                variant="secondary"
                                className={`text-xs ${index < 2 ? 'bg-blue-500/40 text-blue-100 border-blue-400/50' : 'bg-white/10 text-white border-white/20'}`}
                              >
                                {skill}
                              </Badge>
                            ))}
                            {remaining > 0 && (
                              <Badge variant="secondary" className="text-xs bg-white/10 text-gray-300 border-white/20">
                                +{remaining}
                              </Badge>
                            )}
                          </div>
                        );
                      })()}

                      {/* 버튼 영역 */}
                      <div className="flex gap-2 pt-3 border-t border-white/10">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); setDetailScenario(scenario); }}
                          className="flex-1 text-xs text-gray-300 hover:text-white hover:bg-white/10 border border-white/20"
                        >
                          <i className="fas fa-expand-alt mr-1.5"></i>
                          {t('scenario.viewDetail', '상세 내용 보기')}
                        </Button>
                        <Button
                          onClick={(e) => { e.stopPropagation(); handleScenarioClick(scenario); }}
                          size="sm"
                          className="flex-1 text-xs bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white shadow-lg"
                          data-testid={`button-start-scenario-${scenario.id}`}
                        >
                          <i className="fas fa-play mr-1.5"></i>
                          {t('scenario.startScenario')}
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card>
              );
              })
            )}
          </div>
        </div>
      </div>

      {/* 상세 내용 보기 Sheet */}
      <Sheet open={!!detailScenario} onOpenChange={(open) => !open && setDetailScenario(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto p-0">
          {detailScenario && (() => {
            const desc = getTranslatedDescription(detailScenario.id, detailScenario.description);
            const situation = getTranslatedSituation(detailScenario.id, detailScenario.context?.situation);
            const allSkills = sortSkillsByImportance(getTranslatedSkills(detailScenario.id, detailScenario.skills || []));
            return (
              <>
                {/* 상단 이미지 헤더 */}
                <div className="relative h-44 w-full flex-shrink-0">
                  <div
                    className="absolute inset-0 bg-cover bg-center"
                    style={{ backgroundImage: `url(${toMediaUrl((detailScenario as any).thumbnail || detailScenario.image) || 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=800&h=400&fit=crop&auto=format'})` }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-5">
                    <SheetHeader>
                      <SheetTitle className="text-white text-xl font-bold drop-shadow leading-tight text-left">
                        {getTranslatedTitle(detailScenario.id, detailScenario.title)}
                      </SheetTitle>
                    </SheetHeader>
                    {getCategoryName((detailScenario as any).categoryId) && (
                      <Badge className="mt-1.5 bg-blue-600/90 text-white text-xs w-fit">
                        <Folder className="h-3 w-3 mr-1" />
                        {getCategoryName((detailScenario as any).categoryId)}
                      </Badge>
                    )}
                  </div>
                </div>

                {/* 상세 내용 */}
                <div className="p-5 space-y-5">
                  {/* 메타 정보 */}
                  <div className="flex gap-3 text-sm">
                    <div className="flex items-center gap-1.5 bg-slate-100 rounded-full px-3 py-1.5">
                      <i className="fas fa-users text-slate-500 text-xs"></i>
                      <span className="text-slate-700 font-medium">{t('scenario.personaCountN', { count: (detailScenario.personas || []).length })}</span>
                    </div>
                    <div className="flex items-center gap-1.5 bg-slate-100 rounded-full px-3 py-1.5">
                      <i className="fas fa-clock text-slate-500 text-xs"></i>
                      <span className="text-slate-700 font-medium">{detailScenario.estimatedTime}</span>
                    </div>
                  </div>

                  {/* 시나리오 개요 */}
                  {desc && (
                    <div>
                      <h4 className="font-semibold text-slate-800 mb-2 flex items-center text-sm">
                        <i className="fas fa-file-alt mr-2 text-blue-500"></i>
                        {t('scenario.overview')}
                      </h4>
                      <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap bg-slate-50 rounded-lg p-3">{desc}</p>
                    </div>
                  )}

                  {/* 상황 정보 */}
                  {situation && (
                    <div>
                      <h4 className="font-semibold text-slate-800 mb-2 flex items-center text-sm">
                        <i className="fas fa-exclamation-triangle mr-2 text-yellow-500"></i>
                        {t('scenario.situation')}
                      </h4>
                      <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap bg-yellow-50 rounded-lg p-3 border border-yellow-100">{situation}</p>
                    </div>
                  )}

                  {/* 내 역할 */}
                  {(detailScenario.context?.playerRoleText || detailScenario.context?.playerRole?.position) && (
                    <div>
                      <h4 className="font-semibold text-slate-800 mb-2 flex items-center text-sm">
                        <i className="fas fa-user-tie mr-2 text-corporate-500"></i>
                        {t('scenario.yourRole')}
                      </h4>
                      <div className="bg-corporate-50 rounded-lg p-3 border border-corporate-100">
                        {detailScenario.context?.playerRoleText ? (
                          <p className="text-sm text-slate-700 leading-relaxed">{detailScenario.context.playerRoleText}</p>
                        ) : (
                          <>
                            <p className="text-sm font-medium text-slate-700">{detailScenario.context?.playerRole?.position}</p>
                            {detailScenario.context?.playerRole?.experience && (
                              <p className="text-xs text-slate-500 mt-0.5">{detailScenario.context.playerRole.experience}</p>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 주요 역량 전체 */}
                  {allSkills.length > 0 && (
                    <div>
                      <h4 className="font-semibold text-slate-800 mb-2 flex items-center text-sm">
                        <i className="fas fa-lightbulb mr-2 text-green-500"></i>
                        {t('scenario.keyCompetencies')}
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {allSkills.map((skill: string, index: number) => (
                          <Badge
                            key={index}
                            variant="secondary"
                            className={`text-xs ${index < 2 ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}
                          >
                            {skill}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 시작 버튼 */}
                  <div className="pt-2 pb-safe">
                    <Button
                      onClick={() => { setDetailScenario(null); handleScenarioClick(detailScenario); }}
                      className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-medium shadow-lg"
                    >
                      <i className="fas fa-play mr-2"></i>
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
