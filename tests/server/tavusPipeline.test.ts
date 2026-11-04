import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../server/services/tavus/store", () => ({ TavusStore: class {} }));
vi.mock("../../server/services/tavus/context", () => ({
  resolveTavusContext: vi.fn(), resolveTavusOwner: vi.fn(), ROLEPLAY_PAL_PROMPT: "Stay in assigned role",
}));
vi.mock("../../server/services/tavus/importTranscript", () => ({ reserveTavusRun: vi.fn() }));
vi.mock("../../server/services/liveAvatar/projectConnection", () => ({ avatarRouterProjectConnection: {} }));
vi.mock("../../server/services/liveAvatar/conversationTarget", () => ({
  resolveConversationAvatar: vi.fn(), inspectConversationAvatarSelection: vi.fn(),
}));
vi.mock("../../server/storage", () => ({ storage: {} }));
import { TavusSessions } from "../../server/services/tavus/sessions";
import { TavusError, TavusClient, createdPalSchema } from "../../server/services/tavus/client";
import { dailyConnectionSchema } from "../../server/services/tavus/routerContracts";

let rows: Map<string, any>, deps: any, service: TavusSessions, remote: any;
beforeEach(() => {
  rows = new Map();
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
      projectId: "project", scopes: ["sessions:create", "sessions:read", "sessions:connect", "sessions:end"],
      integration: { features: ["tavus_full_pipeline", "daily_private_connection"] },
    })) },
    target: vi.fn(async () => ({ projectId: "project", avatarId: "selected-face", assetId: null })),
    resolve: vi.fn(async () => ({ context: "snapshot-bound character and situation", language: "ko" })),
    reserve: vi.fn(async () => undefined),
    client: { call: vi.fn(async (_user: string, path: string, schema: any, body: any) => {
      if (path === "/live-limits") return schema.parse({
        workerReady: true, creationAllowed: true, cleanupPending: 0, userRemainingSeconds: 600,
        globalRemainingSeconds: 3600, sessionSeconds: 120, providerCredits: "unknown", resetsAt: "tomorrow",
      });
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
  it("discovers features and actor policy without a paid create", async () => {
    expect(await service.config("owner", "run")).toMatchObject({
      available: true, maxSeconds: 120, evaluationAvailable: false, palStrategy: "per_session",
    });
    expect(deps.client.call).not.toHaveBeenCalled();
    deps.selection.mockResolvedValue({ blockers: ["avatar_persona_not_selected"] });
    expect(await service.config("owner", "run")).toMatchObject({ available: false, blockers: ["avatar_persona_not_selected"] });
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
