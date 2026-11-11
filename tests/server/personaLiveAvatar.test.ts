import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
vi.mock("../../server/storage", () => ({ storage: {} }));
import { PersonaAvatarCatalog } from "../../server/services/liveAvatar/personaCatalog";
import { AvatarProjectClient } from "../../server/services/liveAvatar/projectClient";
import { personaLiveAvatarSchema } from "../../shared/avatar/personaAvatar";

const id = "12345678-1234-4234-8234-123456789abc";
const stock = (patch: any = {}) => ({
  id: "tavus-stock-lucy", providerId: "tavus", name: "Lucy - Home",
  description: "Stock", kind: "configured", configured: true, languages: ["en"], ...patch,
});
const asset = (patch: any = {}) => ({
  id, name: "테스트 아바타", providerId: "tavus", providerAvatarId: "provider-face",
  status: "ready", capabilities: { reusable: true, liveRendering: true, validation: "provisioned" }, ...patch,
});
const draft = (patch: any = {}) => ({
  assetId: id, providerId: "tavus", voiceMode: "roleplayx",
  activation: "draft", validationStatus: "live_verified", ...patch,
});
let call: ReturnType<typeof vi.fn>;
let check: ReturnType<typeof vi.fn>;
let catalog: PersonaAvatarCatalog;
beforeEach(() => {
  call = vi.fn(async (_user, path, schema) => schema.parse(path === "/avatars" ? [stock()] : path === "/avatar-assets" ? [asset()] : asset()));
  check = vi.fn(async () => ({ projectId: "project-one", scopes: ["assets:read"] }));
  catalog = new PersonaAvatarCatalog({ call } as any, { check } as any);
});

