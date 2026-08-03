import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import {
  SimulationState,
  SimulationStatePatch,
  Incident,
  IncidentType,
  ScenarioStage,
  TurnScore,
} from './simulationTypes';
import {
  applySimulationPatch,
  checkIncidentCooldown,
  recordIncidentCooldown,
} from './simulationEngine';
import { renderIncidentMessage } from './incidentTemplates';
import type { SimulationHarness } from '@shared/schema/scenarios';
import { DEFAULT_SIMULATION_HARNESS, resolveHarness, resolveCooldownsForType } from './simulationHarness';

const UpdateNpcAffectiveStateArgsSchema = z.object({
  intensityDelta: z.number().optional(),
  valenceDelta: z.number().optional(),
  confusionDelta: z.number().optional(),
  loadDelta: z.number().optional(),
  trustDelta: z.number().optional(),
  rapportDelta: z.number().optional(),
  interestDelta: z.number().optional(),
  cooperativenessDelta: z.number().optional(),
  reason: z.string(),
});

const UpdateScenarioStateArgsSchema = z.object({
  targetStage: z.enum(['intro', 'conflict', 'negotiation', 'escalation', 'resolution']).optional(),
  pressureDelta: z.union([z.literal(-1), z.literal(0), z.literal(1)]).optional(),
  timeDeltaSec: z.number().optional(),
  reason: z.string(),
});

const TriggerIncidentArgsSchema = z.object({
  type: z.string(),
  severity: z.enum(['low', 'medium', 'high']),
  reason: z.string(),
});

export interface PersonaSwitchedInfo {
  fromIndex: number;
  toIndex: number;
  fromPersonaId: string;
  toPersonaId: string;
  reason: string;
  transitionLine: string;
}

export interface ToolHandlerResult {
  success: boolean;
  error?: string;
  statePatch?: SimulationStatePatch;
  currentState?: SimulationState;
  behaviorInstruction?: string;
  incident?: Incident;
  personaSwitched?: PersonaSwitchedInfo;
}

interface ToolCallContext {
  personaRunId: string;
  turnId: string;
  turnIndex: number;
  currentTurnIncidentFired: boolean;
  toolCallCountThisTurn: number;
  emotionCallCountThisTurn: number;
  language: 'ko' | 'en' | 'ja' | 'zh';
  scenarioContext?: string;
  currentPersonaIndex?: number;
  scenarioPersonas?: Array<{ id: string; name: string; [key: string]: any }>;
  harness?: SimulationHarness | null;
}

const SwitchPersonaArgsSchema = z.object({
  targetPersonaIndex: z.number().int().min(0).max(9),
  reason: z.string(),
  transitionLine: z.string(),
});

