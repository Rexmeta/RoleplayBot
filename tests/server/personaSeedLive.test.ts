import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createHash } from "node:crypto";
vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/storage/db", () => ({ db: {} }));
vi.mock("../../server/services/mediaStorage", () => ({ mediaStorage: {} }));
import { PersonaSeedLiveService } from "../../server/services/liveAvatar/personaSeedLive";
import { AvatarIdentityError } from "../../server/services/liveAvatar/delegatedIdentity";
import { AvatarProjectClient } from "../../server/services/liveAvatar/projectClient";
import { createPersonaAvatarOperationsRouter } from "../../server/routes/personaAvatarOperations";
import { isOperatorOrAdmin } from "../../server/middleware/authMiddleware";

const imageId = "22345678-1234-4234-8234-123456789abc";
const assetId = "12345678-1234-4234-8234-123456789abc";
const source = "personas/coach/base-v1.webp";
const consent = { rightsConfirmed: true, transferConfirmed: true, likeness: "synthetic" };
const contentHash = createHash("sha256").update(Buffer.alloc(32)).digest("hex");
let svc: PersonaSeedLiveService, d: any, rows: Map<string, any>, options: any, persona: any, project: string, tenant: string;
beforeEach(() => {
  rows = new Map(); project = "project-one"; tenant = "tenant-one";
  persona = { id: "coach", images: { base: source } };
  options = { imageAssetId: imageId, imageVersion: 1, providerId: "tavus", canProvision: true, nextAction: "provision", candidates: [] };
  d = {
    identity: vi.fn(async () => ({ tenantId: tenant })),
    connection: { check: vi.fn(async () => ({ projectId: project, scopes: ["assets:read", "assets:write"],
      integration: { features: ["custom_live_validation", "client_playback_report", "seed_image_live_options"], customLiveProviders: ["tavus"] } })) },
    store: {
      getMbtiPersona: vi.fn(async () => persona),
      getSystemSetting: vi.fn(async (category, key) => rows.get(`${category}:${key}`)),
      upsertSystemSetting: vi.fn(async row => rows.set(`${row.category}:${row.key}`, row)),
    },
    lock: vi.fn(async (_key, work) => work()),
    readImage: vi.fn(async () => Buffer.alloc(32)),
    client: { call: vi.fn(async (_user, path, schema, body) => {
      if (body) expect([...rows.values()].some(v => /registering|creating/.test(v.value))).toBe(true);
      if (path === "/assets/images") return schema.parse({ id: imageId, version: 1, contentHash });
      if (path === "/avatar-assets") return schema.parse({
        id: assetId, imageAssetId: imageId, providerId: "tavus", providerAvatarId: null, name: "coach", status: "queued",
        capabilities: { reusable: false, liveRendering: false, validation: "documentation_only" },
      });
      return schema.parse(options);
    }), image: vi.fn(async () => ({ bytes: Buffer.from([137, 80, 78, 71]), contentType: "image/png" })) },
  };
  svc = new PersonaSeedLiveService(d);
});
const candidate = (verified = false) => ({
  avatarAssetId: assetId, status: "ready", canActivate: verified, nextAction: verified ? "select" : "validate",
  liveReference: verified ? { avatarAssetId: assetId, avatarId: "face", providerId: "tavus", pipeline: "tavus_full" } : null,
});
const localFailure = () => ({
  ...candidate(), status: "failed", nextAction: "inspect_failure",
  failure: {
    code: "TRAINING_IMAGE_AI_MODEL_UNAVAILABLE", stage: "unknown", trainingImageStage: "unknown",
    category: "permission_or_plan", providerHttpStatus: null, providerErrorCode: null, reasonState: "not_retained",
    message: "Historical model failure", messageKo: "이전에 저장된 모델 오류입니다.",
    automaticRetryAllowed: false, nextAction: "operator_review", creationOutcome: "not_created",
  },
});
describe("persona seed safety and persistence", () => {
  it("uploads bytes and calls creation in one explicit request, without status preflights", async () => {
    const result = await svc.create("admin", "coach", source, { costConfirmed: true, registration: consent });
    expect(result).toMatchObject({ stage: "submitted", uncertain: false, draft: { imageAssetId: imageId } });
    expect(d.client.call.mock.calls.map((c: any[]) => c[1])).toEqual(["/assets/images", "/avatar-assets"]);
    const upload = d.client.call.mock.calls[0][3];
    expect(Buffer.from(upload.imageBase64, "base64")).toEqual(Buffer.alloc(32));
    expect(upload).toMatchObject({ name: "coach", rightsConfirmed: true, likeness: "synthetic" });
    expect(upload).not.toHaveProperty("transferConfirmed");
    expect(d.client.call.mock.calls[1][3].imageAssetId).toBe(imageId);
    expect(JSON.stringify([...rows.values()])).not.toContain(upload.imageBase64);
  });
  it("never invokes creation if the upload fails or acknowledges a different source hash", async () => {
    d.client.call.mockRejectedValueOnce(new AvatarIdentityError("avatar_test_upstream_422", 422));
    await expect(svc.create("admin", "coach", source, { costConfirmed: true, registration: consent }))
      .rejects.toMatchObject({ code: "persona_seed_upload_avatar_test_upstream_422" });
    expect(d.client.call).toHaveBeenCalledTimes(1);
    d.client.call.mockResolvedValueOnce({ id: imageId, version: 1, contentHash: "a".repeat(64) });
    await expect(svc.create("admin", "coach", source, { costConfirmed: true, registration: consent }))
      .rejects.toMatchObject({ code: "persona_seed_upload_mismatch" });
    expect(d.client.call.mock.calls.every((c: any[]) => c[1] === "/assets/images")).toBe(true);
  });
  it("requires all three consents before a combined upload and creation", async () => {
    for (const body of [
      { costConfirmed: false, registration: consent },
      { costConfirmed: true, registration: { ...consent, rightsConfirmed: false } },
      { costConfirmed: true, registration: { ...consent, transferConfirmed: false } },
      { costConfirmed: true, registration: { ...consent, likeness: "real_person" } },
    ]) await expect(svc.create("admin", "coach", source, body)).rejects.toMatchObject({ status: 400 });
    expect(d.client.call).not.toHaveBeenCalled();
    expect(d.readImage).not.toHaveBeenCalled();
  });
  it("retains the acknowledged image after an uncertain create and never retries it automatically", async () => {
    const original = d.client.call.getMockImplementation();
    d.client.call.mockImplementation((user: string, path: string, schema: any, body: any) => {
      if (path === "/avatar-assets") throw new AvatarIdentityError("avatar_test_operation_uncertain", 502);
      return original(user, path, schema, body);
    });
    await expect(svc.create("admin", "coach", source, { costConfirmed: true, registration: consent }))
      .rejects.toMatchObject({ code: "avatar_test_operation_uncertain" });
    const op = JSON.parse([...rows.values()][0].value);
    expect(op).toMatchObject({ stage: "creating", draft: { imageAssetId: imageId } });
    expect(d.client.call).toHaveBeenCalledTimes(2);
  });
  it("sends the one-click route through the real JSON transport with the acknowledged image ID", async () => {
    const bytes = Buffer.alloc(768, 137);
    d.readImage.mockResolvedValue(bytes);
    // This fixture is a response, not a replacement for the transport under test.
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (url.endsWith("/assets/images")) {
        expect(Buffer.from(body.imageBase64, "base64")).toEqual(bytes);
        expect(body).toEqual({ name: "coach", imageBase64: bytes.toString("base64"), rightsConfirmed: true, likeness: "synthetic" });
        return Response.json({ id: imageId, version: 4, contentHash: createHash("sha256").update(bytes).digest("hex") }, { status: 201 });
      }
      expect(url).toBe("https://avatar-router.replit.app/api/v1/avatar-assets");
      expect(body).toEqual({ imageAssetId: imageId, personaId: "coach", providerId: "tavus", voiceName: "anna", costConfirmed: true });
      return Response.json({ id: assetId, imageAssetId: imageId, name: "coach", providerId: "tavus", providerAvatarId: null,
        status: "queued", capabilities: { reusable: false, liveRendering: false, validation: "documentation_only" } }, { status: 202 });
    });
    d.client = new AvatarProjectClient({ getUser: async () => ({ id: "admin", isActive: true }) } as any,
      fetcher as any, () => ({ baseUrl: "https://avatar-router.replit.app/api/v1", apiKey: "ar_sk_test_not_real_123456789" }));
    const app = express(); app.use(express.json());
    app.use((req: any, _res, next) => { req.user = { id: "admin", role: "admin" }; next(); });
    app.use("/api/admin/personas/live-avatar", isOperatorOrAdmin,
      createPersonaAvatarOperationsRouter(undefined, undefined, new PersonaSeedLiveService(d)));
    const result = await request(app).post(`/api/admin/personas/live-avatar/personas/coach/seed/create?source=${encodeURIComponent(source)}`)
      .send({ costConfirmed: true, registration: consent });
    expect(result.status).toBe(202);
    expect(result.body).toMatchObject({ stage: "submitted", uncertain: false, draft: { imageAssetId: imageId, imageVersion: 4 } });
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [, init] of fetcher.mock.calls) {
      expect(init).toMatchObject({ method: "POST", redirect: "error", credentials: "omit",
        headers: { Authorization: "Bearer ar_sk_test_not_real_123456789", "Content-Type": "application/json",
          "X-Avatar-User-ID": expect.stringMatching(/^user_/) } });
    }
  });
  it("editor status is read-only; save with no seed neither transfers media nor starts creation", async () => {
    expect(await svc.status("admin", "coach", source)).toMatchObject({ stage: "idle", draft: null, uncertain: false });
    expect(await svc.normalize("admin", { motivation: "updated" }, persona)).toEqual({});
    expect(d.client.call).not.toHaveBeenCalled();
    expect(d.readImage).not.toHaveBeenCalled();
    expect(d.store.upsertSystemSetting).not.toHaveBeenCalled();
  });
  it("registers the owned image and forwards each explicit create, without automatic retries", async () => {
    const state = await svc.register("admin", "coach", source, consent);
    expect(state.draft).toMatchObject({ imageAssetId: imageId, imageVersion: 1, projectId: project });
    expect(d.readImage).toHaveBeenCalledWith(source);
    expect(d.client.call.mock.calls.filter((c: any[]) => c[3]).map((c: any[]) => c[1])).toEqual(["/assets/images"]);
    await svc.create("admin", "coach", source, { costConfirmed: true });
    const post = d.client.call.mock.calls.find((c: any[]) => c[1] === "/avatar-assets");
    expect(post[3]).toEqual({ imageAssetId: imageId, providerId: "tavus", personaId: "coach", voiceName: "anna", costConfirmed: true });
    expect(d.client.call.mock.calls.filter((c: any[]) => c[1] === "/avatar-assets")).toHaveLength(1);
    await svc.create("admin", "coach", source, { costConfirmed: true });
    expect(d.client.call.mock.calls.filter((c: any[]) => c[1] === "/avatar-assets")).toHaveLength(2);
    const reopened = new PersonaSeedLiveService(d);
    expect(await reopened.status("admin", "coach", source)).toMatchObject({ stage: "submitted", draft: state.draft });
    expect(JSON.stringify([...rows.values()])).not.toContain("imageBase64");
  });
  it("fails closed for missing rights, transfer, cost, unsupported capability and unsaved media", async () => {
    await expect(svc.register("admin", "coach", source, { ...consent, rightsConfirmed: false })).rejects.toMatchObject({ status: 400 });
    await expect(svc.register("admin", "coach", source, { ...consent, likeness: "real_person" })).rejects.toMatchObject({ status: 400 });
    await expect(svc.create("admin", "coach", source, { costConfirmed: false })).rejects.toMatchObject({ status: 400 });
    await expect(svc.register("admin", "coach", "https://evil.invalid/image", consent)).rejects.toMatchObject({ code: "persona_seed_save_image_first" });
    d.connection.check.mockResolvedValue({ scopes: ["assets:read", "assets:write"], projectId: project, integration: {} });
    await expect(svc.register("admin", "coach", source, consent)).rejects.toMatchObject({ code: "persona_seed_contract_upgrade_required" });
    expect(d.readImage).not.toHaveBeenCalled();
    expect(d.client.call).not.toHaveBeenCalled();
  });
  it("hydrates by tenant AND project, never another scope's draft", async () => {
    await svc.register("admin", "coach", source, consent);
    tenant = "tenant-two";
    expect((await svc.status("other", "coach", source)).draft).toBeNull();
    tenant = "tenant-one"; project = "project-two";
    expect((await svc.status("admin", "coach", source)).draft).toBeNull();
  });
  it("retains uncertainty after restart but forwards a new manual request to the router", async () => {
    await svc.register("admin", "coach", source, consent);
    d.client.call.mockImplementation(async (_user: string, path: string, schema: any) => {
      if (path === "/avatar-assets") throw new AvatarIdentityError("avatar_test_operation_uncertain", 502);
      return schema.parse(options);
    });
    await expect(svc.create("admin", "coach", source, { costConfirmed: true })).rejects.toMatchObject({ status: 502 });
    svc = new PersonaSeedLiveService(d);
    expect((await svc.status("admin", "coach", source)).uncertain).toBe(true);
    await expect(svc.create("admin", "coach", source, { costConfirmed: true })).rejects.toMatchObject({ status: 502 });
    await expect(svc.register("admin", "coach", source, consent)).rejects.toMatchObject({ status: 409 });
    const persisted = JSON.parse([...rows.values()][0].value);
    await expect(svc.reset("admin", "coach", source, { confirmed: true, draft: persisted.draft }))
      .rejects.toMatchObject({ code: "persona_seed_reset_blocked" });
    expect(d.client.call.mock.calls.filter((c: any[]) => c[1] === "/avatar-assets")).toHaveLength(2);
  });
  it("saves pending/failed selections as drafts and trusts only the fresh verified reference", async () => {
    const { draft } = await svc.register("admin", "coach", source, consent);
    options.candidates = [candidate(false)]; options.canProvision = false;
    const input = { liveAvatarSeed: draft, liveAvatar: { kind: "custom", assetId, providerId: "tavus", validationStatus: "live_verified" } };
    let result: any = await svc.normalize("admin", input, persona);
    expect(result.liveAvatar).toMatchObject({ validationStatus: "unverified", activation: "draft", seedImageAssetId: imageId });
    options.candidates[0] = { ...candidate(false), status: "failed", nextAction: "inspect_failure" };
    result = await svc.normalize("admin", input, persona);
    expect(result.liveAvatar.validationStatus).toBe("unverified");
    options.candidates[0] = candidate(true);
    expect((await svc.normalize("admin", input, persona)).liveAvatar).toMatchObject({ validationStatus: "live_verified" });
    options.imageVersion = 2;
    await expect(svc.normalize("admin", input, persona)).rejects.toMatchObject({ code: "persona_seed_response_mismatch" });
  });
  it("rejects other-seed candidates, forged draft IDs, and clears old seed binding on replacement", async () => {
    const { draft } = await svc.register("admin", "coach", source, consent);
    await expect(svc.normalize("admin", { liveAvatarSeed: { ...draft, projectId: "forged" } }, persona)).rejects.toMatchObject({ status: 409 });
    await expect(svc.normalize("admin", { liveAvatarSeed: draft, liveAvatar: { assetId } }, persona)).rejects.toMatchObject({ code: "persona_seed_candidate_mismatch" });
    const saved = { ...persona, liveAvatarSeed: draft, liveAvatar: { assetId } };
    expect(await svc.normalize("admin", { images: { base: "personas/coach/v2.webp" } }, saved)).toEqual({ liveAvatarSeed: null, liveAvatar: null });
  });
  it("exposes persisted safe failure evidence through the state response", async () => {
    await svc.register("admin", "coach", source, consent);
    options.candidates = [{ ...candidate(false), status: "failed", nextAction: "replace_image", failure: {
      code: "PROVIDER_TRAINING_FAILED", stage: "status", category: "input", providerHttpStatus: 200,
      providerErrorCode: "training_image_framing_invalid", reasonState: "safe_code",
      message: "Crop at navel", messageKo: "배꼽 위로 자르고 팔을 낮추세요.", automaticRetryAllowed: false,
      nextAction: "replace_image", creationOutcome: "created",
    } }];
    const state = await svc.status("admin", "coach", source);
    expect(state.options?.candidates[0].failure?.providerErrorCode).toBe("training_image_framing_invalid");
  });
  it("allows one explicit create after reset and deduplicated registration returns the same failed image", async () => {
    const first = await svc.register("admin", "coach", source, consent);
    await svc.create("admin", "coach", source, { costConfirmed: true });
    options.candidates = [localFailure()]; options.canProvision = true;
    // Submitted operations also delegate manual requests to the router.
    await svc.reset("admin", "coach", source, { confirmed: true, draft: first.draft });
    const registered = await svc.register("admin", "coach", source, consent);
    expect(registered.draft).toEqual(first.draft);
    expect(registered.options?.candidates[0].failure?.trainingImageStage).toBe("unknown");
    await expect(svc.create("admin", "coach", source, { costConfirmed: false }))
      .rejects.toMatchObject({ code: "persona_seed_cost_confirmation_required" });
    await svc.create("admin", "coach", source, { costConfirmed: true });
    expect(d.client.call.mock.calls.filter((c: any[]) => c[1] === "/avatar-assets")).toHaveLength(2);
  });
  it("keeps an ambiguous retry fenced despite retained failures, a new candidate and a service restart", async () => {
    await svc.register("admin", "coach", source, consent);
    options.candidates = [localFailure()]; options.canProvision = true;
    const original = d.client.call.getMockImplementation();
    d.client.call.mockImplementation(async (user: string, path: string, schema: any, body: any) => {
      if (path === "/avatar-assets") throw new AvatarIdentityError("avatar_test_operation_uncertain", 502);
      return original(user, path, schema, body);
    });
    await expect(svc.create("admin", "coach", source, { costConfirmed: true })).rejects.toMatchObject({ status: 502 });
    svc = new PersonaSeedLiveService(d);
    expect(await svc.status("admin", "coach", source)).toMatchObject({ stage: "creating", uncertain: true });
    options.candidates.push({ ...localFailure(), avatarAssetId: "42345678-1234-4234-8234-123456789abc" });
    await expect(svc.create("admin", "coach", source, { costConfirmed: true }))
      .rejects.toMatchObject({ code: "avatar_test_operation_uncertain" });
    const current = await svc.status("admin", "coach", source);
    expect(current.uncertain).toBe(true);
    await expect(svc.reset("admin", "coach", source, { confirmed: true, draft: current.draft }))
      .rejects.toMatchObject({ code: "persona_seed_reset_blocked" });
    await expect(svc.register("admin", "coach", source, consent))
      .rejects.toMatchObject({ code: "persona_seed_operation_uncertain" });
    expect(d.client.call.mock.calls.filter((c: any[]) => c[1] === "/avatar-assets")).toHaveLength(2);
  });
  it.each(["queued", "submitting", "processing", "ready", "reconciliation_required", "deleting", "deleted"])(
    "forwards explicit creation regardless of %s candidates", async status => {
      await svc.register("admin", "coach", source, consent);
      options.candidates = [{ ...localFailure(), status }]; options.canProvision = true;
      options.canProvision = false;
      await svc.create("admin", "coach", source, { costConfirmed: true });
      expect(d.client.call.mock.calls.filter((c: any[]) => c[1] === "/avatar-assets")).toHaveLength(1);
    },
  );
  it.each(["created", "unknown"])("delegates a failed candidate with %s outcome to the router", async creationOutcome => {
    await svc.register("admin", "coach", source, consent);
    const failure = localFailure();
    failure.failure.creationOutcome = creationOutcome;
    options.candidates = [failure]; options.canProvision = true;
    await svc.create("admin", "coach", source, { costConfirmed: true });
    expect(d.client.call.mock.calls.filter((c: any[]) => c[1] === "/avatar-assets")).toHaveLength(1);
  });
  it("does not preflight live-options or require advertised capabilities before forwarding", async () => {
    await svc.register("admin", "coach", source, consent);
    d.connection.check.mockResolvedValue({ projectId: project, scopes: ["assets:read", "assets:write"], integration: {} });
    const original = d.client.call.getMockImplementation();
    d.client.call.mockClear();
    d.client.call.mockImplementation(async (user: string, path: string, schema: any, body: any) => {
      if (path.endsWith("/live-options")) throw new Error("read_unavailable");
      return original(user, path, schema, body);
    });
    expect(await svc.create("admin", "coach", source, { costConfirmed: true })).toMatchObject({ stage: "submitted" });
    expect(d.client.call.mock.calls.map((c: any[]) => c[1])).toEqual(["/avatar-assets"]);
  });
  it("resets a completed submission without deleting assets and creates a new image version before resubmission", async () => {
    const first = await svc.register("admin", "coach", source, consent);
    await svc.create("admin", "coach", source, { costConfirmed: true });
    options.candidates = [candidate()]; options.canProvision = false;
    const writesBefore = d.client.call.mock.calls.filter((c: any[]) => c[3]).length;
    expect(await svc.reset("admin", "coach", source, { confirmed: true, draft: first.draft }))
      .toMatchObject({ stage: "idle", draft: null, options: null, uncertain: false });
    expect(d.client.call.mock.calls.filter((c: any[]) => c[3])).toHaveLength(writesBefore);
    svc = new PersonaSeedLiveService(d);
    expect(await svc.status("admin", "coach", source)).toMatchObject({ stage: "idle", draft: null });
    await expect(svc.create("admin", "coach", source, { costConfirmed: true }))
      .rejects.toMatchObject({ code: "persona_seed_register_first" });
    const nextImageId = "32345678-1234-4234-8234-123456789abc";
    const original = d.client.call.getMockImplementation();
    d.client.call.mockImplementation(async (user: string, path: string, schema: any, body: any) => {
      if (path === "/assets/images") {
        expect(body.previousVersionId).toBe(imageId);
        options = { ...options, imageAssetId: nextImageId, imageVersion: 2, canProvision: true, candidates: [] };
        return schema.parse({ id: nextImageId, version: 2, contentHash });
      }
      if (path === "/avatar-assets") return schema.parse({
        id: assetId, imageAssetId: nextImageId, providerId: "tavus", providerAvatarId: null, name: "coach", status: "queued",
        capabilities: { reusable: false, liveRendering: false, validation: "documentation_only" },
      });
      return original(user, path, schema, body);
    });
    const second = await svc.register("admin", "coach", source, consent);
    expect(second.draft?.imageVersion).toBe(2);
    await expect(svc.reset("admin", "coach", source, { confirmed: true, draft: first.draft }))
      .rejects.toMatchObject({ code: "persona_seed_reset_stale" });
    await svc.create("admin", "coach", source, { costConfirmed: true });
    expect(d.client.call.mock.calls.filter((c: any[]) => c[1] === "/avatar-assets")).toHaveLength(2);
  });
  it.each(["queued", "submitting", "processing", "reconciliation_required", "deleting"])(
    "does not reset a %s candidate or release its fence", async status => {
      const first = await svc.register("admin", "coach", source, consent);
      await svc.create("admin", "coach", source, { costConfirmed: true });
      options.candidates = [{ ...candidate(), status }]; options.canProvision = false;
      const before = JSON.stringify([...rows.values()]);
      await expect(svc.reset("admin", "coach", source, { confirmed: true, draft: first.draft }))
        .rejects.toMatchObject({ code: "persona_seed_reset_blocked" });
      expect(JSON.stringify([...rows.values()])).toBe(before);
    },
  );
  it("requires confirmation and blocks a submitted request with no reconciled candidate", async () => {
    const first = await svc.register("admin", "coach", source, consent);
    await expect(svc.reset("admin", "coach", source, { confirmed: false, draft: first.draft }))
      .rejects.toMatchObject({ status: 400 });
    await svc.create("admin", "coach", source, { costConfirmed: true });
    await expect(svc.reset("admin", "coach", source, { confirmed: true, draft: first.draft }))
      .rejects.toMatchObject({ code: "persona_seed_reset_blocked" });
  });
  it("permits a failed training candidate to reset but not an unknown creation outcome", async () => {
    const first = await svc.register("admin", "coach", source, consent);
    await svc.create("admin", "coach", source, { costConfirmed: true });
    options.candidates = [{ ...candidate(), status: "failed", nextAction: "replace_image", failure: {
      code: "PROVIDER_TRAINING_FAILED", stage: "create", category: "unknown", providerHttpStatus: null,
      providerErrorCode: null, reasonState: "unknown", message: "Unknown", messageKo: "결과 불명",
      automaticRetryAllowed: false, nextAction: "operator_reconcile", creationOutcome: "unknown",
    } }];
    await expect(svc.reset("admin", "coach", source, { confirmed: true, draft: first.draft }))
      .rejects.toMatchObject({ code: "persona_seed_reset_blocked" });
    options.candidates[0].failure.creationOutcome = "created";
    await expect(svc.reset("admin", "coach", source, { confirmed: true, draft: first.draft }))
      .rejects.toMatchObject({ code: "persona_seed_reset_blocked" });
    options.candidates[0].failure.nextAction = "replace_image";
    expect((await svc.reset("admin", "coach", source, { confirmed: true, draft: first.draft })).stage).toBe("idle");
  });
  it("enforces existing login/admin roles before any seed service operation", async () => {
    const fake = { status: vi.fn(async () => ({})), register: vi.fn(), create: vi.fn(), reset: vi.fn(async () => ({})),
      image: vi.fn(async () => ({ bytes: Buffer.from([137, 80, 78, 71]), contentType: "image/png" })) };
    const app = (role?: string) => {
      const a = express(); a.use(express.json());
      a.use((req: any, res, next) => { if (!role) return res.sendStatus(401); req.user = { id: "owner", role }; next(); });
      a.use("/api/admin/personas/live-avatar", isOperatorOrAdmin, createPersonaAvatarOperationsRouter(undefined, undefined, fake as any));
      return a;
    };
    const path = "/api/admin/personas/live-avatar/personas/coach/seed?source=personas%2Fcoach%2Fbase-v1.webp";
    expect((await request(app()).get(path)).status).toBe(401);
    expect((await request(app("user")).get(path)).status).toBe(403);
    const imagePath = `${path.replace("/seed?", "/seed/image?")}&imageAssetId=${imageId}&imageVersion=1`;
    expect((await request(app()).get(imagePath)).status).toBe(401);
    expect((await request(app("user")).get(imagePath)).status).toBe(403);
    expect(fake.image).not.toHaveBeenCalled();
    const imageResponse = await request(app("operator")).get(imagePath);
    expect(imageResponse.status).toBe(200);
    expect(imageResponse.headers["content-type"]).toContain("image/png");
    expect(imageResponse.headers["cache-control"]).toBe("private, no-store");
    expect(imageResponse.headers["x-content-type-options"]).toBe("nosniff");
    expect(fake.image).toHaveBeenCalledWith("owner", "coach", source, { imageAssetId: imageId, imageVersion: 1 });
    expect((await request(app()).post(path.replace("/seed?", "/seed/reset?")).send({})).status).toBe(401);
    expect((await request(app("user")).post(path.replace("/seed?", "/seed/reset?")).send({})).status).toBe(403);
    expect(fake.reset).not.toHaveBeenCalled();
    expect(fake.status).not.toHaveBeenCalled();
    expect((await request(app("operator")).get(path)).headers["cache-control"]).toBe("no-store");
    expect(fake.status).toHaveBeenCalledWith("owner", "coach", source);
    expect((await request(app("operator")).post(path.replace("/seed?", "/seed/reset?")).send({ confirmed: true })).status).toBe(200);
    expect(fake.reset).toHaveBeenCalledWith("owner", "coach", source, { confirmed: true });
  });
  it("reads the registered router image, not the current local base file, and rejects stale or other-scope versions", async () => {
    await svc.register("admin", "coach", source, consent);
    d.readImage.mockClear(); d.client.call.mockClear(); d.store.upsertSystemSetting.mockClear();
    const image = await svc.image("admin", "coach", source, { imageAssetId: imageId, imageVersion: 1 });
    expect(image.contentType).toBe("image/png");
    expect(d.client.image).toHaveBeenCalledExactlyOnceWith("admin", imageId);
    expect(d.client.call).not.toHaveBeenCalled();
    expect(d.readImage).not.toHaveBeenCalled();
    expect(d.store.upsertSystemSetting).not.toHaveBeenCalled();
    await expect(svc.image("admin", "coach", source, { imageAssetId: imageId, imageVersion: 2 }))
      .rejects.toMatchObject({ code: "persona_seed_image_stale" });
    await expect(svc.image("admin", "coach", source, { imageAssetId: assetId, imageVersion: 1 }))
      .rejects.toMatchObject({ code: "persona_seed_image_stale" });
    await expect(svc.image("admin", "coach", source, { imageAssetId: "../other", imageVersion: 1 }))
      .rejects.toMatchObject({ status: 400 });
    tenant = "other-tenant";
    await expect(svc.image("admin", "coach", source, { imageAssetId: imageId, imageVersion: 1 }))
      .rejects.toMatchObject({ code: "persona_seed_image_stale" });
    expect(d.client.image).toHaveBeenCalledTimes(1);
  });
});
