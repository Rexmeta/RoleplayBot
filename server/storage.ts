import { type Conversation, type InsertConversation, type Feedback, type InsertFeedback, type PersonaSelection, type StrategyChoice, type SequenceAnalysis, type User, type UpsertUser, type ScenarioRun, type InsertScenarioRun, type PersonaRun, type InsertPersonaRun, type ChatMessage, type InsertChatMessage, type Category, type InsertCategory, type SystemSetting, type AiUsageLog, type InsertAiUsageLog, type AiUsageSummary, type AiUsageByFeature, type AiUsageByModel, type AiUsageDaily, type EvaluationCriteriaSet, type InsertEvaluationCriteriaSet, type EvaluationDimension, type InsertEvaluationDimension, type EvaluationCriteriaSetWithDimensions, type SupportedLanguage, type InsertSupportedLanguage, type ScenarioTranslation, type InsertScenarioTranslation, type PersonaTranslation, type InsertPersonaTranslation, type CategoryTranslation, type InsertCategoryTranslation, type Scenario, type InsertScenario, type MbtiPersona, type InsertMbtiPersona, type Company, type InsertCompany, type Organization, type InsertOrganization, type OperatorAssignment, type InsertOperatorAssignment, conversations, feedbacks, users, scenarioRuns, personaRuns, chatMessages, categories, systemSettings, aiUsageLogs, evaluationCriteriaSets, evaluationDimensions, supportedLanguages, scenarioTranslations, personaTranslations, categoryTranslations, scenarios, mbtiPersonas, companies, organizations, operatorAssignments } from "@shared/schema";
import { randomUUID } from "crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq, asc, desc, inArray, and, gte, lte, sql as sqlBuilder, count, sum, isNotNull } from "drizzle-orm";
const sql = sqlBuilder;

// Initialize database connection using node-postgres
const databaseUrl = process.env.DATABASE_URL!;
const isUnixSocket = databaseUrl.includes('/cloudsql/');
const disableSsl = databaseUrl.includes('sslmode=disable') || isUnixSocket;

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: disableSsl ? false : { rejectUnauthorized: false }
});
const db = drizzle(pool);

export interface IStorage {
  // Conversations (레거시)
  createConversation(conversation: InsertConversation): Promise<Conversation>;
  getConversation(id: string): Promise<Conversation | undefined>;
  updateConversation(id: string, updates: Partial<Conversation>): Promise<Conversation>;
  deleteConversation(id: string): Promise<void>;
  getAllConversations(): Promise<Conversation[]>;
  getUserConversations(userId: string): Promise<Conversation[]>;
  
  // Feedback
  createFeedback(feedback: InsertFeedback): Promise<Feedback>;
  getFeedbackByConversationId(conversationId: string): Promise<Feedback | undefined>;
  getAllFeedbacks(): Promise<Feedback[]>;
  getUserFeedbacks(userId: string): Promise<Feedback[]>;
  
  // Strategic Selection - Persona Selections
  addPersonaSelection(conversationId: string, selection: PersonaSelection): Promise<Conversation>;
  getPersonaSelections(conversationId: string): Promise<PersonaSelection[]>;
  
  // Strategic Selection - Strategy Choices  
  addStrategyChoice(conversationId: string, choice: StrategyChoice): Promise<Conversation>;
  getStrategyChoices(conversationId: string): Promise<StrategyChoice[]>;
  
  // Strategic Selection - Sequence Analysis
  saveSequenceAnalysis(conversationId: string, analysis: SequenceAnalysis): Promise<Conversation>;
  getSequenceAnalysis(conversationId: string): Promise<SequenceAnalysis | undefined>;
  
  // Strategy Reflection
  saveStrategyReflection(conversationId: string, reflection: string, conversationOrder: string[]): Promise<Conversation>;

  // 새로운 데이터 구조: Scenario Runs
  createScenarioRun(scenarioRun: InsertScenarioRun): Promise<ScenarioRun>;
  getScenarioRun(id: string): Promise<ScenarioRun | undefined>;
  updateScenarioRun(id: string, updates: Partial<ScenarioRun>): Promise<ScenarioRun>;
  getUserScenarioRuns(userId: string): Promise<ScenarioRun[]>;
  getAllScenarioRuns(): Promise<ScenarioRun[]>; // Admin analytics
  findActiveScenarioRun(userId: string, scenarioId: string): Promise<ScenarioRun | undefined>;
  getUserScenarioRunsWithPersonaRuns(userId: string): Promise<(ScenarioRun & { personaRuns: PersonaRun[] })[]>;
  getScenarioRunWithPersonaRuns(id: string): Promise<(ScenarioRun & { personaRuns: PersonaRun[] }) | undefined>;
  
  // Persona Runs
  createPersonaRun(personaRun: InsertPersonaRun): Promise<PersonaRun>;
  getPersonaRun(id: string): Promise<PersonaRun | undefined>;
  getPersonaRunByConversationId(conversationId: string): Promise<PersonaRun | undefined>;
  updatePersonaRun(id: string, updates: Partial<PersonaRun>): Promise<PersonaRun>;
  getPersonaRunsByScenarioRun(scenarioRunId: string): Promise<PersonaRun[]>;
  getAllPersonaRuns(): Promise<PersonaRun[]>; // Admin analytics
  
  // Chat Messages
  createChatMessage(message: InsertChatMessage): Promise<ChatMessage>;
  getChatMessagesByPersonaRun(personaRunId: string): Promise<ChatMessage[]>;
  deleteChatMessagesByPersonaRun(personaRunId: string): Promise<void>;
  getAllEmotionStats(scenarioIds?: string[]): Promise<{ emotion: string; count: number }[]>; // Admin analytics - 감정 빈도
  getEmotionStatsByScenario(scenarioIds?: string[]): Promise<{ scenarioId: string; scenarioName: string; emotions: { emotion: string; count: number }[]; totalCount: number }[]>;
  getEmotionStatsByMbti(scenarioIds?: string[]): Promise<{ mbti: string; emotions: { emotion: string; count: number }[]; totalCount: number }[]>;
  getEmotionStatsByDifficulty(scenarioIds?: string[]): Promise<{ difficulty: number; emotions: { emotion: string; count: number }[]; totalCount: number }[]>;
  getEmotionTimelineByPersonaRun(personaRunId: string): Promise<{ turnIndex: number; emotion: string | null; message: string }[]>;

  // User operations - 이메일 기반 인증 시스템
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: { email: string; password: string; name: string; assignedCategoryId?: string | null; companyId?: string | null; organizationId?: string | null; preferredLanguage?: string }): Promise<User>;
  updateUser(id: string, updates: { name?: string; password?: string; profileImage?: string; tier?: string }): Promise<User>;
  updateUserLanguage(id: string, language: string): Promise<User>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUserLastLogin(id: string): Promise<void>;
  
  // System Admin operations - 시스템 관리자 전용
  getAllUsers(): Promise<User[]>;
  adminUpdateUser(id: string, updates: { role?: string; tier?: string; isActive?: boolean; assignedCompanyId?: string | null; assignedCategoryId?: string | null; assignedOrganizationId?: string | null }): Promise<User>;
  
  // Category operations - 카테고리 관리
  createCategory(category: InsertCategory): Promise<Category>;
  getCategory(id: string): Promise<Category | undefined>;
  getAllCategories(): Promise<Category[]>;
  updateCategory(id: string, updates: Partial<InsertCategory>): Promise<Category>;
  deleteCategory(id: string): Promise<void>;
  
  // System Settings operations - 시스템 설정 관리
  getSystemSettings(): Promise<SystemSetting[]>;
  getSystemSettingsByCategory(category: string): Promise<SystemSetting[]>;
  getSystemSetting(category: string, key: string): Promise<SystemSetting | undefined>;
  upsertSystemSetting(setting: { category: string; key: string; value: string; description?: string; updatedBy?: string }): Promise<SystemSetting>;
  deleteSystemSetting(category: string, key: string): Promise<void>;
  
  // AI Usage Logs operations - AI 사용량 추적
  createAiUsageLog(log: InsertAiUsageLog): Promise<AiUsageLog>;
  getAiUsageSummary(startDate: Date, endDate: Date): Promise<AiUsageSummary>;
  getAiUsageByFeature(startDate: Date, endDate: Date): Promise<AiUsageByFeature[]>;
  getAiUsageByModel(startDate: Date, endDate: Date): Promise<AiUsageByModel[]>;
  getAiUsageDaily(startDate: Date, endDate: Date): Promise<AiUsageDaily[]>;
  getAiUsageLogs(startDate: Date, endDate: Date, limit?: number): Promise<AiUsageLog[]>;
  
  // Evaluation Criteria operations - 평가 기준 관리
  createEvaluationCriteriaSet(criteriaSet: InsertEvaluationCriteriaSet): Promise<EvaluationCriteriaSet>;
  getEvaluationCriteriaSet(id: string): Promise<EvaluationCriteriaSet | undefined>;
  getAllEvaluationCriteriaSets(): Promise<EvaluationCriteriaSet[]>;
  getActiveEvaluationCriteriaSets(): Promise<EvaluationCriteriaSet[]>;
  getDefaultEvaluationCriteriaSet(): Promise<EvaluationCriteriaSet | undefined>;
  getEvaluationCriteriaSetByCategory(categoryId: string): Promise<EvaluationCriteriaSet | undefined>;
  updateEvaluationCriteriaSet(id: string, updates: Partial<InsertEvaluationCriteriaSet>): Promise<EvaluationCriteriaSet>;
  deleteEvaluationCriteriaSet(id: string): Promise<void>;
  setDefaultEvaluationCriteriaSet(id: string): Promise<void>;
  
  // Evaluation Dimensions operations - 평가 지표 관리
  createEvaluationDimension(dimension: InsertEvaluationDimension): Promise<EvaluationDimension>;
  getEvaluationDimension(id: string): Promise<EvaluationDimension | undefined>;
  getEvaluationDimensionsByCriteriaSet(criteriaSetId: string): Promise<EvaluationDimension[]>;
  updateEvaluationDimension(id: string, updates: Partial<InsertEvaluationDimension>): Promise<EvaluationDimension>;
  deleteEvaluationDimension(id: string): Promise<void>;
  
  // Combined operations - 평가 기준 세트 + 지표 조회
  getEvaluationCriteriaSetWithDimensions(id: string): Promise<EvaluationCriteriaSetWithDimensions | undefined>;
  getActiveEvaluationCriteriaSetWithDimensions(categoryId?: string): Promise<EvaluationCriteriaSetWithDimensions | undefined>;
  
  // Supported Languages - 지원 언어 관리
  getSupportedLanguages(): Promise<SupportedLanguage[]>;
  getActiveSupportedLanguages(): Promise<SupportedLanguage[]>;
  getSupportedLanguage(code: string): Promise<SupportedLanguage | undefined>;
  createSupportedLanguage(language: InsertSupportedLanguage): Promise<SupportedLanguage>;
  updateSupportedLanguage(code: string, updates: Partial<InsertSupportedLanguage>): Promise<SupportedLanguage>;
  deleteSupportedLanguage(code: string): Promise<void>;
  
  // Scenario Translations - 시나리오 번역
  getScenarioTranslation(scenarioId: string, locale: string): Promise<ScenarioTranslation | undefined>;
  getScenarioTranslations(scenarioId: string): Promise<ScenarioTranslation[]>;
  getAllScenarioTranslations(locale: string): Promise<ScenarioTranslation[]>;
  getOriginalScenarioTranslation(scenarioId: string): Promise<ScenarioTranslation | undefined>; // 원본 번역 조회
  getScenarioTranslationWithFallback(scenarioId: string, locale: string): Promise<ScenarioTranslation | undefined>; // 번역 조회 (원본 폴백)
  upsertScenarioTranslation(translation: InsertScenarioTranslation): Promise<ScenarioTranslation>;
  deleteScenarioTranslation(scenarioId: string, locale: string): Promise<void>;
  markScenarioTranslationReviewed(scenarioId: string, locale: string, reviewerId: string): Promise<ScenarioTranslation>;
  
  // Persona Translations - 페르소나 번역
  getPersonaTranslation(personaId: string, locale: string): Promise<PersonaTranslation | undefined>;
  getPersonaTranslations(personaId: string): Promise<PersonaTranslation[]>;
  getAllPersonaTranslations(locale: string): Promise<PersonaTranslation[]>;
  upsertPersonaTranslation(translation: InsertPersonaTranslation): Promise<PersonaTranslation>;
  deletePersonaTranslation(personaId: string, locale: string): Promise<void>;
  markPersonaTranslationReviewed(personaId: string, locale: string, reviewerId: string): Promise<PersonaTranslation>;
  
  // Category Translations - 카테고리 번역
  getCategoryTranslation(categoryId: string, locale: string): Promise<CategoryTranslation | undefined>;
  getCategoryTranslations(categoryId: string): Promise<CategoryTranslation[]>;
  upsertCategoryTranslation(translation: InsertCategoryTranslation): Promise<CategoryTranslation>;
  deleteCategoryTranslation(categoryId: string, locale: string): Promise<void>;
  
  // Scenarios - 시나리오 (DB 기반)
  getScenario(id: string): Promise<Scenario | undefined>;
  getAllScenarios(): Promise<Scenario[]>;
  getScenariosByCategory(categoryId: string): Promise<Scenario[]>;
  createScenario(scenario: InsertScenario): Promise<Scenario>;
  updateScenario(id: string, updates: Partial<InsertScenario>): Promise<Scenario>;
  deleteScenario(id: string): Promise<void>;
  
  // MBTI Personas - MBTI 페르소나 (DB 기반)
  getMbtiPersona(id: string): Promise<MbtiPersona | undefined>;
  getAllMbtiPersonas(): Promise<MbtiPersona[]>;
  createMbtiPersona(persona: InsertMbtiPersona): Promise<MbtiPersona>;
  updateMbtiPersona(id: string, updates: Partial<InsertMbtiPersona>): Promise<MbtiPersona>;
  deleteMbtiPersona(id: string): Promise<void>;
  
  // ==================== 3단 계층 구조: 회사 > 조직 > 카테고리 ====================
  
  // Companies - 회사 관리
  getCompany(id: string): Promise<Company | undefined>;
  getCompanyByName(name: string): Promise<Company | undefined>;
  getAllCompanies(): Promise<Company[]>;
  getActiveCompanies(): Promise<Company[]>;
  createCompany(company: InsertCompany): Promise<Company>;
  updateCompany(id: string, updates: Partial<InsertCompany>): Promise<Company>;
  deleteCompany(id: string): Promise<void>;
  
  // Organizations - 조직 관리
  getOrganization(id: string): Promise<Organization | undefined>;
  getOrganizationsByCompany(companyId: string): Promise<Organization[]>;
  getActiveOrganizationsByCompany(companyId: string): Promise<Organization[]>;
  getAllOrganizations(): Promise<Organization[]>;
  createOrganization(organization: InsertOrganization): Promise<Organization>;
  updateOrganization(id: string, updates: Partial<InsertOrganization>): Promise<Organization>;
  deleteOrganization(id: string): Promise<void>;
  
  // Categories (확장) - 조직별 카테고리
  getCategoriesByOrganization(organizationId: string): Promise<Category[]>;
  getActiveCategoriesByOrganization(organizationId: string): Promise<Category[]>;
  
  // Operator Assignments - 운영자 권한 할당
  getOperatorAssignment(id: string): Promise<OperatorAssignment | undefined>;
  getOperatorAssignmentsByUser(userId: string): Promise<OperatorAssignment[]>;
  getOperatorAssignmentsByCompany(companyId: string): Promise<OperatorAssignment[]>;
  getOperatorAssignmentsByOrganization(organizationId: string): Promise<OperatorAssignment[]>;
  createOperatorAssignment(assignment: InsertOperatorAssignment): Promise<OperatorAssignment>;
  deleteOperatorAssignment(id: string): Promise<void>;
  deleteOperatorAssignmentsByUser(userId: string): Promise<void>;
  
  // 운영자 권한 확인 헬퍼
  canOperatorManageCompany(userId: string, companyId: string): Promise<boolean>;
  canOperatorManageOrganization(userId: string, organizationId: string): Promise<boolean>;
  canOperatorManageCategory(userId: string, categoryId: string): Promise<boolean>;
  getOperatorManagedCompanyIds(userId: string): Promise<string[]>;
  getOperatorManagedOrganizationIds(userId: string): Promise<string[]>;
  getOperatorManagedCategoryIds(userId: string): Promise<string[]>;
  
  // 사용자 소속 관리
  getUsersByCompany(companyId: string): Promise<User[]>;
  getUsersByOrganization(organizationId: string): Promise<User[]>;
  updateUserCompanyOrganization(userId: string, companyId: string | null, organizationId: string | null): Promise<User>;
}

