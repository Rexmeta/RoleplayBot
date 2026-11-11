import { z } from "zod";

export const personaAvatarModeSchema = z.enum(["image", "video", "live"]);
export type PersonaAvatarMode = z.infer<typeof personaAvatarModeSchema>;

const liveDraftShape = {
  providerId: z.enum(["tavus", "anam"]),
  voiceMode: z.literal("roleplayx"),
  validationStatus: z.enum(["unverified", "live_verified"]),
  activation: z.literal("draft"),
  projectId: z.string().min(1).max(256).optional(),
};

const stockReferenceSchema = z.object({
  kind: z.literal("stock"), avatarId: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/),
}).strict();
const customReferenceSchema = z.object({ kind: z.literal("custom"), assetId: z.string().uuid() }).strict();
export const personaAvatarReferenceSchema = z.discriminatedUnion("kind", [
  stockReferenceSchema, customReferenceSchema,
]);
export type PersonaAvatarReference = z.infer<typeof personaAvatarReferenceSchema>;

/** Desired configuration only. Neither catalog selection nor verification activates Live. */
export const personaLiveAvatarSchema = z.union([
  stockReferenceSchema.extend(liveDraftShape),
  // Missing kind is exclusively a legacy custom UUID reference, never a stock ID.
  customReferenceSchema.extend({ ...liveDraftShape, kind: z.literal("custom").optional() }),
]);
export type PersonaLiveAvatar = z.infer<typeof personaLiveAvatarSchema>;

/** /avatars catalog entries are not owned /avatar-assets resources. */
export const personaStockAvatarSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/),
  providerId: z.string().min(1).max(100),
  name: z.string().max(500),
  description: z.string(),
  kind: z.enum(["mock", "configured"]),
  configured: z.boolean(),
  languages: z.array(z.string()),
});
export type PersonaStockAvatar = z.infer<typeof personaStockAvatarSchema>;

export function isSelectableStockAvatar(avatar: PersonaStockAvatar): boolean {
  // Other configured entries and mock avatars have not passed the stock runtime contract.
  return avatar.id === "tavus-stock-lucy" && avatar.providerId === "tavus" &&
    avatar.kind === "configured" && avatar.configured;
}

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
  imageAssetId: z.string().optional(),
  liveValidation: z.object({
    status: z.enum(["unvalidated", "validated"]),
    runtimeSupported: z.boolean(),
    method: z.enum(["client_playback_report"]).nullable(),
    sessionId: z.string().nullable(),
    validatedAt: z.string().nullable(),
  }).optional(),
});
export type PersonaAvatarAsset = z.infer<typeof personaAvatarAssetSchema> & { liveValidated: boolean };
export const personaAvatarCatalogSchema = z.object({
  projectId: z.string().min(1).max(256),
  runtimeAvailable: z.literal(false),
  stockAvatars: z.array(personaStockAvatarSchema).max(500).default([]),
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
  if (asset.liveValidation) {
    return isSelectablePersonaAvatar(asset) && asset.capabilities.liveRendering &&
      asset.liveValidation.runtimeSupported && asset.liveValidation.status === "validated" &&
      asset.liveValidation.method === "client_playback_report" && Boolean(asset.liveValidation.validatedAt);
  }
  return isSelectablePersonaAvatar(asset) && asset.capabilities.liveRendering &&
    asset.capabilities.validation === "live_verified";
}
