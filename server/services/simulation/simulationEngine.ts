import {
  SimulationState,
  SimulationStatePatch,
  SimulationStatePatchRequest,
  NpcEmotions,
  TurnScore,
  Incident,
  ScenarioStage,
  SimulationDirective,
  createDefaultSimulationState,
  calcTurnScoreTotal,
} from './simulationTypes';
import type { FlowGraph, PersonaSwitchRules, ExitCondition, ConditionOperator, TerminationRules, TerminationConditionGroup, TerminationOutcome, DifficultyProfile, NpcBehaviorHarness, EvaluationHarness } from '../../../shared/schema/scenarios';
import { evaluatePersonaSwitchRules } from './personaSwitchEvaluator';
import { v4 as uuidv4 } from 'uuid';

const EMOTION_KEYS: Array<keyof NpcEmotions> = ['anger', 'trust', 'confusion', 'interest'];
const MAX_RECENT = 10;
const GEMINI_TOOL_MAX_DELTA_AFTER_SERVER_EVAL = 10;

function clamp(val: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, val));
}

function clampPressure(val: number): number {
  return Math.max(1, Math.min(5, val));
}

const STAGE_ORDER: ScenarioStage[] = ['intro', 'conflict', 'negotiation', 'escalation', 'resolution'];

function stageAllowed(current: ScenarioStage, target: ScenarioStage): boolean {
  const ci = STAGE_ORDER.indexOf(current);
  const ti = STAGE_ORDER.indexOf(target);
  if (ti < 0) return false;
  return ti >= ci;
}

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

function evaluateExitCondition(cond: ExitCondition, state: SimulationState): boolean {
  let actual: number;
  if (cond.type === 'turn_count') {
    actual = state.summary.totalTurns;
  } else if (cond.type === 'turn_score') {
    const window = cond.windowTurns
      ? state.recentTurnScores.slice(-cond.windowTurns)
      : state.recentTurnScores;
    if (window.length === 0) return false;
    const key = (cond.metric || 'total') as keyof TurnScore;
    const vals = window.map(ts => {
      const v = ts[key];
      return typeof v === 'number' ? v : 0;
    });
    actual = vals.reduce((a, b) => a + b, 0) / vals.length;
  } else if (cond.type === 'npc_emotion') {
    const key = (cond.metric || 'anger') as keyof NpcEmotions;
    actual = state.npcEmotions[key] ?? 0;
  } else {
    return false;
  }
  return compareOp(actual, cond.operator, cond.value);
}

export function evaluateFlowGraph(state: SimulationState, flowGraph: FlowGraph): ScenarioStage | null {
  const currentStageId = state.stage;
  const stageDef = flowGraph.stages.find(s => s.id === currentStageId);
  if (!stageDef) return null;

  const conditions = stageDef.exitConditions ?? [];
  if (conditions.length === 0) return null;

  const logic = stageDef.exitConditionsLogic ?? 'all';
  const results = conditions.map(c => evaluateExitCondition(c, state));
  const triggered = logic === 'any' ? results.some(Boolean) : results.every(Boolean);
  if (!triggered) return null;

  const nextStage = stageDef.nextStage as ScenarioStage;
  if (!stageAllowed(currentStageId, nextStage)) return null;

  return nextStage;
}

export interface PatchContext {
  turnId: string;
  serverEvalAppliedEmotionDelta?: Partial<Record<keyof NpcEmotions, number>>;
}

interface InternalSession {
  simulationState: SimulationState;
  patchContextByTurn: Map<string, { serverEvalEmotionDelta: Partial<Record<keyof NpcEmotions, number>> }>;
  globalIncidentCooldownUntil: number;
  incidentTypeCooldowns: Map<string, number>;
  allTimeTurnScoreSum: number;
  allTimeTurnScoreCount: number;
  flowGraph?: FlowGraph;
  personaSwitchRules?: PersonaSwitchRules;
  terminationRules?: TerminationRules;
  lockedPersonaIndices: Set<number>;
  consecutiveSwitchCounts: Map<string, number>;
  difficultyProfile?: DifficultyProfile;
  npcBehaviorHarness?: NpcBehaviorHarness;
  /** Stored by harnessReader so callers can retrieve it without passing it through every function */
  evaluationHarness?: EvaluationHarness;
}

const sessionContexts = new Map<string, InternalSession>();

