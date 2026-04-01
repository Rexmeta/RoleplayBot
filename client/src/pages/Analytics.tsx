import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, TrendingDown, Minus, Award, Target, BarChart3, Calendar, HelpCircle, MessageSquare, Filter } from "lucide-react";
import { Link } from "wouter";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

type EvaluationDimension = {
  id: string;
  key: string;
  name: string;
  description: string;
  icon?: string;
  color?: string;
  weight: number;
  minScore: number;
  maxScore: number;
};

type EvaluationCriteriaSet = {
  id: string;
  name: string;
  description?: string;
  dimensions: EvaluationDimension[];
};

type CriteriaDetail = {
  key: string;
  name: string;
  icon: string;
  color: string;
  averageScore: number;
  evaluationCount: number;
};

type UsedCriteriaSet = {
  id: string;
  name: string;
  feedbackCount: number;
};

type AnalyticsSummary = {
  totalSessions: number;
  completedSessions?: number;
  totalFeedbacks?: number;
  averageScore: number;
  categoryAverages: Record<string, number>;
  criteriaDetails?: CriteriaDetail[];
  criteriaDetailsBySet?: Record<string, CriteriaDetail[]>;
  usedCriteriaSets?: UsedCriteriaSet[];
  scoreHistory: Array<{
    date: string;
    time?: string;
    score: number;
    conversationId: string;
  }>;
  topStrengths: Array<{ category: string; count: number; items: string[] }>;
  topImprovements: Array<{ category: string; count: number; items: string[] }>;
  overallGrade: string;
  progressTrend: 'improving' | 'stable' | 'declining' | 'neutral';
  lastSessionDate?: string;
};

const DEFAULT_DIMENSION_ICONS: Record<string, string> = {
  clarityLogic: "🎯",
  listeningEmpathy: "👂",
  appropriatenessAdaptability: "⚡",
  persuasivenessImpact: "🎪",
  strategicCommunication: "🎲"
};

const DEFAULT_DIMENSION_NAMES: Record<string, string> = {
  clarityLogic: "명확성 & 논리성",
  listeningEmpathy: "경청 & 공감",
  appropriatenessAdaptability: "적절성 & 상황 대응",
  persuasivenessImpact: "설득력 & 영향력",
  strategicCommunication: "전략적 커뮤니케이션"
};

const FA_TO_EMOJI: Record<string, string> = {
  'fa-solid fa-bullseye': '🎯',
  'fa-solid fa-heart': '❤️',
  'fa-solid fa-arrows-rotate': '🔄',
  'fa-solid fa-chart-line': '📈',
  'fa-solid fa-chess': '♟️',
  'fa-solid fa-comments': '💬',
  'fa-solid fa-handshake': '🤝',
  'fa-solid fa-brain': '🧠',
  'fa-solid fa-lightbulb': '💡',
  'fa-solid fa-star': '⭐',
};

const getDisplayIcon = (icon: string): string => {
  if (!icon) return '📊';
  if (icon.startsWith('fa-')) {
    return FA_TO_EMOJI[icon] || '📊';
  }
  return icon;
};

