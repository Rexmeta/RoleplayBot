import type { ScenarioOverrideData } from "./schema/scenarios";

export const ORGANIZATION_OVERRIDE_KEY = "_organizationOverride";
export type OverrideDimension = { key: string; name?: string; weight: number; isActive?: boolean };
export function isOrganizationOverrideEmpty(value: ScenarioOverrideData): boolean {
  return Object.values(value).every(field => !field || Object.keys(field).length === 0);
}

/** Relative weight input, NOT percentage points. Unspecified ratios stay intact. */
export function resolveOverrideWeights(dimensions: OverrideDimension[], weights: Record<string, number> = {}) {
  const active = dimensions.filter(d => d.isActive !== false);
  const errors: string[] = [];
  const keys = new Set(active.map(d => d.key));
  for (const key of Object.keys(weights)) {
    if (!keys.has(key)) errors.push(`적용 불가 평가항목: ${key}`);
  }
  // Rubric weights are percentages; present/input all defaults on the 0–10 scale.
  const max = Math.max(0, ...active.map(d => d.weight));
  const divisor = max > 10 ? 10 : 1;
  const effective = active.map(d => ({
    key: d.key, name: d.name ?? d.key,
    baseWeight: d.weight / divisor,
    weight: weights[d.key] ?? d.weight / divisor,
    normalizedPercent: 0,
  }));
  const total = effective.reduce((sum, d) => sum + d.weight, 0);
  if (effective.length && (!Number.isFinite(total) || total <= 0)) errors.push("최종 평가 가중치 합계는 0보다 커야 합니다");
  return { dimensions: effective.map(d => ({ ...d, normalizedPercent: total > 0 ? d.weight / total * 100 : 0 })), errors };
}
