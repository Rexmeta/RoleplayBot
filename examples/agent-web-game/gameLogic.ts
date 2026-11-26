import type { GameResultBody } from "../../sdk/agent-api/client";

export interface PlayerState { reputation: number; gold: number }
export type Outcome = "win" | "lose" | "neutral";

/** Decide the branch from a roleplay result. A null score/passed means "not enough data": no penalty. */
export function decideOutcome(r: Pick<GameResultBody, "passed" | "overallScore">): Outcome {
  if (r.passed === true) return "win";
  if (r.passed === false) return "lose";
  if (r.overallScore == null) return "neutral";
  return r.overallScore >= 70 ? "win" : "lose";
}

export function applyOutcome(state: PlayerState, outcome: Outcome): PlayerState {
  if (outcome === "win") return { reputation: state.reputation + 10, gold: state.gold + 20 };
  if (outcome === "lose") return { reputation: state.reputation - 5, gold: Math.max(0, state.gold - 10) };
  return { ...state };
}
