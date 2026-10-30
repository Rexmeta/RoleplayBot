import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import sharp from "sharp";
import { z } from "zod";
vi.mock("../../server/storage", () => ({ storage: {} }));
import { PersonaAvatarCreationService, PERSONA_AVATAR_CREATION } from "../../server/services/liveAvatar/personaCreation";
import { PersonaAvatarValidationService } from "../../server/services/liveAvatar/personaValidation";
import { AdminAvatarTestService } from "../../server/services/liveAvatar/adminTestService";
import { AvatarProjectClient } from "../../server/services/liveAvatar/projectClient";
import { AvatarIdentityError } from "../../server/services/liveAvatar/delegatedIdentity";
import { createPersonaAvatarOperationsRouter } from "../../server/routes/personaAvatarOperations";
import { isOperatorOrAdmin } from "../../server/middleware/authMiddleware";
import { testScopes } from "../../server/services/liveAvatar/testContracts";
import { personaAvatarCreationInput } from "../../shared/avatar/personaAvatarCreation";
import { isLiveValidatedPersonaAvatar } from "../../shared/avatar/personaAvatar";

const assetId = "12345678-1234-4234-8234-123456789abc";
const imageId = "22345678-1234-4234-8234-123456789abc";
const sessionId = "32345678-1234-4234-8234-123456789abc";
const asset = (patch: any = {}) => ({
  id: assetId, imageAssetId: imageId, name: "테스트", providerId: "tavus", providerAvatarId: "custom-replica",
  status: "ready", capabilities: { reusable: true, liveRendering: true, validation: "provisioned" },
  liveValidation: { status: "unvalidated", runtimeSupported: true, method: null, sessionId: null, validatedAt: null },
  ...patch,
});
const session = (patch: any = {}) => ({
  id: sessionId, providerId: "tavus", avatarId: "custom-replica", avatarAssetId: assetId, purpose: "validation",
  mode: "live", status: "active", rendererState: "running", stopRequested: false,
  cleanupPending: false, expiresAt: "2099-01-01T00:00:00Z", ...patch,
});
let records: Map<string, string>;
let store: any;
let connection: any;
let client: any;
let input: any;
let consentStatus: string;
let service: PersonaAvatarCreationService;
let images: any[];
let assets: any[];

beforeEach(async () => {
  records = new Map(); images = []; assets = []; consentStatus = "not_required";
  store = {
    getSystemSetting: vi.fn(async (cat, key) => records.has(`${cat}:${key}`) ? { value: records.get(`${cat}:${key}`) } : undefined),
    upsertSystemSetting: vi.fn(async (row) => records.set(`${row.category}:${row.key}`, row.value)),
  };
  connection = { check: vi.fn(async () => ({
    projectId: "project-one", scopes: [...testScopes, "assets:read", "assets:write"],
    integration: { apiVersion: "0.5.0", features: ["custom_live_validation", "client_playback_report"], customLiveProviders: ["tavus"] },
  })) };
  client = { call: vi.fn(async (_user, path, schema, body) => {
    if (body) expect([...records.values()].some(v => /ingesting|provisioning/.test(v))).toBe(true);
    const response = path === "/assets/images" ? (body ? { id: imageId, contentHash: "hash", consentStatus } : images) :
      path === "/avatar-assets" ? (body ? asset() : assets) : asset();
    return schema.parse(response);
  }) };
  input = {
    name: "페르소나", imageBase64: (await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } }).png().toBuffer()).toString("base64"),
    likeness: "synthetic", rightsConfirmed: true, transferConfirmed: true, costConfirmed: true,
  };
  service = new PersonaAvatarCreationService(client, connection, store);
});

