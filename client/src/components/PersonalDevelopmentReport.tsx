import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useState, useRef } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

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
  onReady
}: PersonalDevelopmentReportProps) {
  const { toast } = useToast();
  const [showDetailedFeedback, setShowDetailedFeedback] = useState(true); // 애니메이션 없이 바로 표시
  const [hasRequestedFeedback, setHasRequestedFeedback] = useState(false); // 피드백 생성 요청 여부
  const [isExportingPdf, setIsExportingPdf] = useState(false); // PDF 내보내기 중
  const [showMobileMenu, setShowMobileMenu] = useState(false); // 모바일 스마트 메뉴 상태
  const reportRef = useRef<HTMLDivElement>(null); // 보고서 컨테이너 참조

  // 사용자의 모든 대화 기록 조회
  const { data: userConversations = [] } = useQuery<any[]>({
    queryKey: ['/api/conversations'],
  });

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

  const userName = userProfile?.name || '사용자';

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
      if (!nextPersona) throw new Error("다음 대화 상대가 없습니다");
      
      const response = await apiRequest('POST', '/api/conversations', {
        scenarioId: scenario.id,
        personaId: nextPersona.id,
        maxTurns: 3,
      });

      if (!response.ok) {
        throw new Error('대화 생성 실패');
      }

      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
      window.location.href = `/chat/${data.id}`;
    },
    onError: (error) => {
      toast({
        title: "오류",
        description: `다음 대화를 생성할 수 없습니다: ${error.message}`,
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
    mutationFn: async () => {
      console.log("피드백 생성 요청 시작:", conversationId);
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
      // 캐시에 즉시 피드백 데이터 설정 (에러 상태를 덮어씀)
      queryClient.setQueryData(["/api/conversations", conversationId, "feedback"], data);
      onFeedbackGeneratingChange?.(false); // 부모에게 피드백 생성 완료 알림
    },
    onError: (error) => {
      console.error("피드백 생성 오류:", error);
      onFeedbackGeneratingChange?.(false); // 에러 시에도 부모에게 알림
      toast({
        title: "오류",
        description: `피드백을 생성할 수 없습니다: ${error.message}`,
        variant: "destructive"
      });
    }
  });

  // 피드백 생성 버튼 클릭 핸들러
  const handleGenerateFeedback = () => {
    setHasRequestedFeedback(true);
    onFeedbackGeneratingChange?.(true); // 부모에게 피드백 생성 시작 알림
    generateFeedbackMutation.mutate();
  };

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
    
    const userProfile = userConversations.length > 0 ? userConversations[0].user : null;
    const userName = userProfile?.name || '사용자';

    return `
      <div style="font-family: 'Noto Sans KR', sans-serif; padding: 20px; max-width: 800px; margin: 0 auto;">
        <!-- 헤더 -->
        <div style="background: linear-gradient(135deg, #4f46e5, #6366f1); color: white; padding: 24px; border-radius: 12px; margin-bottom: 24px;">
          <h1 style="font-size: 24px; font-weight: bold; margin-bottom: 8px;">${escapeHtml(userName)}님 맞춤 보고서</h1>
          <p style="opacity: 0.9; margin-bottom: 4px;">시나리오 : ${escapeHtml(scenario.title)}</p>
          <p style="font-size: 14px; opacity: 0.8; margin-bottom: 12px;">대화 상대 : ${escapeHtml(persona.role)} ${escapeHtml(persona.name)}</p>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 16px;">
            <div></div>
            <div style="background: white; color: ${overallGrade.color.replace('text-', '')}; padding: 16px 24px; border-radius: 8px; text-align: center;">
              <div style="font-size: 28px; font-weight: bold; color: #16a34a;">${escapeHtml(overallGrade.grade)}</div>
              <div style="font-size: 14px; color: #4b5563;">${feedback.overallScore || 0}점</div>
            </div>
          </div>
        </div>

        <!-- 1. 성과 분석 -->
        <div style="margin-bottom: 32px; page-break-inside: avoid;">
          <h2 style="font-size: 20px; font-weight: bold; color: #1f2937; border-bottom: 2px solid #4f46e5; padding-bottom: 8px; margin-bottom: 16px;">📊 성과 분석</h2>
          
          ${feedback.detailedFeedback?.evaluationCriteriaSetName ? `
          <div style="background: #eef2ff; border: 1px solid #c7d2fe; border-radius: 8px; padding: 12px; margin-bottom: 16px;">
            <span style="font-size: 14px; color: #4338ca; font-weight: 500;">📋 평가 기준: ${escapeHtml(feedback.detailedFeedback.evaluationCriteriaSetName)}</span>
          </div>
          ` : ''}
          
          <!-- 카테고리별 점수 -->
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-bottom: 24px;">
            ${scores.map(score => `
              <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                  <span style="font-weight: 600; color: #374151;">${escapeHtml(score.icon)} ${escapeHtml(score.name)}</span>
                  <span style="background: #dbeafe; color: #1e40af; padding: 4px 8px; border-radius: 4px; font-size: 12px;">${score.score || 0}/5</span>
                </div>
                <p style="font-size: 13px; color: #6b7280;">${escapeHtml(score.feedback)}</p>
              </div>
            `).join('')}
          </div>

          <!-- 종합 평가 -->
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px;">
            <h3 style="font-size: 16px; font-weight: 600; color: #374151; margin-bottom: 16px;">📈 종합 평가</h3>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 16px;">
              <div>
                <h4 style="font-size: 14px; font-weight: 600; color: #16a34a; margin-bottom: 8px;">✅ 주요 강점</h4>
                <ul style="list-style: none; padding: 0; margin: 0;">
                  ${strengths.map(s => `<li style="font-size: 13px; color: #4b5563; margin-bottom: 4px;">• ${escapeHtml(s)}</li>`).join('')}
                </ul>
              </div>
              <div>
                <h4 style="font-size: 14px; font-weight: 600; color: #ea580c; margin-bottom: 8px;">⬆️ 개선 포인트</h4>
                <ul style="list-style: none; padding: 0; margin: 0;">
                  ${improvements.map(i => `<li style="font-size: 13px; color: #4b5563; margin-bottom: 4px;">• ${escapeHtml(i)}</li>`).join('')}
                </ul>
              </div>
              <div>
                <h4 style="font-size: 14px; font-weight: 600; color: #2563eb; margin-bottom: 8px;">➡️ 다음 단계</h4>
                <ul style="list-style: none; padding: 0; margin: 0;">
                  ${nextSteps.map(s => `<li style="font-size: 13px; color: #4b5563; margin-bottom: 4px;">• ${escapeHtml(s)}</li>`).join('')}
                </ul>
              </div>
            </div>
            <div style="border-top: 1px solid #e2e8f0; padding-top: 12px;">
              <p style="font-size: 14px; color: #374151;"><strong>전문가 의견:</strong> ${escapeHtml(feedback.detailedFeedback?.ranking)}</p>
            </div>
          </div>
        </div>

        <!-- 2. 행동 가이드 -->
        <div style="margin-bottom: 32px; page-break-inside: avoid;">
          <h2 style="font-size: 20px; font-weight: bold; color: #1f2937; border-bottom: 2px solid #eab308; padding-bottom: 8px; margin-bottom: 16px;">🎯 행동 가이드</h2>
          ${behaviorGuides.length > 0 ? behaviorGuides.map(guide => `
            <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
              <h3 style="font-size: 16px; font-weight: 600; color: #92400e; margin-bottom: 12px;">💡 ${escapeHtml(guide.situation)}</h3>
              <div style="margin-bottom: 12px;">
                <h4 style="font-size: 14px; font-weight: 600; color: #4f46e5; margin-bottom: 4px;">권장 행동</h4>
                <p style="font-size: 13px; color: #374151; background: #f0f9ff; padding: 8px; border-radius: 4px;">${escapeHtml(guide.action)}</p>
              </div>
              <div style="margin-bottom: 12px;">
                <h4 style="font-size: 14px; font-weight: 600; color: #16a34a; margin-bottom: 4px;">구체적 예시</h4>
                <p style="font-size: 13px; color: #166534; background: #dcfce7; padding: 8px; border-radius: 4px; font-style: italic;">"${escapeHtml(guide.example)}"</p>
              </div>
              <div>
                <h4 style="font-size: 14px; font-weight: 600; color: #2563eb; margin-bottom: 4px;">기대 효과</h4>
                <p style="font-size: 13px; color: #374151;">${escapeHtml(guide.impact)}</p>
              </div>
            </div>
          `).join('') : '<p style="color: #6b7280;">구체적인 행동 가이드가 준비 중입니다.</p>'}
        </div>

        <!-- 3. 대화 가이드 -->
        <div style="margin-bottom: 32px; page-break-inside: avoid;">
          <h2 style="font-size: 20px; font-weight: bold; color: #1f2937; border-bottom: 2px solid #06b6d4; padding-bottom: 8px; margin-bottom: 16px;">💬 대화 가이드</h2>
          ${conversationGuides.length > 0 ? conversationGuides.map(guide => `
            <div style="background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
              <h3 style="font-size: 16px; font-weight: 600; color: #0f766e; margin-bottom: 12px;">💭 ${escapeHtml(guide.scenario)}</h3>
              <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 12px;">
                <div style="background: #dcfce7; border: 1px solid #86efac; padding: 12px; border-radius: 4px;">
                  <h4 style="font-size: 13px; font-weight: 600; color: #16a34a; margin-bottom: 4px;">✅ 좋은 예시</h4>
                  <p style="font-size: 12px; color: #166534;">${escapeHtml(guide.goodExample)}</p>
                </div>
                <div style="background: #fef2f2; border: 1px solid #fecaca; padding: 12px; border-radius: 4px;">
                  <h4 style="font-size: 13px; font-weight: 600; color: #dc2626; margin-bottom: 4px;">❌ 피해야 할 예시</h4>
                  <p style="font-size: 12px; color: #991b1b;">${escapeHtml(guide.badExample)}</p>
                </div>
              </div>
              <div>
                <h4 style="font-size: 13px; font-weight: 600; color: #4f46e5; margin-bottom: 4px;">🔑 핵심 포인트</h4>
                <ul style="list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px;">
                  ${(guide.keyPoints || []).map(point => `<li style="font-size: 12px; color: #4b5563;">• ${escapeHtml(point)}</li>`).join('')}
                </ul>
              </div>
            </div>
          `).join('') : '<p style="color: #6b7280;">맞춤형 대화 가이드가 준비 중입니다.</p>'}
        </div>

        <!-- 4. 개발 계획 -->
        <div style="margin-bottom: 32px; page-break-inside: avoid;">
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
          생성일: ${new Date().toLocaleDateString('ko-KR')} · AI 기반 개인 맞춤 개발 보고서
        </div>
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
        <h2 className="text-xl font-semibold text-slate-900 mb-2">개인 맞춤 분석 중...</h2>
        <p className="text-slate-600">AI가 대화를 심층 분석하여 맞춤형 개발 계획을 수립하고 있습니다.</p>
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
        <h2 className="text-xl font-semibold text-slate-900 mb-2">피드백이 아직 생성되지 않았습니다</h2>
        <p className="text-slate-600 mb-4">대화를 완료한 후 피드백을 생성할 수 있습니다.</p>
        <div className="space-y-2">
          <Button 
            onClick={handleGenerateFeedback} 
            data-testid="generate-feedback"
            disabled={generateFeedbackMutation.isPending}
          >
            {generateFeedbackMutation.isPending ? "피드백 생성 중..." : "피드백 생성하기"}
          </Button>
          <Button 
            variant="outline" 
            onClick={() => window.location.href = '/mypage'} 
            data-testid="back-to-mypage"
          >
            마이페이지로 돌아가기
          </Button>
        </div>
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
        <h2 className="text-xl font-semibold text-slate-900 mb-2">오류가 발생했습니다</h2>
        <p className="text-slate-600 mb-4">{error.message || "알 수 없는 오류가 발생했습니다."}</p>
        <div className="space-y-2">
          <Button onClick={() => refetch()} data-testid="refetch-feedback">
            다시 시도
          </Button>
          <Button 
            variant="outline" 
            onClick={() => window.location.href = '/mypage'} 
            data-testid="back-to-mypage"
          >
            마이페이지로 돌아가기
          </Button>
        </div>
      </div>
    );
  }

  const getScoreColor = (score: number) => {
    if (score >= 4) return "green";
    if (score >= 3) return "blue"; 
    if (score >= 2) return "yellow";
    return "red";
  };

  const getScoreLabel = (score: number) => {
    if (score >= 5) return "탁월";
    if (score >= 4) return "우수";
    if (score >= 3) return "보통";
    if (score >= 2) return "개선 필요";
    return "미흡";
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

  // feedback가 없으면 로딩 화면을 표시
  if (!feedback) {
    return (
      <div className="text-center py-16" data-testid="feedback-loading">
        <div className="relative mb-8">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-corporate-600 mx-auto"></div>
          <div className="animate-pulse absolute inset-0 rounded-full h-16 w-16 border-2 border-corporate-200 mx-auto"></div>
        </div>
        <h2 className="text-xl font-semibold text-slate-900 mb-2 animate-pulse-gentle">개인 맞춤 분석 중...</h2>
        <p className="text-slate-600 mb-4">AI가 대화를 심층 분석하여 맞춤형 개발 계획을 수립하고 있습니다.</p>
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
        개인 맞춤 개발 보고서 - {scenario.title}
      </div>
      
      {/* 화면용 헤더 */}
      <div 
        className="bg-gradient-to-r from-corporate-600 to-corporate-700 rounded-xl p-6 text-white transform transition-all duration-700 hover:shadow-2xl screen-only"
        style={{ 
          opacity: 0,
          animation: `fadeInUp 0.8s ease-out forwards`
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <div></div>
          <Button 
            onClick={() => window.location.href = '/mypage'}
            variant="ghost"
            size="sm"
            className="text-white/80 hover:text-white hover:bg-white/10"
            data-testid="mypage-button"
          >
            <i className="fas fa-user mr-2"></i>
            마이페이지로
          </Button>
        </div>
        <div className="flex items-center justify-between">
          <div 
            style={{ 
              opacity: 0,
              animation: `slideInRight 0.8s ease-out 0.3s forwards`
            }}
          >
            <h1 className="text-2xl font-bold mb-2" data-testid="report-title">{userName}님 맞춤 보고서</h1>
            <p className="text-corporate-100">시나리오 : {scenario.title}</p>
            <p className="text-corporate-100 text-sm mt-1">대화 상대 : {persona.role} {persona.name}</p>
            <div className="mt-3 text-sm text-corporate-200">
              <i className="fas fa-history mr-2"></i>
              대화 일시: {new Date().toLocaleString('ko-KR')}
            </div>
          </div>
          <div 
            className={`${overallGrade.bg} ${overallGrade.color} px-6 py-4 rounded-lg text-center min-w-[120px] transform transition-all duration-1000 hover:scale-110 hover:shadow-lg`}
            style={{ 
              opacity: 0,
              animation: `fadeInUp 0.8s ease-out 0.6s forwards, bounce-once 0.8s ease-out 2.5s`
            }}
          >
            <div className="text-3xl font-bold transition-all duration-500" data-testid="overall-grade">{overallGrade.grade}</div>
            <div className="text-sm font-medium transition-all duration-1000">{displayOverallScore}점</div>
            <div className="text-xs">종합 점수</div>
          </div>
        </div>
      </div>

      {/* 대화 시간 분석 카드 (새로 추가) */}
      {feedback?.detailedFeedback?.conversationDuration && (
        <Card className="mb-6 border-blue-200 bg-blue-50 screen-only">
          <CardHeader>
            <CardTitle className="text-lg flex items-center text-blue-800">
              <i className="fas fa-clock mr-2"></i>
              대화 시간 분석
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
                <div className="text-sm text-slate-600">총 대화 시간</div>
              </div>
              {feedback?.detailedFeedback?.averageResponseTime && (
                <div className="bg-white rounded-lg p-4">
                  <div className="text-2xl font-bold text-green-600">
                    {feedback.detailedFeedback.averageResponseTime}초
                  </div>
                  <div className="text-sm text-slate-600">평균 응답 시간</div>
                </div>
              )}
              {feedback?.detailedFeedback?.timePerformance && (
                <div className="bg-white rounded-lg p-4">
                  <div className={`text-lg font-medium ${
                    feedback.detailedFeedback.timePerformance.rating === 'excellent' ? 'text-green-600' :
                    feedback.detailedFeedback.timePerformance.rating === 'good' ? 'text-blue-600' :
                    feedback.detailedFeedback.timePerformance.rating === 'average' ? 'text-yellow-600' : 'text-red-600'
                  }`}>
                    {feedback.detailedFeedback.timePerformance.rating === 'excellent' ? '🎯 우수' :
                     feedback.detailedFeedback.timePerformance.rating === 'good' ? '✅ 좋음' :
                     feedback.detailedFeedback.timePerformance.rating === 'average' ? '🔶 보통' : '⚠️ 개선필요'}
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
          className={`grid w-full ${feedback?.detailedFeedback?.sequenceAnalysis ? 'grid-cols-5' : 'grid-cols-4'} transform transition-all duration-500 screen-only`}
          style={{ 
            opacity: 0,
            animation: `fadeInUp 0.6s ease-out 1s forwards`
          }}
        >
          <TabsTrigger value="scores" data-testid="tab-scores" className="transition-all duration-300 hover:scale-105">성과 분석</TabsTrigger>
          <TabsTrigger value="behavior" data-testid="tab-behavior" className="transition-all duration-300 hover:scale-105">행동 가이드</TabsTrigger>
          <TabsTrigger value="conversation" data-testid="tab-conversation" className="transition-all duration-300 hover:scale-105">대화 가이드</TabsTrigger>
          <TabsTrigger value="development" data-testid="tab-development" className="transition-all duration-300 hover:scale-105">개발 계획</TabsTrigger>
          {feedback?.detailedFeedback?.sequenceAnalysis && (
            <TabsTrigger value="strategy" data-testid="tab-strategy" className="transition-all duration-300 hover:scale-105">전략 평가</TabsTrigger>
          )}
        </TabsList>

        {/* 성과 분석 */}
        <TabsContent value="scores" className="space-y-6 print-show-all">
          <h2 className="print-section-title hidden print:block">📊 성과 분석</h2>
          
          {/* 사용된 평가 기준 세트 정보 */}
          {feedback?.detailedFeedback?.evaluationCriteriaSetName && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 mb-4 screen-only">
              <div className="flex items-center gap-2">
                <i className="fas fa-clipboard-check text-indigo-600"></i>
                <span className="text-sm font-medium text-indigo-800">
                  평가 기준: {feedback.detailedFeedback.evaluationCriteriaSetName}
                </span>
              </div>
            </div>
          )}
          
          {/* 카테고리별 점수 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {feedback?.scores?.map((score, index) => {
              const displayScore = getDisplayValue(score.score);
              const progressWidth = getProgressWidth((score.score / 5) * 100);
              
              return (
                <Card 
                  key={index} 
                  className="card-enhanced" 
                  data-testid={`score-card-${index}`}
                  style={{ 
                    animationDelay: `${index * 200}ms`,
                    opacity: 0,
                    animation: `fadeInUp 0.6s ease-out ${index * 200}ms forwards`
                  }}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <i className={`${score.icon} text-xl text-${score.color}-600 transition-transform duration-300 hover:scale-110`}></i>
                        <CardTitle className="text-sm">{score.name}</CardTitle>
                      </div>
                      <Badge 
                        variant="secondary" 
                        className={`bg-${getScoreColor(score.score)}-100 text-${getScoreColor(score.score)}-800 transition-all duration-300 hover:scale-105`}
                      >
                        {displayScore}/5
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center mb-3">
                      <div className={`h-3 bg-${getScoreColor(score.score)}-200 rounded-full flex-1 mr-3 overflow-hidden`}>
                        <div 
                          className={`h-full bg-gradient-to-r from-${getScoreColor(score.score)}-400 to-${getScoreColor(score.score)}-600 rounded-full transition-all duration-1000 ease-out`}
                          style={{ width: `${progressWidth}%` }}
                        />
                      </div>
                      <span className={`text-sm font-medium text-${getScoreColor(score.score)}-600 transition-colors duration-300`}>
                        {getScoreLabel(score.score)}
                      </span>
                    </div>
                    <div 
                      className={`transition-all duration-500 ${showDetailedFeedback ? 'opacity-100 max-h-none' : 'opacity-0 max-h-0 overflow-hidden'}`}
                      style={{ transitionDelay: `${2000 + index * 300}ms` }}
                    >
                      <p className="text-sm text-slate-600" data-testid={`score-feedback-${index}`}>{score.feedback}</p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* 종합 평가 */}
          <Card 
            className="transform transition-all duration-500 hover:shadow-lg"
            style={{ 
              opacity: 0,
              animation: `fadeInUp 0.8s ease-out 2.5s forwards`
            }}
          >
            <CardHeader>
              <CardTitle className="flex items-center">
                <i className="fas fa-chart-line text-corporate-600 mr-2 transition-transform duration-300 hover:scale-110"></i>
                종합 평가
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <h4 className="font-semibold text-green-700 mb-2 flex items-center">
                    <i className="fas fa-thumbs-up mr-2"></i>
                    주요 강점
                  </h4>
                  <ul className="space-y-2" data-testid="strengths-list">
                    {feedback?.detailedFeedback?.strengths?.map((strength, index) => (
                      <li key={index} className="text-sm text-slate-600 flex items-start">
                        <i className="fas fa-check text-green-500 mr-2 mt-1 text-xs"></i>
                        {strength}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="font-semibold text-orange-700 mb-2 flex items-center">
                    <i className="fas fa-arrow-up mr-2"></i>
                    개선 포인트
                  </h4>
                  <ul className="space-y-2" data-testid="improvements-list">
                    {feedback?.detailedFeedback?.improvements?.map((improvement, index) => (
                      <li key={index} className="text-sm text-slate-600 flex items-start">
                        <i className="fas fa-exclamation-circle text-orange-500 mr-2 mt-1 text-xs"></i>
                        {improvement}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="font-semibold text-blue-700 mb-2 flex items-center">
                    <i className="fas fa-forward mr-2"></i>
                    다음 단계
                  </h4>
                  <ul className="space-y-2" data-testid="next-steps-list">
                    {feedback?.detailedFeedback?.nextSteps?.map((step, index) => (
                      <li key={index} className="text-sm text-slate-600 flex items-start">
                        <i className="fas fa-play text-blue-500 mr-2 mt-1 text-xs"></i>
                        {step}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="pt-4 border-t border-slate-200">
                <p className="text-slate-700 leading-relaxed" data-testid="ranking-summary">
                  <strong>전문가 의견:</strong> {feedback?.detailedFeedback?.ranking}
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 행동 가이드 */}
        <TabsContent value="behavior" className="space-y-6 print-show-all print-section-break">
          <h2 className="print-section-title hidden print:block">🎯 행동 가이드</h2>
          <div className="grid grid-cols-1 gap-6">
            {feedback?.detailedFeedback?.behaviorGuides?.map((guide, index) => (
              <Card key={index} className="hover:shadow-md transition-shadow" data-testid={`behavior-guide-${index}`}>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center">
                    <i className="fas fa-lightbulb text-yellow-500 mr-2"></i>
                    {guide.situation}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="font-semibold text-corporate-700 mb-2">권장 행동</h4>
                    <p className="text-slate-700 bg-corporate-50 p-3 rounded-lg">{guide.action}</p>
                  </div>
                  <div>
                    <h4 className="font-semibold text-green-700 mb-2">구체적 예시</h4>
                    <div className="bg-green-50 border-l-4 border-green-400 p-3 rounded">
                      <p className="text-green-800 italic">"{guide.example}"</p>
                    </div>
                  </div>
                  <div>
                    <h4 className="font-semibold text-blue-700 mb-2">기대 효과</h4>
                    <div className="flex items-center space-x-2">
                      <i className="fas fa-chart-line text-blue-500"></i>
                      <p className="text-slate-700">{guide.impact}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )) || (
              <Card>
                <CardContent className="text-center py-8">
                  <i className="fas fa-info-circle text-slate-400 text-2xl mb-2"></i>
                  <p className="text-slate-500">구체적인 행동 가이드가 준비 중입니다.</p>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* 대화 가이드 */}
        <TabsContent value="conversation" className="space-y-6 print-show-all print-section-break">
          <h2 className="print-section-title hidden print:block">💬 대화 가이드</h2>
          <div className="grid grid-cols-1 gap-6">
            {feedback?.detailedFeedback?.conversationGuides?.map((guide, index) => (
              <Card key={index} className="hover:shadow-md transition-shadow" data-testid={`conversation-guide-${index}`}>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center">
                    <i className="fas fa-comments text-corporate-500 mr-2"></i>
                    {guide.scenario}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <h4 className="font-semibold text-green-700 mb-2 flex items-center">
                        <i className="fas fa-check-circle text-green-500 mr-2"></i>
                        좋은 예시
                      </h4>
                      <div className="bg-green-50 border border-green-200 p-3 rounded-lg">
                        <p className="text-green-800 text-sm">{guide.goodExample}</p>
                      </div>
                    </div>
                    <div>
                      <h4 className="font-semibold text-red-700 mb-2 flex items-center">
                        <i className="fas fa-times-circle text-red-500 mr-2"></i>
                        피해야 할 예시
                      </h4>
                      <div className="bg-red-50 border border-red-200 p-3 rounded-lg">
                        <p className="text-red-800 text-sm">{guide.badExample}</p>
                      </div>
                    </div>
                  </div>
                  <div>
                    <h4 className="font-semibold text-corporate-700 mb-2 flex items-center">
                      <i className="fas fa-key text-corporate-500 mr-2"></i>
                      핵심 포인트
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {guide.keyPoints.map((point, pointIndex) => (
                        <div key={pointIndex} className="flex items-center space-x-2 text-sm">
                          <i className="fas fa-circle text-corporate-400 text-xs"></i>
                          <span className="text-slate-700">{point}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )) || (
              <Card>
                <CardContent className="text-center py-8">
                  <i className="fas fa-info-circle text-slate-400 text-2xl mb-2"></i>
                  <p className="text-slate-500">맞춤형 대화 가이드가 준비 중입니다.</p>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* 개발 계획 */}
        <TabsContent value="development" className="space-y-6 print-show-all print-section-break">
          <h2 className="print-section-title hidden print:block">📈 개발 계획</h2>
          {feedback?.detailedFeedback?.developmentPlan && (
            <>
              {/* 단기/중기/장기 계획 */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="border-l-4 border-l-green-500" data-testid="short-term-plan">
                  <CardHeader>
                    <CardTitle className="text-green-700 flex items-center">
                      <i className="fas fa-calendar-week mr-2"></i>
                      단기 목표 (1-2주)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {feedback?.detailedFeedback?.developmentPlan?.shortTerm?.map((item, index) => (
                      <div key={index} className="bg-green-50 p-3 rounded-lg">
                        <h4 className="font-medium text-green-800 mb-2">{item.goal}</h4>
                        <ul className="space-y-1 mb-2">
                          {item.actions.map((action, actionIndex) => (
                            <li key={actionIndex} className="text-sm text-green-700 flex items-start">
                              <i className="fas fa-chevron-right mr-2 mt-1 text-xs"></i>
                              {action}
                            </li>
                          ))}
                        </ul>
                        <div className="text-xs text-green-600 bg-green-100 px-2 py-1 rounded">
                          측정지표: {item.measurable}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card className="border-l-4 border-l-blue-500" data-testid="medium-term-plan">
                  <CardHeader>
                    <CardTitle className="text-blue-700 flex items-center">
                      <i className="fas fa-calendar-alt mr-2"></i>
                      중기 목표 (1-2개월)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {feedback?.detailedFeedback?.developmentPlan?.mediumTerm?.map((item, index) => (
                      <div key={index} className="bg-blue-50 p-3 rounded-lg">
                        <h4 className="font-medium text-blue-800 mb-2">{item.goal}</h4>
                        <ul className="space-y-1 mb-2">
                          {item.actions.map((action, actionIndex) => (
                            <li key={actionIndex} className="text-sm text-blue-700 flex items-start">
                              <i className="fas fa-chevron-right mr-2 mt-1 text-xs"></i>
                              {action}
                            </li>
                          ))}
                        </ul>
                        <div className="text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded">
                          측정지표: {item.measurable}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card className="border-l-4 border-l-purple-500" data-testid="long-term-plan">
                  <CardHeader>
                    <CardTitle className="text-purple-700 flex items-center">
                      <i className="fas fa-calendar mr-2"></i>
                      장기 목표 (3-6개월)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {feedback?.detailedFeedback?.developmentPlan?.longTerm?.map((item, index) => (
                      <div key={index} className="bg-purple-50 p-3 rounded-lg">
                        <h4 className="font-medium text-purple-800 mb-2">{item.goal}</h4>
                        <ul className="space-y-1 mb-2">
                          {item.actions.map((action, actionIndex) => (
                            <li key={actionIndex} className="text-sm text-purple-700 flex items-start">
                              <i className="fas fa-chevron-right mr-2 mt-1 text-xs"></i>
                              {action}
                            </li>
                          ))}
                        </ul>
                        <div className="text-xs text-purple-600 bg-purple-100 px-2 py-1 rounded">
                          측정지표: {item.measurable}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>

              {/* 추천 리소스 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <i className="fas fa-book-open text-corporate-600 mr-2"></i>
                    추천 학습 자료 및 리소스
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="recommended-resources">
                    {feedback?.detailedFeedback?.developmentPlan?.recommendedResources?.map((resource, index) => (
                      <div key={index} className="flex items-start space-x-3 p-3 bg-slate-50 rounded-lg">
                        <i className="fas fa-bookmark text-corporate-500 mt-1"></i>
                        <p className="text-slate-700 text-sm">{resource}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* 전략 평가 */}
        {feedback?.detailedFeedback?.sequenceAnalysis && (
          <TabsContent value="strategy" className="space-y-6 print-show-all print-section-break">
            <h2 className="print-section-title hidden print:block">🎮 전략 평가</h2>
            <Card className="border-l-4 border-l-purple-500">
              <CardHeader>
                <CardTitle className="flex items-center text-xl">
                  <i className="fas fa-chess text-purple-600 mr-3"></i>
                  전략적 선택 분석
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* 전략 점수 */}
                <div className="bg-purple-50 p-6 rounded-lg">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-purple-900">전략 점수</h3>
                    <Badge variant="outline" className="text-2xl font-bold bg-purple-100 text-purple-700 px-4 py-2">
                      {feedback.detailedFeedback.sequenceAnalysis.strategicScore ?? '평가 대기중'}
                    </Badge>
                  </div>
                  <p className="text-purple-700">
                    {feedback.detailedFeedback.sequenceAnalysis.strategicRationale || '전략 평가가 아직 생성되지 않았습니다.'}
                  </p>
                </div>

                {/* 순서 선택의 효과성 */}
                {feedback.detailedFeedback.sequenceAnalysis.sequenceEffectiveness && (
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900 mb-3 flex items-center">
                      <i className="fas fa-bullseye text-blue-500 mr-2"></i>
                      순서 선택의 효과성
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
                      전략적 통찰
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
                      대안적 접근법
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
        <Button 
          onClick={() => window.location.href = '/mypage'}
          variant="outline"
          className="min-w-[120px]"
          data-testid="back-to-mypage-button"
        >
          <i className="fas fa-home mr-2"></i>
          마이페이지
        </Button>
        
        {/* Home.tsx에서 전달된 다음 페르소나 버튼 (우선순위 높음) */}
        {hasMorePersonas && onNextPersona && (
          <Button 
            onClick={onNextPersona}
            className="min-w-[120px] bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
            data-testid="next-persona-button"
          >
            <i className="fas fa-arrow-right mr-2"></i>
            다음 페르소나와 대화하기
          </Button>
        )}
        
        {/* 모든 페르소나 완료 시 전략 평가 버튼 */}
        {allPersonasCompleted && onNextPersona && (
          <Button 
            onClick={onNextPersona}
            className="min-w-[120px] bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700"
            data-testid="strategy-reflection-button"
          >
            <i className="fas fa-clipboard-list mr-2"></i>
            전략 평가 보기
          </Button>
        )}
        
        {/* FeedbackView에서 사용하는 기존 순차적 다음 페르소나 버튼 */}
        {!hasMorePersonas && !allPersonasCompleted && nextPersona && !isNextConversationCompleted() && (
          <Button 
            onClick={handleNextConversation}
            className="min-w-[120px] bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
            data-testid="next-persona-legacy-button"
            disabled={createNextConversationMutation.isPending}
          >
            <i className="fas fa-arrow-right mr-2"></i>
            {createNextConversationMutation.isPending ? '생성 중...' : `다음 대화 상대: ${nextPersona.name}`}
          </Button>
        )}
        
        <Button 
          onClick={onSelectNewScenario}
          variant="outline"
          className="min-w-[120px]"
          data-testid="new-scenario-button"
        >
          <i className="fas fa-redo mr-2"></i>
          새로운 훈련
        </Button>
        <Button 
          onClick={onRetry}
          className="min-w-[120px]"
          data-testid="retry-scenario-button"
        >
          <i className="fas fa-sync-alt mr-2"></i>
          같은 시나리오 재도전
        </Button>
        <Button 
          variant="secondary"
          onClick={handlePrint}
          className="min-w-[120px]"
          data-testid="print-report-button"
        >
          <i className="fas fa-print mr-2"></i>
          보고서 인쇄
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
              다운로드 중...
            </>
          ) : (
            <>
              <i className="fas fa-download mr-2"></i>
              HTML 다운로드
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
                  다음 페르소나
                </Button>
              )}
              
              {allPersonasCompleted && onNextPersona && (
                <Button 
                  onClick={() => { setShowMobileMenu(false); onNextPersona(); }}
                  className="w-full text-sm bg-gradient-to-r from-purple-600 to-indigo-600"
                  data-testid="mobile-strategy-button"
                >
                  <i className="fas fa-clipboard-list mr-1"></i>
                  전략 평가
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
                  다음 대화
                </Button>
              )}
              
              <Button 
                onClick={() => { setShowMobileMenu(false); onSelectNewScenario(); }}
                variant="outline"
                className="w-full text-sm"
                data-testid="mobile-new-scenario-button"
              >
                <i className="fas fa-redo mr-1"></i>
                새 훈련
              </Button>
              
              <Button 
                onClick={() => { setShowMobileMenu(false); onRetry(); }}
                className="w-full text-sm"
                data-testid="mobile-retry-button"
              >
                <i className="fas fa-sync-alt mr-1"></i>
                재도전
              </Button>
              
              <Button 
                variant="secondary"
                onClick={() => { setShowMobileMenu(false); handlePrint(); }}
                className="w-full text-sm"
                data-testid="mobile-print-button"
              >
                <i className="fas fa-print mr-1"></i>
                인쇄
              </Button>
              
              <Button 
                variant="outline"
                onClick={() => { setShowMobileMenu(false); handleDownloadHtml(); }}
                disabled={isExportingPdf}
                className="w-full text-sm"
                data-testid="mobile-download-button"
              >
                <i className="fas fa-download mr-1"></i>
                다운로드
              </Button>
            </div>
          </div>
        )}
        
        {/* 하단 스마트 버튼 바 */}
        <div className="flex items-center justify-between p-3">
          <Button 
            onClick={() => window.location.href = '/mypage'}
            variant="outline"
            className="flex-1 mr-2"
            data-testid="mobile-mypage-button"
          >
            <i className="fas fa-home mr-2"></i>
            마이페이지
          </Button>
          
          <Button 
            onClick={() => setShowMobileMenu(!showMobileMenu)}
            className={`flex-1 ${showMobileMenu ? 'bg-slate-600' : 'bg-indigo-600'}`}
            data-testid="mobile-menu-toggle"
          >
            <i className={`fas ${showMobileMenu ? 'fa-times' : 'fa-th-large'} mr-2`}></i>
            {showMobileMenu ? '닫기' : '더보기'}
          </Button>
        </div>
      </div>
      
      {/* 모바일 하단 메뉴 공간 확보 */}
      <div className="md:hidden h-20"></div>
    </div>
  );
}