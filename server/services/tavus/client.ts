import { z } from "zod";

export class TavusError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); }
}

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
export const palSchema = z.object({ pal_id: id, pipeline_mode: z.literal("full") });
export const createdPalSchema = z.object({ pal_id: id });
export const createdConversationSchema = z.object({
  conversation_id: id, conversation_url: z.string().url(),
  meeting_token: z.string().max(12000).optional(),
});
export const conversationSchema = z.object({
  conversation_id: id, status: z.string(),
  created_at: z.string().optional(),
  events: z.array(z.object({
    event_type: z.string(), properties: z.record(z.string(), z.unknown()).optional(),
  })).nullable().optional(),
});

/**
 * Fail closed until AvatarRouter publishes its Full Pipeline contract.
 * Direct Tavus credentials/requests are deliberately not supported here.
 * The existing AvatarProjectClient remains the sole external avatar boundary.
 */
export class TavusClient {
  async call<T>(_path: string, _schema: z.ZodType<T>, _body?: unknown): Promise<T> {
    throw new TavusError("avatar_router_full_pipeline_contract_required", 503);
  }
}

export function conversationJoinUrl(result: z.infer<typeof createdConversationSchema>): string {
  const url = new URL(result.conversation_url);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".daily.co") || url.username || url.password) {
    throw new TavusError("tavus_untrusted_room_url", 502);
  }
  if (result.meeting_token) url.searchParams.set("t", result.meeting_token);
  return url.toString();
}
