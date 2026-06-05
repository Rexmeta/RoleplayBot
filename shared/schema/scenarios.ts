import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, boolean, index, uniqueIndex, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { categories, users, organizations } from "./users";
import type { PersonaSelection, StrategyChoice, SequenceAnalysis } from "./types";

export const simulationHarnessSchema = z.object({
  emotionModel: z.array(z.string()).optional(),
  toolPolicy: z.object({
    updateNpcEmotion: z.object({
      maxCallsPerTurn: z.number().int().min(1).max(10).optional(),
      maxDeltaPerCall: z.number().min(1).max(100).optional(),
    }).optional(),
    triggerIncident: z.object({
      allowedTypes: z.array(z.string()).optional(),
      cooldownOverride: z.object({
        globalCooldownSec: z.number().min(0).optional(),
        perTypeCooldownSec: z.number().min(0).optional(),
      }).optional(),
      cooldowns: z.record(z.string(), z.object({
        globalCooldownSec: z.number().min(0).optional(),
        perTypeCooldownSec: z.number().min(0).optional(),
      })).optional(),
    }).optional(),
    updateScenarioState: z.object({
      enabled: z.boolean().optional(),
    }).optional(),
  }).optional(),
  preferredSignals: z.record(z.string(), z.string()).optional(),
});

export type SimulationHarness = z.infer<typeof simulationHarnessSchema>;

export type ConditionOperator = 'gte' | 'lte' | 'gt' | 'lt' | 'eq';

// ─── PlayerConstraints ────────────────────────────────────────────────────────

export interface PlayerConstraints {
  authorityLevel?: string;
  canOffer?: string[];
  cannotOffer?: string[];
  requiredBehaviors?: string[];
  forbiddenBehaviors?: string[];
}

export const playerConstraintsSchema: z.ZodType<PlayerConstraints> = z.object({
  authorityLevel: z.string().optional(),
  canOffer: z.array(z.string()).optional(),
  cannotOffer: z.array(z.string()).optional(),
  requiredBehaviors: z.array(z.string()).optional(),
  forbiddenBehaviors: z.array(z.string()).optional(),
});

// ─── NpcBehaviorHarness ───────────────────────────────────────────────────────

export interface NpcBehaviorHarnessTrigger {
  keyword: string;
  trustDelta?: number;
  angerDelta?: number;
  description?: string;
}

export interface NpcBehaviorHarness {
  negotiationBounds?: {
    minTrustToYield?: number;
    maxAngerBeforeWalkout?: number;
    maxPatienceTurns?: number;
  };
  trustTriggers?: NpcBehaviorHarnessTrigger[];
  escalationTriggers?: NpcBehaviorHarnessTrigger[];
}

const npcBehaviorHarnessTriggerSchema = z.object({
  keyword: z.string().min(1),
  trustDelta: z.number().optional(),
  angerDelta: z.number().optional(),
  description: z.string().optional(),
});

export const npcBehaviorHarnessSchema: z.ZodType<NpcBehaviorHarness> = z.object({
  negotiationBounds: z.object({
    minTrustToYield: z.number().min(0).max(100).optional(),
    maxAngerBeforeWalkout: z.number().min(0).max(100).optional(),
    maxPatienceTurns: z.number().int().positive().optional(),
  }).optional(),
  trustTriggers: z.array(npcBehaviorHarnessTriggerSchema).optional(),
  escalationTriggers: z.array(npcBehaviorHarnessTriggerSchema).optional(),
});

// ─── DifficultyProfile ────────────────────────────────────────────────────────

export interface DifficultyProfile {
  npcPatience?: number;
  hintFrequency?: number;
  incidentProbability?: number;
  passThreshold?: number;
}

export const difficultyProfileSchema: z.ZodType<DifficultyProfile> = z.object({
  npcPatience: z.number().min(1).max(10).optional(),
  hintFrequency: z.number().min(0).max(1).optional(),
  incidentProbability: z.number().min(0).max(2).optional(),
  passThreshold: z.number().min(0).max(100).optional(),
});

// ─── EvaluationHarness ────────────────────────────────────────────────────────

export type EvaluationDimensionKey = 'clarity' | 'empathy' | 'logic' | 'ownership' | 'actionPlan';

export interface EvaluationHarnessDimension {
  key: EvaluationDimensionKey;
  weight: number;
  scenarioSpecificDefinition?: string;
  positiveSignals?: string[];
  negativeSignals?: string[];
}

export interface PassingRule {
  minAverageScore: number;
  requiredDimensions?: { key: EvaluationDimensionKey; minScore: number }[];
}

export interface EvaluationHarness {
  dimensions?: EvaluationHarnessDimension[];
  passingRule?: PassingRule;
}

