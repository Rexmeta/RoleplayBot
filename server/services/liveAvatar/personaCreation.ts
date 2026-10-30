import { createHash } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { storage } from "../../storage";
import { personaAvatarCreationInput, type PersonaAvatarCreationInput, type PersonaAvatarCreationState } from "../../../shared/avatar/personaAvatarCreation";
import { personaAvatarAssetSchema } from "../../../shared/avatar/personaAvatar";
import { AvatarIdentityError } from "./delegatedIdentity";
import { AvatarProjectClient } from "./projectClient";
import { avatarRouterProjectConnection } from "./projectConnection";

const imageSchema = z.object({
  id: z.string().uuid(), contentHash: z.string().min(1).max(200),
  consentStatus: z.enum(["not_required", "pending_review", "verified"]),
});
const operationSchema = z.object({
  stage: z.enum(["idle", "ingesting", "image_ready", "provisioning", "submitted"]),
  imageId: z.string().uuid().optional(), assetId: z.string().uuid().optional(),
  consentStatus: imageSchema.shape.consentStatus.optional(),
  hash: z.string().optional(),
});
type Operation = z.infer<typeof operationSchema>;
type Store = Pick<typeof storage, "getSystemSetting" | "upsertSystemSetting">;
export const PERSONA_AVATAR_CREATION = "persona_avatar_creation_attempt";
const locks = new Set<string>();

/** One external project, explicit rights attestation, no URLs or automatic write retries. */
export class PersonaAvatarCreationService {
  constructor(
    private readonly client = new AvatarProjectClient(storage),
    private readonly connection: Pick<typeof avatarRouterProjectConnection, "check"> = avatarRouterProjectConnection,
    private readonly store: Store = storage,
  ) {}

