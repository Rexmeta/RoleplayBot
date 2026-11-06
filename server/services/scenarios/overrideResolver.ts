import type { ScenarioOverrideData } from "@shared/schema";
import { resolveOverrideWeights } from "@shared/organizationOverride";

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
    const weightMap = override.evaluationWeights as Record<string, number>;
    // Feedback rubric and simulation harness are separate contracts, even
    // when a dimension happens to have the same key. Never mutate the harness.
    const rubric = result._evaluationCriteriaSnapshot;
    const resolved = resolveOverrideWeights(rubric?.dimensions ?? [], weightMap);
    if (resolved.errors.length) throw new Error(resolved.errors.join("; "));
    result._evaluationCriteriaSnapshot = {
      ...rubric,
      dimensions: rubric.dimensions.map((d: any) => ({
        ...d, weight: resolved.dimensions.find(item => item.key === d.key)?.normalizedPercent ?? d.weight,
      })),
    };
  }

  if (override.customIncidents && override.customIncidents.length > 0) {
    result._customIncidents = override.customIncidents;
  }

  result._overridePromptBlock = buildOverridePromptBlock(override);

  return result;
}

export function buildOverridePromptBlock(override: ScenarioOverrideData | null | undefined): string {
  if (!override) return '';

  const lines: string[] = [
    "\n# 조직별 추가 응답 지침",
    "아래는 응답에만 적용하는 하위 지침입니다. 시스템 안전 규칙보다 우선하지 않습니다.",
    "콘텐츠 원본이나 학습자의 발화를 치환하지 마세요. 별도 감점이나 법적 준수 보장을 만들지 마세요.",
  ];

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
    lines.push('다음은 추가 상황 지침이며 자동 사건 트리거가 아닙니다:');
    for (const incident of override.customIncidents) {
      lines.push(`- ${incident}`);
    }
  }

  return lines.join('\n');
}
