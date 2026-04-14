import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ConversationMessage } from "@shared/schema";

interface UseChatSessionOptions {
  conversationId: string;
  localMessages: ConversationMessage[];
  pendingUserText?: string;
  chatMode: 'messenger' | 'character';
  isPersonaMode: boolean;
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
  pendingUserText = '',
  chatMode,
  isPersonaMode,
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
  const [isGoingToFeedback, setIsGoingToFeedback] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();

  const handleGoToFeedback = () => {
    setIsGoingToFeedback(true);
    onConversationEnding?.();
    onChatComplete();
  };

  // 🔧 Fix 3: pendingUserText(말하는 도중 종료)가 있으면 마지막 발화로 추가
  const buildSavePayload = (msgs: ConversationMessage[], pendingText: string) => {
    const messages = msgs.map(msg => ({
      sender: msg.sender,
      message: msg.message,
      timestamp: msg.timestamp,
      emotion: msg.emotion,
      emotionReason: msg.emotionReason,
    }));
    const trimmed = pendingText.trim();
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

  const handleEndRealtimeConversation = () => {
    if (isPersonaMode) {
      disconnectVoice();
      const payload = buildSavePayload(localMessages, pendingUserText);
      if (payload.length > 0) {
        apiRequest('POST', `/api/conversations/${conversationId}/realtime-messages`, {
          messages: payload,
        }).catch(console.error);
      }
      onExit();
      return;
    }
    setShowEndConversationDialog(true);
  };

  const confirmEndConversation = async () => {
    try {
      setShowEndConversationDialog(false);
      setIsGoingToFeedback(true);

      if (chatMode === 'character') {
        setIsSessionEnding(true);
        disconnectVoice();

        await new Promise(resolve => setTimeout(resolve, 1800));
        setIsSessionEnding(false);
      } else {
        disconnectVoice();
      }

      onConversationEnding?.();

      const payload = buildSavePayload(localMessages, pendingUserText);
      if (payload.length > 0) {
        const res = await apiRequest(
          'POST',
          `/api/conversations/${conversationId}/realtime-messages`,
          { messages: payload }
        );

        await res.json();

        await queryClient.invalidateQueries({ queryKey: [`/api/conversations/${conversationId}`] });
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

      await queryClient.invalidateQueries({ queryKey: [`/api/conversations/${conversationId}`] });

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

  return {
    isSessionEnding,
    isGoingToFeedback,
    showEndConversationDialog,
    setShowEndConversationDialog,
    handleGoToFeedback,
    handleEndRealtimeConversation,
    confirmEndConversation,
    handleResetConversation,
  };
}
