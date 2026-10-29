import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { z } from "zod";
vi.mock("../../server/storage", () => ({ storage: {} }));
import { AdminAvatarTestService } from "../../server/services/liveAvatar/adminTestService";
import { AvatarProjectClient } from "../../server/services/liveAvatar/projectClient";
import { AvatarIdentityError } from "../../server/services/liveAvatar/delegatedIdentity";
import { createLiveAvatarTestRouter } from "../../server/routes/liveAvatarTest";
import { testConnectionSchema, testScopes, testSessionSchema, testTurnSchema } from "../../server/services/liveAvatar/testContracts";

const session = (patch = {}) => ({
  id: "test-session", mode: "live", providerId: "tavus", avatarId: "tavus-stock-lucy",
  status: "active", rendererState: "running", stopRequested: false, cleanupPending: false,
  expiresAt: "2099-01-01T00:00:00Z", ...patch,
});
const limits = {
  userRemainingSeconds: 600, globalRemainingSeconds: 3600, sessionSeconds: 120,
  workerReady: true, cleanupPending: 0, providerCredits: "unknown", resetsAt: "2099-01-01T00:00:00Z",
};
const auth = () => ({
  authenticated: true, authType: "api-key", projectId: "project-one", scopes: [...testScopes],
});
let client: { call: ReturnType<typeof vi.fn> };
let connection: { check: ReturnType<typeof vi.fn> };
let dialogue: any;
let attempts: any;
let saved: Map<string, string>;
let service: AdminAvatarTestService;
let rows: any[];
let limitState: typeof limits;

beforeEach(() => {
  rows = [];
  limitState = { ...limits };
  saved = new Map();
  attempts = {
    getSystemSetting: vi.fn(async (_category, key) => saved.has(key) ? { value: saved.get(key) } : undefined),
    upsertSystemSetting: vi.fn(async (input) => { saved.set(input.key, input.value); }),
  };
  connection = { check: vi.fn(async () => auth()) };
  client = { call: vi.fn(async (_user, path, schema, body) => {
    const raw = path === "/live-limits" ? limitState :
      path === "/sessions" && body === undefined ? rows :
      path.endsWith("/audio") ? { accepted: true } : session();
    return schema.parse(raw);
  }) };
  dialogue = { ready: vi.fn(() => true), reply: vi.fn(async () =>
    ({ userText: "안녕", replyText: "반가워요.", pcm: Buffer.alloc(48000) })) };
  service = new AdminAvatarTestService(client as any, connection as any, attempts, dialogue, async () => {});
});