describe("explicit persona avatar creation", () => {
  it("blocks old contracts before image writes, while leaving status recovery available", async () => {
    connection.check.mockResolvedValue({ projectId: "project-one", scopes: [...testScopes, "assets:read", "assets:write"] });
    await expect(service.create("operator", input)).rejects.toMatchObject({ code: "persona_avatar_contract_upgrade_required", status: 409 });
    expect(client.call).not.toHaveBeenCalled();
    expect(store.upsertSystemSetting).not.toHaveBeenCalled();
    expect(await service.status("operator")).toEqual({ stage: "idle", uncertain: false });
  });
  it("reads idle status without writes or image transfer", async () => {
    expect(await service.status("operator")).toEqual({ stage: "idle", uncertain: false });
    expect(client.call).not.toHaveBeenCalled();
    expect(store.upsertSystemSetting).not.toHaveBeenCalled();
  });
  it.each(["costConfirmed", "rightsConfirmed", "transferConfirmed"])("requires %s before any external request", async field => {
    await expect(service.create("operator", { ...input, [field]: false })).rejects.toMatchObject({ status: 400 });
    expect(connection.check).not.toHaveBeenCalled();
    expect(client.call).not.toHaveBeenCalled();
  });
  it("rejects URLs, invalid bytes and real likeness without consent evidence", async () => {
    expect(personaAvatarCreationInput.safeParse({ ...input, sourceUrl: "https://example.com/a" }).success).toBe(false);
    await expect(service.create("operator", { ...input, likeness: "real_person" })).rejects.toMatchObject({ status: 400 });
    await expect(service.create("operator", { ...input, imageBase64: Buffer.from("not a valid image file").toString("base64") }))
      .rejects.toMatchObject({ code: "persona_avatar_image_invalid" });
    expect(client.call).not.toHaveBeenCalled();
  });
  it("requires write scope and never trains an image pending rights review", async () => {
    connection.check.mockResolvedValueOnce({ projectId: "one", scopes: ["assets:read"] });
    await expect(service.create("operator", input)).rejects.toMatchObject({ status: 403 });
    consentStatus = "pending_review";
    const result = await service.create("operator", { ...input, likeness: "real_person", consentReference: "approval-reference" });
    expect(result.state).toMatchObject({ stage: "image_ready", consentStatus: "pending_review", uncertain: false });
    expect(client.call.mock.calls.filter((c: any) => c[3])).toHaveLength(1);
    expect([...records.values()].join("")).not.toContain("approval-reference");
  });
  it("fences both writes before calling, pins Tavus and retains no image bytes", async () => {
    const result = await service.create("operator", input);
    expect(result.state).toMatchObject({ stage: "submitted", assetId, imageId, uncertain: false });
    const posts = client.call.mock.calls.filter((c: any) => c[3]);
    expect(posts.map((c: any) => c[1])).toEqual(["/assets/images", "/avatar-assets"]);
    expect(posts[1][3]).toEqual({ imageAssetId: imageId, providerId: "tavus", costConfirmed: true });
    expect([...records.keys()][0]).toContain(PERSONA_AVATAR_CREATION);
    expect([...records.values()].join("")).not.toContain(input.imageBase64);
    await service.create("operator", input);
    expect(client.call.mock.calls.filter((c: any) => c[3])).toHaveLength(2);
  });
  it("persists an ambiguous paid outcome across restart and never repeats it", async () => {
    const original = client.call.getMockImplementation();
    client.call.mockImplementation(async (...args: any[]) => {
      if (args[1] === "/avatar-assets" && args[3]) throw new AvatarIdentityError("avatar_test_operation_uncertain", 502);
      return original(...args);
    });
    await expect(service.create("operator", input)).rejects.toMatchObject({ status: 502 });
    service = new PersonaAvatarCreationService(client, connection, store);
    expect(await service.status("operator")).toMatchObject({ stage: "provisioning", uncertain: true });
    await expect(service.create("operator", input)).rejects.toMatchObject({ code: "persona_avatar_creation_uncertain" });
    expect(client.call.mock.calls.filter((c: any) => c[1] === "/avatar-assets" && c[3])).toHaveLength(1);
    assets = [asset()];
    expect(await service.status("operator")).toMatchObject({ stage: "submitted", uncertain: false, assetId });
  });
  it("does not resolve a provisioning fence with another image or provider", async () => {
    const original = client.call.getMockImplementation();
    client.call.mockImplementation(async (...args: any[]) => {
      if (args[1] === "/avatar-assets" && args[3]) throw new AvatarIdentityError("avatar_test_operation_uncertain", 502);
      return original(...args);
    });
    await expect(service.create("operator", input)).rejects.toBeDefined();
    assets = [asset({ imageAssetId: assetId }), asset({ providerId: "anam" })];
    expect(await service.status("operator")).toMatchObject({ uncertain: true });
  });
});

