import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Negotiation/test model ONLY, not a ratified router response.
 * Do not import into session dispatch or enable on feature discovery.
 * See docs/anam-final-transcript-proposal.md for the activation gate.
 */
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
const bindingSchema = z.object({
  version: z.literal(1),
  source: z.literal("anam"),
  pipeline: z.literal("anam_full"),
  projectId: z.string().min(1).max(256),
  userId: z.string().min(1).max(256),
  sessionId: id,
  providerSessionId: id,
}).strict();
const messageSchema = z.object({
  id,
  role: z.enum(["user", "assistant"]),
  text: z.string().min(1).max(10000).refine(value => value.trim().length > 0),
  timestamp: z.string().datetime({ offset: true }),
}).strict();

export const proposedAnamTranscriptSchema = z.discriminatedUnion("status", [
  bindingSchema.extend({ status: z.literal("pending") }).strict(),
  bindingSchema.extend({ status: z.literal("unavailable") }).strict(),
  bindingSchema.extend({
    status: z.literal("ready"),
    final: z.literal(true),
    authentication: z.literal("provider_server"),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    messages: z.array(messageSchema).max(1000),
  }).strict(),
]);
type Envelope = z.infer<typeof proposedAnamTranscriptSchema>;
export type ProposedAnamTranscriptBinding = Pick<Envelope,
  "projectId" | "userId" | "sessionId" | "providerSessionId">;

/** Deterministic v1 encoding: ordered tuples, independent of object key order. */
export function proposedAnamTranscriptRevision(envelope: Extract<Envelope, { status: "ready" }>) {
  return createHash("sha256").update(JSON.stringify([
    1, "anam", "anam_full", envelope.projectId, envelope.userId,
    envelope.sessionId, envelope.providerSessionId,
    envelope.messages.map(message => [message.id, message.role, message.text, message.timestamp]),
  ]), "utf8").digest("hex");
}

/** Input must come from an authenticated router read, never from the browser.
 * This validates bindings/integrity, not the truth of the router's attestation.
 */
export function validateProposedAnamTranscript(
  input: unknown, expected: ProposedAnamTranscriptBinding, pinnedRevision?: string,
) {
  const envelope = proposedAnamTranscriptSchema.parse(input);
  for (const key of ["projectId", "userId", "sessionId", "providerSessionId"] as const) {
    if (envelope[key] !== expected[key]) throw new Error("anam_transcript_binding_mismatch");
  }
  if (envelope.status === "ready") {
    if (new Set(envelope.messages.map(message => message.id)).size !== envelope.messages.length) {
      throw new Error("anam_transcript_duplicate_message");
    }
    if (proposedAnamTranscriptRevision(envelope) !== envelope.revision ||
        (pinnedRevision !== undefined && pinnedRevision !== envelope.revision)) {
      throw new Error("anam_transcript_revision_mismatch");
    }
  }
  return envelope;
}
