import { useQuery } from "@tanstack/react-query";
import { authFetchRaw } from "@/lib/authFetch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// ── Runtime-typed shapes ────────────────────────────────────────────────────

interface TurnScore {
  turnId: string;
  turnIndex: number;
  clarity: number;
  empathy: number;
  logic: number;
  ownership: number;
  actionPlan: number;
  total: number;
  hint?: string;
  evaluationMethod: string;
}

interface Incident {
  id: string;
  type: string;
  severity: "low" | "medium" | "high";
  message: string;
  turnIndex: number;
  triggeredBy: string;
  createdAt: string;
}

interface NpcEmotions {
  anger: number;
  trust: number;
  confusion: number;
  interest: number;
}

interface SimulationState {
  version: number;
  npcEmotions: NpcEmotions;
  recentIncidents: Incident[];
}

interface SimulationEventRecord {
  id: string;
  eventType: string;
  turnIndex: number;
  result: Record<string, unknown> | null;
  args: Record<string, unknown> | null;
  stateAfter: Record<string, unknown> | null;
  stateVersionAfter: number | null;
  includeInReport: boolean;
  createdAt: string;
}

interface SimulationEventsResponse {
  events: SimulationEventRecord[];
  userMessagesByTurn?: Record<number, string>;
}

// ── Type guards ────────────────────────────────────────────────────────────

function isTurnScore(v: unknown): v is TurnScore {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.turnIndex === "number" &&
    typeof s.clarity === "number" &&
    typeof s.empathy === "number" &&
    typeof s.logic === "number" &&
    typeof s.ownership === "number" &&
    typeof s.actionPlan === "number" &&
    typeof s.total === "number"
  );
}

function isNpcEmotions(v: unknown): v is NpcEmotions {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.anger === "number" &&
    typeof e.trust === "number" &&
    typeof e.confusion === "number" &&
    typeof e.interest === "number"
  );
}

function isSimulationState(v: unknown): v is SimulationState {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return isNpcEmotions(s.npcEmotions) && typeof s.version === "number";
}

function isIncident(v: unknown): v is Incident {
  if (!v || typeof v !== "object") return false;
  const i = v as Record<string, unknown>;
  return (
    typeof i.id === "string" &&
    typeof i.type === "string" &&
    typeof i.severity === "string" &&
    typeof i.turnIndex === "number"
  );
}

