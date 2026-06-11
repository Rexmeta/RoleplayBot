import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { authFetch } from "@/lib/authFetch";
import { Activity, ArrowDownToLine, ArrowUpFromLine, Zap, DollarSign, AlertCircle } from "lucide-react";

interface DailyRow {
  date: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens: number;
  totalCostUsd: number;
}

interface FeatureRow {
  feature: string;
  requestCount: number;
  totalTokens: number;
  totalCostUsd: number;
}

interface ModelRow {
  model: string;
  provider: string;
  requestCount: number;
  totalTokens: number;
  totalCostUsd: number;
}

interface UsageSummary {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalCostUsd: number;
}

interface UsageResponse {
  rows: DailyRow[];
  summary: UsageSummary;
  byFeature: FeatureRow[];
  byModel: ModelRow[];
}

function getDefaultDates() {
  const today = new Date();
  const from = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
  const to = today.toISOString().slice(0, 10);
  return { from, to };
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtCost(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

const FEATURE_COLORS = ["#8b5cf6", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899"];
const MODEL_COLORS   = ["#6366f1", "#14b8a6", "#f97316", "#84cc16", "#e11d48", "#0ea5e9"];

const FEATURE_LABELS: Record<string, string> = {
  conversation: "대화",
  feedback: "피드백",
  voice: "음성",
  emotion: "감정분석",
  strategy: "전략평가",
  translation: "번역",
  scenario_generation: "시나리오생성",
  image_generation: "이미지생성",
};

function featureLabel(f: string): string {
  return FEATURE_LABELS[f] ?? f;
}

export function ApiUsageTab() {
  const defaults = getDefaultDates();
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [appliedFrom, setAppliedFrom] = useState(defaults.from);
  const [appliedTo, setAppliedTo] = useState(defaults.to);

  const {
    data: usageData,
    isLoading,
    isError,
  } = useQuery<UsageResponse>({
    queryKey: ["/api/admin/analytics/ai-usage", appliedFrom, appliedTo],
    queryFn: () => authFetch(`/api/admin/analytics/ai-usage?from=${appliedFrom}&to=${appliedTo}`),
    staleTime: 1000 * 60 * 2,
  });

  function handleApply() {
    setAppliedFrom(from);
    setAppliedTo(to);
  }

  const summary = usageData?.summary;
  const rows = usageData?.rows ?? [];
  const byFeature = (usageData?.byFeature ?? []).map(r => ({ ...r, feature: featureLabel(r.feature) }));
  const byModel = usageData?.byModel ?? [];

  const summaryCards = [
    {
      label: "총 요청 수",
      value: summary ? fmt(summary.totalRequests) : "–",
      icon: <Activity className="w-5 h-5 text-blue-500" />,
      bg: "bg-blue-50",
    },
    {
      label: "입력 토큰",
      value: summary ? fmt(summary.totalInputTokens) : "–",
      icon: <ArrowDownToLine className="w-5 h-5 text-violet-500" />,
      bg: "bg-violet-50",
    },
    {
      label: "출력 토큰",
      value: summary ? fmt(summary.totalOutputTokens) : "–",
      icon: <ArrowUpFromLine className="w-5 h-5 text-emerald-500" />,
      bg: "bg-emerald-50",
    },
    {
      label: "총 토큰",
      value: summary ? fmt(summary.totalInputTokens + summary.totalOutputTokens) : "–",
      icon: <Zap className="w-5 h-5 text-amber-500" />,
      bg: "bg-amber-50",
    },
    {
      label: "추정 비용",
      value: summary ? fmtCost(summary.totalCostUsd ?? 0) : "–",
      icon: <DollarSign className="w-5 h-5 text-green-500" />,
      bg: "bg-green-50",
    },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5" />
            AI 사용량 현황
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label htmlFor="usage-from">시작일</Label>
              <Input
                id="usage-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="usage-to">종료일</Label>
              <Input
                id="usage-to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-40"
              />
            </div>
            <Button onClick={handleApply} disabled={isLoading}>
              조회
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {summaryCards.map((card) => (
          <Card key={card.label} className={card.bg}>
            <CardContent className="pt-5">
              <div className="flex items-center gap-2 mb-1">
                {card.icon}
                <span className="text-xs font-medium text-slate-600">{card.label}</span>
              </div>
              {isLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <p className="text-2xl font-bold text-slate-800">{card.value}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>일별 토큰 사용량</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2 py-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          ) : isError ? (
            <div className="flex items-center gap-2 text-red-600 py-8 justify-center">
              <AlertCircle className="w-5 h-5" />
              데이터를 불러오는 데 실패했습니다.
            </div>
          ) : rows.length === 0 ? (
            <p className="text-center text-slate-500 py-12">
              선택한 기간에 AI 사용 데이터가 없습니다.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={rows} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={(v) => fmt(v)} tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(value: number, name: string) => [
                    fmt(value),
                    name === "inputTokens" ? "입력 토큰" : name === "outputTokens" ? "출력 토큰" : name,
                  ]}
                />
                <Legend
                  formatter={(value) =>
                    value === "inputTokens" ? "입력 토큰" : value === "outputTokens" ? "출력 토큰" : value
                  }
                />
                <Bar dataKey="inputTokens"  stackId="tokens" fill="#8b5cf6" name="inputTokens" />
                <Bar dataKey="outputTokens" stackId="tokens" fill="#10b981" name="outputTokens" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>기능별 사용량</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : byFeature.length === 0 ? (
              <p className="text-center text-slate-500 py-12 text-sm">데이터 없음</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={byFeature}
                    dataKey="totalTokens"
                    nameKey="feature"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    label={({ feature, percent }) =>
                      `${feature}: ${(percent * 100).toFixed(0)}%`
                    }
                  >
                    {byFeature.map((_, i) => (
                      <Cell key={i} fill={FEATURE_COLORS[i % FEATURE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number, name: string) => [fmt(value), name === "totalTokens" ? "토큰" : name]}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>모델별 사용량</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : byModel.length === 0 ? (
              <p className="text-center text-slate-500 py-12 text-sm">데이터 없음</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={byModel}
                  layout="vertical"
                  margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tickFormatter={(v) => fmt(v)} tick={{ fontSize: 11 }} />
                  <YAxis
                    type="category"
                    dataKey="model"
                    tick={{ fontSize: 11 }}
                    width={120}
                    tickFormatter={(v: string) => (v.length > 18 ? v.slice(0, 18) + "…" : v)}
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      fmt(value),
                      name === "totalTokens" ? "총 토큰" : name,
                    ]}
                  />
                  {byModel.map((_, i) => null)}
                  <Bar dataKey="totalTokens" name="totalTokens" radius={[0, 3, 3, 0]}>
                    {byModel.map((_, i) => (
                      <Cell key={i} fill={MODEL_COLORS[i % MODEL_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>기능별 상세</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-slate-500">
                    <th className="text-left py-2 pr-4">기능</th>
                    <th className="text-right py-2 pr-4">요청 수</th>
                    <th className="text-right py-2 pr-4">총 토큰</th>
                    <th className="text-right py-2">추정 비용</th>
                  </tr>
                </thead>
                <tbody>
                  {byFeature.map((r, i) => (
                    <tr key={i} className="border-b last:border-0 hover:bg-slate-50">
                      <td className="py-2 pr-4 font-medium">{r.feature}</td>
                      <td className="text-right py-2 pr-4">{r.requestCount.toLocaleString()}</td>
                      <td className="text-right py-2 pr-4">{fmt(r.totalTokens)}</td>
                      <td className="text-right py-2 text-slate-600">{fmtCost(r.totalCostUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
