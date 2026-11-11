import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { sql } from "drizzle-orm";
import {
  personaAvatarAssets,
  personaAvatarBindings,
  type PersonaAvatarAsset,
  type PersonaAvatarBinding,
} from "../../shared/schema/personaAvatar";
import { db } from "../storage/db";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/i);
const bindingInputSchema = z.object({
  tenantScope: z.string().trim().min(1).max(150),
  personaType: z.enum(["mbti", "user"]),
  personaId: z.string().trim().min(1).max(150),
  providerId: z.string().trim().min(1).max(100),
  sourceImageHash: hashSchema,
}).strict();

export type SavePersonaAvatarBindingInput = z.infer<typeof bindingInputSchema>;
export type SavedPersonaAvatarBinding = {
  asset: PersonaAvatarAsset;
  binding: PersonaAvatarBinding;
  reusedAsset: boolean;
  reusedBinding: boolean;
};

export function nextPersonaAvatarSourceVersion(
  latest: Pick<PersonaAvatarBinding, "sourceImageHash" | "sourceImageVersion"> | undefined,
  nextSourceImageHash: string,
): number {
  if (!latest) return 1;
  return latest.sourceImageHash.toLowerCase() === nextSourceImageHash.toLowerCase()
    ? latest.sourceImageVersion
    : latest.sourceImageVersion + 1;
}

/**
 * The tenant scope must come from trusted server-side ownership data. It is
 * intentionally part of the cache key so identical images are never reused
 * across unrelated owners.
 */
export async function savePersonaAvatarBinding(
  input: SavePersonaAvatarBindingInput,
  connection: typeof db = db,
): Promise<SavedPersonaAvatarBinding> {
  const value = bindingInputSchema.parse(input);
  const lockKey = [value.tenantScope, value.personaType, value.personaId, value.providerId].join(":");

  return connection.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

    const [insertedAsset] = await tx.insert(personaAvatarAssets).values({
      tenantScope: value.tenantScope,
      providerId: value.providerId,
      sourceImageHash: value.sourceImageHash.toLowerCase(),
    }).onConflictDoNothing({
      target: [
        personaAvatarAssets.tenantScope,
        personaAvatarAssets.providerId,
        personaAvatarAssets.sourceImageHash,
      ],
    }).returning();

    let asset = insertedAsset;
    if (!asset) {
      [asset] = await tx.select().from(personaAvatarAssets).where(and(
        eq(personaAvatarAssets.tenantScope, value.tenantScope),
        eq(personaAvatarAssets.providerId, value.providerId),
        eq(personaAvatarAssets.sourceImageHash, value.sourceImageHash.toLowerCase()),
      )).limit(1);
    }
    if (!asset) throw new Error("persona_avatar_asset_upsert_failed");

    const latestRows = await tx.select().from(personaAvatarBindings).where(and(
      eq(personaAvatarBindings.tenantScope, value.tenantScope),
      eq(personaAvatarBindings.personaType, value.personaType),
      eq(personaAvatarBindings.personaId, value.personaId),
      eq(personaAvatarBindings.providerId, value.providerId),
    )).orderBy(desc(personaAvatarBindings.sourceImageVersion)).limit(1);
    const latest = latestRows[0];

    if (latest?.sourceImageHash === value.sourceImageHash.toLowerCase()) {
      return { asset, binding: latest, reusedAsset: !insertedAsset, reusedBinding: true };
    }

    const sourceImageVersion = nextPersonaAvatarSourceVersion(latest, value.sourceImageHash);
    await tx.update(personaAvatarBindings).set({
      status: "stale",
      updatedAt: new Date(),
    }).where(and(
      eq(personaAvatarBindings.tenantScope, value.tenantScope),
      eq(personaAvatarBindings.personaType, value.personaType),
      eq(personaAvatarBindings.personaId, value.personaId),
      eq(personaAvatarBindings.providerId, value.providerId),
      ne(personaAvatarBindings.status, "stale"),
    ));

    const [binding] = await tx.insert(personaAvatarBindings).values({
      tenantScope: value.tenantScope,
      personaType: value.personaType,
      personaId: value.personaId,
      providerId: value.providerId,
      assetId: asset.id,
      sourceImageHash: value.sourceImageHash.toLowerCase(),
      sourceImageVersion,
      status: asset.status,
    }).returning();
    if (!binding) throw new Error("persona_avatar_binding_insert_failed");
    return { asset, binding, reusedAsset: !insertedAsset, reusedBinding: false };
  });
}

