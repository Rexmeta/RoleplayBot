import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/services/fileManager", () => ({ fileManager: {} }));
vi.mock("../../server/services/conversationLedger/transcript", () => ({ ledgerRuntimeBinding: vi.fn() }));
import { resolveConversationAvatar } from "../../server/services/liveAvatar/conversationTarget";
import { ConversationAvatarSessions } from "../../server/services/liveAvatar/conversationSessions";
import { ConversationAvatarAudio } from "../../server/services/liveAvatar/conversationAudio";
import { AvatarIdentityError } from "../../server/services/liveAvatar/delegatedIdentity";
import { testScopes } from "../../server/services/liveAvatar/testContracts";

const assetId = "12345678-1234-4234-8234-123456789abc";
const reference = { kind: "stock", avatarId: "tavus-stock-lucy", providerId: "tavus",
  voiceMode: "roleplayx", activation: "draft", validationStatus: "unverified", projectId: "project" };
const session = (patch: any = {}) => ({ id: "live-session", providerId: "tavus",
  avatarId: "tavus-stock-lucy", mode: "live", status: "active", rendererState: "running",
  stopRequested: false, cleanupPending: false, expiresAt: "2099-01-01T00:00:00Z", ...patch });
const target = { projectId: "project", avatarId: "tavus-stock-lucy", assetId: null, personaId: "actor" };
const auth = { projectId: "project", scopes: [...testScopes, "assets:read", "assets:write"],
  integration: { apiVersion: "0.5.0", features: ["custom_live_validation", "client_playback_report"], customLiveProviders: ["tavus"] } };
let records: Map<string, string>, store: any, client: any, connection: any;
beforeEach(() => {
  records = new Map();
  store = {
    getSystemSetting: vi.fn(async (cat, key) => {
      if (cat === "live_avatar" || cat === "live_avatar_policy") return { value: "true" };
      return records.has(`${cat}:${key}`) ? { value: records.get(`${cat}:${key}`) } : undefined;
    }),
    upsertSystemSetting: vi.fn(async (row) => { records.set(`${row.category}:${row.key}`, row.value); }),
  };
  client = { call: vi.fn(async (_user, path, schema, body) => schema.parse(
    path === "/sessions" && body === undefined ? [] :
    path === "/live-limits" ? { userRemainingSeconds: 600, globalRemainingSeconds: 600,
      sessionSeconds: 120, cleanupPending: 0, workerReady: true, providerCredits: "unknown", resetsAt: "2099-01-01" } :
    path.endsWith("/audio") ? { accepted: true } :
    session()
  )) };
  connection = { check: vi.fn(async () => auth) };
});

