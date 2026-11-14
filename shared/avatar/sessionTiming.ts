import { z } from "zod";

/** Observational server receipt times, never billing or continuous playback. */
export const sessionTimingSchema = z.object({
  routerElapsedSeconds: z.number().int().nonnegative(),
  clientVideoReportedAt: z.string().datetime({ offset: true }).nullable(),
  preparationSeconds: z.number().int().nonnegative().nullable(),
  connectedSeconds: z.number().int().nonnegative().nullable(),
  evidence: z.enum(["not_reported", "authenticated_client_report"]),
});
export type SessionTiming = z.infer<typeof sessionTimingSchema>;
export const videoObservationSchema = z.object({ event: z.literal("video_frame_presented") }).strict();
