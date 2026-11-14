import { describe, expect, it, vi } from "vitest";
import { AvatarProjectClient } from "../../server/services/liveAvatar/projectClient";

const imageId = "22345678-1234-4234-8234-123456789abc";
const identity: any = { getUser: async () => ({ id: "operator", isActive: true }) };
const input = () => ({ baseUrl: "https://avatar-router.replit.app/api/v1", apiKey: "ar_sk_test_not_real_123456789" });

describe("registered seed image transport", () => {
  it("uses the pinned content endpoint with server authentication and no browser credentials", async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "Content-Type": "image/png" } }));
    const client = new AvatarProjectClient(identity, fetcher as any, input);
    const result = await client.image("operator", imageId);
    expect(result.contentType).toBe("image/png");
    expect([...result.bytes]).toEqual([137, 80, 78, 71]);
    expect(fetcher).toHaveBeenCalledWith(`https://avatar-router.replit.app/api/v1/assets/images/${imageId}/content`,
      expect.objectContaining({ method: "GET", redirect: "error", credentials: "omit",
        headers: expect.objectContaining({ Authorization: `Bearer ${input().apiKey}` }) }));
  });
  it.each(["image/svg+xml", "text/html", "application/json"])("rejects %s instead of serving it as an image", async contentType => {
    const fetcher = vi.fn(async () => new Response("<html>not an image</html>", { headers: { "Content-Type": contentType } }));
    await expect(new AvatarProjectClient(identity, fetcher as any, input).image("operator", imageId))
      .rejects.toMatchObject({ code: "avatar_test_read_failed" });
  });
  it("bounds the body even when content length is omitted", async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array(4_500_001), { headers: { "Content-Type": "image/png" } }));
    await expect(new AvatarProjectClient(identity, fetcher as any, input).image("operator", imageId))
      .rejects.toMatchObject({ code: "avatar_test_read_failed" });
  });
  it("does not fetch arbitrary paths or inactive users", async () => {
    const fetcher = vi.fn();
    const client = new AvatarProjectClient(identity, fetcher, input);
    await expect(client.image("operator", "../other")).rejects.toMatchObject({ status: 400 });
    await expect(client.image("other", imageId)).rejects.toMatchObject({ status: 403 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("returns a safe upstream error without leaking its body or retrying", async () => {
    const fetcher = vi.fn(async () => new Response("private upstream details", { status: 403 }));
    await expect(new AvatarProjectClient(identity, fetcher as any, input).image("operator", imageId))
      .rejects.toMatchObject({ code: "avatar_test_upstream_403", message: "avatar_test_upstream_403" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