describe("selected conversation avatar resolution", () => {
  function fixture() {
    const scenarioRun: any = { scenarioId: "scenario", userId: "owner", status: "active" };
    const personaRun: any = { personaId: "actor", scenarioRunId: "run", status: "active" };
    const actor: any = { id: "actor", personaRef: "ENTJ.json" };
    const profile: any = { avatarMode: "live", liveAvatar: reference };
    const deps: any = {
      storage: { ...store, getPersonaRun: vi.fn(async () => personaRun), getScenarioRun: vi.fn(async () => scenarioRun) },
      fileManager: { getAllScenarios: vi.fn(async () => [{ id: "scenario", personas: [actor] }]),
        getPersonaByMBTI: vi.fn(async () => profile) },
      client: { call: vi.fn(async (_u, _p, schema) => schema.parse([
        { id: "tavus-stock-lucy", providerId: "tavus", name: "Lucy", description: "stock",
          languages: ["ko"], kind: "configured", configured: true },
      ])) },
      connection, ledgerRuntimeBinding: vi.fn(async () => null),
    };
    return { deps, scenarioRun, personaRun, actor, profile };
  }
  it("uses the exact saved persona selection and never creates a session in availability resolution", async () => {
    const { deps } = fixture();
    expect(await resolveConversationAvatar("owner", "conversation", deps)).toEqual(target);
    expect(deps.client.call.mock.calls.map((c: any) => c[1])).toEqual(["/avatars"]);
    expect(store.upsertSystemSetting).not.toHaveBeenCalled();
  });
  it("rejects another owner, completed runs, non-live mode and disabled policy before provider reads", async () => {
    const { deps, scenarioRun, profile } = fixture();
    await expect(resolveConversationAvatar("other", "conversation", deps)).rejects.toMatchObject({ status: 403 });
    scenarioRun.status = "completed";
    await expect(resolveConversationAvatar("owner", "conversation", deps)).rejects.toMatchObject({ code: "avatar_conversation_ended" });
    scenarioRun.status = "active"; profile.avatarMode = "image";
    await expect(resolveConversationAvatar("owner", "conversation", deps)).rejects.toMatchObject({ code: "avatar_persona_not_selected" });
    deps.storage.getSystemSetting.mockResolvedValue({ value: "false" });
    await expect(resolveConversationAvatar("owner", "conversation", deps)).rejects.toMatchObject({ code: "globally_disabled" });
    expect(deps.client.call).not.toHaveBeenCalled();
  });
  it("uses immutable run/ledger persona profiles, never current master settings for snapshot runs", async () => {
    const { deps, scenarioRun } = fixture();
    scenarioRun.scenarioSnapshot = { personas: [{ id: "actor", personaRef: "ENTJ.json",
      _runtimeProfile: { avatarMode: "image", liveAvatar: reference } }] };
    await expect(resolveConversationAvatar("owner", "conversation", deps)).rejects.toMatchObject({ code: "avatar_persona_not_selected" });
    expect(deps.fileManager.getPersonaByMBTI).not.toHaveBeenCalled();
    deps.ledgerRuntimeBinding.mockResolvedValue({ scenarioSnapshot: { personas: [{ id: "actor",
      _runtimeProfile: { avatarMode: "live", liveAvatar: reference } }] } });
    expect(await resolveConversationAvatar("owner", "conversation", deps)).toEqual(target);
    expect(deps.fileManager.getAllScenarios).not.toHaveBeenCalled();
  });
  it("rejects a different external project and missing read scopes without falling back to stock", async () => {
    const { deps, profile } = fixture();
    profile.liveAvatar = { ...reference, projectId: "different" };
    await expect(resolveConversationAvatar("owner", "conversation", deps)).rejects.toMatchObject({ code: "persona_avatar_project_mismatch" });
    connection.check.mockResolvedValue({ ...auth, scopes: testScopes });
    await expect(resolveConversationAvatar("owner", "conversation", deps)).rejects.toMatchObject({ status: 403 });
    expect(deps.client.call).not.toHaveBeenCalled();
  });
  it("requires current custom playback evidence and exact asset identity", async () => {
    const { deps, profile } = fixture();
    profile.liveAvatar = { ...reference, kind: "custom", assetId, avatarId: undefined };
    delete profile.liveAvatar.avatarId;
    const asset: any = { id: assetId, name: "custom", providerId: "tavus", providerAvatarId: "replica",
      status: "ready", capabilities: { reusable: true, liveRendering: true, validation: "provisioned" },
      liveValidation: { status: "unvalidated", runtimeSupported: true, method: null, sessionId: null, validatedAt: null } };
    deps.client.call.mockImplementation(async (_u: string, _p: string, schema: any) => schema.parse(asset));
    await expect(resolveConversationAvatar("owner", "conversation", deps)).rejects.toMatchObject({ code: "persona_avatar_playback_validation_required" });
    asset.liveValidation = { status: "validated", runtimeSupported: true, method: "client_playback_report",
      sessionId: "test-session", validatedAt: "2026-10-30T00:00:00Z" };
    expect(await resolveConversationAvatar("owner", "conversation", deps)).toMatchObject({ avatarId: "replica", assetId });
    asset.status = "deleted";
    await expect(resolveConversationAvatar("owner", "conversation", deps)).rejects.toMatchObject({ status: 409 });
  });
});

