import { useEffect, useRef, type CSSProperties } from "react";
import { ChevronRight, MessageCircle, X, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ConversationMessage } from "@shared/schema";
import type { PersonaSwitchEvent } from "./PersonaSwitchCard";
import { parseJoinModeSpeakerSegments } from "@/lib/joinModeParser";
import { toMediaUrl } from "@/lib/mediaUrl";
import { RecognitionReview, useRecognitionEvidence } from './RecognitionReview';
import { LedgerMessageStatus } from "./LedgerMessageStatus";

interface JoinedPersona {
  name: string;
  image?: string;
}

interface TranscriptPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  messages: ConversationMessage[];
  pendingAiMessage: boolean;
  pendingUserMessage: boolean;
  pendingUserText: string;
  personaName: string;
  personaSwitchEvents?: PersonaSwitchEvent[];
  joinedPersonas?: JoinedPersona[];
  viewportHeight?: number | null;
  viewportOffsetTop?: number;
  recognitionRunId?: string;
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
  personaSwitchEvents = [],
  joinedPersonas = [],
  viewportHeight,
  viewportOffsetTop = 0,
  recognitionRunId,
}: TranscriptPanelProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  const panelWidth = 'min(85vw, 300px)';
  const evidence = useRecognitionEvidence(recognitionRunId ?? '');
  const canonical = new Map(evidence.data?.map(e => [e.id, e]));

  useEffect(() => {
    if (!isOpen) return;
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [isOpen, messages, pendingAiMessage, pendingUserMessage]);

  const getPersonaImage = (name: string) =>
    joinedPersonas.find(p => p.name === name)?.image;

  const renderAvatar = (name: string) => {
    const image = getPersonaImage(name);
    return (
      <div className="flex-shrink-0 w-5 h-5 rounded-full overflow-hidden border border-slate-200 bg-slate-100">
        {image ? (
          <img src={toMediaUrl(image)} alt={name} className="w-full h-full object-cover object-top" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[8px] font-bold text-slate-500">
            {name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>
    );
  };

  const renderMessages = () => (
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
      {recognitionRunId && <RecognitionReview runId={recognitionRunId} />}
      {messages.filter(m => m.sender === 'user' || m.sender === 'ai').map((msg, index) => (
        <div key={msg.utteranceId ?? index}>
          {msg.sender === 'ai' && (() => {
            const segs = parseJoinModeSpeakerSegments(msg.message);
            if (segs && segs.length > 1) {
              return (
                <div className="space-y-1 mr-4">
                  {segs.map((seg, si) => (
                    <div key={si} className="text-xs rounded-lg px-3 py-2 bg-slate-50 text-slate-800">
                      <div className="flex items-center gap-1 mb-0.5">
                        {renderAvatar(seg.personaName)}
                        <span className="font-semibold opacity-60 text-[10px]">{seg.personaName}</span>
                      </div>
                      <div className="leading-relaxed">{seg.text}</div>
                    </div>
                  ))}
                </div>
              );
            }
            return (
              <div className="text-xs rounded-lg px-3 py-2 bg-slate-50 text-slate-800 mr-4">
                <div className="flex items-center gap-1 mb-0.5">
                  {renderAvatar(personaName)}
                  <span className="font-semibold opacity-60 text-[10px]">{personaName}</span>
                </div>
                <div className="leading-relaxed">{msg.message}</div>
              </div>
            );
          })()}
          {msg.sender === 'user' && (
          <div className="text-xs rounded-lg px-3 py-2 bg-blue-50 text-blue-800 ml-4">
            <div className="font-semibold mb-0.5 opacity-60 text-[10px]">{t('chat.me')}</div>
            <div className="leading-relaxed">
              {(() => {
                const e = msg.voiceTurnId ? canonical.get(msg.voiceTurnId) : undefined;
                if (!e) return msg.message;
                if (e.status === 'confirmed' || e.status === 'verified') return e.canonicalText;
                return <><span className="font-semibold">인식 확인 필요 · Live 원문</span><br />{msg.message}</>;
              })()}
            </div>
          </div>
          )}
          <LedgerMessageStatus row={msg.ledger} />
          {personaSwitchEvents
            .filter(ev =>
              ev.turnIndex != null
                ? msg.turnIndex != null ? msg.turnIndex === ev.turnIndex : index === ev.turnIndex
                : index === ev.toIndex
            )
            .map(ev => (
              <div key={ev.timestamp} className="flex items-center gap-1.5 my-1.5 px-2 py-1 rounded-lg bg-indigo-50 border border-indigo-200 text-[10px] text-indigo-700">
                {ev.fromPersonaName && (
                  <span className="opacity-70 shrink-0">{ev.fromPersonaName}</span>
                )}
                <ArrowRight className="w-2.5 h-2.5 shrink-0 text-indigo-400" />
                <span className="font-semibold shrink-0">{ev.newPersonaName}</span>
                {ev.reason && <span className="opacity-50 truncate">{ev.reason}</span>}
              </div>
            ))}
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
    <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-slate-200/50">
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
    <div
      className="pointer-events-none fixed inset-x-0 top-[var(--transcript-viewport-top)] h-[calc(var(--transcript-viewport-height,100dvh)-env(safe-area-inset-bottom,0px))] sm:absolute sm:inset-0 sm:h-auto z-30"
      style={{
        // Share the voice overlay's visible height instead of Safari's larger
        // layout viewport. Keep both the toggle and body above the home indicator.
        '--transcript-viewport-height': viewportHeight ? `${viewportHeight}px` : undefined,
        '--transcript-viewport-top': `${viewportOffsetTop}px`,
      } as CSSProperties}
    >
      {isOpen && (
        <div
          className="pointer-events-auto fixed inset-0 z-[28] bg-black/40 backdrop-blur-sm sm:hidden"
          onClick={onClose}
        />
      )}

      <button
        onClick={onToggle}
        className="pointer-events-auto absolute top-1/2 -translate-y-1/2 z-30 w-11 h-11 flex items-center justify-center bg-white/80 backdrop-blur-sm rounded-l-xl shadow-lg border border-white/30 text-slate-600 hover:text-slate-800 active:bg-white hover:bg-white"
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
        className={`pointer-events-auto absolute top-0 right-0 bottom-0 z-30 bg-white/95 backdrop-blur-md border-l border-white/30 shadow-2xl flex flex-col ${
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
    </div>
  );
}
