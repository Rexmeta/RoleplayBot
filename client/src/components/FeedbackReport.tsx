import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import type { Scenario } from "@/lib/scenarios";
import type { Feedback } from "@shared/schema";

interface FeedbackReportProps {
  scenario: Scenario;
  conversationId: string;
  onRetry: () => void;
  onSelectNewScenario: () => void;
}

export default function FeedbackReport({ 
  scenario, 
  conversationId, 
  onRetry, 
  onSelectNewScenario 
}: FeedbackReportProps) {
  const { toast } = useToast();

  const { data: feedback, isLoading, error } = useQuery<Feedback>({
    queryKey: ["/api/conversations", conversationId, "feedback"],
    enabled: !!conversationId,
  });

  const generateFeedbackMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/conversations/${conversationId}/feedback`);
      return response.json();
    },
    onError: () => {
      toast({
        title: "오류",
        description: "피드백을 생성할 수 없습니다. 다시 시도해주세요.",
        variant: "destructive"
      });
    }
  });

  if (isLoading || generateFeedbackMutation.isPending) {
    return (
      <div className="text-center py-16">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-corporate-600 mx-auto mb-4"></div>
        <h2 className="text-xl font-semibold text-slate-900 mb-2">피드백 분석 중...</h2>
        <p className="text-slate-600">AI가 대화를 분석하고 있습니다. 잠시만 기다려주세요.</p>
      </div>
    );
  }

  if (error || !feedback) {
    return (
      <div className="text-center py-16">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <i className="fas fa-exclamation-triangle text-red-600 text-xl"></i>
        </div>
        <h2 className="text-xl font-semibold text-slate-900 mb-2">피드백을 불러올 수 없습니다</h2>
        <p className="text-slate-600 mb-4">대화가 완료되지 않았거나 오류가 발생했습니다.</p>
        <Button onClick={() => generateFeedbackMutation.mutate()}>
          피드백 다시 생성
        </Button>
      </div>
    );
  }

  const getScoreColor = (score: number) => {
    if (score >= 2) return "green";
    if (score >= 1) return "yellow";
    return "red";
  };

  const getOverallGrade = (score: number) => {
    if (score >= 90) return { grade: "우수한 성과입니다!", color: "green", ranking: "상위 5%" };
    if (score >= 80) return { grade: "좋은 성과입니다!", color: "green", ranking: "상위 15%" };
    if (score >= 70) return { grade: "보통 수준입니다.", color: "yellow", ranking: "상위 30%" };
    if (score >= 60) return { grade: "개선이 필요합니다.", color: "orange", ranking: "상위 50%" };
    return { grade: "더 많은 연습이 필요합니다.", color: "red", ranking: "하위 30%" };
  };

  const overallGrade = getOverallGrade(feedback.overallScore);

  return (
    <div className="feedback-report">
      <div className="text-center mb-8">
        <div className="w-20 h-20 bg-gradient-to-br from-green-400 to-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <i className="fas fa-check text-white text-2xl"></i>
        </div>
        <h2 className="text-3xl font-bold text-slate-900 mb-2">훈련 완료!</h2>
        <p className="text-lg text-slate-600">{scenario.name} {scenario.skills.join(", ")} 시나리오 결과</p>
      </div>

      {/* Overall Score */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 mb-8">
        <div className="text-center mb-6">
          <h3 className="text-xl font-semibold text-slate-900 mb-4">종합 점수</h3>
          <div className="relative inline-block">
            <div className="w-32 h-32 rounded-full border-8 border-slate-200 flex items-center justify-center">
              <div className="text-center">
                <div className={`text-3xl font-bold text-${overallGrade.color}-600`}>
                  {feedback.overallScore}
                </div>
                <div className="text-sm text-slate-500">/ 100</div>
              </div>
            </div>
            <div 
              className={`absolute inset-0 rounded-full border-8 border-${overallGrade.color}-600`}
              style={{ 
                clipPath: `polygon(50% 50%, 50% 0%, 100% 0%, 100% ${feedback.overallScore}%, 50% 50%)` 
              }}
            ></div>
          </div>
          <p className={`text-lg font-medium text-${overallGrade.color}-600 mt-4`}>
            {overallGrade.grade}
          </p>
          <p className="text-sm text-slate-600 mt-2">
            {feedback.detailedFeedback.ranking}
          </p>
        </div>
      </div>

      {/* Detailed Scores */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 mb-8">
        <h3 className="text-xl font-semibold text-slate-900 mb-6">세부 평가 항목</h3>
        
        <div className="space-y-6">
          {feedback.scores.map((scoreItem, index) => (
            <div key={index} className="evaluation-item">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-medium text-slate-900 flex items-center">
                  <i className={`${scoreItem.icon} text-${scoreItem.color}-600 mr-2`}></i>
                  {scoreItem.name}
                </h4>
                <div className="flex items-center space-x-2">
                  <span className={`text-2xl font-bold text-${getScoreColor(scoreItem.score)}-600`}>
                    {scoreItem.score}
                  </span>
                  <span className="text-slate-400">/2</span>
                </div>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-2 mb-2">
                <div 
                  className={`bg-${getScoreColor(scoreItem.score)}-600 h-2 rounded-full transition-all duration-300`}
                  style={{ width: `${(scoreItem.score / 2) * 100}%` }}
                ></div>
              </div>
              <p className="text-sm text-slate-600">{scoreItem.feedback}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Detailed Feedback */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 mb-8">
        <h3 className="text-xl font-semibold text-slate-900 mb-6 flex items-center">
          <i className="fas fa-clipboard-list text-corporate-600 mr-2"></i>
          상세 피드백
        </h3>
        
        <div className="space-y-6">
          <div className="border-l-4 border-green-500 pl-4">
            <h4 className="font-medium text-green-700 mb-2">잘한 점</h4>
            <ul className="text-sm text-slate-600 space-y-1">
              {feedback.detailedFeedback.strengths.map((strength, index) => (
                <li key={index}>• {strength}</li>
              ))}
            </ul>
          </div>

          <div className="border-l-4 border-amber-500 pl-4">
            <h4 className="font-medium text-amber-700 mb-2">개선할 점</h4>
            <ul className="text-sm text-slate-600 space-y-1">
              {feedback.detailedFeedback.improvements.map((improvement, index) => (
                <li key={index}>• {improvement}</li>
              ))}
            </ul>
          </div>

          <div className="border-l-4 border-blue-500 pl-4">
            <h4 className="font-medium text-blue-700 mb-2">다음 단계 추천</h4>
            <ul className="text-sm text-slate-600 space-y-1">
              {feedback.detailedFeedback.nextSteps.map((step, index) => (
                <li key={index}>• {step}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex justify-center space-x-4 mb-12">
        <Button 
          onClick={onRetry}
          data-testid="button-retry-scenario"
        >
          <i className="fas fa-redo mr-2"></i>
          다시 도전하기
        </Button>
        <Button 
          variant="outline"
          onClick={onSelectNewScenario}
          data-testid="button-select-new-scenario"
        >
          <i className="fas fa-list mr-2"></i>
          다른 시나리오 선택
        </Button>
        <Button 
          variant="outline"
          onClick={() => {
            // Generate and download report
            const reportData = {
              scenario: scenario.name,
              score: feedback.overallScore,
              date: new Date().toLocaleDateString('ko-KR'),
              details: feedback
            };
            const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${scenario.name}_훈련결과_${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          data-testid="button-download-report"
        >
          <i className="fas fa-download mr-2"></i>
          보고서 다운로드
        </Button>
      </div>
    </div>
  );
}
