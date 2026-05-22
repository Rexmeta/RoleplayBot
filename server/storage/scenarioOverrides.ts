import { type ScenarioOverride, type InsertScenarioOverride, scenarioOverrides } from "@shared/schema";
import { db } from "./db";
import { eq, and, sql } from "drizzle-orm";

export interface IScenarioOverridesStorage {
  getScenarioOverride(id: string): Promise<ScenarioOverride | undefined>;
  getScenarioOverrideByOrgAndScenario(organizationId: string, scenarioId: string): Promise<ScenarioOverride | undefined>;
  getScenarioOverridesByOrganization(organizationId: string): Promise<ScenarioOverride[]>;
  getScenarioOverridesByScenario(scenarioId: string): Promise<ScenarioOverride[]>;
  upsertScenarioOverride(organizationId: string, scenarioId: string, override: InsertScenarioOverride['override']): Promise<ScenarioOverride>;
  deleteScenarioOverride(id: string): Promise<void>;
  deleteScenarioOverrideByOrgAndScenario(organizationId: string, scenarioId: string): Promise<void>;
}

type Constructor<T = {}> = new (...args: any[]) => T;

export function ScenarioOverridesMixin<TBase extends Constructor>(Base: TBase) {
  return class extends Base implements IScenarioOverridesStorage {
    async getScenarioOverride(id: string): Promise<ScenarioOverride | undefined> {
      const [row] = await db.select().from(scenarioOverrides).where(eq(scenarioOverrides.id, id));
      return row;
    }

    async getScenarioOverrideByOrgAndScenario(organizationId: string, scenarioId: string): Promise<ScenarioOverride | undefined> {
      const [row] = await db.select().from(scenarioOverrides).where(
        and(eq(scenarioOverrides.organizationId, organizationId), eq(scenarioOverrides.scenarioId, scenarioId))
      );
      return row;
    }

    async getScenarioOverridesByOrganization(organizationId: string): Promise<ScenarioOverride[]> {
      return await db.select().from(scenarioOverrides).where(eq(scenarioOverrides.organizationId, organizationId));
    }

    async getScenarioOverridesByScenario(scenarioId: string): Promise<ScenarioOverride[]> {
      return await db.select().from(scenarioOverrides).where(eq(scenarioOverrides.scenarioId, scenarioId));
    }

    async upsertScenarioOverride(organizationId: string, scenarioId: string, override: InsertScenarioOverride['override']): Promise<ScenarioOverride> {
      const [row] = await db.execute<ScenarioOverride>(sql`
        INSERT INTO scenario_overrides (id, organization_id, scenario_id, override, created_at, updated_at)
        VALUES (gen_random_uuid(), ${organizationId}, ${scenarioId}, ${JSON.stringify(override)}::jsonb, NOW(), NOW())
        ON CONFLICT (organization_id, scenario_id) DO UPDATE SET
          override = EXCLUDED.override,
          updated_at = NOW()
        RETURNING *
      `);
      return row;
    }

    async deleteScenarioOverride(id: string): Promise<void> {
      await db.delete(scenarioOverrides).where(eq(scenarioOverrides.id, id));
    }

    async deleteScenarioOverrideByOrgAndScenario(organizationId: string, scenarioId: string): Promise<void> {
      await db.delete(scenarioOverrides).where(
        and(eq(scenarioOverrides.organizationId, organizationId), eq(scenarioOverrides.scenarioId, scenarioId))
      );
    }
  };
}

export class MemScenarioOverridesStorage implements IScenarioOverridesStorage {
  async getScenarioOverride(_: string): Promise<ScenarioOverride | undefined> { return undefined; }
  async getScenarioOverrideByOrgAndScenario(_: string, __: string): Promise<ScenarioOverride | undefined> { return undefined; }
  async getScenarioOverridesByOrganization(_: string): Promise<ScenarioOverride[]> { return []; }
  async getScenarioOverridesByScenario(_: string): Promise<ScenarioOverride[]> { return []; }
  async upsertScenarioOverride(_: string, __: string, ___: InsertScenarioOverride['override']): Promise<ScenarioOverride> { throw new Error("Not implemented"); }
  async deleteScenarioOverride(_: string): Promise<void> {}
  async deleteScenarioOverrideByOrgAndScenario(_: string, __: string): Promise<void> {}
}
