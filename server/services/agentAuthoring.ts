/**
 * Shared foundation for Agent API authoring (write) endpoints.
 *
 * Rules enforced here, for every authoring endpoint:
 *  - the key needs an authoring scope and an expiry date;
 *  - the key's owner (an operator or admin) defines the reachable categories;
 *  - agents can only create private drafts and never publish, approve or set defaults;
 *  - every write is audited with the agent key and its owner;
 *  - writes have their own rate limit and honour the Idempotency-Key header.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import rateLimit from "express-rate-limit";
import { db, storage } from "../storage";
import {
  auditLogs,
  hasAuthoringScope,
  type AgentApiKey,
  type AgentApiScope,
  type AgentAuthorship,
} from "@shared/schema";
import { agentError, requireScope } from "../middleware/agentApiKeyMiddleware";
import { getOperatorAccessibleCategoryIds } from "../routes/routerHelpers";
import { handleIdempotency, hashRequestBody, saveIdempotency } from "./agentIdempotency";

export interface AgentAuthoringContext {
  key: AgentApiKey;
  owner: { id: string; role: string };
  accessibleCategoryIds: string[];
  authorship: AgentAuthorship;
}

export const AGENT_WRITE_RATE_LIMIT_PER_MINUTE = Number(process.env.AGENT_WRITE_RATE_LIMIT_PER_MINUTE) || 20;

/** Fields an agent may never set: they publish, approve or promote content. */
const PUBLISH_FIELDS: Record<string, (value: unknown) => boolean> = {
  isPublic: (v) => v === true,
  isDemo: (v) => v === true,
  storeListed: (v) => v === true,
  isDefault: (v) => v === true,
  status: (v) => v !== undefined && v !== "draft",
  approvedBy: (v) => v != null,
  approvedAt: (v) => v != null,
};

export function getAuthoringContext(req: Request): AgentAuthoringContext {
  const ctx = (req as any).agentAuthoring as AgentAuthoringContext | undefined;
  if (!ctx) throw new Error("Authoring context is missing; use requireAuthoring() on this route.");
  return ctx;
}

/**
 * Route guard: scope check, expiry requirement, owner resolution and the owner's category scope.
 * Pass a specific authoring scope, or nothing to accept any authoring scope.
 */
export function requireAuthoring(scope?: AgentApiScope): RequestHandler[] {
  const scopeCheck: RequestHandler = scope
    ? requireScope(scope)
    : (req, res, next) => {
        const key: AgentApiKey | undefined = (req as any).agentKey;
        if (!key) return agentError(res, 401, "invalid_api_key", "Authentication required.");
        if (!hasAuthoringScope(key.scopes)) {
          return agentError(res, 403, "missing_scope", "This API key has no authoring scope.");
        }
        next();
      };

  const loadContext: RequestHandler = async (req, res, next) => {
    try {
      const key: AgentApiKey = (req as any).agentKey;
      if (!key.expiresAt) {
        return agentError(res, 403, "authoring_out_of_scope", "Authoring requires an API key with an expiry date.");
      }
      const owner = await storage.getUser(key.ownerUserId);
      if (!owner || owner.isActive === false || (owner.role !== "operator" && owner.role !== "admin")) {
        return agentError(res, 403, "authoring_out_of_scope", "The key owner is no longer allowed to author content.");
      }
      const accessibleCategoryIds = await getOperatorAccessibleCategoryIds(owner);
      (req as any).agentAuthoring = {
        key,
        owner: { id: owner.id, role: owner.role },
        accessibleCategoryIds,
        authorship: { agentKeyId: key.id, agentKeyName: key.name, ownerUserId: owner.id },
      } satisfies AgentAuthoringContext;
      next();
    } catch (err) {
      console.error("[agentAuthoring] context error:", err);
      agentError(res, 500, "internal_error", "Failed to resolve authoring context.");
    }
  };

  return [scopeCheck, writeRateLimiter, loadContext];
}