describe("persona project catalog and inactive drafts", () => {
  it("only performs reads and separates provisioning from live validation", async () => {
    const list = await catalog.list("operator");
    expect(list).toMatchObject({
      projectId: "project-one", runtimeAvailable: false,
      assets: [{ id, status: "ready", liveValidated: false }],
    });
    expect(call.mock.calls[0].slice(0, 2)).toEqual(["operator", "/avatar-assets"]);
    expect(call.mock.calls[0]).toHaveLength(3);
  });

  it("requires assets:read before reading catalog or accepting references", async () => {
    check.mockResolvedValue({ projectId: "project-one", scopes: ["sessions:read"] });
    await expect(catalog.list("operator")).rejects.toMatchObject({ code: "avatar_assets_read_scope_missing", status: 403 });
    await expect(catalog.normalize("operator", { liveAvatar: draft() })).rejects.toMatchObject({ status: 403 });
    expect(call).not.toHaveBeenCalled();
  });

  it("resolves owner-bound assets and overwrites fabricated validation with server evidence", async () => {
    const result = await catalog.normalize("operator", { avatarMode: "live", liveAvatar: draft() });
    expect(result).toEqual({ avatarMode: "live", liveAvatar: draft({
      validationStatus: "unverified", projectId: "project-one",
    }) });
    expect(call.mock.calls[0].slice(0, 2)).toEqual(["operator", `/avatar-assets/${id}`]);
    expect(call.mock.calls[0]).toHaveLength(3);
  });

  it("keeps even live-verified assets draft-only", async () => {
    call.mockImplementation(async (_user, _path, schema) => schema.parse(asset({
      capabilities: { reusable: true, liveRendering: true, validation: "live_verified" },
    })));
    expect(await catalog.normalize("admin", { liveAvatar: draft() })).toMatchObject({
      liveAvatar: { validationStatus: "live_verified", activation: "draft" },
    });
    await expect(catalog.normalize("admin", { liveAvatar: draft({ activation: "active" }) }))
      .rejects.toMatchObject({ status: 400 });
  });

  it.each(["processing", "failed", "deleted", "reconciliation_required"])("rejects selecting %s assets", async status => {
    call.mockImplementation(async (_user, _path, schema) => schema.parse(asset({ status })));
    await expect(catalog.normalize("operator", { liveAvatar: draft() })).rejects.toMatchObject({
      code: "persona_avatar_asset_not_ready", status: 409,
    });
  });

  it("rejects provider/ID/project mismatches, non-reusable assets and invalid reference fields", async () => {
    await expect(catalog.normalize("operator", { liveAvatar: draft({ providerId: "anam" }) }))
      .rejects.toMatchObject({ code: "persona_avatar_asset_mismatch" });
    await expect(catalog.normalize("operator", { liveAvatar: draft({ projectId: "another-project" }) }))
      .rejects.toMatchObject({ code: "persona_avatar_project_mismatch" });
    call.mockImplementation(async (_user, _path, schema) => schema.parse(asset({ id: "22345678-1234-4234-8234-123456789abc" })));
    await expect(catalog.normalize("operator", { liveAvatar: draft() })).rejects.toMatchObject({ code: "persona_avatar_asset_mismatch" });
    call.mockImplementation(async (_user, _path, schema) => schema.parse(asset({ providerAvatarId: null })));
    await expect(catalog.normalize("operator", { liveAvatar: draft() })).rejects.toMatchObject({ code: "persona_avatar_asset_not_ready" });
    await expect(catalog.normalize("operator", { liveAvatar: draft({ assetId: "../sessions" }) })).rejects.toMatchObject({ status: 400 });
    await expect(catalog.normalize("operator", { liveAvatar: draft({ url: "https://evil.test" }) })).rejects.toMatchObject({ status: 400 });
  });

  it("leaves live fallback media untouched and synchronizes explicit image/video modes without dropping clips", async () => {
    const videos = { enabled: true, clips: { male: { listening_neutral: "clip.mp4" } } };
    expect(await catalog.normalize("admin", { avatarMode: "live" }, { videos })).toEqual({ avatarMode: "live" });
    expect(await catalog.normalize("admin", { avatarMode: "image" }, { videos })).toEqual({
      avatarMode: "image", videos: { ...videos, enabled: false },
    });
    expect(await catalog.normalize("admin", { avatarMode: "video" }, { videos: { ...videos, enabled: false } }))
      .toEqual({ avatarMode: "video", videos });
    expect(check).not.toHaveBeenCalled();
  });

  it("preserves an unchanged server draft during unrelated offline edits and allows unlink", async () => {
    const saved = draft({ projectId: "project-one", validationStatus: "unverified" });
    expect(await catalog.normalize("admin", { mbti: "NEW" }, { liveAvatar: saved })).toEqual({});
    expect(await catalog.normalize("admin", { avatarMode: null, liveAvatar: null })).toEqual({ avatarMode: null, liveAvatar: null });
    expect(await catalog.normalize("admin", { liveAvatar: saved }, { liveAvatar: saved })).toEqual({ liveAvatar: saved });
    expect(await catalog.normalize("admin", { liveAvatar: null }, { liveAvatar: saved })).toEqual({ liveAvatar: null });
    expect(check).not.toHaveBeenCalled();
    await expect(catalog.normalize("admin", { avatarMode: "arbitrary" })).rejects.toMatchObject({ status: 400 });
  });

  it("never converts malformed catalog responses into an empty successful list", async () => {
    call.mockImplementation(async (_user, _path, schema) => schema.parse({ items: [asset()] }));
    await expect(catalog.list("operator")).rejects.toThrow();
  });

  it("keeps stock and custom catalogs separate and resolves stock using reads only", async () => {
    const list = await catalog.list("operator");
    expect(list.stockAvatars).toEqual([stock()]);
    expect(call.mock.calls.map(args => args[1])).toEqual(["/avatar-assets", "/avatars"]);
    call.mockClear();
    const stockDraft = { kind: "stock", avatarId: "tavus-stock-lucy", providerId: "tavus",
      voiceMode: "roleplayx", activation: "draft", validationStatus: "live_verified" };
    const normalized = await catalog.normalize("operator", { liveAvatar: stockDraft });
    expect(normalized.liveAvatar).toEqual({ ...stockDraft, projectId: "project-one", validationStatus: "unverified" });
    expect(normalized.liveAvatar).not.toHaveProperty("assetId");
    expect(call.mock.calls.map(args => args.slice(0, 2))).toEqual([["operator", "/avatars"]]);
    expect(call.mock.calls[0]).toHaveLength(3);
    expect(check).toHaveBeenCalledWith("operator");
  });

  it.each([
    { configured: false }, { id: "mock-orbit", providerId: "mock", kind: "mock" },
    { id: "tavus-configured" }, { providerId: "anam" },
  ])("rejects unavailable, unsupported or mismatched stock catalog rows: %j", async patch => {
    call.mockImplementation(async (_user, _path, schema) => schema.parse([stock(patch)]));
    await expect(catalog.normalize("operator", { liveAvatar: {
      kind: "stock", avatarId: "tavus-stock-lucy", providerId: "tavus",
      voiceMode: "roleplayx", activation: "draft", validationStatus: "unverified",
    } })).rejects.toMatchObject({ code: "persona_stock_avatar_unavailable", status: 409 });
  });

  it("preserves legacy UUID drafts and accepts explicit custom references without stock lookup", async () => {
    expect(personaLiveAvatarSchema.parse(draft())).toEqual(draft());
    expect(await catalog.normalize("operator", { liveAvatar: draft({ kind: "custom" }) })).toMatchObject({
      liveAvatar: { kind: "custom", assetId: id, activation: "draft", validationStatus: "unverified" },
    });
    expect(call.mock.calls.map(args => args[1])).toEqual([`/avatar-assets/${id}`]);
  });

  it("rejects mixed namespaces, traversal and stock project mismatches before catalog access", async () => {
    const stockDraft = { kind: "stock", avatarId: "tavus-stock-lucy", providerId: "tavus",
      voiceMode: "roleplayx", activation: "draft", validationStatus: "unverified" };
    for (const value of [
      { ...stockDraft, assetId: id }, { ...stockDraft, avatarId: "../sessions" },
      { ...stockDraft, kind: "custom" }, { ...stockDraft, activation: "active" },
      draft({ assetId: "tavus-stock-lucy" }),
    ]) {
      await expect(catalog.normalize("operator", { liveAvatar: value })).rejects.toMatchObject({ status: 400 });
    }
    await expect(catalog.normalize("operator", { liveAvatar: { ...stockDraft, projectId: "other" } }))
      .rejects.toMatchObject({ code: "persona_avatar_project_mismatch", status: 409 });
    expect(call).not.toHaveBeenCalled();
  });
});

