import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import ScenarioSelector from "@/components/ScenarioSelector";
import ChatWindow from "@/components/ChatWindow";
import PersonalDevelopmentReport from "@/components/PersonalDevelopmentReport";
import { SimplePersonaSelector } from "@/components/SimplePersonaSelector";
import { StrategyReflection } from "@/components/StrategyReflection";
import { VideoIntro } from "@/components/VideoIntro";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { toMediaUrl } from "@/lib/mediaUrl";
import { type ComplexScenario, type ScenarioPersona } from "@/lib/scenario-system";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { AppHeader } from "@/components/AppHeader";
import { GuestDemoBanner } from "@/components/GuestDemoBanner";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";
import PersonalizedDashboard from "@/components/PersonalizedDashboard";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type ViewState = "scenarios" | "persona-selection" | "video-intro" | "chat" | "strategy-reflection" | "strategy-result" | "feedback";

export default function Home() {
  const { user } = useAuth();
  const { t } = useTranslation();
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
  const [isVideoTransitioning, setIsVideoTransitioning] = useState(false); // 인트로 영상 → 대화 전환 중 상태
  const [isFeedbackGenerating, setIsFeedbackGenerating] = useState(false); // 피드백 생성 중 상태
  const [isTransitioningToFeedback, setIsTransitioningToFeedback] = useState(false); // 대화 종료 → 피드백 전환 중 상태
  const [autoGenerateFeedback, setAutoGenerateFeedback] = useState(false); // 대화 종료 후 자동 피드백 생성 여부
  const [isHeaderVisible, setIsHeaderVisible] = useState(false); // 상세 페이지에서 헤더 표시 상태
  const [showExitConversationDialog, setShowExitConversationDialog] = useState(false); // 대화 중 홈 이동 경고 다이얼로그

  // 현재 언어 코드 (한국어가 기본이므로 'ko'가 아닐 때만 번역 적용)
  const currentLang = i18n.language || 'ko';

  // 동적으로 시나리오와 페르소나 데이터 로드
  const { data: scenarios = [] } = useQuery<ComplexScenario[]>({
    queryKey: ['/api/scenarios'],
    queryFn: () => {
      const token = localStorage.getItem("authToken");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      return fetch('/api/scenarios', { credentials: 'include', headers }).then(res => res.json());
    },
    staleTime: 1000 * 60 * 30, // 30분간 캐시 유지 (시나리오는 자주 변경되지 않음)
    gcTime: 1000 * 60 * 60,     // 1시간 메모리 유지
  });

  // 선택된 시나리오의 번역 데이터 조회 (현재 언어가 한국어가 아닐 때만)
  const { data: scenarioTranslation } = useQuery({
    queryKey: ['/api/scenarios', selectedScenario?.id, 'translations', currentLang],
    queryFn: async () => {
      if (!selectedScenario?.id || currentLang === 'ko') return null;
      const token = localStorage.getItem("authToken");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/scenarios/${selectedScenario.id}/translations/${currentLang}`, { 
        credentials: 'include', 
        headers 
      });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!selectedScenario?.id && currentLang !== 'ko',
    staleTime: 1000 * 60 * 10, // 10분 캐시
  });

  // 페르소나 컨텍스트에 번역 적용하는 헬퍼 함수
  const applyPersonaContextTranslation = (persona: any) => {
    if (!scenarioTranslation?.personaContexts || currentLang === 'ko') {
      return persona;
    }
    const ctx = scenarioTranslation.personaContexts.find(
      (c: any) => c.personaId === persona.id || c.personaId === persona.personaRef
    );
    if (!ctx) return persona;
    
    return {
      ...persona,
      position: ctx.position || persona.position,
      department: ctx.department || persona.department,
      role: ctx.role || persona.role,
      stance: ctx.stance || persona.stance,
      goal: ctx.goal || persona.goal,
      tradeoff: ctx.tradeoff || persona.tradeoff,
    };
  };

  // 시나리오에 번역 적용하는 헬퍼 함수 (playerRole, objectives 등)
  const applyScenarioTranslation = (scenario: ComplexScenario | null): ComplexScenario | null => {
    if (!scenario || !scenarioTranslation || currentLang === 'ko') {
      return scenario;
    }
    
    const hasPlayerRoleTranslation = !!scenarioTranslation.playerRole;
    
    return {
      ...scenario,
      title: scenarioTranslation.title || scenario.title,
      description: scenarioTranslation.description || scenario.description,
      objectives: scenarioTranslation.objectives || scenario.objectives,
      context: scenario.context ? {
        ...scenario.context,
        situation: scenarioTranslation.situation || scenario.context.situation,
        timeline: scenarioTranslation.timeline || scenario.context.timeline,
        stakes: scenarioTranslation.stakes || scenario.context.stakes,
        playerRoleText: scenarioTranslation.playerRole || scenario.context.playerRoleText,
        playerRole: scenario.context.playerRole ? {
          ...scenario.context.playerRole,
          position: hasPlayerRoleTranslation ? '' : scenario.context.playerRole.position,
          experience: hasPlayerRoleTranslation ? '' : scenario.context.playerRole.experience,
          responsibility: scenarioTranslation.playerRole || scenario.context.playerRole.responsibility,
        } : undefined,
      } : undefined,
    } as ComplexScenario;
  };

  // 번역이 적용된 시나리오
  const translatedScenario = applyScenarioTranslation(selectedScenario);

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
        setSelectedDifficulty(4); // 기본 난이도 4 (고난도)
        
        // ✅ personaId가 있으면 해당 페르소나를 즉시 선택 (미완료 페르소나 "대화하기" 클릭 시)
        if (personaIdParam) {
          const targetPersona = scenario.personas.find((p: any) => p.id === personaIdParam);
          if (targetPersona && !isCreatingConversation) {
            setIsCreatingConversation(true);
            setLoadingPersonaId(personaIdParam);
            const userSelectedDifficulty = 4; // 기본 난이도 4 (고난도)
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
    setSelectedDifficulty(4); // 기본 난이도 4 (고난도)
    
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

  const getDifficultyDescription = (level: number): string => {
    switch (level) {
      case 1:
        return t('home.difficulty.desc1');
      case 2:
        return t('home.difficulty.desc2');
      case 3:
        return t('home.difficulty.desc3');
      case 4:
        return t('home.difficulty.desc4');
      default:
        return t('home.difficulty.default');
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
      
      const response = await apiRequest("POST", "/api/conversations", conversationData);
      
      const conversation = await response.json();
      
      setSelectedPersona(persona);
      setConversationId(conversation.id);
      setScenarioRunId(conversation.scenarioRunId); // scenarioRunId 저장
      
      // 시나리오에 인트로 영상이 있으면 영상 먼저 보여주기
      if (selectedScenario.introVideoUrl) {
        setCurrentView("video-intro");
      } else {
        setCurrentView("chat");
      }
    } catch (error) {
      console.error("대화 생성 실패:", error);
    } finally {
      setIsCreatingConversation(false);
      setLoadingPersonaId(null);
    }
  };

  // 영상 인트로 완료 후 대화 시작
  const handleVideoComplete = () => {
    setIsVideoTransitioning(true);
    // 오버레이가 확실히 렌더링된 후 view 변경 (다음 프레임에서 실행)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setCurrentView("chat");
      });
    });
    
    // 타임아웃 가드: ChatWindow가 1.5초 내에 준비되지 않으면 오버레이 자동 해제
    // (ChatWindow 렌더링 조건이 충족되지 않는 경우 블랙 화면 방지)
    setTimeout(() => {
      setIsVideoTransitioning(prev => {
        if (prev) {
          console.log('⚠️ ChatWindow 준비 타임아웃 - 오버레이 강제 해제');
        }
        return false;
      });
    }, 1500);
  };

  // 영상 건너뛰기
  const handleVideoSkip = () => {
    setIsVideoTransitioning(true);
    // 오버레이가 확실히 렌더링된 후 view 변경 (다음 프레임에서 실행)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setCurrentView("chat");
      });
    });
    
    // 타임아웃 가드: ChatWindow가 1.5초 내에 준비되지 않으면 오버레이 자동 해제
    setTimeout(() => {
      setIsVideoTransitioning(prev => {
        if (prev) {
          console.log('⚠️ ChatWindow 준비 타임아웃 (스킵) - 오버레이 강제 해제');
        }
        return false;
      });
    }, 1500);
  };

  // ChatWindow가 준비 완료되면 전환 오버레이 해제
  const handleChatReady = () => {
    setIsVideoTransitioning(false);
  };

  const handleChatComplete = () => {
    if (!selectedScenario || !conversationId || !selectedPersona) return;
    
    // 전환 오버레이 표시 (화면 깜빡임 방지)
    setIsTransitioningToFeedback(true);
    
    // 현재 대화 ID와 페르소나 ID를 완료 목록에 추가
    setCompletedPersonaIds(prev => [...prev, selectedPersona.id]);
    setConversationIds(prev => [...prev, conversationId]);
    
    // ✅ MyPage에서 업데이트된 대화 기록을 보여주기 위해 scenario-runs 캐시 무효화
    queryClient.invalidateQueries({ queryKey: ['/api/scenario-runs'] });
    console.log('🔄 대화 완료: scenario-runs 캐시 무효화');
    
    // 대화 종료 후 피드백 뷰로 이동 시 자동 생성 플래그 설정
    setAutoGenerateFeedback(true);
    
    // 대화 완료 후 무조건 피드백을 먼저 보여줌
    setCurrentView("feedback");
  };
  
  // 피드백 화면 준비 완료 시 전환 오버레이 해제
  const handleFeedbackReady = () => {
    setIsTransitioningToFeedback(false);
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

  // 상세 페이지 여부 (시나리오 목록 제외)
  const isDetailPage = currentView !== "scenarios";

  return (
    <div className="min-h-screen bg-slate-50">
      {/* 게스트 데모 배너 */}
      <GuestDemoBanner />
      
      {/* 시나리오 목록에서는 항상 헤더 표시 */}
      {!isDetailPage && (
        <AppHeader 
          onLogoClick={() => {
            setCurrentView('scenarios');
            setSelectedScenario(null);
            setSelectedPersona(null);
            setConversationId(null);
          }}
        />
      )}
      
      {/* 상세 페이지에서는 토글 가능한 헤더 */}
      {isDetailPage && isHeaderVisible && (
        <div className="relative">
          <AppHeader 
            onLogoClick={() => {
              if (currentView === 'chat') {
                setShowExitConversationDialog(true);
              } else {
                setCurrentView('scenarios');
                setSelectedScenario(null);
                setSelectedPersona(null);
                setConversationId(null);
                setIsHeaderVisible(false);
              }
            }}
          />
          {/* 헤더 하단 중앙에 숨기기 버튼 */}
          <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 z-50">
            <button
              onClick={() => setIsHeaderVisible(false)}
              className="flex items-center gap-1 px-3 py-1 text-xs bg-white border border-slate-200 text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-full shadow-sm transition-colors"
              data-testid="button-hide-header"
              title={t('home.hideHeader')}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="18 15 12 9 6 15"></polyline>
              </svg>
              <span>{t('common.fold')}</span>
            </button>
          </div>
        </div>
      )}
      
      {/* 상세 페이지에서 헤더가 숨겨졌을 때 토글 버튼 */}
      {isDetailPage && !isHeaderVisible && (
        <div className="flex justify-center pt-2 pb-1">
          <button
            onClick={() => setIsHeaderVisible(true)}
            className="flex items-center gap-1 px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-colors"
            data-testid="button-show-header"
            title={t('home.showHeader')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
            <span>{t('common.menu')}</span>
          </button>
        </div>
      )}
      
      {/* Main Content */}
      <main className={`${currentView === "scenarios" ? "py-8 bg-slate-50" : "max-w-6xl mx-auto px-4 py-4 sm:py-8"}`}>
        {currentView === "scenarios" && (
          <div className="max-w-6xl mx-auto px-4">
            {user && !user.isGuest && (
              <PersonalizedDashboard
                onResumeScenario={(scenarioRunId, scenarioId) => {
                  const foundScenario = scenarios.find((s) => s.id === scenarioId);
                  if (foundScenario) {
                    setSelectedScenario(foundScenario);
                    setScenarioRunId(scenarioRunId);
                    setCompletedPersonaIds([]);
                    setConversationIds([]);
                    setStrategyReflectionSubmitted(false);
                    setStrategyEvaluation(null);
                    setSelectedDifficulty(4);
                    apiRequest('GET', '/api/scenario-runs')
                      .then(res => res.json())
                      .then((runs: Array<{ id: string; personaRuns: Array<{ status: string; personaId: string; difficulty: number }> }>) => {
                        const run = runs.find((r) => r.id === scenarioRunId);
                        if (run) {
                          const completedIds = (run.personaRuns || [])
                            .filter((pr) => pr.status === 'completed')
                            .map((pr) => pr.personaId);
                          setCompletedPersonaIds(completedIds);
                          if (run.personaRuns && run.personaRuns.length > 0) {
                            const firstDifficulty = run.personaRuns[0].difficulty;
                            if (firstDifficulty) setSelectedDifficulty(firstDifficulty);
                          }
                        }
                      })
                      .catch(() => {});
                    setCurrentView('persona-selection');
                  }
                }}
                onRecommendedScenario={(scenarioId) => {
                  const foundScenario = scenarios.find((s) => s.id === scenarioId);
                  if (foundScenario) handleScenarioSelect(foundScenario);
                }}
                scenarios={scenarios}
              />
            )}
            <ScenarioSelector 
              onScenarioSelect={handleScenarioSelect}
              playerProfile={playerProfile}
            />
          </div>
        )}
        
        {currentView === "persona-selection" && selectedScenario && selectedScenario.personas && (
          <SimplePersonaSelector
            personas={selectedScenario.personas.map((p: any) => {
              const translated = applyPersonaContextTranslation(p);
              return {
                id: p.id,
                name: p.name,
                role: translated.position || translated.role,
                department: translated.department,
                experience: p.experience,
                gender: p.gender,
                personality: {
                  traits: [],
                  communicationStyle: translated.stance || '',
                  motivation: translated.goal || '',
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
                  position: translated.stance || ''
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
                stance: translated.stance,
                goal: translated.goal,
                tradeoff: translated.tradeoff,
                mbti: p.mbti || p.id?.toUpperCase()
              };
            })}
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
                  <p className="text-red-800 font-semibold">❌ {t('home.errorNoScenario')}</p>
                  <Button onClick={handleReturnToScenarios} className="mt-4">{t('home.backToScenarios')}</Button>
                </div>
              </div>
            );
          }
          
          if (!selectedScenario.personas || selectedScenario.personas.length === 0) {
            return (
              <div className="max-w-4xl mx-auto p-6">
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
                  <p className="text-yellow-800 font-semibold">⚠️ {t('home.errorNoPersona')}</p>
                  <p className="text-yellow-700 mt-2">{t('home.scenarioId')}: {selectedScenario.id}</p>
                  <Button onClick={handleReturnToScenarios} className="mt-4">{t('home.backToScenarios')}</Button>
                </div>
              </div>
            );
          }
          
          return (
            <StrategyReflection
              personas={selectedScenario.personas.map((p: any) => {
                const translated = applyPersonaContextTranslation(p);
                return {
                  id: p.id,
                  name: p.name,
                  role: translated.position || translated.role,
                  department: translated.department,
                  experience: p.experience,
                  gender: p.gender,
                  personality: {
                    traits: [],
                    communicationStyle: translated.stance || '',
                    motivation: translated.goal || '',
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
                    position: translated.stance || ''
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
                  stance: translated.stance,
                  goal: translated.goal,
                  tradeoff: translated.tradeoff,
                  mbti: p.mbti || p.id?.toUpperCase()
                };
              })}
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
                <h1 className="text-3xl font-bold text-gray-900 mb-2">{t('home.strategyComplete')}</h1>
                <p className="text-lg text-gray-600">
                  {selectedScenario.title} - {t('home.strategyCompleteDesc')}
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
                      {t('home.strategicScore')}
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
                      {t('home.sequenceEffectiveness')}
                    </h3>
                    <p className="text-gray-600">{strategyEvaluation.sequenceEffectiveness}</p>
                  </div>
                  
                  {/* 전략적 통찰 */}
                  <div className="bg-white rounded-lg p-4">
                    <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
                      <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                      {t('home.strategicInsights')}
                    </h3>
                    <p className="text-gray-600">{strategyEvaluation.strategicInsights}</p>
                  </div>
                </div>
              ) : (
                <div className="bg-yellow-50 rounded-lg border border-yellow-200 p-6 text-center">
                  <svg className="w-12 h-12 text-yellow-500 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <h3 className="text-lg font-semibold text-yellow-800 mb-2">{t('home.aiEvalError')}</h3>
                  <p className="text-yellow-700 text-sm">{t('home.aiEvalErrorDesc')}</p>
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
                      {t('home.strengths')}
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
                      {t('home.improvements')}
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
                    {t('home.alternativeApproaches')}
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
                  {t('home.conversationOrder')}
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
                  {t('home.myStrategyReflection')}
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
                  {t('home.viewConversationHistory')}
                </Button>
                <Button
                  onClick={handleReturnToScenarios}
                  size="lg"
                  data-testid="return-to-scenarios-button"
                >
                  {t('home.goToScenarios')}
                </Button>
              </div>
            </div>
          );
        })()}
        
        {currentView === "video-intro" && selectedScenario && selectedScenario.introVideoUrl && (
          <VideoIntro
            videoSrc={toMediaUrl(selectedScenario.introVideoUrl)}
            onComplete={handleVideoComplete}
            onSkip={handleVideoSkip}
            preloadImageUrl={selectedPersona ? toMediaUrl(`personas/${(selectedPersona.mbti?.toLowerCase() || selectedPersona.id)}/${selectedPersona.gender || 'male'}/neutral.webp`) : undefined}
          />
        )}

        {currentView === "chat" && selectedScenario && selectedPersona && conversationId && (
          <ChatWindow
            scenario={translatedScenario || selectedScenario}
            persona={applyPersonaContextTranslation(selectedPersona)}
            conversationId={conversationId}
            onChatComplete={handleChatComplete}
            onExit={handleReturnToScenarios}
            onReady={handleChatReady}
            onConversationEnding={() => setIsTransitioningToFeedback(true)}
          />
        )}
        
        {isVideoTransitioning && (
          <div 
            className="fixed inset-0 z-[60] bg-black transition-opacity duration-500"
            data-testid="video-transition-overlay"
          />
        )}
        
        {(isFeedbackGenerating || isTransitioningToFeedback) && (
          <div 
            className="fixed inset-0 z-[60] bg-white flex items-center justify-center"
            data-testid="feedback-transition-overlay"
          >
            <div className="text-center">
              <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-corporate-600 mx-auto mb-4"></div>
              <h2 className="text-xl font-semibold text-slate-900 mb-2">
                {isFeedbackGenerating ? t('home.analyzingFeedback') : t('home.preparingFeedback')}
              </h2>
              <p className="text-slate-600">
                {isFeedbackGenerating 
                  ? t('home.analyzingFeedbackDesc')
                  : t('home.preparingFeedbackDesc')}
              </p>
            </div>
          </div>
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
              onFeedbackGeneratingChange={setIsFeedbackGenerating}
              onReady={handleFeedbackReady}
              autoGenerateFeedback={autoGenerateFeedback}
            />
          );
        })()}
      </main>

      {/* 대화 중 홈 이동 경고 다이얼로그 */}
      <AlertDialog open={showExitConversationDialog} onOpenChange={setShowExitConversationDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('home.exitConversationTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('home.exitConversationDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-exit">{t('home.continueConversation')}</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => {
                setCurrentView('scenarios');
                setSelectedScenario(null);
                setSelectedPersona(null);
                setConversationId(null);
                setIsHeaderVisible(false);
                setShowExitConversationDialog(false);
              }}
              data-testid="button-confirm-exit"
            >
              {t('home.goToHome')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-8 mt-16">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between">
            <div className="text-sm text-slate-600 mb-4 md:mb-0">
              <Link href="/about" className="hover:text-corporate-600 hover:underline cursor-pointer transition-colors">
                © {t('home.footerCopyright')}
              </Link>
            </div>
            <div className="flex items-center space-x-6 text-sm text-slate-600">
              <a href="/help" className="hover:text-corporate-600" data-testid="link-help">{t('home.footerHelp')}</a>
              <a href="#" className="hover:text-corporate-600">{t('home.footerContact')}</a>
              <a href="/privacy-policy" className="hover:text-corporate-600">{t('home.footerPrivacy')}</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
