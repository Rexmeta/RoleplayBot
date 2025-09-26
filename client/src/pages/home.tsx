import { useState } from "react";
import { Link } from "wouter";
import ScenarioSelector from "@/components/ScenarioSelector";
import ChatWindow from "@/components/ChatWindow";
import PersonalDevelopmentReport from "@/components/PersonalDevelopmentReport";
import { StrategicPersonaSelector } from "@/components/StrategicPersonaSelector";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { type ComplexScenario, type ScenarioPersona, getComplexScenarioById, scenarioPersonas } from "@/lib/scenario-system";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type ViewState = "scenarios" | "strategic-planning" | "chat" | "feedback";

export default function Home() {
  const [currentView, setCurrentView] = useState<ViewState>("scenarios");
  const [selectedScenario, setSelectedScenario] = useState<ComplexScenario | null>(null);
  const [selectedPersona, setSelectedPersona] = useState<ScenarioPersona | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [strategicConversationId, setStrategicConversationId] = useState<string | null>(null);
  const [completedConversations, setCompletedConversations] = useState<string[]>([]);
  const [currentPhase, setCurrentPhase] = useState(1);
  const [totalPhases, setTotalPhases] = useState(1);

  // 동적으로 시나리오와 페르소나 데이터 로드
  const { data: scenarios = [] } = useQuery({
    queryKey: ['/api/scenarios'],
    queryFn: () => fetch('/api/scenarios').then(res => res.json())
  });

  // ⚡ 최적화: 불필요한 전체 페르소나 조회 제거 (성능 개선)
  // ScenarioSelector에서 시나리오별 페르소나를 직접 전달받음

  // 사용자 프로필 (실제로는 인증 시스템에서 가져올 것)
  const playerProfile = {
    position: "신입 개발자",
    department: "개발팀",
    experience: "6개월차"
  };

  // 시나리오 선택 처리 - 페르소나 수에 따라 분기
  const handleScenarioSelect = (scenario: ComplexScenario, persona?: ScenarioPersona, convId?: string) => {
    setSelectedScenario(scenario);
    
    // 페르소나가 2명 이상이면 전략적 계획 단계로
    if (scenario.personas && scenario.personas.length >= 2) {
      setTotalPhases(scenario.personas.length);
      setCurrentPhase(1);
      setCompletedConversations([]);
      setCurrentView("strategic-planning");
    } else {
      // 단일 페르소나면 기존 방식대로
      setSelectedPersona(persona || null);
      setConversationId(convId || null);
      setCurrentView("chat");
    }
  };
  
  // 전략적 페르소나 선택 완료 처리
  const handleStrategicPersonaSelect = async (personaId: string, scenario: ComplexScenario) => {
    try {
      const response = await apiRequest("POST", "/api/conversations", {
        scenarioId: scenario.id,
        personaId: personaId,
        scenarioName: scenario.title,
        messages: [],
        turnCount: 0,
        status: "active",
        conversationType: "sequential",
        currentPhase: currentPhase,
        totalPhases: totalPhases
      });
      
      const conversation = await response.json();
      
      // PersonaSelection 데이터 저장
      try {
        await apiRequest("POST", `/api/conversations/${conversation.id}/persona-selections`, {
          phase: currentPhase,
          personaId: personaId,
          selectionReason: `${currentPhase}단계 대화 상대로 선택`,
          expectedOutcome: "효과적인 대화를 통한 목표 달성"
        });
      } catch (error) {
        console.error("페르소나 선택 데이터 저장 실패:", error);
      }
      
      // 첫 번째 전략적 대화라면 strategic conversation ID 저장
      if (!strategicConversationId) {
        setStrategicConversationId(conversation.id);
      }
      
      // 시나리오 데이터에서 실제 페르소나 객체 찾기
      const selectedPersona = Object.values(scenarioPersonas).find(p => p.id === personaId) || null;
      setSelectedPersona(selectedPersona);
      setConversationId(conversation.id);
      setCurrentView("chat");
    } catch (error) {
      console.error("전략적 대화 생성 실패:", error);
    }
  };
  
  // 페르소나 변경 핸들러 (대화 완료 후)
  const handlePersonaChange = () => {
    if (selectedScenario && selectedScenario.personas && selectedScenario.personas.length >= 2) {
      setCurrentView("strategic-planning");
    }
  };

  const handleChatComplete = () => {
    if (strategicConversationId && currentPhase < totalPhases) {
      // 전략적 대화 중이고 아직 남은 단계가 있으면
      if (conversationId) {
        setCompletedConversations(prev => [...prev, conversationId]);
      }
      setCurrentPhase(prev => prev + 1);
      setCurrentView("strategic-planning");
    } else {
      // 모든 대화가 완료되었거나 단일 대화면 피드백으로
      setCurrentView("feedback");
    }
  };

  const handleReturnToScenarios = () => {
    setCurrentView("scenarios");
    setSelectedScenario(null);
    setSelectedPersona(null);
    setConversationId(null);
    setStrategicConversationId(null);
    setCompletedConversations([]);
    setCurrentPhase(1);
    setTotalPhases(1);
  };

  // 재도전을 위한 새로운 대화 생성
  const createRetryConversationMutation = useMutation({
    mutationFn: async ({ scenarioId, personaId, scenarioName }: { 
      scenarioId: string; 
      personaId: string; 
      scenarioName: string; 
    }) => {
      const response = await apiRequest("POST", "/api/conversations", {
        scenarioId,
        personaId,
        scenarioName,
        messages: [],
        turnCount: 0,
        status: "active"
      });
      return response.json();
    },
    onSuccess: (conversation) => {
      setConversationId(conversation.id);
      setCurrentView("chat");
    },
    onError: (error) => {
      console.error("재도전 대화 생성 실패:", error);
    }
  });

  const handleRetry = () => {
    if (selectedScenario && selectedPersona) {
      createRetryConversationMutation.mutate({
        scenarioId: selectedScenario.id,
        personaId: selectedPersona.id,
        scenarioName: selectedScenario.title
      });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <Link href="/home" className="flex items-center space-x-3 hover:opacity-80 transition-opacity" data-testid="home-link">
              <div className="w-10 h-10 bg-corporate-600 rounded-lg flex items-center justify-center">
                <i className="fas fa-robot text-white text-lg"></i>
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">🎭 Roleplay X</h1>
                <p className="text-sm text-slate-600">커뮤니케이션 역량 개발</p>
              </div>
            </Link>
            <div className="flex items-center space-x-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <a 
                      href="/admin" 
                      className="hidden md:flex items-center justify-center w-10 h-10 text-corporate-600 hover:text-corporate-700 hover:bg-corporate-50 rounded-lg transition-colors"
                      data-testid="admin-dashboard-link"
                    >
                      <i className="fas fa-chart-bar text-lg"></i>
                    </a>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>관리자 대시보드</p>
                  </TooltipContent>
                </Tooltip>
                
                <Tooltip>
                  <TooltipTrigger asChild>
                    <a 
                      href="/admin-management" 
                      className="hidden md:flex items-center justify-center w-10 h-10 text-corporate-600 hover:text-corporate-700 hover:bg-corporate-50 rounded-lg transition-colors"
                      data-testid="content-management-link"
                    >
                      <i className="fas fa-cogs text-lg"></i>
                    </a>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>콘텐츠 관리</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              
              <button className="text-slate-400 hover:text-slate-600 w-10 h-10 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors">
                <i className="fas fa-cog text-lg"></i>
              </button>
            </div>
          </div>
        </div>
      </header>
      {/* Main Content */}
      <main className={`${currentView === "scenarios" ? "py-8 bg-slate-50" : "max-w-6xl mx-auto px-4 py-8"}`}>
        {currentView === "scenarios" && (
          <div className="max-w-6xl mx-auto px-4">
            <ScenarioSelector 
              onScenarioSelect={handleScenarioSelect}
              playerProfile={playerProfile}
            />
          </div>
        )}
        
        {currentView === "strategic-planning" && selectedScenario && (
          <StrategicPersonaSelector
            personas={(() => {
              // 시나리오에서 받은 personas를 ScenarioPersona 타입에 맞게 변환
              const scenarioPersonasArray = (selectedScenario.personas || []).map((p: any) => ({
                id: p.id,
                name: p.name,
                role: p.position || p.role,
                department: p.department,
                experience: p.experience,
                personality: {
                  traits: [],
                  communicationStyle: p.stance || '',
                  motivation: p.goal || '',
                  fears: []
                },
                background: {
                  education: '',
                  previousExperience: p.experience || '',
                  majorProjects: [],
                  expertise: []
                },
                currentSituation: {
                  workload: '',
                  pressure: '',
                  concerns: [],
                  position: p.stance || ''
                },
                communicationPatterns: {
                  openingStyle: '',
                  keyPhrases: [],
                  responseToArguments: {},
                  winConditions: []
                },
                image: `https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=6366f1&color=fff&size=150`,
                voice: {
                  tone: '',
                  pace: '',
                  emotion: ''
                },
                stance: p.stance,
                goal: p.goal,
                tradeoff: p.tradeoff,
                mbti: p.id?.toUpperCase()
              }));
              return scenarioPersonasArray;
            })()}
            personaStatuses={selectedScenario.personas?.map((p: any) => ({
              personaId: p.id,
              name: p.name,
              currentMood: 'neutral' as const,
              approachability: 3,
              influence: p.influence || 3,
              hasBeenContacted: completedConversations.includes(p.id),
              lastInteractionResult: undefined,
              availableInfo: [`${p.name}에 대한 정보`],
              keyRelationships: []
            })) || []}
            currentPhase={currentPhase}
            totalPhases={totalPhases}
            onPersonaSelect={async (selection) => {
              await handleStrategicPersonaSelect(selection.personaId, selectedScenario);
            }}
            onPhaseComplete={() => {
              setCurrentView("feedback");
            }}
            previousSelections={[]}
            scenarioContext={selectedScenario}
          />
        )}
        
        {currentView === "chat" && selectedScenario && selectedPersona && conversationId && (
          <ChatWindow
            scenario={selectedScenario}
            persona={selectedPersona}
            conversationId={conversationId}
            onChatComplete={handleChatComplete}
            onExit={handleReturnToScenarios}
            onPersonaChange={strategicConversationId ? handlePersonaChange : undefined}
          />
        )}
        
        {currentView === "feedback" && selectedScenario && selectedPersona && conversationId && (
          <PersonalDevelopmentReport
            scenario={selectedScenario}
            persona={selectedPersona}
            conversationId={conversationId}
            onRetry={handleRetry}
            onSelectNewScenario={handleReturnToScenarios}
          />
        )}
      </main>
      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-8 mt-16">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between">
            <div className="text-sm text-slate-600 mb-4 md:mb-0">
              © AI 롤플레잉 훈련 시스템
            </div>
            <div className="flex items-center space-x-6 text-sm text-slate-600">
              <a href="#" className="hover:text-corporate-600">도움말</a>
              <a href="#" className="hover:text-corporate-600">문의하기</a>
              <a href="#" className="hover:text-corporate-600">개인정보처리방침</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
