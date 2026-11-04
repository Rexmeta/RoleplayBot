import { createHash } from "node:crypto";
import { z } from "zod";
import { conversationSchema, TavusError } from "./client";

const entrySchema = z.object({
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.string().max(10000),
  timestamp: z.number().finite().min(0),
});
export interface TavusMessage {
  sender: "user" | "ai"; message: string; timestamp: string;
}

/** Official final transcript only; never client-supplied, interim captions or model input audio. */
export function adaptTavusTranscript(conversation: z.infer<typeof conversationSchema>): TavusMessage[] | null {
  if (conversation.status !== "ended") return null;
  const event = [...(conversation.events ?? [])].reverse()
    .find(e => e.event_type === "application.transcription_ready");
  if (!event) return null;
  const envelope = z.array(z.object({ role: z.string() }).passthrough()).max(5000)
    .safeParse(event.properties?.transcript);
  if (!envelope.success) throw new TavusError("tavus_invalid_transcript", 502);
  // System/tool entries are not dialogue evidence and may have different content/time shapes.
  const parsed = z.array(entrySchema).safeParse(envelope.data.filter(e => e.role === "user" || e.role === "assistant"));
  if (!parsed.success) throw new TavusError("tavus_invalid_transcript", 502);
  return parsed.data.filter(e => (e.role === "user" || e.role === "assistant") && e.content.trim())
    .map(e => ({
      sender: e.role === "user" ? "user" as const : "ai" as const,
      message: e.content, timestamp: new Date(e.timestamp * 1000).toISOString(),
    }));
}

/** Stable import identity survives retries/crashes without deduplicating repeated spoken phrases. */
export function transcriptIdentity(conversationId: string, index: number, suffix = "") {
  const hex = createHash("sha256").update(`${conversationId}:${index}:${suffix}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function transcriptHash(messages: TavusMessage[]) {
  return createHash("sha256").update(JSON.stringify(messages)).digest("hex");
}
