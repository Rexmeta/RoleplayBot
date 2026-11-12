import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../server/services/tavus/store", () => ({ TavusStore: class {} }));
vi.mock("../../server/services/tavus/context", () => ({
  resolveTavusContext: vi.fn(), resolveTavusOwner: vi.fn(), ROLEPLAY_PAL_PROMPT: "Stay in assigned role",
}));
vi.mock("../../server/services/tavus/importTranscript", () => ({ reserveTavusRun: vi.fn(), importTavusTranscript: vi.fn() }));
vi.mock("../../server/services/liveAvatar/projectConnection", () => ({ avatarRouterProjectConnection: {} }));
vi.mock("../../server/services/liveAvatar/conversationTarget", () => ({
  resolveConversationAvatar: vi.fn(), inspectConversationAvatarSelection: vi.fn(),
}));
vi.mock("../../server/storage", () => ({ storage: {} }));
import { TavusSessions } from "../../server/services/tavus/sessions";
import { TavusError, TavusClient, createdPalSchema } from "../../server/services/tavus/client";
import { dailyConnectionSchema } from "../../server/services/tavus/routerContracts";
import { tavusLimitsSchema } from "../../server/services/tavus/runtimeLimits";
import { createHash } from "node:crypto";

let rows: Map<string, any>, deps: any, service: TavusSessions, remote: any, limits: any;
beforeEach(() => {
  rows = new Map();
  limits = {
    workerReady: true, creationAllowed: true, cleanupPending: 0, userRemainingSeconds: 600,
    globalRemainingSeconds: 3600, sessionSeconds: 120, providerCredits: "unknown", resetsAt: "tomorrow",
  };
  remote = { id: "s1", providerId: "tavus", avatarId: "selected-face", mode: "live", pipeline: "tavus_full",
    status: "active", rendererState: "queued", cleanupPending: false, stopRequested: false,
    expiresAt: new Date(Date.now() + 120000).toISOString() };
  deps = {
    store: {
      read: vi.fn(async (k: string) => rows.get(k) ?? null),
      mutate: vi.fn(async (k: string, fn: any) => {
        const value = fn(rows.get(k) ?? null); rows.set(k, structuredClone(value)); return value;
      }),
    },
    owner: vi.fn(async (id: string) => {
      if (id !== "owner") throw new TavusError("tavus_conversation_forbidden", 403);
      return { run: { status: "active" }, scenarioRun: { status: "active" } };
    }),
    selection: vi.fn(async () => ({ blockers: [] })),
    connection: { check: vi.fn(async () => ({
      projectId: "project", scopes: ["live-limits:read", "sessions:create", "sessions:read", "sessions:connect", "sessions:end"],
      integration: { features: ["tavus_full_pipeline", "unified_roleplay_context", "unified_client_connection", "hosted_browser_client"] },
    })) },
    target: vi.fn(async () => ({ projectId: "project", avatarId: "selected-face", assetId: null })),
    resolve: vi.fn(async () => ({ context: "snapshot-bound character and situation", language: "ko", immutableContext: true })),
    reserve: vi.fn(async () => undefined),
    importTranscript: vi.fn(async () => undefined),
    client: { call: vi.fn(async (_user: string, path: string, schema: any, body: any) => {
      if (path.startsWith("/live-limits")) return schema.parse(limits);
      if (path === "/sessions" && body) expect(rows.get("run:run").state).toBe("creating");
      if (path.endsWith("/full-connection")) return schema.parse({
        transport: "daily", pipeline: "tavus_full", url: "https://room.tavus.daily.co/abc",
        token: "private-token", expiresAt: remote.expiresAt,
      });
      if (path.endsWith("/client-connection")) return schema.parse({
        sessionId: remote.id, pipeline: remote.pipeline, audioOwner: "avatarrouter",
        clientScriptPath: "/sdk/avatarrouter-client.js", expiresAt: remote.expiresAt, connection: { opaque: true },
      });
      return schema.parse(remote);
    }) },
  };
  service = new TavusSessions(deps);
});
describe("AvatarRouter Full Pipeline", () => {
  it.each(["tavus", "anam"] as const)("uses the same snapshot context and single managed handoff for %s", async provider => {
    vi.stubEnv("AVATAR_ROUTER_BASE_URL", "https://router.example/api/v1");
    const original = deps.connection.check.getMockImplementation();
    deps.connection.check.mockImplementation(async () => {
      const auth = await original();
      return { ...auth, integration: { features: [...auth.integration.features, `${provider}_full_pipeline`] } };
    });
    deps.selection.mockResolvedValue({ blockers: [], providerId: provider });
    deps.target.mockResolvedValue({ projectId: "project", providerId: provider, avatarId: "selected-face", assetId: null });
    Object.assign(remote, { providerId: provider, pipeline: `${provider}_full`, rendererState: "running" });
    try {
      if (provider === "anam") {
        deps.resolve.mockResolvedValueOnce({ context: "mutable authoring data", language: "ko", immutableContext: false });
        await expect(service.start("owner", "run", true)).rejects.toMatchObject({
          code: "avatar_frozen_context_required", details: { creationAttempted: false },
        });
        expect(rows.size).toBe(0);
      }
      expect(await service.start("owner", "run", true)).toMatchObject({ managedClient: true });
      expect(deps.client.call).toHaveBeenCalledWith("owner", "/sessions", expect.anything(), expect.objectContaining({
        fullPipeline: { systemPrompt: "Stay in assigned role", context: "snapshot-bound character and situation", languages: ["ko"] },
      }));
      expect(await service.managedConnection("owner", "run")).toMatchObject({ pipeline: `${provider}_full` });
      await expect(service.managedConnection("owner", "run")).rejects.toMatchObject({ code: "avatar_client_connection_already_issued" });
      await expect(service.connection("owner", "run")).rejects.toMatchObject({ status: 405 });
      expect(deps.client.call.mock.calls.filter(call => call[1].endsWith("/client-connection"))).toHaveLength(1);
    } finally { vi.unstubAllEnvs(); }
  });
  it.each(["pending", "importing", "failed", "completed", "empty"])(
    "never advertises or imports Anam from persisted %s state or speculative feature discovery", async transcriptState => {
      rows.set("run:run", {
        state: "ended", token: "local-fence", userId: "owner", runId: "run",
        createdAt: new Date().toISOString(), projectId: "project", sessionId: "s1",
        providerId: "anam", transcriptState, transcriptError: "tavus_transcript_sync_failed",
      });
      deps.connection.check.mockResolvedValue({
        projectId: "project", integration: {
          features: ["anam_full_pipeline", "anam_final_transcript_v1", "tavus_final_transcript_v1", "unified_final_transcript"],
        },
      });
      expect(await service.session("owner", "run")).toMatchObject({
        state: "ended", providerId: "anam", evaluationAvailable: false, transcriptState: "unavailable",
      });
      const result = await service.sync("owner", "run");
      expect(result).toMatchObject({ evaluationAvailable: false, transcriptState: "unavailable" });
      expect(result).not.toHaveProperty("transcriptError");
      expect(deps.client.call).not.toHaveBeenCalled();
      expect(deps.resolve).not.toHaveBeenCalled();
      expect(deps.importTranscript).not.toHaveBeenCalled();
      expect(rows.get("run:run")).not.toHaveProperty("transcriptContract");
    },
  );
  it("rejects another user's Anam history before any router read or import", async () => {
    rows.set("run:run", {
      state: "ended", userId: "other", runId: "run", providerId: "anam", transcriptState: "pending",
    });
    await expect(service.sync("owner", "run")).rejects.toMatchObject({ code: "tavus_conversation_forbidden" });
    expect(deps.connection.check).not.toHaveBeenCalled();
    expect(deps.client.call).not.toHaveBeenCalled();
    expect(deps.importTranscript).not.toHaveBeenCalled();
  });
  it.each([
    { extraFeatures: [] },
    { extraFeatures: ["tavus_full_pipeline", "daily_private_connection", "tavus_final_transcript_v1"] },
    { extraFeatures: ["anam_session_context_v1"] },
    { extraFeatures: ["anam_final_transcript_v1"] },
  ])("blocks Anam before paid creation when common context support is absent despite $extraFeatures", async ({ extraFeatures }) => {
    deps.selection.mockResolvedValue({ blockers: [], providerId: "anam" });
    deps.connection.check.mockResolvedValue({
      projectId: "project",
      scopes: ["live-limits:read", "sessions:create", "sessions:read", "sessions:connect", "sessions:end"],
      integration: { features: ["anam_full_pipeline", "unified_client_connection", "hosted_browser_client", ...extraFeatures] },
    });
    deps.target.mockResolvedValue({
      projectId: "project", providerId: "anam", avatarId: "anam-persona-default", assetId: null,
    });
    Object.assign(remote, {
      providerId: "anam", avatarId: "anam-persona-default", pipeline: "anam_full", rendererState: "running",
    });
    deps.client.call.mockImplementation(async (_user, path, schema) =>
      schema.parse(path.startsWith("/live-limits") ? limits : remote));

    await expect(service.start("owner", "run", true)).rejects.toMatchObject({
      code: "avatar_router_full_pipeline_unavailable", details: { creationAttempted: false },
    });
    expect(deps.resolve).not.toHaveBeenCalled();
    const writes = deps.client.call.mock.calls.filter((call: any[]) => call[3] !== undefined);
    expect(writes).toHaveLength(0);
    expect(rows.size).toBe(0);
    expect(await service.config("owner", "run")).toMatchObject({
      palStrategy: "per_session", evaluationAvailable: false,
    });
  });
  it("dispatches Anam with the common context and managed connection, never a direct SDK or Daily path", async () => {
    vi.stubEnv("AVATAR_ROUTER_BASE_URL", "https://router.example/api/v1");
    try {
      deps.selection.mockResolvedValue({ blockers: [], providerId: "anam" });
      deps.connection.check.mockResolvedValue({
        projectId: "project", scopes: ["live-limits:read", "sessions:create", "sessions:read", "sessions:connect", "sessions:end"],
        integration: { features: ["anam_full_pipeline", "unified_client_connection", "hosted_browser_client", "unified_roleplay_context", "tavus_final_transcript_v1"] },
      });
      deps.target.mockResolvedValue({ projectId: "project", providerId: "anam", avatarId: "anam-persona-default", assetId: null });
      Object.assign(remote, { providerId: "anam", avatarId: "anam-persona-default", pipeline: "anam_full", rendererState: "running" });
      deps.client.call.mockImplementation(async (_u, path, schema) => schema.parse(
        path.startsWith("/live-limits") ? limits : path.endsWith("/client-connection") ? {
          sessionId: remote.id, pipeline: "anam_full", audioOwner: "avatarrouter",
          clientScriptPath: "/sdk/avatarrouter-client.js", expiresAt: remote.expiresAt, connection: { opaque: true },
        } : remote,
      ));
      expect(await service.config("owner", "run")).toMatchObject({ available: true, providerId: "anam", evaluationAvailable: false, palStrategy: "per_session" });
      expect(await service.start("owner", "run", true)).toMatchObject({ state: "active", providerId: "anam", evaluationAvailable: false });
      expect(deps.client.call).toHaveBeenCalledWith("owner", "/sessions", expect.anything(), {
        providerId: "anam", avatarId: "anam-persona-default", pipeline: "anam_full", mode: "live", costConfirmed: true,
        fullPipeline: { systemPrompt: "Stay in assigned role", context: "snapshot-bound character and situation", languages: ["ko"] },
      });
      expect(await service.managedConnection("owner", "run")).toMatchObject({ clientScriptUrl: "https://router.example/sdk/avatarrouter-client.js" });
      await expect(service.managedConnection("owner", "run")).rejects.toMatchObject({ code: "avatar_client_connection_already_issued" });
      expect(deps.client.call.mock.calls.filter(c => c[1].endsWith("/client-connection"))).toHaveLength(1);
      await expect(service.connection("owner", "run")).rejects.toMatchObject({ status: 405 });
      expect(deps.importTranscript).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });
  it("discovers features, actor policy and current limits without a paid create", async () => {
    expect(await service.config("owner", "run")).toMatchObject({
      available: true, maxSeconds: 120, evaluationAvailable: false, palStrategy: "per_session",
    });
    expect(deps.client.call.mock.calls.map((call: any[]) => call[1])).toEqual(["/live-limits"]);
    deps.selection.mockResolvedValue({ blockers: ["avatar_persona_not_selected"] });
    expect(await service.config("owner", "run")).toMatchObject({ available: false, selectable: false, blockers: ["avatar_persona_not_selected"] });
  });
  it("accepts the router's 600-second full-pipeline limit and starts once without the old diagnostic cap", async () => {
    limits.sessionSeconds = 600;
    expect(tavusLimitsSchema.safeParse(limits).success).toBe(true);
    expect(await service.config("owner", "run")).toMatchObject({
      available: true, maxSeconds: 600, runtime: { sessionSeconds: 600 },
    });
    await service.start("owner", "run", true);
    expect(deps.client.call.mock.calls.filter((call: any[]) => call[1] === "/sessions")).toHaveLength(1);
  });
  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY, "600"])("rejects invalid router session duration %s", sessionSeconds => {
    expect(tavusLimitsSchema.safeParse({ ...limits, sessionSeconds }).success).toBe(false);
  });
  it.each([
    [{ workerReady: false }, "avatar_runtime_worker_unavailable"],
    [{ cleanupPending: 1 }, "avatar_runtime_cleanup_pending"],
    [{ userRemainingSeconds: 119 }, "avatar_runtime_user_budget_insufficient"],
    [{ globalRemainingSeconds: 119 }, "avatar_runtime_global_budget_insufficient"],
    [{ creationAllowed: false }, "avatar_runtime_creation_blocked"],
  ])("explains admission refusal %j before any paid create or local reservation", async (change, code) => {
    Object.assign(limits, change);
    expect(await service.config("owner", "run")).toMatchObject({ available: false, selectable: true, blockers: [code], runtime: change });
    await expect(service.start("owner", "run", true)).rejects.toMatchObject({
      code, status: 409, details: { creationAttempted: false, blockers: [code] },
    });
    expect(rows.size).toBe(0);
    expect(deps.reserve).not.toHaveBeenCalled();
    expect(deps.client.call.mock.calls.every((call: any[]) => call[1] === "/live-limits")).toBe(true);
    Object.assign(limits, { workerReady: true, cleanupPending: 0, userRemainingSeconds: 600,
      globalRemainingSeconds: 3600, creationAllowed: true });
    expect(await service.start("owner", "run", true)).toMatchObject({ state: "creating" });
  });
  it("preserves all blockers, ignores untrusted upstream reason text, and accepts exact budget boundaries", async () => {
    Object.assign(limits, { workerReady: false, cleanupPending: 2, userRemainingSeconds: 0,
      globalRemainingSeconds: 0, creationAllowed: false, blockingReasons: ["private-project-secret"] });
    const config = await service.config("owner", "run");
    expect(config.blockers).toHaveLength(5);
    expect(JSON.stringify(config)).not.toContain("private-project-secret");
    Object.assign(limits, { workerReady: true, cleanupPending: 0, userRemainingSeconds: 120,
      globalRemainingSeconds: 120 });
    delete limits.creationAllowed;
    expect(await service.config("owner", "run")).toMatchObject({ available: true });
  });
  it("fails closed on unreadable limits without marking a paid request as attempted", async () => {
    deps.client.call.mockRejectedValue(new Error("unreadable"));
    await expect(service.start("owner", "run", true)).rejects.toMatchObject({
      details: { creationAttempted: false },
    });
    expect(rows.size).toBe(0);
    expect(deps.reserve).not.toHaveBeenCalled();
  });
  it("blocks an older router and missing session scopes", async () => {
    deps.connection.check.mockResolvedValue({ projectId: "project", scopes: [], integration: { features: [] } });
    expect(await service.config("owner")).toMatchObject({ available: false });
    await expect(service.start("owner", "run", true)).rejects.toMatchObject({ status: 503 });
    expect(deps.client.call).not.toHaveBeenCalled();
  });
  it("requires consent and owner before external writes", async () => {
    await expect(service.start("owner", "run", false)).rejects.toMatchObject({ code: "tavus_consent_required" });
    await expect(service.start("other", "run", true)).rejects.toMatchObject({ status: 403 });
    expect(deps.client.call).not.toHaveBeenCalled();
  });
  it("uses the selected avatar and router-owned per-session PAL, never direct provider endpoints", async () => {
    expect(await service.start("owner", "run", true)).toMatchObject({ state: "creating", evaluationAvailable: false });
    expect(deps.client.call).toHaveBeenCalledWith("owner", "/sessions", expect.anything(), {
      providerId: "tavus", avatarId: "selected-face", mode: "live", pipeline: "tavus_full", costConfirmed: true,
      fullPipeline: { systemPrompt: "Stay in assigned role", context: "snapshot-bound character and situation", languages: ["ko"] },
    });
    expect(deps.reserve).toHaveBeenCalledTimes(1);
    expect(deps.client.call.mock.calls.every((c: any[]) => !/pals|conversations|audio|interrupt/.test(c[1]))).toBe(true);
  });
  it.each([false, undefined])("preserves legacy Daily recovery with managedClient=%s without a managed handoff", async managedClient => {
    await service.start("owner", "run", true);
    await service.start("owner", "run", true);
    await expect(service.connection("owner", "run")).rejects.toMatchObject({ code: "tavus_session_not_ready" });
    remote.rendererState = "running";
    if (managedClient === undefined) delete rows.get("run:run").managedClient;
    else rows.get("run:run").managedClient = managedClient;
    expect(await service.connection("owner", "run")).toMatchObject({ transport: "daily", token: "private-token" });
    await expect(service.managedConnection("owner", "run")).rejects.toMatchObject({ code: "avatar_legacy_connection_required" });
    expect(rows.get("run:run").managedConnectionClaim).toBeUndefined();
    expect(deps.client.call.mock.calls.some(call => call[1].endsWith("/client-connection"))).toBe(false);
    expect(await service.session("owner", "run")).toMatchObject({ managedClient: false });
    expect(await service.session("owner", "run")).not.toHaveProperty("token");
    expect(JSON.stringify([...rows.values()])).not.toContain("private-token");
    expect(deps.client.call.mock.calls.filter((c: any[]) => c[1] === "/sessions")).toHaveLength(1);
  });
  it("keeps an uncertain create fenced against repeated starts", async () => {
    const call = deps.client.call.getMockImplementation();
    deps.client.call.mockImplementation(async (...args: any[]) => {
      if (args[1] === "/sessions") throw new Error("timeout");
      return call(...args);
    });
    await expect(service.start("owner", "run", true)).rejects.toThrow("timeout");
    expect(rows.get("run:run").lastError).toBe("tavus_create_uncertain");
    expect(await service.start("owner", "run", true)).toMatchObject({ state: "create_unknown" });
    expect(deps.client.call.mock.calls.filter((c: any[]) => c[1] === "/sessions")).toHaveLength(1);
  });
  it("remembers an end request during creation and cleans up as soon as the ID arrives", async () => {
    let accept!: (value: unknown) => void;
    const deferred = new Promise(resolve => { accept = resolve; });
    const original = deps.client.call.getMockImplementation();
    deps.client.call.mockImplementation(async (...args: any[]) => {
      if (args[1] === "/sessions") return deferred;
      return original(...args);
    });
    const starting = service.start("owner", "run", true);
    await vi.waitFor(() => expect(deps.client.call.mock.calls.some((c: any[]) => c[1] === "/sessions")).toBe(true));
    expect(await service.end("owner", "run")).toMatchObject({ state: "ending" });
    accept(remote);
    expect(await starting).toMatchObject({ state: "ending" });
    expect(deps.client.call).toHaveBeenCalledWith("owner", "/sessions/s1/end", expect.anything(), {});
  });
  it("does not treat end acknowledgement as cleanup or import nonexistent transcripts", async () => {
    await service.start("owner", "run", true);
    remote.rendererState = "running";
    expect(await service.end("owner", "run")).toMatchObject({ state: "ending" });
    remote.status = "ended"; remote.rendererState = "closed"; remote.cleanupPending = false;
    expect(await service.sync("owner", "run")).toMatchObject({ state: "ended", evaluationAvailable: false });
    expect(deps.client.call.mock.calls.some((c: any[]) => /transcript|conversations/.test(c[1]))).toBe(false);
  });
  it("rejects project changes and unexpected remote identity", async () => {
    await service.start("owner", "run", true);
    remote.avatarId = "different-face";
    await expect(service.session("owner", "run")).rejects.toMatchObject({ code: "tavus_session_mismatch" });
    deps.connection.check.mockResolvedValue({ projectId: "other-project" });
    await expect(service.end("owner", "run")).rejects.toMatchObject({ code: "persona_avatar_project_mismatch" });
  });
  it("does not silently truncate oversized contexts or bypass budget restrictions", async () => {
    deps.resolve.mockResolvedValue({ context: "x".repeat(12001), language: "ko" });
    await expect(service.start("owner", "run", true)).rejects.toMatchObject({ code: "tavus_context_too_large" });
    expect(rows.size).toBe(0);
  });
  it("keeps the legacy direct Tavus adapter blocked", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    await expect(new TavusClient().call("/pals", createdPalSchema, {})).rejects.toMatchObject({ status: 503 });
    expect(fetch).not.toHaveBeenCalled(); fetch.mockRestore();
  });
  it("rejects untrusted Daily URLs", () => {
    for (const url of ["http://tavus.daily.co/x", "https://daily.co.evil.test/x", "https://u:p@tavus.daily.co/x"]) {
      expect(dailyConnectionSchema.safeParse({ transport: "daily", pipeline: "tavus_full", url,
        token: "private", expiresAt: remote.expiresAt }).success).toBe(false);
    }
  });
});

