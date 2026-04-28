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
import type { AnalyticsOverview, PerformanceData } from "./adminTypes";

interface MbtiTabProps {
  overview: AnalyticsOverview | undefined;
  performance: PerformanceData | undefined;
  mbtiUsageData: Array<{ name: string; count: number }>;
}

export function MbtiTab({ overview, performance, mbtiUsageData }: MbtiTabProps) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card data-testid="card-mbti-usage">
          <CardHeader>
            <CardTitle><CardInfo title="MBTI 유형별 사용량" description="각 MBTI 페르소나와의 대화 횟수. 사용자들이 선호하는 페르소나 유형을 파악할 수 있습니다." /></CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={mbtiUsageData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip formatter={(value, name) => [`${value}회`, name === 'count' ? '사용 횟수' : name]} />
                <Bar dataKey="count" fill="#8b5cf6" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card data-testid="card-mbti-performance">
          <CardHeader>
            <CardTitle><CardInfo title="MBTI 유형별 성과" description="각 MBTI 페르소나와의 대화에서 받은 평가 점수의 평균. 특정 페르소나와의 상호작용에서 사용자의 성과를 비교할 수 있습니다." /></CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={performance ? Object.entries(performance.mbtiPerformance).map(([mbti, data]) => ({
                name: mbti.toUpperCase(),
                average: data.average,
                count: data.count
              })) : []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis domain={[0, 100]} />
                <Tooltip formatter={(value, name) => [
                  name === 'average' ? `${value}점` : `${value}회`,
                  name === 'average' ? '평균 점수' : '세션 수'
                ]} />
                <Bar dataKey="average" fill="#06b6d4" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-mbti-details">
        <CardHeader>
          <CardTitle><CardInfo title="MBTI 상세 분석" description="전체 MBTI 페르소나의 통계. 평균 점수, 세션 수, 사용 비율, 성과 레벨을 한눈에 확인할 수 있습니다." /></CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">MBTI 유형</th>
                  <th className="text-left p-2">평균 점수</th>
                  <th className="text-left p-2">세션 수</th>
                  <th className="text-left p-2">사용 비율</th>
                  <th className="text-left p-2">성과 레벨</th>
                </tr>
              </thead>
              <tbody>
                {performance ? Object.entries(performance.mbtiPerformance).map(([mbti, data], index) => {
                  const usageCount = overview?.mbtiUsage[mbti] || 0;
                  const usagePercentage = overview?.totalSessions ? Math.round((usageCount / overview.totalSessions) * 100) : 0;
                  return (
                    <tr key={index} className="border-b hover:bg-slate-50" data-testid={`mbti-row-${index}`}>
                      <td className="p-2 font-medium">{mbti.toUpperCase()}</td>
                      <td className="p-2">
                        <span className={`font-semibold ${
                          data.average >= 80 ? 'text-green-600' :
                          data.average >= 70 ? 'text-blue-600' :
                          data.average >= 60 ? 'text-yellow-600' : 'text-red-600'
                        }`}>
                          {data.average}점
                        </span>
                      </td>
                      <td className="p-2">{data.count}회</td>
                      <td className="p-2">{usagePercentage}%</td>
                      <td className="p-2">
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          data.average >= 80 ? 'bg-green-100 text-green-800' :
                          data.average >= 70 ? 'bg-blue-100 text-blue-800' :
                          data.average >= 60 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {data.average >= 80 ? '탁월' :
                           data.average >= 70 ? '우수' :
                           data.average >= 60 ? '보통' : '개선 필요'}
                        </span>
                      </td>
                    </tr>
                  );
                }) : []}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
