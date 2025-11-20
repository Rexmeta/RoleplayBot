import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const conversations = pgTable("conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id), // 사용자별 대화 관리
  scenarioId: text("scenario_id").notNull(),
  personaId: text("persona_id"), // 레거시 지원용
  personaSnapshot: jsonb("persona_snapshot"), // 대화 생성 시점의 페르소나 정보 스냅샷 (시나리오 수정 시 과거 기록 보호)
  scenarioName: text("scenario_name").notNull(),
  messages: jsonb("messages").notNull().$type<ConversationMessage[]>(),
  turnCount: integer("turn_count").notNull().default(0),
  status: text("status").notNull().default("active"), // active, completed
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  completedAt: timestamp("completed_at"),
  // 전략적 대화 시스템 추가 필드
  conversationType: text("conversation_type").notNull().default("single"), // single, sequential
  currentPhase: integer("current_phase").default(1), // 현재 대화 단계
  totalPhases: integer("total_phases").default(1), // 총 대화 단계 수
  personaSelections: jsonb("persona_selections").$type<PersonaSelection[]>(), // 페르소나 선택 기록
  strategyChoices: jsonb("strategy_choices").$type<StrategyChoice[]>(), // 전략적 선택 기록
  sequenceAnalysis: jsonb("sequence_analysis").$type<SequenceAnalysis>(), // 순서 분석 결과
  strategyReflection: text("strategy_reflection"), // 사용자의 전략 회고 텍스트
  conversationOrder: jsonb("conversation_order").$type<string[]>(), // 실제 대화한 순서 (페르소나 ID 배열)
  mode: text("mode").notNull().default("text"), // text, tts, realtime_voice
  difficulty: integer("difficulty").notNull().default(4), // 사용자가 선택한 난이도 (1-4)
});

export const feedbacks = pgTable("feedbacks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").references(() => conversations.id), // 레거시 지원 (nullable)
  personaRunId: varchar("persona_run_id").references(() => personaRuns.id, { onDelete: 'cascade' }), // 새 구조 (nullable, 마이그레이션 후 non-null로 전환)
  overallScore: integer("overall_score").notNull(), // 0-100
  scores: jsonb("scores").notNull().$type<EvaluationScore[]>(),
  detailedFeedback: jsonb("detailed_feedback").notNull().$type<DetailedFeedback>(),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_feedbacks_conversation_id").on(table.conversationId),
  index("idx_feedbacks_persona_run_id").on(table.personaRunId),
]);

// Session storage table - 인증 시스템용
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User storage table - 이메일 기반 인증 시스템용
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique().notNull(),
  password: varchar("password").notNull(), // 해시된 비밀번호
  name: varchar("name").notNull(), // 사용자 이름
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// 새로운 데이터 구조: 시나리오 실행 (1회 플레이)
export const scenarioRuns = pgTable("scenario_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  scenarioId: text("scenario_id").notNull(),
  scenarioName: text("scenario_name").notNull(),
  attemptNumber: integer("attempt_number").notNull(), // 해당 사용자가 이 시나리오를 몇 번째 시도하는지
  status: text("status").notNull().default("in_progress"), // in_progress, completed
  totalScore: integer("total_score"), // 전체 점수 (0-100)
  difficulty: integer("difficulty").notNull().default(4), // 난이도 (1-4)
  mode: text("mode").notNull().default("text"), // text, tts, realtime_voice
  conversationOrder: jsonb("conversation_order").$type<string[]>(), // 페르소나 대화 순서
  personaSelections: jsonb("persona_selections").$type<PersonaSelection[]>(), // 페르소나 선택 기록
  strategyChoices: jsonb("strategy_choices").$type<StrategyChoice[]>(), // 전략적 선택 기록
  sequenceAnalysis: jsonb("sequence_analysis").$type<SequenceAnalysis>(), // 순서 분석 결과
  strategyReflection: text("strategy_reflection"), // 사용자의 전략 회고 텍스트
  startedAt: timestamp("started_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("idx_scenario_runs_user_id").on(table.userId),
  index("idx_scenario_runs_scenario_id").on(table.scenarioId),
]);

// 페르소나별 대화 세션
export const personaRuns = pgTable("persona_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scenarioRunId: varchar("scenario_run_id").notNull().references(() => scenarioRuns.id, { onDelete: 'cascade' }),
  personaId: text("persona_id").notNull(),
  personaSnapshot: jsonb("persona_snapshot"), // 대화 생성 시점의 페르소나 정보 스냅샷
  phase: integer("phase").notNull(), // 몇 번째 대화인지 (1, 2, ...)
  status: text("status").notNull().default("active"), // active, completed
  turnCount: integer("turn_count").notNull().default(0),
  score: integer("score"), // 이 페르소나와의 대화 점수 (0-100)
  startedAt: timestamp("started_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("idx_persona_runs_scenario_run_id").on(table.scenarioRunId),
  index("idx_persona_runs_persona_id").on(table.personaId),
]);

