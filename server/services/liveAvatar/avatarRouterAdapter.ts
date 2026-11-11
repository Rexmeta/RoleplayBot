import { z } from "zod";
import { normalizeAvatarRouterBaseUrl } from "./connectionConfig";
import {
  AVATAR_ROUTER_ORIGIN,
  LIVE_AVATAR_CONTRACT_BLOCKERS,
  type LiveAvatarDiagnostics,
  type AvatarProviderDiagnostic,
} from "../../../shared/avatar/liveAvatar";

const readinessSchema = z.object({
  status: z.string().max(80),
  database: z.boolean(),
  liveEnabled: z.boolean(),
});
const providersSchema = z.array(z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,60}$/),
  name: z.string().min(1).max(100),
  status: z.enum(["available", "degraded", "unconfigured", "unavailable"]),
  externalAudio: z.boolean(),
  implemented: z.boolean(),
})).max(30);

export class LiveAvatarContractError extends Error {
  readonly code = "live_avatar_contract_unverified";
  readonly blockers = [...LIVE_AVATAR_CONTRACT_BLOCKERS];
  constructor() { super("AvatarRouter machine authentication, tenant mapping, PCM and media contracts are not verified."); }
}

/**
 * Read-only adapter for the currently published contract. NO guessed session,
 * upload or PCM endpoints. A stock echo test is not a RoleplayX bridge.
 */
export class AvatarRouterAdapter {
  readonly contractReady = false;
  private inFlight: Promise<LiveAvatarDiagnostics> | null = null;
  private cached: LiveAvatarDiagnostics | null = null;
  private cachedUntil = 0;

  constructor(private readonly request: typeof fetch = fetch) {}

  /**
   * Fail closed until a published server-to-server contract and trusted tenant
   * identity are available. Browser cookies and stock echo sessions cannot
   * authorize RoleplayX uploads, media credentials or AI audio transfers.
   */
  async openSession(_context: { ownerId: string; conversationId: string }): Promise<never> {
    throw new LiveAvatarContractError();
  }

  private async read(path: "/api/ready" | "/api/v1/providers"): Promise<unknown> {
    const base = normalizeAvatarRouterBaseUrl(process.env.AVATAR_ROUTER_BASE_URL) ?? `${AVATAR_ROUTER_ORIGIN}/api/v1`;
    const url = path === "/api/ready" ? `${base.slice(0, -3)}/ready` : `${base}/providers`;
    const response = await this.request(url, {
      method: "GET", redirect: "error",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error("avatar_router_unreachable");
    if (!(response.headers.get("content-type") ?? "").includes("application/json")) {
      throw new Error("avatar_router_invalid_response");
    }
    // Bound both advertised and streamed size, even when content-length is absent.
    if (Number(response.headers.get("content-length")) > 128 * 1024) throw new Error("avatar_router_invalid_response");
    if (!response.body) throw new Error("avatar_router_invalid_response");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 128 * 1024) throw new Error("avatar_router_invalid_response");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }

  /** Only call after an administrator explicitly requests diagnostics. */
  diagnose(): Promise<LiveAvatarDiagnostics> {
    if (this.cached && Date.now() < this.cachedUntil) return Promise.resolve(this.cached);
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.loadDiagnostics().then(result => {
      this.cached = result;
      // Cache failures too, to avoid refresh fan-out to a failing upstream.
      this.cachedUntil = Date.now() + 30_000;
      return result;
    }).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async loadDiagnostics(): Promise<LiveAvatarDiagnostics> {
    try {
      const [rawReady, rawProviders] = await Promise.all([
        this.read("/api/ready"), this.read("/api/v1/providers"),
      ]);
      const ready = readinessSchema.parse(rawReady);
      // Strip all non-contract fields; do not relay upstream prose/URLs/secrets.
      const providers: AvatarProviderDiagnostic[] = providersSchema.parse(rawProviders);
      return {
        reachable: true,
        liveEnabled: ready.status === "ready" && ready.database && ready.liveEnabled,
        providers, blockers: [...LIVE_AVATAR_CONTRACT_BLOCKERS],
        checkedAt: new Date().toISOString(),
      };
    } catch {
      return {
        reachable: false, liveEnabled: false, providers: [],
        blockers: ["avatar_router_diagnostics_failed", ...LIVE_AVATAR_CONTRACT_BLOCKERS],
        checkedAt: new Date().toISOString(),
      };
    }
  }
}
