import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import express from "express";
import request from "supertest";
import { DEFAULT_EXPERIMENT_FIXED } from "../../shared/cultureExperiment";
import { newCultureValues } from "../../shared/cultureMap";

const mocks = vi.hoisted(() => ({ text: vi.fn(), stream: vi.fn() }));
vi.mock("../../server/routes/routerHelpers", () => ({
  asyncHandler: (fn: any) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res)).catch(next),
}));
vi.mock("../../server/services/cultureMap/service", () => ({
  CultureError: class extends Error {
    constructor(message: string, public statusCode = 400) { super(message); }
  },
  listCultureProfiles: async () => [{ id: "00000000-0000-4000-8000-000000000001", version: 1, name: "프로필", country: "국가", dimensions: newCultureValues() }],
  bindActorCultures: async (actors: any[]) => actors.map(actor => ({
    ...actor, culture: { ...actor.culture, snapshotVersion: 1, name: "프로필", country: "국가", region: "", sources: [], dimensions: newCultureValues() },
  })),
}));
vi.mock("../../server/services/aiServiceFactory", () => ({
  getPolicyForFeature: async () => ({ provider: "gemini", model: "fake" }),
  AIServiceFactory: { createServiceWithPolicy: () => ({ generateText: mocks.text, generateStreamingResponse: mocks.stream }) },
}));
vi.mock("../../server/services/aiUsageTracker", () => ({
  calculateCost: () => ({ totalCost: 0 }), getModelPricingKey: (model: string) => model, MODEL_PRICING: {},
}));

const url = process.env.CULTURE_EXPERIMENT_TEST_DATABASE_URL;
const base = "/api/simulation/culture-experiment";
const variant = { enabled: true, profileId: "00000000-0000-4000-8000-000000000001", profileVersion: 1, intensity: 50, overrides: {} };
const input = { mode: "provider", confirmPaidRun: true, fixed: DEFAULT_EXPERIMENT_FIXED, variants: [variant], repetitions: 1 };
const suggestion = JSON.stringify({ fixed: DEFAULT_EXPERIMENT_FIXED, variants: [{ profileId: variant.profileId, profileVersion: 1, intensity: 50 }] });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

