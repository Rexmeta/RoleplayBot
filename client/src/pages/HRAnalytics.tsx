import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AppHeader } from "@/components/AppHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Loader2, Download, TrendingUp, TrendingDown, Minus, Users, Target, BarChart3, AlertTriangle, Star, Settings, ArrowUpRight, BookOpen } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";

interface MemberCompetency {
  userId: string;
  name: string;
  email: string;
  profileImage?: string | null;
  sessionCount: number;
  dimensionAverages: Record<string, number | null>;
  overallAverage: number | null;
}

interface Dimension { key: string; name: string; }

interface TeamCompetencyData {
  members: MemberCompetency[];
  dimensions: Dimension[];
  orgId: string;
}

interface RadarPoint {
  dimension: string;
  name: string;
  teamAverage: number;
  target: number;
  gap: number;
  suggestedCategories: string[];
}

interface SkillGapData {
  radarData: RadarPoint[];
  benchmarkTargets: Record<string, { targetScore: number; dimensionName: string }>;
}

interface TrendMonth {
  month: string;
  average: number;
  categories: Record<string, number>;
}

interface GrowthTrendData { trend: TrendMonth[]; allCategories: string[]; }

interface MemberRisk {
  userId: string;
  name: string;
  email: string;
  profileImage?: string | null;
  recentAverage: number;
  overallAverage: number;
  sessionCount: number;
  trend: "improving" | "declining" | "stable";
  scenarioBreakdown: any[];
}

interface AtRiskData { atRisk: MemberRisk[]; highPerformers: MemberRisk[]; }

interface PlanStatus { enabled: boolean; planName: string; orgId?: string; userRole?: string; isAuthorized?: boolean; }

interface BenchmarkTarget {
  id: string;
  orgId: string;
  dimensionKey: string;
  dimensionName: string;
  targetScore: number;
}

interface MemberSession {
  personaRunId: string;
  date: string;
  overallScore: number | null;
  dimensionScore: number | null;
  scenarioName: string;
  categoryName: string;
  strengths: string[];
  improvements: string[];
}

function scoreColor(score: number | null): string {
  if (score === null) return "bg-gray-100 text-gray-400";
  if (score < 2.5) return "bg-red-100 text-red-700";
  if (score < 3.5) return "bg-yellow-100 text-yellow-700";
  return "bg-green-100 text-green-700";
}

function TrendArrow({ trend }: { trend: string }) {
  if (trend === "improving") return <TrendingUp className="h-4 w-4 text-green-600" />;
  if (trend === "declining") return <TrendingDown className="h-4 w-4 text-red-500" />;
  return <Minus className="h-4 w-4 text-gray-400" />;
}

function downloadFile(url: string, filename: string) {
  fetch(url, { credentials: "include" })
    .then(r => r.blob())
    .then(blob => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
    });
}