describe("owned conversation session lifecycle", () => {
  const createService = () => {
    const d: any = { store, client, connection,
      owned: vi.fn(async (userId) => {
        if (userId !== "owner") throw new AvatarIdentityError("avatar_conversation_forbidden", 403);
        return { scenarioRun: { scenarioId: "scenario" } };
      }),
      resolve: vi.fn(async () => target) };
    return { service: new ConversationAvatarSessions(d), d };
  };
  it("fences a paid write first and returns the same owned session without recreating it", async () => {
    const { service } = createService();
    const original = client.call.getMockImplementation();
    client.call.mockImplementation(async (...args: any[]) => {
      if (args[1] === "/sessions" && args[3]) expect([...records.values()][0]).toContain('"pending":true');
      return original(...args);
    });
    expect(await service.create("owner", "conversation")).toMatchObject({ id: "live-session" });
    expect(await service.create("owner", "conversation")).toMatchObject({ id: "live-session" });
    const writes = client.call.mock.calls.filter((c: any) => c[1] === "/sessions" && c[3]);
    expect(writes).toHaveLength(1);
    expect(writes[0][3]).toEqual({ providerId: "tavus", avatarId: "tavus-stock-lucy", mode: "live", costConfirmed: true });
    expect([...records.values()].join("")).not.toMatch(/pcmBase64|token/);
  });
  it("persists ambiguous creates across restart and recovers by read without a second paid call", async () => {
    let { service, d } = createService();
    const original = client.call.getMockImplementation();
    client.call.mockImplementation(async (...args: any[]) => {
      if (args[1] === "/sessions" && args[3]) throw new Error("unknown response");
      return original(...args);
    });
    await expect(service.create("owner", "conversation")).rejects.toThrow();
    service = new ConversationAvatarSessions(d);
    expect(await service.recover("owner", "conversation")).toEqual({ session: null, creationUncertain: true });
    await expect(service.create("owner", "conversation")).rejects.toMatchObject({ code: "avatar_session_creation_uncertain" });
    client.call.mockImplementation(async (...args: any[]) => {
      if (args[1] === "/sessions" && !args[3]) return args[2].parse([session()]);
      return original(...args);
    });
    expect(await service.recover("owner", "conversation")).toMatchObject({ session: { id: "live-session" }, creationUncertain: false });
    expect(client.call.mock.calls.filter((c: any) => c[1] === "/sessions" && c[3])).toHaveLength(1);
  });
  it("does not adopt another validation asset or session target", async () => {
    const { service } = createService();
    const original = client.call.getMockImplementation();
    client.call.mockImplementation(async (...args: any[]) => {
      if (args[1] === "/sessions" && args[3]) return args[2].parse(session({ avatarId: "other" }));
      return original(...args);
    });
    await expect(service.create("owner", "conversation")).rejects.toMatchObject({ code: "avatar_session_target_mismatch" });
    expect([...records.values()][0]).toContain('"pending":true');
    await expect(service.session("owner", "conversation", "forged-session")).rejects.toMatchObject({ status: 403 });
    await expect(service.session("other", "conversation", "live-session")).rejects.toMatchObject({ status: 403 });
  });
  it("retains recovery and end after policy or asset becomes unavailable, but blocks media-ready", async () => {
    const { service, d } = createService();
    await service.create("owner", "conversation");
    d.resolve.mockRejectedValue(new AvatarIdentityError("scenario_not_allowed", 409));
    expect(await service.recover("owner", "conversation")).toMatchObject({ session: { id: "live-session" } });
    await expect(service.mediaReady("owner", "conversation", "live-session")).rejects.toMatchObject({ status: 409 });
    await service.stop("owner", "conversation", "live-session", true);
    expect(client.call.mock.calls.some((c: any) => c[1] === "/sessions/live-session/end")).toBe(true);
  });
  it("routes only server PCM after playable media and closes on actor changes/interruption", async () => {
    const { service } = createService();
    const audio = { type: "audio.delta", delta: Buffer.alloc(48000).toString("base64"), turnSeq: 1, pcmSampleRate: 24000 };
    await service.create("owner", "conversation");
    expect(service.routeAudio("owner", "conversation", "actor", audio)).toBe(false);
    await service.mediaReady("owner", "conversation", "live-session");
    const notify = vi.fn();
    expect(service.routeAudio("owner", "conversation", "actor", audio, notify)).toBe(true);
    service.routeAudio("owner", "conversation", "other-actor", audio, notify);
    expect(notify).toHaveBeenCalledWith({ type: "avatar.fallback" });
    expect(service.routeAudio("owner", "conversation", "actor", audio)).toBe(false);
    await service.mediaReady("owner", "conversation", "live-session");
    service.routeAudio("owner", "conversation", "actor", { type: "response.interrupted" }, notify);
    expect(service.routeAudio("owner", "conversation", "actor", audio)).toBe(false);
  });
  it("requires queued sessions to become running before credentials and audio ownership", async () => {
    const { service } = createService();
    await service.create("owner", "conversation");
    client.call.mockImplementation(async (_u: string, _p: string, schema: any) => schema.parse(session({ rendererState: "queued" })));
    await expect(service.connection("owner", "conversation", "live-session")).rejects.toMatchObject({ code: "avatar_session_not_ready" });
    await expect(service.mediaReady("owner", "conversation", "live-session")).rejects.toMatchObject({ code: "avatar_session_not_ready" });
    expect(client.call.mock.calls.some((c: any) => c[1].endsWith("/connection"))).toBe(false);
  });
});