describe("exact custom validation target", () => {
  it("requires current ready Tavus runtime metadata, not historical capability labels", async () => {
    client.call.mockImplementation(async (_u: string, _p: string, schema: any) => schema.parse(asset()));
    const validation = new PersonaAvatarValidationService(client, connection, new Map());
    expect(await validation.resolve("operator", assetId)).toEqual({ providerAvatarId: "custom-replica" });
    for (const patch of [{ providerId: "anam" }, { status: "processing" }, { liveValidation: undefined },
      { liveValidation: { ...asset().liveValidation, runtimeSupported: false } }, { id: imageId }]) {
      client.call.mockImplementation(async (_u: string, _p: string, schema: any) => schema.parse(asset(patch)));
      await expect(validation.resolve("operator", assetId)).rejects.toMatchObject({ status: 409 });
    }
  });
  it("binds create/connection/stop to the selected asset and validation purpose", async () => {
    client.call.mockImplementation(async (_u: string, path: string, schema: any, body: any) => {
      if (path === "/live-limits") return schema.parse({
        userRemainingSeconds: 600, globalRemainingSeconds: 600, sessionSeconds: 120, cleanupPending: 0,
        workerReady: true, providerCredits: "unknown", resetsAt: "2099-01-01",
      });
      return schema.parse(path === "/sessions" && !body ? [] : session());
    });
    const test = new AdminAvatarTestService(client, connection, store, { ready: () => true, reply: vi.fn() },
      async () => {}, { assetId, resolve: async () => ({ providerAvatarId: "custom-replica" }) });
    await test.create("operator");
    const post = client.call.mock.calls.find((c: any) => c[1] === "/sessions" && c[3]);
    expect(post[3]).toEqual({ providerId: "tavus", avatarId: "custom-replica", avatarAssetId: assetId,
      purpose: "validation", mode: "live", costConfirmed: true });
    client.call.mockImplementation(async (_u: string, _p: string, schema: any) => schema.parse(session({ avatarAssetId: imageId })));
    await expect(test.session("operator", sessionId)).rejects.toBeDefined();
  });
  it("retains owned session recovery and end when an asset becomes unavailable", async () => {
    client.call.mockImplementation(async (_u: string, path: string, schema: any, body: any) => {
      if (path === "/live-limits") return schema.parse({
        userRemainingSeconds: 600, globalRemainingSeconds: 600, sessionSeconds: 120, cleanupPending: 0,
        workerReady: true, providerCredits: "unknown", resetsAt: "2099-01-01",
      });
      return schema.parse(path === "/sessions" && !body ? [session()] : session({ stopRequested: true }));
    });
    const test = new AdminAvatarTestService(client, connection, store, { ready: () => true, reply: vi.fn() },
      async () => {}, { assetId, resolve: async () => { throw new AvatarIdentityError("avatar_test_upstream_404", 404); } });
    const state = await test.preflight("operator");
    expect(state).toMatchObject({ ready: false, runtimeError: "avatar_test_upstream_404" });
    expect(state.sessions).toHaveLength(1);
    await test.stop("operator", sessionId, true);
    expect(client.call.mock.calls.some((call: any) => call[1] === `/sessions/${sessionId}/end` && call[3])).toBe(true);
  });
  it("checks running/unexpired same-revision session before reporting and rejects wrong returned evidence", async () => {
    let current = session();
    const tests = new Map([[assetId, { session: vi.fn(async () => current) } as any]]);
    client.call.mockImplementation(async (_u: string, path: string, schema: any) => schema.parse(path.endsWith("live-validation") ?
      asset({ liveValidation: { status: "validated", runtimeSupported: true, method: "client_playback_report", sessionId,
        validatedAt: "2026-10-30T00:00:00Z" } }) : asset()));
    const validation = new PersonaAvatarValidationService(client, connection, tests);
    expect((await validation.report("operator", assetId, sessionId)).liveValidation?.status).toBe("validated");
    expect(client.call.mock.calls.find((c: any) => c[3])[3]).toEqual({ sessionId, videoObserved: true, audioObserved: true });
    for (const patch of [{ avatarId: "changed" }, { rendererState: "queued" }, { cleanupPending: true },
      { expiresAt: "2000-01-01T00:00:00Z" }]) {
      current = session(patch);
      await expect(validation.report("operator", assetId, sessionId)).rejects.toMatchObject({ status: 409 });
    }
  });
  it("distinguishes new playback evidence from old live_verified capability claims", () => {
    expect(isLiveValidatedPersonaAvatar(asset({ capabilities: { ...asset().capabilities, validation: "live_verified" } }))).toBe(false);
    expect(isLiveValidatedPersonaAvatar(asset({ liveValidation: { ...asset().liveValidation, status: "validated",
      method: "client_playback_report", sessionId, validatedAt: "2026-10-30T00:00:00Z" } }))).toBe(true);
  });
});

