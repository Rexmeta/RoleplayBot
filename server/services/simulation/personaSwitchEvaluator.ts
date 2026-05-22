import type { PersonaSwitchRules, SwitchCondition, SwitchRule, ConditionOperator } from '../../../shared/schema/scenarios';
import type { SimulationState, NpcEmotions, TurnScore } from './simulationTypes';

function compareOp(actual: number, operator: ConditionOperator, value: number): boolean {
  switch (operator) {
    case 'gte': return actual >= value;
    case 'lte': return actual <= value;
    case 'gt':  return actual > value;
    case 'lt':  return actual < value;
    case 'eq':  return actual === value;
    default:    return false;
  }
}

function resolveMetric(metric: string, state: SimulationState): number {
  const parts = metric.split('.');
  if (parts[0] === 'npcEmotions' && parts[1]) {
    const key = parts[1] as keyof NpcEmotions;
    return state.npcEmotions[key] ?? 0;
  }
  if (parts[0] === 'turnScores' && parts[1]) {
    const recent = state.recentTurnScores;
    if (recent.length === 0) return 0;
    const last = recent[recent.length - 1];
    const key = parts[1] as keyof TurnScore;
    const val = last[key];
    return typeof val === 'number' ? val : 0;
  }
  if (metric === 'pressureLevel') return state.pressureLevel;
  if (metric === 'currentScore') return state.currentScore;
  if (metric === 'totalTurns') return state.summary.totalTurns;
  return 0;
}

function conditionMet(cond: SwitchCondition, state: SimulationState): boolean {
  const actual = resolveMetric(cond.metric, state);
  return compareOp(actual, cond.operator, cond.value);
}

export interface PersonaSwitchResult {
  targetPersonaIndex: number;
  reason: string;
  ruleId: string;
  lockAfterSwitch: boolean;
}

export function evaluatePersonaSwitchRules(
  state: SimulationState,
  rules: PersonaSwitchRules,
  lockedPersonaIndices: Set<number>,
  consecutiveCounts: Map<string, number>
): PersonaSwitchResult | null {
  for (const rule of rules.rules) {
    if (lockedPersonaIndices.has(rule.targetPersonaIndex)) {
      continue;
    }

    const allMet = rule.conditions.every(cond => conditionMet(cond, state));

    if (allMet) {
      const maxConsecutive = rule.conditions.reduce((max, c) => {
        return c.consecutiveTurns && c.consecutiveTurns > max ? c.consecutiveTurns : max;
      }, 1);

      if (maxConsecutive > 1) {
        const current = (consecutiveCounts.get(rule.id) ?? 0) + 1;
        consecutiveCounts.set(rule.id, current);
        if (current < maxConsecutive) {
          continue;
        }
      }

      consecutiveCounts.set(rule.id, 0);

      return {
        targetPersonaIndex: rule.targetPersonaIndex,
        reason: rule.reason,
        ruleId: rule.id,
        lockAfterSwitch: rule.lockAfterSwitch ?? false,
      };
    } else {
      consecutiveCounts.set(rule.id, 0);
    }
  }
  return null;
}
