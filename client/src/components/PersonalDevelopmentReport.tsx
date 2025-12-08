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

  // PDF 파일로 저장
  const handleExportPdf = async () => {
    if (!reportRef.current) return;
    
    setIsExportingPdf(true);
    try {
      // 동적으로 html2pdf 라이브러리 로드
      const html2pdfModule = await import('html2pdf.js');
      const html2pdf = html2pdfModule.default || html2pdfModule;
      
      if (!html2pdf) {
        throw new Error('html2pdf 라이브러리를 로드할 수 없습니다.');
      }
      
      // PDF 내보내기 모드 클래스 추가
      reportRef.current.classList.add('pdf-export-mode');
      
      const opt = {
        margin: [10, 10, 10, 10] as [number, number, number, number],
        filename: `개발보고서_${scenario.title}_${new Date().toLocaleDateString('ko-KR').replace(/\./g, '-')}.pdf`,
        image: { type: 'jpeg' as const, quality: 0.98 },
        html2canvas: { 
          scale: 2,
          useCORS: true,
          letterRendering: true,
          scrollY: 0
        },
        jsPDF: { 
          unit: 'mm' as const, 
          format: 'a4' as const, 
          orientation: 'portrait' as const 
        },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
      };
      
      await html2pdf().set(opt).from(reportRef.current).save();
      
      toast({
        title: "PDF 저장 완료",
        description: "보고서가 PDF 파일로 저장되었습니다.",
      });
    } catch (error) {
      console.error('PDF 저장 오류:', error);
      toast({
        title: "PDF 저장 실패",
        description: "PDF 파일 저장 중 오류가 발생했습니다.",
        variant: "destructive"
      });
    } finally {
      // PDF 내보내기 모드 클래스 제거
      reportRef.current?.classList.remove('pdf-export-mode');
      setIsExportingPdf(false);
    }
  };

  // 보고서 인쇄
  const handlePrint = () => {
    try {
      window.print();
    } catch (error) {
      console.error('인쇄 오류:', error);
      const userAgent = navigator.userAgent;
      let message = '인쇄 기능을 사용할 수 없습니다.';
      
      if (userAgent.includes('Chrome')) {
        message += ' Chrome에서 Ctrl+P를 눌러 직접 인쇄해보세요.';
      } else if (userAgent.includes('Firefox')) {
        message += ' Firefox에서 Ctrl+P를 눌러 직접 인쇄해보세요.';
      } else {
        message += ' 브라우저에서 Ctrl+P(Windows) 또는 Cmd+P(Mac)를 눌러 직접 인쇄해보세요.';
      }
      
      toast({
        title: "인쇄 오류",
        description: message,
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
            <h1 className="text-2xl font-bold mb-2" data-testid="report-title">개인 맞춤 개발 보고서</h1>
            <p className="text-corporate-100">AI 분석 기반 커뮤니케이션 역량 진단 및 발전 계획</p>
            <div className="mt-3 text-sm text-corporate-200">
              <i className="fas fa-user mr-2"></i>
              대화 상대: {persona.name} ({persona.role}) · 시나리오: {scenario.title}
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

      {/* 액션 버튼 */}
      <div className="flex justify-center space-x-4 pt-6 border-t border-slate-200 no-print">
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
          onClick={handleExportPdf}
          disabled={isExportingPdf}
          className="min-w-[120px]"
          data-testid="export-pdf-button"
        >
          {isExportingPdf ? (
            <>
              <i className="fas fa-spinner fa-spin mr-2"></i>
              PDF 저장 중...
            </>
          ) : (
            <>
              <i className="fas fa-file-pdf mr-2"></i>
              PDF 저장
            </>
          )}
        </Button>
      </div>
    </div>
  );
}