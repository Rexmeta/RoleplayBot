import type { Scenario } from "@shared/schema";
import type { ScenarioTranslation } from "@shared/schema";

export type ValidationSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  check: number;
  key: string;
  severity: ValidationSeverity;
  message: string;
}

export interface ValidationResult {
  scenarioId: string;
  scenarioTitle: string;
  score: number;
  issues: ValidationIssue[];
  hasFatalErrors: boolean;
}

const KNOWN_INCIDENT_TYPES = new Set([
  'executive_join',
  'customer_escalation',
  'deadline_pressure',
  'new_evidence',
  'competitor_offer',
  'policy_constraint',
  'quality_issue',
  'manager_interrupt',
  'budget_cut',
  'compliance_warning',
]);

function detectCycle(stages: Array<{ id: string; nextStage: string }>): boolean {
  const stageIds = new Set(stages.map(s => s.id));
  const adj: Record<string, string> = {};
  for (const s of stages) {
    adj[s.id] = s.nextStage;
  }
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(id: string): boolean {
    if (inStack.has(id)) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    inStack.add(id);
    const next = adj[id];
    if (next && stageIds.has(next)) {
      if (dfs(next)) return true;
    }
    inStack.delete(id);
    return false;
  }

  for (const id of stageIds) {
    if (dfs(id)) return true;
  }
  return false;
}

function findDeadEndStages(stages: Array<{ id: string; nextStage: string }>): string[] {
  const stageIds = new Set(stages.map(s => s.id));
  // A dead-end: a reachable stage whose nextStage is not a known stage id
  // and is not a recognised terminal sentinel ('end', '', undefined)
  const TERMINAL_SENTINELS = new Set(['end', '', 'done', 'finish', 'complete']);

  // Build reachable set from first stage
  const reachable = new Set<string>();
  function traverse(id: string) {
    if (reachable.has(id)) return;
    reachable.add(id);
    const stage = stages.find(s => s.id === id);
    if (!stage) return;
    if (stageIds.has(stage.nextStage)) traverse(stage.nextStage);
  }
  if (stages.length > 0) traverse(stages[0].id);

  // Among reachable stages, find those with a nextStage that is neither a known id
  // nor a recognised terminal sentinel — these are broken pointers (dead-ends)
  const deadEnds: string[] = [];
  for (const id of reachable) {
    const stage = stages.find(s => s.id === id);
    if (!stage) continue;
    const next = stage.nextStage;
    if (!TERMINAL_SENTINELS.has(next) && !stageIds.has(next)) {
      deadEnds.push(`${id} → "${next}" (존재하지 않음)`);
    }
  }

  // Also flag unreachable stages (valid graph but isolated nodes)
  const unreachable = stages.filter(s => !reachable.has(s.id)).map(s => s.id);
  if (unreachable.length > 0) {
    deadEnds.push(`도달 불가능한 단계: ${unreachable.join(', ')}`);
  }

  return deadEnds;
}

