import { z } from "zod";
import { normalizeAvatarRouterBaseUrl } from "./connectionConfig";
import { AvatarIdentityError, resolveAvatarIdentity, type AvatarIdentityStore } from "./delegatedIdentity";

async function readBoundedBody(response: Response, maxBytes: number): Promise<Buffer> {
  if (Number(response.headers.get("content-length")) > maxBytes || !response.body) throw new Error("invalid_body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > maxBytes) throw new Error("body_too_large");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}

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

  /** Only an authorized server-owned image ID may reach this binary endpoint. */
  async image(userId: string, imageAssetId: string): Promise<{ bytes: Buffer; contentType: string }> {
    if (!z.string().uuid().safeParse(imageAssetId).success) throw new AvatarIdentityError("avatar_test_path_invalid", 400);
    const input = this.input();
    const base = normalizeAvatarRouterBaseUrl(input.baseUrl);
    const key = input.apiKey;
    if (!base || !key) throw new AvatarIdentityError("avatar_connection_unconfigured", 503);
    if (!/^ar_sk_[\x21-\x7e]{14,1018}$/.test(key)) throw new AvatarIdentityError("avatar_connection_invalid", 503);
    const identity = await resolveAvatarIdentity(this.store, userId);
    try {
      const response = await this.request(`${base}/assets/images/${imageAssetId}/content`, {
        method: "GET", redirect: "error", credentials: "omit",
        headers: { Accept: "image/png, image/jpeg, image/webp", Authorization: `Bearer ${key}`, "X-Avatar-User-ID": identity.subject },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        const status = [401, 403, 404, 409, 429, 503].includes(response.status) ? response.status : 502;
        throw new AvatarIdentityError(`avatar_test_upstream_${status}`, status);
      }
      const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
      if (!["image/png", "image/jpeg", "image/webp"].includes(contentType)) throw new Error("invalid_image_type");
      const bytes = await readBoundedBody(response, 4_500_000);
      if (!bytes.length) throw new Error("empty_image");
      return { bytes, contentType };
    } catch (error) {
      if (error instanceof AvatarIdentityError) throw error;
      throw new AvatarIdentityError("avatar_test_read_failed", 502);
    }
  }

  async call<T>(userId: string, path: string, schema: z.ZodType<T>, body?: object, signal?: AbortSignal): Promise<T> {
    const input = this.input();
    const base = normalizeAvatarRouterBaseUrl(input.baseUrl);
    const key = input.apiKey;
    if (!base || !key) throw new AvatarIdentityError("avatar_connection_unconfigured", 503);
    if (!/^ar_sk_[\x21-\x7e]{14,1018}$/.test(key)) throw new AvatarIdentityError("avatar_connection_invalid", 503);
    const catalogRead = body === undefined && /^\/avatar-assets(?:\/[a-fA-F0-9-]{36})?$/.test(path);
    const assetWrite = body !== undefined && /^\/(?:assets\/images|avatar-assets(?:\/[a-fA-F0-9-]{36}\/live-validation)?)$/.test(path);
    const imageRead = body === undefined && (path === "/assets/images" ||
      /^\/assets\/images\/[a-fA-F0-9-]{36}\/live-options$/.test(path));
    const stockRead = body === undefined && path === "/avatars";
    const voiceRead = body === undefined && path === "/voices";
    // Owned lifecycle evidence is read-only; never widen this to operator APIs.
    const eventRead = body === undefined && /^\/sessions\/[a-zA-Z0-9_-]{1,160}\/events$/.test(path);
    if (!catalogRead && !assetWrite && !imageRead && !stockRead && !voiceRead && !eventRead && !/^\/(?:live-limits(?:\?providerId=anam)?|sessions(?:\/[a-zA-Z0-9_-]{1,160}(?:\/(?:video-playing|client-connection|connection|full-connection|transcript|audio|interrupt|end))?)?)$/.test(path)) {
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
        const status = [400, 401, 403, 404, 409, 413, 415, 422, 429, 503].includes(response.status) ? response.status : 502;
        // Only the Router's documented public ApiFailure fields may leave the BFF.
        // Never forward arbitrary bodies, provider internals, or credentials.
        let routerResponse: { code: string; error: string } | undefined;
        if (response.headers.get("content-type")?.includes("application/json")) {
          try {
            const text = (await readBoundedBody(response, 16_384)).toString("utf8");
            if (!text.includes(key) && !/(?:ar_sk_|Bearer\s|PRIVATE KEY)/i.test(text)) {
              const parsed = z.object({
                code: z.string().regex(/^[a-zA-Z0-9_.:-]{1,100}$/),
                error: z.string().min(1).max(1000),
              }).safeParse(JSON.parse(text));
              if (parsed.success) routerResponse = parsed.data;
            }
          } catch { /* Untrusted/non-contract error body: retain HTTP status only. */ }
        }
        throw new AvatarIdentityError(`avatar_test_upstream_${status}`, status, routerResponse);
      }
      const maxBytes = body === undefined && path.endsWith("/transcript") ? 2 * 1024 * 1024 : 262_144;
      if (!response.headers.get("content-type")?.includes("application/json") ||
          Number(response.headers.get("content-length")) > maxBytes || !response.body) throw new Error();
      const raw = (await readBoundedBody(response, maxBytes)).toString("utf8");
      if (raw.includes(key)) throw new Error();
      return schema.parse(JSON.parse(raw));
    } catch (error) {
      if (error instanceof AvatarIdentityError) throw error;
      // POST may already have been accepted. Never retry or claim no charge occurred.
      throw new AvatarIdentityError(body === undefined ? "avatar_test_read_failed" : "avatar_test_operation_uncertain", 502);
    }
  }
}
