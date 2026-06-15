import type { ConversationMessage } from "@shared/schema";

/**
 * Sorts an array of conversation messages by `turnIndex` ascending (stable),
 * with messages that have a null/undefined `turnIndex` sorted last.
 * Within the same `turnIndex` (including the null bucket), messages are
 * ordered by timestamp ascending.
 * When both turnIndex and timestamp are equal, the monotonic `id` field is
 * used as a tiebreaker when present. The original insertion order (array
 * index) is the final fallback for messages without an `id`.
 */
export function sortMessagesByTurnIndex(msgs: ConversationMessage[]): ConversationMessage[] {
  return msgs
    .map((msg, idx) => ({ msg, idx }))
    .sort((a, b) => {
      const ta = a.msg.turnIndex ?? Number.MAX_SAFE_INTEGER;
      const tb = b.msg.turnIndex ?? Number.MAX_SAFE_INTEGER;
      if (ta !== tb) return ta - tb;
      const tsA = a.msg.timestamp ? new Date(a.msg.timestamp).getTime() : NaN;
      const tsB = b.msg.timestamp ? new Date(b.msg.timestamp).getTime() : NaN;
      const safeA = isNaN(tsA) ? 0 : tsA;
      const safeB = isNaN(tsB) ? 0 : tsB;
      if (safeA !== safeB) return safeA - safeB;
      if (a.msg.id != null && b.msg.id != null) return a.msg.id - b.msg.id;
      return a.idx - b.idx;
    })
    .map(({ msg }) => msg);
}
