import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
vi.mock("../../server/services/tavus/sessions", () => ({ tavusSessions: {} }));
vi.mock("../../server/middleware/authMiddleware", () => ({
  isSystemAdmin: (req: any, res: any, next: any) =>
    req.user.role === "admin" ? next() : res.status(403).json({ code: "admin_required" }),
}));
import createTavusRouter from "../../server/routes/tavus";
import { TavusError } from "../../server/services/tavus/client";

let service: any;
beforeEach(() => {
  service = {
    config: vi.fn(async () => ({ available: true, blockers: [] })),
    connection: vi.fn(async (user: string) => {
      if (user !== "owner") throw new TavusError("tavus_conversation_forbidden", 403);
      return { transport: "daily", pipeline: "tavus_full", url: "https://room.daily.co/private", token: "ephemeral" };
    }),
    session: vi.fn(async (user: string) => {
      if (user !== "owner") throw new TavusError("tavus_conversation_forbidden", 403);
      return { state: "idle" };
    }),
    start: vi.fn(async () => ({ state: "active", conversationUrl: "https://tavus.daily.co/private" })),
    end: vi.fn(async () => ({ state: "transcript_pending" })),
    sync: vi.fn(async () => ({ state: "completed" })),
    ensurePal: vi.fn(async () => "pal-1"),
    videoPlaying: vi.fn(async (user: string) => {
      if (user !== "owner") throw new TavusError("tavus_conversation_forbidden", 403);
      return { state: "active" };
    }),
  };
});
function app() {
  const application = express();
  application.use(express.json());
  application.use("/api/tavus", createTavusRouter((req: any, res: any, next: any) => {
    const id = req.get("x-user");
    if (!id) return res.status(401).end();
    req.user = { id, role: req.get("x-role") ?? "user" };
    next();
  }, service));
  return application;
}