export function getOrCreateSessionContext(personaRunId: string, state?: SimulationState): InternalSession {
  if (!sessionContexts.has(personaRunId)) {
    const initState = state ?? createDefaultSimulationState();
    const acc = initState.scoreAccumulator;
    const existingScored = initState.recentTurnScores.filter(ts => ts.total > 0);
    sessionContexts.set(personaRunId, {
      simulationState: initState,
      patchContextByTurn: new Map(),
      globalIncidentCooldownUntil: 0,
      incidentTypeCooldowns: new Map(),
      allTimeTurnScoreSum: acc?.sum ?? existingScored.reduce((s, ts) => s + ts.total, 0),
      allTimeTurnScoreCount: acc?.count ?? existingScored.length,
      lockedPersonaIndices: new Set(),
      consecutiveSwitchCounts: new Map(),
    });
  }
  const ctx = sessionContexts.get(personaRunId)!;
  if (state && ctx.simulationState.version < state.version) {
    ctx.simulationState = state;
    // Re-hydrate accumulators from the persisted scoreAccumulator when the incoming state
    // represents more scored turns than the in-memory counters. This covers the server-restart
    // scenario where a context was first created without a state (e.g. by applyHarnessToSession)
    // and then setSessionState is called with the DB-loaded state.
    if (state.scoreAccumulator && state.scoreAccumulator.count > ctx.allTimeTurnScoreCount) {
      ctx.allTimeTurnScoreSum = state.scoreAccumulator.sum;
      ctx.allTimeTurnScoreCount = state.scoreAccumulator.count;
    }
  }
  return ctx;
}

export function setSessionFlowConfig(
  personaRunId: string,
  flowGraph?: FlowGraph | null,
  personaSwitchRules?: PersonaSwitchRules | null
): void {
  const ctx = getOrCreateSessionContext(personaRunId);
  if (flowGraph) ctx.flowGraph = flowGraph;
  if (personaSwitchRules) ctx.personaSwitchRules = personaSwitchRules;
}

export function setSessionTerminationRules(
  personaRunId: string,
  terminationRules: TerminationRules | null | undefined
): void {
  const ctx = getOrCreateSessionContext(personaRunId);
  if (terminationRules) ctx.terminationRules = terminationRules;
}

export function setSessionHarnessConfig(
  personaRunId: string,
  difficultyProfile?: DifficultyProfile | null,
  npcBehaviorHarness?: NpcBehaviorHarness | null
): void {
  const ctx = getOrCreateSessionContext(personaRunId);
  if (difficultyProfile) ctx.difficultyProfile = difficultyProfile;
  if (npcBehaviorHarness) ctx.npcBehaviorHarness = npcBehaviorHarness;
}

export function getSessionHarnessConfig(personaRunId: string): {
  difficultyProfile?: DifficultyProfile;
  npcBehaviorHarness?: NpcBehaviorHarness;
} {
  const ctx = sessionContexts.get(personaRunId);
  return {
    difficultyProfile: ctx?.difficultyProfile,
    npcBehaviorHarness: ctx?.npcBehaviorHarness,
  };
}

export function setSessionEvaluationHarness(
  personaRunId: string,
  evaluationHarness: EvaluationHarness | null | undefined
): void {
  const ctx = getOrCreateSessionContext(personaRunId);
  if (evaluationHarness) ctx.evaluationHarness = evaluationHarness;
}

export function getSessionEvaluationHarness(personaRunId: string): EvaluationHarness | undefined {
  return sessionContexts.get(personaRunId)?.evaluationHarness;
}

export function getSessionFlowGraph(personaRunId: string): import('../../../shared/schema/scenarios').FlowGraph | undefined {
  return sessionContexts.get(personaRunId)?.flowGraph;
}

