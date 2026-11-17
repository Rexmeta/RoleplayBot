/** Scenario goals are capped for live avatars, independently of billing. */
export const LIVE_AVATAR_MAX_SECONDS = 10 * 60;

export function liveAvatarDurationSeconds(targetMinutes?: number | null): number {
  if (typeof targetMinutes !== "number" || !Number.isFinite(targetMinutes) || targetMinutes <= 0) {
    return LIVE_AVATAR_MAX_SECONDS;
  }
  return Math.max(1, Math.min(LIVE_AVATAR_MAX_SECONDS, Math.round(targetMinutes * 60)));
}

/** Never extend the router/provider's independently enforced deadline. */
export function liveAvatarDeadline(routerExpiresAt: string, scenarioDeadlineAt?: string): string {
  return scenarioDeadlineAt && Date.parse(scenarioDeadlineAt) < Date.parse(routerExpiresAt)
    ? scenarioDeadlineAt : routerExpiresAt;
}