export const evaluationHarnessDimensionSchema = z.object({
  key: z.enum(['clarity', 'empathy', 'logic', 'ownership', 'actionPlan']),
  weight: z.number().min(0).max(10),
  scenarioSpecificDefinition: z.string().optional(),
  positiveSignals: z.array(z.string()).optional(),
  negativeSignals: z.array(z.string()).optional(),
});

export const passingRuleSchema = z.object({
  minAverageScore: z.number().min(0).max(100),
  requiredDimensions: z.array(z.object({
    key: z.enum(['clarity', 'empathy', 'logic', 'ownership', 'actionPlan']),
    minScore: z.number().min(0).max(100),
  })).optional(),
});

export const evaluationHarnessSchema: z.ZodType<EvaluationHarness> = z.object({
  dimensions: z.array(evaluationHarnessDimensionSchema).optional(),
  passingRule: passingRuleSchema.optional(),
});

// ─── TerminationRules ─────────────────────────────────────────────────────────

export type TerminationOutcome = 'success' | 'failure' | 'timeout';

export interface TerminationConditionGroup {
  npcEmotions?: Partial<Record<'anger' | 'trust' | 'confusion' | 'interest', { operator: ConditionOperator; value: number }>>;
  currentScore?: { operator: ConditionOperator; value: number };
  stage?: string;
  totalTurns?: { operator: ConditionOperator; value: number };
  consecutiveTurnsBelow?: { scoreThreshold: number; turns: number };
  logic?: 'all' | 'any';
}

export interface TerminationRules {
  success?: TerminationConditionGroup;
  failure?: TerminationConditionGroup;
  timeout?: { maxTurns?: number; maxTimeSec?: number };
}

const npcEmotionConditionSchema = z.object({
  operator: z.enum(['gte', 'lte', 'gt', 'lt', 'eq']),
  value: z.number(),
});

const terminationConditionGroupSchema: z.ZodType<TerminationConditionGroup> = z.object({
  npcEmotions: z.object({
    anger: npcEmotionConditionSchema.optional(),
    trust: npcEmotionConditionSchema.optional(),
    confusion: npcEmotionConditionSchema.optional(),
    interest: npcEmotionConditionSchema.optional(),
  }).optional(),
  currentScore: z.object({
    operator: z.enum(['gte', 'lte', 'gt', 'lt', 'eq']),
    value: z.number(),
  }).optional(),
  stage: z.string().optional(),
  totalTurns: z.object({
    operator: z.enum(['gte', 'lte', 'gt', 'lt', 'eq']),
    value: z.number(),
  }).optional(),
  consecutiveTurnsBelow: z.object({
    scoreThreshold: z.number(),
    turns: z.number().int().positive(),
  }).optional(),
  logic: z.enum(['all', 'any']).optional(),
});

export const terminationRulesSchema: z.ZodType<TerminationRules> = z.object({
  success: terminationConditionGroupSchema.optional(),
  failure: terminationConditionGroupSchema.optional(),
  timeout: z.object({
    maxTurns: z.number().int().positive().optional(),
    maxTimeSec: z.number().positive().optional(),
  }).optional(),
});

export interface ExitCondition {
  type: 'turn_count' | 'turn_score' | 'npc_emotion';
  metric?: string;
  operator: ConditionOperator;
  value: number;
  windowTurns?: number;
}

export interface FlowStage {
  id: string;
  goal: string;
  exitConditions: ExitCondition[];
  exitConditionsLogic?: 'all' | 'any';
  nextStage: string;
}

export interface FlowGraph {
  stages: FlowStage[];
}

export interface SwitchCondition {
  metric: string;
  operator: ConditionOperator;
  value: number;
  consecutiveTurns?: number;
}

export interface SwitchRule {
  id: string;
  targetPersonaIndex: number;
  conditions: SwitchCondition[];
  reason: string;
  lockAfterSwitch?: boolean;
}

export interface PersonaSwitchRules {
  rules: SwitchRule[];
}

export const exitConditionSchema: z.ZodType<ExitCondition> = z.object({
  type: z.enum(['turn_count', 'turn_score', 'npc_emotion']),
  metric: z.string().optional(),
  operator: z.enum(['gte', 'lte', 'gt', 'lt', 'eq']),
  value: z.number(),
  windowTurns: z.number().int().positive().optional(),
});

export const flowStageSchema: z.ZodType<FlowStage> = z.object({
  id: z.string().min(1),
  goal: z.string().min(1),
  exitConditions: z.array(exitConditionSchema),
  exitConditionsLogic: z.enum(['all', 'any']).optional(),
  nextStage: z.string().min(1),
});

export const flowGraphSchema: z.ZodType<FlowGraph> = z.object({
  stages: z.array(flowStageSchema).min(1),
});