export function handleToolCall(
  toolName: string,
  rawArgs: unknown,
  ctx: ToolCallContext
): ToolHandlerResult {
  try {
    switch (toolName) {
      case 'update_npc_affective_state':
        return handleUpdateNpcAffectiveState(rawArgs, ctx);
      case 'update_scenario_state':
        return handleUpdateScenarioState(rawArgs, ctx);
      case 'trigger_incident':
        return handleTriggerIncident(rawArgs, ctx);
      case 'switch_persona':
        return handleSwitchPersona(rawArgs, ctx);
      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    console.error(`[simulationToolHandler] Tool call failed: ${toolName}`, err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function handleSwitchPersona(rawArgs: unknown, ctx: ToolCallContext): ToolHandlerResult {
  const parsed = SwitchPersonaArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return { success: false, error: `Invalid args: ${parsed.error.message}` };
  }
  const { targetPersonaIndex, reason, transitionLine } = parsed.data;
  const fromIndex = ctx.currentPersonaIndex ?? 0;
  if (targetPersonaIndex === fromIndex) {
    return { success: false, error: 'Target persona is already active' };
  }
  const personas = ctx.scenarioPersonas || [];
  const fromPersona = personas[fromIndex];
  const toPersona = personas[targetPersonaIndex];
  if (!toPersona) {
    return { success: false, error: `Target persona index ${targetPersonaIndex} does not exist` };
  }
  return {
    success: true,
    personaSwitched: {
      fromIndex,
      toIndex: targetPersonaIndex,
      fromPersonaId: fromPersona?.id ?? String(fromIndex),
      toPersonaId: toPersona.id,
      reason,
      transitionLine,
    },
  };
}

function clampDelta(value: number | undefined, maxAbs: number): number | undefined {
  if (value === undefined) return undefined;
  return Math.max(-maxAbs, Math.min(maxAbs, value));
}

function handleUpdateNpcAffectiveState(rawArgs: unknown, ctx: ToolCallContext): ToolHandlerResult {
  const parsed = UpdateNpcAffectiveStateArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return { success: false, error: `Invalid args: ${parsed.error.message}` };
  }

  const h = resolveHarness({ simulationHarness: ctx.harness });
  const maxCalls = h.toolPolicy.updateNpcEmotion.maxCallsPerTurn;
  const maxDelta = h.toolPolicy.updateNpcEmotion.maxDeltaPerCall;

  if (ctx.emotionCallCountThisTurn >= maxCalls) {
    return { success: false, error: `Maximum ${maxCalls} affective state updates per turn` };
  }

  const args = parsed.data;
  const affectiveDelta: import('./simulationTypes').DeepPartial<import('./simulationTypes').NpcAffectiveState> = {};

  if (args.intensityDelta !== undefined || args.valenceDelta !== undefined) {
    affectiveDelta.affective = {
      ...(args.intensityDelta !== undefined ? { intensity: clampDelta(args.intensityDelta, maxDelta)! } : {}),
      ...(args.valenceDelta !== undefined ? { valence: clampDelta(args.valenceDelta, maxDelta)! } : {}),
    };
  }
  if (args.confusionDelta !== undefined || args.loadDelta !== undefined) {
    affectiveDelta.cognitive = {
      ...(args.confusionDelta !== undefined ? { confusion: clampDelta(args.confusionDelta, maxDelta)! } : {}),
      ...(args.loadDelta !== undefined ? { load: clampDelta(args.loadDelta, maxDelta)! } : {}),
    };
  }
  if (args.trustDelta !== undefined || args.rapportDelta !== undefined) {
    affectiveDelta.relational = {
      ...(args.trustDelta !== undefined ? { trust: clampDelta(args.trustDelta, maxDelta)! } : {}),
      ...(args.rapportDelta !== undefined ? { rapport: clampDelta(args.rapportDelta, maxDelta)! } : {}),
    };
  }
  if (args.interestDelta !== undefined || args.cooperativenessDelta !== undefined) {
    affectiveDelta.motivational = {
      ...(args.interestDelta !== undefined ? { interest: clampDelta(args.interestDelta, maxDelta)! } : {}),
      ...(args.cooperativenessDelta !== undefined ? { cooperativeness: clampDelta(args.cooperativenessDelta, maxDelta)! } : {}),
    };
  }

  const patch: SimulationStatePatch = { npcAffectiveStateDelta: affectiveDelta };

  const newState = applySimulationPatch(ctx.personaRunId, {
    source: 'gemini_tool',
    priority: 'normal',
    turnId: ctx.turnId,
    patch,
  });

  return {
    success: true,
    statePatch: patch,
    currentState: newState,
    behaviorInstruction: buildEmotionBehaviorInstruction(args.reason, newState),
  };
}

function handleUpdateScenarioState(rawArgs: unknown, ctx: ToolCallContext): ToolHandlerResult {
  const parsed = UpdateScenarioStateArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return { success: false, error: `Invalid args: ${parsed.error.message}` };
  }

  const h = resolveHarness({ simulationHarness: ctx.harness });
  if (h.toolPolicy.updateScenarioState.enabled === false) {
    return { success: false, error: 'update_scenario_state is disabled for this scenario' };
  }

  const args = parsed.data;
  const patch: SimulationStatePatch = {
    ...(args.targetStage ? { targetStage: args.targetStage as ScenarioStage } : {}),
    ...(args.pressureDelta !== undefined ? { pressureDelta: args.pressureDelta as -1 | 0 | 1 } : {}),
    ...(args.timeDeltaSec !== undefined ? { timerDelta: { elapsedSecDelta: args.timeDeltaSec } } : {}),
  };

  const newState = applySimulationPatch(ctx.personaRunId, {
    source: 'gemini_tool',
    priority: 'normal',
    turnId: ctx.turnId,
    patch,
  });

  return {
    success: true,
    statePatch: patch,
    currentState: newState,
    behaviorInstruction: `Scenario progressed: ${args.reason}`,
  };
}

function handleTriggerIncident(rawArgs: unknown, ctx: ToolCallContext): ToolHandlerResult {
  const parsed = TriggerIncidentArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return { success: false, error: `Invalid args: ${parsed.error.message}` };
  }

  if (ctx.currentTurnIncidentFired) {
    return { success: false, error: 'Only one incident per turn is allowed' };
  }

  const args = parsed.data;
  const h = resolveHarness({ simulationHarness: ctx.harness });
  const allowedTypes = h.toolPolicy.triggerIncident.allowedTypes;

  if (!allowedTypes.includes(args.type)) {
    return { success: false, error: `Incident type '${args.type}' is not allowed for this scenario. Allowed: ${allowedTypes.join(', ')}` };
  }

  const { globalCooldownMs, perTypeCooldownMs } = resolveCooldownsForType(h, args.type);

  const cooldown = checkIncidentCooldown(ctx.personaRunId, args.type);
  if (!cooldown.allowed) {
    return { success: false, error: cooldown.reason };
  }

  recordIncidentCooldown(ctx.personaRunId, args.type, Date.now(), globalCooldownMs, perTypeCooldownMs);

  const message = renderIncidentMessage(
    args.type as IncidentType,
    args.severity,
    ctx.scenarioContext ?? '',
    ctx.language
  );

  const incident: Incident = {
    id: uuidv4(),
    type: args.type as IncidentType,
    severity: args.severity,
    message,
    turnIndex: ctx.turnIndex,
    triggeredBy: 'gemini_tool',
    createdAt: new Date().toISOString(),
    resolved: false,
  };

  const patch: SimulationStatePatch = {
    incidentsToAdd: [incident],
    pressureDelta: args.severity === 'high' ? 1 : 0,
    ...(args.severity === 'high' ? {
      npcAffectiveStateDelta: {
        affective: { intensity: 10 },
        relational: { trust: -5 },
      },
    } : {}),
  };

  const newState = applySimulationPatch(ctx.personaRunId, {
    source: 'gemini_tool',
    priority: 'high',
    turnId: ctx.turnId,
    patch,
  });

  return {
    success: true,
    statePatch: patch,
    currentState: newState,
    incident,
    behaviorInstruction: `Incident occurred: ${message}. React naturally to this development.`,
  };
}

function buildEmotionBehaviorInstruction(reason: string, state: SimulationState): string {
  const intensity = state.npcAffectiveState.affective.intensity;
  const trust = state.npcAffectiveState.relational.trust;
  if (intensity >= 80) return `Respond with high tension and frustration. ${reason}`;
  if (trust >= 70) return `Respond with warmth and cooperation. ${reason}`;
  if (intensity >= 60) return `Maintain guarded tone with some skepticism. ${reason}`;
  return `Adjust tone naturally based on the conversation. ${reason}`;
}
