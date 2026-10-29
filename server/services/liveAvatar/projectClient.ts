import { z } from "zod";
import { normalizeAvatarRouterBaseUrl } from "./connectionConfig";
import { AvatarIdentityError, resolveAvatarIdentity, type AvatarIdentityStore } from "./delegatedIdentity";

/** Pinned project-key BFF. Callers supply only constant paths and encoded owned IDs. */
export class AvatarProjectClient {
  constructor(
    private readonly store: AvatarIdentityStore,
    private readonly request: typeof fetch = fetch,
    private readonly input = () => ({
      baseUrl: process.env.AVATAR_ROUTER_BASE_URL,
      apiKey: process.env.AVATAR_ROUTER_API_KEY,
    }),
  ) {}

  async call<T>(userId: string, path: string, schema: z.ZodType<T, z.ZodTypeDef, any>, body?: object, signal?: AbortSignal): Promise<T> {
    const input = this.input();
    const base = normalizeAvatarRouterBaseUrl(input.baseUrl);
    const key = input.apiKey;
    if (!base || !key) throw new AvatarIdentityError("avatar_connection_unconfigured", 503);
    if (!/^ar_sk_[\x21-\x7e]{14,1018}$/.test(key)) throw new AvatarIdentityError("avatar_connection_invalid", 503);
    if (!/^\/(?:live-limits|sessions(?:\/[a-zA-Z0-9_-]{1,160}(?:\/(?:connection|audio|interrupt|end))?)?)$/.test(path)) {
      throw new AvatarIdentityError("avatar_test_path_invalid", 400);
    }
    const identity = await resolveAvatarIdentity(this.store, userId);
    try {
      const response = await this.request(`${base}${path}`, {
        method: body === undefined ? "GET" : "POST",
        redirect: "error", credentials: "omit",
        headers: { Accept: "application/json", Authorization: `Bearer ${key}`, "X-Avatar-User-ID": identity.subject,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        const status = [401, 403, 404, 409, 429, 503].includes(response.status) ? response.status : 502;
        throw new AvatarIdentityError(`avatar_test_upstream_${status}`, status);
      }
      if (!response.headers.get("content-type")?.includes("application/json") ||
          Number(response.headers.get("content-length")) > 262_144 || !response.body) throw new Error();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.length;
          if (bytes > 262_144) throw new Error();
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw.includes(key)) throw new Error();
      return schema.parse(JSON.parse(raw));
    } catch (error) {
      if (error instanceof AvatarIdentityError) throw error;
      // POST may already have been accepted. Never retry or claim no charge occurred.
      throw new AvatarIdentityError(body === undefined ? "avatar_test_read_failed" : "avatar_test_operation_uncertain", 502);
    }
  }
}