export const switchConditionSchema: z.ZodType<SwitchCondition> = z.object({
  metric: z.string().min(1),
  operator: z.enum(['gte', 'lte', 'gt', 'lt', 'eq']),
  value: z.number(),
  consecutiveTurns: z.number().int().positive().optional(),
});

export const switchRuleSchema: z.ZodType<SwitchRule> = z.object({
  id: z.string().min(1),
  targetPersonaIndex: z.number().int().min(0),
  conditions: z.array(switchConditionSchema).min(1),
  reason: z.string().min(1),
  lockAfterSwitch: z.boolean().optional(),
});

export const personaSwitchRulesSchema: z.ZodType<PersonaSwitchRules> = z.object({
  rules: z.array(switchRuleSchema).min(1),
});

export const scenarios = pgTable("scenarios", {
  id: varchar("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  sourceLocale: varchar("source_locale", { length: 10 }).notNull().default('ko'),
  difficulty: integer("difficulty").notNull().default(4),
  estimatedTime: text("estimated_time"),
  skills: text("skills").array(),
  categoryId: varchar("category_id").references(() => categories.id),
  image: text("image"),
  imagePrompt: text("image_prompt"),
  introVideoUrl: text("intro_video_url"),
  introVideoMode: text("intro_video_mode").$type<'none' | 'default' | 'custom'>().default('none'),
  videoPrompt: text("video_prompt"),
  objectiveType: text("objective_type"),
  context: jsonb("context").$type<{
    situation: string;
    timeline: string;
    stakes: string;
    playerRole: {
      position: string;
      department: string;
      experience: string;
      responsibility: string;
    };
  }>(),
  objectives: text("objectives").array(),
  successCriteria: jsonb("success_criteria").$type<{
    optimal: string;
    good: string;
    acceptable: string;
    failure: string;
  }>(),
  personas: jsonb("personas").$type<Array<{
    id: string;
    name: string;
    department: string;
    position: string;
    experience: string;
    personaRef: string;
    stance: string;
    goal: string;
    tradeoff: string;
    gender?: string;
    mbti?: string;
    isPrimary?: boolean;
    triggerHints?: string[];
    entryLine?: string;
    voiceId?: string | null;
    npcBehaviorHarness?: NpcBehaviorHarness;
  }>>(),
  recommendedFlow: text("recommended_flow").array(),
  flowGraph: jsonb("flow_graph").$type<FlowGraph>(),
  personaSwitchRules: jsonb("persona_switch_rules").$type<PersonaSwitchRules>(),
  evaluationCriteriaSetId: varchar("evaluation_criteria_set_id"),
  targetDurationMinutes: integer("target_duration_minutes").notNull().default(7),
  targetTurns: integer("target_turns").notNull().default(10),
  minValidTurns: integer("min_valid_turns").notNull().default(4),
  evaluationHarness: jsonb("evaluation_harness").$type<EvaluationHarness>(),
  terminationRules: jsonb("termination_rules").$type<TerminationRules>(),
  playerConstraints: jsonb("player_constraints").$type<PlayerConstraints>(),
  difficultyProfile: jsonb("difficulty_profile").$type<DifficultyProfile>(),
  personaSwitchMode: varchar("persona_switch_mode", { length: 20 }).$type<'replace' | 'join'>(),
  simulationHarness: jsonb("simulation_harness").$type<SimulationHarness>(),
  analyticsSpec: jsonb("analytics_spec").$type<AnalyticsSpec>(),
  storeListed: boolean("store_listed").notNull().default(false),
  storePriceUsd: doublePrecision("store_price_usd"),
  storePackId: varchar("store_pack_id"),
  isDemo: boolean("is_demo").notNull().default(false),
  isPublic: boolean("is_public").notNull().default(false),
  isDeleted: boolean("is_deleted").notNull().default(false),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_scenarios_category_id").on(table.categoryId),
  index("idx_scenarios_difficulty").on(table.difficulty),
  index("idx_scenarios_is_deleted").on(table.isDeleted),
]);

export const scenarioVersions = pgTable("scenario_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scenarioId: varchar("scenario_id").notNull().references(() => scenarios.id),
  version: integer("version").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("published").$type<'draft' | 'published' | 'archived'>(),
  contentSnapshot: jsonb("content_snapshot").notNull(),
  evaluationHarnessSnapshot: jsonb("evaluation_harness_snapshot").$type<EvaluationHarness>(),
  publishedAt: timestamp("published_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  publishedBy: varchar("published_by").references(() => users.id),
}, (table) => [
  index("idx_scenario_versions_scenario_id").on(table.scenarioId),
  index("idx_scenario_versions_status").on(table.status),
]);

export const insertScenarioVersionSchema = createInsertSchema(scenarioVersions).omit({
  id: true,
  publishedAt: true,
});
export type InsertScenarioVersion = z.infer<typeof insertScenarioVersionSchema>;
export type ScenarioVersion = typeof scenarioVersions.$inferSelect;

export const scenarioRuns = pgTable("scenario_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  scenarioId: text("scenario_id").notNull(),
  scenarioName: text("scenario_name").notNull(),
  scenarioVersionId: varchar("scenario_version_id").references(() => scenarioVersions.id),
  scenarioSnapshot: jsonb("scenario_snapshot"),
  evaluationHarnessSnapshot: jsonb("evaluation_harness_snapshot").$type<EvaluationHarness>(),
  attemptNumber: integer("attempt_number").notNull(),
  status: text("status").notNull().default("in_progress"),
  totalScore: integer("total_score"),
  difficulty: integer("difficulty").notNull().default(2),
  mode: text("mode").notNull().default("text"),
  conversationOrder: jsonb("conversation_order").$type<string[]>(),
  personaSelections: jsonb("persona_selections").$type<PersonaSelection[]>(),
  strategyChoices: jsonb("strategy_choices").$type<StrategyChoice[]>(),
  sequenceAnalysis: jsonb("sequence_analysis").$type<SequenceAnalysis>(),
  strategyReflection: text("strategy_reflection"),
  startedAt: timestamp("started_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("idx_scenario_runs_user_id").on(table.userId),
  index("idx_scenario_runs_scenario_id").on(table.scenarioId),
]);

export const insertScenarioSchema = createInsertSchema(scenarios).omit({
  isDeleted: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertScenario = z.infer<typeof insertScenarioSchema>;
export type Scenario = typeof scenarios.$inferSelect;

export const insertScenarioRunSchema = createInsertSchema(scenarioRuns).omit({
  id: true,
  startedAt: true,
  completedAt: true,
});
export type InsertScenarioRun = z.infer<typeof insertScenarioRunSchema>;
export type ScenarioRun = typeof scenarioRuns.$inferSelect;

// ─── AnalyticsSpec ────────────────────────────────────────────────────────────

export const TRACKED_METRICS = [
  'angerMax', 'trustMin', 'trustMax', 'trustAverage', 'angerAverage',
  'empathyAverage', 'escalationCount', 'interruptionCount',
  'timeToResolution', 'totalTurns', 'turnsToFirstActionPlan',
] as const;

export type TrackedMetricKey = typeof TRACKED_METRICS[number];

export const REPORT_SECTIONS = [
  'scoreOverview', 'criticalMoments', 'simulationReplay', 'practiceGuide',
  'developmentPlan', 'strategy', 'conversation', 'metricSnapshot',
] as const;

export type ReportSectionKey = typeof REPORT_SECTIONS[number];

export interface AnalyticsSpec {
  trackedMetrics?: TrackedMetricKey[];
  reportSections?: ReportSectionKey[];
  benchmarkGroup?: string;
}

export const analyticsSpecSchema: z.ZodType<AnalyticsSpec> = z.object({
  trackedMetrics: z.array(z.enum(TRACKED_METRICS)).optional(),
  reportSections: z.array(z.enum(REPORT_SECTIONS)).optional(),
  benchmarkGroup: z.string().optional(),
});

export type ScenarioStats = {
  scenarioId: string;
  completionCount: number;
  averageScore: number | null;
};

// ─── ScenarioOverride ─────────────────────────────────────────────────────────

export interface ScenarioOverrideData {
  terminology?: Record<string, string>;
  policyConstraints?: string[];
  forbiddenPhrases?: string[];
  evaluationWeights?: Partial<Record<EvaluationDimensionKey, number>>;
  customIncidents?: string[];
}

export const scenarioOverrideDataSchema: z.ZodType<ScenarioOverrideData> = z.object({
  terminology: z.record(z.string(), z.string()).optional(),
  policyConstraints: z.array(z.string()).optional(),
  forbiddenPhrases: z.array(z.string()).optional(),
  evaluationWeights: z.record(z.enum(['clarity', 'empathy', 'logic', 'ownership', 'actionPlan']), z.number().min(0).max(10)).optional(),
  customIncidents: z.array(z.string()).optional(),
});

export const scenarioOverrides = pgTable("scenario_overrides", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  scenarioId: varchar("scenario_id").notNull().references(() => scenarios.id, { onDelete: 'cascade' }),
  override: jsonb("override").notNull().$type<ScenarioOverrideData>(),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_scenario_overrides_org_id").on(table.organizationId),
  index("idx_scenario_overrides_scenario_id").on(table.scenarioId),
  uniqueIndex("uniq_scenario_overrides_org_scenario").on(table.organizationId, table.scenarioId),
]);

export const insertScenarioOverrideSchema = createInsertSchema(scenarioOverrides).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertScenarioOverride = z.infer<typeof insertScenarioOverrideSchema>;
export type ScenarioOverride = typeof scenarioOverrides.$inferSelect;