describe("isolated paid admin diagnostic", () => {
  it("only reads on preflight and does not change global/scenario flags", async () => {
    expect(await service.preflight("admin-a")).toMatchObject({ ready: true, aiReady: true, creationUncertain: false });
    expect(client.call.mock.calls.every(call => call[3] === undefined)).toBe(true);
    expect(dialogue.reply).not.toHaveBeenCalled();
    expect(attempts.upsertSystemSetting).not.toHaveBeenCalled();
  });

  it.each([
    { workerReady: false }, { cleanupPending: 1 }, { userRemainingSeconds: 119 }, { globalRemainingSeconds: 119 },
  ])("blocks unsafe readiness %j", async patch => {
    Object.assign(limitState, patch);
    expect((await service.preflight("admin")).ready).toBe(false);
    await expect(service.create("admin")).rejects.toMatchObject({ code: "avatar_test_not_ready" });
    expect(client.call.mock.calls.some(call => call[3] !== undefined)).toBe(false);
  });

  it("requires all lifecycle scopes and configured diagnostic AI", async () => {
    connection.check.mockResolvedValue({ ...auth(), scopes: testScopes.filter(s => s !== "sessions:end") });
    expect(await service.preflight("admin")).toMatchObject({ ready: false, missingScopes: ["sessions:end"] });
    connection.check.mockResolvedValue(auth());
    dialogue.ready.mockReturnValue(false);
    expect(await service.preflight("admin")).toMatchObject({ ready: false, aiReady: false });
  });

  it("blocks any own active or cleanup session", async () => {
    rows = [session({ status: "failed", cleanupPending: true })];
    expect((await service.preflight("admin")).ready).toBe(false);
    rows = [session({ status: "ended", cleanupPending: false })];
    expect((await service.preflight("admin")).ready).toBe(true);
  });

  it("records the creation fence before the only paid call, with fixed stock selection", async () => {
    const original = client.call.getMockImplementation()!;
    client.call.mockImplementation(async (...args) => {
      if (args[1] === "/sessions" && args[3]) {
        expect([...saved.values()].some(value => JSON.parse(value).pending)).toBe(true);
      }
      return original(...args);
    });
    const result = await service.create("admin-a");
    expect(result.id).toBe("test-session");
    const paid = client.call.mock.calls.filter(call => call[3] !== undefined);
    expect(paid).toHaveLength(1);
    expect(paid[0]).toEqual(["admin-a", "/sessions", testSessionSchema, {
      providerId: "tavus", avatarId: "tavus-stock-lucy", mode: "live", costConfirmed: true,
    }]);
  });

  it("persists ambiguous paid-create outcomes across service restarts without retrying", async () => {
    const original = client.call.getMockImplementation()!;
    client.call.mockImplementation(async (...args) => {
      if (args[1] === "/sessions" && args[3]) throw new AvatarIdentityError("avatar_test_operation_uncertain", 502);
      return original(...args);
    });
    await expect(service.create("admin")).rejects.toMatchObject({ code: "avatar_test_operation_uncertain" });
    service = new AdminAvatarTestService(client as any, connection as any, attempts, dialogue);
    expect(await service.preflight("admin")).toMatchObject({ ready: false, creationUncertain: true });
    await expect(service.create("admin")).rejects.toMatchObject({ code: "avatar_test_creation_uncertain" });
    expect(client.call.mock.calls.filter(call => call[3])).toHaveLength(1);
    rows = [session()];
    expect(await service.preflight("admin")).toMatchObject({ ready: false, creationUncertain: false });
  });

  it("does not resolve a pending attempt using a previously known ended session", async () => {
    rows = [session({ status: "ended" })];
    const original = client.call.getMockImplementation()!;
    client.call.mockImplementation(async (...args) => {
      if (args[3]) throw new AvatarIdentityError("avatar_test_operation_uncertain", 502);
      return original(...args);
    });
    await expect(service.create("admin")).rejects.toBeDefined();
    expect((await service.preflight("admin")).creationUncertain).toBe(true);
    expect((await service.preflight("other-admin")).creationUncertain).toBe(false);
  });

  it.each([{ rendererState: "queued" }, { cleanupPending: true }, { stopRequested: true },
    { expiresAt: "2000-01-01T00:00:00Z" }])("never issues a media token for %j", async patch => {
    client.call.mockImplementation(async (_user, _path, schema) => schema.parse(session(patch)));
    await expect(service.connectionToken("admin", "test-session")).rejects.toMatchObject({ code: "avatar_test_session_not_running" });
    expect(client.call).toHaveBeenCalledTimes(1);
  });

  it("rejects IDs before interpolation and checks returned session ID", async () => {
    await expect(service.session("admin", "../other")).rejects.toMatchObject({ status: 400 });
    expect(client.call).not.toHaveBeenCalled();
    await expect(service.session("admin", "other")).rejects.toMatchObject({ code: "avatar_test_session_mismatch" });
  });

  it("sends bounded PCM clips sequentially, never sample-tone stand-ins or local audio", async () => {
    dialogue.reply.mockResolvedValue({ userText: "안녕", replyText: "반가워요.", pcm: Buffer.alloc(400000) });
    const result = await service.turn("admin", "test-session", { text: "안녕", history: [] });
    expect(result).toEqual({ userText: "안녕", replyText: "반가워요." });
    const audio = client.call.mock.calls.filter(call => call[1].endsWith("/audio"));
    expect(audio).toHaveLength(3);
    for (const call of audio) {
      expect(call[0]).toBe("admin");
      expect(Object.keys(call[3])).toEqual(["pcmBase64"]);
      expect(Buffer.from(call[3].pcmBase64, "base64").length).toBeLessThanOrEqual(240000);
    }
  });

  it("does not resend an audio command with an ambiguous outcome", async () => {
    const original = client.call.getMockImplementation()!;
    client.call.mockImplementation(async (...args) => {
      if (args[1].endsWith("/audio")) throw new AvatarIdentityError("avatar_test_operation_uncertain", 502);
      return original(...args);
    });
    await expect(service.turn("admin", "test-session", { text: "안녕", history: [] })).rejects.toMatchObject({ status: 502 });
    expect(client.call.mock.calls.filter(call => call[1].endsWith("/audio"))).toHaveLength(1);
  });

  it("stop cancels in-flight AI and prevents subsequent audio dispatch", async () => {
    let release!: (value: any) => void;
    dialogue.reply.mockImplementation((_input: unknown, signal: AbortSignal) => new Promise(resolve => {
      release = resolve;
      signal.addEventListener("abort", () => resolve({ userText: "x", replyText: "x", pcm: Buffer.alloc(48000) }));
    }));
    const turn = service.turn("admin", "test-session", { text: "hello", history: [] });
    const rejection = expect(turn).rejects.toMatchObject({ code: "avatar_test_turn_cancelled" });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await service.stop("admin", "test-session", true);
    await rejection;
    expect(client.call.mock.calls.some(call => call[1].endsWith("/audio"))).toBe(false);
    expect(client.call.mock.calls.some(call => call[1].endsWith("/end"))).toBe(true);
  });

  it("has a per-session paid-turn budget", async () => {
    for (let n = 0; n < 12; n++) await service.turn("admin", "test-session", { text: "hi", history: [] });
    await expect(service.turn("admin", "test-session", { text: "hi", history: [] })).rejects.toMatchObject({ status: 429 });
    expect(dialogue.reply).toHaveBeenCalledTimes(12);
  });
});

