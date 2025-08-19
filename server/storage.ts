import { type Conversation, type InsertConversation, type Feedback, type InsertFeedback } from "@shared/schema";
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
      scenarioName: insertConversation.scenarioName,
      messages: insertConversation.messages as any,
      turnCount: insertConversation.turnCount || 0,
      status: insertConversation.status || "active",
      createdAt: new Date(),
      completedAt: null,
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
}

export const storage = new MemStorage();