describe.each(["tavus", "anam"] as const)("router-authenticated %s final transcript recovery", provider => {
  let transcript: any;
  beforeEach(() => {
    deps.selection.mockResolvedValue({ blockers: [], providerId: provider });
    deps.target.mockResolvedValue({ projectId: "project", avatarId: "selected-face", assetId: null, providerId: provider });
    Object.assign(remote, { providerId: provider, pipeline: `${provider}_full` });
    const check = deps.connection.check.getMockImplementation();
    deps.connection.check.mockImplementation(async (...args: any[]) => {
      const auth = await check(...args);
      return { ...auth, integration: { features: [...auth.integration.features, `${provider}_full_pipeline`] } };
    });
  });
  async function endedSession() {
    const check = deps.connection.check.getMockImplementation();
    deps.connection.check.mockImplementation(async (...args: any[]) => {
      const auth = await check(...args);
      return { ...auth, integration: { ...auth.integration,
        features: [...auth.integration.features, "unified_final_transcript"] } };
    });
    transcript = {
      sessionId: "s1", source: provider, status: "ready", final: true,
      messages: [
        { role: "assistant", text: "안녕하세요", timestamp: "2026-11-04T01:00:00.000Z" },
        { role: "user", text: "납기가 촉박합니다", timestamp: "2026-11-04T01:00:03.000Z" },
      ],
    };
    transcript.revision = createHash("sha256").update(JSON.stringify(transcript.messages)).digest("hex");
    const call = deps.client.call.getMockImplementation();
    deps.client.call.mockImplementation(async (...args: any[]) => {
      if (args[1].endsWith("/transcript")) return args[2].parse(transcript);
      return call(...args);
    });
    await service.start("owner", "run", true);
    remote.status = "ended"; remote.rendererState = "closed";
  }
  it("imports owned final evidence once and exposes completion only after durable feedback import succeeds", async () => {
    await endedSession();
    expect(await service.sync("owner", "run")).toMatchObject({
      state: "ended", transcriptState: "completed", evaluationAvailable: true,
    });
    expect(deps.importTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ context: "snapshot-bound character and situation" }), "s1", [
        { sender: "ai", message: "안녕하세요", timestamp: "2026-11-04T01:00:00.000Z" },
        { sender: "user", message: "납기가 촉박합니다", timestamp: "2026-11-04T01:00:03.000Z" },
      ],
      { provider, projectId: "project", sessionId: "s1", revision: transcript.revision },
    );
    await service.sync("owner", "run");
    expect(deps.importTranscript).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await service.session("owner", "run"))).not.toContain("납기가");
    expect(await service.session("owner", "run")).not.toHaveProperty("transcriptRevision");
  });
  it("waits for actual closure and advertised transcript support without inventing an endpoint on an old router", async () => {
    await service.start("owner", "run", true);
    await service.sync("owner", "run");
    remote.status = "ended"; remote.rendererState = "closed";
    expect(await service.sync("owner", "run")).toMatchObject({ transcriptState: "unavailable" });
    expect(deps.client.call.mock.calls.some((call: any[]) => call[1].endsWith("/transcript"))).toBe(false);
    expect(deps.importTranscript).not.toHaveBeenCalled();
  });
  it("keeps pending and unavailable provider evidence out of reports", async () => {
    await endedSession();
    transcript = { sessionId: "s1", source: provider, status: "pending" };
    expect(await service.sync("owner", "run")).toMatchObject({ transcriptState: "pending" });
    rows.get("run:run").transcriptRetryAt = 0;
    transcript.status = "unavailable";
    expect(await service.sync("owner", "run")).toMatchObject({
      transcriptState: "unavailable", transcriptError: "tavus_final_transcript_unavailable",
    });
    expect(deps.importTranscript).not.toHaveBeenCalled();
  });
  it.each(["foreign-session", "foreign-provider", "revision", "missing-final"])("rejects invalid %s transcript without evaluation", async invalid => {
    await endedSession();
    if (invalid === "foreign-session") transcript.sessionId = "other";
    else if (invalid === "foreign-provider") transcript.source = provider === "anam" ? "tavus" : "anam";
    else if (invalid === "revision") transcript.revision = "0".repeat(64);
    else delete transcript.final;
    expect(await service.sync("owner", "run")).toMatchObject({ transcriptState: "failed" });
    expect(deps.importTranscript).not.toHaveBeenCalled();
  });
  it("retries failed feedback import with the same immutable revision, but rejects changed evidence", async () => {
    await endedSession();
    deps.importTranscript.mockRejectedValueOnce(new Error("queue unavailable"));
    expect(await service.sync("owner", "run")).toMatchObject({ transcriptState: "failed" });
    rows.get("run:run").transcriptRetryAt = 0;
    transcript.messages[0].text = "rewritten";
    transcript.revision = createHash("sha256").update(JSON.stringify(transcript.messages)).digest("hex");
    expect(await service.sync("owner", "run")).toMatchObject({
      transcriptState: "failed", transcriptError: "tavus_transcript_revision_mismatch",
    });
    expect(deps.importTranscript).toHaveBeenCalledTimes(1);
  });
  it("serializes concurrent imports and resumes the same failed import safely", async () => {
    await endedSession();
    let release!: () => void;
    deps.importTranscript.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const first = service.sync("owner", "run");
    await vi.waitFor(() => expect(deps.importTranscript).toHaveBeenCalledTimes(1));
    expect(await service.sync("owner", "run")).toMatchObject({ transcriptState: "importing" });
    release();
    expect(await first).toMatchObject({ transcriptState: "completed" });
    expect(deps.importTranscript).toHaveBeenCalledTimes(1);
  });
  it("does not invent feedback when no learner utterance was captured", async () => {
    await endedSession();
    transcript.messages = [];
    transcript.revision = createHash("sha256").update("[]").digest("hex");
    expect(await service.sync("owner", "run")).toMatchObject({ transcriptState: "empty" });
    expect(deps.importTranscript).toHaveBeenCalledWith(expect.anything(), "s1", [],
      { provider, projectId: "project", sessionId: "s1", revision: transcript.revision });
  });
  it("imports AI-only confirmed messages for history without exposing feedback navigation", async () => {
    await endedSession();
    transcript.messages = transcript.messages.slice(0, 1);
    transcript.revision = createHash("sha256").update(JSON.stringify(transcript.messages)).digest("hex");
    expect(await service.sync("owner", "run")).toMatchObject({ transcriptState: "empty" });
    expect(deps.importTranscript).toHaveBeenCalledTimes(1);
  });
});
