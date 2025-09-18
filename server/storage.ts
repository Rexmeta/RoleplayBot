import { type Conversation, type InsertConversation, type Feedback, type InsertFeedback, type PersonaSelection, type StrategyChoice, type SequenceAnalysis } from "@shared/schema";
import { randomUUID } from "crypto";

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
}

export class MemStorage implements IStorage {
  private conversations: Map<string, Conversation>;
  private feedbacks: Map<string, Feedback>;

  constructor() {
    this.conversations = new Map();
    this.feedbacks = new Map();
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
}

export const storage = new MemStorage();
