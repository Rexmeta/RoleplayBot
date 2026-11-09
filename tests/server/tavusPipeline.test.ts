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
      integration: { features: ["tavus_full_pipeline", "daily_private_connection"] },
    })) },
    target: vi.fn(async () => ({ projectId: "project", avatarId: "selected-face", assetId: null })),
    resolve: vi.fn(async () => ({ context: "snapshot-bound character and situation", language: "ko" })),
    reserve: vi.fn(async () => undefined),
    importTranscript: vi.fn(async () => undefined),
    client: { call: vi.fn(async (_user: string, path: string, schema: any, body: any) => {
      if (path === "/live-limits") return schema.parse(limits);
      if (path === "/sessions" && body) expect(rows.get("run:run").state).toBe("creating");
      if (path.endsWith("/full-connection")) return schema.parse({
        transport: "daily", pipeline: "tavus_full", url: "https://room.tavus.daily.co/abc",
        token: "private-token", expiresAt: remote.expiresAt,
      });
      return schema.parse(remote);
    }) },
  };
  service = new TavusSessions(deps);
});
describe("AvatarRouter Full Pipeline", () => {
  it.each([
    { extraFeatures: [] },
    { extraFeatures: ["tavus_full_pipeline", "daily_private_connection", "tavus_final_transcript_v1"] },
    { extraFeatures: ["anam_session_context_v1"] },
  ])("does not treat unrelated or unratified features $extraFeatures as permission to send Anam instructions", async ({ extraFeatures }) => {
    deps.selection.mockResolvedValue({ blockers: [], providerId: "anam" });
    deps.connection.check.mockResolvedValue({
      projectId: "project",
      scopes: ["live-limits:read", "sessions:create", "sessions:read", "sessions:connect", "sessions:end"],
      integration: { features: ["anam_full_pipeline", "unified_client_connection", "hosted_browser_client", ...extraFeatures] },
    });
    deps.target.mockResolvedValue({
      projectId: "project", providerId: "anam", avatarId: "anam-persona-default", assetId: null,
    });
    const frozenInstructions = {
      context: "ROLEPLAY_SESSION_DATA: frozen actor role and private organization response instructions",
      language: "ko",
    };
    deps.resolve.mockResolvedValue(frozenInstructions);
    Object.assign(remote, {
      providerId: "anam", avatarId: "anam-persona-default", pipeline: "anam_full", rendererState: "running",
    });
    deps.client.call.mockImplementation(async (_user, path, schema) =>
      schema.parse(path.startsWith("/live-limits") ? limits : remote));

    await service.start("owner", "run", true);
    expect(deps.resolve).toHaveBeenCalledWith("owner", "run");
    const writes = deps.client.call.mock.calls.filter((call: any[]) => call[3] !== undefined);
    expect(writes).toHaveLength(1);
    expect(writes[0][1]).toBe("/sessions");
    expect(writes[0][3]).toEqual({
      providerId: "anam", avatarId: "anam-persona-default", pipeline: "anam_full", mode: "live", costConfirmed: true,
    });
    expect(JSON.stringify(deps.client.call.mock.calls)).not.toContain(frozenInstructions.context);
    expect(JSON.stringify([...rows.values()])).not.toContain(frozenInstructions.context);
    expect(frozenInstructions.context).toContain("frozen actor role");
    expect(await service.config("owner", "run")).toMatchObject({
      palStrategy: "saved_persona", evaluationAvailable: false,
    });
  });
  it("dispatches Anam via managed native connection without Tavus payloads, Daily or transcript claims", async () => {
    vi.stubEnv("AVATAR_ROUTER_BASE_URL", "https://router.example/api/v1");
    try {
      deps.selection.mockResolvedValue({ blockers: [], providerId: "anam" });
      deps.connection.check.mockResolvedValue({
        projectId: "project", scopes: ["live-limits:read", "sessions:create", "sessions:read", "sessions:connect", "sessions:end"],
        integration: { features: ["anam_full_pipeline", "unified_client_connection", "hosted_browser_client", "tavus_final_transcript_v1"] },
      });
      deps.target.mockResolvedValue({ projectId: "project", providerId: "anam", avatarId: "anam-persona-default", assetId: null });
      Object.assign(remote, { providerId: "anam", avatarId: "anam-persona-default", pipeline: "anam_full", rendererState: "running" });
      deps.client.call.mockImplementation(async (_u, path, schema) => schema.parse(
        path.startsWith("/live-limits") ? limits : path.endsWith("/client-connection") ? {
          sessionId: remote.id, pipeline: "anam_full", audioOwner: "avatarrouter",
          clientScriptPath: "/sdk/avatarrouter-client.js", expiresAt: remote.expiresAt, connection: { opaque: true },
        } : remote,
      ));
      expect(await service.config("owner", "run")).toMatchObject({ available: true, providerId: "anam", evaluationAvailable: false, palStrategy: "saved_persona" });
      expect(await service.start("owner", "run", true)).toMatchObject({ state: "active", providerId: "anam", evaluationAvailable: false });
      expect(deps.client.call).toHaveBeenCalledWith("owner", "/sessions", expect.anything(), {
        providerId: "anam", avatarId: "anam-persona-default", pipeline: "anam_full", mode: "live", costConfirmed: true,
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
  it("does not duplicate creation and only releases Daily credentials after actual readiness", async () => {
    await service.start("owner", "run", true);
    await service.start("owner", "run", true);
    await expect(service.connection("owner", "run")).rejects.toMatchObject({ code: "tavus_session_not_ready" });
    remote.rendererState = "running";
    expect(await service.connection("owner", "run")).toMatchObject({ transport: "daily", token: "private-token" });
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

describe("router-authenticated final transcript recovery", () => {
  let transcript: any;
  async function endedSession() {
    const check = deps.connection.check.getMockImplementation();
    deps.connection.check.mockImplementation(async (...args: any[]) => {
      const auth = await check(...args);
      return { ...auth, integration: { ...auth.integration,
        features: [...auth.integration.features, "tavus_final_transcript_v1"] } };
    });
    transcript = {
      sessionId: "s1", source: "tavus", status: "ready", final: true,
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
    transcript = { sessionId: "s1", source: "tavus", status: "pending" };
    expect(await service.sync("owner", "run")).toMatchObject({ transcriptState: "pending" });
    rows.get("run:run").transcriptRetryAt = 0;
    transcript.status = "unavailable";
    expect(await service.sync("owner", "run")).toMatchObject({
      transcriptState: "unavailable", transcriptError: "tavus_final_transcript_unavailable",
    });
    expect(deps.importTranscript).not.toHaveBeenCalled();
  });
  it.each(["foreign-session", "revision", "missing-final"])("rejects invalid %s transcript without evaluation", async invalid => {
    await endedSession();
    if (invalid === "foreign-session") transcript.sessionId = "other";
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
    expect(deps.importTranscript).toHaveBeenCalledWith(expect.anything(), "s1", []);
  });
  it("imports AI-only confirmed messages for history without exposing feedback navigation", async () => {
    await endedSession();
    transcript.messages = transcript.messages.slice(0, 1);
    transcript.revision = createHash("sha256").update(JSON.stringify(transcript.messages)).digest("hex");
    expect(await service.sync("owner", "run")).toMatchObject({ transcriptState: "empty" });
    expect(deps.importTranscript).toHaveBeenCalledTimes(1);
  });
});
