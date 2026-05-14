import { createHmac, randomBytes, timingSafeEqual } from "crypto";

const PEPPER_ENV = "AGENT_API_KEY_PEPPER";
const KEY_PREFIX_HEX_CHARS = 8;  // hex chars in the prefix segment
const KEY_SECRET_HEX_CHARS = 32; // hex chars in the secret segment
const MAX_EXPIRY_DAYS = 365;
const DEFAULT_EXPIRY_DAYS = 90;

/**
 * Returns the HMAC pepper. Throws if not configured.
 */
export function getPepper(): string {
  const pepper = process.env[PEPPER_ENV];
  if (!pepper) {
    throw new Error(
      `${PEPPER_ENV} environment variable is required for agent API key security. ` +
        "Set it to a long random secret and do NOT change it after creating keys."
    );
  }
  return pepper;
}

/**
 * Validates that the pepper is set at server startup. Call this early.
 */
export function validateAgentApiKeyPepper(): void {
  getPepper();
}

/**
 * Generates a new API key pair.
 * Returns the full key (shown ONCE to user) and the hash/prefix stored in DB.
 */
export function generateAgentApiKey(environment: "live" | "test"): {
  fullKey: string;
  keyHash: string;
  keyPrefix: string;
} {
  const pepper = getPepper();
  const prefix = randomBytes(Math.ceil(KEY_PREFIX_HEX_CHARS / 2))
    .toString("hex")
    .slice(0, KEY_PREFIX_HEX_CHARS);
  const secret = randomBytes(Math.ceil(KEY_SECRET_HEX_CHARS / 2))
    .toString("hex")
    .slice(0, KEY_SECRET_HEX_CHARS);

  const fullKey = `rpb_${environment}_${prefix}_${secret}`;
  // keyPrefix stored in DB = "rpb_<env>_<8 hex chars>" (e.g. "rpb_live_abcd1234")
  const keyPrefix = `rpb_${environment}_${prefix}`;
  const keyHash = hashApiKey(fullKey, pepper);

  return { fullKey, keyHash, keyPrefix };
}

/**
 * HMAC-SHA256 hash of the full key using the pepper.
 */
export function hashApiKey(fullKey: string, pepper: string): string {
  return createHmac("sha256", pepper).update(fullKey).digest("hex");
}

/**
 * Constant-time comparison of a candidate key's hash against the stored hash.
 */
export function verifyApiKeyHash(fullKey: string, storedHash: string): boolean {
  try {
    const pepper = getPepper();
    const candidateHash = hashApiKey(fullKey, pepper);
    const a = Buffer.from(candidateHash, "hex");
    const b = Buffer.from(storedHash, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Extracts the key_prefix from a full API key string.
 * Expected format: rpb_{live|test}_{8-hex-prefix}_{32-hex-secret}
 * key_prefix = "rpb_" + env + "_" + first 8 hex chars (e.g. "rpb_live_abcd1234")
 */
export function extractKeyPrefix(fullKey: string): string | null {
  if (!fullKey) return null;
  // Strict format check
  const match = /^(rpb_(?:live|test)_[0-9a-f]{8})_[0-9a-f]{32}$/.exec(fullKey);
  if (!match) return null;
  return match[1]; // e.g. "rpb_live_abcd1234"
}

/**
 * Computes the expiry date (default 90 days, max 365 days from now).
 */
export function computeExpiryDate(requestedDays?: number): Date {
  const days = Math.min(requestedDays ?? DEFAULT_EXPIRY_DAYS, MAX_EXPIRY_DAYS);
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}
