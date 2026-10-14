import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createConversationLedgerRouter } from "../../server/routes/conversationLedger";
import { LedgerError } from "../../server/services/conversationLedger/policy";

const service = vi.hoisted(() => ({
  read: vi.fn(), apply: vi.fn(), snapshot: vi.fn(),
}));
vi.mock("../../server/services/conversationLedger/service", () => ({
  readLedgerProjection: service.read, applyLedgerCommand: service.apply,
  readLedgerSnapshot: service.snapshot,
}));
vi.mock("../../server/routes/routerHelpers", () => ({
  asyncHandler: (work: any) => (req: any, res: any, next: any) => Promise.resolve(work(req, res, next)).catch(next),
  createHttpError: (status: number, message: string) => Object.assign(new Error(message), { status }),
  verifyPersonaRunOwnership: async (runId: string, userId: string, role?: string) => {
    if (runId !== "owned-run") throw Object.assign(new Error("not_found"), { status: 404 });
    if (userId !== "owner" && !["admin", "operator"].includes(role ?? "")) {
      throw Object.assign(new Error("not_owner"), { status: 403 });
    }
  },
}));

function application() {
  const app = express();
  app.use(express.json());
  app.use("/api/conversations/:id/ledger", createConversationLedgerRouter((req: any, res: any, next: any) => {
    const id = req.get("x-test-user");
    if (!id) return res.status(401).json({ error: "not_authenticated" });
    req.user = { id, role: req.get("x-test-role") ?? "user" };
    next();
  }));
  app.use((error: any, _req: any, res: any, _next: any) => res.status(error.status ?? 500).json({ error: error.message }));
  return app;
}

describe("ledger HTTP ownership and commit ACK boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.read.mockResolvedValue({ version: "legacy", cursor: 0, utterances: [] });
    service.apply.mockResolvedValue({ cursor: 1, duplicate: false });
    service.snapshot.mockResolvedValue({ id: "snapshot", blockedReasons: [] });
  });
  it("requires authentication and refuses other users before accessing storage", async () => {
    await request(application()).get("/api/conversations/owned-run/ledger").expect(401);
    await request(application()).get("/api/conversations/owned-run/ledger").set("x-test-user", "other").expect(403);
    expect(service.read).not.toHaveBeenCalled();
  });
  it("reads legacy projection without enrolling or mutating the run", async () => {
    const result = await request(application()).get("/api/conversations/owned-run/ledger").set("x-test-user", "owner").expect(200);
    expect(result.body.version).toBe("legacy");
    expect(service.read).toHaveBeenCalledWith("owned-run", 0);
    expect(service.apply).not.toHaveBeenCalled();
  });
  it("keeps admin/operator read access from becoming cross-user write access", async () => {
    for (const role of ["admin", "operator"]) {
      await request(application()).get("/api/conversations/owned-run/ledger").set("x-test-user", "other").set("x-test-role", role).expect(200);
      await request(application()).post("/api/conversations/owned-run/ledger/commands").set("x-test-user", "other").set("x-test-role", role).send({}).expect(403);
    }
    expect(service.apply).not.toHaveBeenCalled();
  });
  it("fixes the caller authority to client regardless of supplied role fields", async () => {
    const body = { eventId: "event", generation: 0, payload: {}, actor: "server" };
    await request(application()).post("/api/conversations/owned-run/ledger/commands").set("x-test-user", "owner").send(body).expect(200);
    expect(service.apply).toHaveBeenCalledWith("owned-run", body, "client");
  });
  it("does not return an ACK when the write transaction fails", async () => {
    service.apply.mockRejectedValueOnce(new LedgerError("injected_failure"));
    const result = await request(application()).post("/api/conversations/owned-run/ledger/commands").set("x-test-user", "owner").send({}).expect(409);
    expect(result.body).toEqual({ error: "injected_failure" });
    expect(result.body.ack).toBeUndefined();
  });
  it("rejects invalid cursor shapes and fences snapshot reads by run ownership", async () => {
    for (const cursor of ["-1", "NaN", "1.5", "9999999999999"]) {
      await request(application()).get(`/api/conversations/owned-run/ledger?after=${cursor}`).set("x-test-user", "owner").expect(400);
    }
    await request(application()).get("/api/conversations/owned-run/ledger/snapshots/snapshot").set("x-test-user", "other").expect(403);
    expect(service.snapshot).not.toHaveBeenCalled();
    await request(application()).get("/api/conversations/owned-run/ledger/snapshots/snapshot").set("x-test-user", "owner").expect(200);
    expect(service.snapshot).toHaveBeenCalledWith("owned-run", "snapshot");
  });
});
