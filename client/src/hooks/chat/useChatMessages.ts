import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";
import type { ConversationMessage } from "@shared/schema";

export interface PersonaSwitchedPayload {
  fromIndex: number;
  toIndex: number;
  reason: string;
  transitionLine: string;
  turnIndex?: number;
  newPersonaName?: string;
}

interface UseChatMessagesOptions {
  conversationId: string;
  serverMessages?: ConversationMessage[];
  onSimulationUpdate?: (update: { type: 'simulation_update'; personaRunId: string; eventType: string; currentState: any; incident?: any; turnScore?: any; evaluationSkipped?: boolean; version: number; timestamp: string }) => void;
  onPersonaSwitched?: (info: PersonaSwitchedPayload) => void;
}

function stripMetaPartial(text: string): string {
  const idx = text.lastIndexOf('[META:');
  return idx !== -1 ? text.slice(0, idx).trimEnd() : text;
}

// Shared response payload — covers both SSE done-event and JSON fallback shapes
type MessageResponsePayload = {
  message: string;
  emotion: string;
  emotionReason: string;
  isCompleted: boolean;
  turnCount: number;
  personaRun: Record<string, unknown> | null;
  messages: Array<{ sender: 'ai' | 'user'; message: string; timestamp: string; emotion?: string; emotionReason?: string }>;
  simulationState: ({ recentIncidents?: unknown[]; version?: number } & Record<string, unknown>) | null;
  turnScore: Record<string, unknown> | null;
  evaluationSkipped?: boolean;
  personaSwitched?: PersonaSwitchedPayload;
  _streamed?: boolean;
};

// Typed SSE event payloads (mirror server-side SseEvent union)
type SseDeltaEvent = { type: 'delta'; content: string };
type SseDoneEvent = { type: 'done' } & MessageResponsePayload;
type SseErrorEvent = { type: 'error'; message: string };
type SseEvent = SseDeltaEvent | SseDoneEvent | SseErrorEvent;

