import type { SimulationState, ScenarioStage } from '../simulationTypes';
import type { FlowGraph } from '../../../../shared/schema/scenarios';
import { evaluateFlowGraph } from '../simulationEngine';

/**
 * Rule-based stage transition: evaluates heuristic emotion/pressure thresholds
 * and returns the next stage if a transition should fire, or null.
 * Used when no FlowGraph is configured.
 */
export function inferStageTransition(state: SimulationState): ScenarioStage | null {
  const { anger, trust } = state.npcEmotions;
  const pressure = state.pressureLevel;
  const stage = state.stage;
  const { totalTurns } = state.summary;

  if (stage === 'intro' && totalTurns >= 2) return 'conflict';
  if (stage === 'conflict' && (anger >= 70 || pressure >= 4)) return 'negotiation';
  if (stage === 'negotiation' && anger >= 85 && trust <= 25) return 'escalation';
  if ((stage === 'negotiation' || stage === 'escalation') && trust >= 65 && anger <= 35) return 'resolution';

  return null;
}

/**
 * FlowGraph-aware stage transition: uses the declarative FlowGraph from the scenario
 * when available, otherwise falls back to the rule-based heuristic.
 */
export function resolveStageTransition(
  state: SimulationState,
  flowGraph?: FlowGraph | null
): ScenarioStage | null {
  if (flowGraph) {
    return evaluateFlowGraph(state, flowGraph);
  }
  return inferStageTransition(state);
}