function checkTerminationConditionGroup(
  group: TerminationConditionGroup,
  state: SimulationState
): boolean {
  const results: boolean[] = [];
  const logic = group.logic ?? 'all';

  if (group.npcEmotions) {
    for (const [key, cond] of Object.entries(group.npcEmotions)) {
      if (!cond) continue;
      const actual = state.npcEmotions[key as keyof NpcEmotions] ?? 0;
      results.push(compareOp(actual, cond.operator, cond.value));
    }
  }
  if (group.currentScore !== undefined) {
    results.push(compareOp(state.currentScore, group.currentScore.operator, group.currentScore.value));
  }
  if (group.stage !== undefined) {
    results.push(state.stage === group.stage);
  }
  if (group.totalTurns !== undefined) {
    results.push(compareOp(state.summary.totalTurns, group.totalTurns.operator, group.totalTurns.value));
  }
  if (group.consecutiveTurnsBelow !== undefined) {
    const { scoreThreshold, turns } = group.consecutiveTurnsBelow;
    const recent = state.recentTurnScores.slice(-turns);
    if (recent.length >= turns) {
      const allBelow = recent.every(ts => ts.total < scoreThreshold);
      results.push(allBelow);
    } else {
      results.push(false);
    }
  }

  if (results.length === 0) return false;
  return logic === 'any' ? results.some(Boolean) : results.every(Boolean);
}

export function evaluateTerminationRules(
  state: SimulationState,
  rules: TerminationRules
): TerminationOutcome | null {
  if (state.terminationReason) return null;

  if (rules.success && checkTerminationConditionGroup(rules.success, state)) {
    return 'success';
  }
  if (rules.failure && checkTerminationConditionGroup(rules.failure, state)) {
    return 'failure';
  }
  if (rules.timeout) {
    const { maxTurns, maxTimeSec } = rules.timeout;
    if (maxTurns !== undefined && state.summary.totalTurns >= maxTurns) {
      return 'timeout';
    }
    if (maxTimeSec !== undefined && state.timer.enabled && state.timer.elapsedSec >= maxTimeSec) {
      return 'timeout';
    }
  }
  return null;
}

export function clearSessionContext(personaRunId: string): void {
  sessionContexts.delete(personaRunId);
}

