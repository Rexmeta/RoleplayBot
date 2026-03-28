import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { ConversationMessage } from "@shared/schema";

interface UseChatMessagesOptions {
  conversationId: string;
  serverMessages?: ConversationMessage[];
}

export function useChatMessages({ conversationId, serverMessages }: UseChatMessagesOptions) {
  const [localMessages, setLocalMessages] = useState<ConversationMessage[]>([]);
  const [pendingAiMessage, setPendingAiMessage] = useState(false);
  const [pendingUserMessage, setPendingUserMessage] = useState(false);
  const [pendingUserText, setPendingUserText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();

  useEffect(() => {
    if (serverMessages) {
      setLocalMessages(serverMessages);
    }
  }, [serverMessages]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'end'
      });
    }
  }, [localMessages, pendingAiMessage, pendingUserMessage, pendingUserText]);

  const sendMessageMutation = useMutation({
    mutationFn: async (message: string) => {
      const response = await apiRequest("POST", `/api/conversations/${conversationId}/messages`, {
        message
      });
      return response.json();
    },
    onSuccess: (data) => {
      if (data.messages && data.messages.length > 0) {
        const latestMessage = data.messages[data.messages.length - 1];
        if (latestMessage.sender === 'ai') {
          setLocalMessages(prev => [...prev, latestMessage]);
        }
      }

      queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversationId] });
    },
    onError: () => {
      setLocalMessages(prev => {
        if (prev.length > 0 && prev[prev.length - 1].sender === 'user') {
          return prev.slice(0, -1);
        }
        return prev;
      });

      toast({
        title: t('toast.error'),
        description: t('voice.sendError'),
        variant: "destructive"
      });
    }
  });

  const addUserMessage = (message: string) => {
    const userMessage: ConversationMessage = {
      sender: 'user',
      message: message,
      timestamp: new Date().toISOString()
    };
    setLocalMessages(prev => [...prev, userMessage]);
    return userMessage;
  };

  const addAiMessage = (message: string, emotion?: string, emotionReason?: string) => {
    const aiMessage: ConversationMessage = {
      sender: 'ai',
      message,
      timestamp: new Date().toISOString(),
      emotion: emotion || '중립',
      emotionReason: emotionReason || '',
    };
    setLocalMessages(prev => [...prev, aiMessage]);
    return aiMessage;
  };

  const addRealtimeUserMessage = (transcript: string) => {
    setPendingUserMessage(false);
    setPendingUserText('');
    setLocalMessages(prev => [...prev, {
      sender: 'user',
      message: transcript,
      timestamp: new Date().toISOString(),
    }]);
  };

  const addRealtimeAiMessage = (message: string, emotion?: string, emotionReason?: string) => {
    setPendingAiMessage(false);
    setLocalMessages(prev => [...prev, {
      sender: 'ai',
      message,
      timestamp: new Date().toISOString(),
      emotion: emotion || '중립',
      emotionReason: emotionReason || '',
    }]);
  };

  const resetMessages = () => {
    setLocalMessages([]);
    setPendingAiMessage(false);
    setPendingUserMessage(false);
    setPendingUserText('');
  };

  return {
    localMessages,
    setLocalMessages,
    pendingAiMessage,
    setPendingAiMessage,
    pendingUserMessage,
    setPendingUserMessage,
    pendingUserText,
    setPendingUserText,
    messagesEndRef,
    sendMessageMutation,
    addUserMessage,
    addAiMessage,
    addRealtimeUserMessage,
    addRealtimeAiMessage,
    resetMessages,
  };
}