function AccessRestrictedCTA() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-slate-100 p-4">
      <Card className="max-w-md w-full shadow-xl">
        <CardHeader className="text-center pb-4">
          <div className="w-16 h-16 rounded-full bg-orange-500 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="h-8 w-8 text-white" />
          </div>
          <CardTitle className="text-2xl">Access Restricted</CardTitle>
          <p className="text-muted-foreground mt-2">HR Team Analytics is available to HR administrators and operators only.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-center text-sm text-muted-foreground">
            This dashboard contains organization-wide performance data. Please contact your HR administrator to request access.
          </p>
          <Button variant="outline" className="w-full" onClick={() => window.history.back()}>
            Go Back
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function UpgradeCTA({ planName }: { planName: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <Card className="max-w-lg w-full shadow-xl">
        <CardHeader className="text-center pb-4">
          <div className="w-16 h-16 rounded-full bg-blue-600 flex items-center justify-center mx-auto mb-4">
            <BarChart3 className="h-8 w-8 text-white" />
          </div>
          <CardTitle className="text-2xl">HR Team Analytics</CardTitle>
          <p className="text-muted-foreground mt-2">Your organization is on the <strong>{planName}</strong> plan.</p>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-center text-muted-foreground">
            Unlock HR Analytics to access team competency heatmaps, skill gap analysis, growth trends, and at-risk identification — all in one dashboard.
          </p>
          <ul className="space-y-3">
            {[
              "Team Competency Heatmap across all evaluation dimensions",
              "Skill Gap radar chart with benchmark targets",
              "Growth Trend line chart by scenario category",
              "At-Risk / High-Performer identification with drill-down",
              "CSV & JSON exports ready for HRIS integration",
            ].map(feature => (
              <li key={feature} className="flex items-start gap-2 text-sm">
                <ArrowUpRight className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-3 pt-2">
            <Button size="lg" className="w-full">
              Upgrade to Analytics Plan
            </Button>
            <Button variant="outline" size="lg" className="w-full">
              Contact us to learn more
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function HeatmapCellDrillDown({ member, dimension, orgId, onClose }: {
  member: MemberCompetency;
  dimension: Dimension;
  orgId: string;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery<{ sessions: MemberSession[] }>({
    queryKey: ["/api/analytics/hr/member-feedbacks", orgId, member.userId, dimension.key],
    queryFn: async () => {
      const params = new URLSearchParams({ orgId, userId: member.userId, dimensionKey: dimension.key });
      const res = await fetch(`/api/analytics/hr/member-feedbacks?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load sessions");
      return res.json();
    },
  });

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            {member.name} — {dimension.name}
          </DialogTitle>
          <DialogDescription>
            Session history for this evaluation dimension (avg: <strong>{member.dimensionAverages[dimension.key] ?? "—"}</strong>)
          </DialogDescription>
        </DialogHeader>
        {isLoading && <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>}
        {!isLoading && (!data?.sessions.length) && (
          <p className="text-center text-muted-foreground py-8 text-sm">No sessions with data for this dimension.</p>
        )}
        <div className="space-y-3">
          {data?.sessions.map((session, i) => (
            <Card key={i} className="border">
              <CardContent className="pt-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{session.scenarioName || `Session ${i + 1}`}</span>
                  <div className="flex items-center gap-2">
                    {session.dimensionScore !== null && (
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${scoreColor(session.dimensionScore)}`}>
                        {dimension.name}: {session.dimensionScore}
                      </span>
                    )}
                    {session.categoryName && (
                      <Badge variant="outline" className="text-xs">{session.categoryName}</Badge>
                    )}
                    <span className="text-xs text-muted-foreground">{session.date ? new Date(session.date).toLocaleDateString() : ""}</span>
                  </div>
                </div>
                {session.strengths?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-green-700 mb-1">Strengths</p>
                    <ul className="text-xs text-muted-foreground space-y-0.5">
                      {session.strengths.slice(0, 2).map((s: string, j: number) => <li key={j}>• {s}</li>)}
                    </ul>
                  </div>
                )}
                {session.improvements?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-orange-600 mb-1">Areas to improve</p>
                    <ul className="text-xs text-muted-foreground space-y-0.5">
                      {session.improvements.slice(0, 2).map((s: string, j: number) => <li key={j}>• {s}</li>)}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DrillDownModal({ member, onClose }: { member: MemberRisk; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {member.name} — Session Breakdown
          </DialogTitle>
          <DialogDescription>
            Recent average: <strong>{member.recentAverage}</strong> · Total sessions: {member.sessionCount}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {member.scenarioBreakdown.length === 0 && (
            <p className="text-muted-foreground text-sm text-center py-4">No sessions found.</p>
          )}
          {member.scenarioBreakdown.map((session: any, i: number) => (
            <Card key={i} className="border">
              <CardContent className="pt-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{session.scenarioName || `Session ${i + 1}`}</span>
                  <div className="flex items-center gap-2">
                    <Badge className={scoreColor(session.score)}>{session.score ?? "—"}</Badge>
                    <span className="text-xs text-muted-foreground">{session.date ? new Date(session.date).toLocaleDateString() : ""}</span>
                  </div>
                </div>
                {session.strengths?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-green-700 mb-1">Strengths</p>
                    <ul className="text-xs text-muted-foreground space-y-0.5">
                      {session.strengths.slice(0, 2).map((s: string, j: number) => <li key={j}>• {s}</li>)}
                    </ul>
                  </div>
                )}
                {session.improvements?.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-orange-600 mb-1">Areas to improve</p>
                    <ul className="text-xs text-muted-foreground space-y-0.5">
                      {session.improvements.slice(0, 2).map((s: string, j: number) => <li key={j}>• {s}</li>)}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BenchmarkSettingsModal({ orgId, dimensions, onClose }: { orgId: string; dimensions: Dimension[]; onClose: () => void }) {
  const { toast } = useToast();
  const { data: targets = [], isLoading } = useQuery<BenchmarkTarget[]>({
    queryKey: ["/api/analytics/hr/benchmark-targets", orgId],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/hr/benchmark-targets?orgId=${orgId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const [edits, setEdits] = useState<Record<string, string>>({});

  const getTargetScore = (dimKey: string): string => {
    if (edits[dimKey] !== undefined) return edits[dimKey];
    const existing = targets.find(t => t.dimensionKey === dimKey);
    return existing ? String(existing.targetScore) : "3.5";
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const targetList = dimensions.map(d => ({
        dimensionKey: d.key,
        dimensionName: d.name,
        targetScore: parseFloat(getTargetScore(d.key)) || 3.5,
      }));
      const res = await apiRequest("PUT", "/api/analytics/hr/benchmark-targets", { orgId, targets: targetList });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/hr/skill-gap"] });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/hr/benchmark-targets"] });
      toast({ title: "Benchmark targets saved" });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Failed to save", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Benchmark Targets
          </DialogTitle>
          <DialogDescription>Set the target score (1–5) for each evaluation dimension.</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div className="space-y-3 max-h-[50vh] overflow-y-auto">
            {dimensions.map(dim => (
              <div key={dim.key} className="flex items-center gap-3">
                <label className="flex-1 text-sm font-medium">{dim.name}</label>
                <Input
                  className="w-20 text-center"
                  type="number"
                  min="1"
                  max="5"
                  step="0.1"
                  value={getTargetScore(dim.key)}
                  onChange={e => setEdits(prev => ({ ...prev, [dim.key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Targets
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CompetencyHeatmap({ orgId }: { orgId: string }) {
  const [drillCell, setDrillCell] = useState<{ member: MemberCompetency; dimension: Dimension } | null>(null);

  const { data, isLoading } = useQuery<TeamCompetencyData>({
    queryKey: ["/api/analytics/hr/team-competency", orgId],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/hr/team-competency?orgId=${orgId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load team competency");
      return res.json();
    },
  });

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!data || data.members.length === 0) return <p className="text-center text-muted-foreground py-16">No team data available yet.</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{data.members.length} team members · {data.dimensions.length} dimensions · click a cell to drill down</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => downloadFile(`/api/analytics/hr/export/team-competency?format=csv&orgId=${orgId}`, "team-competency.csv")}>
            <Download className="h-4 w-4 mr-1" />CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => downloadFile(`/api/analytics/hr/export/team-competency?format=json&orgId=${orgId}`, "team-competency.json")}>
            <Download className="h-4 w-4 mr-1" />JSON
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[140px] sticky left-0 bg-background z-10">Member</TableHead>
              <TableHead className="text-center">Sessions</TableHead>
              <TableHead className="text-center">Overall</TableHead>
              {data.dimensions.map(d => (
                <TableHead key={d.key} className="text-center min-w-[100px] text-xs">{d.name}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.members.map(member => (
              <TableRow key={member.userId}>
                <TableCell className="sticky left-0 bg-background z-10 font-medium text-sm">
                  <div>{member.name}</div>
                  <div className="text-xs text-muted-foreground">{member.email}</div>
                </TableCell>
                <TableCell className="text-center text-sm">{member.sessionCount}</TableCell>
                <TableCell className="text-center">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${scoreColor(member.overallAverage)}`}>
                    {member.overallAverage ?? "—"}
                  </span>
                </TableCell>
                {data.dimensions.map(d => {
                  const score = member.dimensionAverages[d.key] ?? null;
                  return (
                    <TableCell key={d.key} className="text-center">
                      <button
                        className={`inline-block px-2 py-0.5 rounded text-xs font-semibold cursor-pointer hover:opacity-75 transition-opacity ${scoreColor(score)}`}
                        onClick={() => setDrillCell({ member, dimension: d })}
                        title={`Click to see ${member.name}'s sessions for ${d.name}`}
                      >
                        {score ?? "—"}
                      </button>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-100 border border-red-200 inline-block" /> Below 2.5</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-100 border border-yellow-200 inline-block" /> 2.5 – 3.5</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-100 border border-green-200 inline-block" /> Above 3.5</span>
      </div>
      {drillCell && (
        <HeatmapCellDrillDown
          member={drillCell.member}
          dimension={drillCell.dimension}
          orgId={orgId}
          onClose={() => setDrillCell(null)}
        />
      )}
    </div>
  );
}

function SkillGapPanel({ orgId, onOpenBenchmarks, dimensions }: { orgId: string; onOpenBenchmarks: () => void; dimensions: Dimension[] }) {
  const { data, isLoading } = useQuery<SkillGapData>({
    queryKey: ["/api/analytics/hr/skill-gap", orgId],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/hr/skill-gap?orgId=${orgId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load skill gap");
      return res.json();
    },
  });

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!data || data.radarData.length === 0) return <p className="text-center text-muted-foreground py-16">No skill gap data available yet.</p>;

  const radarForChart = data.radarData.map(d => ({
    subject: d.name,
    "Team Avg": d.teamAverage,
    "Target": d.target,
    fullMark: 5,
  }));

  const gapList = [...data.radarData].sort((a, b) => a.gap - b.gap);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Comparing team averages to benchmark targets</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onOpenBenchmarks}><Settings className="h-4 w-4 mr-1" />Benchmarks</Button>
          <Button variant="outline" size="sm" onClick={() => downloadFile(`/api/analytics/hr/export/skill-gap?format=csv&orgId=${orgId}`, "skill-gap.csv")}>
            <Download className="h-4 w-4 mr-1" />CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => downloadFile(`/api/analytics/hr/export/skill-gap?format=json&orgId=${orgId}`, "skill-gap.json")}>
            <Download className="h-4 w-4 mr-1" />JSON
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Radar Overview</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <RadarChart data={radarForChart}>
                <PolarGrid />
                <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11 }} />
                <PolarRadiusAxis angle={30} domain={[0, 5]} tick={{ fontSize: 10 }} />
                <Radar name="Team Avg" dataKey="Team Avg" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.4} />
                <Radar name="Target" dataKey="Target" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.2} strokeDasharray="5 5" />
                <Legend />
                <Tooltip />
              </RadarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Gap Analysis</CardTitle></CardHeader>
          <CardContent className="space-y-3 overflow-y-auto max-h-72">
            {gapList.map(item => (
              <div key={item.dimension} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium truncate">{item.name}</span>
                  <span className={`text-xs font-semibold ml-2 ${item.gap >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {item.gap >= 0 ? "+" : ""}{item.gap}
                  </span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${item.teamAverage >= item.target ? "bg-green-500" : "bg-red-400"}`}
                    style={{ width: `${Math.min(100, (item.teamAverage / 5) * 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Avg: {item.teamAverage}</span>
                  <span>Target: {item.target}</span>
                </div>
                {item.gap < 0 && item.suggestedCategories.length > 0 && (
                  <div className="flex items-center gap-1.5 pt-0.5 flex-wrap">
                    <BookOpen className="h-3 w-3 text-blue-500 flex-shrink-0" />
                    <span className="text-xs text-blue-600 font-medium">Practice in:</span>
                    {item.suggestedCategories.map(cat => (
                      <Badge key={cat} variant="secondary" className="text-xs py-0 px-1.5">{cat}</Badge>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function GrowthTrendPanel({ orgId }: { orgId: string }) {
  const [dateRange, setDateRange] = useState({ start: "", end: "" });
  const [selectedCategory, setSelectedCategory] = useState<string>("__all__");

  const { data, isLoading } = useQuery<GrowthTrendData>({
    queryKey: ["/api/analytics/hr/growth-trend", orgId, dateRange, selectedCategory],
    queryFn: async () => {
      const params = new URLSearchParams({ orgId });
      if (dateRange.start) params.set("startDate", dateRange.start);
      if (dateRange.end) params.set("endDate", dateRange.end);
      if (selectedCategory !== "__all__") params.set("categoryName", selectedCategory);
      const res = await fetch(`/api/analytics/hr/growth-trend?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load growth trend");
      return res.json();
    },
  });

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!data || data.trend.length === 0) return <p className="text-center text-muted-foreground py-16">No trend data available yet.</p>;

  const allCategories = Array.from(new Set([
    ...(data.allCategories || []),
    ...data.trend.flatMap(t => Object.keys(t.categories)),
  ]));
  const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4"];

  const flatTrend = data.trend.map(month => {
    const flat: Record<string, any> = { month: month.month, average: month.average };
    for (const cat of allCategories) {
      flat[`cat__${cat}`] = month.categories[cat];
    }
    return flat;
  });

  const last = data.trend[data.trend.length - 1];
  const secondLast = data.trend.length > 1 ? data.trend[data.trend.length - 2] : null;
  const trendDir = secondLast ? (last.average > secondLast.average ? "up" : last.average < secondLast.average ? "down" : "flat") : "flat";

  const catTrendBadges = allCategories.map(cat => {
    const catValues = data.trend.map(t => t.categories[cat]).filter(v => v !== undefined);
    if (catValues.length < 2) return null;
    const first = catValues[0];
    const lastV = catValues[catValues.length - 1];
    const dir = lastV > first + 1 ? "up" : lastV < first - 1 ? "down" : "flat";
    return { cat, dir };
  }).filter(Boolean) as { cat: string; dir: string }[];

  const exportParams = new URLSearchParams({ orgId });
  if (dateRange.start) exportParams.set("startDate", dateRange.start);
  if (dateRange.end) exportParams.set("endDate", dateRange.end);
  if (selectedCategory !== "__all__") exportParams.set("categoryName", selectedCategory);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm">
          <label className="text-muted-foreground">From</label>
          <Input type="date" value={dateRange.start} onChange={e => setDateRange(p => ({ ...p, start: e.target.value }))} className="w-36 h-8" />
          <label className="text-muted-foreground">To</label>
          <Input type="date" value={dateRange.end} onChange={e => setDateRange(p => ({ ...p, end: e.target.value }))} className="w-36 h-8" />
        </div>
        {allCategories.length > 1 && (
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className="w-44 h-8 text-sm">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All categories</SelectItem>
              {allCategories.map(cat => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-sm text-muted-foreground">Latest avg:</span>
          <span className="font-bold">{last.average}</span>
          {trendDir === "up" && <TrendingUp className="h-4 w-4 text-green-600" />}
          {trendDir === "down" && <TrendingDown className="h-4 w-4 text-red-500" />}
          {trendDir === "flat" && <Minus className="h-4 w-4 text-gray-400" />}
          <Button variant="outline" size="sm" onClick={() => downloadFile(`/api/analytics/hr/export/growth-trend?format=csv&${exportParams}`, "growth-trend.csv")}>
            <Download className="h-4 w-4 mr-1" />CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => downloadFile(`/api/analytics/hr/export/growth-trend?format=json&${exportParams}`, "growth-trend.json")}>
            <Download className="h-4 w-4 mr-1" />JSON
          </Button>
        </div>
      </div>

      {catTrendBadges.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Category trend:</span>
          {catTrendBadges.map(({ cat, dir }) => (
            <Badge key={cat} variant="outline" className="text-xs flex items-center gap-1">
              {cat}
              {dir === "up" ? <TrendingUp className="h-3 w-3 text-green-600" /> : dir === "down" ? <TrendingDown className="h-3 w-3 text-red-500" /> : <Minus className="h-3 w-3 text-gray-400" />}
            </Badge>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="pt-4">
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={flatTrend} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="average" name="Overall Avg" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
              {allCategories.map((cat, i) => (
                <Line
                  key={cat}
                  type="monotone"
                  dataKey={`cat__${cat}`}
                  name={cat}
                  stroke={COLORS[(i + 1) % COLORS.length]}
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

function AtRiskPanel({ orgId }: { orgId: string }) {
  const [drillDown, setDrillDown] = useState<MemberRisk | null>(null);
  const [threshold, setThreshold] = useState("60");

  const { data, isLoading } = useQuery<AtRiskData>({
    queryKey: ["/api/analytics/hr/at-risk", orgId, threshold],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/hr/at-risk?orgId=${orgId}&threshold=${threshold}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load at-risk data");
      return res.json();
    },
  });

  const MemberCard = ({ member, variant }: { member: MemberRisk; variant: "risk" | "high" }) => (
    <div
      className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
      onClick={() => setDrillDown(member)}
    >
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0 ${variant === "risk" ? "bg-red-500" : "bg-green-500"}`}>
        {member.name.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{member.name}</div>
        <div className="text-xs text-muted-foreground">{member.sessionCount} sessions</div>
      </div>
      <div className="flex items-center gap-2">
        <span className={`text-sm font-bold ${variant === "risk" ? "text-red-600" : "text-green-600"}`}>
          {member.recentAverage}
        </span>
        <TrendArrow trend={member.trend} />
      </div>
    </div>
  );

  const exportParams = new URLSearchParams({ orgId, threshold });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2 text-sm">
          <label className="text-muted-foreground">Score threshold:</label>
          <Input
            type="number" min="0" max="100" className="w-20 h-8"
            value={threshold}
            onChange={e => setThreshold(e.target.value)}
          />
          <span className="text-muted-foreground text-xs">(below = at risk)</span>
        </div>
        <div className="flex gap-2 ml-auto">
          <Button variant="outline" size="sm" onClick={() => downloadFile(`/api/analytics/hr/export/at-risk?format=csv&${exportParams}`, "at-risk.csv")}>
            <Download className="h-4 w-4 mr-1" />CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => downloadFile(`/api/analytics/hr/export/at-risk?format=json&${exportParams}`, "at-risk.json")}>
            <Download className="h-4 w-4 mr-1" />JSON
          </Button>
        </div>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 text-red-600">
                <AlertTriangle className="h-4 w-4" />
                At Risk ({data?.atRisk.length ?? 0})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {!data?.atRisk.length ? (
                <p className="text-sm text-muted-foreground text-center py-4">No at-risk members 🎉</p>
              ) : (
                data.atRisk.map(m => <MemberCard key={m.userId} member={m} variant="risk" />)
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 text-green-700">
                <Star className="h-4 w-4" />
                High Performers ({data?.highPerformers.length ?? 0})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {!data?.highPerformers.length ? (
                <p className="text-sm text-muted-foreground text-center py-4">No data yet</p>
              ) : (
                data.highPerformers.slice(0, 8).map(m => <MemberCard key={m.userId} member={m} variant="high" />)
              )}
            </CardContent>
          </Card>
        </div>
      )}
      {drillDown && <DrillDownModal member={drillDown} onClose={() => setDrillDown(null)} />}
    </div>
  );
}

export default function HRAnalyticsPage() {
  const [benchmarkOpen, setBenchmarkOpen] = useState(false);

  const { data: planStatus, isLoading: planLoading } = useQuery<PlanStatus>({
    queryKey: ["/api/analytics/hr/plan-status"],
    queryFn: async () => {
      const res = await fetch("/api/analytics/hr/plan-status", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: competencyData } = useQuery<TeamCompetencyData>({
    queryKey: ["/api/analytics/hr/team-competency", planStatus?.orgId],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/hr/team-competency?orgId=${planStatus?.orgId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!planStatus?.enabled && !!planStatus?.orgId,
  });

  if (planLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (planStatus && !planStatus.isAuthorized) {
    return <AccessRestrictedCTA />;
  }

  if (!planStatus?.enabled) {
    return <UpgradeCTA planName={planStatus?.planName ?? "Starter"} />;
  }

  const orgId = planStatus.orgId ?? "";
  const dimensions = competencyData?.dimensions ?? [];

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <div className="container mx-auto px-4 py-6 max-w-7xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BarChart3 className="h-6 w-6 text-blue-600" />
              HR Team Analytics
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Org-level competency intelligence for your team</p>
          </div>
          <Badge className="bg-blue-100 text-blue-700 border-blue-200">{planStatus.planName} Plan</Badge>
        </div>

        <Tabs defaultValue="heatmap">
          <TabsList className="mb-6 flex-wrap h-auto gap-1">
            <TabsTrigger value="heatmap" className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />Competency Heatmap
            </TabsTrigger>
            <TabsTrigger value="skill-gap" className="flex items-center gap-1.5">
              <Target className="h-3.5 w-3.5" />Skill Gap
            </TabsTrigger>
            <TabsTrigger value="growth" className="flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" />Growth Trend
            </TabsTrigger>
            <TabsTrigger value="at-risk" className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" />At-Risk / Top Performers
            </TabsTrigger>
          </TabsList>

          <TabsContent value="heatmap">
            <Card>
              <CardHeader>
                <CardTitle>Team Competency Heatmap</CardTitle>
                <p className="text-sm text-muted-foreground">Average score per evaluation dimension — click any score cell to drill into sessions</p>
              </CardHeader>
              <CardContent>
                <CompetencyHeatmap orgId={orgId} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="skill-gap">
            <Card>
              <CardHeader>
                <CardTitle>Skill Gap Map</CardTitle>
                <p className="text-sm text-muted-foreground">Team averages vs. benchmark targets — gaps below target show suggested practice categories</p>
              </CardHeader>
              <CardContent>
                <SkillGapPanel orgId={orgId} onOpenBenchmarks={() => setBenchmarkOpen(true)} dimensions={dimensions} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="growth">
            <Card>
              <CardHeader>
                <CardTitle>Growth Trend</CardTitle>
                <p className="text-sm text-muted-foreground">Monthly average scores — filter by date range or scenario category</p>
              </CardHeader>
              <CardContent>
                <GrowthTrendPanel orgId={orgId} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="at-risk">
            <Card>
              <CardHeader>
                <CardTitle>At-Risk / High-Performer Identification</CardTitle>
                <p className="text-sm text-muted-foreground">Click any member to see their session-by-session breakdown</p>
              </CardHeader>
              <CardContent>
                <AtRiskPanel orgId={orgId} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {benchmarkOpen && (
        <BenchmarkSettingsModal
          orgId={orgId}
          dimensions={dimensions}
          onClose={() => setBenchmarkOpen(false)}
        />
      )}
    </div>
  );
}
