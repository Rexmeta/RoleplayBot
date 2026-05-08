import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, boolean, doublePrecision, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users, categories } from "./users";
import { personaRuns } from "./conversations";
import type { EvaluationScore, DetailedFeedback, ScoringRubric } from "./types";

export const feedbacks = pgTable("feedbacks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id"),
  personaRunId: varchar("persona_run_id").references(() => personaRuns.id, { onDelete: 'cascade' }),
  overallScore: integer("overall_score"),
  confidence: doublePrecision("confidence"),
  reportStatus: varchar("report_status"),
  scores: jsonb("scores").notNull().$type<EvaluationScore[]>(),
  detailedFeedback: jsonb("detailed_feedback").notNull().$type<DetailedFeedback>(),
  rubricSnapshot: jsonb("rubric_snapshot").$type<Record<string, any>>(),
  conversationSnapshot: jsonb("conversation_snapshot").$type<any[]>(),
  evaluationPromptSnapshot: jsonb("evaluation_prompt_snapshot").$type<Record<string, any>>(),
  modelSnapshot: jsonb("model_snapshot").$type<Record<string, any>>(),
  criteriaSetVersion: integer("criteria_set_version"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_feedbacks_conversation_id").on(table.conversationId),
  index("idx_feedbacks_persona_run_id").on(table.personaRunId),
]);

export const evaluationCriteriaSets = pgTable("evaluation_criteria_sets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  description: text("description"),
  isDefault: boolean("is_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  categoryId: varchar("category_id").references(() => categories.id),
  createdBy: varchar("created_by").references(() => users.id),
  status: varchar("status").notNull().default("draft"),
  approvedBy: varchar("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  version: integer("version").notNull().default(1),
  parentSetId: varchar("parent_set_id"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_criteria_sets_category").on(table.categoryId),
  index("idx_criteria_sets_default").on(table.isDefault),
  index("idx_criteria_sets_status").on(table.status),
  index("idx_criteria_sets_parent").on(table.parentSetId),
]);

export const evaluationDimensions = pgTable("evaluation_dimensions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  criteriaSetId: varchar("criteria_set_id").notNull().references(() => evaluationCriteriaSets.id, { onDelete: 'cascade' }),
  key: varchar("key").notNull(),
  name: varchar("name").notNull(),
  description: text("description"),
  icon: varchar("icon").notNull().default("📊"),
  color: varchar("color").notNull().default("blue"),
  weight: doublePrecision("weight").notNull().default(20.0),
  dimensionType: varchar("dimension_type").notNull().default("standard"),
  minScore: integer("min_score").notNull().default(1),
  maxScore: integer("max_score").notNull().default(10),
  scoringRubric: jsonb("scoring_rubric").$type<ScoringRubric[]>(),
  evaluationPrompt: text("evaluation_prompt"),
  displayOrder: integer("display_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_dimensions_criteria_set").on(table.criteriaSetId),
  index("idx_dimensions_key").on(table.key),
]);

export const insertFeedbackSchema = createInsertSchema(feedbacks).omit({
  id: true,
  createdAt: true,
});
export type InsertFeedback = z.infer<typeof insertFeedbackSchema>;
export type Feedback = typeof feedbacks.$inferSelect;

export const insertEvaluationCriteriaSetSchema = createInsertSchema(evaluationCriteriaSets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertEvaluationCriteriaSet = z.infer<typeof insertEvaluationCriteriaSetSchema>;
export type EvaluationCriteriaSet = typeof evaluationCriteriaSets.$inferSelect;

export const insertEvaluationDimensionSchema = createInsertSchema(evaluationDimensions).omit({
  id: true,
  createdAt: true,
});
export type InsertEvaluationDimension = z.infer<typeof insertEvaluationDimensionSchema>;
export type EvaluationDimension = typeof evaluationDimensions.$inferSelect;

export type EvaluationCriteriaSetWithDimensions = EvaluationCriteriaSet & {
  dimensions: EvaluationDimension[];
};

export type { EvaluationScore, DetailedFeedback, ActionGuide, ConversationGuide, DevelopmentPlan, PlanItem, ScoringRubric, EvaluationEvidence } from "./types";
