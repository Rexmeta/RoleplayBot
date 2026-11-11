import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";

const integrationUrl = process.env.ORGANIZATION_OVERRIDE_TEST_DATABASE_URL;
const runIntegration = Boolean(integrationUrl);
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe.skipIf(!runIntegration)("scenario override PostgreSQL concurrency contract", () => {
  let fixtureClient: Client;
  let fixtureSchema: string;
  let originalDatabaseUrl: string | undefined;
  let pool: { end: () => Promise<void> };
  let store: InstanceType<ReturnType<typeof ScenarioOverridesMixin>>;
  let ScenarioOverridesMixin: typeof import("../../server/storage/scenarioOverrides").ScenarioOverridesMixin;

  beforeAll(async () => {
    if (!integrationUrl) throw new Error("ORGANIZATION_OVERRIDE_TEST_DATABASE_URL is required");

    const parsed = new URL(integrationUrl);
    const databaseName = decodeURIComponent(parsed.pathname.slice(1));
    if (!databaseName.toLowerCase().includes("test")) {
      throw new Error("Integration tests require a dedicated PostgreSQL database whose name includes 'test'");
    }
    if (integrationUrl === process.env.DATABASE_URL) {
      throw new Error("The integration database must not be the application's DATABASE_URL");
    }

    fixtureSchema = `scenario_override_test_${randomUUID().replaceAll("-", "")}`;
    fixtureClient = new Client({ connectionString: integrationUrl });
    await fixtureClient.connect();
    await fixtureClient.query(`CREATE SCHEMA ${fixtureSchema}`);
    await fixtureClient.query(`SET search_path TO ${fixtureSchema}`);
    await fixtureClient.query(`
      CREATE TABLE users (id varchar PRIMARY KEY, name varchar NOT NULL);
      CREATE TABLE scenario_overrides (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id varchar NOT NULL,
        scenario_id varchar NOT NULL,
        override jsonb NOT NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (organization_id, scenario_id)
      );
      CREATE TABLE audit_logs (
        id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_user_id varchar,
        organization_id varchar,
        action varchar NOT NULL,
        target_type varchar,
        target_id varchar,
        metadata jsonb,
        ip varchar,
        user_agent text,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const scopedUrl = new URL(integrationUrl);
    scopedUrl.searchParams.set("options", `-c search_path=${fixtureSchema}`);
    originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = scopedUrl.toString();

    const storage = await import("../../server/storage/scenarioOverrides");
    ScenarioOverridesMixin = storage.ScenarioOverridesMixin;
    const Storage = ScenarioOverridesMixin(class {});
    store = new Storage();
    ({ pool } = await import("../../server/storage/db"));
  });

  beforeEach(async () => {
    await fixtureClient.query("TRUNCATE audit_logs, scenario_overrides, users");
  });

  afterAll(async () => {
    await pool?.end();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (fixtureClient) {
      await fixtureClient.query(`DROP SCHEMA ${fixtureSchema} CASCADE`);
      await fixtureClient.end();
    }
  });

  async function readOverride(organizationId: string, scenarioId: string) {
    const result = await fixtureClient.query(
      "SELECT * FROM scenario_overrides WHERE organization_id = $1 AND scenario_id = $2",
      [organizationId, scenarioId],
    );
    return result.rows[0] as {
      id: string;
      override: Record<string, unknown>;
      updated_at: Date;
    } | undefined;
  }

  async function readAudit(organizationId: string, scenarioId: string) {
    const result = await fixtureClient.query(
      `SELECT actor_user_id, action, metadata, created_at
       FROM audit_logs
       WHERE organization_id = $1 AND target_id = $2
       ORDER BY created_at ASC, id ASC`,
      [organizationId, scenarioId],
    );
    return result.rows as Array<{
      actor_user_id: string;
      action: string;
      metadata: {
        before: { configured: boolean; counts: Record<string, number>; evaluationWeights: Record<string, number> };
        after: { configured: boolean; counts: Record<string, number>; evaluationWeights: Record<string, number> };
        changedFields: string[];
      };
      created_at: Date;
    }>;
  }

  it("serializes simultaneous first saves and audits only the committed winner", async () => {
    const organizationId = `org-${randomUUID()}`;
    const scenarioId = `scenario-${randomUUID()}`;
    const saves = [
      { actor: `admin-${randomUUID()}`, override: { terminology: { greeting: "one" } } },
      { actor: `admin-${randomUUID()}`, override: { policyConstraints: ["two"] } },
    ];

    const results = await Promise.allSettled(saves.map(save =>
      store.upsertScenarioOverride(organizationId, scenarioId, save.override, save.actor, null, null),
    ));

    const winners = results.flatMap((result, index) =>
      result.status === "fulfilled" ? [{ row: result.value, save: saves[index] }] : [],
    );
    expect(winners).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);

    const [winner] = winners;
    const persisted = await readOverride(organizationId, scenarioId);
    expect(persisted?.id).toBe(winner.row.id);
    expect(persisted?.override).toEqual(winner.save.override);

    const audit = await readAudit(organizationId, scenarioId);
    expect(audit).toHaveLength(1);
    expect(audit[0].actor_user_id).toBe(winner.save.actor);
    expect(audit[0].action).toBe("scenario_override_saved");
    expect(audit[0].metadata.before.configured).toBe(false);
    expect(audit[0].metadata.after.configured).toBe(true);
    expect(audit[0].metadata.changedFields).toEqual(
      "terminology" in winner.save.override ? ["terminology"] : ["policyConstraints"],
    );
  });

  it("keeps consecutive save audit transitions aligned with the persisted versions", async () => {
    const organizationId = `org-${randomUUID()}`;
    const scenarioId = `scenario-${randomUUID()}`;
    const actors = [`admin-${randomUUID()}`, `admin-${randomUUID()}`, `admin-${randomUUID()}`];
    const first = await store.upsertScenarioOverride(
      organizationId, scenarioId, { terminology: { hello: "one", welcome: "two" } }, actors[0], null, null,
    );
    await pause(10);
    const second = await store.upsertScenarioOverride(
      organizationId, scenarioId, { policyConstraints: ["rule"] }, actors[1], first.updatedAt.toISOString(), first.id,
    );
    await pause(10);
    const third = await store.upsertScenarioOverride(
      organizationId, scenarioId, { evaluationWeights: { empathy: 4, clarity: 2 } },
      actors[2], second.updatedAt.toISOString(), second.id,
    );

    expect((await readOverride(organizationId, scenarioId))?.override).toEqual({
      evaluationWeights: { empathy: 4, clarity: 2 },
    });
    const audit = await readAudit(organizationId, scenarioId);
    expect(audit.map(row => row.actor_user_id)).toEqual(actors);
    expect(audit.map(row => row.action)).toEqual([
      "scenario_override_saved", "scenario_override_saved", "scenario_override_saved",
    ]);
    expect(audit[0].metadata).toMatchObject({
      before: { configured: false },
      after: { configured: true, counts: { terminology: 2 } },
      changedFields: ["terminology"],
    });
    expect(audit[1].metadata).toMatchObject({
      before: { configured: true, counts: { terminology: 2 } },
      after: { configured: true, counts: { policyConstraints: 1 } },
      changedFields: ["terminology", "policyConstraints"],
    });
    expect(audit[2].metadata).toMatchObject({
      before: { configured: true, counts: { policyConstraints: 1 } },
      after: { configured: true, counts: { evaluationWeights: 2 }, evaluationWeights: { empathy: 4, clarity: 2 } },
      changedFields: ["policyConstraints", "evaluationWeights"],
    });
    expect(audit[0].created_at.getTime()).toBeLessThan(audit[1].created_at.getTime());
    expect(audit[1].created_at.getTime()).toBeLessThan(audit[2].created_at.getTime());
  });

  it("makes a concurrent save/delete race produce one valid commit-ordered audit transition", async () => {
    const organizationId = `org-${randomUUID()}`;
    const scenarioId = `scenario-${randomUUID()}`;
    const originalActor = `admin-${randomUUID()}`;
    const saveActor = `admin-${randomUUID()}`;
    const deleteActor = `admin-${randomUUID()}`;
    const original = await store.upsertScenarioOverride(
      organizationId, scenarioId, { terminology: { greeting: "original" } }, originalActor, null, null,
    );
    await pause(10);

    const results = await Promise.allSettled([
      store.upsertScenarioOverride(
        organizationId, scenarioId, { policyConstraints: ["updated"] },
        saveActor, original.updatedAt.toISOString(), original.id,
      ),
      store.deleteScenarioOverrideByOrgAndScenario(
        organizationId, scenarioId, deleteActor, original.updatedAt.toISOString(), original.id,
      ),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);

    const saveWon = results[0].status === "fulfilled";
    const persisted = await readOverride(organizationId, scenarioId);
    const audit = await readAudit(organizationId, scenarioId);
    expect(audit).toHaveLength(2);
    expect(audit[0].actor_user_id).toBe(originalActor);
    expect(audit[0].metadata.before.configured).toBe(false);
    expect(audit[0].metadata.after.counts.terminology).toBe(1);
    expect(audit[1].actor_user_id).toBe(saveWon ? saveActor : deleteActor);

    if (saveWon) {
      expect(persisted?.override).toEqual({ policyConstraints: ["updated"] });
      expect(audit[1].action).toBe("scenario_override_saved");
      expect(audit[1].metadata.before.counts.terminology).toBe(1);
      expect(audit[1].metadata.after.counts.policyConstraints).toBe(1);
      expect(audit[1].metadata.changedFields).toEqual(["terminology", "policyConstraints"]);
    } else {
      expect(persisted).toBeUndefined();
      expect(audit[1].action).toBe("scenario_override_deleted");
      expect(audit[1].metadata.before.counts.terminology).toBe(1);
      expect(audit[1].metadata.after.configured).toBe(false);
      expect(audit[1].metadata.changedFields).toEqual(["terminology"]);
    }
  });

  it("rolls back saved settings when a real PostgreSQL audit insert constraint fails", async () => {
    const organizationId = `org-${randomUUID()}`;
    const scenarioId = `scenario-${randomUUID()}`;
    const actor = `admin-${randomUUID()}`;
    const suffix = randomUUID().replaceAll("-", "");
    const triggerName = `reject_audit_${suffix}`;
    const functionName = `reject_audit_fn_${suffix}`;
    const rejectAudit = async () => {
      await fixtureClient.query(`
        CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.target_id = '${scenarioId}' THEN
            RAISE EXCEPTION 'injected audit insert failure';
          END IF;
          RETURN NEW;
        END;
        $$
      `);
      await fixtureClient.query(
        `CREATE TRIGGER ${triggerName} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
      );
    };
    const allowAudit = async () => {
      await fixtureClient.query(`DROP TRIGGER IF EXISTS ${triggerName} ON audit_logs`);
      await fixtureClient.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    };

    try {
      await rejectAudit();
      await expect(store.upsertScenarioOverride(
        organizationId, scenarioId, { terminology: { greeting: "rejected" } }, actor, null, null,
      )).rejects.toThrow();
      expect(await readOverride(organizationId, scenarioId)).toBeUndefined();
      expect(await readAudit(organizationId, scenarioId)).toHaveLength(0);

      await allowAudit();
      const saved = await store.upsertScenarioOverride(
        organizationId, scenarioId, { terminology: { greeting: "original" } }, actor, null, null,
      );
      const beforeFailure = await readOverride(organizationId, scenarioId);
      await rejectAudit();

      await expect(store.upsertScenarioOverride(
        organizationId, scenarioId, { policyConstraints: ["rejected update"] },
        actor, saved.updatedAt.toISOString(), saved.id,
      )).rejects.toThrow();
      expect(await readOverride(organizationId, scenarioId)).toEqual(beforeFailure);
      expect(await readAudit(organizationId, scenarioId)).toHaveLength(1);

      await expect(store.deleteScenarioOverrideByOrgAndScenario(
        organizationId, scenarioId, actor, saved.updatedAt.toISOString(), saved.id,
      )).rejects.toThrow();
      expect(await readOverride(organizationId, scenarioId)).toEqual(beforeFailure);
      expect(await readAudit(organizationId, scenarioId)).toHaveLength(1);
    } finally {
      await allowAudit();
    }
  });
});
