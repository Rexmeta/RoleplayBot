import { useEffect, useRef, useState } from "react";
import { ChevronRight, MessageCircle, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ConversationMessage } from "@shared/schema";

interface TranscriptPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  messages: ConversationMessage[];
  pendingAiMessage: boolean;
  pendingUserMessage: boolean;
  pendingUserText: string;
  personaName: string;
}

export function TranscriptPanel({
  isOpen,
  onToggle,
  onClose,
  messages,
  pendingAiMessage,
  pendingUserMessage,
  pendingUserText,
  personaName,
}: TranscriptPanelProps) {
  const { t } = useTranslation();
  const mobileScrollRef = useRef<HTMLDivElement>(null);
  const desktopScrollRef = useRef<HTMLDivElement>(null);

  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 640 : false
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    setIsMobile(mq.matches);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const ref = isMobile ? mobileScrollRef : desktopScrollRef;
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [isOpen, isMobile, messages, pendingAiMessage, pendingUserMessage]);

  const panelWidth = 'min(80vw, 300px)';

  const renderMessages = (scrollRef: React.RefObject<HTMLDivElement>) => (
    <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
      {messages.filter(m => m.sender === 'user' || m.sender === 'ai').map((msg, index) => (
        <div
          key={index}
          className={`text-xs rounded-lg px-3 py-2 ${
            msg.sender === 'user'
              ? 'bg-blue-50 text-blue-800 ml-4'
              : 'bg-slate-50 text-slate-800 mr-4'
          }`}
        >
          <div className="font-semibold mb-0.5 opacity-60 text-[10px]">
            {msg.sender === 'user' ? t('chat.me') : personaName}
          </div>
          <div className="leading-relaxed">{msg.message}</div>
        </div>
      ))}
      {pendingAiMessage && (
        <div className="text-xs rounded-lg px-3 py-2 bg-slate-50 text-slate-600 mr-4 animate-in fade-in duration-300">
          <div className="font-semibold mb-0.5 opacity-60 text-[10px]">{personaName}</div>
          <div className="flex items-center gap-1">
            <i className="fas fa-volume-up animate-pulse text-blue-400 text-[10px]"></i>
            <span className="text-blue-500">{t('chat.aiSpeaking') || 'AI가 말하는 중...'}</span>
          </div>
        </div>
      )}
      {pendingUserMessage && (
        <div className="text-xs rounded-lg px-3 py-2 bg-blue-50 text-blue-700 ml-4 animate-in fade-in duration-300">
          <div className="font-semibold mb-0.5 opacity-60 text-[10px]">{t('chat.me')}</div>
          {pendingUserText ? (
            <div className="leading-relaxed">{pendingUserText}</div>
          ) : (
            <div className="flex items-center gap-1">
              <i className="fas fa-microphone animate-pulse text-purple-400 text-[10px]"></i>
              <span className="text-purple-500">{t('chat.recognizing') || '음성 인식 중...'}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const renderHeader = () => (
    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200/50">
      <span className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
        <MessageCircle className="w-3.5 h-3.5 text-purple-500" />
        대화 내역
      </span>
      <button
        onClick={onClose}
        className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-slate-100 active:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  );

  if (isMobile) {
    return (
      <>
        {isOpen && (
          <div
            className="fixed inset-0 z-[28] bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          />
        )}

        <button
          onClick={onToggle}
          className="pointer-events-auto absolute top-1/2 -translate-y-1/2 right-0 w-11 h-11 flex items-center justify-center bg-white/80 backdrop-blur-sm rounded-l-xl shadow-lg border border-white/30 text-slate-600 hover:text-slate-800 active:bg-white transition-all duration-200 z-[29]"
          title={isOpen ? '대화 내역 닫기' : '대화 내역 보기'}
          data-testid="button-toggle-transcript"
        >
          {isOpen ? <X className="w-4 h-4" /> : <MessageCircle className="w-4 h-4" />}
        </button>

        <div
          className={`fixed bottom-0 left-0 right-0 z-[29] bg-white/95 backdrop-blur-md rounded-t-2xl shadow-2xl flex flex-col transition-transform duration-300 ease-out ${
            isOpen ? 'translate-y-0' : 'translate-y-full'
          }`}
          style={{ maxHeight: '60vh', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          <div className="flex justify-center pt-2 pb-1">
            <div className="w-10 h-1 bg-slate-300 rounded-full" />
          </div>
          {renderHeader()}
          {renderMessages(mobileScrollRef)}
        </div>
      </>
    );
  }

  return (
    <div
      className="absolute top-0 right-0 bottom-0 z-30 flex flex-col pointer-events-none"
      style={{ width: isOpen ? panelWidth : '48px' }}
    >
      <button
        onClick={onToggle}
        className="pointer-events-auto absolute top-1/2 -translate-y-1/2 left-0 w-11 h-11 flex items-center justify-center bg-white/80 backdrop-blur-sm rounded-l-xl shadow-lg border border-white/30 text-slate-600 hover:text-slate-800 hover:bg-white transition-all duration-200 z-10"
        title={isOpen ? '대화 내역 닫기' : '대화 내역 보기'}
        data-testid="button-toggle-transcript"
      >
        {isOpen ? <ChevronRight className="w-4 h-4" /> : <MessageCircle className="w-4 h-4" />}
      </button>

      <div
        className={`pointer-events-auto absolute top-0 right-0 bottom-0 bg-white/85 backdrop-blur-md border-l border-white/30 shadow-2xl flex flex-col transition-all duration-300 ${
          isOpen ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-full'
        }`}
        style={{ width: panelWidth }}
      >
        {renderHeader()}
        {renderMessages(desktopScrollRef)}
      </div>
    </div>
  );
}
