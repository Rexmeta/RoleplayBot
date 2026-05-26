/**
 * Admin routes for Agent API Key management.
 * - admin: full create / revoke / list
 * - operator: list only
 */
import { Router } from "express";
import { db } from "../storage";
import {
  agentApiKeys,
  agentKeyScenarios,
  agentUsageDaily,
  auditLogs,
  AGENT_API_SCOPES,
} from "@shared/schema";
import { eq, and, desc, sql, or, gte, lt, lte } from "drizzle-orm";
import { isSystemAdmin, isOperatorOrAdmin } from "../middleware/authMiddleware";
import { asyncHandler, createHttpError } from "./routerHelpers";
import { generateAgentApiKey, computeExpiryDate } from "../utils/agentApiKey";
import { z } from "zod";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Input schemas
// ─────────────────────────────────────────────────────────────────────────────
const createKeySchema = z.object({
  name: z.string().min(1).max(200),
  environment: z.enum(["live", "test"]).default("live"),
  organizationId: z.string().min(1),
  scopes: z.array(z.enum(AGENT_API_SCOPES)).min(1),
  allowedIps: z.array(z.string()).default([]),
  allowedScenarioIds: z.array(z.string()).default([]),
  expiresInDays: z.number().int().min(1).max(365).default(90),
  rateLimitPerMinute: z.number().int().min(1).max(1000).default(60),
});

