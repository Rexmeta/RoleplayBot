import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const conversations = pgTable("conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scenarioId: text("scenario_id").notNull(),
  personaId: text("persona_id"), // 새로운 시나리오 시스템용
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
  emotion?: string;
  emotionReason?: string;
};

export type EvaluationScore = {
  category: string;
  name: string;
  score: number; // 1-5 (ComOn Check 5-point scale)
  feedback: string;
  icon: string;
  color: string;
};

export type DetailedFeedback = {
  overallScore: number;
  scores: {
    clarityLogic: number;
    listeningEmpathy: number;
    appropriatenessAdaptability: number;
    persuasivenessImpact: number;
    strategicCommunication: number;
  };
  strengths: string[];
  improvements: string[];
  nextSteps: string[];
  summary: string;
  ranking?: string;
  behaviorGuides?: ActionGuide[];
  conversationGuides?: ConversationGuide[];
  developmentPlan?: DevelopmentPlan;
  conversationDuration?: number; // 대화 총 소요 시간 (분)
  averageResponseTime?: number; // 평균 응답 시간 (초)
  timePerformance?: {
    rating: 'excellent' | 'good' | 'average' | 'slow';
    feedback: string;
  };
};

export type ActionGuide = {
  situation: string;
  action: string;
  example: string;
  impact: string;
};

export type ConversationGuide = {
  scenario: string;
  goodExample: string;
  badExample: string;
  keyPoints: string[];
};

export type DevelopmentPlan = {
  shortTerm: PlanItem[];  // 1-2주 내
  mediumTerm: PlanItem[];  // 1-2개월 내
  longTerm: PlanItem[];    // 3-6개월 내
  recommendedResources: string[];
};

export type PlanItem = {
  goal: string;
  actions: string[];
  measurable: string;  // 측정 가능한 목표
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

// ScenarioPersona type for shared use between frontend and backend
export interface ScenarioPersona {
  id: string;
  name: string;
  role: string;
  department: string;
  experience: string;
  gender?: 'male' | 'female';
  personality: {
    traits: string[];
    communicationStyle: string;
    motivation: string;
    fears: string[];
  };
  background: {
    education: string;
    previousExperience: string;
    majorProjects: string[];
    expertise: string[];
  };
  currentSituation: {
    workload: string;
    pressure: string;
    concerns: string[];
    position: string;
  };
  communicationPatterns: {
    openingStyle: string;
    keyPhrases: string[];
    responseToArguments: Record<string, string>;
    winConditions: string[];
  };
  image: string;
  voice: {
    tone: string;
    pace: string;
    emotion: string;
  };
  stance?: string;
  goal?: string;
  tradeoff?: string;
  mbti?: string;
}

export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type InsertFeedback = z.infer<typeof insertFeedbackSchema>;
export type Conversation = typeof conversations.$inferSelect;
export type Feedback = typeof feedbacks.$inferSelect;
