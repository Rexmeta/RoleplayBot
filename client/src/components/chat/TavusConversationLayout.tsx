import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Clock3, Mic2 } from "lucide-react";
import { formatElapsedTime } from "@/hooks/chat/useConversationTimer";
import type { ComplexScenario, ScenarioPersona } from "@/lib/scenario-system";
import type { ConversationMessage } from "@shared/schema";
import { GoalsSidebar } from "./GoalsSidebar";
import { TranscriptPanel } from "./TranscriptPanel";

export interface TavusConversationLayoutProps {
  scenario: ComplexScenario;
  persona: ScenarioPersona;
  statusLabel: string;
  active: boolean;
  elapsedSeconds: number;
  remainingSeconds: number | null;
  headerActions: ReactNode;
  stage: ReactNode;
  sessionControls: ReactNode;
  history: ReactNode;
  transcriptMessages: ConversationMessage[];
  captionsAreProvisional: boolean;
  hasCaptionEvents: boolean;
}

function formatRemainingTime(seconds: number) {
  const wholeSeconds = Math.floor(Math.abs(seconds));
  return `${seconds < 0 ? "-" : ""}${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, "0")}`;
}

export default function TavusConversationLayout({
  scenario,
  persona,
  statusLabel,
  active,
  elapsedSeconds,
  remainingSeconds,
  headerActions,
  stage,
  sessionControls,
  history,
  transcriptMessages,
  captionsAreProvisional,
  hasCaptionEvents,
}: TavusConversationLayoutProps) {
  const { t, i18n } = useTranslation();
  const tx = (key: string, english: string, korean: string) =>
    t(key, { defaultValue: i18n.language?.startsWith("ko") ? korean : english });
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false);
  const [isGoalsExpanded, setIsGoalsExpanded] = useState(false);
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [viewportOffsetTop, setViewportOffsetTop] = useState(0);
  const personaSubtitle = [persona.role, persona.department, scenario.title].filter(Boolean).join(" · ");
  const initials = persona.name.trim().split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join("");

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
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-44 bg-gradient-to-b from-[#111a1c]/80 via-[#111a1c]/35 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-64 bg-gradient-to-t from-[#10191b]/90 via-[#10191b]/40 to-transparent" />

          <header className="absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 px-3 pt-[calc(.75rem+env(safe-area-inset-top,0px))] sm:px-5 sm:pt-5">
            <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/15 bg-[#142022]/55 px-3 py-2.5 shadow-lg backdrop-blur-md sm:px-4">
              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-white/30 bg-white/15 sm:h-11 sm:w-11">
                {persona.image ? (
                  <img src={persona.image} alt="" className="h-full w-full object-cover object-top" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-sm font-semibold">{initials}</span>
                )}
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-sm font-semibold leading-5 sm:text-base">{persona.name}</h1>
                {personaSubtitle && <p className="max-w-[min(52vw,32rem)] truncate text-[11px] leading-4 text-white/65 sm:text-xs">{personaSubtitle}</p>}
                <div className="mt-1 flex items-center gap-1.5 text-[10px] leading-3 text-white/80">
                  <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-[#87d8b8]" : "bg-white/55"}`} />
                  <span role="status" data-testid="tavus-session-status">{statusLabel}</span>
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <div className="hidden items-center gap-2 rounded-xl border border-white/15 bg-[#142022]/55 px-3 py-2 text-xs text-white/85 shadow-lg backdrop-blur-md sm:flex">
                <Clock3 className="h-3.5 w-3.5 text-white/65" />
                <time className="font-mono tabular-nums" data-testid="elapsed-time">{formatElapsedTime(elapsedSeconds)}</time>
                {remainingSeconds !== null && <time className="border-l border-white/20 pl-2 font-mono tabular-nums text-white/65" data-testid="remaining-time">{formatRemainingTime(remainingSeconds)}</time>}
              </div>
              <div className="[&_button]:rounded-xl [&_button]:border-white/25 [&_button]:bg-[#142022]/55 [&_button]:px-3 [&_button]:py-2 [&_button]:text-xs [&_button]:shadow-lg [&_button]:backdrop-blur-md">
                {headerActions}
              </div>
            </div>
          </header>

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

          <div className="absolute right-4 top-[calc(6.9rem+env(safe-area-inset-top,0px))] z-10 flex items-center gap-2 text-[10px] text-white/70 sm:hidden">
            <Clock3 className="h-3 w-3" />
            <time className="font-mono tabular-nums">{formatElapsedTime(elapsedSeconds)}</time>
            {remainingSeconds !== null && <span className="font-mono tabular-nums text-white/50">· {formatRemainingTime(remainingSeconds)}</span>}
          </div>

          <div className="absolute inset-x-0 bottom-0 z-20 px-3 pb-[calc(.75rem+env(safe-area-inset-bottom,0px))] sm:px-5 sm:pb-5">
            <div className="mx-auto max-h-[min(44dvh,25rem)] w-full max-w-3xl overflow-y-auto overscroll-contain rounded-2xl border border-white/15 bg-[#172426]/78 p-3 shadow-2xl backdrop-blur-xl sm:p-4">
              <div className="mb-2 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[.12em] text-white/45">
                <Mic2 className="h-3 w-3" />
                <span>{tx("chat.tavus.sessionControls", "Session controls", "세션 제어")}</span>
              </div>
              {sessionControls}
              <details className="mt-3 border-t border-white/10 pt-2 text-xs text-white/75">
                <summary className="cursor-pointer select-none py-1 font-medium marker:text-white/50">
                  {tx("chat.conversationHistory", "Confirmed history & status", "확정 기록 및 상태")}
                </summary>
                <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-white/10 bg-[#0e181a]/55 p-3">
                  {history}
                </div>
              </details>
            </div>
          </div>

          {captionsAreProvisional && (
            <div className="pointer-events-none absolute right-3 top-[calc(9.5rem+env(safe-area-inset-top,0px))] z-[31] max-w-[min(82vw,19rem)] rounded-xl border border-white/15 bg-[#172426]/75 px-3 py-2 text-[10px] leading-4 text-white/75 shadow-lg backdrop-blur-md sm:right-[calc(min(85vw,300px)+1rem)] sm:top-28">
              <p className="font-semibold text-white/90">{tx("chat.tavus.browserCaptions", "Browser captions · unverified", "브라우저 자막 · 미확정")}</p>
              <p>{hasCaptionEvents
                ? tx("chat.tavus.captionCaveat", "Delayed captions may include interrupted AI text. Unconfirmed captions are lost on reload.", "중단된 AI 문장이 포함될 수 있습니다. 미확정 자막은 새로고침하면 사라집니다.")
                : tx("chat.tavus.captionWaiting", "No caption events yet. Captions may arrive late or not at all.", "아직 자막 이벤트가 없습니다. 자막이 늦게 오거나 표시되지 않을 수 있습니다.")}</p>
            </div>
          )}

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
          />
        </section>
      </div>

    </main>
  );
}
