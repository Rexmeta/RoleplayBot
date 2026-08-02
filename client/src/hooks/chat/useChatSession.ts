import { useState, useRef, type MutableRefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ConversationMessage } from "@shared/schema";

interface UseChatSessionOptions {
  conversationId: string;
  localMessages: ConversationMessage[];
  localMessagesRef?: MutableRefObject<ConversationMessage[]>;
  pendingUserText?: string;
  pendingUserTextRef?: MutableRefObject<string>;
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
  conversationId,
  localMessages,
  localMessagesRef,
  pendingUserText = '',
  pendingUserTextRef,
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

  const handleGoToFeedback = async () => {
    setIsGoingToFeedback(true);
    onConversationEnding?.();

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
    const messages = msgs.map(msg => ({
      sender: msg.sender,
      message: msg.message,
      timestamp: msg.timestamp,
      emotion: msg.emotion,
      emotionReason: msg.emotionReason,
      userAffect: msg.userAffect ?? undefined,
    }));
    const latest = pendingUserTextRef ? pendingUserTextRef.current : pendingText;
    const trimmed = latest.trim();
    if (trimmed) {
      console.log(`🎤 [save] Including pendingUserText as last message: "${trimmed.substring(0, 60)}"`);
      messages.push({
        sender: 'user',
        message: trimmed,
        timestamp: new Date().toISOString(),
        emotion: undefined,
        emotionReason: undefined,
      });
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
