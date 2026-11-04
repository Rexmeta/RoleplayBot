import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, CircleAlert, ExternalLink, LoaderCircle, Mic2, Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ComplexScenario, ScenarioPersona } from "@/lib/scenario-system";
import { apiRequest } from "@/lib/queryClient";

type TavusState =
  | "idle"
  | "creating"
  | "create_unknown"
  | "active"
  | "ending"
  | "transcript_pending"
  | "completed";

type TavusMessage = {
  sender: "user" | "ai";
  message: string;
  timestamp: string;
};

type TavusSession = {
  state: TavusState;
  conversationUrl?: string;
  messages?: TavusMessage[];
};

type Props = {
  scenario: ComplexScenario;
  persona: ScenarioPersona;
  conversationId: string;
  onChatComplete: () => void;
  onExit: () => void;
  onReady?: () => void;
  onExitMode: () => void;
};

const sessionUrl = (conversationId: string) =>
  `/api/tavus/conversations/${encodeURIComponent(conversationId)}/session`;

function readError(error: unknown): { code: string; message: string } {
  const raw = error instanceof Error ? error.message : String(error);
  const match = raw.match(/^(\d{3}):\s*([\s\S]*)$/);
  const detail = match?.[2] || raw;
  try {
    const parsed = JSON.parse(detail);
    return {
      code: String(parsed.code || match?.[1] || "REQUEST_FAILED"),
      message: String(parsed.message || parsed.error || detail),
    };
  } catch {
    return { code: match?.[1] || "REQUEST_FAILED", message: detail };
  }
}

