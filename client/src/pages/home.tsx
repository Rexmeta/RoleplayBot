import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
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
  const { logout } = useAuth();
  const [location] = useLocation();
  const [currentView, setCurrentView] = useState<ViewState>("scenarios");
  const [selectedScenario, setSelectedScenario] = useState<ComplexScenario | null>(null);
  const [selectedPersona, setSelectedPersona] = useState<ScenarioPersona | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [scenarioRunId, setScenarioRunId] = useState<string | null>(null); // 현재 시나리오 실행 ID
  const [completedPersonaIds, setCompletedPersonaIds] = useState<string[]>([]);
  const [conversationIds, setConversationIds] = useState<string[]>([]); // 모든 대화 ID 저장
  const [strategyReflectionSubmitted, setStrategyReflectionSubmitted] = useState(false); // 전략 회고 제출 여부 추적
  const [submittedStrategyReflection, setSubmittedStrategyReflection] = useState<string>(''); // 제출한 전략 회고 내용
  const [strategyEvaluation, setStrategyEvaluation] = useState<{
    strategicScore: number;
    strategicRationale: string;
    sequenceEffectiveness: string;
    alternativeApproaches: string[];
    strategicInsights: string;
    strengths: string[];
    improvements: string[];
  } | null>(null); // AI 전략 회고 평가
  const [isCreatingConversation, setIsCreatingConversation] = useState(false); // 대화 생성 중 상태
  const [loadingPersonaId, setLoadingPersonaId] = useState<string | null>(null); // 로딩 중인 페르소나 ID
  const [selectedDifficulty, setSelectedDifficulty] = useState<number>(4); // 사용자가 선택한 난이도 (기본값: 4)
  const [isResuming, setIsResuming] = useState(false); // 대화 재개 중 상태

  // 동적으로 시나리오와 페르소나 데이터 로드
  const { data: scenarios = [] } = useQuery({
    queryKey: ['/api/scenarios'],
    queryFn: () => fetch('/api/scenarios').then(res => res.json()),
    staleTime: 1000 * 60 * 30, // 30분간 캐시 유지 (시나리오는 자주 변경되지 않음)
    gcTime: 1000 * 60 * 60,     // 1시간 메모리 유지
  });

  // ⚡ 최적화: 불필요한 전체 페르소나 조회 제거 (성능 개선)
  // ScenarioSelector에서 시나리오별 페르소나를 직접 전달받음

  // 사용자 프로필 (실제로는 인증 시스템에서 가져올 것)
  const playerProfile = {
    position: "신입 개발자",
    department: "개발팀",
    experience: "6개월차"
  };

  // URL 파라미터 처리 (대화 재개 & 페르소나 선택 화면 이동)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const resumePersonaRunId = params.get('resumePersonaRunId');
    const scenarioId = params.get('scenarioId');
    const scenarioRunIdParam = params.get('scenarioRunId');
    const personaIdParam = params.get('personaId');

    if (resumePersonaRunId && scenarios.length > 0 && !isResuming) {
      // 대화 재개 로직
      setIsResuming(true);
      
      apiRequest('GET', `/api/conversations/${resumePersonaRunId}`)
        .then(res => res.json())
        .then(conversation => {
          console.log('📥 대화 재개:', conversation);
          
          // 시나리오 찾기
          const scenario = scenarios.find((s: any) => s.id === conversation.scenarioId);
          if (!scenario) {
            console.error('시나리오를 찾을 수 없습니다:', conversation.scenarioId);
            setIsResuming(false);
            return;
          }

          // 페르소나 찾기
          const persona = scenario.personas.find((p: any) => p.id === conversation.personaId);
          if (!persona) {
            console.error('페르소나를 찾을 수 없습니다:', conversation.personaId);
            setIsResuming(false);
            return;
          }

          // 상태 설정
          setSelectedScenario(scenario);
          setSelectedPersona(persona);
          setConversationId(conversation.id);
          setScenarioRunId(conversation.scenarioRunId);
          setSelectedDifficulty(conversation.difficulty || 4);
          setCurrentView("chat");
          
          // URL에서 파라미터 제거
          window.history.replaceState({}, '', '/home');
          setIsResuming(false);
        })
        .catch(error => {
          console.error('대화 재개 실패:', error);
          setIsResuming(false);
        });
    } else if (scenarioId && scenarios.length > 0 && !isCreatingConversation) {
      // 특정 시나리오의 페르소나 선택 화면으로 이동
      const scenario = scenarios.find((s: any) => s.id === scenarioId);
      if (scenario) {
        console.log(`📍 시나리오 페르소나 선택 화면 이동: ${scenario.title}, scenarioRunId: ${scenarioRunIdParam || 'none'}, personaId: ${personaIdParam || 'none'}`);
        
        setSelectedScenario(scenario);
        setScenarioRunId(scenarioRunIdParam);
        setConversationIds([]);
        setStrategyReflectionSubmitted(false);
        setStrategyEvaluation(null);
        setSelectedDifficulty(scenario.difficulty || 4);
        
        // ✅ personaId가 있으면 해당 페르소나를 즉시 선택 (미완료 페르소나 "대화하기" 클릭 시)
        if (personaIdParam) {
          const targetPersona = scenario.personas.find((p: any) => p.id === personaIdParam);
          if (targetPersona && !isCreatingConversation) {
            setIsCreatingConversation(true);
            setLoadingPersonaId(personaIdParam);
            const userSelectedDifficulty = scenario.difficulty || 4;
            setSelectedDifficulty(userSelectedDifficulty);
            
            const conversationData = {
              scenarioId: scenario.id,
              personaId: personaIdParam,
              personaSnapshot: targetPersona,
              scenarioName: scenario.title,
              messages: [],
              turnCount: 0,
              status: "active" as const,
              mode: "realtime_voice" as const,
              difficulty: userSelectedDifficulty,
              forceNewRun: scenarioRunIdParam === null,
            };
            
            apiRequest("POST", "/api/conversations", conversationData)
              .then(res => res.json())
              .then(conversation => {
                setSelectedPersona(targetPersona);
                setConversationId(conversation.id);
                setScenarioRunId(conversation.scenarioRunId);
                setCurrentView("chat");
                window.history.replaceState({}, '', '/home');
              })
              .catch(error => {
                console.error("대화 생성 실패:", error);
              })
              .finally(() => {
                setIsCreatingConversation(false);
                setLoadingPersonaId(null);
              });
            return;
        }
        }
        
        // ⚠️ personaId가 없으면 반드시 페르소나 선택 화면으로만 이동
        console.log('📍 페르소나 선택 화면으로 이동 (personaId 없음)');
        
        // ✅ scenarioRunId가 있으면 완료된 페르소나 목록과 난이도 불러오기
        if (scenarioRunIdParam) {
          console.log('📍 scenarioRunId 있음:', scenarioRunIdParam);
          apiRequest('GET', '/api/scenario-runs')
            .then(res => res.json())
            .then((scenarioRuns: any[]) => {
              const run = scenarioRuns.find((sr: any) => sr.id === scenarioRunIdParam);
              if (run) {
                const completedIds = (run.personaRuns || [])
                  .filter((pr: any) => pr.status === 'completed')
                  .map((pr: any) => pr.personaId);
                
                setCompletedPersonaIds(completedIds);
                console.log(`✅ 완료된 페르소나 ${completedIds.length}개 불러옴:`, completedIds);
                
                // 🔒 난이도 고정: 첫 번째 persona_run의 난이도를 가져옴
                if (run.personaRuns && run.personaRuns.length > 0) {
                  const firstDifficulty = run.personaRuns[0].difficulty;
                  if (firstDifficulty) {
                    setSelectedDifficulty(firstDifficulty);
                    console.log(`🔒 난이도 고정: ${firstDifficulty}`);
                  }
                }
              } else {
                setCompletedPersonaIds([]);
              }
            })
            .catch(error => {
              console.error('완료된 페르소나 목록 불러오기 실패:', error);
              setCompletedPersonaIds([]);
            });
        } else {
          // 새 시도인 경우 빈 배열
          setCompletedPersonaIds([]);
        }
        
        // 반드시 persona-selection 뷰로만 이동
        setCurrentView("persona-selection");
        
        // URL에서 파라미터 제거
        window.history.replaceState({}, '', '/home');
      }
    }
  }, [scenarios, isResuming, isCreatingConversation]);

  // 시나리오 선택 처리 - 항상 새로운 시도로 시작
  const handleScenarioSelect = async (scenario: ComplexScenario) => {
    console.log('🆕 새로운 시나리오 시도 시작:', scenario.title);
    
    setSelectedScenario(scenario);
    setCompletedPersonaIds([]);
    setConversationIds([]);
    setScenarioRunId(null); // ✅ null로 설정 → forceNewRun=true → 새 scenario_run 생성
    setStrategyReflectionSubmitted(false);
    setStrategyEvaluation(null);
    setSelectedDifficulty(scenario.difficulty || 4);
    
    // 모든 시나리오에서 페르소나 선택 화면으로 이동
    setCurrentView("persona-selection");
  };

  // 시나리오 목록으로 돌아가기
  const handleBackToScenarios = () => {
    setCurrentView("scenarios");
    setSelectedScenario(null);
    setSelectedPersona(null);
    setConversationId(null);
    setScenarioRunId(null);
    setCompletedPersonaIds([]);
    setConversationIds([]);
    setSelectedDifficulty(4); // 기본 난이도로 리셋
  };

  // 난이도 레벨에 따른 설명 반환 함수
  const getDifficultyDescription = (level: number): string => {
    switch (level) {
      case 1:
        return '매우 쉬움 - 온화하고 수용적인 대화, 비판 거의 없음';
      case 2:
        return '기본 - 따뜻하고 격려적이나 명확한 방향성 요구';
      case 3:
        return '도전형 - 논리와 근거 요구, 비판적 질문과 협상 필요';
      case 4:
        return '고난도 - 직설적이고 압박감 있는 대화, 빠른 결정 요구';
      default:
        return '기본 - 일반적인 대화 난이도';
    }
  };

  // 페르소나 선택 처리
  const handlePersonaSelect = async (persona: ScenarioPersona, userSelectedDifficulty: number) => {
    if (!selectedScenario || isCreatingConversation) return;
    
    setIsCreatingConversation(true);
    setLoadingPersonaId(persona.id);
    setSelectedDifficulty(userSelectedDifficulty); // 선택된 난이도 저장 (재도전 시 재사용)
    
    try {
      console.log(`🕐 CLIENT CODE TIMESTAMP: ${Date.now()} - UPDATED VERSION`);
      
      const conversationData = {
        scenarioId: selectedScenario.id,
        personaId: persona.id,
        personaSnapshot: persona,
        scenarioName: selectedScenario.title,
        messages: [],
        turnCount: 0,
        status: "active" as const,
        mode: "realtime_voice" as const,
        difficulty: userSelectedDifficulty, // 사용자가 선택한 난이도
        forceNewRun: scenarioRunId === null, // ✨ scenarioRunId가 null이면 새 scenario_run 생성
      };
      
      console.log('📤 [NEW CODE] Creating conversation with mode:', conversationData.mode);
      console.log('📤 [NEW CODE] User selected difficulty:', userSelectedDifficulty);
      console.log('📤 [NEW CODE] forceNewRun:', conversationData.forceNewRun, '(scenarioRunId:', scenarioRunId, ')');
      console.log('📤 [NEW CODE] Full conversation data:', JSON.stringify(conversationData));
      
      const response = await apiRequest("POST", "/api/conversations", conversationData);
      
      const conversation = await response.json();
      
      setSelectedPersona(persona);
      setConversationId(conversation.id);
      setScenarioRunId(conversation.scenarioRunId); // scenarioRunId 저장
      setCurrentView("chat");
    } catch (error) {
      console.error("대화 생성 실패:", error);
    } finally {
      setIsCreatingConversation(false);
      setLoadingPersonaId(null);
    }
  };

  const handleChatComplete = () => {
    if (!selectedScenario || !conversationId || !selectedPersona) return;
    
    // 현재 대화 ID와 페르소나 ID를 완료 목록에 추가
    setCompletedPersonaIds(prev => [...prev, selectedPersona.id]);
    setConversationIds(prev => [...prev, conversationId]);
    
    // ✅ MyPage에서 업데이트된 대화 기록을 보여주기 위해 scenario-runs 캐시 무효화
    queryClient.invalidateQueries({ queryKey: ['/api/scenario-runs'] });
    console.log('🔄 대화 완료: scenario-runs 캐시 무효화');
    
    // 대화 완료 후 무조건 피드백을 먼저 보여줌
    setCurrentView("feedback");
  };

  const handleReturnToScenarios = async () => {
    // ✅ scenario_run은 전략 회고 제출 시에만 완료 처리됨
    // active 상태로 남겨서 나중에 마이페이지에서 재개 가능
    console.log(`🔙 시나리오 목록으로 돌아가기 (scenario_run ${scenarioRunId || 'none'}은 active 상태 유지)`);
    
    setCurrentView("scenarios");
    setSelectedScenario(null);
    setSelectedPersona(null);
    setConversationId(null);
    setScenarioRunId(null);
    setCompletedPersonaIds([]);
    setConversationIds([]);
    setStrategyReflectionSubmitted(false);
    setStrategyEvaluation(null);
  };

  // 재도전을 위한 새로운 대화 생성
  const createRetryConversationMutation = useMutation({
    mutationFn: async ({ scenarioId, personaId, scenarioName, persona, difficulty }: { 
      scenarioId: string; 
      personaId: string; 
      scenarioName: string;
      persona: ScenarioPersona;
      difficulty: number;
    }) => {
      const conversationData = {
        scenarioId,
        personaId,
        personaSnapshot: persona,
        scenarioName,
        messages: [],
        turnCount: 0,
        status: "active",
        mode: "realtime_voice",
        difficulty,
        forceNewRun: false, // ✨ 재도전은 같은 scenario_run 내에서 진행
      };
      
      console.log('📤 Creating retry conversation with data:', conversationData);
      console.log('📤 forceNewRun: false (재도전은 같은 scenario_run 내에서 진행)');
      
      const response = await apiRequest("POST", "/api/conversations", conversationData);
      return response.json();
    },
    onSuccess: (conversation) => {
      setConversationId(conversation.id);
      setScenarioRunId(conversation.scenarioRunId); // scenarioRunId 저장
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
        persona: selectedPersona,
        difficulty: selectedDifficulty // 이전에 선택한 난이도 재사용
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
                className="flex items-center justify-center w-10 h-10 mr-2"
                data-testid="mypage-button"
                title="마이페이지"
              >
                <User className="w-4 h-4" />
              </Button>

              {/* 로그아웃 버튼 */}
              <Button
                onClick={async () => {
                  await logout();
                  window.location.href = '/';
                }}
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
              gender: p.gender,
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
              mbti: p.mbti || p.id?.toUpperCase()
            }))}
            completedPersonaIds={completedPersonaIds}
            onPersonaSelect={handlePersonaSelect}
            scenarioTitle={selectedScenario.title}
            scenarioSituation={selectedScenario.description}
            scenario={selectedScenario}
            onBack={handleBackToScenarios}
            isLoading={isCreatingConversation}
            loadingPersonaId={loadingPersonaId}
            selectedDifficulty={selectedDifficulty}
            onDifficultyChange={setSelectedDifficulty}
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
              gender: p.gender,
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
              mbti: p.mbti || p.id?.toUpperCase()
            }))}
            completedPersonaIds={completedPersonaIds}
            onSubmit={async (reflection) => {
              // 전략 회고를 scenario run에 저장
              if (scenarioRunId) {
                try {
                  // scenario run ID를 사용하여 전략 회고 저장
                  const response = await apiRequest("POST", `/api/scenario-runs/${scenarioRunId}/strategy-reflection`, {
                    strategyReflection: reflection,
                    conversationOrder: completedPersonaIds
                  });
                  const result = await response.json();
                  setStrategyReflectionSubmitted(true); // 제출 완료 표시
                  setSubmittedStrategyReflection(reflection); // 제출한 내용 저장
                  if (result.sequenceAnalysis) {
                    setStrategyEvaluation(result.sequenceAnalysis); // AI 평가 결과 저장
                  }
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
                <h1 className="text-3xl font-bold text-gray-900 mb-2">전략 회고 평가 완료!</h1>
                <p className="text-lg text-gray-600">
                  {selectedScenario.title} 시나리오의 전략적 대화 순서가 평가되었습니다.
                </p>
              </div>

              {/* AI 전략 평가 점수 */}
              {strategyEvaluation ? (
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-200 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                      <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                      전략적 사고력 점수
                    </h2>
                    <div className="text-4xl font-bold text-blue-600">
                      {strategyEvaluation.strategicScore}
                      <span className="text-xl text-gray-500">/100</span>
                    </div>
                  </div>
                  <p className="text-gray-700 mb-4">{strategyEvaluation.strategicRationale}</p>
                  
                  {/* 순서 효과성 */}
                  <div className="bg-white rounded-lg p-4 mb-4">
                    <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                      <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                      </svg>
                      순서 효과성 평가
                    </h3>
                    <p className="text-gray-600">{strategyEvaluation.sequenceEffectiveness}</p>
                  </div>
                  
                  {/* 전략적 통찰 */}
                  <div className="bg-white rounded-lg p-4">
                    <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                      <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                      전략적 통찰
                    </h3>
                    <p className="text-gray-600">{strategyEvaluation.strategicInsights}</p>
                  </div>
                </div>
              ) : (
                <div className="bg-yellow-50 rounded-lg border border-yellow-200 p-6 text-center">
                  <svg className="w-12 h-12 text-yellow-500 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <h3 className="text-lg font-semibold text-yellow-800 mb-2">AI 평가를 생성하지 못했습니다</h3>
                  <p className="text-yellow-700 text-sm">전략 회고가 저장되었지만, AI 평가 생성 중 문제가 발생했습니다. 마이페이지에서 다시 확인해 보세요.</p>
                </div>
              )}

              {/* 강점과 개선점 */}
              {strategyEvaluation && (
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="bg-green-50 rounded-lg border border-green-200 p-5">
                    <h3 className="font-semibold text-green-800 mb-3 flex items-center gap-2">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      강점
                    </h3>
                    <ul className="space-y-2">
                      {strategyEvaluation.strengths.map((strength, i) => (
                        <li key={i} className="text-green-700 text-sm flex items-start gap-2">
                          <span className="text-green-500 mt-1">✓</span>
                          {strength}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="bg-orange-50 rounded-lg border border-orange-200 p-5">
                    <h3 className="font-semibold text-orange-800 mb-3 flex items-center gap-2">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      개선점
                    </h3>
                    <ul className="space-y-2">
                      {strategyEvaluation.improvements.map((improvement, i) => (
                        <li key={i} className="text-orange-700 text-sm flex items-start gap-2">
                          <span className="text-orange-500 mt-1">→</span>
                          {improvement}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* 대안적 접근법 */}
              {strategyEvaluation && strategyEvaluation.alternativeApproaches.length > 0 && (
                <div className="bg-purple-50 rounded-lg border border-purple-200 p-5">
                  <h3 className="font-semibold text-purple-800 mb-3 flex items-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                    대안적 접근법
                  </h3>
                  <ul className="space-y-2">
                    {strategyEvaluation.alternativeApproaches.map((approach, i) => (
                      <li key={i} className="text-purple-700 text-sm flex items-start gap-2">
                        <span className="bg-purple-200 text-purple-800 rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold flex-shrink-0">{i + 1}</span>
                        {approach}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

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
                        <p className="text-sm text-gray-600">{persona.position || persona.role}{persona.department ? ` · ${persona.department}` : ''}</p>
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
                  나의 전략 회고
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
