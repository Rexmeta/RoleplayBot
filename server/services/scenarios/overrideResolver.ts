import type { ScenarioOverrideData } from "@shared/schema";

export function applyScenarioOverride(scenario: any, override: ScenarioOverrideData | null | undefined): any {
  if (!override) return scenario;

  const result = { ...scenario };

  if (override.terminology && Object.keys(override.terminology).length > 0) {
    result._terminology = override.terminology;
  }

  if (override.policyConstraints && override.policyConstraints.length > 0) {
    result._policyConstraints = override.policyConstraints;
  }

  if (override.forbiddenPhrases && override.forbiddenPhrases.length > 0) {
    result._forbiddenPhrases = override.forbiddenPhrases;
  }

  if (override.evaluationWeights && Object.keys(override.evaluationWeights).length > 0) {
    const existing = result.evaluationHarness ?? {};
    const existingDimensions: any[] = existing.dimensions ?? [];
    const weightMap = override.evaluationWeights as Record<string, number>;
    const mergedDimensions = existingDimensions.map((d: any) => {
      if (weightMap[d.key] !== undefined) {
        return { ...d, weight: weightMap[d.key] };
      }
      return d;
    });
    const overriddenKeys = new Set(mergedDimensions.map((d: any) => d.key));
    const addedDimensions = Object.entries(weightMap)
      .filter(([key]) => !overriddenKeys.has(key))
      .map(([key, weight]) => ({ key, weight }));
    result.evaluationHarness = {
      ...existing,
      dimensions: [...mergedDimensions, ...addedDimensions],
    };
  }

  if (override.customIncidents && override.customIncidents.length > 0) {
    result._customIncidents = override.customIncidents;
  }

  result._overridePromptBlock = buildOverridePromptBlock(override);

  return result;
}

export function applyEvalWeightsOverride(
  harness: Record<string, unknown>,
  evaluationWeights: Record<string, number>
): Record<string, unknown> {
  if (!harness || !evaluationWeights || Object.keys(evaluationWeights).length === 0) return harness;
  const dims = (harness as any).dimensions;
  if (!Array.isArray(dims)) return harness;
  return {
    ...harness,
    dimensions: dims.map((d: any) => {
      const key = d.key ?? d.id;
      return (key !== undefined && evaluationWeights[key] !== undefined)
        ? { ...d, weight: evaluationWeights[key] }
        : d;
    }),
  };
}

export function buildOverridePromptBlock(override: ScenarioOverrideData | null | undefined): string {
  if (!override) return '';

  const lines: string[] = [];

  if (override.terminology && Object.keys(override.terminology).length > 0) {
    lines.push('\n# 조직별 용어 지침 (Organization Terminology)');
    lines.push('이 조직에서는 다음 용어를 사용합니다:');
    for (const [original, replacement] of Object.entries(override.terminology)) {
      lines.push(`- "${original}" → "${replacement}"`);
    }
  }

  if (override.policyConstraints && override.policyConstraints.length > 0) {
    lines.push('\n# 조직별 정책 제약 (Policy Constraints)');
    lines.push('이 조직의 정책에 따라 다음 사항을 반드시 준수하세요:');
    for (const constraint of override.policyConstraints) {
      lines.push(`- ${constraint}`);
    }
  }

  if (override.forbiddenPhrases && override.forbiddenPhrases.length > 0) {
    lines.push('\n# 금지 표현 (Forbidden Phrases)');
    lines.push('다음 표현은 절대 사용하지 마세요:');
    for (const phrase of override.forbiddenPhrases) {
      lines.push(`- "${phrase}"`);
    }
  }

  if (override.customIncidents && override.customIncidents.length > 0) {
    lines.push('\n# 커스텀 인시던트 (Custom Incidents)');
    lines.push('적절한 상황에서 다음 인시던트를 활용할 수 있습니다:');
    for (const incident of override.customIncidents) {
      lines.push(`- ${incident}`);
    }
  }

  return lines.join('\n');
}