describe("at-most-once AI PCM clip bridge", () => {
  it("chunks and paces 24k mono PCM without forwarding invalid source formats", async () => {
    const wait = vi.fn(async () => {});
    const fallback = vi.fn();
    const bridge = new ConversationAvatarAudio(client, "owner", "session", fallback, wait);
    bridge.ready = true;
    expect(bridge.push(Buffer.alloc(96000).toString("base64"), 1, 24000)).toBe(true);
    await vi.waitFor(() => expect(client.call).toHaveBeenCalledTimes(2));
    expect(client.call.mock.calls.every((c: any) => Buffer.from(c[3].pcmBase64, "base64").length === 48000)).toBe(true);
    expect(wait).toHaveBeenCalledWith(1000, expect.any(AbortSignal));
    expect(bridge.push(Buffer.alloc(960).toString("base64"), 1, 16000)).toBe(false);
    expect(fallback).toHaveBeenCalledOnce();
    bridge.close();
  });
  it("never retries rejected audio and bounds queued data", async () => {
    client.call.mockRejectedValue(new Error("timeout after acceptance"));
    const fallback = vi.fn();
    const bridge = new ConversationAvatarAudio(client, "owner", "session", fallback);
    bridge.ready = true;
    bridge.push(Buffer.alloc(48000).toString("base64"), 1, 24000);
    await vi.waitFor(() => expect(fallback).toHaveBeenCalledOnce());
    expect(client.call).toHaveBeenCalledOnce();
    expect(bridge.push(Buffer.alloc(48000).toString("base64"), 2, 24000)).toBe(false);
  });
  it("flushes a short final tail once and invalidates queued writes on close", async () => {
    const bridge = new ConversationAvatarAudio(client, "owner", "session", vi.fn(), async () => {});
    bridge.ready = true;
    bridge.push(Buffer.alloc(480).toString("base64"), 0, 24000);
    expect(client.call).not.toHaveBeenCalled();
    bridge.finish();
    await vi.waitFor(() => expect(client.call).toHaveBeenCalledOnce());
    expect(Buffer.from(client.call.mock.calls[0][3].pcmBase64, "base64")).toHaveLength(960);
    bridge.close();
    expect(bridge.push(Buffer.alloc(48000).toString("base64"), 1, 24000)).toBe(false);
  });
});
