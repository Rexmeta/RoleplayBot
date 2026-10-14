import { useState, useRef, useEffect, type MutableRefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ConversationMessage } from "@shared/schema";

interface UseChatSessionOptions {
  ledgerEnabled?: boolean;
  ledgerGeneration?: number;
  conversationId: string;
  localMessages: ConversationMessage[];
  localMessagesRef?: MutableRefObject<ConversationMessage[]>;
  pendingUserText?: string;
  pendingUserTextRef?: MutableRefObject<string>;
  pendingUserVoiceTurnId?: string;
  pendingUserVoiceTurnIdRef?: MutableRefObject<string>;
  hasPendingLocalRef?: MutableRefObject<boolean>;
  isPersonaMode: boolean;
  isNearingEnd: boolean;
  currentTurn: number;
  targetTurns: number;
  onChatComplete: () => void;
  onExit: () => void;
  onConversationEnding?: () => void;
  disconnectVoice: () => void;
  resetPhase: () => void;
  setLocalMessages: (messages: ConversationMessage[] | ((prev: ConversationMessage[]) => ConversationMessage[])) => void;
  setConversationStartTime: (date: Date | null) => void;
  setElapsedTime: (time: number) => void;
  showMicPromptReset: () => void;
}

export function useChatSession({
  ledgerEnabled = false, ledgerGeneration = 0,
  conversationId,
  localMessages,
  localMessagesRef,
  pendingUserText = '',
  pendingUserTextRef,
  pendingUserVoiceTurnId = '',
  pendingUserVoiceTurnIdRef,
  hasPendingLocalRef,
  isPersonaMode,
  isNearingEnd,
  currentTurn,
  targetTurns,
  onChatComplete,
  onExit,
  onConversationEnding,
  disconnectVoice,
  resetPhase,
  setLocalMessages,
  setConversationStartTime,
  setElapsedTime,
  showMicPromptReset,
}: UseChatSessionOptions) {
  const [isSessionEnding, setIsSessionEnding] = useState(false);
  const [showEndConversationDialog, setShowEndConversationDialog] = useState(false);
  const [showAlmostDoneDialog, setShowAlmostDoneDialog] = useState(false);
  const [isGoingToFeedback, setIsGoingToFeedback] = useState(false);
  const [messageSaveError, setMessageSaveError] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const closeEnvelope = useRef<{ runId: string; command: any } | null>(null);
  const ledgerState = useRef({ ledgerEnabled, ledgerGeneration, conversationId });
  ledgerState.current = { ledgerEnabled, ledgerGeneration, conversationId };
  const closeCommand = (reason: string) => {
    const state = ledgerState.current;
    if (closeEnvelope.current?.runId !== state.conversationId) {
      closeEnvelope.current = { runId: state.conversationId, command: {
        eventId: crypto.randomUUID(), generation: state.ledgerGeneration,
        payload: { kind: "session.close", reason },
      } };
    }
    return closeEnvelope.current!.command;
  };
  const closeLedger = async (reason: string) => {
    await apiRequest("POST", `/api/conversations/${conversationId}/ledger/commands`, closeCommand(reason));
    await queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversationId] });
    await queryClient.invalidateQueries({ queryKey: ["/api/scenario-runs"] });
  };
  useEffect(() => {
    const pagehide = () => {
      const state = ledgerState.current;
      if (!state.ledgerEnabled) return;
      const token = localStorage.getItem("authToken");
      void fetch(`/api/conversations/${encodeURIComponent(state.conversationId)}/ledger/commands`, {
        method: "POST", credentials: "include", keepalive: true,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(closeCommand("page_exit")),
      }).catch(() => {}); // No response is not an ACK; reconnect reads the persisted projection.
    };
    window.addEventListener("pagehide", pagehide);
    return () => window.removeEventListener("pagehide", pagehide);
  }, []);

  const handleGoToFeedback = async () => {
    setIsGoingToFeedback(true);
    onConversationEnding?.();
    if (ledgerEnabled) {
      disconnectVoice();
      try { await closeLedger("user_end"); onChatComplete(); }
      catch { setMessageSaveError(true); setIsGoingToFeedback(false); }
      return;
    }

    // Send a final save so the persona run is marked 'completed' and the
    // server-side turn count is updated.  This also invalides the cached
    // conversation snapshot so PersonalDevelopmentReport sees the full
    // message list (not a stale pre-voice-session snapshot with 0 messages).
    const msgs = localMessagesRef?.current ?? localMessages;
    const payload = buildSavePayload(msgs, pendingUserText);
    try {
      await apiRequest('POST', `/api/conversations/${conversationId}/realtime-messages`, {
        messages: payload,
        isFinal: true,
      });
      await queryClient.invalidateQueries({ queryKey: ['/api/conversations', conversationId] });
      await queryClient.invalidateQueries({ queryKey: ['/api/scenario-runs'] });
      await queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
    } catch (error) {
      console.warn('⚠️ [handleGoToFeedback] Final save failed, proceeding anyway:', error);
      // Still invalidate so the feedback page fetches the freshest data it can.
      queryClient.invalidateQueries({ queryKey: ['/api/conversations', conversationId] }).catch(() => {});
    }

    onChatComplete();
  };

  // pendingUserText(말하는 도중 종료)가 있으면 마지막 발화로 추가.
  // pendingUserTextRef is preferred over pendingUserText prop because it is
  // updated synchronously on every change, avoiding React batching races at
  // session end where the state value might not yet reflect the latest text.
  const buildSavePayload = (msgs: ConversationMessage[], pendingText: string) => {
    if (ledgerEnabled) return [];
    const messages = msgs.map(msg => ({
      sender: msg.sender,
      message: msg.message,
      timestamp: msg.timestamp,
      emotion: msg.emotion,
      emotionReason: msg.emotionReason,
      userAffect: msg.userAffect ?? undefined,
      voiceTurnId: msg.voiceTurnId,
      voiceTranscriptFinal: msg.voiceTranscriptFinal,
    }));
    const latest = pendingUserTextRef ? pendingUserTextRef.current : pendingText;
    if (latest.trim()) {
      const latestTurnId = pendingUserVoiceTurnIdRef
        ? pendingUserVoiceTurnIdRef.current
        : pendingUserVoiceTurnId;
      console.log(`🎤 [save] Including pending user transcript (length=${latest.length})`);
      const provisionalIndex = latestTurnId
        ? messages.findIndex(
            message =>
              message.sender === 'user' &&
              message.voiceTurnId === latestTurnId &&
              message.voiceTranscriptFinal !== true,
          )
        : -1;
      if (provisionalIndex >= 0) {
        messages[provisionalIndex] = {
          ...messages[provisionalIndex],
          message: latest,
          voiceTranscriptFinal: false,
        };
      } else {
        messages.push({
          sender: 'user',
          message: latest,
          timestamp: new Date().toISOString(),
          emotion: undefined,
          emotionReason: undefined,
          userAffect: undefined,
          voiceTurnId: latestTurnId || undefined,
          voiceTranscriptFinal: false,
        });
      }
    }
    return messages;
  };

  const handleAlmostDoneKeepGoing = () => {
    setShowAlmostDoneDialog(false);
  };

  const handleAlmostDoneConfirmExit = () => {
    setShowAlmostDoneDialog(false);
    setShowEndConversationDialog(true);
  };

  const handleFeedbackRequest = () => {
    setShowEndConversationDialog(true);
  };

  const handleEndRealtimeConversation = () => {
    if (ledgerEnabled && isPersonaMode) {
      disconnectVoice();
      void closeLedger("user_end").then(onExit).catch(() => setMessageSaveError(true));
      return;
    }
    if (isPersonaMode) {
      disconnectVoice();
      // Use localMessagesRef.current (always up-to-date) to include any message
      // appended since the last render (e.g. final transcription arriving while
      // the user taps End).
      const msgs = localMessagesRef?.current ?? localMessages;
      const payload = buildSavePayload(msgs, pendingUserText);
      if (payload.length > 0) {
        apiRequest('POST', `/api/conversations/${conversationId}/realtime-messages`, {
          messages: payload,
          isFinal: true,
        }).catch(console.error);
      }
      onExit();
      return;
    }
    if (isNearingEnd) {
      setShowAlmostDoneDialog(true);
      return;
    }
    setShowEndConversationDialog(true);
  };

  const doSaveAndComplete = async () => {
    setMessageSaveError(false);
    setIsSessionEnding(true);
    disconnectVoice();
    if (ledgerEnabled) {
      try { await closeLedger("user_end"); onChatComplete(); }
      catch { setMessageSaveError(true); setIsGoingToFeedback(false); }
      finally { setIsSessionEnding(false); }
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 1800));
    setIsSessionEnding(false);

    onConversationEnding?.();

    const msgs = localMessagesRef?.current ?? localMessages;
    const payload = buildSavePayload(msgs, pendingUserText);
    if (payload.length > 0) {
      const res = await apiRequest(
        'POST',
        `/api/conversations/${conversationId}/realtime-messages`,
        { messages: payload, isFinal: true }
      );

      await res.json();

      await queryClient.invalidateQueries({ queryKey: ['/api/conversations', conversationId] });
      await queryClient.invalidateQueries({ queryKey: ['/api/scenario-runs'] });
      await queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
    }

    onChatComplete();
  };

  const confirmEndConversation = async () => {
    try {
      setShowEndConversationDialog(false);
      setIsGoingToFeedback(true);

      // Use localMessagesRef.current (always up-to-date) to include any message
      // appended since the last render before this async function was called.
      await doSaveAndComplete();
    } catch (error) {
      console.error('❌ Error saving realtime messages:', error);
      setIsGoingToFeedback(false);
      setMessageSaveError(true);
    }
  };

  const retrySave = async () => {
    try {
      setIsGoingToFeedback(true);
      await doSaveAndComplete();
    } catch (error) {
      console.error('❌ Error retrying realtime message save:', error);
      setIsGoingToFeedback(false);
      setMessageSaveError(true);
    }
  };

  const handleResetConversation = async () => {
    try {
      setShowEndConversationDialog(false);

      disconnectVoice();

      await apiRequest('DELETE', `/api/conversations/${conversationId}/messages`);

      setLocalMessages([]);

      resetPhase();

      await queryClient.invalidateQueries({ queryKey: ['/api/conversations', conversationId] });

      setConversationStartTime(null);
      setElapsedTime(0);

      showMicPromptReset();

      toast({
        title: t('voice.resetSuccess'),
        description: t('voice.resetDescription'),
      });
    } catch (error) {
      console.error('❌ Error resetting conversation:', error);
      toast({
        title: t('voice.resetError'),
        description: t('voice.resetError'),
        variant: "destructive"
      });
    }
  };

  // Durable in-flight guard using useRef so it survives re-renders.
  // Prevents concurrent flush calls from sending overlapping payloads:
  // - Non-final duplicate flush while one is already in-flight → skip.
  // - Final flush while one is in-flight → wait for it then send.
  const flushInFlightRef = useRef(false);
  // Promise that resolves when the current in-flight flush finishes.
  const flushInFlightPromiseRef = useRef<Promise<void> | null>(null);

  const flushRealtimeMessages = async (isFinal = false): Promise<void> => {
    // Prefer localMessagesRef.current (always up-to-date synchronously) over
    // localMessages prop (captured at last render), so a flush called immediately
    // after setLocalMessages includes the just-added message.
    const msgs = localMessagesRef?.current ?? localMessages;
    const payload = buildSavePayload(msgs, pendingUserText);
    if (payload.length === 0) return;

    if (flushInFlightRef.current) {
      if (!isFinal) {
        // A non-final flush is already in-flight; skip this duplicate.
        console.log(`⏩ [flushRealtimeMessages] Skipping duplicate non-final flush (in-flight)`);
        return;
      }
      // Final flush: wait for the in-flight flush to complete before sending
      // the definitive payload so no partial snapshot overwrites it.
      console.log(`⏳ [flushRealtimeMessages] Waiting for in-flight flush before final save`);
      await flushInFlightPromiseRef.current;
    }

    // Snapshot the message count before the async request so we can detect
    // whether new messages arrived while the request was in-flight.
    const snapshotLength = (localMessagesRef?.current ?? localMessages).length;

    let resolveFlight!: () => void;
    flushInFlightPromiseRef.current = new Promise<void>(r => { resolveFlight = r; });
    flushInFlightRef.current = true;
    try {
      await apiRequest('POST', `/api/conversations/${conversationId}/realtime-messages`, {
        messages: payload,
        isFinal,
      });
      console.log(`✅ [flushRealtimeMessages] Saved ${payload.length} messages, isFinal=${isFinal}`);
      // Successful save: allow server sync to resume by clearing the pending flag —
      // but only if no new messages were added while the request was in-flight.
      // If localMessagesRef grew beyond the snapshot, new user messages arrived
      // during the request and haven't been flushed yet; keep the flag true so
      // the sync effect stays blocked until those messages are also saved.
      // hasPendingLocalRef is intentionally NOT cleared on error — local messages
      // that have not yet been acknowledged by the server must not be overwritten
      // by a stale server refetch, regardless of how many flush attempts fail.
      const currentLength = (localMessagesRef?.current ?? localMessages).length;
      if (hasPendingLocalRef && currentLength <= snapshotLength) {
        hasPendingLocalRef.current = false;
      }
    } catch (error) {
      console.error('❌ [flushRealtimeMessages] Failed to save messages:', error);
      // Re-throw so callers can distinguish success from failure and apply their
      // own recovery logic (e.g. show an error toast, retry, or fall back).
      // hasPendingLocalRef remains true — local messages are still unsaved.
      throw error;
    } finally {
      flushInFlightRef.current = false;
      resolveFlight();
    }
  };

  return {
    isSessionEnding,
    isGoingToFeedback,
    showEndConversationDialog,
    setShowEndConversationDialog,
    showAlmostDoneDialog,
    handleAlmostDoneKeepGoing,
    handleAlmostDoneConfirmExit,
    handleGoToFeedback,
    handleFeedbackRequest,
    handleEndRealtimeConversation,
    confirmEndConversation,
    handleResetConversation,
    flushRealtimeMessages,
    messageSaveError,
    retrySave,
  };
}
