/**
 * Declarative Harness Reader
 *
 * Reads `flowGraph`, `evaluationHarness`, `terminationRules`, and
 * `npcBehaviorHarness` from a scenario/run object and feeds them into the
 * server engine so that rules are evaluated server-side rather than embedded
 * in the prompt text.
 */
import type {
  FlowGraph,
  EvaluationHarness,
  TerminationRules,
  NpcBehaviorHarness,
  DifficultyProfile,
  PersonaSwitchRules,
  SimulationHarness,
  PlayerConstraints,
} from '../../../shared/schema/scenarios';
import {
  setSessionFlowConfig,
  setSessionTerminationRules,
  setSessionHarnessConfig,
  setSessionEvaluationHarness,
} from './simulationEngine';

/**
 * All declarative harness fields extracted from a scenario.
 * These fields drive server-side rule evaluation; they are NOT injected
 * verbatim into the AI system prompt.
 */
export interface ScenarioHarnessConfig {
  flowGraph?: FlowGraph | null;
  evaluationHarness?: EvaluationHarness | null;
  terminationRules?: TerminationRules | null;
  npcBehaviorHarness?: NpcBehaviorHarness | null;
  difficultyProfile?: DifficultyProfile | null;
  personaSwitchRules?: PersonaSwitchRules | null;
  simulationHarness?: SimulationHarness | null;
  playerConstraints?: PlayerConstraints | null;
}

/**
 * Extracts declarative harness fields from a raw scenario/persona run object.
 * Handles both camelCase and snake_case field names for flexibility.
 */
export function readScenarioHarness(scenario: Record<string, any>): ScenarioHarnessConfig {
  return {
    flowGraph: scenario.flowGraph ?? scenario.flow_graph ?? null,
    evaluationHarness: scenario.evaluationHarness ?? scenario.evaluation_harness ?? null,
    terminationRules: scenario.terminationRules ?? scenario.termination_rules ?? null,
    npcBehaviorHarness: scenario.npcBehaviorHarness ?? scenario.npc_behavior_harness ?? null,
    difficultyProfile: scenario.difficultyProfile ?? scenario.difficulty_profile ?? null,
    personaSwitchRules: scenario.personaSwitchRules ?? scenario.persona_switch_rules ?? null,
    simulationHarness: scenario.simulationHarness ?? scenario.simulation_harness ?? null,
    playerConstraints: scenario.playerConstraints ?? scenario.player_constraints ?? null,
  };
}

/**
 * Registers all declarative harness fields with the engine for a given session.
 * Call once at session initialisation (before the first turn).
 */
export function applyHarnessToSession(
  personaRunId: string,
  config: ScenarioHarnessConfig
): void {
  setSessionFlowConfig(
    personaRunId,
    config.flowGraph ?? null,
    config.personaSwitchRules ?? null
  );

  setSessionTerminationRules(
    personaRunId,
    config.terminationRules ?? null
  );

  setSessionHarnessConfig(
    personaRunId,
    config.difficultyProfile ?? null,
    config.npcBehaviorHarness ?? null
  );

  // Store evaluationHarness in the engine so per-turn evaluation can retrieve it
  // without it needing to be threaded through every call site manually.
  if (config.evaluationHarness) {
    setSessionEvaluationHarness(personaRunId, config.evaluationHarness);
  }
}

/**
 * Convenience: extract and apply harness in one call.
 */
export function initSessionHarness(
  personaRunId: string,
  scenario: Record<string, any>
): ScenarioHarnessConfig {
  const config = readScenarioHarness(scenario);
  applyHarnessToSession(personaRunId, config);
  return config;
}
