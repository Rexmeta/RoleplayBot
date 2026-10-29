import { isIP } from "node:net";
import { AvatarIdentityError } from "./delegatedIdentity";

/** Operator-pinned server setting only; never accept destinations from HTTP input. */
export function normalizeAvatarRouterBaseUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    if (value.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(value)) throw new Error();
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
        !/^\/api\/v1\/?$/.test(url.pathname) || !host.includes(".") ||
        host.endsWith(".localhost") || host.endsWith(".local") ||
        isIP(host.replace(/^\[|\]$/g, ""))) throw new Error();
    return `${url.origin}/api/v1`;
  } catch {
    throw new AvatarIdentityError("avatar_connection_invalid", 503);
  }
}
