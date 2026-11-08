import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { scenarioOverrides, auditLogs } from "../../shared/schema";
import { summarizeOverrideChange } from "../../shared/organizationOverrideAudit";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), select: vi.fn() }));
vi.mock("../../server/storage/db", () => ({ db: mocks }));
import { ScenarioOverridesMixin } from "../../server/storage/scenarioOverrides";

const store = new (ScenarioOverridesMixin(class {}))();
let state: { record: any; logs: any[] };
let failAudit: boolean;
let failWrite: boolean;
let operations: string[];
let lockQueries: string[];
const dialect = new PgDialect();

beforeEach(() => {
  vi.clearAllMocks();
  state = { record: null, logs: [] };
  failAudit = false; failWrite = false; operations = []; lockQueries = [];
  // Model transaction commit/rollback without a real database or runtime snapshots.
  mocks.transaction.mockImplementation(async fn => {
    const pending = structuredClone(state);
    const tx = {
      execute: vi.fn(async sql => {
        operations.push("lock");
        const query = dialect.sqlToQuery(sql);
        lockQueries.push(query.sql);
        expect(query.params).toEqual([JSON.stringify(["org", "scenario"])]);
      }),
      select: () => ({ from: () => ({ where: async () => {
        operations.push("read"); return pending.record ? [pending.record] : [];
      } }) }),
      insert: (table: any) => ({ values: (value: any) => {
        if (table === auditLogs) {
          operations.push("audit");
          if (failAudit) throw new Error("audit unavailable");
          pending.logs.push(value);
          return Promise.resolve();
        }
        expect(table).toBe(scenarioOverrides);
        return { onConflictDoUpdate: () => ({ returning: async () => {
          operations.push("write");
          if (failWrite) throw new Error("write unavailable");
          pending.record = { id: "override", ...value };
          return [pending.record];
        } }) };
      } }),
      delete: () => ({ where: () => ({ returning: async () => {
        operations.push("delete");
        if (failWrite) throw new Error("delete unavailable");
        const before = pending.record;
        pending.record = null;
        return before ? [before] : [];
      } }) }),
    };
    const result = await fn(tx);
    state = pending;
    return result;
  });
});

describe("privacy-preserving change summary", () => {
  it("detects equal-count text edits without storing raw content or personal data", () => {
    const result = summarizeOverrideChange(
      { terminology: { "private@example.com": "old person" }, policyConstraints: ["sensitive text"] },
      { terminology: { "private@example.com": "new person" }, policyConstraints: ["new sensitive text"], evaluationWeights: { empathy: 0 } },
    );
    expect(result.changedFields).toEqual(["terminology", "policyConstraints", "evaluationWeights"]);
    expect(result.before.counts.terminology).toBe(1);
    expect(result.after.counts.terminology).toBe(1);
    expect(result.after.evaluationWeights).toEqual({ empathy: 0 });
    for (const secret of ["private@example.com", "old person", "new person", "sensitive text"]) {
      expect(JSON.stringify(result)).not.toContain(secret);
    }
  });
  it("ignores object key order and strips invalid legacy weight keys", () => {
    expect(summarizeOverrideChange({ terminology: { b: "2", a: "1" } }, { terminology: { a: "1", b: "2" } }).changedFields).toEqual([]);
    expect(summarizeOverrideChange({ evaluationWeights: { "private@example.com": 5, valid: 3, nan: NaN } }, null).before.evaluationWeights).toEqual({ valid: 3 });
  });
});

describe("atomic audited persistence", () => {
  it("records actor, organization, save/delete and before/after from serialized state, without touching snapshots", async () => {
    const snapshot = Object.freeze({ organizationId: "org", override: { policyConstraints: ["original"] } });
    const original = JSON.stringify(snapshot);
    await store.upsertScenarioOverride("org", "scenario", { policyConstraints: ["secret"] }, "admin-1");
    await store.upsertScenarioOverride("org", "scenario", { evaluationWeights: { empathy: 4 } }, "admin-2");
    await store.deleteScenarioOverrideByOrgAndScenario("org", "scenario", "admin-1");
    expect(state.record).toBeNull();
    expect(state.logs.map(log => log.action)).toEqual(["scenario_override_saved", "scenario_override_saved", "scenario_override_deleted"]);
    expect(state.logs[0]).toMatchObject({ actorUserId: "admin-1", organizationId: "org", targetId: "scenario", targetType: "scenario_override" });
    expect(state.logs[0].metadata.before.configured).toBe(false);
    expect(state.logs[1].metadata.before.counts.policyConstraints).toBe(1);
    expect(state.logs[1].metadata.after.evaluationWeights).toEqual({ empathy: 4 });
    expect(state.logs[2].metadata.after.configured).toBe(false);
    expect(state.logs[0]).not.toHaveProperty("ip");
    expect(state.logs[0]).not.toHaveProperty("userAgent");
    expect(JSON.stringify(state.logs)).not.toContain("secret");
    expect(operations).toEqual(["lock", "read", "write", "audit", "lock", "read", "write", "audit", "lock", "delete", "audit"]);
    expect(lockQueries.every(query => query.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(JSON.stringify(snapshot)).toBe(original);
  });
  it.each(["save", "delete"])("rolls back %s when the audit insert fails", async action => {
    await store.upsertScenarioOverride("org", "scenario", { policyConstraints: ["original"] }, "admin");
    const original = structuredClone(state);
    failAudit = true;
    const change = action === "save"
      ? store.upsertScenarioOverride("org", "scenario", { policyConstraints: ["new"] }, "admin")
      : store.deleteScenarioOverrideByOrgAndScenario("org", "scenario", "admin");
    await expect(change).rejects.toThrow("audit unavailable");
    expect(state).toEqual(original);
  });
  it("creates no successful audit for failed mutations or repeated deletes", async () => {
    failWrite = true;
    await expect(store.upsertScenarioOverride("org", "scenario", { policyConstraints: ["new"] }, "admin")).rejects.toThrow();
    expect(state.logs).toEqual([]);
    expect(operations).not.toContain("audit");
    failWrite = false;
    await store.deleteScenarioOverrideByOrgAndScenario("org", "scenario", "admin");
    expect(state.logs).toEqual([]);
  });
  it("restricts the database query to organization, scenario, action and target type with bounded paging", async () => {
    const chain: any = {};
    for (const method of ["from", "leftJoin", "where", "orderBy", "limit", "offset"]) chain[method] = vi.fn(() => chain);
    mocks.select.mockReturnValue(chain);
    await store.getScenarioOverrideAudit("org", "scenario", 26, 25);
    const query = dialect.sqlToQuery(chain.where.mock.calls[0][0]);
    expect(query.params).toEqual(["org", "scenario_override", "scenario_override_saved", "scenario_override_deleted", "scenario"]);
    expect(chain.limit).toHaveBeenCalledWith(26);
    expect(chain.offset).toHaveBeenCalledWith(25);
    const projection = mocks.select.mock.calls[0][0];
    expect(Object.keys(projection).sort()).toEqual(["id", "actorUserId", "actorName", "organizationId", "action", "targetId", "metadata", "createdAt"].sort());
  });
});
