import { useState, useEffect } from "react";
import type { Conversation } from "@shared/schema";

export const formatElapsedTime = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

interface UseConversationTimerOptions {
  conversation: Conversation | undefined;
  maxTurns: number;
}

export function useConversationTimer({ conversation, maxTurns }: UseConversationTimerOptions) {
  const [elapsedTime, setElapsedTime] = useState(0);
  const [conversationStartTime, setConversationStartTime] = useState<Date | null>(null);

  useEffect(() => {
    if (conversation && conversation.createdAt && !conversationStartTime) {
      setConversationStartTime(new Date(conversation.createdAt));
    }
  }, [conversation, conversationStartTime]);

  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (conversationStartTime && conversation && conversation.turnCount < maxTurns) {
      interval = setInterval(() => {
        const now = new Date();
        const elapsed = Math.floor((now.getTime() - conversationStartTime.getTime()) / 1000);
        setElapsedTime(elapsed);
      }, 1000);
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [conversationStartTime, conversation]);

  return {
    elapsedTime,
    conversationStartTime,
    setConversationStartTime,
    setElapsedTime,
  };
}
