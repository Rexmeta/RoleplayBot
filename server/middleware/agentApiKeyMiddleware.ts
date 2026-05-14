import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { db } from "../storage";
import { agentApiKeys } from "@shared/schema";
import { eq } from "drizzle-orm";
import { verifyApiKeyHash, extractKeyPrefix } from "../utils/agentApiKey";
import type { AgentApiKey, AgentApiScope } from "@shared/schema";

// ─────────────────────────────────────────────────────────────────────────────
// Standard error response builder for Agent API
// ─────────────────────────────────────────────────────────────────────────────
export type AgentApiErrorCode =
  | "invalid_api_key"
  | "expired_api_key"
  | "revoked_api_key"
  | "missing_scope"
  | "ip_not_allowed"
  | "scenario_not_found"
  | "persona_not_found"
  | "session_not_found"
  | "session_ended"
  | "rate_limit_exceeded"
  | "quota_exceeded"
  | "concurrent_session_limit_exceeded"
  | "validation_error"
  | "idempotency_key_conflict"
  | "external_session_conflict"
  | "metadata_too_large"
  | "message_too_long"
  | "unsupported_language"
  | "invalid_difficulty"
  | "request_timeout"
  | "service_unavailable"
  | "internal_error"
  | "provider_timeout";

export function agentError(
  res: Response,
  status: number,
  code: AgentApiErrorCode,
  message: string,
  details?: any
): void {
  const requestId = (res as any).__agentRequestId ?? `req_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  res.status(status).json({
    error: { code, message, details: details ?? null },
    requestId,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Attach a request ID to every agent API request
// ─────────────────────────────────────────────────────────────────────────────
export function attachAgentRequestId(req: Request, res: Response, next: NextFunction): void {
  const requestId = `req_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  (req as any).agentRequestId = requestId;
  (res as any).__agentRequestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  // API version header
  res.setHeader("X-API-Version", "2026-05-13");
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// isAgentApiKey – main authentication middleware
// ─────────────────────────────────────────────────────────────────────────────
export async function isAgentApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    agentError(res, 401, "invalid_api_key", "Missing or malformed Authorization header. Expected: Bearer <api_key>");
    return;
  }

  const fullKey = authHeader.slice(7).trim();
  const keyPrefix = extractKeyPrefix(fullKey);
  if (!keyPrefix) {
    agentError(res, 401, "invalid_api_key", "Invalid API key format.");
    return;
  }

  // 1. Fetch candidate keys by prefix (fast index lookup)
  let candidates: AgentApiKey[];
  try {
    candidates = await db
      .select()
      .from(agentApiKeys)
      .where(eq(agentApiKeys.keyPrefix, keyPrefix));
  } catch (err) {
    console.error("[agentApiKeyMiddleware] DB error:", err);
    agentError(res, 500, "internal_error", "Internal server error.");
    return;
  }

  if (candidates.length === 0) {
    agentError(res, 401, "invalid_api_key", "Invalid API key.");
    return;
  }

  // 2. Constant-time HMAC comparison
  const matched = candidates.find((k) => verifyApiKeyHash(fullKey, k.keyHash));
  if (!matched) {
    agentError(res, 401, "invalid_api_key", "Invalid API key.");
    return;
  }

  // 3. Active check
  if (!matched.isActive) {
    agentError(res, 401, "revoked_api_key", "This API key has been revoked.");
    return;
  }

  // 4. Revoked check
  if (matched.revokedAt) {
    agentError(res, 401, "revoked_api_key", "This API key has been revoked.");
    return;
  }

  // 5. Expiry check
  if (matched.expiresAt && matched.expiresAt < new Date()) {
    agentError(res, 401, "expired_api_key", "This API key has expired.");
    return;
  }

  // 6. IP whitelist check
  const allowedIps = matched.allowedIps ?? [];
  if (allowedIps.length > 0) {
    // MVP: use req.ip. For multi-instance prod with proxies (Cloudflare/Nginx),
    // configure Express trust proxy and use CF-Connecting-IP or X-Forwarded-For.
    const clientIp = req.ip ?? req.socket?.remoteAddress ?? "";
    const normalizedClientIp = clientIp.replace(/^::ffff:/, "");
    if (!allowedIps.includes(normalizedClientIp)) {
      agentError(res, 403, "ip_not_allowed", `IP ${normalizedClientIp} is not in the allowed list for this key.`);
      return;
    }
  }

  // 7. Attach to request
  (req as any).agentKey = matched;
  (req as any).agentOrgId = matched.organizationId;

  // 8. Async best-effort: update last_used_at (fire and forget)
  db.update(agentApiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(agentApiKeys.id, matched.id))
    .catch((err) => console.warn("[agentApiKeyMiddleware] Failed to update last_used_at:", err));

  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// requireScope – scope validation middleware factory
// ─────────────────────────────────────────────────────────────────────────────
export function requireScope(scope: AgentApiScope) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key: AgentApiKey | undefined = (req as any).agentKey;
    if (!key) {
      agentError(res, 401, "invalid_api_key", "Authentication required.");
      return;
    }
    const scopes: string[] = key.scopes ?? [];
    if (!scopes.includes(scope)) {
      agentError(res, 403, "missing_scope", `This API key is missing the required scope: ${scope}`);
      return;
    }
    next();
  };
}
