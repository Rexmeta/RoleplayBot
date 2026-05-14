import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { users } from "./users";
import { scenarioRuns } from "./scenarios";
import type {
  ConversationMessage,
  PersonaSelection,
  StrategyChoice,
  SequenceAnalysis,
} from "./types";

export const conversations = pgTable("conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  scenarioId: text("scenario_id").notNull(),
  personaId: text("persona_id"),
  personaSnapshot: jsonb("persona_snapshot"),
  scenarioName: text("scenario_name").notNull(),
  messages: jsonb("messages").notNull().$type<ConversationMessage[]>(),
  turnCount: integer("turn_count").notNull().default(0),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  completedAt: timestamp("completed_at"),
  conversationType: text("conversation_type").notNull().default("single"),
  currentPhase: integer("current_phase").default(1),
  totalPhases: integer("total_phases").default(1),
  personaSelections: jsonb("persona_selections").$type<PersonaSelection[]>(),
  strategyChoices: jsonb("strategy_choices").$type<StrategyChoice[]>(),
  sequenceAnalysis: jsonb("sequence_analysis").$type<SequenceAnalysis>(),
  strategyReflection: text("strategy_reflection"),
  conversationOrder: jsonb("conversation_order").$type<string[]>(),
  mode: text("mode").notNull().default("text"),
  difficulty: integer("difficulty").notNull().default(2),
});

export const personaRuns = pgTable("persona_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scenarioRunId: varchar("scenario_run_id").notNull().references(() => scenarioRuns.id, { onDelete: 'cascade' }),
  conversationId: varchar("conversation_id").references(() => conversations.id, { onDelete: 'cascade' }),
  personaId: text("persona_id").notNull(),
  personaName: text("persona_name"),
  personaSnapshot: jsonb("persona_snapshot"),
  mbtiType: text("mbti_type"),
  phase: integer("phase"),
  status: text("status").notNull().default("active"),
  turnCount: integer("turn_count").notNull().default(0),
  score: integer("score"),
  mode: text("mode").notNull().default("text"),
  difficulty: integer("difficulty").notNull().default(2),
  simulationState: jsonb("simulation_state"),
  startedAt: timestamp("started_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  actualStartedAt: timestamp("actual_started_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("idx_persona_runs_scenario_run_id").on(table.scenarioRunId),
  index("idx_persona_runs_persona_id").on(table.personaId),
  index("idx_persona_runs_conversation_id").on(table.conversationId),
]);

export const simulationEvents = pgTable("simulation_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  personaRunId: varchar("persona_run_id").notNull().references(() => personaRuns.id, { onDelete: 'cascade' }),
  scenarioRunId: varchar("scenario_run_id"),
  turnIndex: integer("turn_index").notNull().default(0),
  turnId: varchar("turn_id"),
  eventType: varchar("event_type").notNull(),
  toolName: varchar("tool_name"),
  args: jsonb("args"),
  result: jsonb("result"),
  stateBefore: jsonb("state_before"),
  stateAfter: jsonb("state_after"),
  stateVersionBefore: integer("state_version_before"),
  stateVersionAfter: integer("state_version_after"),
  includeInReport: boolean("include_in_report").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_simulation_events_persona_run_id").on(table.personaRunId),
  index("idx_simulation_events_turn_index").on(table.turnIndex),
]);

export const chatMessages = pgTable("chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  personaRunId: varchar("persona_run_id").notNull().references(() => personaRuns.id, { onDelete: 'cascade' }),
  turnIndex: integer("turn_index").notNull(),
  sender: text("sender").notNull(),
  message: text("message").notNull(),
  emotion: text("emotion"),
  emotionReason: text("emotion_reason"),
  interrupted: boolean("interrupted").default(false),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_chat_messages_persona_run_id").on(table.personaRunId),
]);

export const insertSimulationEventSchema = createInsertSchema(simulationEvents).omit({
  id: true,
  createdAt: true,
});
export type InsertSimulationEvent = z.infer<typeof insertSimulationEventSchema>;
export type SimulationEvent = typeof simulationEvents.$inferSelect;

export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Conversation = typeof conversations.$inferSelect;

export const insertPersonaRunSchema = createInsertSchema(personaRuns).omit({
  id: true,
  startedAt: true,
  completedAt: true,
});
export type InsertPersonaRun = z.infer<typeof insertPersonaRunSchema>;
export type PersonaRun = typeof personaRuns.$inferSelect;

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({
  id: true,
}).extend({
  createdAt: z.date().optional(),
});
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;

export const insertPersonaSelectionSchema = z.object({
  phase: z.number().int().min(1, "Phase must be at least 1"),
  personaId: z.string().min(1, "Persona ID is required"),
  selectionReason: z.string().min(1, "Selection reason is required"),
  timestamp: z.string().optional().default(() => new Date().toISOString()),
  expectedOutcome: z.string().optional().default(""),
});

export const insertStrategyChoiceSchema = z.object({
  phase: z.number().int().min(1, "Phase must be at least 1"),
  choice: z.string().min(1, "Choice is required"),
  reasoning: z.string().min(1, "Reasoning is required"),
  expectedImpact: z.string().optional().default(""),
  actualOutcome: z.string().optional(),
  effectiveness: z.number().int().min(1).max(5).optional(),
});

export const insertSequenceAnalysisSchema = z.object({
  selectionOrder: z.array(z.number().int().min(1)).min(1, "Selection order must not be empty"),
  optimalOrder: z.array(z.number().int().min(1)).min(1, "Optimal order must not be empty"),
  orderScore: z.number().int().min(1).max(5, "Order score must be between 1-5"),
  reasoningQuality: z.number().int().min(1).max(5, "Reasoning quality must be between 1-5"),
  strategicThinking: z.number().int().min(1).max(5, "Strategic thinking must be between 1-5"),
  adaptability: z.number().int().min(1).max(5, "Adaptability must be between 1-5"),
  overallEffectiveness: z.number().int().min(1).max(5, "Overall effectiveness must be between 1-5"),
  detailedAnalysis: z.string().min(1, "Detailed analysis is required"),
  improvements: z.array(z.string()).default([]),
  strengths: z.array(z.string()).default([]),
});

export type InsertPersonaSelection = z.infer<typeof insertPersonaSelectionSchema>;
export type InsertStrategyChoice = z.infer<typeof insertStrategyChoiceSchema>;
export type InsertSequenceAnalysis = z.infer<typeof insertSequenceAnalysisSchema>;

export type { ConversationMessage, PersonaSelection, StrategyChoice, PersonaStatus, SequenceAnalysis } from "./types";
