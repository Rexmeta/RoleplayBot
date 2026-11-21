import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Router, type Request, type RequestHandler } from "express";
import { z } from "zod";
import { GUEST_MESSAGE_MAX_LENGTH, type GuestProgress } from "@shared/guestDemo";
import { resolveConversationLanguage } from "@shared/conversationLanguage";
import { generateAIResponse } from "../services/aiServiceFactory";
import { guestDemoScenarios } from "../services/guestDemoScenarios";
import { GUEST_SESSION_MS, guestDemoStore, type GuestSession } from "../services/guestDemoStore";

const COOKIE = "roleplay_guest";
const cookieScope = { httpOnly: true, sameSite: "strict", path: "/api" } as const;
const turnInput = z.object({
  message: z.string().trim().min(1).max(GUEST_MESSAGE_MAX_LENGTH),
  turns: z.number().int().min(0).max(10),
}).strict();
const selectionInput = z.object({ scenarioId: z.string().min(1).max(250) }).strict();
const sessionKey = (token: string) => createHash("sha256").update(token).digest("hex");

class GuestError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

const handler = (fn: (req: Request, res: Parameters<RequestHandler>[1]) => Promise<unknown>): RequestHandler =>
  (req, res) => {
    res.set("Cache-Control", "no-store");
    if (req.method === "POST" && req.get("Sec-Fetch-Site") === "cross-site") {
      res.status(403).json({ code: "guest_cross_site" });
      return;
    }
    fn(req, res).catch(error => {
      if (error instanceof GuestError) res.status(error.status).json({ code: error.code });
      else {
        console.error("[guest-demo] Request failed", req.method, req.path);
        res.status(503).json({ code: "guest_unavailable" });
      }
    });
  };

function getKey(req: Request) {
  const token: unknown = req.cookies?.[COOKIE];
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token) ? sessionKey(token) : null;
}

function progress(session: GuestSession): GuestProgress | null {
  return session.progress ? {
    scenario: session.progress.scenario, messages: session.messages,
    turnLimit: session.progress.turnLimit, turns: session.messages.length / 2,
  } : null;
}

export default function createGuestDemoRouter(deps = {
  store: guestDemoStore, scenarios: guestDemoScenarios, reply: generateAIResponse,
}) {
  const router = Router();

  async function owned(req: Request) {
    const key = getKey(req);
    const session = key && await deps.store.read(key);
    if (!key || !session) throw new GuestError(401, "guest_session_required");
    return { key, session };
  }

  router.post("/api/auth/guest-login", handler(async (req, res) => {
    const key = getKey(req);
    if (key && await deps.store.read(key)) return res.json({ success: true });

    const token = randomBytes(32).toString("base64url");
    const saved = await deps.store.create(sessionKey(token), {
      expiresAt: Date.now() + GUEST_SESSION_MS, attempts: 0, messages: [],
      language: resolveConversationLanguage(null, null,
        typeof req.body?.language === "string" ? req.body.language.split("-")[0] : undefined),
    });
    if (!saved) throw new GuestError(429, "guest_busy");
    res.cookie(COOKIE, token, { ...cookieScope, secure: process.env.NODE_ENV === "production", maxAge: GUEST_SESSION_MS });
    return res.json({ success: true });
  }));

  router.get("/api/guest/demo", handler(async (req, res) => {
    const { session } = await owned(req);
    return res.json({ scenarios: session.progress ? [] : await deps.scenarios.list(), progress: progress(session) });
  }));

  router.post("/api/guest/demo/scenario", handler(async (req, res) => {
    const { key } = await owned(req);
    const input = selectionInput.safeParse(req.body);
    if (!input.success) throw new GuestError(400, "guest_invalid_input");
    const demo = await deps.scenarios.get(input.data.scenarioId);
    if (!demo) throw new GuestError(404, "guest_scenario_unavailable");
    const result = await deps.store.mutate(key, session => {
      if (session.progress && session.progress.scenario.id !== demo.summary.id) {
        throw new GuestError(409, "guest_trial_started");
      }
      session.progress ??= { scenario: demo.summary, actorId: demo.actor.id, turnLimit: demo.turnLimit };
      return progress(session);
    });
    if (!result) throw new GuestError(401, "guest_session_required");
    return res.json(result);
  }));

  router.post("/api/guest/demo/message", handler(async (req, res) => {
    const { key, session } = await owned(req);
    const input = turnInput.safeParse(req.body);
    if (!input.success) throw new GuestError(400, "guest_invalid_input");
    if (!session.progress) throw new GuestError(409, "guest_choose_scenario");
    const demo = await deps.scenarios.get(session.progress.scenario.id);
    if (!demo || demo.actor.id !== session.progress.actorId) throw new GuestError(404, "guest_scenario_unavailable");
    const token = randomUUID();
    const claimed = await deps.store.mutate(key, state => {
      if (!state.progress) throw new GuestError(409, "guest_choose_scenario");
      if (state.pending && state.pending.until > Date.now()) throw new GuestError(409, "guest_turn_pending");
      if (state.messages.length / 2 !== input.data.turns) throw new GuestError(409, "guest_turn_changed");
      if (state.messages.length / 2 >= state.progress.turnLimit || state.attempts >= state.progress.turnLimit + 5) {
        throw new GuestError(429, "guest_limit");
      }
      state.pending = { token, until: Date.now() + 90_000 };
      return { messages: state.messages, language: state.language };
    });
    if (!claimed) throw new GuestError(401, "guest_session_required");

    try {
      if (!await deps.store.allowTurn()) throw new GuestError(429, "guest_busy");
      const ready = await deps.store.mutate(key, state => {
        if (state.pending?.token !== token) return false;
        state.attempts++;
        return true;
      });
      if (!ready) throw new GuestError(409, "guest_turn_changed");
      const reply = await deps.reply(demo.scenario, claimed.messages, {
        id: demo.actor.id, name: demo.actor.name, role: demo.summary.partner.role,
        personality: demo.actor.stance || "",
        responseStyle: demo.actor.stance || "",
        goals: [demo.actor.goal].filter(Boolean),
        background: demo.actor.experience || "",
      }, input.data.message, claimed.language);
      const content = reply.content.trim();
      if (!content) throw new GuestError(503, "guest_reply_failed");

      const result = await deps.store.mutate(key, state => {
        if (state.pending?.token !== token || state.pending.until <= Date.now()) return null;
        state.messages.push(
          { sender: "user", message: input.data.message, timestamp: new Date().toISOString() },
          { sender: "ai", message: content.slice(0, 4000), timestamp: new Date().toISOString() },
        );
        delete state.pending;
        return progress(state);
      });
      if (!result) throw new GuestError(409, "guest_turn_changed");
      return res.json(result);
    } finally {
      await deps.store.mutate(key, state => {
        if (state.pending?.token === token) delete state.pending;
      }).catch(() => { /* lease expires if the store is temporarily unavailable */ });
    }
  }));

  return router;
}
