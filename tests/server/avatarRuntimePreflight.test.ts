import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../server/storage", () => ({ storage: {} }));
import { AvatarRuntimePreflight } from "../../server/services/liveAvatar/runtimePreflight";
import { AvatarProjectClient } from "../../server/services/liveAvatar/projectClient";
import { AvatarRouterProjectConnection } from "../../server/services/liveAvatar/projectConnection";
import { liveAvatarAvailability } from "../../shared/avatar/liveAvatar";
import { testScopes } from "../../server/services/liveAvatar/testContracts";

const id = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const asset = {
  id, name: "Synthetic custom candidate", providerId: "tavus", providerAvatarId: "custom-one", status: "ready",
  capabilities: { reusable: true, liveRendering: true, validation: "live_verified" },
  liveValidation: { runtimeSupported: true, status: "validated", method: "client_playback_report",
    validatedAt: "2026-01-01T00:00:00Z", sessionId: "validation-one" },
};
const limits = {
  workerReady: true, cleanupPending: 0, userRemainingSeconds: 120, globalRemainingSeconds: 120,
  sessionSeconds: 120, providerCredits: "unknown", resetsAt: "2099-01-01T00:00:00Z",
};
let call: ReturnType<typeof vi.fn>;
let check: ReturnType<typeof vi.fn>;
let service: AvatarRuntimePreflight;
beforeEach(() => {
  call = vi.fn(async (_user, path, schema) => schema.parse(path === "/avatar-assets" ? [asset] : limits));
  check = vi.fn(async () => ({
    projectId: "configured-project", projectName: "Configured project", scopes: [...testScopes, "assets:read"],
  }));
  service = new AvatarRuntimePreflight({ call } as any, { check } as any);
});

describe("free runtime preflight", () => {
  it("does nothing on construction and never upgrades availability even with all remote checks passing", async () => {
    expect(check).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
    const result = await service.check("verified-admin");
    expect(check).toHaveBeenCalledWith("verified-admin");
    expect(result).toMatchObject({
      available: false, sessionCreated: false, externalMediaSent: false, missingScopes: [],
      candidate: { assetId: id, providerId: "tavus", liveValidated: true },
    });
    expect(call.mock.calls.map(c => c[1]).sort()).toEqual(["/avatar-assets", "/live-limits"]);
    expect(call.mock.calls.every(c => c.length === 3 && c[0] === "verified-admin")).toBe(true);
    expect(result.blockers).toEqual(expect.arrayContaining([
      "tenant_mapping_unverified", "persona_binding_unverified", "pcm_bridge_unverified",
      "media_transport_unverified", "paid_media_validation_not_authorized",
    ]));
    expect(liveAvatarAvailability(true, true).available).toBe(false);
    expect(result).not.toHaveProperty("token");
  });

  it("prefers validated custom Tavus deterministically, never Anam or an unready/unsupported asset", async () => {
    call.mockImplementation(async (_user, path, schema) => schema.parse(path === "/avatar-assets" ? [
      { ...asset, id, providerId: "anam" },
      { ...asset, id, status: "processing" },
      { ...asset, id, liveValidation: { ...asset.liveValidation, runtimeSupported: false } },
      { ...asset, id, liveValidation: { ...asset.liveValidation, status: "unvalidated" } },
      { ...asset, id: otherId },
    ] : limits));
    expect((await service.check("admin")).candidate?.assetId).toBe(otherId);
  });

  it.each(["assets:read", "live-limits:read"])("skips reads lacking %s without inventing success", async missing => {
    check.mockResolvedValue({ projectId: "project", projectName: "Project",
      scopes: [...testScopes, "assets:read"].filter(s => s !== missing) });
    const result = await service.check("admin");
    expect(result.missingScopes).toContain(missing);
    expect(result.blockers).toContain("avatar_preflight_scopes_missing");
    expect(call).toHaveBeenCalledTimes(1);
    if (missing === "assets:read") expect(result.candidate).toBeNull();
    else expect(result.capacity).toBeNull();
  });

  it("sanitizes failed remote reads and does not retain a previous successful candidate", async () => {
    await service.check("admin");
    call.mockRejectedValue(new Error("upstream secret/token/raw response"));
    const result = await service.check("admin");
    expect(result.candidate).toBeNull();
    expect(result.capacity).toBeNull();
    expect(result.blockers).toEqual(expect.arrayContaining(["avatar_preflight_assets_failed", "avatar_preflight_limits_failed"]));
    expect(JSON.stringify(result)).not.toMatch(/secret|token|raw response/);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("rejects authentication before reading assets or capacity", async () => {
    check.mockRejectedValue(new Error("not authenticated"));
    await expect(service.check("admin")).rejects.toThrow("not authenticated");
    expect(call).not.toHaveBeenCalled();
  });

  it("reports capacity, worker and cleanup blockers independently", async () => {
    call.mockImplementation(async (_user, path, schema) => schema.parse(path === "/avatar-assets" ? [] :
      { ...limits, workerReady: false, cleanupPending: 1, userRemainingSeconds: 119 }));
    const result = await service.check("admin");
    expect(result.blockers).toEqual(expect.arrayContaining([
      "avatar_preflight_no_custom_asset", "avatar_preflight_worker_unavailable",
      "avatar_preflight_cleanup_pending", "avatar_preflight_capacity_unavailable",
    ]));
    expect(result.candidate).toBeNull();
  });

  it("deduplicates simultaneous reads per user without sharing results across users", async () => {
    const first = service.check("one");
    expect(service.check("one")).toBe(first);
    const second = service.check("two");
    await Promise.all([first, second]);
    expect(check).toHaveBeenCalledTimes(2);
    await service.check("one");
    expect(check).toHaveBeenCalledTimes(3);
  });

  it("executes only official credentialed GETs using the existing project client", async () => {
    const store = { getUser: vi.fn(async id => ({ id, isActive: true })), getOrganization: vi.fn(), getCompany: vi.fn() };
    const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(
      url.endsWith("/auth/check") ? {
        authenticated: true, authType: "api-key", projectId: "configured-project", projectName: "Configured",
        scopes: [...testScopes, "assets:read"], expiresAt: "2099-01-01T00:00:00Z", userContext: true,
      } : url.endsWith("/avatar-assets") ? [asset] : limits,
    ), { headers: { "content-type": "application/json" } }));
    const input = () => ({ baseUrl: "https://avatar.example.test/api/v1", apiKey: "ar_sk_synthetic_fixture_not_a_real_credential" });
    const remote = new AvatarRuntimePreflight(new AvatarProjectClient(store, fetcher as any, input),
      new AvatarRouterProjectConnection(store, input, fetcher as any));
    await remote.check("active-admin");
    expect(fetcher.mock.calls.map(c => c[0]).sort()).toEqual([
      "https://avatar.example.test/api/v1/auth/check",
      "https://avatar.example.test/api/v1/avatar-assets",
      "https://avatar.example.test/api/v1/live-limits",
    ]);
    for (const [, options] of fetcher.mock.calls as any) {
      expect(options).toMatchObject({ method: "GET", redirect: "error", credentials: "omit" });
      expect(options).not.toHaveProperty("body");
      expect(options.headers).not.toHaveProperty("Cookie");
    }
  });
});
