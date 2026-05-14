/**
 * Agent API Routes – Enterprise B2B REST API
 * All routes require Bearer <api_key> authentication via isAgentApiKey middleware.
 *
 * NOTE: simulationState is always null in this implementation until Task #292
 * (Simulation Engine) is integrated. Set AGENT_API_ENABLE_SIMULATION=true to enable
 * once #292 is ready.
 *
 * Rate limiting uses express-rate-limit with an in-memory store.
 * TODO: Replace with Redis store for multi-instance deployment (Upstash etc.)
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
  auditLogs,
} from "@shared/schema";
import { eq, and, lt, sql } from "drizzle-orm";
import {
  isAgentApiKey,
  requireScope,
  agentError,
  attachAgentRequestId,
} from "../middleware/agentApiKeyMiddleware";
import { fileManager } from "../services/fileManager";
import { generateAIResponse } from "../services/aiServiceFactory";
import { storage } from "../storage";
import { z } from "zod";

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

function isSimulationEnabled(): boolean {
  return process.env.AGENT_API_ENABLE_SIMULATION === "true";
}

// Best-effort async: aggregate usage for dashboard
async function incrementUsageDaily(
  organizationId: string,
  agentKeyId: string,
  params: { inputTokens?: number; outputTokens?: number; errorCount?: number; latencyMs?: number }
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
          errorCount: sql`${agentUsageDaily.errorCount} + ${params.errorCount ?? 0}`,
        },
      });
  } catch (err) {
    console.warn("[agentApi] Failed to increment usage_daily (non-fatal):", err);
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
// TODO: Replace with Redis store for multi-instance deployment
// ─────────────────────────────────────────────────────────────────────────────
const agentRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: (req) => {
    const key = (req as any).agentKey;
    return key?.rateLimitPerMinute ?? 60;
  },
  keyGenerator: (req) => {
    const key = (req as any).agentKey;
    return key?.id ?? "anonymous";
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    agentError(res, 429, "rate_limit_exceeded", "Rate limit exceeded. See X-RateLimit-* headers for limits.");
  },
  skip: (req) => !(req as any).agentKey,
});

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

    // Create internal persona run
    const allScenarioRuns = await storage.findActiveScenarioRun("__agent__", scenarioId).catch(() => null);
    let personaRunId: string | null = null;
    try {
      const scenarioRun = await storage.createScenarioRun({
        userId: "__agent__",
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

    res.json(buildSessionResponse(freshSession ?? session, requestId));
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

    // Idempotency
    const idempotencyKeyHeader = req.headers["idempotency-key"] as string | undefined;
    const bodyHash = hashRequestBody(req.body);
    if (idempotencyKeyHeader) {
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

    // Call AI
    const language = session.language as any;
    const aiResult = await generateAIResponse(
      scenarioWithDifficulty as any,
      conversationMessages,
      persona,
      message,
      language,
      session.externalUserId
    );

    // Save messages to persona run if available
    const turn = Math.floor(existingMessages.length / 2);
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

    // Update session lastActivityAt
    await db
      .update(agentSessions)
      .set({ lastActivityAt: new Date() })
      .where(eq(agentSessions.id, sessionId))
      .catch(() => {});

    const turnId = generateTurnId(sessionId, turn + 1);

    const responseBody = {
      id: `msg_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      sessionId,
      turnId,
      reply: {
        text: aiResult.content,
        emotionLabel: aiResult.emotion,
        emotionReason: aiResult.emotionReason,
      },
      simulationState: isSimulationEnabled() ? null : null, // #292 Simulation Engine not yet integrated
      turnScore: null, // #292 not yet integrated
      usage: null,
      requestId,
    };

    if (idempotencyKeyHeader) {
      await saveIdempotency(idempotencyKeyHeader, agentKey.id, bodyHash, 200, responseBody);
    }

    // Best-effort async usage tracking
    incrementUsageDaily(orgId, agentKey.id, { latencyMs }).catch(() => {});

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

    await db
      .update(agentSessions)
      .set({ status: "ended", endedAt: new Date() })
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

    const responseBody = {
      sessionId,
      status: "ended",
      endedAt: new Date().toISOString(),
      feedbackReport: null,
      requestId,
    };

    if (idempotencyKeyHeader) {
      await saveIdempotency(idempotencyKeyHeader, agentKey.id, bodyHash, 200, responseBody);
    }

    res.json(responseBody);
  } catch (err) {
    console.error("[agentApi] POST /sessions/:id/end error:", err);
    agentError(res, 500, "internal_error", "Failed to end session.");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Background session cleanup (called periodically)
// ─────────────────────────────────────────────────────────────────────────────
export async function cleanupExpiredAgentSessions(): Promise<void> {
  try {
    const now = new Date();
    const inactiveThreshold = new Date(now.getTime() - AGENT_SESSION_INACTIVE_MINUTES * 60 * 1000);

    await db
      .update(agentSessions)
      .set({ status: "expired" })
      .where(
        and(
          eq(agentSessions.status, "active"),
          lt(agentSessions.lastActivityAt, inactiveThreshold)
        )
      );

    await db
      .update(agentSessions)
      .set({ status: "expired" })
      .where(
        and(
          eq(agentSessions.status, "active"),
          lt(agentSessions.expiresAt, now)
        )
      );

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

function buildSessionResponse(session: any, requestId: string): any {
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
    requestId,
  };
}

export default router;
