import { z } from "zod";

export const testSessionSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/),
  providerId: z.literal("tavus"),
  avatarId: z.literal("tavus-stock-lucy"),
  mode: z.literal("live"),
  status: z.enum(["active", "ended", "expired", "failed"]),
  rendererState: z.string().max(100).nullable(),
  stopRequested: z.boolean(),
  cleanupPending: z.boolean(),
  expiresAt: z.string().datetime({ offset: true }),
});
export const testLimitsSchema = z.object({
  userRemainingSeconds: z.number().int().nonnegative(),
  globalRemainingSeconds: z.number().int().nonnegative(),
  sessionSeconds: z.number().int().min(1).max(120),
  cleanupPending: z.number().int().nonnegative(),
  workerReady: z.boolean(),
  providerCredits: z.literal("unknown"),
  resetsAt: z.string().max(100),
});
export const testConnectionSchema = z.object({
  url: z.string().max(2048).refine(value => {
    try {
      const u = new URL(value);
      return u.protocol === "wss:" && !u.username && !u.password && !u.search && !u.hash &&
        /^[a-z0-9.-]+\.livekit\.cloud$/i.test(u.hostname);
    } catch { return false; }
  }),
  token: z.string().min(32).max(8192).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
  expiresAt: z.string().datetime({ offset: true }),
});
export const testTurnSchema = z.object({
  text: z.string().trim().min(1).max(500).optional(),
  audioBase64: z.string().min(1).max(2_000_000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/).optional(),
  mimeType: z.enum(["audio/webm", "audio/mp4", "audio/ogg"]).optional(),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1).max(600),
  }).strict()).max(10),
}).strict().refine(v => Boolean(v.text) !== Boolean(v.audioBase64) && (v.audioBase64 ? Boolean(v.mimeType) : !v.mimeType));

export const testScopes = [
  "live-limits:read", "sessions:create", "sessions:read", "sessions:connect",
  "sessions:audio", "sessions:interrupt", "sessions:end",
] as const;