// 실제 대화 메시지 턴
export const chatMessages = pgTable("chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  personaRunId: varchar("persona_run_id").notNull().references(() => personaRuns.id, { onDelete: 'cascade' }),
  turnIndex: integer("turn_index").notNull(), // 대화 순서 (0, 1, 2, ...)
  sender: text("sender").notNull(), // 'user' or 'ai'
  message: text("message").notNull(),
  emotion: text("emotion"), // AI 감정 (😊, 😢, 😠, 😲, 😐)
  emotionReason: text("emotion_reason"), // 감정 이유
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_chat_messages_persona_run_id").on(table.personaRunId),
]);

export type ConversationMessage = {
  sender: "user" | "ai";
  message: string;
  timestamp: string;
  emotion?: string;
  emotionReason?: string;
  personaId?: string; // 다중 페르소나 대화용
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
    // 전략적 대화 선택 평가 추가
    strategicSelection?: number; // 대화 순서와 선택의 논리성
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
  // 전략적 선택 분석 추가
  sequenceAnalysis?: SequenceAnalysis;
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

// 전략적 대화 선택 시스템 타입 정의
export type PersonaSelection = {
  phase: number; // 몇 번째 대화 선택인지
  personaId: string; // 선택된 페르소나 ID
  selectionReason: string; // 선택 사유
  timestamp: string; // 선택 시간
  expectedOutcome: string; // 기대하는 결과
};

export type StrategyChoice = {
  phase: number;
  choice: string; // 전략적 선택 내용
  reasoning: string; // 선택 근거
  expectedImpact: string; // 기대 효과
  actualOutcome?: string; // 실제 결과 (대화 완료 후)
  effectiveness?: number; // 효과성 점수 (1-5)
};

export type PersonaStatus = {
  personaId: string;
  name: string;
  currentMood: 'positive' | 'neutral' | 'negative' | 'unknown'; // 현재 기분
  approachability: number; // 접근 용이성 (1-5)
  influence: number; // 영향력 (1-5)
  hasBeenContacted: boolean; // 이미 대화했는지 여부
  lastInteractionResult?: 'success' | 'neutral' | 'failure'; // 마지막 대화 결과
  availableInfo: string[]; // 이 인물로부터 얻을 수 있는 정보
  keyRelationships: string[]; // 주요 인물 관계
};

export type SequenceAnalysis = {
  selectionOrder?: number[]; // 선택한 순서 (이전 시스템용, 옵셔널)
  optimalOrder?: number[]; // 최적 순서 (이전 시스템용, 옵셔널)
  orderScore?: number; // 순서의 논리성 점수 (1-5) (이전 시스템용, 옵셔널)
  reasoningQuality?: number; // 사유 논리성 점수 (1-5) (이전 시스템용, 옵셔널)
  strategicThinking?: number; // 전략적 사고 점수 (1-5) (이전 시스템용, 옵셔널)
  adaptability?: number; // 상황 적응력 점수 (1-5) (이전 시스템용, 옵셔널)
  overallEffectiveness?: number; // 전반적 효과성 (1-5) (이전 시스템용, 옵셔널)
  detailedAnalysis?: string; // 상세 분석 내용 (이전 시스템용, 옵셔널)
  improvements?: string[]; // 개선 사항 (이전 시스템용, 옵셔널)
  strengths?: string[]; // 강점 (이전 시스템용, 옵셔널)
  // 새로운 전략 회고 기반 평가 필드
  strategicScore?: number; // 전략 점수 (0-100)
  strategicRationale?: string; // 전략 점수 이유
  sequenceEffectiveness?: string; // 순서 선택의 효과성 평가
  alternativeApproaches?: string[]; // 대안적 접근법
  strategicInsights?: string; // 전략적 통찰
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

// Strategic Selection Insert Schemas
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

export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type InsertFeedback = z.infer<typeof insertFeedbackSchema>;
export type Conversation = typeof conversations.$inferSelect;
export type Feedback = typeof feedbacks.$inferSelect;

// 새로운 데이터 구조 타입들
export const insertScenarioRunSchema = createInsertSchema(scenarioRuns).omit({
  id: true,
  startedAt: true,
  completedAt: true,
});

export const insertPersonaRunSchema = createInsertSchema(personaRuns).omit({
  id: true,
  startedAt: true,
  completedAt: true,
});

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({
  id: true,
  createdAt: true,
});

export type InsertScenarioRun = z.infer<typeof insertScenarioRunSchema>;
export type InsertPersonaRun = z.infer<typeof insertPersonaRunSchema>;
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ScenarioRun = typeof scenarioRuns.$inferSelect;
export type PersonaRun = typeof personaRuns.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;

// User types for email-based authentication
export type CreateUser = {
  email: string;
  password: string;
  name: string;
};

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
