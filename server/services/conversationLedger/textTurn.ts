import { randomUUID } from "node:crypto";
import { z } from "zod";
import { applyLedgerCommand, readLedgerProjection } from "./service";
import { ledgerChatMessages, finalizeGeneratedLedgerMessage, serverLedgerTransition } from "./transcript";
import { LedgerError } from "./policy";

const requestIdentity = z.object({
  eventId: z.string().uuid(), utteranceId: z.string().uuid(),
  generation: z.number().int().nonnegative(),
}).strict();

export async function beginLedgerTextTurn(runId: string, personaId: string, message: string, identity: unknown) {
  const parsed = requestIdentity.safeParse(identity);
  if (!parsed.success) throw new LedgerError("ledger_text_identity_required", 400);
  const { eventId, utteranceId, generation } = parsed.data;
  if (!message.trim()) throw new LedgerError("ledger_empty_text_not_supported", 400);
  const ack = await applyLedgerCommand(runId, {
    eventId, generation, payload: { kind: "text.submit", utteranceId, text: message },
  }, "client");
  const rows = await ledgerChatMessages(runId);
  if (ack.duplicate) {
    const response = rows.find(row => row.ledger.responseTo === utteranceId);
    if (!response || response.ledger.providerState === "pending") throw new LedgerError("ledger_response_in_progress");
    if (response.ledger.providerState !== "final") throw new LedgerError("ledger_response_failed");
    return { replay: response, recordMessage: null, fail: async () => {} };
  }
  const responseId = randomUUID();
  await serverLedgerTransition(runId, generation, {
    kind: "utterance.register", utteranceId: responseId, speaker: "ai", mode: "text",
    personaId, responseTo: utteranceId, provider: "text",
  });
  return {
    replay: null,
    async recordMessage(input: {
      sender: string; message: string; emotion?: string | null; emotionReason?: string | null;
      userAffect?: unknown;
    }) {
      if (input.sender === "user") return rows.find(row => row.id === utteranceId)!;
      const result = await finalizeGeneratedLedgerMessage(runId, generation, responseId, input.message, {
        emotion: input.emotion ?? undefined, emotionReason: input.emotionReason ?? undefined,
        userAffect: input.userAffect && typeof input.userAffect === "object" && !Array.isArray(input.userAffect)
          ? input.userAffect as Record<string, unknown> : undefined,
      });
      return result.row;
    },
    async fail() {
      const view = await readLedgerProjection(runId);
      const response = view.utterances.find(row => row.id === responseId);
      if (response?.providerState === "pending") {
        await serverLedgerTransition(runId, generation, { kind: "provider.failed", utteranceId: responseId });
      }
    },
  };
}
