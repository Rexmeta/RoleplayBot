import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
vi.mock("../../server/storage", () => ({ storage: {} }));
import { PersonaAvatarCatalog } from "../../server/services/liveAvatar/personaCatalog";
import { AvatarProjectClient } from "../../server/services/liveAvatar/projectClient";
import { personaLiveAvatarSchema } from "../../shared/avatar/personaAvatar";

const id = "12345678-1234-4234-8234-123456789abc";
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
  call = vi.fn(async (_user, path, schema) => schema.parse(path === "/avatar-assets" ? [asset()] : asset()));
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
});

describe("project client catalog transport boundary", () => {
  const identity = { getUser: async () => ({ id: "admin", isActive: true }), getOrganization: vi.fn(), getCompany: vi.fn() };
  it("allows only catalog GETs and does not leak extra asset fields", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify([{ id, extra: "hidden" }]), { headers: { "content-type": "application/json" } }));
    const client = new AvatarProjectClient(identity, request as any, () => ({
      baseUrl: "https://avatar-router.replit.app/api/v1", apiKey: "ar_sk_test_key_not_real_123456",
    }));
    expect(await client.call("admin", "/avatar-assets", z.array(z.object({ id: z.string() })))).toEqual([{ id }]);
    expect(request.mock.calls[0][1]).toMatchObject({ method: "GET", redirect: "error", credentials: "omit" });
    for (const path of ["/avatar-assets", `/avatar-assets/${id}`, "/assets/images"]) {
      await expect(client.call("admin", path, z.unknown(), {})).rejects.toMatchObject({ code: "avatar_test_path_invalid" });
    }
    expect(request).toHaveBeenCalledTimes(1);
  });
});
