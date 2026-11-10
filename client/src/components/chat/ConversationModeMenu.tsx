import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface ConversationModeMenuProps {
  currentMode?: 'text' | 'realtime-voice' | 'live-avatar';
  onTextModeToggle?: () => void;
  onVoiceModeToggle?: () => void;
  onLiveAvatarOptions?: () => void;
  disabled?: boolean;
  textDisabled?: boolean;
}

export function ConversationModeMenu({
  currentMode = 'realtime-voice',
  onTextModeToggle,
  onVoiceModeToggle,
  onLiveAvatarOptions,
  disabled = false,
  textDisabled = false,
}: ConversationModeMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const voiceUnavailableId = useId();
  const liveAvatarUnavailableId = useId();
  const textUnavailable = !onTextModeToggle;
  const voiceUnavailable = !onVoiceModeToggle;
  const liveAvatarUnavailable = !onLiveAvatarOptions;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 shrink-0"
          aria-label={t('chat.conversationModeMenu', { defaultValue: '대화 방식 선택' })}
          data-testid="button-conversation-mode-menu"
        >
          <i className="fas fa-sliders-h text-[11px] text-slate-500" aria-hidden="true" />
          <span>{t('chat.conversationModeLabel', { defaultValue: '대화 방식' })}</span>
          <i className="fas fa-chevron-down text-[9px] text-slate-400" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        className="w-64 rounded-xl border-slate-200 bg-white p-2 shadow-lg"
        data-testid="panel-conversation-mode-menu"
      >
        <p className="px-2 pb-1 pt-1 text-[11px] font-medium text-slate-500">
          {t('chat.conversationModeLabel', { defaultValue: '대화 방식' })}
        </p>
        {currentMode !== 'text' && (
          <>
            <button
              type="button"
              onClick={() => { setOpen(false); onTextModeToggle?.(); }}
              disabled={disabled || textDisabled || textUnavailable}
              className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="button-conversation-mode-text"
            >
              <i className="fas fa-keyboard w-4 text-center text-slate-500" aria-hidden="true" />
              <span>{t('chat.switchToText', { defaultValue: '텍스트 대화' })}</span>
            </button>
            {textUnavailable && (
              <p className="px-9 pb-1 text-[11px] leading-snug text-slate-600">
                {t('chat.textModeUnavailable', { defaultValue: '텍스트 전환을 사용할 수 없습니다' })}
              </p>
            )}
          </>
        )}
        {currentMode !== 'realtime-voice' && (
          <>
            <button
              type="button"
              onClick={() => { setOpen(false); onVoiceModeToggle?.(); }}
              disabled={disabled || voiceUnavailable}
              aria-describedby={voiceUnavailable ? voiceUnavailableId : undefined}
              className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="button-conversation-mode-voice"
            >
              <i className="fas fa-microphone w-4 text-center text-slate-500" aria-hidden="true" />
              <span>{t('chat.switchToVoice', { defaultValue: '음성 대화' })}</span>
            </button>
            {voiceUnavailable && (
              <p
                id={voiceUnavailableId}
                className="px-9 pb-1 text-[11px] leading-snug text-slate-600"
                data-testid="text-voice-mode-unavailable"
              >
                {t('chat.voiceModeUnavailable', { defaultValue: '음성 대화를 사용할 수 없습니다' })}
              </p>
            )}
          </>
        )}
        {currentMode !== 'live-avatar' && (
          <>
            <button
              type="button"
              onClick={() => { setOpen(false); onLiveAvatarOptions?.(); }}
              disabled={disabled || liveAvatarUnavailable}
              aria-describedby={liveAvatarUnavailable ? liveAvatarUnavailableId : undefined}
              className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="button-conversation-mode-live-avatar"
            >
              <i className="fas fa-user-circle w-4 text-center text-slate-500" aria-hidden="true" />
              <span>{t('chat.liveAvatarMode', { defaultValue: '라이브 아바타' })}</span>
            </button>
            {liveAvatarUnavailable && (
              <p
                id={liveAvatarUnavailableId}
                className="px-9 pb-1 text-[11px] leading-snug text-slate-600"
                data-testid="text-live-avatar-unavailable"
              >
                {t('chat.liveAvatarUnavailable', { defaultValue: '현재 사용할 수 없습니다' })}
              </p>
            )}
          </>
        )}
        {disabled && !liveAvatarUnavailable && (
          <p className="px-9 pb-1 text-[11px] leading-snug text-slate-600">
            {t('chat.modeSwitchPending', { defaultValue: '대화 방식을 전환하고 있습니다' })}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
