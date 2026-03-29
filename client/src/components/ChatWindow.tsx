import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { toMediaUrl } from "@/lib/mediaUrl";
import { Button } from "@/components/ui/button";
import { MessageSquare, User } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { ComplexScenario, ScenarioPersona } from "@/lib/scenario-system";
import type { Conversation } from "@shared/schema";
import { useRealtimeVoice } from "@/hooks/useRealtimeVoice";
import { AISpeechParticleLayer } from "@/components/AISpeechParticleLayer";
import { UserSpeechParticleLayer } from "@/components/UserSpeechParticleLayer";

import { useConversationTimer, formatElapsedTime } from "@/hooks/chat/useConversationTimer";
import { useVoiceRecording } from "@/hooks/chat/useVoiceRecording";
import { useEmotionState, emotionEmojis } from "@/hooks/chat/useEmotionState";
import { useChatMessages } from "@/hooks/chat/useChatMessages";
import { useChatSession } from "@/hooks/chat/useChatSession";
import { useTTS } from "@/hooks/chat/useTTS";

import { MessageList } from "@/components/chat/MessageList";
import { TranscriptPanel } from "@/components/chat/TranscriptPanel";
import { TopMenuPanel } from "@/components/chat/TopMenuPanel";
import { CharacterPortrait } from "@/components/chat/CharacterPortrait";
import { ChatInputBar } from "@/components/chat/ChatInputBar";
import { GoalsSidebar } from "@/components/chat/GoalsSidebar";
import { MessengerInfoCards } from "@/components/chat/MessengerInfoCards";

const MAX_TURNS = 999;

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
}

