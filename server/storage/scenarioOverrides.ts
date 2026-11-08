import { type ScenarioOverride, type InsertScenarioOverride, type AuditLog, scenarioOverrides, auditLogs, users } from "@shared/schema";
import { overrideAuditActions, summarizeOverrideChange } from "@shared/organizationOverrideAudit";
import { db } from "./db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";

type ScenarioOverrideAuditRow = Pick<AuditLog, "id" | "actorUserId" | "organizationId" | "action" | "targetId" | "metadata" | "createdAt"> & { actorName: string | null };

export interface IScenarioOverridesStorage {
  getScenarioOverride(id: string): Promise<ScenarioOverride | undefined>;
  getScenarioOverrideByOrgAndScenario(organizationId: string, scenarioId: string): Promise<ScenarioOverride | undefined>;
  getScenarioOverridesByOrganization(organizationId: string): Promise<ScenarioOverride[]>;
  getScenarioOverridesByScenario(scenarioId: string): Promise<ScenarioOverride[]>;
  getAllScenarioOverrides(): Promise<ScenarioOverride[]>;
  upsertScenarioOverride(organizationId: string, scenarioId: string, override: InsertScenarioOverride['override'], actorUserId: string): Promise<ScenarioOverride>;
  getScenarioOverrideAudit(organizationId: string, scenarioId: string | undefined, limit: number, offset: number): Promise<ScenarioOverrideAuditRow[]>;
  deleteScenarioOverride(id: string): Promise<void>;
  deleteScenarioOverrideByOrgAndScenario(organizationId: string, scenarioId: string, actorUserId: string): Promise<void>;
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

    async getAllScenarioOverrides(): Promise<ScenarioOverride[]> {
      return await db.select().from(scenarioOverrides);
    }

    async upsertScenarioOverride(organizationId: string, scenarioId: string, override: InsertScenarioOverride['override'], actorUserId: string): Promise<ScenarioOverride> {
      return db.transaction(async tx => {
        // Also serializes concurrent first saves, where there is no row to lock yet.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([organizationId, scenarioId])}, 0))`);
        const condition = and(eq(scenarioOverrides.organizationId, organizationId), eq(scenarioOverrides.scenarioId, scenarioId));
        const [before] = await tx.select().from(scenarioOverrides).where(condition);
        const [row] = await tx.insert(scenarioOverrides).values({ organizationId, scenarioId, override })
          .onConflictDoUpdate({ target: [scenarioOverrides.organizationId, scenarioOverrides.scenarioId],
            set: { override, updatedAt: new Date() } }).returning();
        await tx.insert(auditLogs).values({
          actorUserId, organizationId, action: overrideAuditActions[0], targetType: "scenario_override", targetId: scenarioId,
          metadata: summarizeOverrideChange(before?.override ?? null, row.override),
        });
        return row;
      });
    }

    async getScenarioOverrideAudit(organizationId: string, scenarioId: string | undefined, limit: number, offset: number) {
      return db.select({
        id: auditLogs.id, actorUserId: auditLogs.actorUserId, organizationId: auditLogs.organizationId,
        action: auditLogs.action, targetId: auditLogs.targetId, metadata: auditLogs.metadata, createdAt: auditLogs.createdAt,
        // Resolve only the current display name: never persist names/emails in the immutable audit payload.
        actorName: users.name,
      }).from(auditLogs).leftJoin(users, eq(auditLogs.actorUserId, users.id)).where(and(
        eq(auditLogs.organizationId, organizationId), eq(auditLogs.targetType, "scenario_override"),
        inArray(auditLogs.action, [...overrideAuditActions]),
        scenarioId ? eq(auditLogs.targetId, scenarioId) : undefined,
      )).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(limit).offset(offset);
    }

    async deleteScenarioOverride(id: string): Promise<void> {
      await db.delete(scenarioOverrides).where(eq(scenarioOverrides.id, id));
    }

    async deleteScenarioOverrideByOrgAndScenario(organizationId: string, scenarioId: string, actorUserId: string): Promise<void> {
      await db.transaction(async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([organizationId, scenarioId])}, 0))`);
        const [before] = await tx.delete(scenarioOverrides).where(
          and(eq(scenarioOverrides.organizationId, organizationId), eq(scenarioOverrides.scenarioId, scenarioId))
        ).returning();
        // An idempotent delete with nothing to remove is not a configuration change.
        if (!before) return;
        await tx.insert(auditLogs).values({
          actorUserId, organizationId, action: overrideAuditActions[1], targetType: "scenario_override", targetId: scenarioId,
          metadata: summarizeOverrideChange(before.override, null),
        });
      });
    }
  };
}

export class MemScenarioOverridesStorage implements IScenarioOverridesStorage {
  async getScenarioOverrideAudit(): Promise<ScenarioOverrideAuditRow[]> { throw new Error("Audit history requires database storage"); }
  async getScenarioOverride(_: string): Promise<ScenarioOverride | undefined> { return undefined; }
  async getScenarioOverrideByOrgAndScenario(_: string, __: string): Promise<ScenarioOverride | undefined> { return undefined; }
  async getScenarioOverridesByOrganization(_: string): Promise<ScenarioOverride[]> { return []; }
  async getScenarioOverridesByScenario(_: string): Promise<ScenarioOverride[]> { return []; }
  async getAllScenarioOverrides(): Promise<ScenarioOverride[]> { return []; }
  async upsertScenarioOverride(_: string, __: string, ___: InsertScenarioOverride['override']): Promise<ScenarioOverride> { throw new Error("Not implemented"); }
  async deleteScenarioOverride(_: string): Promise<void> {}
  async deleteScenarioOverrideByOrgAndScenario(_: string, __: string): Promise<void> {}
}
