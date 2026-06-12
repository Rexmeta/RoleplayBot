import type { ConversationMessage } from "@shared/schema";

/**
 * Sorts an array of conversation messages by `turnIndex` ascending (stable),
 * with messages that have a null/undefined `turnIndex` sorted last.
 * Within the same `turnIndex` (including the null bucket), messages are
 * ordered by timestamp ascending.
 */
export function sortMessagesByTurnIndex(msgs: ConversationMessage[]): ConversationMessage[] {
  return [...msgs].sort((a, b) => {
    const ta = a.turnIndex ?? Number.MAX_SAFE_INTEGER;
    const tb = b.turnIndex ?? Number.MAX_SAFE_INTEGER;
    if (ta !== tb) return ta - tb;
    return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
  });
}
