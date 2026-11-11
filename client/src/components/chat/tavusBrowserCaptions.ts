import { useCallback, useEffect, useRef, useState } from "react";

/** Display-only browser evidence. Never send these records to the canonical ledger or evaluation. */
export type BrowserCaption = {
  id: string;
  sender: "user" | "ai";
  message: string;
  timestamp: string;
  interrupted: boolean;
};
type Entry = {
  caption: BrowserCaption; turn?: number; inference?: string; seq?: number;
  terminal: boolean; source: "tavus" | "daily"; receivedAt: number;
};
const MAX_CAPTIONS = 500;
let readerSequence = 0;
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Bounded, per-room reader for documented Tavus accumulated utterances and optional Daily STT events. */
export function createBrowserCaptionReader() {
  const readerId = ++readerSequence;
  const entries: Entry[] = [];
  let nextId = 0;
  let boundConversation: string | undefined;
  function accept(input: Omit<Entry, "caption" | "receivedAt"> & {
    sender: BrowserCaption["sender"]; text: string; interrupted: boolean;
    timestamp?: number; interruptionOnly?: boolean;
  }, now: number): BrowserCaption | null {
    const identified = input.turn !== undefined || !!input.inference || input.seq !== undefined;
    let previous = entries.find(row => row.caption.sender === input.sender && (
      input.turn !== undefined && row.turn === input.turn ||
      input.inference !== undefined && row.inference === input.inference ||
      input.turn === undefined && !input.inference && input.seq !== undefined && row.seq === input.seq
    ));
    // Providers can emit the same caption through both transports. Keep one visible row.
    if (!previous && !input.interruptionOnly) {
      previous = [...entries].reverse().find(row => row.caption.sender === input.sender &&
        row.caption.message === input.text && (
          row.source !== input.source && now - row.receivedAt < 8000 ||
          !identified && row.turn === undefined && !row.inference && now - row.receivedAt < 1500
        ));
    }
    // Legacy streaming events without turn identifiers still carry cumulative text, not deltas.
    if (!previous && !identified && !input.terminal) {
      const last = entries.at(-1);
      if (last && !last.terminal && last.caption.sender === input.sender &&
          last.turn === undefined && !last.inference && now - last.receivedAt < 15000) previous = last;
    }
    if (input.interruptionOnly && !previous) return null;
    if (previous?.source === "tavus" && input.source === "daily") return null;
    if (previous && input.seq !== undefined && previous.seq !== undefined &&
        input.seq < previous.seq && !input.interruptionOnly) return null;
    if (previous?.terminal && previous.source === input.source && !input.terminal && !input.interruptionOnly) return null;
    const interrupted = input.interrupted || previous?.caption.interrupted || false;
    // A delayed full LLM reply must not expand an already interrupted partial caption.
    const text = input.interruptionOnly || previous?.caption.interrupted
      ? previous!.caption.message : input.text;
    const timestamp = previous?.caption.timestamp ?? new Date(
      input.timestamp !== undefined && Number.isFinite(input.timestamp) &&
      input.timestamp >= 0 && input.timestamp <= 8_640_000_000_000
        ? input.timestamp * 1000 : now,
    ).toISOString();
    const caption: BrowserCaption = {
      id: previous?.caption.id ?? `browser-caption-${readerId}-${++nextId}`, sender: input.sender,
      message: text, timestamp, interrupted,
    };
    const entry: Entry = {
      caption, turn: input.turn ?? previous?.turn, inference: input.inference ?? previous?.inference,
      seq: input.seq ?? previous?.seq, terminal: input.terminal || previous?.source === input.source && previous.terminal || false,
      source: input.source, receivedAt: now,
    };
    if (previous) entries[entries.indexOf(previous)] = entry;
    else { entries.push(entry); if (entries.length > MAX_CAPTIONS) entries.shift(); }
    if (previous?.caption.message === text && previous.caption.interrupted === interrupted) return null;
    return caption;
  }
  return {
    appMessage(raw: unknown, now = Date.now()): BrowserCaption | null {
      if (typeof raw === "string") {
        if (raw.length > 40000) return null;
        try { raw = JSON.parse(raw); } catch { return null; }
      }
      const data = object(raw);
      if (!data || data.message_type !== undefined && data.message_type !== "conversation") return null;
      const kind = data.event_type;
      const interruption = kind === "conversation.replica.interrupted" || kind === "conversation.pal.interrupted";
      if (!interruption && kind !== "conversation.utterance" && kind !== "conversation.utterance.streaming") return null;
      const properties = object(data.properties) ?? (interruption ? {} : null);
      if (!properties) return null;
      const role = interruption ? "pal" : properties.role;
      if (role !== "user" && role !== "pal" && role !== "replica" && role !== "assistant") return null;
      const text = properties.speech ?? properties.content;
      if (!interruption && (typeof text !== "string" || !text.trim() || text.length > 10000)) return null;
      if (typeof data.conversation_id === "string") {
        if (data.conversation_id.length > 160) return null;
        if (boundConversation && data.conversation_id !== boundConversation) return null;
        boundConversation = data.conversation_id;
      }
      return accept({
        sender: role === "user" ? "user" : "ai", text: typeof text === "string" ? text.trim() : "",
        turn: integer(data.turn_idx),
        inference: typeof data.inference_id === "string" && data.inference_id.length <= 160 ? data.inference_id : undefined,
        seq: integer(data.seq), source: "tavus",
        terminal: kind === "conversation.utterance" || properties.final === true,
        interrupted: interruption || properties.interrupted === true || properties.is_interrupted === true,
        interruptionOnly: interruption,
        timestamp: typeof data.timestamp === "number" ? data.timestamp : undefined,
      }, now);
    },
    dailyTranscription(raw: unknown, sender: BrowserCaption["sender"], now = Date.now()): BrowserCaption | null {
      const data = object(raw);
      if (!data || typeof data.text !== "string" || !data.text.trim() || data.text.length > 10000) return null;
      const response = object(data.rawResponse);
      if (response?.is_final === false) return null;
      const timestamp = data.timestamp instanceof Date ? data.timestamp.getTime() / 1000 : undefined;
      return accept({
        sender, text: data.text.trim(), timestamp, terminal: true, source: "daily", interrupted: false,
      }, now);
    },
  };
}

/** Session-local memory only: reloads discard unconfirmed captions rather than inventing saved history. */
export function useBrowserCaptions(conversationId: string) {
  const [state, setState] = useState<{ conversationId: string; captions: BrowserCaption[] }>({ conversationId, captions: [] });
  const currentId = useRef(conversationId);
  const mounted = useRef(true);
  currentId.current = conversationId;
  useEffect(() => {
    mounted.current = true;
    setState({ conversationId, captions: [] });
    return () => { mounted.current = false; };
  }, [conversationId]);
  const onCaption = useCallback((caption: BrowserCaption) => {
    if (!mounted.current || currentId.current !== conversationId) return;
    setState(previous => {
      const captions = previous.conversationId === conversationId ? previous.captions : [];
      const index = captions.findIndex(row => row.id === caption.id);
      const next = index < 0 ? [...captions, caption] : captions.map((row, i) => i === index ? caption : row);
      return { conversationId, captions: next.slice(-MAX_CAPTIONS) };
    });
  }, [conversationId]);
  return { captions: state.conversationId === conversationId ? state.captions : [], onCaption };
}
