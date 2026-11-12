import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { DEFAULT_EXPERIMENT_FIXED } from "../../shared/cultureExperiment";
import { newCultureValues } from "../../shared/cultureMap";

const mocks = vi.hoisted(() => ({
  policy: vi.fn(), create: vi.fn(), bind: vi.fn(), run: vi.fn(), list: vi.fn(), text: vi.fn(),
}));
vi.mock("../../server/routes/routerHelpers", () => ({
  asyncHandler: (handler: any) => (req: any, res: any, next: any) => Promise.resolve(handler(req, res, next)).catch(next),
}));
vi.mock("../../server/services/cultureMap/service", () => ({
  bindActorCultures: mocks.bind,
  listCultureProfiles: mocks.list,
  CultureError: class CultureError extends Error {
    constructor(message: string, public statusCode = 400) { super(message); }
  },
}));
vi.mock("../../server/services/aiServiceFactory", () => ({
  getPolicyForFeature: mocks.policy, AIServiceFactory: { createServiceWithPolicy: mocks.create },
}));
vi.mock("../../server/services/aiUsageTracker", () => ({
  calculateCost: () => ({ totalCost: 0.01 }), getModelPricingKey: (model: string) => model,
  MODEL_PRICING: { "test-model": { input: 1, output: 1 } },
}));
vi.mock("../../server/services/cultureMap/experiment", () => ({ runCultureExperiment: mocks.run }));
import createCultureExperimentRouter from "../../server/routes/cultureExperiment";

const variant = { enabled: true, profileId: "00000000-0000-4000-8000-000000000001", profileVersion: 1, intensity: 70, overrides: {} };
const input = (mode = "provider") => ({ mode, confirmPaidRun: true, fixed: DEFAULT_EXPERIMENT_FIXED, variants: [variant], repetitions: 1 });
function app(role = "admin") {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { if (role) req.user = { id: "user", role }; next(); });
  app.use("/api/simulation", createCultureExperimentRouter((req: any, res: any, next: any) => req.user ? next() : res.sendStatus(401)));
  app.use((error: any, _req: any, res: any, _next: any) => res.status(500).json({ error: "Unexpected error" }));
  return app;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.policy.mockResolvedValue({ provider: "gemini", model: "test-model" });
  mocks.create.mockReturnValue({ generateStreamingResponse: vi.fn(), generateText: mocks.text });
  mocks.list.mockResolvedValue([{ id: variant.profileId, version: 1, name: "프로필", country: "국가", dimensions: newCultureValues() }]);
  mocks.text.mockResolvedValue(JSON.stringify({ fixed: DEFAULT_EXPERIMENT_FIXED, variants: [{ profileId: variant.profileId, profileVersion: 1, intensity: 50 }] }));
  mocks.bind.mockImplementation(async (actors: any[]) => actors.map(actor => ({ ...actor, culture: {
    ...actor.culture, snapshotVersion: 1, name: "국가", country: "국가", region: "", sources: [], dimensions: newCultureValues(),
  } })));
  mocks.run.mockResolvedValue({ mode: "provider", cases: [] });
});
describe("admin-only controlled experiment endpoints", () => {
  it.each(["operator", "user", ""])("blocks role %s before any binding or provider setup", async role => {
    const api = app(role);
    const status = role ? 403 : 401;
    expect((await request(api).get("/api/simulation/culture-experiment/config")).status).toBe(status);
    expect((await request(api).post("/api/simulation/culture-experiment").send(input())).status).toBe(status);
    expect((await request(api).post("/api/simulation/culture-experiment/autofill").send({})).status).toBe(status);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.bind).not.toHaveBeenCalled();
  });
  it("config reads model without starting provider calls", async () => {
    const response = await request(app()).get("/api/simulation/culture-experiment/config");
    expect(response.body.policy).toEqual({ provider: "gemini", model: "test-model" });
    expect(response.body.situations).toHaveLength(4);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects lack of consent, excessive batches and forged snapshots before paid execution", async () => {
    const api = app();
    for (const body of [
      { ...input(), confirmPaidRun: false },
      { ...input(), repetitions: 3 },
      { ...input(), variants: [{ ...variant, snapshotVersion: 1, dimensions: newCultureValues() }] },
    ]) expect((await request(api).post("/api/simulation/culture-experiment").send(body)).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("mock binds versioned snapshots but never resolves/creates a paid provider", async () => {
    expect((await request(app()).post("/api/simulation/culture-experiment").send(input("mock"))).status).toBe(200);
    expect(mocks.bind).toHaveBeenCalledWith([{ id: "controlled-actor", culture: variant }], { id: "user", role: "admin" });
    expect(mocks.policy).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.run.mock.calls[0][1][0].culture).toEqual({ enabled: false });
  });
  it("uses one pinned strict provider with no substitution and no unknown-price fallback", async () => {
    const api = app();
    expect((await request(api).post("/api/simulation/culture-experiment").send(input())).status).toBe(200);
    expect(mocks.policy).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith({ provider: "gemini", model: "test-model" }, { strict: true });
    const deps = mocks.run.mock.calls[0][2];
    expect(deps.estimateCost("unknown-model", 1, 1)).toBeNull();
    expect(deps.estimateCost("test-model", 1, 1)).toBe(0.01);
    mocks.create.mockImplementation(() => { throw new Error("SECRET"); });
    const failed = await request(api).post("/api/simulation/culture-experiment").send(input());
    expect(failed.status).toBe(400);
    expect(failed.text).not.toContain("SECRET");
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });
  it("rejects concurrent batches and releases its guard after completion or failure", async () => {
    const api = app();
    let release!: () => void;
    let signal!: () => void;
    const started = new Promise<void>(resolve => { signal = resolve; });
    mocks.run.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; signal(); }));
    const first = request(api).post("/api/simulation/culture-experiment").send(input()).then(response => response);
    await started;
    expect((await request(api).post("/api/simulation/culture-experiment").send(input())).status).toBe(409);
    release();
    await first;
    mocks.run.mockRejectedValueOnce(new Error("fail"));
    expect((await request(api).post("/api/simulation/culture-experiment").send(input())).status).toBe(500);
    expect((await request(api).post("/api/simulation/culture-experiment").send(input())).status).toBe(200);
  });
});

