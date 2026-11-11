import { z } from "zod";
import { AVATAR_ROUTER_ORIGIN } from "../../../shared/avatar/liveAvatar";
import { storage } from "../../storage";
import { AvatarIdentityError, resolveAvatarIdentity, type AvatarIdentityStore } from "./delegatedIdentity";
import { AvatarDelegationSigner } from "./delegationSigner";

const liveLimitsSchema = z.object({
  userDailySeconds: z.number().int().nonnegative(),
  globalDailySeconds: z.number().int().nonnegative(),
  userRemainingSeconds: z.number().int().nonnegative(),
  globalRemainingSeconds: z.number().int().nonnegative(),
  sessionSeconds: z.number().int().positive(),
  cleanupPending: z.number().int().nonnegative(),
  workerReady: z.boolean(),
  providerCredits: z.literal("unknown"),
  resetsAt: z.string().min(1).max(100),
});

export class AvatarRouterIdentityService {
  constructor(
    private readonly store: AvatarIdentityStore,
    readonly signer = new AvatarDelegationSigner(),
    private readonly request: typeof fetch = fetch,
  ) {}

  /** Administrator-triggered, protected READ ONLY. No paid create/media calls. */
  async check(authenticatedUserId: string) {
    if (this.signer.status().state !== "configured") {
      throw new AvatarIdentityError("avatar_delegation_not_configured", 503);
    }
    // Resolve fresh for every call: no cached membership attestation.
    const identity = await resolveAvatarIdentity(this.store, authenticatedUserId);
    const token = this.signer.mint(identity, "live-limits:read");
    try {
      const response = await this.request(`${AVATAR_ROUTER_ORIGIN}/api/v1/live-limits`, {
        method: "GET", redirect: "error", credentials: "omit",
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new AvatarIdentityError("avatar_delegation_rejected", 502);
        if (response.status === 503) throw new AvatarIdentityError("avatar_delegation_upstream_unavailable", 503);
        throw new AvatarIdentityError("avatar_delegation_check_failed", 502);
      }
      if (!(response.headers.get("content-type") ?? "").includes("application/json") ||
          Number(response.headers.get("content-length")) > 32 * 1024 || !response.body) throw new Error();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 32 * 1024) throw new Error();
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      const limits = liveLimitsSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      return {
        accepted: true as const, checkedAt: new Date().toISOString(),
        // Never return the delegated JWT, subject, tenant claim, raw headers or upstream prose.
        limits,
      };
    } catch (error) {
      if (error instanceof AvatarIdentityError) throw error;
      throw new AvatarIdentityError("avatar_delegation_check_failed", 502);
    }
  }
}

export const avatarRouterIdentityService = new AvatarRouterIdentityService(storage);
