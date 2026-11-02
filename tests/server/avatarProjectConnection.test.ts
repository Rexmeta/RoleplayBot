import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../../server/storage", () => ({ storage: {} }));
import { AvatarRouterProjectConnection } from "../../server/services/liveAvatar/projectConnection";
import { AvatarRouterAdapter } from "../../server/services/liveAvatar/avatarRouterAdapter";
import { liveAvatarAvailability } from "../../shared/avatar/liveAvatar";

// Synthetic nonfunctional credentials; never read environment keys.
const key = "ar_sk_synthetic_fixture_not_a_real_credential_12345";
const baseUrl = "https://avatar.example.test/api/v1";
const result = {
  authenticated: true, authType: "api-key", projectId: "project-one", projectName: "RoleplayX",
  scopes: ["live-limits:read"], expiresAt: "2099-01-01T00:00:00Z", userContext: true,
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let store: any;
let fetcher: ReturnType<typeof vi.fn>;
let input: { baseUrl?: string; apiKey?: string };
let service: AvatarRouterProjectConnection;
beforeEach(() => {
  store = { getUser: vi.fn(async id => ({ id, isActive: true })), getOrganization: vi.fn(), getCompany: vi.fn() };
  fetcher = vi.fn().mockResolvedValue(json({ ...result, secret: key, token: "DO_NOT_RELAY" }));
  input = { baseUrl, apiKey: key };
  service = new AvatarRouterProjectConnection(store, () => input, fetcher);
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("server project API-key connection", () => {
  it("coalesces concurrent checks but revalidates each caller and never caches a later authorization", async () => {
    let complete!: (response: Response) => void;
    fetcher.mockImplementation(() => new Promise<Response>(resolve => { complete = resolve; }));
    const first = service.check("one");
    const second = service.check("one");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(store.getUser).toHaveBeenCalledTimes(2);
    complete(json(result));
    const checked = await Promise.all([first, second]);
    expect(checked[0]).toEqual(checked[1]);
    expect(checked[0]).not.toBe(checked[1]);
    fetcher.mockImplementation(async () => json(result));
    await service.check("one");
    expect(fetcher).toHaveBeenCalledTimes(2);
    store.getUser.mockResolvedValue({ id: "one", isActive: false });
    await expect(service.check("one")).rejects.toMatchObject({ status: 403 });
  });

  it("does not share an in-flight check across users or a changed project credential", async () => {
    const complete: Array<(response: Response) => void> = [];
    fetcher.mockImplementation(() => new Promise<Response>(resolve => complete.push(resolve)));
    const first = service.check("one");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const second = service.check("two");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    input.apiKey = "ar_sk_another_synthetic_fixture_not_a_real_credential";
    const rotated = service.check("one");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    complete.forEach(resolve => resolve(json(result)));
    await Promise.all([first, second, rotated]);
    expect(fetcher.mock.calls[0][1].headers.Authorization).not.toBe(fetcher.mock.calls[2][1].headers.Authorization);
  });

  it("allows a six-second response instead of aborting it at the former five-second deadline", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("delayed", "TimeoutError")), ms);
      return controller.signal;
    });
    fetcher.mockImplementation((_url, options) => new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(json(result)), 6000);
      options.signal.addEventListener("abort", () => { clearTimeout(timer); reject(options.signal.reason); }, { once: true });
    }));
    const checked = service.check("one");
    await vi.advanceTimersByTimeAsync(6000);
    expect(await checked).toMatchObject(result);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retries only a timed-out free auth GET once and clears exhausted failures for later recovery", async () => {
    fetcher.mockRejectedValueOnce(new DOMException("delayed", "TimeoutError"))
      .mockResolvedValueOnce(json(result));
    expect(await service.check("one")).toMatchObject(result);
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockReset().mockRejectedValue(new DOMException("delayed", "TimeoutError"));
    await expect(service.check("one")).rejects.toMatchObject({ code: "avatar_connection_timeout", status: 504 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every(([url, options]) => url === `${baseUrl}/auth/check` && options.method === "GET")).toBe(true);
    fetcher.mockImplementation(async () => json(result));
    expect(await service.check("one")).toMatchObject(result);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("also recognizes a deadline while reading a response body, whose stream reports AbortError", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("delayed", "TimeoutError")), ms);
      return controller.signal;
    });
    fetcher.mockImplementationOnce(async (_url, options) => new Response(new ReadableStream({
      start(controller) {
        options.signal.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")), { once: true });
      },
    }), { headers: { "content-type": "application/json" } })).mockResolvedValueOnce(json(result));
    const checked = service.check("one");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await checked).toMatchObject(result);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("requires only Base URL and API key, without JWT trust enrollment or implicit requests", () => {
    expect(service.status()).toEqual({ authMode: "api-key", state: "configured", baseUrl });
    expect(JSON.stringify(service.status())).not.toContain(key);
    expect(fetcher).not.toHaveBeenCalled();
    expect(store.getUser).not.toHaveBeenCalled();
  });

  it("checks auth only, using a freshly verified opaque subject and no browser credentials", async () => {
    const checked = await service.check("current-admin");
    expect(checked).toMatchObject(result);
    expect(Object.keys(checked).sort()).toEqual([...Object.keys(result), "checkedAt"].sort());
    expect(JSON.stringify(checked)).not.toContain(key);
    expect(JSON.stringify(checked)).not.toContain("DO_NOT_RELAY");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe(`${baseUrl}/auth/check`);
    expect(options).toMatchObject({ method: "GET", redirect: "error", credentials: "omit" });
    expect(options.headers).toEqual({
      Accept: "application/json", Authorization: `Bearer ${key}`, "X-Avatar-User-ID": expect.stringMatching(/^user_[A-Za-z0-9_-]+$/),
    });
    expect(store.getUser).toHaveBeenCalledWith("current-admin");
    expect(liveAvatarAvailability(true, true).available).toBe(false);
  });

  it("keeps user namespaces distinct and rechecks account activation each time", async () => {
    fetcher.mockImplementation(async () => json(result));
    await service.check("one");
    await service.check("two");
    expect(fetcher.mock.calls[0][1].headers["X-Avatar-User-ID"]).not.toBe(fetcher.mock.calls[1][1].headers["X-Avatar-User-ID"]);
    store.getUser.mockResolvedValue({ id: "one", isActive: false });
    await expect(service.check("one")).rejects.toMatchObject({ status: 403 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([{}, { baseUrl }, { apiKey: key }])("fails closed on incomplete config without fallback", async missing => {
    input = missing;
    expect(service.status().state).toBe("unconfigured");
    await expect(service.check("one")).rejects.toMatchObject({ status: 503 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    "http://avatar.example.test/api/v1", "https://user:pass@avatar.example.test/api/v1",
    "https://avatar.example.test/api/v1?key=bad", "https://avatar.example.test/api/v1#bad",
    "https://avatar.example.test/other", "https://localhost/api/v1", "https://127.0.0.1/api/v1",
    "https://[::1]/api/v1", " https://avatar.example.test/api/v1",
  ])("rejects invalid operator destinations: %s", async url => {
    input.baseUrl = url;
    expect(service.status().state).toBe("invalid");
    await expect(service.check("one")).rejects.toMatchObject({ code: "avatar_connection_invalid" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("normalizes only the trailing slash and never falls back to JWT or public sessions", () => {
    input.baseUrl = `${baseUrl}/`;
    expect(service.status().baseUrl).toBe(baseUrl);
    input.apiKey = "ordinary-login-token";
    expect(service.status().state).toBe("invalid");
  });

  it.each([401, 403, 404, 429, 500, 503])("does not retry or relay raw upstream failures: %s", async status => {
    fetcher.mockResolvedValue(json({ error: key, secret: key }, status));
    try { await service.check("one"); expect.fail("Should reject"); }
    catch (error: any) {
      expect(error.message).toMatch(/^avatar_connection_/);
      expect(JSON.stringify(error)).not.toContain(key);
      expect(error.cause).toBeUndefined();
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    () => json({ ...result, authType: "jwt" }),
    () => json({ ...result, authenticated: false }),
    () => json({ ...result, userContext: false }),
    () => json({ ...result, expiresAt: "2000-01-01T00:00:00Z" }),
    () => json({ ...result, projectName: key }),
    () => json({ ...result, scopes: ["admin:all"] }),
    () => new Response("x".repeat(33 * 1024), { headers: { "content-type": "application/json" } }),
    () => new Response("<html>login</html>"),
  ])("rejects malformed, expired, oversized or secret-reflecting responses", async response => {
    fetcher.mockResolvedValue(response());
    await expect(service.check("one")).rejects.toMatchObject({ code: "avatar_connection_check_failed", status: 502 });
  });

  it("sanitizes network/redirect errors that contain the key", async () => {
    fetcher.mockRejectedValue(new Error(`redirect failed Authorization: Bearer ${key}`));
    await expect(service.check("one")).rejects.toMatchObject({ message: "avatar_connection_check_failed" });
  });

  it("uses the configured environment host for public diagnostics, without sending its key", async () => {
    vi.stubEnv("AVATAR_ROUTER_BASE_URL", baseUrl);
    const request = vi.fn().mockImplementation(async url => json(url.endsWith("/ready")
      ? { status: "ready", database: true, liveEnabled: false } : []));
    expect((await new AvatarRouterAdapter(request).diagnose()).reachable).toBe(true);
    expect(request.mock.calls.map(call => call[0])).toEqual(["https://avatar.example.test/api/ready", `${baseUrl}/providers`]);
    expect(request.mock.calls.every(([, options]) => !options.headers.Authorization)).toBe(true);
  });
});
