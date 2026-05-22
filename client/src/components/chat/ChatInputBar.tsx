import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getProgressInfo } from "@/lib/conversationProgress";

interface ChatInputBarProps {
  userInput: string;
  onUserInputChange: (value: string) => void;
  onSendMessage: () => void;
  onVoiceInput: () => void;
  onSkipTurn: () => void;
  isLoading: boolean;
  isRecording: boolean;
  speechSupported: boolean;
  mode?: 'text' | 'realtime-voice';
  onTextModeToggle?: () => void;
  onTTSModeToggle?: () => void;
  realtimeVoiceProps?: {
    status: string;
    isRecording: boolean;
    isAISpeaking: boolean;
    isWaitingForGreeting: boolean;
    greetingFailed: boolean;
    greetingRetryCount: number;
    conversationPhase: string;
    sessionWarning?: string | null;
    error?: string | null;
    showMicPrompt: boolean;
    onConnect: (messages?: { role: 'user' | 'ai'; content: string }[]) => void;
    onStartRecording: () => void;
    onStopRecording: () => void;
    onEndConversation: () => void;
    previousMessages?: { role: 'user' | 'ai'; content: string }[];
    personaDept?: string;
    personaRole?: string;
    personaName?: string;
    userName?: string;
    currentTurn?: number;
    targetTurns?: number;
    vadSensitivity?: number;
    onVadSensitivityChange?: (level: number) => void;
    isSwitchingMode?: boolean;
  };
}

