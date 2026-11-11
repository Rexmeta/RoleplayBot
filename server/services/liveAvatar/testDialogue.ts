import OpenAI, { toFile } from "openai";
import type { AvatarTestTurnInput } from "../../../shared/avatar/adminAvatarTest";
import { AvatarIdentityError } from "./delegatedIdentity";

export interface AvatarTestDialogue {
  ready(): boolean;
  reply(input: AvatarTestTurnInput, signal: AbortSignal): Promise<{ userText: string; replyText: string; pcm: Buffer }>;
}

/** Dedicated diagnostic dialogue; never changes scenario models, prompts, transcripts or scoring. */
export class OpenAIAvatarTestDialogue implements AvatarTestDialogue {
  ready() { return Boolean(process.env.OPENAI_API_KEY); }

  async reply(input: AvatarTestTurnInput, signal: AbortSignal) {
    if (!this.ready()) throw new AvatarIdentityError("avatar_test_ai_unconfigured", 503);
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 25_000, maxRetries: 0 });
    try {
      let userText = input.text ?? "";
      if (input.audioBase64) {
        const ext = input.mimeType === "audio/mp4" ? "mp4" : input.mimeType === "audio/ogg" ? "ogg" : "webm";
        const result = await client.audio.transcriptions.create({
          file: await toFile(Buffer.from(input.audioBase64, "base64"), `recording.${ext}`, { type: input.mimeType }),
          model: "whisper-1", language: "ko",
        }, { signal });
        userText = result.text.trim();
      }
      if (!userText || userText.length > 500) throw new AvatarIdentityError("avatar_test_transcript_invalid", 422);
      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 100,
        messages: [
          { role: "system", content: "You are Lucy in a Korean live-avatar connection test, not a roleplay scenario. Reply naturally in Korean using exactly one short sentence, at most 40 Korean characters. No markdown or stage directions. Never claim this diagnostic is the user's scenario persona." },
          ...input.history,
          { role: "user", content: userText },
        ],
      }, { signal });
      const replyText = response.choices[0]?.message.content?.trim();
      if (!replyText || replyText.length > 600) throw new Error();
      const speech = await client.audio.speech.create({
        model: "tts-1", voice: "nova", input: replyText, response_format: "pcm",
      }, { signal });
      // OpenAI PCM is signed PCM16 LE, mono, 24kHz. Reject rather than truncate.
      if (Number(speech.headers.get("content-length")) > 720_000 || !speech.body) throw new Error();
      const reader = speech.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.length;
          if (bytes > 720_000) throw new Error();
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      const pcm = Buffer.concat(chunks);
      if (pcm.length < 960 || pcm.length % 2) throw new Error();
      return { userText, replyText, pcm };
    } catch (error) {
      if (error instanceof AvatarIdentityError) throw error;
      throw new AvatarIdentityError(signal.aborted ? "avatar_test_turn_cancelled" : "avatar_test_ai_failed", signal.aborted ? 409 : 502);
    }
  }
}
