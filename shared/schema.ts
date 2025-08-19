import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const conversations = pgTable("conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scenarioId: text("scenario_id").notNull(),
  scenarioName: text("scenario_name").notNull(),
  messages: jsonb("messages").notNull().$type<ConversationMessage[]>(),
  turnCount: integer("turn_count").notNull().default(0),
  status: text("status").notNull().default("active"), // active, completed
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  completedAt: timestamp("completed_at"),
});

export const feedbacks = pgTable("feedbacks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => conversations.id),
  overallScore: integer("overall_score").notNull(), // 0-100
  scores: jsonb("scores").notNull().$type<EvaluationScore[]>(),
  detailedFeedback: jsonb("detailed_feedback").notNull().$type<DetailedFeedback>(),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export type ConversationMessage = {
  sender: "user" | "ai";
  message: string;
  timestamp: string;
};

export type EvaluationScore = {
  category: string;
  name: string;
  score: number; // 0-2
  feedback: string;
  icon: string;
  color: string;
};

export type DetailedFeedback = {
  strengths: string[];
  improvements: string[];
  nextSteps: string[];
  ranking: string;
};

export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});

export const insertFeedbackSchema = createInsertSchema(feedbacks).omit({
  id: true,
  createdAt: true,
});

export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type InsertFeedback = z.infer<typeof insertFeedbackSchema>;
export type Conversation = typeof conversations.$inferSelect;
export type Feedback = typeof feedbacks.$inferSelect;
