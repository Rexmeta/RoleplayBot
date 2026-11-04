import { z } from "zod";

export const routerSessionSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/),
  providerId: z.literal("tavus"),
  avatarId: z.string().min(1),
  avatarAssetId: z.string().nullable().optional(),
  mode: z.literal("live"),
  pipeline: z.literal("tavus_full"),
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
