import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import { Loader2, Activity, AlertCircle, Clock, Zap, Database } from "lucide-react";

interface AgentUsageDailyRow {
  id: string;
  organizationId: string;
  agentKeyId: string;
  date: string;
  requestCount: number;
  sessionCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens: number;
  errorCount: number;
  avgLatencyMs: number | null;
  estimatedRequestCount: number;
}

interface Props {
  keyId: string | null;
  keyName: string;
  keyPrefix: string;
  open: boolean;
  onClose: () => void;
}

function toISODate(d: Date) {
  return d.toISOString().split("T")[0];
}

function makeDateRange(days: number) {
  const end = new Date();
  const start = new Date(end.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  return { from: toISODate(start), to: toISODate(end) };
}

export function AgentKeyUsageDashboard({ keyId, keyName, keyPrefix, open, onClose }: Props) {
  const { t } = useTranslation();
  const [range, setRange] = useState<"7" | "30">("7");

  const dateRange = makeDateRange(range === "7" ? 7 : 30);

  const { data: rows = [], isLoading, isError } = useQuery<AgentUsageDailyRow[]>({
    queryKey: ["/api/admin/agent-keys", keyId, "usage", dateRange.from, dateRange.to],
    queryFn: async () => {
      if (!keyId) return [];
      const res = await fetch(
        `/api/admin/agent-keys/${keyId}/usage?from=${dateRange.from}&to=${dateRange.to}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch usage");
      return res.json();
    },
    enabled: !!keyId && open,
    staleTime: 60 * 1000,
  });

  const totals = rows.reduce(
    (acc, r) => ({
      requests: acc.requests + r.requestCount,
      tokens: acc.tokens + r.totalTokens,
      cached: acc.cached + (r.cachedTokens ?? 0),
      errors: acc.errors + r.errorCount,
      sessions: acc.sessions + r.sessionCount,
    }),
    { requests: 0, tokens: 0, cached: 0, errors: 0, sessions: 0 }
  );

  const errorRate = totals.requests > 0
    ? ((totals.errors / totals.requests) * 100).toFixed(1)
    : "0.0";

  const avgLatency = (() => {
    const withData = rows.filter((r) => r.avgLatencyMs != null);
    if (withData.length === 0) return null;
    const sum = withData.reduce((a, r) => a + (r.avgLatencyMs ?? 0), 0);
    return Math.round(sum / withData.length);
  })();

  const chartData = rows.map((r) => ({
    date: r.date.slice(5),
    requests: r.requestCount,
    tokens: r.totalTokens,
    errors: r.errorCount,
    latency: r.avgLatencyMs ?? 0,
  }));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            {t("agentKeys.usage.title", "API Key Usage")}
          </DialogTitle>
          <DialogDescription>
            <span className="font-medium">{keyName}</span>{" "}
            <span className="font-mono text-xs text-muted-foreground">({keyPrefix}…)</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 pt-1">
          <span className="text-sm text-muted-foreground">{t("agentKeys.usage.range", "Range:")}</span>
          <Button
            size="sm"
            variant={range === "7" ? "default" : "outline"}
            onClick={() => setRange("7")}
          >
            {t("agentKeys.usage.last7Days", "Last 7 days")}
          </Button>
          <Button
            size="sm"
            variant={range === "30" ? "default" : "outline"}
            onClick={() => setRange("30")}
          >
            {t("agentKeys.usage.last30Days", "Last 30 days")}
          </Button>
          <span className="text-xs text-muted-foreground ml-2">
            {dateRange.from} → {dateRange.to}
          </span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mr-2" />
            {t("agentKeys.usage.loading", "Loading usage data…")}
          </div>
        ) : isError ? (
          <div className="flex items-center justify-center py-16 text-destructive gap-2">
            <AlertCircle className="h-5 w-5" />
            {t("agentKeys.usage.error", "Failed to load usage data.")}
          </div>
        ) : (
          <>
            {/* Summary stat cards */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <Card>
                <CardHeader className="pb-1 pt-3 px-4">
                  <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                    <Activity className="h-3.5 w-3.5" />
                    {t("agentKeys.usage.stat.requests", "Requests")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3">
                  <div className="text-2xl font-bold">{totals.requests.toLocaleString()}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-1 pt-3 px-4">
                  <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                    <Zap className="h-3.5 w-3.5" />
                    {t("agentKeys.usage.stat.tokens", "Total Tokens")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3">
                  <div className="text-2xl font-bold">{totals.tokens.toLocaleString()}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-1 pt-3 px-4">
                  <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                    <Database className="h-3.5 w-3.5" />
                    {t("agentKeys.usage.stat.cachedTokens", "Cached Tokens")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3">
                  <div className="text-2xl font-bold">{totals.cached.toLocaleString()}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-1 pt-3 px-4">
                  <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                    <AlertCircle className="h-3.5 w-3.5" />
                    {t("agentKeys.usage.stat.errorRate", "Error Rate")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3">
                  <div className={`text-2xl font-bold ${parseFloat(errorRate) > 5 ? "text-red-600" : ""}`}>
                    {errorRate}%
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-1 pt-3 px-4">
                  <CardTitle className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {t("agentKeys.usage.stat.avgLatency", "Avg Latency")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3">
                  <div className="text-2xl font-bold">
                    {avgLatency != null ? `${avgLatency} ms` : "—"}
                  </div>
                </CardContent>
              </Card>
            </div>

            {rows.length === 0 ? (
              <div className="text-center text-muted-foreground text-sm py-10">
                {t("agentKeys.usage.noData", "No usage data for this period.")}
              </div>
            ) : (
              <>
                {/* Requests bar chart */}
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">
                    {t("agentKeys.usage.chart.requests", "Daily Requests & Errors")}
                  </p>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="requests" name={t("agentKeys.usage.chart.requests_label", "Requests")} fill="#3b82f6" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="errors" name={t("agentKeys.usage.chart.errors_label", "Errors")} fill="#ef4444" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Tokens line chart */}
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">
                    {t("agentKeys.usage.chart.tokens", "Daily Token Consumption")}
                  </p>
                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line
                        type="monotone"
                        dataKey="tokens"
                        name={t("agentKeys.usage.chart.tokens_label", "Total Tokens")}
                        stroke="#8b5cf6"
                        dot={false}
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Detailed table */}
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">
                    {t("agentKeys.usage.table.title", "Daily Breakdown")}
                  </p>
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("agentKeys.usage.table.date", "Date")}</TableHead>
                          <TableHead className="text-right">{t("agentKeys.usage.table.requests", "Requests")}</TableHead>
                          <TableHead className="text-right">{t("agentKeys.usage.table.sessions", "Sessions")}</TableHead>
                          <TableHead className="text-right">{t("agentKeys.usage.table.inputTokens", "Input Tokens")}</TableHead>
                          <TableHead className="text-right">{t("agentKeys.usage.table.outputTokens", "Output Tokens")}</TableHead>
                          <TableHead className="text-right" title={t("agentKeys.usage.table.estimatedTooltip", "Requests where token counts are heuristic estimates (no real provider metadata)")}>
                            {t("agentKeys.usage.table.estimated", "Est. Req.")}
                          </TableHead>
                          <TableHead className="text-right">{t("agentKeys.usage.table.errors", "Errors")}</TableHead>
                          <TableHead className="text-right">{t("agentKeys.usage.table.errorRate", "Error Rate")}</TableHead>
                          <TableHead className="text-right">{t("agentKeys.usage.table.avgLatency", "Avg Latency")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((row) => {
                          const rate = row.requestCount > 0
                            ? ((row.errorCount / row.requestCount) * 100).toFixed(1)
                            : "0.0";
                          const estCount = row.estimatedRequestCount ?? 0;
                          const allEstimated = row.requestCount > 0 && estCount === row.requestCount;
                          const someEstimated = estCount > 0 && !allEstimated;
                          return (
                            <TableRow key={row.date}>
                              <TableCell className="font-mono text-sm">{row.date}</TableCell>
                              <TableCell className="text-right font-mono text-sm">{row.requestCount.toLocaleString()}</TableCell>
                              <TableCell className="text-right font-mono text-sm">{row.sessionCount.toLocaleString()}</TableCell>
                              <TableCell className="text-right font-mono text-sm">{row.inputTokens.toLocaleString()}</TableCell>
                              <TableCell className="text-right font-mono text-sm">{row.outputTokens.toLocaleString()}</TableCell>
                              <TableCell className="text-right font-mono text-sm">
                                {estCount > 0 ? (
                                  <Badge
                                    variant={allEstimated ? "secondary" : "outline"}
                                    className={`text-xs ${allEstimated ? "text-amber-700 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400" : "text-amber-600"}`}
                                    title={t("agentKeys.usage.table.estimatedTooltip", "Requests where token counts are heuristic estimates (no real provider metadata)")}
                                  >
                                    {estCount}
                                    {someEstimated && `/${row.requestCount}`}
                                  </Badge>
                                ) : (
                                  <span className="text-muted-foreground text-xs">—</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm">
                                {row.errorCount > 0 ? (
                                  <Badge variant="destructive" className="text-xs">
                                    {row.errorCount}
                                  </Badge>
                                ) : (
                                  <span className="text-muted-foreground">0</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right text-sm">
                                <span className={parseFloat(rate) > 5 ? "text-red-600 font-semibold" : "text-muted-foreground"}>
                                  {rate}%
                                </span>
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm text-muted-foreground">
                                {row.avgLatencyMs != null ? `${row.avgLatencyMs} ms` : "—"}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
