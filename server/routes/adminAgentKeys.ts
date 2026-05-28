/**
 * Admin routes for Agent API Key management.
 * - admin: full create / revoke / list
 * - operator: list only
 */
import { Router } from "express";
import { randomUUID } from "crypto";
import { db } from "../storage";
import { storage } from "../storage";
import {
  agentApiKeys,
  agentKeyScenarios,
  agentUsageDaily,
  agentKeyAlerts,
  agentWebhooks,
  agentWebhookDeliveries,
  auditLogs,
  AGENT_API_SCOPES,
} from "@shared/schema";
import { eq, and, desc, sql, or, gte, lt, lte, isNull, ne } from "drizzle-orm";
import { isSystemAdmin, isOperatorOrAdmin } from "../middleware/authMiddleware";
import { asyncHandler, createHttpError } from "./routerHelpers";
import { generateAgentApiKey, computeExpiryDate } from "../utils/agentApiKey";
import { encryptWebhookSecret, fireTestWebhook, manualRetryDelivery } from "../services/webhookDelivery";
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
        monthlyEstimatedRequests: sql<number>`COALESCE(SUM(${agentUsageDaily.estimatedRequestCount}), 0)::int`,
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
        monthlyEstimatedRequestCount: usage?.monthlyEstimatedRequests ?? 0,
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
        estimatedRequestCount: sql<number>`SUM(${agentUsageDaily.estimatedRequestCount})::int`,
      })
      .from(agentUsageDaily)
      .where(and(...conditions))
      .groupBy(agentUsageDaily.date, agentUsageDaily.agentKeyId)
      .orderBy(agentUsageDaily.date);

    // Collapse multi-key rows into single-date aggregates for the chart
    const byDate = new Map<string, { date: string; requestCount: number; inputTokens: number; outputTokens: number; totalTokens: number; cachedTokens: number; errorCount: number; estimatedRequestCount: number }>();
    for (const row of rows) {
      const existing = byDate.get(row.date);
      if (existing) {
        existing.requestCount += row.requestCount;
        existing.inputTokens += row.inputTokens;
        existing.outputTokens += row.outputTokens;
        existing.totalTokens += row.totalTokens;
        existing.cachedTokens += row.cachedTokens;
        existing.errorCount += row.errorCount;
        existing.estimatedRequestCount += row.estimatedRequestCount;
      } else {
        byDate.set(row.date, {
          date: row.date,
          requestCount: row.requestCount,
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
          totalTokens: row.totalTokens,
          cachedTokens: row.cachedTokens,
          errorCount: row.errorCount,
          estimatedRequestCount: row.estimatedRequestCount,
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

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/agent-keys/alerts — list unacknowledged rate alerts (admin + operator)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/alerts",
  isOperatorOrAdmin,
  asyncHandler(async (req: any, res) => {
    const isAdmin = req.user.role === "admin";

    // Only surface alerts that have an in-app component (exclude webhook-only)
    const inAppFilter = ne(agentKeyAlerts.notificationMethod, "webhook");

    type AlertRow = typeof agentKeyAlerts.$inferSelect;
    let rows: AlertRow[];
    if (isAdmin) {
      rows = await db
        .select()
        .from(agentKeyAlerts)
        .where(and(isNull(agentKeyAlerts.acknowledgedAt), inAppFilter))
        .orderBy(desc(agentKeyAlerts.createdAt))
        .limit(50);
    } else {
      // Operators see alerts for keys they own or their assigned org
      if (!req.user.assignedOrganizationId) {
        rows = [];
      } else {
        rows = await db
          .select()
          .from(agentKeyAlerts)
          .where(and(isNull(agentKeyAlerts.acknowledgedAt), eq(agentKeyAlerts.organizationId, req.user.assignedOrganizationId), inAppFilter))
          .orderBy(desc(agentKeyAlerts.createdAt))
          .limit(50);
      }
    }

    res.json(rows);
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/agent-keys/alerts/:id/acknowledge — dismiss an alert (admin + operator)
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/alerts/:id/acknowledge",
  isOperatorOrAdmin,
  asyncHandler(async (req: any, res) => {
    const [alert] = await db
      .select()
      .from(agentKeyAlerts)
      .where(eq(agentKeyAlerts.id, req.params.id))
      .limit(1);

    if (!alert) throw createHttpError(404, "Alert not found");

    // Operators may only acknowledge alerts for their assigned organization
    const isAdmin = req.user.role === "admin";
    if (!isAdmin) {
      const ownedByOrg = req.user.assignedOrganizationId
        ? alert.organizationId === req.user.assignedOrganizationId
        : false;
      if (!ownedByOrg) throw createHttpError(403, "Access denied");
    }

    await db
      .update(agentKeyAlerts)
      .set({ acknowledgedAt: new Date() })
      .where(eq(agentKeyAlerts.id, req.params.id));

    res.json({ success: true });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/agent-keys/alert-settings — get threshold setting (admin)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/alert-settings",
  isSystemAdmin,
  asyncHandler(async (_req: any, res) => {
    const [thresholdSetting, methodSetting] = await Promise.all([
      storage.getSystemSetting("agent", "real_token_rate_threshold"),
      storage.getSystemSetting("agent", "alert_notification_method"),
    ]);
    const threshold = thresholdSetting ? parseInt(thresholdSetting.value, 10) : 50;
    const notificationMethod = (methodSetting?.value as "in_app" | "webhook" | "both") ?? "in_app";
    res.json({ threshold, notificationMethod });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/admin/agent-keys/alert-settings — update threshold (admin)
// ─────────────────────────────────────────────────────────────────────────────
const alertSettingsSchema = z.object({
  threshold: z.number().int().min(1).max(100),
  notificationMethod: z.enum(["in_app", "webhook", "both"]).default("in_app"),
});

router.put(
  "/alert-settings",
  isSystemAdmin,
  asyncHandler(async (req: any, res) => {
    const parsed = alertSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      throw Object.assign(createHttpError(400, "Invalid input"), {
        details: parsed.error.flatten(),
      });
    }
    await Promise.all([
      storage.upsertSystemSetting({
        category: "agent",
        key: "real_token_rate_threshold",
        value: String(parsed.data.threshold),
        description: "Minimum acceptable real-token rate (%) for agent API keys. Alerts fire when a key drops below this.",
        updatedBy: req.user.id,
      }),
      storage.upsertSystemSetting({
        category: "agent",
        key: "alert_notification_method",
        value: parsed.data.notificationMethod,
        description: "Delivery method for low-token-rate alerts: in_app, webhook, or both.",
        updatedBy: req.user.id,
      }),
    ]);
    res.json({ threshold: parsed.data.threshold, notificationMethod: parsed.data.notificationMethod });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/agent-keys/webhook-deliveries — global delivery log (admin)
// Query params: status (failed|success|all), event, from (YYYY-MM-DD),
//               to (YYYY-MM-DD), limit (default 50, max 100)
// ─────────────────────────────────────────────────────────────────────────────
const deliveryQuerySchema = z.object({
  status: z.enum(["all", "success", "failed"]).default("all"),
  event: z.string().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

router.get(
  "/webhook-deliveries",
  isSystemAdmin,
  asyncHandler(async (req: any, res) => {
    const parsed = deliveryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw Object.assign(createHttpError(400, "Invalid query params"), {
        details: parsed.error.flatten(),
      });
    }
    const { status, event, from, to, limit } = parsed.data;

    const conditions: any[] = [];

    if (status === "success") {
      conditions.push(sql`${agentWebhookDeliveries.succeededAt} IS NOT NULL`);
    } else if (status === "failed") {
      // Any delivery that has not succeeded counts as failed — this includes
      // transport-level failures (statusCode IS NULL) such as network timeouts
      // and connection errors, not just HTTP 4xx/5xx responses.
      conditions.push(sql`${agentWebhookDeliveries.succeededAt} IS NULL`);
    }

    if (event) {
      conditions.push(eq(agentWebhookDeliveries.event, event));
    }

    if (from) {
      conditions.push(gte(agentWebhookDeliveries.createdAt, new Date(`${from}T00:00:00.000Z`)));
    }

    if (to) {
      conditions.push(lte(agentWebhookDeliveries.createdAt, new Date(`${to}T23:59:59.999Z`)));
    }

    const rows = await db
      .select({
        id: agentWebhookDeliveries.id,
        deliveryId: agentWebhookDeliveries.deliveryId,
        event: agentWebhookDeliveries.event,
        statusCode: agentWebhookDeliveries.statusCode,
        latencyMs: agentWebhookDeliveries.latencyMs,
        attempt: agentWebhookDeliveries.attempt,
        succeededAt: agentWebhookDeliveries.succeededAt,
        nextRetryAt: agentWebhookDeliveries.nextRetryAt,
        createdAt: agentWebhookDeliveries.createdAt,
        webhookId: agentWebhookDeliveries.webhookId,
        webhookUrl: agentWebhooks.url,
        agentKeyId: agentWebhooks.agentKeyId,
        agentKeyName: agentApiKeys.name,
        agentKeyPrefix: agentApiKeys.keyPrefix,
      })
      .from(agentWebhookDeliveries)
      .innerJoin(agentWebhooks, eq(agentWebhookDeliveries.webhookId, agentWebhooks.id))
      .innerJoin(agentApiKeys, eq(agentWebhooks.agentKeyId, agentApiKeys.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(agentWebhookDeliveries.createdAt))
      .limit(limit);

    res.json(
      rows.map((d) => ({
        id: d.id,
        deliveryId: d.deliveryId,
        event: d.event,
        statusCode: d.statusCode,
        latencyMs: d.latencyMs ?? null,
        attempt: d.attempt,
        succeededAt: d.succeededAt?.toISOString() ?? null,
        nextRetryAt: d.nextRetryAt?.toISOString() ?? null,
        createdAt: d.createdAt?.toISOString() ?? null,
        webhookId: d.webhookId,
        webhookUrl: d.webhookUrl,
        agentKeyId: d.agentKeyId,
        agentKeyName: d.agentKeyName,
        agentKeyPrefix: d.agentKeyPrefix,
      }))
    );
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/agent-keys/webhook-coverage — per-key webhook subscription
// status for agent_key.low_token_rate (admin)
// ─────────────────────────────────────────────────────────────────────────────
const LOW_TOKEN_RATE_EVENT = "agent_key.low_token_rate";

router.get(
  "/webhook-coverage",
  isSystemAdmin,
  asyncHandler(async (_req: any, res) => {
    const [keys, webhooks] = await Promise.all([
      db
        .select({
          id: agentApiKeys.id,
          name: agentApiKeys.name,
          keyPrefix: agentApiKeys.keyPrefix,
          isActive: agentApiKeys.isActive,
          revokedAt: agentApiKeys.revokedAt,
        })
        .from(agentApiKeys)
        .orderBy(desc(agentApiKeys.createdAt)),
      db
        .select({
          agentKeyId: agentWebhooks.agentKeyId,
          events: agentWebhooks.events,
        })
        .from(agentWebhooks)
        .where(eq(agentWebhooks.isActive, true)),
    ]);

    const subscribedKeyIds = new Set(
      webhooks
        .filter((w) => w.events.includes(LOW_TOKEN_RATE_EVENT))
        .map((w) => w.agentKeyId)
    );

    res.json(
      keys.map((k) => ({
        keyId: k.id,
        keyName: k.name,
        keyPrefix: k.keyPrefix,
        isActive: k.isActive && !k.revokedAt,
        hasSubscription: subscribedKeyIds.has(k.id),
      }))
    );
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/admin/agent-keys/:id/webhooks/:webhookId — toggle active state (admin)
// ─────────────────────────────────────────────────────────────────────────────
router.patch(
  "/:id/webhooks/:webhookId",
  isSystemAdmin,
  asyncHandler(async (req: any, res) => {
    const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);

    const [existing] = await db
      .select({ id: agentWebhooks.id })
      .from(agentWebhooks)
      .where(
        and(
          eq(agentWebhooks.id, req.params.webhookId),
          eq(agentWebhooks.agentKeyId, req.params.id)
        )
      )
      .limit(1);

    if (!existing) throw createHttpError(404, "Webhook not found");

    const [updated] = await db
      .update(agentWebhooks)
      .set({ isActive })
      .where(
        and(
          eq(agentWebhooks.id, req.params.webhookId),
          eq(agentWebhooks.agentKeyId, req.params.id)
        )
      )
      .returning({ id: agentWebhooks.id, isActive: agentWebhooks.isActive });

    res.json({ id: updated.id, isActive: updated.isActive });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/agent-keys/:id/webhooks — list webhooks for a key (admin)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/:id/webhooks",
  isSystemAdmin,
  asyncHandler(async (req: any, res) => {
    const rows = await db
      .select({
        id: agentWebhooks.id,
        url: agentWebhooks.url,
        events: agentWebhooks.events,
        isActive: agentWebhooks.isActive,
        createdAt: agentWebhooks.createdAt,
      })
      .from(agentWebhooks)
      .where(eq(agentWebhooks.agentKeyId, req.params.id))
      .orderBy(desc(agentWebhooks.createdAt));

    res.json(
      rows.map((w) => ({
        id: w.id,
        url: w.url,
        events: w.events,
        isActive: w.isActive,
        createdAt: w.createdAt?.toISOString?.() ?? null,
      }))
    );
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/agent-keys/:id/webhooks — create a webhook for a key (admin)
// ─────────────────────────────────────────────────────────────────────────────
const createWebhookAdminSchema = z.object({
  url: z.string().url("Must be a valid HTTPS URL"),
  events: z.array(z.string().min(1)).min(1, "At least one event required"),
});

router.post(
  "/:id/webhooks",
  isSystemAdmin,
  asyncHandler(async (req: any, res) => {
    const [key] = await db
      .select({ id: agentApiKeys.id })
      .from(agentApiKeys)
      .where(eq(agentApiKeys.id, req.params.id))
      .limit(1);

    if (!key) throw createHttpError(404, "API key not found");

    const parsed = createWebhookAdminSchema.safeParse(req.body);
    if (!parsed.success) {
      throw Object.assign(createHttpError(400, "Invalid input"), {
        details: parsed.error.flatten(),
      });
    }

    const { url, events } = parsed.data;

    const secret = `whsec_${randomUUID().replace(/-/g, "")}`;
    const encryptedSecret = encryptWebhookSecret(secret);

    const [webhook] = await db
      .insert(agentWebhooks)
      .values({
        agentKeyId: req.params.id,
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
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/agent-keys/:id/webhooks/:webhookId/deliveries — recent deliveries (admin)
// Query param: limit (default 20, max 50)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/:id/webhooks/:webhookId/deliveries",
  isSystemAdmin,
  asyncHandler(async (req: any, res) => {
    // Verify the webhook belongs to the key
    const [webhook] = await db
      .select({ id: agentWebhooks.id })
      .from(agentWebhooks)
      .where(
        and(
          eq(agentWebhooks.id, req.params.webhookId),
          eq(agentWebhooks.agentKeyId, req.params.id)
        )
      )
      .limit(1);

    if (!webhook) throw createHttpError(404, "Webhook not found");

    const limitParam = parseInt(String(req.query.limit ?? "20"), 10);
    const limit = Math.min(Math.max(1, isNaN(limitParam) ? 20 : limitParam), 50);

    const rows = await db
      .select()
      .from(agentWebhookDeliveries)
      .where(eq(agentWebhookDeliveries.webhookId, req.params.webhookId))
      .orderBy(desc(agentWebhookDeliveries.createdAt))
      .limit(limit);

    res.json(
      rows.map((d) => ({
        id: d.id,
        deliveryId: d.deliveryId,
        event: d.event,
        statusCode: d.statusCode,
        latencyMs: d.latencyMs ?? null,
        attempt: d.attempt,
        payload: d.payload ?? null,
        succeededAt: d.succeededAt?.toISOString() ?? null,
        nextRetryAt: d.nextRetryAt?.toISOString() ?? null,
        createdAt: d.createdAt?.toISOString() ?? null,
      }))
    );
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/agent-keys/:id/webhooks/:webhookId/test — fire a test event (admin)
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/:id/webhooks/:webhookId/test",
  isSystemAdmin,
  asyncHandler(async (req: any, res) => {
    const { ok, statusCode } = await fireTestWebhook(req.params.webhookId, req.params.id);
    res.json({ ok, statusCode });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/agent-keys/:id/webhooks/:webhookId/deliveries/:deliveryId/retry
// Immediately re-attempts a failed delivery and records a new row (admin only)
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/:id/webhooks/:webhookId/deliveries/:deliveryId/retry",
  isSystemAdmin,
  asyncHandler(async (req: any, res) => {
    // Verify the webhook belongs to the key
    const [webhook] = await db
      .select({
        id: agentWebhooks.id,
        url: agentWebhooks.url,
        secretKey: agentWebhooks.secretKey,
      })
      .from(agentWebhooks)
      .where(
        and(
          eq(agentWebhooks.id, req.params.webhookId),
          eq(agentWebhooks.agentKeyId, req.params.id)
        )
      )
      .limit(1);

    if (!webhook) throw createHttpError(404, "Webhook not found");

    // Look up the original delivery row to get the payload and event
    const [delivery] = await db
      .select({
        id: agentWebhookDeliveries.id,
        event: agentWebhookDeliveries.event,
        payload: agentWebhookDeliveries.payload,
        succeededAt: agentWebhookDeliveries.succeededAt,
        nextRetryAt: agentWebhookDeliveries.nextRetryAt,
        webhookId: agentWebhookDeliveries.webhookId,
      })
      .from(agentWebhookDeliveries)
      .where(
        and(
          eq(agentWebhookDeliveries.id, req.params.deliveryId),
          eq(agentWebhookDeliveries.webhookId, req.params.webhookId)
        )
      )
      .limit(1);

    if (!delivery) throw createHttpError(404, "Delivery record not found");
    if (delivery.succeededAt) throw createHttpError(400, "Delivery already succeeded");
    if (delivery.nextRetryAt && delivery.nextRetryAt > new Date()) {
      throw createHttpError(409, "An automatic retry is already scheduled for this delivery");
    }

    const { ok, statusCode } = await manualRetryDelivery(
      webhook,
      delivery.event as any,
      delivery.payload
    );

    await db.insert(auditLogs).values({
      actorUserId: req.user.id,
      action: "agent_webhook.delivery_retried",
      targetType: "agent_webhook_delivery",
      targetId: delivery.id,
      metadata: {
        webhookId: req.params.webhookId,
        agentKeyId: req.params.id,
        originalDeliveryId: delivery.id,
        event: delivery.event,
        retryOk: ok,
        retryStatusCode: statusCode,
      },
      ip: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
    });

    res.json({ ok, statusCode });
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/admin/agent-keys/:id/webhooks/:webhookId — delete a webhook (admin)
// ─────────────────────────────────────────────────────────────────────────────
router.delete(
  "/:id/webhooks/:webhookId",
  isSystemAdmin,
  asyncHandler(async (req: any, res) => {
    const [existing] = await db
      .select({ id: agentWebhooks.id })
      .from(agentWebhooks)
      .where(
        and(
          eq(agentWebhooks.id, req.params.webhookId),
          eq(agentWebhooks.agentKeyId, req.params.id)
        )
      )
      .limit(1);

    if (!existing) throw createHttpError(404, "Webhook not found");

    await db
      .delete(agentWebhooks)
      .where(
        and(
          eq(agentWebhooks.id, req.params.webhookId),
          eq(agentWebhooks.agentKeyId, req.params.id)
        )
      );

    res.status(204).end();
  })
);

export default router;
