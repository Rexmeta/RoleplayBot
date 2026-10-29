import { z } from "zod";

export const personaAvatarModeSchema = z.enum(["image", "video", "live"]);
export type PersonaAvatarMode = z.infer<typeof personaAvatarModeSchema>;

/** Desired live configuration only. This release cannot activate a live persona. */
export const personaLiveAvatarSchema = z.object({
  assetId: z.string().uuid(),
  providerId: z.enum(["tavus", "anam"]),
  voiceMode: z.literal("roleplayx"),
  validationStatus: z.enum(["unverified", "live_verified"]),
  activation: z.literal("draft"),
  projectId: z.string().min(1).max(256).optional(),
}).strict();
export type PersonaLiveAvatar = z.infer<typeof personaLiveAvatarSchema>;

export const personaAvatarAssetSchema = z.object({
  id: z.string().uuid(),
  name: z.string().max(500),
  providerId: z.string().min(1).max(100),
  providerAvatarId: z.string().min(1).max(200).nullable(),
  status: z.enum(["queued", "submitting", "processing", "ready", "failed", "reconciliation_required", "deleting", "deleted"]),
  capabilities: z.object({
    reusable: z.boolean(),
    liveRendering: z.boolean(),
    validation: z.enum(["documentation_only", "provisioned", "live_verified"]),
  }),
});
export type PersonaAvatarAsset = z.infer<typeof personaAvatarAssetSchema> & { liveValidated: boolean };
export const personaAvatarCatalogSchema = z.object({
  projectId: z.string().min(1).max(256),
  runtimeAvailable: z.literal(false),
  assets: z.array(personaAvatarAssetSchema.extend({
    providerId: z.enum(["tavus", "anam"]),
    liveValidated: z.boolean(),
  })).max(500),
});

export function isSelectablePersonaAvatar(asset: z.infer<typeof personaAvatarAssetSchema>): boolean {
  return (asset.providerId === "tavus" || asset.providerId === "anam") &&
    asset.status === "ready" && asset.capabilities.reusable && Boolean(asset.providerAvatarId);
}

export function isLiveValidatedPersonaAvatar(asset: z.infer<typeof personaAvatarAssetSchema>): boolean {
  return isSelectablePersonaAvatar(asset) && asset.capabilities.liveRendering &&
    asset.capabilities.validation === "live_verified";
}
