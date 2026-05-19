import { type ScenarioRun, type InsertScenarioRun, type PersonaRun, type InsertPersonaRun, type ChatMessage, type InsertChatMessage, type SimulationEvent, type InsertSimulationEvent, scenarioRuns, personaRuns, chatMessages, simulationEvents } from "@shared/schema";
import { db } from "./db";
import { eq, asc, desc, inArray, and, isNotNull, ne, sql } from "drizzle-orm";

export type ScenarioRunWithPersonaRuns = ScenarioRun & { personaRuns: PersonaRun[] };
export type EmotionStat = { emotion: string; count: number };
export type EmotionStatByScenario = { scenarioId: string; scenarioName: string; emotions: EmotionStat[]; totalCount: number };
export type EmotionStatByMbti = { mbti: string; emotions: EmotionStat[]; totalCount: number };
export type EmotionStatByDifficulty = { difficulty: number; emotions: EmotionStat[]; totalCount: number };
export type EmotionTimeline = { turnIndex: number; emotion: string | null; message: string };

export interface ISessionsStorage {
  createScenarioRun(scenarioRun: InsertScenarioRun): Promise<ScenarioRun>;
  getScenarioRun(id: string): Promise<ScenarioRun | undefined>;
  updateScenarioRun(id: string, updates: Partial<ScenarioRun>): Promise<ScenarioRun>;
  getUserScenarioRuns(userId: string): Promise<ScenarioRun[]>;
  getAllScenarioRuns(): Promise<ScenarioRun[]>;
  findActiveScenarioRun(userId: string, scenarioId: string): Promise<ScenarioRun | undefined>;
  abandonActiveScenarioRuns(userId: string, scenarioId: string): Promise<void>;
  getUserScenarioRunsWithPersonaRuns(userId: string): Promise<ScenarioRunWithPersonaRuns[]>;
  getScenarioRunWithPersonaRuns(id: string): Promise<ScenarioRunWithPersonaRuns | undefined>;

  createPersonaRun(personaRun: InsertPersonaRun): Promise<PersonaRun>;
  getPersonaRun(id: string): Promise<PersonaRun | undefined>;
  getPersonaRunByConversationId(conversationId: string): Promise<PersonaRun | undefined>;
  updatePersonaRun(id: string, updates: Partial<PersonaRun>): Promise<PersonaRun>;
  getPersonaRunsByScenarioRun(scenarioRunId: string): Promise<PersonaRun[]>;
  getAllPersonaRuns(): Promise<PersonaRun[]>;

  createChatMessage(message: InsertChatMessage): Promise<ChatMessage>;
  getChatMessagesByPersonaRun(personaRunId: string): Promise<ChatMessage[]>;
  deleteChatMessagesByPersonaRun(personaRunId: string): Promise<void>;
  getAllEmotionStats(scenarioIds?: string[]): Promise<EmotionStat[]>;
  getEmotionStatsByScenario(scenarioIds?: string[]): Promise<EmotionStatByScenario[]>;
  getEmotionStatsByMbti(scenarioIds?: string[]): Promise<EmotionStatByMbti[]>;
  getEmotionStatsByDifficulty(scenarioIds?: string[]): Promise<EmotionStatByDifficulty[]>;
  getEmotionTimelineByPersonaRun(personaRunId: string): Promise<EmotionTimeline[]>;

  deleteScenarioRun(id: string): Promise<void>;

  createSimulationEvent(event: InsertSimulationEvent): Promise<SimulationEvent>;
  getSimulationEventsByPersonaRun(personaRunId: string): Promise<SimulationEvent[]>;
  hasSimulationData(personaRunId: string): Promise<boolean>;
  getSimulationState(personaRunId: string): Promise<Record<string, unknown> | null>;
  saveSimulationState(personaRunId: string, state: Record<string, unknown>): Promise<void>;
}

type Constructor<T = {}> = new (...args: any[]) => T;

