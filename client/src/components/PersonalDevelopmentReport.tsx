import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

import type { Scenario } from "@/lib/scenarios";
import type { Feedback } from "@shared/schema";

interface PersonalDevelopmentReportProps {
  scenario: Scenario;
  conversationId: string;
  onRetry: () => void;
  onSelectNewScenario: () => void;
}

// 애니메이션 없이 바로 값 표시 (hooks 오류 방지)
const getDisplayValue = (value: number) => value;
const getProgressWidth = (value: number) => value;

export default function PersonalDevelopmentReport({ 
  scenario, 
  conversationId, 
  onRetry, 
  onSelectNewScenario 
}: PersonalDevelopmentReportProps) {
  const { toast } = useToast();
  const [showDetailedFeedback, setShowDetailedFeedback] = useState(true); // 애니메이션 없이 바로 표시

  // 먼저 피드백이 존재하는지 확인하고, 없으면 자동으로 생성 시도
  const { data: feedback, isLoading, error, refetch } = useQuery<Feedback>({
    queryKey: ["/api/conversations", conversationId, "feedback"],
    enabled: !!conversationId,
    retry: false, // 404 에러 시 재시도하지 않음
    staleTime: 0,
    queryFn: async () => {
      try {
        const response = await fetch(`/api/conversations/${conversationId}/feedback`);
        if (response.status === 404) {
          // 피드백이 없으면 자동으로 생성 시도
          console.log("피드백이 없음, 자동 생성 시도...");
          throw new Error("FEEDBACK_NOT_FOUND");
        }
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      } catch (error) {
        console.error("피드백 조회 오류:", error);
        throw error;
      }
    }
  });



  const generateFeedbackMutation = useMutation({
    mutationFn: async () => {
      console.log("피드백 생성 요청 시작:", conversationId);
      try {
        const response = await fetch(`/api/conversations/${conversationId}/feedback`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
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
      console.log("피드백 생성 완료, 페이지 새로고침");
      // 성공 후 자동으로 새로고침하여 최신 데이터 가져오기
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: [`/api/conversations/${conversationId}/feedback`] });
        refetch();
      }, 1000);
    },
    onError: (error) => {
      console.error("Feedback generation error:", error);
      toast({
        title: "오류",
        description: `피드백을 생성할 수 없습니다: ${error.message}`,
        variant: "destructive"
      });
    }
  });

  // 로딩 중이거나 피드백 생성 중일 때만 로딩 표시
  if (isLoading || generateFeedbackMutation.isPending) {
    return (
      <div className="text-center py-16" data-testid="feedback-loading">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-corporate-600 mx-auto mb-4"></div>
        <h2 className="text-xl font-semibold text-slate-900 mb-2">개인 맞춤 분석 중...</h2>
        <p className="text-slate-600">AI가 대화를 심층 분석하여 맞춤형 개발 계획을 수립하고 있습니다.</p>
      </div>
    );
  }

  // 피드백이 없고 아직 생성 중이 아니라면 자동으로 생성 시도
  if (error && error.message === "FEEDBACK_NOT_FOUND" && !generateFeedbackMutation.isPending) {
    console.log("피드백이 없음, 자동 생성 시도...");
    generateFeedbackMutation.mutate();
  }

  // 피드백이 없고 오류가 발생했을 때 오류 화면 표시
  if (!feedback && !isLoading && !generateFeedbackMutation.isPending && error && error.message !== "FEEDBACK_NOT_FOUND") {
    return (
      <div className="text-center py-16" data-testid="feedback-error">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <i className="fas fa-exclamation-triangle text-red-600 text-xl"></i>
        </div>
        <h2 className="text-xl font-semibold text-slate-900 mb-2">분석 보고서를 생성할 수 없습니다</h2>
        <p className="text-slate-600 mb-4">대화가 완료되지 않았거나 오류가 발생했습니다.</p>
        <div className="space-y-2">
          <Button onClick={() => generateFeedbackMutation.mutate()} data-testid="retry-feedback">
            분석 다시 시도
          </Button>
          <Button variant="outline" onClick={() => refetch()} data-testid="refetch-feedback">
            데이터 다시 가져오기
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
    <div className="max-w-6xl mx-auto space-y-6" data-testid="personal-development-report">
      {/* PDF 전용 헤더 (인쇄 시에만 표시) */}
      <div className="pdf-header" style={{ display: 'none' }}>
        RolePlayX
      </div>
      
      {/* 화면용 헤더 */}
      <div 
        className="bg-gradient-to-r from-corporate-600 to-corporate-700 rounded-xl p-6 text-white transform transition-all duration-700 hover:shadow-2xl screen-only"
        style={{ 
          opacity: 0,
          animation: `fadeInUp 0.8s ease-out forwards`
        }}
      >
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
              훈련 시나리오: {scenario.name} ({scenario.role})
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

      <Tabs defaultValue="scores" className="space-y-6">
        <TabsList 
          className="grid w-full grid-cols-4 transform transition-all duration-500 screen-only"
          style={{ 
            opacity: 0,
            animation: `fadeInUp 0.6s ease-out 1s forwards`
          }}
        >
          <TabsTrigger value="scores" data-testid="tab-scores" className="transition-all duration-300 hover:scale-105">성과 분석</TabsTrigger>
          <TabsTrigger value="behavior" data-testid="tab-behavior" className="transition-all duration-300 hover:scale-105">행동 가이드</TabsTrigger>
          <TabsTrigger value="conversation" data-testid="tab-conversation" className="transition-all duration-300 hover:scale-105">대화 가이드</TabsTrigger>
          <TabsTrigger value="development" data-testid="tab-development" className="transition-all duration-300 hover:scale-105">개발 계획</TabsTrigger>
        </TabsList>

        {/* 성과 분석 */}
        <TabsContent value="scores" className="space-y-6 print-show-all">
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
        <TabsContent value="behavior" className="space-y-6 print-show-all">
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
        <TabsContent value="conversation" className="space-y-6 print-show-all">
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
        <TabsContent value="development" className="space-y-6 print-show-all">
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
      </Tabs>

      {/* 액션 버튼 */}
      <div className="flex justify-center space-x-4 pt-6 border-t border-slate-200 no-print">
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
          onClick={() => window.print()}
          className="min-w-[120px]"
          data-testid="print-report-button"
        >
          <i className="fas fa-print mr-2"></i>
          보고서 인쇄
        </Button>
      </div>
    </div>
  );
}