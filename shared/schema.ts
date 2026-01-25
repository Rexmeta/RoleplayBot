import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, jsonb, index, boolean, doublePrecision } from "drizzle-orm/pg-core";
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
  difficulty: integer("difficulty").notNull().default(2), // 사용자가 선택한 난이도 (1-4), 기본값: 기본 난이도
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

// 시나리오 카테고리 테이블
export const categories = pgTable("categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull().unique(), // 카테고리 이름 (예: 온보딩, 리더십, 경영지원, 기타)
  description: text("description"), // 카테고리 설명
  order: integer("order").notNull().default(0), // 정렬 순서
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// 시나리오 테이블 - JSON 파일에서 DB로 마이그레이션
export const scenarios = pgTable("scenarios", {
  id: varchar("id").primaryKey(), // 시나리오 ID (예: "골든타임-4시간-긴급-2025-12-17T22-43-28")
  title: text("title").notNull(), // 기본 표시용 제목 (원본 언어)
  description: text("description").notNull(), // 기본 표시용 설명 (원본 언어)
  sourceLocale: varchar("source_locale", { length: 10 }).notNull().default('ko'), // 원본 작성 언어
  difficulty: integer("difficulty").notNull().default(4), // 1-4 난이도, 기본값 4로 변경
  estimatedTime: text("estimated_time"), // 예: "60-90분"
  skills: text("skills").array(), // 주요 역량 배열
  categoryId: varchar("category_id").references(() => categories.id),
  image: text("image"), // 이미지 경로
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
  }>(), // 상황, 타임라인, 이해관계, 플레이어 역할
  objectives: text("objectives").array(), // 목표 배열
  successCriteria: jsonb("success_criteria").$type<{
    optimal: string;
    good: string;
    acceptable: string;
    failure: string;
  }>(), // 성공 기준
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
  }>>(), // 시나리오별 페르소나 설정
  recommendedFlow: text("recommended_flow").array(), // 추천 순서
  evaluationCriteriaSetId: varchar("evaluation_criteria_set_id"), // 평가 기준 세트 ID
  isDemo: boolean("is_demo").notNull().default(false), // 게스트 데모용 시나리오 여부
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_scenarios_category_id").on(table.categoryId),
  index("idx_scenarios_difficulty").on(table.difficulty),
]);

// MBTI 페르소나 테이블 - personas 폴더에서 DB로 마이그레이션
export const mbtiPersonas = pgTable("mbti_personas", {
  id: varchar("id").primaryKey(), // MBTI 유형 (예: "enfj", "istp")
  mbti: varchar("mbti").notNull(), // MBTI 유형 대문자 (예: "ENFJ")
  gender: varchar("gender"), // male, female
  personalityTraits: text("personality_traits").array(), // 성격 특성 배열
  communicationStyle: text("communication_style"), // 커뮤니케이션 스타일
  motivation: text("motivation"), // 동기
  fears: text("fears").array(), // 두려움 배열
  background: jsonb("background").$type<{
    personal_values: string[];
    hobbies: string[];
    social: {
      preference: string;
      behavior: string;
    };
  }>(), // 배경 정보
  communicationPatterns: jsonb("communication_patterns").$type<{
    opening_style: string;
    key_phrases: string[];
    response_to_arguments: Record<string, string>;
    win_conditions: string[];
  }>(), // 커뮤니케이션 패턴
  voice: jsonb("voice").$type<{
    tone: string;
    pace: string;
    volume?: string;
    pitch?: string;
  }>(), // 음성 특성
  images: jsonb("images").$type<{
    base?: string;
    style?: string;
    male?: {
      expressions?: Record<string, string>;
    };
    female?: {
      expressions?: Record<string, string>;
    };
  }>(), // 표정 이미지 데이터
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// 시스템 설정 테이블 (키-값 저장)
export const systemSettings = pgTable("system_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  category: varchar("category").notNull(), // ai_model, evaluation, conversation, voice
  key: varchar("key").notNull(), // 설정 키
  value: text("value").notNull(), // 설정 값 (JSON 문자열 가능)
  description: text("description"), // 설정 설명
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedBy: varchar("updated_by").references(() => users.id), // 마지막 수정자
}, (table) => [
  index("idx_system_settings_category").on(table.category),
  index("idx_system_settings_key").on(table.key),
]);

// AI 사용량 로그 테이블 - 토큰 사용량 및 비용 추적
export const aiUsageLogs = pgTable("ai_usage_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  occurredAt: timestamp("occurred_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  feature: varchar("feature").notNull(), // conversation, feedback, strategy, scenario, realtime
  model: varchar("model").notNull(), // gemini-2.5-flash, gpt-4o 등
  provider: varchar("provider").notNull(), // google, openai
  userId: varchar("user_id").references(() => users.id), // 사용자 ID (nullable - 시스템 작업 시)
  conversationId: varchar("conversation_id"), // 관련 대화 ID (optional)
  requestId: varchar("request_id"), // 요청 추적용 고유 ID
  promptTokens: integer("prompt_tokens").notNull().default(0), // 입력 토큰 수
  completionTokens: integer("completion_tokens").notNull().default(0), // 출력 토큰 수
  totalTokens: integer("total_tokens").notNull().default(0), // 총 토큰 수
  inputCostUsd: doublePrecision("input_cost_usd").notNull().default(0), // 입력 비용 (USD)
  outputCostUsd: doublePrecision("output_cost_usd").notNull().default(0), // 출력 비용 (USD)
  totalCostUsd: doublePrecision("total_cost_usd").notNull().default(0), // 총 비용 (USD)
  durationMs: integer("duration_ms"), // 요청 소요 시간 (ms)
  metadata: jsonb("metadata").$type<Record<string, any>>(), // 추가 메타데이터
}, (table) => [
  index("idx_ai_usage_logs_occurred_at").on(table.occurredAt),
  index("idx_ai_usage_logs_feature").on(table.feature),
  index("idx_ai_usage_logs_user_id").on(table.userId),
  index("idx_ai_usage_logs_model").on(table.model),
]);

