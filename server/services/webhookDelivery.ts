/**
 * Webhook Delivery Service
 * Dispatches Agent API lifecycle events to client-registered HTTPS endpoints.
 * Supports 1 initial attempt + up to 3 retries with exponential backoff.
 *
 * Secret security model:
 * - A random plaintext secret is generated on webhook creation and returned ONCE to the client.
 * - The plaintext secret is encrypted with AES-256-GCM (key derived from JWT_SECRET) before DB storage.
 * - At delivery time the ciphertext is decrypted in-process, used for HMAC-SHA256 signing, then discarded.
 * - The DB therefore never holds a recoverable plaintext secret at rest (only the ciphertext).
 * - Clients verify deliveries with: HMAC-SHA256(key=<their stored secret>, data=rawBody)
 */

import {
  createHmac,
  randomUUID,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "crypto";
import { db } from "../storage";
import { agentWebhooks, agentWebhookDeliveries } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export type WebhookEventType = "session.ended" | "session.expired" | "feedback.completed" | "agent_key.low_token_rate";

export interface WebhookEventData {
  sessionId?: string;
  [key: string]: any;
}

// ─────────────────────────────────────────────────────────────────────────────
// AES-256-GCM envelope encryption for secret storage
// ─────────────────────────────────────────────────────────────────────────────
const AES_ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
let _derivedKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (_derivedKey) return _derivedKey;
  const root = process.env.JWT_SECRET;
  if (!root) throw new Error("JWT_SECRET is required for webhook secret encryption");
  // Derive a stable 32-byte key via scrypt (low cost for key derivation, not password hashing)
  _derivedKey = scryptSync(root, "webhook-signing-key-v1", 32);
  return _derivedKey;
}

/**
 * Encrypt a plaintext webhook secret for storage.
 * Wire format: base64( iv[12] | authTag[16] | ciphertext )
 */
export function encryptWebhookSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(AES_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

/**
 * Decrypt a stored webhook secret ciphertext.
 * Throws on tampered or corrupt data (GCM auth tag verification).
 */
export function decryptWebhookSecret(ciphertext: string): string {
  const key = getEncryptionKey();
  const data = Buffer.from(ciphertext, "base64");
  const iv = data.subarray(0, IV_BYTES);
  const tag = data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const encrypted = data.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(AES_ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// Retry configuration
// 1 initial attempt + up to 3 retries (30s / 5m / 30m)
// ─────────────────────────────────────────────────────────────────────────────
const RETRY_DELAYS_MS = [30_000, 5 * 60_000, 30 * 60_000];
const MAX_ATTEMPTS = 4; // 1 initial + 3 retries
const DELIVERY_TIMEOUT_MS = 10_000;

// ─────────────────────────────────────────────────────────────────────────────
// Payload signing  (HMAC-SHA256 over raw JSON body using the decrypted secret)
// ─────────────────────────────────────────────────────────────────────────────
function signPayload(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// Single HTTP delivery attempt
// ─────────────────────────────────────────────────────────────────────────────
async function attemptDelivery(
  url: string,
  rawBody: string,
  signature: string,
  event: WebhookEventType,
  deliveryId: string
): Promise<{ statusCode: number; ok: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Event": event,
        "X-Webhook-Signature": `sha256=${signature}`,
        "X-Webhook-Delivery-Id": deliveryId,
        "User-Agent": "AgentAPI-Webhook/1.0",
      },
      body: rawBody,
      signal: controller.signal,
    });
    return { statusCode: resp.status, ok: resp.ok };
  } catch {
    return { statusCode: 0, ok: false };
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Log a delivery attempt to DB (best-effort)
// ─────────────────────────────────────────────────────────────────────────────
async function logDelivery(
  webhookId: string,
  deliveryId: string,
  event: WebhookEventType,
  payload: Record<string, any>,
  statusCode: number | null,
  attempt: number,
  succeeded: boolean,
  nextRetryAt: Date | null
): Promise<void> {
  await db
    .insert(agentWebhookDeliveries)
    .values({
      webhookId,
      deliveryId,
      event,
      payload,
      statusCode: statusCode ?? null,
      attempt,
      succeededAt: succeeded ? new Date() : null,
      nextRetryAt: nextRetryAt ?? null,
    })
    .catch((err) => {
      console.warn("[webhookDelivery] Failed to log delivery:", err);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Deliver to a single webhook with retries (up to MAX_ATTEMPTS total)
// ─────────────────────────────────────────────────────────────────────────────
async function deliverWithRetry(
  webhook: { id: string; url: string; secretKey: string },
  event: WebhookEventType,
  payload: Record<string, any>,
  deliveryId: string,
  attempt: number = 1
): Promise<void> {
  const rawBody = JSON.stringify(payload);

  // Decrypt stored ciphertext to get plaintext secret for HMAC signing
  let plaintextSecret: string;
  try {
    plaintextSecret = decryptWebhookSecret(webhook.secretKey);
  } catch (err) {
    console.error(`[webhookDelivery] Cannot decrypt secret for webhook ${webhook.id} — skipping`, err);
    return;
  }
  const signature = signPayload(rawBody, plaintextSecret);

  const { statusCode, ok } = await attemptDelivery(webhook.url, rawBody, signature, event, deliveryId);

  const hasMoreAttempts = attempt < MAX_ATTEMPTS;
  const nextRetryDelay = hasMoreAttempts && !ok ? RETRY_DELAYS_MS[attempt - 1] : null;
  const nextRetryAt = nextRetryDelay ? new Date(Date.now() + nextRetryDelay) : null;

  await logDelivery(webhook.id, deliveryId, event, payload, statusCode || null, attempt, ok, nextRetryAt);

  if (!ok && hasMoreAttempts) {
    const delay = RETRY_DELAYS_MS[attempt - 1] ?? 30_000;
    setTimeout(() => {
      deliverWithRetry(webhook, event, payload, deliveryId, attempt + 1).catch((err) => {
        console.warn(`[webhookDelivery] Retry ${attempt + 1} error for ${webhook.id}:`, err);
      });
    }, delay);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API: dispatch an event to all matching webhooks for an API key
// ─────────────────────────────────────────────────────────────────────────────
export async function dispatchWebhook(
  agentKeyId: string,
  event: WebhookEventType,
  data: WebhookEventData
): Promise<void> {
  let webhooks: { id: string; url: string; secretKey: string; events: string[] }[];

  try {
    webhooks = await db
      .select({
        id: agentWebhooks.id,
        url: agentWebhooks.url,
        secretKey: agentWebhooks.secretKey,
        events: agentWebhooks.events,
      })
      .from(agentWebhooks)
      .where(and(eq(agentWebhooks.agentKeyId, agentKeyId), eq(agentWebhooks.isActive, true)));
  } catch (err) {
    console.warn("[webhookDelivery] Failed to fetch webhooks:", err);
    return;
  }

  const matching = webhooks.filter((w) => w.events.includes(event));
  if (matching.length === 0) return;

  const deliveryId = `wdl_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const payload = {
    event,
    deliveryId,
    timestamp: new Date().toISOString(),
    data,
  };

  for (const webhook of matching) {
    deliverWithRetry(webhook, event, payload, deliveryId).catch((err) => {
      console.warn(`[webhookDelivery] Fire error for webhook ${webhook.id}:`, err);
    });
  }
}
