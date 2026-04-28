import { type Conversation, type InsertConversation, type Feedback, type InsertFeedback, type PersonaSelection, type StrategyChoice, type SequenceAnalysis, conversations, feedbacks, scenarioRuns, personaRuns } from "@shared/schema";
import { db } from "./db";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";

export interface IConversationsStorage {
  createConversation(conversation: InsertConversation): Promise<Conversation>;
  getConversation(id: string): Promise<Conversation | undefined>;
  updateConversation(id: string, updates: Partial<Conversation>): Promise<Conversation>;
  deleteConversation(id: string): Promise<void>;
  getAllConversations(): Promise<Conversation[]>;
  getUserConversations(userId: string): Promise<Conversation[]>;

  createFeedback(feedback: InsertFeedback): Promise<Feedback>;
  getFeedbackByConversationId(conversationId: string): Promise<Feedback | undefined>;
  deleteFeedback(id: string): Promise<void>;
  getAllFeedbacks(): Promise<Feedback[]>;
  getUserFeedbacks(userId: string): Promise<Feedback[]>;

  addPersonaSelection(conversationId: string, selection: PersonaSelection): Promise<Conversation>;
  getPersonaSelections(conversationId: string): Promise<PersonaSelection[]>;
  addStrategyChoice(conversationId: string, choice: StrategyChoice): Promise<Conversation>;
  getStrategyChoices(conversationId: string): Promise<StrategyChoice[]>;
  saveSequenceAnalysis(conversationId: string, analysis: SequenceAnalysis): Promise<Conversation>;
  getSequenceAnalysis(conversationId: string): Promise<SequenceAnalysis | undefined>;
  saveStrategyReflection(conversationId: string, reflection: string, conversationOrder: string[]): Promise<Conversation>;
}

type Constructor<T = {}> = new (...args: any[]) => T;

export function ConversationsMixin<TBase extends Constructor>(Base: TBase) {
  return class extends Base implements IConversationsStorage {
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
      if (!conversation) throw new Error("Conversation not found");
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

    async createFeedback(insertFeedback: InsertFeedback): Promise<Feedback> {
      const [feedback] = await db.insert(feedbacks).values(insertFeedback as any).returning();
      return feedback;
    }

    async getFeedbackByConversationId(conversationId: string): Promise<Feedback | undefined> {
      const [feedbackByPersonaRun] = await db.select().from(feedbacks).where(eq(feedbacks.personaRunId, conversationId));
      if (feedbackByPersonaRun) return feedbackByPersonaRun;
      const [feedbackByConversation] = await db.select().from(feedbacks).where(eq(feedbacks.conversationId, conversationId));
      return feedbackByConversation;
    }

    async deleteFeedback(id: string): Promise<void> {
      await db.delete(feedbacks).where(eq(feedbacks.id, id));
    }

    async getAllFeedbacks(): Promise<Feedback[]> {
      return await db.select().from(feedbacks);
    }

    async getUserFeedbacks(userId: string): Promise<Feedback[]> {
      // 1) New structure: feedbacks linked via personaRunId -> scenarioRunId -> userId
      const userScenarioRuns = await db.select().from(scenarioRuns).where(eq(scenarioRuns.userId, userId));
      const scenarioRunIds = userScenarioRuns.map(sr => sr.id);
      const userPersonaRuns = scenarioRunIds.length > 0
        ? await db.select().from(personaRuns).where(inArray(personaRuns.scenarioRunId, scenarioRunIds))
        : [];
      const personaRunIds = userPersonaRuns.map(pr => pr.id);
      const newStructureFeedbacks = personaRunIds.length > 0
        ? await db.select().from(feedbacks).where(inArray(feedbacks.personaRunId, personaRunIds))
        : [];

      // 2) Legacy structure: feedbacks linked via conversationId -> conversations.userId
      const legacyResults = await db
        .select()
        .from(feedbacks)
        .innerJoin(conversations, eq(feedbacks.conversationId, conversations.id))
        .where(eq(conversations.userId, userId));
      const legacyFeedbacks = legacyResults.map(r => r.feedbacks);

      // 3) Merge, deduplicate by id, sort newest first
      const allFeedbacks = [...newStructureFeedbacks, ...legacyFeedbacks];
      const unique = Array.from(new Map(allFeedbacks.map(f => [f.id, f])).values())
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      console.log(`✅ UserFeedbacks for ${userId}: ${unique.length} feedbacks from ${newStructureFeedbacks.length} new + ${legacyFeedbacks.length} legacy`);
      return unique;
    }

    async addPersonaSelection(conversationId: string, selection: PersonaSelection): Promise<Conversation> {
      const existing = await this.getConversation(conversationId);
      if (!existing) throw new Error("Conversation not found");
      const currentSelections = existing.personaSelections || [];
      return await this.updateConversation(conversationId, { personaSelections: [...currentSelections, selection] });
    }

    async getPersonaSelections(conversationId: string): Promise<PersonaSelection[]> {
      const conversation = await this.getConversation(conversationId);
      return conversation?.personaSelections || [];
    }

    async addStrategyChoice(conversationId: string, choice: StrategyChoice): Promise<Conversation> {
      const existing = await this.getConversation(conversationId);
      if (!existing) throw new Error("Conversation not found");
      const currentChoices = existing.strategyChoices || [];
      return await this.updateConversation(conversationId, { strategyChoices: [...currentChoices, choice] });
    }

    async getStrategyChoices(conversationId: string): Promise<StrategyChoice[]> {
      const conversation = await this.getConversation(conversationId);
      return conversation?.strategyChoices || [];
    }

    async saveSequenceAnalysis(conversationId: string, analysis: SequenceAnalysis): Promise<Conversation> {
      return await this.updateConversation(conversationId, { sequenceAnalysis: analysis });
    }

    async getSequenceAnalysis(conversationId: string): Promise<SequenceAnalysis | undefined> {
      const conversation = await this.getConversation(conversationId);
      return conversation?.sequenceAnalysis || undefined;
    }

    async saveStrategyReflection(conversationId: string, reflection: string, conversationOrder: string[]): Promise<Conversation> {
      return await this.updateConversation(conversationId, {
        strategyReflection: reflection,
        conversationOrder: conversationOrder,
      });
    }
  };
}

