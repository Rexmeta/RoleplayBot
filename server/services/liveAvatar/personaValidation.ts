import { z } from "zod";
import { supportsCustomLiveContract } from "../../../shared/avatar/routerContract";
import { storage } from "../../storage";
import { personaAvatarAssetSchema, isSelectablePersonaAvatar } from "../../../shared/avatar/personaAvatar";
import { avatarTestReady } from "../../../shared/avatar/adminAvatarTest";
import { AvatarIdentityError } from "./delegatedIdentity";
import { AvatarProjectClient } from "./projectClient";
import { avatarRouterProjectConnection } from "./projectConnection";
import { AdminAvatarTestService } from "./adminTestService";

const client = new AvatarProjectClient(storage);
const services = new Map<string, AdminAvatarTestService>();

export class PersonaAvatarValidationService {
  constructor(
    private readonly projectClient = client,
    private readonly connection: Pick<typeof avatarRouterProjectConnection, "check"> = avatarRouterProjectConnection,
    private readonly tests = services,
  ) {}
  async resolve(userId: string, assetId: string) {
    if (!z.string().uuid().safeParse(assetId).success) throw new AvatarIdentityError("persona_avatar_asset_id_invalid", 400);
    const auth = await this.connection.check(userId);
    if (!(["assets:read", "assets:write"] as const).every(s => auth.scopes.includes(s))) {
      throw new AvatarIdentityError("persona_avatar_asset_scopes_required", 403);
    }
    if (!supportsCustomLiveContract(auth.integration)) {
      throw new AvatarIdentityError("persona_avatar_contract_upgrade_required", 409);
    }
    const asset = await this.projectClient.call(userId, `/avatar-assets/${assetId}`, personaAvatarAssetSchema);
    if (asset.id !== assetId || asset.providerId !== "tavus" || !isSelectablePersonaAvatar(asset) ||
        !asset.liveValidation?.runtimeSupported) {
      throw new AvatarIdentityError("persona_avatar_custom_runtime_unavailable", 409);
    }
    return { providerAvatarId: asset.providerAvatarId! };
  }
  service(assetId: string) {
    if (!z.string().uuid().safeParse(assetId).success) throw new AvatarIdentityError("persona_avatar_asset_id_invalid", 400);
    let test = this.tests.get(assetId);
    if (!test) {
      // No eviction of in-flight services: turn cancellation must survive other asset reads.
      if (this.tests.size >= 500) throw new AvatarIdentityError("persona_avatar_validation_capacity", 503);
      test = new AdminAvatarTestService(this.projectClient, this.connection, storage, undefined, undefined, {
        assetId, resolve: userId => this.resolve(userId, assetId),
      });
      this.tests.set(assetId, test);
    }
    return test;
  }
  async report(userId: string, assetId: string, sessionId: string) {
    const target = await this.resolve(userId, assetId);
    const session = await this.service(assetId).session(userId, sessionId);
    if (!avatarTestReady(session) || Date.parse(session.expiresAt) <= Date.now() ||
        session.avatarId !== target.providerAvatarId) {
      throw new AvatarIdentityError("persona_avatar_validation_session_invalid", 409);
    }
    // Upstream enforces original owner, completed audio command and exact asset revision.
    const asset = await this.projectClient.call(userId, `/avatar-assets/${assetId}/live-validation`,
      personaAvatarAssetSchema, { sessionId, videoObserved: true, audioObserved: true });
    if (asset.id !== assetId || asset.providerAvatarId !== target.providerAvatarId ||
        asset.liveValidation?.status !== "validated" || asset.liveValidation.sessionId !== sessionId) {
      throw new AvatarIdentityError("persona_avatar_validation_report_mismatch", 502);
    }
    return asset;
  }
}
export const personaAvatarValidation = new PersonaAvatarValidationService();
