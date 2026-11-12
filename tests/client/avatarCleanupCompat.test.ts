import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshCleanupSafely } from "../../client/src/lib/avatarCleanupCompat";

afterEach(() => vi.useRealTimers());
const closed = { id: "owned", rendererState: "closed", cleanupPending: false };
describe("AvatarRouter cleanup compatibility", () => {
  it("feature-detects the actual method without requiring a version/features field", async () => {
    const refreshCleanup = vi.fn(async () => "confirmed");
    const get = vi.fn();
    expect(await refreshCleanupSafely({ sessionId: "owned", refreshCleanup }, "owned", get))
      .toEqual({ state: "confirmed" });
    expect(refreshCleanup).toHaveBeenCalledOnce();
    expect(get).not.toHaveBeenCalled();
  });
  it("uses only the authenticated status callback for legacy or missing SDKs", async () => {
    const get = vi.fn(async () => closed);
    for (const client of [null, {}]) {
      expect(await refreshCleanupSafely(client, "owned", get)).toEqual({ state: "confirmed" });
    }
    expect(get.mock.calls).toEqual([["owned"], ["owned"]]);
  });
  it("requires an update when neither SDK method nor status proxy is available", async () => {
    expect(await refreshCleanupSafely({}, "owned"))
      .toEqual({ state: "unknown", code: "CLIENT_SDK_UPDATE_REQUIRED" });
  });
  it.each([
    { ...closed, rendererState: "running" }, { ...closed, rendererState: null },
    { ...closed, cleanupPending: true }, { ...closed, status: "ended", rendererState: "closing" },
  ])("never equates local end or partial cleanup with confirmation: %j", async status => {
    expect(await refreshCleanupSafely(null, "owned", async () => status)).toEqual({ state: "pending" });
  });
  it.each([null, { ...closed, id: "foreign" }, { ...closed, cleanupPending: undefined },
    { ...closed, rendererState: undefined }])("rejects malformed or foreign status: %j", async status => {
    expect(await refreshCleanupSafely(null, "owned", async () => status))
      .toEqual({ state: "unknown", code: "ROUTER_STATUS_INVALID" });
  });
  it("rejects a different client's result without invoking it", async () => {
    const refreshCleanup = vi.fn(async () => "confirmed");
    expect(await refreshCleanupSafely({ sessionId: "foreign", refreshCleanup }, "owned"))
      .toEqual({ state: "unknown", code: "ROUTER_STATUS_INVALID" });
    expect(refreshCleanup).not.toHaveBeenCalled();
  });
  it.each(["403", "404", "network"])("sanitizes %s failures", async message => {
    expect(await refreshCleanupSafely(null, "owned", async () => { throw new Error(`${message}: private`); }))
      .toEqual({ state: "unknown", code: "ROUTER_STATUS_UNCONFIRMED" });
  });
  it("bounds stuck reads to eight seconds", async () => {
    vi.useFakeTimers();
    const result = refreshCleanupSafely(null, "owned", () => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(8000);
    expect(await result).toEqual({ state: "unknown", code: "ROUTER_STATUS_UNCONFIRMED" });
    expect(vi.getTimerCount()).toBe(0);
  });
});
