import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/services/fileManager", () => ({ fileManager: {} }));
vi.mock("../../server/routes/routerHelpers", () => ({
  getOperatorAccessibleCategoryIds: vi.fn(),
  asyncHandler: (fn: any) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res, next)).catch(next),
  createHttpError: (status: number, message: string) => Object.assign(new Error(message), { status }),
}));

import createLiveAvatarRouter from "../../server/routes/liveAvatar";
import { AvatarRouterAdapter } from "../../server/services/liveAvatar/avatarRouterAdapter";

let settings: Map<string, string>;
let app: express.Express;
let deps: any;
let externalRequest: ReturnType<typeof vi.fn>;
let identityService: any;
const base = "/api/live-avatar";
function api(method: "get" | "put" | "post", path: string, role = "user", user = "owner") {
  return request(app)[method](`${base}${path}`).set("x-role", role).set("x-user", user);
}

beforeEach(() => {
  settings = new Map();
  externalRequest = vi.fn().mockRejectedValue(new Error("offline"));
  deps = {
    storage: {
      getSystemSetting: vi.fn(async (category: string, key: string) => {
        const value = settings.get(`${category}/${key}`);
        return value === undefined ? undefined : { category, key, value };
      }),
      upsertSystemSetting: vi.fn(async (s: any) => { settings.set(`${s.category}/${s.key}`, s.value); return s; }),
      getPersonaRun: vi.fn(async () => ({ id: "pr", scenarioRunId: "sr", status: "active" })),
      getScenarioRun: vi.fn(async () => ({ id: "sr", userId: "owner", scenarioId: "scenario", status: "active" })),
    },
    fileManager: { getAllScenarios: vi.fn(async () => [{ id: "scenario", categoryId: "category" }]) },
    getOperatorAccessibleCategoryIds: vi.fn(async () => ["category"]),
    adapter: new AvatarRouterAdapter(externalRequest),
  };
  identityService = {
    signer: { status: vi.fn(() => ({ state: "unconfigured", audience: "avatarrouter-api", clientId: "roleplayx-avatarrouter", tokenLifetimeSeconds: 45 })) },
    check: vi.fn().mockResolvedValue({ accepted: true, checkedAt: "2026-10-27T00:00:00Z", limits: {} }),
  };
  app = express();
  app.use(express.json());
  app.use(base, createLiveAvatarRouter((req: any, res: any, next: any) => {
    if (!req.headers["x-user"]) return res.status(401).json({ error: "Sign in required" });
    req.user = { id: req.headers["x-user"], role: req.headers["x-role"] };
    next();
  }, deps, identityService));
  app.use((error: any, _req: any, res: any, _next: any) => res.status(error.status ?? 500).json({ error: error.message }));
});

