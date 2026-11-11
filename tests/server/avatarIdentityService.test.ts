import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";
vi.mock("../../server/storage", () => ({ storage: {} }));
import { AvatarRouterIdentityService } from "../../server/services/liveAvatar/identityService";
import { AvatarDelegationSigner } from "../../server/services/liveAvatar/delegationSigner";
import { liveAvatarAvailability } from "../../shared/avatar/liveAvatar";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = keys.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const limits = {
  userDailySeconds: 600, globalDailySeconds: 3600, userRemainingSeconds: 600,
  globalRemainingSeconds: 3600, sessionSeconds: 120, cleanupPending: 0,
  workerReady: true, providerCredits: "unknown", resetsAt: "2026-10-28T00:00:00Z",
};
let store: any;
let fetcher: ReturnType<typeof vi.fn>;
let service: AvatarRouterIdentityService;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
beforeEach(() => {
  store = {
    getUser: vi.fn(async () => ({ id: "a", isActive: true })),
    getOrganization: vi.fn(), getCompany: vi.fn(),
  };
  fetcher = vi.fn().mockResolvedValue(json({ ...limits, token: "DO_NOT_RELAY", secret: "DO_NOT_RELAY" }));
  service = new AvatarRouterIdentityService(store, new AvatarDelegationSigner(() => ({ issuer: "https://issuer.example.test", privateKeyPem: pem })), fetcher);
});

describe("explicit protected read-only AvatarRouter identity check", () => {
  it("never contacts the provider merely on construction/status inspection", () => {
    expect(service.signer.status().state).toBe("configured");
    expect(fetcher).not.toHaveBeenCalled();
    expect(store.getUser).not.toHaveBeenCalled();
  });

  it("sends only a fresh narrow-scoped delegation, not login JWTs/cookies/browser headers", async () => {
    const result = await service.check("a");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe("https://avatar-router.replit.app/api/v1/live-limits");
    expect(options).toMatchObject({ method: "GET", redirect: "error", credentials: "omit" });
    expect(Object.keys(options.headers).sort()).toEqual(["Accept", "Authorization"]);
    const token = options.headers.Authorization.slice("Bearer ".length);
    const claims = jwt.verify(token, keys.publicKey, { algorithms: ["RS256"], issuer: "https://issuer.example.test", audience: "avatarrouter-api" }) as jwt.JwtPayload;
    expect(claims.scope).toBe("live-limits:read");
    expect(result.limits).toEqual(limits);
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain("DO_NOT_RELAY");
    expect(JSON.stringify(result)).not.toContain(claims.sub);
    expect(JSON.stringify(result)).not.toContain(claims.tenant_id);
    expect(result.accepted).toBe(true);
    // One accepted read cannot establish live media, image rights or multi-tenant isolation.
    expect(liveAvatarAvailability(true, true).available).toBe(false);
  });

  it("does not query membership or make requests while unconfigured", async () => {
    service = new AvatarRouterIdentityService(store, new AvatarDelegationSigner(() => ({})), fetcher);
    await expect(service.check("a")).rejects.toMatchObject({ status: 503, code: "avatar_delegation_not_configured" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(store.getUser).not.toHaveBeenCalled();
  });

  it("rejects deactivated accounts before sending a signed request", async () => {
    store.getUser.mockResolvedValue({ id: "a", isActive: false });
    await expect(service.check("a")).rejects.toMatchObject({ status: 403 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404, 500, 503])("does not retry rejected protected reads or relay upstream errors: %s", async status => {
    fetcher.mockResolvedValue(json({ token: "DO_NOT_RELAY" }, status));
    try { await service.check("a"); expect.fail("Expected a safe error"); }
    catch (error: any) {
      expect(error.message).toMatch(/^avatar_delegation_/);
      expect(JSON.stringify(error)).not.toContain("DO_NOT_RELAY");
      expect(error.cause).toBeUndefined();
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    () => new Response("<html>token DO_NOT_RELAY</html>"),
    () => json({ ...limits, workerReady: "yes" }),
    () => json({ ...limits, userRemainingSeconds: -1 }),
    () => new Response("x".repeat(33 * 1024), { headers: { "content-type": "application/json" } }),
  ])("rejects incompatible and oversized responses", async response => {
    fetcher.mockResolvedValue(response());
    await expect(service.check("a")).rejects.toMatchObject({ status: 502, code: "avatar_delegation_check_failed" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not relay network exceptions containing credential-like values", async () => {
    fetcher.mockRejectedValue(new Error("upstream Authorization: DO_NOT_RELAY"));
    await expect(service.check("a")).rejects.toMatchObject({ status: 502, message: "avatar_delegation_check_failed" });
  });
});
