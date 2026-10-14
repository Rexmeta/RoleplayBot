import { z } from "zod";

const identity = z.string().uuid();
const text = z.string().max(10000);
const nonemptyText = text.refine(value => value.trim().length > 0, "empty_text");
const integer = z.number().int().min(0).max(2147483647);
const utteranceId = { utteranceId: identity };
const reason = z.enum([
  "connection_lost", "capture_gap", "overlapping_capture", "capture_timeout",
  "stt_disabled", "stt_failed", "segmented_capture", "provider_failed",
]);

/** Important transitions only. Audio, tokens and arbitrary client metadata are forbidden. */
export const ledgerPayloadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("connection.open") }).strict(),
  z.object({
    kind: z.literal("utterance.register"), ...utteranceId,
    speaker: z.enum(["user", "ai"]), mode: z.enum(["text", "voice"]),
    personaId: z.string().min(1).max(160), responseTo: identity.optional(),
    provider: z.enum(["gemini", "openai", "text"]),
    providerResponseId: z.string().min(1).max(200).optional(),
    captureGeneration: integer.optional(), captureSequence: integer.min(1).optional(),
  }).strict(),
  z.object({ kind: z.literal("text.submit"), ...utteranceId, text: nonemptyText }).strict(),
  z.object({ kind: z.literal("capture.commit"), ...utteranceId }).strict(),
  z.object({ kind: z.literal("capture.gap"), ...utteranceId, reason }).strict(),
  z.object({
    kind: z.literal("provider.final"), ...utteranceId, text: nonemptyText,
    providerEventId: z.string().min(1).max(200).optional(),
  }).strict(),
  z.object({ kind: z.literal("provider.interrupted"), ...utteranceId, text }).strict(),
  z.object({ kind: z.literal("provider.failed"), ...utteranceId }).strict(),
  z.object({
    kind: z.literal("recognition.stt"), ...utteranceId,
    text: text.nullable(), reason: reason.optional(),
    model: z.enum(["gpt-4o-mini-transcribe", "gpt-4o-transcribe", "whisper-1"]).optional(),
  }).strict(),
  z.object({
    kind: z.literal("recognition.confirm"), ...utteranceId,
    text: nonemptyText, expectedRevision: integer,
  }).strict(),
  z.object({
    kind: z.literal("playback.observed"), ...utteranceId,
    state: z.enum(["started", "completed", "interrupted"]),
  }).strict(),
  z.object({
    kind: z.literal("session.close"),
    reason: z.enum(["user_end", "time_limit", "turn_limit", "page_exit", "connection_lost"]),
  }).strict(),
]);

export const ledgerCommandSchema = z.object({
  eventId: identity,
  generation: integer,
  payload: ledgerPayloadSchema,
}).strict();

export type LedgerCommand = z.infer<typeof ledgerCommandSchema>;
export type LedgerPayload = LedgerCommand["payload"];
export type LedgerActor = "server" | "client";
export const CLIENT_LEDGER_COMMANDS = new Set<LedgerPayload["kind"]>([
  "text.submit", "capture.commit", "capture.gap", "recognition.confirm",
  "playback.observed", "session.close",
]);

export interface LedgerAck {
  eventId: string;
  cursor: number;
  utteranceRevision: number | null;
  snapshotId: string | null;
  duplicate: boolean;
}
