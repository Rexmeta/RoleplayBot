import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { AutoResizeTextarea } from "@/components/ui/auto-resize-textarea";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  historyCount?: number;
  onHistoryClick?: () => void;
  inlineHint?: 'silence' | 'saving' | null;
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
  realtimeVoiceProps,
  historyCount,
  onHistoryClick,
  inlineHint,
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
                {t('chat.connectingVoiceHint')}
              </span>
            </div>
          </div>
        )}

        {rv.status === 'connected' && rv.greetingFailed && (
          <div className="flex items-center justify-center py-2">
            <span className="text-orange-600 text-sm font-medium">
              {rv.userName || t('chat.member')}{t('chat.sayHelloFirst', { name: rv.personaName })}
            </span>
          </div>
        )}

        {/* Compact connected control row */}
        {rv.status === 'connected' && !rv.isWaitingForGreeting && (
          <div className="flex items-center gap-2 py-1.5 px-2">
            {/* End conversation button */}
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
                        className={`shrink-0 min-h-[36px] min-w-[36px] h-9 border transition-all duration-300 text-xs px-2 ${
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

            {/* Mic button — color encodes state: red=recording, blue=AI speaking */}
            <button
              onClick={() => {
                if (rv.isRecording) {
                  rv.onStopRecording();
                } else {
                  rv.onStartRecording();
                }
              }}
              disabled={rv.isAISpeaking}
              className={`relative w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 shadow-md shrink-0 ${
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
              <i className={`fas text-base ${
                rv.isRecording
                  ? 'fa-stop'
                  : rv.isAISpeaking
                  ? 'fa-volume-up animate-pulse'
                  : 'fa-microphone'
              }`}></i>
            </button>

            {/* Text mode toggle */}
            <button
              onClick={onTextModeToggle}
              disabled={rv.isAISpeaking || rv.isSwitchingMode}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-200 rounded-full bg-white hover:bg-slate-50 hover:border-slate-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              data-testid="button-text-mode-toggle"
            >
              <i className="fas fa-keyboard text-slate-500 text-[11px]"></i>
              <span className="text-slate-600">{t('chat.switchToText', { defaultValue: '텍스트' })}</span>
            </button>

            {/* VAD sensitivity popover */}
            {rv.onVadSensitivityChange && (
              <Popover>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <PopoverTrigger asChild>
                        <button
                          className="relative flex items-center justify-center w-8 h-8 rounded-full border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 transition-colors shrink-0"
                        >
                    <i className="fas fa-sliders-h text-[11px]"></i>
                    {rv.vadSensitivity !== undefined && (
                      <span
                        className={`absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold text-white leading-none ${
                          rv.vadSensitivity <= 2
                            ? 'bg-blue-400'
                            : rv.vadSensitivity >= 4
                            ? 'bg-amber-400'
                            : 'bg-slate-400'
                        }`}
                      >
                        {rv.vadSensitivity}
                      </span>
                    )}
                        </button>
                      </PopoverTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {t('vad.sensitivityTooltip', {
                        defaultValue: '마이크 감도: {{level}} ({{value}})',
                        level: rv.vadSensitivity === 1 ? t('vad.sensitivity.1', { defaultValue: '매우 낮음' })
                          : rv.vadSensitivity === 2 ? t('vad.sensitivity.2', { defaultValue: '낮음' })
                          : rv.vadSensitivity === 4 ? t('vad.sensitivity.4', { defaultValue: '높음' })
                          : rv.vadSensitivity === 5 ? t('vad.sensitivity.5', { defaultValue: '매우 높음' })
                          : t('vad.sensitivity.3', { defaultValue: '중간' }),
                        value: rv.vadSensitivity ?? 3,
                      })}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <PopoverContent side="top" align="end" className="w-52 p-3">
                  <p className="text-xs font-medium text-slate-600 mb-2">
                    {t('vad.settingsTitle', { defaultValue: '마이크 감도' })}
                  </p>
                  <div className="flex items-center gap-2">
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
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1.5 text-center">
                    {rv.vadSensitivity === 1 ? t('vad.sensitivity.1', { defaultValue: '매우 낮음' })
                      : rv.vadSensitivity === 2 ? t('vad.sensitivity.2', { defaultValue: '낮음' })
                      : rv.vadSensitivity === 4 ? t('vad.sensitivity.4', { defaultValue: '높음' })
                      : rv.vadSensitivity === 5 ? t('vad.sensitivity.5', { defaultValue: '매우 높음' })
                      : t('vad.sensitivity.3', { defaultValue: '중간' })}
                  </p>
                </PopoverContent>
              </Popover>
            )}

            {/* Right-side inline hints + history */}
            <div className="flex-1 flex items-center justify-end gap-2 min-w-0">
              {rv.sessionWarning && (
                <span className="text-[10px] text-amber-600 truncate">🔄</span>
              )}
              {rv.error && (
                <span className="text-[10px] text-red-500 truncate" title={rv.error}>⚠</span>
              )}
              {inlineHint === 'saving' && (
                <span className="text-[10px] text-slate-400 animate-pulse truncate">
                  {t('voice.savingMessages', { defaultValue: '저장 중…' })}
                </span>
              )}
              {inlineHint === 'silence' && (
                <span className="text-[10px] text-slate-400 truncate" style={{ animation: 'silenceBreathe 3s ease-in-out infinite' }}>
                  🎤 {t('chat.speakPrompt', { defaultValue: '말씀해 주세요…' })}
                </span>
              )}
              {historyCount !== undefined && historyCount > 0 && onHistoryClick && (
                <button
                  onClick={onHistoryClick}
                  className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700 transition-colors shrink-0"
                >
                  <i className="fas fa-history text-[10px]" />
                  <span className="bg-slate-200 text-slate-600 rounded-full px-1.5 leading-4 text-[10px] font-medium">
                    {historyCount}
                  </span>
                </button>
              )}
            </div>
          </div>
        )}

        {onTextModeToggle && !(rv.status === 'connected' && !rv.isWaitingForGreeting) && (
          <div className="flex justify-center mt-3 pt-2 border-t border-slate-100">
            <button
              onClick={onTextModeToggle}
              disabled={rv.isAISpeaking || rv.isSwitchingMode}
              className="flex items-center gap-1.5 px-3 py-2 text-sm border border-slate-200 rounded-full bg-white hover:bg-slate-50 hover:border-slate-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="button-text-mode-toggle-persistent"
            >
              <i className="fas fa-keyboard text-slate-500 text-xs"></i>
              <span className="text-slate-600">{t('chat.switchToText', { defaultValue: '텍스트로 대화' })}</span>
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="flex gap-4">
      <div className="flex-1">
        <div className="relative">
          <AutoResizeTextarea
            value={userInput}
            onChange={(e) => onUserInputChange(e.target.value)}
            placeholder={`메시지를 입력하세요... (최대 200자)`}
            maxLength={200}
            rows={3}
            className="rounded-xl border-slate-200 focus:border-corporate-400 focus:ring-corporate-400/20 focus:ring-4 transition-all duration-200 pr-12 pb-8"
            disabled={isLoading}
            data-testid="input-message"
          />
          <div className="absolute bottom-3 right-3 text-xs text-slate-400 bg-white/80 px-1.5 py-0.5 rounded">
            {userInput.length}/200
          </div>
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                {speechSupported ? (
                  <button
                    type="button"
                    onClick={onVoiceInput}
                    disabled={isLoading}
                    className={`absolute bottom-2 left-3 flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-all duration-200 ${
                      isRecording
                        ? 'bg-red-100 border border-red-300 text-red-700 animate-pulse'
                        : 'bg-slate-100 border border-slate-200 text-slate-500 hover:bg-slate-200 hover:text-slate-700'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                    data-testid="button-voice-input"
                  >
                    <i className={`fas ${isRecording ? 'fa-stop' : 'fa-microphone'} text-[11px] ${isRecording ? 'text-red-500' : 'text-slate-500'}`}></i>
                    <span>{isRecording ? t('chat.done') : t('chat.voice')}</span>
                  </button>
                ) : (
                  <span
                    className="absolute bottom-2 left-3 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs bg-slate-100 border border-slate-200 text-slate-400 opacity-50 cursor-not-allowed"
                    aria-label={t('chat.voiceNotSupported', { defaultValue: '이 브라우저는 음성 인식을 지원하지 않습니다' })}
                    data-testid="button-voice-input"
                  >
                    <i className="fas fa-microphone text-[11px] text-slate-400"></i>
                    <span>{t('chat.voice')}</span>
                  </span>
                )}
              </TooltipTrigger>
              <TooltipContent side="top">
                {!speechSupported
                  ? t('chat.voiceNotSupported', { defaultValue: '이 브라우저는 음성 인식을 지원하지 않습니다' })
                  : isRecording
                    ? t('chat.stopRecording')
                    : t('chat.startRecording')}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
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
      <div className="flex flex-col gap-3">
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
