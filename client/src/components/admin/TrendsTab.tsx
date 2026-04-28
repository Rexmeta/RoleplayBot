import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { CardInfo } from "./AdminCardInfo";
import type { TrendsData } from "./adminTypes";

interface TrendsTabProps {
  trends: TrendsData | undefined;
}

export function TrendsTab({ trends }: TrendsTabProps) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6">
        <Card data-testid="card-daily-usage">
          <CardHeader>
            <CardTitle><CardInfo title="일일 사용량 추이" description="최근 30일간 매일 시작된 세션과 완료된 세션의 수. 사용자 활동 추세와 완료율 변화를 시간순으로 볼 수 있습니다." /></CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trends?.dailyUsage || []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="sessions" stroke="#3b82f6" name="시작된 세션" />
                <Line type="monotone" dataKey="completed" stroke="#10b981" name="완료된 세션" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card data-testid="card-performance-trends">
          <CardHeader>
            <CardTitle><CardInfo title="성과 트렌드" description="최근 20개 세션의 평가 점수 추이. 사용자의 학습 진행 상황과 개선 정도를 시각적으로 파악할 수 있습니다." /></CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trends?.performanceTrends || []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="session" />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Line type="monotone" dataKey="score" stroke="#f59e0b" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
