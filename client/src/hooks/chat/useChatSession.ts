import { useState, type MutableRefObject } from "react";
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
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();

  const handleGoToFeedback = () => {
    setIsGoingToFeedback(true);
    onConversationEnding?.();
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

  const confirmEndConversation = async () => {
    try {
      setShowEndConversationDialog(false);
      setIsGoingToFeedback(true);

      setIsSessionEnding(true);
      disconnectVoice();

      await new Promise(resolve => setTimeout(resolve, 1800));
      setIsSessionEnding(false);

      onConversationEnding?.();

      // Use localMessagesRef.current (always up-to-date) to include any message
      // appended since the last render before this async function was called.
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
    } catch (error) {
      console.error('❌ Error saving realtime messages:', error);
      toast({
        title: t('voice.saveError'),
        description: t('voice.saveError'),
        variant: "destructive"
      });
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

  const flushRealtimeMessages = async (isFinal = false): Promise<void> => {
    // Prefer localMessagesRef.current (always up-to-date synchronously) over
    // localMessages prop (captured at last render), so a flush called immediately
    // after setLocalMessages includes the just-added message.
    const msgs = localMessagesRef?.current ?? localMessages;
    const payload = buildSavePayload(msgs, pendingUserText);
    if (payload.length === 0) return;
    try {
      await apiRequest('POST', `/api/conversations/${conversationId}/realtime-messages`, {
        messages: payload,
        isFinal,
      });
      console.log(`✅ [flushRealtimeMessages] Saved ${payload.length} messages, isFinal=${isFinal}`);
    } catch (error) {
      console.error('❌ [flushRealtimeMessages] Failed to save messages:', error);
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
  };
}
