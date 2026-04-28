import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  BarChart,
  Bar,
} from "recharts";
import { CardInfo } from "./AdminCardInfo";
import type { PerformanceData, TrendsData } from "./adminTypes";

interface PerformanceTabProps {
  performance: PerformanceData | undefined;
  trends: TrendsData | undefined;
  scoreDistributionData: Array<{ name: string; value: number; color: string }>;
  categoryData: Array<{ category: string; average: number }>;
}

export function PerformanceTab({ performance, trends, scoreDistributionData, categoryData }: PerformanceTabProps) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="card-enhanced" data-testid="card-perf-average">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium"><CardInfo title="전체 평균 점수" description="모든 피드백의 평가 점수 평균 (0-100점). AI 평가 기준: 명확성, 공감력, 문제해결능력, 태도 등 다양한 지표로 평가합니다." /></CardTitle>
            <i className="fas fa-chart-bar text-blue-600"></i>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-600" data-testid="perf-average-value">
              {(performance?.averageScore ?? 0).toFixed(1)}점
            </div>
            <p className="text-xs text-slate-600 mt-1">전체 {performance?.totalFeedbacks || 0}건 평가 기준</p>
          </CardContent>
        </Card>

        <Card className="card-enhanced" data-testid="card-perf-highest">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium"><CardInfo title="최고 점수" description="시스템에서 기록된 최고 평가 점수. 사용자가 달성한 최상의 커뮤니케이션 성과입니다." /></CardTitle>
            <i className="fas fa-trophy text-yellow-500"></i>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-yellow-600" data-testid="perf-highest-value">
              {performance?.highestScore || 0}점
            </div>
            <p className="text-xs text-slate-600 mt-1">역대 최고 기록</p>
          </CardContent>
        </Card>

        <Card className="card-enhanced" data-testid="card-perf-completion">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium"><CardInfo title="평가 완료율" description="AI 평가 피드백을 받은 세션의 비율 (%). 대화 완료 후 AI가 상세 피드백을 제공한 세션 기준입니다." /></CardTitle>
            <i className="fas fa-check-circle text-green-600"></i>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600" data-testid="perf-completion-value">
              {performance?.feedbackCompletionRate || 0}%
            </div>
            <p className="text-xs text-slate-600 mt-1">피드백 완료된 세션</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="card-enhanced" data-testid="card-score-distribution">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <i className="fas fa-pie-chart text-purple-600"></i>
              <CardInfo title="점수 분포" description="모든 세션을 점수 범위별로 분류한 비율. 우수/양호/보통/개선필요/부족 5단계로 분류합니다." />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={scoreDistributionData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {scoreDistributionData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="card-enhanced" data-testid="card-score-trend">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <i className="fas fa-chart-line text-indigo-600"></i>
              <CardInfo title="점수 추이" description="최근 20개 세션의 점수 변화 추이. 사용자의 성과 개선 정도를 시간순으로 확인할 수 있습니다." />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={trends?.performanceTrends || []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="session" label={{ value: "세션", position: "insideBottom", offset: -5 }} />
                <YAxis domain={[0, 100]} label={{ value: "점수", angle: -90, position: "insideLeft" }} />
                <Tooltip formatter={(value) => [`${value}점`, "점수"]} />
                <Line type="monotone" dataKey="score" stroke="#6366f1" strokeWidth={2} dot={{ fill: "#6366f1" }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card data-testid="card-category-performance">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <i className="fas fa-tags text-blue-600"></i>
              <CardInfo title="카테고리별 성과" description="평가 카테고리(명확성, 공감력, 문제해결력, 태도)별 평균 점수. 각 역량 영역의 강점과 개선점을 파악할 수 있습니다." />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={categoryData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" domain={[0, 5]} />
                <YAxis dataKey="category" type="category" width={80} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value) => [`${value}점`, "평균"]} />
                <Bar dataKey="average" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="card-enhanced" data-testid="card-top-strengths">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <i className="fas fa-thumbs-up text-green-600"></i>
              <CardInfo title="강점 Top 5" description="AI 피드백에서 가장 많이 언급된 긍정적 강점. 사용자가 잘 수행하고 있는 커뮤니케이션 능력입니다." />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {performance?.topStrengths?.length ? performance.topStrengths.map((item, index) => (
                <div key={index} className="flex items-start gap-3 p-2 bg-green-50 rounded-lg" data-testid={`strength-${index}`}>
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                    index === 0 ? 'bg-green-500 text-white' :
                    index === 1 ? 'bg-green-400 text-white' :
                    'bg-green-200 text-green-700'
                  }`}>
                    {index + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-700 line-clamp-2">{item.text}</p>
                    <p className="text-xs text-green-600 mt-1">{item.count}회 언급</p>
                  </div>
                </div>
              )) : <p className="text-slate-500 text-sm text-center py-4">데이터 없음</p>}
            </div>
          </CardContent>
        </Card>

        <Card className="card-enhanced" data-testid="card-top-improvements">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <i className="fas fa-arrow-up text-orange-600"></i>
              <CardInfo title="개선점 Top 5" description="AI 피드백에서 가장 많이 언급된 개선사항. 사용자가 집중해서 개선해야 할 커뮤니케이션 역량입니다." />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {performance?.topImprovements?.length ? performance.topImprovements.map((item, index) => (
                <div key={index} className="flex items-start gap-3 p-2 bg-orange-50 rounded-lg" data-testid={`improvement-${index}`}>
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                    index === 0 ? 'bg-orange-500 text-white' :
                    index === 1 ? 'bg-orange-400 text-white' :
                    'bg-orange-200 text-orange-700'
                  }`}>
                    {index + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-700 line-clamp-2">{item.text}</p>
                    <p className="text-xs text-orange-600 mt-1">{item.count}회 언급</p>
                  </div>
                </div>
              )) : <p className="text-slate-500 text-sm text-center py-4">데이터 없음</p>}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="card-enhanced" data-testid="card-recent-sessions">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <i className="fas fa-list-alt text-slate-600"></i>
            최근 세션 상세 (최근 20건)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50">
                  <th className="p-3 text-left font-semibold">점수</th>
                  <th className="p-3 text-left font-semibold">시나리오</th>
                  <th className="p-3 text-left font-semibold">MBTI</th>
                  <th className="p-3 text-left font-semibold">난이도</th>
                  <th className="p-3 text-left font-semibold">사용자</th>
                  <th className="p-3 text-left font-semibold">완료일</th>
                </tr>
              </thead>
              <tbody>
                {performance?.recentSessions?.map((session, index) => {
                  const difficultyLabels: Record<number, string> = { 1: '매우 쉬움', 2: '기본', 3: '도전형', 4: '고난도' };
                  const scoreColor = session.score >= 90 ? 'text-green-600' :
                                    session.score >= 80 ? 'text-blue-600' :
                                    session.score >= 70 ? 'text-yellow-600' :
                                    session.score >= 60 ? 'text-orange-600' : 'text-red-600';
                  return (
                    <tr key={session.id} className="border-b hover:bg-slate-50" data-testid={`session-row-${index}`}>
                      <td className={`p-3 font-bold ${scoreColor}`}>{Number(session.score).toFixed(1)}점</td>
                      <td className="p-3 truncate max-w-[150px]">{session.scenarioName}</td>
                      <td className="p-3">
                        <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs font-bold">
                          {session.mbti}
                        </span>
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded text-xs ${
                          session.difficulty === 4 ? 'bg-red-100 text-red-700' :
                          session.difficulty === 3 ? 'bg-orange-100 text-orange-700' :
                          session.difficulty === 2 ? 'bg-blue-100 text-blue-700' :
                          'bg-green-100 text-green-700'
                        }`}>
                          {difficultyLabels[session.difficulty] || '기본'}
                        </span>
                      </td>
                      <td className="p-3 text-slate-500">{session.userId}...</td>
                      <td className="p-3 text-slate-500">
                        {new Date(session.completedAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  );
                })}
                {(!performance?.recentSessions || performance.recentSessions.length === 0) && (
                  <tr><td colSpan={6} className="p-4 text-center text-slate-500">최근 세션 데이터가 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
