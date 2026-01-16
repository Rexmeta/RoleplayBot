import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ComplexScenario, getDifficultyLabel } from "@/lib/scenario-system";
import { Loader2, Search, Filter, ChevronDown, ChevronUp, Folder } from "lucide-react";
import { useTranslation } from "react-i18next";

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
  
  // 필터 상태
  const [filters, setFilters] = useState({
    difficulty: '',
    personaCount: '',
    searchText: '',
    department: '',
    skillType: '',
    categoryId: ''
  });
  
  // 상세 검색 표시 여부
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  
  // 펼쳐진 시나리오 상태 관리 (한 번에 하나만 펼치기)
  const [expandedScenarioId, setExpandedScenarioId] = useState<string | number | null>(null);
  
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
      categoryId: 'all'
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
            {(filters.searchText || filters.personaCount || filters.department || filters.skillType || (filters.categoryId && filters.categoryId !== 'all')) && (
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
                      backgroundImage: `url(${(scenario as any).thumbnail || scenario.image || 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=800&h=400&fit=crop&auto=format'})`,
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
                    
                    {/* 메인 콘텐츠 - 항상 보이는 영역 */}
                    <div className="absolute bottom-0 left-0 right-0 p-5 text-white">
                      <h2 className="text-xl font-bold mb-2 drop-shadow-lg line-clamp-2 group-hover:text-white transition-colors duration-300">
                        {scenario.title}
                      </h2>
                      
                      {/* 설명 미리보기 (500자 제한) */}
                      {!isExpanded && scenario.description && (
                        <p className="text-xs text-gray-200 mb-3 leading-relaxed line-clamp-3 drop-shadow-md">
                          {scenario.description.length > 500 
                            ? scenario.description.substring(0, 500) + '...' 
                            : scenario.description}
                          {scenario.description.length > 500 && (
                            <span className="text-blue-300 ml-1 font-medium">{t('scenario.viewMore')} ▼</span>
                          )}
                        </p>
                      )}
                      
                      <div className="flex items-center gap-3 text-sm">
                        <div className="flex items-center gap-1.5 bg-white/20 backdrop-blur-md rounded-full px-3 py-1.5 shadow-sm">
                          <i className="fas fa-users text-xs"></i>
                          <span className="font-medium">{(scenario.personas || []).length}명</span>
                        </div>
                        <div className="flex items-center gap-1.5 bg-white/20 backdrop-blur-md rounded-full px-3 py-1.5 shadow-sm">
                          <i className="fas fa-clock text-xs"></i>
                          <span className="font-medium">{scenario.estimatedTime}</span>
                        </div>
                        <Badge variant="outline" className="bg-white/20 text-white border-white/40 backdrop-blur-md">
                          {recommendation.level}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  
                  {/* 펼쳐지는 상세 정보 영역 */}
                  <div 
                    className={`relative transition-all duration-500 ease-in-out ${
                      isExpanded ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0 overflow-hidden'
                    }`}
                  >
                    <div className="bg-gradient-to-b from-slate-900 to-slate-800 p-6 text-white">
                      {/* 시나리오 개요 - 모바일에서는 300자 제한 */}
                      {scenario.description && (
                        <div className="bg-white/5 rounded-lg p-4 mb-5">
                          <h4 className="font-medium text-white mb-3 flex items-center text-sm">
                            <i className="fas fa-file-alt mr-2 text-blue-400"></i>
                            {t('scenario.overview')}
                          </h4>
                          {/* 데스크탑: 전체 표시, 모바일: 300자 제한 */}
                          <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap hidden md:block">
                            {scenario.description}
                          </p>
                          <div className="md:hidden">
                            <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">
                              {scenario.description.length > 300 
                                ? scenario.description.substring(0, 300) + '...' 
                                : scenario.description}
                            </p>
                            {scenario.description.length > 300 && (
                              <p className="text-xs text-blue-300 mt-2 flex items-center gap-1">
                                <i className="fas fa-info-circle"></i>
                                {t('scenario.mobileHint')}
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                      
                      {/* 상황 정보 */}
                      <div className="space-y-4 mb-5">
                        <div className="bg-white/5 rounded-lg p-4">
                          <h4 className="font-medium text-white mb-2 flex items-center text-sm">
                            <i className="fas fa-exclamation-triangle mr-2 text-yellow-400"></i>
                            {t('scenario.situation')}
                          </h4>
                          <p className="text-gray-300 text-xs leading-relaxed whitespace-pre-wrap">
                            {scenario.context?.situation || t('scenario.noSituation')}
                          </p>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-3">
                          <div className="bg-white/5 rounded-lg p-3">
                            <h4 className="font-medium text-white mb-1 flex items-center text-xs">
                              <i className="fas fa-user-tie mr-2 text-blue-400"></i>
                              {t('scenario.yourRole')}
                            </h4>
                            <p className="text-gray-300 text-xs">
                              {scenario.context?.playerRole?.position || t('scenario.noRole')}
                            </p>
                            <p className="text-gray-400 text-xs mt-0.5">
                              {scenario.context?.playerRole?.experience || ''}
                            </p>
                          </div>
                          
                          <div className="bg-white/5 rounded-lg p-3">
                            <h4 className="font-medium text-white mb-1 flex items-center text-xs">
                              <i className="fas fa-clock mr-2 text-purple-400"></i>
                              {t('scenario.estimatedTime')}
                            </h4>
                            <p className="text-gray-300 text-xs">{scenario.estimatedTime}</p>
                          </div>
                        </div>
                      </div>

                      {/* 주요 역량 */}
                      <div>
                        <h4 className="font-medium text-white mb-3 flex items-center text-sm">
                          <i className="fas fa-lightbulb mr-2 text-green-400"></i>
                          {t('scenario.keyCompetencies')}
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {sortSkillsByImportance(scenario.skills || []).map((skill: string, index: number) => (
                            <Badge 
                              key={index} 
                              variant="secondary" 
                              className={`text-xs transition-all duration-300 ${
                                index < 2 
                                  ? 'bg-blue-500/40 text-blue-100 border-blue-400/50 hover:bg-blue-500/60' 
                                  : 'bg-white/10 text-white border-white/20 hover:bg-white/20'
                              }`}
                            >
                              {skill}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      
                      {/* 시작 버튼 */}
                      <div className="mt-5 pt-4 border-t border-white/10">
                        <Button 
                          onClick={() => handleScenarioClick(scenario)}
                          className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-medium shadow-lg hover:shadow-xl transition-all duration-300"
                          data-testid={`button-start-scenario-${scenario.id}`}
                        >
                          <i className="fas fa-play mr-2"></i>
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
    </div>
  );
}
