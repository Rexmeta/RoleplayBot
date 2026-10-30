import { z } from "zod";
import { storage } from "../../storage";
import { AvatarIdentityError, resolveAvatarIdentity, type AvatarIdentityStore } from "./delegatedIdentity";
import { normalizeAvatarRouterBaseUrl } from "./connectionConfig";

const scopes = [
  "live-limits:read", "sessions:create", "sessions:read", "sessions:connect",
  "sessions:audio", "sessions:interrupt", "sessions:end", "assets:read", "assets:write",
] as const;
const checkSchema = z.object({
  authenticated: z.literal(true),
  authType: z.literal("api-key"),
  projectId: z.string().min(1).max(256),
  projectName: z.string().min(1).max(60),
  scopes: z.array(z.enum(scopes)).min(1).max(9),
  expiresAt: z.string().datetime({ offset: true }),
  userContext: z.literal(true),
  integration: z.object({
    apiVersion: z.string().max(40),
    features: z.array(z.string().max(100)).max(30),
    customLiveProviders: z.array(z.string().max(100)).max(30),
  }).optional(),
});
type Input = { baseUrl?: string; apiKey?: string };
export type AvatarProjectConnectionStatus = {
  authMode: "api-key"; state: "configured" | "unconfigured" | "invalid"; baseUrl?: string;
};

/** Project authentication only. It neither maps local tenants nor enables paid sessions. */
export class AvatarRouterProjectConnection {
  constructor(
    private readonly store: AvatarIdentityStore,
    private readonly input: () => Input = () => ({
      baseUrl: process.env.AVATAR_ROUTER_BASE_URL,
      apiKey: process.env.AVATAR_ROUTER_API_KEY,
    }),
    private readonly request: typeof fetch = fetch,
  ) {}

  private configuration(): { baseUrl: string; apiKey: string } | null {
    const input = this.input();
    const baseUrl = normalizeAvatarRouterBaseUrl(input.baseUrl);
    if (!baseUrl || !input.apiKey) return null;
    // Treat the key as opaque. Only reject malformed/header-injection input.
    if (!input.apiKey.startsWith("ar_sk_") || input.apiKey.length < 20 ||
        input.apiKey.length > 1024 || /[^\x21-\x7e]/.test(input.apiKey)) {
      throw new AvatarIdentityError("avatar_connection_invalid", 503);
    }
    return { baseUrl, apiKey: input.apiKey };
  }

  status(): AvatarProjectConnectionStatus {
    try {
      const config = this.configuration();
      return { authMode: "api-key", state: config ? "configured" : "unconfigured",
        ...(config ? { baseUrl: config.baseUrl } : {}) };
    } catch {
      return { authMode: "api-key", state: "invalid" };
    }
  }

  /** Only explicit authenticated admin action calls this free auth endpoint. */
  async check(authenticatedUserId: string) {
    const config = this.configuration();
    if (!config) throw new AvatarIdentityError("avatar_connection_unconfigured", 503);
    const identity = await resolveAvatarIdentity(this.store, authenticatedUserId);
    try {
      const response = await this.request(`${config.baseUrl}/auth/check`, {
        method: "GET", redirect: "error", credentials: "omit",
        headers: { Accept: "application/json", Authorization: `Bearer ${config.apiKey}`, "X-Avatar-User-ID": identity.subject },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        const code = response.status === 401 ? "avatar_connection_rejected" :
          response.status === 403 ? "avatar_connection_forbidden" :
          response.status === 429 ? "avatar_connection_rate_limited" :
          response.status === 503 ? "avatar_connection_upstream_unavailable" : "avatar_connection_check_failed";
        throw new AvatarIdentityError(code, response.status === 429 ? 429 : response.status === 503 ? 503 : 502);
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
      const result = checkSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      if (Date.parse(result.expiresAt) <= Date.now() || JSON.stringify(result).includes(config.apiKey)) throw new Error();
      return { ...result, checkedAt: new Date().toISOString() };
    } catch (error) {
      if (error instanceof AvatarIdentityError) throw error;
      throw new AvatarIdentityError("avatar_connection_check_failed", 502);
    }
  }
}

export const avatarRouterProjectConnection = new AvatarRouterProjectConnection(storage);
