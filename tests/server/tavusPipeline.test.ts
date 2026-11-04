import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/services/tavus/store", () => ({ TavusStore: class {} }));
vi.mock("../../server/services/tavus/context", () => ({
  resolveTavusContext: vi.fn(), resolveTavusOwner: vi.fn(), ROLEPLAY_PAL_PROMPT: "Stay in assigned role",
}));
vi.mock("../../server/services/tavus/importTranscript", () => ({
  importTavusTranscript: vi.fn(), reserveTavusRun: vi.fn(),
}));
vi.mock("../../server/services/liveAvatar/projectConnection", () => ({
  avatarRouterProjectConnection: { status: () => ({ state: "configured" }) },
}));

import { TavusSessions } from "../../server/services/tavus/sessions";
import { TavusClient, TavusError, conversationJoinUrl, createdPalSchema } from "../../server/services/tavus/client";

let rows: Map<string, any>, deps: any, service: TavusSessions;
const finalConversation = {
  conversation_id: "c1", status: "ended", events: [{
    event_type: "application.transcription_ready",
    properties: { transcript: [
      { role: "assistant", content: "어떤 제안인가요?", timestamp: 1800000000 },
      { role: "user", content: "납기를 먼저 협의하고 싶습니다.", timestamp: 1800000003 },
    ] },
  }],
};

beforeEach(() => {
  rows = new Map();
  deps = {
    store: {
      read: vi.fn(async (key: string) => rows.get(key) ?? null),
      mutate: vi.fn(async (key: string, fn: any) => {
        const value = fn(rows.get(key) ?? null);
        rows.set(key, structuredClone(value));
        return value;
      }),
    },
    env: { TAVUS_DEFAULT_FACE_ID: "stock-face" },
    availability: vi.fn(() => ({ available: true, blockers: [] })),
    owner: vi.fn(async (userId: string) => {
      if (userId !== "owner") throw new TavusError("tavus_conversation_forbidden", 403);
      return { run: { status: "active" }, scenarioRun: { status: "active" } };
    }),
    resolve: vi.fn(async (userId: string, runId: string) => {
      if (userId !== "owner") throw new TavusError("tavus_conversation_forbidden", 403);
      return { run: { id: runId, status: "active" }, scenarioRun: { status: "active" },
        context: "unique persona and scenario", language: "ko" };
    }),
    reserve: vi.fn(async () => undefined),
    importTranscript: vi.fn(async () => undefined),
    client: { call: vi.fn(async (path: string) => {
      if (path === "/pals") return { pal_id: "p1" }; // create does NOT return pipeline_mode
      if (path.startsWith("/pals/")) return { pal_id: "p1", pipeline_mode: "full" };
      if (path === "/conversations") return {
        conversation_id: "c1", conversation_url: "https://tavus.daily.co/room", meeting_token: "short-lived-room-token",
      };
      if (path.endsWith("/end")) return {};
      return finalConversation;
    }) },
  };
  service = new TavusSessions(deps);
});