// ─────────────────────────────────────────────────────────────────────────────
// Write rate limit (separate from the per-key general limit). Only mutating methods count.
// ─────────────────────────────────────────────────────────────────────────────
const writeRateLimiter: RequestHandler = rateLimit({
  windowMs: 60 * 1000,
  limit: AGENT_WRITE_RATE_LIMIT_PER_MINUTE,
  keyGenerator: (req) => `authoring:${(req as any).agentKey?.id ?? "anonymous"}`,
  standardHeaders: false,
  legacyHeaders: false,
  skip: (req) => req.method === "GET" || req.method === "HEAD" || !(req as any).agentKey,
  validate: false,
  handler: (_req, res) => {
    agentError(res, 429, "authoring_rate_limit_exceeded", "Authoring write rate limit exceeded.");
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Scope helpers
// ─────────────────────────────────────────────────────────────────────────────
export function canAccessCategory(ctx: AgentAuthoringContext, categoryId: string | null | undefined): boolean {
  return !!categoryId && ctx.accessibleCategoryIds.includes(categoryId);
}

/** Creating or moving content into a category the owner cannot reach. */
export function denyCategory(res: Response): void {
  agentError(res, 403, "authoring_out_of_scope", "The key owner cannot author content in this category.");
}

/** Existing content outside the owner's scope looks identical to missing content. */
export function denyAsNotFound(res: Response, kind: "scenario" | "persona" | "rubric"): void {
  if (kind === "scenario") return agentError(res, 404, "scenario_not_found", "Scenario not found.");
  if (kind === "persona") return agentError(res, 404, "persona_not_found", "Persona not found.");
  agentError(res, 404, "rubric_not_found", "Rubric not found.");
}

// ─────────────────────────────────────────────────────────────────────────────
// Draft enforcement
// ─────────────────────────────────────────────────────────────────────────────
/** Names of fields in the body that try to publish/approve/promote content. */
export function findPublishAttempts(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const record = body as Record<string, unknown>;
  return Object.keys(PUBLISH_FIELDS).filter((k) => k in record && PUBLISH_FIELDS[k](record[k]));
}

/** Rejects (403) bodies that try to publish; returns true when the request was rejected. */
export function rejectPublishAttempts(res: Response, body: unknown): boolean {
  const attempted = findPublishAttempts(body);
  if (attempted.length === 0) return false;
  agentError(res, 403, "authoring_draft_only",
    "Agents can only create private drafts. Publishing, approval and defaults are done by a person.",
    { fields: attempted });
  return true;
}

/** Fields to merge into a new scenario so it is a private draft attributed to the agent. */
export function scenarioDraftFields(ctx: AgentAuthoringContext) {
  return { isPublic: false, isDemo: false, storeListed: false, authoredByAgent: ctx.authorship };
}

/** Fields to merge into a new rubric set so it is an unapproved, non-default draft. */
export function rubricDraftFields(ctx: AgentAuthoringContext) {
  return {
    status: "draft" as const,
    isDefault: false,
    approvedBy: null,
    approvedAt: null,
    createdBy: ctx.owner.id,
    ownerOperatorId: ctx.owner.id,
    authoredByAgent: ctx.authorship,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit log with agent attribution
// ─────────────────────────────────────────────────────────────────────────────
export async function recordAuthoringAudit(
  req: Request,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const ctx = getAuthoringContext(req);
  await db.insert(auditLogs).values({
    actorUserId: ctx.owner.id,
    organizationId: ctx.key.organizationId,
    action: `agent_authoring.${action}`,
    targetType,
    targetId,
    metadata: {
      ...metadata,
      agentKeyId: ctx.key.id,
      agentKeyName: ctx.key.name,
      ownerUserId: ctx.owner.id,
      requestId: (req as any).agentRequestId ?? null,
    },
    ip: req.ip ?? null,
    userAgent: req.headers["user-agent"] ?? null,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency (same rules as session creation: optional Idempotency-Key header)
// ─────────────────────────────────────────────────────────────────────────────
export const authoringIdempotency: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers["idempotency-key"];
  const key = typeof header === "string" ? header : undefined;
  if (!key || req.method === "GET") return next();
  const agentKey: AgentApiKey = (req as any).agentKey;
  const bodyHash = hashRequestBody({ method: req.method, path: req.path, body: req.body });
  try {
    const { handled } = await handleIdempotency(res, key, agentKey.id, bodyHash);
    if (handled) return;
  } catch (err) {
    console.error("[agentAuthoring] idempotency lookup failed:", err);
    return agentError(res, 500, "internal_error", "Failed to check the idempotency key.");
  }
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      void saveIdempotency(key, agentKey.id, bodyHash, res.statusCode, body);
    }
    return originalJson(body);
  }) as typeof res.json;
  next();
};
