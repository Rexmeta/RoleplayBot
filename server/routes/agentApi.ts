/**
 * Agent API Routes – Enterprise B2B REST API
 * All routes require Bearer <api_key> authentication via isAgentApiKey middleware.
 *
 * Rate limiting uses express-rate-limit with Redis store when REDIS_URL is set,
 * falling back to an in-memory store for single-instance / dev environments.
 */

import { Router } from "express";
import { randomUUID } from "crypto";
import { createHash } from "crypto";
import rateLimit from "express-rate-limit";
import { db } from "../storage";
import {
  agentKeyScenarios,
  agentSessions,
  agentIdempotencyKeys,
  agentUsageDaily,
  agentWebhooks,
  auditLogs,
  personaRuns,
} from "@shared/schema";
import { dispatchWebhook, encryptWebhookSecret } from "../services/webhookDelivery";
import { eq, and, lt, sql, gte, lte, inArray } from "drizzle-orm";
import {
  isAgentApiKey,
  requireScope,
  agentError,
  attachAgentRequestId,
} from "../middleware/agentApiKeyMiddleware";
import { fileManager } from "../services/fileManager";
import { generateAIResponse, generateStreamingAIResponse } from "../services/aiServiceFactory";
import { storage } from "../storage";
import { z } from "zod";
import {
  applySimulationPatch,
  getOrCreateSessionContext,
  getSessionState,
} from "../services/simulation/simulationEngine";
import { createDefaultSimulationState } from "../services/simulation/simulationTypes";
import { evaluateUserResponse } from "../services/simulation/evaluateUserResponse";
import { generateAndSaveFeedback } from "./routerHelpers";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

const SUPPORTED_LANGUAGES = ["ko", "en", "ja", "zh"] as const;
const AGENT_SESSION_INACTIVE_MINUTES = 30;
const AGENT_SESSION_MAX_HOURS = 24;
const IDEMPOTENCY_TTL_HOURS = 24;

function nowPlusHours(h: number): Date {
  const d = new Date();
  d.setHours(d.getHours() + h);
  return d;
}

