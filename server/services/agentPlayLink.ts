/**
 * Hosted play links.
 *
 *  1. Server (API key) issues a link token for one session. TTL 30s–15min.
 *  2. The hosted page redeems the token exactly once (atomic UPDATE) and
 *     receives a session-bound access token (never longer than the session).
 *  3. The access token authorises only messages/end for that session.
 *
 * Only SHA-256 hashes of the 256-bit random tokens are stored.
 */
import { createHash, randomBytes } from "crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../storage";
import { agentPlayLinks, agentSessions, agentApiKeys } from "@shared/schema";

export const PLAY_LINK_MIN_TTL_SECONDS = 30;
export const PLAY_LINK_MAX_TTL_SECONDS = 900;
export const PLAY_LINK_DEFAULT_TTL_SECONDS = 300;
export const PLAY_ACCESS_MAX_MS = 2 * 60 * 60 * 1000;

const LINK_PREFIX = "pll_";
const ACCESS_PREFIX = "pla_";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(prefix: string): string {
  return prefix + randomBytes(32).toString("base64url");
}

export async function issuePlayLink(args: {
  sessionId: string;
  agentKeyId: string;
  ttlSeconds: number;
}): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken(LINK_PREFIX);
  const expiresAt = new Date(Date.now() + args.ttlSeconds * 1000);
  // Only one unredeemed link per session: a new one supersedes older ones.
  await db.delete(agentPlayLinks).where(and(
    eq(agentPlayLinks.sessionId, args.sessionId),
    isNull(agentPlayLinks.redeemedAt),
  ));
  await db.insert(agentPlayLinks).values({
    sessionId: args.sessionId,
    agentKeyId: args.agentKeyId,
    linkTokenHash: hashToken(token),
    linkExpiresAt: expiresAt,
  });
  return { token, expiresAt };
}

export interface PlayContext {
  link: any;
  session: any;
  key: any;
}

async function loadContext(link: any | undefined): Promise<PlayContext | null> {
  if (!link) return null;
  const [session] = await db.select().from(agentSessions).where(eq(agentSessions.id, link.sessionId)).limit(1);
  const [key] = await db.select().from(agentApiKeys).where(eq(agentApiKeys.id, link.agentKeyId)).limit(1);
  if (!session || !key) return null;
  // The issuing key must still be usable and own the session.
  if (session.agentKeyId !== key.id) return null;
  if (!key.isActive || key.revokedAt || (key.expiresAt && key.expiresAt < new Date())) return null;
  return { link, session, key };
}

/** Non-consuming lookup of a still-valid, unredeemed link (used to render the page). */
export async function peekLinkToken(token: string): Promise<PlayContext | null> {
  if (!token.startsWith(LINK_PREFIX)) return null;
  const [link] = await db.select().from(agentPlayLinks)
    .where(eq(agentPlayLinks.linkTokenHash, hashToken(token))).limit(1);
  if (!link || link.redeemedAt || new Date(link.linkExpiresAt) <= new Date()) return null;
  return loadContext(link);
}

/** Atomically consume a link token. Returns null when unknown, expired or already used. */
export async function redeemLinkToken(token: string): Promise<(PlayContext & { accessToken: string }) | null> {
  if (!token.startsWith(LINK_PREFIX)) return null;
  const peeked = await peekLinkToken(token);
  if (!peeked || peeked.session.status !== "active") return null;
  const accessToken = newToken(ACCESS_PREFIX);
  const now = new Date();
  const accessExpiresAt = new Date(Math.min(
    now.getTime() + PLAY_ACCESS_MAX_MS,
    new Date(peeked.session.expiresAt).getTime(),
  ));
  const [updated] = await db.update(agentPlayLinks).set({
    redeemedAt: now,
    accessTokenHash: hashToken(accessToken),
    accessExpiresAt,
  }).where(and(
    eq(agentPlayLinks.id, peeked.link.id),
    isNull(agentPlayLinks.redeemedAt),
    gt(agentPlayLinks.linkExpiresAt, now),
  )).returning();
  if (!updated) return null; // lost the race: single use
  return { ...peeked, link: updated, accessToken };
}

/** Resolve an access token to its single bound session. */
export async function resolveAccessToken(token: string): Promise<PlayContext | null> {
  if (!token.startsWith(ACCESS_PREFIX)) return null;
  const [link] = await db.select().from(agentPlayLinks)
    .where(eq(agentPlayLinks.accessTokenHash, hashToken(token))).limit(1);
  if (!link?.accessExpiresAt || new Date(link.accessExpiresAt) <= new Date()) return null;
  return loadContext(link);
}

/** Keep only well-formed http(s) origins; anything else could inject CSP syntax. */
export function sanitizeOrigins(origins: readonly string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of origins ?? []) {
    try {
      const u = new URL(raw.trim());
      if ((u.protocol === "https:" || u.protocol === "http:") && u.origin !== "null" &&
          raw.trim().replace(/\/$/, "") === u.origin) {
        out.push(u.origin);
      }
    } catch { /* ignore malformed */ }
  }
  return out;
}