describe("Tavus Full Pipeline sessions", () => {
  it("keeps the real adapter unavailable until the router Full Pipeline contract exists", async () => {
    expect(await new TavusSessions().config()).toEqual({
      available: false, blockers: ["avatar_router_full_pipeline_contract_required"],
    });
  });
  it("creates ONE shared full PAL and passes per-run contexts rather than creating per-persona PALs", async () => {
    const one = await service.start("owner", "run1", true);
    await service.start("owner", "run2", true);
    const creates = deps.client.call.mock.calls.filter((c: any[]) => c[0] === "/pals");
    expect(creates).toHaveLength(1);
    expect(creates[0][2]).toMatchObject({ pipeline_mode: "full", default_face_id: "stock-face" });
    const calls = deps.client.call.mock.calls.filter((c: any[]) => c[0] === "/conversations");
    expect(calls).toHaveLength(2);
    expect(calls[0][2]).toMatchObject({
      pal_id: "p1", conversational_context: "unique persona and scenario", require_auth: true,
      properties: { languages: ["ko"], participant_left_timeout: 20, enable_recording: false },
    });
    expect(one).toEqual({ state: "active", conversationUrl: "https://tavus.daily.co/room?t=short-lived-room-token" });
  });

  it("requires explicit consent and current owner before any provider call", async () => {
    await expect(service.start("owner", "run", false)).rejects.toMatchObject({ code: "tavus_consent_required" });
    await expect(service.start("other", "run", true)).rejects.toMatchObject({ status: 403 });
    expect(deps.client.call).not.toHaveBeenCalled();
  });
  it("reads ordinary session status and ends known rooms without resolving mutable scenario authoring", async () => {
    deps.resolve.mockRejectedValue(new Error("scenario was edited or removed"));
    expect(await service.session("owner", "ordinary-run")).toEqual({ state: "idle" });
    rows.set("run:existing", { userId: "owner", runId: "existing", state: "active", conversationId: "c1" });
    expect(await service.end("owner", "existing")).toEqual({ state: "transcript_pending" });
    expect(deps.resolve).not.toHaveBeenCalled();
  });

  it("reports the missing router contract instead of falling back to direct Tavus or Gemini", async () => {
    deps.availability.mockReturnValue({ available: false, blockers: ["avatar_router_full_pipeline_contract_required"] });
    service = new TavusSessions(deps);
    expect(await service.config()).toEqual({
      available: false, blockers: ["avatar_router_full_pipeline_contract_required"],
    });
    await expect(service.start("owner", "run", true)).rejects.toMatchObject({ code: "tavus_not_configured" });
    expect(deps.client.call).not.toHaveBeenCalled();
  });

  it("does not create another billable conversation on repeated start", async () => {
    await service.start("owner", "run", true);
    await service.start("owner", "run", true);
    expect(deps.client.call.mock.calls.filter((c: any[]) => c[0] === "/conversations")).toHaveLength(1);
  });

  it("commits a create fence before request and never retries an uncertain create", async () => {
    deps.client.call.mockImplementation(async (path: string) => {
      if (path === "/pals") return { pal_id: "p1" };
      expect(rows.get("run:run").state).toBe("creating");
      throw new TavusError("tavus_request_uncertain", 502);
    });
    await expect(service.start("owner", "run", true)).rejects.toMatchObject({ code: "tavus_request_uncertain" });
    expect(await service.start("owner", "run", true)).toMatchObject({ state: "create_unknown" });
    expect(deps.client.call.mock.calls.filter((c: any[]) => c[0] === "/conversations")).toHaveLength(1);
  });

  it("ends before importing official final transcript and queues feedback only once", async () => {
    await service.start("owner", "run", true);
    expect(deps.importTranscript).not.toHaveBeenCalled();
    expect(await service.end("owner", "run")).toEqual({ state: "transcript_pending" });
    const final = await service.sync("owner", "run");
    expect(final).toMatchObject({ state: "completed", messages: [
      { sender: "ai", message: "어떤 제안인가요?" },
      { sender: "user", message: "납기를 먼저 협의하고 싶습니다." },
    ] });
    expect(deps.importTranscript).toHaveBeenCalledTimes(1);
    await service.sync("owner", "run");
    await service.end("owner", "run");
    expect(deps.importTranscript).toHaveBeenCalledTimes(1);
    expect(deps.client.call.mock.calls.filter((c: any[]) => c[0].endsWith("/end"))).toHaveLength(1);
    expect(final).not.toHaveProperty("conversationUrl");
  });

  it("waits for transcription_ready and does not evaluate interim or unavailable text", async () => {
    await service.start("owner", "run", true);
    await service.end("owner", "run");
    deps.client.call.mockResolvedValue({ conversation_id: "c1", status: "ended", events: [] });
    expect(await service.sync("owner", "run")).toEqual({ state: "transcript_pending" });
    expect(deps.importTranscript).not.toHaveBeenCalled();
  });

  it("retains provider ID for cleanup if a returned room URL is untrusted", async () => {
    deps.client.call.mockImplementation(async (path: string) => path === "/pals" ? { pal_id: "p1" } : {
      conversation_id: "c1", conversation_url: "https://evil.example/room",
    });
    await expect(service.start("owner", "run", true)).rejects.toMatchObject({ code: "tavus_untrusted_room_url" });
    expect(rows.get("run:run")).toMatchObject({ state: "ending", conversationId: "c1" });
  });

  it("keeps cleanup pending on end failure", async () => {
    await service.start("owner", "run", true);
    deps.client.call.mockRejectedValue(new TavusError("tavus_upstream_503", 502));
    await expect(service.end("owner", "run")).rejects.toMatchObject({ status: 502 });
    expect(rows.get("run:run").state).toBe("ending");
  });

  it("validates an explicitly configured PAL as full rather than patching it", async () => {
    deps.env.TAVUS_PAL_ID = "fixed-pal";
    await service.start("owner", "run", true);
    expect(deps.client.call.mock.calls.map((c: any[]) => c[0])).toEqual(["/pals/fixed-pal", "/conversations"]);
  });
});

describe("Tavus HTTP boundary", () => {
  it("never makes direct provider requests for reads, PAL creation, conversations or end", async () => {
    const request = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("must not call"));
    try {
      const client = new TavusClient();
      for (const [path, body] of [
        ["/pals", { pipeline_mode: "full" }], ["/pals/shared", undefined],
        ["/conversations", {}], ["/conversations/session/end", {}],
      ] as const) {
        await expect(client.call(path, createdPalSchema, body)).rejects.toMatchObject({
          code: "avatar_router_full_pipeline_contract_required", status: 503,
        });
      }
      expect(request).not.toHaveBeenCalled();
    } finally { request.mockRestore(); }
  });

  it("rejects insecure room URLs and URL credentials", () => {
    for (const url of ["http://tavus.daily.co/x", "https://daily.co.evil.example/x", "https://user:pw@tavus.daily.co/x"]) {
      expect(() => conversationJoinUrl({ conversation_id: "c", conversation_url: url })).toThrow("tavus_untrusted_room_url");
    }
  });
});
