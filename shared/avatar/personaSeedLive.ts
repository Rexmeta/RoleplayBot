import { z } from "zod";

export const personaSeedDraftSchema = z.object({
  imageAssetId: z.string().uuid(),
  imageVersion: z.number().int().positive(),
  projectId: z.string().min(1).max(256),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type PersonaSeedDraft = z.infer<typeof personaSeedDraftSchema>;
export const seedResetInput = z.object({
  confirmed: z.literal(true),
  draft: personaSeedDraftSchema,
}).strict();

// Fixed public Router contract, not the provider's arbitrary error body.
export const provisioningFailureSchema = z.object({
  code: z.string().max(100), stage: z.enum(["create", "status", "delete", "unknown"]),
  category: z.enum(["training", "authentication", "billing", "permission_or_plan", "provider_limit", "input", "reconciliation", "unknown"]),
  providerHttpStatus: z.number().int().min(100).max(599).nullable(),
  providerErrorCode: z.string().regex(/^[a-z0-9_]{1,100}$/).nullable(),
  reasonState: z.string().max(100),
  message: z.string().max(1000), messageKo: z.string().max(1000),
  automaticRetryAllowed: z.literal(false),
  nextAction: z.enum(["operator_reconcile", "inspect_existing_asset", "operator_review", "replace_image"]),
  creationOutcome: z.enum(["created", "not_created", "unknown"]),
});
export const seedLiveOptionsSchema = z.object({
  imageAssetId: z.string().uuid(), imageVersion: z.number().int().positive(),
  providerId: z.literal("tavus"), canProvision: z.boolean(),
  nextAction: z.enum(["provision", "select", "reconcile", "wait", "validate", "inspect_failure", "replace_image", "review_consent", "configure_provider"]),
  candidates: z.array(z.object({
    avatarAssetId: z.string().uuid(),
    status: z.enum(["queued", "submitting", "processing", "ready", "failed", "reconciliation_required", "deleting", "deleted"]),
    canActivate: z.boolean(),
    nextAction: z.enum(["select", "reconcile", "wait", "validate", "inspect_failure", "replace_image", "review_consent", "configure_provider"]),
    failure: provisioningFailureSchema.nullable().optional(),
    liveReference: z.object({
      providerId: z.literal("tavus"), avatarId: z.string().min(1).max(200),
      avatarAssetId: z.string().uuid(), pipeline: z.literal("tavus_full"),
    }).nullable(),
  })).max(500),
});
export const personaSeedStateSchema = z.object({
  draft: personaSeedDraftSchema.nullable(),
  options: seedLiveOptionsSchema.nullable(),
  uncertain: z.boolean(),
  stage: z.enum(["idle", "registering", "registered", "creating", "submitted"]),
});
export type PersonaSeedState = z.infer<typeof personaSeedStateSchema>;
export const seedRegistrationInput = z.object({
  rightsConfirmed: z.literal(true), transferConfirmed: z.literal(true),
  likeness: z.enum(["synthetic", "real_person"]),
  consentReference: z.string().trim().min(1).max(200).optional(),
}).strict().refine(v => v.likeness !== "real_person" || Boolean(v.consentReference));

/** Stable comparison across signed-URL refreshes; never fetches a URL. */
export function seedSourceIdentity(source: string | null | undefined): string {
  if (!source) return "";
  if (source.startsWith("gcs://")) return source.slice(6).split("?")[0];
  try {
    const url = new URL(source, "https://local.invalid");
    if (url.pathname === "/objects" && url.searchParams.has("key")) return url.searchParams.get("key")!;
    if (url.hostname === "storage.googleapis.com") return decodeURIComponent(url.pathname).replace(/^\/[^/]+\//, "");
    return decodeURIComponent(url.pathname).replace(/^\/(?:objects\/)?/, "");
  } catch { return ""; }
}
