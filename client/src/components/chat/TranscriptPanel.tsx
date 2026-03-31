import { useEffect, useRef } from "react";
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
  const scrollRef = useRef<HTMLDivElement>(null);

  const panelWidth = 'min(85vw, 300px)';

  useEffect(() => {
    if (!isOpen) return;
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [isOpen, messages, pendingAiMessage, pendingUserMessage]);

  const renderMessages = () => (
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

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-[28] bg-black/40 backdrop-blur-sm sm:hidden"
          onClick={onClose}
        />
      )}

      <button
        onClick={onToggle}
        className="pointer-events-auto fixed sm:absolute top-1/2 -translate-y-1/2 z-30 w-11 h-11 flex items-center justify-center bg-white/80 backdrop-blur-sm rounded-l-xl shadow-lg border border-white/30 text-slate-600 hover:text-slate-800 active:bg-white hover:bg-white"
        style={{
          right: isOpen ? panelWidth : '0',
          transition: 'right 300ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
        title={isOpen ? '대화 내역 닫기' : '대화 내역 보기'}
        data-testid="button-toggle-transcript"
      >
        {isOpen ? <ChevronRight className="w-4 h-4" /> : <MessageCircle className="w-4 h-4" />}
      </button>

      <div
        className={`pointer-events-auto fixed sm:absolute top-0 right-0 bottom-0 z-30 bg-white/95 backdrop-blur-md border-l border-white/30 shadow-2xl flex flex-col ${
          isOpen ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-full'
        }`}
        style={{
          width: panelWidth,
          transition: 'transform 300ms cubic-bezier(0.4, 0, 0.2, 1), opacity 300ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {renderHeader()}
        {renderMessages()}
      </div>
    </>
  );
}