// User storage table - 이메일 기반 인증 시스템용
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique().notNull(),
  password: varchar("password").notNull(), // 해시된 비밀번호
  name: varchar("name").notNull(), // 사용자 이름
  role: varchar("role").notNull().default("user"), // admin, operator, user
  profileImage: varchar("profile_image"), // 프로필 이미지 URL
  tier: varchar("tier").notNull().default("bronze"), // 회원 등급: bronze, silver, gold, platinum, diamond
  preferredLanguage: varchar("preferred_language").notNull().default("ko"), // 선호 언어: ko, en, ja, zh
  isActive: boolean("is_active").notNull().default(true), // 계정 활성화 상태
  lastLoginAt: timestamp("last_login_at"), // 마지막 로그인 시간
  assignedCategoryId: varchar("assigned_category_id").references(() => categories.id), // 운영자가 담당하는 카테고리 (운영자만 해당)
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
  difficulty: integer("difficulty").notNull().default(2), // 사용자가 선택한 난이도 (1-4), 기본값: 기본 난이도
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
  conversationId: varchar("conversation_id").references(() => conversations.id, { onDelete: 'cascade' }), // 대화 재개를 위한 conversation 참조
  personaId: text("persona_id").notNull(),
  personaName: text("persona_name"), // 페르소나 이름 (MBTI 분석 및 표시용)
  personaSnapshot: jsonb("persona_snapshot"), // 대화 생성 시점의 페르소나 정보 스냅샷
  mbtiType: text("mbti_type"), // MBTI 유형 (예: "ISTJ", "ENFP") - MBTI 분석용
  phase: integer("phase"), // 몇 번째 대화인지 (1, 2, ...) - nullable for simple conversations
  status: text("status").notNull().default("active"), // active, completed
  turnCount: integer("turn_count").notNull().default(0),
  score: integer("score"), // 이 페르소나와의 대화 점수 (0-100)
  mode: text("mode").notNull().default("text"), // text, tts, realtime_voice - 대화 재개 시 필요
  difficulty: integer("difficulty").notNull().default(2), // 사용자가 선택한 난이도 (1-4), 기본값: 기본 난이도 - 대화 재개 시 필요
  startedAt: timestamp("started_at").notNull().default(sql`CURRENT_TIMESTAMP`), // 첫 생성 시간
  actualStartedAt: timestamp("actual_started_at").notNull().default(sql`CURRENT_TIMESTAMP`), // 실제 대화 시작/재개 시간 (매 재개마다 업데이트)
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("idx_persona_runs_scenario_run_id").on(table.scenarioRunId),
  index("idx_persona_runs_persona_id").on(table.personaId),
  index("idx_persona_runs_conversation_id").on(table.conversationId),
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
  interrupted: boolean("interrupted").default(false), // AI 발화가 사용자에 의해 중단됨 (barge-in)
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
  interrupted?: boolean; // AI 발화가 사용자에 의해 중단됨 (barge-in)
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
    strategicSelection?: number;
    [key: string]: number | undefined; // 동적 평가 기준 지원
  };
  strengths: string[];
  improvements: string[];
  nextSteps: string[];
  summary: string;
  ranking?: string;
  behaviorGuides?: ActionGuide[];
  conversationGuides?: ConversationGuide[];
  developmentPlan?: DevelopmentPlan;
  conversationDuration?: number;
  averageResponseTime?: number;
  timePerformance?: {
    rating: 'excellent' | 'good' | 'average' | 'slow';
    feedback: string;
  };
  sequenceAnalysis?: SequenceAnalysis;
  evaluationCriteriaSetId?: string; // 사용된 평가 기준 세트 ID
  evaluationCriteriaSetName?: string; // 사용된 평가 기준 세트 이름
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
}).extend({
  createdAt: z.date().optional(),
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
  assignedCategoryId?: string; // 운영자 회원가입 시 카테고리 지정
};

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

// Category types
export const insertCategorySchema = createInsertSchema(categories).omit({
  id: true,
  createdAt: true,
});

export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type Category = typeof categories.$inferSelect;

// Scenario types
export const insertScenarioSchema = createInsertSchema(scenarios).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertScenario = z.infer<typeof insertScenarioSchema>;
export type Scenario = typeof scenarios.$inferSelect;

// MBTI Persona types
export const insertMbtiPersonaSchema = createInsertSchema(mbtiPersonas).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertMbtiPersona = z.infer<typeof insertMbtiPersonaSchema>;
export type MbtiPersona = typeof mbtiPersonas.$inferSelect;

// System Settings types
export const insertSystemSettingSchema = createInsertSchema(systemSettings).omit({
  id: true,
  updatedAt: true,
});

export type InsertSystemSetting = z.infer<typeof insertSystemSettingSchema>;
export type SystemSetting = typeof systemSettings.$inferSelect;

// AI Usage Log types
export const insertAiUsageLogSchema = createInsertSchema(aiUsageLogs).omit({
  id: true,
  occurredAt: true,
});

export type InsertAiUsageLog = z.infer<typeof insertAiUsageLogSchema>;
export type AiUsageLog = typeof aiUsageLogs.$inferSelect;

// 평가 기준 세트 테이블 (운영자가 설정하는 평가 기준 그룹)
export const evaluationCriteriaSets = pgTable("evaluation_criteria_sets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name").notNull(), // 평가 기준 세트 이름 (예: "기본 커뮤니케이션 평가", "리더십 평가")
  description: text("description"), // 세트 설명
  isDefault: boolean("is_default").notNull().default(false), // 기본 평가 기준 여부
  isActive: boolean("is_active").notNull().default(true), // 활성화 여부
  categoryId: varchar("category_id").references(() => categories.id), // 특정 카테고리에만 적용 (null이면 전체)
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_criteria_sets_category").on(table.categoryId),
  index("idx_criteria_sets_default").on(table.isDefault),
]);

