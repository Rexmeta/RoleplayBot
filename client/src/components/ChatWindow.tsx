import { useState, useEffect, useRef, useCallback } from "react";
import { X, Brain, AlertTriangle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { toMediaUrl } from "@/lib/mediaUrl";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { ComplexScenario, ScenarioPersona } from "@/lib/scenario-system";
import type { Conversation } from "@shared/schema";
import { useRealtimeVoice } from "@/hooks/useRealtimeVoice";
import { AISpeechParticleLayer } from "@/components/AISpeechParticleLayer";
import { UserSpeechParticleLayer } from "@/components/UserSpeechParticleLayer";
import { getProgressInfo } from "@/lib/conversationProgress";
import { useSimulationState } from "@/hooks/useSimulationState";
import SimulationPanel from "@/components/SimulationPanel";

import { useConversationTimer, formatElapsedTime } from "@/hooks/chat/useConversationTimer";
import { useVoiceRecording } from "@/hooks/chat/useVoiceRecording";
import { useEmotionState, emotionEmojis } from "@/hooks/chat/useEmotionState";
import { useChatMessages } from "@/hooks/chat/useChatMessages";
import { useChatSession } from "@/hooks/chat/useChatSession";
import { useTTS } from "@/hooks/chat/useTTS";

import { MessageList } from "@/components/chat/MessageList";
import { PersonaSwitchCard } from "@/components/chat/PersonaSwitchCard";
import { TranscriptPanel } from "@/components/chat/TranscriptPanel";
import { TopMenuPanel } from "@/components/chat/TopMenuPanel";
import { CharacterPortrait } from "@/components/chat/CharacterPortrait";
import { ChatInputBar } from "@/components/chat/ChatInputBar";
import { GoalsSidebar } from "@/components/chat/GoalsSidebar";

const MAX_TURNS = 999;
const SOFT_CLOSE_THRESHOLD = 0.8;

type PreviousMessage = { role: 'user' | 'ai'; content: string };

interface ChatWindowProps {
  scenario: ComplexScenario;
  persona: ScenarioPersona;
  conversationId: string;
  onChatComplete: () => void;
  onExit: () => void;
  onPersonaChange?: () => void;
  onReady?: () => void;
  onConversationEnding?: () => void;
  isPersonaMode?: boolean;
  initialMessages?: import("@shared/schema").ConversationMessage[];
}

export default function ChatWindow({ scenario, persona, conversationId, onChatComplete, onExit, onPersonaChange, onReady, onConversationEnding, isPersonaMode = false, initialMessages }: ChatWindowProps) {
  const [userInput, setUserInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [inputMode, setInputMode] = useState<'text' | 'tts' | 'realtime-voice'>('realtime-voice');
  const [showInputMode, setShowInputMode] = useState(false);
  const [isGoalsExpanded, setIsGoalsExpanded] = useState(false);
  const [isSwitchingMode, setIsSwitchingMode] = useState(false);
  const [isMobileSimOpen, setIsMobileSimOpenRaw] = useState(
    () => localStorage.getItem('npc-panel-open') === 'true'
  );
  const [simSheetDragY, setSimSheetDragY] = useState(0);
  const [simSheetDragging, setSimSheetDragging] = useState(false);
  const simSheetTouchStartY = useRef<number>(0);
  const simSheetDragActive = useRef<boolean>(false);
  const [mobileIncidentAlert, setMobileIncidentAlert] = useState<import('@/hooks/useSimulationState').Incident | null>(null);
  const mobileIncidentDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setIsMobileSimOpen = (value: boolean | ((prev: boolean) => boolean)) => {
    setIsMobileSimOpenRaw(prev => {
      const next = typeof value === 'function' ? value(prev) : value;
      localStorage.setItem('npc-panel-open', String(next));
      if (next) {
        setMobileIncidentAlert(null);
        if (mobileIncidentDismissTimerRef.current) {
          clearTimeout(mobileIncidentDismissTimerRef.current);
          mobileIncidentDismissTimerRef.current = null;
        }
      }
      return next;
    });
  };
  const DESKTOP_NPC_KEY = 'npc-panel-desktop-open';
  const [isDesktopSimOpen, setIsDesktopSimOpenRaw] = useState(
    () => localStorage.getItem(DESKTOP_NPC_KEY) === 'true'
  );
  const hasAutoExpandedNpcRef = useRef(false);
  const setIsDesktopSimOpen = (value: boolean | ((prev: boolean) => boolean)) => {
    setIsDesktopSimOpenRaw(prev => {
      const next = typeof value === 'function' ? value(prev) : value;
      localStorage.setItem(DESKTOP_NPC_KEY, String(next));
      if (next) clearIncidentCount();
      return next;
    });
  };
  const isPersonaX = scenario.id?.startsWith('__');
  const [showMicPrompt, setShowMicPrompt] = useState(false);
  const [isInputExpanded, setIsInputExpanded] = useState(false);
  const [isBargeInFlash, setIsBargeInFlash] = useState(false);
  const [isTranscriptPanelOpen, setIsTranscriptPanelOpen] = useState(false);
  const [isTopMenuOpen, setIsTopMenuOpen] = useState(false);
  const [isSilenceIdle, setIsSilenceIdle] = useState(false);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [viewportOffsetTop, setViewportOffsetTop] = useState<number>(0);

  const isAISpeakingForBargeInRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasUserSpokenRef = useRef(false);
  const handleSwitchToTextModeRef = useRef<(() => Promise<void>) | null>(null);
  const pendingModeTransitionRef = useRef<'realtime-voice' | 'text' | 'tts' | undefined>(undefined);

  const { toast } = useToast();
  const { user } = useAuth();
  const { t } = useTranslation();

  const getPersonaGender = (): 'male' | 'female' => persona.gender ?? 'male';

  const isSimulationEnabled = !isPersonaX && !!conversationId;

  const {
    state: simulationState,
    newIncident,
    incidentCount,
    clearIncidentCount,
    latestTurnScore,
    applyUpdate: applySimulationUpdate,
    evaluate,
  } = useSimulationState({
    personaRunId: isSimulationEnabled ? conversationId : null,
    enabled: isSimulationEnabled,
  });

  const handleSimulationUpdate = useCallback((update: any) => {
    applySimulationUpdate(update);
  }, [applySimulationUpdate]);

  const [personaSwitchEvents, setPersonaSwitchEvents] = useState<import("./chat/PersonaSwitchCard").PersonaSwitchEvent[]>([]);
  const [latestPersonaSwitch, setLatestPersonaSwitch] = useState<{ name: string; transitionLine: string } | null>(null);
  const personaSwitchBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activePersona, setActivePersona] = useState<ScenarioPersona>(persona);

  const handlePersonaSwitched = useCallback((info: { fromIndex: number; toIndex: number; newPersonaName?: string; reason: string; transitionLine: string; turnIndex?: number; fromPersonaName?: string }) => {
    const fromPersonaName = info.fromPersonaName
      ?? (scenario.personas?.[info.fromIndex] as ScenarioPersona | undefined)?.name;
    const eventEntry = {
      fromIndex: info.fromIndex,
      fromPersonaName,
      toIndex: info.toIndex,
      newPersonaName: info.newPersonaName ?? '',
      reason: info.reason,
      transitionLine: info.transitionLine,
      timestamp: new Date().toISOString(),
      turnIndex: info.turnIndex,
    };
    setPersonaSwitchEvents(prev => [...prev, eventEntry]);
    // Update active persona so header/portrait displays the new character
    const switchedTo = scenario.personas?.[info.toIndex] as ScenarioPersona | undefined;
    if (switchedTo) {
      setActivePersona(switchedTo);
    }
    // Show temporary banner
    if (personaSwitchBannerTimerRef.current) clearTimeout(personaSwitchBannerTimerRef.current);
    setLatestPersonaSwitch({ name: info.newPersonaName ?? '', transitionLine: info.transitionLine });
    personaSwitchBannerTimerRef.current = setTimeout(() => setLatestPersonaSwitch(null), 4000);
  }, [scenario.personas]);

  const { localMessages, setLocalMessages, pendingAiMessage: rawPendingAiMessage, setPendingAiMessage,
    pendingUserMessage, setPendingUserMessage, pendingUserText, setPendingUserText,
    messagesEndRef, sendMessageMutation } = useChatMessages({
    conversationId,
    serverMessages: initialMessages,
    onSimulationUpdate: isSimulationEnabled ? handleSimulationUpdate : undefined,
    onPersonaSwitched: handlePersonaSwitched,
  });

  const { currentEmotion, setCurrentEmotion, isEmotionTransitioning, setIsEmotionTransitioning,
    loadedImageUrl, isInitialLoading, isOverlayFading, hasNoPersonaImages,
    getCharacterImage, preloadImage } = useEmotionState({
    persona: { id: activePersona.id, mbti: activePersona.mbti, gender: activePersona.gender, name: activePersona.name, image: activePersona.image, expressions: activePersona.expressions },
    conversationId, onReady,
  });

  const { speakText, stopSpeaking, cleanup: cleanupTTS } = useTTS({
    personaId: persona.id,
    personaGender: getPersonaGender(),
    inputMode,
  });

  const realtimeVoice = useRealtimeVoice({
    conversationId, scenarioId: scenario.id, personaId: persona.id, enabled: false,
    onSimulationUpdate: isSimulationEnabled ? handleSimulationUpdate : undefined,
    onPersonaSwitched: handlePersonaSwitched,
    onReconnectGreetingComplete: () => {
      setPendingAiMessage(false);
      isAISpeakingForBargeInRef.current = false;
    },
    onMessageComplete: (message, emotion, emotionReason) => {
      setPendingAiMessage(false);
      isAISpeakingForBargeInRef.current = false;
      if (emotion) {
        setIsEmotionTransitioning(true);
        setCurrentEmotion(emotion);
        setTimeout(() => setIsEmotionTransitioning(false), 150);
        const newUrl = getCharacterImage(emotion);
        if (newUrl) preloadImage(newUrl);
      }
      setLocalMessages(prev => {
        if (prev.some(m => m.sender === 'ai' && m.message === message)) return prev;
        // Phase-based dedup: if AI has spoken but user hasn't yet (greeting phase),
        // suppress any additional AI message — it's a duplicate from the retry race.
        const hasAiMessage = prev.some(m => m.sender === 'ai');
        const hasUserMessage = prev.some(m => m.sender === 'user');
        if (hasAiMessage && !hasUserMessage) {
          console.log('⚠️ [phase-dedup] Suppressing duplicate AI message in greeting phase');
          return prev;
        }
        return [...prev, { sender: 'ai', message, timestamp: new Date().toISOString(), emotion: emotion || '중립', emotionReason: emotionReason || '' }];
      });
      if (!hasUserSpokenRef.current) setShowMicPrompt(true);
    },
    onUserTranscription: (transcript) => {
      setPendingUserMessage(false); setPendingUserText('');
      setLocalMessages(prev => [...prev, { sender: 'user', message: transcript, timestamp: new Date().toISOString() }]);
    },
    onUserTranscriptionDelta: (_delta, accumulated) => { setPendingUserText(accumulated); },
    onAiSpeakingStart: () => { setPendingAiMessage(true); isAISpeakingForBargeInRef.current = true; },
    onUserSpeakingStart: () => {
      setPendingUserMessage(true); setPendingUserText('');
      hasUserSpokenRef.current = true; setShowMicPrompt(false);
      if (isAISpeakingForBargeInRef.current) {
        setIsBargeInFlash(true); isAISpeakingForBargeInRef.current = false;
        setTimeout(() => setIsBargeInFlash(false), 400);
      }
    },
    onError: (error) => toast({ title: t('voice.connectionError'), description: error, variant: "destructive" }),
    onSessionTerminated: (reason) => {
      toast({ title: t('voice.sessionEnded'), description: reason });
      setPendingAiMessage(false); setPendingUserMessage(false); setPendingUserText('');
      pendingModeTransitionRef.current = 'realtime-voice';
      setInputMode('text');
      if (handleSwitchToTextModeRef.current) {
        handleSwitchToTextModeRef.current();
      }
    },
  });

  const pendingAiMessage = rawPendingAiMessage && !realtimeVoice.isReconnecting;

  const { data: conversation, error } = useQuery<Conversation>({
    queryKey: ["/api/conversations", conversationId], enabled: !!conversationId,
  });

  const { elapsedTime, setConversationStartTime, setElapsedTime } = useConversationTimer({
    conversation, maxTurns: MAX_TURNS,
  });

  const { isRecording, speechSupported, startRecording, stopRecording, removeInterimText, cleanup: cleanupVoiceRecording } = useVoiceRecording({
    onTranscript: (transcript) => setUserInput(prev => { const t = removeInterimText(prev); return t + (t ? ' ' : '') + transcript; }),
    onInterimTranscript: (interim) => {
      if (interim === '') setUserInput(prev => removeInterimText(prev));
      else setUserInput(prev => { const t = removeInterimText(prev); return t + (t ? ' ' : '') + interim; });
    },
  });

  const targetTurns = scenario.targetTurns ?? 10;
  const currentTurn = realtimeVoice.status === 'connected'
    ? localMessages.filter(m => m.sender === 'ai').length
    : (conversation ? conversation.turnCount : 0);
  const progressPercentage = Math.min((currentTurn / targetTurns) * 100, 100);
  const isNearingEnd = progressPercentage >= SOFT_CLOSE_THRESHOLD * 100;
  const progressInfo = getProgressInfo(progressPercentage);
  const turnsLeft = Math.max(targetTurns - currentTurn, 0);

  const prevStageRef = useRef(progressInfo.stage);
  const [isProgressAnimating, setIsProgressAnimating] = useState(false);
  const [isButtonAnimating, setIsButtonAnimating] = useState(false);
  const animTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (progressInfo.stage !== prevStageRef.current) {
      prevStageRef.current = progressInfo.stage;
      setIsProgressAnimating(true);
      setIsButtonAnimating(true);
      if (animTimerRef.current) clearTimeout(animTimerRef.current);
      animTimerRef.current = setTimeout(() => {
        setIsProgressAnimating(false);
        setIsButtonAnimating(false);
      }, 650);
    }
  }, [progressInfo.stage]);

  useEffect(() => {
    return () => {
      if (animTimerRef.current) clearTimeout(animTimerRef.current);
    };
  }, []);

  const { isSessionEnding, isGoingToFeedback, showEndConversationDialog, setShowEndConversationDialog,
    showAlmostDoneDialog, handleAlmostDoneKeepGoing, handleAlmostDoneConfirmExit,
    handleGoToFeedback, handleFeedbackRequest, handleEndRealtimeConversation, confirmEndConversation, handleResetConversation, flushRealtimeMessages } = useChatSession({
    conversationId, localMessages, pendingUserText, isPersonaMode, isNearingEnd, currentTurn, targetTurns,
    onChatComplete, onExit, onConversationEnding,
    disconnectVoice: realtimeVoice.disconnect, resetPhase: realtimeVoice.resetPhase,
    setLocalMessages, setConversationStartTime, setElapsedTime,
    showMicPromptReset: () => { hasUserSpokenRef.current = false; setShowMicPrompt(false); },
  });

  handleSwitchToTextModeRef.current = async () => {
    if (isSwitchingMode) return;
    setIsSwitchingMode(true);
    try {
      await flushRealtimeMessages(false);
      realtimeVoice.disconnect();
    } finally {
      setIsSwitchingMode(false);
      pendingModeTransitionRef.current = 'realtime-voice';
      setInputMode('text');
    }
  };

  useEffect(() => {
    if (!conversation?.messages) return;
    setLocalMessages(prev => {
      const incoming = conversation.messages;
      const incomingKeys = new Set(incoming.map(m => `${m.sender}:::${m.message}`));
      const existingKeys = new Set(prev.map(m => `${m.sender}:::${m.message}`));
      const hasNewFromServer = incoming.some(m => !existingKeys.has(`${m.sender}:::${m.message}`));
      const localOnly = prev.filter(m => !incomingKeys.has(`${m.sender}:::${m.message}`));
      if (!hasNewFromServer && localOnly.length === 0) return prev;
      return [...incoming, ...localOnly];
    });
  }, [conversation?.messages]);

  useEffect(() => { if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' }); },
    [localMessages, pendingAiMessage, pendingUserMessage, pendingUserText]);

  useEffect(() => { return () => { cleanupTTS(); cleanupVoiceRecording(); }; }, []);

  useEffect(() => {
    if (!newIncident) return;
    if (isMobileSimOpen) return;
    setMobileIncidentAlert(newIncident);
    if (mobileIncidentDismissTimerRef.current) clearTimeout(mobileIncidentDismissTimerRef.current);
    mobileIncidentDismissTimerRef.current = setTimeout(() => {
      setMobileIncidentAlert(null);
      mobileIncidentDismissTimerRef.current = null;
    }, 5000);
  }, [newIncident]);

  useEffect(() => {
    return () => {
      if (mobileIncidentDismissTimerRef.current) {
        clearTimeout(mobileIncidentDismissTimerRef.current);
        mobileIncidentDismissTimerRef.current = null;
      }
    };
  }, []);

  // 🔧 Fix 2: 탭 닫기/새로고침/페이지 이탈 시 localMessages를 sendBeacon으로 저장
  // navigator.sendBeacon은 페이지가 닫히는 도중에도 쿠키와 함께 POST 전송 보장
  const localMessagesRef = useRef(localMessages);
  const pendingUserTextRef = useRef(pendingUserText);
  const conversationIdRef = useRef(conversationId);
  const isGoingToFeedbackRef = useRef(false);

  useEffect(() => { localMessagesRef.current = localMessages; }, [localMessages]);
  useEffect(() => { pendingUserTextRef.current = pendingUserText; }, [pendingUserText]);
  useEffect(() => { conversationIdRef.current = conversationId; }, [conversationId]);
  useEffect(() => { isGoingToFeedbackRef.current = isGoingToFeedback; }, [isGoingToFeedback]);

  useEffect(() => {
    const handlePageHide = () => {
      // 정상 종료(피드백 페이지 이동) 중이면 이미 저장 진행 중 → 중복 저장 방지
      if (isGoingToFeedbackRef.current) return;

      const msgs = localMessagesRef.current;
      const pending = pendingUserTextRef.current.trim();
      const convId = conversationIdRef.current;

      const payload: Array<{ sender: string; message: string; timestamp: string; emotion?: string; emotionReason?: string }> = msgs.map(msg => ({
        sender: msg.sender,
        message: msg.message,
        timestamp: msg.timestamp,
        emotion: msg.emotion,
        emotionReason: msg.emotionReason,
      }));

      if (pending) {
        payload.push({ sender: 'user', message: pending, timestamp: new Date().toISOString() });
      }

      if (payload.length === 0 || !convId) return;

      console.log(`📤 [pagehide] sendBeacon 저장: ${payload.length}개 메시지`);
      const blob = new Blob([JSON.stringify({ messages: payload })], { type: 'application/json' });
      navigator.sendBeacon(`/api/conversations/${convId}/realtime-messages`, blob);
    };

    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      setViewportHeight(vv.height);
      setViewportOffsetTop(vv.offsetTop);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  useEffect(() => { isAISpeakingForBargeInRef.current = realtimeVoice.isAISpeaking; }, [realtimeVoice.isAISpeaking]);

  useEffect(() => {
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    setIsSilenceIdle(false);
    const isIdle = realtimeVoice.status === 'connected' && !realtimeVoice.isAISpeaking && !realtimeVoice.isRecording && !realtimeVoice.isWaitingForGreeting && !pendingAiMessage && !pendingUserMessage;
    if (isIdle) silenceTimerRef.current = setTimeout(() => setIsSilenceIdle(true), 5000);
    return () => { if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current); };
  }, [realtimeVoice.status, realtimeVoice.isAISpeaking, realtimeVoice.isRecording, realtimeVoice.isWaitingForGreeting, pendingAiMessage, pendingUserMessage]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Enter" && e.ctrlKey) handleSendMessage(); };
    document.addEventListener("keypress", handler); return () => document.removeEventListener("keypress", handler);
  }, [userInput, isLoading]);

  const latestAiMessage = localMessages.slice().reverse().find(msg => msg.sender === 'ai');

  useEffect(() => {
    const newEmotion = latestAiMessage?.emotion || '중립';
    if (newEmotion !== currentEmotion) {
      setIsEmotionTransitioning(true); setCurrentEmotion(newEmotion);
      const newUrl = getCharacterImage(newEmotion); if (newUrl) preloadImage(newUrl);
    }
    if (inputMode === 'tts' && latestAiMessage?.message) {
      speakText(latestAiMessage.message, true, latestAiMessage.emotion, activePersona.voiceId ?? undefined, (activePersona.gender as 'male' | 'female') || undefined);
    }
  }, [latestAiMessage?.message, latestAiMessage?.emotion, currentEmotion, inputMode, activePersona.voiceId]);

  const hasActiveIncident = !!(simulationState?.recentIncidents?.some(i => !i.resolved));

  useEffect(() => {
    if (simulationState && !hasAutoExpandedNpcRef.current && localStorage.getItem(DESKTOP_NPC_KEY) === null) {
      hasAutoExpandedNpcRef.current = true;
      setIsDesktopSimOpenRaw(true);
    }
  }, [simulationState]);

  useEffect(() => {
    if (latestAiMessage && isSimulationEnabled && !hasAutoExpandedNpcRef.current && localStorage.getItem(DESKTOP_NPC_KEY) === null) {
      hasAutoExpandedNpcRef.current = true;
      setIsDesktopSimOpenRaw(true);
    }
  }, [latestAiMessage, isSimulationEnabled]);

  const lastUserTextRef = useRef<string>('');

  const handleSendMessage = () => {
    const message = userInput.trim(); if (!message || isLoading) return;
    if (inputMode === 'realtime-voice' && realtimeVoice.status === 'connected') { setUserInput(""); realtimeVoice.sendTextMessage(message); return; }
    setLocalMessages(prev => [...prev, { sender: 'user', message, timestamp: new Date().toISOString() }]);
    setIsLoading(true); setUserInput(""); setShowInputMode(false);
    lastUserTextRef.current = message;
    const transitionMode = pendingModeTransitionRef.current;
    pendingModeTransitionRef.current = undefined;
    sendMessageMutation.mutate(
      transitionMode ? { message, previousInputMode: transitionMode } : message,
      {
        onSuccess: (data) => {
          setIsLoading(false);
          if (isSimulationEnabled && data?.simulationState) {
            applySimulationUpdate({
              type: 'simulation_update',
              personaRunId: conversationId,
              currentState: data.simulationState,
              turnScore: data.turnScore ?? null,
              eventType: 'auto_evaluation',
              version: data.simulationState.version,
              timestamp: new Date().toISOString(),
            });
          }
        },
        onError: () => {
          setIsLoading(false);
          if (transitionMode) pendingModeTransitionRef.current = transitionMode;
        },
      }
    );
  };

  const handleSkipTurn = () => {
    if (isLoading) return;
    setIsLoading(true); setShowInputMode(false);
    const transitionMode = pendingModeTransitionRef.current;
    pendingModeTransitionRef.current = undefined;
    sendMessageMutation.mutate(
      transitionMode ? { message: "", previousInputMode: transitionMode } : "",
      {
        onSuccess: () => setIsLoading(false),
        onError: () => {
          setIsLoading(false);
          if (transitionMode) pendingModeTransitionRef.current = transitionMode;
        },
      }
    );
  };
  const handleVoiceInput = () => { if (isRecording) stopRecording(); else startRecording(); };

  if (error) return (
    <div className="text-center py-8">
      <p className="text-red-600">대화를 불러올 수 없습니다.</p>
      <Button onClick={onExit} className="mt-4">시나리오 선택으로 돌아가기</Button>
    </div>
  );
  if (!conversation) return <div className="text-center py-8">로딩 중...</div>;

  if (isGoingToFeedback) return (
    <div className="fixed inset-0 z-50 bg-white flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-corporate-600 mx-auto mb-4"></div>
        <h2 className="text-xl font-semibold text-slate-900 mb-2">피드백 준비 중...</h2>
        <p className="text-slate-600">잠시만 기다려 주세요.</p>
      </div>
    </div>
  );

  const previousMessages: PreviousMessage[] = localMessages.filter(m => m.sender === 'user' || m.sender === 'ai').map(m => ({ role: m.sender as 'user' | 'ai', content: m.message }));

  const rvBarProps = {
    status: realtimeVoice.status, isRecording: realtimeVoice.isRecording, isAISpeaking: realtimeVoice.isAISpeaking,
    isWaitingForGreeting: realtimeVoice.isWaitingForGreeting, greetingFailed: realtimeVoice.greetingFailed,
    greetingRetryCount: realtimeVoice.greetingRetryCount, conversationPhase: realtimeVoice.conversationPhase,
    sessionWarning: realtimeVoice.sessionWarning, error: realtimeVoice.error,
    showMicPrompt, isInputExpanded, onInputExpandedChange: setIsInputExpanded,
    onConnect: (msgs?: PreviousMessage[]) => realtimeVoice.connect(msgs),
    onStartRecording: () => { hasUserSpokenRef.current = true; setShowMicPrompt(false); setIsInputExpanded(false); realtimeVoice.startRecording(); },
    onStopRecording: () => realtimeVoice.stopRecording(),
    onEndConversation: handleEndRealtimeConversation,
    previousMessages,
    personaDept: activePersona.department, personaRole: activePersona.role, personaName: activePersona.name, userName: user?.name,
    currentTurn, targetTurns,
  };

  return (
    <>
      <TopMenuPanel isOpen={isTopMenuOpen} onToggle={() => setIsTopMenuOpen(v => !v)} onClose={() => setIsTopMenuOpen(false)} />

      <div className="chat-window relative">
        {isInitialLoading && (
          <div className={`fixed inset-0 z-50 bg-black flex items-center justify-center transition-opacity duration-500 ${isOverlayFading ? 'opacity-0' : 'opacity-100'}`} data-testid="chat-loading-overlay">
            <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin" />
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          {/* Chat Header */}
          <div className="bg-gradient-to-r from-corporate-600 to-corporate-700 px-4 sm:px-6 py-3 sm:py-4 text-white">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center space-x-3 sm:space-x-4 min-w-0 flex-1">
                <div className="flex-shrink-0" data-testid="chat-header-persona-image">
                  <div className="w-14 h-14 sm:w-12 sm:h-12 rounded-xl border-2 border-white/30 overflow-hidden bg-gradient-to-br from-slate-100 to-slate-200 shadow-lg">
                    <img src={getCharacterImage(currentEmotion) || toMediaUrl(activePersona.image)} alt={activePersona.name}
                      className="w-full h-full object-cover object-[center_15%] transition-all duration-200 scale-110"
                      onError={(e) => { (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(activePersona.name)}&background=6366f1&color=fff&size=64`; }} />
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-left w-full" data-testid="chat-header-persona-info">
                    <h3 className="text-base sm:text-lg font-semibold truncate">{activePersona.name} ({activePersona.department})</h3>
                    <p className="text-blue-100 text-xs sm:text-sm truncate">{scenario.title}</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <div className="flex-1 flex items-center gap-2 min-w-0">
                <div className="flex-1 bg-white/20 rounded-full h-3 overflow-hidden">
                  <div
                    className={`rounded-full h-3 transition-all duration-500 ${progressInfo.progressBarClass}${isProgressAnimating ? ' animate-progress-flash' : ''}`}
                    style={{ width: `${progressPercentage}%` }}
                  />
                </div>
                <div className="flex items-center gap-2 text-white/90 text-xs shrink-0">
                  <div
                    className={`flex items-center gap-1 font-medium transition-colors duration-300 ${progressInfo.isAmber ? 'text-amber-300' : progressInfo.isGreen ? 'text-green-300' : 'text-white/90'}`}
                    data-testid="turn-counter"
                  >
                    {progressInfo.stage === 'complete' ? (
                      <span className="font-semibold">{t('chat.conversationCompleted')}</span>
                    ) : (
                      <>
                        <span className="opacity-70">{Math.round(progressPercentage)}%</span>
                        <span className="opacity-50">·</span>
                        <span>{t('chat.turnsRemaining', { count: turnsLeft })}</span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-1 opacity-75"><i className="fas fa-clock text-xs"></i><span data-testid="elapsed-time">{formatElapsedTime(elapsedTime)}</span></div>
                </div>
              </div>

              {inputMode !== 'realtime-voice' && (
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (progressInfo.stage === 'complete') {
                            handleFeedbackRequest();
                          } else {
                            handleEndRealtimeConversation();
                          }
                        }}
                        data-testid="button-end-conversation-header"
                        className={`shrink-0 text-xs h-8 px-3 border transition-all duration-300 ${progressInfo.endButtonClass}${isButtonAnimating ? ' animate-btn-pop' : ''}`}
                      >
                        {progressInfo.showWarningIcon && <i className="fas fa-exclamation-triangle mr-1 text-xs"></i>}
                        {progressInfo.isGreen && <i className="fas fa-chart-bar mr-1 text-xs"></i>}
                        {progressInfo.isAmber && !progressInfo.isGreen && <i className="fas fa-star mr-1 text-xs"></i>}
                        {progressInfo.showBadge && <span className="mr-1 bg-white/20 rounded px-1 text-xs font-mono">{currentTurn}/{targetTurns}</span>}
                        {t(progressInfo.endButtonLabelKey)}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      {progressInfo.stage === 'early'
                        ? t('chat.exitWarningTooltip', { count: turnsLeft })
                        : progressInfo.stage === 'mid'
                        ? t('chat.progressBadgeTooltip', { current: currentTurn, target: targetTurns })
                        : progressInfo.stage === 'nearEnd'
                        ? t('chat.almostDoneTitle')
                        : t('chat.getFeedback')}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          </div>

          {/* Main Content */}
          <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
            <div
              className="fixed left-0 right-0 z-10 flex"
              data-testid="character-mode"
              style={viewportHeight
                ? { top: `${viewportOffsetTop}px`, height: `${viewportHeight}px` }
                : { top: 0, bottom: 0 }}
            >
                {!isPersonaX && (
                  <GoalsSidebar scenario={scenario} personaName={persona.name} personaDept={persona.department} personaRole={persona.role}
                    latestEmotion={latestAiMessage?.emotion} elapsedTime={elapsedTime} isAdmin={user?.role === 'admin'}
                    isGoalsExpanded={isGoalsExpanded} onToggleGoals={() => setIsGoalsExpanded(v => !v)} variant="sidebar"
                    isSimulationEnabled={isSimulationEnabled} simulationState={simulationState} newIncident={newIncident}
                    latestTurnScore={latestTurnScore} hasActiveIncident={hasActiveIncident}
                    isNpcExpanded={isDesktopSimOpen} onToggleNpc={() => setIsDesktopSimOpen(v => !v)} />
                )}

                <div className="relative flex-1 overflow-hidden">
                  {/* Mobile overlay header – unified bar: avatar + name/role + progress + elapsed + NPC toggle + end button */}
                  <div className="lg:hidden absolute top-0 left-0 right-0 z-20 bg-black/50 backdrop-blur-sm px-3 pt-2 pb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {/* Persona avatar thumbnail */}
                      <img
                        src={loadedImageUrl || toMediaUrl(activePersona.image || '') || `https://ui-avatars.com/api/?name=${encodeURIComponent(activePersona.name)}&background=6366f1&color=fff&size=64`}
                        alt={activePersona.name}
                        className="w-8 h-8 rounded-full object-cover object-top shrink-0 border border-white/20"
                      />
                      {/* Name + role/department */}
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-white text-xs font-semibold truncate leading-tight">{activePersona.name}</span>
                        {(activePersona.role || activePersona.department) && (
                          <span className="text-white/60 text-[10px] truncate leading-tight">
                            {[activePersona.role, activePersona.department].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </div>
                      {/* Progress % + turns remaining + elapsed time */}
                      <div
                        className={`text-[10px] font-medium shrink-0 text-right transition-colors duration-300 ${progressInfo.isAmber ? 'text-amber-300' : progressInfo.isGreen ? 'text-green-300' : 'text-white/70'}`}
                        data-testid="mobile-overlay-turn-counter"
                      >
                        {progressInfo.stage === 'complete' ? (
                          <span>{t('chat.conversationCompleted')}</span>
                        ) : (
                          <div className="flex flex-col items-end gap-0.5">
                            <span>{Math.round(progressPercentage)}% · {t('chat.turnsRemaining', { count: turnsLeft })}</span>
                            <span className="text-white/50 font-normal">{formatElapsedTime(elapsedTime)}</span>
                          </div>
                        )}
                      </div>
                      {/* NPC simulation toggle (integrated into header, only when simulation active) */}
                      {isSimulationEnabled && simulationState && (
                        <button
                          onClick={() => setIsMobileSimOpen(v => !v)}
                          aria-label={t('chat.npcStatusButton')}
                          className="relative shrink-0 flex items-center justify-center w-7 h-7 rounded-full bg-white/10 border border-white/20 text-white hover:bg-white/20 transition-colors"
                        >
                          <Brain className="h-3.5 w-3.5" />
                          {hasActiveIncident && (
                            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-orange-400 rounded-full animate-pulse" />
                          )}
                        </button>
                      )}
                      {/* End / feedback button */}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (progressInfo.stage === 'complete') {
                            handleFeedbackRequest();
                          } else {
                            handleEndRealtimeConversation();
                          }
                        }}
                        data-testid="button-end-conversation-mobile-overlay"
                        className={`shrink-0 text-xs h-7 px-2 border transition-all duration-300 ${progressInfo.endButtonClass}`}
                      >
                        {progressInfo.showWarningIcon && <i className="fas fa-exclamation-triangle mr-1 text-xs"></i>}
                        {progressInfo.isGreen && <i className="fas fa-chart-bar mr-1 text-xs"></i>}
                        {progressInfo.isAmber && !progressInfo.isGreen && <i className="fas fa-star mr-1 text-xs"></i>}
                        {t(progressInfo.endButtonLabelKey)}
                      </Button>
                    </div>
                    {/* Progress bar */}
                    <div className="bg-white/20 rounded-full h-1 overflow-hidden mt-1.5">
                      <div
                        className={`h-1 rounded-full transition-all duration-500 ${progressInfo.progressBarClass}`}
                        style={{ width: `${progressPercentage}%` }}
                      />
                    </div>
                  </div>

                  <CharacterPortrait loadedImageUrl={loadedImageUrl} personaName={activePersona.name} personaImage={activePersona.image}
                    currentEmotion={currentEmotion} isEmotionTransitioning={isEmotionTransitioning} isSessionEnding={isSessionEnding} />

                  {latestPersonaSwitch && (
                    <div className="absolute top-16 left-0 right-0 z-[14] flex justify-center animate-in slide-in-from-top-2 duration-300 px-4">
                      <div className="flex flex-col items-center gap-1 bg-indigo-600/90 backdrop-blur-sm text-white rounded-2xl px-5 py-2.5 shadow-xl max-w-sm w-full">
                        <div className="flex items-center gap-2 text-sm font-semibold">
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                          <span>{latestPersonaSwitch.name} joined</span>
                        </div>
                        {latestPersonaSwitch.transitionLine && (
                          <p className="text-xs text-indigo-100 italic text-center">"{latestPersonaSwitch.transitionLine}"</p>
                        )}
                      </div>
                    </div>
                  )}

                  {isBargeInFlash && (
                    <div className="absolute inset-0 pointer-events-none z-[13]"
                      style={{ backgroundColor: 'rgba(34, 197, 94, 0.35)', animation: 'bargeInFlash 0.4s ease-out forwards' }} />
                  )}

                  {realtimeVoice.isAISpeaking && !realtimeVoice.isReconnecting && (
                    <div className="absolute top-0 left-0 right-0 pointer-events-none z-[12]"
                      style={{ height: '45%', background: 'linear-gradient(to bottom, rgba(139, 92, 246, 0.22) 0%, rgba(99, 102, 241, 0.10) 40%, transparent 100%)', animation: 'beamPulse 2.5s ease-in-out infinite' }} />
                  )}
                  {realtimeVoice.isRecording && !realtimeVoice.isAISpeaking && (
                    <div className="absolute bottom-0 left-0 right-0 pointer-events-none z-[12]"
                      style={{ height: '40%', background: 'linear-gradient(to top, rgba(34, 197, 94, 0.20) 0%, rgba(16, 185, 129, 0.08) 40%, transparent 100%)', animation: 'beamPulse 2s ease-in-out infinite' }} />
                  )}
                  <AISpeechParticleLayer amplitude={realtimeVoice.audioAmplitude} isActive={realtimeVoice.isAISpeaking && !realtimeVoice.isReconnecting} />
                  <UserSpeechParticleLayer amplitude={realtimeVoice.userAudioAmplitude} isActive={realtimeVoice.isRecording && !realtimeVoice.isAISpeaking} />

                  {hasNoPersonaImages && (
                    <div className="absolute inset-0 flex items-center justify-center z-5">
                      <div className="bg-white/95 backdrop-blur-sm rounded-2xl px-8 py-6 shadow-xl max-w-md text-center">
                        <div className="text-4xl mb-4">🖼️</div>
                        <h3 className="text-lg font-semibold text-slate-800 mb-2">{t('chat.personaImageNotFound')}</h3>
                        <p className="text-sm text-slate-600">{t('chat.contactOperator')}</p>
                      </div>
                    </div>
                  )}

                  {!isPersonaX && (
                    <GoalsSidebar scenario={scenario} personaName={persona.name} personaDept={persona.department} personaRole={persona.role}
                      latestEmotion={latestAiMessage?.emotion} elapsedTime={elapsedTime} isAdmin={user?.role === 'admin'}
                      isGoalsExpanded={isGoalsExpanded} onToggleGoals={() => setIsGoalsExpanded(v => !v)} variant="overlay" />
                  )}

                  <TranscriptPanel isOpen={isTranscriptPanelOpen} onToggle={() => setIsTranscriptPanelOpen(v => !v)}
                    onClose={() => setIsTranscriptPanelOpen(false)} messages={localMessages}
                    pendingAiMessage={pendingAiMessage} pendingUserMessage={pendingUserMessage}
                    pendingUserText={pendingUserText} personaName={activePersona.name}
                    personaSwitchEvents={personaSwitchEvents} />


                  {/* Desktop NPC status toggle button */}
                  {isSimulationEnabled && simulationState && (
                    <div className="hidden lg:flex absolute bottom-24 left-4 z-20">
                      {hasActiveIncident && !isDesktopSimOpen && (
                        <span className="absolute inset-0 rounded-full animate-ping bg-orange-400 opacity-40 pointer-events-none" />
                      )}
                      <button
                        onClick={() => setIsDesktopSimOpen(v => !v)}
                        className={`relative flex items-center gap-1.5 bg-black/60 backdrop-blur-sm text-white text-xs px-2.5 py-1.5 rounded-full shadow-lg transition-colors ${hasActiveIncident && !isDesktopSimOpen ? 'border-2 border-orange-400' : 'border border-white/20'}`}
                      >
                        <Brain className="h-3.5 w-3.5" />
                        <span>{isDesktopSimOpen ? t('chat.npcStatusHide', { defaultValue: 'Hide NPC Panel' }) : t('chat.npcStatusButton')}</span>
                        {hasActiveIncident && <span className="w-2 h-2 bg-orange-400 rounded-full animate-pulse shrink-0" />}
                        {incidentCount > 0 && !isDesktopSimOpen && (
                          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-orange-500 text-white text-[10px] font-bold leading-none px-1 shadow-md">
                            {incidentCount > 99 ? '99+' : incidentCount}
                          </span>
                        )}
                      </button>
                    </div>
                  )}

                  <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-20 w-full max-w-4xl lg:max-w-6xl xl:max-w-[90%] px-4">
                    <Card className="rounded-2xl overflow-hidden text-card-foreground backdrop-blur-sm shadow-xl border border-white/10 bg-[#ffffff9c]">
                      {inputMode === 'realtime-voice' ? (
                        <>
                          <div className="p-4 bg-[#ffffff9c]">
                            <ChatInputBar userInput={userInput} onUserInputChange={setUserInput} onSendMessage={handleSendMessage}
                              onVoiceInput={handleVoiceInput} onSkipTurn={handleSkipTurn} isLoading={isLoading}
                              isRecording={isRecording} speechSupported={speechSupported}
                              mode="realtime-voice" realtimeVoiceProps={rvBarProps} />
                          </div>
                          {isSwitchingMode && (
                            <div className="border-t border-slate-200/30 px-4 py-2 text-center">
                              <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
                                <div className="w-3 h-3 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                                <span>대화 내용 저장 중...</span>
                              </div>
                            </div>
                          )}
                          {isSilenceIdle && realtimeVoice.status === 'connected' && !realtimeVoice.isWaitingForGreeting && !realtimeVoice.isRecording && !realtimeVoice.isAISpeaking && (
                            <div className="border-t border-slate-200/30 px-4 py-2 text-center">
                              <p className="text-xs text-slate-400" style={{ animation: 'silenceBreathe 3s ease-in-out infinite' }}>🎤 말씀해 주세요...</p>
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="p-4 bg-[#ffffff9c]">
                            {personaSwitchEvents.length > 0 && (() => {
                              const latest = personaSwitchEvents[personaSwitchEvents.length - 1];
                              return (
                                <div className="mb-3">
                                  <PersonaSwitchCard event={latest} />
                                </div>
                              );
                            })()}
                            {isLoading ? (
                              <div className="flex items-center justify-center space-x-2" data-testid="status-typing">
                                <div className="w-3 h-3 bg-purple-400 rounded-full animate-bounce"></div>
                                <div className="w-3 h-3 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }}></div>
                                <div className="w-3 h-3 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }}></div>
                                <span className="ml-2 text-slate-600">{t('chat.generatingConversation')}</span>
                              </div>
                            ) : latestAiMessage ? (
                              <div className="space-y-3">
                                <p className="text-slate-800 leading-relaxed text-base" data-testid="text-ai-line">{latestAiMessage.message}</p>
                                {inputMode === 'tts' && (
                                  <div className="flex justify-end gap-2 pt-1">
                                    <Button size="sm" variant="outline" onClick={() => speakText(latestAiMessage.message, false, latestAiMessage.emotion, activePersona.voiceId ?? undefined, (activePersona.gender as 'male' | 'female') || undefined)}
                                      className="text-xs text-blue-600 border-blue-200 hover:bg-blue-50" data-testid="button-replay-tts">
                                      <i className="fas fa-volume-up mr-1"></i>{t('chat.replay')}
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={stopSpeaking}
                                      className="text-xs text-slate-600 border-slate-200 hover:bg-slate-50" data-testid="button-stop-tts">
                                      <i className="fas fa-stop mr-1"></i>{t('chat.stop')}
                                    </Button>
                                  </div>
                                )}
                                {!showInputMode && (
                                  <div className="flex justify-end pt-2">
                                    <Button onClick={() => setShowInputMode(true)} className="bg-purple-600 hover:bg-purple-700 text-white" data-testid="button-start-chat-inline" size="sm">
                                      <i className="fas fa-comment mr-1"></i>{t('chat.startChat')}
                                    </Button>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="text-center text-slate-600 py-4">
                                <i className="fas fa-comment-dots text-2xl text-purple-400 mb-2"></i>
                                <p>{t('chat.startConversationHint')}</p>
                                <div className="mt-4">
                                  <Button onClick={() => setShowInputMode(true)} className="bg-purple-600 hover:bg-purple-700 text-white" data-testid="button-start-chat-first" size="sm">
                                    <i className="fas fa-comment mr-2"></i>{t('chat.startChat')}
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                          {showInputMode && conversation.turnCount < MAX_TURNS && (
                            <div className="border-t border-slate-200/30 p-4">
                              <div className="flex items-start space-x-3">
                                <div className="flex-1">
                                  <Textarea value={userInput} onChange={(e) => setUserInput(e.target.value)}
                                    placeholder={`${t('chat.messageInputPlaceholder')}${!speechSupported ? ' - ' + t('chat.voiceNotSupported') : ''}`}
                                    maxLength={200} rows={2} className="resize-none text-sm" disabled={isLoading} data-testid="input-message-text" />
                                  <div className="text-xs text-slate-500 mt-1">{userInput.length}/200</div>
                                </div>
                                <div className="grid grid-cols-2 gap-1 w-20">
                                  <Button onClick={handleSendMessage} disabled={!userInput.trim() || isLoading} className="bg-purple-600 hover:bg-purple-700 text-white" size="sm" data-testid="button-send-message-text"><i className="fas fa-paper-plane"></i></Button>
                                  <Button variant="outline" size="sm" onClick={handleVoiceInput} disabled={isLoading || !speechSupported}
                                    className={`${isRecording ? 'bg-red-50 border-red-300 text-red-700 animate-pulse' : ''} ${!speechSupported ? 'opacity-50' : ''}`}
                                    data-testid="button-voice-input-text" title={!speechSupported ? t('voice.notSupported') : isRecording ? t('chat.stopRecording') : t('chat.startRecording')}>
                                    <i className={`fas ${isRecording ? 'fa-stop' : 'fa-microphone'} ${isRecording ? 'text-red-500' : ''}`}></i>
                                  </Button>
                                  <Button variant="outline" size="sm" onClick={handleSkipTurn} disabled={isLoading} data-testid="button-skip-turn-text" className="col-span-2">Skip</Button>
                                </div>
                              </div>
                            </div>
                          )}
                          {conversation.turnCount >= MAX_TURNS && (
                            <div className="border-t border-slate-200/30 p-4 text-center space-y-3">
                              <div className="text-sm font-medium text-slate-700">{t('chat.conversationComplete', { count: conversation.turnCount })}</div>
                              <div className="flex justify-center space-x-3">
                                {!isPersonaMode && onPersonaChange && <Button onClick={onPersonaChange} className="bg-blue-600 hover:bg-blue-700 text-white" data-testid="button-change-persona" size="sm"><i className="fas fa-user-friends mr-1"></i>{t('chat.chatWithAnother')}</Button>}
                                {!isPersonaMode && <Button onClick={handleGoToFeedback} className="bg-purple-600 hover:bg-purple-700 text-white" data-testid="button-final-feedback" size="sm"><i className="fas fa-chart-bar mr-1"></i>{t('chat.finalFeedback')}</Button>}
                                <Button onClick={onExit} variant="outline" data-testid="button-exit-completed" size="sm"><i className={`fas ${isPersonaMode ? 'fa-sign-out-alt' : 'fa-home'} mr-1`}></i>{isPersonaMode ? '대화방 나가기' : t('chat.goHome')}</Button>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                      {/* Mobile stage-aware end button */}
                      {!isPersonaMode && conversation.turnCount < MAX_TURNS && (
                        <div className="border-t border-slate-200/30 px-4 py-2 flex items-center justify-between gap-2">
                          <div className={`text-xs font-medium transition-colors duration-300 ${progressInfo.isAmber ? 'text-amber-600' : progressInfo.isGreen ? 'text-green-600' : 'text-slate-400'}`}>
                            {progressInfo.stage === 'complete'
                              ? t('chat.conversationCompleted')
                              : (
                                <>
                                  <span>{Math.round(progressPercentage)}%</span>
                                  <span className="mx-1 opacity-50">·</span>
                                  <span>{t('chat.turnsRemaining', { count: turnsLeft })}</span>
                                </>
                              )}
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              if (progressInfo.stage === 'complete') {
                                handleFeedbackRequest();
                              } else {
                                handleEndRealtimeConversation();
                              }
                            }}
                            data-testid="button-end-conversation-mobile"
                            className={`shrink-0 text-xs h-7 px-2 border transition-all duration-300 ${progressInfo.endButtonClass}`}
                          >
                            {progressInfo.showWarningIcon && <i className="fas fa-exclamation-triangle mr-1 text-xs"></i>}
                            {progressInfo.isGreen && <i className="fas fa-chart-bar mr-1 text-xs"></i>}
                            {progressInfo.isAmber && !progressInfo.isGreen && <i className="fas fa-star mr-1 text-xs"></i>}
                            {progressInfo.showBadge && <span className="mr-1 bg-slate-100 rounded px-1 text-xs font-mono">{currentTurn}/{targetTurns}</span>}
                            {t(progressInfo.endButtonLabelKey)}
                          </Button>
                        </div>
                      )}
                    </Card>
                  </div>
                </div>
            </div>
          </div>
        </div>

        {/* Mobile floating incident alert (shown when panel is closed) */}
        {mobileIncidentAlert && !isMobileSimOpen && (
          <div className="lg:hidden fixed top-4 left-4 right-4 z-[100] animate-in slide-in-from-top-3 duration-300">
            <div
              className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm shadow-xl backdrop-blur-sm ${
                mobileIncidentAlert.severity === 'high'
                  ? 'border-red-500 bg-red-500/90 text-white'
                  : mobileIncidentAlert.severity === 'medium'
                  ? 'border-orange-500 bg-orange-500/90 text-white'
                  : 'border-blue-500 bg-blue-500/90 text-white'
              }`}
            >
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="font-semibold capitalize mr-1">[{mobileIncidentAlert.severity.toUpperCase()}]</span>
                <span className="leading-snug">{mobileIncidentAlert.message}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 ml-1">
                <button
                  onClick={() => setIsMobileSimOpen(true)}
                  className="text-white/90 underline underline-offset-2 text-xs font-medium hover:text-white"
                >
                  {t('chat.npcStatusButton')}
                </button>
                <button
                  onClick={() => {
                    setMobileIncidentAlert(null);
                    if (mobileIncidentDismissTimerRef.current) {
                      clearTimeout(mobileIncidentDismissTimerRef.current);
                      mobileIncidentDismissTimerRef.current = null;
                    }
                  }}
                  className="text-white/70 hover:text-white ml-1"
                  aria-label="Dismiss"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Mobile simulation bottom sheet */}
        {isSimulationEnabled && simulationState && (
          <>
            {isMobileSimOpen && (
              <div
                className="lg:hidden fixed inset-0 z-[98] bg-black/40"
                onClick={() => setIsMobileSimOpen(false)}
              />
            )}
            <div
              className={`lg:hidden fixed bottom-0 left-0 right-0 z-[99] ${simSheetDragging ? '' : 'transition-transform duration-300 ease-in-out'} ${isMobileSimOpen ? 'translate-y-0' : 'translate-y-full'}`}
              style={isMobileSimOpen && simSheetDragY > 0 ? { transform: `translateY(${simSheetDragY}px)` } : undefined}
              onTouchMove={(e) => {
                if (!simSheetDragActive.current) return;
                const delta = e.touches[0].clientY - simSheetTouchStartY.current;
                if (delta > 0) setSimSheetDragY(delta);
              }}
              onTouchEnd={() => {
                if (!simSheetDragActive.current) return;
                simSheetDragActive.current = false;
                setSimSheetDragging(false);
                if (simSheetDragY > 100) {
                  setIsMobileSimOpen(false);
                }
                setSimSheetDragY(0);
              }}
            >
              <div className="bg-background rounded-t-2xl shadow-2xl border-t border-border overflow-y-auto max-h-[65vh]">
                {/* Drag handle — touch here to swipe down and dismiss */}
                <div
                  className="flex justify-center pt-2 pb-1 touch-none"
                  onTouchStart={(e) => {
                    simSheetTouchStartY.current = e.touches[0].clientY;
                    simSheetDragActive.current = true;
                    setSimSheetDragging(true);
                  }}
                >
                  <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
                </div>
                <div
                  className="flex items-center justify-between px-4 pt-2 pb-2 border-b border-border/50 sticky top-0 bg-background z-10"
                  onTouchStart={(e) => {
                    simSheetTouchStartY.current = e.touches[0].clientY;
                    simSheetDragActive.current = true;
                    setSimSheetDragging(true);
                  }}
                >
                  <div className="flex items-center gap-2.5">
                    {activePersona.image ? (
                      <img
                        src={toMediaUrl(activePersona.image)}
                        alt={activePersona.name}
                        className="h-8 w-8 rounded-full object-cover border border-border flex-shrink-0"
                      />
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0 border border-border">
                        <span className="text-xs font-semibold text-muted-foreground">
                          {activePersona.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                    )}
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-semibold leading-tight truncate">{activePersona.name}</span>
                      <div className="flex items-center gap-1">
                        <Brain className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                        <span className="text-xs text-muted-foreground">{t('chat.npcStatusPanel')}</span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setIsMobileSimOpen(false)}
                    aria-label={t('common.close')}
                    className="p-1.5 rounded-full hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring text-muted-foreground flex-shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="px-3 py-3">
                  <SimulationPanel
                    state={simulationState}
                    newIncident={newIncident}
                    latestTurnScore={latestTurnScore}
                    hasActiveIncident={hasActiveIncident}
                  />
                </div>
              </div>
            </div>
          </>
        )}

        <AlertDialog open={showAlmostDoneDialog} onOpenChange={(open) => { if (!open) handleAlmostDoneKeepGoing(); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <i className="fas fa-star text-amber-400"></i>
                {t('chat.almostDoneTitle')}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t('chat.almostDoneDesc', { current: currentTurn, target: targetTurns })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="mt-2">
              <div className="w-full bg-slate-100 rounded-full h-2">
                <div
                  className="bg-amber-400 rounded-full h-2 transition-all duration-300"
                  style={{ width: `${progressPercentage}%` }}
                />
              </div>
              <p className="text-xs text-slate-500 mt-1 text-right">{currentTurn} / {targetTurns}</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end mt-4">
              <Button variant="outline" onClick={handleAlmostDoneConfirmExit} data-testid="button-almost-done-exit" className="border-slate-300 text-slate-600 hover:bg-slate-50">
                {t('chat.exitAnyway')}
              </Button>
              <Button onClick={handleAlmostDoneKeepGoing} data-testid="button-almost-done-keep-going" className="bg-purple-600 hover:bg-purple-700 text-white">
                <i className="fas fa-play mr-1"></i>{t('chat.keepGoing')}
              </Button>
            </div>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={showEndConversationDialog} onOpenChange={setShowEndConversationDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('chat.endConversationTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('chat.endConversationDesc')}<br />{t('chat.endConversationDesc2')}</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-between mt-4">
              <Button variant="outline" onClick={handleResetConversation} data-testid="button-reset-conversation" className="border-orange-300 text-orange-600 hover:bg-orange-50">
                <i className="fas fa-redo mr-1"></i>{t('chat.resetConversation')}
              </Button>
              <div className="flex gap-2 justify-end">
                <AlertDialogCancel data-testid="button-cancel-end-conversation">{t('chat.cancel')}</AlertDialogCancel>
                <AlertDialogAction onClick={confirmEndConversation} data-testid="button-confirm-end-conversation" className="bg-purple-600 hover:bg-purple-700">{t('chat.yesGenerateFeedback')}</AlertDialogAction>
              </div>
            </div>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </>
  );
}