export function applySimulationPatch(
  personaRunId: string,
  request: SimulationStatePatchRequest
): SimulationState {
  const ctx = getOrCreateSessionContext(personaRunId);
  const prev = ctx.simulationState;
  const patch = request.patch;
  const turnId = request.turnId;

  const newEmotions = { ...prev.npcEmotions };

  if (patch.npcEmotionDelta) {
    let turnCtx = ctx.patchContextByTurn.get(turnId);

    if (request.source === 'server_evaluation') {
      for (const key of EMOTION_KEYS) {
        const delta = patch.npcEmotionDelta[key];
        if (delta !== undefined) {
          newEmotions[key] = clamp(newEmotions[key] + delta);
        }
      }
      if (!turnCtx) {
        turnCtx = { serverEvalEmotionDelta: {} };
        ctx.patchContextByTurn.set(turnId, turnCtx);
      }
      for (const key of EMOTION_KEYS) {
        const delta = patch.npcEmotionDelta[key];
        if (delta !== undefined) {
          turnCtx.serverEvalEmotionDelta[key] = (turnCtx.serverEvalEmotionDelta[key] ?? 0) + delta;
        }
      }
    } else if (request.source === 'gemini_tool') {
      const prevServerEvalDelta = turnCtx?.serverEvalEmotionDelta ?? {};
      for (const key of EMOTION_KEYS) {
        const rawDelta = patch.npcEmotionDelta[key];
        if (rawDelta !== undefined) {
          const alreadyMoved = prevServerEvalDelta[key] ?? 0;
          const signedCap = rawDelta > 0
            ? Math.min(rawDelta, GEMINI_TOOL_MAX_DELTA_AFTER_SERVER_EVAL)
            : Math.max(rawDelta, -GEMINI_TOOL_MAX_DELTA_AFTER_SERVER_EVAL);
          const effectiveDelta = alreadyMoved !== 0 ? signedCap : rawDelta;
          newEmotions[key] = clamp(newEmotions[key] + effectiveDelta);
        }
      }
    } else {
      for (const key of EMOTION_KEYS) {
        const delta = patch.npcEmotionDelta[key];
        if (delta !== undefined) {
          newEmotions[key] = clamp(newEmotions[key] + delta);
        }
      }
    }
  }

  let newStage = prev.stage;
  if (patch.targetStage && stageAllowed(prev.stage, patch.targetStage)) {
    newStage = patch.targetStage;
  }

  let newPressure = prev.pressureLevel;
  if (patch.pressureDelta !== undefined && patch.pressureDelta !== 0) {
    const limited = patch.pressureDelta > 0 ? 1 : -1;
    newPressure = clampPressure(newPressure + limited);
  }

  let newTimer = { ...prev.timer };
  if (patch.timerDelta?.elapsedSecDelta !== undefined) {
    newTimer.elapsedSec = Math.max(0, newTimer.elapsedSec + patch.timerDelta.elapsedSecDelta);
  }

  const newIncidents = [...prev.recentIncidents];
  if (patch.incidentsToAdd && patch.incidentsToAdd.length > 0) {
    for (const inc of patch.incidentsToAdd) {
      newIncidents.push(inc);
    }
  }
  const trimmedIncidents = newIncidents.slice(-MAX_RECENT);

  const currentTotalTurns = prev.summary.totalTurns + (patch.turnScoresToAdd?.length ?? 0);
  const survivingDirectives: SimulationDirective[] = (prev.simulationDirectives ?? [])
    .filter(d => !d.expiresAtTurnIndex || d.expiresAtTurnIndex > currentTotalTurns);
  if (patch.directivesToAdd && patch.directivesToAdd.length > 0) {
    for (const d of patch.directivesToAdd) {
      const dupIdx = survivingDirectives.findIndex(x => x.id === d.id || x.instruction === d.instruction);
      if (dupIdx !== -1) {
        survivingDirectives[dupIdx] = { ...survivingDirectives[dupIdx], ...d };
      } else {
        survivingDirectives.push(d);
      }
    }
  }
  const newDirectives = survivingDirectives.slice(-3);

  const newTurnScores = [...prev.recentTurnScores];
  if (patch.turnScoresToAdd && patch.turnScoresToAdd.length > 0) {
    for (const ts of patch.turnScoresToAdd) {
      if (ts.total > 0) {
        ctx.allTimeTurnScoreSum += ts.total;
        ctx.allTimeTurnScoreCount += 1;
      }
      newTurnScores.push(ts);
    }
  }
  const trimmedTurnScores = newTurnScores.slice(-MAX_RECENT);

  const currentScore = ctx.allTimeTurnScoreCount > 0
    ? Math.round(ctx.allTimeTurnScoreSum / ctx.allTimeTurnScoreCount)
    : prev.currentScore;

  const maxAnger = Math.max(prev.summary.maxAnger, newEmotions.anger);
  const minTrust = Math.min(prev.summary.minTrust, newEmotions.trust);
  const totalIncidents = prev.summary.totalIncidents + (patch.incidentsToAdd?.length ?? 0);
  const totalTurns = prev.summary.totalTurns + (patch.turnScoresToAdd?.length ?? 0);

  const intermediateState: SimulationState = {
    version: prev.version + 1,
    stage: newStage,
    pressureLevel: newPressure,
    npcEmotions: newEmotions,
    timer: newTimer,
    currentScore,
    recentTurnScores: trimmedTurnScores,
    recentIncidents: trimmedIncidents,
    simulationDirectives: newDirectives,
    scoreAccumulator: { sum: ctx.allTimeTurnScoreSum, count: ctx.allTimeTurnScoreCount },
    summary: {
      totalTurns,
      totalIncidents,
      averageScore: ctx.allTimeTurnScoreCount > 0
        ? Math.round(ctx.allTimeTurnScoreSum / ctx.allTimeTurnScoreCount)
        : prev.summary.averageScore,
      maxAnger,
      minTrust,
    },
  };

  let finalStage = intermediateState.stage;
  const extraDirectives: SimulationDirective[] = [];
  let serverRulePersonaSwitch: SimulationState['serverRulePersonaSwitch'] = undefined;

  if (ctx.flowGraph) {
    const nextStage = evaluateFlowGraph(intermediateState, ctx.flowGraph);
    if (nextStage && nextStage !== finalStage) {
      console.log(`[simulationEngine] flowGraph: stage transition ${finalStage} → ${nextStage} (turn=${totalTurns})`);
      finalStage = nextStage;

      const stageDef = ctx.flowGraph.stages.find(s => s.id === nextStage);
      if (stageDef?.goal) {
        extraDirectives.push({
          id: `flow-stage-${nextStage}-${totalTurns}`,
          createdTurnIndex: totalTurns,
          expiresAtTurnIndex: totalTurns + 5,
          instruction: `[STAGE TRANSITION] Now entering "${nextStage}" stage. Your goal: ${stageDef.goal}`,
          source: 'server_rule',
        });
      }
    }
  }

  if (ctx.personaSwitchRules) {
    const stateForEval = { ...intermediateState, stage: finalStage };
    const switchResult = evaluatePersonaSwitchRules(
      stateForEval,
      ctx.personaSwitchRules,
      ctx.lockedPersonaIndices,
      ctx.consecutiveSwitchCounts
    );
    if (switchResult) {
      console.log(`[simulationEngine] personaSwitchRules: switch to persona[${switchResult.targetPersonaIndex}] triggered (rule=${switchResult.ruleId})`);
      serverRulePersonaSwitch = {
        targetPersonaIndex: switchResult.targetPersonaIndex,
        reason: switchResult.reason,
      };
      if (switchResult.lockAfterSwitch) {
        ctx.lockedPersonaIndices.add(switchResult.targetPersonaIndex);
      }
      extraDirectives.push({
        id: `persona-switch-rule-${switchResult.ruleId}-${totalTurns}`,
        createdTurnIndex: totalTurns,
        expiresAtTurnIndex: totalTurns + 2,
        instruction: `[SERVER RULE] Switch to persona index ${switchResult.targetPersonaIndex}. Reason: ${switchResult.reason}`,
        source: 'server_rule',
      });
    }
  }

  let finalDirectives = [...intermediateState.simulationDirectives];
  if (extraDirectives.length > 0) {
    for (const d of extraDirectives) {
      const dupIdx = finalDirectives.findIndex(x => x.id === d.id);
      if (dupIdx !== -1) {
        finalDirectives[dupIdx] = d;
      } else {
        finalDirectives.push(d);
      }
    }
    finalDirectives = finalDirectives.slice(-3);
  }

  // Resolve the current stage goal: use the new stage's goal if a transition fired, else keep the existing one.
  let currentStageGoal: string | undefined = intermediateState.currentStageGoal;
  if (ctx.flowGraph && finalStage !== intermediateState.stage) {
    const stageDef = ctx.flowGraph.stages.find(s => s.id === finalStage);
    if (stageDef?.goal) currentStageGoal = stageDef.goal;
  }

  let terminationReason: SimulationState['terminationReason'] = intermediateState.terminationReason;
  if (!terminationReason && ctx.terminationRules) {
    const outcome = evaluateTerminationRules(
      { ...intermediateState, stage: finalStage },
      ctx.terminationRules
    );
    if (outcome) {
      console.log(`[simulationEngine] terminationRules: outcome="${outcome}" at turn=${totalTurns}`);
      terminationReason = outcome;
    }
  }

  const newState: SimulationState = {
    ...intermediateState,
    stage: finalStage,
    simulationDirectives: finalDirectives,
    ...(serverRulePersonaSwitch ? { serverRulePersonaSwitch } : {}),
    ...(currentStageGoal !== undefined ? { currentStageGoal } : {}),
    ...(terminationReason ? { terminationReason } : {}),
  };

  ctx.simulationState = newState;
  return newState;
}

