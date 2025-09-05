import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ComplexScenario, ScenarioPersona, getDifficultyColor, getDifficultyLabel } from "@/lib/scenario-system";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface ScenarioSelectorProps {
  onScenarioSelect: (scenarioId: string, personaId: string, conversationId: string) => void;
  playerProfile?: {
    position: string;
    department: string;
    experience: string;
  };
}

export default function ScenarioSelector({ onScenarioSelect, playerProfile }: ScenarioSelectorProps) {
  const { toast } = useToast();
  const [selectedScenario, setSelectedScenario] = useState<ComplexScenario | null>(null);
  const [selectedPersona, setSelectedPersona] = useState<ScenarioPersona | null>(null);
  const [loadingScenarioId, setLoadingScenarioId] = useState<string | null>(null);

  // JSON 파일에서 실시간으로 시나리오와 페르소나 데이터 가져오기
  const { data: scenarios = [], isLoading: scenariosLoading } = useQuery({
    queryKey: ['/api/scenarios'],
    queryFn: () => fetch('/api/scenarios').then(res => res.json())
  });

  const { data: personas = [], isLoading: personasLoading } = useQuery({
    queryKey: ['/api/personas'],
    queryFn: () => fetch('/api/personas').then(res => res.json())
  });

  // 시나리오에 속한 페르소나들 가져오기 - 시나리오 정보와 MBTI 특성을 결합
  const getPersonasForScenario = (scenarioId: string): ScenarioPersona[] => {
    const scenario = scenarios.find((s: ComplexScenario) => s.id === scenarioId);
    if (!scenario) return [];
    
    // 시나리오의 personas 배열에서 각 페르소나 객체 정보와 MBTI 특성을 결합
    return scenario.personas.map((scenarioPersona: any) => {
      // 시나리오에서 직접 페르소나 객체를 가져오는 경우 (객체 형태)
      if (typeof scenarioPersona === 'object' && scenarioPersona.personaRef) {
        const mbtiPersona = personas.find((p: any) => p.id === scenarioPersona.personaRef.replace('.json', ''));
        
        if (mbtiPersona) {
          const combinedPersona = {
            ...mbtiPersona,
            // 시나리오의 구체적인 정보를 우선으로 사용
            id: scenarioPersona.id,
            name: scenarioPersona.name,
            role: scenarioPersona.position,
            department: scenarioPersona.department,
            experience: scenarioPersona.experience,
            image: mbtiPersona?.image?.profile || mbtiPersona?.image || `https://ui-avatars.com/api/?name=${encodeURIComponent(scenarioPersona.name)}&background=6366f1&color=fff&size=150`,
            motivation: mbtiPersona?.motivation || '목표 달성',
            // 시나리오 특화 정보 추가
            stance: scenarioPersona.stance,
            goal: scenarioPersona.goal,
            tradeoff: scenarioPersona.tradeoff
          };
          return combinedPersona;
        }
      }
      
      // MBTI ID만 있는 경우 (문자열 형태)
      const mbtiPersona = personas.find((p: any) => p.id === scenarioPersona);
      if (mbtiPersona) {
        // 기본값으로 MBTI 특성 활용
        return {
          ...mbtiPersona,
          id: scenarioPersona,
          name: `${mbtiPersona.mbti} 유형`,
          role: '팀 구성원',
          department: '관련 부서',
          experience: '경력자',
          image: mbtiPersona?.image?.profile || mbtiPersona?.image || `https://ui-avatars.com/api/?name=${encodeURIComponent(mbtiPersona.mbti)}&background=6366f1&color=fff&size=150`,
          motivation: mbtiPersona?.motivation || '목표 달성'
        };
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
      onScenarioSelect(scenarioId, personaId, conversation.id);
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
  };

  const handlePersonaSelect = (persona: ScenarioPersona) => {
    setSelectedPersona(persona);
  };

  const handleStartConversation = () => {
    if (selectedScenario && selectedPersona && !loadingScenarioId) {
      createConversationMutation.mutate({
        scenarioId: selectedScenario.id,
        personaId: selectedPersona.id
      });
    }
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
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-slate-900 mb-4">
            🎭 시나리오 기반 롤플레이 훈련
          </h1>
          <p className="text-lg text-slate-600">
            복잡한 업무 상황에서 다양한 이해관계자와의 협상 및 문제 해결 능력을 기르세요
          </p>
        </div>

        <div className="max-w-4xl mx-auto">
          
          <div className="space-y-4">
            {scenarios.map((scenario: ComplexScenario) => {
              const recommendation = getRecommendationLevel(scenario);
              const isSelected = selectedScenario?.id === scenario.id;
              const scenarioPersonas = getPersonasForScenario(scenario.id);
              
              return (
                <Card key={scenario.id} className="overflow-hidden">
                  {/* 시나리오 헤더 */}
                  <div
                    className={`cursor-pointer transition-all duration-300 ${
                      isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'
                    }`}
                    onClick={() => handleScenarioClick(scenario)}
                    data-testid={`scenario-card-${scenario.id}`}
                  >
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <CardTitle className="text-lg font-semibold text-slate-900">
                              {scenario.title}
                            </CardTitle>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className={`bg-${getDifficultyColor(scenario.difficulty)}-100 text-${getDifficultyColor(scenario.difficulty)}-800`}>
                                {getDifficultyLabel(scenario.difficulty)} (★{scenario.difficulty})
                              </Badge>
                              <Badge variant="outline" className={`bg-${recommendation.color}-100 text-${recommendation.color}-800`}>
                                {recommendation.level}
                              </Badge>
                            </div>
                          </div>
                          <p className="text-sm text-slate-600 mb-3">{scenario.description}</p>
                          
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                            <div>
                              <h4 className="font-medium text-slate-700 mb-1">상황</h4>
                              <p className="text-slate-600">{scenario.context.situation}</p>
                            </div>
                            <div>
                              <h4 className="font-medium text-slate-700 mb-1">당신의 역할</h4>
                              <p className="text-slate-600">
                                {scenario.context.playerRole.position} ({scenario.context.playerRole.experience})
                              </p>
                            </div>
                          </div>

                          <div className="mt-4">
                            <h4 className="font-medium text-slate-700 mb-2">주요 역량</h4>
                            <div className="flex flex-wrap gap-2">
                              {scenario.skills.map((skill: string, index: number) => (
                                <Badge key={index} variant="secondary" className="text-xs">
                                  {skill}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>
                        
                        <div className="text-right flex flex-col items-end">
                          <div className="text-xs text-slate-500 mb-2">{scenario.personas.length}명의 대화 상대</div>
                          <div className="text-xs text-slate-500 mb-2">{scenario.estimatedTime}</div>
                          <div className={`transition-transform duration-300 ${isSelected ? 'rotate-180' : ''}`}>
                            <i className="fas fa-chevron-down text-slate-400"></i>
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                  </div>

                  {/* 펼쳐지는 페르소나 목록 */}
                  {isSelected && (
                    <CardContent className="border-t border-slate-200 bg-slate-50">
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
                                  <div className="mt-3 p-4 bg-green-50 border border-green-200 rounded-lg">
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
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
