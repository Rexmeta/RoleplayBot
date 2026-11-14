import { testLimitsSchema } from "../liveAvatar/testContracts";
import { z } from "zod";

export const tavusLimitsSchema = testLimitsSchema.extend({
  // Full-pipeline capacity is controlled by the router, not the legacy
  // 120-second rendering diagnostic contract.
  sessionSeconds: z.number().int().positive(),
  creationAllowed: z.boolean().optional(),
});

/** Only locally defined reasons and numeric capacity leave this boundary. */
export function inspectTavusLimits(limits: z.infer<typeof tavusLimitsSchema>) {
  const blockers: string[] = [];
  if (!limits.workerReady) blockers.push("avatar_runtime_worker_unavailable");
  if (limits.cleanupPending > 0) blockers.push("avatar_runtime_cleanup_pending");
  if (limits.userRemainingSeconds < limits.sessionSeconds) blockers.push("avatar_runtime_user_budget_insufficient");
  if (limits.globalRemainingSeconds < limits.sessionSeconds) blockers.push("avatar_runtime_global_budget_insufficient");
  if (limits.creationAllowed === false) blockers.push("avatar_runtime_creation_blocked");
  return {
    blockers,
    limits: {
      workerReady: limits.workerReady, cleanupPending: limits.cleanupPending,
      userRemainingSeconds: limits.userRemainingSeconds,
      globalRemainingSeconds: limits.globalRemainingSeconds,
      sessionSeconds: limits.sessionSeconds, resetsAt: limits.resetsAt,
      ...(limits.creationAllowed === undefined ? {} : { creationAllowed: limits.creationAllowed }),
    },
  };
}
