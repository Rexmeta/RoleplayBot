import { createHash } from "node:crypto";
import {
  PERSONA_AVATAR_EMOTIONS,
  PERSONA_AVATAR_STATES,
  personaAssetManifestSchema,
  type PersonaAssetManifest,
} from "../../shared/avatar/personaAssetManifest";

const STORAGE_PREFIXES = ["personas/", "user-personas/"] as const;

const EMOTION_ALIASES: Record<string, typeof PERSONA_AVATAR_EMOTIONS[number]> = {
  neutral: "neutral", 중립: "neutral", 中立: "neutral",
  happy: "happy", joy: "happy", 기쁨: "happy", 喜悦: "happy", 喜び: "happy",
  sad: "sad", 슬픔: "sad", 悲伤: "sad", 悲しみ: "sad",
  angry: "angry", 분노: "angry", 愤怒: "angry", 怒り: "angry",
  surprised: "surprised", surprise: "surprised", 놀람: "surprised", 惊讶: "surprised", 驚き: "surprised",
  curious: "curious", 호기심: "curious", 好奇: "curious", 好奇心: "curious",
  anxious: "anxious", 불안: "anxious", 焦虑: "anxious", 不安: "anxious",
  tired: "tired", 피로: "tired", 피곤: "tired", 疲劳: "tired",
  disappointed: "disappointed", 실망: "disappointed", 失望: "disappointed",
  confused: "confused", 당혹: "confused", 困惑: "confused",
  determined: "determined", 단호: "determined",
  concerned: "concerned",
  excited: "excited",
};

type GenderedImages = {
  base?: string | null;
  male?: { expressions?: Record<string, string | null | undefined> | null } | null;
  female?: { expressions?: Record<string, string | null | undefined> | null } | null;
  expressions?: Record<string, string | null | undefined> | null;
};

export type PersonaAssetSource =
  | {
      kind: "mbti";
      id: string;
      name: string;
      mbti?: string | null;
      gender?: string | null;
      images?: GenderedImages | null;
    }
  | {
      kind: "user";
      id: string;
      name: string;
      gender?: string | null;
      avatarUrl?: string | null;
      expressions?: Record<string, string | null | undefined> | null;
    };

export type SeedImageSelection = {
  assetId: string;
  selection: "base" | "approved_neutral";
};

export type PersonaAssetManifestResult = {
  manifest: PersonaAssetManifest;
  seedImage: SeedImageSelection | null;
  seedImageError: "missing_image" | "unsupported_reference" | "image_unavailable" | null;
  blockers: Array<"missing_image" | "rights_review_required">;
};

export type ImageBufferReader = (assetId: string) => Promise<Buffer | null>;

/**
 * Return a stable internal object key, never a signed URL, external URL,
 * temporary address, traversal path, or data URL.
 */
export function normalizeStablePersonaAssetId(reference: string | null | undefined): string | undefined {
  if (typeof reference !== "string" || reference.trim() === "") return undefined;
  const value = reference.trim();
  if (/^(?:https?:|data:|blob:)/i.test(value)) return undefined;

  let key = value;
  if (value.startsWith("/objects?key=") || value.startsWith("objects?key=")) {
    try {
      key = new URL(value, "https://roleplayx.invalid").searchParams.get("key") ?? "";
    } catch {
      return undefined;
    }
  } else {
    key = key.split("?", 1)[0] ?? "";
  }

  key = key.replace(/^\/+/, "");
  try {
    key = decodeURIComponent(key);
  } catch {
    return undefined;
  }
  if (!STORAGE_PREFIXES.some(prefix => key.startsWith(prefix))) return undefined;
  if (key.includes("\\") || /[\u0000-\u001f\u007f]/.test(key)) return undefined;
  const segments = key.split("/");
  if (segments.some(segment => segment === "" || segment === "." || segment === "..")) return undefined;
  return key;
}

function preferredGender(gender: string | null | undefined): "male" | "female" {
  return gender?.toLowerCase() === "female" ? "female" : "male";
}

function sourceExpressions(source: PersonaAssetSource): Record<string, string | null | undefined> {
  if (source.kind === "user") return source.expressions ?? {};
  const images = source.images;
  const gender = preferredGender(source.gender);
  return {
    ...(images?.expressions ?? {}),
    ...(images?.[gender]?.expressions ?? {}),
  };
}

function neutralExpressionReferences(source: PersonaAssetSource): string[] {
  const entries = sourceExpressions(source);
  return Object.entries(entries)
    .filter(([key]) => EMOTION_ALIASES[key.trim().toLowerCase()] === "neutral")
    .map(([, value]) => value)
    .filter((value): value is string => typeof value === "string" && value.trim() !== "");
}

