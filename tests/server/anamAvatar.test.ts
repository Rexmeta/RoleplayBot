import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../server/storage", () => ({ storage: {} }));
import { AdminAvatarTestService } from "../../server/services/liveAvatar/adminTestService";
import { anamFeatures, managedClientDescriptor, managedConnectionSchema, nativeScopes } from "../../server/services/liveAvatar/managedClient";
import { isSelectableStockAvatar } from "../../shared/avatar/personaAvatar";

const avatar = { id: "anam-persona-default", providerId: "anam", name: "Anam", description: "saved", kind: "configured" as const, configured: true, languages: [] };
const remote = {
  id: "native-session", providerId: "anam", avatarId: avatar.id, pipeline: "anam_full",
  mode: "live", status: "active", rendererState: "running", stopRequested: false,
  cleanupPending: false, expiresAt: "2099-01-01T00:00:00Z",
};
const descriptor = {
  sessionId: remote.id, pipeline: "anam_full", audioOwner: "avatarrouter",
  clientScriptPath: "/sdk/avatarrouter-client.js", expiresAt: remote.expiresAt,
  connection: { transport: "anam", sessionToken: "transient-only" },
};
let service: AdminAvatarTestService, client: any, auth: any, dialogue: any, saved: string | undefined, sessions: any[], configured: boolean;
beforeEach(() => {
  sessions = []; saved = undefined; configured = true;
  auth = { projectId: "project", scopes: [...nativeScopes, "assets:read"], integration: { features: [...anamFeatures] } };
  dialogue = { ready: vi.fn(() => false), reply: vi.fn() };
  client = { call: vi.fn(async (_user, path, schema) => schema.parse(
    path.startsWith("/live-limits") ? {
      workerReady: true, cleanupPending: 0, userRemainingSeconds: 600, globalRemainingSeconds: 3600,
      sessionSeconds: 120, providerCredits: "unknown", resetsAt: remote.expiresAt,
    } : path === "/avatars" ? [{ ...avatar, configured }] :
      path === "/sessions" && client.call.mock.calls.at(-1)[3] === undefined ? sessions :
      path.endsWith("/client-connection") ? descriptor : remote,
  )) };
  service = new AdminAvatarTestService(client, { check: async () => auth } as any, {
    getSystemSetting: async () => saved ? { value: saved } : undefined,
    upsertSystemSetting: async input => { saved = input.value; },
  }, dialogue, undefined, undefined, true);
  vi.stubEnv("AVATAR_ROUTER_BASE_URL", "https://router.example/api/v1");
});
afterEach(() => vi.unstubAllEnvs());
describe("Anam saved persona through the managed AvatarRouter client", () => {
  it("allows configured Anam, not mocks or arbitrary stock providers", () => {
    expect(isSelectableStockAvatar(avatar)).toBe(true);
    expect(isSelectableStockAvatar({ ...avatar, configured: false })).toBe(false);
    expect(isSelectableStockAvatar({ ...avatar, id: "other" })).toBe(false);
    expect(isSelectableStockAvatar({ ...avatar, kind: "mock" })).toBe(false);
  });
  it("uses Anam-specific free limits and never depends on local AI/audio scopes", async () => {
    expect(await service.preflight("user")).toMatchObject({ ready: true, aiReady: true });
    expect(client.call.mock.calls.map(c => c[1])).toContain("/live-limits?providerId=anam");
    expect(client.call.mock.calls.every(c => c[3] === undefined)).toBe(true);
    expect(dialogue.ready).not.toHaveBeenCalled();
  });
  it.each(["feature", "catalog", "scope"])("blocks missing %s before paid creation", async kind => {
    if (kind === "feature") auth.integration.features = [];
    if (kind === "catalog") configured = false;
    if (kind === "scope") auth.scopes = ["live-limits:read", "sessions:read", "assets:read"];
    await expect(service.create("user")).rejects.toMatchObject({ code: "avatar_test_not_ready" });
    expect(client.call.mock.calls.every(c => c[3] === undefined)).toBe(true);
  });
  it("posts Anam diagnostic context through the common API without custom asset claims", async () => {
    await service.create("user");
    expect(client.call).toHaveBeenCalledWith("user", "/sessions", expect.anything(), {
      providerId: "anam", avatarId: avatar.id, pipeline: "anam_full", mode: "live", costConfirmed: true,
      roleplay: {
        persona: "당신은 친절한 한국어 대화 상대입니다. 짧고 명확하게 답하세요.",
        scenario: "관리자가 영상과 음성 연결을 확인하는 짧은 진단입니다. 실제 학습 시나리오나 평가가 아닙니다.",
        language: "Korean",
      },
    });
    expect(JSON.stringify(saved)).not.toContain("sessionToken");
  });
  it("hands off one opaque connection through the pinned hosted script origin", async () => {
    const value = await service.managedConnection("user", remote.id);
    expect(value).toMatchObject({ ...descriptor, clientScriptUrl: "https://router.example/sdk/avatarrouter-client.js" });
    expect(client.call.mock.calls.filter(c => c[1].endsWith("/client-connection"))).toHaveLength(1);
    expect(saved).toBeUndefined();
    await expect(service.connectionToken("user", remote.id)).rejects.toMatchObject({ status: 405 });
    await expect(service.turn("user", remote.id, { text: "hello", history: [] })).rejects.toMatchObject({ code: "anam_owns_dialogue_and_audio" });
    expect(dialogue.reply).not.toHaveBeenCalled();
  });
  it("does not clear a different provider's uncertain paid-create fence", async () => {
    saved = JSON.stringify({ pending: true, baseline: [], target: "tavus:tavus-stock-lucy" });
    sessions = [remote];
    expect(await service.preflight("user")).toMatchObject({ ready: false, creationUncertain: true });
    expect(JSON.parse(saved).pending).toBe(true);
  });
  it("rejects cross-session, expired and script-path substitutions", () => {
    const valid = managedConnectionSchema.parse(descriptor);
    expect(() => managedClientDescriptor(valid, "foreign")).toThrow();
    expect(() => managedClientDescriptor({ ...valid, expiresAt: "2000-01-01T00:00:00Z" }, remote.id)).toThrow();
    expect(managedConnectionSchema.safeParse({ ...descriptor, clientScriptPath: "https://evil.example/sdk.js" }).success).toBe(false);
  });
});