export function SessionsMixin<TBase extends Constructor>(Base: TBase) {
  return class extends Base implements ISessionsStorage {
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
      if (!scenarioRun) throw new Error("ScenarioRun not found");
      return scenarioRun;
    }

    async getUserScenarioRuns(userId: string): Promise<ScenarioRun[]> {
      return await db.select().from(scenarioRuns).where(and(eq(scenarioRuns.userId, userId), ne(scenarioRuns.status, 'abandoned'))).orderBy(desc(scenarioRuns.startedAt));
    }

    async getAllScenarioRuns(): Promise<ScenarioRun[]> {
      return await db.select().from(scenarioRuns).orderBy(desc(scenarioRuns.startedAt));
    }

    async findActiveScenarioRun(userId: string, scenarioId: string): Promise<ScenarioRun | undefined> {
      const [activeRun] = await db
        .select()
        .from(scenarioRuns)
        .where(and(eq(scenarioRuns.userId, userId), eq(scenarioRuns.scenarioId, scenarioId), eq(scenarioRuns.status, 'active')))
        .orderBy(desc(scenarioRuns.startedAt))
        .limit(1);
      return activeRun;
    }

    async abandonActiveScenarioRuns(userId: string, scenarioId: string): Promise<void> {
      await db
        .update(scenarioRuns)
        .set({ status: 'abandoned' })
        .where(and(eq(scenarioRuns.userId, userId), eq(scenarioRuns.scenarioId, scenarioId), eq(scenarioRuns.status, 'active')));
    }

    async getUserScenarioRunsWithPersonaRuns(userId: string): Promise<(ScenarioRun & { personaRuns: PersonaRun[] })[]> {
      const userScenarioRuns = await db.select().from(scenarioRuns).where(and(eq(scenarioRuns.userId, userId), ne(scenarioRuns.status, 'abandoned'))).orderBy(desc(scenarioRuns.startedAt));
      if (userScenarioRuns.length === 0) return [];
      const scenarioRunIds = userScenarioRuns.map(sr => sr.id);
      const allPersonaRuns = await db.select().from(personaRuns).where(inArray(personaRuns.scenarioRunId, scenarioRunIds)).orderBy(asc(personaRuns.phase));
      const personaRunsByScenarioId = new Map<string, PersonaRun[]>();
      for (const pr of allPersonaRuns) {
        const list = personaRunsByScenarioId.get(pr.scenarioRunId) ?? [];
        list.push(pr);
        personaRunsByScenarioId.set(pr.scenarioRunId, list);
      }
      return userScenarioRuns.map(sr => ({ ...sr, personaRuns: personaRunsByScenarioId.get(sr.id) ?? [] }));
    }

    async getScenarioRunWithPersonaRuns(id: string): Promise<(ScenarioRun & { personaRuns: PersonaRun[] }) | undefined> {
      const scenarioRun = await this.getScenarioRun(id);
      if (!scenarioRun) return undefined;
      const personas = await this.getPersonaRunsByScenarioRun(id);
      return { ...scenarioRun, personaRuns: personas };
    }

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
      if (!personaRun) throw new Error("PersonaRun not found");
      return personaRun;
    }

    async getPersonaRunsByScenarioRun(scenarioRunId: string): Promise<PersonaRun[]> {
      return await db.select().from(personaRuns).where(eq(personaRuns.scenarioRunId, scenarioRunId)).orderBy(asc(personaRuns.phase));
    }

    async getAllPersonaRuns(): Promise<PersonaRun[]> {
      return await db.select().from(personaRuns).orderBy(desc(personaRuns.startedAt));
    }

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
      const baseConditions: any[] = [eq(chatMessages.sender, 'ai'), isNotNull(chatMessages.emotion), ne(scenarioRuns.status, 'abandoned')];
      if (scenarioIds && scenarioIds.length > 0) baseConditions.push(inArray(scenarioRuns.scenarioId, scenarioIds));
      const result = await db.select({ emotion: chatMessages.emotion, count: sql<number>`count(*)::int` })
        .from(chatMessages)
        .innerJoin(personaRuns, eq(chatMessages.personaRunId, personaRuns.id))
        .innerJoin(scenarioRuns, eq(personaRuns.scenarioRunId, scenarioRuns.id))
        .where(and(...baseConditions))
        .groupBy(chatMessages.emotion)
        .orderBy(desc(sql`count(*)`));
      return result.filter(r => r.emotion !== null) as { emotion: string; count: number }[];
    }

    async getEmotionStatsByScenario(scenarioIds?: string[]): Promise<{ scenarioId: string; scenarioName: string; emotions: { emotion: string; count: number }[]; totalCount: number }[]> {
      const whereConditions: any[] = [eq(chatMessages.sender, 'ai'), isNotNull(chatMessages.emotion), ne(scenarioRuns.status, 'abandoned')];
      if (scenarioIds && scenarioIds.length > 0) whereConditions.push(inArray(scenarioRuns.scenarioId, scenarioIds));
      const result = await db.select({
        scenarioId: scenarioRuns.scenarioId,
        scenarioName: scenarioRuns.scenarioName,
        emotion: chatMessages.emotion,
        count: sql<number>`count(*)::int`,
      })
        .from(chatMessages)
        .innerJoin(personaRuns, eq(chatMessages.personaRunId, personaRuns.id))
        .innerJoin(scenarioRuns, eq(personaRuns.scenarioRunId, scenarioRuns.id))
        .where(and(...whereConditions))
        .groupBy(scenarioRuns.scenarioId, scenarioRuns.scenarioName, chatMessages.emotion)
        .orderBy(scenarioRuns.scenarioId, desc(sql`count(*)`));
      const scenarioMap = new Map<string, { scenarioId: string; scenarioName: string; emotions: { emotion: string; count: number }[]; totalCount: number }>();
      for (const row of result) {
        if (!row.emotion) continue;
        if (!scenarioMap.has(row.scenarioId)) {
          scenarioMap.set(row.scenarioId, { scenarioId: row.scenarioId, scenarioName: row.scenarioName, emotions: [], totalCount: 0 });
        }
        const scenario = scenarioMap.get(row.scenarioId)!;
        scenario.emotions.push({ emotion: row.emotion, count: row.count });
        scenario.totalCount += row.count;
      }
      return Array.from(scenarioMap.values()).sort((a, b) => b.totalCount - a.totalCount);
    }

    async getEmotionStatsByMbti(scenarioIds?: string[]): Promise<{ mbti: string; emotions: { emotion: string; count: number }[]; totalCount: number }[]> {
      const whereConditions: any[] = [eq(chatMessages.sender, 'ai'), isNotNull(chatMessages.emotion), isNotNull(personaRuns.mbtiType), ne(scenarioRuns.status, 'abandoned')];
      if (scenarioIds && scenarioIds.length > 0) whereConditions.push(inArray(scenarioRuns.scenarioId, scenarioIds));
      const result = await db.select({ mbti: personaRuns.mbtiType, emotion: chatMessages.emotion, count: sql<number>`count(*)::int` })
        .from(chatMessages)
        .innerJoin(personaRuns, eq(chatMessages.personaRunId, personaRuns.id))
        .innerJoin(scenarioRuns, eq(personaRuns.scenarioRunId, scenarioRuns.id))
        .where(and(...whereConditions))
        .groupBy(personaRuns.mbtiType, chatMessages.emotion)
        .orderBy(personaRuns.mbtiType, desc(sql`count(*)`));
      const mbtiMap = new Map<string, { mbti: string; emotions: { emotion: string; count: number }[]; totalCount: number }>();
      for (const row of result) {
        if (!row.emotion || !row.mbti) continue;
        if (!mbtiMap.has(row.mbti)) mbtiMap.set(row.mbti, { mbti: row.mbti, emotions: [], totalCount: 0 });
        const mbtiData = mbtiMap.get(row.mbti)!;
        mbtiData.emotions.push({ emotion: row.emotion, count: row.count });
        mbtiData.totalCount += row.count;
      }
      return Array.from(mbtiMap.values()).sort((a, b) => b.totalCount - a.totalCount);
    }

    async getEmotionStatsByDifficulty(scenarioIds?: string[]): Promise<{ difficulty: number; emotions: { emotion: string; count: number }[]; totalCount: number }[]> {
      const whereConditions: any[] = [eq(chatMessages.sender, 'ai'), isNotNull(chatMessages.emotion), isNotNull(personaRuns.difficulty), ne(scenarioRuns.status, 'abandoned')];
      if (scenarioIds && scenarioIds.length > 0) whereConditions.push(inArray(scenarioRuns.scenarioId, scenarioIds));
      const result = await db.select({ difficulty: personaRuns.difficulty, emotion: chatMessages.emotion, count: sql<number>`count(*)::int` })
        .from(chatMessages)
        .innerJoin(personaRuns, eq(chatMessages.personaRunId, personaRuns.id))
        .innerJoin(scenarioRuns, eq(personaRuns.scenarioRunId, scenarioRuns.id))
        .where(and(...whereConditions))
        .groupBy(personaRuns.difficulty, chatMessages.emotion)
        .orderBy(personaRuns.difficulty, desc(sql`count(*)`));
      const difficultyMap = new Map<number, { difficulty: number; emotions: { emotion: string; count: number }[]; totalCount: number }>();
      for (const row of result) {
        if (!row.emotion || row.difficulty === null) continue;
        if (!difficultyMap.has(row.difficulty)) difficultyMap.set(row.difficulty, { difficulty: row.difficulty, emotions: [], totalCount: 0 });
        const difficultyData = difficultyMap.get(row.difficulty)!;
        difficultyData.emotions.push({ emotion: row.emotion, count: row.count });
        difficultyData.totalCount += row.count;
      }
      return Array.from(difficultyMap.values()).sort((a, b) => a.difficulty - b.difficulty);
    }

    async getEmotionTimelineByPersonaRun(personaRunId: string): Promise<EmotionTimeline[]> {
      return await db.select({ turnIndex: chatMessages.turnIndex, emotion: chatMessages.emotion, message: chatMessages.message })
        .from(chatMessages)
        .where(and(eq(chatMessages.personaRunId, personaRunId), eq(chatMessages.sender, 'ai')))
        .orderBy(asc(chatMessages.turnIndex));
    }

    async deleteScenarioRun(id: string): Promise<void> {
      await db.delete(scenarioRuns).where(eq(scenarioRuns.id, id));
    }

    async createSimulationEvent(event: InsertSimulationEvent): Promise<SimulationEvent> {
      const [created] = await db.insert(simulationEvents).values(event as any).returning();
      return created;
    }

    async getSimulationEventsByPersonaRun(personaRunId: string): Promise<SimulationEvent[]> {
      return await db.select().from(simulationEvents)
        .where(eq(simulationEvents.personaRunId, personaRunId))
        .orderBy(asc(simulationEvents.createdAt));
    }

    async hasSimulationData(personaRunId: string): Promise<boolean> {
      const [row] = await db.select({ count: sql<number>`count(*)::int` })
        .from(simulationEvents)
        .where(and(
          eq(simulationEvents.personaRunId, personaRunId),
          eq(simulationEvents.eventType, 'auto_evaluation'),
          eq(simulationEvents.includeInReport, true),
        ));
      return (row?.count ?? 0) > 0;
    }

    async getSimulationState(personaRunId: string): Promise<Record<string, unknown> | null> {
      const [row] = await db.select({ simulationState: personaRuns.simulationState })
        .from(personaRuns)
        .where(eq(personaRuns.id, personaRunId));
      if (!row) return null;
      return (row.simulationState as Record<string, unknown>) ?? null;
    }

    async saveSimulationState(personaRunId: string, state: Record<string, unknown>): Promise<void> {
      await db.update(personaRuns).set({ simulationState: state as any }).where(eq(personaRuns.id, personaRunId));
    }
  };
}

