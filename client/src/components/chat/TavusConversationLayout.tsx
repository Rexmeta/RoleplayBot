import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Clock3, LoaderCircle, Mic, MicOff, Settings2 } from "lucide-react";
import { toMediaUrl } from "@/lib/mediaUrl";
import { formatElapsedTime } from "@/hooks/chat/useConversationTimer";
import type { ComplexScenario, ScenarioPersona } from "@/lib/scenario-system";
import type { ConversationMessage } from "@shared/schema";
import { GoalsSidebar } from "./GoalsSidebar";
import { TranscriptPanel } from "./TranscriptPanel";
import { ConversationModeMenu } from "./ConversationModeMenu";
import { LiveAvatarOptionsDialog } from "./LiveAvatarOptionsDialog";
import { VoiceControlSurface, VoiceOverlayHeader } from "./VoiceConversationChrome";
import { ConversationLanguageNotice } from "./ConversationLanguageNotice";

export interface TavusConversationLayoutProps {
  language?: import("@shared/conversationLanguage").ConversationLanguage;
  scenario: ComplexScenario;
  persona: ScenarioPersona;
  statusLabel: string;
  active: boolean;
  elapsedSeconds: number;
  remainingSeconds: number | null;
  headerActions: ReactNode;
  stage: ReactNode;
  sessionControls: ReactNode;
  preStartControls?: ReactNode;
  microphoneState: "idle" | "busy" | "active" | "ended" | "unknown";
  microphoneDisabled: boolean;
  onMicrophoneClick: () => void;
  history: ReactNode;
  transcriptMessages: ConversationMessage[];
  captionsAreProvisional: boolean;
  hasCaptionEvents: boolean;
  onExitMode?: (mode: "text" | "realtime-voice") => void;
  requiresAttention?: boolean;
}

