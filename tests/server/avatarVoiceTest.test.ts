import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AvatarVoiceTest } from "../../server/services/liveAvatar/voiceTest";
import { createAvatarVoiceTestRouter } from "../../server/routes/avatarVoiceTest";
import { AvatarProjectClient } from "../../server/services/liveAvatar/projectClient";
import { AvatarIdentityError } from "../../server/services/liveAvatar/delegatedIdentity";

vi.mock("../../server/storage", () => ({ storage: {} }));
const stock = "tavus-stock-lucy";
const anam = "anam-persona-default";
const asset = "12345678-1234-4234-8234-123456789abc";
const features = ["provider_voice_catalog_v1", "unified_client_connection", "hosted_browser_client",
  "unified_roleplay_context", "tavus_full_pipeline", "anam_full_pipeline"];
const voice = (id: string, providerId = "tavus", available = true) => ({
  id, providerId, available, name: id, description: "", gender: "female", genderSource: "provider", languages: [],
});
const catalog = {
  providers: ["tavus", "anam"].map(providerId => ({ providerId, status: "available", errorCode: null })),
  voices: [voice("tavus-voice-1"), voice("anam-voice-1", "anam"), voice("tavus-unavailable", "tavus", false)],
};
const remoteFor = (body: any) => ({
  id: "router-session", providerId: body.providerId, avatarId: body.avatarId, pipeline: body.pipeline,
  mode: "live", avatarAssetId: body.avatarAssetId ?? null, purpose: body.purpose ?? "conversation",
  status: "active", rendererState: "running", stopRequested: false, cleanupPending: false, expiresAt: "2099-01-01T00:00:00Z",
});
const call = vi.fn();
const voiceCatalogPage = vi.fn();
const check = vi.fn();
const resolve = vi.fn();
let api: ReturnType<typeof request>;
let remote: ReturnType<typeof remoteFor>;

beforeEach(() => {
  const records = new Map<string, { value: string }>();
  check.mockReset().mockResolvedValue({ projectId: "project-a", integration: { features } });
  resolve.mockReset().mockResolvedValue({ providerAvatarId: "custom-face" });
  voiceCatalogPage.mockReset().mockResolvedValue({ ...catalog, nextOffset: 100 });
  remote = remoteFor({ providerId: "tavus", avatarId: stock, pipeline: "tavus_full" });
  call.mockReset().mockImplementation(async (_user, path, schema, body) => {
    if (path === "/sessions" && body) remote = remoteFor(body);
    const result = path.endsWith("/end") ? { ...remote, status: "ended", rendererState: "closed" } : remote;
    return schema.parse(result);
  });
  const service = new AvatarVoiceTest({ call, voiceCatalogPage } as any, { check } as any, {
    getSystemSetting: vi.fn(async (_category, key) => records.get(key)) as any,
    upsertSystemSetting: vi.fn(async record => { records.set(record.key, { value: record.value }); }) as any,
  }, { resolve });
  const app = express();
  app.use(express.json(), (req: any, _res, next) => {
    req.user = { id: req.get("x-test-user") ?? "admin-a", role: req.get("x-test-role") ?? "admin" };
    next();
  });
  app.use("/test", createAvatarVoiceTestRouter(service));
  api = request(app);
});

