import { z } from "zod";
import { storage } from "../../storage";
import { personaAvatarAssetSchema, isLiveValidatedPersonaAvatar, isSelectablePersonaAvatar } from "../../../shared/avatar/personaAvatar";
import { liveAvatarPreflightSchema, type LiveAvatarPreflight } from "../../../shared/avatar/liveAvatarPreflight";
import { AvatarProjectClient } from "./projectClient";
import { avatarRouterProjectConnection } from "./projectConnection";
import { testLimitsSchema, testScopes } from "./testContracts";

/**
 * Official API 0.5 GETs only. No attempt reconciliation writes, session creation,
 * image fetching/upload, connection-token issuance, or AI/audio calls.
 * A candidate is diagnostic advice, NEVER a saved binding or runtime grant.
 */
export class AvatarRuntimePreflight {
  private readonly inFlight = new Map<string, Promise<LiveAvatarPreflight>>();

  constructor(
    private readonly client: Pick<AvatarProjectClient, "call"> = new AvatarProjectClient(storage),
    private readonly connection: Pick<typeof avatarRouterProjectConnection, "check"> = avatarRouterProjectConnection,
  ) {}

  check(userId: string): Promise<LiveAvatarPreflight> {
    const pending = this.inFlight.get(userId);
    if (pending) return pending;
    const result = this.inspect(userId).finally(() => { this.inFlight.delete(userId); });
    this.inFlight.set(userId, result);
    return result;
  }

  private async inspect(userId: string): Promise<LiveAvatarPreflight> {
    // Fresh server-side login/membership resolution and project authentication.
    const auth = await this.connection.check(userId);
    const required = [...testScopes, "assets:read"];
    const missingScopes = required.filter(scope => !auth.scopes.includes(scope as typeof auth.scopes[number]));
    const blockers: string[] = missingScopes.length ? ["avatar_preflight_scopes_missing"] : [];
    const [assetRead, limitRead] = await Promise.all([
      auth.scopes.includes("assets:read")
        ? this.client.call(userId, "/avatar-assets", z.array(personaAvatarAssetSchema).max(500))
          .then(assets => ({ assets, failed: false }))
          .catch(() => ({ assets: [], failed: true }))
        : Promise.resolve({ assets: [], failed: false }),
      auth.scopes.includes("live-limits:read")
        ? this.client.call(userId, "/live-limits", testLimitsSchema)
          .then(limits => ({ limits, failed: false }))
          .catch(() => ({ limits: null, failed: true }))
        : Promise.resolve({ limits: null, failed: false }),
    ]);
    if (assetRead.failed) blockers.push("avatar_preflight_assets_failed");
    if (limitRead.failed) blockers.push("avatar_preflight_limits_failed");
    const candidates = assetRead.assets.filter(asset =>
      asset.providerId === "tavus" && isSelectablePersonaAvatar(asset) &&
      asset.liveValidation?.runtimeSupported === true,
    ).sort((a, b) => Number(isLiveValidatedPersonaAvatar(b)) - Number(isLiveValidatedPersonaAvatar(a)) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const candidate = candidates[0];
    if (auth.scopes.includes("assets:read") && !assetRead.failed && !candidate) {
      blockers.push("avatar_preflight_no_custom_asset");
    }
    if (candidate && !isLiveValidatedPersonaAvatar(candidate)) blockers.push("custom_avatar_live_unverified");
    const capacity = limitRead.limits;
    if (capacity) {
      if (!capacity.workerReady) blockers.push("avatar_preflight_worker_unavailable");
      if (capacity.cleanupPending) blockers.push("avatar_preflight_cleanup_pending");
      if (capacity.userRemainingSeconds < 120 || capacity.globalRemainingSeconds < 120) {
        blockers.push("avatar_preflight_capacity_unavailable");
      }
    }
    // No mapping/binding/image/rights evidence is inferred from a project catalog.
    blockers.push("tenant_mapping_unverified", "persona_binding_unverified", "pcm_bridge_unverified",
      "media_transport_unverified", "paid_media_validation_not_authorized");
    return liveAvatarPreflightSchema.parse({
      checkedAt: new Date().toISOString(), projectId: auth.projectId, projectName: auth.projectName,
      available: false, sessionCreated: false, externalMediaSent: false, missingScopes,
      candidate: candidate ? {
        assetId: candidate.id, name: candidate.name, providerId: "tavus",
        liveValidated: isLiveValidatedPersonaAvatar(candidate), runtimeSupported: true,
      } : null,
      capacity, blockers,
    });
  }
}

export const avatarRuntimePreflight = new AvatarRuntimePreflight();
