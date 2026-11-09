import { z } from "zod";
import { normalizeAvatarRouterBaseUrl } from "./connectionConfig";
import { AvatarIdentityError } from "./delegatedIdentity";

/** The opaque connection is short-lived browser-only data. Never persist it. */
export const managedConnectionSchema = z.object({
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/),
  pipeline: z.literal("anam_full"),
  audioOwner: z.literal("avatarrouter"),
  clientScriptPath: z.literal("/sdk/avatarrouter-client.js"),
  expiresAt: z.string().datetime({ offset: true }),
  connection: z.record(z.string(), z.unknown()),
});

export function managedClientDescriptor(value: z.infer<typeof managedConnectionSchema>, sessionId: string) {
  const base = normalizeAvatarRouterBaseUrl(process.env.AVATAR_ROUTER_BASE_URL);
  if (!base || value.sessionId !== sessionId || Date.parse(value.expiresAt) <= Date.now()) {
    throw new AvatarIdentityError("avatar_client_connection_invalid", 502);
  }
  // Origin is pinned by the operator, never supplied by a browser/upstream URL.
  return { ...value, clientScriptUrl: `${new URL(base).origin}${value.clientScriptPath}` };
}

export const anamFeatures = [
  "anam_full_pipeline", "unified_client_connection", "hosted_browser_client",
] as const;
export const nativeScopes = [
  "live-limits:read", "sessions:create", "sessions:read", "sessions:connect", "sessions:end",
] as const;
