import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
vi.mock("../../server/storage", () => ({ storage: {} }));
import { AdminAvatarTestService } from "../../server/services/liveAvatar/adminTestService";
import { PersonaAvatarValidationService } from "../../server/services/liveAvatar/personaValidation";
import { createLiveAvatarTestRouter } from "../../server/routes/liveAvatarTest";
import { createPersonaAvatarOperationsRouter } from "../../server/routes/personaAvatarOperations";
import { isOperatorOrAdmin } from "../../server/middleware/authMiddleware";

const assetId = "12345678-1234-4234-8234-123456789abc";
const otherAsset = "22345678-1234-4234-8234-123456789abc";
const timing = { routerElapsedSeconds: 26, clientVideoReportedAt: "2026-11-13T00:00:09Z",
  preparationSeconds: 9, connectedSeconds: 17, evidence: "authenticated_client_report" };
function fixture(kind: "stock" | "anam" | "custom") {
  let row: any = {
    id: "owned-session", providerId: kind === "anam" ? "anam" : "tavus",
    avatarId: kind === "anam" ? "anam-persona-default" : kind === "stock" ? "tavus-stock-lucy" : "custom-replica",
    mode: "live", status: "active", rendererState: "running", stopRequested: false,
    cleanupPending: false, expiresAt: "2099-01-01T00:00:00Z", timing,
    ...(kind === "anam" ? { pipeline: "anam_full" } : {}),
    ...(kind === "custom" ? { avatarAssetId: assetId, purpose: "validation" } : {}),
  };
  const client = { call: vi.fn(async (_user, _path, schema) => schema.parse(row)) };
  const service = new AdminAvatarTestService(client as any, undefined, undefined, undefined, undefined, undefined, kind === "anam");
  const validation = new PersonaAvatarValidationService(client as any, undefined, new Map());
  const app = express(); app.use(express.json());
  app.use((req: any, res, next) => {
    if (!req.headers["x-role"]) { res.sendStatus(401); return; }
    req.user = { id: "authenticated-user", role: req.headers["x-role"] }; next();
  });
  if (kind === "custom") app.use("/custom", isOperatorOrAdmin, createPersonaAvatarOperationsRouter(undefined, validation));
  else app.use("/test", createLiveAvatarTestRouter(service));
  const path = kind === "custom" ? `/custom/assets/${assetId}/validation/sessions/owned-session/video-playing` : "/test/sessions/owned-session/video-playing";
  const send = (body: unknown, role = "admin", target = path) => request(app).post(target).set("x-role", role).send(body);
  return { app, path, send, client, patch: (patch: object) => { row = { ...row, ...patch }; } };
}
describe.each(["stock", "anam", "custom"] as const)("%s first-frame proxy contract", kind => {
  it("requires login and the existing route role before any upstream call", async () => {
    const f = fixture(kind);
    expect((await request(f.app).post(f.path).send({ event: "video_frame_presented" })).status).toBe(401);
    expect((await f.send({ event: "video_frame_presented" }, "user")).status).toBe(403);
    if (kind !== "custom") expect((await f.send({ event: "video_frame_presented" }, "operator")).status).toBe(403);
    expect(f.client.call).not.toHaveBeenCalled();
  });
  it("rejects timestamps, durations and browser-supplied identity/credentials", async () => {
    const f = fixture(kind);
    for (const body of [{}, { event: "connected" }, { event: "video_frame_presented", timestamp: "2020-01-01" },
      { event: "video_frame_presented", userId: "foreign" }, { event: "video_frame_presented", tenantId: "foreign" },
      { event: "video_frame_presented", durationSeconds: 600 }, { event: "video_frame_presented", apiKey: "fake" }]) {
      expect((await f.send(body)).status).toBe(400);
    }
    expect(f.client.call).not.toHaveBeenCalled();
  });
  it("forwards only the constant event for the bound session and preserves server timing", async () => {
    const f = fixture(kind);
    const response = await f.send({ event: "video_frame_presented" }, kind === "custom" ? "operator" : "admin");
    expect(response.status).toBe(200); expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.body.timing).toEqual(timing);
    expect(f.client.call.mock.calls.map(c => [c[0], c[1], c[3]])).toEqual([
      ["authenticated-user", "/sessions/owned-session", undefined],
      ["authenticated-user", "/sessions/owned-session/video-playing", { event: "video_frame_presented" }],
    ]);
    expect(JSON.stringify(response.body)).not.toContain("apiKey");
  });
  it("fails closed on an ID/provider/asset mismatch without a reporting POST", async () => {
    const f = fixture(kind); f.patch({ id: "foreign" });
    expect((await f.send({ event: "video_frame_presented" })).status).toBe(502);
    expect(f.client.call).toHaveBeenCalledTimes(1);
    f.client.call.mockClear();
    f.patch({ id: "owned-session", ...(kind === "custom" ? { avatarAssetId: otherAsset } : { providerId: "other-provider" }) });
    expect((await f.send({ event: "video_frame_presented" })).status).toBe(502);
    expect(f.client.call).toHaveBeenCalledTimes(1);
  });
  it("does not estimate timing for old rows or change a terminal cleanup state", async () => {
    const f = fixture(kind); f.patch({ timing: undefined, status: "ended", rendererState: "closed", stopRequested: true });
    const result = await f.send({ event: "video_frame_presented" });
    expect(result.status).toBe(200); expect(result.body.timing).toBeUndefined();
    expect(result.body).toMatchObject({ status: "ended", rendererState: "closed", stopRequested: true });
    expect(f.client.call.mock.calls.every(c => !/\/(end|interrupt|audio)$/.test(c[1]) && c[1] !== "/sessions")).toBe(true);
  });
});
