import { type Conversation, type InsertConversation, type Feedback, type InsertFeedback, type PersonaSelection, type StrategyChoice, type SequenceAnalysis, type User, type UpsertUser, type ScenarioRun, type InsertScenarioRun, type PersonaRun, type InsertPersonaRun, type ChatMessage, type InsertChatMessage, type Category, type InsertCategory, type SystemSetting, conversations, feedbacks, users, scenarioRuns, personaRuns, chatMessages, categories, systemSettings } from "@shared/schema";
import { randomUUID } from "crypto";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, asc, desc, inArray, and } from "drizzle-orm";

// Initialize database connection
const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

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

  // User operations - 이메일 기반 인증 시스템
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: { email: string; password: string; name: string; assignedCategoryId?: string | null }): Promise<User>;
  updateUser(id: string, updates: { name?: string; password?: string; profileImage?: string; tier?: string }): Promise<User>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUserLastLogin(id: string): Promise<void>;
  
  // System Admin operations - 시스템 관리자 전용
  getAllUsers(): Promise<User[]>;
  adminUpdateUser(id: string, updates: { role?: string; tier?: string; isActive?: boolean; assignedCategoryId?: string | null }): Promise<User>;
  
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

  async createUser(userData: { email: string; password: string; name: string; assignedCategoryId?: string | null }): Promise<User> {
    const id = randomUUID();
    const user: User = {
      id,
      email: userData.email,
      password: userData.password,
      name: userData.name,
      role: 'user',
      profileImage: null,
      tier: 'bronze',
      isActive: true,
      lastLoginAt: null,
      assignedCategoryId: userData.assignedCategoryId || null,
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
      isActive: existingUser?.isActive ?? true,
      lastLoginAt: existingUser?.lastLoginAt || null,
      assignedCategoryId: existingUser?.assignedCategoryId || null,
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

  async adminUpdateUser(id: string, updates: { role?: string; tier?: string; isActive?: boolean; assignedCategoryId?: string | null }): Promise<User> {
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

  async createUser(userData: { email: string; password: string; name: string; assignedCategoryId?: string | null }): Promise<User> {
    const [user] = await db.insert(users).values(userData).returning();
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

  async adminUpdateUser(id: string, updates: { role?: string; tier?: string; isActive?: boolean; assignedCategoryId?: string | null }): Promise<User> {
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
}

// Use PostgreSQL storage instead of memory storage
export const storage = new PostgreSQLStorage();