export default function Analytics() {
  const [selectedCriteriaSet, setSelectedCriteriaSet] = useState<string>("all");
  
  const { data: analytics, isLoading } = useQuery<AnalyticsSummary>({
    queryKey: ['/api/analytics/summary'],
    staleTime: 1000 * 60,
    gcTime: 1000 * 60 * 5,
  });

  const { data: evaluationCriteria } = useQuery<EvaluationCriteriaSet>({
    queryKey: ['/api/evaluation-criteria/active'],
    staleTime: 1000 * 60 * 10,
  });
  
  const getFilteredCriteriaDetails = () => {
    if (selectedCriteriaSet === "all") {
      return analytics?.criteriaDetails || [];
    }
    return analytics?.criteriaDetailsBySet?.[selectedCriteriaSet] || [];
  };

  const getDimensionName = (key: string): string => {
    const dimension = evaluationCriteria?.dimensions?.find(d => d.key === key);
    return dimension?.name || DEFAULT_DIMENSION_NAMES[key] || key;
  };

  const getDimensionIcon = (key: string): string => {
    const dimension = evaluationCriteria?.dimensions?.find(d => d.key === key);
    if (dimension?.icon) {
      const iconMap: Record<string, string> = {
        'fa-solid fa-bullseye': '🎯',
        'fa-solid fa-heart': '👂',
        'fa-solid fa-arrows-rotate': '⚡',
        'fa-solid fa-chart-line': '🎪',
        'fa-solid fa-chess': '🎲'
      };
      return iconMap[dimension.icon] || DEFAULT_DIMENSION_ICONS[key] || '📊';
    }
    return DEFAULT_DIMENSION_ICONS[key] || '📊';
  };

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
            <Link href="/mypage">
              <Button variant="outline" data-testid="button-back-mypage">마이페이지로</Button>
            </Link>
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
              {analytics.completedSessions ? `${analytics.completedSessions}/${analytics.totalSessions}개의 시나리오` : `총 ${analytics.totalSessions}개의 시나리오`} 데이터를 기반으로 한 종합 분석
            </p>
          </div>
          <Link href="/mypage">
            <Button variant="outline" data-testid="button-back-mypage">마이페이지로</Button>
          </Link>
        </div>

        {/* Summary Cards */}
        <TooltipProvider>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            {/* Overall Score */}
            <Card data-testid="card-overall-score">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                  <Award className="w-4 h-4" />
                  종합 점수
                  <UITooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="w-4 h-4 text-slate-400 hover:text-slate-600 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      <p>완료된 모든 대화</p>
                      <p>피드백의 평균 점수입니다.</p>
                    </TooltipContent>
                  </UITooltip>
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
                완료한 시나리오
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-slate-900" data-testid="text-total-sessions">
                {analytics.completedSessions !== undefined ? `${analytics.completedSessions}/${analytics.totalSessions}` : analytics.totalSessions}
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

          {/* Total Feedbacks */}
          <Card data-testid="card-feedbacks">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                총 피드백
                <UITooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="w-4 h-4 text-slate-400 hover:text-slate-600 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    <p>완료되고 피드백을</p>
                    <p>받은 대화의 개수입니다.</p>
                  </TooltipContent>
                </UITooltip>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-slate-900" data-testid="text-total-feedbacks">
                {analytics.totalFeedbacks || 0}
              </div>
            </CardContent>
          </Card>
        </div>
        </TooltipProvider>

        {/* Category Breakdown with Filter */}
        <Card className="mb-8" data-testid="card-categories">
          <CardHeader>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <CardTitle>평가 기준별 분석</CardTitle>
                <CardDescription>
                  {analytics.criteriaDetails && analytics.criteriaDetails.length > 0 
                    ? `${analytics.criteriaDetails.length}개 평가 기준 종합 분석 (10점 만점)`
                    : '평가 항목별 종합 분석 (10점 만점)'}
                </CardDescription>
              </div>
              {analytics.usedCriteriaSets && analytics.usedCriteriaSets.length >= 1 && (
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-slate-500" />
                  <Select value={selectedCriteriaSet} onValueChange={setSelectedCriteriaSet}>
                    <SelectTrigger className="w-[240px]">
                      <SelectValue placeholder="평가 기준 세트 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">전체 평가 기준 ({analytics.totalFeedbacks}회)</SelectItem>
                      {analytics.usedCriteriaSets.map((criteriaSet) => (
                        <SelectItem key={criteriaSet.id} value={criteriaSet.id}>
                          {criteriaSet.name} ({criteriaSet.feedbackCount}회)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* 새로운 criteriaDetails 사용 (있는 경우) */}
              {analytics.criteriaDetails && analytics.criteriaDetails.length > 0 ? (
                getFilteredCriteriaDetails().map((criteria) => (
                  <div key={criteria.key} data-testid={`category-${criteria.key}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{getDisplayIcon(criteria.icon)}</span>
                        <span className="font-medium text-slate-900">
                          {criteria.name}
                        </span>
                        <Badge variant="outline" className="text-xs bg-slate-50">
                          {criteria.evaluationCount}회 평가
                        </Badge>
                      </div>
                      <span className="text-lg font-semibold text-slate-900" data-testid={`score-${criteria.key}`}>
                        {criteria.averageScore.toFixed(1)} / 10.0
                      </span>
                    </div>
                    <Progress value={criteria.averageScore * 10} className="h-3" />
                  </div>
                ))
              ) : (
                /* 기존 categoryAverages 호환 (구버전 데이터) */
                Object.entries(analytics.categoryAverages).map(([key, value]) => (
                  <div key={key} data-testid={`category-${key}`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{getDimensionIcon(key)}</span>
                        <span className="font-medium text-slate-900">
                          {getDimensionName(key)}
                        </span>
                      </div>
                      <span className="text-lg font-semibold text-slate-900" data-testid={`score-${key}`}>
                        {value.toFixed(1)} / 10.0
                      </span>
                    </div>
                    <Progress value={value * 10} className="h-3" />
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Score History Chart */}
        {analytics.scoreHistory.length > 1 && (
          <Card className="mb-8" data-testid="card-history">
            <CardHeader>
              <CardTitle>점수 변화 추이</CardTitle>
              <CardDescription>날짜별 평균 점수 추이 (0~100 점)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="w-full h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={Object.entries(
                      analytics.scoreHistory.reduce((acc, entry) => {
                        const dateKey = entry.date;
                        if (!acc[dateKey]) {
                          acc[dateKey] = { scores: [], date: dateKey };
                        }
                        acc[dateKey].scores.push(entry.score);
                        return acc;
                      }, {} as Record<string, { scores: number[]; date: string }>)
                    )
                    .sort((a, b) => a[0].localeCompare(b[0]))
                    .map(([_, data]) => {
                      const [year, month, day] = data.date.split('-');
                      return {
                        date: `${month}.${day}`,
                        score: Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length),
                        count: data.scores.length
                      };
                    })}
                    margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis 
                      dataKey="date" 
                      stroke="#64748b"
                      style={{ fontSize: '12px' }}
                    />
                    <YAxis 
                      stroke="#64748b"
                      domain={[0, 100]}
                      style={{ fontSize: '12px' }}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#fff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px',
                        padding: '8px 12px'
                      }}
                      formatter={(value, name) => {
                        if (name === 'score') return [`${value}점`, '평균 점수'];
                        if (name === 'count') return [`${value}회`, '대화 수'];
                        return value;
                      }}
                      labelStyle={{ color: '#1e293b' }}
                    />
                    <Legend 
                      wrapperStyle={{ paddingTop: '20px' }}
                      formatter={() => '일일 평균 점수'}
                    />
                    <Line
                      type="monotone"
                      dataKey="score"
                      stroke="#2563eb"
                      strokeWidth={3}
                      dot={{ fill: '#2563eb', r: 6 }}
                      activeDot={{ r: 8 }}
                      isAnimationActive={true}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-6 grid grid-cols-3 gap-4 text-sm">
                <div className="p-3 bg-slate-50 rounded-lg">
                  <div className="text-slate-600 mb-1">최고 점수</div>
                  <div className="text-2xl font-bold text-slate-900">
                    {Math.max(...analytics.scoreHistory.map(e => e.score))}
                  </div>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg">
                  <div className="text-slate-600 mb-1">최저 점수</div>
                  <div className="text-2xl font-bold text-slate-900">
                    {Math.min(...analytics.scoreHistory.map(e => e.score))}
                  </div>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg">
                  <div className="text-slate-600 mb-1">점수 범위</div>
                  <div className="text-2xl font-bold text-slate-900">
                    {Math.max(...analytics.scoreHistory.map(e => e.score)) - Math.min(...analytics.scoreHistory.map(e => e.score))}
                  </div>
                </div>
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
                <div className="space-y-4">
                  {analytics.topStrengths.map((strength, index) => (
                    <div key={index} className="pb-3 border-b last:border-b-0" data-testid={`strength-${index}`}>
                      <div className="flex items-center gap-3 mb-2">
                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 shrink-0">
                          {strength.count}회
                        </Badge>
                        <p className="font-semibold text-slate-900 text-sm">{strength.category}</p>
                      </div>
                      {strength.items.length > 0 && (
                        <div className="ml-12 space-y-1">
                          {strength.items.map((item, itemIndex) => (
                            <p key={itemIndex} className="text-xs text-slate-600 leading-relaxed">
                              • {item}
                            </p>
                          ))}
                        </div>
                      )}
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
                <div className="space-y-4">
                  {analytics.topImprovements.map((improvement, index) => (
                    <div key={index} className="pb-3 border-b last:border-b-0" data-testid={`improvement-${index}`}>
                      <div className="flex items-center gap-3 mb-2">
                        <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200 shrink-0">
                          {improvement.count}회
                        </Badge>
                        <p className="font-semibold text-slate-900 text-sm">{improvement.category}</p>
                      </div>
                      {improvement.items.length > 0 && (
                        <div className="ml-12 space-y-1">
                          {improvement.items.map((item, itemIndex) => (
                            <p key={itemIndex} className="text-xs text-slate-600 leading-relaxed">
                              • {item}
                            </p>
                          ))}
                        </div>
                      )}
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
