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
  stateBefore: Record<string, unknown> | null;
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
 * Collect all unique incidents from simulation events, keyed by turnIndex.
 */
function collectIncidentsByTurn(events: SimulationEventRecord[]): Map<number, Incident[]> {
  const seen = new Map<string, Incident>();

  for (const ev of events) {
    if (ev.eventType === "tool_call" && ev.result) {
      const candidate = ev.result["incident"];
      if (isIncident(candidate) && !seen.has(candidate.id)) {
        seen.set(candidate.id, candidate);
      }
    }
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

  const byTurn = new Map<number, Incident[]>();
  for (const inc of seen.values()) {
    const list = byTurn.get(inc.turnIndex) ?? [];
    list.push(inc);
    byTurn.set(inc.turnIndex, list);
  }
  return byTurn;
}

interface EmotionDelta {
  trust: number;
  interest: number;
  anger: number;
  confusion: number;
}

/**
 * For each turn, compute NPC emotion delta = stateAfter - stateBefore
 * from auto_evaluation events.
 */
function computeEmotionDeltasByTurn(events: SimulationEventRecord[]): Map<number, EmotionDelta> {
  const result = new Map<number, EmotionDelta>();
  for (const ev of events) {
    if (ev.eventType !== "auto_evaluation") continue;
    if (!isSimulationState(ev.stateAfter)) continue;
    const after = ev.stateAfter.npcEmotions;
    const before = isSimulationState(ev.stateBefore) ? ev.stateBefore.npcEmotions : null;
    if (!before) continue;
    result.set(ev.turnIndex, {
      trust: after.trust - before.trust,
      interest: after.interest - before.interest,
      anger: after.anger - before.anger,
      confusion: after.confusion - before.confusion,
    });
  }
  return result;
}

// ── Config ────────────────────────────────────────────────────────────────

interface ScoreDimension {
  key: keyof Pick<TurnScore, "clarity" | "empathy" | "logic" | "ownership" | "actionPlan">;
  label: string;
}

const SCORE_DIMENSIONS: ScoreDimension[] = [
  { key: "clarity", label: "명확성" },
  { key: "empathy", label: "공감" },
  { key: "logic", label: "논리" },
  { key: "ownership", label: "책임감" },
  { key: "actionPlan", label: "행동계획" },
];

// ── Session insights computation ───────────────────────────────────────────

interface SessionInsights {
  turningPoint: {
    turnIndex: number;
    emotionKey: "trust" | "anger";
    delta: number;
    direction: "drop" | "rise";
  } | null;
  repeatedWeakness: {
    dimensionLabel: string;
    affectedTurns: number;
    totalTurns: number;
  } | null;
  bestMoment: {
    turnIndex: number;
    dimensionLabel: string;
    score: number;
    hint?: string;
  } | null;
}

function computeSessionInsights(
  turnScores: TurnScore[],
  emotionDeltasByTurn: Map<number, EmotionDelta>
): SessionInsights {
  // 1. Turning point — largest NPC emotion change (trust drop or anger rise)
  let turningPoint: SessionInsights["turningPoint"] = null;
  let maxMagnitude = 0;
  for (const [turnIndex, delta] of emotionDeltasByTurn) {
    // Trust drop is most impactful
    if (delta.trust < 0 && Math.abs(delta.trust) > maxMagnitude) {
      maxMagnitude = Math.abs(delta.trust);
      turningPoint = { turnIndex, emotionKey: "trust", delta: delta.trust, direction: "drop" };
    }
    // Anger rise (treat as negative signal)
    if (delta.anger > 0 && delta.anger > maxMagnitude) {
      maxMagnitude = delta.anger;
      turningPoint = { turnIndex, emotionKey: "anger", delta: delta.anger, direction: "rise" };
    }
  }

  // 2. Repeated weakness — dimension low on 3+ consecutive turns OR majority of turns
  let repeatedWeakness: SessionInsights["repeatedWeakness"] = null;
  if (turnScores.length >= 2) {
    const WEAK_THRESHOLD = 50;
    let worstDim: ScoreDimension | null = null;
    let worstCount = 0;

    for (const dim of SCORE_DIMENSIONS) {
      const weakCount = turnScores.filter((s) => s[dim.key] < WEAK_THRESHOLD).length;
      const isMajority = weakCount >= Math.ceil(turnScores.length / 2);

      // Check for 3+ consecutive weak turns
      let maxConsecutive = 0;
      let consecutive = 0;
      for (const s of turnScores) {
        if (s[dim.key] < WEAK_THRESHOLD) {
          consecutive++;
          if (consecutive > maxConsecutive) maxConsecutive = consecutive;
        } else {
          consecutive = 0;
        }
      }
      const hasConsecutive = maxConsecutive >= 3;

      if ((isMajority || hasConsecutive) && weakCount > worstCount) {
        worstCount = weakCount;
        worstDim = dim;
      }
    }
    if (worstDim) {
      repeatedWeakness = {
        dimensionLabel: worstDim.label,
        affectedTurns: worstCount,
        totalTurns: turnScores.length,
      };
    }
  }

  // 3. Best moment — turn with highest single-dimension score
  let bestMoment: SessionInsights["bestMoment"] = null;
  let bestScore = -1;
  for (const score of turnScores) {
    for (const dim of SCORE_DIMENSIONS) {
      const val = score[dim.key];
      if (val > bestScore) {
        bestScore = val;
        bestMoment = {
          turnIndex: score.turnIndex,
          dimensionLabel: dim.label,
          score: val,
          hint: score.hint,
        };
      }
    }
  }

  return { turningPoint, repeatedWeakness, bestMoment };
}

// ── Sub-components ─────────────────────────────────────────────────────────

function DeltaBadge({
  value,
  label,
  invertPositive = false,
  alwaysShow = false,
}: {
  value: number;
  label: string;
  invertPositive?: boolean;
  alwaysShow?: boolean;
}) {
  const rounded = Math.round(value);
  const isZero = Math.abs(rounded) < 1;

  if (isZero && !alwaysShow) return null;

  if (isZero) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
        <i className="fas fa-minus text-[9px]" />
        {label} 변화 없음
      </span>
    );
  }

  const sign = rounded > 0 ? "+" : "";
  const isGood = invertPositive ? rounded < 0 : rounded > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded-full ${
        isGood
          ? "bg-emerald-50 text-emerald-700"
          : "bg-red-50 text-red-700"
      }`}
    >
      {isGood ? (
        <i className="fas fa-arrow-up text-[9px]" />
      ) : (
        <i className="fas fa-arrow-down text-[9px]" />
      )}
      {label} {sign}{rounded}
    </span>
  );
}

function EmotionImpactRow({ delta }: { delta: EmotionDelta }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {/* Trust and anger always shown per spec: "NPC 신뢰 +12 / 분노 변화 없음" */}
      <DeltaBadge value={delta.trust} label="신뢰" alwaysShow />
      <DeltaBadge value={delta.anger} label="분노" invertPositive alwaysShow />
      {/* Interest and confusion only shown when non-zero */}
      <DeltaBadge value={delta.interest} label="관심" />
      <DeltaBadge value={delta.confusion} label="혼란" invertPositive />
    </div>
  );
}

function StrengthWeaknessBadges({ score }: { score: TurnScore }) {
  const dims = SCORE_DIMENSIONS.map((d) => ({ ...d, value: score[d.key] }));
  dims.sort((a, b) => b.value - a.value);
  const best = dims[0];
  const worst = dims[dims.length - 1];
  return (
    <div className="flex flex-wrap gap-1.5">
      {best && (
        <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
          <i className="fas fa-check text-[9px]" />
          잘함 · {best.label}
        </span>
      )}
      {worst && worst.key !== best?.key && (
        <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200">
          <i className="fas fa-wrench text-[9px]" />
          보완 필요 · {worst.label}
        </span>
      )}
    </div>
  );
}

function IncidentInlineBanner({ incident }: { incident: Incident }) {
  const severityClass = {
    low: "bg-yellow-50 border-yellow-300 text-yellow-800",
    medium: "bg-orange-50 border-orange-300 text-orange-800",
    high: "bg-red-50 border-red-300 text-red-800",
  }[toSeverity(incident.severity)];
  return (
    <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs leading-relaxed ${severityClass}`}>
      <i className="fas fa-triangle-exclamation text-[10px] mt-0.5 shrink-0" />
      <span>{incident.message || "인시던트가 발생했습니다."}</span>
    </div>
  );
}