// 평가 지표 테이블 (각 평가 기준 세트에 속하는 개별 지표)
export const evaluationDimensions = pgTable("evaluation_dimensions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  criteriaSetId: varchar("criteria_set_id").notNull().references(() => evaluationCriteriaSets.id, { onDelete: 'cascade' }),
  key: varchar("key").notNull(), // 내부 키 (예: "clarityLogic", "empathy")
  name: varchar("name").notNull(), // 표시 이름 (예: "명확성 & 논리성")
  description: text("description"), // 지표 설명
  icon: varchar("icon").notNull().default("📊"), // 아이콘 이모지
  color: varchar("color").notNull().default("blue"), // 차트/UI 색상
  weight: doublePrecision("weight").notNull().default(20.0), // 가중치 (백분율 %, 전체 합계 100%)
  dimensionType: varchar("dimension_type").notNull().default("standard"), // 차원 유형: 'core' (필수), 'standard' (일반), 'bonus' (가점)
  minScore: integer("min_score").notNull().default(1), // 최소 점수
  maxScore: integer("max_score").notNull().default(5), // 최대 점수
  scoringRubric: jsonb("scoring_rubric").$type<ScoringRubric[]>(), // 점수별 평가 기준
  displayOrder: integer("display_order").notNull().default(0), // 표시 순서
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_dimensions_criteria_set").on(table.criteriaSetId),
  index("idx_dimensions_key").on(table.key),
]);

// 점수별 평가 기준 타입
export type ScoringRubric = {
  score: number; // 1, 2, 3, 4, 5
  label: string; // "매우 부족", "부족", "보통", "우수", "매우 우수"
  description: string; // 해당 점수를 받기 위한 조건 설명
};

