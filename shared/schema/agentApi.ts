import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, boolean, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./users";
import { organizations } from "./users";

// ─────────────────────────────────────────────────────────────
// agent_api_keys
// ─────────────────────────────────────────────────────────────
export const agentApiKeys = pgTable("agent_api_keys", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(),
  keyHash: varchar("key_hash").notNull(),
  keyPrefix: varchar("key_prefix", { length: 16 }).notNull(),
  environment: varchar("environment", { length: 10 }).notNull().default("live"),
  ownerUserId: varchar("owner_user_id").notNull().references(() => users.id),
  organizationId: varchar("organization_id").notNull(),
  scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
  allowedIps: text("allowed_ips").array().notNull().default(sql`'{}'::text[]`),
  allowedOrigins: text("allowed_origins").array().notNull().default(sql`'{}'::text[]`),
  rateLimitPerMinute: integer("rate_limit_per_minute").notNull().default(60),
  expiresAt: timestamp("expires_at"),
  lastUsedAt: timestamp("last_used_at"),
  revokedAt: timestamp("revoked_at"),
  revokedByUserId: varchar("revoked_by_user_id").references(() => users.id),
  revocationReason: text("revocation_reason"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_agent_api_keys_key_hash").on(table.keyHash),
  index("idx_agent_api_keys_key_prefix").on(table.keyPrefix),
  index("idx_agent_api_keys_org_id").on(table.organizationId),
  index("idx_agent_api_keys_owner").on(table.ownerUserId),
]);

export const insertAgentApiKeySchema = createInsertSchema(agentApiKeys).omit({
  id: true,
  keyHash: true,
  lastUsedAt: true,
  revokedAt: true,
  revokedByUserId: true,
  revocationReason: true,
  createdAt: true,
});
export type InsertAgentApiKey = z.infer<typeof insertAgentApiKeySchema>;
export type AgentApiKey = typeof agentApiKeys.$inferSelect;

// ─────────────────────────────────────────────────────────────
// agent_key_scenarios  (per-key scenario access control)
// ─────────────────────────────────────────────────────────────
export const agentKeyScenarios = pgTable("agent_key_scenarios", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  agentKeyId: varchar("agent_key_id").notNull().references(() => agentApiKeys.id, { onDelete: "cascade" }),
  scenarioId: text("scenario_id").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_agent_key_scenarios_unique").on(table.agentKeyId, table.scenarioId),
  index("idx_agent_key_scenarios_key").on(table.agentKeyId),
]);

export type AgentKeyScenario = typeof agentKeyScenarios.$inferSelect;

// ─────────────────────────────────────────────────────────────
// agent_sessions
// ─────────────────────────────────────────────────────────────
export const agentSessions = pgTable("agent_sessions", {
  id: varchar("id").primaryKey(),
  agentKeyId: varchar("agent_key_id").notNull().references(() => agentApiKeys.id),
  organizationId: varchar("organization_id").notNull(),
  externalUserId: varchar("external_user_id").notNull(),
  externalSessionId: varchar("external_session_id"),
  personaRunId: varchar("persona_run_id"),
  scenarioId: text("scenario_id").notNull(),
  personaId: text("persona_id").notNull(),
  language: varchar("language", { length: 5 }).notNull().default("ko"),
  difficulty: integer("difficulty").notNull().default(4),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  lastActivityAt: timestamp("last_activity_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  endedAt: timestamp("ended_at"),
}, (table) => [
  index("idx_agent_sessions_key_id").on(table.agentKeyId),
  index("idx_agent_sessions_org_id").on(table.organizationId),
  index("idx_agent_sessions_status").on(table.status),
  index("idx_agent_sessions_external_session").on(table.organizationId, table.externalSessionId),
]);

export const insertAgentSessionSchema = createInsertSchema(agentSessions).omit({
  createdAt: true,
});
export type InsertAgentSession = z.infer<typeof insertAgentSessionSchema>;
export type AgentSession = typeof agentSessions.$inferSelect;

// ─────────────────────────────────────────────────────────────
// agent_idempotency_keys
// ─────────────────────────────────────────────────────────────
export const agentIdempotencyKeys = pgTable("agent_idempotency_keys", {
  key: varchar("key").notNull(),
  agentKeyId: varchar("agent_key_id").notNull().references(() => agentApiKeys.id, { onDelete: "cascade" }),
  requestHash: varchar("request_hash").notNull(),
  responseBody: jsonb("response_body").$type<any>(),
  statusCode: integer("status_code").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_agent_idempotency_keys_primary").on(table.key, table.agentKeyId),
  index("idx_agent_idempotency_keys_expires").on(table.expiresAt),
]);

export type AgentIdempotencyKey = typeof agentIdempotencyKeys.$inferSelect;

// ─────────────────────────────────────────────────────────────
// agent_usage_daily
// ─────────────────────────────────────────────────────────────
export const agentUsageDaily = pgTable("agent_usage_daily", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  agentKeyId: varchar("agent_key_id").notNull().references(() => agentApiKeys.id),
  date: varchar("date", { length: 10 }).notNull(),
  requestCount: integer("request_count").notNull().default(0),
  sessionCount: integer("session_count").notNull().default(0),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  cachedTokens: integer("cached_tokens").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  avgLatencyMs: integer("avg_latency_ms"),
}, (table) => [
  uniqueIndex("idx_agent_usage_daily_unique").on(table.organizationId, table.agentKeyId, table.date),
  index("idx_agent_usage_daily_org").on(table.organizationId),
  index("idx_agent_usage_daily_date").on(table.date),
]);

