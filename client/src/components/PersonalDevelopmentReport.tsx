import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useState, useRef } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

import type { ComplexScenario, ScenarioPersona } from "@/lib/scenario-system";
import type { Feedback } from "@shared/schema";

interface PersonalDevelopmentReportProps {
  scenario: ComplexScenario;
  persona: ScenarioPersona;
  conversationId: string;
  onRetry: () => void;
  onSelectNewScenario: () => void;
  hasMorePersonas?: boolean;
  allPersonasCompleted?: boolean;
  onNextPersona?: () => void;
  onFeedbackGeneratingChange?: (isGenerating: boolean) => void;
  onReady?: () => void;
  isAdminView?: boolean;
  autoGenerateFeedback?: boolean;
}

// 애니메이션 없이 바로 값 표시 (hooks 오류 방지)
const getDisplayValue = (value: number) => value;
const getProgressWidth = (value: number) => value;

export default function PersonalDevelopmentReport({ 
  scenario, 
  persona,
  conversationId, 
  onRetry, 
  onSelectNewScenario,
  hasMorePersonas,
  allPersonasCompleted,
  onNextPersona,
  onFeedbackGeneratingChange,
  onReady,
  isAdminView = false,
  autoGenerateFeedback = false
}: PersonalDevelopmentReportProps) {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [showDetailedFeedback, setShowDetailedFeedback] = useState(true); // 애니메이션 없이 바로 표시
  const [hasRequestedFeedback, setHasRequestedFeedback] = useState(false); // 피드백 생성 요청 여부
  const [isExportingPdf, setIsExportingPdf] = useState(false); // PDF 내보내기 중
  const [showMobileMenu, setShowMobileMenu] = useState(false); // 모바일 스마트 메뉴 상태
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>(() => {
    try {
      const stored = localStorage.getItem(`checklist_${conversationId}`);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });
  const reportRef = useRef<HTMLDivElement>(null); // 보고서 컨테이너 참조

  // 사용자의 모든 대화 기록 조회
  const { data: userConversations = [] } = useQuery<any[]>({
    queryKey: ['/api/conversations'],
  });

  // 현재 대화 찾기 (모드 정보 등 활용)
  const currentConversation = userConversations.find((c: any) => c.id === conversationId) || null;

  // 피드백 조회 - 한번 가져온 피드백은 캐시에서 사용 (피드백은 변경되지 않음)
  const { data: feedback, isLoading, error, refetch } = useQuery<Feedback>({
    queryKey: ["/api/conversations", conversationId, "feedback"],
    enabled: !!conversationId,
    retry: false, // 404 에러 시 재시도하지 않음
    staleTime: Infinity, // 피드백은 한번 생성되면 변경되지 않으므로 영구 캐시
    gcTime: Infinity, // 캐시를 영구 보관
    queryFn: async () => {
      try {
        const token = localStorage.getItem("authToken");
        const headers: Record<string, string> = {};
        
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }

        const response = await fetch(`/api/conversations/${conversationId}/feedback`, {
          headers,
          credentials: "include",
        });
        
        if (response.status === 404) {
          // 피드백이 없음을 명확하게 표시
          console.log("피드백이 아직 생성되지 않음");
          throw new Error("FEEDBACK_NOT_FOUND");
        }
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        console.log("피드백 로드 완료 (캐시에 저장됨)");
        return data;
      } catch (error) {
        console.error("피드백 조회 오류:", error);
        throw error;
      }
    }
  });

  // 피드백이 로드되거나 피드백 생성 버튼 화면이 준비되면 부모에게 알림
  useEffect(() => {
    // 피드백이 있는 경우 또는 피드백이 없어서 버튼을 표시할 경우
    if (!isLoading) {
      if (feedback || error?.message === "FEEDBACK_NOT_FOUND") {
        onReady?.();
      }
    }
  }, [feedback, isLoading, error, onReady]);

  const { data: userProfile } = useQuery<any>({
    queryKey: ['/api/auth/user'],
  });

  const userName = userProfile?.name || t('report.defaultUser', '사용자');

  // 피드백 히스토리 조회 (동일 시나리오+페르소나 과거 세션)
  const { data: feedbackHistory = [] } = useQuery<any[]>({
    queryKey: ['/api/users/me/feedback-history', scenario.id, persona.id],
    queryFn: async () => {
      const token = localStorage.getItem("authToken");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const response = await fetch(
        `/api/users/me/feedback-history?scenarioId=${encodeURIComponent(scenario.id)}&personaId=${encodeURIComponent(persona.id)}`,
        { headers, credentials: "include" }
      );
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!scenario.id && !!persona.id,
    staleTime: 60000,
  });

  // 다음 페르소나 확인 (서버에서 온 scenario는 personas가 객체 배열)
  const getNextPersona = () => {
    const personasArray = (scenario as any).personas;
    if (!personasArray || personasArray.length <= 1) return null;
    
    const currentIndex = personasArray.findIndex((p: any) => p.id === persona.id);
    if (currentIndex === -1 || currentIndex === personasArray.length - 1) return null;
    
    return personasArray[currentIndex + 1];
  };

  const nextPersona = getNextPersona();

  // 다음 페르소나와의 대화가 이미 완료되었는지 확인
  const isNextConversationCompleted = () => {
    if (!nextPersona) return false;
    
    const nextConversation = userConversations.find(
      (conv: any) => conv.scenarioId === scenario.id && conv.personaId === nextPersona.id
    );
    
    return nextConversation?.status === 'completed';
  };

  // 다음 대화 상대와 대화 생성
  const createNextConversationMutation = useMutation({
    mutationFn: async () => {
      if (!nextPersona) throw new Error("NO_NEXT_PERSONA");
      
      const response = await apiRequest('POST', '/api/conversations', {
        scenarioId: scenario.id,
        personaId: nextPersona.id,
        maxTurns: 3,
      });

      if (!response.ok) {
        throw new Error('CREATE_FAILED');
      }

      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
      window.location.href = `/chat/${data.id}`;
    },
    onError: (error) => {
      const errorKey = error.message === 'NO_NEXT_PERSONA' 
        ? 'report.noNextPersonaError'
        : 'report.conversationCreateFailed';
      toast({
        title: t('report.error', 'Error'),
        description: t(errorKey, 'Failed to create the next conversation.'),
        variant: "destructive"
      });
    }
  });

  const handleNextConversation = () => {
    if (!nextPersona) return;
    
    // 이미 다음 페르소나와의 대화가 있는지 확인
    const existingConversation = userConversations.find(
      (conv: any) => conv.scenarioId === scenario.id && conv.personaId === nextPersona.id
    );

    if (existingConversation) {
      // 이미 대화가 있으면 그 대화로 이동
      window.location.href = `/chat/${existingConversation.id}`;
    } else {
      // 없으면 새로 생성
      createNextConversationMutation.mutate();
    }
  };

  const generateFeedbackMutation = useMutation({
    mutationFn: async (options?: { force?: boolean }) => {
      const isForce = options?.force === true;
      console.log(`피드백 ${isForce ? '재생성' : '생성'} 요청 시작:`, conversationId);
      try {
        const token = localStorage.getItem("authToken");
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }

        const response = await fetch(`/api/conversations/${conversationId}/feedback`, {
          method: 'POST',
          headers,
          credentials: "include",
          body: JSON.stringify(isForce ? { force: true } : {}),
        });
        
        console.log("피드백 생성 응답 상태:", response.status);
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error("피드백 생성 실패:", errorText);
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        
        const result = await response.json();
        console.log("피드백 생성 성공:", result);
        return result;
      } catch (error) {
        console.error("피드백 생성 중 오류:", error);
        throw error;
      }
    },
    onSuccess: (data) => {
      console.log("피드백 생성 완료, 캐시 즉시 업데이트");
      queryClient.setQueryData(["/api/conversations", conversationId, "feedback"], data);
      onFeedbackGeneratingChange?.(false);
    },
    onError: (error) => {
      console.error("피드백 생성 오류:", error);
      onFeedbackGeneratingChange?.(false);
      toast({
        title: "오류",
        description: `피드백을 생성할 수 없습니다: ${error.message}`,
        variant: "destructive"
      });
    }
  });

  const handleGenerateFeedback = () => {
    setHasRequestedFeedback(true);
    onFeedbackGeneratingChange?.(true);
    generateFeedbackMutation.mutate();
  };

  const handleRegenerateFeedback = () => {
    onFeedbackGeneratingChange?.(true);
    generateFeedbackMutation.mutate({ force: true });
  };

  // 대화 종료 후 피드백 뷰 진입 시 자동으로 피드백 생성 시작
  useEffect(() => {
    if (
      autoGenerateFeedback &&
      !isLoading &&
      !feedback &&
      !hasRequestedFeedback &&
      !generateFeedbackMutation.isPending &&
      error?.message === "FEEDBACK_NOT_FOUND"
    ) {
      setHasRequestedFeedback(true);
      onFeedbackGeneratingChange?.(true);
      generateFeedbackMutation.mutate();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerateFeedback, isLoading, feedback, hasRequestedFeedback, error?.message, generateFeedbackMutation.isPending]);

  // HTML 이스케이프 함수 (XSS 방지)
  const escapeHtml = (text: string | null | undefined): string => {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  // 평가 차원 이름 번역 헬퍼 함수
  const getTranslatedDimensionName = (key: string | undefined, fallbackName: string): string => {
    if (!key) return fallbackName;
    const translatedName = t(`evaluationDimensions.${key}.name`, { defaultValue: '' });
    return translatedName || fallbackName;
  };

  // 페르소나 전체 정보 표시 (소속 + 직급/역할 + 이름)
  const getPersonaFullInfo = () => {
    // persona 또는 personaSnapshot에서 데이터 추출
    const p = persona as any;
    
    // 유효한 필드인지 확인하는 헬퍼 함수 (너무 긴 텍스트는 stance/goal 등의 설명 필드로 간주)
    const isValidShortField = (value: string | undefined, maxLength: number = 30): string => {
      if (!value || typeof value !== 'string') return '';
      // stance, goal, tradeoff 등의 긴 설명 필드가 잘못 참조되는 것을 방지
      if (value.length > maxLength) return '';
      return value;
    };
    
    // 소속 부서 (여러 소스에서 탐색)
    const department = isValidShortField(p.department, 20) || 
                       isValidShortField(p.personaSnapshot?.department, 20) || 
                       isValidShortField(p.affiliation, 20) || '';
    
    // 직위/포지션 - position 필드 우선 (AI 생성 시나리오에서 사용)
    const position = isValidShortField(p.position, 30) || 
                     isValidShortField(p.personaSnapshot?.position, 30) || '';
    
    // 역할 (role 필드) - 레거시 시나리오 호환
    const role = isValidShortField(p.role, 30) || 
                 isValidShortField(p.personaSnapshot?.role, 30) || 
                 isValidShortField(p.currentSituation?.position, 30) || '';
    
    // 이름 (20자 이하만 유효한 이름으로 간주)
    const name = isValidShortField(p.name, 20) || 
                 isValidShortField(p.personaSnapshot?.name, 20) || '';
    
    const parts: string[] = [];
    
    // 소속 추가
    if (department) {
      parts.push(department);
    }
    
    // 직위 추가 (position 우선, 없으면 role)
    if (position) {
      parts.push(position);
    } else if (role && !role.includes(department)) {
      parts.push(role);
    }
    
    // 이름 추가
    if (name) {
      parts.push(name);
    }
    
    return parts.join(' ') || name || '';
  };

  // 인쇄/PDF용 전체 보고서 HTML 생성
  const generatePrintableContent = () => {
    if (!feedback) return '';
    
    const overallGrade = getOverallGrade(feedback.overallScore || 0);
    
    // 안전한 배열 접근
    const scores = feedback.scores || [];
    const strengths = feedback.detailedFeedback?.strengths || [];
    const improvements = feedback.detailedFeedback?.improvements || [];
    const nextSteps = feedback.detailedFeedback?.nextSteps || [];
    const behaviorGuides = feedback.detailedFeedback?.behaviorGuides || [];
    const conversationGuides = feedback.detailedFeedback?.conversationGuides || [];
    const developmentPlan = feedback.detailedFeedback?.developmentPlan;
    const sequenceAnalysis = feedback.detailedFeedback?.sequenceAnalysis;
    const conversationDuration = feedback.detailedFeedback?.conversationDuration;
    const averageResponseTime = feedback.detailedFeedback?.averageResponseTime;
    const timePerformance = feedback.detailedFeedback?.timePerformance;
    
    const userProfile = userConversations.length > 0 ? userConversations[0].user : null;
    const printUserName = userProfile?.name || userName;

    return `
      <div style="font-family: 'Noto Sans KR', sans-serif; max-width: 800px; margin: 0 auto;">

        <!-- 커버 페이지 -->
        <div style="page-break-after: always; min-height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center; background: linear-gradient(135deg, #4f46e5 0%, #6366f1 60%, #8b5cf6 100%); color: white; padding: 60px 40px; text-align: center;">
          <div style="font-size: 13px; letter-spacing: 0.15em; text-transform: uppercase; opacity: 0.7; margin-bottom: 24px;">Personal Development Report</div>
          <h1 style="font-size: 36px; font-weight: 800; margin-bottom: 16px; line-height: 1.2;">${escapeHtml(printUserName)}님 맞춤 개발 보고서</h1>
          <div style="width: 60px; height: 3px; background: rgba(255,255,255,0.5); margin: 24px auto;"></div>
          <p style="font-size: 16px; opacity: 0.9; margin-bottom: 8px;">시나리오: ${escapeHtml(scenario.title)}</p>
          <p style="font-size: 14px; opacity: 0.75; margin-bottom: 40px;">대화 상대: ${escapeHtml(getPersonaFullInfo())}</p>
          <div style="background: rgba(255,255,255,0.15); border-radius: 16px; padding: 24px 40px; margin-bottom: 40px;">
            <div style="font-size: 48px; font-weight: 900; margin-bottom: 4px;">${escapeHtml(overallGrade.grade)}</div>
            <div style="font-size: 20px; font-weight: 600;">${feedback.overallScore || 0}점</div>
            <div style="font-size: 12px; opacity: 0.75; margin-top: 4px;">종합 점수</div>
          </div>
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; text-align: left; max-width: 400px; width: 100%;">
            <div style="background: rgba(255,255,255,0.1); border-radius: 8px; padding: 12px;">
              <div style="font-size: 10px; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 4px;">발행 일시</div>
              <div style="font-size: 12px;">${feedback.createdAt ? new Date(feedback.createdAt).toLocaleString('ko-KR') : new Date().toLocaleString('ko-KR')}</div>
            </div>
            <div style="background: rgba(255,255,255,0.1); border-radius: 8px; padding: 12px;">
              <div style="font-size: 10px; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 4px;">보고서 ID</div>
              <div style="font-size: 12px; font-family: monospace;">${conversationId.slice(0, 8).toUpperCase()}</div>
            </div>
          </div>
        </div>

        <!-- 목차 -->
        <div style="page-break-after: always; padding: 40px;">
          <h2 style="font-size: 22px; font-weight: 700; color: #1e293b; border-bottom: 2px solid #4f46e5; padding-bottom: 12px; margin-bottom: 24px;">목차</h2>
          <ol style="list-style: none; padding: 0; margin: 0; space-y: 12px;">
            ${conversationDuration ? `<li style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px dashed #e2e8f0; font-size: 14px; color: #374151;"><span>⏱️ 대화 시간 분석</span><span style="color: #94a3b8;">Section 1</span></li>` : ''}
            <li style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px dashed #e2e8f0; font-size: 14px; color: #374151;"><span>📊 성과 분석</span><span style="color: #94a3b8;">Section ${conversationDuration ? '2' : '1'}</span></li>
            <li style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px dashed #e2e8f0; font-size: 14px; color: #374151;"><span>🗂️ 실천 가이드</span><span style="color: #94a3b8;">Section ${conversationDuration ? '3' : '2'}</span></li>
            <li style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px dashed #e2e8f0; font-size: 14px; color: #374151;"><span>📈 개발 계획</span><span style="color: #94a3b8;">Section ${conversationDuration ? '4' : '3'}</span></li>
            ${sequenceAnalysis ? `<li style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px dashed #e2e8f0; font-size: 14px; color: #374151;"><span>🎮 전략 평가</span><span style="color: #94a3b8;">Section ${conversationDuration ? '5' : '4'}</span></li>` : ''}
          </ol>
        </div>

        <!-- 본문 -->
        <div style="padding: 20px;">
        <!-- 헤더 (본문용 요약) -->
        <div style="background: linear-gradient(135deg, #4f46e5, #6366f1); color: white; padding: 24px; border-radius: 12px; margin-bottom: 24px;">
          <h1 style="font-size: 24px; font-weight: bold; margin-bottom: 8px;">${escapeHtml(printUserName)}님 맞춤 보고서</h1>
          <p style="opacity: 0.9; margin-bottom: 4px;">시나리오 : ${escapeHtml(scenario.title)}</p>
          <p style="font-size: 14px; opacity: 0.8; margin-bottom: 12px;">대화 상대 : ${escapeHtml(getPersonaFullInfo())}</p>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 16px;">
            <div></div>
            <div style="background: white; color: ${overallGrade.color.replace('text-', '')}; padding: 16px 24px; border-radius: 8px; text-align: center;">
              <div style="font-size: 28px; font-weight: bold; color: #16a34a;">${escapeHtml(overallGrade.grade)}</div>
              <div style="font-size: 14px; color: #4b5563;">${feedback.overallScore || 0}점</div>
            </div>
          </div>
        </div>

        <!-- 대화 시간 분석 -->
        ${conversationDuration ? `
        <div style="margin-bottom: 32px; page-break-inside: avoid;">
          <h2 style="font-size: 20px; font-weight: bold; color: #1f2937; border-bottom: 2px solid #3b82f6; padding-bottom: 8px; margin-bottom: 16px;">⏱️ 대화 시간 분석</h2>
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;">
            <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 16px; text-align: center;">
              <div style="font-size: 20px; font-weight: bold; color: #0284c7; margin-bottom: 4px;">
                ${Math.floor(conversationDuration / 60)}:${(conversationDuration % 60).toString().padStart(2, '0')}
              </div>
              <div style="font-size: 13px; color: #0369a1;">총 대화 시간</div>
            </div>
            
            ${averageResponseTime ? `
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; text-align: center;">
              <div style="font-size: 20px; font-weight: bold; color: #16a34a; margin-bottom: 4px;">
                ${averageResponseTime}초
              </div>
              <div style="font-size: 13px; color: #15803d;">평균 응답 시간</div>
            </div>
            ` : ''}

            ${timePerformance ? `
            <div style="background: #fff7ed; border: 1px solid #ffedd5; border-radius: 8px; padding: 16px; text-align: center;">
              <div style="font-size: 16px; font-weight: 600; color: ${
                timePerformance.rating === 'excellent' ? '#16a34a' :
                timePerformance.rating === 'good' ? '#2563eb' :
                timePerformance.rating === 'average' ? '#d97706' : '#dc2626'
              }; margin-bottom: 4px;">
                ${timePerformance.rating === 'excellent' ? '🎯 우수' :
                  timePerformance.rating === 'good' ? '✅ 좋음' :
                  timePerformance.rating === 'average' ? '🔶 보통' : '⚠️ 개선필요'}
              </div>
              <div style="font-size: 11px; color: #9a3412;">${escapeHtml(timePerformance.feedback)}</div>
            </div>
            ` : ''}
          </div>
        </div>
        ` : ''}

        <!-- 1. 성과 분석 -->
        <div style="margin-bottom: 32px; page-break-before: always;">
          <h2 style="font-size: 20px; font-weight: bold; color: #1f2937; border-bottom: 2px solid #4f46e5; padding-bottom: 8px; margin-bottom: 16px;">📊 성과 분석</h2>
          
          ${feedback.detailedFeedback?.evaluationCriteriaSetName ? `
          <div style="background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 8px; padding: 12px; margin-bottom: 16px;">
            <span style="font-size: 14px; color: #4338ca; font-weight: 500;">📋 평가 기준: ${escapeHtml(feedback.detailedFeedback.evaluationCriteriaSetName)}</span>
          </div>
          ` : ''}
          
          <!-- 카테고리별 점수 -->
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; margin-bottom: 24px;">
            ${scores.map((score, idx) => {
              const sNum = typeof score.score === 'number' ? score.score : 0;
              const statusLabel = sNum >= 4 ? '✅ 역량 확인됨' : sNum === 3 ? '🔶 기본 수준' : '⚠️ 집중 개선 필요';
              const statusBg = sNum >= 4 ? '#dcfce7' : sNum === 3 ? '#ffedd5' : '#fee2e2';
              const statusColor = sNum >= 4 ? '#166534' : sNum === 3 ? '#9a3412' : '#991b1b';
              const statusBorder = sNum >= 4 ? '#86efac' : sNum === 3 ? '#fdba74' : '#fca5a5';
              return `
              <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; gap: 8px;">
                  <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
                    <span style="flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; background: #e2e8f0; color: #64748b; border-radius: 50%; font-size: 10px; font-weight: 700;">${idx + 1}</span>
                    <span style="font-size: 13px; font-weight: 600; color: #374151;">${escapeHtml(getTranslatedDimensionName(score.category, score.name))}${score.weight ? ` <span style="font-weight: 400; color: #94a3b8; font-size: 10px;">(${score.weight}%)</span>` : ''}</span>
                  </div>
                  <span style="flex-shrink: 0; background: #dbeafe; color: #1e40af; padding: 2px 7px; border-radius: 4px; font-size: 12px; font-weight: 600;">${score.score || 0}/5</span>
                </div>
                <span style="display: inline-block; font-size: 10px; font-weight: 600; color: ${statusColor}; background: ${statusBg}; border: 1px solid ${statusBorder}; border-radius: 20px; padding: 1px 8px; margin-bottom: 6px;">${statusLabel}</span>
                <p style="font-size: 12px; color: #4b5563; line-height: 1.5; margin: 0;">${escapeHtml(score.feedback)}</p>
              </div>
            `}).join('')}
          </div>

          <!-- 종합 평가 -->
          <div style="margin-bottom: 16px;">
            <h3 style="font-size: 16px; font-weight: 600; color: #374151; margin-bottom: 12px;">📈 종합 평가</h3>

            <!-- 주요 강점 -->
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px; margin-bottom: 10px;">
              <h4 style="font-size: 13px; font-weight: 700; color: #166534; margin: 0 0 10px 0; display: flex; align-items: center; gap: 6px;">
                <span style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; background: #22c55e; color: white; border-radius: 50%; font-size: 10px;">👍</span>
                주요 강점
              </h4>
              <ul style="list-style: none; padding: 0; margin: 0;">
                ${strengths.map((s, i) => `
                  <li style="display: flex; align-items: flex-start; gap: 8px; margin-bottom: 6px;">
                    <span style="flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; background: #bbf7d0; color: #166534; border-radius: 50%; font-size: 10px; font-weight: 700;">${i + 1}</span>
                    <span style="font-size: 12px; color: #166534; line-height: 1.5;">${escapeHtml(s)}</span>
                  </li>
                `).join('')}
              </ul>
            </div>

            <!-- 개선 포인트 -->
            <div style="background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 14px; margin-bottom: 10px;">
              <h4 style="font-size: 13px; font-weight: 700; color: #9a3412; margin: 0 0 10px 0; display: flex; align-items: center; gap: 6px;">
                <span style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; background: #f97316; color: white; border-radius: 50%; font-size: 10px;">⬆</span>
                개선 포인트
              </h4>
              <ul style="list-style: none; padding: 0; margin: 0;">
                ${improvements.map((item, i) => {
                  const labels = ['즉시 실천', '단기', '지속'];
                  const label = labels[i] ?? '지속';
                  return `
                    <li style="display: flex; align-items: flex-start; gap: 8px; margin-bottom: 6px;">
                      <span style="flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; background: #fed7aa; color: #9a3412; border-radius: 50%; font-size: 10px; font-weight: 700;">${i + 1}</span>
                      <span style="font-size: 12px; color: #7c2d12; line-height: 1.5; flex: 1;">${escapeHtml(item)}</span>
                      <span style="flex-shrink: 0; font-size: 10px; background: #fef3c7; color: #92400e; border: 1px solid #fde68a; border-radius: 10px; padding: 1px 6px;">${label}</span>
                    </li>
                  `;
                }).join('')}
              </ul>
            </div>

            <!-- 다음 단계 -->
            <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 14px; margin-bottom: 12px;">
              <h4 style="font-size: 13px; font-weight: 700; color: #1e40af; margin: 0 0 10px 0; display: flex; align-items: center; gap: 6px;">
                <span style="display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; background: #3b82f6; color: white; border-radius: 50%; font-size: 10px;">▶</span>
                다음 단계
              </h4>
              <ul style="list-style: none; padding: 0; margin: 0;">
                ${nextSteps.map((s, i) => `
                  <li style="display: flex; align-items: flex-start; gap: 8px; margin-bottom: 6px;">
                    <span style="flex-shrink: 0; background: #3b82f6; color: white; font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 4px; margin-top: 2px;">Step ${i + 1}</span>
                    <span style="font-size: 12px; color: #1e3a8a; line-height: 1.5;">${escapeHtml(s)}</span>
                  </li>
                `).join('')}
              </ul>
            </div>

            <!-- 종합 의견 -->
            <div style="background: #eef2ff; border-left: 4px solid #6366f1; border-radius: 0 8px 8px 0; padding: 14px;">
              <p style="font-size: 12px; font-weight: 700; color: #4338ca; margin: 0 0 6px 0;">💬 종합 의견</p>
              <p style="font-size: 13px; color: #312e81; line-height: 1.6; margin: 0;">${escapeHtml(feedback.detailedFeedback?.ranking)}</p>
            </div>
          </div>
        </div>

        <!-- 2. 실천 가이드 (행동 개선 포인트 + 대화 스크립트 예시) -->
        <div style="margin-bottom: 32px; page-break-before: always;">
          <h2 style="font-size: 20px; font-weight: bold; color: #1f2937; border-bottom: 2px solid #f59e0b; padding-bottom: 8px; margin-bottom: 20px;">🗂️ 실천 가이드</h2>

          <!-- 2-1. 행동 개선 포인트 -->
          <div style="margin-bottom: 24px;">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 14px;">
              <div style="width: 32px; height: 32px; background: #fef3c7; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0;">💡</div>
              <div>
                <h3 style="font-size: 15px; font-weight: 700; color: #1f2937; margin: 0 0 2px 0;">행동 개선 포인트</h3>
                <p style="font-size: 11px; color: #6b7280; margin: 0;">이번 대화에서 발견된 상황별 구체적 행동 가이드입니다.</p>
              </div>
            </div>
            ${behaviorGuides.length > 0 ? behaviorGuides.map((guide, idx) => `
              <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 14px; margin-bottom: 12px; page-break-inside: avoid;">
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                  <span style="display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; background: #f59e0b; color: white; border-radius: 50%; font-size: 11px; font-weight: 700; flex-shrink: 0;">${idx + 1}</span>
                  <h4 style="font-size: 14px; font-weight: 600; color: #92400e; margin: 0;">${escapeHtml(guide.situation)}</h4>
                </div>
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 10px;">
                  <div style="background: #eff6ff; border: 1px solid #bfdbfe; padding: 10px; border-radius: 6px;">
                    <p style="font-size: 11px; font-weight: 700; color: #4f46e5; margin: 0 0 4px 0; text-transform: uppercase; letter-spacing: 0.05em;">권장 행동</p>
                    <p style="font-size: 12px; color: #374151; margin: 0; line-height: 1.5;">${escapeHtml(guide.action)}</p>
                  </div>
                  <div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 10px; border-radius: 6px;">
                    <p style="font-size: 11px; font-weight: 700; color: #16a34a; margin: 0 0 4px 0; text-transform: uppercase; letter-spacing: 0.05em;">실제 예시</p>
                    <p style="font-size: 12px; color: #166534; margin: 0; line-height: 1.5; font-style: italic;">"${escapeHtml(guide.example)}"</p>
                  </div>
                </div>
                <div style="border-top: 1px solid #fde68a; padding-top: 8px; display: flex; align-items: flex-start; gap: 6px;">
                  <span style="color: #3b82f6; font-size: 12px; flex-shrink: 0;">↑</span>
                  <p style="font-size: 12px; color: #374151; margin: 0;"><strong style="color: #2563eb;">기대 효과: </strong>${escapeHtml(guide.impact)}</p>
                </div>
              </div>
            `).join('') : '<p style="color: #6b7280; font-size: 13px;">구체적인 행동 가이드가 준비 중입니다.</p>'}
          </div>

          <!-- 구분선 -->
          <div style="display: flex; align-items: center; gap: 12px; margin: 20px 0;">
            <div style="flex: 1; height: 1px; background: linear-gradient(to right, transparent, #e2e8f0);"></div>
            <span style="font-size: 11px; font-weight: 600; color: #94a3b8; background: #f8fafc; padding: 4px 12px; border-radius: 20px; border: 1px solid #e2e8f0;">💬 대화 스크립트 예시</span>
            <div style="flex: 1; height: 1px; background: linear-gradient(to left, transparent, #e2e8f0);"></div>
          </div>

          <!-- 2-2. 대화 스크립트 예시 -->
          <div>
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 14px;">
              <div style="width: 32px; height: 32px; background: #cffafe; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0;">💬</div>
              <div>
                <h3 style="font-size: 15px; font-weight: 700; color: #1f2937; margin: 0 0 2px 0;">대화 스크립트 예시</h3>
                <p style="font-size: 11px; color: #6b7280; margin: 0;">좋은 표현과 피해야 할 표현을 비교하여 실전 대화력을 높이세요.</p>
              </div>
            </div>
            ${conversationGuides.length > 0 ? conversationGuides.map((guide, idx) => `
              <div style="background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 8px; padding: 14px; margin-bottom: 12px; page-break-inside: avoid;">
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                  <span style="display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; background: #06b6d4; color: white; border-radius: 50%; font-size: 11px; font-weight: 700; flex-shrink: 0;">${idx + 1}</span>
                  <h4 style="font-size: 14px; font-weight: 600; color: #0f766e; margin: 0;">${escapeHtml(guide.scenario)}</h4>
                </div>
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 10px;">
                  <div style="background: #dcfce7; border: 1px solid #86efac; padding: 10px; border-radius: 6px;">
                    <p style="font-size: 11px; font-weight: 700; color: #16a34a; margin: 0 0 4px 0;">✅ 이렇게 말하세요</p>
                    <p style="font-size: 12px; color: #166534; margin: 0; line-height: 1.5;">${escapeHtml(guide.goodExample)}</p>
                  </div>
                  <div style="background: #fef2f2; border: 1px solid #fecaca; padding: 10px; border-radius: 6px;">
                    <p style="font-size: 11px; font-weight: 700; color: #dc2626; margin: 0 0 4px 0;">❌ 이런 표현은 피하세요</p>
                    <p style="font-size: 12px; color: #991b1b; margin: 0; line-height: 1.5;">${escapeHtml(guide.badExample)}</p>
                  </div>
                </div>
                ${(guide.keyPoints || []).length > 0 ? `
                  <div style="border-top: 1px solid #99f6e4; padding-top: 8px;">
                    <p style="font-size: 11px; font-weight: 700; color: #6b7280; margin: 0 0 6px 0;">🔑 핵심 포인트</p>
                    <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                      ${(guide.keyPoints || []).map(point => `<span style="font-size: 11px; background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; padding: 3px 10px; border-radius: 20px;">${escapeHtml(point)}</span>`).join('')}
                    </div>
                  </div>
                ` : ''}
              </div>
            `).join('') : '<p style="color: #6b7280; font-size: 13px;">맞춤형 대화 가이드가 준비 중입니다.</p>'}
          </div>
        </div>

        <!-- 4. 개발 계획 -->
        <div style="margin-bottom: 32px; page-break-before: always;">
          <h2 style="font-size: 20px; font-weight: bold; color: #1f2937; border-bottom: 2px solid #8b5cf6; padding-bottom: 8px; margin-bottom: 16px;">📈 개발 계획</h2>
          ${developmentPlan ? `
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 20px;">
              <!-- 단기 목표 -->
              <div style="background: #f0fdf4; border-left: 4px solid #22c55e; padding: 16px; border-radius: 0 8px 8px 0;">
                <h3 style="font-size: 15px; font-weight: 600; color: #16a34a; margin-bottom: 12px;">📅 단기 목표 (1-2주)</h3>
                ${(developmentPlan.shortTerm || []).map(item => `
                  <div style="background: white; padding: 12px; border-radius: 4px; margin-bottom: 8px;">
                    <h4 style="font-size: 13px; font-weight: 600; color: #166534; margin-bottom: 8px;">${escapeHtml(item.goal)}</h4>
                    <ul style="list-style: none; padding: 0; margin: 0 0 8px 0;">
                      ${(item.actions || []).map(a => `<li style="font-size: 12px; color: #4b5563;">→ ${escapeHtml(a)}</li>`).join('')}
                    </ul>
                    <div style="font-size: 11px; background: #dcfce7; padding: 4px 8px; border-radius: 4px; color: #166534;">측정지표: ${escapeHtml(item.measurable)}</div>
                  </div>
                `).join('')}
              </div>
              
              <!-- 중기 목표 -->
              <div style="background: #eff6ff; border-left: 4px solid #3b82f6; padding: 16px; border-radius: 0 8px 8px 0;">
                <h3 style="font-size: 15px; font-weight: 600; color: #2563eb; margin-bottom: 12px;">📆 중기 목표 (1-2개월)</h3>
                ${(developmentPlan.mediumTerm || []).map(item => `
                  <div style="background: white; padding: 12px; border-radius: 4px; margin-bottom: 8px;">
                    <h4 style="font-size: 13px; font-weight: 600; color: #1e40af; margin-bottom: 8px;">${escapeHtml(item.goal)}</h4>
                    <ul style="list-style: none; padding: 0; margin: 0 0 8px 0;">
                      ${(item.actions || []).map(a => `<li style="font-size: 12px; color: #4b5563;">→ ${escapeHtml(a)}</li>`).join('')}
                    </ul>
                    <div style="font-size: 11px; background: #dbeafe; padding: 4px 8px; border-radius: 4px; color: #1e40af;">측정지표: ${escapeHtml(item.measurable)}</div>
                  </div>
                `).join('')}
              </div>
              
              <!-- 장기 목표 -->
              <div style="background: #faf5ff; border-left: 4px solid #a855f7; padding: 16px; border-radius: 0 8px 8px 0;">
                <h3 style="font-size: 15px; font-weight: 600; color: #7c3aed; margin-bottom: 12px;">🗓️ 장기 목표 (3-6개월)</h3>
                ${(developmentPlan.longTerm || []).map(item => `
                  <div style="background: white; padding: 12px; border-radius: 4px; margin-bottom: 8px;">
                    <h4 style="font-size: 13px; font-weight: 600; color: #6b21a8; margin-bottom: 8px;">${escapeHtml(item.goal)}</h4>
                    <ul style="list-style: none; padding: 0; margin: 0 0 8px 0;">
                      ${(item.actions || []).map(a => `<li style="font-size: 12px; color: #4b5563;">→ ${escapeHtml(a)}</li>`).join('')}
                    </ul>
                    <div style="font-size: 11px; background: #f3e8ff; padding: 4px 8px; border-radius: 4px; color: #6b21a8;">측정지표: ${escapeHtml(item.measurable)}</div>
                  </div>
                `).join('')}
              </div>
            </div>
            
            <!-- 추천 리소스 -->
            ${(developmentPlan.recommendedResources || []).length > 0 ? `
              <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px;">
                <h3 style="font-size: 15px; font-weight: 600; color: #374151; margin-bottom: 12px;">📚 추천 학습 자료</h3>
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;">
                  ${(developmentPlan.recommendedResources || []).map(r => `
                    <div style="background: white; padding: 8px 12px; border-radius: 4px; font-size: 13px; color: #4b5563;">📖 ${escapeHtml(r)}</div>
                  `).join('')}
                </div>
              </div>
            ` : ''}
          ` : '<p style="color: #6b7280;">개발 계획이 준비 중입니다.</p>'}
        </div>

        ${sequenceAnalysis ? `
        <!-- 5. 전략 평가 -->
        <div style="margin-bottom: 32px; page-break-inside: avoid;">
          <h2 style="font-size: 20px; font-weight: bold; color: #1f2937; border-bottom: 2px solid #ec4899; padding-bottom: 8px; margin-bottom: 16px;">🎮 전략 평가</h2>
          <div style="background: #fdf4ff; border-left: 4px solid #a855f7; padding: 20px; border-radius: 0 8px 8px 0;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
              <h3 style="font-size: 16px; font-weight: 600; color: #7c3aed;">전략 점수</h3>
              <span style="background: #e9d5ff; color: #7c3aed; padding: 8px 16px; border-radius: 8px; font-size: 18px; font-weight: bold;">
                ${escapeHtml(String(sequenceAnalysis.strategicScore ?? '평가 대기중'))}
              </span>
            </div>
            <p style="font-size: 14px; color: #6b21a8; margin-bottom: 16px;">${escapeHtml(sequenceAnalysis.strategicRationale)}</p>
            
            ${sequenceAnalysis.sequenceEffectiveness ? `
              <div style="margin-bottom: 16px;">
                <h4 style="font-size: 14px; font-weight: 600; color: #2563eb; margin-bottom: 8px;">🎯 순서 선택의 효과성</h4>
                <p style="font-size: 13px; color: #374151; background: white; padding: 12px; border-radius: 4px;">${escapeHtml(sequenceAnalysis.sequenceEffectiveness)}</p>
              </div>
            ` : ''}
            
            ${sequenceAnalysis.strategicInsights ? `
              <div style="margin-bottom: 16px;">
                <h4 style="font-size: 14px; font-weight: 600; color: #eab308; margin-bottom: 8px;">💡 전략적 통찰</h4>
                <p style="font-size: 13px; color: #374151; background: #fef9c3; padding: 12px; border-radius: 4px; border-left: 4px solid #eab308;">${escapeHtml(sequenceAnalysis.strategicInsights)}</p>
              </div>
            ` : ''}
            
            ${(sequenceAnalysis.alternativeApproaches || []).length > 0 ? `
              <div>
                <h4 style="font-size: 14px; font-weight: 600; color: #16a34a; margin-bottom: 8px;">🛤️ 대안적 접근법</h4>
                ${(sequenceAnalysis.alternativeApproaches || []).map((a: string, i: number) => `
                  <div style="display: flex; align-items: flex-start; gap: 8px; background: #dcfce7; padding: 12px; border-radius: 4px; margin-bottom: 8px;">
                    <span style="background: #22c55e; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px;">${i + 1}</span>
                    <p style="font-size: 13px; color: #166534; margin: 0;">${escapeHtml(a)}</p>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        </div>
        ` : ''}

        <!-- 푸터 -->
        <div style="text-align: center; padding-top: 20px; border-top: 1px solid #e2e8f0; color: #9ca3af; font-size: 12px;">
          발행: ${feedback.createdAt ? new Date(feedback.createdAt).toLocaleDateString('ko-KR') : new Date().toLocaleDateString('ko-KR')} · 보고서 ID: ${conversationId.slice(0, 8).toUpperCase()} · AI 기반 개인 맞춤 개발 보고서
        </div>
        </div><!-- /본문 -->
      </div>
    `;
  };

  // HTML 파일 다운로드 - 오프라인에서 열어서 PDF로 인쇄 가능
  const handleDownloadHtml = () => {
    if (!feedback) return;
    
    setIsExportingPdf(true);
    
    try {
      const printableContent = generatePrintableContent();
      
      if (!printableContent || printableContent.trim() === '') {
        throw new Error('보고서 콘텐츠가 비어 있습니다.');
      }
      
      const fullHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(userName)} 맞춤 보고서 - ${escapeHtml(scenario.title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: 'Noto Sans KR', sans-serif; 
      padding: 40px; 
      background: #f8fafc; 
      max-width: 900px; 
      margin: 0 auto;
    }
    @media print {
      body { 
        background: white; 
        padding: 20px;
        -webkit-print-color-adjust: exact; 
        print-color-adjust: exact; 
      }
      .no-print { display: none !important; }
    }
    .print-instructions {
      background: linear-gradient(135deg, #3b82f6 0%, #6366f1 100%);
      color: white;
      padding: 20px 30px;
      border-radius: 12px;
      margin-bottom: 30px;
      text-align: center;
    }
    .print-instructions h2 { font-size: 18px; margin-bottom: 10px; }
    .print-instructions p { font-size: 14px; opacity: 0.9; }
    .print-instructions button {
      background: white;
      color: #3b82f6;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      margin-top: 15px;
    }
    .print-instructions button:hover { background: #f1f5f9; }
  </style>
</head>
<body>
  <div class="print-instructions no-print">
    <h2>📄 개인 맞춤 개발 보고서</h2>
    <p>이 파일을 인쇄하거나 PDF로 저장하려면 아래 버튼을 클릭하세요.</p>
    <p>또는 Ctrl+P (Mac: Cmd+P)를 눌러 인쇄 대화상자를 열 수 있습니다.</p>
    <button onclick="window.print()">🖨️ 인쇄 / PDF 저장</button>
  </div>
  ${printableContent}
  <div class="no-print" style="text-align: center; margin-top: 30px; padding: 20px; border-top: 1px solid #e2e8f0;">
    <p style="color: #9ca3af; font-size: 12px;">PDF로 저장하려면 인쇄 대화상자에서 "PDF로 저장" 또는 "Microsoft Print to PDF"를 선택하세요.</p>
  </div>
</body>
</html>`;
      
      const safeFilename = scenario.title.replace(/[<>:"/\\|?*]/g, '_');
      const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `개발보고서_${safeFilename}_${new Date().toLocaleDateString('ko-KR').replace(/\./g, '-')}.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      toast({
        title: "HTML 파일 다운로드 완료",
        description: "다운로드된 파일을 열어서 '인쇄/PDF 저장' 버튼을 클릭하세요.",
      });
    } catch (error) {
      console.error('HTML 다운로드 오류:', error);
      toast({
        title: "다운로드 실패",
        description: error instanceof Error ? error.message : "파일 다운로드 중 오류가 발생했습니다.",
        variant: "destructive"
      });
    } finally {
      setIsExportingPdf(false);
    }
  };

  // 브라우저 기본 인쇄 기능 사용 - 새 창에서 인쇄
  const handlePrint = () => {
    if (!feedback) return;
    
    try {
      const printableContent = generatePrintableContent();
      
      if (!printableContent || printableContent.trim() === '') {
        toast({
          title: "인쇄 실패",
          description: "보고서 콘텐츠가 비어 있습니다.",
          variant: "destructive"
        });
        return;
      }
      
      // 새 창 열기
      const printWindow = window.open('', '_blank', 'width=900,height=800');
      if (!printWindow) {
        toast({
          title: "팝업 차단됨",
          description: "브라우저에서 팝업을 허용해주세요. 또는 'HTML 다운로드' 버튼을 사용해주세요.",
          variant: "destructive"
        });
        return;
      }
      
      printWindow.document.write(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(userName)} 맞춤 보고서 - ${escapeHtml(scenario.title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Noto Sans KR', sans-serif; padding: 30px; background: white; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; padding: 20px; }
      .no-print { display: none !important; }
    }
    .print-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 15px;
      border-bottom: 2px solid #e2e8f0;
    }
    .print-header h1 { font-size: 18px; color: #1e3a5f; }
    .print-actions { display: flex; gap: 10px; }
    .print-actions button {
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      border: none;
    }
    .btn-print { background: #3b82f6; color: white; }
    .btn-print:hover { background: #2563eb; }
    .btn-close { background: #6b7280; color: white; }
    .btn-close:hover { background: #4b5563; }
  </style>
</head>
<body>
  <div class="print-header no-print">
    <h1>${escapeHtml(userName)}님 맞춤 보고서</h1>
    <div class="print-actions">
      <button class="btn-print" onclick="window.print()">🖨️ 인쇄 / PDF 저장</button>
      <button class="btn-close" onclick="window.close()">닫기</button>
    </div>
  </div>
  ${printableContent}
</body>
</html>`);
      printWindow.document.close();
      
      toast({
        title: "인쇄 창 열림",
        description: "새 창에서 '인쇄/PDF 저장' 버튼을 클릭하세요.",
      });
      
    } catch (error) {
      console.error('인쇄 오류:', error);
      toast({
        title: "인쇄 오류",
        description: "HTML 다운로드 버튼을 사용해서 파일을 다운로드한 후 인쇄해주세요.",
        variant: "destructive"
      });
    }
  };

  // 로딩 중이거나 피드백 생성 중일 때 로딩 표시
  // hasRequestedFeedback이 true이면 피드백이 표시될 때까지 로딩 상태 유지
  if (isLoading || generateFeedbackMutation.isPending || (hasRequestedFeedback && !feedback)) {
    return (
      <div className="text-center py-16" data-testid="feedback-loading">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-corporate-600 mx-auto mb-4"></div>
        <h2 className="text-xl font-semibold text-slate-900 mb-2">{t('report.analyzing', '개인 맞춤 분석 중...')}</h2>
        <p className="text-slate-600">{t('report.analyzingDesc', 'AI가 대화를 심층 분석하여 맞춤형 개발 계획을 수립하고 있습니다.')}</p>
      </div>
    );
  }

  // 피드백이 없는 경우 자동 생성하지 않고, 사용자가 명시적으로 생성 버튼을 클릭하도록 안내
  // (마이페이지에서 "피드백 보기" 버튼을 누를 때마다 재생성되는 문제 방지)

  // 피드백이 없는 경우 - 아직 생성되지 않았음을 안내
  if (!feedback && !isLoading && !hasRequestedFeedback && error?.message === "FEEDBACK_NOT_FOUND") {
    return (
      <div className="text-center py-16" data-testid="feedback-not-found">
        <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <i className="fas fa-clipboard-list text-blue-600 text-xl"></i>
        </div>
        <h2 className="text-xl font-semibold text-slate-900 mb-2">{t('report.notGenerated', '피드백이 아직 생성되지 않았습니다')}</h2>
        <p className="text-slate-600 mb-4">{t('report.notGeneratedDesc', '대화를 완료한 후 피드백을 생성할 수 있습니다.')}</p>
        {!isAdminView && (
          <div className="space-y-2">
            <Button 
              onClick={handleGenerateFeedback} 
              data-testid="generate-feedback"
              disabled={generateFeedbackMutation.isPending}
            >
              {generateFeedbackMutation.isPending ? t('report.generating', '피드백 생성 중...') : t('report.generate', '피드백 생성하기')}
            </Button>
            <Button 
              variant="outline" 
              onClick={() => window.location.href = '/mypage'} 
              data-testid="back-to-mypage"
            >
              {t('report.backToMyPage', '마이페이지로 돌아가기')}
            </Button>
          </div>
        )}
      </div>
    );
  }

  // 기타 오류가 발생한 경우
  if (!feedback && !isLoading && !generateFeedbackMutation.isPending && error && error.message !== "FEEDBACK_NOT_FOUND") {
    return (
      <div className="text-center py-16" data-testid="feedback-error">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <i className="fas fa-exclamation-triangle text-red-600 text-xl"></i>
        </div>
        <h2 className="text-xl font-semibold text-slate-900 mb-2">{t('report.error', '오류가 발생했습니다')}</h2>
        <p className="text-slate-600 mb-4">{t('report.feedbackLoadError', '피드백을 불러오는 중 오류가 발생했습니다. 다시 시도해주세요.')}</p>
        <div className="space-y-2">
          <Button onClick={() => refetch()} data-testid="refetch-feedback">
            {t('common.retry', '다시 시도')}
          </Button>
          {!isAdminView && <Button 
            variant="outline" 
            onClick={() => window.location.href = '/mypage'} 
            data-testid="back-to-mypage"
          >
            {t('report.backToMyPage', '마이페이지로 돌아가기')}
          </Button>}
        </div>
      </div>
    );
  }

  const getScoreColor = (score: number) => {
    if (score >= 4) return "indigo";
    if (score >= 3) return "sky";
    if (score >= 2) return "amber";
    return "rose";
  };

  const getScoreBorderColor = (score: number) => {
    if (score >= 4) return "border-l-indigo-500";
    if (score >= 3) return "border-l-sky-400";
    if (score >= 2) return "border-l-amber-400";
    return "border-l-rose-400";
  };

  const getScoreHex = (score: number) => {
    if (score >= 4) return "#4f46e5";
    if (score >= 3) return "#0ea5e9";
    if (score >= 2) return "#f59e0b";
    return "#f43f5e";
  };

  const getScoreLabel = (score: number) => {
    if (score >= 5) return t('report.scoreExcellent', '탁월');
    if (score >= 4) return t('report.scoreGood', '우수');
    if (score >= 3) return t('report.scoreAverage', '보통');
    if (score >= 2) return t('report.scoreNeedsImprovement', '개선 필요');
    return t('report.scorePoor', '미흡');
  };

  const toggleCheckItem = (key: string) => {
    setCheckedItems(prev => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem(`checklist_${conversationId}`, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const getPrevSessionDelta = (category: string): number | null => {
    if (feedbackHistory.length < 2) return null;
    // 현재 보고서의 conversationId로 history 내 위치를 정확히 찾아 직전 세션과 비교
    const currentIdx = feedbackHistory.findIndex((h: any) => h.personaRunId === conversationId);
    // 현재 보고서가 history에 없으면 (최근 5건 밖) 비교 불가 처리
    if (currentIdx < 0) return null;
    const currentSession = feedbackHistory[currentIdx];
    const prevSession = feedbackHistory[currentIdx + 1];
    if (!prevSession || !currentSession) return null;
    const prevScore = prevSession.scores?.find((s: any) => s.category === category)?.score;
    const currScore = currentSession.scores?.find((s: any) => s.category === category)?.score;
    if (prevScore === undefined || currScore === undefined) return null;
    return currScore - prevScore;
  };

  // 현재 세션이 history에 포함되어 있는지 여부 (비교 가능 여부 판단)
  const isCurrentSessionInHistory = feedbackHistory.some((h: any) => h.personaRunId === conversationId);

  const extractSentences = (text: string, maxSentences: number = 2): string => {
    if (!text) return '';
    const sentenceEndings = /(?<=[.!?。。！？])\s+/g;
    const sentences = text.split(sentenceEndings).filter(s => s.trim());
    if (sentences.length <= maxSentences) return text;
    return sentences.slice(0, maxSentences).join(' ');
  };

  const getDifficultyTag = (item: { goal: string; actions: string[] }) => {
    const totalLen = item.goal.length + item.actions.join('').length;
    const actionCount = item.actions.length;
    if (totalLen > 150 || actionCount >= 4) return { label: '도전', cls: 'bg-red-100 text-red-700 border-red-200' };
    if (totalLen > 80 || actionCount >= 3) return { label: '보통', cls: 'bg-yellow-100 text-yellow-700 border-yellow-200' };
    return { label: '쉬움', cls: 'bg-green-100 text-green-700 border-green-200' };
  };

  const getOverallGrade = (score: number) => {
    if (score >= 90) return { grade: "A+", color: "text-green-600", bg: "bg-green-50" };
    if (score >= 80) return { grade: "A", color: "text-green-600", bg: "bg-green-50" };
    if (score >= 70) return { grade: "B", color: "text-blue-600", bg: "bg-blue-50" };
    if (score >= 60) return { grade: "C", color: "text-yellow-600", bg: "bg-yellow-50" };
    return { grade: "D", color: "text-red-600", bg: "bg-red-50" };
  };

  const overallGrade = getOverallGrade(feedback?.overallScore || 0);
  
  // 애니메이션 제거하고 바로 값 표시 (hooks 오류 방지)
  const displayOverallScore = getDisplayValue(feedback?.overallScore || 0);

  const radarData = (feedback?.scores || []).map(s => ({
    subject: getTranslatedDimensionName(s.category, s.name),
    value: s.score ?? 0,
    fullMark: 5,
  }));

  const CustomRadarTick = ({ payload, x, y, cx, cy }: any) => {
    const item = radarData.find(d => d.subject === payload.value);
    const score = item?.value ?? 0;
    const color = getScoreHex(score);
    const midX = cx ?? 0;
    const anchor = Math.abs(x - midX) < 10 ? 'middle' : x > midX ? 'start' : 'end';
    return (
      <g>
        <text x={x} y={y - 7} textAnchor={anchor} fill="#64748b" fontSize={10}>{payload.value}</text>
        <text x={x} y={y + 8} textAnchor={anchor} fill={color} fontSize={12} fontWeight="700">{score}/5</text>
      </g>
    );
  };

  // feedback가 없으면 로딩 화면을 표시
  if (!feedback) {
    return (
      <div className="text-center py-16" data-testid="feedback-loading">
        <div className="relative mb-8">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-corporate-600 mx-auto"></div>
          <div className="animate-pulse absolute inset-0 rounded-full h-16 w-16 border-2 border-corporate-200 mx-auto"></div>
        </div>
        <h2 className="text-xl font-semibold text-slate-900 mb-2 animate-pulse-gentle">{t('report.analyzing', '개인 맞춤 분석 중...')}</h2>
        <p className="text-slate-600 mb-4">{t('report.analyzingDesc', 'AI가 대화를 심층 분석하여 맞춤형 개발 계획을 수립하고 있습니다.')}</p>
        <div className="flex justify-center space-x-1 mt-6">
          <div className="w-2 h-2 bg-corporate-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
          <div className="w-2 h-2 bg-corporate-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
          <div className="w-2 h-2 bg-corporate-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
        </div>
      </div>
    );
  }

  return (
    <div ref={reportRef} className="max-w-6xl mx-auto space-y-6 print-report-container" data-testid="personal-development-report">
      {/* PDF 전용 헤더 (인쇄/PDF 시에만 표시) */}
      <div className="pdf-header hidden print:block">
        {t('report.pdfTitle', '개인 맞춤 개발 보고서')} - {scenario.title}
      </div>
      
      {/* 화면용 헤더 (메타정보 강화) */}
      <div 
        className="bg-gradient-to-r from-corporate-600 to-corporate-700 rounded-xl p-6 text-white transform transition-all duration-700 hover:shadow-2xl screen-only"
        style={{ 
          opacity: 0,
          animation: `fadeInUp 0.8s ease-out forwards`
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <div></div>
          {!isAdminView && <Button 
            onClick={() => window.location.href = '/mypage'}
            variant="ghost"
            size="sm"
            className="text-white/80 hover:text-white hover:bg-white/10"
            data-testid="mypage-button"
          >
            <i className="fas fa-user mr-2"></i>
            {t('report.toMyPage', '마이페이지로')}
          </Button>}
        </div>
        <div className="flex items-center justify-between">
          <div 
            style={{ 
              opacity: 0,
              animation: `slideInRight 0.8s ease-out 0.3s forwards`
            }}
          >
            <h1 className="text-2xl font-bold mb-2" data-testid="report-title">{t('report.title', '{{name}}님 맞춤 보고서', { name: userName })}</h1>
            <p className="text-corporate-100">{t('report.scenario', '시나리오')} : {scenario.title}</p>
            <p className="text-corporate-100 text-sm mt-1">{t('report.conversationPartner', '대화 상대')} : {getPersonaFullInfo()}</p>
          </div>
          <div 
            className={`${overallGrade.bg} ${overallGrade.color} px-6 py-4 rounded-lg text-center min-w-[120px] transform transition-all duration-1000 hover:scale-110 hover:shadow-lg`}
            style={{ 
              opacity: 0,
              animation: `fadeInUp 0.8s ease-out 0.6s forwards, bounce-once 0.8s ease-out 2.5s`
            }}
          >
            <div className="text-3xl font-bold transition-all duration-500" data-testid="overall-grade">{overallGrade.grade}</div>
            <div className="text-sm font-medium transition-all duration-1000">{displayOverallScore}{t('report.points', '점')}</div>
            <div className="text-xs">{t('report.overallScore', '종합 점수')}</div>
          </div>
        </div>
        {/* 메타정보 행 */}
        <div className="mt-4 pt-4 border-t border-white/20 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-white/80">
          <div className="flex flex-col gap-0.5">
            <span className="font-semibold text-white/60 uppercase tracking-wide">발행 일시</span>
            <span>{feedback?.createdAt ? new Date(feedback.createdAt).toLocaleString('ko-KR') : new Date().toLocaleString('ko-KR')}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-semibold text-white/60 uppercase tracking-wide">보고서 ID</span>
            <span className="font-mono">{conversationId.slice(0, 8).toUpperCase()}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-semibold text-white/60 uppercase tracking-wide">난이도</span>
            <span>{['', '입문', '기본', '심화', '전문가'][scenario.difficulty as number] || '기본'}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-semibold text-white/60 uppercase tracking-wide">대화 모드</span>
            <span>{
              currentConversation?.mode === 'realtime_voice' ? '실시간 음성' :
              currentConversation?.mode === 'tts' ? 'TTS 음성' :
              '텍스트'
            }</span>
          </div>
        </div>

        {/* 역량 미니 KPI 바 */}
        {(feedback?.scores?.length ?? 0) > 0 && (
          <div className="mt-4 pt-4 border-t border-white/20">
            <p className="text-[10px] font-semibold text-white/50 uppercase tracking-widest mb-2">역량별 점수 요약</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
              {feedback!.scores.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[11px] text-white/70 truncate w-24 flex-shrink-0">{getTranslatedDimensionName(s.category, s.name)}</span>
                  <div className="flex-1 h-1.5 bg-white/20 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-1000"
                      style={{ width: `${((s.score ?? 0) / 5) * 100}%`, backgroundColor: 'rgba(255,255,255,0.75)' }}
                    />
                  </div>
                  <span className="text-[11px] font-bold text-white/90 w-5 text-right flex-shrink-0">{s.score ?? 0}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 이그제큐티브 서머리 카드 */}
      {feedback && (() => {
        const scores = feedback.scores || [];
        const maxScore = scores.reduce((best: any, s: any) => (!best || s.score > best.score) ? s : best, null);
        const minScore = scores.reduce((worst: any, s: any) => (!worst || s.score < worst.score) ? s : worst, null);
        const summary = feedback.detailedFeedback?.summary || feedback.detailedFeedback?.ranking || '';
        const topImprovement = feedback.detailedFeedback?.improvements?.[0] || '';
        return (
          <Card className="border-0 shadow-lg bg-gradient-to-br from-indigo-50 to-purple-50 screen-only" data-testid="executive-summary">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-bold text-indigo-800 flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-indigo-600 text-white text-xs">★</span>
                이 보고서의 핵심 (Executive Summary)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white rounded-xl p-4 border border-indigo-100">
                  <div className="text-xs font-bold text-indigo-600 mb-2 uppercase tracking-wide flex items-center gap-1">
                    <i className="fas fa-align-left text-indigo-400"></i> 총평 요약
                  </div>
                  <p className="text-sm text-slate-700 leading-relaxed">{extractSentences(summary, 2) || '종합 평가를 확인하세요.'}</p>
                </div>
                <div className="bg-white rounded-xl p-4 border border-green-100">
                  <div className="text-xs font-bold text-green-600 mb-2 uppercase tracking-wide flex items-center gap-1">
                    <i className="fas fa-star text-green-400"></i> 핵심 강점
                  </div>
                  {maxScore && (
                    <>
                      <div className="text-lg font-bold text-green-700 mb-1">{getTranslatedDimensionName(maxScore.category, maxScore.name)}</div>
                      <div className="inline-flex items-center gap-1 bg-green-100 text-green-800 text-xs font-semibold px-2 py-0.5 rounded-full mb-2">점수 {maxScore.score}/5</div>
                      <p className="text-xs text-slate-600 leading-relaxed">{extractSentences(maxScore.feedback, 2)}</p>
                    </>
                  )}
                </div>
                <div className="bg-white rounded-xl p-4 border border-orange-100">
                  <div className="text-xs font-bold text-orange-600 mb-2 uppercase tracking-wide flex items-center gap-1">
                    <i className="fas fa-bullseye text-orange-400"></i> 1순위 개선 과제
                  </div>
                  {minScore && (
                    <>
                      <div className="text-sm font-bold text-orange-700 mb-1">{getTranslatedDimensionName(minScore.category, minScore.name)}</div>
                      <div className="inline-flex items-center gap-1 bg-orange-100 text-orange-800 text-xs font-semibold px-2 py-0.5 rounded-full mb-2">점수 {minScore.score}/5</div>
                    </>
                  )}
                  <p className="text-xs text-slate-600 leading-relaxed">{extractSentences(topImprovement, 2) || '개선 포인트를 확인하세요.'}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* 대화 시간 분석 카드 (새로 추가) */}
      {feedback?.detailedFeedback?.conversationDuration && (
        <Card className="mb-6 border-blue-200 bg-blue-50 screen-only">
          <CardHeader>
            <CardTitle className="text-lg flex items-center text-blue-800">
              <i className="fas fa-clock mr-2"></i>
              {t('report.timeAnalysis', '대화 시간 분석')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
              <div className="bg-white rounded-lg p-4">
                <div className="text-2xl font-bold text-blue-600">
                  {(() => {
                    const minutes = Math.floor(feedback.detailedFeedback.conversationDuration / 60);
                    const seconds = feedback.detailedFeedback.conversationDuration % 60;
                    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
                  })()}
                </div>
                <div className="text-sm text-slate-600">{t('report.totalDuration', '총 대화 시간')}</div>
              </div>
              {feedback?.detailedFeedback?.averageResponseTime && (
                <div className="bg-white rounded-lg p-4">
                  <div className="text-2xl font-bold text-green-600">
                    {feedback.detailedFeedback.averageResponseTime}초
                  </div>
                  <div className="text-sm text-slate-600">{t('report.avgResponseTime', '평균 응답 시간')}</div>
                </div>
              )}
              {feedback?.detailedFeedback?.timePerformance && (
                <div className="bg-white rounded-lg p-4">
                  <div className={`text-lg font-medium ${
                    feedback.detailedFeedback.timePerformance.rating === 'excellent' ? 'text-green-600' :
                    feedback.detailedFeedback.timePerformance.rating === 'good' ? 'text-blue-600' :
                    feedback.detailedFeedback.timePerformance.rating === 'average' ? 'text-yellow-600' : 'text-red-600'
                  }`}>
                    {feedback.detailedFeedback.timePerformance.rating === 'excellent' ? t('report.ratingExcellent', '🎯 우수') :
                     feedback.detailedFeedback.timePerformance.rating === 'good' ? t('report.ratingGood', '✅ 좋음') :
                     feedback.detailedFeedback.timePerformance.rating === 'average' ? t('report.ratingAverage', '🔶 보통') : t('report.ratingNeedsWork', '⚠️ 개선필요')}
                  </div>
                  <div className="text-xs text-slate-600 mt-1">
                    {feedback.detailedFeedback.timePerformance.feedback}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="scores" className="space-y-6">
        <TabsList 
          className={`flex flex-wrap justify-center gap-1 sm:grid sm:w-full ${feedback?.detailedFeedback?.sequenceAnalysis ? 'sm:grid-cols-4' : 'sm:grid-cols-3'} transform transition-all duration-500 screen-only h-auto p-1`}
          style={{ 
            opacity: 0,
            animation: `fadeInUp 0.6s ease-out 1s forwards`
          }}
        >
          <TabsTrigger value="scores" data-testid="tab-scores" className="transition-all duration-300 hover:scale-105 text-xs sm:text-sm px-2 sm:px-3 py-1.5 whitespace-nowrap">{t('report.tabs.scores', '성과 분석')}</TabsTrigger>
          <TabsTrigger value="behavior" data-testid="tab-behavior" className="transition-all duration-300 hover:scale-105 text-xs sm:text-sm px-2 sm:px-3 py-1.5 whitespace-nowrap">{t('report.tabs.practiceGuide', '실천 가이드')}</TabsTrigger>
          <TabsTrigger value="development" data-testid="tab-development" className="transition-all duration-300 hover:scale-105 text-xs sm:text-sm px-2 sm:px-3 py-1.5 whitespace-nowrap">{t('report.tabs.development', '개발 계획')}</TabsTrigger>
          {feedback?.detailedFeedback?.sequenceAnalysis && (
            <TabsTrigger value="strategy" data-testid="tab-strategy" className="transition-all duration-300 hover:scale-105 text-xs sm:text-sm px-2 sm:px-3 py-1.5 whitespace-nowrap">{t('report.tabs.strategy', '전략 평가')}</TabsTrigger>
          )}
        </TabsList>

        {/* 성과 분석 */}
        <TabsContent value="scores" className="space-y-6 print-show-all">
          <h2 className="print-section-title hidden print:block">📊 {t('report.tabs.scores', '성과 분석')}</h2>

          {/* 2단 레이아웃: 레이더 차트(좌) + 역량 카드(우) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">

            {/* 좌: 레이더 차트 + 평가 기준 뱃지 — 우측 카드 높이에 맞게 stretch */}
            <div className="flex flex-col gap-3">
              {(feedback?.scores?.length ?? 0) > 0 && (
                <Card className="flex flex-col flex-1 shadow-sm" data-testid="radar-chart-card">
                  <CardHeader className="pb-1 pt-4 px-4 flex-shrink-0">
                    <CardTitle className="text-sm font-semibold text-slate-600 uppercase tracking-wide flex items-center gap-2">
                      <i className="fas fa-chart-area text-indigo-400"></i>
                      역량 레이더 차트
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col flex-1 min-h-0 pt-2 px-2 pb-4">
                    <div className="flex-1 min-h-[220px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart
                          data={radarData}
                          cx="50%"
                          cy="50%"
                          outerRadius="52%"
                        >
                          <PolarGrid stroke="#e2e8f0" />
                          <PolarAngleAxis dataKey="subject" tick={<CustomRadarTick />} />
                          <PolarRadiusAxis domain={[0, 5]} tick={false} axisLine={false} />
                          <Radar
                            name="역량"
                            dataKey="value"
                            stroke="#4f46e5"
                            fill="#4f46e5"
                            fillOpacity={0.15}
                            strokeWidth={2}
                            dot={{ r: 3, fill: '#4f46e5', strokeWidth: 0 }}
                          />
                          <Tooltip
                            formatter={(value: any) => [`${value}/5점`, '역량 점수']}
                            contentStyle={{ fontSize: 12, borderRadius: 8 }}
                          />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              )}
              {feedback?.detailedFeedback?.evaluationCriteriaSetName && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 flex items-center gap-2 flex-shrink-0 screen-only">
                  <i className="fas fa-clipboard-check text-indigo-500 text-sm"></i>
                  <span className="text-xs font-medium text-slate-600">
                    {t('report.evaluationCriteria', '평가 기준')}: <span className="text-indigo-700">{feedback.detailedFeedback.evaluationCriteriaSetName}</span>
                  </span>
                </div>
              )}
            </div>

            {/* 우: 역량별 점수 카드 (세로 스택) */}
            <div className="space-y-3">
              {feedback?.scores?.map((score, index) => {
                const scoreNum = typeof score.score === 'number' ? score.score : 0;
                const progressPct = (scoreNum / 5) * 100;
                const delta = getPrevSessionDelta(score.category);
                const hexColor = getScoreHex(scoreNum);
                const levelLabel = scoreNum >= 4 ? '우수' : scoreNum >= 3 ? '보통' : scoreNum >= 2 ? '개선 필요' : '미흡';

                return (
                  <div
                    key={index}
                    className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden"
                    style={{
                      borderLeftWidth: 4,
                      borderLeftColor: hexColor,
                      opacity: 0,
                      animation: `fadeInUp 0.5s ease-out ${index * 150}ms forwards`
                    }}
                    data-testid={`score-card-${index}`}
                  >
                    <div className="px-4 pt-3 pb-2">
                      {/* 헤더 행 */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <i className={`${score.icon} text-sm flex-shrink-0`} style={{ color: hexColor }}></i>
                          <span className="text-sm font-semibold text-slate-800 truncate">
                            {getTranslatedDimensionName(score.category, score.name)}
                          </span>
                          {score.weight && <span className="text-xs text-slate-400 flex-shrink-0">({score.weight}%)</span>}
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                          {delta !== null && (
                            <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${
                              delta > 0 ? 'bg-emerald-50 text-emerald-700' :
                              delta < 0 ? 'bg-rose-50 text-rose-700' :
                              'bg-slate-100 text-slate-500'
                            }`}>
                              {delta > 0 ? `↑+${delta.toFixed(1)}` : delta < 0 ? `↓${delta.toFixed(1)}` : '→'}
                            </span>
                          )}
                          <span
                            className="text-sm font-bold px-2 py-0.5 rounded-full text-white"
                            style={{ backgroundColor: hexColor }}
                          >
                            {scoreNum}/5
                          </span>
                        </div>
                      </div>
                      {/* 프로그레스 바 */}
                      <div className="flex items-center gap-2 mb-2">
                        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all duration-1000 ease-out"
                            style={{ width: `${progressPct}%`, backgroundColor: hexColor, opacity: 0.75 }}
                          />
                        </div>
                        <span className="text-[11px] text-slate-400 w-14 text-right flex-shrink-0">{levelLabel}</span>
                      </div>
                      {/* 피드백 텍스트 */}
                      <p className="text-xs text-slate-600 leading-relaxed" data-testid={`score-feedback-${index}`}>{score.feedback}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 종합 평가 */}
          <Card 
            className="transform transition-all duration-500 hover:shadow-lg"
            style={{ 
              opacity: 0,
              animation: `fadeInUp 0.8s ease-out 2.5s forwards`
            }}
          >
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center">
                <i className="fas fa-chart-line text-corporate-600 mr-2 transition-transform duration-300 hover:scale-110"></i>
                {t('report.overallEvaluation', '종합 평가')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 3개 섹션 세로 배치 */}
              <div className="grid grid-cols-1 gap-4">

                {/* 주요 강점 */}
                <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                  <h4 className="font-bold text-green-800 mb-3 flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-green-500 text-white text-xs">
                      <i className="fas fa-thumbs-up"></i>
                    </span>
                    {t('report.mainStrengths', '주요 강점')}
                  </h4>
                  <ul className="space-y-2" data-testid="strengths-list">
                    {feedback?.detailedFeedback?.strengths?.map((strength, idx) => (
                      <li key={idx} className="flex items-start gap-3">
                        <span className="flex-shrink-0 inline-flex items-center justify-center w-5 h-5 mt-0.5 rounded-full bg-green-200 text-green-700 text-xs font-bold">{idx + 1}</span>
                        <span className="text-sm text-green-900 leading-relaxed">{strength}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* 개선 포인트 */}
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                  <h4 className="font-bold text-orange-800 mb-3 flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-orange-500 text-white text-xs">
                      <i className="fas fa-arrow-up"></i>
                    </span>
                    {t('report.improvementPoints', '개선 포인트')}
                  </h4>
                  <ul className="space-y-2" data-testid="improvements-list">
                    {feedback?.detailedFeedback?.improvements?.map((improvement, idx) => {
                      const priorityLabels = ['즉시 실천', '단기', '지속'];
                      const priorityColors = [
                        'bg-red-100 text-red-700 border-red-200',
                        'bg-yellow-100 text-yellow-700 border-yellow-200',
                        'bg-slate-100 text-slate-600 border-slate-200'
                      ];
                      const priorityLabel = priorityLabels[idx] ?? '지속';
                      const priorityColor = priorityColors[idx] ?? priorityColors[2];
                      return (
                        <li key={idx} className="flex items-start gap-3">
                          <span className="flex-shrink-0 inline-flex items-center justify-center w-5 h-5 mt-0.5 rounded-full bg-orange-200 text-orange-700 text-xs font-bold">{idx + 1}</span>
                          <div className="flex-1 min-w-0">
                            <span className="text-sm text-orange-900 leading-relaxed">{improvement}</span>
                            <span className={`ml-2 inline-block text-xs px-1.5 py-0.5 rounded border ${priorityColor} font-medium align-middle`}>{priorityLabel}</span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {/* 다음 단계 */}
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                  <h4 className="font-bold text-blue-800 mb-3 flex items-center gap-2">
                    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-500 text-white text-xs">
                      <i className="fas fa-forward"></i>
                    </span>
                    {t('report.nextSteps', '다음 단계')}
                  </h4>
                  <ul className="space-y-2" data-testid="next-steps-list">
                    {feedback?.detailedFeedback?.nextSteps?.map((step, idx) => (
                      <li key={idx} className="flex items-start gap-3">
                        <span className="flex-shrink-0 inline-flex items-center justify-center h-5 px-1.5 mt-0.5 rounded bg-blue-500 text-white text-xs font-bold whitespace-nowrap">Step {idx + 1}</span>
                        <span className="text-sm text-blue-900 leading-relaxed">{step}</span>
                        {idx < (feedback?.detailedFeedback?.nextSteps?.length ?? 0) - 1 && (
                          <i className="fas fa-arrow-down text-blue-300 text-xs mt-1 flex-shrink-0"></i>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* 종합 의견 — 인용 박스 */}
              <div className="bg-indigo-50 border-l-4 border-indigo-500 rounded-r-xl p-4" data-testid="ranking-summary">
                <div className="flex items-center gap-2 mb-2">
                  <i className="fas fa-comment-dots text-indigo-500"></i>
                  <span className="text-sm font-bold text-indigo-800">{t('report.overallOpinion', '종합 의견')}</span>
                </div>
                <p className="text-sm text-indigo-900 leading-relaxed">
                  {feedback?.detailedFeedback?.ranking}
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 실천 가이드 (행동 가이드 + 대화 가이드 통합) */}
        <TabsContent value="behavior" className="space-y-8 print-show-all print-section-break">
          <h2 className="print-section-title hidden print:block">🗂️ {t('report.tabs.practiceGuide', '실천 가이드')}</h2>

          {/* 섹션 1: 행동 개선 포인트 */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center justify-center w-9 h-9 rounded-full bg-amber-100">
                <i className="fas fa-lightbulb text-amber-500 text-base"></i>
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-800">{t('report.section.behaviorPoints', '행동 개선 포인트')}</h3>
                <p className="text-xs text-slate-500">{t('report.section.behaviorPointsDesc', '이번 대화에서 발견된 상황별 구체적 행동 가이드입니다.')}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5">
              {(feedback?.detailedFeedback?.behaviorGuides?.length ?? 0) > 0
                ? feedback!.detailedFeedback!.behaviorGuides!.map((guide, index) => (
                  <Card key={index} className="border border-amber-100 shadow-sm hover:shadow-md transition-shadow" data-testid={`behavior-guide-${index}`}>
                    <CardContent className="p-5 space-y-4">
                      {/* 상단: 번호 + 상황명 */}
                      <div className="flex items-center gap-3">
                        <span className="flex-shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-500 text-white text-xs font-bold">
                          {index + 1}
                        </span>
                        <h4 className="font-semibold text-slate-800 text-base leading-snug">{guide.situation}</h4>
                      </div>

                      {/* 중단 2열: 권장 행동 + 구체적 예시 */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="bg-corporate-50 rounded-lg p-3 border border-corporate-100">
                          <p className="text-xs font-semibold text-corporate-600 mb-1.5 uppercase tracking-wide">{t('report.recommendedAction', '권장 행동')}</p>
                          <p className="text-sm text-slate-700 leading-relaxed">{guide.action}</p>
                        </div>
                        <div className="bg-green-50 rounded-lg p-3 border border-green-100 relative">
                          <p className="text-xs font-semibold text-green-600 mb-1.5 uppercase tracking-wide">{t('report.specificExample', '실제 예시')}</p>
                          <p className="text-sm text-green-800 italic leading-relaxed">"{guide.example}"</p>
                        </div>
                      </div>

                      {/* 하단: 기대 효과 */}
                      <div className="flex items-start gap-2 pt-1 border-t border-slate-100">
                        <i className="fas fa-arrow-trend-up text-blue-400 mt-0.5 flex-shrink-0"></i>
                        <p className="text-sm text-slate-600"><span className="font-medium text-blue-700">{t('report.expectedEffect', '기대 효과')}: </span>{guide.impact}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))
                : (
                  <Card className="border-dashed">
                    <CardContent className="text-center py-8 text-slate-400">
                      <i className="fas fa-info-circle text-2xl mb-2 block"></i>
                      <p className="text-sm">{t('report.behaviorGuideLoading', '구체적인 행동 가이드가 준비 중입니다.')}</p>
                    </CardContent>
                  </Card>
                )
              }
            </div>
          </div>

          {/* 섹션 구분선 */}
          <div className="relative flex items-center gap-4 py-2">
            <div className="flex-1 h-px bg-gradient-to-r from-transparent via-slate-200 to-slate-200"></div>
            <span className="flex-shrink-0 inline-flex items-center gap-2 px-4 py-1.5 bg-slate-100 rounded-full text-xs font-medium text-slate-500">
              <i className="fas fa-comments text-slate-400"></i>
              {t('report.section.conversationExamples', '대화 스크립트 예시')}
            </span>
            <div className="flex-1 h-px bg-gradient-to-l from-transparent via-slate-200 to-slate-200"></div>
          </div>

          {/* 섹션 2: 대화 스크립트 예시 */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center justify-center w-9 h-9 rounded-full bg-cyan-100">
                <i className="fas fa-comments text-cyan-500 text-base"></i>
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-800">{t('report.section.conversationScript', '대화 스크립트 예시')}</h3>
                <p className="text-xs text-slate-500">{t('report.section.conversationScriptDesc', '좋은 표현과 피해야 할 표현을 비교하여 실전 대화력을 높이세요.')}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-5">
              {(feedback?.detailedFeedback?.conversationGuides?.length ?? 0) > 0
                ? feedback!.detailedFeedback!.conversationGuides!.map((guide, index) => (
                  <Card key={index} className="border border-cyan-100 shadow-sm hover:shadow-md transition-shadow" data-testid={`conversation-guide-${index}`}>
                    <CardContent className="p-5 space-y-4">
                      {/* 상단: 번호 + 시나리오명 */}
                      <div className="flex items-center gap-3">
                        <span className="flex-shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full bg-cyan-500 text-white text-xs font-bold">
                          {index + 1}
                        </span>
                        <h4 className="font-semibold text-slate-800 text-base leading-snug">{guide.scenario}</h4>
                      </div>

                      {/* 중단 2열: 좋은 예시 vs 피해야 할 예시 */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                          <p className="text-xs font-semibold text-green-700 mb-2 flex items-center gap-1">
                            <i className="fas fa-check-circle"></i>
                            {t('report.goodExample', '이렇게 말하세요')}
                          </p>
                          <p className="text-sm text-green-800 leading-relaxed">{guide.goodExample}</p>
                        </div>
                        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                          <p className="text-xs font-semibold text-red-700 mb-2 flex items-center gap-1">
                            <i className="fas fa-times-circle"></i>
                            {t('report.badExample', '이런 표현은 피하세요')}
                          </p>
                          <p className="text-sm text-red-800 leading-relaxed">{guide.badExample}</p>
                        </div>
                      </div>

                      {/* 하단: 핵심 포인트 pill 태그 */}
                      {(guide.keyPoints?.length ?? 0) > 0 && (
                        <div className="pt-1 border-t border-slate-100">
                          <p className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1">
                            <i className="fas fa-key text-slate-400"></i>
                            {t('report.keyPoints', '핵심 포인트')}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {guide.keyPoints.map((point, pointIndex) => (
                              <span
                                key={pointIndex}
                                className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-corporate-100 text-corporate-700 border border-corporate-200"
                              >
                                {point}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))
                : (
                  <Card className="border-dashed">
                    <CardContent className="text-center py-8 text-slate-400">
                      <i className="fas fa-info-circle text-2xl mb-2 block"></i>
                      <p className="text-sm">{t('report.conversationGuideLoading', '맞춤형 대화 가이드가 준비 중입니다.')}</p>
                    </CardContent>
                  </Card>
                )
              }
            </div>
          </div>
        </TabsContent>

        {/* 개발 계획 */}
        <TabsContent value="development" className="space-y-6 print-show-all print-section-break">
          <h2 className="print-section-title hidden print:block">📈 {t('report.tabs.development', '개발 계획')}</h2>
          {feedback?.detailedFeedback?.developmentPlan && (() => {
            const plan = feedback.detailedFeedback.developmentPlan;
            const sections = [
              {
                key: 'short',
                label: '단기 목표 (1-2주)',
                timeLabel: '1-2주',
                icon: 'fas fa-calendar-week',
                items: plan.shortTerm || [],
                accentColor: 'green',
                testId: 'short-term-plan',
              },
              {
                key: 'medium',
                label: '중기 목표 (1-2개월)',
                timeLabel: '1-2개월',
                icon: 'fas fa-calendar-alt',
                items: plan.mediumTerm || [],
                accentColor: 'blue',
                testId: 'medium-term-plan',
              },
              {
                key: 'long',
                label: '장기 목표 (3-6개월)',
                timeLabel: '3-6개월',
                icon: 'fas fa-calendar',
                items: plan.longTerm || [],
                accentColor: 'purple',
                testId: 'long-term-plan',
              },
            ];
            const accentMap: Record<string, { hdr: string; badge: string; bg: string; check: string; row: string }> = {
              green: { hdr: 'text-green-700', badge: 'bg-green-100 text-green-700 border-green-200', bg: 'bg-green-50', check: 'text-green-600', row: 'border-green-100' },
              blue: { hdr: 'text-blue-700', badge: 'bg-blue-100 text-blue-700 border-blue-200', bg: 'bg-blue-50', check: 'text-blue-600', row: 'border-blue-100' },
              purple: { hdr: 'text-purple-700', badge: 'bg-purple-100 text-purple-700 border-purple-200', bg: 'bg-purple-50', check: 'text-purple-600', row: 'border-purple-100' },
            };
            return (
              <>
                {sections.map(section => {
                  const ac = accentMap[section.accentColor];
                  return (
                    <Card key={section.key} className={`border-l-4 border-l-${section.accentColor}-500`} data-testid={section.testId}>
                      <CardHeader className="pb-3">
                        <CardTitle className={`${ac.hdr} flex items-center gap-2`}>
                          <i className={`${section.icon}`}></i>
                          {section.label}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {section.items.map((item, idx) => {
                          const itemKey = `${section.key}_${idx}`;
                          const isChecked = !!checkedItems[itemKey];
                          const diff = getDifficultyTag(item);
                          return (
                            <div
                              key={idx}
                              className={`rounded-xl border p-4 transition-all ${ac.row} ${isChecked ? 'opacity-60' : ''}`}
                            >
                              <div className="flex items-start gap-3">
                                <button
                                  onClick={() => toggleCheckItem(itemKey)}
                                  className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                                    isChecked
                                      ? `bg-${section.accentColor}-500 border-${section.accentColor}-500`
                                      : `border-slate-300 hover:border-${section.accentColor}-400`
                                  }`}
                                  aria-label={isChecked ? '완료 취소' : '완료 표시'}
                                >
                                  {isChecked && <i className="fas fa-check text-white text-xs"></i>}
                                </button>
                                <div className="flex-1 min-w-0">
                                  <div className="flex flex-wrap items-center gap-2 mb-2">
                                    <h4 className={`font-semibold text-sm ${isChecked ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                                      {item.goal}
                                    </h4>
                                    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${diff.cls}`}>
                                      {diff.label}
                                    </span>
                                    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full border ${ac.badge}`}>
                                      {section.timeLabel}
                                    </span>
                                  </div>
                                  <ul className="space-y-1 mb-2">
                                    {item.actions.map((action, aIdx) => (
                                      <li key={aIdx} className="text-xs text-slate-600 flex items-start gap-1.5">
                                        <i className="fas fa-chevron-right mt-0.5 text-slate-400 flex-shrink-0" style={{ fontSize: '0.6rem' }}></i>
                                        {action}
                                      </li>
                                    ))}
                                  </ul>
                                  <div className={`text-xs ${ac.check} ${ac.bg} px-2 py-1 rounded inline-block`}>
                                    측정지표: {item.measurable}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {section.items.length === 0 && (
                          <p className="text-sm text-slate-400 text-center py-4">목표 항목이 없습니다.</p>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}

                {/* 추천 리소스 */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center">
                      <i className="fas fa-book-open text-corporate-600 mr-2"></i>
                      {t('report.recommendedResources', '추천 학습 자료 및 리소스')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="recommended-resources">
                      {(plan.recommendedResources || []).map((resource, index) => (
                        <div key={index} className="flex items-start space-x-3 p-3 bg-slate-50 rounded-lg">
                          <i className="fas fa-bookmark text-corporate-500 mt-1"></i>
                          <p className="text-slate-700 text-sm">{resource}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </>
            );
          })()}
        </TabsContent>

        {/* 전략 평가 */}
        {feedback?.detailedFeedback?.sequenceAnalysis && (
          <TabsContent value="strategy" className="space-y-6 print-show-all print-section-break">
            <h2 className="print-section-title hidden print:block">🎮 {t('report.tabs.strategy', '전략 평가')}</h2>
            <Card className="border-l-4 border-l-purple-500">
              <CardHeader>
                <CardTitle className="flex items-center text-xl">
                  <i className="fas fa-chess text-purple-600 mr-3"></i>
                  {t('report.strategicAnalysis', '전략적 선택 분석')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* 전략 점수 */}
                <div className="bg-purple-50 p-6 rounded-lg">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-purple-900">{t('report.strategyScore', '전략 점수')}</h3>
                    <Badge variant="outline" className="text-2xl font-bold bg-purple-100 text-purple-700 px-4 py-2">
                      {feedback.detailedFeedback.sequenceAnalysis.strategicScore ?? t('report.awaitingEvaluation', '평가 대기중')}
                    </Badge>
                  </div>
                  <p className="text-purple-700">
                    {feedback.detailedFeedback.sequenceAnalysis.strategicRationale || t('report.strategyNotGenerated', '전략 평가가 아직 생성되지 않았습니다.')}
                  </p>
                </div>

                {/* 순서 선택의 효과성 */}
                {feedback.detailedFeedback.sequenceAnalysis.sequenceEffectiveness && (
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900 mb-3 flex items-center">
                      <i className="fas fa-bullseye text-blue-500 mr-2"></i>
                      {t('report.sequenceEffectiveness', '순서 선택의 효과성')}
                    </h3>
                    <p className="text-slate-700 bg-slate-50 p-4 rounded-lg">
                      {feedback.detailedFeedback.sequenceAnalysis.sequenceEffectiveness}
                    </p>
                  </div>
                )}

                {/* 전략적 통찰 */}
                {feedback.detailedFeedback.sequenceAnalysis.strategicInsights && (
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900 mb-3 flex items-center">
                      <i className="fas fa-lightbulb text-yellow-500 mr-2"></i>
                      {t('report.strategicInsights', '전략적 통찰')}
                    </h3>
                    <p className="text-slate-700 bg-yellow-50 p-4 rounded-lg border-l-4 border-yellow-400">
                      {feedback.detailedFeedback.sequenceAnalysis.strategicInsights}
                    </p>
                  </div>
                )}

                {/* 대안적 접근법 */}
                {feedback.detailedFeedback.sequenceAnalysis.alternativeApproaches && 
                 feedback.detailedFeedback.sequenceAnalysis.alternativeApproaches.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900 mb-3 flex items-center">
                      <i className="fas fa-route text-green-500 mr-2"></i>
                      {t('report.alternativeApproaches', '대안적 접근법')}
                    </h3>
                    <div className="space-y-3">
                      {feedback.detailedFeedback.sequenceAnalysis.alternativeApproaches.map((approach: string, index: number) => (
                        <div key={index} className="flex items-start space-x-3 bg-green-50 p-4 rounded-lg">
                          <Badge className="bg-green-500 text-white mt-1">{index + 1}</Badge>
                          <p className="text-slate-700 flex-1">{approach}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* 액션 버튼 - 데스크톱 */}
      <div className="hidden md:flex justify-center flex-wrap gap-3 pt-6 border-t border-slate-200 no-print">
        {!isAdminView && <Button 
          onClick={() => window.location.href = '/mypage'}
          variant="outline"
          className="min-w-[120px]"
          data-testid="back-to-mypage-button"
        >
          <i className="fas fa-home mr-2"></i>
          {t('report.myPage', '마이페이지')}
        </Button>}
        
        {/* Home.tsx에서 전달된 다음 페르소나 버튼 (우선순위 높음) - 관리자 보기에서는 숨김 */}
        {!isAdminView && hasMorePersonas && onNextPersona && (
          <Button 
            onClick={onNextPersona}
            className="min-w-[120px] bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
            data-testid="next-persona-button"
          >
            <i className="fas fa-arrow-right mr-2"></i>
            {t('report.nextPersona', '다음 페르소나와 대화하기')}
          </Button>
        )}
        
        {/* 모든 페르소나 완료 시 전략 평가 버튼 - 관리자 보기에서는 숨김 */}
        {!isAdminView && allPersonasCompleted && onNextPersona && (
          <Button 
            onClick={onNextPersona}
            className="min-w-[120px] bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700"
            data-testid="strategy-reflection-button"
          >
            <i className="fas fa-clipboard-list mr-2"></i>
            {t('report.viewStrategyEvaluation', '전략 평가 보기')}
          </Button>
        )}
        
        {/* FeedbackView에서 사용하는 기존 순차적 다음 페르소나 버튼 - 관리자 보기에서는 숨김 */}
        {!isAdminView && !hasMorePersonas && !allPersonasCompleted && nextPersona && !isNextConversationCompleted() && (
          <Button 
            onClick={handleNextConversation}
            className="min-w-[120px] bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
            data-testid="next-persona-legacy-button"
            disabled={createNextConversationMutation.isPending}
          >
            <i className="fas fa-arrow-right mr-2"></i>
            {createNextConversationMutation.isPending ? t('report.creating', '생성 중...') : t('report.nextConversationPartner', '다음 대화 상대: {{name}}', { name: nextPersona.name })}
          </Button>
        )}
        
        {!isAdminView && <Button 
          onClick={onSelectNewScenario}
          variant="outline"
          className="min-w-[120px]"
          data-testid="new-scenario-button"
        >
          <i className="fas fa-redo mr-2"></i>
          {t('report.newTraining', '새로운 훈련')}
        </Button>}
        {!isAdminView && <Button 
          onClick={onRetry}
          className="min-w-[120px]"
          data-testid="retry-scenario-button"
        >
          <i className="fas fa-sync-alt mr-2"></i>
          {t('report.retryScenario', '같은 시나리오 재도전')}
        </Button>}
        <Button 
          variant="secondary"
          onClick={handlePrint}
          className="min-w-[120px]"
          data-testid="print-report-button"
        >
          <i className="fas fa-print mr-2"></i>
          {t('report.printReport', '보고서 인쇄')}
        </Button>
        <Button 
          variant="outline"
          onClick={handleRegenerateFeedback}
          disabled={generateFeedbackMutation.isPending}
          className="min-w-[120px] text-orange-600 border-orange-300 hover:bg-orange-50"
          data-testid="regenerate-feedback-button"
        >
          {generateFeedbackMutation.isPending ? (
            <>
              <i className="fas fa-spinner fa-spin mr-2"></i>
              {t('report.regenerating', '재생성 중...')}
            </>
          ) : (
            <>
              <i className="fas fa-redo-alt mr-2"></i>
              {t('report.regenerateFeedback', '피드백 재생성')}
            </>
          )}
        </Button>
        <Button 
          variant="outline"
          onClick={handleDownloadHtml}
          disabled={isExportingPdf}
          className="min-w-[120px]"
          data-testid="export-html-button"
        >
          {isExportingPdf ? (
            <>
              <i className="fas fa-spinner fa-spin mr-2"></i>
              {t('report.downloading', '다운로드 중...')}
            </>
          ) : (
            <>
              <i className="fas fa-download mr-2"></i>
              {t('report.downloadHtml', 'HTML 다운로드')}
            </>
          )}
        </Button>
      </div>
      
      {/* 액션 버튼 - 모바일 (스마트 버튼) */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 shadow-lg z-50 no-print">
        {/* 확장된 메뉴 */}
        {showMobileMenu && (
          <div className="p-3 border-b border-slate-100 bg-slate-50 animate-in slide-in-from-bottom duration-200">
            <div className="grid grid-cols-2 gap-2">
              {hasMorePersonas && onNextPersona && (
                <Button 
                  onClick={() => { setShowMobileMenu(false); onNextPersona(); }}
                  className="w-full text-sm bg-gradient-to-r from-green-600 to-emerald-600"
                  data-testid="mobile-next-persona-button"
                >
                  <i className="fas fa-arrow-right mr-1"></i>
                  {t('report.nextPersonaShort', '다음 페르소나')}
                </Button>
              )}
              
              {allPersonasCompleted && onNextPersona && (
                <Button 
                  onClick={() => { setShowMobileMenu(false); onNextPersona(); }}
                  className="w-full text-sm bg-gradient-to-r from-purple-600 to-indigo-600"
                  data-testid="mobile-strategy-button"
                >
                  <i className="fas fa-clipboard-list mr-1"></i>
                  {t('report.tabs.strategy', '전략 평가')}
                </Button>
              )}
              
              {!hasMorePersonas && !allPersonasCompleted && nextPersona && !isNextConversationCompleted() && (
                <Button 
                  onClick={() => { setShowMobileMenu(false); handleNextConversation(); }}
                  className="w-full text-sm bg-gradient-to-r from-blue-600 to-indigo-600"
                  disabled={createNextConversationMutation.isPending}
                  data-testid="mobile-next-legacy-button"
                >
                  <i className="fas fa-arrow-right mr-1"></i>
                  {t('report.nextConversationShort', '다음 대화')}
                </Button>
              )}
              
              <Button 
                onClick={() => { setShowMobileMenu(false); onSelectNewScenario(); }}
                variant="outline"
                className="w-full text-sm"
                data-testid="mobile-new-scenario-button"
              >
                <i className="fas fa-redo mr-1"></i>
                {t('report.newTrainingShort', '새 훈련')}
              </Button>
              
              <Button 
                onClick={() => { setShowMobileMenu(false); onRetry(); }}
                className="w-full text-sm"
                data-testid="mobile-retry-button"
              >
                <i className="fas fa-sync-alt mr-1"></i>
                {t('report.retryShort', '재도전')}
              </Button>
              
              <Button 
                variant="secondary"
                onClick={() => { setShowMobileMenu(false); handlePrint(); }}
                className="w-full text-sm"
                data-testid="mobile-print-button"
              >
                <i className="fas fa-print mr-1"></i>
                {t('report.print', '인쇄')}
              </Button>
              
              <Button 
                variant="outline"
                onClick={() => { setShowMobileMenu(false); handleRegenerateFeedback(); }}
                disabled={generateFeedbackMutation.isPending}
                className="w-full text-sm text-orange-600 border-orange-300"
                data-testid="mobile-regenerate-button"
              >
                <i className="fas fa-redo-alt mr-1"></i>
                {t('report.regenerateFeedback', '피드백 재생성')}
              </Button>
              
              <Button 
                variant="outline"
                onClick={() => { setShowMobileMenu(false); handleDownloadHtml(); }}
                disabled={isExportingPdf}
                className="w-full text-sm"
                data-testid="mobile-download-button"
              >
                <i className="fas fa-download mr-1"></i>
                {t('report.download', '다운로드')}
              </Button>
            </div>
          </div>
        )}
        
        {/* 하단 스마트 버튼 바 */}
        <div className="flex items-center justify-between p-3">
          {!isAdminView && <Button 
            onClick={() => window.location.href = '/mypage'}
            variant="outline"
            className="flex-1 mr-2"
            data-testid="mobile-mypage-button"
          >
            <i className="fas fa-home mr-2"></i>
            {t('report.myPage', '마이페이지')}
          </Button>}
          
          <Button 
            onClick={() => setShowMobileMenu(!showMobileMenu)}
            className={`flex-1 ${showMobileMenu ? 'bg-slate-600' : 'bg-indigo-600'}`}
            data-testid="mobile-menu-toggle"
          >
            <i className={`fas ${showMobileMenu ? 'fa-times' : 'fa-th-large'} mr-2`}></i>
            {showMobileMenu ? t('report.close', '닫기') : t('report.more', '더보기')}
          </Button>
        </div>
      </div>
      
      {/* 모바일 하단 메뉴 공간 확보 */}
      <div className="md:hidden h-20"></div>
    </div>
  );
}