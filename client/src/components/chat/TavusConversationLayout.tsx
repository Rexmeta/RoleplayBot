import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatElapsedTime } from "@/hooks/chat/useConversationTimer";
import type { ComplexScenario, ScenarioPersona } from "@/lib/scenario-system";

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
}

function formatRemainingTime(seconds: number) {
  const wholeSeconds = Math.floor(Math.abs(seconds));
  const minutes = Math.floor(wholeSeconds / 60);
  const remainder = wholeSeconds % 60;
  return `${seconds < 0 ? "-" : ""}${minutes}:${String(remainder).padStart(2, "0")}`;
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
}: TavusConversationLayoutProps) {
  const { t, i18n } = useTranslation();
  const tx = (key: string, english: string, korean: string) =>
    t(key, { defaultValue: i18n.language?.startsWith("ko") ? korean : english });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const role = scenario.context?.playerRole;
  const roleDescription = scenario.context?.playerRoleText || role?.responsibility;
  const objectives = scenario.objectives ?? [];
  const initials = persona.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("");
  const historyHeading = tx("chat.conversationHistory", "Conversation history", "대화 기록");

  return (
    <main
      className="min-h-[100dvh] bg-slate-100/80 px-3 py-3 text-slate-800 sm:px-5 sm:py-5"
      data-testid="tavus-conversation-layout"
    >
      <div className="mx-auto w-full max-w-[1440px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <header className="bg-gradient-to-r from-corporate-600 to-corporate-700 px-4 py-3 text-white sm:px-6 sm:py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border-2 border-white/30 bg-white/15 shadow-sm">
                {persona.image ? (
                  <img src={persona.image} alt="" className="h-full w-full object-cover object-top" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-sm font-semibold">
                    {initials}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-base font-semibold sm:text-lg">{persona.name}</h1>
                <p className="truncate text-xs text-blue-100 sm:text-sm">
                  {[persona.role, persona.department, scenario.title].filter(Boolean).join(" · ")}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <div
                className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-white/95"
                role="status"
                data-testid="tavus-session-status"
              >
                <span className={`h-2 w-2 rounded-full ${active ? "bg-emerald-300" : "bg-white/60"}`} />
                {statusLabel}
              </div>
              {headerActions}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-white/15 pt-3 text-xs text-white/85">
            <span className="inline-flex items-center gap-2">
              <span className="text-white/65">{tx("chat.elapsed", "Elapsed", "경과 시간")}</span>
              <time className="font-mono font-medium tabular-nums" data-testid="elapsed-time">
                {formatElapsedTime(elapsedSeconds)}
              </time>
            </span>
            {remainingSeconds !== null && (
              <span className="inline-flex items-center gap-2">
                <span className="text-white/65">{tx("chat.remaining", "Remaining", "남은 시간")}</span>
                <time className="font-mono font-medium tabular-nums" data-testid="remaining-time">
                  {formatRemainingTime(remainingSeconds)}
                </time>
              </span>
            )}
          </div>
        </header>

        <div className="grid min-w-0 gap-3 p-3 sm:gap-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
          <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
            <div
              className="relative isolate aspect-[4/3] min-h-[260px] w-full overflow-hidden bg-slate-200 sm:aspect-video sm:min-h-[320px] lg:min-h-[400px]"
              data-testid="tavus-room"
            >
              <div className="absolute inset-0 min-w-0">{stage}</div>
            </div>
            <div className="border-t border-slate-200 bg-white px-3 py-3 sm:px-4">
              {sessionControls}
            </div>

            <section className="border-t border-slate-200 bg-white">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-corporate-500"
                aria-expanded={contextOpen}
                aria-controls="tavus-scenario-context"
                onClick={() => setContextOpen((open) => !open)}
                data-testid="tavus-context-toggle"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-800">
                    {tx("chat.yourRoleAndGoals", "Your role & goals", "내 역할과 목표")}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">{scenario.title}</span>
                </span>
                <span className="shrink-0 text-xs font-medium text-corporate-700">
                  {contextOpen ? tx("common.close", "Close", "닫기") : tx("common.view", "View", "보기")}
                </span>
              </button>
              {contextOpen && (
                <div id="tavus-scenario-context" className="space-y-4 border-t border-slate-100 px-4 py-4">
                  {(roleDescription || role?.position || role?.department) && (
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <h2 className="text-xs font-semibold text-corporate-700">
                          {tx("chat.yourRole", "Your role", "내 역할")}
                        </h2>
                        <span className="text-xs text-slate-500">
                          {[role?.position, role?.department, role?.experience].filter(Boolean).join(" · ") ||
                            persona.role ||
                            persona.department}
                        </span>
                      </div>
                      {roleDescription && (
                        <p className="mt-2 break-words rounded-lg bg-slate-50 px-3 py-2 text-sm leading-relaxed text-slate-700">
                          {roleDescription}
                        </p>
                      )}
                    </div>
                  )}
                  {objectives.length > 0 && (
                    <div className="min-w-0">
                      <h2 className="text-xs font-semibold text-corporate-700">
                        {tx("chat.achievementGoals", "Goals", "달성 목표")}
                      </h2>
                      <ul className="mt-2 space-y-2">
                        {objectives.map((objective, index) => (
                          <li key={`${index}-${objective}`} className="flex min-w-0 items-start gap-2 text-sm leading-relaxed text-slate-700">
                            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-corporate-500" aria-hidden="true" />
                            <span className="min-w-0 break-words">{objective}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {!roleDescription && !role?.position && !role?.department && objectives.length === 0 && (
                    <p className="text-sm text-slate-500">
                      {tx("chat.noScenarioDetails", "No role or goals are provided for this scenario.", "이 시나리오에 지정된 역할과 목표가 없습니다.")}
                    </p>
                  )}
                </div>
              )}
            </section>
          </section>

          <aside className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white" data-testid="tavus-history-panel">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-corporate-500 lg:hidden"
              aria-expanded={historyOpen}
              aria-controls="tavus-history-content"
              onClick={() => setHistoryOpen((open) => !open)}
              data-testid="tavus-history-toggle"
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-800">{historyHeading}</span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  {tx("chat.tavus.historyConfirmedSubtitle", "Confirmed history is saved after the session ends", "종료 후 확정 대화 기록이 저장됩니다")}
                </span>
              </span>
              <span className="shrink-0 text-xs font-medium text-corporate-700">
                {historyOpen ? tx("common.close", "Close", "닫기") : tx("common.view", "View", "보기")}
              </span>
            </button>
            <div className="hidden border-b border-slate-200 px-4 py-3 lg:block">
              <h2 className="text-sm font-semibold text-slate-800">{historyHeading}</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {tx("chat.tavus.historyConfirmedSubtitle", "Confirmed history is saved after the session ends", "종료 후 확정 대화 기록이 저장됩니다")}
              </p>
            </div>
            <div
              id="tavus-history-content"
              className={`${historyOpen ? "block" : "hidden"} max-h-[65dvh] min-w-0 overflow-y-auto overscroll-contain lg:block lg:max-h-[min(72dvh,760px)]`}
            >
              {history}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