// 평가 기준 세트 타입
export const insertEvaluationCriteriaSetSchema = createInsertSchema(evaluationCriteriaSets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertEvaluationCriteriaSet = z.infer<typeof insertEvaluationCriteriaSetSchema>;
export type EvaluationCriteriaSet = typeof evaluationCriteriaSets.$inferSelect;

// 평가 지표 타입
export const insertEvaluationDimensionSchema = createInsertSchema(evaluationDimensions).omit({
  id: true,
  createdAt: true,
});

export type InsertEvaluationDimension = z.infer<typeof insertEvaluationDimensionSchema>;
export type EvaluationDimension = typeof evaluationDimensions.$inferSelect;

// 평가 기준 세트 + 지표 통합 타입 (API 응답용)
export type EvaluationCriteriaSetWithDimensions = EvaluationCriteriaSet & {
  dimensions: EvaluationDimension[];
};

// AI Usage 집계 타입
export type AiUsageSummary = {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  totalCostUsd: number;
  requestCount: number;
};

export type AiUsageByFeature = {
  feature: string;
  totalTokens: number;
  totalCostUsd: number;
  requestCount: number;
};

export type AiUsageByModel = {
  model: string;
  provider: string;
  totalTokens: number;
  totalCostUsd: number;
  requestCount: number;
};

export type AiUsageDaily = {
  date: string;
  totalTokens: number;
  totalCostUsd: number;
  requestCount: number;
};

// ================================
// 다국어 콘텐츠 지원 테이블들
// ================================

// 지원 언어 테이블 - 언어 확장성을 위한 동적 관리
export const supportedLanguages = pgTable("supported_languages", {
  code: varchar("code", { length: 10 }).primaryKey(), // 'ko', 'en', 'ja', 'zh', 'vi', 'es' 등
  name: varchar("name").notNull(), // '한국어', 'English', '日本語' 등
  nativeName: varchar("native_name").notNull(), // 해당 언어로 된 이름
  isActive: boolean("is_active").notNull().default(true), // 활성화 여부
  isDefault: boolean("is_default").notNull().default(false), // 기본 언어 여부 (ko = true)
  displayOrder: integer("display_order").notNull().default(0), // 표시 순서
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// 시나리오 번역 테이블
export const scenarioTranslations = pgTable("scenario_translations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scenarioId: text("scenario_id").notNull(), // JSON 시나리오 ID 참조
  sourceLocale: varchar("source_locale", { length: 10 }).notNull().default('ko').references(() => supportedLanguages.code), // 원문 언어 (번역 소스)
  locale: varchar("locale", { length: 10 }).notNull().references(() => supportedLanguages.code), // 이 번역의 언어
  isOriginal: boolean("is_original").notNull().default(false), // 원본 콘텐츠 여부 (작성자가 직접 작성한 언어)
  title: text("title").notNull(),
  description: text("description"),
  situation: text("situation"), // context.situation
  timeline: text("timeline"), // context.timeline - 시간적 제약
  stakes: text("stakes"), // context.stakes - 이해관계
  playerRole: text("player_role"), // context.playerRole 설명
  objectives: text("objectives").array(), // 목표 배열
  successCriteriaOptimal: text("success_criteria_optimal"), // 성공기준: 최적
  successCriteriaGood: text("success_criteria_good"), // 성공기준: 양호
  successCriteriaAcceptable: text("success_criteria_acceptable"), // 성공기준: 수용가능
  successCriteriaFailure: text("success_criteria_failure"), // 성공기준: 실패
  skills: text("skills").array(), // 핵심역량 (Key Competencies) 배열
  // 시나리오별 페르소나 컨텍스트 번역 (stance, goal, tradeoff 등)
  personaContexts: jsonb("persona_contexts").$type<PersonaContextTranslation[]>(),
  isMachineTranslated: boolean("is_machine_translated").notNull().default(false), // AI 번역 여부
  isReviewed: boolean("is_reviewed").notNull().default(false), // 검수 완료 여부
  reviewedBy: varchar("reviewed_by").references(() => users.id), // 검수자
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_scenario_translations_scenario_id").on(table.scenarioId),
  index("idx_scenario_translations_locale").on(table.locale),
]);

// 시나리오별 페르소나 컨텍스트 번역 타입 (시나리오 번역에 포함됨)
// 직책, 부서, 역할은 마스터 페르소나가 아닌 시나리오에서 정의되므로 여기에 포함
export type PersonaContextTranslation = {
  personaId: string;        // 페르소나 ID
  position?: string;        // 직책 (시나리오에서 정의)
  department?: string;      // 부서 (시나리오에서 정의)
  role?: string;            // 역할 설명 (시나리오에서 정의)
  stance?: string;          // 입장/태도
  goal?: string;            // 목표
  tradeoff?: string;        // 협상 가능 범위
};

// 페르소나 번역 테이블 (마스터 페르소나 기본 정보만 - 시나리오 컨텍스트 제외)
// 주의: position, department, role은 시나리오에서 정의되므로 scenarioTranslations.personaContexts에서 관리
export const personaTranslations = pgTable("persona_translations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  personaId: text("persona_id").notNull(), // JSON 페르소나 ID 참조
  sourceLocale: varchar("source_locale", { length: 10 }).notNull().default('ko').references(() => supportedLanguages.code), // 원문 언어
  locale: varchar("locale", { length: 10 }).notNull().references(() => supportedLanguages.code), // 번역 대상 언어
  // 기본 정보 (마스터 페르소나 아이덴티티만 - MBTI 유형명)
  name: varchar("name").notNull(), // MBTI 유형 이름 (예: "분석가형", "The Analyst")
  // 성격 정보 (시나리오 컨텍스트 필드 stance/goal/tradeoff/position/department/role은 scenarioTranslations.personaContexts로 이동)
  personalityTraits: text("personality_traits").array(), // 성격 특성 배열
  communicationStyle: text("communication_style"), // 커뮤니케이션 스타일
  motivation: text("motivation"), // 동기
  fears: text("fears").array(), // 두려움 배열
  personalityDescription: text("personality_description"), // 성격 설명 (요약)
  // 배경 정보
  education: text("education"), // 학력
  previousExperience: text("previous_experience"), // 이전 경험
  majorProjects: text("major_projects").array(), // 주요 프로젝트 배열
  expertise: text("expertise").array(), // 전문분야 배열
  background: text("background"), // 배경 설명 (요약)
  // 메타 정보
  isMachineTranslated: boolean("is_machine_translated").notNull().default(false),
  isReviewed: boolean("is_reviewed").notNull().default(false),
  reviewedBy: varchar("reviewed_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_persona_translations_persona_id").on(table.personaId),
  index("idx_persona_translations_locale").on(table.locale),
]);

// 카테고리 번역 테이블
export const categoryTranslations = pgTable("category_translations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  categoryId: varchar("category_id").notNull().references(() => categories.id, { onDelete: 'cascade' }),
  sourceLocale: varchar("source_locale", { length: 10 }).notNull().default('ko').references(() => supportedLanguages.code), // 원문 언어
  locale: varchar("locale", { length: 10 }).notNull().references(() => supportedLanguages.code), // 번역 대상 언어
  name: varchar("name").notNull(),
  description: text("description"),
  isMachineTranslated: boolean("is_machine_translated").notNull().default(false),
  isReviewed: boolean("is_reviewed").notNull().default(false),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_category_translations_category_id").on(table.categoryId),
  index("idx_category_translations_locale").on(table.locale),
]);