describe("persona operations routes", () => {
  const app = (creation: any, validation: any) => {
    const a = express(); a.use(express.json());
    a.use((req: any, res, next) => {
      const role = req.header("x-role");
      if (!role) return res.sendStatus(401);
      req.user = { id: "operator", role }; next();
    });
    a.use("/avatar", isOperatorOrAdmin, createPersonaAvatarOperationsRouter(creation, validation));
    return a;
  };
  it("blocks learner/anonymous access and never dispatches without exact consent", async () => {
    const create = vi.fn();
    const a = app({ create }, { service: vi.fn() });
    expect((await request(a).get("/avatar/creation")).status).toBe(401);
    expect((await request(a).post("/avatar/creation").set("x-role", "user").send(input)).status).toBe(403);
    expect((await request(a).post("/avatar/creation").set("x-role", "operator").send({ ...input, tenantId: "forged" })).status).toBe(400);
    expect((await request(a).post(`/avatar/assets/${assetId}/validation/sessions`).set("x-role", "operator")
      .send({ costConfirmed: true })).status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });
  it("requires actual affirmative playback reports and uses fresh authenticated user", async () => {
    const report = vi.fn(async () => asset());
    const a = app({}, { report });
    for (const patch of [{ videoObserved: false }, { audioObserved: false }, { userId: "forged" }]) {
      expect((await request(a).post(`/avatar/assets/${assetId}/validation/report`).set("x-role", "operator")
        .send({ sessionId, videoObserved: true, audioObserved: true, ...patch })).status).toBe(400);
    }
    const res = await request(a).post(`/avatar/assets/${assetId}/validation/report`).set("x-role", "operator")
      .send({ sessionId, videoObserved: true, audioObserved: true });
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(report).toHaveBeenCalledExactlyOnceWith("operator", assetId, sessionId);
  });
  it("allows only the fixed asset write routes in the project transport", async () => {
    const identity: any = { getUser: async () => ({ id: "operator", isActive: true }) };
    const fetcher = vi.fn(async () => new Response("{}", { headers: { "Content-Type": "application/json" } }));
    const transport = new AvatarProjectClient(identity, fetcher as any, () => ({
      baseUrl: "https://avatar-router.replit.app/api/v1", apiKey: "ar_sk_test_not_real_123456789",
    }));
    for (const path of ["/assets/images", "/avatar-assets", `/avatar-assets/${assetId}/live-validation`]) {
      await transport.call("operator", path, z.object({}), {});
    }
    for (const path of ["/developer/keys", `/avatar-assets/${assetId}`, "/assets/images/../sessions", "//evil.test/sessions"]) {
      await expect(transport.call("operator", path, z.object({}), {})).rejects.toMatchObject({ status: 400 });
    }
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
