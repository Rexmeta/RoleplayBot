import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircle, Mic, MicOff, Settings2 } from "lucide-react";
import { toMediaUrl } from "@/lib/mediaUrl";
import { formatElapsedTime } from "@/hooks/chat/useConversationTimer";
import type { ComplexScenario, ScenarioPersona } from "@/lib/scenario-system";
import type { ConversationMessage } from "@shared/schema";
import { GoalsSidebar } from "./GoalsSidebar";
import { TranscriptPanel } from "./TranscriptPanel";
import { ConversationModeMenu } from "./ConversationModeMenu";
import { LiveAvatarOptionsDialog } from "./LiveAvatarOptionsDialog";
import { VoiceControlSurface } from "./VoiceConversationChrome";
import { PersonaSessionStrip } from "./PersonaSessionStrip";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ConversationLanguageNotice } from "./ConversationLanguageNotice";

export interface TavusConversationLayoutProps {
  language?: import("@shared/conversationLanguage").ConversationLanguage;
  scenario: ComplexScenario;
  persona: ScenarioPersona;
  statusLabel: string;
  active: boolean;
  elapsedSeconds: number;
  remainingSeconds: number | null;
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
  /** Confirmed early end: closes the session and generates feedback when available. */
  onEarlyEnd?: () => void;
  /** Ends the session without feedback and returns to the scenario detail. */
  onReturnToScenario?: () => void;
  earlyEndDisabled?: boolean;
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
  onEarlyEnd,
  onReturnToScenario,
  earlyEndDisabled = false,
  requiresAttention = false,
}: TavusConversationLayoutProps) {
  const { t, i18n } = useTranslation();
  const tx = (key: string, english: string, korean: string) =>
    t(key, { defaultValue: i18n.language?.startsWith("ko") ? korean : english });
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false);
  const [isGoalsExpanded, setIsGoalsExpanded] = useState(false);
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [isEarlyEndOpen, setIsEarlyEndOpen] = useState(false);
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
              <div className="sr-only">
                <span role="status" data-testid="tavus-session-status">{statusLabel}</span>
                <time data-testid="elapsed-time">{formatElapsedTime(elapsedSeconds)}</time>
                {remainingSeconds !== null && <time data-testid="remaining-time">{formatRemainingTime(remainingSeconds)}</time>}
              </div>
              <div className="-mx-3 -mt-2 w-[calc(100%+1.5rem)] overflow-hidden rounded-t-2xl">
                <PersonaSessionStrip
                  name={persona.name}
                  imageUrl={persona.image ? toMediaUrl(persona.image) : null}
                  description={personaSubtitle || null}
                  progressPercentage={remainingSeconds === null ? 0 : (elapsedSeconds / Math.max(1, elapsedSeconds + remainingSeconds)) * 100}
                  progressBarClass="bg-blue-400"
                  toneClass="text-slate-600"
                  statusLabel={<span className="block max-w-[16rem] truncate">{statusLabel}</span>}
                  elapsedLabel={<>
                    <time>{formatElapsedTime(elapsedSeconds)}</time>
                    {remainingSeconds !== null && <time className="ml-1.5 border-l border-slate-300 pl-1.5">{formatRemainingTime(remainingSeconds)}</time>}
                  </>}
                  endAction={active && onEarlyEnd ? (
                    <Button size="sm" variant="outline" onClick={() => setIsEarlyEndOpen(true)} disabled={earlyEndDisabled}
                      data-testid="button-end-conversation-persona-strip"
                      className="h-8 border px-3 text-xs text-slate-600 border-slate-300 hover:bg-slate-50">
                      {tx("chat.endEarly", "End Early", "조기 종료")}
                    </Button>
                  ) : undefined}
                />
              </div>
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

          <AlertDialog open={isEarlyEndOpen} onOpenChange={setIsEarlyEndOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{tx("chat.endConversationTitle", "End the conversation?", "대화를 종료하시겠습니까?")}</AlertDialogTitle>
                <AlertDialogDescription>{tx("chat.endConversationDesc", "Ending now closes the live session. You can generate feedback from what was said so far.", "지금 종료하면 라이브 세션이 닫힙니다. 지금까지의 대화로 피드백을 생성할 수 있습니다.")}</AlertDialogDescription>
              </AlertDialogHeader>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-between">
                {onReturnToScenario && (
                  <Button variant="outline" onClick={() => { setIsEarlyEndOpen(false); onReturnToScenario(); }} data-testid="button-return-to-scenario">
                    {tx("chat.returnToScenario", "Back to scenario", "시나리오로 돌아가기")}
                  </Button>
                )}
                <div className="flex justify-end gap-2">
                  <AlertDialogCancel data-testid="button-cancel-end-conversation">{tx("chat.cancel", "Cancel", "취소")}</AlertDialogCancel>
                  <Button onClick={() => { setIsEarlyEndOpen(false); onEarlyEnd?.(); }} data-testid="button-confirm-end-conversation" className="bg-purple-600 hover:bg-purple-700">
                    {tx("chat.yesGenerateFeedback", "End and get feedback", "종료하고 피드백 받기")}
                  </Button>
                </div>
              </div>
            </AlertDialogContent>
          </AlertDialog>

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
