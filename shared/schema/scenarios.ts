import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { categories, users } from "./users";
import type { PersonaSelection, StrategyChoice, SequenceAnalysis } from "./types";

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
  }>>(),
  recommendedFlow: text("recommended_flow").array(),
  evaluationCriteriaSetId: varchar("evaluation_criteria_set_id"),
  targetDurationMinutes: integer("target_duration_minutes").notNull().default(7),
  targetTurns: integer("target_turns").notNull().default(10),
  minValidTurns: integer("min_valid_turns").notNull().default(4),
  personaSwitchMode: varchar("persona_switch_mode", { length: 20 }).$type<'replace' | 'join'>(),
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

export const scenarioRuns = pgTable("scenario_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  scenarioId: text("scenario_id").notNull(),
  scenarioName: text("scenario_name").notNull(),
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

export type ScenarioStats = {
  scenarioId: string;
  completionCount: number;
  averageScore: number | null;
};
