import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, CircleAlert, LoaderCircle, Mic2, Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ComplexScenario, ScenarioPersona } from "@/lib/scenario-system";
import { apiRequest } from "@/lib/queryClient";
import DailyAvatarRoom from "./DailyAvatarRoom";

type SessionState = "idle" | "creating" | "create_unknown" | "active" | "ending" | "ended";
type Session = { state: SessionState; error?: string; expiresAt?: string; evaluationAvailable?: false };
type Config = {
  available: boolean; blockers?: string[];
  runtime?: { userRemainingSeconds: number; globalRemainingSeconds: number; sessionSeconds: number; resetsAt: string } | null;
};
type Connection = { transport: "daily"; pipeline: "tavus_full"; url: string; token: string; expiresAt?: string };
type Props = {
  scenario: ComplexScenario;
  persona: ScenarioPersona;
  conversationId: string;
  onChatComplete: () => void;
  onExit: () => void;
  onReady?: () => void;
  onExitMode: () => void;
};

const sessionUrl = (id: string) => `/api/tavus/conversations/${encodeURIComponent(id)}`;

function errorDetails(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  const match = raw.match(/^(\d{3}):\s*([\s\S]*)$/);
  let message = match?.[2] || raw;
  let code = match?.[1] || "REQUEST_FAILED";
  let creationAttempted: false | undefined;
  try {
    const parsed = JSON.parse(message);
    code = String(parsed.code || code);
    message = String(parsed.message || parsed.error || message);
    if (parsed.creationAttempted === false) creationAttempted = false;
  } catch { /* Keep the server's plain-text message. */ }
  message = message
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, "$1[redacted]")
    .replace(/([?&]token=)[^&\s]+/gi, "$1[redacted]")
    .replace(/((?:access[_-]?token|token)\s*[:=]\s*)["']?[^"',\s}]+/gi, "$1[redacted]");
  return { code, message, creationAttempted };
}

export default function TavusChatWindow({
  scenario, persona, conversationId, onExit, onReady, onExitMode,
}: Props) {
  const { t, i18n } = useTranslation();
  const text = (key: string, english: string, korean: string) =>
    t(`chat.tavus.${key}`, { defaultValue: i18n.language?.startsWith("ko") ? korean : english });
  const reasonText = (code: string) => {
    switch (code) {
      case "avatar_runtime_worker_unavailable": return text("workerUnavailable", "AvatarRouter's worker is not ready. The router operator must check worker health.", "AvatarRouter 작업 서버가 준비되지 않았습니다. 라우터 운영자의 서버 상태 확인이 필요합니다.");
      case "avatar_runtime_cleanup_pending": return text("cleanupPending", "A previous avatar session is still being cleaned up. Check again after cleanup finishes; if it persists, contact the router operator.", "이전 아바타 세션을 정리 중입니다. 정리가 끝난 뒤 다시 확인하세요. 계속되면 라우터 운영자의 확인이 필요합니다.");
      case "avatar_runtime_user_budget_insufficient": return text("userBudget", "Your remaining avatar time is shorter than one session. Wait for the budget reset or ask the router operator to review the limit.", "사용자 잔여 시간이 한 세션에 필요한 시간보다 적습니다. 한도 초기화를 기다리거나 라우터 운영자에게 한도 확인을 요청하세요.");
      case "avatar_runtime_global_budget_insufficient": return text("globalBudget", "The project's remaining avatar time is insufficient. Wait for the budget reset or ask the router operator to review the limit.", "프로젝트 잔여 아바타 시간이 부족합니다. 한도 초기화를 기다리거나 라우터 운영자에게 한도 확인을 요청하세요.");
      case "avatar_runtime_creation_blocked": return text("creationBlocked", "AvatarRouter is blocking new sessions because of service capacity or cleanup restrictions. The router operator must check admission status.", "AvatarRouter가 서비스 용량 또는 정리 제한으로 새 세션 생성을 차단했습니다. 라우터 운영자의 생성 허용 상태 확인이 필요합니다.");
      default: return code;
    }
  };
  const displayError = (details: { code: string; message: string }) =>
    reasonText(details.code) !== details.code ? reasonText(details.code) :
      details.code === details.message ? details.code : `${details.code}: ${details.message}`;
  const [session, setSession] = useState<Session>({ state: "idle" });
  const [config, setConfig] = useState<Config | null>(null);
  const [consent, setConsent] = useState(false);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [connectionError, setConnectionError] = useState<{ code: string; message: string } | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [statusChecking, setStatusChecking] = useState(false);
  const [endFailed, setEndFailed] = useState(false);
  const startedRef = useRef(false);
  const sessionStateRef = useRef<SessionState>("idle");
  const endRequestedRef = useRef(false);
  const endInFlightRef = useRef(false);
  const requestInFlightRef = useRef(false);
  const mountedRef = useRef(false);
  const endKeepaliveSentRef = useRef(false);
  const readyRef = useRef(false);
  const connectionRequestRef = useRef(false);
  const connectionAttemptedRef = useRef(false);

  const updateSession = useCallback((next: Session) => {
    if (next.state === "ended") endRequestedRef.current = false;
    sessionStateRef.current = endRequestedRef.current && next.state === "active" ? "ending" : next.state;
    const visibleSession = endRequestedRef.current && next.state === "active" ? { ...next, state: "ending" as const } : next;
    if (mountedRef.current) setSession(visibleSession);
    if (mountedRef.current && next.error) setError(errorDetails(next.error));
  }, []);

  const notifyReady = useCallback(() => {
    if (!readyRef.current) {
      readyRef.current = true;
      onReady?.();
    }
  }, [onReady]);

  const requestSession = useCallback(async (method: "GET" | "POST", suffix = "", body?: unknown) => {
    const response = await apiRequest(method, `${sessionUrl(conversationId)}${suffix || "/session"}`, body);
    return await response.json() as Session;
  }, [conversationId]);

  const endKeepalive = useCallback(() => {
    endRequestedRef.current = true;
    if (!conversationId || endKeepaliveSentRef.current) return;
    endKeepaliveSentRef.current = true;
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
      if (!response.ok) endKeepaliveSentRef.current = false;
    }).catch(() => { endKeepaliveSentRef.current = false; });
  }, [conversationId]);

  const checkConnection = useCallback(async () => {
    if (connectionRequestRef.current || connectionAttemptedRef.current) return;
    connectionAttemptedRef.current = true;
    connectionRequestRef.current = true;
    setConnectionError(null);
    try {
      const response = await apiRequest("GET", `/api/tavus/conversations/${encodeURIComponent(conversationId)}/connection`);
      const result = await response.json() as Connection;
      if (!mountedRef.current) return;
      if (result.transport !== "daily" || result.pipeline !== "tavus_full" || !result.url || !result.token) {
        throw new Error("Connection details were incomplete.");
      }
      setConnection(result);
    } catch (cause) {
      if (mountedRef.current) setConnectionError(errorDetails(cause));
    } finally {
      connectionRequestRef.current = false;
    }
  }, [conversationId]);

  const refreshStatus = useCallback(async () => {
    if (requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    setStatusChecking(true);
    setError(null);
    try {
      const next = await requestSession("GET");
      if (!mountedRef.current) return;
      updateSession(next);
      if (sessionStateRef.current === "idle") {
        const response = await apiRequest("GET", `/api/tavus/config?runId=${encodeURIComponent(conversationId)}`);
        const nextConfig = await response.json() as Config;
        if (mountedRef.current) setConfig(nextConfig);
      }
      if (next.state === "active") void checkConnection();
      if (next.state === "ended") {
        setConnection(null);
        setEndFailed(false);
      }
    } catch (cause) {
      if (mountedRef.current) setError(errorDetails(cause));
    } finally {
      requestInFlightRef.current = false;
      if (mountedRef.current) setStatusChecking(false);
    }
  }, [checkConnection, requestSession, updateSession]);

  useEffect(() => {
    mountedRef.current = true;
    notifyReady();
    let cancelled = false;
    Promise.all([
      apiRequest("GET", `/api/tavus/config?runId=${encodeURIComponent(conversationId)}`).then(response => response.json() as Promise<Config>),
      requestSession("GET"),
    ]).then(([nextConfig, nextSession]) => {
      if (cancelled) return;
      setConfig(nextConfig);
      updateSession(nextSession);
      if (nextSession.state === "active") void checkConnection();
    }).catch(cause => {
      if (!cancelled) setError(errorDetails(cause));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    const pageHide = () => {
      if (startedRef.current || sessionStateRef.current !== "idle") endKeepalive();
    };
    window.addEventListener("pagehide", pageHide);
    return () => {
      cancelled = true;
      mountedRef.current = false;
      window.removeEventListener("pagehide", pageHide);
      if (startedRef.current || sessionStateRef.current !== "idle") endKeepalive();
    };
  // Initial session/config bootstrap is intentionally one-shot for this conversation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    if (!["creating", "active", "ending"].includes(session.state)) return;
    let cancelled = false;
    let inFlight = false;
    const timer = window.setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const next = await requestSession("GET");
        if (!cancelled && mountedRef.current) {
          updateSession(next);
          if (next.state === "active" && !connection && !connectionAttemptedRef.current) void checkConnection();
          if (next.state === "ended") {
            setError(null);
            setConnection(null);
            setEndFailed(false);
          } else if (next.error) setError(errorDetails(next.error));
          else if (!endFailed) setError(null);
        }
      } catch (cause) {
        if (!cancelled && mountedRef.current) setError(errorDetails(cause));
      } finally { inFlight = false; }
    }, 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [session.state, connection, requestSession, checkConnection, updateSession, endFailed]);

  const start = async () => {
    if (!consent || startedRef.current || starting || !config?.available) return;
    startedRef.current = true;
    setStarting(true);
    setError(null);
    try {
      const next = await requestSession("POST", "/start", { consent: true });
      if (endRequestedRef.current && next.state !== "ended") {
        endKeepaliveSentRef.current = false;
        endKeepalive();
        if (mountedRef.current) updateSession({ ...next, state: "ending" });
        return;
      }
      if (!mountedRef.current) {
        if (next.state !== "ended") {
          endKeepaliveSentRef.current = false;
          endKeepalive();
        }
        return;
      }
      updateSession(next);
      if (next.state === "active") void checkConnection();
    } catch (cause) {
      if (mountedRef.current) {
        const details = errorDetails(cause);
        if (details.creationAttempted === false) {
          startedRef.current = false;
          updateSession({ state: "idle" });
          // Disable stale admission until the user explicitly refreshes it.
          setConfig(current => ({ ...current, available: false, blockers: [details.code] }));
        } else updateSession({ state: "create_unknown" });
        setError(details);
      } else endKeepalive();
    } finally {
      if (mountedRef.current) setStarting(false);
    }
  };

  const end = async () => {
    if (endInFlightRef.current || session.state === "ended") return;
    endInFlightRef.current = true;
    setEnding(true);
    setEndFailed(false);
    setError(null);
    setConnectionError(null);
    setConnection(null);
    endRequestedRef.current = true;
    updateSession({ ...session, state: "ending" });
    try {
      const next = await requestSession("POST", "/end", {});
      if (!mountedRef.current) return;
      updateSession(next.state === "active" ? { ...next, state: "ending" } : next);
      if (next.state === "ended") setEndFailed(false);
    } catch (cause) {
      if (mountedRef.current) {
        setError(errorDetails(cause));
        setEndFailed(true);
      }
    } finally {
      endInFlightRef.current = false;
      if (mountedRef.current) setEnding(false);
    }
  };

  const started = startedRef.current || session.state !== "idle";
  const busy = starting || ending || session.state === "creating" || session.state === "ending";
  const labels: Record<SessionState, string> = {
    idle: text("status.ready", "Ready when you are", "준비되었습니다"),
    creating: text("status.creating", "Preparing your room", "대화 공간을 준비하고 있습니다"),
    create_unknown: text("status.unknown", "Room status needs attention", "대화 공간 상태를 확인해야 합니다"),
    active: text("status.active", "Conversation live", "대화 중"),
    ending: text("status.ending", "Ending session", "세션 종료 중"),
    ended: text("status.ended", "Session closed", "세션 종료됨"),
  };
  const blockers = config?.blockers || [];

  return (
    <main className="min-h-[100dvh] bg-[#eef2f4] text-[#17272e]">
      <header className="flex min-h-16 items-center justify-between gap-3 border-b border-[#d6e0e3] bg-[#f8faf9] px-4 py-3 sm:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#d8e8e5] text-[#28675d]"><Video className="h-5 w-5" /></div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#55716f]">{text("title", "Tavus Full Pipeline", "Tavus 전체 파이프라인")}</p>
            <h1 className="truncate text-base font-semibold">{scenario.title}</h1>
          </div>
        </div>
        <button type="button" onClick={() => started ? session.state === "ended" || endFailed ? onExit() : void end() : onExitMode()} disabled={busy && !endFailed}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-[#ccd8db] px-3 py-2 text-sm font-medium text-[#32484e] transition hover:bg-white disabled:opacity-60" data-testid="tavus-exit">
          {started ? <CheckCircle2 className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}
          {started ? session.state === "ended" ? text("close", "Close session", "세션 닫기") : endFailed ? text("exitAnyway", "Exit anyway", "종료하고 나가기") : text("endAndExit", "End and exit", "종료하고 나가기") : text("back", "Back to chat modes", "채팅 모드로 돌아가기")}
        </button>
      </header>

      <div className="mx-auto grid w-full max-w-[1440px] gap-4 p-3 sm:p-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.8fr)] lg:gap-6">
        <section className="min-w-0 overflow-hidden rounded-2xl border border-[#d3dfe1] bg-[#dfe8e8] shadow-[0_16px_50px_rgba(24,51,58,0.08)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#cbd8d9] bg-[#f8faf9] px-4 py-3 sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#dce7e4] text-sm font-semibold text-[#315b56]">
                {persona.image ? <img src={persona.image} alt="" className="h-full w-full object-cover" /> : persona.name.split(/\s+/).map(part => part[0]).slice(0, 2).join("")}
              </div>
              <div className="min-w-0"><p className="truncate text-sm font-semibold">{persona.name}</p><p className="truncate text-xs text-[#667c80]">{persona.role || persona.department || text("personaFallback", "Scenario persona", "시나리오 페르소나")}</p></div>
            </div>
            <div className="flex items-center gap-2 rounded-full bg-[#e7f1ee] px-3 py-1.5 text-xs font-medium text-[#32675d]" role="status" data-testid="tavus-session-status">
              <span className={`h-2 w-2 rounded-full ${session.state === "active" ? "bg-[#3f9a79]" : session.state === "ended" ? "bg-[#71888a]" : "bg-[#c28a49]"}`} />{labels[session.state]}
            </div>
          </div>
          <div className="relative aspect-[4/3] min-h-[260px] w-full bg-[#b9c9c9] sm:aspect-video lg:min-h-[420px]" data-testid="tavus-room">
            {session.state === "active" && connection ? <DailyAvatarRoom connection={connection} onError={(message) => setConnectionError({ code: "DAILY_ROOM_ERROR", message })} /> : (
              <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#f1f6f4] text-[#49756b] shadow-sm">
                  {busy || loading ? <LoaderCircle className="h-7 w-7 animate-spin" /> : <Mic2 className="h-7 w-7" />}
                </div>
                <h2 className="text-lg font-semibold text-[#253e43]">{session.state === "ended" ? text("closedTitle", "This session is closed", "이 세션은 종료되었습니다") : loading ? text("loading", "Checking session availability", "세션 상태를 확인하고 있습니다") : text("roomReady", "A private room, when you are ready", "원할 때 비공개 대화 공간을 시작할 수 있습니다")}</h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-[#53696d]">
                  {session.state === "ended" ? text("closedDescription", "The room is closed. Final transcript and evaluation are not available yet.", "대화 공간이 종료되었습니다. 최종 대화 기록과 평가는 아직 지원되지 않습니다.") : text("roomDescription", "Your session-specific PAL connects through Daily. Nothing starts until you consent and choose to begin.", "이 세션 전용 PAL은 Daily를 통해 연결됩니다. 동의하고 시작을 선택하기 전에는 아무것도 시작되지 않습니다.")}
                </p>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#cbd8d9] bg-[#f8faf9] px-4 py-3 sm:px-5">
            <p className="text-xs text-[#698084]">{text("scenario", "Scenario:", "시나리오:")} <span className="font-medium text-[#40595e]">{scenario.title}</span></p>
            {session.state === "active" && <button type="button" onClick={() => void end()} disabled={busy} className="rounded-lg bg-[#a94338] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#90372f] disabled:opacity-60" data-testid="tavus-end">{ending ? text("endingButton", "Ending…", "종료 중…") : text("end", "End session", "세션 종료")}</button>}
            {session.state === "ended" && <button type="button" onClick={onExit} className="rounded-lg border border-[#ccd8db] px-4 py-2 text-sm font-semibold text-[#32484e] hover:bg-white" data-testid="tavus-close">{text("close", "Close session", "세션 닫기")}</button>}
          </div>
        </section>

        <aside className="flex min-h-[460px] min-w-0 flex-col overflow-hidden rounded-2xl border border-[#d3dfe1] bg-[#f8faf9] shadow-[0_16px_50px_rgba(24,51,58,0.06)]">
          <div className="border-b border-[#dce5e5] px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#64807f]">{text("sessionDetails", "Session details", "세션 안내")}</p>
            <h2 className="mt-1 text-lg font-semibold">{text("noticeTitle", "Before you begin", "시작하기 전에")}</h2>
          </div>
          <div className="flex-1 space-y-4 p-4 sm:p-5">
            <div className="rounded-xl border border-[#d8e2e1] bg-[#f2f6f4] p-4 text-sm leading-6 text-[#53696d]">
              <p>{text("noticePal", "This is a session-specific PAL, not a persistent recording.", "이 세션 전용 PAL이며 지속적으로 저장되는 녹음이 아닙니다.")}</p>
              <p className="mt-2 font-medium text-[#40595e]">{text("noticeLimit", "Maximum duration: 120 seconds, including queue and startup time.", "최대 이용 시간: 대기 및 시작 시간을 포함해 120초입니다.")}</p>
              <p className="mt-2">{text("noticeTranscript", "Final transcript and evaluation are not supported yet.", "최종 대화 기록 및 평가는 아직 지원되지 않습니다.")}</p>
            </div>
            {config && !config.available && <div className="rounded-xl border border-[#ead7b3] bg-[#fff9ec] p-3 text-xs leading-5 text-[#725a32]" role="status" data-testid="tavus-blockers">
              <p className="font-semibold">{text("unavailable", "This pipeline is not available yet.", "현재 파이프라인을 사용할 수 없습니다.")}</p>
              {blockers.length > 0 && <ul className="mt-1 list-disc pl-4">{blockers.map((blocker, index) => <li key={`${blocker}-${index}`}>{reasonText(blocker)}</li>)}</ul>}
              {session.state === "idle" && <button type="button" onClick={() => void refreshStatus()} disabled={statusChecking || busy} className="mt-2 rounded-lg border border-[#d8c69f] px-3 py-2 font-semibold disabled:opacity-50" data-testid="tavus-availability-retry">{statusChecking ? text("checking", "Checking…", "확인 중…") : text("retryAvailability", "Check availability again", "실행 가능 상태 다시 확인")}</button>}
            </div>}
            {config?.runtime && <div className="rounded-xl border border-[#d8e2e1] p-3 text-xs leading-5 text-[#53696d]" data-testid="tavus-runtime-limits">
              <p>{text("requiredSeconds", "Required per session", "세션당 필요 시간")}: {config.runtime.sessionSeconds}s</p>
              <p>{text("userRemaining", "Your remaining time", "사용자 잔여 시간")}: {config.runtime.userRemainingSeconds}s</p>
              <p>{text("globalRemaining", "Project remaining time", "프로젝트 잔여 시간")}: {config.runtime.globalRemainingSeconds}s</p>
              <p>{text("resetsAt", "Budget resets at", "한도 초기화 시각")}: {Number.isNaN(Date.parse(config.runtime.resetsAt)) ? config.runtime.resetsAt : new Date(config.runtime.resetsAt).toLocaleString(i18n.language)}</p>
            </div>}
            {loading ? <div className="space-y-2" aria-label={text("loading", "Loading", "불러오는 중")}><div className="h-3 animate-pulse rounded bg-[#e3ebea]" /><div className="h-3 w-4/5 animate-pulse rounded bg-[#e3ebea]" /></div> : null}
            {!started && <div className="border-t border-[#dce5e5] pt-4">
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#d8e2e1] bg-[#f2f6f4] p-3.5">
                <input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[#317367]" data-testid="tavus-consent" />
                <span className="text-xs leading-5 text-[#53696d]">{text("consent", "I consent to sending my audio and conversation context to Tavus and its service providers to run this session.", "이 세션을 위해 내 음성과 대화 맥락을 Tavus 및 서비스 제공자에게 전송하는 데 동의합니다.")}</span>
              </label>
              <button type="button" onClick={() => void start()} disabled={!consent || busy || loading || !config?.available || startedRef.current} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#28675d] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#20584f] disabled:cursor-not-allowed disabled:opacity-50" data-testid="tavus-start">
                {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}{text("start", "Start Tavus session", "Tavus 세션 시작")}
              </button>
              <p className="mt-2 text-center text-[11px] leading-4 text-[#829395]">{text("noAutoRetry", "A room creation is never retried automatically.", "대화 공간 생성은 자동으로 다시 시도하지 않습니다.")}</p>
            </div>}
            {session.state === "active" && !connection && <div className="rounded-xl border border-[#d8e2e1] bg-[#f2f6f4] p-3 text-xs text-[#53696d]" data-testid="tavus-connection-pending">
              {connectionError ? <><p className="font-semibold text-[#8f4137]">{connectionError.code}: {connectionError.message}</p><button type="button" onClick={() => { connectionAttemptedRef.current = false; setConnection(null); void checkConnection(); }} className="mt-2 rounded-lg border border-[#ccd8db] px-3 py-2 font-semibold hover:bg-white" data-testid="tavus-connection-retry">{text("retryConnection", "Retry connection details", "연결 정보 다시 확인")}</button></> : text("connecting", "Securely retrieving connection details…", "안전하게 연결 정보를 확인하고 있습니다…")}
            </div>}
            {(session.state === "creating" || session.state === "ending") && <div className="flex items-center gap-2 text-xs text-[#607a7d]" role="status"><LoaderCircle className="h-4 w-4 animate-spin" />{session.state === "creating" ? text("creatingHelp", "Checking room startup status…", "대화 공간 시작 상태 확인 중…") : text("endingHelp", "Waiting for the room to close…", "대화 공간 종료를 확인하고 있습니다…")}</div>}
            {session.state === "ended" && <div className="flex items-center gap-2 rounded-xl border border-[#d6e8df] bg-[#edf6f1] p-3 text-xs leading-5 text-[#397568]" role="status" data-testid="tavus-evaluation-unavailable">
              <CheckCircle2 className="h-4 w-4 shrink-0" /><span>{text("evaluationUnavailable", "Session closed. Transcript and evaluation are not available yet.", "세션이 종료되었습니다. 대화 기록과 평가는 아직 제공되지 않습니다.")}</span>
            </div>}
            {(error || connectionError) && <div className="rounded-xl border border-[#efd5d0] bg-[#fff7f4] p-3 text-[#8f4137]" role="alert" data-testid="tavus-error">
              <div className="flex items-start gap-2"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /><div className="min-w-0 text-xs leading-5"><p className="font-semibold">{error ? displayError(error) : connectionError ? displayError(connectionError) : ""}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {connectionError && <button type="button" onClick={() => { connectionAttemptedRef.current = false; setConnection(null); void checkConnection(); }} className="rounded-lg border border-[#d8aaa2] px-3 py-2 font-semibold hover:bg-white" data-testid="tavus-connection-retry">{text("retryConnection", "Retry connection details", "연결 정보 다시 확인")}</button>}
                  <button type="button" onClick={() => void refreshStatus()} disabled={statusChecking || busy} className="rounded-lg border border-[#d8aaa2] px-3 py-2 font-semibold hover:bg-white disabled:opacity-50" data-testid="tavus-status-retry">{statusChecking ? text("checking", "Checking…", "확인 중…") : text("retryStatus", "Check status", "상태 확인")}</button>
                  {(session.state !== "idle" && session.state !== "ended") && <button type="button" onClick={() => void end()} disabled={busy} className="rounded-lg border border-[#d8aaa2] px-3 py-2 font-semibold hover:bg-white disabled:opacity-50" data-testid="tavus-end-retry">{endFailed ? text("retryEnd", "Retry safe end", "안전하게 종료 재시도") : text("endSession", "End session", "세션 종료")}</button>}
                </div>
              </div></div>
            </div>}
            {session.state === "create_unknown" && !error && <div className="rounded-xl border border-[#ead7b3] bg-[#fff9ec] p-3 text-xs leading-5 text-[#725a32]" role="alert" data-testid="tavus-create-unknown">
              {text("unknownHelp", "The start outcome is uncertain. Do not start again; check status or safely end the possible session.", "시작 결과가 불확실합니다. 다시 시작하지 말고 상태를 확인하거나 세션 종료를 요청하세요.")}
              <div className="mt-2 flex gap-2"><button type="button" onClick={() => void refreshStatus()} className="rounded-lg border border-[#d8c69f] px-3 py-2 font-semibold hover:bg-white" data-testid="tavus-status-retry">{text("retryStatus", "Check status", "상태 확인")}</button><button type="button" onClick={() => void end()} className="rounded-lg border border-[#d8c69f] px-3 py-2 font-semibold hover:bg-white" data-testid="tavus-end-retry">{text("endSession", "End session", "세션 종료")}</button></div>
            </div>}
          </div>
        </aside>
      </div>
    </main>
  );
}