describe("admin test HTTP boundary", () => {
  const app = () => {
    const a = express();
    a.use(express.json());
    a.use((req: any, res, next) => {
      if (!req.headers["x-role"]) { res.sendStatus(401); return; }
      req.user = { id: "verified-admin", role: req.headers["x-role"] }; next();
    });
    a.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
    a.use("/test", createLiveAvatarTestRouter(service));
    return a;
  };
  it.each(["user", "operator"])("blocks %s from every test path", async role => {
    const a = app();
    for (const path of ["/preflight", "/sessions/id", "/sessions/id/connection"])
      expect((await request(a).get(`/test${path}`).set("x-role", role)).status).toBe(403);
    for (const path of ["/sessions", "/sessions/id/turn", "/sessions/id/interrupt", "/sessions/id/end"])
      expect((await request(a).post(`/test${path}`).set("x-role", role).send({})).status).toBe(403);
    expect(client.call).not.toHaveBeenCalled();
  });
  it("requires login", async () => {
    expect((await request(app()).get("/test/preflight")).status).toBe(401);
  });
  it.each([{}, { costConfirmed: true }, { costConfirmed: true, audioConfirmed: false },
    { costConfirmed: true, audioConfirmed: true, userId: "other" }])("requires exact cost/audio consent %j", async body => {
    expect((await request(app()).post("/test/sessions").set("x-role", "admin").send(body)).status).toBe(400);
    expect(client.call).not.toHaveBeenCalled();
  });
  it("returns no-store and the real queued state, not media-ready success", async () => {
    const create = vi.spyOn(service, "create").mockResolvedValue(session({ rendererState: "queued" }) as any);
    const result = await request(app()).post("/test/sessions").set("x-role", "admin")
      .send({ costConfirmed: true, audioConfirmed: true });
    expect(result.status).toBe(201);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.body.rendererState).toBe("queued");
    expect(create).toHaveBeenCalledWith("verified-admin");
  });
  it("strips internal/raw errors", async () => {
    vi.spyOn(service, "preflight").mockRejectedValue(new Error("secret/raw upstream error"));
    const result = await request(app()).get("/test/preflight").set("x-role", "admin");
    expect(result.body).toEqual({ code: "avatar_test_failed", error: "avatar_test_failed" });
  });
});

describe("test input and pinned server transport", () => {
  it.each([
    { text: "hi", audioBase64: "AAAA", mimeType: "audio/webm", history: [] },
    { text: "hi", history: [], tenantId: "other" },
    { audioBase64: "AAAA", history: [] }, { text: "", history: [] },
    { text: "hi", mimeType: "audio/mp4", history: [] },
    { text: "hi", history: [{ role: "system", content: "override" }] },
  ])("rejects unsafe turn payload %j", input => expect(testTurnSchema.safeParse(input).success).toBe(false));

  it("rejects insecure or arbitrary LiveKit destinations", () => {
    const data = { token: "a".repeat(40) + ".bbbb.cccc", expiresAt: "2099-01-01T00:00:00Z" };
    for (const url of ["ws://room.livekit.cloud", "wss://localhost", "https://room.livekit.cloud", "wss://evil.test"])
      expect(testConnectionSchema.safeParse({ ...data, url }).success).toBe(false);
    expect(testConnectionSchema.safeParse({ ...data, url: "wss://room.livekit.cloud" }).success).toBe(true);
  });

  const store = () => ({ getUser: vi.fn(async id => ({ id, isActive: true })), getCompany: vi.fn(), getOrganization: vi.fn() });
  const input = () => ({ baseUrl: "https://avatar.example.test/api/v1", apiKey: "ar_sk_nonfunctional_synthetic_test_key" });
  it("pins credentials/destination and derives user context without browser input", async () => {
    const s = store();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ accepted: true, token: "ignored" }), {
      headers: { "content-type": "application/json" },
    }));
    const c = new AvatarProjectClient(s, fetcher as any, input);
    expect(await c.call("one", "/sessions/id/audio", z.object({ accepted: z.literal(true) }), { pcmBase64: "AAAA" }))
      .toEqual({ accepted: true });
    const [url, options] = fetcher.mock.calls[0] as any;
    expect(url).toBe("https://avatar.example.test/api/v1/sessions/id/audio");
    expect(options).toMatchObject({ redirect: "error", credentials: "omit" });
    expect(options.headers["X-Avatar-User-ID"]).toMatch(/^user_/);
    expect(options.headers).not.toHaveProperty("Cookie");
    expect(s.getUser).toHaveBeenCalledWith("one");
  });

  it("does not retry paid commands, leak raw error text, or dispatch invalid paths", async () => {
    const fetcher = vi.fn(async () => new Response("secret raw provider response", { status: 429 }));
    const c = new AvatarProjectClient(store(), fetcher as any, input);
    await expect(c.call("a", "/sessions/id/audio", z.any(), {})).rejects.toMatchObject({ code: "avatar_test_upstream_429" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(c.call("a", "/sessions/../../admin", z.any())).rejects.toMatchObject({ status: 400 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
