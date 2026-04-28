import { type Scenario, type InsertScenario, type MbtiPersona, type InsertMbtiPersona, scenarios, mbtiPersonas } from "@shared/schema";
import { db } from "./db";
import { eq, asc, desc, and } from "drizzle-orm";

export interface IScenariosStorage {
  getScenario(id: string): Promise<Scenario | undefined>;
  getAllScenarios(includeDeleted?: boolean): Promise<Scenario[]>;
  getScenariosByCategory(categoryId: string): Promise<Scenario[]>;
  createScenario(scenario: InsertScenario): Promise<Scenario>;
  updateScenario(id: string, updates: Partial<InsertScenario>): Promise<Scenario>;
  deleteScenario(id: string): Promise<void>;

  getMbtiPersona(id: string): Promise<MbtiPersona | undefined>;
  getAllMbtiPersonas(): Promise<MbtiPersona[]>;
  getFreeChatPersonas(): Promise<MbtiPersona[]>;
  createMbtiPersona(persona: InsertMbtiPersona): Promise<MbtiPersona>;
  updateMbtiPersona(id: string, updates: Partial<InsertMbtiPersona>): Promise<MbtiPersona>;
  deleteMbtiPersona(id: string): Promise<void>;
}

type Constructor<T = {}> = new (...args: any[]) => T;

export function ScenariosMixin<TBase extends Constructor>(Base: TBase) {
  return class extends Base implements IScenariosStorage {
    async getScenario(id: string): Promise<Scenario | undefined> {
      const [scenario] = await db.select().from(scenarios).where(eq(scenarios.id, id));
      return scenario;
    }

    async getAllScenarios(includeDeleted: boolean = false): Promise<Scenario[]> {
      if (includeDeleted) return await db.select().from(scenarios).orderBy(desc(scenarios.createdAt));
      return await db.select().from(scenarios).where(eq(scenarios.isDeleted, false)).orderBy(desc(scenarios.createdAt));
    }

    async getScenariosByCategory(categoryId: string): Promise<Scenario[]> {
      return await db.select().from(scenarios).where(and(eq(scenarios.categoryId, categoryId), eq(scenarios.isDeleted, false))).orderBy(desc(scenarios.createdAt));
    }

    async createScenario(scenario: InsertScenario): Promise<Scenario> {
      const [created] = await db.insert(scenarios).values(scenario as any).returning();
      return created;
    }

    async updateScenario(id: string, updates: Partial<InsertScenario>): Promise<Scenario> {
      console.log(`[DatabaseStorage.updateScenario] id=${id}`);
      console.log(`[DatabaseStorage.updateScenario] updates.image=${updates.image}`);
      console.log(`[DatabaseStorage.updateScenario] updates.introVideoUrl=${updates.introVideoUrl}`);
      const [updated] = await db.update(scenarios).set({ ...updates as any, updatedAt: new Date() }).where(eq(scenarios.id, id)).returning();
      if (!updated) throw new Error("Scenario not found");
      console.log(`[DatabaseStorage.updateScenario] Saved - image=${updated.image}, introVideoUrl=${updated.introVideoUrl}`);
      return updated;
    }

    async deleteScenario(id: string): Promise<void> {
      await db.update(scenarios).set({ isDeleted: true, deletedAt: new Date() }).where(eq(scenarios.id, id));
    }

    async getMbtiPersona(id: string): Promise<MbtiPersona | undefined> {
      const [persona] = await db.select().from(mbtiPersonas).where(eq(mbtiPersonas.id, id));
      return persona;
    }

    async getAllMbtiPersonas(): Promise<MbtiPersona[]> {
      return await db.select().from(mbtiPersonas).orderBy(asc(mbtiPersonas.mbti));
    }

    async getFreeChatPersonas(): Promise<MbtiPersona[]> {
      return await db.select().from(mbtiPersonas).where(eq(mbtiPersonas.freeChatAvailable, true)).orderBy(asc(mbtiPersonas.mbti));
    }

    async createMbtiPersona(persona: InsertMbtiPersona): Promise<MbtiPersona> {
      const [created] = await db.insert(mbtiPersonas).values(persona as any).returning();
      return created;
    }

    async updateMbtiPersona(id: string, updates: Partial<InsertMbtiPersona>): Promise<MbtiPersona> {
      const [updated] = await db.update(mbtiPersonas).set({ ...updates as any, updatedAt: new Date() }).where(eq(mbtiPersonas.id, id)).returning();
      if (!updated) throw new Error("MbtiPersona not found");
      return updated;
    }

    async deleteMbtiPersona(id: string): Promise<void> {
      await db.delete(mbtiPersonas).where(eq(mbtiPersonas.id, id));
    }
  };
}

export class MemScenariosStorage implements IScenariosStorage {
  async getScenario(_: string): Promise<Scenario | undefined> { return undefined; }
  async getAllScenarios(_?: boolean): Promise<Scenario[]> { return []; }
  async getScenariosByCategory(_: string): Promise<Scenario[]> { return []; }
  async createScenario(_: InsertScenario): Promise<Scenario> { throw new Error("Not implemented"); }
  async updateScenario(_: string, __: Partial<InsertScenario>): Promise<Scenario> { throw new Error("Not implemented"); }
  async deleteScenario(_: string): Promise<void> {}
  async getMbtiPersona(_: string): Promise<MbtiPersona | undefined> { return undefined; }
  async getAllMbtiPersonas(): Promise<MbtiPersona[]> { return []; }
  async getFreeChatPersonas(): Promise<MbtiPersona[]> { return []; }
  async createMbtiPersona(_: InsertMbtiPersona): Promise<MbtiPersona> { throw new Error("Not implemented"); }
  async updateMbtiPersona(_: string, __: Partial<InsertMbtiPersona>): Promise<MbtiPersona> { throw new Error("Not implemented"); }
  async deleteMbtiPersona(_: string): Promise<void> {}
}
