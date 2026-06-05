import { type Scenario, type InsertScenario, type MbtiPersona, type InsertMbtiPersona, type ScenarioVersion, type InsertScenarioVersion, scenarios, mbtiPersonas, scenarioVersions } from "@shared/schema";
import { db } from "./db";
import { eq, asc, desc, and, max, sql } from "drizzle-orm";

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

  publishScenarioVersion(scenarioId: string, publishedBy: string): Promise<ScenarioVersion>;
  getScenarioVersions(scenarioId: string): Promise<ScenarioVersion[]>;
  getScenarioVersion(versionId: string): Promise<ScenarioVersion | undefined>;
  getLatestPublishedVersion(scenarioId: string): Promise<ScenarioVersion | undefined>;
  archiveScenarioVersion(versionId: string): Promise<ScenarioVersion>;
  rollbackToVersion(versionId: string, publishedBy: string): Promise<ScenarioVersion>;
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
      const [updated] = await db.update(scenarios).set({ ...updates as any, updatedAt: new Date() }).where(eq(scenarios.id, id)).returning();
      if (!updated) throw new Error("Scenario not found");
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

    async publishScenarioVersion(scenarioId: string, publishedBy: string): Promise<ScenarioVersion> {
      const scenario = await this.getScenario(scenarioId);
      if (!scenario) throw new Error("Scenario not found");

      const [maxResult] = await db
        .select({ maxVersion: max(scenarioVersions.version) })
        .from(scenarioVersions)
        .where(eq(scenarioVersions.scenarioId, scenarioId));
      const nextVersion = (maxResult?.maxVersion ?? 0) + 1;

      const contentSnapshot: Record<string, unknown> = { ...scenario as any };

      const [version] = await db.insert(scenarioVersions).values({
        scenarioId,
        version: nextVersion,
        status: 'published',
        contentSnapshot,
        evaluationHarnessSnapshot: scenario.evaluationHarness ?? null,
        publishedBy,
      } as any).returning();

      console.log(`[ScenarioVersions] Published v${nextVersion} for scenario ${scenarioId} by ${publishedBy}`);
      return version;
    }

    async getScenarioVersions(scenarioId: string): Promise<ScenarioVersion[]> {
      return await db
        .select()
        .from(scenarioVersions)
        .where(eq(scenarioVersions.scenarioId, scenarioId))
        .orderBy(desc(scenarioVersions.version));
    }

    async getScenarioVersion(versionId: string): Promise<ScenarioVersion | undefined> {
      const [version] = await db.select().from(scenarioVersions).where(eq(scenarioVersions.id, versionId));
      return version;
    }

    async getLatestPublishedVersion(scenarioId: string): Promise<ScenarioVersion | undefined> {
      const [version] = await db
        .select()
        .from(scenarioVersions)
        .where(and(eq(scenarioVersions.scenarioId, scenarioId), eq(scenarioVersions.status, 'published')))
        .orderBy(desc(scenarioVersions.version))
        .limit(1);
      return version;
    }

    async archiveScenarioVersion(versionId: string): Promise<ScenarioVersion> {
      const [updated] = await db
        .update(scenarioVersions)
        .set({ status: 'archived' })
        .where(eq(scenarioVersions.id, versionId))
        .returning();
      if (!updated) throw new Error("ScenarioVersion not found");
      return updated;
    }

    async rollbackToVersion(versionId: string, publishedBy: string): Promise<ScenarioVersion> {
      const sourceVersion = await this.getScenarioVersion(versionId);
      if (!sourceVersion) throw new Error("ScenarioVersion not found");

      const [maxResult] = await db
        .select({ maxVersion: max(scenarioVersions.version) })
        .from(scenarioVersions)
        .where(eq(scenarioVersions.scenarioId, sourceVersion.scenarioId));
      const nextVersion = (maxResult?.maxVersion ?? 0) + 1;

      const [newVersion] = await db.insert(scenarioVersions).values({
        scenarioId: sourceVersion.scenarioId,
        version: nextVersion,
        status: 'published',
        contentSnapshot: sourceVersion.contentSnapshot,
        evaluationHarnessSnapshot: sourceVersion.evaluationHarnessSnapshot,
        publishedBy,
      } as any).returning();

      const content = sourceVersion.contentSnapshot as any;
      if (content && typeof content === 'object') {
        const { id: _id, createdAt: _c, updatedAt: _u, isDeleted: _d, deletedAt: _da, ...updateFields } = content;
        await db.update(scenarios)
          .set({ ...updateFields, updatedAt: new Date() })
          .where(eq(scenarios.id, sourceVersion.scenarioId));
      }

      console.log(`[ScenarioVersions] Rolled back to v${sourceVersion.version} as new v${nextVersion} for scenario ${sourceVersion.scenarioId} by ${publishedBy}`);
      return newVersion;
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
  async publishScenarioVersion(_: string, __: string): Promise<ScenarioVersion> { throw new Error("Not implemented"); }
  async getScenarioVersions(_: string): Promise<ScenarioVersion[]> { return []; }
  async getScenarioVersion(_: string): Promise<ScenarioVersion | undefined> { return undefined; }
  async getLatestPublishedVersion(_: string): Promise<ScenarioVersion | undefined> { return undefined; }
  async archiveScenarioVersion(_: string): Promise<ScenarioVersion> { throw new Error("Not implemented"); }
  async rollbackToVersion(_: string, __: string): Promise<ScenarioVersion> { throw new Error("Not implemented"); }
}