export class MemConversationsStorage implements IConversationsStorage {
  private _conversations: Map<string, Conversation> = new Map();
  private _feedbacks: Map<string, Feedback> = new Map();

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
      difficulty: insertConversation.difficulty || 4,
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
    this._conversations.set(id, conversation);
    return conversation;
  }

  async getConversation(id: string): Promise<Conversation | undefined> {
    return this._conversations.get(id);
  }

  async updateConversation(id: string, updates: Partial<Conversation>): Promise<Conversation> {
    const existing = this._conversations.get(id);
    if (!existing) throw new Error("Conversation not found");
    const updated = { ...existing, ...updates };
    this._conversations.set(id, updated);
    return updated;
  }

  async deleteConversation(id: string): Promise<void> {
    this._conversations.delete(id);
    const feedbackToDelete = Array.from(this._feedbacks.entries()).find(([_, f]) => f.conversationId === id);
    if (feedbackToDelete) this._feedbacks.delete(feedbackToDelete[0]);
  }

  async getAllConversations(): Promise<Conversation[]> {
    return Array.from(this._conversations.values());
  }

  async getUserConversations(userId: string): Promise<Conversation[]> {
    return Array.from(this._conversations.values()).filter(c => c.userId === userId);
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
    this._feedbacks.set(id, feedback);
    return feedback;
  }

  async getFeedbackByConversationId(conversationId: string): Promise<Feedback | undefined> {
    return Array.from(this._feedbacks.values()).find(f => f.conversationId === conversationId || f.personaRunId === conversationId);
  }

  async deleteFeedback(id: string): Promise<void> {
    this._feedbacks.delete(id);
  }

  async getAllFeedbacks(): Promise<Feedback[]> {
    return Array.from(this._feedbacks.values());
  }

  async getUserFeedbacks(userId: string): Promise<Feedback[]> {
    const userConversationIds = Array.from(this._conversations.values())
      .filter(c => c.userId === userId)
      .map(c => c.id);
    return Array.from(this._feedbacks.values()).filter(
      f => f.conversationId && userConversationIds.includes(f.conversationId)
    );
  }

  async addPersonaSelection(conversationId: string, selection: PersonaSelection): Promise<Conversation> {
    const existing = this._conversations.get(conversationId);
    if (!existing) throw new Error("Conversation not found");
    const updated = { ...existing, personaSelections: [...(existing.personaSelections || []), selection] };
    this._conversations.set(conversationId, updated);
    return updated;
  }

  async getPersonaSelections(conversationId: string): Promise<PersonaSelection[]> {
    return this._conversations.get(conversationId)?.personaSelections || [];
  }

  async addStrategyChoice(conversationId: string, choice: StrategyChoice): Promise<Conversation> {
    const existing = this._conversations.get(conversationId);
    if (!existing) throw new Error("Conversation not found");
    const updated = { ...existing, strategyChoices: [...(existing.strategyChoices || []), choice] };
    this._conversations.set(conversationId, updated);
    return updated;
  }

  async getStrategyChoices(conversationId: string): Promise<StrategyChoice[]> {
    return this._conversations.get(conversationId)?.strategyChoices || [];
  }

  async saveSequenceAnalysis(conversationId: string, analysis: SequenceAnalysis): Promise<Conversation> {
    const existing = this._conversations.get(conversationId);
    if (!existing) throw new Error("Conversation not found");
    const updated = { ...existing, sequenceAnalysis: analysis };
    this._conversations.set(conversationId, updated);
    return updated;
  }

  async getSequenceAnalysis(conversationId: string): Promise<SequenceAnalysis | undefined> {
    return this._conversations.get(conversationId)?.sequenceAnalysis || undefined;
  }

  async saveStrategyReflection(conversationId: string, reflection: string, conversationOrder: string[]): Promise<Conversation> {
    const existing = this._conversations.get(conversationId);
    if (!existing) throw new Error("Conversation not found");
    const updated = { ...existing, strategyReflection: reflection, conversationOrder };
    this._conversations.set(conversationId, updated);
    return updated;
  }
}
