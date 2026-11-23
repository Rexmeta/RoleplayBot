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
    private readonly client: Pick<AvatarProjectClient, "call" | "image" | "voiceCatalogPage"> = new AvatarProjectClient(storage),
    private readonly connection: Pick<typeof avatarRouterProjectConnection, "check"> = avatarRouterProjectConnection,
  ) {}

  private async authorize(userId: string) {
    const auth = await this.connection.check(userId);
    if (!auth.scopes.includes("assets:read")) throw new AvatarIdentityError("avatar_assets_read_scope_missing", 403);
    return auth;
  }

  async list(userId: string) {
    const auth = await this.authorize(userId);
    const [assets, stockAvatars, voicePage] = await Promise.all([
      this.client.call(userId, "/avatar-assets", z.array(personaAvatarAssetSchema).max(500)),
      this.client.call(userId, "/avatars", z.array(personaStockAvatarSchema).max(1000)),
      this.client.voiceCatalogPage(userId, 0),
    ]);
    const { nextOffset, ...voiceCatalog } = voicePage;
    return {
      projectId: auth.projectId, runtimeAvailable: false as const,
      voiceCatalog, voiceCatalogNextOffset: nextOffset,
      customLiveProviders: this.customProviders(auth),
      stockAvatars,
      assets: assets.filter(a => a.providerId === "tavus" || a.providerId === "anam")
        .map(a => ({ ...a, liveValidated: isLiveValidatedPersonaAvatar(a) })),
    };
  }

  private customProviders(auth: Awaited<ReturnType<typeof this.authorize>>) {
    return Array.from(new Set(auth.integration?.customLiveProviders ?? ["tavus"])).filter(
      (provider): provider is "tavus" | "anam" => provider === "tavus" || provider === "anam",
    );
  }

  async voicePage(userId: string, projectId: string, offset: number) {
    const auth = await this.authorize(userId);
    if (auth.projectId !== projectId) throw new AvatarIdentityError("persona_avatar_project_mismatch", 409);
    return this.client.voiceCatalogPage(userId, offset);
  }

  private async resolveVoice(userId: string, providerId: "tavus" | "anam", voiceId: string) {
    let offset: number | null = 0;
    while (offset !== null) {
      const page = await this.client.voiceCatalogPage(userId, offset);
      if (page.providers.find(provider => provider.providerId === providerId)?.status !== "available") return null;
      const voice = page.voices.find(item => item.providerId === providerId && item.id === voiceId);
      if (voice) return voice;
      offset = page.nextOffset;
    }
    return null;
  }

  async thumbnail(userId: string, assetId: string) {
    const parsedId = z.string().uuid().safeParse(assetId);
    if (!parsedId.success) throw new AvatarIdentityError("avatar_test_path_invalid", 400);
    await this.authorize(userId);
    const asset = await this.client.call(
      userId, `/avatar-assets/${parsedId.data}`, personaAvatarAssetSchema,
    );
    if (asset.id !== parsedId.data || !isSelectablePersonaAvatar(asset)) {
      throw new AvatarIdentityError("persona_avatar_asset_not_ready", 404);
    }
    if (!asset.imageAssetId) throw new AvatarIdentityError("persona_avatar_thumbnail_not_available", 404);
    return this.client.image(userId, asset.imageAssetId);
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
    if (parsed.data.kind !== "stock" && (parsed.data.seedImageAssetId || parsed.data.seedImageVersion || parsed.data.seedSourceFingerprint)) {
      throw new AvatarIdentityError("persona_seed_draft_required", 409);
    }
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
    if (parsed.data.kind !== "stock" && !this.customProviders(auth).includes(parsed.data.providerId)) {
      throw new AvatarIdentityError("persona_custom_live_provider_unavailable", 409);
    }
    let voiceSelection = parsed.data.voiceSelection;
    if (voiceSelection && (parsed.data.providerId !== existing?.liveAvatar?.providerId ||
        JSON.stringify(voiceSelection) !== JSON.stringify(existing?.liveAvatar?.voiceSelection))) {
      const voice = await this.resolveVoice(userId, parsed.data.providerId, voiceSelection.voiceId);
      if (!voice || !voice.available || voice.gender !== voiceSelection.gender) {
        throw new AvatarIdentityError("persona_voice_unavailable", 409);
      }
      voiceSelection = { voiceId: voice.id, gender: voice.gender };
    }
    if (parsed.data.kind === "stock") {
      const reference = parsed.data;
      const stock = (await this.client.call(userId, "/avatars", z.array(personaStockAvatarSchema).max(1000)))
        .find(avatar => avatar.id === reference.avatarId && avatar.providerId === reference.providerId);
      if (!stock || !isSelectableStockAvatar(stock)) {
        throw new AvatarIdentityError("persona_stock_avatar_unavailable", 409);
      }
      return {
        ...result, liveAvatar: {
          kind: "stock", avatarId: stock.id, providerId: stock.providerId, projectId: auth.projectId,
          voiceMode: "roleplayx", activation: "draft", validationStatus: "unverified",
          ...(voiceSelection ? { voiceSelection } : {}),
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
        ...(voiceSelection ? { voiceSelection } : {}),
      },
    };
  }
}

export const personaAvatarCatalog = new PersonaAvatarCatalog();
