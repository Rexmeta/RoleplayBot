import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ComplexScenario, ScenarioPersona, complexScenarios, getPersonasForScenario, getDifficultyColor, getDifficultyLabel } from "@/lib/scenario-system";
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

  const createConversationMutation = useMutation({
    mutationFn: async ({ scenarioId, personaId }: { scenarioId: string; personaId: string }) => {
      setLoadingScenarioId(scenarioId);
      const response = await apiRequest("POST", "/api/conversations", {
        scenarioId: scenarioId,
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
          {playerProfile && (
            <div className="mt-4 p-4 bg-blue-100 rounded-lg inline-block">
              <p className="text-blue-800">
                <strong>{playerProfile.position}</strong> • {playerProfile.department} • {playerProfile.experience}
              </p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* 시나리오 리스트 */}
          <div className="space-y-6">
            <h2 className="text-2xl font-semibold text-slate-800 mb-4">시나리오 선택</h2>
            
            {complexScenarios.map((scenario) => {
              const recommendation = getRecommendationLevel(scenario);
              const isSelected = selectedScenario?.id === scenario.id;
              
              return (
                <Card 
                  key={scenario.id}
                  className={`cursor-pointer transition-all duration-300 hover:shadow-lg ${
                    isSelected ? 'ring-2 ring-blue-500 bg-blue-50' : 'hover:bg-slate-50'
                  }`}
                  onClick={() => handleScenarioClick(scenario)}
                  data-testid={`scenario-card-${scenario.id}`}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-lg mb-2">{scenario.title}</CardTitle>
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="outline" className={`bg-${getDifficultyColor(scenario.difficulty)}-100 text-${getDifficultyColor(scenario.difficulty)}-800`}>
                            {getDifficultyLabel(scenario.difficulty)} (★{scenario.difficulty})
                          </Badge>
                          <Badge variant="outline" className={`bg-${recommendation.color}-100 text-${recommendation.color}-800`}>
                            {recommendation.level}
                          </Badge>
                          <span className="text-sm text-slate-500">{scenario.estimatedTime}</span>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-slate-600 mb-4">{scenario.description}</p>
                    
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
                        {scenario.skills.map((skill, index) => (
                          <Badge key={index} variant="secondary" className="text-xs">
                            {skill}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* 페르소나 선택 및 상세 정보 */}
          <div className="space-y-6">
            {selectedScenario ? (
              <>
                <div>
                  <h2 className="text-2xl font-semibold text-slate-800 mb-4">대화 상대 선택</h2>
                  
                  <div className="space-y-4 mb-6">
                    {getPersonasForScenario(selectedScenario.id).map((persona, index) => {
                      const isSelected = selectedPersona?.id === persona.id;
                      const isLoading = loadingScenarioId === selectedScenario.id && isSelected;
                      
                      return (
                        <Card 
                          key={persona.id} 
                          className={`cursor-pointer transition-all duration-300 ${
                            isSelected ? 'ring-2 ring-green-500 bg-green-50' : 'hover:shadow-md hover:bg-slate-50'
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
                                  {isSelected && (
                                    <Badge className="bg-green-100 text-green-800 text-xs">선택됨</Badge>
                                  )}
                                </div>
                                <p className="text-sm text-slate-600">{persona.role} • {persona.experience}</p>
                                <p className="text-xs text-slate-500 mt-1">{persona.personality.motivation}</p>
                              </div>
                              <div className="text-right">
                                <div className="text-xs text-slate-500">#{index + 1}</div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>

                  {selectedPersona && (
                    <div className="pt-6">
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
                          <>🚀 {selectedPersona.name}과 대화 시작하기</>
                        )}
                      </Button>
                      
                      <p className="text-center text-sm text-slate-500 mt-2">
                        {selectedPersona.name}과 1:1 대화를 통해 문제를 해결해보세요
                      </p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">🎯</div>
                <h3 className="text-xl font-medium text-slate-600 mb-2">시나리오를 선택하세요</h3>
                <p className="text-slate-500">
                  왼쪽에서 원하는 시나리오를 클릭하면<br />
                  대화할 수 있는 페르소나들을 확인할 수 있습니다
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