async function streamingFetch(
  url: string,
  body: object,
  onDelta: (content: string) => void,
  onStreamingDone: (cleanMessage: string, emotion: string, emotionReason: string, personaSwitched?: PersonaSwitchedPayload) => void
): Promise<MessageResponsePayload> {
  const token = localStorage.getItem('authToken');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    credentials: 'include',
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status}: ${text}`);
  }

  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('text/event-stream') && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let doneData: MessageResponsePayload | null = null;
    let streamError: string | null = null;

    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        let event: SseEvent;
        try {
          event = JSON.parse(line.slice(6)) as SseEvent;
        } catch {
          continue;
        }
        if (event.type === 'delta') {
          onDelta(event.content);
        } else if (event.type === 'done') {
          onStreamingDone(
            event.message || '',
            event.emotion || '중립',
            event.emotionReason || '',
            event.personaSwitched
          );
          doneData = { ...event, _streamed: true };
        } else if (event.type === 'error') {
          streamError = event.message || 'Streaming error';
          break outer;
        }
      }
    }

    if (streamError) throw new Error(streamError);
    if (!doneData) throw new Error('Stream ended without completion');

    return doneData;
  }

  // Fallback: regular JSON response (e.g. TTS mode, skip turns)
  return response.json() as Promise<MessageResponsePayload>;
}

export function useChatMessages({ conversationId, serverMessages, onSimulationUpdate, onPersonaSwitched }: UseChatMessagesOptions) {
  const [localMessages, setLocalMessages] = useState<ConversationMessage[]>([]);
  const [pendingAiMessage, setPendingAiMessage] = useState(false);
  const [pendingUserMessage, setPendingUserMessage] = useState(false);
  const [pendingUserText, setPendingUserText] = useState('');
  const [isStreamingActive, setIsStreamingActive] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();

  // Stable refs to avoid stale closures inside mutationFn
  const setLocalMessagesRef = useRef(setLocalMessages);
  useEffect(() => { setLocalMessagesRef.current = setLocalMessages; }, [setLocalMessages]);
  const setIsStreamingActiveRef = useRef(setIsStreamingActive);
  useEffect(() => { setIsStreamingActiveRef.current = setIsStreamingActive; }, [setIsStreamingActive]);
  const onPersonaSwitchedRef = useRef(onPersonaSwitched);
  useEffect(() => { onPersonaSwitchedRef.current = onPersonaSwitched; }, [onPersonaSwitched]);
  const conversationIdRef = useRef(conversationId);
  useEffect(() => { conversationIdRef.current = conversationId; }, [conversationId]);

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
    mutationFn: async (payload: string | { message: string; previousInputMode?: 'realtime-voice' | 'text' | 'tts' }) => {
      const body = typeof payload === 'string'
        ? { message: payload }
        : { message: payload.message, previousInputMode: payload.previousInputMode };

      let streamingMessageAdded = false;

      const onDelta = (content: string) => {
        if (!streamingMessageAdded) {
          setIsStreamingActiveRef.current(true);
          setLocalMessagesRef.current(prev => [...prev, {
            sender: 'ai' as const,
            message: stripMetaPartial(content),
            timestamp: new Date().toISOString(),
            emotion: '중립',
            emotionReason: '',
          }]);
          streamingMessageAdded = true;
        } else {
          setLocalMessagesRef.current(prev => {
            const msgs = [...prev];
            let lastAiIdx = -1;
            for (let i = msgs.length - 1; i >= 0; i--) {
              if (msgs[i].sender === 'ai') { lastAiIdx = i; break; }
            }
            if (lastAiIdx >= 0) {
              msgs[lastAiIdx] = { ...msgs[lastAiIdx], message: stripMetaPartial(msgs[lastAiIdx].message + content) };
            }
            return msgs;
          });
        }
      };

      const onStreamingDone = (cleanMessage: string, emotion: string, emotionReason: string, personaSwitched?: PersonaSwitchedPayload) => {
        // isStreamingActive is cleared in onSuccess/onSettled so the spinner
        // does not re-appear between the done event and mutation resolution
        if (streamingMessageAdded && cleanMessage) {
          setLocalMessagesRef.current(prev => {
            const msgs = [...prev];
            let lastAiIdx = -1;
            for (let i = msgs.length - 1; i >= 0; i--) {
              if (msgs[i].sender === 'ai') { lastAiIdx = i; break; }
            }
            if (lastAiIdx >= 0) {
              msgs[lastAiIdx] = {
                ...msgs[lastAiIdx],
                message: cleanMessage,
                emotion: emotion || '중립',
                emotionReason: emotionReason || '',
              };
            }
            return msgs;
          });
        }
        if (personaSwitched && onPersonaSwitchedRef.current) {
          onPersonaSwitchedRef.current(personaSwitched);
        }
      };

      return streamingFetch(
        `/api/conversations/${conversationIdRef.current}/messages`,
        body,
        onDelta,
        onStreamingDone
      );
    },
    onSuccess: (data) => {
      // Clear streaming indicator now that mutation has fully resolved
      setIsStreamingActive(false);
      // Only add AI message if NOT streamed (streaming handles it progressively)
      if (!data?._streamed && data?.messages?.length > 0) {
        const latestMessage = data.messages[data.messages.length - 1];
        if (latestMessage.sender === 'ai') {
          setLocalMessages(prev => [...prev, latestMessage]);
        }
      }

      // Forward simulation state update from HTTP/SSE response to SimulationPanel
      if (onSimulationUpdate && (data?.simulationState || data?.turnScore || data?.evaluationSkipped)) {
        onSimulationUpdate({
          type: 'simulation_update',
          personaRunId: conversationId,
          eventType: 'auto_evaluation',
          currentState: data.simulationState,
          incident: data.simulationState?.recentIncidents?.[data.simulationState.recentIncidents.length - 1],
          turnScore: data.turnScore,
          evaluationSkipped: data.evaluationSkipped ?? false,
          version: data.simulationState?.version ?? 0,
          timestamp: new Date().toISOString(),
        });
      }

      // Forward persona switch event to caller (non-streaming path only;
      // streaming path already fires this from onStreamingDone)
      if (onPersonaSwitched && data?.personaSwitched && !data?._streamed) {
        onPersonaSwitched(data.personaSwitched);
      }

      queryClient.invalidateQueries({ queryKey: ['/api/conversations', conversationId] });
      queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
    },
    onError: () => {
      setIsStreamingActive(false);
      setLocalMessages(prev => {
        if (prev.length > 0 && prev[prev.length - 1].sender === 'user') {
          return prev.slice(0, -1);
        }
        return prev;
      });

      toast({
        title: t('toast.error'),
        description: t('voice.sendError'),
        variant: 'destructive'
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
    isStreamingActive,
    messagesEndRef,
    sendMessageMutation,
    addUserMessage,
    addAiMessage,
    addRealtimeUserMessage,
    addRealtimeAiMessage,
    resetMessages,
  };
}
