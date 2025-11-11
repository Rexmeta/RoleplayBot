import { useState } from "react";
import { Link } from "wouter";
import ScenarioSelector from "@/components/ScenarioSelector";
import ChatWindow from "@/components/ChatWindow";
import PersonalDevelopmentReport from "@/components/PersonalDevelopmentReport";
import { SimplePersonaSelector } from "@/components/SimplePersonaSelector";
import { StrategyReflection } from "@/components/StrategyReflection";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { type ComplexScenario, type ScenarioPersona, getComplexScenarioById, scenarioPersonas } from "@/lib/scenario-system";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { User, LogOut } from "lucide-react";

type ViewState = "scenarios" | "persona-selection" | "chat" | "strategy-reflection" | "strategy-result" | "feedback";

export default function Home() {
  const [currentView, setCurrentView] = useState<ViewState>("scenarios");
  const [selectedScenario, setSelectedScenario] = useState<ComplexScenario | null>(null);
  const [selectedPersona, setSelectedPersona] = useState<ScenarioPersona | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [completedPersonaIds, setCompletedPersonaIds] = useState<string[]>([]);
  const [conversationIds, setConversationIds] = useState<string[]>([]); // 모든 대화 ID 저장
  const [strategyReflectionSubmitted, setStrategyReflectionSubmitted] = useState(false); // 전략 회고 제출 여부 추적
  const [submittedStrategyReflection, setSubmittedStrategyReflection] = useState<string>(''); // 제출한 전략 회고 내용

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

  // 시나리오 선택 처리
  const handleScenarioSelect = async (scenario: ComplexScenario) => {
    setSelectedScenario(scenario);
    setCompletedPersonaIds([]);
    setConversationIds([]);
    setStrategyReflectionSubmitted(false); // 새 시나리오 시작 시 초기화
    
    // 모든 시나리오에서 페르소나 선택 화면으로 이동
    setCurrentView("persona-selection");
  };

  // 시나리오 목록으로 돌아가기
  const handleBackToScenarios = () => {
    setCurrentView("scenarios");
    setSelectedScenario(null);
    setSelectedPersona(null);
    setConversationId(null);
    setCompletedPersonaIds([]);
    setConversationIds([]);
  };

  // 페르소나 선택 처리
  const handlePersonaSelect = async (persona: ScenarioPersona) => {
    if (!selectedScenario) return;
    
    try {
      console.log(`🕐 CLIENT CODE TIMESTAMP: ${Date.now()} - UPDATED VERSION`);
      
      const conversationData = {
        scenarioId: selectedScenario.id,
        personaId: persona.id,
        personaSnapshot: persona, // 대화 생성 시점의 페르소나 정보 스냅샷 저장
        scenarioName: selectedScenario.title,
        messages: [],
        turnCount: 0,
        status: "active" as const,
        mode: "realtime_voice" as const,
      };
      
      console.log('📤 [NEW CODE] Creating conversation with mode:', conversationData.mode);
      console.log('📤 [NEW CODE] Full conversation data:', JSON.stringify(conversationData));
      
      const response = await apiRequest("POST", "/api/conversations", conversationData);
      
      const conversation = await response.json();
      
      setSelectedPersona(persona);
      setConversationId(conversation.id);
      setCurrentView("chat");
    } catch (error) {
      console.error("대화 생성 실패:", error);
    }
  };

  const handleChatComplete = () => {
    if (!selectedScenario || !conversationId || !selectedPersona) return;
    
    // 현재 대화 ID와 페르소나 ID를 완료 목록에 추가
    setCompletedPersonaIds(prev => [...prev, selectedPersona.id]);
    setConversationIds(prev => [...prev, conversationId]);
    
    // 대화 완료 후 무조건 피드백을 먼저 보여줌
    setCurrentView("feedback");
  };

  const handleReturnToScenarios = () => {
    setCurrentView("scenarios");
    setSelectedScenario(null);
    setSelectedPersona(null);
    setConversationId(null);
    setCompletedPersonaIds([]);
    setConversationIds([]);
    setStrategyReflectionSubmitted(false); // 초기화
  };

  // 재도전을 위한 새로운 대화 생성
  const createRetryConversationMutation = useMutation({
    mutationFn: async ({ scenarioId, personaId, scenarioName, persona }: { 
      scenarioId: string; 
      personaId: string; 
      scenarioName: string;
      persona: ScenarioPersona;
    }) => {
      const conversationData = {
        scenarioId,
        personaId,
        personaSnapshot: persona, // 재도전 시에도 현재 페르소나 스냅샷 저장
        scenarioName,
        messages: [],
        turnCount: 0,
        status: "active",
        mode: "realtime_voice"
      };
      
      console.log('📤 Creating retry conversation with data:', conversationData);
      
      const response = await apiRequest("POST", "/api/conversations", conversationData);
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
        scenarioName: selectedScenario.title,
        persona: selectedPersona
      });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <button 
              onClick={() => {
                setCurrentView('scenarios');
                setSelectedScenario(null);
                setSelectedPersona(null);
                setConversationId(null);
              }}
              className="flex items-center space-x-3 hover:opacity-80 transition-opacity cursor-pointer bg-transparent border-none" 
              data-testid="home-link"
            >
              <div className="w-10 h-10 bg-corporate-600 rounded-lg flex items-center justify-center">
                <i className="fas fa-robot text-white text-lg"></i>
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">🎭 Roleplay X</h1>
                <p className="text-sm text-slate-600">커뮤니케이션 역량 개발</p>
              </div>
            </button>
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
              
              {/* MyPage 링크 - from javascript_log_in_with_replit blueprint */}
              <Button
                onClick={() => window.location.href = '/mypage'}
                variant="outline"
                size="sm"
                className="flex items-center gap-2 mr-2"
                data-testid="mypage-button"
              >
                <User className="w-4 h-4" />
                MyPage
              </Button>

              {/* 로그아웃 버튼 - from javascript_log_in_with_replit blueprint */}
              <Button
                onClick={() => window.location.href = '/api/logout'}
                variant="outline"
                size="sm"
                className="flex items-center gap-2"
                data-testid="logout-button"
              >
                <LogOut className="w-4 h-4" />
                로그아웃
              </Button>
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
        
        {currentView === "persona-selection" && selectedScenario && selectedScenario.personas && (
          <SimplePersonaSelector
            personas={selectedScenario.personas.map((p: any) => ({
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
            }))}
            completedPersonaIds={completedPersonaIds}
            onPersonaSelect={handlePersonaSelect}
            scenarioTitle={selectedScenario.title}
            scenarioSituation={selectedScenario.description}
            scenario={selectedScenario}
            onBack={handleBackToScenarios}
          />
        )}

        {currentView === "strategy-reflection" && (() => {
          console.log('🔍 Strategy Reflection Render Check:', {
            currentView,
            hasSelectedScenario: !!selectedScenario,
            hasPersonas: !!selectedScenario?.personas,
            personasLength: selectedScenario?.personas?.length,
            completedPersonaIds,
            conversationIds
          });
          
          if (!selectedScenario) {
            return (
              <div className="max-w-4xl mx-auto p-6">
                <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
                  <p className="text-red-800 font-semibold">❌ 오류: 시나리오 정보가 없습니다</p>
                  <Button onClick={handleReturnToScenarios} className="mt-4">시나리오 목록으로 돌아가기</Button>
                </div>
              </div>
            );
          }
          
          if (!selectedScenario.personas || selectedScenario.personas.length === 0) {
            return (
              <div className="max-w-4xl mx-auto p-6">
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
                  <p className="text-yellow-800 font-semibold">⚠️ 오류: 페르소나 정보가 없습니다</p>
                  <p className="text-yellow-700 mt-2">시나리오 ID: {selectedScenario.id}</p>
                  <Button onClick={handleReturnToScenarios} className="mt-4">시나리오 목록으로 돌아가기</Button>
                </div>
              </div>
            );
          }
          
          return (
            <StrategyReflection
              personas={selectedScenario.personas.map((p: any) => ({
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
            }))}
            completedPersonaIds={completedPersonaIds}
            onSubmit={async (reflection) => {
              // 전략 회고를 모든 대화 ID에 저장
              if (conversationIds.length > 0) {
                try {
                  // 첫 번째 대화 ID를 대표로 사용하여 전략 회고 저장
                  await apiRequest("POST", `/api/conversations/${conversationIds[0]}/strategy-reflection`, {
                    strategyReflection: reflection,
                    conversationOrder: completedPersonaIds
                  });
                  setStrategyReflectionSubmitted(true); // 제출 완료 표시
                  setSubmittedStrategyReflection(reflection); // 제출한 내용 저장
                  setCurrentView("strategy-result"); // 결과 화면으로 이동
                } catch (error) {
                  console.error("전략 회고 저장 실패:", error);
                }
              }
            }}
            scenarioTitle={selectedScenario.title}
          />
          )
        })()}
        
        {currentView === "strategy-result" && selectedScenario && (() => {
          const completedPersonas = completedPersonaIds.map(id => 
            selectedScenario.personas.find((p: any) => p.id === id)
          ).filter(p => p !== undefined);

          return (
            <div className="max-w-4xl mx-auto p-6 space-y-6">
              <div className="text-center mb-8">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h1 className="text-3xl font-bold text-gray-900 mb-2">전략 회고 제출 완료!</h1>
                <p className="text-lg text-gray-600">
                  {selectedScenario.title} 시나리오의 전략적 대화 순서가 저장되었습니다.
                </p>
              </div>

              <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
                <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                  <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  대화 순서
                </h2>
                <div className="space-y-3">
                  {completedPersonas.map((persona: any, index: number) => (
                    <div 
                      key={persona.id} 
                      className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg"
                    >
                      <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold flex-shrink-0">
                        {index + 1}
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900">{persona.name}</h3>
                        <p className="text-sm text-gray-600">{persona.position || persona.role}</p>
                      </div>
                      {index < completedPersonas.length - 1 && (
                        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
                <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                  <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                  전략 회고
                </h2>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-gray-700 whitespace-pre-wrap">{submittedStrategyReflection}</p>
                </div>
              </div>

              <div className="flex gap-4 justify-center pt-4">
                <Button
                  onClick={() => window.location.href = '/mypage'}
                  variant="outline"
                  size="lg"
                  data-testid="view-history-button"
                >
                  대화 히스토리 보기
                </Button>
                <Button
                  onClick={handleReturnToScenarios}
                  size="lg"
                  data-testid="return-to-scenarios-button"
                >
                  시나리오 목록으로
                </Button>
              </div>
            </div>
          );
        })()}
        
        {currentView === "chat" && selectedScenario && selectedPersona && conversationId && (
          <ChatWindow
            scenario={selectedScenario}
            persona={selectedPersona}
            conversationId={conversationId}
            onChatComplete={handleChatComplete}
            onExit={handleReturnToScenarios}
          />
        )}
        
        {currentView === "feedback" && selectedScenario && selectedPersona && conversationId && (() => {
          // 현재 완료된 페르소나 수 계산
          const totalPersonas = selectedScenario.personas?.length || 0;
          const currentCompletedCount = completedPersonaIds.length;
          const hasMorePersonas = currentCompletedCount < totalPersonas;
          const allPersonasCompleted = currentCompletedCount === totalPersonas;
          
          return (
            <PersonalDevelopmentReport
              scenario={selectedScenario}
              persona={selectedPersona}
              conversationId={conversationId}
              onRetry={handleRetry}
              onSelectNewScenario={handleReturnToScenarios}
              hasMorePersonas={hasMorePersonas}
              allPersonasCompleted={allPersonasCompleted && !strategyReflectionSubmitted}
              onNextPersona={() => {
                if (hasMorePersonas) {
                  setCurrentView("persona-selection");
                } else if (allPersonasCompleted && !strategyReflectionSubmitted && totalPersonas >= 2) {
                  setCurrentView("strategy-reflection");
                }
              }}
            />
          );
        })()}
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