export function validateScenario(
  scenario: Scenario,
  allMbtiPersonaIds: Set<string>,
  translations: ScenarioTranslation[],
  activeLangs: string[],
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const personas = (scenario.personas as any[]) ?? [];

  // Check ①: exactly one primary persona
  // Empty personas array is allowed during initial creation (warning, not error).
  // Error only when personas exist but none (or multiple) are marked primary.
  const primaryPersonas = personas.filter((p: any) => p.isPrimary === true);
  if (personas.length === 0) {
    issues.push({
      check: 1,
      key: 'primary_persona',
      severity: 'warning',
      message: '페르소나가 아직 추가되지 않았습니다.',
    });
  } else if (primaryPersonas.length !== 1) {
    issues.push({
      check: 1,
      key: 'primary_persona',
      severity: 'error',
      message: primaryPersonas.length === 0
        ? '주 페르소나(isPrimary)가 지정되지 않았습니다.'
        : `주 페르소나가 ${primaryPersonas.length}명 지정되어 있습니다 (1명이어야 합니다).`,
    });
  }

  // Check ②: personaRef connects to actual mbti_personas
  // Normalize ".json" suffix — frontend may append it but DB IDs are stored without it.
  const invalidRefs: string[] = [];
  for (const p of personas) {
    if (p.personaRef) {
      const normalizedRef = p.personaRef.replace(/\.json$/i, '');
      if (!allMbtiPersonaIds.has(normalizedRef) && !allMbtiPersonaIds.has(p.personaRef)) {
        invalidRefs.push(`${p.name ?? p.id}(ref: ${p.personaRef})`);
      }
    }
  }
  if (invalidRefs.length > 0) {
    issues.push({
      check: 2,
      key: 'persona_ref',
      severity: 'error',
      message: `유효하지 않은 personaRef: ${invalidRefs.join(', ')}`,
    });
  }

  // Check ③: targetTurns >= minValidTurns
  const targetTurns = scenario.targetTurns ?? 10;
  const minValidTurns = scenario.minValidTurns ?? 4;
  if (targetTurns < minValidTurns) {
    issues.push({
      check: 3,
      key: 'turns_config',
      severity: 'warning',
      message: `targetTurns(${targetTurns})이 minValidTurns(${minValidTurns})보다 작습니다.`,
    });
  }

  // Check ④: successCriteria not empty
  const sc = scenario.successCriteria as any;
  const hasSC = sc && (sc.optimal || sc.good || sc.acceptable || sc.failure);
  if (!hasSC) {
    issues.push({
      check: 4,
      key: 'success_criteria',
      severity: 'warning',
      message: '성공 기준(successCriteria)이 비어 있습니다.',
    });
  }

  // Check ⑤: objectives and evaluationHarness alignment
  const objectives = (scenario.objectives as string[]) ?? [];
  const evalHarness = scenario.evaluationHarness as any;
  const hasObjectives = objectives.length > 0;
  const hasHarness = evalHarness && (evalHarness.dimensions?.length > 0 || evalHarness.passingRule != null);
  if (hasObjectives && !hasHarness) {
    issues.push({
      check: 5,
      key: 'objectives_harness',
      severity: 'info',
      message: '목표(objectives)가 있지만 evaluationHarness가 정의되지 않아 평가 기준과 연결되지 않습니다.',
    });
  }

  // Check ⑥: triggerHints and switchRules conflict
  // Use the original persona index (not the filtered-array index) to match targetPersonaIndex
  const switchRules = scenario.personaSwitchRules as any;
  const hasSwitchRules = switchRules && Array.isArray(switchRules.rules) && switchRules.rules.length > 0;
  if (hasSwitchRules) {
    const switchTargetIndices = new Set<number>((switchRules.rules as any[]).map((r: any) => r.targetPersonaIndex));
    const conflicts: string[] = [];
    personas.forEach((p: any, originalIndex: number) => {
      if (p.triggerHints && p.triggerHints.length > 0 && switchTargetIndices.has(originalIndex)) {
        conflicts.push(p.name ?? `[${originalIndex}]`);
      }
    });
    if (conflicts.length > 0) {
      issues.push({
        check: 6,
        key: 'trigger_switch_conflict',
        severity: 'warning',
        message: `triggerHints가 있는 페르소나(${conflicts.join(', ')})가 switchRules의 전환 대상(targetPersonaIndex)이기도 합니다. 충돌 가능성을 검토하세요.`,
      });
    }
  }

  // Check ⑦: allowed incident types exist in known template
  const simHarness = scenario.simulationHarness as any;
  const allowedTypes: string[] = simHarness?.toolPolicy?.triggerIncident?.allowedTypes ?? [];
  if (allowedTypes.length > 0) {
    const unknownTypes = allowedTypes.filter((t: string) => !KNOWN_INCIDENT_TYPES.has(t));
    if (unknownTypes.length > 0) {
      issues.push({
        check: 7,
        key: 'incident_types',
        severity: 'warning',
        message: `알 수 없는 incident 타입: ${unknownTypes.join(', ')}. 지원 타입: ${[...KNOWN_INCIDENT_TYPES].join(', ')}`,
      });
    }
  }

  // Check ⑧: playerConstraints present
  const playerConstraints = scenario.playerConstraints as any;
  const hasConstraints = playerConstraints && Object.keys(playerConstraints).some(k => {
    const v = playerConstraints[k];
    return v !== undefined && v !== null && v !== '' && (!Array.isArray(v) || v.length > 0);
  });
  if (!hasConstraints) {
    issues.push({
      check: 8,
      key: 'player_constraints',
      severity: 'info',
      message: 'playerConstraints가 정의되지 않았습니다. 플레이어 행동 제약을 설정하면 더 일관된 시뮬레이션이 가능합니다.',
    });
  }

  // Check ⑨: stageRules cycle and dead-end detection
  const flowGraph = scenario.flowGraph as any;
  if (flowGraph && Array.isArray(flowGraph.stages) && flowGraph.stages.length > 0) {
    const stages = flowGraph.stages as Array<{ id: string; nextStage: string }>;
    if (detectCycle(stages)) {
      issues.push({
        check: 9,
        key: 'stage_cycle',
        severity: 'warning',
        message: 'flowGraph에 순환(cycle)이 감지되었습니다. 대화가 무한 루프에 빠질 수 있습니다.',
      });
    } else {
      const deadEnds = findDeadEndStages(stages);
      if (deadEnds.length > 0) {
        issues.push({
          check: 9,
          key: 'stage_dead_end',
          severity: 'warning',
          message: `flowGraph에 막힌 경로가 있습니다: ${deadEnds.join('; ')}`,
        });
      }
    }
  }

  // Check ⑩: sourceLocale set and translation completeness
  // Check scenario.sourceLocale directly (not with ?? fallback) to detect missing value
  const rawSourceLocale = scenario.sourceLocale;
  if (!rawSourceLocale) {
    issues.push({
      check: 10,
      key: 'source_locale',
      severity: 'info',
      message: 'sourceLocale이 설정되지 않았습니다.',
    });
  } else if (activeLangs.length > 1) {
    const translatedLocales = new Set(translations.map(t => t.locale));
    const missingLangs = activeLangs.filter(lang => lang !== rawSourceLocale && !translatedLocales.has(lang));
    if (missingLangs.length > 0) {
      issues.push({
        check: 10,
        key: 'missing_translations',
        severity: 'info',
        message: `번역이 누락된 언어: ${missingLangs.join(', ')}`,
      });
    }
  }

  // Score: 10 checks, each worth 10 points, pass = 10, fail = 0
  const NUM_CHECKS = 10;
  const checksPassed = NUM_CHECKS - new Set(issues.map(i => i.check)).size;
  const score = Math.round((checksPassed / NUM_CHECKS) * 100);

  const hasFatalErrors = issues.some(i => i.severity === 'error');

  return {
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    score,
    issues,
    hasFatalErrors,
  };
}