export class MemStorage implements IStorage {
  private conversations: Map<string, Conversation>;
  private feedbacks: Map<string, Feedback>;
  private users: Map<string, User>; // Auth storage

  constructor() {
    this.conversations = new Map();
    this.feedbacks = new Map();
    this.users = new Map(); // Auth storage
  }

  async createConversation(insertConversation: InsertConversation): Promise<Conversation> {
    const id = randomUUID();
    const conversation: Conversation = {
      id,
      mode: insertConversation.mode || "text",
      userId: insertConversation.userId || null,
      scenarioId: insertConversation.scenarioId,
      personaId: insertConversation.personaId || null,
      personaSnapshot: insertConversation.personaSnapshot || null,
      scenarioName: insertConversation.scenarioName,
      messages: insertConversation.messages as any,
      turnCount: insertConversation.turnCount || 0,
      status: insertConversation.status || "active",
      difficulty: insertConversation.difficulty || 2,
      createdAt: new Date(),
      completedAt: null,
      conversationType: insertConversation.conversationType || "single",
      currentPhase: insertConversation.currentPhase || 1,
      totalPhases: insertConversation.totalPhases || 1,
      personaSelections: (insertConversation.personaSelections as PersonaSelection[]) || [],
      strategyChoices: (insertConversation.strategyChoices as StrategyChoice[]) || [],
      sequenceAnalysis: (insertConversation.sequenceAnalysis as SequenceAnalysis) || null,
      strategyReflection: null,
      conversationOrder: null,
    };
    this.conversations.set(id, conversation);
    return conversation;
  }

  async getConversation(id: string): Promise<Conversation | undefined> {
    return this.conversations.get(id);
  }

  async updateConversation(id: string, updates: Partial<Conversation>): Promise<Conversation> {
    const existing = this.conversations.get(id);
    if (!existing) {
      throw new Error("Conversation not found");
    }
    const updated = { ...existing, ...updates };
    this.conversations.set(id, updated);
    return updated;
  }

  async deleteConversation(id: string): Promise<void> {
    this.conversations.delete(id);
    const feedbackToDelete = Array.from(this.feedbacks.entries()).find(
      ([_, feedback]) => feedback.conversationId === id
    );
    if (feedbackToDelete) {
      this.feedbacks.delete(feedbackToDelete[0]);
    }
  }

  async createFeedback(insertFeedback: InsertFeedback): Promise<Feedback> {
    const id = randomUUID();
    const feedback: Feedback = {
      id,
      conversationId: insertFeedback.conversationId || null,
      personaRunId: insertFeedback.personaRunId || null,
      overallScore: insertFeedback.overallScore,
      scores: insertFeedback.scores as any,
      detailedFeedback: insertFeedback.detailedFeedback as any,
      createdAt: new Date(),
    };
    this.feedbacks.set(id, feedback);
    return feedback;
  }

  async getFeedbackByConversationId(conversationId: string): Promise<Feedback | undefined> {
    return Array.from(this.feedbacks.values()).find(
      (feedback) => feedback.conversationId === conversationId
    );
  }

  async getAllConversations(): Promise<Conversation[]> {
    return Array.from(this.conversations.values());
  }

  async getUserConversations(userId: string): Promise<Conversation[]> {
    return Array.from(this.conversations.values()).filter(
      (conversation) => conversation.userId === userId
    );
  }

  async getAllFeedbacks(): Promise<Feedback[]> {
    return Array.from(this.feedbacks.values());
  }

  async getUserFeedbacks(userId: string): Promise<Feedback[]> {
    const userConversationIds = Array.from(this.conversations.values())
      .filter((conversation) => conversation.userId === userId)
      .map((conversation) => conversation.id);
    
    return Array.from(this.feedbacks.values()).filter(
      (feedback) => feedback.conversationId && userConversationIds.includes(feedback.conversationId)
    );
  }

  // Strategic Selection - Persona Selections
  async addPersonaSelection(conversationId: string, selection: PersonaSelection): Promise<Conversation> {
    const existing = this.conversations.get(conversationId);
    if (!existing) {
      throw new Error("Conversation not found");
    }
    
    const currentSelections = existing.personaSelections || [];
    const updatedSelections = [...currentSelections, selection];
    
    const updated = { ...existing, personaSelections: updatedSelections };
    this.conversations.set(conversationId, updated);
    return updated;
  }

  async getPersonaSelections(conversationId: string): Promise<PersonaSelection[]> {
    const conversation = this.conversations.get(conversationId);
    return conversation?.personaSelections || [];
  }

  // Strategic Selection - Strategy Choices
  async addStrategyChoice(conversationId: string, choice: StrategyChoice): Promise<Conversation> {
    const existing = this.conversations.get(conversationId);
    if (!existing) {
      throw new Error("Conversation not found");
    }
    
    const currentChoices = existing.strategyChoices || [];
    const updatedChoices = [...currentChoices, choice];
    
    const updated = { ...existing, strategyChoices: updatedChoices };
    this.conversations.set(conversationId, updated);
    return updated;
  }

  async getStrategyChoices(conversationId: string): Promise<StrategyChoice[]> {
    const conversation = this.conversations.get(conversationId);
    return conversation?.strategyChoices || [];
  }

  // Strategic Selection - Sequence Analysis
  async saveSequenceAnalysis(conversationId: string, analysis: SequenceAnalysis): Promise<Conversation> {
    const existing = this.conversations.get(conversationId);
    if (!existing) {
      throw new Error("Conversation not found");
    }
    
    const updated = { 
      ...existing, 
      sequenceAnalysis: analysis 
    };
    this.conversations.set(conversationId, updated);
    return updated;
  }

  async getSequenceAnalysis(conversationId: string): Promise<SequenceAnalysis | undefined> {
    const conversation = this.conversations.get(conversationId);
    return conversation?.sequenceAnalysis || undefined;
  }

  // Strategy Reflection
  async saveStrategyReflection(conversationId: string, reflection: string, conversationOrder: string[]): Promise<Conversation> {
    const existing = this.conversations.get(conversationId);
    if (!existing) {
      throw new Error("Conversation not found");
    }
    
    const updated = { 
      ...existing, 
      strategyReflection: reflection,
      conversationOrder: conversationOrder
    };
    this.conversations.set(conversationId, updated);
    return updated;
  }

  // 새로운 데이터 구조: Scenario Runs (stub implementations - MemStorage not used)
  async createScenarioRun(scenarioRun: InsertScenarioRun): Promise<ScenarioRun> {
    throw new Error("MemStorage does not support Scenario Runs");
  }

  async getScenarioRun(id: string): Promise<ScenarioRun | undefined> {
    throw new Error("MemStorage does not support Scenario Runs");
  }

  async updateScenarioRun(id: string, updates: Partial<ScenarioRun>): Promise<ScenarioRun> {
    throw new Error("MemStorage does not support Scenario Runs");
  }

