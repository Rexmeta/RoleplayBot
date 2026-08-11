export type ScenarioStage = 'intro' | 'conflict' | 'negotiation' | 'escalation' | 'resolution';

export type IncidentType =
  | 'executive_join' | 'customer_escalation' | 'deadline_pressure'
  | 'new_evidence' | 'competitor_offer' | 'policy_constraint'
  | 'quality_issue' | 'manager_interrupt' | 'budget_cut' | 'compliance_warning';

export type SimulationEventType =
  | 'tool_call' | 'auto_evaluation' | 'state_init' | 'state_restore'
  | 'manual_update' | 'incident' | 'session_end';

export type PatchSource = 'gemini_tool' | 'server_evaluation' | 'server_rule' | 'admin';

/**
 * NpcAffectiveState — 4-layer structured NPC state model.
 * This is the single source of truth for NPC emotional state.
 * NpcEmotions is derived from this for backward compatibility.
 * - affective: raw emotional responses
 * - cognitive: perceptual/epistemic state
 * - relational: interpersonal relationship quality
 * - motivational: engagement and goal-seeking drive
 */
export interface NpcAffectiveState {
  affective: {
    /** Emotional intensity / anger proxy (0-100) */
    intensity: number;
    /** Valence: positive = pleasant, negative = unpleasant (-100 to 100) */
    valence: number;
  };
  cognitive: {
    /** Confusion / uncertainty level (0-100) */
    confusion: number;
    /** Cognitive load / overwhelm (0-100) */
    load: number;
  };
  relational: {
    /** Trust in the conversation partner (0-100) */
    trust: number;
    /** Perceived rapport / closeness (0-100) */
    rapport: number;
  };
  motivational: {
    /** Interest / engagement with the topic (0-100) */
    interest: number;
    /** Willingness to cooperate (0-100) */
    cooperativeness: number;
  };
}

export interface TimerState {
  enabled: boolean;
  timeLimitSec: number;
  startedAt: string | null;
  pausedAt: string | null;
  elapsedSec: number;
}

export interface TurnScore {
  turnId: string;
  turnIndex: number;
  clarity: number;
  empathy: number;
  logic: number;
  ownership: number;
  actionPlan: number;
  total: number;
  hint?: string;
  evaluationMethod: 'llm' | 'rule' | 'hybrid';
  evaluationConfidence: number;
}

export interface Incident {
  id: string;
  type: IncidentType;
  severity: 'low' | 'medium' | 'high';
  message: string;
  turnIndex: number;
  triggeredBy: 'gemini_tool' | 'server_rule' | 'admin';
  createdAt: string;
  resolved?: boolean;
}

export interface SimulationState {
  version: number;
  stage: ScenarioStage;
  pressureLevel: number;
  /** Primary NPC state. All emotion logic reads and writes here. */
  npcAffectiveState: NpcAffectiveState;
  timer: TimerState;
  currentScore: number;
  recentTurnScores: TurnScore[];
  recentIncidents: Incident[];
  simulationDirectives: SimulationDirective[];
  /** Persisted accumulator so score average survives restart/reconnect beyond the recentTurnScores window. */
  scoreAccumulator?: { sum: number; count: number };
  /** Set by server rule evaluator when personaSwitchRules condition fires. Cleared after the switch is processed. */
  serverRulePersonaSwitch?: { targetPersonaIndex: number; reason: string };
  /** Current flowGraph stage goal — updated whenever a stage transition fires; injected into per-turn AI context. */
  currentStageGoal?: string;
  /** Set when terminationRules conditions are met; causes route layer to complete the persona run. */
  terminationReason?: 'success' | 'failure' | 'timeout';
  summary: {
    totalTurns: number;
    totalIncidents: number;
    averageScore: number;
    maxAnger: number;
    minTrust: number;
  };
}

