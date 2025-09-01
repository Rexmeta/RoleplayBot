import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { scenarios, getSkillColor, type Scenario } from "@/lib/scenarios";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface ScenarioSelectorProps {
  onScenarioSelect: (scenario: Scenario, conversationId: string) => void;
}

export default function ScenarioSelector({ onScenarioSelect }: ScenarioSelectorProps) {
  const { toast } = useToast();
  const [loadingScenarioId, setLoadingScenarioId] = useState<string | null>(null);

  const createConversationMutation = useMutation({
    mutationFn: async (scenario: Scenario) => {
      setLoadingScenarioId(scenario.id);
      const response = await apiRequest("POST", "/api/conversations", {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        messages: [],
        turnCount: 0,
        status: "active"
      });
      return response.json();
    },
    onSuccess: (conversation, scenario) => {
      setLoadingScenarioId(null);
      onScenarioSelect(scenario, conversation.id);
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

  const handleScenarioClick = (scenario: Scenario) => {
    if (loadingScenarioId) return; // 이미 로딩 중이면 무시
    createConversationMutation.mutate(scenario);
  };

  return (
    <div className="scenario-selector">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold text-slate-900 mb-4">훈련 시나리오 선택</h2>
        <p className="text-lg text-slate-600 max-w-2xl mx-auto">
          다양한 상황의 페르소나와 대화하며 커뮤니케이션 역량을 개발하세요. 
          각 시나리오는 10턴의 대화로 구성되며, 완료 후 상세한 피드백을 제공합니다.
        </p>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {scenarios.map((scenario) => {
          const isLoading = loadingScenarioId === scenario.id;
          return (
          <div
            key={scenario.id}
            className={`scenario-card card-enhanced rounded-xl p-6 transition-all duration-200 ${
              isLoading 
                ? 'cursor-wait bg-blue-50 border-blue-200 border-2 shadow-lg scale-105' 
                : loadingScenarioId 
                  ? 'cursor-not-allowed opacity-50'
                  : 'cursor-pointer hover:shadow-lg hover:scale-105'
            }`}
            onClick={() => handleScenarioClick(scenario)}
            data-testid={`scenario-card-${scenario.id}`}
          >
            <div className="flex items-start space-x-4">
              <div className="relative">
                <img 
                  src={scenario.image} 
                  alt={`${scenario.name} 프로필`} 
                  className={`w-16 h-16 rounded-full object-cover transition-all duration-200 ${
                    isLoading ? 'opacity-50' : ''
                  }`}
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(scenario.name)}&background=6366f1&color=fff&size=64`;
                  }}
                />
                {isLoading && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                  </div>
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center space-x-2">
                  <h3 className={`text-lg font-semibold transition-colors duration-200 ${
                    isLoading ? 'text-blue-600' : 'text-slate-900'
                  }`}>{scenario.name}</h3>
                  {isLoading && (
                    <span className="text-sm text-blue-600 font-medium animate-pulse">
                      대화 준비 중...
                    </span>
                  )}
                </div>
                <p className="text-sm text-corporate-600 font-medium mb-2">{scenario.role}</p>
                <p className="text-sm text-slate-600 mb-3">{scenario.description}</p>
                <div className="flex items-center space-x-2">
                  {scenario.skills.map((skill) => (
                    <span
                      key={skill}
                      className={`inline-block px-2 py-1 bg-${getSkillColor(skill)}-100 text-${getSkillColor(skill)}-800 text-xs font-medium rounded`}
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-100">
              <div className="flex items-center justify-between text-sm text-slate-500">
                <span><i className="fas fa-clock mr-1"></i>{scenario.estimatedTime}</span>
                <span><i className="fas fa-comments mr-1"></i>10턴 대화</span>
                <span><i className="fas fa-star mr-1"></i>난이도 {scenario.difficultyStars}</span>
              </div>
            </div>
          </div>
          );
        })}
      </div>

      <div className="text-center">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 max-w-2xl mx-auto">
          <div className="flex items-center justify-center space-x-2 text-blue-800">
            <i className="fas fa-lightbulb"></i>
            <p className="text-sm font-medium">
              <strong>Tip:</strong> 시나리오별로 다른 커뮤니케이션 스킬을 연습할 수 있습니다. 
              난이도가 낮은 시나리오부터 시작해보세요!
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
