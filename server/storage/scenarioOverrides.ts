import { type ScenarioOverride, type InsertScenarioOverride, type AuditLog, scenarioOverrides, auditLogs, users } from "@shared/schema";
import { overrideAuditActions, summarizeOverrideChange } from "@shared/organizationOverrideAudit";
import { db } from "./db";
import { eq, and, sql, desc, inArray, lt, or } from "drizzle-orm";

type ScenarioOverrideAuditRow = Pick<AuditLog, "id" | "actorUserId" | "organizationId" | "action" | "targetId" | "metadata" | "createdAt"> & { actorName: string | null };
export interface ScenarioOverrideAuditCursor { createdAt: string; id: string }

export class ScenarioOverrideConflictError extends Error {
  constructor() {
    super("다른 관리자가 설정을 변경하거나 삭제했습니다. 최신 설정을 확인한 뒤 다시 시도하세요.");
  }
}

function assertVersion(row: ScenarioOverride | undefined, expectedUpdatedAt: string | null, expectedOverrideId: string | null) {
  // The UUID distinguishes a recreated row even if its timestamp repeats or a server clock moves backwards.
  if (expectedUpdatedAt === undefined || expectedOverrideId === undefined ||
    (row?.id ?? null) !== expectedOverrideId || (row?.updatedAt.toISOString() ?? null) !== expectedUpdatedAt) {
    throw new ScenarioOverrideConflictError();
  }
}

export interface IScenarioOverridesStorage {
  getScenarioOverride(id: string): Promise<ScenarioOverride | undefined>;
  getScenarioOverrideByOrgAndScenario(organizationId: string, scenarioId: string): Promise<ScenarioOverride | undefined>;
  getScenarioOverridesByOrganization(organizationId: string): Promise<ScenarioOverride[]>;
  getScenarioOverridesByScenario(scenarioId: string): Promise<ScenarioOverride[]>;
  getAllScenarioOverrides(): Promise<ScenarioOverride[]>;
  upsertScenarioOverride(organizationId: string, scenarioId: string, override: InsertScenarioOverride['override'], actorUserId: string, expectedUpdatedAt: string | null, expectedOverrideId: string | null): Promise<ScenarioOverride>;
  getScenarioOverrideAudit(organizationId: string, scenarioId: string | undefined, limit: number, cursor?: ScenarioOverrideAuditCursor | null): Promise<(ScenarioOverrideAuditRow & { cursorCreatedAt: string })[]>;
  deleteScenarioOverride(id: string): Promise<void>;
  deleteScenarioOverrideByOrgAndScenario(organizationId: string, scenarioId: string, actorUserId: string, expectedUpdatedAt: string | null, expectedOverrideId: string | null): Promise<void>;
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

    async upsertScenarioOverride(organizationId: string, scenarioId: string, override: InsertScenarioOverride['override'], actorUserId: string, expectedUpdatedAt: string | null, expectedOverrideId: string | null): Promise<ScenarioOverride> {
      return db.transaction(async tx => {
        // Also serializes concurrent first saves, where there is no row to lock yet.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([organizationId, scenarioId])}, 0))`);
        const condition = and(eq(scenarioOverrides.organizationId, organizationId), eq(scenarioOverrides.scenarioId, scenarioId));
        const [before] = await tx.select().from(scenarioOverrides).where(condition);
        assertVersion(before, expectedUpdatedAt, expectedOverrideId);
        // JS/JSON timestamps have millisecond precision; even same-millisecond saves must advance the token.
        const updatedAt = new Date(Math.max(Date.now(), (before?.updatedAt.getTime() ?? 0) + 1));
        const [row] = await tx.insert(scenarioOverrides).values({ organizationId, scenarioId, override, updatedAt })
          .onConflictDoUpdate({ target: [scenarioOverrides.organizationId, scenarioOverrides.scenarioId],
            set: { override, updatedAt } }).returning();
        await tx.insert(auditLogs).values({
          actorUserId, organizationId, action: overrideAuditActions[0], targetType: "scenario_override", targetId: scenarioId,
          metadata: summarizeOverrideChange(before?.override ?? null, row.override),
        });
        return row;
      });
    }

    async getScenarioOverrideAudit(organizationId: string, scenarioId: string | undefined, limit: number, cursor?: ScenarioOverrideAuditCursor | null) {
      return db.select({
        id: auditLogs.id, actorUserId: auditLogs.actorUserId, organizationId: auditLogs.organizationId,
        action: auditLogs.action, targetId: auditLogs.targetId, metadata: auditLogs.metadata, createdAt: auditLogs.createdAt,
        // Keep PostgreSQL's full timestamp precision for an exact keyset boundary.
        cursorCreatedAt: sql<string>`to_char(${auditLogs.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        // Resolve only the current display name: never persist names/emails in the immutable audit payload.
        actorName: users.name,
      }).from(auditLogs).leftJoin(users, eq(auditLogs.actorUserId, users.id)).where(and(
        eq(auditLogs.organizationId, organizationId), eq(auditLogs.targetType, "scenario_override"),
        inArray(auditLogs.action, [...overrideAuditActions]),
        scenarioId ? eq(auditLogs.targetId, scenarioId) : undefined,
        cursor ? or(
          lt(auditLogs.createdAt, sql`${cursor.createdAt.slice(0, -1)}::timestamp`),
          and(eq(auditLogs.createdAt, sql`${cursor.createdAt.slice(0, -1)}::timestamp`), lt(auditLogs.id, cursor.id)),
        ) : undefined,
      )).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(limit);
    }

    async deleteScenarioOverride(id: string): Promise<void> {
      await db.delete(scenarioOverrides).where(eq(scenarioOverrides.id, id));
    }

    async deleteScenarioOverrideByOrgAndScenario(organizationId: string, scenarioId: string, actorUserId: string, expectedUpdatedAt: string | null, expectedOverrideId: string | null): Promise<void> {
      await db.transaction(async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([organizationId, scenarioId])}, 0))`);
        const [current] = await tx.select().from(scenarioOverrides).where(
          and(eq(scenarioOverrides.organizationId, organizationId), eq(scenarioOverrides.scenarioId, scenarioId))
        );
        assertVersion(current, expectedUpdatedAt, expectedOverrideId);
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
  async getScenarioOverrideAudit(): Promise<(ScenarioOverrideAuditRow & { cursorCreatedAt: string })[]> { throw new Error("Audit history requires database storage"); }
  async getScenarioOverride(_: string): Promise<ScenarioOverride | undefined> { return undefined; }
  async getScenarioOverrideByOrgAndScenario(_: string, __: string): Promise<ScenarioOverride | undefined> { return undefined; }
  async getScenarioOverridesByOrganization(_: string): Promise<ScenarioOverride[]> { return []; }
  async getScenarioOverridesByScenario(_: string): Promise<ScenarioOverride[]> { return []; }
  async getAllScenarioOverrides(): Promise<ScenarioOverride[]> { return []; }
  async upsertScenarioOverride(_: string, __: string, ___: InsertScenarioOverride['override']): Promise<ScenarioOverride> { throw new Error("Not implemented"); }
  async deleteScenarioOverride(_: string): Promise<void> {}
  async deleteScenarioOverrideByOrgAndScenario(_: string, __: string): Promise<void> {}
}