  private async context(userId: string) {
    const auth = await this.connection.check(userId);
    if (!(["assets:read", "assets:write"] as const).every(s => auth.scopes.includes(s))) {
      throw new AvatarIdentityError("persona_avatar_asset_scopes_required", 403);
    }
    return createHash("sha256").update(`${auth.projectId}:${userId}`).digest("hex");
  }
  private async read(key: string): Promise<Operation> {
    const saved = await this.store.getSystemSetting(PERSONA_AVATAR_CREATION, key);
    return saved ? operationSchema.parse(JSON.parse(saved.value)) : { stage: "idle" };
  }
  private async save(key: string, userId: string, value: Operation) {
    await this.store.upsertSystemSetting({
      category: PERSONA_AVATAR_CREATION, key, value: JSON.stringify(value), updatedBy: userId,
      description: "Persona avatar write fence; never clear an uncertain external operation",
    });
  }
  private publicState(op: Operation): PersonaAvatarCreationState {
    const { hash: _hash, ...state } = op;
    return { ...state, uncertain: op.stage === "ingesting" || op.stage === "provisioning" };
  }
  private async reconcile(userId: string, key: string, op: Operation) {
    if (op.stage === "ingesting" || op.stage === "image_ready") {
      const images = await this.client.call(userId, "/assets/images", z.array(imageSchema).max(500));
      const image = images.find(i => op.imageId ? i.id === op.imageId : i.contentHash === op.hash);
      if (image) {
        op = { ...op, imageId: image.id, consentStatus: image.consentStatus, stage: "image_ready" };
        await this.save(key, userId, op);
      }
    }
    if (op.stage === "provisioning") {
      const assets = await this.client.call(userId, "/avatar-assets", z.array(personaAvatarAssetSchema).max(500));
      const asset = assets.find(a => a.imageAssetId === op.imageId && a.providerId === "tavus");
      if (asset) {
        op = { ...op, stage: "submitted", assetId: asset.id };
        await this.save(key, userId, op);
      }
    }
    return op;
  }
  async status(userId: string) {
    const key = await this.context(userId);
    if (locks.has(key)) return this.publicState(await this.read(key));
    locks.add(key);
    try { return this.publicState(await this.reconcile(userId, key, await this.read(key))); }
    finally { locks.delete(key); }
  }
  async create(userId: string, raw: PersonaAvatarCreationInput) {
    const parsed = personaAvatarCreationInput.safeParse(raw);
    if (!parsed.success) throw new AvatarIdentityError("persona_avatar_creation_input_invalid", 400);
    const input = parsed.data;
    const bytes = Buffer.from(input.imageBase64, "base64");
    if (bytes.length < 16 || bytes.toString("base64") !== input.imageBase64) {
      throw new AvatarIdentityError("persona_avatar_image_invalid", 400);
    }
    try {
      const meta = await sharp(bytes, { limitInputPixels: 16_777_216 }).metadata();
      if (!["jpeg", "png", "webp"].includes(meta.format ?? "") || !meta.width || !meta.height ||
          meta.width > 4096 || meta.height > 4096 || (meta.pages ?? 1) > 1) throw new Error();
    } catch { throw new AvatarIdentityError("persona_avatar_image_invalid", 400); }
    const key = await this.context(userId);
    if (locks.has(key)) throw new AvatarIdentityError("persona_avatar_creation_in_progress", 409);
    locks.add(key);
    try {
      let op = await this.reconcile(userId, key, await this.read(key));
      if (this.publicState(op).uncertain) throw new AvatarIdentityError("persona_avatar_creation_uncertain", 409);
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (op.hash === hash && op.stage === "submitted" && op.assetId) {
        const asset = await this.client.call(userId, `/avatar-assets/${op.assetId}`, personaAvatarAssetSchema);
        return { state: this.publicState(op), asset };
      }
      if (op.stage === "image_ready" && op.hash !== hash) {
        throw new AvatarIdentityError("persona_avatar_pending_image_mismatch", 409);
      }
      if (op.stage !== "image_ready") {
        op = { stage: "ingesting", hash };
        await this.save(key, userId, op); // No bytes or raw consent references persisted here.
        try {
          const image = await this.client.call(userId, "/assets/images", imageSchema, {
            name: input.name, imageBase64: input.imageBase64, likeness: input.likeness,
            rightsConfirmed: true, ...(input.consentReference ? { consentReference: input.consentReference } : {}),
          });
          op = { ...op, imageId: image.id, consentStatus: image.consentStatus, stage: "image_ready" };
          await this.save(key, userId, op);
        } catch (error) {
          if (this.definitiveRejection(error)) await this.save(key, userId, { stage: "idle" });
          throw error;
        }
      }
      // A client attestation is not an independently verified real-person consent.
      if (op.consentStatus === "pending_review" ||
          (input.likeness === "real_person" && op.consentStatus !== "verified")) {
        return { state: this.publicState(op) };
      }
      op = { ...op, stage: "provisioning" };
      await this.save(key, userId, op);
      try {
        const asset = await this.client.call(userId, "/avatar-assets", personaAvatarAssetSchema, {
          imageAssetId: op.imageId, providerId: "tavus", costConfirmed: true,
        });
        if (asset.providerId !== "tavus" || asset.imageAssetId !== op.imageId) {
          throw new AvatarIdentityError("persona_avatar_provision_mismatch", 502);
        }
        op = { ...op, stage: "submitted", assetId: asset.id };
        await this.save(key, userId, op);
        return { state: this.publicState(op), asset };
      } catch (error) {
        if (this.definitiveRejection(error)) await this.save(key, userId, { ...op, stage: "image_ready" });
        throw error;
      }
    } finally { locks.delete(key); }
  }
  private definitiveRejection(error: unknown) {
    return error instanceof AvatarIdentityError &&
      [400, 401, 403, 404, 413, 415, 422, 429].some(s => error.code === `avatar_test_upstream_${s}`);
  }
}

export const personaAvatarCreation = new PersonaAvatarCreationService();