export class MemSessionsStorage implements ISessionsStorage {
  async createScenarioRun(_: InsertScenarioRun): Promise<ScenarioRun> { throw new Error("MemStorage does not support Scenario Runs"); }
  async getScenarioRun(_: string): Promise<ScenarioRun | undefined> { throw new Error("MemStorage does not support Scenario Runs"); }
  async updateScenarioRun(_: string, __: Partial<ScenarioRun>): Promise<ScenarioRun> { throw new Error("MemStorage does not support Scenario Runs"); }
  async getUserScenarioRuns(_: string): Promise<ScenarioRun[]> { throw new Error("MemStorage does not support Scenario Runs"); }
  async getAllScenarioRuns(): Promise<ScenarioRun[]> { throw new Error("MemStorage does not support Scenario Runs"); }
  async findActiveScenarioRun(_: string, __: string): Promise<ScenarioRun | undefined> { throw new Error("MemStorage does not support Scenario Runs"); }
  async abandonActiveScenarioRuns(_: string, __: string): Promise<void> { }
  async getUserScenarioRunsWithPersonaRuns(_: string): Promise<ScenarioRunWithPersonaRuns[]> { throw new Error("MemStorage does not support Scenario Runs"); }
  async getScenarioRunWithPersonaRuns(_: string): Promise<ScenarioRunWithPersonaRuns | undefined> { throw new Error("MemStorage does not support Scenario Runs"); }
  async createPersonaRun(_: InsertPersonaRun): Promise<PersonaRun> { throw new Error("MemStorage does not support Persona Runs"); }
  async getPersonaRun(_: string): Promise<PersonaRun | undefined> { throw new Error("MemStorage does not support Persona Runs"); }
  async getPersonaRunByConversationId(_: string): Promise<PersonaRun | undefined> { throw new Error("MemStorage does not support Persona Runs"); }
  async updatePersonaRun(_: string, __: Partial<PersonaRun>): Promise<PersonaRun> { throw new Error("MemStorage does not support Persona Runs"); }
  async getPersonaRunsByScenarioRun(_: string): Promise<PersonaRun[]> { throw new Error("MemStorage does not support Persona Runs"); }
  async getAllPersonaRuns(): Promise<PersonaRun[]> { throw new Error("MemStorage does not support Persona Runs"); }
  async createChatMessage(_: InsertChatMessage): Promise<ChatMessage> { throw new Error("MemStorage does not support Chat Messages"); }
  async getChatMessagesByPersonaRun(_: string): Promise<ChatMessage[]> { throw new Error("MemStorage does not support Chat Messages"); }
  async deleteChatMessagesByPersonaRun(_: string): Promise<void> { throw new Error("MemStorage does not support Chat Messages"); }
  async getAllEmotionStats(_?: string[]): Promise<EmotionStat[]> { throw new Error("MemStorage does not support emotion stats"); }
  async getEmotionStatsByScenario(_?: string[]): Promise<EmotionStatByScenario[]> { throw new Error("MemStorage does not support emotion stats by scenario"); }
  async getEmotionStatsByMbti(_?: string[]): Promise<EmotionStatByMbti[]> { throw new Error("MemStorage does not support emotion stats by MBTI"); }
  async getEmotionStatsByDifficulty(_?: string[]): Promise<EmotionStatByDifficulty[]> { throw new Error("MemStorage does not support emotion stats by difficulty"); }
  async getEmotionTimelineByPersonaRun(_: string): Promise<EmotionTimeline[]> { throw new Error("MemStorage does not support emotion timeline"); }
  async deleteScenarioRun(_: string): Promise<void> { throw new Error("MemStorage does not support deleteScenarioRun"); }
  async createSimulationEvent(_: InsertSimulationEvent): Promise<SimulationEvent> { throw new Error("MemStorage does not support simulation events"); }
  async getSimulationEventsByPersonaRun(_: string): Promise<SimulationEvent[]> { return []; }
  async hasSimulationData(_: string): Promise<boolean> { return false; }
  async getSimulationState(_: string): Promise<Record<string, unknown> | null> { return null; }
  async saveSimulationState(_: string, __: Record<string, unknown>): Promise<void> { }
}
