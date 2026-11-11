import { useCallback, useEffect, useRef, useState } from "react";
import type { ConversationMessage } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";

export type TranscriptState = "unavailable" | "pending" | "importing" | "completed" | "empty" | "failed";
export type TranscriptSession = {
  state: string;
  transcriptState?: TranscriptState;
  transcriptError?: string;
  evaluationAvailable?: boolean;
};

type Options<T extends TranscriptSession> = {
  conversationId: string;
  session: T;
  evaluationAvailable: boolean;
  onSessionUpdate: (next: T) => void;
};

export function useTavusTranscript<T extends TranscriptSession>({
  conversationId,
  session,
  evaluationAvailable,
  onSessionUpdate,
}: Options<T>) {
  const [localState, setLocalState] = useState<TranscriptState | undefined>();
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [pollingPaused, setPollingPaused] = useState(false);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [pollSequence, setPollSequence] = useState(0);
  const [boundConversationId, setBoundConversationId] = useState(conversationId);
  const onSessionUpdateRef = useRef(onSessionUpdate);
  const autoSyncForIdRef = useRef<string | null>(null);
  const conversationIdRef = useRef(conversationId);
  const generationRef = useRef(0);
  const mountedRef = useRef(false);
  const pollRequestInFlightRef = useRef(false);
  const syncRequestInFlightRef = useRef(false);
  const pollCountRef = useRef(0);
  const messageRequestInFlightRef = useRef(false);
  const messageLoadKeyRef = useRef<string | null>(null);
  const isBoundToConversation = boundConversationId === conversationId;
  const effectiveState = isBoundToConversation ? localState ?? session.transcriptState : undefined;

  onSessionUpdateRef.current = onSessionUpdate;
  conversationIdRef.current = conversationId;

  const isCurrent = useCallback((generation: number, id: string) =>
    mountedRef.current && generationRef.current === generation && conversationIdRef.current === id, []);

  const applySession = useCallback((next: T, generation: number, id: string) => {
    if (!isCurrent(generation, id)) return;
    if (next.transcriptState) setLocalState(next.transcriptState);
    onSessionUpdateRef.current(next);
  }, [isCurrent]);

  const loadMessages = useCallback(async (force = false) => {
    if (messageRequestInFlightRef.current) return;
    const requestGeneration = generationRef.current;
    const requestKey = `${conversationId}:${effectiveState}`;
    if (!isBoundToConversation || !isCurrent(requestGeneration, conversationId)) return;
    if (!force && messageLoadKeyRef.current === requestKey) return;
    messageRequestInFlightRef.current = true;
    if (isCurrent(requestGeneration, conversationId)) {
      setMessagesLoading(true);
      setMessagesError(null);
    }
    try {
      const response = await apiRequest("GET", `/api/conversations/${encodeURIComponent(conversationId)}`);
      const body = await response.json() as { messages?: ConversationMessage[] };
      if (!Array.isArray(body.messages)) throw new Error("Conversation history was not returned.");
      if (!isCurrent(requestGeneration, conversationId)) return;
      setMessages(body.messages);
      messageLoadKeyRef.current = requestKey;
    } catch (cause) {
      if (isCurrent(requestGeneration, conversationId)) {
        setMessagesError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (isCurrent(requestGeneration, conversationId)) {
        messageRequestInFlightRef.current = false;
        setMessagesLoading(false);
      }
    }
  }, [conversationId, effectiveState, isBoundToConversation, isCurrent]);

  const sync = useCallback(async () => {
    if (!isBoundToConversation || syncRequestInFlightRef.current || pollRequestInFlightRef.current || !conversationId) return;
    const requestGeneration = generationRef.current;
    if (!isCurrent(requestGeneration, conversationId)) return;
    syncRequestInFlightRef.current = true;
    setPollingPaused(false);
    setSyncing(true);
    if (isCurrent(requestGeneration, conversationId)) setSyncError(null);
    try {
      const response = await apiRequest(
        "POST",
        `/api/tavus/conversations/${encodeURIComponent(conversationId)}/sync`,
        {},
      );
      const next = await response.json() as T;
      applySession(next, requestGeneration, conversationId);
      if (isCurrent(requestGeneration, conversationId) &&
        (next.transcriptState === "pending" || next.transcriptState === "importing")) {
        pollCountRef.current = 0;
        if (isCurrent(requestGeneration, conversationId)) setPollSequence((sequence) => sequence + 1);
      }
    } catch (cause) {
      if (isCurrent(requestGeneration, conversationId)) {
        setSyncError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (isCurrent(requestGeneration, conversationId)) {
        syncRequestInFlightRef.current = false;
        setSyncing(false);
      }
    }
  }, [applySession, conversationId, isBoundToConversation, isCurrent]);

  useEffect(() => {
    mountedRef.current = true;
    generationRef.current += 1;
    const generation = generationRef.current;
    setLocalState(undefined);
    setSyncError(null);
    setSyncing(false);
    setPollingPaused(false);
    setMessages([]);
    setMessagesError(null);
    setMessagesLoading(false);
    setBoundConversationId(conversationId);
    autoSyncForIdRef.current = null;
    messageLoadKeyRef.current = null;
    pollCountRef.current = 0;
    syncRequestInFlightRef.current = false;
    pollRequestInFlightRef.current = false;
    messageRequestInFlightRef.current = false;
    return () => {
      mountedRef.current = false;
      if (generationRef.current === generation) generationRef.current += 1;
    };
  }, [conversationId]);

  useEffect(() => {
    if (!isBoundToConversation) return;
    if (session.state !== "ended" || !evaluationAvailable) return;
    // A previous session may predate the router's transcript capability. A fresh
    // positive capability check permits one recovery attempt, never a caption fallback.
    if (["completed", "empty", "failed"].includes(effectiveState || "")) return;
    if (autoSyncForIdRef.current === conversationId) return;
    autoSyncForIdRef.current = conversationId;
    void sync();
  }, [conversationId, effectiveState, evaluationAvailable, isBoundToConversation, session.state, sync]);

  useEffect(() => {
    if (!isBoundToConversation) return;
    if (session.state !== "ended" || !evaluationAvailable || !["pending", "importing"].includes(effectiveState || "")) return;
    let cancelled = false;
    let inFlight = false;
    const timer = window.setInterval(async () => {
      const requestGeneration = generationRef.current;
      if (cancelled || inFlight || syncRequestInFlightRef.current || pollRequestInFlightRef.current || pollCountRef.current >= 60) {
        if (pollCountRef.current >= 60) window.clearInterval(timer);
        return;
      }
      inFlight = true;
      pollRequestInFlightRef.current = true;
      setSyncing(true);
      pollCountRef.current += 1;
      try {
        const response = await apiRequest("GET", `/api/tavus/conversations/${encodeURIComponent(conversationId)}/session`);
        const next = await response.json() as T;
        if (!cancelled) applySession(next, requestGeneration, conversationId);
      } catch (cause) {
        if (!cancelled && isCurrent(requestGeneration, conversationId)) {
          setSyncError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        inFlight = false;
        if (isCurrent(requestGeneration, conversationId)) {
          pollRequestInFlightRef.current = false;
          setSyncing(false);
        }
      }
      if (pollCountRef.current >= 60) {
        window.clearInterval(timer);
        if (isCurrent(requestGeneration, conversationId)) setPollingPaused(true);
      }
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [applySession, conversationId, effectiveState, evaluationAvailable, isBoundToConversation, isCurrent, pollSequence, session.state]);

  useEffect(() => {
    if (!isBoundToConversation) return;
    if (session.state === "ended" && (effectiveState === "completed" || effectiveState === "empty")) void loadMessages();
  }, [effectiveState, isBoundToConversation, loadMessages, session.state]);

  return {
    transcriptState: effectiveState,
    syncError: isBoundToConversation ? syncError : null,
    messages: isBoundToConversation ? messages : [],
    messagesLoading: isBoundToConversation && messagesLoading,
    messagesError: isBoundToConversation ? messagesError : null,
    retrySync: sync,
    retryMessages: () => loadMessages(true),
    syncing: isBoundToConversation && (syncing || pollRequestInFlightRef.current),
    pollingPaused: isBoundToConversation && pollingPaused,
  };
}