describe.skipIf(!url)("culture experiment leases with two routers and real PostgreSQL", () => {
  let fixture: Client;
  let schema: string;
  let originalUrl: string | undefined;
  let pool: { end: () => Promise<void> };
  let RouterFactory: typeof import("../../server/routes/cultureExperiment").default;
  let Store: typeof import("../../server/services/cultureMap/experimentLease").ExperimentLeaseStore;
  function app() {
    const api = express();
    api.use(express.json());
    api.use((req: any, _res, next) => { req.user = { id: req.headers["x-user"] || "admin", role: "admin" }; next(); });
    api.use("/api/simulation", RouterFactory((_req: any, _res: any, next: any) => next()));
    api.use((_error: any, _req: any, res: any, _next: any) => res.sendStatus(500));
    return api;
  }
  async function expire() {
    await fixture.query(`UPDATE system_settings SET value = jsonb_set(value::jsonb, '{expiresAt}', '0')::text`);
  }
  beforeAll(async () => {
    if (!url || !new URL(url).pathname.toLowerCase().includes("test") || url === process.env.DATABASE_URL)
      throw new Error("A separate test database is required");
    schema = `culture_lease_${randomUUID().replaceAll("-", "")}`;
    fixture = new Client({ connectionString: url });
    await fixture.connect();
    await fixture.query(`CREATE SCHEMA ${schema}`);
    await fixture.query(`SET search_path TO ${schema}`);
    await fixture.query(`CREATE TABLE system_settings (
      id varchar PRIMARY KEY DEFAULT gen_random_uuid(), category varchar NOT NULL,
      key varchar NOT NULL, value text NOT NULL, description text,
      updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_by varchar
    )`);
    const scoped = new URL(url);
    scoped.searchParams.set("options", `-c search_path=${schema}`);
    originalUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = scoped.toString();
    RouterFactory = (await import("../../server/routes/cultureExperiment")).default;
    Store = (await import("../../server/services/cultureMap/experimentLease")).ExperimentLeaseStore;
    ({ pool } = await import("../../server/storage/db"));
  });
  beforeEach(async () => {
    await fixture.query("TRUNCATE system_settings");
    vi.resetAllMocks();
    mocks.text.mockResolvedValue(suggestion);
    mocks.stream.mockImplementation(async () => (async function* () { yield "가짜 응답"; })());
  });
  afterAll(async () => {
    await pool?.end();
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    if (fixture) {
      await fixture.query(`DROP SCHEMA ${schema} CASCADE`);
      await fixture.end();
    }
  });

  it("blocks autofill/autofill and autofill/comparison across router instances, then releases", async () => {
    const a = app(), b = app();
    const entered = deferred<void>(), result = deferred<string>();
    mocks.text.mockImplementationOnce(() => { entered.resolve(); return result.promise; });
    const first = request(a).post(`${base}/autofill`).send({}).then(r => r);
    await entered.promise;
    expect((await request(b).post(`${base}/autofill`).send({})).status).toBe(409);
    expect((await request(b).post(base).send(input)).status).toBe(409);
    expect(mocks.text).toHaveBeenCalledTimes(1);
    expect(mocks.stream).not.toHaveBeenCalled();
    result.resolve(suggestion);
    expect((await first).status).toBe(200);
    expect((await request(b).post(`${base}/autofill`).send({})).status).toBe(200);
  });

  it("blocks comparison/autofill and comparison/comparison in the opposite direction", async () => {
    const a = app(), b = app();
    const entered = deferred<void>(), resume = deferred<void>();
    mocks.stream.mockImplementationOnce(async () => (async function* () {
      entered.resolve(); await resume.promise; yield "가짜 응답";
    })());
    const first = request(a).post(base).send(input).then(r => r);
    await entered.promise;
    expect((await request(b).post(`${base}/autofill`).send({})).status).toBe(409);
    expect((await request(b).post(base).send(input)).status).toBe(409);
    resume.resolve();
    expect((await first).status).toBe(200);
  });

  it("atomically enforces the global two-user cap and keeps different users independent", async () => {
    const a = new Store(), b = new Store();
    const results = await Promise.all([
      a.acquire("one", "t1"), b.acquire("two", "t2"), a.acquire("three", "t3"),
    ]);
    expect(results.filter(Boolean)).toHaveLength(2);
    expect((await fixture.query("SELECT * FROM system_settings")).rows).toHaveLength(2);
  });

  it("admits only one owner when two workers acquire the same user simultaneously", async () => {
    const results = await Promise.all([
      new Store().acquire("same-admin", "one"),
      new Store().acquire("same-admin", "two"),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await fixture.query("SELECT * FROM system_settings")).rows).toHaveLength(1);
  });

  it("recovers orphaned work after expiry, with stale renew/release fenced out", async () => {
    const old = new Store(), replacement = new Store();
    expect(await old.acquire("admin", "old-token")).toBe(true);
    // A fresh router (restart) must still respect the orphaned lease.
    expect((await request(app()).post(`${base}/autofill`).send({})).status).toBe(409);
    await expire();
    expect(await old.renew("admin", "old-token")).toBe(false);
    expect(await replacement.acquire("admin", "new-token")).toBe(true);
    await old.release("admin", "old-token");
    expect(await old.renew("admin", "old-token")).toBe(false);
    expect(await replacement.renew("admin", "new-token")).toBe(true);
    await replacement.release("admin", "new-token");
    expect((await request(app()).post(`${base}/autofill`).send({})).status).toBe(200);
  });

  it("stops a stale comparison before another paid call and cannot release the replacement", async () => {
    const entered = deferred<void>(), resume = deferred<void>();
    mocks.stream.mockImplementationOnce(async () => (async function* () {
      entered.resolve(); await resume.promise; yield "늦은 응답";
    })());
    const first = request(app()).post(base).send(input).then(r => r);
    await entered.promise;
    await expire();
    const replacement = new Store();
    expect(await replacement.acquire("admin", "new-token")).toBe(true);
    resume.resolve();
    expect((await first).status).toBe(503);
    expect(mocks.stream).toHaveBeenCalledTimes(1);
    expect(await replacement.renew("admin", "new-token")).toBe(true);
  });

  it("recovers normally from provider errors without leaving the user locked", async () => {
    mocks.text.mockRejectedValueOnce(new Error("fake failure"));
    expect((await request(app()).post(`${base}/autofill`).send({})).status).toBe(502);
    expect((await request(app()).post(`${base}/autofill`).send({})).status).toBe(200);
  });
});