  async getUserScenarioRuns(userId: string): Promise<ScenarioRun[]> {
    throw new Error("MemStorage does not support Scenario Runs");
  }

  async getAllScenarioRuns(): Promise<ScenarioRun[]> {
    throw new Error("MemStorage does not support Scenario Runs");
  }

  async findActiveScenarioRun(userId: string, scenarioId: string): Promise<ScenarioRun | undefined> {
    throw new Error("MemStorage does not support Scenario Runs");
  }

  async getUserScenarioRunsWithPersonaRuns(userId: string): Promise<(ScenarioRun & { personaRuns: PersonaRun[] })[]> {
    throw new Error("MemStorage does not support Scenario Runs");
  }

  async getScenarioRunWithPersonaRuns(id: string): Promise<(ScenarioRun & { personaRuns: PersonaRun[] }) | undefined> {
    throw new Error("MemStorage does not support Scenario Runs");
  }

  async createPersonaRun(personaRun: InsertPersonaRun): Promise<PersonaRun> {
    throw new Error("MemStorage does not support Persona Runs");
  }

  async getPersonaRun(id: string): Promise<PersonaRun | undefined> {
    throw new Error("MemStorage does not support Persona Runs");
  }

  async getPersonaRunByConversationId(conversationId: string): Promise<PersonaRun | undefined> {
    throw new Error("MemStorage does not support Persona Runs");
  }

  async updatePersonaRun(id: string, updates: Partial<PersonaRun>): Promise<PersonaRun> {
    throw new Error("MemStorage does not support Persona Runs");
  }

  async getPersonaRunsByScenarioRun(scenarioRunId: string): Promise<PersonaRun[]> {
    throw new Error("MemStorage does not support Persona Runs");
  }

  async getAllPersonaRuns(): Promise<PersonaRun[]> {
    throw new Error("MemStorage does not support Persona Runs");
  }

  async createChatMessage(message: InsertChatMessage): Promise<ChatMessage> {
    throw new Error("MemStorage does not support Chat Messages");
  }

  async getChatMessagesByPersonaRun(personaRunId: string): Promise<ChatMessage[]> {
    throw new Error("MemStorage does not support Chat Messages");
  }

  async deleteChatMessagesByPersonaRun(personaRunId: string): Promise<void> {
    throw new Error("MemStorage does not support Chat Messages");
  }

  async getAllEmotionStats(scenarioIds?: string[]): Promise<{ emotion: string; count: number }[]> {
    throw new Error("MemStorage does not support emotion stats");
  }

  async getEmotionStatsByScenario(scenarioIds?: string[]): Promise<{ scenarioId: string; scenarioName: string; emotions: { emotion: string; count: number }[]; totalCount: number }[]> {
    throw new Error("MemStorage does not support emotion stats by scenario");
  }

  async getEmotionStatsByMbti(scenarioIds?: string[]): Promise<{ mbti: string; emotions: { emotion: string; count: number }[]; totalCount: number }[]> {
    throw new Error("MemStorage does not support emotion stats by MBTI");
  }

  async getEmotionStatsByDifficulty(scenarioIds?: string[]): Promise<{ difficulty: number; emotions: { emotion: string; count: number }[]; totalCount: number }[]> {
    throw new Error("MemStorage does not support emotion stats by difficulty");
  }

  async getEmotionTimelineByPersonaRun(personaRunId: string): Promise<{ turnIndex: number; emotion: string | null; message: string }[]> {
    throw new Error("MemStorage does not support emotion timeline");
  }

  // User operations - 이메일 기반 인증 시스템
  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    for (const user of Array.from(this.users.values())) {
      if (user.email === email) {
        return user;
      }
    }
    return undefined;
  }

  async createUser(userData: { email: string; password: string; name: string; assignedCategoryId?: string | null; companyId?: string | null; organizationId?: string | null; preferredLanguage?: string }): Promise<User> {
    const id = randomUUID();
    const user: User = {
      id,
      email: userData.email,
      password: userData.password,
      name: userData.name,
      role: 'user',
      profileImage: null,
      tier: 'bronze',
      preferredLanguage: userData.preferredLanguage || 'ko',
      isActive: true,
      lastLoginAt: null,
      companyId: userData.companyId || null,
      organizationId: userData.organizationId || null,
      assignedCategoryId: userData.assignedCategoryId || null,
      assignedOrganizationId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    this.users.set(id, user);
    return user;
  }

  async updateUser(id: string, updates: { name?: string; password?: string; profileImage?: string; tier?: string }): Promise<User> {
    const existingUser = this.users.get(id);
    if (!existingUser) {
      throw new Error("User not found");
    }
    
    const updatedUser: User = {
      ...existingUser,
      ...(updates.name && { name: updates.name }),
      ...(updates.password && { password: updates.password }),
      ...(updates.profileImage !== undefined && { profileImage: updates.profileImage }),
      ...(updates.tier && { tier: updates.tier }),
      updatedAt: new Date(),
    };
    
    this.users.set(id, updatedUser);
    return updatedUser;
  }

  async updateUserLanguage(id: string, language: string): Promise<User> {
    const existingUser = this.users.get(id);
    if (!existingUser) {
      throw new Error("User not found");
    }
    
    const updatedUser: User = {
      ...existingUser,
      preferredLanguage: language,
      updatedAt: new Date(),
    };
    
    this.users.set(id, updatedUser);
    return updatedUser;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const existingUser = this.users.get(userData.id as string);
    
    const user: User = {
      id: userData.id as string,
      email: userData.email || '',
      password: existingUser?.password || '',
      name: userData.name || '',
      role: existingUser?.role || 'user',
      profileImage: existingUser?.profileImage || null,
      tier: existingUser?.tier || 'bronze',
      preferredLanguage: existingUser?.preferredLanguage || 'ko',
      isActive: existingUser?.isActive ?? true,
      lastLoginAt: existingUser?.lastLoginAt || null,
      companyId: existingUser?.companyId || null,
      organizationId: existingUser?.organizationId || null,
      assignedCategoryId: existingUser?.assignedCategoryId || null,
      assignedOrganizationId: existingUser?.assignedOrganizationId || null,
      createdAt: existingUser?.createdAt || new Date(),
      updatedAt: new Date(),
    };
    
    this.users.set(user.id, user);
    return user;
  }

  async updateUserLastLogin(id: string): Promise<void> {
    const user = this.users.get(id);
    if (user) {
      user.lastLoginAt = new Date();
      this.users.set(id, user);
    }
  }

  async getAllUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  async adminUpdateUser(id: string, updates: { role?: string; tier?: string; isActive?: boolean; assignedCompanyId?: string | null; assignedCategoryId?: string | null; assignedOrganizationId?: string | null }): Promise<User> {
    const user = this.users.get(id);
    if (!user) throw new Error("User not found");
    
    const updatedUser = { ...user, ...updates, updatedAt: new Date() };
    this.users.set(id, updatedUser);
    return updatedUser;
  }

  // Category operations - not implemented for MemStorage
  async createCategory(_category: InsertCategory): Promise<Category> {
    throw new Error("Not implemented in MemStorage");
  }
  async getCategory(_id: string): Promise<Category | undefined> {
    throw new Error("Not implemented in MemStorage");
  }
  async getAllCategories(): Promise<Category[]> {
    throw new Error("Not implemented in MemStorage");
  }
  async updateCategory(_id: string, _updates: Partial<InsertCategory>): Promise<Category> {
    throw new Error("Not implemented in MemStorage");
  }
  async deleteCategory(_id: string): Promise<void> {
    throw new Error("Not implemented in MemStorage");
  }
  
  // System Settings operations - not implemented for MemStorage
  async getSystemSettings(): Promise<SystemSetting[]> {
    throw new Error("Not implemented in MemStorage");
  }
  async getSystemSettingsByCategory(_category: string): Promise<SystemSetting[]> {
    throw new Error("Not implemented in MemStorage");
  }
  async getSystemSetting(_category: string, _key: string): Promise<SystemSetting | undefined> {
    throw new Error("Not implemented in MemStorage");
  }
  async upsertSystemSetting(_setting: { category: string; key: string; value: string; description?: string; updatedBy?: string }): Promise<SystemSetting> {
    throw new Error("Not implemented in MemStorage");
  }
  async deleteSystemSetting(_category: string, _key: string): Promise<void> {
    throw new Error("Not implemented in MemStorage");
  }
  
  // AI Usage Logs - MemStorage stubs
  async createAiUsageLog(_log: InsertAiUsageLog): Promise<AiUsageLog> {
    throw new Error("Not implemented in MemStorage");
  }
  
  async getAiUsageSummary(_startDate: Date, _endDate: Date): Promise<AiUsageSummary> {
    return { totalTokens: 0, promptTokens: 0, completionTokens: 0, totalCostUsd: 0, requestCount: 0 };
  }
  
  async getAiUsageByFeature(_startDate: Date, _endDate: Date): Promise<AiUsageByFeature[]> {
    return [];
  }
  
  async getAiUsageByModel(_startDate: Date, _endDate: Date): Promise<AiUsageByModel[]> {
    return [];
  }
  
  async getAiUsageDaily(_startDate: Date, _endDate: Date): Promise<AiUsageDaily[]> {
    return [];
  }
  
  async getAiUsageLogs(_startDate: Date, _endDate: Date, _limit?: number): Promise<AiUsageLog[]> {
    return [];
  }
  
  // Evaluation Criteria - MemStorage stubs
  async createEvaluationCriteriaSet(_criteriaSet: InsertEvaluationCriteriaSet): Promise<EvaluationCriteriaSet> {
    throw new Error("Not implemented in MemStorage");
  }
  async getEvaluationCriteriaSet(_id: string): Promise<EvaluationCriteriaSet | undefined> {
    throw new Error("Not implemented in MemStorage");
  }
  async getAllEvaluationCriteriaSets(): Promise<EvaluationCriteriaSet[]> {
    return [];
  }
  async getActiveEvaluationCriteriaSets(): Promise<EvaluationCriteriaSet[]> {
    return [];
  }
  async getDefaultEvaluationCriteriaSet(): Promise<EvaluationCriteriaSet | undefined> {
    return undefined;
  }
  async getEvaluationCriteriaSetByCategory(_categoryId: string): Promise<EvaluationCriteriaSet | undefined> {
    return undefined;
  }
  async updateEvaluationCriteriaSet(_id: string, _updates: Partial<InsertEvaluationCriteriaSet>): Promise<EvaluationCriteriaSet> {
    throw new Error("Not implemented in MemStorage");
  }
  async deleteEvaluationCriteriaSet(_id: string): Promise<void> {
    throw new Error("Not implemented in MemStorage");
  }
  async setDefaultEvaluationCriteriaSet(_id: string): Promise<void> {
    throw new Error("Not implemented in MemStorage");
  }
  async createEvaluationDimension(_dimension: InsertEvaluationDimension): Promise<EvaluationDimension> {
    throw new Error("Not implemented in MemStorage");
  }
  async getEvaluationDimension(_id: string): Promise<EvaluationDimension | undefined> {
    throw new Error("Not implemented in MemStorage");
  }
  async getEvaluationDimensionsByCriteriaSet(_criteriaSetId: string): Promise<EvaluationDimension[]> {
    return [];
  }
  async updateEvaluationDimension(_id: string, _updates: Partial<InsertEvaluationDimension>): Promise<EvaluationDimension> {
    throw new Error("Not implemented in MemStorage");
  }
  async deleteEvaluationDimension(_id: string): Promise<void> {
    throw new Error("Not implemented in MemStorage");
  }
  async getEvaluationCriteriaSetWithDimensions(_id: string): Promise<EvaluationCriteriaSetWithDimensions | undefined> {
    return undefined;
  }
  async getActiveEvaluationCriteriaSetWithDimensions(_categoryId?: string): Promise<EvaluationCriteriaSetWithDimensions | undefined> {
    return undefined;
  }
  
  // Translation stubs - MemStorage
  async getSupportedLanguages(): Promise<SupportedLanguage[]> { return []; }
  async getActiveSupportedLanguages(): Promise<SupportedLanguage[]> { return []; }
  async getSupportedLanguage(_code: string): Promise<SupportedLanguage | undefined> { return undefined; }
  async createSupportedLanguage(_language: InsertSupportedLanguage): Promise<SupportedLanguage> { throw new Error("Not implemented"); }
  async updateSupportedLanguage(_code: string, _updates: Partial<InsertSupportedLanguage>): Promise<SupportedLanguage> { throw new Error("Not implemented"); }
  async deleteSupportedLanguage(_code: string): Promise<void> {}
  
  async getScenarioTranslation(_scenarioId: string, _locale: string): Promise<ScenarioTranslation | undefined> { return undefined; }
  async getScenarioTranslations(_scenarioId: string): Promise<ScenarioTranslation[]> { return []; }
  async getAllScenarioTranslations(_locale: string): Promise<ScenarioTranslation[]> { return []; }
  async getOriginalScenarioTranslation(_scenarioId: string): Promise<ScenarioTranslation | undefined> { return undefined; }
  async getScenarioTranslationWithFallback(_scenarioId: string, _locale: string): Promise<ScenarioTranslation | undefined> { return undefined; }
  async upsertScenarioTranslation(_translation: InsertScenarioTranslation): Promise<ScenarioTranslation> { throw new Error("Not implemented"); }
  async deleteScenarioTranslation(_scenarioId: string, _locale: string): Promise<void> {}
  async markScenarioTranslationReviewed(_scenarioId: string, _locale: string, _reviewerId: string): Promise<ScenarioTranslation> { throw new Error("Not implemented"); }
  
  async getPersonaTranslation(_personaId: string, _locale: string): Promise<PersonaTranslation | undefined> { return undefined; }
  async getPersonaTranslations(_personaId: string): Promise<PersonaTranslation[]> { return []; }
  async getAllPersonaTranslations(_locale: string): Promise<PersonaTranslation[]> { return []; }
  async upsertPersonaTranslation(_translation: InsertPersonaTranslation): Promise<PersonaTranslation> { throw new Error("Not implemented"); }
  async deletePersonaTranslation(_personaId: string, _locale: string): Promise<void> {}
  async markPersonaTranslationReviewed(_personaId: string, _locale: string, _reviewerId: string): Promise<PersonaTranslation> { throw new Error("Not implemented"); }
  
  async getCategoryTranslation(_categoryId: string, _locale: string): Promise<CategoryTranslation | undefined> { return undefined; }
  async getCategoryTranslations(_categoryId: string): Promise<CategoryTranslation[]> { return []; }
  async upsertCategoryTranslation(_translation: InsertCategoryTranslation): Promise<CategoryTranslation> { throw new Error("Not implemented"); }
  async deleteCategoryTranslation(_categoryId: string, _locale: string): Promise<void> {}
  
  // Scenarios - stub implementations
  async getScenario(_id: string): Promise<Scenario | undefined> { return undefined; }
  async getAllScenarios(): Promise<Scenario[]> { return []; }
  async getScenariosByCategory(_categoryId: string): Promise<Scenario[]> { return []; }
  async createScenario(_scenario: InsertScenario): Promise<Scenario> { throw new Error("Not implemented"); }
  async updateScenario(_id: string, _updates: Partial<InsertScenario>): Promise<Scenario> { throw new Error("Not implemented"); }
  async deleteScenario(_id: string): Promise<void> {}
  
  // MBTI Personas - stub implementations
  async getMbtiPersona(_id: string): Promise<MbtiPersona | undefined> { return undefined; }
  async getAllMbtiPersonas(): Promise<MbtiPersona[]> { return []; }
  async createMbtiPersona(_persona: InsertMbtiPersona): Promise<MbtiPersona> { throw new Error("Not implemented"); }
  async updateMbtiPersona(_id: string, _updates: Partial<InsertMbtiPersona>): Promise<MbtiPersona> { throw new Error("Not implemented"); }
  async deleteMbtiPersona(_id: string): Promise<void> {}
  
  // 3단 계층 구조 - stub implementations
  async getCompany(_id: string): Promise<Company | undefined> { return undefined; }
  async getCompanyByName(_name: string): Promise<Company | undefined> { return undefined; }
  async getAllCompanies(): Promise<Company[]> { return []; }
  async getActiveCompanies(): Promise<Company[]> { return []; }
  async createCompany(_company: InsertCompany): Promise<Company> { throw new Error("Not implemented"); }
  async updateCompany(_id: string, _updates: Partial<InsertCompany>): Promise<Company> { throw new Error("Not implemented"); }
  async deleteCompany(_id: string): Promise<void> {}
  
  async getOrganization(_id: string): Promise<Organization | undefined> { return undefined; }
  async getOrganizationsByCompany(_companyId: string): Promise<Organization[]> { return []; }
  async getActiveOrganizationsByCompany(_companyId: string): Promise<Organization[]> { return []; }
  async getAllOrganizations(): Promise<Organization[]> { return []; }
  async createOrganization(_organization: InsertOrganization): Promise<Organization> { throw new Error("Not implemented"); }
  async updateOrganization(_id: string, _updates: Partial<InsertOrganization>): Promise<Organization> { throw new Error("Not implemented"); }
  async deleteOrganization(_id: string): Promise<void> {}
  
  async getCategoriesByOrganization(_organizationId: string): Promise<Category[]> { return []; }
  async getActiveCategoriesByOrganization(_organizationId: string): Promise<Category[]> { return []; }
  
  async getOperatorAssignment(_id: string): Promise<OperatorAssignment | undefined> { return undefined; }
  async getOperatorAssignmentsByUser(_userId: string): Promise<OperatorAssignment[]> { return []; }
  async getOperatorAssignmentsByCompany(_companyId: string): Promise<OperatorAssignment[]> { return []; }
  async getOperatorAssignmentsByOrganization(_organizationId: string): Promise<OperatorAssignment[]> { return []; }
  async createOperatorAssignment(_assignment: InsertOperatorAssignment): Promise<OperatorAssignment> { throw new Error("Not implemented"); }
  async deleteOperatorAssignment(_id: string): Promise<void> {}
  async deleteOperatorAssignmentsByUser(_userId: string): Promise<void> {}
  
  async canOperatorManageCompany(_userId: string, _companyId: string): Promise<boolean> { return false; }
  async canOperatorManageOrganization(_userId: string, _organizationId: string): Promise<boolean> { return false; }
  async canOperatorManageCategory(_userId: string, _categoryId: string): Promise<boolean> { return false; }
  async getOperatorManagedCompanyIds(_userId: string): Promise<string[]> { return []; }
  async getOperatorManagedOrganizationIds(_userId: string): Promise<string[]> { return []; }
  async getOperatorManagedCategoryIds(_userId: string): Promise<string[]> { return []; }
  
  async getUsersByCompany(_companyId: string): Promise<User[]> { return []; }
  async getUsersByOrganization(_organizationId: string): Promise<User[]> { return []; }
  async updateUserCompanyOrganization(_userId: string, _companyId: string | null, _organizationId: string | null): Promise<User> { throw new Error("Not implemented"); }
}