const VALID_SEVERITIES = new Set<string>(["low", "medium", "high"]);
function toSeverity(v: unknown): "low" | "medium" | "high" {
  return typeof v === "string" && VALID_SEVERITIES.has(v)
    ? (v as "low" | "medium" | "high")
    : "low";
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Collect all unique incidents from simulation events.
 *
 * Incidents surface in two ways:
 * 1. As stateAfter.recentIncidents on any event type (text/TTS mode: they
 *    are folded into the state by applySimulationPatch on the same turn as
 *    the auto_evaluation event).
 * 2. As result.incident on tool_call events (voice mode: trigger_incident
 *    tool called by Gemini is stored inline alongside the tool call result).
 *
 * We union both sources and deduplicate by ID so neither path is missed.
 */
function collectIncidents(events: SimulationEventRecord[]): Incident[] {
  const seen = new Map<string, Incident>();

  for (const ev of events) {
    // Source 1 – result.incident on tool_call events (voice mode)
    if (ev.eventType === "tool_call" && ev.result) {
      const candidate = ev.result["incident"];
      if (isIncident(candidate) && !seen.has(candidate.id)) {
        seen.set(candidate.id, candidate);
      }
    }

    // Source 2 – stateAfter.recentIncidents on any event (text/TTS + voice)
    if (isSimulationState(ev.stateAfter)) {
      const recentIncidents = Array.isArray(ev.stateAfter.recentIncidents)
        ? ev.stateAfter.recentIncidents
        : [];
      for (const inc of recentIncidents) {
        if (isIncident(inc) && !seen.has(inc.id)) {
          seen.set(inc.id, inc);
        }
      }
    }
  }

  return Array.from(seen.values()).sort((a, b) => a.turnIndex - b.turnIndex);
}

/**
 * Return the NPC emotion state from the event with the highest
 * stateVersionAfter (true terminal state, not merely the last eval event).
 */
function deriveFinalNpcEmotions(events: SimulationEventRecord[]): NpcEmotions | null {
  let bestVersion = -1;
  let result: NpcEmotions | null = null;

  for (const ev of events) {
    const version = ev.stateVersionAfter ?? -1;
    if (version <= bestVersion) continue;
    if (isSimulationState(ev.stateAfter)) {
      bestVersion = version;
      result = ev.stateAfter.npcEmotions;
    }
  }

  return result;
}

// ── Config ────────────────────────────────────────────────────────────────

interface ScoreDimension {
  key: keyof Pick<TurnScore, "clarity" | "empathy" | "logic" | "ownership" | "actionPlan">;
  label: string;
  color: string;
}

const SCORE_DIMENSIONS: ScoreDimension[] = [
  { key: "clarity", label: "명확성", color: "bg-blue-500" },
  { key: "empathy", label: "공감", color: "bg-pink-500" },
  { key: "logic", label: "논리", color: "bg-violet-500" },
  { key: "ownership", label: "책임감", color: "bg-amber-500" },
  { key: "actionPlan", label: "행동계획", color: "bg-emerald-500" },
];

interface EmotionBarConfig {
  key: keyof NpcEmotions;
  label: string;
  positiveColor: string;
  icon: string;
}

const EMOTION_BARS: EmotionBarConfig[] = [
  { key: "trust", label: "신뢰", positiveColor: "bg-emerald-500", icon: "fa-handshake" },
  { key: "interest", label: "관심", positiveColor: "bg-blue-500", icon: "fa-eye" },
  { key: "anger", label: "분노", positiveColor: "bg-red-500", icon: "fa-fire" },
  { key: "confusion", label: "혼란", positiveColor: "bg-amber-500", icon: "fa-question-circle" },
];

const SEVERITY_CONFIG: Record<"low" | "medium" | "high", { label: string; className: string }> = {
  low: { label: "낮음", className: "bg-yellow-100 text-yellow-800 border-yellow-300" },
  medium: { label: "중간", className: "bg-orange-100 text-orange-800 border-orange-300" },
  high: { label: "높음", className: "bg-red-100 text-red-800 border-red-300" },
};

// ── Sub-components ─────────────────────────────────────────────────────────

function ScoreBar({ value, color }: { value: number; color: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-semibold text-slate-700 w-8 text-right">{Math.round(value)}</span>
    </div>
  );
}

function EmotionBar({ value, label, icon, positiveColor }: { value: number; label: string; icon: string; positiveColor: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2">
      <i className={`fas ${icon} text-slate-400 w-4 text-center text-xs`} />
      <span className="text-xs text-slate-600 w-10">{label}</span>
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${positiveColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-slate-500 w-6 text-right">{Math.round(value)}</span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

interface SimulationReplayPanelProps {
  conversationId: string;
}

export default function SimulationReplayPanel({ conversationId }: SimulationReplayPanelProps) {
  const { data, isLoading, error } = useQuery<SimulationEventsResponse>({
    queryKey: ["/api/simulation", conversationId, "events"],
    queryFn: async () => {
      const res = await authFetchRaw(`/api/simulation/${conversationId}/events`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<SimulationEventsResponse>;
    },
    staleTime: Infinity,
    gcTime: 1000 * 60 * 30,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-corporate-600" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-12 text-slate-500 text-sm">
        시뮬레이션 데이터를 불러올 수 없습니다.
      </div>
    );
  }

  const allEvents = data.events ?? [];
  const userMessagesByTurn: Record<number, string> = data.userMessagesByTurn ?? {};

  // Turn scores from auto_evaluation events with includeInReport=true.
  // Deduplicate by turnIndex: when both a 'quality' and a 'fast' event exist for the
  // same turn (e.g. quality succeeded then a fast fallback also ran, or a retry occurred),
  // prefer the 'quality' event so the richer LLM-based score wins.
  const turnScores: TurnScore[] = (() => {
    const byTurnIndex = new Map<number, { score: TurnScore; evalMode: string }>();
    for (const e of allEvents) {
      if (e.eventType !== "auto_evaluation" || !e.includeInReport) continue;
      const ts = e.result?.["turnScore"];
      if (!isTurnScore(ts)) continue;
      const evalMode = (e.args?.["evalMode"] as string | undefined) ?? "fast";
      const existing = byTurnIndex.get(ts.turnIndex);
      if (!existing || evalMode === "quality") {
        byTurnIndex.set(ts.turnIndex, { score: ts, evalMode });
      }
    }
    return Array.from(byTurnIndex.values())
      .map((v) => v.score)
      .sort((a, b) => a.turnIndex - b.turnIndex);
  })();

  // Incidents from all sources (tool_call result.incident + stateAfter.recentIncidents)
  const incidents = collectIncidents(allEvents);

  // Final NPC emotions from the event with the highest state version
  const finalNpcEmotions = deriveFinalNpcEmotions(allEvents);

  const hasSimData = turnScores.length > 0 || incidents.length > 0 || finalNpcEmotions !== null;

  if (!hasSimData) {
    return (
      <div className="text-center py-12 text-slate-500 text-sm">
        이 대화에는 시뮬레이션 점수 데이터가 없습니다.
      </div>
    );
  }

  const avgScores = SCORE_DIMENSIONS.reduce<Record<string, number>>((acc, dim) => {
    const vals = turnScores.map((s) => s[dim.key]);
    acc[dim.key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    return acc;
  }, {});

  return (
    <div className="space-y-6">

      {/* Final NPC emotion state */}
      {finalNpcEmotions && (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-indigo-600 text-white text-xs">
                <i className="fas fa-face-smile" />
              </span>
              세션 종료 시 NPC 감정 상태
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {EMOTION_BARS.map((bar) => (
                <EmotionBar
                  key={bar.key}
                  value={finalNpcEmotions[bar.key]}
                  label={bar.label}
                  icon={bar.icon}
                  positiveColor={bar.positiveColor}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Turn-by-turn scores */}
      {turnScores.length > 0 && (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-600 text-white text-xs">
                <i className="fas fa-chart-line" />
              </span>
              턴별 역량 점수
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Average summary */}
            <div className="mb-4 p-3 bg-slate-50 rounded-lg">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">평균 점수</p>
              <div className="space-y-1.5">
                {SCORE_DIMENSIONS.map((dim) => (
                  <div key={dim.key} className="flex items-center gap-2">
                    <span className="text-xs text-slate-600 w-14">{dim.label}</span>
                    <ScoreBar value={avgScores[dim.key] ?? 0} color={dim.color} />
                  </div>
                ))}
              </div>
            </div>

            {/* Per-turn breakdown */}
            <div className="space-y-4">
              {turnScores.map((score, idx) => {
                const userMessage = userMessagesByTurn[score.turnIndex];
                return (
                  <div key={score.turnId ?? idx} className="border border-slate-200 rounded-lg overflow-hidden">
                    {/* User message bubble */}
                    {userMessage && (
                      <div className="bg-slate-50 border-b border-slate-200 px-3 py-2 flex gap-2 items-start">
                        <span className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-corporate-600 text-white mt-0.5">
                          <i className="fas fa-user text-[9px]" />
                        </span>
                        <p className="text-sm text-slate-700 leading-relaxed">{userMessage}</p>
                      </div>
                    )}

                    {/* Score card */}
                    <div className="p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-slate-600">턴 {score.turnIndex + 1}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-400">{score.evaluationMethod}</span>
                          <span className="text-sm font-bold text-corporate-700">
                            종합 {Math.round(score.total)}점
                          </span>
                        </div>
                      </div>
                      <div className="space-y-1">
                        {SCORE_DIMENSIONS.map((dim) => (
                          <div key={dim.key} className="flex items-center gap-2">
                            <span className="text-xs text-slate-500 w-14">{dim.label}</span>
                            <ScoreBar value={score[dim.key]} color={dim.color} />
                          </div>
                        ))}
                      </div>
                      {score.hint && (
                        <div className="mt-3 flex gap-2 items-start rounded-md bg-amber-50 border border-amber-200 px-3 py-2">
                          <i className="fas fa-lightbulb text-amber-500 text-xs mt-0.5 shrink-0" />
                          <p className="text-xs text-amber-800 leading-relaxed">{score.hint}</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Incident timeline */}
      {incidents.length > 0 && (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-orange-500 text-white text-xs">
                <i className="fas fa-bolt" />
              </span>
              발생한 인시던트 ({incidents.length}건)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative pl-4 border-l-2 border-slate-200 space-y-4">
              {incidents.map((incident, idx) => {
                const sev = SEVERITY_CONFIG[toSeverity(incident.severity)];
                return (
                  <div key={incident.id ?? idx} className="relative">
                    <div className="absolute -left-[17px] top-1 w-3 h-3 rounded-full bg-orange-400 border-2 border-white" />
                    <div className="flex items-start gap-2">
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0.5 shrink-0 ${sev.className}`}
                      >
                        {sev.label}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-xs font-semibold text-slate-700">
                            턴 {incident.turnIndex + 1}
                          </span>
                          <span className="text-xs text-slate-400">·</span>
                          <span className="text-xs text-slate-500 font-mono">{incident.type}</span>
                        </div>
                        {incident.message && (
                          <p className="text-sm text-slate-700 leading-relaxed">{incident.message}</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
