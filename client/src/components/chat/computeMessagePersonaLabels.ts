import type { ConversationMessage } from "@shared/schema";
import type { PersonaSwitchEvent } from "./PersonaSwitchCard";

/**
 * Pure function: given an ordered message list, a set of persona switch events,
 * and the initial/fallback persona name, returns a Map<messageIndex, personaName>
 * that records which persona was active when each AI message was sent.
 *
 * Switch events are sorted by timestamp before processing so out-of-order
 * arrivals do not corrupt earlier message labels.
 */
export function computeMessagePersonaLabels(
  messages: ConversationMessage[],
  personaSwitchEvents: PersonaSwitchEvent[],
  personaName: string,
): Map<number, string> {
  const sortedEvents = [...personaSwitchEvents].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  type ListItem =
    | { type: 'message'; message: ConversationMessage; index: number }
    | { type: 'switch'; event: PersonaSwitchEvent };

  const items: ListItem[] = [];
  messages.forEach((msg, idx) => {
    items.push({ type: 'message', message: msg, index: idx });
    sortedEvents
      .filter(ev =>
        ev.turnIndex != null
          ? msg.turnIndex != null && msg.turnIndex === ev.turnIndex
          : idx === ev.toIndex,
      )
      .forEach(ev => items.push({ type: 'switch', event: ev }));
  });
  const placedTimestamps = new Set(
    items.filter(i => i.type === 'switch').map(i => (i as any).event.timestamp),
  );
  sortedEvents
    .filter(ev => !placedTimestamps.has(ev.timestamp))
    .forEach(ev => items.push({ type: 'switch', event: ev }));

  const initialPersonaName =
    sortedEvents.length > 0
      ? sortedEvents[0].fromPersonaName || personaName
      : personaName;

  const labels = new Map<number, string>();
  let current = initialPersonaName;
  items.forEach(item => {
    if (item.type === 'switch') {
      current = item.event.newPersonaName || current;
    } else if (item.message.sender === 'ai') {
      labels.set(item.index, current);
    }
  });
  return labels;
}
