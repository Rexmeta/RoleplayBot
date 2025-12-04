import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ComplexScenario, getDifficultyLabel } from "@/lib/scenario-system";
import { Loader2, Search, Filter, ChevronDown, ChevronUp, Folder } from "lucide-react";

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

  // JSON 파일에서 실시간으로 시나리오와 페르소나 데이터 가져오기
  const { data: scenarios = [], isLoading: scenariosLoading } = useQuery({
    queryKey: ['/api/scenarios'],
    queryFn: () => fetch('/api/scenarios').then(res => res.json())
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

  // 카테고리 이름 조회 헬퍼 함수
  const getCategoryName = (categoryId: string | undefined): string => {
    if (!categoryId) return '';
    const category = categories.find(c => c.id === categoryId);
    return category?.name || '';
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
      categoryId: ''
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
        level: "강력 추천",
        color: "green",
        reason: "개발팀 배경에 최적화된 시나리오"
      };
    }
    return {
      level: "적합",
      color: "blue", 
      reason: "모든 부서에 유용한 협업 시나리오"
    };
  };

  if (scenariosLoading || personasLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-6 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
          <p className="text-slate-600">시나리오 데이터를 불러오는 중...</p>
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
                <h3 className="text-sm font-medium text-slate-700">총 {filteredScenarios.length}개의 시나리오</h3>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                  className="text-slate-600 hover:text-slate-900 h-7 px-2 text-xs flex items-center gap-1"
                  data-testid="toggle-advanced-filters"
                >
                  상세 검색
                  {showAdvancedFilters ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={resetFilters}
                  className="text-slate-600 hover:text-slate-900 h-7 px-2 text-xs"
                  data-testid="reset-filters"
                >
                  초기화
                </Button>
              </div>
            </div>
            
            {/* 기본 필터 (항상 표시) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              {/* 검색어 */}
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="시나리오 검색"
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
                    <SelectValue placeholder="카테고리" />
                  </div>
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
              
              {/* 스킬 유형 */}
              <Select value={filters.skillType || undefined} onValueChange={(value) => setFilters(prev => ({ ...prev, skillType: value }))}>
                <SelectTrigger data-testid="filter-skill-type" className="h-9 text-sm">
                  <SelectValue placeholder="핵심 스킬" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체</SelectItem>
                  <SelectItem value="협상">협상</SelectItem>
                  <SelectItem value="의사소통">의사소통</SelectItem>
                  <SelectItem value="갈등해결">갈등해결</SelectItem>
                  <SelectItem value="리더십">리더십</SelectItem>
                  <SelectItem value="문제해결">문제해결</SelectItem>
                  <SelectItem value="팀워크">팀워크</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {/* 고급 필터 (토글로 표시/숨김) */}
            {showAdvancedFilters && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3 border-t border-slate-200">
                {/* 페르소나 수 */}
                <Select value={filters.personaCount || undefined} onValueChange={(value) => setFilters(prev => ({ ...prev, personaCount: value }))}>
                  <SelectTrigger data-testid="filter-persona-count" className="h-9 text-sm">
                    <SelectValue placeholder="상대역 수" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">전체</SelectItem>
                    <SelectItem value="1">1명</SelectItem>
                    <SelectItem value="2">2명</SelectItem>
                    <SelectItem value="3">3명</SelectItem>
                    <SelectItem value="4">4명</SelectItem>
                    <SelectItem value="5">5명</SelectItem>
                    <SelectItem value="6">6명 이상</SelectItem>
                  </SelectContent>
                </Select>
                
                {/* 부서 */}
                <Select value={filters.department || undefined} onValueChange={(value) => setFilters(prev => ({ ...prev, department: value }))}>
                  <SelectTrigger data-testid="filter-department" className="h-9 text-sm">
                    <SelectValue placeholder="부서" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">전체</SelectItem>
                    <SelectItem value="개발팀">개발팀</SelectItem>
                    <SelectItem value="마케팅팀">마케팅팀</SelectItem>
                    <SelectItem value="QA팀">QA팀</SelectItem>
                    <SelectItem value="고객서비스팀">고객서비스팀</SelectItem>
                    <SelectItem value="경영진">경영진</SelectItem>
                    <SelectItem value="물류팀">물류팀</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            
            {/* 필터 적용 상태 표시 */}
            {(filters.searchText || filters.personaCount || filters.department || filters.skillType || (filters.categoryId && filters.categoryId !== 'all')) && (
              <div className="mt-3 pt-3 border-t border-slate-200">
                <div className="flex items-center justify-center">
                  <span className="text-xs text-blue-600">필터 적용됨</span>
                </div>
              </div>
            )}
          </div>
          
          <div className="space-y-4">
            {filteredScenarios.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">🔍</div>
                <h3 className="text-xl font-medium text-slate-600 mb-2">조건에 맞는 시나리오가 없습니다</h3>
                <p className="text-slate-500 mb-4">필터 조건을 변경하거나 초기화해보세요</p>
                <Button onClick={resetFilters} variant="outline">
                  필터 초기화
                </Button>
              </div>
            ) : (
              filteredScenarios.map((scenario: ComplexScenario) => {
              const recommendation = getRecommendationLevel(scenario);
              
              return (
                <Card key={scenario.id} className="overflow-hidden group">
                  {/* 시나리오 카드 - 이미지 배경 버전 (썸네일 우선 사용) */}
                  <div
                    className="relative cursor-pointer min-h-[12rem] max-h-[12rem] group-hover:max-h-screen overflow-x-hidden overflow-y-hidden group-hover:overflow-y-auto transition-[max-height] duration-700 ease-in-out"
                    onClick={() => handleScenarioClick(scenario)}
                    data-testid={`scenario-card-${scenario.id}`}
                    style={{
                      backgroundImage: `linear-gradient(45deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.3) 100%), url(${(scenario as any).thumbnail || scenario.image || 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=800&h=400&fit=crop&auto=format'})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      backgroundRepeat: 'no-repeat'
                    }}
                  >
                    {/* 기본 표시 정보 (항상 보이는 내용) */}
                    <div className="absolute inset-0 flex flex-col justify-center items-center text-white text-center p-6 group-hover:hidden transition-all duration-500">
                      {/* 카테고리 배지 (상단 좌측) */}
                      {getCategoryName((scenario as any).categoryId) && (
                        <div className="absolute top-3 left-3">
                          <Badge className="bg-blue-600/80 text-white text-xs backdrop-blur-sm">
                            <Folder className="h-3 w-3 mr-1" />
                            {getCategoryName((scenario as any).categoryId)}
                          </Badge>
                        </div>
                      )}
                      <h2 className="text-2xl font-bold mb-4 drop-shadow-lg">{scenario.title}</h2>
                      <div className="flex items-center gap-4 text-sm">
                        <div className="flex items-center gap-1 bg-white/20 backdrop-blur-sm rounded-full px-3 py-1">
                          <i className="fas fa-users"></i>
                          <span>{(scenario.personas || []).length}명</span>
                        </div>
                        <div className="flex items-center gap-1 bg-white/20 backdrop-blur-sm rounded-full px-3 py-1">
                          <i className="fas fa-clock"></i>
                          <span>{scenario.estimatedTime}</span>
                        </div>
                      </div>
                    </div>

                    {/* 호버시 표시되는 상세 정보 */}
                    <div className="hidden group-hover:block bg-black/80 backdrop-blur-sm p-6 transition-all duration-700 ease-in-out">
                      <div className="text-white">
                        {/* 헤더 */}
                        <div className="flex items-center gap-3 mb-4">
                          <h3 className="text-lg font-semibold">{scenario.title}</h3>
                          <Badge variant="outline" className="bg-white/20 text-white border-white/30">
                            {recommendation.level}
                          </Badge>
                        </div>
                        
                        {/* 설명 */}
                        <p className="text-sm text-gray-200 mb-4 whitespace-pre-wrap">{scenario.description}</p>
                        
                        {/* 상황 정보 */}
                        <div className="space-y-3 mb-4">
                          <div>
                            <h4 className="font-medium text-white mb-1 flex items-center text-sm">
                              <i className="fas fa-exclamation-triangle mr-2 text-yellow-400"></i>
                              상황
                            </h4>
                            <p className="text-gray-300 text-xs leading-relaxed pl-5 whitespace-pre-wrap">
                              {scenario.context?.situation || '상황 정보 없음'}
                            </p>
                          </div>
                          
                          <div>
                            <h4 className="font-medium text-white mb-1 flex items-center text-sm">
                              <i className="fas fa-user-tie mr-2 text-blue-400"></i>
                              당신의 역할
                            </h4>
                            <p className="text-gray-300 text-xs pl-5">
                              {scenario.context?.playerRole?.position || '역할 정보 없음'} ({scenario.context?.playerRole?.experience || '경력 정보 없음'})
                            </p>
                          </div>

                          <div>
                            <h4 className="font-medium text-white mb-1 flex items-center text-sm">
                              <i className="fas fa-clock mr-2 text-purple-400"></i>
                              예상 소요 시간
                            </h4>
                            <p className="text-gray-300 text-xs pl-5">{scenario.estimatedTime}</p>
                          </div>
                        </div>

                        {/* 주요 역량 */}
                        <div>
                          <h4 className="font-medium text-white mb-2 flex items-center text-sm">
                            <i className="fas fa-lightbulb mr-2 text-green-400"></i>
                            주요 역량
                          </h4>
                          <div className="flex flex-wrap gap-1 pl-5">
                            {sortSkillsByImportance(scenario.skills || []).map((skill: string, index: number) => (
                              <Badge 
                                key={index} 
                                variant="secondary" 
                                className={`text-xs bg-white/20 text-white border-white/30 ${index < 2 ? 'bg-blue-500/30 border-blue-400/50' : ''}`}
                              >
                                {skill}
                              </Badge>
                            ))}
                          </div>
                        </div>
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