function generateSessionId(): string {
  return `ags_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

function generateTurnId(sessionId: string, turn: number): string {
  return `${sessionId}-${turn}`;
}

function hashRequestBody(body: any): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

// Best-effort async: aggregate usage for dashboard
export async function incrementUsageDaily(
  organizationId: string,
  agentKeyId: string,
  params: { inputTokens?: number; outputTokens?: number; cachedTokens?: number; errorCount?: number; latencyMs?: number }
): Promise<void> {
  try {
    const date = new Date().toISOString().slice(0, 10);
    await db
      .insert(agentUsageDaily)
      .values({
        organizationId,
        agentKeyId,
        date,
        requestCount: 1,
        sessionCount: 0,
        inputTokens: params.inputTokens ?? 0,
        outputTokens: params.outputTokens ?? 0,
        totalTokens: (params.inputTokens ?? 0) + (params.outputTokens ?? 0),
        cachedTokens: params.cachedTokens ?? 0,
        errorCount: params.errorCount ?? 0,
        avgLatencyMs: params.latencyMs ?? null,
      })
      .onConflictDoUpdate({
        target: [agentUsageDaily.organizationId, agentUsageDaily.agentKeyId, agentUsageDaily.date],
        set: {
          requestCount: sql`${agentUsageDaily.requestCount} + 1`,
          inputTokens: sql`${agentUsageDaily.inputTokens} + ${params.inputTokens ?? 0}`,
          outputTokens: sql`${agentUsageDaily.outputTokens} + ${params.outputTokens ?? 0}`,
          totalTokens: sql`${agentUsageDaily.totalTokens} + ${(params.inputTokens ?? 0) + (params.outputTokens ?? 0)}`,
          cachedTokens: sql`${agentUsageDaily.cachedTokens} + ${params.cachedTokens ?? 0}`,
          errorCount: sql`${agentUsageDaily.errorCount} + ${params.errorCount ?? 0}`,
        },
      });
  } catch (err) {
    console.warn("[agentApi] Failed to increment usage_daily (non-fatal):", err);
  }
}

// Estimate token count from text length (~4 chars per token)
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

// Query today's aggregated usage for an API key
async function getUsageTodayForKey(agentKeyId: string): Promise<{
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
}> {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const rows = await db
      .select()
      .from(agentUsageDaily)
      .where(and(eq(agentUsageDaily.agentKeyId, agentKeyId), eq(agentUsageDaily.date, date)))
      .limit(1);
    if (rows.length === 0) return { requestCount: 0, inputTokens: 0, outputTokens: 0 };
    return {
      requestCount: rows[0].requestCount,
      inputTokens: rows[0].inputTokens,
      outputTokens: rows[0].outputTokens,
    };
  } catch {
    return { requestCount: 0, inputTokens: 0, outputTokens: 0 };
  }
}

// Check if an idempotency key exists and handle it
async function handleIdempotency(
  res: any,
  key: string,
  agentKeyId: string,
  bodyHash: string
): Promise<{ handled: boolean }> {
  const existing = await db
    .select()
    .from(agentIdempotencyKeys)
    .where(and(eq(agentIdempotencyKeys.key, key), eq(agentIdempotencyKeys.agentKeyId, agentKeyId)))
    .limit(1);

  if (existing.length > 0) {
    const record = existing[0];
    if (record.requestHash !== bodyHash) {
      agentError(res, 409, "idempotency_key_conflict", "Idempotency-Key was already used with a different request body.");
      return { handled: true };
    }
    // Replay stored response
    res.status(record.statusCode).json(record.responseBody);
    return { handled: true };
  }
  return { handled: false };
}

async function saveIdempotency(
  key: string,
  agentKeyId: string,
  bodyHash: string,
  statusCode: number,
  responseBody: any
): Promise<void> {
  try {
    await db
      .insert(agentIdempotencyKeys)
      .values({
        key,
        agentKeyId,
        requestHash: bodyHash,
        responseBody,
        statusCode,
        expiresAt: nowPlusHours(IDEMPOTENCY_TTL_HOURS),
      })
      .onConflictDoNothing();
  } catch (err) {
    console.warn("[agentApi] Failed to save idempotency key:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiter (per key ID)
// Uses Redis store when REDIS_URL is set; falls back to in-memory store.
// ─────────────────────────────────────────────────────────────────────────────
function parseRedisUrlForAgent(raw: string): string | null {
  const decoded = decodeURIComponent(raw).trim();
  const match = decoded.match(/(rediss?:\/\/\S+)/);
  let url = match ? match[1] : null;
  if (!url) {
    if (decoded.startsWith('redis://') || decoded.startsWith('rediss://')) url = decoded;
    else return null;
  }
  if (decoded.includes('--tls') && url.startsWith('redis://')) {
    url = url.replace('redis://', 'rediss://');
  }
  return url;
}

async function createRateLimitStore() {
  if (!process.env.REDIS_URL) return undefined; // use default memory store
  const resolvedUrl = parseRedisUrlForAgent(process.env.REDIS_URL);
  if (!resolvedUrl) {
    console.warn("[agentApi] Could not parse Redis URL — falling back to memory rate-limit store.");
    return undefined;
  }
  try {
    const { default: Redis } = await import("ioredis");
    const { RedisStore } = await import("rate-limit-redis");
    const isTls = resolvedUrl.startsWith('rediss://');
    const client = new Redis(resolvedUrl, { lazyConnect: true, enableOfflineQueue: false, ...(isTls ? { tls: {} } : {}) });
    await client.connect().catch(() => {
      console.warn("[agentApi] Redis connection failed, falling back to memory rate-limit store.");
    });
    if (client.status !== "ready") return undefined;
    console.log("[agentApi] Using Redis rate-limit store.");
    return new RedisStore({ sendCommand: (...args: string[]) => client.call(...args) as any });
  } catch (err) {
    console.warn("[agentApi] Redis store init error, falling back to memory store:", err);
    return undefined;
  }
}

const rateLimitStorePromise = createRateLimitStore();

function buildRateLimiter(store: any) {
  return rateLimit({
    windowMs: 60 * 1000,
    max: (req) => {
      const key = (req as any).agentKey;
      return key?.rateLimitPerMinute ?? 60;
    },
    keyGenerator: (req) => {
      const key = (req as any).agentKey;
      return key?.id ?? "anonymous";
    },
    store,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      const key = (req as any).agentKey;
      if (key?.organizationId && key?.id) {
        incrementUsageDaily(key.organizationId, key.id, { errorCount: 1 }).catch(() => {});
      }
      agentError(res, 429, "rate_limit_exceeded", "Rate limit exceeded. See X-RateLimit-* headers for limits.");
    },
    skip: (req) => !(req as any).agentKey,
  });
}

// Middleware wrapper: resolves the store promise once, then delegates to the real limiter
let _rateLimiter: ReturnType<typeof rateLimit> | null = null;
const agentRateLimiter: import("express").RequestHandler = async (req, res, next) => {
  if (!_rateLimiter) {
    const store = await rateLimitStorePromise;
    _rateLimiter = buildRateLimiter(store);
  }
  return _rateLimiter(req, res, next);
};

// ─────────────────────────────────────────────────────────────────────────────
// Apply shared middleware to all agent routes
// ─────────────────────────────────────────────────────────────────────────────
router.use(attachAgentRequestId);
router.use(isAgentApiKey);
router.use(agentRateLimiter);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/agent/scenarios
// ─────────────────────────────────────────────────────────────────────────────
router.get("/scenarios", requireScope("scenarios:read"), async (req: any, res) => {
  try {
    const agentKey = req.agentKey;

    // Fetch allowed scenario IDs for this key
    const allowed = await db
      .select()
      .from(agentKeyScenarios)
      .where(eq(agentKeyScenarios.agentKeyId, agentKey.id));

    if (allowed.length === 0) {
      res.json({ scenarios: [], total: 0 });
      return;
    }

    const allowedIds = new Set(allowed.map((r: any) => r.scenarioId));

    const allScenarios = await fileManager.getAllScenarios();
    const filtered = allScenarios.filter((s: any) => allowedIds.has(s.id) && !s.isDeleted);

    // Optional filters
    const { category, tag } = req.query as Record<string, string>;
    let result = filtered;
    if (category) result = result.filter((s: any) => s.category === category);
    if (tag) result = result.filter((s: any) => Array.isArray(s.tags) && s.tags.includes(tag));

    const scenarios = result.map((s: any) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      category: s.category,
      tags: s.tags ?? [],
      difficulty: s.difficulty,
      targetTurns: s.targetTurns,
      personaCount: s.personas?.length ?? 0,
    }));

    res.json({ scenarios, total: scenarios.length });
  } catch (err) {
    console.error("[agentApi] GET /scenarios error:", err);
    agentError(res, 500, "internal_error", "Failed to fetch scenarios.");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/agent/personas
// ─────────────────────────────────────────────────────────────────────────────
router.get("/personas", requireScope("personas:read"), async (req: any, res) => {
  try {
    const agentKey = req.agentKey;
    const { scenarioId } = req.query as Record<string, string>;

    // Fetch allowed scenario IDs for this key
    const allowed = await db
      .select()
      .from(agentKeyScenarios)
      .where(eq(agentKeyScenarios.agentKeyId, agentKey.id));

    const allowedIds = new Set(allowed.map((r: any) => r.scenarioId));

    // If filtering by scenarioId, verify access first
    if (scenarioId) {
      if (!allowedIds.has(scenarioId)) {
        // Return 404 to not expose existence of unauthorized scenarios
        agentError(res, 404, "scenario_not_found", "Scenario not found or not accessible with this API key.");
        return;
      }
    }

    const allScenarios = await fileManager.getAllScenarios();
    const eligibleScenarios = allScenarios.filter((s: any) => allowedIds.has(s.id) && !s.isDeleted);

    let personas: any[] = [];
    for (const scenario of eligibleScenarios) {
      if (scenarioId && scenario.id !== scenarioId) continue;
      for (const p of scenario.personas ?? []) {
        personas.push({
          id: p.id,
          name: p.name,
          scenarioId: scenario.id,
          scenarioTitle: scenario.title,
          role: p.role ?? p.position ?? "",
          mbti: p.mbti ?? p.personaRef?.replace(".json", "") ?? null,
          gender: p.gender ?? null,
        });
      }
    }

    res.json({ personas, total: personas.length });
  } catch (err) {
    console.error("[agentApi] GET /personas error:", err);
    agentError(res, 500, "internal_error", "Failed to fetch personas.");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/agent/sessions
// ─────────────────────────────────────────────────────────────────────────────
const createSessionSchema = z.object({
  scenarioId: z.string().min(1),
  personaId: z.string().min(1),
  externalUserId: z.string().min(1),
  externalSessionId: z.string().optional(),
  difficulty: z.number().int().min(1).max(5).default(4),
  language: z.enum(SUPPORTED_LANGUAGES).default("ko"),
  metadata: z.record(z.any()).optional(),
});

router.post("/sessions", requireScope("sessions:create"), async (req: any, res) => {
  const startTime = Date.now();
  try {
    const agentKey = req.agentKey;
    const orgId = req.agentOrgId;
    const requestId = req.agentRequestId;

    // Idempotency
    const idempotencyKeyHeader = req.headers["idempotency-key"] as string | undefined;
    const bodyHash = hashRequestBody(req.body);
    if (idempotencyKeyHeader) {
      const { handled } = await handleIdempotency(res, idempotencyKeyHeader, agentKey.id, bodyHash);
      if (handled) return;
    }

    // Validate input
    const parsed = createSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      agentError(res, 400, "validation_error", "Invalid request body.", parsed.error.flatten());
      return;
    }

    const { scenarioId, personaId, externalUserId, externalSessionId, difficulty, language, metadata } = parsed.data;

    // Metadata size limit: 8KB
    const metaStr = metadata ? JSON.stringify(metadata) : "";
    if (metaStr.length > 8192) {
      agentError(res, 400, "metadata_too_large", "metadata must be 8KB or less.");
      return;
    }

    // Verify scenarioId is allowed for this key
    const scenarioAccess = await db
      .select()
      .from(agentKeyScenarios)
      .where(and(eq(agentKeyScenarios.agentKeyId, agentKey.id), eq(agentKeyScenarios.scenarioId, scenarioId)))
      .limit(1);

    if (scenarioAccess.length === 0) {
      // 404 to not expose unauthorized resource existence
      agentError(res, 404, "scenario_not_found", "Scenario not found.");
      return;
    }

    // Verify scenario exists and has the given persona
    const allScenarios = await fileManager.getAllScenarios();
    const scenario = allScenarios.find((s: any) => s.id === scenarioId && !s.isDeleted);
    if (!scenario) {
      agentError(res, 404, "scenario_not_found", "Scenario not found.");
      return;
    }

    const scenarioPersona = scenario.personas?.find((p: any) => p.id === personaId);
    if (!scenarioPersona) {
      agentError(res, 404, "persona_not_found", "Persona not found in this scenario.");
      return;
    }

    // externalSessionId uniqueness check
    if (externalSessionId) {
      const existing = await db
        .select()
        .from(agentSessions)
        .where(
          and(
            eq(agentSessions.organizationId, orgId),
            eq(agentSessions.externalSessionId, externalSessionId)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        const sess = existing[0];
        if (sess.status === "active") {
          // Return existing active session
          const responseBody = buildSessionResponse(sess, requestId);
          if (idempotencyKeyHeader) {
            await saveIdempotency(idempotencyKeyHeader, agentKey.id, bodyHash, 200, responseBody);
          }
          res.json(responseBody);
          return;
        }
        // ended/expired → create new session (fall through)
      }
    }

    // Create internal persona run (userId is null – agent sessions are not
    // tied to a users table row; agent_sessions.id is the source of truth).
    let personaRunId: string | null = null;
    try {
      const scenarioRun = await storage.createScenarioRun({
        userId: null as any,
        scenarioId,
        scenarioName: scenario.title ?? scenarioId,
        attemptNumber: 1,
        mode: "text",
        difficulty,
        status: "active",
      });

      const personaRun = await storage.createPersonaRun({
        scenarioRunId: scenarioRun.id,
        personaId,
        personaName: scenarioPersona.name,
        personaSnapshot: {},
        mbtiType: scenarioPersona.mbti ?? scenarioPersona.personaRef?.replace(".json", "") ?? null,
        phase: 1,
        mode: "text",
        difficulty,
        status: "active",
      });
      personaRunId = personaRun.id;
    } catch (err) {
      console.warn("[agentApi] Failed to create persona run (non-fatal):", err);
    }

    // Create agent session
    const sessionId = generateSessionId();
    const expiresAt = nowPlusHours(AGENT_SESSION_MAX_HOURS);

    await db.insert(agentSessions).values({
      id: sessionId,
      agentKeyId: agentKey.id,
      organizationId: orgId,
      externalUserId,
      externalSessionId: externalSessionId ?? null,
      personaRunId,
      scenarioId,
      personaId,
      language,
      difficulty,
      status: "active",
      metadata: metadata ?? null,
      lastActivityAt: new Date(),
      expiresAt,
    });

    const session = await db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .limit(1)
      .then((r: any[]) => r[0]);

    const responseBody = buildSessionResponse(session, requestId);
    if (idempotencyKeyHeader) {
      await saveIdempotency(idempotencyKeyHeader, agentKey.id, bodyHash, 201, responseBody);
    }

    // Best-effort usage tracking
    incrementUsageDaily(orgId, agentKey.id, { latencyMs: Date.now() - startTime }).catch(() => {});

    res.status(201).json(responseBody);
  } catch (err) {
    console.error("[agentApi] POST /sessions error:", err);
    agentError(res, 500, "internal_error", "Failed to create session.");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/agent/sessions/:id
// ─────────────────────────────────────────────────────────────────────────────
router.get("/sessions/:id", requireScope("sessions:read"), async (req: any, res) => {
  try {
    const agentKey = req.agentKey;
    const requestId = req.agentRequestId;
    const sessionId = req.params.id;

    const session = await getSessionForKey(sessionId, agentKey.id);
    if (!session) {
      agentError(res, 404, "session_not_found", "Session not found.");
      return;
    }

    await autoExpireSession(session);
    const freshSession = await db.select().from(agentSessions).where(eq(agentSessions.id, sessionId)).limit(1).then((r: any[]) => r[0]);
    const usedSession = freshSession ?? session;

    // Return session-scoped cumulative usage (stored in metadata.sessionUsage per message)
    const sessionMeta = (usedSession.metadata as Record<string, any>) ?? {};
    const sessionUsage = (sessionMeta.sessionUsage as { requestCount: number; inputTokens: number; outputTokens: number }) ?? null;

    // Detect lost in-memory context: active session that has had at least one message turn
    // (requestCount > 0) but whose persona_run simulation_state is null.
    // A brand-new session with no turns legitimately has a null simulation_state, so we
    // only flag contextLost when messages have already been exchanged (state should exist).
    let contextLost = false;
    if (usedSession.status === "active" && usedSession.personaRunId) {
      const sessionMeta2 = (usedSession.metadata as Record<string, any>) ?? {};
      const sessionUsage2 = (sessionMeta2.sessionUsage as { requestCount: number } | undefined);
      const hasExchangedMessages = (sessionUsage2?.requestCount ?? 0) > 0;
      if (hasExchangedMessages) {
        const personaRunRow = await db
          .select({ simulationState: personaRuns.simulationState })
          .from(personaRuns)
          .where(eq(personaRuns.id, usedSession.personaRunId))
          .limit(1)
          .then((r: any[]) => r[0] ?? null);
        contextLost = personaRunRow !== null && personaRunRow.simulationState === null;
      }
    }

    res.json(buildSessionResponse(usedSession, requestId, sessionUsage ?? undefined, contextLost));
  } catch (err) {
    console.error("[agentApi] GET /sessions/:id error:", err);
    agentError(res, 500, "internal_error", "Failed to fetch session.");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/agent/sessions/:id/messages
// ─────────────────────────────────────────────────────────────────────────────
const sendMessageSchema = z.object({
  message: z.string().min(1).max(4000),
});

router.post("/sessions/:id/messages", requireScope("sessions:message"), async (req: any, res) => {
  const startTime = Date.now();
  try {
    const agentKey = req.agentKey;
    const orgId = req.agentOrgId;
    const requestId = req.agentRequestId;
    const sessionId = req.params.id;

    // Detect SSE streaming early so we can skip idempotency for streaming requests
    const wantsStream = (req.headers["accept"] || "").includes("text/event-stream");

    // Idempotency (skipped for SSE mode — streaming responses cannot be cached/replayed)
    const idempotencyKeyHeader = req.headers["idempotency-key"] as string | undefined;
    const bodyHash = hashRequestBody(req.body);
    if (!wantsStream && idempotencyKeyHeader) {
      const { handled } = await handleIdempotency(res, idempotencyKeyHeader, agentKey.id, bodyHash);
      if (handled) return;
    }

    // Validate
    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      agentError(res, 400, "validation_error", "Invalid request body.", parsed.error.flatten());
      return;
    }
    const { message } = parsed.data;

    // Fetch session
    const session = await getSessionForKey(sessionId, agentKey.id);
    if (!session) {
      agentError(res, 404, "session_not_found", "Session not found.");
      return;
    }

    // Check if active
    await autoExpireSession(session);
    if (session.status !== "active") {
      agentError(res, 400, "session_ended", "Session is no longer active.");
      return;
    }

    // Build persona/scenario context for AI
    const allScenarios = await fileManager.getAllScenarios();
    const scenario = allScenarios.find((s: any) => s.id === session.scenarioId);
    if (!scenario) {
      agentError(res, 404, "scenario_not_found", "Scenario no longer exists.");
      return;
    }

    const scenarioPersona = scenario.personas?.find((p: any) => p.id === session.personaId);
    const mbtiType = scenarioPersona?.mbti ?? scenarioPersona?.personaRef?.replace(".json", "");
    const mbtiPersona = mbtiType ? await fileManager.getPersonaByMBTI(mbtiType) : null;

    const persona = {
      id: scenarioPersona?.id ?? session.personaId,
      name: scenarioPersona?.name ?? session.personaId,
      role: scenarioPersona?.position ?? scenarioPersona?.role ?? "",
      department: scenarioPersona?.department ?? "",
      personality: (mbtiPersona as any)?.communication_style ?? "균형 잡힌 의사소통",
      responseStyle: (mbtiPersona as any)?.communication_patterns?.opening_style ?? "상황에 맞는 방식으로 대화 시작",
      goals: (mbtiPersona as any)?.communication_patterns?.win_conditions ?? ["목표 달성"],
      background: (mbtiPersona as any)?.background?.personal_values?.join(", ") ?? "전문성",
    };

    const scenarioWithDifficulty = {
      ...scenario,
      difficulty: session.difficulty,
    };

    // Get existing messages from internal persona run if available
    let existingMessages: any[] = [];
    if (session.personaRunId) {
      existingMessages = await storage.getChatMessagesByPersonaRun(session.personaRunId).catch(() => []);
    }

    const conversationMessages = existingMessages.map((m: any) => ({
      sender: m.sender as "user" | "ai",
      message: m.message,
      timestamp: m.createdAt?.toISOString(),
      emotion: m.emotion,
      emotionReason: m.emotionReason,
    }));

    const language = session.language as any;
    const turn = Math.floor(existingMessages.length / 2);
    const turnId = generateTurnId(sessionId, turn + 1);

    // ── SSE Streaming path ─────────────────────────────────────────────────────
    if (wantsStream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      const flushRes = () => {
        if ("flush" in res && typeof (res as any).flush === "function") {
          (res as any).flush();
        }
      };

      const writeEvent = (eventName: string, data: Record<string, unknown>) => {
        res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
        flushRes();
      };

      // Stream chunks immediately while watching for the [META:{...}] marker.
      // Strategy: emit each chunk right away, but keep a small rolling window (the length
      // of the META_PREFIX string = 6 chars) so we can detect markers that span chunk
      // boundaries. Once [META: is found, buffer the rest and stop emitting deltas.
      const META_PREFIX = "[META:";
      const META_WINDOW = META_PREFIX.length; // 6 — minimal holdback, ensures true streaming
      let fullContent = "";
      let emittedUpTo = 0;
      let metaFoundAt = -1; // index in fullContent where [META: begins

      try {
        const stream = await generateStreamingAIResponse(
          scenarioWithDifficulty as any,
          conversationMessages,
          persona,
          message,
          language,
          session.externalUserId ?? undefined
        );
        for await (const chunk of stream) {
          fullContent += chunk;

          if (metaFoundAt >= 0) {
            // Already buffering META content — don't emit anything further
            continue;
          }

          // Search for [META: starting slightly before the last emitted position
          // to catch markers split across chunk boundaries
          const searchFrom = Math.max(0, emittedUpTo - META_WINDOW + 1);
          const idx = fullContent.indexOf(META_PREFIX, searchFrom);

          if (idx >= 0) {
            // Found [META: — emit everything before it, then stop
            metaFoundAt = idx;
            const safe = fullContent.slice(emittedUpTo, idx);
            if (safe.length > 0) writeEvent("delta", { content: safe });
            emittedUpTo = idx;
          } else {
            // No META yet. Emit up to (fullContent.length - META_WINDOW) to leave
            // a small window for cross-chunk detection.
            const safeEnd = Math.max(emittedUpTo, fullContent.length - META_WINDOW);
            if (safeEnd > emittedUpTo) {
              writeEvent("delta", { content: fullContent.slice(emittedUpTo, safeEnd) });
              emittedUpTo = safeEnd;
            }
          }
        }
      } catch (streamErr) {
        console.error("[agentApi] SSE stream error:", streamErr);
        writeEvent("error", { message: "AI response generation failed." });
        res.end();
        return;
      }

      // Parse [USAGE:{...}] sidecar emitted by providers after the text stream
      const usageMatch = fullContent.match(/\[USAGE:([\s\S]*?)\]\s*$/);
      let usageParsed: { inputTokens?: number; outputTokens?: number } = {};
      let contentWithoutUsage = fullContent;
      if (usageMatch) {
        try {
          usageParsed = JSON.parse(usageMatch[1]);
          contentWithoutUsage = fullContent.slice(0, fullContent.lastIndexOf("[USAGE:")).trimEnd();
        } catch {
          // keep as-is
        }
      }

      // Parse [META:{...}] marker from end of accumulated content
      const metaMatch = contentWithoutUsage.match(/\[META:([\s\S]*?)\]\s*$/);
      let metaParsed: { emotion?: string; emotionReason?: string } = {};
      let cleanContent = contentWithoutUsage;
      if (metaMatch) {
        try {
          metaParsed = JSON.parse(metaMatch[1]);
          cleanContent = contentWithoutUsage.slice(0, contentWithoutUsage.lastIndexOf("[META:")).trimEnd();
        } catch {
          // keep raw content as-is
        }
      }

      // Emit any remaining clean content that wasn't sent during the loop
      const remaining = cleanContent.slice(emittedUpTo);
      if (remaining.length > 0) {
        writeEvent("delta", { content: remaining });
      }

      const streamEmotion = metaParsed.emotion ?? "중립";
      const streamEmotionReason = metaParsed.emotionReason ?? "";

      // Save messages to persona run if available
      if (session.personaRunId) {
        await storage.createChatMessage({
          personaRunId: session.personaRunId,
          sender: "user",
          message,
          turnIndex: turn,
        }).catch(() => {});

        await storage.createChatMessage({
          personaRunId: session.personaRunId,
          sender: "ai",
          message: cleanContent,
          turnIndex: turn,
          emotion: streamEmotion || null,
          emotionReason: streamEmotionReason || null,
        }).catch(() => {});
      }

      const latencyMs = Date.now() - startTime;

      // Use real token counts from provider [USAGE:...] sidecar when available, fall back to estimates
      const hasRealTokens = (usageParsed.inputTokens ?? 0) > 0 || (usageParsed.outputTokens ?? 0) > 0;
      const inputTokensEst = hasRealTokens ? usageParsed.inputTokens! : estimateTokens(message);
      const outputTokensEst = hasRealTokens ? usageParsed.outputTokens! : estimateTokens(cleanContent);
      const tokensEstimated = !hasRealTokens;

      const prevMeta = (session.metadata as Record<string, any>) ?? {};
      const prevSessionUsage = (prevMeta.sessionUsage as { requestCount: number; inputTokens: number; outputTokens: number }) ?? { requestCount: 0, inputTokens: 0, outputTokens: 0 };
      const updatedSessionUsage = {
        requestCount: prevSessionUsage.requestCount + 1,
        inputTokens: prevSessionUsage.inputTokens + inputTokensEst,
        outputTokens: prevSessionUsage.outputTokens + outputTokensEst,
      };

      await db
        .update(agentSessions)
        .set({ lastActivityAt: new Date(), metadata: { ...prevMeta, sessionUsage: updatedSessionUsage } })
        .where(eq(agentSessions.id, sessionId))
        .catch(() => {});

      // Run simulation engine (same as non-streaming path)
      let simulationState: any = null;
      let turnScore: any = null;

      if (session.personaRunId) {
        try {
          const personaRunId = session.personaRunId;
          let currentState = getSessionState(personaRunId);
          if (!currentState) {
            const stored = await storage.getSimulationState(personaRunId).catch(() => null);
            if (stored) {
              const { setSessionState } = await import("../services/simulation/simulationEngine");
              setSessionState(personaRunId, stored as any);
              currentState = stored as any;
            } else {
              currentState = createDefaultSimulationState();
            }
          }
          getOrCreateSessionContext(personaRunId, currentState);

          const evalResult = await evaluateUserResponse({
            personaRunId,
            turnId,
            turnIndex: turn,
            userText: message,
            aiText: cleanContent,
            simulationState: currentState,
            language: (session.language as any) ?? "ko",
            evaluationMode: "fast",
          });

          if (!evalResult.skipped) {
            const newState = applySimulationPatch(personaRunId, {
              turnId,
              source: "server_evaluation",
              priority: "normal",
              patch: {
                npcEmotionDelta: evalResult.emotionDelta,
                turnScoresToAdd: [evalResult.turnScore],
              },
            });
            simulationState = newState;
            turnScore = evalResult.turnScore;

            storage.saveSimulationState(personaRunId, newState as unknown as Record<string, unknown>)
              .catch((e) => console.warn("[agentApi] Failed to save simulation state:", e));

            const personaRun = await storage.getPersonaRun(personaRunId).catch(() => null);
            storage.createSimulationEvent({
              personaRunId,
              scenarioRunId: personaRun?.scenarioRunId ?? "",
              turnIndex: turn,
              turnId,
              eventType: "auto_evaluation",
              toolName: null,
              args: { userTextLength: message.length, method: evalResult.method, evalMode: "fast" },
              result: { turnScore: evalResult.turnScore },
              stateBefore: currentState,
              stateAfter: newState,
              stateVersionBefore: currentState.version,
              stateVersionAfter: newState.version,
              includeInReport: true,
            }).catch((e) => console.warn("[agentApi] Failed to save simulation event:", e));
          } else {
            simulationState = currentState;
          }
        } catch (err) {
          console.warn("[agentApi] Simulation engine error (non-fatal):", err);
        }
      }

      await incrementUsageDaily(orgId, agentKey.id, {
        inputTokens: inputTokensEst,
        outputTokens: outputTokensEst,
        latencyMs,
      }).catch(() => {});

      const messageCount = updatedSessionUsage.requestCount * 2;

      writeEvent("done", {
        emotion: streamEmotion,
        emotionReason: streamEmotionReason,
        turnId,
        turnIndex: turn,
        turnScore,
        simulationState,
        usage: {
          requestCount: updatedSessionUsage.requestCount,
          messageCount,
          inputTokens: updatedSessionUsage.inputTokens,
          outputTokens: updatedSessionUsage.outputTokens,
          tokensEstimated,
        },
        requestId,
      });

      res.end();
      return;
    }
    // ── End SSE path ───────────────────────────────────────────────────────────

    // Call AI (non-streaming path)
    const aiResult = await generateAIResponse(
      scenarioWithDifficulty as any,
      conversationMessages,
      persona,
      message,
      language,
      session.externalUserId ?? undefined
    );

    // Save messages to persona run if available
    if (session.personaRunId) {
      await storage.createChatMessage({
        personaRunId: session.personaRunId,
        sender: "user",
        message,
        turnIndex: turn,
      }).catch(() => {});

      await storage.createChatMessage({
        personaRunId: session.personaRunId,
        sender: "ai",
        message: aiResult.content,
        turnIndex: turn,
        emotion: aiResult.emotion ?? null,
        emotionReason: aiResult.emotionReason ?? null,
      }).catch(() => {});
    }

    const latencyMs = Date.now() - startTime;

    // Prefer real provider token counts; fall back to length-based estimation
    const hasRealUsage =
      (aiResult as any).usageMetadata?.promptTokenCount != null ||
      (aiResult as any).promptTokenCount != null;
    const tokensEstimated = !hasRealUsage;
    const inputTokensEst =
      (aiResult as any).usageMetadata?.promptTokenCount ??
      (aiResult as any).promptTokenCount ??
      estimateTokens(message);
    const outputTokensEst =
      (aiResult as any).usageMetadata?.candidatesTokenCount ??
      (aiResult as any).completionTokenCount ??
      estimateTokens(aiResult.content);

    // Accumulate session-level usage in metadata so GET /sessions/:id can return it
    const prevMeta = (session.metadata as Record<string, any>) ?? {};
    const prevSessionUsage = (prevMeta.sessionUsage as { requestCount: number; inputTokens: number; outputTokens: number }) ?? { requestCount: 0, inputTokens: 0, outputTokens: 0 };
    const updatedSessionUsage = {
      requestCount: prevSessionUsage.requestCount + 1,
      inputTokens: prevSessionUsage.inputTokens + inputTokensEst,
      outputTokens: prevSessionUsage.outputTokens + outputTokensEst,
    };

    // Update session lastActivityAt + persist session-scoped usage counters
    await db
      .update(agentSessions)
      .set({
        lastActivityAt: new Date(),
        metadata: { ...prevMeta, sessionUsage: updatedSessionUsage },
      })
      .where(eq(agentSessions.id, sessionId))
      .catch(() => {});

    // ── Simulation Engine Integration ──────────────────────────────────────
    let simulationState: any = null;
    let turnScore: any = null;

    if (session.personaRunId) {
      try {
        const personaRunId = session.personaRunId;

        // Hydrate simulation state from DB if not in memory (survives process restarts)
        let currentState = getSessionState(personaRunId);
        if (!currentState) {
          const stored = await storage.getSimulationState(personaRunId).catch(() => null);
          if (stored) {
            const { setSessionState } = await import("../services/simulation/simulationEngine");
            setSessionState(personaRunId, stored as any);
            currentState = stored as any;
          } else {
            currentState = createDefaultSimulationState();
          }
        }
        getOrCreateSessionContext(personaRunId, currentState);

        // Evaluate the user's message (LLM-based with rule fallback)
        const evalResult = await evaluateUserResponse({
          personaRunId,
          turnId,
          turnIndex: turn,
          userText: message,
          aiText: aiResult.content,
          simulationState: currentState,
          language: (session.language as any) ?? "ko",
          evaluationMode: "fast",
        });

        if (!evalResult.skipped) {
          // Apply evaluation scores to simulation state
          const newState = applySimulationPatch(personaRunId, {
            turnId,
            source: "server_evaluation",
            priority: "normal",
            patch: {
              npcEmotionDelta: evalResult.emotionDelta,
              turnScoresToAdd: [evalResult.turnScore],
            },
          });
          simulationState = newState;
          turnScore = evalResult.turnScore;

          // Persist updated simulation state to DB for cross-restart continuity
          storage.saveSimulationState(personaRunId, newState as unknown as Record<string, unknown>)
            .catch((e) => console.warn("[agentApi] Failed to save simulation state:", e));

          // Persist simulation event for feedback report generation
          const personaRun = await storage.getPersonaRun(personaRunId).catch(() => null);
          storage.createSimulationEvent({
            personaRunId,
            scenarioRunId: personaRun?.scenarioRunId ?? "",
            turnIndex: turn,
            turnId,
            eventType: "auto_evaluation",
            toolName: null,
            args: { userTextLength: message.length, method: evalResult.method, evalMode: "fast" },
            result: { turnScore: evalResult.turnScore },
            stateBefore: currentState,
            stateAfter: newState,
            stateVersionBefore: currentState.version,
            stateVersionAfter: newState.version,
            includeInReport: true,
          }).catch((e) => console.warn("[agentApi] Failed to save simulation event:", e));
        } else {
          // Skipped (short message) — still return the current state
          simulationState = currentState;
        }
      } catch (err) {
        console.warn("[agentApi] Simulation engine error (non-fatal):", err);
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Increment key-level daily usage (best-effort, for admin dashboard aggregates)
    await incrementUsageDaily(orgId, agentKey.id, {
      inputTokens: inputTokensEst,
      outputTokens: outputTokensEst,
      latencyMs,
    }).catch(() => {});

    // messageCount = total user+AI messages in this session (session-scoped, not per-key)
    // Each turn produces 1 user message + 1 AI message; requestCount == number of turns
    const messageCount = updatedSessionUsage.requestCount * 2;

    const responseBody = {
      id: `msg_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      sessionId,
      turnId,
      reply: {
        text: aiResult.content,
        emotionLabel: aiResult.emotion,
        emotionReason: aiResult.emotionReason,
      },
      simulationState,
      turnScore,
      usage: {
        requestCount: updatedSessionUsage.requestCount,
        messageCount,
        inputTokens: updatedSessionUsage.inputTokens,
        outputTokens: updatedSessionUsage.outputTokens,
        tokensEstimated,
      },
      requestId,
    };

    if (idempotencyKeyHeader) {
      await saveIdempotency(idempotencyKeyHeader, agentKey.id, bodyHash, 200, responseBody);
    }

    res.json(responseBody);
  } catch (err) {
    console.error("[agentApi] POST /sessions/:id/messages error:", err);
    agentError(res, 500, "internal_error", "Failed to process message.");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/agent/sessions/:id/end
// ─────────────────────────────────────────────────────────────────────────────
router.post("/sessions/:id/end", requireScope("sessions:end"), async (req: any, res) => {
  try {
    const agentKey = req.agentKey;
    const orgId = req.agentOrgId;
    const requestId = req.agentRequestId;
    const sessionId = req.params.id;

    // Idempotency
    const idempotencyKeyHeader = req.headers["idempotency-key"] as string | undefined;
    const bodyHash = hashRequestBody(req.body ?? {});
    if (idempotencyKeyHeader) {
      const { handled } = await handleIdempotency(res, idempotencyKeyHeader, agentKey.id, bodyHash);
      if (handled) return;
    }

    const session = await getSessionForKey(sessionId, agentKey.id);
    if (!session) {
      agentError(res, 404, "session_not_found", "Session not found.");
      return;
    }

    if (session.status === "ended") {
      const responseBody = { sessionId, status: "ended", requestId };
      if (idempotencyKeyHeader) {
        await saveIdempotency(idempotencyKeyHeader, agentKey.id, bodyHash, 200, responseBody);
      }
      res.json(responseBody);
      return;
    }

    const endedAt = new Date();
    const existingMeta = (session.metadata as Record<string, any>) ?? {};

    // If there is a persona run, mark feedbackStatus as "pending" synchronously
    // so GET /sessions/:id/feedback can distinguish "job queued" from "no feedback"
    const metaUpdate = session.personaRunId
      ? { ...existingMeta, feedbackStatus: "pending" }
      : existingMeta;

    await db
      .update(agentSessions)
      .set({ status: "ended", endedAt, metadata: metaUpdate })
      .where(eq(agentSessions.id, sessionId));

    // Audit log
    await db.insert(auditLogs).values({
      actorUserId: null,
      organizationId: orgId,
      action: "agent_session.ended",
      targetType: "agent_session",
      targetId: sessionId,
      metadata: { agentKeyId: agentKey.id },
    }).catch(() => {});

    // Return immediately — feedback generation and webhook delivery happen in the background.
    // Only include feedbackStatus when a generation job was actually queued (personaRunId exists).
    const responseBody: Record<string, any> = {
      sessionId,
      status: "ended",
      endedAt: endedAt.toISOString(),
      ...(session.personaRunId ? { feedbackStatus: "pending" } : {}),
      requestId,
    };

    if (idempotencyKeyHeader) {
      await saveIdempotency(idempotencyKeyHeader, agentKey.id, bodyHash, 200, responseBody);
    }

    res.json(responseBody);

    // Fire session.ended immediately after response (fire-and-forget)
    dispatchWebhook(agentKey.id, "session.ended", { sessionId, endedAt: endedAt.toISOString() }).catch(() => {});

    // ── Background: generate feedback + fire feedback.completed ───────────
    if (session.personaRunId) {
      setImmediate(async () => {
        try {
          const personaRunId = session.personaRunId;
          const allScenarios = await fileManager.getAllScenarios();
          const scenario = allScenarios.find((s: any) => s.id === session.scenarioId);

          if (scenario) {
            const scenarioPersona = scenario.personas?.find((p: any) => p.id === session.personaId);
            const mbtiType = scenarioPersona?.mbti ?? scenarioPersona?.personaRef?.replace(".json", "");
            const mbtiPersona = mbtiType ? await fileManager.getPersonaByMBTI(mbtiType) : null;

            const personaContext = {
              id: scenarioPersona?.id ?? session.personaId,
              name: scenarioPersona?.name ?? session.personaId,
              role: scenarioPersona?.position ?? scenarioPersona?.role ?? "",
              department: scenarioPersona?.department ?? "",
              personality: (mbtiPersona as any)?.communication_style ?? "균형 잡힌 의사소통",
              responseStyle: (mbtiPersona as any)?.communication_patterns?.opening_style ?? "",
              goals: (mbtiPersona as any)?.communication_patterns?.win_conditions ?? [],
              background: (mbtiPersona as any)?.background?.personal_values?.join(", ") ?? "",
            };

            const rawMessages = await storage.getChatMessagesByPersonaRun(personaRunId).catch(() => []);
            const conversationMessages = rawMessages.map((m: any) => ({
              sender: m.sender as "user" | "ai",
              message: m.message,
              timestamp: m.createdAt?.toISOString?.() ?? new Date().toISOString(),
              emotion: m.emotion ?? null,
              emotionReason: m.emotionReason ?? null,
            }));

            const language = (session.language as "ko" | "en" | "ja" | "zh") ?? "ko";
            const feedbackReport = await generateAndSaveFeedback(
              personaRunId,
              { messages: conversationMessages },
              scenario,
              personaContext,
              language
            );

            if (feedbackReport) {
              // Re-read latest session metadata before writing to avoid clobbering concurrent updates
              const freshSessionRow = await db
                .select({ metadata: agentSessions.metadata })
                .from(agentSessions)
                .where(eq(agentSessions.id, sessionId))
                .limit(1)
                .then((r: any[]) => r[0] ?? null)
                .catch(() => null);
              const latestMeta = ((freshSessionRow?.metadata as Record<string, any>) ?? {});
              await db
                .update(agentSessions)
                .set({ metadata: { ...latestMeta, feedbackReport, feedbackStatus: "completed" } })
                .where(eq(agentSessions.id, sessionId))
                .catch((e) => console.warn("[agentApi] Failed to persist feedbackReport to session metadata:", e));

              dispatchWebhook(agentKey.id, "feedback.completed", { sessionId, feedbackReport }).catch(() => {});
            }
          }
        } catch (err) {
          console.warn("[agentApi] Failed to generate feedback report (non-fatal):", err);
        }
      });
    }
    // ─────────────────────────────────────────────────────────────────────────
  } catch (err) {
    console.error("[agentApi] POST /sessions/:id/end error:", err);
    agentError(res, 500, "internal_error", "Failed to end session.");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/agent/sessions/:id/feedback
// ─────────────────────────────────────────────────────────────────────────────
router.get("/sessions/:id/feedback", requireScope("sessions:read"), async (req: any, res) => {
  try {
    const agentKey = req.agentKey;
    const requestId = req.agentRequestId;
    const sessionId = req.params.id;

    const session = await getSessionForKey(sessionId, agentKey.id);
    if (!session) {
      agentError(res, 404, "session_not_found", "Session not found.");
      return;
    }

    const sessionMeta = (session.metadata as Record<string, any>) ?? {};

    // feedbackStatus is only present in metadata when a generation job was explicitly queued
    // (set synchronously at end-time). Its absence means no feedback will ever exist for this session.
    if (!("feedbackStatus" in sessionMeta)) {
      agentError(res, 404, "feedback_not_available", "No feedback report is associated with this session.");
      return;
    }

    const feedbackStatus = sessionMeta.feedbackStatus as string;
    const feedbackReport = sessionMeta.feedbackReport ?? null;

    res.json({
      sessionId,
      feedbackStatus,
      feedbackReport,
      requestId,
    });
  } catch (err) {
    console.error("[agentApi] GET /sessions/:id/feedback error:", err);
    agentError(res, 500, "internal_error", "Failed to fetch feedback.");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Background session cleanup (called periodically)
// ─────────────────────────────────────────────────────────────────────────────
export async function cleanupExpiredAgentSessions(): Promise<void> {
  try {
    const now = new Date();
    const inactiveThreshold = new Date(now.getTime() - AGENT_SESSION_INACTIVE_MINUTES * 60 * 1000);

    // Fetch sessions about to be expired (inactive)
    const inactiveSessions = await db
      .select({ id: agentSessions.id, agentKeyId: agentSessions.agentKeyId })
      .from(agentSessions)
      .where(
        and(
          eq(agentSessions.status, "active"),
          lt(agentSessions.lastActivityAt, inactiveThreshold)
        )
      );

    if (inactiveSessions.length > 0) {
      await db
        .update(agentSessions)
        .set({ status: "expired" })
        .where(inArray(agentSessions.id, inactiveSessions.map((s) => s.id)));
      for (const s of inactiveSessions) {
        dispatchWebhook(s.agentKeyId, "session.expired", { sessionId: s.id }).catch(() => {});
      }
    }

    // Fetch sessions about to be expired (max TTL)
    const ttlSessions = await db
      .select({ id: agentSessions.id, agentKeyId: agentSessions.agentKeyId })
      .from(agentSessions)
      .where(
        and(
          eq(agentSessions.status, "active"),
          lt(agentSessions.expiresAt, now)
        )
      );

    if (ttlSessions.length > 0) {
      await db
        .update(agentSessions)
        .set({ status: "expired" })
        .where(inArray(agentSessions.id, ttlSessions.map((s) => s.id)));
      for (const s of ttlSessions) {
        dispatchWebhook(s.agentKeyId, "session.expired", { sessionId: s.id }).catch(() => {});
      }
    }

    // Cleanup expired idempotency keys
    await db.delete(agentIdempotencyKeys).where(lt(agentIdempotencyKeys.expiresAt, now));

    console.log("[agentApi] Expired sessions cleanup done.");
  } catch (err) {
    console.warn("[agentApi] Session cleanup error (non-fatal):", err);
  }
}

// Run cleanup every 5 minutes
setInterval(() => {
  cleanupExpiredAgentSessions().catch(() => {});
}, 5 * 60 * 1000);

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

async function getSessionForKey(sessionId: string, agentKeyId: string): Promise<any | null> {
  const result = await db
    .select()
    .from(agentSessions)
    .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.agentKeyId, agentKeyId)))
    .limit(1);
  return result[0] ?? null;
}

async function autoExpireSession(session: any): Promise<void> {
  if (session.status !== "active") return;
  const now = new Date();
  const inactiveThreshold = new Date(now.getTime() - AGENT_SESSION_INACTIVE_MINUTES * 60 * 1000);
  const isInactive = session.lastActivityAt < inactiveThreshold;
  const isExpired = session.expiresAt < now;
  if (isInactive || isExpired) {
    await db
      .update(agentSessions)
      .set({ status: "expired" })
      .where(eq(agentSessions.id, session.id))
      .catch(() => {});
    session.status = "expired";
  }
}

function buildSessionResponse(
  session: any,
  requestId: string,
  usage?: { requestCount: number; inputTokens: number; outputTokens: number },
  contextLost?: boolean
): any {
  return {
    sessionId: session.id,
    status: session.status,
    scenarioId: session.scenarioId,
    personaId: session.personaId,
    externalUserId: session.externalUserId,
    externalSessionId: session.externalSessionId ?? null,
    language: session.language,
    difficulty: session.difficulty,
    createdAt: session.createdAt?.toISOString?.() ?? session.createdAt,
    expiresAt: session.expiresAt?.toISOString?.() ?? session.expiresAt,
    contextLost: contextLost ?? false,
    usage: usage
      ? { requestCount: usage.requestCount, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }
      : null,
    requestId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/agent/usage
// Returns daily token-spend rows for the authenticated API key.
// Optional query params: ?from=YYYY-MM-DD&to=YYYY-MM-DD
// Defaults to the current calendar month when params are omitted.
// ─────────────────────────────────────────────────────────────────────────────
const usageQuerySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD")
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD")
    .optional(),
});

router.get("/usage", requireScope("usage:read"), async (req: any, res) => {
  try {
    const agentKey = req.agentKey;

    const parsed = usageQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      agentError(res, 400, "validation_error", "Invalid query parameters.", parsed.error.flatten());
      return;
    }

    const today = new Date();
    const defaultFrom = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
    const defaultTo = today.toISOString().slice(0, 10);

    const fromDate = parsed.data.from ?? defaultFrom;
    const toDate = parsed.data.to ?? defaultTo;

    if (fromDate > toDate) {
      agentError(res, 400, "validation_error", "from date must not be after to date.");
      return;
    }

    const _rawRangeDays = parseInt(process.env.AGENT_USAGE_MAX_RANGE_DAYS ?? '', 10);
    const MAX_RANGE_DAYS = Number.isInteger(_rawRangeDays) && _rawRangeDays > 0 ? _rawRangeDays : 365;
    const msPerDay = 86_400_000;
    const rangeDays = (new Date(toDate).getTime() - new Date(fromDate).getTime()) / msPerDay;
    if (rangeDays > MAX_RANGE_DAYS) {
      agentError(res, 400, "date_range_too_large", `Date range must not exceed ${MAX_RANGE_DAYS} days.`);
      return;
    }

    const rows = await db
      .select({
        date: agentUsageDaily.date,
        requestCount: agentUsageDaily.requestCount,
        inputTokens: agentUsageDaily.inputTokens,
        outputTokens: agentUsageDaily.outputTokens,
        totalTokens: agentUsageDaily.totalTokens,
      })
      .from(agentUsageDaily)
      .where(
        and(
          eq(agentUsageDaily.agentKeyId, agentKey.id),
          gte(agentUsageDaily.date, fromDate),
          lte(agentUsageDaily.date, toDate)
        )
      )
      .orderBy(agentUsageDaily.date);

    const summary = rows.reduce(
      (acc, row) => {
        acc.totalRequests += row.requestCount;
        acc.totalInputTokens += row.inputTokens;
        acc.totalOutputTokens += row.outputTokens;
        return acc;
      },
      { totalRequests: 0, totalInputTokens: 0, totalOutputTokens: 0 }
    );

    res.json({ rows, summary });
  } catch (err) {
    console.error("[agentApi] GET /usage error:", err);
    agentError(res, 500, "internal_error", "Failed to fetch usage data.");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Webhook CRUD endpoints
// ─────────────────────────────────────────────────────────────────────────────

const SUPPORTED_WEBHOOK_EVENTS = ["session.ended", "session.expired", "feedback.completed"] as const;

const createWebhookSchema = z.object({
  url: z
    .string()
    .url("url must be a valid URL")
    .refine((u) => u.startsWith("https://"), "Webhook URL must use HTTPS"),
  events: z
    .array(z.enum(SUPPORTED_WEBHOOK_EVENTS))
    .min(1, "At least one event type is required")
    .max(SUPPORTED_WEBHOOK_EVENTS.length),
});

// POST /api/v1/agent/webhooks — register a new webhook
router.post("/webhooks", requireScope("webhooks:manage"), async (req: any, res) => {
  try {
    const agentKey = req.agentKey;
    const parsed = createWebhookSchema.safeParse(req.body);
    if (!parsed.success) {
      agentError(res, 400, "validation_error", "Invalid request body.", parsed.error.flatten());
      return;
    }

    const { url, events } = parsed.data;

    // Generate a random secret, return it once.
    // Store AES-256-GCM ciphertext in DB — never the plaintext.
    const secret = `whsec_${randomUUID().replace(/-/g, "")}`;
    const encryptedSecret = encryptWebhookSecret(secret);

    const [webhook] = await db
      .insert(agentWebhooks)
      .values({
        agentKeyId: agentKey.id,
        url,
        events,
        secretKey: encryptedSecret,
        isActive: true,
      })
      .returning();

    res.status(201).json({
      id: webhook.id,
      url: webhook.url,
      events: webhook.events,
      secret,
      isActive: webhook.isActive,
      createdAt: webhook.createdAt?.toISOString?.() ?? new Date().toISOString(),
    });
  } catch (err) {
    console.error("[agentApi] POST /webhooks error:", err);
    agentError(res, 500, "internal_error", "Failed to register webhook.");
  }
});

// GET /api/v1/agent/webhooks — list webhooks for this API key
router.get("/webhooks", requireScope("webhooks:manage"), async (req: any, res) => {
  try {
    const agentKey = req.agentKey;
    const rows = await db
      .select({
        id: agentWebhooks.id,
        url: agentWebhooks.url,
        events: agentWebhooks.events,
        isActive: agentWebhooks.isActive,
        createdAt: agentWebhooks.createdAt,
      })
      .from(agentWebhooks)
      .where(eq(agentWebhooks.agentKeyId, agentKey.id));

    res.json({
      webhooks: rows.map((w) => ({
        id: w.id,
        url: w.url,
        events: w.events,
        isActive: w.isActive,
        createdAt: w.createdAt?.toISOString?.() ?? null,
      })),
      total: rows.length,
    });
  } catch (err) {
    console.error("[agentApi] GET /webhooks error:", err);
    agentError(res, 500, "internal_error", "Failed to list webhooks.");
  }
});

// DELETE /api/v1/agent/webhooks/:id — remove a webhook
router.delete("/webhooks/:id", requireScope("webhooks:manage"), async (req: any, res) => {
  try {
    const agentKey = req.agentKey;
    const webhookId = req.params.id;

    const existing = await db
      .select({ id: agentWebhooks.id })
      .from(agentWebhooks)
      .where(and(eq(agentWebhooks.id, webhookId), eq(agentWebhooks.agentKeyId, agentKey.id)))
      .limit(1);

    if (existing.length === 0) {
      agentError(res, 404, "session_not_found", "Webhook not found.");
      return;
    }

    await db
      .delete(agentWebhooks)
      .where(and(eq(agentWebhooks.id, webhookId), eq(agentWebhooks.agentKeyId, agentKey.id)));

    res.status(204).end();
  } catch (err) {
    console.error("[agentApi] DELETE /webhooks/:id error:", err);
    agentError(res, 500, "internal_error", "Failed to delete webhook.");
  }
});

export default router;