const revokeKeySchema = z.object({
  reason: z.string().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/agent-keys — list keys (admin + operator)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/",
  isOperatorOrAdmin,
  asyncHandler(async (req: any, res) => {
    const isAdmin = req.user.role === "admin";
    const currentMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"

    // Build visibility filter for operators:
    // operators see keys they created OR keys belonging to their assigned organization
    let whereClause: any = undefined;
    if (!isAdmin) {
      const conditions = [eq(agentApiKeys.ownerUserId, req.user.id)];
      if (req.user.assignedOrganizationId) {
        conditions.push(eq(agentApiKeys.organizationId, req.user.assignedOrganizationId));
      }
      whereClause = conditions.length === 1 ? conditions[0] : or(...conditions);
    }

    const rows = whereClause
      ? await db.select().from(agentApiKeys).where(whereClause).orderBy(desc(agentApiKeys.createdAt))
      : await db.select().from(agentApiKeys).orderBy(desc(agentApiKeys.createdAt));

    // Aggregate this month's requestCount per key from agent_usage_daily
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const nextMonthStart = now.getMonth() === 11
      ? `${now.getFullYear() + 1}-01-01`
      : `${now.getFullYear()}-${String(now.getMonth() + 2).padStart(2, "0")}-01`;

    const usageRows = await db
      .select({
        agentKeyId: agentUsageDaily.agentKeyId,
        monthlyRequests: sql<number>`COALESCE(SUM(${agentUsageDaily.requestCount}), 0)::int`,
        monthlyTotalTokens: sql<number>`COALESCE(SUM(${agentUsageDaily.totalTokens}), 0)::int`,
      })
      .from(agentUsageDaily)
      .where(and(gte(agentUsageDaily.date, monthStart), lt(agentUsageDaily.date, nextMonthStart)))
      .groupBy(agentUsageDaily.agentKeyId);

    const usageByKeyId = new Map(usageRows.map((r) => [r.agentKeyId, r]));

    const result = rows.map((k: any) => {
      const usage = usageByKeyId.get(k.id);
      return {
        id: k.id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        environment: k.environment,
        organizationId: k.organizationId,
        scopes: k.scopes,
        allowedIps: k.allowedIps,
        rateLimitPerMinute: k.rateLimitPerMinute,
        isActive: k.isActive,
        expiresAt: k.expiresAt,
        lastUsedAt: k.lastUsedAt,
        revokedAt: k.revokedAt,
        revocationReason: k.revocationReason,
        createdAt: k.createdAt,
        monthlyRequestCount: usage?.monthlyRequests ?? 0,
        monthlyTotalTokens: usage?.monthlyTotalTokens ?? 0,
      };
    });

    res.json(result);
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/agent-keys — create key (admin only)
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/",
  isSystemAdmin,
  asyncHandler(async (req: any, res) => {
    const parsed = createKeySchema.safeParse(req.body);
    if (!parsed.success) {
      throw Object.assign(createHttpError(400, "Invalid input"), {
        details: parsed.error.flatten(),
      });
    }

    const {
      name,
      environment,
      organizationId,
      scopes,
      allowedIps,
      allowedScenarioIds,
      expiresInDays,
      rateLimitPerMinute,
    } = parsed.data;

    const { fullKey, keyHash, keyPrefix } = generateAgentApiKey(environment);
    const expiresAt = computeExpiryDate(expiresInDays);

    const [newKey] = await db
      .insert(agentApiKeys)
      .values({
        name,
        keyHash,
        keyPrefix,
        environment,
        ownerUserId: req.user.id,
        organizationId,
        scopes,
        allowedIps,
        allowedOrigins: [],
        rateLimitPerMinute,
        expiresAt,
        isActive: true,
      })
      .returning();

    // Insert scenario permissions
    if (allowedScenarioIds.length > 0) {
      await db.insert(agentKeyScenarios).values(
        allowedScenarioIds.map((scenarioId: string) => ({
          agentKeyId: newKey.id,
          scenarioId,
        }))
      );
    }

    // Audit log
    await db.insert(auditLogs).values({
      actorUserId: req.user.id,
      organizationId,
      action: "agent_api_key.created",
      targetType: "agent_api_key",
      targetId: newKey.id,
      metadata: { name, environment, scopes, allowedScenarioIds },
      ip: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
    });

    // Return the full key only once
    res.status(201).json({
      id: newKey.id,
      name: newKey.name,
      keyPrefix: newKey.keyPrefix,
      environment: newKey.environment,
      scopes: newKey.scopes,
      expiresAt: newKey.expiresAt,
      createdAt: newKey.createdAt,
      // Shown ONCE — never stored again
      apiKey: fullKey,
    });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/agent-keys/:id/scenarios — list allowed scenarios for a key
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/:id/scenarios",
  isOperatorOrAdmin,
  asyncHandler(async (req: any, res) => {
    const rows = await db
      .select()
      .from(agentKeyScenarios)
      .where(eq(agentKeyScenarios.agentKeyId, req.params.id));

    res.json(rows.map((r: any) => r.scenarioId));
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/admin/agent-keys/:id/scenarios — update allowed scenarios (admin)
// ─────────────────────────────────────────────────────────────────────────────
router.patch(
  "/:id/scenarios",
  isSystemAdmin,
  asyncHandler(async (req: any, res) => {
    const { scenarioIds } = z
      .object({ scenarioIds: z.array(z.string()) })
      .parse(req.body);

    // Delete existing and re-insert
    await db.delete(agentKeyScenarios).where(eq(agentKeyScenarios.agentKeyId, req.params.id));

    if (scenarioIds.length > 0) {
      await db.insert(agentKeyScenarios).values(
        scenarioIds.map((scenarioId: string) => ({
          agentKeyId: req.params.id,
          scenarioId,
        }))
      );
    }

    res.json({ scenarioIds });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/agent-keys/:id/revoke — revoke key (admin only)
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/:id/revoke",
  isSystemAdmin,
  asyncHandler(async (req: any, res) => {
    const { reason } = revokeKeySchema.parse(req.body);

    const [key] = await db
      .select()
      .from(agentApiKeys)
      .where(eq(agentApiKeys.id, req.params.id))
      .limit(1);

    if (!key) {
      throw createHttpError(404, "API key not found");
    }

    if (key.revokedAt) {
      throw createHttpError(400, "API key is already revoked");
    }

    await db
      .update(agentApiKeys)
      .set({
        revokedAt: new Date(),
        revokedByUserId: req.user.id,
        revocationReason: reason ?? null,
        isActive: false,
      })
      .where(eq(agentApiKeys.id, req.params.id));

    // Audit log
    await db.insert(auditLogs).values({
      actorUserId: req.user.id,
      organizationId: key.organizationId,
      action: "agent_api_key.revoked",
      targetType: "agent_api_key",
      targetId: key.id,
      metadata: { reason: reason ?? null },
      ip: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
    });

    res.json({ success: true, revokedAt: new Date().toISOString() });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/agent-keys/:id/usage — daily usage for a key (admin + operator)
// Query params: from=YYYY-MM-DD, to=YYYY-MM-DD
// ─────────────────────────────────────────────────────────────────────────────
const perKeyUsageQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD"),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD"),
});

router.get(
  "/:id/usage",
  isOperatorOrAdmin,
  asyncHandler(async (req: any, res) => {
    const parsed = perKeyUsageQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw Object.assign(createHttpError(400, "Invalid query params"), {
        details: parsed.error.flatten(),
      });
    }
    const { from, to } = parsed.data;

    // Operators may only view keys they own or those in their assigned org
    const isAdmin = req.user.role === "admin";
    if (!isAdmin) {
      const [key] = await db
        .select({ ownerUserId: agentApiKeys.ownerUserId, organizationId: agentApiKeys.organizationId })
        .from(agentApiKeys)
        .where(eq(agentApiKeys.id, req.params.id))
        .limit(1);
      if (!key) throw createHttpError(404, "API key not found");
      const ownedByUser = key.ownerUserId === req.user.id;
      const ownedByOrg = req.user.assignedOrganizationId
        ? key.organizationId === req.user.assignedOrganizationId
        : false;
      if (!ownedByUser && !ownedByOrg) throw createHttpError(403, "Access denied");
    }

    const rows = await db
      .select()
      .from(agentUsageDaily)
      .where(
        and(
          eq(agentUsageDaily.agentKeyId, req.params.id),
          gte(agentUsageDaily.date, from),
          lte(agentUsageDaily.date, to)
        )
      )
      .orderBy(agentUsageDaily.date);

    res.json(rows);
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/agent-keys/audit-logs — recent audit log entries (admin)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/audit-logs",
  isSystemAdmin,
  asyncHandler(async (_req: any, res) => {
    const rows = await db
      .select()
      .from(auditLogs)
      .where(
        sql`${auditLogs.action} LIKE 'agent_%'`
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(100);

    res.json(rows);
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/agent-keys/usage — daily token spend for admin dashboard
// Query params: ?from=YYYY-MM-DD&to=YYYY-MM-DD&keyId=<id>
// Defaults to current calendar month.
// ─────────────────────────────────────────────────────────────────────────────
const usageQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  keyId: z.string().optional(),
});

router.get(
  "/usage",
  isOperatorOrAdmin,
  asyncHandler(async (req: any, res) => {
    const parsed = usageQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw createHttpError(400, "Invalid query parameters.");
    }

    const today = new Date();
    const defaultFrom = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
    const defaultTo = today.toISOString().slice(0, 10);

    const fromDate = parsed.data.from ?? defaultFrom;
    const toDate = parsed.data.to ?? defaultTo;
    const keyId = parsed.data.keyId;

    const conditions: any[] = [
      gte(agentUsageDaily.date, fromDate),
      lte(agentUsageDaily.date, toDate),
    ];
    if (keyId) {
      conditions.push(eq(agentUsageDaily.agentKeyId, keyId));
    }

    const rows = await db
      .select({
        date: agentUsageDaily.date,
        agentKeyId: agentUsageDaily.agentKeyId,
        requestCount: sql<number>`SUM(${agentUsageDaily.requestCount})::int`,
        inputTokens: sql<number>`SUM(${agentUsageDaily.inputTokens})::int`,
        outputTokens: sql<number>`SUM(${agentUsageDaily.outputTokens})::int`,
        totalTokens: sql<number>`SUM(${agentUsageDaily.totalTokens})::int`,
        cachedTokens: sql<number>`SUM(${agentUsageDaily.cachedTokens})::int`,
        errorCount: sql<number>`SUM(${agentUsageDaily.errorCount})::int`,
      })
      .from(agentUsageDaily)
      .where(and(...conditions))
      .groupBy(agentUsageDaily.date, agentUsageDaily.agentKeyId)
      .orderBy(agentUsageDaily.date);

    // Collapse multi-key rows into single-date aggregates for the chart
    const byDate = new Map<string, { date: string; requestCount: number; inputTokens: number; outputTokens: number; totalTokens: number; cachedTokens: number; errorCount: number }>();
    for (const row of rows) {
      const existing = byDate.get(row.date);
      if (existing) {
        existing.requestCount += row.requestCount;
        existing.inputTokens += row.inputTokens;
        existing.outputTokens += row.outputTokens;
        existing.totalTokens += row.totalTokens;
        existing.cachedTokens += row.cachedTokens;
        existing.errorCount += row.errorCount;
      } else {
        byDate.set(row.date, {
          date: row.date,
          requestCount: row.requestCount,
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
          totalTokens: row.totalTokens,
          cachedTokens: row.cachedTokens,
          errorCount: row.errorCount,
        });
      }
    }

    const dailyRows = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));

    const summary = dailyRows.reduce(
      (acc, r) => {
        acc.totalRequests += r.requestCount;
        acc.totalInputTokens += r.inputTokens;
        acc.totalOutputTokens += r.outputTokens;
        acc.totalCachedTokens += r.cachedTokens;
        acc.totalErrors += r.errorCount;
        return acc;
      },
      { totalRequests: 0, totalInputTokens: 0, totalOutputTokens: 0, totalCachedTokens: 0, totalErrors: 0 }
    );

    res.json({ rows: dailyRows, summary });
  })
);

export default router;
