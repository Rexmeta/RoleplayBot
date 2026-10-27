import { describe, it, expect, vi } from "vitest";
import { AvatarRouterAdapter, LiveAvatarContractError } from "../../server/services/liveAvatar/avatarRouterAdapter";
import { AVATAR_ROUTER_ORIGIN, liveAvatarAvailability } from "../../shared/avatar/liveAvatar";

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const provider = { id: "tavus", name: "Tavus", status: "available", externalAudio: true, implemented: true };
const ready = { status: "ready", database: true, liveEnabled: true };

describe("AvatarRouter read-only adapter", () => {
  it("does not make network calls on construction or failed session creation", async () => {
    const fetcher = vi.fn();
    const adapter = new AvatarRouterAdapter(fetcher);
    expect(adapter.contractReady).toBe(false);
    await expect(adapter.openSession({ ownerId: "owner", conversationId: "conversation" })).rejects.toBeInstanceOf(LiveAvatarContractError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reads only fixed HTTPS public paths and never promotes stock readiness to bridge readiness", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(json(ready)).mockResolvedValueOnce(json([{ ...provider, key: "DO_NOT_RELAY" }]));
    const adapter = new AvatarRouterAdapter(fetcher);
    const result = await adapter.diagnose();
    expect(result.reachable).toBe(true);
    expect(result.liveEnabled).toBe(true);
    expect(result.providers).toEqual([provider]);
    expect(result.blockers).toContain("pcm_bridge_unverified");
    expect(JSON.stringify(result)).not.toContain("DO_NOT_RELAY");
    expect(adapter.contractReady).toBe(false);
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([
      `${AVATAR_ROUTER_ORIGIN}/api/ready`, `${AVATAR_ROUTER_ORIGIN}/api/v1/providers`,
    ]);
    for (const [, options] of fetcher.mock.calls) {
      expect(options.method).toBe("GET");
      expect(options.redirect).toBe("error");
      expect(options.headers.Authorization).toBeUndefined();
    }
  });

  it("coalesces concurrent refreshes and caches failures as safe diagnostics", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("upstream secret token"));
    const adapter = new AvatarRouterAdapter(fetcher);
    const [a, b] = await Promise.all([adapter.diagnose(), adapter.diagnose()]);
    expect(a).toEqual(b);
    expect(a.reachable).toBe(false);
    expect(a.blockers).toContain("avatar_router_diagnostics_failed");
    expect(JSON.stringify(a)).not.toContain("token");
    await adapter.diagnose();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    () => new Response("<html>login</html>", { headers: { "content-type": "text/html" } }),
    () => new Response("{}", { status: 403, headers: { "content-type": "application/json" } }),
    () => json({ status: "ready", liveEnabled: "yes" }),
    () => new Response("x".repeat(128 * 1024 + 1), { headers: { "content-type": "application/json" } }),
  ])("rejects malformed, unauthorized or oversized responses", async response => {
    const adapter = new AvatarRouterAdapter(vi.fn().mockImplementation(async () => response()));
    expect((await adapter.diagnose()).reachable).toBe(false);
  });

  it.each([[false, false], [false, true], [true, false], [true, true]])(
    "never bypasses the unverified contract with settings enabled=%s allowed=%s",
    (enabled, allowed) => {
      const status = liveAvatarAvailability(enabled, allowed);
      expect(status.available).toBe(false);
      expect(status.contractReady).toBe(false);
      expect(status.blockers.includes("globally_disabled")).toBe(!enabled);
      expect(status.blockers.includes("scenario_not_allowed")).toBe(!allowed);
    },
  );
});