export function ChatInputBar({
  userInput,
  onUserInputChange,
  onSendMessage,
  onVoiceInput,
  onSkipTurn,
  isLoading,
  isRecording,
  speechSupported,
  mode = 'text',
  onTextModeToggle,
  onTTSModeToggle,
  realtimeVoiceProps,
}: ChatInputBarProps) {
  const { t } = useTranslation();

  const realtimeProgressPct = realtimeVoiceProps?.currentTurn !== undefined && realtimeVoiceProps?.targetTurns
    ? Math.min((realtimeVoiceProps.currentTurn / realtimeVoiceProps.targetTurns) * 100, 100)
    : 0;
  const realtimeStage = getProgressInfo(realtimeProgressPct).stage;

  const realtimePrevStageRef = useRef(realtimeStage);
  const [isRealtimeButtonAnimating, setIsRealtimeButtonAnimating] = useState(false);
  const realtimeAnimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (realtimeStage !== realtimePrevStageRef.current) {
      realtimePrevStageRef.current = realtimeStage;
      setIsRealtimeButtonAnimating(true);
      if (realtimeAnimTimerRef.current) clearTimeout(realtimeAnimTimerRef.current);
      realtimeAnimTimerRef.current = setTimeout(() => {
        setIsRealtimeButtonAnimating(false);
      }, 550);
    }
  }, [realtimeStage]);

  useEffect(() => {
    return () => {
      if (realtimeAnimTimerRef.current) clearTimeout(realtimeAnimTimerRef.current);
    };
  }, []);

  if (mode === 'realtime-voice' && realtimeVoiceProps) {
    const rv = realtimeVoiceProps;

    return (
      <>
        {rv.status === 'disconnected' && (
          <div className="text-center space-y-4 py-4">
            {rv.conversationPhase === 'interrupted' ? (
              <>
                <p className="text-sm text-orange-600">{t('chat.connectionLost')}</p>
                <Button
                  onClick={() => rv.onConnect(rv.previousMessages)}
                  className="bg-orange-500 hover:bg-orange-600 text-white px-8 py-6 text-lg font-semibold rounded-full shadow-lg"
                  data-testid="button-resume-voice"
                >
                  <i className="fas fa-redo mr-2"></i>
                  {t('chat.resume')}
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-slate-600">{t('chat.startRealtimeVoice')}</p>
                <Button
                  onClick={() => rv.onConnect(rv.previousMessages && rv.previousMessages.length > 0 ? rv.previousMessages : undefined)}
                  className="bg-purple-600 hover:bg-purple-700 text-white px-8 py-6 text-lg font-semibold rounded-full shadow-lg"
                  data-testid="button-start-voice"
                >
                  <i className="fas fa-phone mr-2"></i>
                  {t('chat.startConversation')}
                </Button>
              </>
            )}
          </div>
        )}

        {(rv.status === 'connecting' || rv.status === 'reconnecting') && (
          <div className="flex flex-col items-center justify-center gap-2 py-4">
            <div className="flex items-center justify-center space-x-2">
              <div className="w-3 h-3 bg-purple-500 rounded-full animate-bounce"></div>
              <div className="w-3 h-3 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: "0.15s" }}></div>
              <div className="w-3 h-3 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: "0.3s" }}></div>
            </div>
            <span className="text-slate-700 font-medium text-sm">
              {rv.status === 'reconnecting' ? t('chat.reconnectingVoice') : t('chat.connectingVoice')}
            </span>
            <span className="text-slate-400 text-xs">
              {rv.status === 'reconnecting' ? t('chat.reconnectingVoiceHint') : t('chat.connectingVoiceHint')}
            </span>
          </div>
        )}

        {rv.status === 'connected' && rv.isWaitingForGreeting && (
          <div className="flex flex-col items-center justify-center gap-3 py-4">
            <div className="flex items-center justify-center space-x-2">
              <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce"></div>
              <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
              <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
              <span className="ml-2 text-slate-600 text-sm">
                {rv.greetingRetryCount > 0
                  ? `${rv.personaDept} ${rv.personaRole} ${rv.personaName}${t('chat.preparingGreetingRetry', { count: rv.greetingRetryCount })}`
                  : `${rv.personaDept} ${rv.personaRole} ${rv.personaName}${t('chat.preparingGreeting')}`}
              </span>
            </div>
            <Button
              onClick={rv.onStartRecording}
              size="sm"
              className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-full text-sm"
              data-testid="button-start-greeting"
            >
              <i className="fas fa-microphone mr-1.5"></i>
              {t('chat.startConversation')}
            </Button>
          </div>
        )}

        {rv.status === 'connected' && rv.greetingFailed && (
          <div className="flex items-center justify-center py-4">
            <span className="text-orange-600 text-sm font-medium">
              {rv.userName || t('chat.member')}{t('chat.sayHelloFirst', { name: rv.personaName })}
            </span>
          </div>
        )}

        {rv.status === 'connected' && !rv.isWaitingForGreeting && (
          <div className="flex items-center justify-center gap-4 py-2">
            {(() => {
              const progressPct = rv.currentTurn !== undefined && rv.targetTurns
                ? Math.min((rv.currentTurn / rv.targetTurns) * 100, 100)
                : 0;
              const pi = getProgressInfo(progressPct);
              const turnsLeft = rv.targetTurns ? Math.max(rv.targetTurns - (rv.currentTurn ?? 0), 0) : 0;
              return (
                <TooltipProvider delayDuration={300}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={rv.onEndConversation}
                        disabled={rv.isRecording || rv.isAISpeaking}
                        data-testid="button-end-conversation-realtime"
                        className={`shrink-0 min-h-[44px] min-w-[44px] border transition-all duration-300 ${
                          pi.isGreen
                            ? 'bg-green-600 hover:bg-green-700 text-white border-green-600'
                            : pi.isAmber
                            ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-500'
                            : pi.showWarningIcon
                            ? 'text-slate-400 border-slate-200 hover:bg-slate-50 opacity-80'
                            : 'text-red-600 border-red-200 hover:bg-red-50'
                        }${isRealtimeButtonAnimating ? ' animate-btn-pop' : ''}`}
                      >
                        {pi.showWarningIcon && <i className="fas fa-exclamation-triangle mr-1 text-xs"></i>}
                        {pi.isGreen && <i className="fas fa-chart-bar mr-1 text-xs"></i>}
                        {pi.isAmber && <i className="fas fa-star mr-1 text-xs"></i>}
                        {!pi.showWarningIcon && !pi.isGreen && !pi.isAmber && <i className="fas fa-stop-circle mr-1"></i>}
                        {pi.showBadge && rv.currentTurn !== undefined && rv.targetTurns ? (
                          <span>{rv.currentTurn}/{rv.targetTurns}</span>
                        ) : (
                          <span>{t(pi.stage === 'complete' ? 'chat.almostDoneEnd' : pi.endButtonLabelKey)}</span>
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {pi.stage === 'early'
                        ? t('chat.exitWarningTooltip', { count: turnsLeft })
                        : pi.stage === 'mid'
                        ? t('chat.progressBadgeTooltip', { current: rv.currentTurn, target: rv.targetTurns })
                        : t('chat.almostDoneTitle')}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              );
            })()}

            <button
              onClick={() => {
                if (rv.isRecording) {
                  rv.onStopRecording();
                } else {
                  rv.onStartRecording();
                }
              }}
              disabled={rv.isAISpeaking}
              className={`relative w-14 h-14 rounded-full flex items-center justify-center transition-all duration-300 shadow-lg ${
                rv.isRecording
                  ? 'bg-red-500 text-white scale-110'
                  : rv.isAISpeaking
                  ? 'bg-blue-500 text-white'
                  : rv.showMicPrompt
                  ? 'bg-gradient-to-r from-blue-500 to-purple-500 text-white animate-bounce'
                  : 'bg-gradient-to-r from-purple-500 to-indigo-500 text-white hover:scale-105'
              }`}
              data-testid="button-realtime-voice-record"
              title={rv.isRecording ? "음성 입력을 중지하려면 클릭하세요" : "음성 입력을 시작하려면 클릭하세요"}
            >
              {(rv.showMicPrompt || rv.isRecording) && !rv.isAISpeaking && (
                <>
                  <span className="absolute inset-0 rounded-full bg-current animate-ping opacity-20"></span>
                  <span className="absolute -inset-2 rounded-full bg-current opacity-10 blur-md animate-pulse"></span>
                </>
              )}
              <i className={`fas text-xl ${
                rv.isRecording
                  ? 'fa-stop'
                  : rv.isAISpeaking
                  ? 'fa-volume-up animate-pulse'
                  : 'fa-microphone'
              }`}></i>
            </button>

            <button
              onClick={onTextModeToggle}
              disabled={rv.isRecording || rv.isAISpeaking || rv.isSwitchingMode}
              className="flex items-center gap-1.5 px-3 py-2 text-sm border border-slate-200 rounded-full bg-white hover:bg-slate-50 hover:border-slate-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="button-text-mode-toggle"
            >
              <i className="fas fa-keyboard text-slate-500 text-xs"></i>
              <span className="text-slate-600">{t('chat.switchToText', { defaultValue: '텍스트로 대화' })}</span>
            </button>
            {onTTSModeToggle && (
              <button
                onClick={onTTSModeToggle}
                disabled={rv.isRecording || rv.isAISpeaking || rv.isSwitchingMode}
                className="flex items-center gap-1.5 px-3 py-2 text-sm border border-slate-200 rounded-full bg-white hover:bg-slate-50 hover:border-slate-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="button-tts-mode-toggle"
              >
                <i className="fas fa-volume-up text-slate-500 text-xs"></i>
                <span className="text-slate-600">{t('chat.switchToTTS', { defaultValue: 'TTS로 대화' })}</span>
              </button>
            )}
          </div>
        )}

        {rv.status === 'connected' && (rv.isRecording || rv.isAISpeaking) && (
          <div className="text-center mt-2">
            {rv.isRecording && (
              <p className="text-sm text-red-600 font-medium animate-pulse">
                🔴 {t('chat.recording')}
              </p>
            )}
            {rv.isAISpeaking && (
              <p className="text-sm text-blue-600 font-medium animate-pulse">
                🔵 {t('chat.aiResponding')}
              </p>
            )}
          </div>
        )}

        {rv.status === 'connected' && !rv.isWaitingForGreeting && rv.onVadSensitivityChange && (
          <div className="flex items-center gap-3 mt-2 px-1">
            <span className="text-slate-400 text-xs shrink-0">🔇</span>
            <Slider
              min={1}
              max={5}
              step={1}
              value={[rv.vadSensitivity ?? 3]}
              onValueChange={([v]) => rv.onVadSensitivityChange!(v)}
              className="flex-1 h-1"
            />
            <span className="text-slate-400 text-xs shrink-0">🎤</span>
            <span className="text-xs text-slate-500 shrink-0 w-16 text-right">
              {rv.vadSensitivity === 1 ? t('vad.sensitivity.1', { defaultValue: '매우 낮음' })
                : rv.vadSensitivity === 2 ? t('vad.sensitivity.2', { defaultValue: '낮음' })
                : rv.vadSensitivity === 4 ? t('vad.sensitivity.4', { defaultValue: '높음' })
                : rv.vadSensitivity === 5 ? t('vad.sensitivity.5', { defaultValue: '매우 높음' })
                : t('vad.sensitivity.3', { defaultValue: '중간' })}
            </span>
          </div>
        )}

        {rv.sessionWarning && (
          <div className="mt-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2">
            <span className="text-amber-500 text-sm">🔄</span>
            <p className="text-sm text-amber-700">{rv.sessionWarning}</p>
          </div>
        )}

        {rv.error && (
          <p className="text-sm text-red-600 text-center mt-2">{rv.error}</p>
        )}
      </>
    );
  }

  return (
    <div className="flex gap-4">
      <div className="flex-1">
        <div className="relative">
          <Textarea
            value={userInput}
            onChange={(e) => onUserInputChange(e.target.value)}
            placeholder={`메시지를 입력하세요... (최대 200자)`}
            maxLength={200}
            rows={3}
            className="resize-none rounded-xl border-slate-200 focus:border-corporate-400 focus:ring-corporate-400/20 focus:ring-4 transition-all duration-200 pr-12"
            disabled={isLoading}
            data-testid="input-message"
          />
          <div className="absolute bottom-3 right-3 text-xs text-slate-400 bg-white/80 px-1.5 py-0.5 rounded">
            {userInput.length}/200
          </div>
        </div>
        <div className="flex items-center justify-between mt-2 px-1">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <i className="fas fa-lightbulb text-amber-400"></i>
            <span>{t('chat.tipPoliteAnswer')}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {isRecording && (
              <span className="text-red-600 animate-pulse flex items-center gap-1">
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                {t('voice.inputInProgress')}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Button
          onClick={onSendMessage}
          disabled={!userInput.trim() || isLoading}
          className="bg-gradient-to-r from-corporate-600 to-corporate-700 hover:from-corporate-700 hover:to-corporate-800 shadow-md hover:shadow-lg transition-all duration-200 rounded-xl min-h-[44px] h-12"
          data-testid="button-send-message"
        >
          <i className="fas fa-paper-plane mr-2"></i>
          {t('chat.send')}
        </Button>
        <Button
          variant="outline"
          onClick={onVoiceInput}
          disabled={isLoading || !speechSupported}
          className={`rounded-xl min-h-[44px] h-10 transition-all duration-200 ${
            isRecording
              ? 'bg-red-50 border-red-300 text-red-700 animate-pulse shadow-md'
              : 'hover:bg-slate-50 hover:border-slate-300 hover:shadow-sm'
          } ${!speechSupported ? 'opacity-50 cursor-not-allowed' : ''}`}
          data-testid="button-voice-input"
          title={!speechSupported ? t('chat.voiceNotSupported') : isRecording ? t('chat.stopRecording') : t('chat.startRecording')}
        >
          <i className={`fas ${isRecording ? 'fa-stop' : 'fa-microphone'} mr-2 ${isRecording ? 'text-red-500' : 'text-corporate-600'}`}></i>
          {isRecording ? t('chat.done') : t('chat.voice')}
        </Button>
        <Button
          variant="ghost"
          onClick={onSkipTurn}
          disabled={isLoading}
          className="rounded-xl min-h-[44px] h-10 text-slate-500 hover:text-slate-700 hover:bg-slate-100"
          data-testid="button-skip-turn"
        >
          <i className="fas fa-forward mr-2"></i>
          {t('chat.skip')}
        </Button>
      </div>
    </div>
  );
}