export default function TavusChatWindow({
  scenario,
  persona,
  conversationId,
  onChatComplete,
  onExit,
  onReady,
  onExitMode,
}: Props) {
  const { t, i18n } = useTranslation();
  const text = (key: string, english: string, korean: string) =>
    t(`chat.tavus.${key}`, { defaultValue: i18n.language?.startsWith("ko") ? korean : english });
  const [session, setSession] = useState<TavusSession>({ state: "idle" });
  const [consent, setConsent] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [pollingTimedOut, setPollingTimedOut] = useState(false);
  const mountedRef = useRef(true);
  const startAttemptedRef = useRef(false);
  const endRequestedRef = useRef(false);
  const sessionMayExistRef = useRef(false);
  const keepaliveEndAttemptedRef = useRef(false);
  const cleanupRequestedRef = useRef(false);
  const startRequestResolvedRef = useRef(false);
  const readyNotifiedRef = useRef(false);
  const syncAttemptRef = useRef(0);
  const syncFlightRef = useRef<Promise<void> | null>(null);
  const initialPendingSyncRef = useRef(false);
  const completionCallbackFiredRef = useRef(false);
  const exitAfterEndRef = useRef(false);

  const updateSession = useCallback((next: TavusSession) => {
    sessionMayExistRef.current = next.state !== "idle" && next.state !== "completed";
    if (mountedRef.current) setSession(next);
  }, []);

  const notifyReady = () => {
    if (readyNotifiedRef.current) return;
    readyNotifiedRef.current = true;
    onReady?.();
  };

  const requestSession = useCallback(async (method: "GET" | "POST", suffix = "", body?: unknown) => {
    const response = await apiRequest(method, `${sessionUrl(conversationId)}${suffix}`, body);
    return await response.json() as TavusSession;
  }, [conversationId]);

  const keepaliveEnd = useCallback((force = false) => {
    cleanupRequestedRef.current = true;
    if (!conversationId || (keepaliveEndAttemptedRef.current && !force)) return;
    keepaliveEndAttemptedRef.current = true;
    const token = localStorage.getItem("authToken");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    void fetch(`${sessionUrl(conversationId)}/end`, {
      method: "POST",
      headers,
      body: "{}",
      credentials: "include",
      keepalive: true,
    }).then((response) => {
      if (!response.ok && startRequestResolvedRef.current) keepaliveEndAttemptedRef.current = false;
    }).catch(() => {
      keepaliveEndAttemptedRef.current = false;
    });
  }, [conversationId]);

  useEffect(() => {
    mountedRef.current = true;
    notifyReady();
    let disposed = false;
    requestSession("GET")
      .then((result) => {
        if (!disposed) updateSession(result);
      })
      .catch((cause: unknown) => {
        if (!disposed) setError(readError(cause));
      });

    const handlePageHide = () => {
      if (sessionMayExistRef.current || startAttemptedRef.current) keepaliveEnd();
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      disposed = true;
      mountedRef.current = false;
      window.removeEventListener("pagehide", handlePageHide);
      if (sessionMayExistRef.current || startAttemptedRef.current) keepaliveEnd();
    };
  }, [keepaliveEnd, requestSession, updateSession]);

  // The provider can end a room itself (leave/time limit); the server worker then
  // imports its transcript. Also recover a create that was in flight at refresh.
  useEffect(() => {
    if (session.state !== "active" && session.state !== "creating") return;
    let cancelled = false;
    let inFlight = false;
    const timer = window.setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const next = await requestSession("GET");
        if (!cancelled && mountedRef.current) updateSession(next);
      } catch (cause) {
        if (!cancelled && mountedRef.current) setError(readError(cause));
      } finally { inFlight = false; }
    }, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [session.state, requestSession, updateSession]);

  const start = async () => {
    if (!consent || startAttemptedRef.current || isStarting) return;
    startAttemptedRef.current = true;
    sessionMayExistRef.current = true;
    setIsStarting(true);
    setError(null);
    try {
      const result = await requestSession("POST", "/start", { consent: true });
      startRequestResolvedRef.current = true;
      updateSession(result);
      if (cleanupRequestedRef.current) {
        keepaliveEnd(true);
        return;
      }
      if (!mountedRef.current && result.state !== "completed") {
        keepaliveEnd(true);
        return;
      }
      if (result.state === "creating") {
        let current = result;
        for (let attempt = 0; attempt < 30 && current.state === "creating"; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 2000));
          if (!mountedRef.current) {
            keepaliveEnd(true);
            return;
          }
          current = await requestSession("GET");
          updateSession(current);
        }
        if (current.state === "creating" && mountedRef.current) {
          setSession({ state: "create_unknown" });
          setError({
            code: "CREATE_STATUS_TIMEOUT",
            message: text("createTimeout", "The room status did not resolve in time.", "대화 공간 상태가 제한 시간 내에 확인되지 않았습니다."),
          });
        }
        if (current.state === "active" && current.conversationUrl) notifyReady();
      }
      if (result.state === "active" && result.conversationUrl) notifyReady();
    } catch (cause) {
      startRequestResolvedRef.current = true;
      if (mountedRef.current) {
        setSession({ state: "create_unknown" });
        setError(readError(cause));
      } else {
        keepaliveEnd();
      }
    } finally {
      if (mountedRef.current) setIsStarting(false);
    }
  };

  const syncTranscript = (fromRetry = false): Promise<void> => {
    if (syncFlightRef.current) return syncFlightRef.current;
    initialPendingSyncRef.current = true;
    if (fromRetry) syncAttemptRef.current = 0;
    setError(null);
    setPollingTimedOut(false);
    setIsEnding(true);
    const maxAttempts = 30;
    const flight = (async () => {
      try {
        for (let i = syncAttemptRef.current; i < maxAttempts; i += 1) {
          if (!mountedRef.current) return;
          syncAttemptRef.current = i + 1;
          const result = await requestSession("POST", "/sync", {});
          if (!mountedRef.current) return;
          updateSession(result);
          if (result.state === "completed") {
            sessionMayExistRef.current = false;
            endRequestedRef.current = true;
            if (!completionCallbackFiredRef.current) {
              completionCallbackFiredRef.current = true;
              onChatComplete();
            }
            if (exitAfterEndRef.current) onExit();
            return;
          }
          if (result.state !== "transcript_pending" && result.state !== "ending") break;
          await new Promise<void>((resolve) => window.setTimeout(resolve, 3000));
          if (!mountedRef.current) return;
        }
        if (mountedRef.current) setPollingTimedOut(true);
      } catch (cause) {
        if (mountedRef.current) setError(readError(cause));
      } finally {
        if (mountedRef.current) setIsEnding(false);
        syncFlightRef.current = null;
      }
    })();
    syncFlightRef.current = flight;
    return flight;
  };

  useEffect(() => {
    if ((session.state !== "transcript_pending" && session.state !== "ending") || initialPendingSyncRef.current) return;
    void syncTranscript();
  }, [session.state, syncTranscript]);

  const end = async (exitAfter = false) => {
    if (isEnding) return;
    exitAfterEndRef.current = exitAfter;
    setError(null);
    setIsEnding(true);
    endRequestedRef.current = true;
    try {
      const result = await requestSession("POST", "/end", {});
      updateSession(result);
      if (result.state === "completed") {
        sessionMayExistRef.current = false;
        if (!completionCallbackFiredRef.current) {
          completionCallbackFiredRef.current = true;
          onChatComplete();
        }
        if (exitAfter) onExit();
        return;
      }
      if (result.state === "transcript_pending" || result.state === "ending") {
        await syncTranscript();
        return;
      }
      if (result.state === "active") {
        setSession({ ...result, state: "transcript_pending" });
        await syncTranscript();
      }
    } catch (cause) {
      endRequestedRef.current = false;
      setError(readError(cause));
    } finally {
      setIsEnding(false);
    }
  };

  const started = startAttemptedRef.current || session.state !== "idle";
  const canReturnToStandard = !started;
  const statusLabel: Record<TavusState, string> = {
    idle: text("status.ready", "Ready when you are", "준비되었습니다"),
    creating: text("status.creating", "Preparing your room", "대화 공간을 준비하고 있습니다"),
    create_unknown: text("status.unknown", "Room creation needs attention", "대화 공간 상태를 확인해야 합니다"),
    active: text("status.active", "Conversation live", "대화 중"),
    ending: text("status.ending", "Ending conversation", "대화를 종료하고 있습니다"),
    transcript_pending: text("status.transcriptPending", "Saving transcript", "대화 기록을 저장하고 있습니다"),
    completed: text("status.completed", "Conversation complete", "대화가 완료되었습니다"),
  };
  const isBusy = isStarting || isEnding || session.state === "creating" || session.state === "ending";

  return (
    <main className="min-h-[100dvh] bg-[#eef2f4] text-[#17272e]">
      <header className="flex min-h-16 items-center justify-between gap-3 border-b border-[#d6e0e3] bg-[#f8faf9] px-4 py-3 sm:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#d8e8e5] text-[#28675d]">
            <Video className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#55716f]">{text("title", "Tavus Full Pipeline", "Tavus 전체 파이프라인")}</p>
            <h1 className="truncate text-base font-semibold">{scenario.title}</h1>
          </div>
        </div>
        <button
          type="button"
          onClick={() => canReturnToStandard
            ? onExitMode()
            : session.state === "completed"
              ? onExit()
              : void end(true)}
          disabled={isBusy}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-[#ccd8db] px-3 py-2 text-sm font-medium text-[#32484e] transition hover:bg-white disabled:opacity-60"
          data-testid="tavus-exit"
        >
          {canReturnToStandard ? <ArrowLeft className="h-4 w-4" /> : <ExternalLink className="h-4 w-4" />}
          {canReturnToStandard
            ? text("back", "Back to chat modes", "채팅 모드로 돌아가기")
            : session.state === "completed"
              ? text("close", "Close session", "세션 닫기")
              : text("endAndExit", "End and exit", "종료하고 나가기")}
        </button>
      </header>

      <div className="mx-auto grid w-full max-w-[1440px] gap-4 p-3 sm:p-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.8fr)] lg:gap-6">
        <section className="min-w-0 overflow-hidden rounded-2xl border border-[#d3dfe1] bg-[#dfe8e8] shadow-[0_16px_50px_rgba(24,51,58,0.08)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#cbd8d9] bg-[#f8faf9] px-4 py-3 sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#dce7e4] text-sm font-semibold text-[#315b56]">
                {persona.image ? <img src={persona.image} alt="" className="h-full w-full object-cover" /> : persona.name.split(/\s+/).map(part => part[0]).slice(0, 2).join("")}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{persona.name}</p>
                <p className="truncate text-xs text-[#667c80]">{persona.role || persona.department || text("personaFallback", "Scenario persona", "시나리오 페르소나")}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-full bg-[#e7f1ee] px-3 py-1.5 text-xs font-medium text-[#32675d]" role="status" data-testid="tavus-session-status">
              <span className={`h-2 w-2 rounded-full ${session.state === "active" ? "bg-[#3f9a79]" : session.state === "completed" ? "bg-[#71888a]" : "bg-[#c28a49]"}`} />
              {statusLabel[session.state]}
            </div>
          </div>

          <div className="relative aspect-[4/3] min-h-[260px] w-full bg-[#b9c9c9] sm:aspect-video lg:min-h-[420px]">
            {session.conversationUrl && session.state !== "completed" ? (
              <iframe
                title={`${persona.name} conversation`}
                src={session.conversationUrl}
                allow="camera; microphone; autoplay; fullscreen"
                allowFullScreen
                referrerPolicy="no-referrer"
                className="absolute inset-0 h-full w-full border-0"
                onLoad={notifyReady}
                data-testid="tavus-conversation-frame"
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#f1f6f4] text-[#49756b] shadow-sm">
                  <Mic2 className="h-7 w-7" />
                </div>
                <h2 className="text-lg font-semibold text-[#253e43]">
                  {session.state === "completed"
                    ? text("transcriptReady", "Your transcript is ready", "대화 기록이 준비되었습니다")
                    : text("roomReady", "A hosted room, when you are ready", "원할 때 외부 대화 공간을 시작할 수 있습니다")}
                </h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-[#53696d]">
                  {session.state === "completed"
                    ? text("completedDescription", "The conversation has ended and the transcript has been synchronized.", "대화가 종료되고 기록 동기화가 완료되었습니다.")
                    : text("roomDescription", "Tavus connects the persona and live video in its own conversation room. Nothing starts until you consent and choose to begin.", "Tavus가 페르소나와 실시간 영상을 외부 대화 공간에서 연결합니다. 동의하고 시작을 선택하기 전에는 아무것도 시작되지 않습니다.")}
                </p>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#cbd8d9] bg-[#f8faf9] px-4 py-3 sm:px-5">
            <p className="text-xs text-[#698084]">{text("scenario", "Scenario:", "시나리오:")} <span className="font-medium text-[#40595e]">{scenario.title}</span></p>
            {session.state === "active" && (
              <button type="button" onClick={() => void end(false)} disabled={isBusy} className="rounded-lg bg-[#a94338] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#90372f] disabled:opacity-60" data-testid="tavus-end">
                {isBusy ? text("endingButton", "Ending…", "종료 중…") : text("end", "End conversation", "대화 종료")}
              </button>
            )}
            {session.state === "completed" && (
              <>
                <button type="button" onClick={() => {
                  if (!completionCallbackFiredRef.current) {
                    completionCallbackFiredRef.current = true;
                    onChatComplete();
                  }
                }} className="rounded-lg bg-[#28675d] px-4 py-2 text-sm font-semibold text-white hover:bg-[#20584f]" data-testid="tavus-review-report">
                  {text("reviewReport", "Review report", "결과 보고서 보기")}
                </button>
                <button type="button" onClick={onExit} className="rounded-lg border border-[#ccd8db] px-4 py-2 text-sm font-semibold text-[#32484e] hover:bg-white">{text("close", "Close session", "세션 닫기")}</button>
              </>
            )}
          </div>
        </section>

        <aside className="flex min-h-[460px] min-w-0 flex-col overflow-hidden rounded-2xl border border-[#d3dfe1] bg-[#f8faf9] shadow-[0_16px_50px_rgba(24,51,58,0.06)]">
          <div className="border-b border-[#dce5e5] px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#64807f]">{text("transcriptEyebrow", "Session transcript", "세션 대화 기록")}</p>
            <h2 className="mt-1 text-lg font-semibold">{text("transcriptTitle", "Conversation notes", "대화 내용")}</h2>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite" data-testid="tavus-transcript">
            {session.messages?.length ? session.messages.map((message, index) => (
              <article key={`${message.timestamp}-${index}`} className={`max-w-[92%] rounded-xl px-3.5 py-3 ${message.sender === "user" ? "ml-auto bg-[#dceae6]" : "mr-auto bg-[#edf1f1]"}`}>
                <div className="mb-1 flex items-center justify-between gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-[#54716f]">{message.sender === "ai" ? persona.name : text("you", "You", "나")}</span>
                  <time className="text-[10px] text-[#829395]">{new Date(message.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-6 text-[#30464b]">{message.message}</p>
              </article>
            )) : (
              <div className="flex h-full min-h-40 flex-col items-center justify-center px-6 text-center">
                <div className="mb-3 h-9 w-9 rounded-full border border-[#d4e0df] bg-[#f1f6f4]" />
                <p className="text-sm font-medium text-[#52696d]">{text("transcriptEmptyTitle", "Transcript appears here", "대화 기록이 여기에 표시됩니다")}</p>
                <p className="mt-1 max-w-xs text-xs leading-5 text-[#879799]">{text("transcriptEmptyDescription", "Tavus conversation messages are synchronized after the room ends.", "Tavus 대화 기록은 세션 종료 후 동기화됩니다.")}</p>
              </div>
            )}
          </div>

          {canReturnToStandard && (
            <div className="border-t border-[#dce5e5] p-4 sm:p-5">
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#d8e2e1] bg-[#f2f6f4] p-3.5">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[#317367]"
                  data-testid="tavus-consent"
                />
                <span className="text-xs leading-5 text-[#53696d]">
                  {text("consent", "I consent to send my audio and conversation context to Tavus and its service providers to run this session. Provider usage may incur charges.", "이 세션을 위해 내 음성과 대화 맥락을 Tavus 및 서비스 제공자에게 전송하는 데 동의합니다. 제공자 사용에 따라 비용이 발생할 수 있습니다.")}
                </span>
              </label>
              <button type="button" onClick={() => void start()} disabled={!consent || isBusy || startAttemptedRef.current} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#28675d] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#20584f] disabled:cursor-not-allowed disabled:opacity-50" data-testid="tavus-start">
                {isBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
                {session.state === "create_unknown" || startAttemptedRef.current
                  ? text("startNeedsAttention", "Start requires attention", "시작 상태 확인 필요")
                  : text("start", "Start Tavus conversation", "Tavus 대화 시작")}
              </button>
              <p className="mt-2 text-center text-[11px] leading-4 text-[#829395]">{text("noAutoRetry", "Room creation is never retried automatically.", "대화 공간 생성은 자동으로 다시 시도하지 않습니다.")}</p>
            </div>
          )}

          {(error || pollingTimedOut || session.state === "create_unknown") && (
            <div className="border-t border-[#efd5d0] bg-[#fff7f4] p-4" role="alert" data-testid="tavus-error">
              <div className="flex items-start gap-2 text-[#8f4137]">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{error ? `${error.code}: ${error.message}` : text("syncSlow", "Transcript sync is taking longer than expected.", "대화 기록 동기화가 예상보다 오래 걸립니다.")}</p>
                  <p className="mt-1 text-xs leading-5 text-[#9a625a]">
                    {session.state === "create_unknown"
                      ? text("unknownHelp", "The provider may have created a room. Do not start again; end or refresh the session status.", "제공자가 대화 공간을 생성했을 수 있습니다. 다시 시작하지 말고 세션을 종료하거나 상태를 확인하세요.")
                      : text("syncHelp", "You can retry transcript synchronization without creating another conversation.", "새 대화를 만들지 않고 기록 동기화를 다시 시도할 수 있습니다.")}
                  </p>
                </div>
              </div>
              {(session.state === "transcript_pending" || session.state === "ending" || pollingTimedOut) && (
                <button type="button" onClick={() => void syncTranscript(true)} disabled={isBusy} className="mt-3 rounded-lg border border-[#d8aaa2] px-3 py-2 text-xs font-semibold text-[#8f4137] hover:bg-white disabled:opacity-60" data-testid="tavus-sync-retry">
                  {text("retrySync", "Retry transcript sync", "기록 동기화 다시 시도")}
                </button>
              )}
              {session.state === "create_unknown" && (
                <button type="button" onClick={() => void end(true)} disabled={isBusy} className="mt-3 rounded-lg border border-[#d8aaa2] px-3 py-2 text-xs font-semibold text-[#8f4137] hover:bg-white disabled:opacity-60">
                  {text("endPossible", "End possible session and exit", "가능한 세션을 종료하고 나가기")}
                </button>
              )}
            </div>
          )}

          {session.state === "transcript_pending" && isEnding && (
            <div className="flex items-center gap-2 border-t border-[#dce5e5] px-4 py-3 text-xs text-[#607a7d]">
              <LoaderCircle className="h-4 w-4 animate-spin" /> {text("checkingTranscript", "Checking for the final transcript", "최종 대화 기록 확인 중")}
            </div>
          )}
          {session.state === "completed" && !error && (
            <div className="flex items-center gap-2 border-t border-[#dce5e5] px-4 py-3 text-xs text-[#397568]">
              <CheckCircle2 className="h-4 w-4" /> {text("synced", "Transcript synchronized", "대화 기록 동기화 완료")}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