/**
 * Select a base portrait first. A neutral expression is only a fallback when
 * the caller explicitly approves that exact stored reference.
 */
export function resolveSeedImage(
  source: PersonaAssetSource,
  approvedNeutralImageRef?: string | null,
): { selection: SeedImageSelection | null; error: PersonaAssetManifestResult["seedImageError"] } {
  const baseReference = source.kind === "mbti" ? source.images?.base : source.avatarUrl;
  const baseAssetId = normalizeStablePersonaAssetId(baseReference);
  if (baseAssetId) return { selection: { assetId: baseAssetId, selection: "base" }, error: null };

  if (approvedNeutralImageRef) {
    const approvedAssetId = normalizeStablePersonaAssetId(approvedNeutralImageRef);
    const isNeutralExpression = neutralExpressionReferences(source)
      .some(reference => normalizeStablePersonaAssetId(reference) === approvedAssetId);
    if (approvedAssetId && isNeutralExpression) {
      return { selection: { assetId: approvedAssetId, selection: "approved_neutral" }, error: null };
    }
  }

  const hadImageReference = Boolean(
    baseReference?.trim() ||
    Object.values(sourceExpressions(source)).some(value => typeof value === "string" && value.trim() !== ""),
  );
  const hasSupportedReference = Boolean(baseAssetId || neutralExpressionReferences(source)
    .some(reference => normalizeStablePersonaAssetId(reference)));
  return {
    selection: null,
    error: hadImageReference && !hasSupportedReference ? "unsupported_reference" : "missing_image",
  };
}

function normalizeExpressions(source: PersonaAssetSource): Record<string, { assetId: string }> {
  const result: Record<string, { assetId: string }> = {};
  const rankedEntries = Object.entries(sourceExpressions(source)).sort(([left], [right]) => {
    const leftIsCanonical = EMOTION_ALIASES[left.trim().toLowerCase()] === left.trim().toLowerCase();
    const rightIsCanonical = EMOTION_ALIASES[right.trim().toLowerCase()] === right.trim().toLowerCase();
    return Number(rightIsCanonical) - Number(leftIsCanonical);
  });

  for (const [key, rawReference] of rankedEntries) {
    if (typeof rawReference !== "string" || rawReference.trim() === "") continue;
    const emotion = EMOTION_ALIASES[key.trim().toLowerCase()];
    const assetId = normalizeStablePersonaAssetId(rawReference);
    if (!emotion || !assetId || result[emotion]) continue;
    result[emotion] = { assetId };
  }
  return result;
}

async function defaultImageBufferReader(assetId: string): Promise<Buffer | null> {
  const { mediaStorage } = await import("./mediaStorage");
  return mediaStorage.readImageBuffer(assetId);
}

export async function buildPersonaAssetManifest(
  source: PersonaAssetSource,
  options: {
    sourceImageVersion?: number;
    approvedNeutralImageRef?: string | null;
    rightsStatus?: "unverified" | "pending_review" | "approved" | "rejected";
    readImageBuffer?: ImageBufferReader;
  } = {},
): Promise<PersonaAssetManifestResult> {
  const seedResolution = resolveSeedImage(source, options.approvedNeutralImageRef);
  let seedImage: SeedImageSelection | null = null;
  let sourceImage: PersonaAssetManifest["sourceImage"];
  let seedImageError = seedResolution.error;

  if (seedResolution.selection) {
    const readImageBuffer = options.readImageBuffer ?? defaultImageBufferReader;
    const imageBytes = await readImageBuffer(seedResolution.selection.assetId).catch(() => null);
    if (imageBytes?.length) {
      seedImage = seedResolution.selection;
      seedImageError = null;
      sourceImage = {
        assetId: seedImage.assetId,
        contentHash: createHash("sha256").update(imageBytes).digest("hex"),
        version: options.sourceImageVersion ?? 1,
      };
    } else {
      seedImageError = "image_unavailable";
    }
  }

  const blockers: PersonaAssetManifestResult["blockers"] = [];
  if (!sourceImage) blockers.push("missing_image");
  if (options.rightsStatus !== "approved") blockers.push("rights_review_required");

  const metadata = source.kind === "mbti"
    ? { ...(source.mbti ? { mbti: source.mbti } : {}), ...(source.gender ? { gender: source.gender } : {}) }
    : source.gender ? { gender: source.gender } : undefined;

  const manifest = personaAssetManifestSchema.parse({
    schemaVersion: "1.0",
    personaId: source.id,
    name: source.name,
    ...(sourceImage ? { sourceImage } : {}),
    expressions: normalizeExpressions(source),
    avatarStates: [...PERSONA_AVATAR_STATES],
    ...(metadata && Object.keys(metadata).length ? { metadata } : {}),
  });

  return { manifest, seedImage, seedImageError, blockers };
}
