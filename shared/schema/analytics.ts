import { sql } from "drizzle-orm";
import { pgTable, varchar, integer, boolean, timestamp, jsonb, doublePrecision, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./users";
import { organizations } from "./users";
import type { AiUsageSummary, AiUsageByFeature, AiUsageByModel, AiUsageDaily } from "./types";

export const aiUsageLogs = pgTable("ai_usage_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  occurredAt: timestamp("occurred_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  feature: varchar("feature").notNull(),
  model: varchar("model").notNull(),
  provider: varchar("provider").notNull(),
  userId: varchar("user_id").references(() => users.id),
  conversationId: varchar("conversation_id"),
  requestId: varchar("request_id"),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  cachedTokens: integer("cached_tokens").notNull().default(0),
  inputCostUsd: doublePrecision("input_cost_usd").notNull().default(0),
  outputCostUsd: doublePrecision("output_cost_usd").notNull().default(0),
  totalCostUsd: doublePrecision("total_cost_usd").notNull().default(0),
  durationMs: integer("duration_ms"),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  agentKeyId: varchar("agent_key_id"),
  tokensEstimated: boolean("tokens_estimated").notNull().default(false),
}, (table) => [
  index("idx_ai_usage_logs_occurred_at").on(table.occurredAt),
  index("idx_ai_usage_logs_feature").on(table.feature),
  index("idx_ai_usage_logs_user_id").on(table.userId),
  index("idx_ai_usage_logs_model").on(table.model),
]);

export const hrBenchmarkTargets = pgTable("hr_benchmark_targets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  dimensionKey: varchar("dimension_key").notNull(),
  dimensionName: varchar("dimension_name").notNull().default(""),
  targetScore: doublePrecision("target_score").notNull().default(3.5),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_hr_benchmark_targets_org_id").on(table.orgId),
]);

export const insertAiUsageLogSchema = createInsertSchema(aiUsageLogs).omit({
  id: true,
  occurredAt: true,
});
export type InsertAiUsageLog = z.infer<typeof insertAiUsageLogSchema>;
export type AiUsageLog = typeof aiUsageLogs.$inferSelect;

export const insertHrBenchmarkTargetSchema = createInsertSchema(hrBenchmarkTargets).omit({
  id: true,
  updatedAt: true,
});
export type InsertHrBenchmarkTarget = z.infer<typeof insertHrBenchmarkTargetSchema>;
export type HrBenchmarkTarget = typeof hrBenchmarkTargets.$inferSelect;

export type { AiUsageSummary, AiUsageByFeature, AiUsageByModel, AiUsageDaily } from "./types";
