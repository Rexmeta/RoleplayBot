import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { CardInfo } from "./AdminCardInfo";
import { useQuery } from "@tanstack/react-query";

interface ScenariosTabProps {
  scenarioPerformanceData: Array<{ name: string; average: number; sessionCount: number; difficulty: number; personaCount?: number }>;
  scenarioPopularityData: Array<{ name: string; sessions: number }>;
  difficultyPopularityData: Array<{ difficulty: string; count: number }>;
  scenarioDifficultyData: Array<{ personaCount: number; count: number }>;
}

interface BenchmarkGroup {
  benchmarkGroup: string;
  scenarioCount: number;
  scenarioTitles: string[];
  averageScore: number | null;
  sessionCount: number;
}

export function ScenariosTab({
  scenarioPerformanceData,
  scenarioPopularityData,
  difficultyPopularityData,
  scenarioDifficultyData,
}: ScenariosTabProps) {
  const { data: benchmarkGroups, isLoading: benchmarkLoading } = useQuery<BenchmarkGroup[]>({
    queryKey: ["/api/admin/analytics/benchmark-groups"],
    staleTime: 60_000,
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card data-testid="card-scenario-popularity">
          <CardHeader>
            <CardTitle><CardInfo title="시나리오 인기도" description="각 시나리오별 세션 참여 수. 사용자들이 선택한 시나리오의 인기도를 나타냅니다." /></CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={scenarioPopularityData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="sessions" fill="#10b981" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card data-testid="card-scenario-performance">
          <CardHeader>
            <CardTitle><CardInfo title="시나리오별 성과" description="각 시나리오에서 사용자가 받은 평가 점수의 평균. 시나리오 난이도와 특성에 따른 성과를 비교할 수 있습니다." /></CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={scenarioPerformanceData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Bar dataKey="average" fill="#f59e0b" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card data-testid="card-difficulty-popularity">
          <CardHeader>
            <CardTitle><CardInfo title="난이도 선택 인기도" description="사용자가 선택한 난이도별 세션 수. 1=매우쉬움, 2=기본, 3=도전형, 4=고난도입니다." /></CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={difficultyPopularityData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="difficulty" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill="#8b5cf6" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card data-testid="card-persona-count-popularity">
          <CardHeader>
            <CardTitle><CardInfo title="페르소나 수별 인기도" description="시나리오에 포함된 페르소나 수에 따른 세션 수. 더 많은 페르소나와의 대화가 선호도에 미치는 영향을 보여줍니다." /></CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={scenarioDifficultyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="personaCount" label={{ value: "페르소나 수", position: "insideBottom", offset: -5 }} />
                <YAxis label={{ value: "세션 수", angle: -90, position: "insideLeft" }} />
                <Tooltip formatter={(value) => [`${value}회`, "세션 수"]} labelFormatter={(label) => `${label}명의 페르소나`} />
                <Bar dataKey="count" fill="#8b5cf6" name="세션 수" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-scenario-details">
        <CardHeader>
          <CardTitle><CardInfo title="시나리오 상세 분석" description="전체 시나리오의 통계 정보. 평균 점수, 세션 수, 난이도, 포함 페르소나 수, 성과 상태를 한눈에 확인할 수 있습니다." /></CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">시나리오</th>
                  <th className="text-left p-2">평균 점수</th>
                  <th className="text-left p-2">세션 수</th>
                  <th className="text-left p-2">난이도</th>
                  <th className="text-left p-2">페르소나 수</th>
                  <th className="text-left p-2">상태</th>
                </tr>
              </thead>
              <tbody>
                {scenarioPerformanceData.map((scenario, index) => (
                  <tr key={index} className="border-b hover:bg-slate-50" data-testid={`scenario-row-${index}`}>
                    <td className="p-2 font-medium">{scenario.name}</td>
                    <td className="p-2">
                      <span className={`font-semibold ${
                        scenario.average >= 80 ? 'text-green-600' :
                        scenario.average >= 70 ? 'text-blue-600' :
                        scenario.average >= 60 ? 'text-yellow-600' : 'text-red-600'
                      }`}>
                        {scenario.average}점
                      </span>
                    </td>
                    <td className="p-2">{scenario.sessionCount}회</td>
                    <td className="p-2">
                      {'★'.repeat(Math.min(scenario.difficulty, 4))}{'☆'.repeat(Math.max(0, 4 - scenario.difficulty))}
                    </td>
                    <td className="p-2">{scenario.personaCount || 0}명</td>
                    <td className="p-2">
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        scenario.average >= 75 ? 'bg-green-100 text-green-800' :
                        scenario.average >= 65 ? 'bg-yellow-100 text-yellow-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {scenario.average >= 75 ? '우수' : scenario.average >= 65 ? '보통' : '개선 필요'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Benchmark Group Comparison */}
      {(benchmarkLoading || (benchmarkGroups && benchmarkGroups.length > 0)) && (
        <Card data-testid="card-benchmark-groups">
          <CardHeader>
            <CardTitle>
              <CardInfo
                title="벤치마크 그룹 비교"
                description="analyticsSpec.benchmarkGroup이 설정된 시나리오끼리 그룹으로 묶어 평균 성과를 비교합니다."
              />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {benchmarkLoading ? (
              <div className="flex items-center justify-center h-24 text-slate-400 text-sm">로딩 중...</div>
            ) : benchmarkGroups && benchmarkGroups.length > 0 ? (
              <div className="space-y-4">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={benchmarkGroups.map(bg => ({
                    name: bg.benchmarkGroup,
                    average: bg.averageScore ?? 0,
                    sessions: bg.sessionCount,
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis domain={[0, 100]} />
                    <Tooltip
                      formatter={(value, name) => [
                        name === 'average' ? `${value}점` : `${value}회`,
                        name === 'average' ? '평균 점수' : '세션 수',
                      ]}
                    />
                    <Bar dataKey="average" fill="#7c3aed" name="average" />
                  </BarChart>
                </ResponsiveContainer>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b bg-slate-50">
                        <th className="text-left p-2 font-semibold">그룹</th>
                        <th className="text-left p-2 font-semibold">시나리오 수</th>
                        <th className="text-left p-2 font-semibold">세션 수</th>
                        <th className="text-left p-2 font-semibold">평균 점수</th>
                        <th className="text-left p-2 font-semibold">시나리오 목록</th>
                      </tr>
                    </thead>
                    <tbody>
                      {benchmarkGroups.map((bg, idx) => (
                        <tr key={idx} className="border-b hover:bg-slate-50" data-testid={`benchmark-row-${idx}`}>
                          <td className="p-2 font-medium text-violet-700">
                            <span className="bg-violet-100 px-2 py-0.5 rounded-full text-xs">{bg.benchmarkGroup}</span>
                          </td>
                          <td className="p-2 text-slate-600">{bg.scenarioCount}개</td>
                          <td className="p-2 text-slate-600">{bg.sessionCount}회</td>
                          <td className="p-2">
                            {bg.averageScore === null ? (
                              <span className="text-slate-400 text-xs">데이터 없음</span>
                            ) : (
                              <span className={`font-semibold ${
                                bg.averageScore >= 80 ? 'text-green-600' :
                                bg.averageScore >= 70 ? 'text-blue-600' :
                                bg.averageScore >= 60 ? 'text-yellow-600' : 'text-red-600'
                              }`}>
                                {bg.averageScore}점
                              </span>
                            )}
                          </td>
                          <td className="p-2 text-slate-500 text-xs max-w-xs truncate" title={bg.scenarioTitles.join(', ')}>
                            {bg.scenarioTitles.join(', ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