describe("project client catalog transport boundary", () => {
  const identity = { getUser: async () => ({ id: "admin", isActive: true }), getOrganization: vi.fn(), getCompany: vi.fn() };
  it("allows catalog reads, rejects arbitrary asset mutations and strips extra fields", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify([{ id, extra: "hidden" }]), { headers: { "content-type": "application/json" } }));
    const client = new AvatarProjectClient(identity, request as any, () => ({
      baseUrl: "https://avatar-router.replit.app/api/v1", apiKey: "ar_sk_test_key_not_real_123456",
    }));
    expect(await client.call("admin", "/avatar-assets", z.array(z.object({ id: z.string() })))).toEqual([{ id }]);
    expect(request.mock.calls[0][1]).toMatchObject({ method: "GET", redirect: "error", credentials: "omit" });
    for (const path of [`/avatar-assets/${id}`, `/assets/images/${id}`, "/developer/keys", "/avatar-assets/../sessions"]) {
      await expect(client.call("admin", path, z.unknown(), {})).rejects.toMatchObject({ code: "avatar_test_path_invalid" });
    }
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("permits only read-only stock catalog access with the existing project/user identity headers", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify([stock()]), { headers: { "content-type": "application/json" } }));
    const client = new AvatarProjectClient(identity, request as any, () => ({
      baseUrl: "https://avatar-router.replit.app/api/v1", apiKey: "ar_sk_test_key_not_real_123456",
    }));
    await client.call("admin", "/avatars", z.array(z.object({ id: z.string() })));
    expect(request.mock.calls[0][0]).toBe("https://avatar-router.replit.app/api/v1/avatars");
    expect(request.mock.calls[0][1]).toMatchObject({ method: "GET", headers: { "X-Avatar-User-ID": expect.any(String) } });
    for (const path of ["/avatars", "/avatars/tavus-stock-lucy", "/avatars/../sessions"]) {
      await expect(client.call("admin", path, z.unknown(), {})).rejects.toMatchObject({ code: "avatar_test_path_invalid" });
    }
    expect(request).toHaveBeenCalledTimes(1);
  });
});
