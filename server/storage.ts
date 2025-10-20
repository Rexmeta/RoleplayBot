import { type Conversation, type InsertConversation, type Feedback, type InsertFeedback, type PersonaSelection, type StrategyChoice, type SequenceAnalysis, type User, type UpsertUser, conversations, feedbacks, users } from "@shared/schema";
import { randomUUID } from "crypto";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";

// Initialize database connection
const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql);

export interface IStorage {
  // Conversations
  createConversation(conversation: InsertConversation): Promise<Conversation>;
  getConversation(id: string): Promise<Conversation | undefined>;
  updateConversation(id: string, updates: Partial<Conversation>): Promise<Conversation>;
  getAllConversations(): Promise<Conversation[]>;
  
  // Feedback
  createFeedback(feedback: InsertFeedback): Promise<Feedback>;
  getFeedbackByConversationId(conversationId: string): Promise<Feedback | undefined>;
  getAllFeedbacks(): Promise<Feedback[]>;
  
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

  // User operations - 이메일 기반 인증 시스템
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: { email: string; password: string; name: string }): Promise<User>;
  upsertUser(user: UpsertUser): Promise<User>;
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
      scenarioId: insertConversation.scenarioId,
      personaId: insertConversation.personaId || null,
      scenarioName: insertConversation.scenarioName,
      messages: insertConversation.messages as any,
      turnCount: insertConversation.turnCount || 0,
      status: insertConversation.status || "active",
      createdAt: new Date(),
      completedAt: null,
      conversationType: insertConversation.conversationType || "single",
      currentPhase: insertConversation.currentPhase || 1,
      totalPhases: insertConversation.totalPhases || 1,
      personaSelections: insertConversation.personaSelections || [],
      strategyChoices: insertConversation.strategyChoices || [],
      sequenceAnalysis: insertConversation.sequenceAnalysis || null,
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

  async createFeedback(insertFeedback: InsertFeedback): Promise<Feedback> {
    const id = randomUUID();
    const feedback: Feedback = {
      id,
      conversationId: insertFeedback.conversationId,
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

  async getAllFeedbacks(): Promise<Feedback[]> {
    return Array.from(this.feedbacks.values());
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

  async createUser(userData: { email: string; password: string; name: string }): Promise<User> {
    const id = randomUUID();
    const user: User = {
      id,
      email: userData.email,
      password: userData.password,
      name: userData.name,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    this.users.set(id, user);
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const existingUser = this.users.get(userData.id as string);
    
    const user: User = {
      id: userData.id as string,
      email: userData.email || '',
      password: '', // 기본값
      name: userData.name || '',
      createdAt: existingUser?.createdAt || new Date(),
      updatedAt: new Date(),
    };
    
    this.users.set(user.id, user);
    return user;
  }
}

export class PostgreSQLStorage implements IStorage {
  // Conversations
  async createConversation(insertConversation: InsertConversation): Promise<Conversation> {
    const [conversation] = await db.insert(conversations).values(insertConversation).returning();
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

  async getAllConversations(): Promise<Conversation[]> {
    return await db.select().from(conversations);
  }

  // Feedback
  async createFeedback(insertFeedback: InsertFeedback): Promise<Feedback> {
    const [feedback] = await db.insert(feedbacks).values(insertFeedback).returning();
    return feedback;
  }

  async getFeedbackByConversationId(conversationId: string): Promise<Feedback | undefined> {
    const [feedback] = await db.select().from(feedbacks).where(eq(feedbacks.conversationId, conversationId));
    return feedback;
  }

  async getAllFeedbacks(): Promise<Feedback[]> {
    return await db.select().from(feedbacks);
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

  async createUser(userData: { email: string; password: string; name: string }): Promise<User> {
    const [user] = await db.insert(users).values(userData).returning();
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
}

// Use PostgreSQL storage instead of memory storage
export const storage = new PostgreSQLStorage();