export default function ChatWindow({ scenario, persona, conversationId, onChatComplete, onExit, onPersonaChange, onReady, onConversationEnding, isPersonaMode = false }: ChatWindowProps) {
  const [userInput, setUserInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [inputMode, setInputMode] = useState<'text' | 'tts' | 'realtime-voice'>('realtime-voice');
  const [chatMode, setChatMode] = useState<'messenger' | 'character'>('character');
  const [showInputMode, setShowInputMode] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isGoalsExpanded, setIsGoalsExpanded] = useState(false);
  const [showMicPrompt, setShowMicPrompt] = useState(false);
  const [isInputExpanded, setIsInputExpanded] = useState(false);
  const [isBargeInFlash, setIsBargeInFlash] = useState(false);
  const [isTranscriptPanelOpen, setIsTranscriptPanelOpen] = useState(false);
  const [isTopMenuOpen, setIsTopMenuOpen] = useState(false);
  const [isSilenceIdle, setIsSilenceIdle] = useState(false);

  const isAISpeakingForBargeInRef = useRef(false);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasUserSpokenRef = useRef(false);

  const { toast } = useToast();
  const { user } = useAuth();
  const { t } = useTranslation();

  const getPersonaGender = (): 'male' | 'female' => persona.gender ?? 'male';

  const { localMessages, setLocalMessages, pendingAiMessage, setPendingAiMessage,
    pendingUserMessage, setPendingUserMessage, pendingUserText, setPendingUserText,
    messagesEndRef, sendMessageMutation } = useChatMessages({ conversationId, serverMessages: undefined });

  const { currentEmotion, setCurrentEmotion, isEmotionTransitioning, setIsEmotionTransitioning,
    loadedImageUrl, isInitialLoading, isOverlayFading, hasNoPersonaImages,
    getCharacterImage, preloadImage } = useEmotionState({
    persona: { id: persona.id, mbti: persona.mbti, gender: persona.gender, name: persona.name, image: persona.image, expressions: persona.expressions },
    conversationId, onReady,
  });

  const { speakText, stopSpeaking, cleanup: cleanupTTS } = useTTS({
    personaId: persona.id,
    personaGender: getPersonaGender(),
    inputMode,
  });

  const realtimeVoice = useRealtimeVoice({
    conversationId, scenarioId: scenario.id, personaId: persona.id, enabled: false,
    onMessageComplete: (message, emotion, emotionReason) => {
      setPendingAiMessage(false);
      isAISpeakingForBargeInRef.current = false;
      if (emotion) { setIsEmotionTransitioning(true); setCurrentEmotion(emotion); setTimeout(() => setIsEmotionTransitioning(false), 150); }
      setLocalMessages(prev => [...prev, { sender: 'ai', message, timestamp: new Date().toISOString(), emotion: emotion || '중립', emotionReason: emotionReason || '' }]);
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
      setPendingAiMessage(false); setPendingUserMessage(false); setPendingUserText(''); setInputMode('text');
    },
  });

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

  const { isSessionEnding, showEndConversationDialog, setShowEndConversationDialog, handleGoToFeedback,
    handleEndRealtimeConversation, confirmEndConversation, handleResetConversation } = useChatSession({
    conversationId, localMessages, chatMode, isPersonaMode, onChatComplete, onExit, onConversationEnding,
    disconnectVoice: realtimeVoice.disconnect, resetPhase: realtimeVoice.resetPhase,
    setLocalMessages, setConversationStartTime, setElapsedTime,
    showMicPromptReset: () => { hasUserSpokenRef.current = false; setShowMicPrompt(false); },
  });

  useEffect(() => { if (conversation?.messages) setLocalMessages(conversation.messages); }, [conversation?.messages]);

  useEffect(() => { if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' }); },
    [localMessages, pendingAiMessage, pendingUserMessage, pendingUserText]);

  useEffect(() => { return () => { cleanupTTS(); cleanupVoiceRecording(); }; }, []);

  useEffect(() => { isAISpeakingForBargeInRef.current = realtimeVoice.isAISpeaking; }, [realtimeVoice.isAISpeaking]);

  useEffect(() => {
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    setIsSilenceIdle(false);
    const isIdle = realtimeVoice.status === 'connected' && !realtimeVoice.isAISpeaking && !realtimeVoice.isRecording && !realtimeVoice.isWaitingForGreeting && !pendingAiMessage && !pendingUserMessage;
    if (isIdle && chatMode === 'character') silenceTimerRef.current = setTimeout(() => setIsSilenceIdle(true), 5000);
    return () => { if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current); };
  }, [realtimeVoice.status, realtimeVoice.isAISpeaking, realtimeVoice.isRecording, realtimeVoice.isWaitingForGreeting, pendingAiMessage, pendingUserMessage, chatMode]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Enter" && e.ctrlKey) handleSendMessage(); };
    document.addEventListener("keypress", handler); return () => document.removeEventListener("keypress", handler);
  }, [userInput, isLoading]);

  const latestAiMessage = localMessages.slice().reverse().find(msg => msg.sender === 'ai');

  useEffect(() => {
    const newEmotion = latestAiMessage?.emotion || '중립';
    if (newEmotion !== currentEmotion) {
      if (chatMode === 'character') {
        setIsEmotionTransitioning(true); setCurrentEmotion(newEmotion);
        const newUrl = getCharacterImage(newEmotion); if (newUrl) preloadImage(newUrl);
      } else { setCurrentEmotion(newEmotion); }
    }
    if (inputMode === 'tts' && latestAiMessage?.message) {
      speakText(latestAiMessage.message, true, latestAiMessage.emotion);
    }
  }, [latestAiMessage?.message, latestAiMessage?.emotion, currentEmotion, chatMode, inputMode]);

  const handleSendMessage = () => {
    const message = userInput.trim(); if (!message || isLoading) return;
    if (inputMode === 'realtime-voice' && realtimeVoice.status === 'connected') { setUserInput(""); realtimeVoice.sendTextMessage(message); return; }
    setLocalMessages(prev => [...prev, { sender: 'user', message, timestamp: new Date().toISOString() }]);
    setIsLoading(true); setUserInput(""); setShowInputMode(false);
    sendMessageMutation.mutate(message, { onSuccess: () => setIsLoading(false), onError: () => setIsLoading(false) });
  };

  const handleSkipTurn = () => { if (isLoading) return; setIsLoading(true); setShowInputMode(false); sendMessageMutation.mutate("", { onSuccess: () => setIsLoading(false), onError: () => setIsLoading(false) }); };
  const handleVoiceInput = () => { if (isRecording) stopRecording(); else startRecording(); };
  const handleCharacterModeTransition = () => { setIsTransitioning(true); setTimeout(() => { setChatMode('character'); setTimeout(() => setIsTransitioning(false), 300); }, 200); };

  const progressPercentage = conversation ? (conversation.turnCount / MAX_TURNS) * 100 : 0;

  if (error) return (
    <div className="text-center py-8">
      <p className="text-red-600">대화를 불러올 수 없습니다.</p>
      <Button onClick={onExit} className="mt-4">시나리오 선택으로 돌아가기</Button>
    </div>
  );
  if (!conversation) return <div className="text-center py-8">로딩 중...</div>;

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
    personaDept: persona.department, personaRole: persona.role, personaName: persona.name, userName: user?.name,
  };

  return (
    <>
      {chatMode === 'character' && <TopMenuPanel isOpen={isTopMenuOpen} onToggle={() => setIsTopMenuOpen(v => !v)} onClose={() => setIsTopMenuOpen(false)} />}

      <div className={`chat-window relative${chatMode === 'messenger' ? ' flex flex-col lg:flex-row gap-4 lg:items-start' : ''}`}>
        {isInitialLoading && (
          <div className={`fixed inset-0 z-50 bg-black flex items-center justify-center transition-opacity duration-500 ${isOverlayFading ? 'opacity-0' : 'opacity-100'}`} data-testid="chat-loading-overlay">
            <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin" />
          </div>
        )}

        <div className={`bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden${chatMode === 'messenger' ? ' flex flex-col h-[calc(100vh-8rem)] lg:flex-1 lg:min-w-0' : ''}`}>
          {/* Chat Header */}
          <div className="bg-gradient-to-r from-corporate-600 to-corporate-700 px-4 sm:px-6 py-3 sm:py-4 text-white">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center space-x-3 sm:space-x-4 min-w-0 flex-1">
                <div className="flex-shrink-0" data-testid="chat-header-persona-image">
                  <div className="w-14 h-14 sm:w-12 sm:h-12 rounded-xl border-2 border-white/30 overflow-hidden bg-gradient-to-br from-slate-100 to-slate-200 shadow-lg">
                    <img src={getCharacterImage(currentEmotion) || toMediaUrl(persona.image)} alt={persona.name}
                      className="w-full h-full object-cover object-[center_15%] transition-all duration-200 scale-110"
                      onError={(e) => { (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(persona.name)}&background=6366f1&color=fff&size=64`; }} />
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-left w-full" data-testid="chat-header-persona-info">
                    <h3 className="text-base sm:text-lg font-semibold truncate">{persona.name} ({persona.department})</h3>
                    <p className="text-blue-100 text-xs sm:text-sm truncate">{scenario.title}</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center">
                <div className="flex items-center bg-white/10 rounded-lg p-0.5">
                  <button onClick={() => { if (!isTransitioning && chatMode === 'character') setChatMode('messenger'); }}
                    className={`p-2 rounded-md transition-all duration-200 ${chatMode === 'messenger' ? 'bg-white text-corporate-600 shadow-sm' : 'text-white/70 hover:text-white hover:bg-white/10'}`}
                    disabled={isTransitioning || chatMode === 'messenger'} data-testid="button-messenger-mode" title="메신저 모드">
                    <MessageSquare className="w-4 h-4" />
                  </button>
                  <button onClick={() => { if (!isTransitioning && chatMode === 'messenger') handleCharacterModeTransition(); }}
                    className={`p-2 rounded-md transition-all duration-200 ${chatMode === 'character' ? 'bg-white text-corporate-600 shadow-sm' : 'text-white/70 hover:text-white hover:bg-white/10'}`}
                    disabled={isTransitioning || chatMode === 'character'} data-testid="button-character-mode" title="캐릭터 모드">
                    <User className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
            <div className="mt-4 flex items-center space-x-3">
              <div className="flex-1 bg-white/20 rounded-full h-2">
                <div className="bg-white rounded-full h-2 transition-all duration-300" style={{ width: `${progressPercentage}%` }}></div>
              </div>
              <div className="flex items-center space-x-3 text-white/90 text-sm">
                <div className="flex items-center space-x-1"><i className="fas fa-clock text-xs"></i><span data-testid="elapsed-time">{formatElapsedTime(elapsedTime)}</span></div>
                {chatMode === 'messenger' && <div className="flex items-center space-x-1"><i className="fas fa-tasks text-xs"></i><span>{conversation.turnCount}/{MAX_TURNS}</span></div>}
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
            {chatMode === 'messenger' && (
              <>
                <MessageList messages={localMessages} pendingAiMessage={pendingAiMessage} pendingUserMessage={pendingUserMessage}
                  pendingUserText={pendingUserText} isLoading={isLoading} personaName={persona.name} personaImage={persona.image}
                  currentEmotion={currentEmotion} isAdmin={user?.role === 'admin'} getCharacterImage={getCharacterImage} messagesEndRef={messagesEndRef} />
                <div className="border-t border-slate-100 bg-white shadow-[0_-4px_20px_-8px_rgba(0,0,0,0.1)]">
                  {isPersonaMode && conversation.turnCount < MAX_TURNS && (
                    <div className="flex justify-end px-4 pt-2 pb-1 border-b border-slate-50">
                      <button onClick={onExit} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors">
                        <i className="fas fa-sign-out-alt"></i>대화방 나가기
                      </button>
                    </div>
                  )}
                  <div className="p-6">
                    {conversation.turnCount >= MAX_TURNS ? (
                      <div className="text-center space-y-4">
                        <div className="text-lg font-semibold text-slate-700">대화가 완료되었습니다!</div>
                        <div className="text-sm text-slate-500 space-y-1"><div>총 {conversation.turnCount}턴의 대화를 나누었습니다.</div><div>대화 시간: {formatElapsedTime(elapsedTime)}</div></div>
                        <div className="flex justify-center space-x-4">
                          {!isPersonaMode && <Button onClick={handleGoToFeedback} className="bg-corporate-600 hover:bg-corporate-700" data-testid="button-final-feedback"><i className="fas fa-chart-bar mr-2"></i>최종 피드백 보기</Button>}
                          <Button onClick={onExit} variant="outline" data-testid="button-exit-completed"><i className={`fas ${isPersonaMode ? 'fa-sign-out-alt' : 'fa-home'} mr-2`}></i>{isPersonaMode ? '대화방 나가기' : '홈으로 이동'}</Button>
                        </div>
                      </div>
                    ) : (
                      <ChatInputBar userInput={userInput} onUserInputChange={setUserInput} onSendMessage={handleSendMessage}
                        onVoiceInput={handleVoiceInput} onSkipTurn={handleSkipTurn} isLoading={isLoading}
                        isRecording={isRecording} speechSupported={speechSupported}
                        mode={inputMode === 'realtime-voice' ? 'realtime-voice' : 'text'}
                        realtimeVoiceProps={inputMode === 'realtime-voice' ? rvBarProps : undefined} variant="messenger" />
                    )}
                  </div>
                </div>
              </>
            )}

            {chatMode === 'character' && (
              <div className="fixed inset-0 z-10 flex" data-testid="character-mode">
                <GoalsSidebar scenario={scenario} personaName={persona.name} personaDept={persona.department} personaRole={persona.role}
                  latestEmotion={latestAiMessage?.emotion} elapsedTime={elapsedTime} isAdmin={user?.role === 'admin'}
                  isGoalsExpanded={isGoalsExpanded} onToggleGoals={() => setIsGoalsExpanded(v => !v)} variant="sidebar" />

                <div className="relative flex-1 overflow-hidden">
                  <CharacterPortrait loadedImageUrl={loadedImageUrl} personaName={persona.name} personaImage={persona.image}
                    currentEmotion={currentEmotion} isEmotionTransitioning={isEmotionTransitioning} isSessionEnding={isSessionEnding} />

                  {isBargeInFlash && (
                    <div className="absolute inset-0 pointer-events-none z-[13]"
                      style={{ backgroundColor: 'rgba(34, 197, 94, 0.35)', animation: 'bargeInFlash 0.4s ease-out forwards' }} />
                  )}

                  {realtimeVoice.isAISpeaking && (
                    <div className="absolute top-0 left-0 right-0 pointer-events-none z-[12]"
                      style={{ height: '45%', background: 'linear-gradient(to bottom, rgba(139, 92, 246, 0.22) 0%, rgba(99, 102, 241, 0.10) 40%, transparent 100%)', animation: 'beamPulse 2.5s ease-in-out infinite' }} />
                  )}
                  {realtimeVoice.isRecording && !realtimeVoice.isAISpeaking && (
                    <div className="absolute bottom-0 left-0 right-0 pointer-events-none z-[12]"
                      style={{ height: '40%', background: 'linear-gradient(to top, rgba(34, 197, 94, 0.20) 0%, rgba(16, 185, 129, 0.08) 40%, transparent 100%)', animation: 'beamPulse 2s ease-in-out infinite' }} />
                  )}
                  <AISpeechParticleLayer amplitude={realtimeVoice.audioAmplitude} isActive={realtimeVoice.isAISpeaking} />
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

                  <GoalsSidebar scenario={scenario} personaName={persona.name} personaDept={persona.department} personaRole={persona.role}
                    latestEmotion={latestAiMessage?.emotion} elapsedTime={elapsedTime} isAdmin={user?.role === 'admin'}
                    isGoalsExpanded={isGoalsExpanded} onToggleGoals={() => setIsGoalsExpanded(v => !v)} variant="overlay" />

                  <div className="absolute top-4 right-4 z-20 flex items-center">
                    <div className="flex items-center bg-white/20 backdrop-blur-sm rounded-lg p-0.5 shadow-lg">
                      <button onClick={() => setChatMode('messenger')} className="p-2 rounded-md transition-all duration-200 text-white/80 hover:text-white hover:bg-white/20"
                        disabled={isTransitioning} data-testid="button-messenger-mode" title={t('chat.messengerMode')}><MessageSquare className="w-4 h-4" /></button>
                      <button className="p-2 rounded-md transition-all duration-200 bg-white text-corporate-600 shadow-sm"
                        disabled={true} data-testid="button-character-mode" title={t('chat.characterMode')}><User className="w-4 h-4" /></button>
                    </div>
                  </div>

                  <TranscriptPanel isOpen={isTranscriptPanelOpen} onToggle={() => setIsTranscriptPanelOpen(v => !v)}
                    onClose={() => setIsTranscriptPanelOpen(false)} messages={localMessages}
                    pendingAiMessage={pendingAiMessage} pendingUserMessage={pendingUserMessage}
                    pendingUserText={pendingUserText} personaName={persona.name} />

                  <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-20 w-full max-w-4xl lg:max-w-6xl xl:max-w-[90%] px-4">
                    <Card className="rounded-2xl overflow-hidden text-card-foreground backdrop-blur-sm shadow-xl border border-white/10 bg-[#ffffff9c]">
                      {inputMode === 'realtime-voice' ? (
                        <>
                          <div className="p-4 bg-[#ffffff9c]">
                            <ChatInputBar userInput={userInput} onUserInputChange={setUserInput} onSendMessage={handleSendMessage}
                              onVoiceInput={handleVoiceInput} onSkipTurn={handleSkipTurn} isLoading={isLoading}
                              isRecording={isRecording} speechSupported={speechSupported}
                              mode="realtime-voice" realtimeVoiceProps={rvBarProps} variant="character" />
                          </div>
                          {isSilenceIdle && realtimeVoice.status === 'connected' && !realtimeVoice.isWaitingForGreeting && !realtimeVoice.isRecording && !realtimeVoice.isAISpeaking && (
                            <div className="border-t border-slate-200/30 px-4 py-2 text-center">
                              <p className="text-xs text-slate-400" style={{ animation: 'silenceBreathe 3s ease-in-out infinite' }}>🎤 말씀해 주세요...</p>
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="p-4 bg-[#ffffff9c]">
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
                                    <Button size="sm" variant="outline" onClick={() => speakText(latestAiMessage.message, false, latestAiMessage.emotion)}
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
                                    maxLength={200} rows={2} className="resize-none text-sm" disabled={isLoading} data-testid="input-message-character" />
                                  <div className="text-xs text-slate-500 mt-1">{userInput.length}/200</div>
                                </div>
                                <div className="grid grid-cols-2 gap-1 w-20">
                                  <Button onClick={handleSendMessage} disabled={!userInput.trim() || isLoading} className="bg-purple-600 hover:bg-purple-700 text-white" size="sm" data-testid="button-send-message-character"><i className="fas fa-paper-plane"></i></Button>
                                  <Button variant="outline" size="sm" onClick={handleVoiceInput} disabled={isLoading || !speechSupported}
                                    className={`${isRecording ? 'bg-red-50 border-red-300 text-red-700 animate-pulse' : ''} ${!speechSupported ? 'opacity-50' : ''}`}
                                    data-testid="button-voice-input-character" title={!speechSupported ? t('voice.notSupported') : isRecording ? t('chat.stopRecording') : t('chat.startRecording')}>
                                    <i className={`fas ${isRecording ? 'fa-stop' : 'fa-microphone'} ${isRecording ? 'text-red-500' : ''}`}></i>
                                  </Button>
                                  <Button variant="outline" size="sm" onClick={handleSkipTurn} disabled={isLoading} data-testid="button-skip-turn-character" className="col-span-2">Skip</Button>
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
                    </Card>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {chatMode === 'messenger' && (
          <MessengerInfoCards scenario={scenario} elapsedTime={elapsedTime} turnCount={conversation.turnCount} maxTurns={MAX_TURNS} />
        )}

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
