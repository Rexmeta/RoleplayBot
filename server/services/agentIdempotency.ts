import { createHash } from "crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../storage";
import { agentIdempotencyKeys } from "@shared/schema";
import { agentError } from "../middleware/agentApiKeyMiddleware";

const IDEMPOTENCY_TTL_HOURS = 24;

export function hashRequestBody(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

// Replays the stored response (or reports a conflict) when the key was already used.
export async function handleIdempotency(
  res: any,
  key: string,
  agentKeyId: string,
  bodyHash: string,
): Promise<{ handled: boolean }> {
  const existing = await db
    .select()
    .from(agentIdempotencyKeys)
    .where(and(eq(agentIdempotencyKeys.key, key), eq(agentIdempotencyKeys.agentKeyId, agentKeyId)))
    .limit(1);

  if (existing.length > 0) {
    const record = existing[0];
    if (record.requestHash !== bodyHash) {
      agentError(res, 409, "idempotency_key_conflict", "Idempotency-Key was already used with a different request body.");
      return { handled: true };
    }
    res.status(record.statusCode).json(record.responseBody);
    return { handled: true };
  }
  return { handled: false };
}

export async function saveIdempotency(
  key: string,
  agentKeyId: string,
  bodyHash: string,
  statusCode: number,
  responseBody: unknown,
): Promise<void> {
  try {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + IDEMPOTENCY_TTL_HOURS);
    await db
      .insert(agentIdempotencyKeys)
      .values({ key, agentKeyId, requestHash: bodyHash, responseBody: responseBody as any, statusCode, expiresAt })
      .onConflictDoNothing();
  } catch (err) {
    console.warn("[agentApi] Failed to save idempotency key:", err);
  }
}
