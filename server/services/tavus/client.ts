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

/** Fixed provider origin, server-only credentials, bounded requests, NO paid-create retries. */
export class TavusClient {
  constructor(private readonly request = fetch, private readonly env = process.env) {}

  async call<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    if (!this.env.TAVUS_API_KEY) throw new TavusError("tavus_not_configured", 503);
    let response: Response;
    try {
      response = await this.request(`https://tavusapi.com/v2${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { "x-api-key": this.env.TAVUS_API_KEY, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20000), redirect: "error",
      });
    } catch { throw new TavusError("tavus_request_uncertain", 502); }
    // Never echo upstream bodies: they may contain credentials, context or room tokens.
    if (!response.ok) throw new TavusError(`tavus_upstream_${response.status}`, 502);
    if (path.endsWith("/end")) return schema.parse({});
    try { return schema.parse(await response.json()); }
    catch { throw new TavusError("tavus_invalid_response", 502); }
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
