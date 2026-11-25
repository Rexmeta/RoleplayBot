/**
 * Hosted play screen + token-authenticated play API for end users.
 *
 *  GET  /play/:token                      → HTML page (embeddable; frame-ancestors = key.allowedOrigins)
 *  POST /api/v1/agent/play/redeem         → consume the single-use link, get a session-bound access token
 *  POST /api/v1/agent/play/messages       → same handler as POST /sessions/:id/messages
 *  POST /api/v1/agent/play/end            → same handler as POST /sessions/:id/end
 *
 * The access token is bound to exactly one session and one issuing key; the
 * key's scopes, rate limit and usage metering still apply.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { randomBytes } from "crypto";
import { z } from "zod";
import { agentError, attachAgentRequestId } from "../middleware/agentApiKeyMiddleware";
import { agentRateLimiter, handleSendMessage, handleEndSession } from "./agentApi";
import { peekLinkToken, redeemLinkToken, resolveAccessToken, sanitizeOrigins } from "../services/agentPlayLink";
import { fileManager } from "../services/fileManager";
import { renderPlayPage, renderPlayErrorPage } from "../views/agentPlayPage";

// ── Page ─────────────────────────────────────────────────────────────────────
export const agentPlayPageRouter = Router();

agentPlayPageRouter.get("/:token", async (req, res) => {
  const nonce = randomBytes(16).toString("base64");
  let ctx = null;
  try {
    ctx = await peekLinkToken(req.params.token);
  } catch (err) {
    console.error("[agentPlay] page lookup failed:", err);
  }
  const origins = ctx ? sanitizeOrigins(ctx.key.allowedOrigins) : [];
  // No configured origin → the page cannot be framed anywhere.
  const frameAncestors = origins.length > 0 ? origins.join(" ") : "'none'";
  res.setHeader("Content-Security-Policy", [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${frameAncestors}`,
  ].join("; "));
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.type("html");
  if (!ctx) {
    res.status(410).send(renderPlayErrorPage(nonce));
    return;
  }
  res.send(renderPlayPage(nonce, ctx.session.language));
});

// ── API ──────────────────────────────────────────────────────────────────────
export const agentPlayApiRouter = Router();
agentPlayApiRouter.use(attachAgentRequestId);

agentPlayApiRouter.post("/redeem", async (req: any, res) => {
  try {
    const parsed = z.object({ token: z.string().min(10).max(200) }).safeParse(req.body);
    if (!parsed.success) {
      agentError(res, 400, "validation_error", "Invalid request body.");
      return;
    }
    const redeemed = await redeemLinkToken(parsed.data.token);
    if (!redeemed) {
      agentError(res, 401, "invalid_play_token", "Play link is invalid, expired or already used.");
      return;
    }
    const { session, key, link, accessToken } = redeemed;
    const scenarios = await fileManager.getAllScenarios().catch(() => []);
    const personaName = scenarios
      .find((s: any) => s.id === session.scenarioId)?.personas?.find((p: any) => p.id === session.personaId)?.name ?? null;
    res.setHeader("Cache-Control", "no-store");
    res.json({
      accessToken,
      accessExpiresAt: link.accessExpiresAt?.toISOString?.() ?? link.accessExpiresAt,
      sessionId: session.id,
      externalSessionId: session.externalSessionId ?? null,
      language: session.language,
      personaName,
      allowedOrigins: sanitizeOrigins(key.allowedOrigins),
      requestId: req.agentRequestId,
    });
  } catch (err) {
    console.error("[agentPlay] redeem error:", err);
    agentError(res, 500, "internal_error", "Failed to redeem play link.");
  }
});

function requirePlayAccess(scope: "sessions:message" | "sessions:end") {
  return async (req: any, res: Response, next: NextFunction) => {
    try {
      const header = req.headers.authorization as string | undefined;
      const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
      const ctx = token ? await resolveAccessToken(token) : null;
      if (!ctx) {
        agentError(res, 401, "invalid_play_token", "Play access token is invalid or expired.");
        return;
      }
      if (!(ctx.key.scopes ?? []).includes(scope)) {
        agentError(res, 403, "missing_scope", `This API key is missing the required scope: ${scope}`);
        return;
      }
      // Bind the request to the token's session only; client-supplied ids are ignored.
      req.agentKey = ctx.key;
      req.agentOrgId = ctx.key.organizationId;
      req.params = { id: ctx.session.id };
      delete req.headers["idempotency-key"];
      next();
    } catch (err) {
      console.error("[agentPlay] access check error:", err);
      agentError(res, 500, "internal_error", "Internal server error.");
    }
  };
}

agentPlayApiRouter.post("/messages", requirePlayAccess("sessions:message"), agentRateLimiter, handleSendMessage);
agentPlayApiRouter.post("/end", requirePlayAccess("sessions:end"), agentRateLimiter, handleEndSession);
