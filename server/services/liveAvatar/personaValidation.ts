import { z } from "zod";
import { storage } from "../../storage";
import { personaAvatarAssetSchema } from "../../../shared/avatar/personaAvatar";
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
    const asset = await this.projectClient.call(userId, `/avatar-assets/${assetId}`, personaAvatarAssetSchema);
    if (asset.id !== assetId || asset.providerId !== "tavus" || !asset.providerAvatarId) {
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
  async report(_userId: string, _assetId: string, _sessionId: string) {
    throw new AvatarIdentityError("avatar_validation_managed_by_router", 410);
  }
}
export const personaAvatarValidation = new PersonaAvatarValidationService();