describe("explicit AI autofill", () => {
  const path = "/api/simulation/culture-experiment/autofill";
  it("generates once with the configured strict text policy and accessible candidates, without running experiments", async () => {
    const response = await request(app()).post(path).send({});
    expect(response.status).toBe(200);
    expect(response.body.fixed).toEqual(DEFAULT_EXPERIMENT_FIXED);
    expect(response.body.variants).toEqual([{ profileId: variant.profileId, profileVersion: 1, intensity: 50 }]);
    expect(mocks.list).toHaveBeenCalledWith({ id: "user", role: "admin" });
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.policy).toHaveBeenCalledWith("conversation");
    expect(mocks.create).toHaveBeenCalledWith({ provider: "gemini", model: "test-model" }, { strict: true });
    expect(mocks.text).toHaveBeenCalledTimes(1);
    expect(mocks.text.mock.calls[0][0]).toContain(variant.profileId);
    expect(mocks.text.mock.calls[0][0]).toContain("고정관념");
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.bind).not.toHaveBeenCalled();
  });
  it("rejects supplied candidates and empty accessible profiles before AI setup", async () => {
    const api = app();
    expect((await request(api).post(path).send({ profiles: [variant] })).status).toBe(400);
    mocks.list.mockResolvedValue([]);
    const response = await request(api).post(path).send({});
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("프로필");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each([
    "not JSON",
    JSON.stringify({ fixed: DEFAULT_EXPERIMENT_FIXED, variants: [] }),
    JSON.stringify({ fixed: { ...DEFAULT_EXPERIMENT_FIXED, name: "x".repeat(101) }, variants: [variant] }),
    JSON.stringify({ fixed: DEFAULT_EXPERIMENT_FIXED, variants: [{ profileId: variant.profileId, profileVersion: 1, intensity: 101 }] }),
    JSON.stringify({ fixed: DEFAULT_EXPERIMENT_FIXED, variants: [{ profileId: variant.profileId, profileVersion: 2, intensity: 50 }] }),
    JSON.stringify({ fixed: DEFAULT_EXPERIMENT_FIXED, variants: [{ profileId: "00000000-0000-4000-8000-000000000099", profileVersion: 1, intensity: 50 }] }),
  ])("rejects malformed or invented suggestions without leaking provider contents", async raw => {
    mocks.text.mockResolvedValue(raw);
    const response = await request(app()).post(path).send({});
    expect([409, 502]).toContain(response.status);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("rechecks changed profile versions after generation", async () => {
    mocks.list.mockResolvedValueOnce([{ id: variant.profileId, version: 1 }]).mockResolvedValueOnce([{ id: variant.profileId, version: 2 }]);
    expect((await request(app()).post(path).send({})).status).toBe(409);
  });
  it("blocks duplicate autofill and experiment requests, then unlocks after provider failure", async () => {
    let fail!: (error: Error) => void;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    mocks.text.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; started(); }));
    const api = app();
    const first = request(api).post(path).send({}).then(response => response);
    await ready;
    expect((await request(api).post(path).send({})).status).toBe(409);
    expect((await request(api).post("/api/simulation/culture-experiment").send(input())).status).toBe(409);
    fail(new Error("SECRET_URL_AND_KEY"));
    const response = await first;
    expect(response.status).toBe(502);
    expect(response.text).not.toContain("SECRET");
    expect((await request(api).post(path).send({})).status).toBe(200);
  });
  it("times out, aborts the text request and allows retry", async () => {
    const api = app();
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    let signal!: AbortSignal;
    mocks.text.mockImplementationOnce((_prompt, options) => {
      signal = options.signal;
      started();
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
    });
    // Fake only the application deadline, not HTTP's I/O scheduling.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const first = request(api).post(path).send({}).then(response => response);
      await ready;
      await vi.advanceTimersByTimeAsync(45001);
      const response = await first;
      expect(response.status).toBe(504);
      expect(signal.aborted).toBe(true);
    } finally { vi.useRealTimers(); }
    expect((await request(api).post(path).send({})).status).toBe(200);
  });
});
