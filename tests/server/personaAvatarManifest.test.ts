import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildPersonaAssetManifest,
  normalizeStablePersonaAssetId,
  resolveSeedImage,
  type PersonaAssetSource,
} from "../../server/services/personaAvatarManifest";
import { nextPersonaAvatarSourceVersion } from "../../server/services/personaAvatarBindings";
import { personaAssetManifestSchema } from "../../shared/avatar/personaAssetManifest";

describe("persona avatar seed image resolution", () => {
  it("normalizes stable app storage keys and strips cache-busting query strings", () => {
    expect(normalizeStablePersonaAssetId("/personas/istj/male/neutral.webp?t=123"))
      .toBe("personas/istj/male/neutral.webp");
    expect(normalizeStablePersonaAssetId("/objects?key=personas%2Fistj%2Fmale%2Fneutral.webp"))
      .toBe("personas/istj/male/neutral.webp");
    expect(normalizeStablePersonaAssetId("user-personas/abc/happy.webp"))
      .toBe("user-personas/abc/happy.webp");
  });

  it.each([
    "https://storage.example/image.webp?X-Goog-Signature=abc",
    "https://images.example/persona.webp",
    "data:image/webp;base64,abc",
    "personas/../private.webp",
    "personas/%2e%2e/private.webp",
    "/objects?key=personas%2F..%2Fprivate.webp",
  ])("rejects non-stable or unsafe reference %s", reference => {
    expect(normalizeStablePersonaAssetId(reference)).toBeUndefined();
  });

  it("prefers the base image and never uses a neutral image without exact approval", () => {
    const source: PersonaAssetSource = {
      kind: "mbti",
      id: "istj",
      name: "Test persona",
      gender: "male",
      images: {
        base: "personas/istj/base.webp",
        male: { expressions: { "중립": "personas/istj/neutral.webp" } },
      },
    };

    expect(resolveSeedImage(source).selection).toEqual({
      assetId: "personas/istj/base.webp",
      selection: "base",
    });
    expect(resolveSeedImage({ ...source, images: { ...source.images, base: "" } }).selection)
      .toBeNull();
    expect(resolveSeedImage(
      { ...source, images: { ...source.images, base: "" } },
      "personas/istj/neutral.webp",
    ).selection).toEqual({
      assetId: "personas/istj/neutral.webp",
      selection: "approved_neutral",
    });
    expect(resolveSeedImage(
      { ...source, images: { ...source.images, base: "" } },
      "personas/istj/other.webp",
    ).selection).toBeNull();
  });

  it("creates a minimized manifest with a byte hash and canonical expression keys", async () => {
    const source: PersonaAssetSource = {
      kind: "mbti",
      id: "istj",
      name: "Test persona",
      mbti: "ISTJ",
      gender: "male",
      images: {
        base: "personas/istj/male/neutral.webp?t=old",
        male: {
          expressions: {
            "중립": "personas/istj/male/neutral.webp",
            "기쁨": "personas/istj/male/happy.webp",
            "분노": "",
            "기타": "https://temporary.example/image.webp?sig=private",
          },
        },
      },
    };
    const bytes = Buffer.from("test image bytes");

    const result = await buildPersonaAssetManifest(source, {
      sourceImageVersion: 3,
      readImageBuffer: async () => bytes,
    });

    expect(result.manifest.sourceImage).toEqual({
      assetId: "personas/istj/male/neutral.webp",
      contentHash: createHash("sha256").update(bytes).digest("hex"),
      version: 3,
    });
    expect(result.manifest.expressions).toEqual({
      neutral: { assetId: "personas/istj/male/neutral.webp" },
      happy: { assetId: "personas/istj/male/happy.webp" },
    });
    expect(result.manifest.avatarStates).toEqual([
      "idle", "listening", "listening_nod", "thinking", "speaking", "speaking_pause",
    ]);
    expect(result.manifest.metadata).toEqual({ mbti: "ISTJ", gender: "male" });
    expect(JSON.stringify(result.manifest)).not.toContain("personality");
    expect(JSON.stringify(result.manifest)).not.toContain("motivation");
    expect(result.blockers).toContain("rights_review_required");
  });

  it("reports missing or unreadable images without inventing a seed", async () => {
    const noImage: PersonaAssetSource = {
      kind: "user",
      id: "user-persona-1",
      name: "Custom",
      expressions: { happy: "" },
    };
    const missing = await buildPersonaAssetManifest(noImage, {
      readImageBuffer: async () => null,
    });
    expect(missing.manifest.sourceImage).toBeUndefined();
    expect(missing.seedImage).toBeNull();
    expect(missing.seedImageError).toBe("missing_image");
    expect(missing.blockers).toContain("missing_image");

    const unreadable: PersonaAssetSource = {
      kind: "user",
      id: "user-persona-2",
      name: "Custom",
      avatarUrl: "user-personas/user-persona-2/neutral.webp",
    };
    const unavailable = await buildPersonaAssetManifest(unreadable, {
      readImageBuffer: async () => null,
    });
    expect(unavailable.seedImageError).toBe("image_unavailable");
    expect(unavailable.manifest.sourceImage).toBeUndefined();
  });

  it("changes the source version only when the image content hash changes", () => {
    const previous = { sourceImageHash: "a".repeat(64), sourceImageVersion: 4 };
    expect(nextPersonaAvatarSourceVersion(undefined, "a".repeat(64))).toBe(1);
    expect(nextPersonaAvatarSourceVersion(previous, "A".repeat(64))).toBe(4);
    expect(nextPersonaAvatarSourceVersion(previous, "b".repeat(64))).toBe(5);
  });

  it("rejects URLs and incomplete source-image records from internal manifests", () => {
    const shared = {
      schemaVersion: "1.0" as const,
      personaId: "istj",
      name: "Test persona",
      expressions: {},
      avatarStates: ["idle"] as const,
    };
    expect(personaAssetManifestSchema.safeParse({
      ...shared,
      sourceImage: {
        assetId: "https://storage.example/signed.webp",
        contentHash: "a".repeat(64),
        version: 1,
      },
    }).success).toBe(false);
    expect(personaAssetManifestSchema.safeParse({
      ...shared,
      sourceImage: { version: 1 },
    }).success).toBe(false);
    expect(personaAssetManifestSchema.safeParse({
      ...shared,
      expressions: { happy: { assetId: "https://storage.example/signed.webp" } },
    }).success).toBe(false);
  });
});
