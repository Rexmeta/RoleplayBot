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
    session: vi.fn(async (user: string) => {
      if (user !== "owner") throw new TavusError("tavus_conversation_forbidden", 403);
      return { state: "idle" };
    }),
    start: vi.fn(async () => ({ state: "active", conversationUrl: "https://tavus.daily.co/private" })),
    end: vi.fn(async () => ({ state: "transcript_pending" })),
    sync: vi.fn(async () => ({ state: "completed" })),
    ensurePal: vi.fn(async () => "pal-1"),
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
  it("requires login for config and room access", async () => {
    await request(app()).get("/api/tavus/config").expect(401);
    await request(app()).get("/api/tavus/conversations/run/session").expect(401);
    expect(service.config).not.toHaveBeenCalled();
  });
  it("does not expose another user's session or bypass ownership for admin", async () => {
    const result = await request(app()).get("/api/tavus/conversations/run/session")
      .set("x-user", "other").set("x-role", "admin").expect(403);
    expect(result.body.code).toBe("tavus_conversation_forbidden");
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
    expect(result.headers["cache-control"]).toBe("no-store");
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
  it("routes end and sync to the actual run owner without arbitrary provider IDs", async () => {
    await request(app()).post("/api/tavus/conversations/run/end").set("x-user", "owner").send({}).expect(200);
    await request(app()).post("/api/tavus/conversations/run/sync").set("x-user", "owner").send({}).expect(200);
    expect(service.end).toHaveBeenCalledWith("owner", "run");
    expect(service.sync).toHaveBeenCalledWith("owner", "run");
  });
});
