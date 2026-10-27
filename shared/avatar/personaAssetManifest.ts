import { z } from "zod";

export const PERSONA_AVATAR_EMOTIONS = [
  "neutral",
  "happy",
  "sad",
  "angry",
  "surprised",
  "curious",
  "anxious",
  "tired",
  "disappointed",
  "confused",
  "determined",
  "concerned",
  "excited",
] as const;

export const PERSONA_AVATAR_STATES = [
  "idle",
  "listening",
  "listening_nod",
  "thinking",
  "speaking",
  "speaking_pause",
] as const;

export function isStablePersonaAssetId(value: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return false;
  }
  if (decoded !== value || decoded.includes("\\") || /[\u0000-\u001f\u007f?#]/.test(decoded)) return false;
  if (!decoded.startsWith("personas/") && !decoded.startsWith("user-personas/")) return false;
  return decoded.split("/").every(segment => segment !== "" && segment !== "." && segment !== "..");
}

const stableAssetIdSchema = z.string().trim().min(1).max(2000).refine(isStablePersonaAssetId);
const contentHashSchema = z.string().regex(/^[a-f0-9]{64}$/i);

export const personaAssetManifestSchema = z.object({
  schemaVersion: z.literal("1.0"),
  personaId: z.string().trim().min(1).max(150),
  name: z.string().trim().min(1).max(150),
  sourceImage: z.object({
    assetId: stableAssetIdSchema,
    contentHash: contentHashSchema,
    version: z.number().int().positive(),
  }).strict().optional(),
  expressions: z.record(
    z.string(),
    z.object({
      assetId: stableAssetIdSchema,
    }).strict(),
  ),
  avatarStates: z.array(z.enum(PERSONA_AVATAR_STATES)).min(1),
  metadata: z.object({
    mbti: z.string().trim().min(1).max(20).optional(),
    gender: z.string().trim().min(1).max(50).optional(),
  }).strict().optional(),
}).strict();

export type PersonaAssetManifest = z.infer<typeof personaAssetManifestSchema>;