describe("live avatar policy routes", () => {
  it("exposes only public delegation status to administrators without checking upstream", async () => {
    const status = await api("get", "/identity", "admin");
    expect(status.status).toBe(200);
    expect(status.body.state).toBe("unconfigured");
    expect(status.headers["cache-control"]).toBe("no-store");
    expect(identityService.check).not.toHaveBeenCalled();
    expect(externalRequest).not.toHaveBeenCalled();
  });

  it.each(["operator", "user"])("denies %s access to delegation configuration/check", async role => {
    expect((await api("get", "/identity", role)).status).toBe(403);
    expect((await api("post", "/identity/check", role).send({})).status).toBe(403);
    expect(identityService.signer.status).not.toHaveBeenCalled();
    expect(identityService.check).not.toHaveBeenCalled();
  });

  it.each([{ userId: "other" }, { tenant_id: "other" }, { scope: "sessions:create" }, { url: "https://evil.example" }])(
    "rejects browser-controlled delegated identities and scopes", async body => {
      expect((await api("post", "/identity/check", "admin").send(body)).status).toBe(400);
      expect(identityService.check).not.toHaveBeenCalled();
    },
  );

  it("checks only the currently authenticated administrator, without returning delegation credentials", async () => {
    const result = await api("post", "/identity/check", "admin", "current").send({});
    expect(result.status).toBe(200);
    expect(identityService.check).toHaveBeenCalledWith("current");
    expect(result.body).toEqual({ accepted: true, checkedAt: "2026-10-27T00:00:00Z", limits: {} });
    expect(externalRequest).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    expect((await request(app).get(`${base}/config`)).status).toBe(401);
  });

  it("defaults OFF without writing settings, probing providers or touching content", async () => {
    const result = await api("get", "/config");
    expect(result.status).toBe(200);
    expect(result.body.enabled).toBe(false);
    expect(result.body.contractReady).toBe(false);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(deps.storage.upsertSystemSetting).not.toHaveBeenCalled();
    expect(deps.fileManager.getAllScenarios).not.toHaveBeenCalled();
    expect(externalRequest).not.toHaveBeenCalled();
  });

  it.each(["operator", "user"])("blocks %s from changing global state or running diagnostics", async role => {
    expect((await api("put", "/config", role).send({ enabled: true })).status).toBe(403);
    expect((await api("post", "/diagnostics", role)).status).toBe(403);
    expect(deps.storage.upsertSystemSetting).not.toHaveBeenCalled();
    expect(externalRequest).not.toHaveBeenCalled();
  });

  it("persists only strict booleans and returns complete config after save", async () => {
    expect((await api("put", "/config", "admin").send({ enabled: "true" })).status).toBe(400);
    expect((await api("put", "/config", "admin").send({ enabled: true, url: "http://localhost" })).status).toBe(400);
    const enabled = await api("put", "/config", "admin").send({ enabled: true });
    expect(enabled.status).toBe(200);
    expect(enabled.body).toMatchObject({ enabled: true, service: "avatar-router", contractReady: false });
    expect((await api("get", "/config")).body.enabled).toBe(true);
    expect(externalRequest).not.toHaveBeenCalled();
  });

  it("only probes fixed upstream after explicit administrator diagnostics", async () => {
    const result = await api("post", "/diagnostics", "admin");
    expect(result.status).toBe(200);
    expect(result.body.reachable).toBe(false);
    expect(externalRequest).toHaveBeenCalledTimes(2);
    expect(externalRequest.mock.calls.every(([, options]) => options.method === "GET")).toBe(true);
  });

  it("allows an authorized operator to store a policy independently while global OFF", async () => {
    const before = await api("get", "/scenarios/scenario/policy", "operator");
    expect(before.body.allowed).toBe(false);
    const saved = await api("put", "/scenarios/scenario/policy", "operator").send({ allowed: true });
    expect(saved.status).toBe(200);
    expect((await api("get", "/scenarios/scenario/policy", "operator")).body.allowed).toBe(true);
    expect((await api("get", "/config")).body.enabled).toBe(false);
    expect(externalRequest).not.toHaveBeenCalled();
  });

  it("denies out-of-category operators even on direct API requests", async () => {
    deps.getOperatorAccessibleCategoryIds.mockResolvedValue(["other"]);
    expect((await api("get", "/scenarios/scenario/policy", "operator")).status).toBe(403);
    expect((await api("put", "/scenarios/scenario/policy", "operator").send({ allowed: true })).status).toBe(403);
    expect(deps.storage.upsertSystemSetting).not.toHaveBeenCalled();
  });

  it("rejects regular users, unknown scenarios and malformed policy values", async () => {
    expect((await api("get", "/scenarios/scenario/policy")).status).toBe(403);
    expect((await api("put", "/scenarios/scenario/policy").send({ allowed: true })).status).toBe(403);
    expect((await api("put", "/scenarios/scenario/policy", "admin").send({ allowed: 1 })).status).toBe(400);
    expect((await api("put", "/scenarios/missing/policy", "admin").send({ allowed: true })).status).toBe(404);
  });

  it.each(["user", "admin", "operator"])("forbids %s from starting external sessions for another owner", async role => {
    expect((await api("get", "/conversations/pr/availability", role, "other")).status).toBe(403);
    expect((await api("post", "/conversations/pr/sessions", role, "other").send({ service: "avatar-router", consent: true })).status).toBe(403);
    expect(externalRequest).not.toHaveBeenCalled();
  });

  it("requires an existing owned conversation", async () => {
    deps.storage.getPersonaRun.mockResolvedValue(undefined);
    expect((await api("get", "/conversations/missing/availability")).status).toBe(404);
  });

  it.each([{ service: "avatar-router" }, { service: "avatar-router", consent: false }, { service: "tavus", consent: true }, { service: "avatar-router", consent: true, audio: "mic" }])(
    "rejects missing consent, unrecognized services and unsolicited audio: %j", async body => {
      expect((await api("post", "/conversations/pr/sessions").send(body)).status).toBe(400);
      expect(externalRequest).not.toHaveBeenCalled();
    },
  );

  it.each([[false, false], [true, false], [false, true], [true, true]])(
    "fails closed for enabled=%s allowed=%s without provider costs or PCM", async (enabled, allowed) => {
      settings.set("live_avatar/enabled", String(enabled));
      settings.set("live_avatar_policy/scenario", String(allowed));
      const available = await api("get", "/conversations/pr/availability");
      expect(available.body).toMatchObject({ enabled, allowed, available: false, contractReady: false });
      const selected = await api("post", "/conversations/pr/sessions").send({ service: "avatar-router", consent: true });
      expect(selected.status).toBe(409);
      expect(selected.body.code).toBe("live_avatar_contract_unverified");
      expect(selected.body.blockers).toContain("tenant_mapping_unverified");
      expect(externalRequest).not.toHaveBeenCalled();
    },
  );

  it("rejects completed conversations", async () => {
    deps.storage.getPersonaRun.mockResolvedValue({ scenarioRunId: "sr", status: "completed" });
    expect((await api("post", "/conversations/pr/sessions").send({ service: "avatar-router", consent: true })).status).toBe(409);
    expect(externalRequest).not.toHaveBeenCalled();
  });
});