function SessionInsightsCard({ insights }: { insights: SessionInsights }) {
  const hasAny = insights.turningPoint || insights.repeatedWeakness || insights.bestMoment;
  if (!hasAny) return null;

  return (
    <Card className="border-indigo-200 shadow-sm bg-gradient-to-br from-indigo-50 to-white">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-bold text-slate-800 flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-indigo-600 text-white text-xs">
            <i className="fas fa-lightbulb" />
          </span>
          세션 인사이트
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {insights.turningPoint && (
            <div className="flex gap-3 p-3 rounded-lg bg-red-50 border border-red-100">
              <div className="shrink-0 w-7 h-7 rounded-full bg-red-100 flex items-center justify-center">
                <i className="fas fa-rotate text-red-500 text-xs" />
              </div>
              <div>
                <p className="text-xs font-semibold text-red-700 mb-0.5">결정적 순간</p>
                <p className="text-sm text-red-800 leading-relaxed">
                  {insights.turningPoint.direction === "drop"
                    ? `턴 ${insights.turningPoint.turnIndex + 1}에서 NPC 신뢰가 ${Math.abs(Math.round(insights.turningPoint.delta))}점 급격히 하락했습니다.`
                    : `턴 ${insights.turningPoint.turnIndex + 1}에서 NPC 분노가 ${Math.round(insights.turningPoint.delta)}점 상승했습니다.`}
                </p>
              </div>
            </div>
          )}

          {insights.repeatedWeakness && (
            <div className="flex gap-3 p-3 rounded-lg bg-orange-50 border border-orange-100">
              <div className="shrink-0 w-7 h-7 rounded-full bg-orange-100 flex items-center justify-center">
                <i className="fas fa-repeat text-orange-500 text-xs" />
              </div>
              <div>
                <p className="text-xs font-semibold text-orange-700 mb-0.5">반복된 약점 패턴</p>
                <p className="text-sm text-orange-800 leading-relaxed">
                  이번 대화 전반에 걸쳐 <strong>{insights.repeatedWeakness.dimensionLabel}</strong>이(가) 부족했습니다.
                  ({insights.repeatedWeakness.affectedTurns}/{insights.repeatedWeakness.totalTurns} 턴)
                </p>
              </div>
            </div>
          )}

          {insights.bestMoment && (
            <div className="flex gap-3 p-3 rounded-lg bg-emerald-50 border border-emerald-100">
              <div className="shrink-0 w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center">
                <i className="fas fa-star text-emerald-500 text-xs" />
              </div>
              <div>
                <p className="text-xs font-semibold text-emerald-700 mb-0.5">잘한 순간</p>
                <p className="text-sm text-emerald-800 leading-relaxed">
                  턴 {insights.bestMoment.turnIndex + 1}에서 <strong>{insights.bestMoment.dimensionLabel}</strong>이(가)
                  {" "}{Math.round(insights.bestMoment.score)}점으로 가장 높았습니다.
                  {insights.bestMoment.hint && " 코칭 힌트를 잘 활용했습니다."}
                </p>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

interface SimulationReplayPanelProps {
  conversationId: string;
  conversationMode?: string;
}

export default function SimulationReplayPanel({ conversationId, conversationMode }: SimulationReplayPanelProps) {
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

  // Turn scores — deduplicate by turnIndex, prefer 'quality' over 'fast'
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

  const incidentsByTurn = collectIncidentsByTurn(allEvents);
  const emotionDeltasByTurn = computeEmotionDeltasByTurn(allEvents);

  // Gate on turnScores only: incidents without scores have no turn card to attach to,
  // so showing only incidents would leave the panel blank. Empty-state handles that path.
  const hasSimData = turnScores.length > 0;

  if (!hasSimData) {
    const isVoice = conversationMode === "realtime_voice";
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
        <div className="flex items-center justify-center w-14 h-14 rounded-full bg-slate-100">
          {isVoice ? (
            <i className="fas fa-microphone-slash text-slate-400 text-xl" />
          ) : (
            <i className="fas fa-chart-bar text-slate-400 text-xl" />
          )}
        </div>
        <div className="space-y-1">
          <p className="text-slate-700 font-medium text-sm">
            {isVoice
              ? "음성 대화는 시뮬레이션 점수를 지원하지 않습니다"
              : "시뮬레이션 점수 데이터가 없습니다"}
          </p>
          <p className="text-slate-400 text-xs max-w-xs leading-relaxed">
            {isVoice
              ? "시뮬레이션 점수는 텍스트 또는 TTS 모드 대화에서만 생성됩니다."
              : "시뮬레이션 점수는 텍스트 또는 TTS 모드로 진행한 대화에서, 10자 이상의 메시지를 입력했을 때 생성됩니다."}
          </p>
        </div>
      </div>
    );
  }

  const insights = computeSessionInsights(turnScores, emotionDeltasByTurn);

  return (
    <div className="space-y-6">

      {/* Session insights card */}
      <SessionInsightsCard insights={insights} />

      {/* Timeline of turn cards */}
      {turnScores.length > 0 && (
        <div className="relative">
          {/* Timeline vertical line */}
          <div className="absolute left-3.5 top-4 bottom-4 w-0.5 bg-slate-200" />

          <div className="space-y-4">
            {turnScores.map((score, idx) => {
              const userMessage = userMessagesByTurn[score.turnIndex];
              const delta = emotionDeltasByTurn.get(score.turnIndex);
              const turnIncidents = incidentsByTurn.get(score.turnIndex) ?? [];

              return (
                <div key={score.turnId ?? idx} className="relative flex gap-4">
                  {/* Timeline dot */}
                  <div className="shrink-0 z-10 flex items-center justify-center w-7 h-7 rounded-full bg-corporate-600 text-white text-xs font-bold shadow-sm">
                    {score.turnIndex + 1}
                  </div>

                  {/* Turn card */}
                  <div className="flex-1 border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                    {/* User utterance */}
                    <div className="bg-slate-50 border-b border-slate-200 px-3 py-2.5 flex gap-2 items-start">
                      <span className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-corporate-600 text-white mt-0.5">
                        <i className="fas fa-user text-[9px]" />
                      </span>
                      {userMessage ? (
                        <p className="text-sm text-slate-700 leading-relaxed">{userMessage}</p>
                      ) : (
                        <p className="text-sm text-slate-400 italic">발화 기록 없음</p>
                      )}
                    </div>

                    {/* Turn body */}
                    <div className="p-3 space-y-3">
                      {/* Emotion impact */}
                      <div>
                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
                          이 턴의 영향
                        </p>
                        {delta ? (
                          <EmotionImpactRow delta={delta} />
                        ) : (
                          <span className="text-xs text-slate-400 italic">감정 데이터 없음</span>
                        )}
                      </div>

                      {/* Strength / weakness badges */}
                      <div>
                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
                          역량 평가
                        </p>
                        <StrengthWeaknessBadges score={score} />
                      </div>

                      {/* Coaching hint */}
                      {score.hint && (
                        <div className="flex gap-2 items-start rounded-md bg-amber-50 border border-amber-200 px-3 py-2">
                          <i className="fas fa-lightbulb text-amber-500 text-xs mt-0.5 shrink-0" />
                          <div>
                            <p className="text-[10px] font-semibold text-amber-600 mb-0.5">이렇게 해보세요</p>
                            <p className="text-xs text-amber-800 leading-relaxed">{score.hint}</p>
                          </div>
                        </div>
                      )}

                      {/* Inline incidents */}
                      {turnIncidents.length > 0 && (
                        <div className="space-y-1.5">
                          {turnIncidents.map((inc, iidx) => (
                            <IncidentInlineBanner key={inc.id ?? iidx} incident={inc} />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
