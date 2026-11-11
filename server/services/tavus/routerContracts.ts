import { z } from "zod";

export const routerSessionSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/),
  providerId: z.enum(["tavus", "anam"]),
  avatarId: z.string().min(1),
  avatarAssetId: z.string().nullable().optional(),
  mode: z.literal("live"),
  pipeline: z.enum(["tavus_full", "anam_full"]),
  status: z.enum(["active", "ended", "expired", "failed"]),
  rendererState: z.string().nullable(),
  stopRequested: z.boolean(),
  cleanupPending: z.boolean(),
  expiresAt: z.string().datetime({ offset: true }),
});

export const dailyConnectionSchema = z.object({
  transport: z.literal("daily"),
  pipeline: z.literal("tavus_full"),
  url: z.string().max(2048).refine(value => {
    try {
      const u = new URL(value);
      return u.protocol === "https:" && u.hostname.endsWith(".daily.co") &&
        !u.username && !u.password && !u.search && !u.hash && !u.port;
    } catch { return false; }
  }),
  token: z.string().min(1).max(12000),
  expiresAt: z.string().datetime({ offset: true }),
});

const transcriptBase = z.object({ sessionId: z.string().min(1).max(160), source: z.enum(["tavus", "anam"]) });
export const routerTranscriptSchema = z.discriminatedUnion("status", [
  transcriptBase.extend({ status: z.literal("pending") }),
  transcriptBase.extend({ status: z.literal("unavailable") }),
  transcriptBase.extend({
    status: z.literal("ready"), final: z.literal(true), revision: z.string().regex(/^[a-f0-9]{64}$/),
    messages: z.array(z.object({
      role: z.enum(["user", "assistant"]), text: z.string().min(1).max(10000).refine(value => !!value.trim()),
      timestamp: z.string().datetime({ offset: true }),
    })).max(1000),
  }),
]);
