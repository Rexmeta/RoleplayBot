import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { GuestDemoStore, GuestSession } from "../../server/services/guestDemoStore";
import type { guestDemoScenarios } from "../../server/services/guestDemoScenarios";
import type { generateAIResponse } from "../../server/services/aiServiceFactory";

vi.mock("../../server/services/guestDemoStore", () => ({ GUEST_SESSION_MS: 86_400_000, guestDemoStore: {} }));
vi.mock("../../server/services/guestDemoScenarios", () => ({ guestDemoScenarios: {} }));
vi.mock("../../server/services/aiServiceFactory", () => ({ generateAIResponse: vi.fn() }));
vi.mock("../../server/storage", () => ({ storage: { getUser: vi.fn() } }));
vi.mock("../../server/redisClient", () => ({ redis: null, redisAvailable: false }));

import createGuestDemoRouter from "../../server/routes/guestDemo";
import { isAuthenticated, setupAuth } from "../../server/auth";

const summary = { id: "demo", title: "First day", description: "Ask for help", situation: "You joined the team.", partner: { name: "Team lead", role: "Engineering" } };
const actor = { id: "team-lead", name: "Team lead", department: "Engineering", position: "Lead", experience: "5y", personaRef: "entj", stance: "Helpful", goal: "Identify the blocker", tradeoff: "" };
const demo = { summary, actor, scenario: { id: summary.id, title: summary.title, description: summary.description, difficulty: 2, context: undefined, objectives: undefined, personas: [actor], targetTurns: 3 }, turnLimit: 3 };

function fixture(reply = vi.fn<typeof generateAIResponse>().mockResolvedValue({ content: "Which step are you stuck on?", emotion: "neutral", emotionReason: "" })) {
  const sessions = new Map<string, GuestSession>();
  const controls = { startsAllowed: true, turnsAllowed: true };
  const store: GuestDemoStore = {
    read: async key => {
      const value = sessions.get(key);
      return value && value.expiresAt > Date.now() ? structuredClone(value) : null;
    },
    async create(key, session) {
      if (!controls.startsAllowed) return false;
      sessions.set(key, structuredClone(session));
      return true;
    },
    async mutate(key, update) {
      const value = sessions.get(key);
      if (!value || value.expiresAt <= Date.now()) return null;
      const next = structuredClone(value);
      const result = update(next);
      sessions.set(key, next);
      return structuredClone(result);
    },
    allowTurn: async () => controls.turnsAllowed,
  };
  const scenarios: typeof guestDemoScenarios = {
    list: async () => [summary],
    get: async id => id === "demo" ? demo : null,
  };
  const app = express();
  app.use(express.json(), cookieParser());
  setupAuth(app);
  app.use(createGuestDemoRouter({ store, scenarios, reply }));
  app.get("/api/member-only", isAuthenticated, (_req, res) => { res.sendStatus(200); });
  return { app, sessions, reply, controls };
}

