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
}

const sessionContexts = new Map<string, InternalSession>();

export function getOrCreateSessionContext(personaRunId: string, state?: SimulationState): InternalSession {
  if (!sessionContexts.has(personaRunId)) {
    const initState = state ?? createDefaultSimulationState();
    // Prefer the persisted scoreAccumulator (survives >10 turn history) over reconstructing
    // from recentTurnScores (capped at MAX_RECENT=10), which would undercount after restart.
    const acc = initState.scoreAccumulator;
    const existingScored = initState.recentTurnScores.filter(ts => ts.total > 0);
    sessionContexts.set(personaRunId, {
      simulationState: initState,
      patchContextByTurn: new Map(),
      globalIncidentCooldownUntil: 0,
      incidentTypeCooldowns: new Map(),
      allTimeTurnScoreSum: acc?.sum ?? existingScored.reduce((s, ts) => s + ts.total, 0),
      allTimeTurnScoreCount: acc?.count ?? existingScored.length,
    });
  }
  const ctx = sessionContexts.get(personaRunId)!;
  if (state && ctx.simulationState.version < state.version) {
    ctx.simulationState = state;
  }
  return ctx;
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

  // Directive lifecycle: add new directives, expire old ones, enforce max 3 with dedupe
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
  // Keep at most 3 active directives (newest first) — spec: "max 3 active"
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

  const newState: SimulationState = {
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
  now = Date.now()
): void {
  const ctx = getOrCreateSessionContext(personaRunId);
  ctx.globalIncidentCooldownUntil = now + 60_000;
  ctx.incidentTypeCooldowns.set(incidentType, now + 120_000);
}

export function getSessionState(personaRunId: string): SimulationState | null {
  return sessionContexts.get(personaRunId)?.simulationState ?? null;
}

export function setSessionState(personaRunId: string, state: SimulationState): void {
  const ctx = getOrCreateSessionContext(personaRunId, state);
  ctx.simulationState = state;
}

export { calcTurnScoreTotal };
