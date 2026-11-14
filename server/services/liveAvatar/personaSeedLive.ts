import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { storage } from "../../storage";
import { db } from "../../storage/db";
import { mediaStorage } from "../mediaStorage";
import {
  personaSeedDraftSchema, seedLiveOptionsSchema, seedRegistrationInput, seedResetInput, seedSourceIdentity,
  type PersonaSeedDraft, type PersonaSeedState,
} from "../../../shared/avatar/personaSeedLive";
import { personaAvatarAssetSchema, type PersonaLiveAvatar } from "../../../shared/avatar/personaAvatar";
import { supportsCustomLiveContract } from "../../../shared/avatar/routerContract";
import { AvatarProjectClient } from "./projectClient";
import { avatarRouterProjectConnection } from "./projectConnection";
import { AvatarIdentityError, resolveAvatarIdentity } from "./delegatedIdentity";

const category = "persona_seed_live";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const operationSchema = z.object({
  stage: z.enum(["idle", "registering", "registered", "creating", "submitted"]),
  draft: personaSeedDraftSchema.nullable(),
  previousDraft: personaSeedDraftSchema.nullable().optional(),
  sourceFingerprint: z.string(),
});
type Operation = z.infer<typeof operationSchema>;
const imageSchema = z.object({
  id: z.string().uuid(), version: z.number().int().positive(),
});
const defaultDeps = {
  store: storage,
  client: new AvatarProjectClient(storage),
  connection: avatarRouterProjectConnection,
  identity: (userId: string) => resolveAvatarIdentity(storage, userId),
  readImage: (key: string) => mediaStorage.readImageBuffer(key),
  // Transaction lock is held across the request; write fences use the main pool
  // and commit BEFORE external POST. A crash therefore leaves a durable fence.
  lock: async <T>(key: string, work: () => Promise<T>): Promise<T> => db.transaction(async tx => {
    const result = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${category + key}, 0)) AS locked`);
    if (!(result.rows[0] as { locked?: boolean })?.locked) throw new AvatarIdentityError("persona_seed_busy", 409);
    return work();
  }),
};

/** Existing login/admin guards + verified tenant/project scope; never fetches browser URLs. */
export class PersonaSeedLiveService {
  constructor(private readonly deps = defaultDeps) {}

  private async context(userId: string, personaId: string, source: string, write = false) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(personaId)) {
      throw new AvatarIdentityError("persona_seed_id_invalid", 400);
    }
    const identity = await this.deps.identity(userId);
    const auth = await this.deps.connection.check(userId);
    if (!auth.scopes.includes("assets:read") || write && !auth.scopes.includes("assets:write")) {
      throw new AvatarIdentityError("persona_avatar_asset_scopes_required", 403);
    }
    if (!supportsCustomLiveContract(auth.integration) ||
        !auth.integration?.features?.includes("seed_image_live_options")) {
      throw new AvatarIdentityError("persona_seed_contract_upgrade_required", 409);
    }
    const persona = await this.deps.store.getMbtiPersona(personaId);
    if (!persona) throw new AvatarIdentityError("persona_seed_persona_not_found", 404);
    const saved = seedSourceIdentity(persona.images?.base);
    // Never use an arbitrary caller-supplied media key. URL strings are only
    // compared to the authorized stored reference, and never downloaded by HTTP.
    if (!saved || saved !== seedSourceIdentity(source)) throw new AvatarIdentityError("persona_seed_save_image_first", 409);
    const key = hash(`${identity.tenantId}:${auth.projectId}:${personaId}`);
    return { key, persona, projectId: auth.projectId, source: saved, fingerprint: hash(saved) };
  }
  private async read(key: string): Promise<Operation> {
    const row = await this.deps.store.getSystemSetting(category, key);
    return row ? operationSchema.parse(JSON.parse(row.value)) : { stage: "idle", draft: null, sourceFingerprint: "" };
  }
  private async save(key: string, userId: string, value: Operation) {
    await this.deps.store.upsertSystemSetting({
      category, key, value: JSON.stringify(value), updatedBy: userId,
      description: "Persona seed operation fence; contains no image, URL, consent evidence or provider credentials",
    });
  }
  private async options(userId: string, draft: PersonaSeedDraft) {
    const result = await this.deps.client.call(userId,
      `/assets/images/${draft.imageAssetId}/live-options`, seedLiveOptionsSchema);
    if (result.imageAssetId !== draft.imageAssetId || result.imageVersion !== draft.imageVersion) {
      throw new AvatarIdentityError("persona_seed_response_mismatch", 502);
    }
    return result;
  }
  private async present(userId: string, op: Operation, fingerprint: string): Promise<PersonaSeedState> {
    // Keep a previous source's uncertain write visible, without attaching its
    // candidate/reference to the new image.
    const matches = op.sourceFingerprint === fingerprint;
    const options = op.draft ? await this.options(userId, op.draft) : null;
    const uncertain = op.stage === "registering" ||
      op.stage === "creating" && !options?.candidates.length;
    return {
      stage: uncertain ? op.stage : op.stage === "creating" ? "submitted" : matches ? op.stage : "idle",
      uncertain, draft: matches ? op.draft : null, options: matches ? options : null,
    };
  }
  async status(userId: string, personaId: string, source: string) {
    const ctx = await this.context(userId, personaId, source);
    // Pure reads: no images transferred, provider calls, state repairs or writes.
    return this.present(userId, await this.read(ctx.key), ctx.fingerprint);
  }
  async register(userId: string, personaId: string, source: string, raw: unknown) {
    const input = seedRegistrationInput.safeParse(raw);
    if (!input.success) throw new AvatarIdentityError("persona_seed_consent_required", 400);
    const ctx = await this.context(userId, personaId, source, true);
    return this.deps.lock(ctx.key, async () => {
      const old = await this.read(ctx.key);
      if ((await this.present(userId, old, ctx.fingerprint)).uncertain) {
        throw new AvatarIdentityError("persona_seed_operation_uncertain", 409);
      }
      if (old.draft && old.sourceFingerprint === ctx.fingerprint) return this.present(userId, old, ctx.fingerprint);
      // Only storage-owned persona keys are eligible; no network/SSRF fallback.
      if (!/^(?:personas|uploads|user-personas)\/[^\x00-\x1f\\]+$/.test(ctx.source) ||
          ctx.source.split("/").includes("..")) throw new AvatarIdentityError("persona_seed_source_unsupported", 422);
      const bytes = await this.deps.readImage(ctx.source);
      if (!bytes || bytes.length < 16 || bytes.length > 4_500_000) throw new AvatarIdentityError("persona_seed_image_unavailable", 422);
      const pending: Operation = { stage: "registering", draft: null, sourceFingerprint: ctx.fingerprint };
      await this.save(ctx.key, userId, pending);
      let image;
      try {
        image = await this.deps.client.call(userId, "/assets/images", imageSchema, {
          name: personaId, imageBase64: bytes.toString("base64"),
          ...input.data, transferConfirmed: undefined,
          ...((old.draft ?? old.previousDraft)?.projectId === ctx.projectId
            ? { previousVersionId: (old.draft ?? old.previousDraft)!.imageAssetId } : {}),
        });
      } catch (error) {
        // Definitive validation rejection, not timeout/network/5xx/409.
        if (error instanceof AvatarIdentityError && /^avatar_test_upstream_(400|401|403|404|413|415|422|429)$/.test(error.code)) {
          await this.save(ctx.key, userId, old);
        }
        throw error;
      }
      const op: Operation = {
        stage: "registered", sourceFingerprint: ctx.fingerprint,
        draft: { imageAssetId: image.id, imageVersion: image.version, projectId: ctx.projectId, sourceFingerprint: ctx.fingerprint },
      };
      await this.save(ctx.key, userId, op);
      return this.present(userId, op, ctx.fingerprint);
    });
  }
  /** Local preparation reset only: never deletes assets or clears an unresolved paid-create fence. */
  async reset(userId: string, personaId: string, source: string, raw: unknown) {
    const input = seedResetInput.safeParse(raw);
    if (!input.success) throw new AvatarIdentityError("persona_seed_reset_confirmation_required", 400);
    const ctx = await this.context(userId, personaId, source, true);
    return this.deps.lock(ctx.key, async () => {
      const op = await this.read(ctx.key);
      if (!op.draft || JSON.stringify(op.draft) !== JSON.stringify(input.data.draft) ||
          op.sourceFingerprint !== ctx.fingerprint) {
        throw new AvatarIdentityError("persona_seed_reset_stale", 409);
      }
      const current = await this.present(userId, op, ctx.fingerprint);
      const candidates = current.options?.candidates ?? [];
      if (current.uncertain || !current.options ||
          (op.stage === "submitted" || op.stage === "creating") && !candidates.length ||
          candidates.some(c => !["ready", "failed", "deleted"].includes(c.status) ||
            c.nextAction === "reconcile" || c.failure?.creationOutcome === "unknown" ||
            c.failure?.nextAction === "operator_reconcile")) {
        throw new AvatarIdentityError("persona_seed_reset_blocked", 409);
      }
      const next: Operation = {
        stage: "idle", draft: null, previousDraft: op.draft, sourceFingerprint: ctx.fingerprint,
      };
      await this.save(ctx.key, userId, next);
      return this.present(userId, next, ctx.fingerprint);
    });
  }
  async create(userId: string, personaId: string, source: string, raw: unknown) {
    if (!z.object({ costConfirmed: z.literal(true) }).strict().safeParse(raw).success) {
      throw new AvatarIdentityError("persona_seed_cost_confirmation_required", 400);
    }
    const ctx = await this.context(userId, personaId, source, true);
    return this.deps.lock(ctx.key, async () => {
      const op = await this.read(ctx.key);
      const current = await this.present(userId, op, ctx.fingerprint);
      if (op.stage !== "registered" || current.uncertain || !current.draft || !current.options?.canProvision || current.options.candidates.length) {
        throw new AvatarIdentityError("persona_seed_creation_blocked", 409);
      }
      await this.save(ctx.key, userId, { ...op, stage: "creating" });
      // Never retry automatically, even when a caller repeats this operation.
      const asset = await this.deps.client.call(userId, "/avatar-assets", personaAvatarAssetSchema, {
        imageAssetId: current.draft.imageAssetId, providerId: "tavus", personaId, voiceName: "anna", costConfirmed: true,
      });
      if (asset.imageAssetId !== current.draft.imageAssetId || asset.providerId !== "tavus") {
        throw new AvatarIdentityError("persona_seed_response_mismatch", 502);
      }
      await this.save(ctx.key, userId, { ...op, stage: "submitted" });
      return this.present(userId, { ...op, stage: "submitted" }, ctx.fingerprint);
    });
  }
  /** Save-time re-read, not browser assertions. Drafts can persist before playback. */
  async normalize(userId: string, input: any, existing?: any): Promise<Record<string, unknown>> {
    const source = input.images?.base ?? existing?.images?.base;
    const changed = existing && seedSourceIdentity(source) !== seedSourceIdentity(existing.images?.base);
    const selection = input.liveAvatar === undefined ? existing?.liveAvatar : input.liveAvatar;
    if (changed) return { liveAvatarSeed: null,
      ...(selection?.kind !== "stock" && (existing.liveAvatarSeed || existing.liveAvatar?.seedImageAssetId) ? { liveAvatar: null } : {}) };
    const raw = input.liveAvatarSeed === undefined ? existing?.liveAvatarSeed : input.liveAvatarSeed;
    if (raw === null || raw === undefined) return input.liveAvatarSeed === null ? {
      liveAvatarSeed: null, ...(selection?.kind !== "stock" && existing?.liveAvatarSeed ? { liveAvatar: null } : {}),
    } : {};
    const draft = personaSeedDraftSchema.safeParse(raw);
    if (!draft.success) throw new AvatarIdentityError("persona_seed_draft_invalid", 400);
    const ctx = await this.context(userId, existing?.id ?? input.id, source);
    const op = await this.read(ctx.key);
    if (!op.draft || JSON.stringify(op.draft) !== JSON.stringify(draft.data) || op.sourceFingerprint !== ctx.fingerprint) {
      throw new AvatarIdentityError("persona_seed_draft_mismatch", 409);
    }
    if (!selection || selection.kind === "stock") return { liveAvatarSeed: op.draft };
    const options = await this.options(userId, op.draft);
    const candidate = options.candidates.find(c => c.avatarAssetId === selection.assetId &&
      c.status !== "deleted" && c.status !== "deleting");
    if (!candidate) throw new AvatarIdentityError("persona_seed_candidate_mismatch", 409);
    const reference: PersonaLiveAvatar = {
      kind: "custom", assetId: candidate.avatarAssetId, providerId: "tavus", projectId: ctx.projectId,
      voiceMode: "roleplayx", activation: "draft",
      validationStatus: candidate.canActivate && candidate.liveReference?.avatarAssetId === candidate.avatarAssetId ? "live_verified" : "unverified",
      seedImageAssetId: op.draft.imageAssetId, seedImageVersion: op.draft.imageVersion,
      seedSourceFingerprint: op.draft.sourceFingerprint,
    };
    return { liveAvatarSeed: op.draft, liveAvatar: reference };
  }
}
export const personaSeedLive = new PersonaSeedLiveService();
