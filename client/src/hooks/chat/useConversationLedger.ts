import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { apiRequest } from "@/lib/queryClient";
import type { LedgerUtterance } from "@shared/schema/conversationLedger";
import type { ConversationMessage } from "@shared/schema";

type Projection = {
  version: 1 | "legacy"; cursor: number; generation: number; status: string;
  utterances: LedgerUtterance[];
};

export function mergeLedgerProjection(previous: Projection | undefined, incoming: Projection): Projection {
  if (incoming.version === "legacy") return incoming;
  if (previous && incoming.cursor < previous.cursor) return previous;
  const rows = new Map(previous?.utterances.map(row => [row.id, row]) ?? []);
  for (const row of incoming.utterances) {
    const existing = rows.get(row.id);
    if (!existing || row.revision >= existing.revision) rows.set(row.id, row);
  }
  return { ...incoming, utterances: Array.from(rows.values()).sort((a, b) => a.sequence - b.sequence) };
}

export function ledgerDisplayMessages(rows: LedgerUtterance[]): ConversationMessage[] {
  return rows.map(row => ({
    utteranceId: row.id, sender: row.speaker as "ai" | "user",
    message: row.canonicalText ?? row.providerText,
    timestamp: new Date(row.createdAt).toISOString(), turnIndex: row.sequence, personaId: row.personaId,
    emotion: row.metadata?.emotion, emotionReason: row.metadata?.emotionReason,
    userAffect: row.metadata?.userAffect,
    voiceTurnId: row.speaker === "user" && row.mode === "voice" ? row.id : undefined,
    voiceTranscriptFinal: row.providerState === "final",
    interrupted: row.providerState === "interrupted" || row.playbackState === "interrupted", ledger: row,
  }));
}

/** Cache/cursor is scoped to the run; pending browser text is never merged into authority. */
export function useConversationLedger(runId: string) {
  const cache = useQueryClient();
  const key = ["/api/conversations", runId, "ledger"];
  const query = useQuery<Projection>({
    queryKey: key, enabled: !!runId,
    refetchInterval: query => query.state.data?.version === "legacy" ? false : 1500,
    queryFn: async () => {
      const previous = cache.getQueryData<Projection>(key);
      const after = previous?.version === 1 ? previous.cursor : 0;
      const incoming = await (await apiRequest("GET",
        `/api/conversations/${encodeURIComponent(runId)}/ledger?after=${after}`)).json();
      return mergeLedgerProjection(previous, incoming);
    },
  });
  const messages = useMemo(() => ledgerDisplayMessages(query.data?.utterances ?? []), [query.data?.utterances]);
  return {
    ...query, enabled: query.data?.version === 1, generation: query.data?.generation ?? 0,
    messages,
  };
}