// 지원 언어 타입
export const insertSupportedLanguageSchema = createInsertSchema(supportedLanguages);
export type InsertSupportedLanguage = z.infer<typeof insertSupportedLanguageSchema>;
export type SupportedLanguage = typeof supportedLanguages.$inferSelect;

// 시나리오 번역 타입
export const insertScenarioTranslationSchema = createInsertSchema(scenarioTranslations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertScenarioTranslation = z.infer<typeof insertScenarioTranslationSchema>;
export type ScenarioTranslation = typeof scenarioTranslations.$inferSelect;

// 페르소나 번역 타입
export const insertPersonaTranslationSchema = createInsertSchema(personaTranslations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPersonaTranslation = z.infer<typeof insertPersonaTranslationSchema>;
export type PersonaTranslation = typeof personaTranslations.$inferSelect;

// 카테고리 번역 타입
export const insertCategoryTranslationSchema = createInsertSchema(categoryTranslations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCategoryTranslation = z.infer<typeof insertCategoryTranslationSchema>;
export type CategoryTranslation = typeof categoryTranslations.$inferSelect;

// 번역 상태 통계 타입 (대시보드용)
export type TranslationStats = {
  locale: string;
  totalScenarios: number;
  translatedScenarios: number;
  reviewedScenarios: number;
  totalPersonas: number;
  translatedPersonas: number;
  reviewedPersonas: number;
};