export function checkIncidentCooldown(
  personaRunId: string,
  incidentType: string,
  now = Date.now()
): { allowed: boolean; reason?: string } {
  const ctx = getOrCreateSessionContext(personaRunId);

  if (now < ctx.globalIncidentCooldownUntil) {
    const remaining = Math.ceil((ctx.globalIncidentCooldownUntil - now) / 1000);
    return { allowed: false, reason: `Global cooldown: ${remaining}s remaining` };
  }

  const typeCooldown = ctx.incidentTypeCooldowns.get(incidentType) ?? 0;
  if (now < typeCooldown) {
    const remaining = Math.ceil((typeCooldown - now) / 1000);
    return { allowed: false, reason: `Type cooldown for ${incidentType}: ${remaining}s remaining` };
  }

  return { allowed: true };
}

export function recordIncidentCooldown(
  personaRunId: string,
  incidentType: string,
  now = Date.now(),
  globalCooldownMs = 60_000,
  perTypeCooldownMs = 120_000
): void {
  const ctx = getOrCreateSessionContext(personaRunId);
  ctx.globalIncidentCooldownUntil = now + globalCooldownMs;
  ctx.incidentTypeCooldowns.set(incidentType, now + perTypeCooldownMs);
}

export function getSessionState(personaRunId: string): SimulationState | null {
  return sessionContexts.get(personaRunId)?.simulationState ?? null;
}

export function setSessionState(personaRunId: string, state: SimulationState): void {
  const ctx = getOrCreateSessionContext(personaRunId, state);
  ctx.simulationState = state;
}

export { calcTurnScoreTotal };
