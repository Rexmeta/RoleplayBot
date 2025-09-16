import { useState } from "react";
import { Link } from "wouter";
import ScenarioSelector from "@/components/ScenarioSelector";
import ChatWindow from "@/components/ChatWindow";
import PersonalDevelopmentReport from "@/components/PersonalDevelopmentReport";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { type ComplexScenario, type ScenarioPersona } from "@/lib/scenario-system";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type ViewState = "scenarios" | "chat" | "feedback";

export default function Home() {
  const [currentView, setCurrentView] = useState<ViewState>("scenarios");
  const [selectedScenario, setSelectedScenario] = useState<ComplexScenario | null>(null);
  const [selectedPersona, setSelectedPersona] = useState<ScenarioPersona | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);

  // 동적으로 시나리오와 페르소나 데이터 로드
  const { data: scenarios = [] } = useQuery({
    queryKey: ['/api/scenarios'],
    queryFn: () => fetch('/api/scenarios').then(res => res.json())
  });

  const { data: personas = [] } = useQuery({
    queryKey: ['/api/personas'],
    queryFn: () => fetch('/api/personas').then(res => res.json())
  });

  // 사용자 프로필 (실제로는 인증 시스템에서 가져올 것)
  const playerProfile = {
    position: "신입 개발자",
    department: "개발팀",
    experience: "6개월차"
  };

  const handleScenarioSelect = (scenarioId: string, personaId: string, convId: string) => {
    const scenario = scenarios.find((s: ComplexScenario) => s.id === scenarioId);
    const persona = personas.find((p: ScenarioPersona) => p.id === personaId);
    
    if (scenario && persona) {
      setSelectedScenario(scenario);
      setSelectedPersona(persona);
      setConversationId(convId);
      setCurrentView("chat");
    }
  };

  const handleChatComplete = () => {
    setCurrentView("feedback");
  };

  const handleReturnToScenarios = () => {
    setCurrentView("scenarios");
    setSelectedScenario(null);
    setSelectedPersona(null);
    setConversationId(null);
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
                <h1 className="text-xl font-bold text-slate-900">AI 롤플레잉 훈련</h1>
                <p className="text-sm text-slate-600">신입사원 역량 개발 시스템</p>
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
                      href="/admin-dashboard" 
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
        
        {currentView === "chat" && selectedScenario && selectedPersona && conversationId && (
          <ChatWindow
            scenario={selectedScenario}
            persona={selectedPersona}
            conversationId={conversationId}
            onChatComplete={handleChatComplete}
            onExit={handleReturnToScenarios}
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