describe("account-free guest trial", () => {
  it("creates a separate cookie and does not sign the visitor into member or admin routes", async () => {
    const { app, sessions } = fixture();
    const browser = request.agent(app);
    expect((await browser.get("/api/guest/demo")).status).toBe(401);
    const response = await browser.post("/api/auth/guest-login").send({ language: "en-US" });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(response.headers["set-cookie"][0]).toMatch(/^roleplay_guest=[A-Za-z0-9_-]{43};.*Path=\/api;.*HttpOnly;.*SameSite=Strict/i);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect([...sessions.values()][0].language).toBe("en");
    expect((await browser.get("/api/auth/user")).status).toBe(401);
    expect((await browser.get("/api/member-only")).status).toBe(401);
    expect((await browser.get("/api/guest/demo")).body).toEqual({ scenarios: [summary], progress: null });
    expect((await browser.post("/api/auth/guest-login").send({})).headers["set-cookie"]).toBeUndefined();
    expect(sessions.size).toBe(1);
  });

  it("keeps a completed trial and its transcript private without blocking or populating another trial", async () => {
    const { app, reply } = fixture();
    const a = request.agent(app);
    const b = request.agent(app);
    await a.post("/api/auth/guest-login").send({ language: "en" });
    expect((await a.post("/api/guest/demo/scenario").send({ scenarioId: "demo" })).status).toBe(200);
    for (let turns = 0; turns < 3; turns++) {
      const response = await a.post("/api/guest/demo/message").send({ message: "My blocker", turns });
      expect(response.status).toBe(200);
      expect(response.body.turns).toBe(turns + 1);
    }
    expect((await a.post("/api/guest/demo/message").send({ message: "One more", turns: 3 })).body.code).toBe("guest_limit");
    expect((await a.get("/api/guest/demo")).body.progress.messages).toHaveLength(6);
    expect(reply.mock.calls[1][1]).toHaveLength(2);
    expect(reply.mock.calls[1][4]).toBe("en");
    expect((await b.post("/api/auth/guest-login").send({})).status).toBe(200);
    expect((await b.get("/api/guest/demo")).body).toEqual({ scenarios: [summary], progress: null });
    const other = await b.post("/api/guest/demo/scenario").send({ scenarioId: "demo" });
    expect(other.body.messages).toEqual([]);
    expect(reply).toHaveBeenCalledTimes(3);
  });

  it("rejects out-of-scope demos and malformed input without invoking AI", async () => {
    const { app, reply } = fixture();
    const browser = request.agent(app);
    const denied = await browser.post("/api/auth/guest-login").set("Sec-Fetch-Site", "cross-site").send({});
    expect(denied.status).toBe(403);
    await browser.post("/api/auth/guest-login").send({});
    expect((await browser.post("/api/guest/demo/scenario").send({ scenarioId: "private-demo" })).status).toBe(404);
    expect((await browser.post("/api/guest/demo/message").send({ message: "Hello", turns: 0 })).status).toBe(409);
    await browser.post("/api/guest/demo/scenario").send({ scenarioId: "demo" });
    expect((await browser.post("/api/guest/demo/message").send({ message: "x".repeat(1001), turns: 0 })).status).toBe(400);
    expect((await browser.post("/api/guest/demo/message").send({ message: "hello", turns: 0, scenarioId: "private-demo" })).status).toBe(400);
    expect(reply).not.toHaveBeenCalled();
  });

  it("rejects duplicate in-flight turns and preserves the last successful reply after retry", async () => {
    let resolveReply: (value: Awaited<ReturnType<typeof generateAIResponse>>) => void = () => {};
    const reply = vi.fn<typeof generateAIResponse>()
      .mockImplementationOnce(() => new Promise(resolve => { resolveReply = resolve; }));
    const { app } = fixture(reply);
    const browser = request.agent(app);
    await browser.post("/api/auth/guest-login").send({});
    await browser.post("/api/guest/demo/scenario").send({ scenarioId: "demo" });
    const first = browser.post("/api/guest/demo/message").send({ message: "Hello", turns: 0 }).then(response => response);
    try {
      await vi.waitFor(() => expect(reply).toHaveBeenCalledOnce());
      expect((await browser.post("/api/guest/demo/message").send({ message: "Hello", turns: 0 })).body.code).toBe("guest_turn_pending");
    } finally {
      resolveReply({ content: "Hello to you", emotion: "neutral", emotionReason: "" });
    }
    expect((await first).status).toBe(200);
    expect((await browser.post("/api/guest/demo/message").send({ message: "Hello", turns: 0 })).body.code).toBe("guest_turn_changed");
    expect((await browser.get("/api/guest/demo")).body.progress.messages).toHaveLength(2);
    expect(reply).toHaveBeenCalledOnce();
  });

  it("does not spend a model call when the budget is exhausted and permits a retry after provider failure", async () => {
    const { app, reply, controls } = fixture();
    const browser = request.agent(app);
    controls.startsAllowed = false;
    expect((await browser.post("/api/auth/guest-login").send({})).status).toBe(429);
    controls.startsAllowed = true;
    await browser.post("/api/auth/guest-login").send({});
    await browser.post("/api/guest/demo/scenario").send({ scenarioId: "demo" });
    const payload = { message: "Hello", turns: 0 };
    controls.turnsAllowed = false;
    expect((await browser.post("/api/guest/demo/message").send(payload)).status).toBe(429);
    expect(reply).not.toHaveBeenCalled();
    controls.turnsAllowed = true;
    reply.mockRejectedValueOnce(new Error("provider timeout"));
    expect((await browser.post("/api/guest/demo/message").send(payload)).status).toBe(503);
    expect((await browser.get("/api/guest/demo")).body.progress.turns).toBe(0);
    expect((await browser.post("/api/guest/demo/message").send(payload)).status).toBe(200);
  });
});