function formatRemainingTime(seconds: number) {
  const wholeSeconds = Math.floor(Math.abs(seconds));
  return `${seconds < 0 ? "-" : ""}${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}

export default function TavusConversationLayout({
  language,
  scenario,
  persona,
  statusLabel,
  active,
  elapsedSeconds,
  remainingSeconds,
  headerActions,
  stage,
  sessionControls,
  preStartControls,
  microphoneState,
  microphoneDisabled,
  onMicrophoneClick,
  history,
  transcriptMessages,
  captionsAreProvisional,
  hasCaptionEvents,
  onExitMode,
  requiresAttention = false,
}: TavusConversationLayoutProps) {
  const { t, i18n } = useTranslation();
  const tx = (key: string, english: string, korean: string) =>
    t(key, { defaultValue: i18n.language?.startsWith("ko") ? korean : english });
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false);
  const [isGoalsExpanded, setIsGoalsExpanded] = useState(false);
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [viewportOffsetTop, setViewportOffsetTop] = useState(0);
  const personaSubtitle = [persona.role, persona.department, scenario.title].filter(Boolean).join(" · ");
  const initials = persona.name.trim().split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join("");
  const captionNotice = captionsAreProvisional ? (
    <div data-testid="live-captions-notice" className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] leading-relaxed text-slate-600">
      <p className="font-semibold">{tx("chat.tavus.browserCaptions", "Browser captions · unverified", "브라우저 자막 · 미확정")}</p>
      <p>{hasCaptionEvents
        ? tx("chat.tavus.captionCaveat", "Delayed captions may include interrupted AI text. Unconfirmed captions are lost on reload.", "중단된 AI 문장이 포함될 수 있습니다. 미확정 자막은 새로고침하면 사라집니다.")
        : tx("chat.tavus.captionWaiting", "No caption events yet. Captions may arrive late or not at all.", "아직 자막 이벤트가 없습니다. 자막이 늦게 오거나 표시되지 않을 수 있습니다.")}</p>
    </div>
  ) : undefined;

  useEffect(() => {
    if (requiresAttention) {
      setIsOptionsOpen(true);
    } else if (active) {
      setIsOptionsOpen(false);
    }
  }, [active, requiresAttention]);

  useEffect(() => {
    const visualViewport = window.visualViewport;
    if (!visualViewport) return;
    const update = () => {
      setViewportHeight(visualViewport.height);
      const layoutHeight = window.innerHeight || visualViewport.height;
      const isViewportShrunk = layoutHeight - visualViewport.height > 120;
      setViewportOffsetTop(isViewportShrunk ? Math.max(0, visualViewport.offsetTop) : 0);
    };
    update();
    visualViewport.addEventListener("resize", update);
    visualViewport.addEventListener("scroll", update);
    return () => {
      visualViewport.removeEventListener("resize", update);
      visualViewport.removeEventListener("scroll", update);
    };
  }, []);

  return (
    <main
      className="fixed inset-0 isolate overflow-hidden bg-[#182426] text-white"
      data-testid="tavus-conversation-layout"
      style={viewportHeight
        ? { top: `${viewportOffsetTop}px`, height: `${viewportHeight}px` }
        : { top: 0, bottom: 0 }}
    >
      <div className="flex h-full min-h-0 w-full">
        <GoalsSidebar
          scenario={scenario}
          personaName={persona.name}
          personaDept={persona.department}
          personaRole={persona.role}
          elapsedTime={elapsedSeconds}
          isGoalsExpanded={isGoalsExpanded}
          onToggleGoals={() => setIsGoalsExpanded(open => !open)}
          variant="sidebar"
        />

        <section className="relative isolate min-w-0 flex-1 overflow-hidden bg-[#182426]" data-testid="tavus-room">
          <div className="absolute inset-0">{stage}</div>

          <VoiceOverlayHeader className="absolute inset-x-0 top-0 z-20 px-3 pb-2 pt-[calc(.5rem+env(safe-area-inset-top,0px))] sm:px-5 sm:pb-3">
            <header className="flex min-w-0 items-center gap-2.5">
              <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full border border-white/25 bg-white/15 sm:h-9 sm:w-9">
                {persona.image ? (
                    <img src={toMediaUrl(persona.image)} alt="" className="h-full w-full object-cover object-top" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-xs font-semibold">{initials}</span>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <h1 className="truncate text-xs font-semibold leading-4 sm:text-sm">{persona.name}</h1>
                {personaSubtitle && <p className="max-w-[min(45vw,32rem)] truncate text-[10px] leading-3 text-white/65 sm:text-[11px]">{personaSubtitle}</p>}
                <div className="mt-0.5 flex items-center gap-1.5 text-[10px] leading-3 text-white/75">
                  <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-[#87d8b8]" : "bg-white/55"}`} />
                  <span role="status" data-testid="tavus-session-status" className="truncate">{statusLabel}</span>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1.5 text-[10px] text-white/80 sm:gap-2 sm:text-xs">
                <Clock3 className="h-3 w-3 text-white/60 sm:h-3.5 sm:w-3.5" />
                <time className="font-mono tabular-nums" data-testid="elapsed-time">{formatElapsedTime(elapsedSeconds)}</time>
                {remainingSeconds !== null && (
                  <time className="border-l border-white/25 pl-1.5 font-mono tabular-nums text-white/65 sm:pl-2" data-testid="remaining-time">
                    {formatRemainingTime(remainingSeconds)}
                  </time>
                )}
              </div>
              <div className="shrink-0 [&_button]:min-h-8 [&_button]:rounded-lg [&_button]:border-white/25 [&_button]:bg-white/10 [&_button]:px-2.5 [&_button]:py-1.5 [&_button]:text-[10px] [&_button]:text-white [&_button]:shadow-none [&_button]:backdrop-blur-sm sm:[&_button]:min-h-9 sm:[&_button]:px-3 sm:[&_button]:text-xs">
                {headerActions}
              </div>
            </header>
          </VoiceOverlayHeader>

          <div className="contents [&>div]:top-[calc(6.5rem+env(safe-area-inset-top,0px))]">
          <GoalsSidebar
            scenario={scenario}
            personaName={persona.name}
            personaDept={persona.department}
            personaRole={persona.role}
            elapsedTime={elapsedSeconds}
            isGoalsExpanded={isGoalsExpanded}
            onToggleGoals={() => setIsGoalsExpanded(open => !open)}
            variant="overlay"
          />
          </div>

          <div className="absolute inset-x-0 bottom-0 z-20 px-3 pb-[calc(.75rem+env(safe-area-inset-bottom,0px))] sm:px-5 sm:pb-5">
            <VoiceControlSurface
              data-testid="tavus-control-surface"
              className="mx-auto flex w-full max-w-4xl flex-col items-center gap-1 px-3 py-2 lg:max-w-6xl xl:max-w-[90%]"
            >
              <div className="flex w-full min-w-0 items-center gap-2 px-1 py-1.5 sm:gap-3" data-testid="live-avatar-control-row">
                <ConversationModeMenu
                  currentMode="live-avatar"
                  onTextModeToggle={onExitMode ? () => onExitMode("text") : undefined}
                  onVoiceModeToggle={onExitMode ? () => onExitMode("realtime-voice") : undefined}
                  disabled={!onExitMode || active}
                />
                <button
                  type="button"
                  onClick={onMicrophoneClick}
                  disabled={microphoneDisabled}
                  className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white shadow-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55 ${
                    microphoneState === "active"
                      ? "bg-red-500 hover:bg-red-600"
                      : "bg-purple-600 hover:bg-purple-700"
                  }`}
                  aria-label={microphoneState === "active"
                    ? tx("chat.endConversation", "End conversation", "대화 종료")
                    : tx("chat.startConversation", "Start conversation", "대화 시작")}
                  aria-pressed={microphoneState === "active"}
                  title={microphoneState === "active"
                    ? tx("chat.endConversation", "End conversation", "대화 종료")
                    : tx("chat.startConversation", "Start conversation", "대화 시작")}
                  data-testid="button-live-avatar-microphone"
                >
                  {microphoneState === "busy"
                    ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
                    : microphoneState === "active"
                      ? <MicOff className="h-5 w-5" aria-hidden="true" />
                      : <Mic className="h-5 w-5" aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  onClick={() => setIsOptionsOpen(true)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2"
                  aria-label={tx("chat.liveAvatarOptionsTitle", "Conversation settings", "대화 설정")}
                  title={tx("chat.liveAvatarOptionsTitle", "Conversation settings", "대화 설정")}
                  data-testid="button-open-live-avatar-settings"
                >
                  <Settings2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              {preStartControls}
            </VoiceControlSurface>
          </div>

          <TranscriptPanel
            isOpen={isTranscriptOpen}
            onToggle={() => setIsTranscriptOpen(open => !open)}
            onClose={() => setIsTranscriptOpen(false)}
            messages={transcriptMessages}
            pendingAiMessage={false}
            pendingUserMessage={false}
            pendingUserText=""
            personaName={persona.name}
            joinedPersonas={[{ name: persona.name, image: persona.image }]}
            viewportHeight={viewportHeight}
            viewportOffsetTop={viewportOffsetTop}
            notice={captionNotice}
          />

          <LiveAvatarOptionsDialog open={isOptionsOpen} onClose={() => setIsOptionsOpen(false)}>
            <div className="space-y-4">
              <section aria-label={tx("chat.settings", "Conversation settings", "대화 설정")}>
                <ConversationLanguageNotice language={language} />
                {sessionControls}
              </section>
              <details className="border-t border-slate-200 pt-3 text-sm text-slate-700">
                <summary className="cursor-pointer select-none py-1 font-medium">
                  {tx("chat.conversationHistory", "Confirmed history & status", "확정 기록 및 상태")}
                </summary>
                <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3">
                  {history}
                </div>
              </details>
            </div>
          </LiveAvatarOptionsDialog>
        </section>
      </div>

    </main>
  );
}