export type AgentUsageDaily = typeof agentUsageDaily.$inferSelect;

// ─────────────────────────────────────────────────────────────
// audit_logs
// ─────────────────────────────────────────────────────────────
export const auditLogs = pgTable("audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  actorUserId: varchar("actor_user_id").references(() => users.id),
  organizationId: varchar("organization_id"),
  action: varchar("action").notNull(),
  targetType: varchar("target_type"),
  targetId: varchar("target_id"),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  ip: varchar("ip"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_audit_logs_actor").on(table.actorUserId),
  index("idx_audit_logs_org").on(table.organizationId),
  index("idx_audit_logs_action").on(table.action),
  index("idx_audit_logs_created").on(table.createdAt),
]);

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
  id: true,
  createdAt: true,
});
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;

// ─────────────────────────────────────────────────────────────
// Agent API response type schemas
// ─────────────────────────────────────────────────────────────

export const agentNpcEmotionsSchema = z.object({
  anger: z.number(),
  trust: z.number(),
  confusion: z.number(),
  interest: z.number(),
});

export const agentTurnScoreSchema = z.object({
  turnId: z.string(),
  turnIndex: z.number(),
  clarity: z.number(),
  empathy: z.number(),
  logic: z.number(),
  ownership: z.number(),
  actionPlan: z.number(),
  total: z.number(),
  hint: z.string().optional(),
  evaluationMethod: z.enum(["llm", "rule", "hybrid"]),
  evaluationConfidence: z.number(),
});
export type AgentTurnScore = z.infer<typeof agentTurnScoreSchema>;

export const agentSimulationStateSchema = z.object({
  version: z.number(),
  stage: z.enum(["intro", "conflict", "negotiation", "escalation", "resolution"]),
  pressureLevel: z.number(),
  npcEmotions: agentNpcEmotionsSchema,
  currentScore: z.number(),
  recentTurnScores: z.array(agentTurnScoreSchema),
  summary: z.object({
    totalTurns: z.number(),
    totalIncidents: z.number(),
    averageScore: z.number(),
    maxAnger: z.number(),
    minTrust: z.number(),
  }),
});
export type AgentSimulationState = z.infer<typeof agentSimulationStateSchema>;

export const agentUsageSchema = z.object({
  requestCount: z.number(),
  messageCount: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
});
export type AgentUsage = z.infer<typeof agentUsageSchema>;

export const agentMessageResponseSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  turnId: z.string(),
  reply: z.object({
    text: z.string(),
    emotionLabel: z.string().nullable(),
    emotionReason: z.string().nullable(),
  }),
  simulationState: agentSimulationStateSchema.nullable(),
  turnScore: agentTurnScoreSchema.nullable(),
  usage: agentUsageSchema.nullable(),
  requestId: z.string(),
});
export type AgentMessageResponse = z.infer<typeof agentMessageResponseSchema>;

export const agentEndSessionResponseSchema = z.object({
  sessionId: z.string(),
  status: z.literal("ended"),
  endedAt: z.string(),
  feedbackReport: z.record(z.any()).nullable(),
  requestId: z.string(),
});
export type AgentEndSessionResponse = z.infer<typeof agentEndSessionResponseSchema>;

// ─────────────────────────────────────────────────────────────
// agent_webhooks
// ─────────────────────────────────────────────────────────────
export const agentWebhooks = pgTable("agent_webhooks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  agentKeyId: varchar("agent_key_id").notNull().references(() => agentApiKeys.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  events: text("events").array().notNull().default(sql`'{}'::text[]`),
  secretKey: varchar("secret_key").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_agent_webhooks_key_id").on(table.agentKeyId),
  index("idx_agent_webhooks_active").on(table.agentKeyId, table.isActive),
]);

export const insertAgentWebhookSchema = createInsertSchema(agentWebhooks).omit({
  id: true,
  createdAt: true,
});
export type InsertAgentWebhook = z.infer<typeof insertAgentWebhookSchema>;
export type AgentWebhook = typeof agentWebhooks.$inferSelect;

// ─────────────────────────────────────────────────────────────
// agent_webhook_deliveries
// ─────────────────────────────────────────────────────────────
export const agentWebhookDeliveries = pgTable("agent_webhook_deliveries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  webhookId: varchar("webhook_id").notNull().references(() => agentWebhooks.id, { onDelete: "cascade" }),
  deliveryId: varchar("delivery_id").notNull(),
  event: varchar("event").notNull(),
  payload: jsonb("payload").$type<Record<string, any>>().notNull(),
  statusCode: integer("status_code"),
  attempt: integer("attempt").notNull().default(1),
  succeededAt: timestamp("succeeded_at"),
  nextRetryAt: timestamp("next_retry_at"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_agent_webhook_deliveries_webhook").on(table.webhookId),
  index("idx_agent_webhook_deliveries_retry").on(table.nextRetryAt),
]);

export type AgentWebhookDelivery = typeof agentWebhookDeliveries.$inferSelect;

// ─────────────────────────────────────────────────────────────
// Scope definitions
// ─────────────────────────────────────────────────────────────
export const AGENT_API_SCOPES = [
  "scenarios:read",
  "personas:read",
  "sessions:create",
  "sessions:read",
  "sessions:message",
  "sessions:end",
  "usage:read",
  "webhooks:manage",
] as const;

export type AgentApiScope = typeof AGENT_API_SCOPES[number];
