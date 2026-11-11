import { z } from "zod";
import { storage } from "../../storage";
import {
  personaAvatarAssetSchema, personaAvatarModeSchema, personaLiveAvatarSchema,
  isSelectablePersonaAvatar, isLiveValidatedPersonaAvatar,
  personaStockAvatarSchema, isSelectableStockAvatar,
} from "../../../shared/avatar/personaAvatar";
import { AvatarProjectClient } from "./projectClient";
import { avatarRouterProjectConnection } from "./projectConnection";
import { AvatarIdentityError } from "./delegatedIdentity";

/** Read-only project catalog. No provisioning, image transfer or paid session calls. */
export class PersonaAvatarCatalog {
  constructor(
    private readonly client = new AvatarProjectClient(storage),
    private readonly connection: Pick<typeof avatarRouterProjectConnection, "check"> = avatarRouterProjectConnection,
  ) {}

  private async authorize(userId: string) {
    const auth = await this.connection.check(userId);
    if (!auth.scopes.includes("assets:read")) throw new AvatarIdentityError("avatar_assets_read_scope_missing", 403);
    return auth;
  }

  async list(userId: string) {
    const auth = await this.authorize(userId);
    const assets = await this.client.call(userId, "/avatar-assets", z.array(personaAvatarAssetSchema).max(500));
    const stockAvatars = await this.client.call(userId, "/avatars", z.array(personaStockAvatarSchema).max(500));
    return {
      projectId: auth.projectId, runtimeAvailable: false as const,
      stockAvatars,
      assets: assets.filter(a => a.providerId === "tavus" || a.providerId === "anam")
        .map(a => ({ ...a, liveValidated: isLiveValidatedPersonaAvatar(a) })),
    };
  }

  /** Accept only a server-resolved reference. Browser validation claims never grant activation. */
  async normalize(userId: string, input: any, existing?: any): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};
    // DB/older API responses represent legacy absence with null.
    if (input.avatarMode === null) result.avatarMode = null;
    if (input.avatarMode !== undefined && input.avatarMode !== null) {
      const mode = personaAvatarModeSchema.safeParse(input.avatarMode);
      if (!mode.success) throw new AvatarIdentityError("persona_avatar_mode_invalid", 400);
      result.avatarMode = mode.data;
      if (mode.data !== "live") {
        const videos = input.videos ?? existing?.videos;
        if (videos || mode.data === "video") {
          result.videos = { ...videos, enabled: mode.data === "video" };
        }
      }
    }
    if (input.liveAvatar === undefined) return result; // Older clients must not clear the draft.
    if (input.liveAvatar === null) return { ...result, liveAvatar: null };
    const parsed = personaLiveAvatarSchema.safeParse(input.liveAvatar);
    if (!parsed.success) throw new AvatarIdentityError("persona_live_avatar_invalid", 400);
    // Preserve unchanged drafts during unrelated edits, including when the provider is offline.
    // Their stored validation is historical only: activation remains unconditionally draft.
    if (existing?.liveAvatar?.activation === "draft" &&
        JSON.stringify(parsed.data) === JSON.stringify(personaLiveAvatarSchema.safeParse(existing.liveAvatar).data)) {
      return { ...result, liveAvatar: existing.liveAvatar };
    }
    const auth = await this.authorize(userId);
    if (parsed.data.projectId && parsed.data.projectId !== auth.projectId) {
      throw new AvatarIdentityError("persona_avatar_project_mismatch", 409);
    }
    if (parsed.data.kind === "stock") {
      const reference = parsed.data;
      const stock = (await this.client.call(userId, "/avatars", z.array(personaStockAvatarSchema).max(500)))
        .find(avatar => avatar.id === reference.avatarId && avatar.providerId === reference.providerId);
      if (!stock || !isSelectableStockAvatar(stock)) {
        throw new AvatarIdentityError("persona_stock_avatar_unavailable", 409);
      }
      return {
        ...result, liveAvatar: {
          kind: "stock", avatarId: stock.id, providerId: stock.providerId, projectId: auth.projectId,
          voiceMode: "roleplayx", activation: "draft", validationStatus: "unverified",
        },
      };
    }
    const asset = await this.client.call(userId, `/avatar-assets/${parsed.data.assetId}`, personaAvatarAssetSchema);
    if (asset.id !== parsed.data.assetId || asset.providerId !== parsed.data.providerId) {
      throw new AvatarIdentityError("persona_avatar_asset_mismatch", 409);
    }
    if (!isSelectablePersonaAvatar(asset)) throw new AvatarIdentityError("persona_avatar_asset_not_ready", 409);
    return {
      ...result, liveAvatar: {
        ...(parsed.data.kind === "custom" ? { kind: "custom" } : {}),
        assetId: asset.id, providerId: asset.providerId, projectId: auth.projectId,
        voiceMode: "roleplayx", activation: "draft",
        validationStatus: isLiveValidatedPersonaAvatar(asset) ? "live_verified" : "unverified",
      },
    };
  }
}

export const personaAvatarCatalog = new PersonaAvatarCatalog();