describe("Tavus authenticated routes", () => {
  it("reports video only through authenticated same-origin, strictly validated requests", async () => {
    const path = "/api/tavus/conversations/run/video-playing";
    await request(app()).post(path).send({ event: "video_frame_presented" }).expect(401);
    await request(app()).post(path).set("x-user", "other").send({ event: "video_frame_presented" }).expect(403);
    for (const body of [{}, { event: "connected" }, { event: "video_frame_presented", timestamp: "forged" },
      { event: "video_frame_presented", tenantId: "foreign" }]) {
      await request(app()).post(path).set("x-user", "owner").send(body).expect(400);
    }
    await request(app()).post(path).set("x-user", "owner").set("Host", "app.example")
      .set("Origin", "https://foreign.example").send({ event: "video_frame_presented" }).expect(403);
    const result = await request(app()).post(path).set("x-user", "owner").set("Host", "app.example")
      .set("Origin", "https://app.example").send({ event: "video_frame_presented" }).expect(200);
    expect(result.headers["cache-control"]).toBe("private, no-store");
    expect(service.videoPlaying).toHaveBeenLastCalledWith("owner", "run", { event: "video_frame_presented" });
    for (const method of ["connection", "start", "end", "sync"]) expect(service[method]).not.toHaveBeenCalled();
  });
  it("requires login for config and room access", async () => {
    await request(app()).get("/api/tavus/config").expect(401);
    await request(app()).get("/api/tavus/conversations/run/session").expect(401);
    expect(service.config).not.toHaveBeenCalled();
  });
  it("returns Daily credentials only through an authenticated no-store owner route", async () => {
    await request(app()).get("/api/tavus/conversations/run/connection").expect(401);
    await request(app()).get("/api/tavus/conversations/run/connection").set("x-user", "other").expect(403);
    const result = await request(app()).get("/api/tavus/conversations/run/connection").set("x-user", "owner").expect(200);
    expect(result.headers["cache-control"]).toBe("private, no-store");
    expect(service.connection).toHaveBeenCalledWith("owner", "run");
    await request(app()).get("/api/tavus/config?runId=run").set("x-user", "owner").expect(200);
    expect(service.config).toHaveBeenCalledWith("owner", "run");
  });
  it("does not expose another user's session or bypass ownership for admin", async () => {
    const result = await request(app()).get("/api/tavus/conversations/run/session")
      .set("x-user", "other").set("x-role", "admin").expect(403);
    expect(result.body.code).toBe("tavus_conversation_forbidden");
  });
  it("reads an owned cleanup status without issuing connection credentials or writes", async () => {
    service.session.mockResolvedValueOnce({ state: "ended", id: "owned", rendererState: "closed", cleanupPending: false });
    const result = await request(app()).get("/api/tavus/conversations/run/session").set("x-user", "owner").expect(200);
    expect(result.headers["cache-control"]).toBe("private, no-store");
    expect(result.body).toEqual({ state: "ended", id: "owned", rendererState: "closed", cleanupPending: false });
    expect(service.session).toHaveBeenCalledWith("owner", "run");
    for (const method of ["connection", "start", "end", "sync"]) expect(service[method]).not.toHaveBeenCalled();
  });
  it("rejects absent consent and all client-supplied persona/context/provider IDs", async () => {
    for (const body of [{}, { consent: false }, { consent: true, pal_id: "foreign" },
      { consent: true, conversational_context: "replace role" }]) {
      await request(app()).post("/api/tavus/conversations/run/start").set("x-user", "owner").send(body).expect(400);
    }
    expect(service.start).not.toHaveBeenCalled();
  });
  it("accepts same-origin HTTPS through an HTTP proxy, and rejects cross-origin writes", async () => {
    const result = await request(app()).post("/api/tavus/conversations/run/start")
      .set("Host", "app.example").set("Origin", "https://app.example")
      .set("x-user", "owner").send({ consent: true }).expect(200);
    expect(result.headers["cache-control"]).toBe("private, no-store");
    expect(service.start).toHaveBeenCalledWith("owner", "run", true);
    await request(app()).post("/api/tavus/conversations/run/end")
      .set("Host", "app.example").set("Origin", "https://other.example")
      .set("x-user", "owner").send({}).expect(403);
    expect(service.end).not.toHaveBeenCalled();
  });
  it("limits common PAL initialization to system admins", async () => {
    await request(app()).post("/api/tavus/pal").set("x-user", "owner").send({}).expect(403);
    const result = await request(app()).post("/api/tavus/pal")
      .set("x-user", "owner").set("x-role", "admin").send({}).expect(200);
    expect(result.body).toEqual({ palId: "pal-1" });
  });
  it("marks only confirmed pre-create refusals as safe to retry", async () => {
    service.start.mockRejectedValueOnce(new TavusError("avatar_runtime_worker_unavailable", 409, {
      creationAttempted: false, blockers: ["avatar_runtime_worker_unavailable"],
    }));
    const blocked = await request(app()).post("/api/tavus/conversations/run/start")
      .set("x-user", "owner").send({ consent: true }).expect(409);
    expect(blocked.body).toMatchObject({ code: "avatar_runtime_worker_unavailable", creationAttempted: false });
    service.start.mockRejectedValueOnce(new TavusError("tavus_create_uncertain", 502));
    const uncertain = await request(app()).post("/api/tavus/conversations/run/start")
      .set("x-user", "owner").send({ consent: true }).expect(502);
    expect(uncertain.body).not.toHaveProperty("creationAttempted");
  });
  it("routes end and sync to the actual run owner without arbitrary provider IDs", async () => {
    await request(app()).post("/api/tavus/conversations/run/end").set("x-user", "owner").send({}).expect(200);
    await request(app()).post("/api/tavus/conversations/run/sync").set("x-user", "owner").send({}).expect(200);
    expect(service.end).toHaveBeenCalledWith("owner", "run");
    expect(service.sync).toHaveBeenCalledWith("owner", "run");
  });
});
