import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { AutoResizeTextarea } from "@/components/ui/auto-resize-textarea";
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
    outputDevices?: { deviceId: string; label: string; kind?: 'default' | 'speaker' | 'bluetooth' | 'wired' | 'other' }[];
    selectedOutputDeviceId?: string;
    outputStatus?: 'supported' | 'unsupported' | 'selecting' | 'error';
    outputMessage?: string | null;
    outputNeedsPermission?: boolean;
    outputListUnavailable?: boolean;
    onOutputDeviceChange?: (deviceId: string) => Promise<boolean>;
    onRefreshOutputDevices?: () => Promise<void>;
    onRequestOutputPermission?: () => Promise<boolean>;
    onRetryAudioPlayback?: () => Promise<boolean>;
    inputDevices?: { deviceId: string; label: string; kind?: 'default' | 'bluetooth' | 'wired' | 'builtin' | 'other' }[];
    selectedInputDeviceId?: string;
    inputStatus?: 'supported' | 'unsupported' | 'error';
    inputMessage?: string | null;
    inputNeedsPermission?: boolean;
    onInputDeviceChange?: (deviceId: string) => Promise<boolean>;
    onRefreshInputDevices?: () => Promise<void>;
    onRequestInputPermission?: () => Promise<boolean>;
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
            {rv.onVadSensitivityChange && (() => {
              const cur = rv.vadSensitivity ?? 3;
              const VAD_LEVELS = [
                { value: 1, icon: '🔇', label: t('vad.sensitivity.1', { defaultValue: '매우 낮음' }), desc: t('vad.sensitivity.1.desc', { defaultValue: '아주 큰 소리만 인식 — 소음 많은 환경' }) },
                { value: 2, icon: '🔈', label: t('vad.sensitivity.2', { defaultValue: '낮음' }),     desc: t('vad.sensitivity.2.desc', { defaultValue: '큰 목소리에 반응 — 잡음이 많을 때' }) },
                { value: 3, icon: '🔉', label: t('vad.sensitivity.3', { defaultValue: '중간' }),     desc: t('vad.sensitivity.3.desc', { defaultValue: '일반 환경에 적합 (기본값)' }) },
                { value: 4, icon: '🔊', label: t('vad.sensitivity.4', { defaultValue: '높음' }),     desc: t('vad.sensitivity.4.desc', { defaultValue: '작은 소리도 감지 — 조용한 환경' }) },
                { value: 5, icon: '🎤', label: t('vad.sensitivity.5', { defaultValue: '매우 높음' }), desc: t('vad.sensitivity.5.desc', { defaultValue: '매우 민감 — 배경소음 주의' }) },
              ] as const;
              const active = VAD_LEVELS.find(l => l.value === cur) ?? VAD_LEVELS[2];
              return (
                <Popover>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <PopoverTrigger asChild>
                          <button className="relative flex items-center gap-1 h-8 px-2 rounded-full border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-colors shrink-0 text-[11px] font-medium">
                            <span>{active.icon}</span>
                            <span className="hidden sm:inline max-w-[48px] truncate">{active.label}</span>
                          </button>
                        </PopoverTrigger>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {t('vad.sensitivityTooltip', {
                          defaultValue: '마이크 감도 — 클릭해서 변경',
                        })}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <PopoverContent side="top" align="end" className="w-64 p-3">
                    <p className="text-xs font-semibold text-slate-700 mb-0.5">
                      {t('vad.settingsTitle', { defaultValue: '마이크 감도' })}
                    </p>
                    <p className="text-[11px] text-slate-400 mb-2.5">
                      {t('vad.settingsHint', { defaultValue: '주변 환경에 맞게 선택하세요' })}
                    </p>
                    <div className="flex flex-col gap-1">
                      {VAD_LEVELS.map(level => (
                        <button
                          key={level.value}
                          onClick={() => rv.onVadSensitivityChange!(level.value)}
                          className={`flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-left transition-colors ${
                            cur === level.value
                              ? 'bg-purple-50 border border-purple-200 text-purple-800'
                              : 'hover:bg-slate-50 border border-transparent text-slate-700'
                          }`}
                        >
                          <span className="text-base shrink-0">{level.icon}</span>
                          <div className="min-w-0">
                            <p className="text-xs font-medium leading-tight">{level.label}</p>
                            <p className="text-[10px] text-slate-400 leading-tight mt-0.5">{level.desc}</p>
                          </div>
                          {cur === level.value && (
                            <i className="fas fa-check text-purple-500 text-[10px] ml-auto shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              );
            })()}

            {rv.onInputDeviceChange && (
              <Popover onOpenChange={(open) => { if (open) rv.onRefreshInputDevices?.(); }}>
                <PopoverTrigger asChild>
                  <button
                    className="flex items-center gap-1 h-8 px-2 rounded-full border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-colors shrink-0 text-[11px] font-medium"
                    data-testid="button-audio-input-settings"
                    aria-label="마이크 기기 설정"
                  >
                    <i className="fas fa-microphone text-[10px]" />
                    <span className="hidden sm:inline">마이크</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent side="top" align="end" className="w-72 p-3">
                  <p className="text-xs font-semibold text-slate-700">마이크</p>
                  <p className="text-[10px] text-slate-400 mt-0.5" data-testid="text-input-popover-hint">
                    내 목소리를 녹음할 기기를 선택합니다
                  </p>
                  {rv.inputStatus === 'unsupported' ? (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                      이 브라우저에서는 앱이 마이크를 직접 선택할 수 없습니다.
                      휴대폰 블루투스 메뉴에서 연결을 변경한 뒤 다시 시도하세요.
                    </p>
                  ) : (
                    <div className="mt-2 flex flex-col gap-1">
                      {(rv.inputDevices?.length ? rv.inputDevices : [{ deviceId: '', label: '기본 마이크', kind: 'default' as const }]).map(device => {
                        const isSelected = rv.selectedInputDeviceId === device.deviceId;
                        const deviceIcon = device.kind === 'bluetooth'
                          ? 'fa-bluetooth-b'
                          : device.kind === 'wired'
                            ? 'fa-headphones'
                            : device.kind === 'builtin'
                              ? 'fa-mobile-alt'
                              : 'fa-microphone';
                        return (
                          <button
                            key={device.deviceId || 'default'}
                            onClick={() => rv.onInputDeviceChange!(device.deviceId)}
                            data-testid={`button-input-device-${device.deviceId || 'default'}`}
                            className={`w-full rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${
                              isSelected
                                ? 'border-purple-200 bg-purple-50 text-purple-800'
                                : 'border-transparent text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            <i className={`${device.kind === 'bluetooth' ? 'fab' : 'fas'} ${deviceIcon} ${isSelected ? 'text-purple-500' : 'text-slate-400'} mr-2 w-3.5`} />
                            {device.label}
                            {isSelected && <i className="fas fa-check text-purple-500 text-[10px] ml-1.5" />}
                          </button>
                        );
                      })}
                      {rv.inputNeedsPermission && rv.onRequestInputPermission && (
                        <button
                          onClick={() => rv.onRequestInputPermission!()}
                          className="mt-1 w-full rounded-lg border border-dashed border-purple-200 px-2.5 py-2 text-left text-[11px] font-medium text-purple-700 hover:bg-purple-50"
                          data-testid="button-load-input-devices"
                        >
                          <i className="fas fa-sync-alt mr-2" />
                          연결된 기기 목록 불러오기
                        </button>
                      )}
                    </div>
                  )}
                  {rv.inputMessage && (
                    <p className={`mt-2 text-[11px] leading-relaxed ${rv.inputStatus === 'error' ? 'text-amber-700' : 'text-slate-500'}`}>
                      {rv.inputMessage}
                    </p>
                  )}
                </PopoverContent>
              </Popover>
            )}

            {rv.onOutputDeviceChange && (
              <Popover onOpenChange={(open) => { if (open) rv.onRefreshOutputDevices?.(); }}>
                <PopoverTrigger asChild>
                  <button
                    className="flex items-center gap-1 h-8 px-2 rounded-full border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-colors shrink-0 text-[11px] font-medium"
                    data-testid="button-audio-output-settings"
                    aria-label="음성 출력 기기 설정"
                  >
                    <i className="fas fa-volume-up text-[10px]" />
                    <span className="hidden sm:inline">출력</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent side="top" align="end" className="w-72 p-3">
                  <p className="text-xs font-semibold text-slate-700">음성 출력</p>
                  <p className="text-[10px] text-slate-400 mt-0.5" data-testid="text-output-popover-hint">
                    상대 음성이 재생될 기기를 선택합니다
                  </p>
                  {rv.outputStatus === 'unsupported' ? (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                      이 브라우저에서는 앱이 스피커·수화음·블루투스 기기를 직접 선택할 수 없습니다.
                      휴대폰 제어 센터 또는 블루투스 메뉴에서 출력 기기를 바꾼 뒤 재생을 다시 시도하세요.
                    </p>
                  ) : rv.outputListUnavailable ? (
                    <p
                      className="mt-1.5 text-[11px] leading-relaxed text-slate-500"
                      data-testid="text-output-list-unavailable"
                    >
                      이 브라우저는 출력 기기 목록을 앱에 제공하지 않아 여기서 직접 선택할 수 없습니다.
                      블루투스 이어폰을 연결하면 휴대폰이 자동으로 전환하며,
                      Android는 알림창의 미디어 출력 버튼, iPhone은 제어 센터에서 출력 기기를 바꿀 수 있습니다.
                    </p>
                  ) : (
                    <div className="mt-2 flex flex-col gap-1">
                      {(rv.outputDevices?.length ? rv.outputDevices : [{ deviceId: '', label: '기본 출력 기기', kind: 'default' as const }]).map(device => {
                        const isSelected = rv.selectedOutputDeviceId === device.deviceId;
                        const deviceIcon = device.kind === 'bluetooth'
                          ? 'fa-bluetooth-b'
                          : device.kind === 'wired'
                            ? 'fa-headphones'
                            : device.kind === 'speaker'
                              ? 'fa-volume-up'
                              : 'fa-mobile-alt';
                        return (
                          <button
                            key={device.deviceId || 'default'}
                            onClick={() => rv.onOutputDeviceChange!(device.deviceId)}
                            disabled={rv.outputStatus === 'selecting'}
                            data-testid={`button-output-device-${device.deviceId || 'default'}`}
                            className={`w-full rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${
                              isSelected
                                ? 'border-purple-200 bg-purple-50 text-purple-800'
                                : 'border-transparent text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            <i className={`${device.kind === 'bluetooth' ? 'fab' : 'fas'} ${deviceIcon} ${isSelected ? 'text-purple-500' : 'text-slate-400'} mr-2 w-3.5`} />
                            {device.label}
                            {isSelected && <i className="fas fa-check text-purple-500 text-[10px] ml-1.5" />}
                          </button>
                        );
                      })}
                      {rv.outputNeedsPermission && rv.onRequestOutputPermission && (
                        <button
                          onClick={() => rv.onRequestOutputPermission!()}
                          className="mt-1 w-full rounded-lg border border-dashed border-purple-200 px-2.5 py-2 text-left text-[11px] font-medium text-purple-700 hover:bg-purple-50"
                          data-testid="button-load-output-devices"
                        >
                          <i className="fas fa-sync-alt mr-2" />
                          연결된 기기 목록 불러오기
                        </button>
                      )}
                    </div>
                  )}
                  {rv.outputMessage && !rv.outputListUnavailable && (
                    <p className={`mt-2 text-[11px] leading-relaxed ${rv.outputStatus === 'error' ? 'text-amber-700' : 'text-slate-500'}`}>
                      {rv.outputMessage}
                    </p>
                  )}
                  {(rv.outputStatus === 'error' || rv.outputStatus === 'unsupported') && rv.onRetryAudioPlayback && (
                    <button
                      onClick={() => rv.onRetryAudioPlayback!()}
                      className="mt-2 text-[11px] font-medium text-purple-700 hover:text-purple-800"
                      data-testid="button-retry-audio-playback"
                    >
                      <i className="fas fa-redo mr-1" />재생 다시 시도
                    </button>
                  )}
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

  const charsLeft = 200 - userInput.length;

  return (
    <div className="flex items-center gap-2">
      {/* Mic button */}
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            {speechSupported ? (
              <button
                type="button"
                onClick={onVoiceInput}
                disabled={isLoading}
                className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all duration-200 ${
                  isRecording
                    ? 'bg-red-500 text-white animate-pulse shadow-md'
                    : 'bg-slate-100 border border-slate-200 text-slate-500 hover:bg-slate-200 hover:text-slate-700'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
                data-testid="button-voice-input"
              >
                <i className={`fas ${isRecording ? 'fa-stop' : 'fa-microphone'} text-sm`}></i>
              </button>
            ) : (
              <span
                className="w-10 h-10 rounded-full inline-flex items-center justify-center shrink-0 bg-slate-100 border border-slate-200 text-slate-400 opacity-50 cursor-not-allowed"
                aria-label={t('chat.voiceNotSupported', { defaultValue: '이 브라우저는 음성 인식을 지원하지 않습니다' })}
                data-testid="button-voice-input"
              >
                <i className="fas fa-microphone text-sm"></i>
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

      {/* Text input */}
      <AutoResizeTextarea
        value={userInput}
        onChange={(e) => onUserInputChange(e.target.value)}
        placeholder={`메시지를 입력하세요... (최대 200자)`}
        maxLength={200}
        rows={1}
        style={{ maxHeight: '120px' }}
        className="flex-1 rounded-xl border-slate-200 focus:border-corporate-400 focus:ring-corporate-400/20 focus:ring-4 transition-all duration-200 py-2.5 px-3"
        disabled={isLoading}
        data-testid="input-message"
      />

      {/* Char counter */}
      <span className={`text-xs shrink-0 ${charsLeft <= 20 ? 'text-amber-500' : 'text-slate-400'}`}>
        {charsLeft}
      </span>

      {/* Send button */}
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onSendMessage}
              disabled={!userInput.trim() || isLoading}
              className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-gradient-to-r from-corporate-600 to-corporate-700 hover:from-corporate-700 hover:to-corporate-800 text-white shadow-md hover:shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="button-send-message"
            >
              <i className="fas fa-paper-plane text-sm"></i>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{t('chat.send')}</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Skip button */}
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onSkipTurn}
              disabled={isLoading}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 border border-slate-200 shrink-0 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="button-skip-turn"
            >
              <i className="fas fa-forward text-[11px]"></i>
              <span>{t('chat.skip')}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{t('chat.skip')}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
