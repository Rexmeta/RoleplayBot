export type ScenarioStage = 'intro' | 'conflict' | 'negotiation' | 'escalation' | 'resolution';

export type IncidentType =
  | 'executive_join' | 'customer_escalation' | 'deadline_pressure'
  | 'new_evidence' | 'competitor_offer' | 'policy_constraint'
  | 'quality_issue' | 'manager_interrupt' | 'budget_cut' | 'compliance_warning';

export type SimulationEventType =
  | 'tool_call' | 'auto_evaluation' | 'state_init' | 'state_restore'
  | 'manual_update' | 'incident' | 'session_end';

export type PatchSource = 'gemini_tool' | 'server_evaluation' | 'server_rule' | 'admin';

export interface NpcEmotions {
  anger: number;
  trust: number;
  confusion: number;
  interest: number;
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
  npcEmotions: NpcEmotions;
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

export interface SimulationStatePatch {
  npcEmotionDelta?: Partial<Record<keyof NpcEmotions, number>>;
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

export const DEFAULT_NPC_EMOTIONS: NpcEmotions = {
  anger: 30,
  trust: 50,
  confusion: 20,
  interest: 50,
};

export function createDefaultSimulationState(): SimulationState {
  return {
    version: 0,
    stage: 'intro',
    pressureLevel: 1,
    npcEmotions: { ...DEFAULT_NPC_EMOTIONS },
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
