import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
} from "recharts";
import { authFetch } from "@/lib/authFetch";
import { Activity, ArrowDownToLine, ArrowUpFromLine, Zap, AlertCircle } from "lucide-react";

interface DailyRow {
  date: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens: number;
  errorCount: number;
}

interface UsageSummary {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalErrors: number;
}

interface UsageResponse {
  rows: DailyRow[];
  summary: UsageSummary;
}

interface AgentKey {
  id: string;
  name: string;
  keyPrefix: string;
  environment: string;
  isActive: boolean;
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

export function ApiUsageTab() {
  const defaults = getDefaultDates();
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [selectedKeyId, setSelectedKeyId] = useState<string>("all");
  const [appliedFrom, setAppliedFrom] = useState(defaults.from);
  const [appliedTo, setAppliedTo] = useState(defaults.to);
  const [appliedKeyId, setAppliedKeyId] = useState<string>("all");

  const { data: agentKeys = [] } = useQuery<AgentKey[]>({
    queryKey: ["/api/admin/agent-keys"],
    staleTime: 1000 * 60 * 5,
  });

  const usageParams = new URLSearchParams({ from: appliedFrom, to: appliedTo });
  if (appliedKeyId !== "all") usageParams.set("keyId", appliedKeyId);

  const {
    data: usageData,
    isLoading,
    isError,
  } = useQuery<UsageResponse>({
    queryKey: ["/api/admin/agent-keys/usage", appliedFrom, appliedTo, appliedKeyId],
    queryFn: () => authFetch(`/api/admin/agent-keys/usage?${usageParams}`),
    staleTime: 1000 * 60 * 2,
  });

  function handleApply() {
    setAppliedFrom(from);
    setAppliedTo(to);
    setAppliedKeyId(selectedKeyId);
  }

  const summary = usageData?.summary;
  const rows = usageData?.rows ?? [];

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
      label: "캐시 토큰",
      value: summary ? fmt(summary.totalCachedTokens ?? 0) : "–",
      icon: <AlertCircle className="w-5 h-5 text-cyan-500" />,
      bg: "bg-cyan-50",
    },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5" />
            API 사용량 현황
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
            <div className="space-y-1">
              <Label>API 키 필터</Label>
              <Select value={selectedKeyId} onValueChange={setSelectedKeyId}>
                <SelectTrigger className="w-52">
                  <SelectValue placeholder="전체 키" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">전체 키</SelectItem>
                  {agentKeys.map((k) => (
                    <SelectItem key={k.id} value={k.id}>
                      {k.name} ({k.keyPrefix}…)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleApply} disabled={isLoading}>
              조회
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
              선택한 기간에 사용 데이터가 없습니다.
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
                <Bar dataKey="inputTokens" stackId="tokens" fill="#8b5cf6" name="inputTokens" />
                <Bar dataKey="outputTokens" stackId="tokens" fill="#10b981" name="outputTokens" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>일별 요청 수</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : rows.length === 0 ? null : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={rows} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value: number) => [value.toLocaleString(), "요청 수"]} />
                <Bar dataKey="requestCount" fill="#3b82f6" name="요청 수" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