const rightsReviewSchema = z.object({
  bindingId: z.string().uuid(),
  status: z.enum(["pending_review", "approved", "rejected"]),
  likeness: z.enum(["synthetic", "real_person"]).optional(),
  consentReference: z.string().trim().min(1).max(200).optional(),
  reviewerId: z.string().trim().min(1).max(150),
}).strict().superRefine((input, ctx) => {
  if (input.status === "approved" && !input.likeness) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["likeness"], message: "likeness is required for approval" });
  }
  if (input.status === "approved" && input.likeness === "real_person" && !input.consentReference) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["consentReference"], message: "consent evidence reference is required for real-person likeness" });
  }
});

/**
 * Record a trusted review outcome without accepting evidence documents or
 * identity data. Route-level operator authorization belongs to the caller.
 */
export async function reviewPersonaAvatarBindingRights(
  input: Omit<z.input<typeof rightsReviewSchema>, "reviewerId">,
  trustedReviewerId: string,
  connection: typeof db = db,
): Promise<PersonaAvatarBinding> {
  const value = rightsReviewSchema.parse({ ...input, reviewerId: trustedReviewerId });
  const [binding] = await connection.update(personaAvatarBindings).set({
    rightsStatus: value.status,
    likeness: value.likeness ?? null,
    consentReference: value.consentReference ?? null,
    reviewedBy: value.status === "pending_review" ? null : value.reviewerId,
    reviewedAt: value.status === "pending_review" ? null : new Date(),
    updatedAt: new Date(),
  }).where(eq(personaAvatarBindings.id, value.bindingId)).returning();
  if (!binding) throw new Error("persona_avatar_binding_not_found");
  return binding;
}

const assetUpdateSchema = z.object({
  assetId: z.string().uuid(),
  status: z.enum(["pending", "ready", "failed"]),
  routerAssetId: z.string().trim().min(1).max(200).optional(),
  providerAvatarId: z.string().trim().min(1).max(200).optional(),
  failureCode: z.string().regex(/^[a-z0-9_]{1,100}$/).optional(),
}).strict().superRefine((input, ctx) => {
  if (input.status === "ready" && !input.routerAssetId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["routerAssetId"], message: "routerAssetId is required when ready" });
  }
  if (input.status === "failed" && !input.failureCode) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["failureCode"], message: "failureCode is required when failed" });
  }
  if (input.status !== "failed" && input.failureCode) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["failureCode"], message: "failureCode is only valid when failed" });
  }
});

/** Persist only safe provider identifiers/codes; never provider response bodies or credentials. */
export async function updatePersonaAvatarAssetStatus(
  input: z.input<typeof assetUpdateSchema>,
  connection: typeof db = db,
): Promise<PersonaAvatarAsset> {
  const value = assetUpdateSchema.parse(input);
  return connection.transaction(async tx => {
    const [asset] = await tx.update(personaAvatarAssets).set({
      status: value.status,
      routerAssetId: value.routerAssetId,
      providerAvatarId: value.providerAvatarId,
      failureCode: value.failureCode ?? null,
      updatedAt: new Date(),
    }).where(eq(personaAvatarAssets.id, value.assetId)).returning();
    if (!asset) throw new Error("persona_avatar_asset_not_found");

    await tx.update(personaAvatarBindings).set({
      status: value.status,
      updatedAt: new Date(),
    }).where(and(
      eq(personaAvatarBindings.assetId, value.assetId),
      ne(personaAvatarBindings.status, "stale"),
    ));
    return asset;
  });
}
