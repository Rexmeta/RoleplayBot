import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, Minus, Award, Target, BarChart3, Calendar } from "lucide-react";
import { Link } from "wouter";

type AnalyticsSummary = {
  totalSessions: number;
  averageScore: number;
  categoryAverages: {
    clarityLogic: number;
    listeningEmpathy: number;
    appropriatenessAdaptability: number;
    persuasivenessImpact: number;
    strategicCommunication: number;
  };
  scoreHistory: Array<{
    date: string;
    score: number;
    conversationId: string;
  }>;
  topStrengths: Array<{ text: string; count: number }>;
  topImprovements: Array<{ text: string; count: number }>;
  overallGrade: string;
  progressTrend: 'improving' | 'stable' | 'declining' | 'neutral';
  lastSessionDate?: string;
};

export default function Analytics() {
  const { data: analytics, isLoading } = useQuery<AnalyticsSummary>({
    queryKey: ['/api/analytics/summary'],
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center" data-testid="analytics-loading">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-corporate-600"></div>
      </div>
    );
  }

  if (!analytics || analytics.totalSessions === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8" data-testid="analytics-empty">
        <div className="max-w-4xl mx-auto">
          <div className="flex justify-between items-center mb-8">
            <h1 className="text-3xl font-bold text-slate-900">종합 분석</h1>
            <div className="flex gap-3">
              <Button 
                onClick={() => window.location.href = '/home'}
                variant="outline"
                data-testid="scenario-list-button"
                className="flex items-center gap-2"
              >
                <i className="fas fa-list"></i>
                시나리오 리스트
              </Button>
              <Link href="/mypage">
                <Button variant="outline" data-testid="button-back-mypage">마이페이지로</Button>
              </Link>
            </div>
          </div>
          
          <Card>
            <CardContent className="text-center py-16">
              <BarChart3 className="w-16 h-16 text-slate-300 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-slate-900 mb-2">아직 분석할 데이터가 없습니다</h2>
              <p className="text-slate-600 mb-6">대화를 완료하고 피드백을 받으면 종합 분석이 표시됩니다.</p>
              <Link href="/">
                <Button data-testid="button-start-conversation">첫 대화 시작하기</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const categoryNames = {
    clarityLogic: "명확성 & 논리성",
    listeningEmpathy: "경청 & 공감",
    appropriatenessAdaptability: "적절성 & 상황 대응",
    persuasivenessImpact: "설득력 & 영향력",
    strategicCommunication: "전략적 커뮤니케이션"
  };

  const categoryIcons = {
    clarityLogic: "🎯",
    listeningEmpathy: "👂",
    appropriatenessAdaptability: "⚡",
    persuasivenessImpact: "🎪",
    strategicCommunication: "🎲"
  };

  const getGradeColor = (grade: string) => {
    if (grade.startsWith('A')) return 'text-green-600 bg-green-50';
    if (grade === 'B') return 'text-blue-600 bg-blue-50';
    if (grade === 'C') return 'text-yellow-600 bg-yellow-50';
    return 'text-red-600 bg-red-50';
  };

  const getTrendIcon = () => {
    switch (analytics.progressTrend) {
      case 'improving':
        return <TrendingUp className="w-5 h-5 text-green-600" />;
      case 'declining':
        return <TrendingDown className="w-5 h-5 text-red-600" />;
      default:
        return <Minus className="w-5 h-5 text-slate-600" />;
    }
  };

  const getTrendText = () => {
    switch (analytics.progressTrend) {
      case 'improving':
        return '성장 중';
      case 'declining':
        return '하락 중';
      case 'stable':
        return '안정적';
      default:
        return '중립';
    }
  };

  const getTrendColor = () => {
    switch (analytics.progressTrend) {
      case 'improving':
        return 'text-green-600 bg-green-50';
      case 'declining':
        return 'text-red-600 bg-red-50';
      default:
        return 'text-slate-600 bg-slate-50';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8" data-testid="analytics-page">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 mb-2">종합 커뮤니케이션 분석</h1>
            <p className="text-slate-600">
              총 {analytics.totalSessions}회의 대화 세션 데이터를 기반으로 한 종합 분석
            </p>
          </div>
          <div className="flex gap-3">
            <Button 
              onClick={() => window.location.href = '/home'}
              variant="outline"
              data-testid="scenario-list-button"
              className="flex items-center gap-2"
            >
              <i className="fas fa-list"></i>
              시나리오 리스트
            </Button>
            <Link href="/mypage">
              <Button variant="outline" data-testid="button-back-mypage">마이페이지로</Button>
            </Link>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {/* Overall Score */}
          <Card data-testid="card-overall-score">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                <Award className="w-4 h-4" />
                종합 점수
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-3">
                <div className="text-4xl font-bold text-slate-900" data-testid="text-average-score">
                  {analytics.averageScore}
                </div>
                <div className={`px-3 py-1 rounded-full text-sm font-semibold mb-1 ${getGradeColor(analytics.overallGrade)}`} data-testid="badge-grade">
                  {analytics.overallGrade} 등급
                </div>
              </div>
              <Progress value={analytics.averageScore} className="mt-4" />
            </CardContent>
          </Card>

          {/* Sessions Count */}
          <Card data-testid="card-sessions">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                완료한 세션
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-slate-900" data-testid="text-total-sessions">
                {analytics.totalSessions}
              </div>
              <p className="text-sm text-slate-500 mt-2">
                {analytics.lastSessionDate && (
                  <>마지막 세션: {new Date(analytics.lastSessionDate).toLocaleDateString('ko-KR')}</>
                )}
              </p>
            </CardContent>
          </Card>

          {/* Progress Trend */}
          <Card data-testid="card-trend">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                <Target className="w-4 h-4" />
                성장 추세
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                {getTrendIcon()}
                <div className={`px-3 py-1 rounded-full text-sm font-semibold ${getTrendColor()}`} data-testid="badge-trend">
                  {getTrendText()}
                </div>
              </div>
              <p className="text-sm text-slate-500 mt-3">
                {analytics.progressTrend === 'improving' && '최근 실력이 향상되고 있습니다'}
                {analytics.progressTrend === 'declining' && '추가 연습이 필요합니다'}
                {analytics.progressTrend === 'stable' && '안정적인 수준을 유지하고 있습니다'}
                {analytics.progressTrend === 'neutral' && '데이터가 더 필요합니다'}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Category Breakdown */}
        <Card className="mb-8" data-testid="card-categories">
          <CardHeader>
            <CardTitle>카테고리별 평균 점수</CardTitle>
            <CardDescription>5개 평가 항목별 종합 분석 (5점 만점)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {Object.entries(analytics.categoryAverages).map(([key, value]) => (
                <div key={key} data-testid={`category-${key}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{categoryIcons[key as keyof typeof categoryIcons]}</span>
                      <span className="font-medium text-slate-900">
                        {categoryNames[key as keyof typeof categoryNames]}
                      </span>
                    </div>
                    <span className="text-lg font-semibold text-slate-900" data-testid={`score-${key}`}>
                      {value.toFixed(1)} / 5.0
                    </span>
                  </div>
                  <Progress value={value * 20} className="h-3" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Score History Chart */}
        {analytics.scoreHistory.length > 1 && (
          <Card className="mb-8" data-testid="card-history">
            <CardHeader>
              <CardTitle>점수 변화 추이</CardTitle>
              <CardDescription>시간에 따른 성장 곡선</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {analytics.scoreHistory.map((entry, index) => (
                  <div key={entry.conversationId} className="flex items-center gap-4" data-testid={`history-${index}`}>
                    <div className="text-sm text-slate-500 w-32">
                      {new Date(entry.date).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
                    </div>
                    <Progress value={entry.score} className="flex-1 h-2" />
                    <div className="text-sm font-semibold text-slate-900 w-12 text-right" data-testid={`history-score-${index}`}>
                      {entry.score}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Strengths and Improvements */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Top Strengths */}
          {analytics.topStrengths.length > 0 && (
            <Card data-testid="card-strengths">
              <CardHeader>
                <CardTitle className="text-green-600">주요 강점</CardTitle>
                <CardDescription>가장 자주 나타나는 강점 패턴</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {analytics.topStrengths.map((strength, index) => (
                    <div key={index} className="flex items-start gap-3" data-testid={`strength-${index}`}>
                      <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 shrink-0">
                        {strength.count}회
                      </Badge>
                      <p className="text-sm text-slate-700 leading-relaxed">{strength.text}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Top Improvements */}
          {analytics.topImprovements.length > 0 && (
            <Card data-testid="card-improvements">
              <CardHeader>
                <CardTitle className="text-orange-600">개선 필요 영역</CardTitle>
                <CardDescription>지속적으로 나타나는 개선점</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {analytics.topImprovements.map((improvement, index) => (
                    <div key={index} className="flex items-start gap-3" data-testid={`improvement-${index}`}>
                      <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200 shrink-0">
                        {improvement.count}회
                      </Badge>
                      <p className="text-sm text-slate-700 leading-relaxed">{improvement.text}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Call to Action */}
        <div className="mt-8 text-center">
          <Link href="/">
            <Button size="lg" data-testid="button-continue-practice">
              <Calendar className="w-4 h-4 mr-2" />
              연습 계속하기
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