export class PostgreSQLStorage implements IStorage {
  // Conversations
  async createConversation(insertConversation: InsertConversation): Promise<Conversation> {
    const [conversation] = await db.insert(conversations).values(insertConversation as any).returning();
    return conversation;
  }

  async getConversation(id: string): Promise<Conversation | undefined> {
    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, id));
    return conversation;
  }

  async updateConversation(id: string, updates: Partial<Conversation>): Promise<Conversation> {
    const [conversation] = await db.update(conversations).set(updates).where(eq(conversations.id, id)).returning();
    if (!conversation) {
      throw new Error("Conversation not found");
    }
    return conversation;
  }

  async deleteConversation(id: string): Promise<void> {
    await db.delete(feedbacks).where(eq(feedbacks.conversationId, id));
    await db.delete(conversations).where(eq(conversations.id, id));
  }

  async getAllConversations(): Promise<Conversation[]> {
    return await db.select().from(conversations);
  }

  async getUserConversations(userId: string): Promise<Conversation[]> {
    return await db.select().from(conversations).where(eq(conversations.userId, userId));
  }

  // Feedback
  async createFeedback(insertFeedback: InsertFeedback): Promise<Feedback> {
    const [feedback] = await db.insert(feedbacks).values(insertFeedback as any).returning();
    return feedback;
  }

  async getFeedbackByConversationId(conversationId: string): Promise<Feedback | undefined> {
    // ✨ 새 구조: personaRunId로 조회 (conversationId가 실제로는 personaRunId)
    // 먼저 personaRunId로 조회
    const [feedbackByPersonaRun] = await db.select().from(feedbacks).where(eq(feedbacks.personaRunId, conversationId));
    if (feedbackByPersonaRun) {
      return feedbackByPersonaRun;
    }
    
    // 레거시 지원: conversationId로도 조회
    const [feedbackByConversation] = await db.select().from(feedbacks).where(eq(feedbacks.conversationId, conversationId));
    return feedbackByConversation;
  }

  async getAllFeedbacks(): Promise<Feedback[]> {
    return await db.select().from(feedbacks);
  }

  async getUserFeedbacks(userId: string): Promise<Feedback[]> {
    // ✨ 새 구조: personaRunId를 통해 userId 필터링
    // 1) 유저의 모든 scenarioRun ID 가져오기
    const userScenarioRuns = await db.select().from(scenarioRuns).where(eq(scenarioRuns.userId, userId));
    
    if (userScenarioRuns.length === 0) {
      return [];
    }
    
    const scenarioRunIds = userScenarioRuns.map(sr => sr.id);
    
    // 2) 해당 scenarioRun들에 속한 모든 personaRun ID 가져오기
    const userPersonaRuns = await db
      .select()
      .from(personaRuns)
      .where(inArray(personaRuns.scenarioRunId, scenarioRunIds));
    
    const personaRunIds = userPersonaRuns.map(pr => pr.id);
    
    // 3) personaRunId로 피드백 조회 (새 구조)
    const newStructureFeedbacks = personaRunIds.length > 0 
      ? await db.select().from(feedbacks).where(inArray(feedbacks.personaRunId, personaRunIds))
      : [];
    
    // 4) conversationId로 피드백 조회 (레거시 지원)
    const legacyResults = await db
      .select()
      .from(feedbacks)
      .innerJoin(conversations, eq(feedbacks.conversationId, conversations.id))
      .where(eq(conversations.userId, userId));
    
    const legacyFeedbacks = legacyResults.map(r => r.feedbacks);
    
    // 5) 두 결과 병합하고 중복 제거 (ID 기준)
    const allFeedbacks = [...newStructureFeedbacks, ...legacyFeedbacks];
    const uniqueFeedbacks = Array.from(
      new Map(allFeedbacks.map(f => [f.id, f])).values()
    ).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    console.log(`✅ UserFeedbacks for ${userId}: ${uniqueFeedbacks.length} feedbacks from ${newStructureFeedbacks.length} new + ${legacyFeedbacks.length} legacy`);
    return uniqueFeedbacks;
  }

  // Strategic Selection - Persona Selections
  async addPersonaSelection(conversationId: string, selection: PersonaSelection): Promise<Conversation> {
    const existing = await this.getConversation(conversationId);
    if (!existing) {
      throw new Error("Conversation not found");
    }
    
    const currentSelections = existing.personaSelections || [];
    const updatedSelections = [...currentSelections, selection];
    
    return await this.updateConversation(conversationId, { personaSelections: updatedSelections });
  }

  async getPersonaSelections(conversationId: string): Promise<PersonaSelection[]> {
    const conversation = await this.getConversation(conversationId);
    return conversation?.personaSelections || [];
  }

  // Strategic Selection - Strategy Choices
  async addStrategyChoice(conversationId: string, choice: StrategyChoice): Promise<Conversation> {
    const existing = await this.getConversation(conversationId);
    if (!existing) {
      throw new Error("Conversation not found");
    }
    
    const currentChoices = existing.strategyChoices || [];
    const updatedChoices = [...currentChoices, choice];
    
    return await this.updateConversation(conversationId, { strategyChoices: updatedChoices });
  }

  async getStrategyChoices(conversationId: string): Promise<StrategyChoice[]> {
    const conversation = await this.getConversation(conversationId);
    return conversation?.strategyChoices || [];
  }

  // Strategic Selection - Sequence Analysis
  async saveSequenceAnalysis(conversationId: string, analysis: SequenceAnalysis): Promise<Conversation> {
    return await this.updateConversation(conversationId, { sequenceAnalysis: analysis });
  }

  async getSequenceAnalysis(conversationId: string): Promise<SequenceAnalysis | undefined> {
    const conversation = await this.getConversation(conversationId);
    return conversation?.sequenceAnalysis || undefined;
  }

  // Strategy Reflection
  async saveStrategyReflection(conversationId: string, reflection: string, conversationOrder: string[]): Promise<Conversation> {
    return await this.updateConversation(conversationId, { 
      strategyReflection: reflection,
      conversationOrder: conversationOrder
    });
  }

  // User operations - 이메일 기반 인증 시스템
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(userData: { email: string; password: string; name: string; assignedCategoryId?: string | null; companyId?: string | null; organizationId?: string | null; preferredLanguage?: string }): Promise<User> {
    const [user] = await db.insert(users).values({
      ...userData,
      preferredLanguage: userData.preferredLanguage || 'ko',
      companyId: userData.companyId || null,
      organizationId: userData.organizationId || null,
    }).returning();
    return user;
  }

  async updateUser(id: string, updates: { name?: string; password?: string; profileImage?: string; tier?: string }): Promise<User> {
    const updateData: any = { updatedAt: new Date() };
    if (updates.name) updateData.name = updates.name;
    if (updates.password) updateData.password = updates.password;
    if (updates.profileImage !== undefined) updateData.profileImage = updates.profileImage;
    if (updates.tier) updateData.tier = updates.tier;
    
    const [user] = await db.update(users).set(updateData).where(eq(users.id, id)).returning();
    if (!user) {
      throw new Error("User not found");
    }
    return user;
  }

  async updateUserLanguage(id: string, language: string): Promise<User> {
    const [user] = await db.update(users).set({ 
      preferredLanguage: language, 
      updatedAt: new Date() 
    }).where(eq(users.id, id)).returning();
    if (!user) {
      throw new Error("User not found");
    }
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db.insert(users).values(userData).onConflictDoUpdate({
      target: users.id,
      set: {
        email: userData.email,
        name: userData.name,
        updatedAt: new Date(),
      }
    }).returning();
    return user;
  }

  async updateUserLastLogin(id: string): Promise<void> {
    await db.update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, id));
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users).orderBy(desc(users.createdAt));
  }

  async adminUpdateUser(id: string, updates: { role?: string; tier?: string; isActive?: boolean; assignedCompanyId?: string | null; assignedCategoryId?: string | null; assignedOrganizationId?: string | null }): Promise<User> {
    const [user] = await db.update(users)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    if (!user) throw new Error("User not found");
    return user;
  }

  // Category operations - 카테고리 관리
  async createCategory(insertCategory: InsertCategory): Promise<Category> {
    const [category] = await db.insert(categories).values(insertCategory).returning();
    return category;
  }

  async getCategory(id: string): Promise<Category | undefined> {
    const [category] = await db.select().from(categories).where(eq(categories.id, id));
    return category;
  }

  async getAllCategories(): Promise<Category[]> {
    return await db.select().from(categories).orderBy(asc(categories.order));
  }

  async updateCategory(id: string, updates: Partial<InsertCategory>): Promise<Category> {
    const [category] = await db.update(categories)
      .set(updates)
      .where(eq(categories.id, id))
      .returning();
    if (!category) throw new Error("Category not found");
    return category;
  }

  async deleteCategory(id: string): Promise<void> {
    await db.delete(categories).where(eq(categories.id, id));
  }

  // 새로운 데이터 구조: Scenario Runs
  async createScenarioRun(insertScenarioRun: InsertScenarioRun): Promise<ScenarioRun> {
    const [scenarioRun] = await db.insert(scenarioRuns).values(insertScenarioRun as any).returning();
    return scenarioRun;
  }

  async getScenarioRun(id: string): Promise<ScenarioRun | undefined> {
    const [scenarioRun] = await db.select().from(scenarioRuns).where(eq(scenarioRuns.id, id));
    return scenarioRun;
  }

  async updateScenarioRun(id: string, updates: Partial<ScenarioRun>): Promise<ScenarioRun> {
    const [scenarioRun] = await db.update(scenarioRuns).set(updates).where(eq(scenarioRuns.id, id)).returning();
    if (!scenarioRun) {
      throw new Error("ScenarioRun not found");
    }
    return scenarioRun;
  }

  async getUserScenarioRuns(userId: string): Promise<ScenarioRun[]> {
    return await db.select().from(scenarioRuns).where(eq(scenarioRuns.userId, userId)).orderBy(desc(scenarioRuns.startedAt));
  }

  async getAllScenarioRuns(): Promise<ScenarioRun[]> {
    return await db.select().from(scenarioRuns).orderBy(desc(scenarioRuns.startedAt));
  }

  async findActiveScenarioRun(userId: string, scenarioId: string): Promise<ScenarioRun | undefined> {
    const [activeRun] = await db
      .select()
      .from(scenarioRuns)
      .where(and(
        eq(scenarioRuns.userId, userId),
        eq(scenarioRuns.scenarioId, scenarioId),
        eq(scenarioRuns.status, 'active')
      ))
      .orderBy(desc(scenarioRuns.startedAt))
      .limit(1);
    return activeRun;
  }

  async getUserScenarioRunsWithPersonaRuns(userId: string): Promise<(ScenarioRun & { personaRuns: PersonaRun[] })[]> {
    // 1) 유저의 모든 시나리오 실행 가져오기 (리스트의 "줄"이 되는 단위)
    const userScenarioRuns = await db
      .select()
      .from(scenarioRuns)
      .where(eq(scenarioRuns.userId, userId))
      .orderBy(desc(scenarioRuns.startedAt));

    if (userScenarioRuns.length === 0) {
      return [];
    }

    const scenarioRunIds = userScenarioRuns.map((sr) => sr.id);

    // 2) ✨ 한 번에 해당 시나리오 실행들에 속한 personaRuns 전체를 가져오기 (N+1 문제 해결)
    const allPersonaRuns = await db
      .select()
      .from(personaRuns)
      .where(inArray(personaRuns.scenarioRunId, scenarioRunIds))
      .orderBy(asc(personaRuns.phase));

    // 3) scenarioRunId 별로 personaRuns 그룹핑
    const personaRunsByScenarioId = new Map<string, PersonaRun[]>();

    for (const pr of allPersonaRuns) {
      const list = personaRunsByScenarioId.get(pr.scenarioRunId) ?? [];
      list.push(pr);
      personaRunsByScenarioId.set(pr.scenarioRunId, list);
    }

    // 4) 각 ScenarioRun에 personaRuns 배열 붙여서 반환
    return userScenarioRuns.map((sr) => ({
      ...sr,
      personaRuns: personaRunsByScenarioId.get(sr.id) ?? [],
    }));
  }

  async getScenarioRunWithPersonaRuns(id: string): Promise<(ScenarioRun & { personaRuns: PersonaRun[] }) | undefined> {
    const scenarioRun = await this.getScenarioRun(id);
    if (!scenarioRun) {
      return undefined;
    }
    const personas = await this.getPersonaRunsByScenarioRun(id);
    return { ...scenarioRun, personaRuns: personas };
  }

  // Persona Runs
  async createPersonaRun(insertPersonaRun: InsertPersonaRun): Promise<PersonaRun> {
    const [personaRun] = await db.insert(personaRuns).values(insertPersonaRun).returning();
    return personaRun;
  }

  async getPersonaRun(id: string): Promise<PersonaRun | undefined> {
    const [personaRun] = await db.select().from(personaRuns).where(eq(personaRuns.id, id));
    return personaRun;
  }

  async getPersonaRunByConversationId(conversationId: string): Promise<PersonaRun | undefined> {
    const [personaRun] = await db.select().from(personaRuns).where(eq(personaRuns.conversationId, conversationId));
    return personaRun;
  }

  async updatePersonaRun(id: string, updates: Partial<PersonaRun>): Promise<PersonaRun> {
    const [personaRun] = await db.update(personaRuns).set(updates).where(eq(personaRuns.id, id)).returning();
    if (!personaRun) {
      throw new Error("PersonaRun not found");
    }
    return personaRun;
  }

  async getPersonaRunsByScenarioRun(scenarioRunId: string): Promise<PersonaRun[]> {
    return await db.select().from(personaRuns).where(eq(personaRuns.scenarioRunId, scenarioRunId)).orderBy(asc(personaRuns.phase));
  }

  async getAllPersonaRuns(): Promise<PersonaRun[]> {
    return await db.select().from(personaRuns).orderBy(desc(personaRuns.startedAt));
  }

  // Chat Messages
  async createChatMessage(insertMessage: InsertChatMessage): Promise<ChatMessage> {
    const [message] = await db.insert(chatMessages).values(insertMessage).returning();
    return message;
  }

  async getChatMessagesByPersonaRun(personaRunId: string): Promise<ChatMessage[]> {
    return await db.select().from(chatMessages).where(eq(chatMessages.personaRunId, personaRunId)).orderBy(asc(chatMessages.turnIndex));
  }

  async deleteChatMessagesByPersonaRun(personaRunId: string): Promise<void> {
    await db.delete(chatMessages).where(eq(chatMessages.personaRunId, personaRunId));
  }

  async getAllEmotionStats(scenarioIds?: string[]): Promise<{ emotion: string; count: number }[]> {
    // scenarioIds가 있으면 해당 시나리오만 필터링
    if (scenarioIds && scenarioIds.length > 0) {
      const result = await db.select({
        emotion: chatMessages.emotion,
        count: sql<number>`count(*)::int`
      })
      .from(chatMessages)
      .innerJoin(personaRuns, eq(chatMessages.personaRunId, personaRuns.id))
      .innerJoin(scenarioRuns, eq(personaRuns.scenarioRunId, scenarioRuns.id))
      .where(and(
        eq(chatMessages.sender, 'ai'),
        isNotNull(chatMessages.emotion),
        inArray(scenarioRuns.scenarioId, scenarioIds)
      ))
      .groupBy(chatMessages.emotion)
      .orderBy(desc(sql`count(*)`));
      
      return result.filter(r => r.emotion !== null) as { emotion: string; count: number }[];
    }
    
    // scenarioIds가 없으면 전체 조회
    const result = await db.select({
      emotion: chatMessages.emotion,
      count: sql<number>`count(*)::int`
    })
    .from(chatMessages)
    .where(and(
      eq(chatMessages.sender, 'ai'),
      isNotNull(chatMessages.emotion)
    ))
    .groupBy(chatMessages.emotion)
    .orderBy(desc(sql`count(*)`));
    
    return result.filter(r => r.emotion !== null) as { emotion: string; count: number }[];
  }

  async getEmotionStatsByScenario(scenarioIds?: string[]): Promise<{ scenarioId: string; scenarioName: string; emotions: { emotion: string; count: number }[]; totalCount: number }[]> {
    // 시나리오별 감정 통계: chat_messages -> persona_runs -> scenario_runs 조인
    const whereConditions = [
      eq(chatMessages.sender, 'ai'),
      isNotNull(chatMessages.emotion)
    ];
    
    if (scenarioIds && scenarioIds.length > 0) {
      whereConditions.push(inArray(scenarioRuns.scenarioId, scenarioIds));
    }
    
    const result = await db.select({
      scenarioId: scenarioRuns.scenarioId,
      scenarioName: scenarioRuns.scenarioName,
      emotion: chatMessages.emotion,
      count: sql<number>`count(*)::int`
    })
    .from(chatMessages)
    .innerJoin(personaRuns, eq(chatMessages.personaRunId, personaRuns.id))
    .innerJoin(scenarioRuns, eq(personaRuns.scenarioRunId, scenarioRuns.id))
    .where(and(...whereConditions))
    .groupBy(scenarioRuns.scenarioId, scenarioRuns.scenarioName, chatMessages.emotion)
    .orderBy(scenarioRuns.scenarioId, desc(sql`count(*)`));
    
    // 시나리오별로 그룹화
    const scenarioMap = new Map<string, { scenarioId: string; scenarioName: string; emotions: { emotion: string; count: number }[]; totalCount: number }>();
    
    for (const row of result) {
      if (!row.emotion) continue;
      
      if (!scenarioMap.has(row.scenarioId)) {
        scenarioMap.set(row.scenarioId, {
          scenarioId: row.scenarioId,
          scenarioName: row.scenarioName,
          emotions: [],
          totalCount: 0
        });
      }
      
      const scenario = scenarioMap.get(row.scenarioId)!;
      scenario.emotions.push({ emotion: row.emotion, count: row.count });
      scenario.totalCount += row.count;
    }
    
    return Array.from(scenarioMap.values()).sort((a, b) => b.totalCount - a.totalCount);
  }

  async getEmotionStatsByMbti(scenarioIds?: string[]): Promise<{ mbti: string; emotions: { emotion: string; count: number }[]; totalCount: number }[]> {
    // MBTI별 감정 통계: chat_messages -> persona_runs -> scenario_runs 조인
    const whereConditions = [
      eq(chatMessages.sender, 'ai'),
      isNotNull(chatMessages.emotion),
      isNotNull(personaRuns.mbtiType)
    ];
    
    if (scenarioIds && scenarioIds.length > 0) {
      whereConditions.push(inArray(scenarioRuns.scenarioId, scenarioIds));
    }
    
    const result = await db.select({
      mbti: personaRuns.mbtiType,
      emotion: chatMessages.emotion,
      count: sql<number>`count(*)::int`
    })
    .from(chatMessages)
    .innerJoin(personaRuns, eq(chatMessages.personaRunId, personaRuns.id))
    .innerJoin(scenarioRuns, eq(personaRuns.scenarioRunId, scenarioRuns.id))
    .where(and(...whereConditions))
    .groupBy(personaRuns.mbtiType, chatMessages.emotion)
    .orderBy(personaRuns.mbtiType, desc(sql`count(*)`));
    
    // MBTI별로 그룹화
    const mbtiMap = new Map<string, { mbti: string; emotions: { emotion: string; count: number }[]; totalCount: number }>();
    
    for (const row of result) {
      if (!row.emotion || !row.mbti) continue;
      
      if (!mbtiMap.has(row.mbti)) {
        mbtiMap.set(row.mbti, {
          mbti: row.mbti,
          emotions: [],
          totalCount: 0
        });
      }
      
      const mbtiData = mbtiMap.get(row.mbti)!;
      mbtiData.emotions.push({ emotion: row.emotion, count: row.count });
      mbtiData.totalCount += row.count;
    }
    
    return Array.from(mbtiMap.values()).sort((a, b) => b.totalCount - a.totalCount);
  }

  async getEmotionStatsByDifficulty(scenarioIds?: string[]): Promise<{ difficulty: number; emotions: { emotion: string; count: number }[]; totalCount: number }[]> {
    // 난이도별 감정 통계: chat_messages -> persona_runs -> scenario_runs 조인
    const whereConditions = [
      eq(chatMessages.sender, 'ai'),
      isNotNull(chatMessages.emotion),
      isNotNull(personaRuns.difficulty)
    ];
    
    if (scenarioIds && scenarioIds.length > 0) {
      whereConditions.push(inArray(scenarioRuns.scenarioId, scenarioIds));
    }
    
    const result = await db.select({
      difficulty: personaRuns.difficulty,
      emotion: chatMessages.emotion,
      count: sql<number>`count(*)::int`
    })
    .from(chatMessages)
    .innerJoin(personaRuns, eq(chatMessages.personaRunId, personaRuns.id))
    .innerJoin(scenarioRuns, eq(personaRuns.scenarioRunId, scenarioRuns.id))
    .where(and(...whereConditions))
    .groupBy(personaRuns.difficulty, chatMessages.emotion)
    .orderBy(personaRuns.difficulty, desc(sql`count(*)`));
    
    // 난이도별로 그룹화
    const difficultyMap = new Map<number, { difficulty: number; emotions: { emotion: string; count: number }[]; totalCount: number }>();
    
    for (const row of result) {
      if (!row.emotion || row.difficulty === null) continue;
      
      if (!difficultyMap.has(row.difficulty)) {
        difficultyMap.set(row.difficulty, {
          difficulty: row.difficulty,
          emotions: [],
          totalCount: 0
        });
      }
      
      const difficultyData = difficultyMap.get(row.difficulty)!;
      difficultyData.emotions.push({ emotion: row.emotion, count: row.count });
      difficultyData.totalCount += row.count;
    }
    
    // 난이도 순서대로 정렬 (1, 2, 3, 4)
    return Array.from(difficultyMap.values()).sort((a, b) => a.difficulty - b.difficulty);
  }

  async getEmotionTimelineByPersonaRun(personaRunId: string): Promise<{ turnIndex: number; emotion: string | null; message: string }[]> {
    // 특정 대화의 감정 타임라인 (AI 메시지만)
    const result = await db.select({
      turnIndex: chatMessages.turnIndex,
      emotion: chatMessages.emotion,
      message: chatMessages.message
    })
    .from(chatMessages)
    .where(and(
      eq(chatMessages.personaRunId, personaRunId),
      eq(chatMessages.sender, 'ai')
    ))
    .orderBy(asc(chatMessages.turnIndex));
    
    return result;
  }

  async deleteScenarioRun(id: string): Promise<void> {
    await db.delete(scenarioRuns).where(eq(scenarioRuns.id, id));
  }

  // System Settings
  async getSystemSettings(): Promise<SystemSetting[]> {
    return await db.select().from(systemSettings).orderBy(asc(systemSettings.category), asc(systemSettings.key));
  }

  async getSystemSettingsByCategory(category: string): Promise<SystemSetting[]> {
    return await db.select().from(systemSettings).where(eq(systemSettings.category, category)).orderBy(asc(systemSettings.key));
  }

  async getSystemSetting(category: string, key: string): Promise<SystemSetting | undefined> {
    const [setting] = await db.select().from(systemSettings)
      .where(and(eq(systemSettings.category, category), eq(systemSettings.key, key)));
    return setting;
  }

  async upsertSystemSetting(setting: { category: string; key: string; value: string; description?: string; updatedBy?: string }): Promise<SystemSetting> {
    // Check if setting exists
    const existing = await this.getSystemSetting(setting.category, setting.key);
    
    if (existing) {
      // Update existing
      const [updated] = await db.update(systemSettings)
        .set({ 
          value: setting.value, 
          description: setting.description,
          updatedBy: setting.updatedBy,
          updatedAt: new Date()
        })
        .where(and(eq(systemSettings.category, setting.category), eq(systemSettings.key, setting.key)))
        .returning();
      return updated;
    } else {
      // Insert new
      const [inserted] = await db.insert(systemSettings).values({
        category: setting.category,
        key: setting.key,
        value: setting.value,
        description: setting.description,
        updatedBy: setting.updatedBy,
      }).returning();
      return inserted;
    }
  }

  async deleteSystemSetting(category: string, key: string): Promise<void> {
    await db.delete(systemSettings)
      .where(and(eq(systemSettings.category, category), eq(systemSettings.key, key)));
  }
  
  // AI Usage Logs
  async createAiUsageLog(log: InsertAiUsageLog): Promise<AiUsageLog> {
    const [inserted] = await db.insert(aiUsageLogs).values(log as any).returning();
    return inserted;
  }
  
  async getAiUsageSummary(startDate: Date, endDate: Date): Promise<AiUsageSummary> {
    const result = await db.select({
      totalTokens: sqlBuilder<number>`COALESCE(SUM(${aiUsageLogs.totalTokens}), 0)::integer`,
      promptTokens: sqlBuilder<number>`COALESCE(SUM(${aiUsageLogs.promptTokens}), 0)::integer`,
      completionTokens: sqlBuilder<number>`COALESCE(SUM(${aiUsageLogs.completionTokens}), 0)::integer`,
      totalCostUsd: sqlBuilder<number>`COALESCE(SUM(${aiUsageLogs.totalCostUsd}), 0)::float`,
      requestCount: sqlBuilder<number>`COUNT(*)::integer`,
    })
    .from(aiUsageLogs)
    .where(and(
      gte(aiUsageLogs.occurredAt, startDate),
      lte(aiUsageLogs.occurredAt, endDate)
    ));
    
    return result[0] || { totalTokens: 0, promptTokens: 0, completionTokens: 0, totalCostUsd: 0, requestCount: 0 };
  }
  
  async getAiUsageByFeature(startDate: Date, endDate: Date): Promise<AiUsageByFeature[]> {
    const result = await db.select({
      feature: aiUsageLogs.feature,
      totalTokens: sqlBuilder<number>`COALESCE(SUM(${aiUsageLogs.totalTokens}), 0)::integer`,
      totalCostUsd: sqlBuilder<number>`COALESCE(SUM(${aiUsageLogs.totalCostUsd}), 0)::float`,
      requestCount: sqlBuilder<number>`COUNT(*)::integer`,
    })
    .from(aiUsageLogs)
    .where(and(
      gte(aiUsageLogs.occurredAt, startDate),
      lte(aiUsageLogs.occurredAt, endDate)
    ))
    .groupBy(aiUsageLogs.feature)
    .orderBy(desc(sqlBuilder`SUM(${aiUsageLogs.totalTokens})`));
    
    return result;
  }
  
  async getAiUsageByModel(startDate: Date, endDate: Date): Promise<AiUsageByModel[]> {
    const result = await db.select({
      model: aiUsageLogs.model,
      provider: aiUsageLogs.provider,
      totalTokens: sqlBuilder<number>`COALESCE(SUM(${aiUsageLogs.totalTokens}), 0)::integer`,
      totalCostUsd: sqlBuilder<number>`COALESCE(SUM(${aiUsageLogs.totalCostUsd}), 0)::float`,
      requestCount: sqlBuilder<number>`COUNT(*)::integer`,
    })
    .from(aiUsageLogs)
    .where(and(
      gte(aiUsageLogs.occurredAt, startDate),
      lte(aiUsageLogs.occurredAt, endDate)
    ))
    .groupBy(aiUsageLogs.model, aiUsageLogs.provider)
    .orderBy(desc(sqlBuilder`SUM(${aiUsageLogs.totalTokens})`));
    
    return result;
  }
  
  async getAiUsageDaily(startDate: Date, endDate: Date): Promise<AiUsageDaily[]> {
    const result = await db.select({
      date: sqlBuilder<string>`TO_CHAR(${aiUsageLogs.occurredAt}, 'YYYY-MM-DD')`,
      totalTokens: sqlBuilder<number>`COALESCE(SUM(${aiUsageLogs.totalTokens}), 0)::integer`,
      totalCostUsd: sqlBuilder<number>`COALESCE(SUM(${aiUsageLogs.totalCostUsd}), 0)::float`,
      requestCount: sqlBuilder<number>`COUNT(*)::integer`,
    })
    .from(aiUsageLogs)
    .where(and(
      gte(aiUsageLogs.occurredAt, startDate),
      lte(aiUsageLogs.occurredAt, endDate)
    ))
    .groupBy(sqlBuilder`TO_CHAR(${aiUsageLogs.occurredAt}, 'YYYY-MM-DD')`)
    .orderBy(asc(sqlBuilder`TO_CHAR(${aiUsageLogs.occurredAt}, 'YYYY-MM-DD')`));
    
    return result;
  }
  
  async getAiUsageLogs(startDate: Date, endDate: Date, limit: number = 100): Promise<AiUsageLog[]> {
    return await db.select()
      .from(aiUsageLogs)
      .where(and(
        gte(aiUsageLogs.occurredAt, startDate),
        lte(aiUsageLogs.occurredAt, endDate)
      ))
      .orderBy(desc(aiUsageLogs.occurredAt))
      .limit(limit);
  }
  
  // Evaluation Criteria Sets
  async createEvaluationCriteriaSet(criteriaSet: InsertEvaluationCriteriaSet): Promise<EvaluationCriteriaSet> {
    const [inserted] = await db.insert(evaluationCriteriaSets).values(criteriaSet as any).returning();
    return inserted;
  }
  
  async getEvaluationCriteriaSet(id: string): Promise<EvaluationCriteriaSet | undefined> {
    const results = await db.select().from(evaluationCriteriaSets).where(eq(evaluationCriteriaSets.id, id));
    return results[0];
  }
  
  async getAllEvaluationCriteriaSets(): Promise<EvaluationCriteriaSet[]> {
    return await db.select().from(evaluationCriteriaSets).orderBy(desc(evaluationCriteriaSets.createdAt));
  }
  
  async getActiveEvaluationCriteriaSets(): Promise<EvaluationCriteriaSet[]> {
    return await db.select().from(evaluationCriteriaSets)
      .where(eq(evaluationCriteriaSets.isActive, true))
      .orderBy(desc(evaluationCriteriaSets.createdAt));
  }
  
  async getDefaultEvaluationCriteriaSet(): Promise<EvaluationCriteriaSet | undefined> {
    const results = await db.select().from(evaluationCriteriaSets)
      .where(and(
        eq(evaluationCriteriaSets.isDefault, true),
        eq(evaluationCriteriaSets.isActive, true)
      ));
    return results[0];
  }
  
  async getEvaluationCriteriaSetByCategory(categoryId: string): Promise<EvaluationCriteriaSet | undefined> {
    const results = await db.select().from(evaluationCriteriaSets)
      .where(and(
        eq(evaluationCriteriaSets.categoryId, categoryId),
        eq(evaluationCriteriaSets.isActive, true)
      ));
    return results[0];
  }
  
  async updateEvaluationCriteriaSet(id: string, updates: Partial<InsertEvaluationCriteriaSet>): Promise<EvaluationCriteriaSet> {
    const [updated] = await db.update(evaluationCriteriaSets)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(evaluationCriteriaSets.id, id))
      .returning();
    return updated;
  }
  
  async deleteEvaluationCriteriaSet(id: string): Promise<void> {
    await db.delete(evaluationCriteriaSets).where(eq(evaluationCriteriaSets.id, id));
  }
  
  async setDefaultEvaluationCriteriaSet(id: string): Promise<void> {
    // First, unset all defaults
    await db.update(evaluationCriteriaSets).set({ isDefault: false });
    // Then set the new default
    await db.update(evaluationCriteriaSets)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(evaluationCriteriaSets.id, id));
  }
  
  // Evaluation Dimensions
  async createEvaluationDimension(dimension: InsertEvaluationDimension): Promise<EvaluationDimension> {
    const [inserted] = await db.insert(evaluationDimensions).values(dimension as any).returning();
    return inserted;
  }
  
  async getEvaluationDimension(id: string): Promise<EvaluationDimension | undefined> {
    const results = await db.select().from(evaluationDimensions).where(eq(evaluationDimensions.id, id));
    return results[0];
  }
  
  async getEvaluationDimensionsByCriteriaSet(criteriaSetId: string): Promise<EvaluationDimension[]> {
    return await db.select().from(evaluationDimensions)
      .where(eq(evaluationDimensions.criteriaSetId, criteriaSetId))
      .orderBy(asc(evaluationDimensions.displayOrder));
  }
  
  async updateEvaluationDimension(id: string, updates: Partial<InsertEvaluationDimension>): Promise<EvaluationDimension> {
    const [updated] = await db.update(evaluationDimensions)
      .set(updates as any)
      .where(eq(evaluationDimensions.id, id))
      .returning();
    return updated;
  }
  
  async deleteEvaluationDimension(id: string): Promise<void> {
    await db.delete(evaluationDimensions).where(eq(evaluationDimensions.id, id));
  }
  
  // Combined operations
  async getEvaluationCriteriaSetWithDimensions(id: string): Promise<EvaluationCriteriaSetWithDimensions | undefined> {
    const criteriaSet = await this.getEvaluationCriteriaSet(id);
    if (!criteriaSet) return undefined;
    
    const dimensions = await this.getEvaluationDimensionsByCriteriaSet(id);
    return { ...criteriaSet, dimensions };
  }
  
  async getActiveEvaluationCriteriaSetWithDimensions(categoryId?: string): Promise<EvaluationCriteriaSetWithDimensions | undefined> {
    let criteriaSet: EvaluationCriteriaSet | undefined;
    
    // 1. 카테고리 ID가 있으면 해당 카테고리의 기준 세트 찾기
    if (categoryId) {
      criteriaSet = await this.getEvaluationCriteriaSetByCategory(categoryId);
    }
    
    // 2. 카테고리별 기준이 없으면 기본 기준 세트 사용
    if (!criteriaSet) {
      criteriaSet = await this.getDefaultEvaluationCriteriaSet();
    }
    
    // 3. 기본 기준도 없으면 undefined 반환
    if (!criteriaSet) return undefined;
    
    const dimensions = await this.getEvaluationDimensionsByCriteriaSet(criteriaSet.id);
    return { ...criteriaSet, dimensions };
  }
  
  // ================================
  // Supported Languages operations
  // ================================
  
  async getSupportedLanguages(): Promise<SupportedLanguage[]> {
    return await db.select().from(supportedLanguages).orderBy(asc(supportedLanguages.displayOrder));
  }
  
  async getActiveSupportedLanguages(): Promise<SupportedLanguage[]> {
    return await db.select().from(supportedLanguages)
      .where(eq(supportedLanguages.isActive, true))
      .orderBy(asc(supportedLanguages.displayOrder));
  }
  
  async getSupportedLanguage(code: string): Promise<SupportedLanguage | undefined> {
    const results = await db.select().from(supportedLanguages).where(eq(supportedLanguages.code, code));
    return results[0];
  }
  
  async createSupportedLanguage(language: InsertSupportedLanguage): Promise<SupportedLanguage> {
    const [created] = await db.insert(supportedLanguages).values(language).returning();
    return created;
  }
  
  async updateSupportedLanguage(code: string, updates: Partial<InsertSupportedLanguage>): Promise<SupportedLanguage> {
    const [updated] = await db.update(supportedLanguages)
      .set(updates)
      .where(eq(supportedLanguages.code, code))
      .returning();
    return updated;
  }
  
  async deleteSupportedLanguage(code: string): Promise<void> {
    await db.delete(supportedLanguages).where(eq(supportedLanguages.code, code));
  }
  
  // ================================
  // Scenario Translations operations
  // ================================
  
  async getScenarioTranslation(scenarioId: string, locale: string): Promise<ScenarioTranslation | undefined> {
    const results = await db.select().from(scenarioTranslations)
      .where(and(
        eq(scenarioTranslations.scenarioId, scenarioId),
        eq(scenarioTranslations.locale, locale)
      ));
    return results[0];
  }
  
  async getScenarioTranslations(scenarioId: string): Promise<ScenarioTranslation[]> {
    return await db.select().from(scenarioTranslations)
      .where(eq(scenarioTranslations.scenarioId, scenarioId));
  }
  
  async getAllScenarioTranslations(locale: string): Promise<ScenarioTranslation[]> {
    return await db.select().from(scenarioTranslations)
      .where(eq(scenarioTranslations.locale, locale));
  }
  
  async getOriginalScenarioTranslation(scenarioId: string): Promise<ScenarioTranslation | undefined> {
    const results = await db.select().from(scenarioTranslations)
      .where(and(
        eq(scenarioTranslations.scenarioId, scenarioId),
        eq(scenarioTranslations.isOriginal, true)
      ));
    return results[0];
  }
  
  async getScenarioTranslationWithFallback(scenarioId: string, locale: string): Promise<ScenarioTranslation | undefined> {
    const translation = await this.getScenarioTranslation(scenarioId, locale);
    if (translation) return translation;
    return await this.getOriginalScenarioTranslation(scenarioId);
  }
  
  async upsertScenarioTranslation(translation: InsertScenarioTranslation): Promise<ScenarioTranslation> {
    const existing = await this.getScenarioTranslation(translation.scenarioId, translation.locale);
    
    if (existing) {
      const [updated] = await db.update(scenarioTranslations)
        .set({ ...translation, updatedAt: new Date() })
        .where(eq(scenarioTranslations.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(scenarioTranslations).values(translation).returning();
      return created;
    }
  }
  
  async deleteScenarioTranslation(scenarioId: string, locale: string): Promise<void> {
    await db.delete(scenarioTranslations)
      .where(and(
        eq(scenarioTranslations.scenarioId, scenarioId),
        eq(scenarioTranslations.locale, locale)
      ));
  }
  
  async markScenarioTranslationReviewed(scenarioId: string, locale: string, reviewerId: string): Promise<ScenarioTranslation> {
    const [updated] = await db.update(scenarioTranslations)
      .set({ isReviewed: true, reviewedBy: reviewerId, updatedAt: new Date() })
      .where(and(
        eq(scenarioTranslations.scenarioId, scenarioId),
        eq(scenarioTranslations.locale, locale)
      ))
      .returning();
    return updated;
  }
  
  // ================================
  // Persona Translations operations
  // ================================
  
  async getPersonaTranslation(personaId: string, locale: string): Promise<PersonaTranslation | undefined> {
    const results = await db.select().from(personaTranslations)
      .where(and(
        eq(personaTranslations.personaId, personaId),
        eq(personaTranslations.locale, locale)
      ));
    return results[0];
  }
  
  async getPersonaTranslations(personaId: string): Promise<PersonaTranslation[]> {
    return await db.select().from(personaTranslations)
      .where(eq(personaTranslations.personaId, personaId));
  }
  
  async getAllPersonaTranslations(locale: string): Promise<PersonaTranslation[]> {
    return await db.select().from(personaTranslations)
      .where(eq(personaTranslations.locale, locale));
  }
  
  async upsertPersonaTranslation(translation: InsertPersonaTranslation): Promise<PersonaTranslation> {
    const existing = await this.getPersonaTranslation(translation.personaId, translation.locale);
    
    if (existing) {
      const [updated] = await db.update(personaTranslations)
        .set({ ...translation, updatedAt: new Date() })
        .where(eq(personaTranslations.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(personaTranslations).values(translation).returning();
      return created;
    }
  }
  
  async deletePersonaTranslation(personaId: string, locale: string): Promise<void> {
    await db.delete(personaTranslations)
      .where(and(
        eq(personaTranslations.personaId, personaId),
        eq(personaTranslations.locale, locale)
      ));
  }
  
  async markPersonaTranslationReviewed(personaId: string, locale: string, reviewerId: string): Promise<PersonaTranslation> {
    const [updated] = await db.update(personaTranslations)
      .set({ isReviewed: true, reviewedBy: reviewerId, updatedAt: new Date() })
      .where(and(
        eq(personaTranslations.personaId, personaId),
        eq(personaTranslations.locale, locale)
      ))
      .returning();
    return updated;
  }
  
  // ================================
  // Category Translations operations
  // ================================
  
  async getCategoryTranslation(categoryId: string, locale: string): Promise<CategoryTranslation | undefined> {
    const results = await db.select().from(categoryTranslations)
      .where(and(
        eq(categoryTranslations.categoryId, categoryId),
        eq(categoryTranslations.locale, locale)
      ));
    return results[0];
  }
  
  async getCategoryTranslations(categoryId: string): Promise<CategoryTranslation[]> {
    return await db.select().from(categoryTranslations)
      .where(eq(categoryTranslations.categoryId, categoryId));
  }
  
  async upsertCategoryTranslation(translation: InsertCategoryTranslation): Promise<CategoryTranslation> {
    const existing = await this.getCategoryTranslation(translation.categoryId, translation.locale);
    
    if (existing) {
      const [updated] = await db.update(categoryTranslations)
        .set({ ...translation, updatedAt: new Date() })
        .where(eq(categoryTranslations.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(categoryTranslations).values(translation).returning();
      return created;
    }
  }
  
  async deleteCategoryTranslation(categoryId: string, locale: string): Promise<void> {
    await db.delete(categoryTranslations)
      .where(and(
        eq(categoryTranslations.categoryId, categoryId),
        eq(categoryTranslations.locale, locale)
      ));
  }
  
  // Scenarios - 시나리오 (DB 기반)
  async getScenario(id: string): Promise<Scenario | undefined> {
    const [scenario] = await db.select().from(scenarios).where(eq(scenarios.id, id));
    return scenario;
  }
  
  async getAllScenarios(): Promise<Scenario[]> {
    return await db.select().from(scenarios).orderBy(desc(scenarios.createdAt));
  }
  
  async getScenariosByCategory(categoryId: string): Promise<Scenario[]> {
    return await db.select().from(scenarios)
      .where(eq(scenarios.categoryId, categoryId))
      .orderBy(desc(scenarios.createdAt));
  }
  
  async createScenario(scenario: InsertScenario): Promise<Scenario> {
    const [created] = await db.insert(scenarios).values(scenario as any).returning();
    return created;
  }
  
  async updateScenario(id: string, updates: Partial<InsertScenario>): Promise<Scenario> {
    const [updated] = await db.update(scenarios)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(scenarios.id, id))
      .returning();
    if (!updated) {
      throw new Error("Scenario not found");
    }
    return updated;
  }
  
  async deleteScenario(id: string): Promise<void> {
    await db.delete(scenarios).where(eq(scenarios.id, id));
  }
  
  // MBTI Personas - MBTI 페르소나 (DB 기반)
  async getMbtiPersona(id: string): Promise<MbtiPersona | undefined> {
    const [persona] = await db.select().from(mbtiPersonas).where(eq(mbtiPersonas.id, id));
    return persona;
  }
  
  async getAllMbtiPersonas(): Promise<MbtiPersona[]> {
    return await db.select().from(mbtiPersonas).orderBy(asc(mbtiPersonas.mbti));
  }
  
  async createMbtiPersona(persona: InsertMbtiPersona): Promise<MbtiPersona> {
    const [created] = await db.insert(mbtiPersonas).values(persona as any).returning();
    return created;
  }
  
  async updateMbtiPersona(id: string, updates: Partial<InsertMbtiPersona>): Promise<MbtiPersona> {
    const [updated] = await db.update(mbtiPersonas)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(mbtiPersonas.id, id))
      .returning();
    if (!updated) {
      throw new Error("MbtiPersona not found");
    }
    return updated;
  }
  
  async deleteMbtiPersona(id: string): Promise<void> {
    await db.delete(mbtiPersonas).where(eq(mbtiPersonas.id, id));
  }
  
  // ==================== 3단 계층 구조: 회사 > 조직 > 카테고리 ====================
  
  // Companies - 회사 관리
  async getCompany(id: string): Promise<Company | undefined> {
    const [company] = await db.select().from(companies).where(eq(companies.id, id));
    return company;
  }
  
  async getCompanyByName(name: string): Promise<Company | undefined> {
    const [company] = await db.select().from(companies).where(eq(companies.name, name));
    return company;
  }
  
  async getAllCompanies(): Promise<Company[]> {
    return await db.select().from(companies).orderBy(asc(companies.name));
  }
  
  async getActiveCompanies(): Promise<Company[]> {
    return await db.select().from(companies)
      .where(eq(companies.isActive, true))
      .orderBy(asc(companies.name));
  }
  
  async createCompany(company: InsertCompany): Promise<Company> {
    const [created] = await db.insert(companies).values(company).returning();
    return created;
  }
  
  async updateCompany(id: string, updates: Partial<InsertCompany>): Promise<Company> {
    const [updated] = await db.update(companies)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(companies.id, id))
      .returning();
    if (!updated) {
      throw new Error("Company not found");
    }
    return updated;
  }
  
  async deleteCompany(id: string): Promise<void> {
    await db.delete(companies).where(eq(companies.id, id));
  }
  
  // Organizations - 조직 관리
  async getOrganization(id: string): Promise<Organization | undefined> {
    const [organization] = await db.select().from(organizations).where(eq(organizations.id, id));
    return organization;
  }
  
  async getOrganizationsByCompany(companyId: string): Promise<Organization[]> {
    return await db.select().from(organizations)
      .where(eq(organizations.companyId, companyId))
      .orderBy(asc(organizations.name));
  }
  
  async getActiveOrganizationsByCompany(companyId: string): Promise<Organization[]> {
    return await db.select().from(organizations)
      .where(and(
        eq(organizations.companyId, companyId),
        eq(organizations.isActive, true)
      ))
      .orderBy(asc(organizations.name));
  }
  
  async getAllOrganizations(): Promise<Organization[]> {
    return await db.select().from(organizations).orderBy(asc(organizations.name));
  }
  
  async createOrganization(organization: InsertOrganization): Promise<Organization> {
    const [created] = await db.insert(organizations).values(organization).returning();
    return created;
  }
  
  async updateOrganization(id: string, updates: Partial<InsertOrganization>): Promise<Organization> {
    const [updated] = await db.update(organizations)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(organizations.id, id))
      .returning();
    if (!updated) {
      throw new Error("Organization not found");
    }
    return updated;
  }
  
  async deleteOrganization(id: string): Promise<void> {
    await db.delete(organizations).where(eq(organizations.id, id));
  }
  
  // Categories (확장) - 조직별 카테고리
  async getCategoriesByOrganization(organizationId: string): Promise<Category[]> {
    return await db.select().from(categories)
      .where(eq(categories.organizationId, organizationId))
      .orderBy(asc(categories.order));
  }
  
  async getActiveCategoriesByOrganization(organizationId: string): Promise<Category[]> {
    return await db.select().from(categories)
      .where(and(
        eq(categories.organizationId, organizationId),
        eq(categories.isActive, true)
      ))
      .orderBy(asc(categories.order));
  }
  
  // Operator Assignments - 운영자 권한 할당
  async getOperatorAssignment(id: string): Promise<OperatorAssignment | undefined> {
    const [assignment] = await db.select().from(operatorAssignments).where(eq(operatorAssignments.id, id));
    return assignment;
  }
  
  async getOperatorAssignmentsByUser(userId: string): Promise<OperatorAssignment[]> {
    return await db.select().from(operatorAssignments)
      .where(eq(operatorAssignments.userId, userId));
  }
  
  async getOperatorAssignmentsByCompany(companyId: string): Promise<OperatorAssignment[]> {
    return await db.select().from(operatorAssignments)
      .where(eq(operatorAssignments.companyId, companyId));
  }
  
  async getOperatorAssignmentsByOrganization(organizationId: string): Promise<OperatorAssignment[]> {
    return await db.select().from(operatorAssignments)
      .where(eq(operatorAssignments.organizationId, organizationId));
  }
  
  async createOperatorAssignment(assignment: InsertOperatorAssignment): Promise<OperatorAssignment> {
    const [created] = await db.insert(operatorAssignments).values(assignment).returning();
    return created;
  }
  
  async deleteOperatorAssignment(id: string): Promise<void> {
    await db.delete(operatorAssignments).where(eq(operatorAssignments.id, id));
  }
  
  async deleteOperatorAssignmentsByUser(userId: string): Promise<void> {
    await db.delete(operatorAssignments).where(eq(operatorAssignments.userId, userId));
  }
  
  // 운영자 권한 확인 헬퍼
  async canOperatorManageCompany(userId: string, companyId: string): Promise<boolean> {
    const assignments = await this.getOperatorAssignmentsByUser(userId);
    return assignments.some(a => a.companyId === companyId && !a.organizationId);
  }
  
  async canOperatorManageOrganization(userId: string, organizationId: string): Promise<boolean> {
    const assignments = await this.getOperatorAssignmentsByUser(userId);
    // 직접 조직 할당 또는 상위 회사 할당 확인
    if (assignments.some(a => a.organizationId === organizationId)) {
      return true;
    }
    // 상위 회사 전체 관리 권한 확인
    const organization = await this.getOrganization(organizationId);
    if (organization) {
      return assignments.some(a => a.companyId === organization.companyId && !a.organizationId);
    }
    return false;
  }
  
  async canOperatorManageCategory(userId: string, categoryId: string): Promise<boolean> {
    const category = await this.getCategory(categoryId);
    if (!category || !category.organizationId) {
      return false;
    }
    return this.canOperatorManageOrganization(userId, category.organizationId);
  }
  
  async getOperatorManagedCompanyIds(userId: string): Promise<string[]> {
    const assignments = await this.getOperatorAssignmentsByUser(userId);
    // 회사 레벨 할당만 반환 (조직 없이 회사만 할당된 경우)
    return assignments
      .filter(a => a.companyId && !a.organizationId)
      .map(a => a.companyId as string);
  }
  
  async getOperatorManagedOrganizationIds(userId: string): Promise<string[]> {
    const assignments = await this.getOperatorAssignmentsByUser(userId);
    const managedOrgIds: string[] = [];
    
    // 직접 조직 할당
    assignments.forEach(a => {
      if (a.organizationId) {
        managedOrgIds.push(a.organizationId);
      }
    });
    
    // 회사 레벨 할당의 경우 해당 회사 하위 모든 조직 포함
    for (const assignment of assignments) {
      if (assignment.companyId && !assignment.organizationId) {
        const orgs = await this.getOrganizationsByCompany(assignment.companyId);
        orgs.forEach(org => {
          if (!managedOrgIds.includes(org.id)) {
            managedOrgIds.push(org.id);
          }
        });
      }
    }
    
    return managedOrgIds;
  }
  
  async getOperatorManagedCategoryIds(userId: string): Promise<string[]> {
    const managedOrgIds = await this.getOperatorManagedOrganizationIds(userId);
    const categoryIds: string[] = [];
    
    for (const orgId of managedOrgIds) {
      const cats = await this.getCategoriesByOrganization(orgId);
      cats.forEach(cat => categoryIds.push(cat.id));
    }
    
    return categoryIds;
  }
  
  // 사용자 소속 관리
  async getUsersByCompany(companyId: string): Promise<User[]> {
    return await db.select().from(users)
      .where(eq(users.companyId, companyId))
      .orderBy(asc(users.name));
  }
  
  async getUsersByOrganization(organizationId: string): Promise<User[]> {
    return await db.select().from(users)
      .where(eq(users.organizationId, organizationId))
      .orderBy(asc(users.name));
  }
  
  async updateUserCompanyOrganization(userId: string, companyId: string | null, organizationId: string | null): Promise<User> {
    const [updated] = await db.update(users)
      .set({ 
        companyId: companyId, 
        organizationId: organizationId,
        updatedAt: new Date() 
      })
      .where(eq(users.id, userId))
      .returning();
    if (!updated) {
      throw new Error("User not found");
    }
    return updated;
  }
}

// Use PostgreSQL storage instead of memory storage
export const storage = new PostgreSQLStorage();
