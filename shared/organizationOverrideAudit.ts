import type { ScenarioOverrideData } from "./schema/scenarios";

export const overrideAuditActions = ["scenario_override_saved", "scenario_override_deleted"] as const;
const fields = ["terminology", "policyConstraints", "forbiddenPhrases", "customIncidents", "evaluationWeights"] as const;
export type OverrideAuditSummary = {
  configured: boolean;
  counts: Record<typeof fields[number], number>;
  evaluationWeights: Record<string, number>;
};
export type OverrideAuditMetadata = {
  version: 1;
  before: OverrideAuditSummary;
  after: OverrideAuditSummary;
  changedFields: string[];
};
export type OverrideAuditEntry = {
  id: string;
  actorUserId: string | null;
  actorName: string | null;
  organizationId: string | null;
  action: string;
  targetId: string | null;
  createdAt: string;
  metadata: OverrideAuditMetadata;
};

/** Do not copy free-form instructions or terminology (which may contain PII). */
export function summarizeOverrideChange(before: ScenarioOverrideData | null, after: ScenarioOverrideData | null): OverrideAuditMetadata {
  const summary = (value: ScenarioOverrideData | null): OverrideAuditSummary => ({
    configured: value !== null,
    counts: Object.fromEntries(fields.map(field => [field, Object.keys(value?.[field] ?? {}).length])) as OverrideAuditSummary["counts"],
    // Legacy rows may predate the current input schema; never echo arbitrary keys.
    evaluationWeights: Object.fromEntries(Object.entries(value?.evaluationWeights ?? {})
      .filter(([key, weight]) => /^[a-zA-Z][a-zA-Z0-9_-]{0,99}$/.test(key) && typeof weight === "number" && Number.isFinite(weight))),
  });
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return JSON.stringify(value);
    return JSON.stringify(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  };
  return {
    version: 1, before: summary(before), after: summary(after),
    changedFields: fields.filter(field => canonical(before?.[field]) !== canonical(after?.[field])),
  };
}
