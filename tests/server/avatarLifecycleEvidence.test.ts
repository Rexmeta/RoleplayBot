import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AvatarProjectClient } from "../../server/services/liveAvatar/projectClient";

const input = () => ({ baseUrl: "https://router.example/api/v1", apiKey: "ar_sk_fixture_only_not_a_real_secret" });
const identity = {
  getUser: async (id: string) => ({ id, isActive: true }),
  getOrganization: async () => undefined,
  getCompany: async () => undefined,
};
const events = z.array(z.object({ type: z.string(), createdAt: z.string(), message: z.string() }));

describe("owned avatar lifecycle evidence", () => {
  it("reads events with the same verified owner and server-only authentication", async () => {
    const request = vi.fn(async () => Response.json([{ type: "failed", createdAt: "2026-11-17T05:53:53Z", message: "cleanup confirmed" }]));
    const client = new AvatarProjectClient(identity, request as typeof fetch, input);
    const result = await client.call("owner", "/sessions/session-id/events", events);
    expect(result[0].type).toBe("failed");
    const [url, options] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://router.example/api/v1/sessions/session-id/events");
    expect(options.method).toBe("GET");
    expect((options.headers as Record<string, string>)["X-Avatar-User-ID"]).toMatch(/^user_/);
    expect(options.body).toBeUndefined();
  });

  it("does not permit event writes, operator diagnostics or inactive owners", async () => {
    const request = vi.fn();
    const client = new AvatarProjectClient(identity, request as typeof fetch, input);
    await expect(client.call("owner", "/sessions/id/events", events, {})).rejects.toMatchObject({ code: "avatar_test_path_invalid" });
    await expect(client.call("owner", "/operator/live-reconciliation/diagnostics/compare", events)).rejects.toMatchObject({ code: "avatar_test_path_invalid" });
    const inactive = new AvatarProjectClient({ ...identity, getUser: async id => ({ id, isActive: false }) }, request as typeof fetch, input);
    await expect(inactive.call("owner", "/sessions/id/events", events)).rejects.toMatchObject({ code: "avatar_identity_account_inactive" });
    expect(request).not.toHaveBeenCalled();
  });
});
