import { useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ComplexScenario, ScenarioPersona, getDifficultyColor, getDifficultyLabel } from "@/lib/scenario-system";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Search, Filter, ChevronDown, ChevronUp } from "lucide-react";

interface ScenarioSelectorProps {
  onScenarioSelect: (scenario: ComplexScenario, persona: ScenarioPersona, conversationId: string) => void;
  playerProfile?: {
    position: string;
    department: string;
    experience: string;
  };
}

export default function ScenarioSelector({ onScenarioSelect, playerProfile }: ScenarioSelectorProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedScenario, setSelectedScenario] = useState<ComplexScenario | null>(null);
  const [selectedPersona, setSelectedPersona] = useState<ScenarioPersona | null>(null);
  const [loadingScenarioId, setLoadingScenarioId] = useState<string | null>(null);
  
  // 스크롤 ref
  const personasRef = useRef<HTMLDivElement>(null);
  const startButtonRef = useRef<HTMLDivElement>(null);
  
  // 필터 상태
  const [filters, setFilters] = useState({
    difficulty: '',
    personaCount: '',
    searchText: '',
    department: '',
    skillType: ''
  });
  
  // 상세 검색 표시 여부
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // JSON 파일에서 실시간으로 시나리오와 페르소나 데이터 가져오기
  const { data: scenarios = [], isLoading: scenariosLoading } = useQuery({
    queryKey: ['/api/scenarios'],
    queryFn: () => fetch('/api/scenarios').then(res => res.json())
  });

  // MBTI 기본 특성을 시나리오 내에서 직접 처리 (외부 API 호출 없이)
  const personasLoading = false; // 로딩 상태 제거

  // 시나리오에 속한 페르소나들 가져오기 - 시나리오 정보와 MBTI 특성을 결합
  const getPersonasForScenario = (scenarioId: string): ScenarioPersona[] => {
    const scenario = scenarios.find((s: ComplexScenario) => s.id === scenarioId);
    if (!scenario) return [];
    
    // 시나리오의 personas 배열에서 각 페르소나 객체 정보와 MBTI 특성을 결합
    return (scenario.personas || []).map((scenarioPersona: any) => {
      // 시나리오에서 직접 페르소나 객체를 가져오는 경우 (객체 형태)
      if (typeof scenarioPersona === 'object' && scenarioPersona.name) {
        // 시나리오에 정의된 정확한 페르소나 정보를 사용 (MBTI API 의존성 제거)
        const combinedPersona = {
          // 시나리오의 구체적인 정보를 직접 사용 (핵심 수정!)
          id: scenarioPersona.id,
          name: scenarioPersona.name, // 시나리오에서 정의된 정확한 이름 사용!
          role: scenarioPersona.position,
          department: scenarioPersona.department,
          experience: scenarioPersona.experience,
          gender: scenarioPersona.gender,
          image: `https://ui-avatars.com/api/?name=${encodeURIComponent(scenarioPersona.name)}&background=6366f1&color=fff&size=150`,
          motivation: scenarioPersona.goal || '목표 달성',
          // 시나리오 특화 정보 추가
          stance: scenarioPersona.stance,
          goal: scenarioPersona.goal,
          tradeoff: scenarioPersona.tradeoff,
          // 시나리오 연결 정보 추가 (디버깅용)
          scenarioId: scenarioId,
          mbti: scenarioPersona.personaRef?.replace('.json', '').toUpperCase() || 'UNKNOWN'
        };
        return combinedPersona;
      }
      
      return null;
    }).filter(Boolean);
  };

  const createConversationMutation = useMutation({
    mutationFn: async ({ scenarioId, personaId }: { scenarioId: string; personaId: string }) => {
      setLoadingScenarioId(scenarioId);
      const response = await apiRequest("POST", "/api/conversations", {
        scenarioId: scenarioId,
        personaId: personaId,
        scenarioName: selectedScenario?.title || "",
        messages: [],
        turnCount: 0,
        status: "active"
      });
      return response.json();
    },
    onSuccess: (conversation, { scenarioId, personaId }) => {
      setLoadingScenarioId(null);
      // ⚡ 최적화: 객체 직접 전달 (추가 조회 불필요)
      if (selectedScenario && selectedPersona) {
        onScenarioSelect(selectedScenario, selectedPersona, conversation.id);
      }
    },
    onError: () => {
      setLoadingScenarioId(null);
      toast({
        title: "오류",
        description: "대화를 시작할 수 없습니다. 다시 시도해주세요.",
        variant: "destructive"
      });
    }
  });

  const handleScenarioClick = (scenario: ComplexScenario) => {
    setSelectedScenario(scenario);
    setSelectedPersona(null);
    
    // 대화상대 리스트로 스크롤
    setTimeout(() => {
      personasRef.current?.scrollIntoView({ 
        behavior: 'smooth',
        block: 'center' 
      });
    }, 100);
  };

  const handlePersonaSelect = (persona: ScenarioPersona) => {
    // ✅ 성능 최적화 완료: 시나리오별 개별 페르소나 처리
    
    // ⚡ 최적화: 불필요한 전역 페르소나 캐시 클리어 제거
    
    setSelectedPersona(persona);
    
    // 대화하기 버튼으로 스크롤
    setTimeout(() => {
      startButtonRef.current?.scrollIntoView({ 
        behavior: 'smooth',
        block: 'center' 
      });
    }, 100);
  };

  const handleStartConversation = () => {
    if (selectedScenario && selectedPersona && !loadingScenarioId) {
      createConversationMutation.mutate({
        scenarioId: selectedScenario.id,
        personaId: selectedPersona.id
      });
    }
  };

  // 필터링된 시나리오 목록
  const filteredScenarios = scenarios.filter((scenario: ComplexScenario) => {
    // 검색어 필터
    if (filters.searchText && !scenario.title.toLowerCase().includes(filters.searchText.toLowerCase()) && 
        !scenario.description.toLowerCase().includes(filters.searchText.toLowerCase())) {
      return false;
    }
    
    // 난이도 필터
    if (filters.difficulty && filters.difficulty !== 'all' && scenario.difficulty.toString() !== filters.difficulty) {
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
      skillType: ''
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
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
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3 border-t border-slate-200">
                {/* 난이도 */}
                <Select value={filters.difficulty || undefined} onValueChange={(value) => setFilters(prev => ({ ...prev, difficulty: value }))}>
                  <SelectTrigger data-testid="filter-difficulty" className="h-9 text-sm">
                    <SelectValue placeholder="난이도" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">전체</SelectItem>
                    <SelectItem value="1">★ 초급</SelectItem>
                    <SelectItem value="2">★★ 기초</SelectItem>
                    <SelectItem value="3">★★★ 중급</SelectItem>
                    <SelectItem value="4">★★★★ 고급</SelectItem>
                    <SelectItem value="5">★★★★★ 전문가</SelectItem>
                  </SelectContent>
                </Select>
                
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
            {(filters.searchText || filters.difficulty || filters.personaCount || filters.department || filters.skillType) && (
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
              const isSelected = selectedScenario?.id === scenario.id;
              const scenarioPersonas = getPersonasForScenario(scenario.id);
              
              return (
                <Card key={scenario.id} className="overflow-hidden group">
                  {/* 시나리오 카드 - 이미지 배경 버전 */}
                  <div
                    className={`relative cursor-pointer transition-all duration-500 h-48 ${
                      isSelected ? 'ring-2 ring-blue-500' : ''
                    }`}
                    onClick={() => handleScenarioClick(scenario)}
                    data-testid={`scenario-card-${scenario.id}`}
                    style={{
                      backgroundImage: `linear-gradient(45deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.3) 100%), url(${scenario.image || 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=800&h=400&fit=crop&auto=format'})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      backgroundRepeat: 'no-repeat'
                    }}
                  >
                    {/* 기본 표시 정보 (항상 보이는 내용) */}
                    <div className="absolute inset-0 flex flex-col justify-center items-center text-white text-center p-6 group-hover:opacity-0 transition-opacity duration-500">
                      <h2 className="text-2xl font-bold mb-4 drop-shadow-lg">{scenario.title}</h2>
                      <div className="flex items-center gap-4 text-sm">
                        <div className="flex items-center gap-1 bg-white/20 backdrop-blur-sm rounded-full px-3 py-1">
                          <i className="fas fa-star text-yellow-400"></i>
                          <span>난이도 {scenario.difficulty}</span>
                        </div>
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
                    <div className="absolute inset-0 bg-black/80 backdrop-blur-sm p-6 opacity-0 group-hover:opacity-100 transition-all duration-500 overflow-y-auto">
                      <div className="text-white h-full flex flex-col">
                        <div className="flex items-center gap-3 mb-3">
                          <h3 className="text-lg font-semibold">{scenario.title}</h3>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="bg-white/20 text-white border-white/30">
                              {getDifficultyLabel(scenario.difficulty)} (★{scenario.difficulty})
                            </Badge>
                            <Badge variant="outline" className="bg-white/20 text-white border-white/30">
                              {recommendation.level}
                            </Badge>
                          </div>
                          <div className={`ml-auto transition-transform duration-300 ${isSelected ? 'rotate-180' : ''}`}>
                            <i className="fas fa-chevron-down text-white"></i>
                          </div>
                        </div>
                        
                        <p className="text-sm text-gray-200 mb-4 flex-shrink-0">{scenario.description}</p>
                        
                        <div className="grid grid-cols-1 gap-3 text-sm mb-4 flex-shrink-0">
                          <div>
                            <h4 className="font-medium text-white mb-1 flex items-center">
                              <i className="fas fa-exclamation-triangle mr-2 text-yellow-400"></i>
                              상황
                            </h4>
                            <p className="text-gray-300 text-xs leading-relaxed">{scenario.context?.situation || '상황 정보 없음'}</p>
                          </div>
                          <div>
                            <h4 className="font-medium text-white mb-1 flex items-center">
                              <i className="fas fa-user-tie mr-2 text-blue-400"></i>
                              당신의 역할
                            </h4>
                            <p className="text-gray-300 text-xs">
                              {scenario.context?.playerRole?.position || '역할 정보 없음'} ({scenario.context?.playerRole?.experience || '경력 정보 없음'})
                            </p>
                          </div>
                        </div>

                        <div className="mt-auto">
                          <h4 className="font-medium text-white mb-2 flex items-center">
                            <i className="fas fa-lightbulb mr-2 text-green-400"></i>
                            주요 역량
                          </h4>
                          <div className="flex flex-wrap gap-1">
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

                  {/* 펼쳐지는 페르소나 목록 */}
                  {isSelected && (
                    <CardContent className="border-t border-slate-200 bg-slate-50" ref={personasRef}>
                      <div className="py-4">
                        <h3 className="text-lg font-medium text-slate-800 mb-4 flex items-center">
                          <i className="fas fa-users text-blue-600 mr-2"></i>
                          대화 상대 선택 ({scenarioPersonas.length}명)
                        </h3>
                        
                        <div className="space-y-3">
                          {scenarioPersonas.map((persona, index) => {
                            const isPersonaSelected = selectedPersona?.id === persona.id;
                            const isLoading = loadingScenarioId === scenario.id && isPersonaSelected;
                            
                            return (
                              <div key={persona.id}>
                                <Card 
                                  className={`cursor-pointer transition-all duration-300 ${
                                    isPersonaSelected ? 'ring-2 ring-green-500 bg-green-50' : 'bg-white hover:shadow-md hover:bg-slate-50'
                                  } ${isLoading ? 'cursor-wait' : ''}`}
                                  onClick={() => !isLoading && handlePersonaSelect(persona)}
                                  data-testid={`persona-card-${persona.id}`}
                                >
                                  <CardContent className="p-4">
                                    <div className="flex items-center space-x-4">
                                      <div className="relative">
                                        <img 
                                          src={persona.image} 
                                          alt={persona.name}
                                          className={`w-12 h-12 rounded-full ${isLoading ? 'opacity-50' : ''}`}
                                          onError={(e) => {
                                            (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(persona.name)}&background=6366f1&color=fff&size=48`;
                                          }}
                                        />
                                        {isLoading && (
                                          <div className="absolute inset-0 flex items-center justify-center">
                                            <Loader2 className="w-4 h-4 text-green-500 animate-spin" />
                                          </div>
                                        )}
                                      </div>
                                      <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                          <h4 className="font-medium text-slate-900">{persona.name}</h4>
                                          <Badge variant="outline" className="text-xs">
                                            {persona.department}
                                          </Badge>
                                          {isPersonaSelected && (
                                            <Badge className="bg-green-100 text-green-800 text-xs">선택됨</Badge>
                                          )}
                                        </div>
                                        <p className="text-sm text-slate-600">{persona.role} • {persona.experience}</p>
                                        <p className="text-xs text-slate-500 mt-1">{(persona as any).motivation || '목표 설정'}</p>
                                      </div>
                                      <div className="text-right">
                                        <div className="text-xs text-slate-500">#{index + 1}</div>
                                      </div>
                                    </div>
                                  </CardContent>
                                </Card>
                                
                                {/* 선택된 페르소나의 대화 시작 버튼 */}
                                {isPersonaSelected && (
                                  <div ref={startButtonRef} className="mt-3 p-4 bg-green-50 border border-green-200 rounded-lg">
                                    <Button 
                                      onClick={handleStartConversation}
                                      disabled={loadingScenarioId !== null}
                                      className="w-full bg-green-600 hover:bg-green-700 text-white py-3 text-lg font-medium"
                                      data-testid="start-conversation-button"
                                    >
                                      {loadingScenarioId ? (
                                        <>
                                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                          대화 준비 중...
                                        </>
                                      ) : (
                                        <>🚀 {persona.name}과 대화 시작하기</>
                                      )}
                                    </Button>
                                    
                                    <p className="text-center text-sm text-slate-500 mt-2">
                                      {persona.name}과 1:1 대화를 통해 문제를 해결해보세요
                                    </p>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </CardContent>
                  )}
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