describe("admin AvatarRouter voice diagnostic", () => {
  it("returns only selectable voices for the target provider and keeps router pagination", async () => {
    const result = await api.get(`/test/${stock}/voices?offset=100`);
    expect(result.body).toMatchObject({ providerId: "tavus", status: "available", nextOffset: 100,
      voices: [{ id: "tavus-voice-1" }] });
    expect(result.body.voices).toHaveLength(1);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(voiceCatalogPage).toHaveBeenCalledWith("admin-a", 100);
    expect(call).not.toHaveBeenCalled();
    expect((await api.get(`/test/${stock}/voices?offset=5001`)).status).toBe(400);
    expect((await api.get(`/test/${stock}/voices`).set("x-test-role", "operator")).status).toBe(403);
  });

  it.each([
    [stock, "tavus", stock, "tavus-voice-1", "female"],
    [anam, "anam", anam, "anam-voice-1", "female"],
    [asset, "tavus", "custom-face", "unclassified-id", undefined],
  ])("passes the chosen voice to the %s native session without changing the persona", async (target, providerId, avatarId, voiceId, gender) => {
    const result = await api.post(`/test/${target}/sessions`).send({ voice: { voiceId, ...(gender ? { gender } : {}) } });
    expect(result.status).toBe(201);
    const payload = call.mock.calls[0][3];
    expect(payload).toMatchObject({ providerId, avatarId, pipeline: `${providerId}_full`,
      fullPipeline: { voiceId, languages: ["ko"] }, ...(target === asset ? { avatarAssetId: asset, purpose: "validation" } : {}) });
    expect(payload.fullPipeline.voiceGender).toBe(gender);
    expect(result.body.requestedVoice).toMatchObject({ voiceId });
    expect(resolve.mock.calls.length).toBe(target === asset ? 1 : 0);
  });

  it("does not silently replace a rejected selection, start on read, or accept client-supplied session settings", async () => {
    expect((await api.get(`/test/${stock}/session`)).body).toBeNull();
    expect((await api.post(`/test/${stock}/sessions`).send({ voice: { voiceId: "one" }, avatarId: anam })).status).toBe(400);
    expect((await api.post(`/test/${stock}/sessions`).set("x-test-role", "user").send({})).status).toBe(403);
    expect(call).not.toHaveBeenCalled();
    check.mockResolvedValueOnce({ projectId: "project-a", integration: { features: features.slice(1) } });
    expect((await api.post(`/test/${stock}/sessions`).send({ voice: { voiceId: "one" } })).status).toBe(409);
    expect(call).not.toHaveBeenCalled();
    call.mockRejectedValueOnce(new AvatarIdentityError("avatar_test_upstream_409", 409, { code: "VOICE_UNAVAILABLE", error: "Voice unavailable" }));
    const rejected = await api.post(`/test/${stock}/sessions`).send({ voice: { voiceId: "voice-no-longer-listed" } });
    expect(rejected.body).toEqual({ code: "VOICE_UNAVAILABLE", error: "Voice unavailable" });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("recovers and ends only the bound test session for the same admin, target, and project", async () => {
    expect((await api.post(`/test/${stock}/sessions`).send({})).status).toBe(201);
    expect(call.mock.calls[0][3].fullPipeline).not.toHaveProperty("voiceId");
    const path = `/test/${stock}/sessions/router-session`;
    const recovered = await api.get(`/test/${stock}/session`);
    expect(recovered.body).toMatchObject({ id: "router-session", requestedVoice: null });
    const before = call.mock.calls.length;
    expect((await api.post(`${path}/end`).set("x-test-user", "admin-b").send({})).status).toBe(404);
    expect((await api.post(`/test/${anam}/sessions/router-session/end`).send({})).status).toBe(404);
    expect((await api.get(`/test/${stock}/sessions/other`)).status).toBe(404);
    check.mockResolvedValueOnce({ projectId: "project-b", integration: { features } });
    expect((await api.post(`${path}/end`).send({})).status).toBe(404);
    expect(call).toHaveBeenCalledTimes(before);
    expect((await api.post(`${path}/end`).send({})).body.status).toBe("ended");
    expect(call.mock.calls.at(-1)?.[1]).toBe("/sessions/router-session/end");
  });

  it("follows the official next offset even if the page has fewer entries than requested", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(catalog), {
      headers: { "content-type": "application/json", "X-Voice-Catalog-Next-Offset": "100" },
    }));
    const client = new AvatarProjectClient({
      getUser: vi.fn(async id => ({ id, isActive: true })), getCompany: vi.fn(), getOrganization: vi.fn(),
    }, fetcher as typeof fetch, () => ({
      baseUrl: "https://avatar.example.test/api/v1", apiKey: "ar_sk_example_voice_route_test_key",
    }));
    expect((await client.voiceCatalogPage("admin", 0)).nextOffset).toBe(100);
    expect(fetcher).toHaveBeenCalledWith("https://avatar.example.test/api/v1/voices?offset=0&limit=100",
      expect.objectContaining({ method: "GET" }));
    await expect(client.voiceCatalogPage("admin", 100)).rejects.toMatchObject({ code: "avatar_voice_catalog_invalid" });
  });
});
