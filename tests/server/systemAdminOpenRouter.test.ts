import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { upsertSystemSetting } = vi.hoisted(() => ({
  upsertSystemSetting: vi.fn(async (setting: any) => ({
    id: "setting-1",
    ...setting,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })),
}));

vi.mock("../../server/storage", () => ({
  storage: { upsertSystemSetting },
}));

vi.mock("../../server/middleware/authMiddleware", () => ({
  isSystemAdmin: (_req: any, _res: any, next: any) => next(),
}));

import createSystemAdminRouter from "../../server/routes/systemAdmin";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = { id: "admin-1", role: "admin" };
    next();
  });
  app.use("/api/system-admin", createSystemAdminRouter((_req: any, _res: any, next: any) => next()));
  app.use((error: any, _req: any, res: any, _next: any) => {
    res.status(error.status || 500).json({ error: error.message });
  });
  return app;
}

describe("OpenRouter system admin controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_BASE_URL;
  });

  it("persists an explicit provider/model policy", async () => {
    const response = await request(makeApp()).put("/api/system-admin/settings").send({
      category: "ai",
      key: "model_conversation",
      value: { provider: "openrouter", model: "anthropic/claude-3.5-sonnet" },
    });

    expect(response.status).toBe(200);
    expect(upsertSystemSetting).toHaveBeenCalledWith(expect.objectContaining({
      category: "ai",
      key: "model_conversation",
      value: JSON.stringify({ provider: "openrouter", model: "anthropic/claude-3.5-sonnet" }),
    }));
  });

  it("rejects OpenRouter for realtime and media features", async () => {
    for (const key of ["model_realtime", "model_image", "model_video", "model_avatar_video"]) {
      const response = await request(makeApp()).put("/api/system-admin/settings").send({
        category: "ai",
        key,
        value: { provider: "openrouter", model: "openai/gpt-4o-mini" },
      });
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).toMatch(/OpenRouter does not support|realtime model/i);
    }
  });

  it("reports credential status without exposing a secret", async () => {
    process.env.OPENROUTER_API_KEY = "secret-that-must-not-appear";
    process.env.OPENROUTER_BASE_URL = "https://router.example/v1?token=do-not-display";
    const response = await request(makeApp()).get("/api/system-admin/api-keys-status");

    expect(response.status).toBe(200);
    expect(response.body.openrouter).toBe(true);
    expect(response.body.openrouterBaseUrl).toBe("https://router.example/v1");
    expect(JSON.stringify(response.body)).not.toContain("secret-that-must-not-appear");
    expect(JSON.stringify(response.body)).not.toContain("do-not-display");
  });

  it("maps a missing deployment credential to a sanitized probe result", async () => {
    const response = await request(makeApp()).post("/api/system-admin/openrouter-connection-check");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "credential",
      message: expect.stringContaining("OPENROUTER_API_KEY"),
    });
  });
});