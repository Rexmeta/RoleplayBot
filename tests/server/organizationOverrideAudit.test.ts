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
let transactionQueue: Promise<unknown>;
const dialect = new PgDialect();

beforeEach(() => {
  vi.clearAllMocks();
  state = { record: null, logs: [] };
  failAudit = false; failWrite = false; operations = []; lockQueries = [];
  transactionQueue = Promise.resolve();
  // Model transaction commit/rollback without a real database or runtime snapshots.
  mocks.transaction.mockImplementation(async fn => {
    let pending: typeof state;
    let release!: () => void;
    let acquired = false;
    const tx = {
      execute: vi.fn(async sql => {
        const previous = transactionQueue;
        transactionQueue = new Promise(resolve => { release = resolve; });
        await previous;
        acquired = true;
        pending = structuredClone(state);
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
          pending.record = { id: pending.record?.id ?? crypto.randomUUID(), ...value };
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
    try {
      const result = await fn(tx);
      state = pending!;
      return result;
    } finally { if (acquired) release(); }
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
    const first = await store.upsertScenarioOverride("org", "scenario", { policyConstraints: ["secret"] }, "admin-1", null, null);
    const second = await store.upsertScenarioOverride("org", "scenario", { evaluationWeights: { empathy: 4 } }, "admin-2", first.updatedAt.toISOString(), first.id);
    await store.deleteScenarioOverrideByOrgAndScenario("org", "scenario", "admin-1", second.updatedAt.toISOString(), second.id);
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
    expect(operations).toEqual(["lock", "read", "write", "audit", "lock", "read", "write", "audit", "lock", "read", "delete", "audit"]);
    expect(lockQueries.every(query => query.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(JSON.stringify(snapshot)).toBe(original);
  });
  it.each(["save", "delete"])("rolls back %s when the audit insert fails", async action => {
    const saved = await store.upsertScenarioOverride("org", "scenario", { policyConstraints: ["original"] }, "admin", null, null);
    const original = structuredClone(state);
    failAudit = true;
    const change = action === "save"
      ? store.upsertScenarioOverride("org", "scenario", { policyConstraints: ["new"] }, "admin", saved.updatedAt.toISOString(), saved.id)
      : store.deleteScenarioOverrideByOrgAndScenario("org", "scenario", "admin", saved.updatedAt.toISOString(), saved.id);
    await expect(change).rejects.toThrow("audit unavailable");
    expect(state).toEqual(original);
  });
  it("creates no successful audit for failed mutations or repeated deletes", async () => {
    failWrite = true;
    await expect(store.upsertScenarioOverride("org", "scenario", { policyConstraints: ["new"] }, "admin", null, null)).rejects.toThrow();
    expect(state.logs).toEqual([]);
    expect(operations).not.toContain("audit");
    failWrite = false;
    await store.deleteScenarioOverrideByOrgAndScenario("org", "scenario", "admin", null, null);
    expect(state.logs).toEqual([]);
  });
  it("applies the timestamp/id cursor within organization and scenario with bounded paging", async () => {
    const chain: any = {};
    for (const method of ["from", "leftJoin", "where", "orderBy", "limit", "offset"]) chain[method] = vi.fn(() => chain);
    mocks.select.mockReturnValue(chain);
    const cursor = { createdAt: "2026-11-06T10:00:00.123456Z", id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
    await store.getScenarioOverrideAudit("org", "scenario", 26, cursor);
    const query = dialect.sqlToQuery(chain.where.mock.calls[0][0]);
    expect(query.params).toEqual([
      "org", "scenario_override", "scenario_override_saved", "scenario_override_deleted", "scenario",
      "2026-11-06T10:00:00.123456", "2026-11-06T10:00:00.123456", cursor.id,
    ]);
    expect(query.sql).toContain("created_at");
    expect(query.sql).toContain("id");
    expect(chain.limit).toHaveBeenCalledWith(26);
    expect(chain.offset).not.toHaveBeenCalled();
    const projection = mocks.select.mock.calls[0][0];
    expect(Object.keys(projection).sort()).toEqual(["id", "actorUserId", "actorName", "organizationId", "action", "targetId", "metadata", "createdAt", "cursorCreatedAt"].sort());
  });
});

describe("two-editor optimistic concurrency under the transaction lock", () => {
  it("allows just one simultaneous first save and does not audit the loser", async () => {
    const results = await Promise.allSettled([
      store.upsertScenarioOverride("org", "scenario", { policyConstraints: ["A"] }, "admin-A", null, null),
      store.upsertScenarioOverride("org", "scenario", { policyConstraints: ["B"] }, "admin-B", null, null),
    ]);
    expect(results.map(r => r.status)).toEqual(["fulfilled", "rejected"]);
    expect(state.record.override.policyConstraints).toEqual(["A"]);
    expect(state.logs).toHaveLength(1);
  });

  it.each(["save", "delete"])("rejects stale %s after another editor saves, then allows a reviewed retry", async action => {
    const first = await store.upsertScenarioOverride("org", "scenario", { policyConstraints: ["original"] }, "admin", null, null);
    const version = first.updatedAt.toISOString();
    const results = await Promise.allSettled([
      store.upsertScenarioOverride("org", "scenario", { policyConstraints: ["A"] }, "admin-A", version, first.id),
      action === "save"
        ? store.upsertScenarioOverride("org", "scenario", { policyConstraints: ["B"] }, "admin-B", version, first.id)
        : store.deleteScenarioOverrideByOrgAndScenario("org", "scenario", "admin-B", version, first.id),
    ]);
    expect(results.map(r => r.status)).toEqual(["fulfilled", "rejected"]);
    expect(state.record.override.policyConstraints).toEqual(["A"]);
    expect(state.logs).toHaveLength(2);
    const freshVersion = state.record.updatedAt.toISOString();
    expect(freshVersion).not.toBe(version);
    if (action === "save") {
      await store.upsertScenarioOverride("org", "scenario", { policyConstraints: ["B"] }, "admin-B", freshVersion, first.id);
      expect(state.record.override.policyConstraints).toEqual(["B"]);
    } else {
      await store.deleteScenarioOverrideByOrgAndScenario("org", "scenario", "admin-B", freshVersion, first.id);
      expect(state.record).toBeNull();
    }
    expect(state.logs).toHaveLength(3);
  });

  it.each([0, -1000])("rejects stale writes across deletion/recreation even if the clock changes by %s ms", async skew => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1800000000000);
    try {
      const row = await store.upsertScenarioOverride("org", "scenario", { policyConstraints: ["original"] }, "admin", null, null);
      const version = row.updatedAt.toISOString();
      await store.deleteScenarioOverrideByOrgAndScenario("org", "scenario", "admin-A", version, row.id);
      await expect(store.upsertScenarioOverride("org", "scenario", { policyConstraints: ["stale"] }, "admin-B", version, row.id)).rejects.toThrow("다른 관리자");
      await expect(store.deleteScenarioOverrideByOrgAndScenario("org", "scenario", "admin-B", version, row.id)).rejects.toThrow("다른 관리자");
      clock.mockReturnValue(1800000000000 + skew);
      const recreated = await store.upsertScenarioOverride("org", "scenario", { policyConstraints: ["recreated"] }, "admin-A", null, null);
      expect(recreated.updatedAt.getTime()).toBe(row.updatedAt.getTime() + skew);
      expect(recreated.id).not.toBe(row.id);
      await expect(store.upsertScenarioOverride("org", "scenario", { policyConstraints: ["stale"] }, "admin-B", version, row.id)).rejects.toThrow("다른 관리자");
      await expect(store.deleteScenarioOverrideByOrgAndScenario("org", "scenario", "admin-B", version, row.id)).rejects.toThrow("다른 관리자");
      expect(state.record.override.policyConstraints).toEqual(["recreated"]);
      expect(state.logs).toHaveLength(3);
      await store.deleteScenarioOverrideByOrgAndScenario("org", "scenario", "admin-A", recreated.updatedAt.toISOString(), recreated.id);
      expect(state.record).toBeNull();
    } finally { clock.mockRestore(); }
  });

  it("advances the version even for two saves in the same millisecond", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1800000000000);
    try {
      const a = await store.upsertScenarioOverride("org", "scenario", { policyConstraints: ["A"] }, "admin", null, null);
      const b = await store.upsertScenarioOverride("org", "scenario", { policyConstraints: ["B"] }, "admin", a.updatedAt.toISOString(), a.id);
      expect(b.updatedAt.getTime()).toBe(a.updatedAt.getTime() + 1);
    } finally { clock.mockRestore(); }
  });
});
