import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
const fakes = vi.hoisted(() => ({
  list: vi.fn(), normalize: vi.fn(), create: vi.fn(), update: vi.fn(), get: vi.fn(),
}));
vi.mock("../../server/storage", () => ({ storage: {
  getMbtiPersona: fakes.get,
  getSystemSetting: vi.fn(async () => ({ value: "false" })),
} }));
vi.mock("../../server/services/fileManager", () => ({ fileManager: {
  createMBTIPersona: fakes.create, updateMBTIPersona: fakes.update,
} }));
vi.mock("../../server/services/liveAvatar/personaCatalog", () => ({
  personaAvatarCatalog: { list: fakes.list, normalize: fakes.normalize },
}));
vi.mock("../../server/services/gcsStorage", () => ({
  transformPersonasMedia: vi.fn(async p => p), transformPersonaMedia: vi.fn(async p => p),
  safeTransformToSignedUrl: vi.fn(async p => p),
}));
vi.mock("../../server/services/mediaStorage", () => ({ mediaStorage: {} }));
vi.mock("../../server/services/gemini-video-generator", () => ({
  generateAvatarClip: vi.fn(), avatarClipSlot: vi.fn(),
  AVATAR_CLIP_BEHAVIORS: [], AVATAR_CLIP_EMOTIONS: [],
}));
vi.mock("../../server/utils/videoJobStore", () => ({ videoJobStore: {} }));
import createAdminPersonasRouter from "../../server/routes/adminPersonas";
import { AvatarIdentityError } from "../../server/services/liveAvatar/delegatedIdentity";
function app(role?: string) {
  const server = express();
  server.use(express.json());
  server.use(createAdminPersonasRouter((req: any, res: any, next: any) => {
    if (!role) { res.status(401).json({ error: "login required" }); return; }
    req.user = { id: "owner", role }; next();
  }));
  server.use((error: any, _req: any, res: any, _next: any) => res.status(error.status ?? 500).json({ error: error.message }));
  return server;
}
beforeEach(() => {
  vi.clearAllMocks();
  fakes.list.mockResolvedValue({ projectId: "project-one", runtimeAvailable: false, assets: [] });
  fakes.normalize.mockResolvedValue({});
  fakes.create.mockImplementation(async p => p);
  fakes.update.mockImplementation(async (_id, p) => p);
  fakes.get.mockResolvedValue({ id: "persona", videos: { enabled: false }, liveAvatar: null });
});
describe("persona catalog authenticated bridge", () => {
  const path = "/api/admin/personas/live-avatar/assets";
  it("requires login and a content-management role before invoking any upstream reads", async () => {
    expect((await request(app()).get(path)).status).toBe(401);
    expect((await request(app("user")).get(path)).status).toBe(403);
    expect(fakes.list).not.toHaveBeenCalled();
  });
  it.each(["admin", "operator"])("allows %s to explicitly list catalog with no-store", async role => {
    const response = await request(app(role)).get(path).set("X-Avatar-User-ID", "forged-user");
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(fakes.list).toHaveBeenCalledExactlyOnceWith("owner");
  });
  it("returns safe actionable permission errors without a successful empty list", async () => {
    fakes.list.mockRejectedValue(new AvatarIdentityError("avatar_assets_read_scope_missing", 403));
    const response = await request(app("operator")).get(path);
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ code: "avatar_assets_read_scope_missing", error: "avatar_assets_read_scope_missing" });
  });
  it("normalizes both create and edit payloads before persistence", async () => {
    const normalized = { avatarMode: "live", liveAvatar: { assetId: "resolved", activation: "draft", validationStatus: "unverified" } };
    fakes.normalize.mockResolvedValue(normalized);
    const input = { id: "persona", avatarMode: "live", liveAvatar: { assetId: "untrusted", validationStatus: "live_verified" } };
    expect((await request(app("admin")).post("/api/admin/personas").send(input)).status).toBe(200);
    expect(fakes.create).toHaveBeenCalledWith({ ...input, ...normalized });
    expect((await request(app("admin")).put("/api/admin/personas/persona").send(input)).status).toBe(200);
    expect(fakes.update).toHaveBeenCalledWith("persona", { ...input, ...normalized });
    expect(fakes.normalize).toHaveBeenLastCalledWith("owner", input, expect.objectContaining({ id: "persona" }));
  });
  it("prevents saving invalid references and retains existing operator video permission gates", async () => {
    fakes.normalize.mockRejectedValueOnce(new AvatarIdentityError("persona_avatar_asset_not_ready", 409));
    expect((await request(app("admin")).post("/api/admin/personas").send({})).status).toBe(409);
    expect(fakes.create).not.toHaveBeenCalled();
    fakes.normalize.mockResolvedValue({ avatarMode: "video", videos: { enabled: true } });
    expect((await request(app("operator")).put("/api/admin/personas/persona").send({ avatarMode: "video" })).status).toBe(403);
    expect(fakes.update).not.toHaveBeenCalled();
  });
});
