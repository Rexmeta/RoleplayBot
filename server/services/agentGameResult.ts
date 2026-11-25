/**
 * Game-friendly session result. The single source of truth for both
 * GET /sessions/:id/result and the feedback.completed webhook payload.
 */
import { GAME_CONTEXT_METADATA_KEY, type GameContext } from "./agentGameContext";

export type GameResultStatus = "in_progress" | "completed" | "failed";
export type ScenarioSuccessLevel = "excellent" | "success" | "partial" | "failure";

export interface GameResultInput {
  session: {
    id: string;
    status: string;
    externalSessionId?: string | null;
    scenarioId: string;
    personaId: string;
    language?: string | null;
    metadata?: unknown;
  };
  /** Durable job status from persona_runs.feedback_status (null = never queued). */
  feedbackStatus: string | null;
  feedbackError?: string | null;
  /** Persisted feedbacks row (or its detailedFeedback). */
  feedback?: Record<string, any> | null;
  messages?: Array<{ sender?: string; emotion?: string | null }>;
  personaName?: string | null;
}

export const SUCCESS_LEVEL_THRESHOLDS = { excellent: 85, success: 70, partial: 50 } as const;

export function resolveSuccessLevel(score: number | null, passed: boolean | null): ScenarioSuccessLevel | null {
  if (score === null) return null;
  let level: ScenarioSuccessLevel =
    score >= SUCCESS_LEVEL_THRESHOLDS.excellent ? "excellent"
    : score >= SUCCESS_LEVEL_THRESHOLDS.success ? "success"
    : score >= SUCCESS_LEVEL_THRESHOLDS.partial ? "partial"
    : "failure";
  // A failed passing rule can never read as a clear success.
  if (passed === false && (level === "excellent" || level === "success")) level = "partial";
  return level;
}

function strArray(v: unknown, max: number): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, max)
    : [];
}

export function summarizeEmotionFlow(messages: GameResultInput["messages"]) {
  const sequence = (messages ?? [])
    .filter((m) => m.sender === "ai" && typeof m.emotion === "string" && m.emotion.trim())
    .map((m) => m.emotion!.trim());
  if (sequence.length === 0) return null;
  const counts = new Map<string, number>();
  for (const e of sequence) counts.set(e, (counts.get(e) ?? 0) + 1);
  const dominant = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0][0];
  return {
    start: sequence[0],
    end: sequence[sequence.length - 1],
    dominant,
    turns: sequence.length,
    sequence: sequence.slice(-20),
  };
}

const LEVEL_TEXT: Record<string, Record<ScenarioSuccessLevel, string>> = {
  ko: { excellent: "매우 훌륭하게", success: "성공적으로", partial: "절반의 성과로", failure: "성과 없이" },
  en: { excellent: "excellently", success: "successfully", partial: "with mixed results", failure: "without success" },
};

export function buildNarrativeHook(args: {
  language: string;
  personaName: string | null;
  level: ScenarioSuccessLevel | null;
  flow: ReturnType<typeof summarizeEmotionFlow>;
  strength: string | null;
  improvement: string | null;
}): string {
  const ko = args.language === "ko";
  const t = LEVEL_TEXT[ko ? "ko" : "en"];
  const who = args.personaName ?? (ko ? "상대" : "the other party");
  const parts: string[] = [];
  if (args.level) {
    parts.push(ko ? `플레이어는 ${who}와의 대화를 ${t[args.level]} 마무리했다.`
      : `The player handled the conversation with ${who} ${t[args.level]}.`);
  } else {
    parts.push(ko ? `${who}와의 대화는 평가하기에 충분하지 않았다.`
      : `The conversation with ${who} was too short to assess.`);
  }
  if (args.flow && args.flow.start !== args.flow.end) {
    parts.push(ko ? `상대의 감정은 '${args.flow.start}'에서 '${args.flow.end}'(으)로 변했다.`
      : `Their mood shifted from '${args.flow.start}' to '${args.flow.end}'.`);
  } else if (args.flow) {
    parts.push(ko ? `상대의 감정은 '${args.flow.end}' 상태를 유지했다.`
      : `Their mood stayed '${args.flow.end}'.`);
  }
  if (args.strength) parts.push(ko ? `돋보인 점: ${args.strength}` : `Standout: ${args.strength}`);
  else if (args.improvement) parts.push(ko ? `아쉬운 점: ${args.improvement}` : `Weak spot: ${args.improvement}`);
  return parts.join(" ").slice(0, 400);
}

export function buildGameResult(input: GameResultInput) {
  const { session } = input;
  const meta = (session.metadata as Record<string, any> | null) ?? {};
  const ctx = meta[GAME_CONTEXT_METADATA_KEY] as GameContext | undefined;

  const base = {
    sessionId: session.id,
    externalSessionId: session.externalSessionId ?? null,
    gameContextId: ctx?.contextId ?? null,
    sessionStatus: session.status,
    scenarioId: session.scenarioId,
    personaId: session.personaId,
  };

  const fs = input.feedbackStatus;
  if (fs === "error" || fs === "expired") {
    return {
      ...base,
      status: "failed" as GameResultStatus,
      result: null,
      error: { code: "feedback_failed", message: input.feedbackError ?? "Feedback generation failed." },
    };
  }
  if (fs !== "completed" || !input.feedback) {
    return { ...base, status: "in_progress" as GameResultStatus, result: null };
  }

  const detailed: Record<string, any> = input.feedback.detailedFeedback ?? input.feedback;
  const insufficient = detailed.reportStatus === "insufficient_data" || input.feedback.reportStatus === "insufficient_data";
  const rawScore = detailed.overallScore ?? input.feedback.overallScore;
  const overallScore = !insufficient && typeof rawScore === "number" && Number.isFinite(rawScore)
    ? Math.round(rawScore) : null;
  const passResult = detailed.harnessPassResult;
  const passed: boolean | null = typeof passResult?.passed === "boolean" ? passResult.passed : null;
  const level = resolveSuccessLevel(overallScore, passed);
  const strengths = strArray(detailed.strengths, 5);
  const improvements = strArray(detailed.improvements, 5);
  const flow = summarizeEmotionFlow(input.messages);

  const rawScores: any[] = Array.isArray(detailed.scores) ? detailed.scores : (input.feedback.scores ?? []);
  const dimensionScores = rawScores
    .filter((s) => s && typeof s.score === "number")
    .map((s) => ({
      key: String(s.category ?? s.name ?? ""),
      name: String(s.name ?? s.category ?? ""),
      score: s.score as number,
      maxScore: typeof s.maxScore === "number" ? s.maxScore : 100,
    }));

  return {
    ...base,
    status: "completed" as GameResultStatus,
    result: {
      passed,
      overallScore,
      scenarioSuccessLevel: level,
      dimensionScores,
      strengths,
      improvements,
      emotionFlow: flow,
      narrativeHook: buildNarrativeHook({
        language: session.language ?? "ko",
        personaName: input.personaName ?? null,
        level,
        flow,
        strength: strengths[0] ?? null,
        improvement: improvements[0] ?? null,
      }),
      reportStatus: detailed.reportStatus ?? input.feedback.reportStatus ?? null,
      confidence: typeof detailed.confidence === "number" ? detailed.confidence : null,
    },
  };
}

export type GameResult = ReturnType<typeof buildGameResult>;