/** DeepPartial utility for nested patch types */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export interface SimulationStatePatch {
  /** Primary NPC state delta. Engine applies this and derives npcEmotions from it. */
  npcAffectiveStateDelta?: DeepPartial<NpcAffectiveState>;
  targetStage?: ScenarioStage;
  pressureDelta?: -1 | 0 | 1;
  timerDelta?: { elapsedSecDelta?: number };
  incidentsToAdd?: Incident[];
  turnScoresToAdd?: TurnScore[];
  directivesToAdd?: SimulationDirective[];
}

export interface SimulationStatePatchRequest {
  source: PatchSource;
  priority: 'low' | 'normal' | 'high';
  turnId: string;
  patch: SimulationStatePatch;
}

/**
 * @deprecated Use UpdateNpcAffectiveStateArgs (npcAffectiveStateDelta patch) instead.
 * Flat emotion args are no longer used by any tool handler; retained only for
 * backward-compatibility with any external callers that have not yet migrated.
 */
export interface UpdateNpcEmotionArgs {
  angerDelta?: number;
  trustDelta?: number;
  confusionDelta?: number;
  interestDelta?: number;
  reason: string;
}

export interface UpdateScenarioStateArgs {
  targetStage?: ScenarioStage;
  pressureDelta?: -1 | 0 | 1;
  timeDeltaSec?: number;
  reason: string;
}

export interface TriggerIncidentArgs {
  type: IncidentType;
  severity: 'low' | 'medium' | 'high';
  reason: string;
}

export interface SimulationUpdateMessage {
  type: 'simulation_update';
  personaRunId: string;
  turnId?: string;
  eventType: SimulationEventType;
  statePatch?: SimulationStatePatch;
  currentState: SimulationState;
  incident?: Incident;
  turnScore?: TurnScore;
  version: number;
  timestamp: string;
}

export interface SimulationDirective {
  id: string;
  createdTurnIndex: number;
  expiresAtTurnIndex: number;
  instruction: string;
  source: 'tool' | 'server_rule' | 'admin';
}

export interface SimulationEvent {
  id: string;
  personaRunId: string;
  scenarioRunId: string | null;
  turnIndex: number;
  turnId: string | null;
  eventType: SimulationEventType;
  toolName: string | null;
  args: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  stateBefore: SimulationState | null;
  stateAfter: SimulationState | null;
  stateVersionBefore: number | null;
  stateVersionAfter: number | null;
  includeInReport: boolean;
  createdAt: Date;
}

export const DEFAULT_NPC_AFFECTIVE_STATE: NpcAffectiveState = {
  affective: {
    intensity: 30,
    valence: 0,
  },
  cognitive: {
    confusion: 20,
    load: 20,
  },
  relational: {
    trust: 50,
    rapport: 40,
  },
  motivational: {
    interest: 50,
    cooperativeness: 50,
  },
};

export function createDefaultSimulationState(): SimulationState {
  return {
    version: 0,
    stage: 'intro',
    pressureLevel: 1,
    npcAffectiveState: {
      affective: { ...DEFAULT_NPC_AFFECTIVE_STATE.affective },
      cognitive: { ...DEFAULT_NPC_AFFECTIVE_STATE.cognitive },
      relational: { ...DEFAULT_NPC_AFFECTIVE_STATE.relational },
      motivational: { ...DEFAULT_NPC_AFFECTIVE_STATE.motivational },
    },
    timer: {
      enabled: false,
      timeLimitSec: 0,
      startedAt: null,
      pausedAt: null,
      elapsedSec: 0,
    },
    currentScore: 0,
    recentTurnScores: [],
    recentIncidents: [],
    simulationDirectives: [],
    summary: {
      totalTurns: 0,
      totalIncidents: 0,
      averageScore: 0,
      maxAnger: 30,
      minTrust: 50,
    },
  };
}

export function calcTurnScoreTotal(s: { clarity: number; empathy: number; logic: number; ownership: number; actionPlan: number }): number {
  return Math.round(s.clarity * 0.25 + s.empathy * 0.20 + s.logic * 0.20 + s.ownership * 0.20 + s.actionPlan * 0.15);
}
