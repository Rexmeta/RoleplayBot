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

const UpdateNpcEmotionArgsSchema = z.object({
  angerDelta: z.number().min(-30).max(30).optional(),
  trustDelta: z.number().min(-30).max(30).optional(),
  confusionDelta: z.number().min(-30).max(30).optional(),
  interestDelta: z.number().min(-30).max(30).optional(),
  reason: z.string(),
});

const UpdateScenarioStateArgsSchema = z.object({
  targetStage: z.enum(['intro', 'conflict', 'negotiation', 'escalation', 'resolution']).optional(),
  pressureDelta: z.union([z.literal(-1), z.literal(0), z.literal(1)]).optional(),
  timeDeltaSec: z.number().optional(),
  reason: z.string(),
});

const TriggerIncidentArgsSchema = z.object({
  type: z.enum([
    'executive_join', 'customer_escalation', 'deadline_pressure',
    'new_evidence', 'competitor_offer', 'policy_constraint',
    'quality_issue', 'manager_interrupt', 'budget_cut', 'compliance_warning',
  ]),
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
      case 'update_npc_emotion':
        return handleUpdateNpcEmotion(rawArgs, ctx);
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

function handleUpdateNpcEmotion(rawArgs: unknown, ctx: ToolCallContext): ToolHandlerResult {
  const parsed = UpdateNpcEmotionArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return { success: false, error: `Invalid args: ${parsed.error.message}` };
  }

  if (ctx.emotionCallCountThisTurn >= 2) {
    return { success: false, error: 'Maximum 2 emotion updates per turn' };
  }

  const args = parsed.data;
  const patch: SimulationStatePatch = {
    npcEmotionDelta: {
      ...(args.angerDelta !== undefined ? { anger: args.angerDelta } : {}),
      ...(args.trustDelta !== undefined ? { trust: args.trustDelta } : {}),
      ...(args.confusionDelta !== undefined ? { confusion: args.confusionDelta } : {}),
      ...(args.interestDelta !== undefined ? { interest: args.interestDelta } : {}),
    },
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
    behaviorInstruction: buildEmotionBehaviorInstruction(args.reason, newState),
  };
}

function handleUpdateScenarioState(rawArgs: unknown, ctx: ToolCallContext): ToolHandlerResult {
  const parsed = UpdateScenarioStateArgsSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return { success: false, error: `Invalid args: ${parsed.error.message}` };
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
  const cooldown = checkIncidentCooldown(ctx.personaRunId, args.type);
  if (!cooldown.allowed) {
    return { success: false, error: cooldown.reason };
  }

  recordIncidentCooldown(ctx.personaRunId, args.type);

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
    npcEmotionDelta: args.severity === 'high' ? { anger: 10, trust: -5 } : {},
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
  const { anger, trust } = state.npcEmotions;
  if (anger >= 80) return `Respond with high tension and frustration. ${reason}`;
  if (trust >= 70) return `Respond with warmth and cooperation. ${reason}`;
  if (anger >= 60) return `Maintain guarded tone with some skepticism. ${reason}`;
  return `Adjust tone naturally based on the conversation. ${reason}`;
}
