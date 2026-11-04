import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AvatarRouterProjectConnection } from "../../server/services/liveAvatar/projectConnection";

describe("AvatarRouter project connection status", () => {
  const store = {} as ConstructorParameters<typeof AvatarRouterProjectConnection>[0];
  const validKey = "ar_sk_0123456789abcdefghijklmn";

  it("returns only the first 12 SHA-256 hex characters of the configured key", () => {
    const connection = new AvatarRouterProjectConnection(
      store,
      () => ({ baseUrl: "https://avatar.example/api/v1", apiKey: validKey }),
    );

    const status = connection.status();
    const expected = createHash("sha256").update(validKey).digest("hex").slice(0, 12);

    expect(status).toEqual({
      authMode: "api-key",
      state: "configured",
      baseUrl: "https://avatar.example/api/v1",
      keyFingerprint: expected,
    });
    expect(JSON.stringify(status)).not.toContain(validKey);
  });

  it("does not expose a fingerprint when the key is not configured", () => {
    const connection = new AvatarRouterProjectConnection(store, () => ({}));

    expect(connection.status()).toEqual({ authMode: "api-key", state: "unconfigured" });
  });
});
