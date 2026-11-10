import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, CircleAlert, LoaderCircle, Mic2, Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ComplexScenario, ScenarioPersona } from "@/lib/scenario-system";
import type { ConversationMessage } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { toMediaUrl } from "@/lib/mediaUrl";
import DailyAvatarRoom from "./DailyAvatarRoom";
import ManagedAvatarRoom from "./ManagedAvatarRoom";
import TavusConversationLayout from "./TavusConversationLayout";
import { useTavusTranscript, type TranscriptState } from "./useTavusTranscript";
import { useBrowserCaptions } from "./tavusBrowserCaptions";
import { ScenarioOverrideSummary, type OrganizationOverrideMetadata } from "../ScenarioOverrideSummary";

type SessionState = "idle" | "creating" | "create_unknown" | "active" | "ending" | "ended";
type Session = {
  state: SessionState;
  providerId?: "tavus" | "anam";
  error?: string;
  createdAt?: string;
  expiresAt?: string;
  evaluationAvailable?: boolean;
  transcriptState?: TranscriptState;
  transcriptError?: string;
};
type Config = {
  available: boolean; blockers?: string[]; evaluationAvailable?: boolean;
  providerId?: "tavus" | "anam";
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
  onExitMode: (mode?: "text" | "realtime-voice") => void;
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
  scenario, persona, conversationId, onChatComplete, onExit, onReady, onExitMode,
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
  const [clockNow, setClockNow] = useState(() => Date.now());
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
  const providerRef = useRef<"tavus" | "anam">("tavus");
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const wakeLockRequestRef = useRef<Promise<void> | null>(null);

  const releaseScreenWakeLock = useCallback(() => {
    const lock = wakeLockRef.current;
    wakeLockRef.current = null;
    if (lock && !lock.released) void lock.release().catch(() => {});
  }, []);

  const requestScreenWakeLock = useCallback(() => {
    if (!("wakeLock" in navigator) || document.visibilityState !== "visible" ||
        !startedRef.current || endRequestedRef.current || wakeLockRequestRef.current ||
        (wakeLockRef.current && !wakeLockRef.current.released)) return;
    const request = (async () => {
      try {
        const lock = await navigator.wakeLock.request("screen");
        if (!mountedRef.current || !startedRef.current || endRequestedRef.current ||
            sessionStateRef.current === "ended" || document.visibilityState !== "visible") {
          await lock.release();
          return;
        }
        wakeLockRef.current = lock;
        lock.addEventListener("release", () => {
          if (wakeLockRef.current === lock) wakeLockRef.current = null;
        }, { once: true });
      } catch {
        // Screen Wake Lock is optional and not available in every mobile browser.
      } finally {
        wakeLockRequestRef.current = null;
      }
    })();
    wakeLockRequestRef.current = request;
  }, []);

  const updateSession = useCallback((next: Session) => {
    if (next.providerId) providerRef.current = next.providerId;
    if (next.state !== "idle") startedRef.current = true;
    if (next.state === "ended") endRequestedRef.current = false;
    if (next.createdAt || next.expiresAt || next.state === "ended") setClockNow(Date.now());
    sessionStateRef.current = endRequestedRef.current && next.state === "active" ? "ending" : next.state;
    const visibleSession = endRequestedRef.current && next.state === "active" ? { ...next, state: "ending" as const } : next;
    if (mountedRef.current) setSession(visibleSession);
    if (mountedRef.current && next.error) setError(errorDetails(next.error));
    if (next.state === "active") requestScreenWakeLock();
    if (next.state === "ended") releaseScreenWakeLock();
  }, [releaseScreenWakeLock, requestScreenWakeLock]);
  const isAnam = (session.state === "idle" ? config?.providerId : session.providerId) === "anam";
  const evaluationAvailable = !isAnam && (session.evaluationAvailable === true || config?.evaluationAvailable === true);
  const transcript = useTavusTranscript<Session>({
    conversationId,
    session,
    evaluationAvailable,
    onSessionUpdate: updateSession,
  });
  const browserCaptions = useBrowserCaptions(conversationId);
  // "completed" means the authenticated transcript was saved AND the durable
  // feedback job was accepted, not that the report itself has finished.
  const feedbackQueued = session.state === "ended" && evaluationAvailable &&
    transcript.transcriptState === "completed";
  const feedbackOpenedForRef = useRef<string | null>(null);
  const openFeedback = useCallback(() => {
    if (!feedbackQueued || feedbackOpenedForRef.current === conversationId) return;
    feedbackOpenedForRef.current = conversationId;
    onChatComplete();
  }, [conversationId, feedbackQueued, onChatComplete]);

  useEffect(() => {
    if (feedbackQueued) openFeedback();
  }, [feedbackQueued, openFeedback]);

  useEffect(() => {
    if (session.state !== "active" || (!session.createdAt && !session.expiresAt)) return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [session.createdAt, session.expiresAt, session.state]);

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
    if (sessionStateRef.current === "ended") return;
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
    if (providerRef.current === "anam") return; // Managed client makes the single-use POST itself.
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
      releaseScreenWakeLock();
    };
    const visibilityChange = () => {
      if (document.visibilityState === "visible" && startedRef.current &&
          sessionStateRef.current !== "ended" && !endRequestedRef.current) {
        requestScreenWakeLock();
      }
    };
    window.addEventListener("pagehide", pageHide);
    document.addEventListener("visibilitychange", visibilityChange);
    return () => {
      cancelled = true;
      mountedRef.current = false;
      window.removeEventListener("pagehide", pageHide);
      document.removeEventListener("visibilitychange", visibilityChange);
      releaseScreenWakeLock();
      if (startedRef.current || sessionStateRef.current !== "idle") endKeepalive();
    };
  // Initial session/config bootstrap is intentionally one-shot for this conversation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, releaseScreenWakeLock, requestScreenWakeLock]);

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
    // Request synchronously from the user's tap before any network awaits.
    requestScreenWakeLock();
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
          releaseScreenWakeLock();
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
    releaseScreenWakeLock();
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
  const elapsedSeconds = session.createdAt && Number.isFinite(Date.parse(session.createdAt))
    ? Math.max(0, Math.floor((clockNow - Date.parse(session.createdAt)) / 1000))
    : 0;
  const remainingSeconds = session.expiresAt && Number.isFinite(Date.parse(session.expiresAt))
    ? Math.max(0, Math.ceil((Date.parse(session.expiresAt) - clockNow) / 1000))
    : null;
  const roomStage = session.state === "active" && isAnam ? (
    <ManagedAvatarRoom endpoint={sessionUrl(conversationId)}
      onError={message => setConnectionError({ code: "ANAM_CLIENT_ERROR", message })} />
  ) : session.state === "active" && connection ? (
    <DailyAvatarRoom
      connection={connection}
      onCaption={browserCaptions.onCaption}
      onError={(message) => setConnectionError({ code: "DAILY_ROOM_ERROR", message })}
    />
  ) : (
    <div className="absolute inset-0 flex flex-col items-center justify-center overflow-hidden bg-slate-900 px-6 py-8 text-center">
      {persona.image && <img src={toMediaUrl(persona.image)} alt="" className="absolute inset-0 h-full w-full object-cover object-top" />}
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative mb-4 flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-black/30 text-white/80 backdrop-blur-sm">
        {busy || loading ? <LoaderCircle className="h-7 w-7 animate-spin" /> : <Mic2 className="h-7 w-7" />}
      </div>
      <h2 className="relative text-lg font-semibold text-white">
        {session.state === "ended" ? text("closedTitle", "This session is closed", "이 세션은 종료되었습니다") :
          loading ? text("loading", "Checking session availability", "세션 상태를 확인하고 있습니다") :
            text("voiceReady", "Ready to talk", "대화할 준비가 되었습니다")}
      </h2>
      <p className="relative mt-2 max-w-md break-words text-sm leading-6 text-white/80">
        {session.state === "ended"
          ? text("closedDescription", "The room is closed. Confirmed history will appear in the conversation panel when available.", "대화 공간이 종료되었습니다. 확인된 기록은 제공되는 대로 대화 패널에 표시됩니다.")
          : text("liveReadyHint", "Use the controls below to review consent and begin.", "하단에서 이용 동의를 확인한 뒤 대화를 시작하세요.")}
      </p>
    </div>
  );
  const historyContent = session.state !== "ended" ? (
    <div className="p-4 sm:p-5">
      <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
        {text("historyAfterEnd", "Confirmed history is available after the session ends. Provisional browser captions appear in the conversation panel while they are available.", "확정 대화 기록은 세션 종료 후 제공됩니다. 브라우저 임시 자막은 사용 가능한 동안 대화 패널에 표시됩니다.")}
      </p>
    </div>
  ) : transcript.transcriptState === "completed" || transcript.transcriptState === "empty" ? (
    <>
      {transcript.transcriptState === "empty" && (
        <p className="border-b border-slate-100 bg-[#f2f6f4] px-4 py-3 text-xs leading-5 text-[#53696d]">
          {text("transcriptEmpty", "No learner utterance was available for evaluation. Confirmed server messages are shown below when present.", "평가에 사용할 학습자 발화가 없습니다. 확인된 서버 메시지가 있으면 아래에 표시됩니다.")}
        </p>
      )}
      {transcript.messagesLoading ? (
      <div className="space-y-3 p-4" aria-label={text("historyLoading", "Loading confirmed conversation history", "확인된 대화 기록을 불러오는 중")}>
        <div className="h-12 animate-pulse rounded-xl bg-slate-100" />
        <div className="ml-auto h-12 w-4/5 animate-pulse rounded-xl bg-slate-100" />
        <div className="h-12 w-3/4 animate-pulse rounded-xl bg-slate-100" />
      </div>
      ) : transcript.messagesError ? (
      <div className="p-4" role="alert" data-testid="tavus-history-error">
        <p className="text-sm leading-5 text-[#8f4137]">{text("historyReadError", "The confirmed conversation history could not be loaded.", "확인된 대화 기록을 불러오지 못했습니다.")}</p>
        <button type="button" onClick={() => void transcript.retryMessages()} className="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50" data-testid="tavus-history-retry">
          {text("retryHistory", "Retry history", "기록 다시 불러오기")}
        </button>
      </div>
      ) : transcript.messages.length > 0 ? (
      <p className="p-4 text-sm leading-6 text-slate-600">
        {text("historyShownInPanel", "Confirmed messages are available in the conversation panel.", "확정된 메시지는 대화 패널에서 확인할 수 있습니다.")}
      </p>
      ) : (
      <div className="p-4">
        <p className="text-sm leading-6 text-slate-600">{transcript.transcriptState === "empty"
          ? text("historyEmptyNoUtterance", "No saved messages were returned for this empty transcript.", "발화가 없는 대화 기록에 저장된 메시지가 없습니다.")
          : text("historyEmpty", "No saved conversation messages were returned.", "저장된 대화 메시지를 찾을 수 없습니다.")}</p>
        <button type="button" onClick={() => void transcript.retryMessages()} className="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50" data-testid="tavus-history-retry">
          {text("retryHistory", "Retry history", "기록 다시 불러오기")}
        </button>
      </div>
      )}
    </>
  ) : transcript.transcriptState === "pending" || transcript.transcriptState === "importing" ? (
    <div className="p-4 sm:p-5">
      <div className="rounded-xl border border-[#d8e2e1] bg-[#f2f6f4] p-4 text-sm leading-6 text-[#53696d]" role="status" data-testid="tavus-transcript-pending">
        <p className="font-medium">{text("transcriptPending", "The router is retrieving confirmed conversation history.", "라우터에서 확인된 대화 기록을 가져오고 있습니다.")}</p>
        <p className="mt-1 text-xs">{text("transcriptWait", "This may take a short while. You can safely check again.", "잠시 시간이 걸릴 수 있습니다. 안전하게 다시 확인할 수 있습니다.")}</p>
        <button type="button" onClick={() => void transcript.retrySync()} disabled={transcript.syncing} className="mt-3 rounded-lg border border-[#ccd8db] px-3 py-2 text-xs font-semibold hover:bg-white disabled:opacity-50" data-testid="tavus-transcript-retry">
          {transcript.syncing ? text("checking", "Checking…", "확인 중…") : text("retryTranscript", "Check transcript status", "대화 기록 상태 확인")}
        </button>
      </div>
    </div>
  ) : transcript.transcriptState === "failed" ? (
    <div className="p-4 sm:p-5">
      <div className="rounded-xl border border-[#efd5d0] bg-[#fff7f4] p-4 text-sm leading-6 text-[#8f4137]" role="alert" data-testid="tavus-transcript-failed">
        <p className="font-semibold">{text("transcriptFailed", "Confirmed history could not be retrieved.", "확인된 대화 기록을 가져오지 못했습니다.")}</p>
        {session.transcriptError && <p className="mt-1 break-words text-xs">{session.transcriptError}</p>}
        <button type="button" onClick={() => void transcript.retrySync()} disabled={transcript.syncing} className="mt-3 rounded-lg border border-[#d8aaa2] px-3 py-2 text-xs font-semibold hover:bg-white disabled:opacity-50" data-testid="tavus-transcript-retry">
          {transcript.syncing ? text("checking", "Checking…", "확인 중…") : text("retryTranscript", "Retry transcript retrieval", "대화 기록 가져오기 재시도")}
        </button>
      </div>
    </div>
  ) : transcript.syncError ? (
    <div className="p-4 sm:p-5">
      <p className="text-sm leading-6 text-[#8f4137]" role="alert">{text("transcriptSyncError", "Transcript status could not be checked.", "대화 기록 상태를 확인하지 못했습니다.")}</p>
      <button type="button" onClick={() => void transcript.retrySync()} disabled={transcript.syncing} className="mt-3 rounded-lg border border-[#d8aaa2] px-3 py-2 text-sm font-semibold disabled:opacity-50" data-testid="tavus-transcript-retry">
        {text("retryTranscript", "Retry transcript retrieval", "대화 기록 가져오기 재시도")}
      </button>
    </div>
  ) : (
    <div className="p-4 sm:p-5">
      <p className="text-sm leading-6 text-slate-600">{text("transcriptStarting", "Checking whether confirmed conversation history is available.", "확인된 대화 기록을 사용할 수 있는지 확인하고 있습니다.")}</p>
    </div>
  );
  const feedbackReady = feedbackQueued;
  const transcriptUnavailable = session.state === "ended" &&
    (!evaluationAvailable || transcript.transcriptState === "unavailable" || transcript.transcriptState === "empty");
  const apiDisplayError = error || connectionError || (transcript.syncError ? errorDetails(transcript.syncError) : null);
  const canonicalTranscriptReady = session.state === "ended" &&
    (transcript.transcriptState === "completed" || transcript.transcriptState === "empty") &&
    !transcript.messagesLoading && !transcript.messagesError;
  const provisionalMessages = browserCaptions.captions.map((caption) => ({
    sender: caption.sender,
    message: caption.interrupted
      ? `${caption.message} · ${text("interruptedDraft", "interrupted draft", "중단된 임시 문장")}`
      : caption.message,
    timestamp: caption.timestamp,
    utteranceId: caption.id,
  })) as unknown as ConversationMessage[];
  const transcriptMessages = canonicalTranscriptReady ? transcript.messages : provisionalMessages;

  return (
    <TavusConversationLayout
      scenario={scenario}
      persona={persona}
      statusLabel={labels[session.state]}
      active={session.state === "active"}
      elapsedSeconds={elapsedSeconds}
      remainingSeconds={remainingSeconds}
      onExitMode={!started ? () => onExitMode("text") : undefined}
      requiresAttention={Boolean(apiDisplayError) || session.state === "create_unknown" || session.state === "ended"}
      headerActions={
        <button
          type="button"
          onClick={() => started ? session.state === "ended" || endFailed ? onExit() : void end() : onExitMode()}
          disabled={busy && !endFailed}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-white/35 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10 disabled:opacity-60"
          data-testid="tavus-exit"
        >
          {started ? <CheckCircle2 className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}
          {started ? session.state === "ended" ? text("close", "Close session", "세션 닫기") : endFailed ? text("exitAnyway", "Exit anyway", "종료하고 나가기") : text("endAndExit", "End and exit", "종료하고 나가기") : text("back", "Back to chat modes", "채팅 모드로 돌아가기")}
        </button>
      }
      stage={roomStage}
      transcriptMessages={transcriptMessages}
      captionsAreProvisional={!canonicalTranscriptReady}
      hasCaptionEvents={browserCaptions.captions.length > 0}
      sessionControls={
        <div className="space-y-4">
          {!started && <div className="rounded-xl border border-[#d8e2e1] bg-[#f2f6f4] p-4 text-sm leading-6 text-[#53696d]">
            <p>{isAnam ? text("anamSavedPersona", "Anam uses the persona saved in AvatarRouter. Scenario instructions and confirmed transcript evaluation are not supported by this router contract.", "Anam은 AvatarRouter에 저장된 페르소나를 사용합니다. 현재 라우터 계약은 이 앱의 시나리오 지침 전달과 확정 대화록 평가를 지원하지 않습니다.") : text("noticePal", "This is a session-specific PAL, not a persistent recording.", "이 세션 전용 PAL이며 지속적으로 저장되는 녹음이 아닙니다.")}</p>
            <p className="mt-2 font-medium text-[#40595e]">{text("noticeLimit", "Maximum duration: 120 seconds, including queue and startup time.", "최대 이용 시간: 대기 및 시작을 포함해 120초입니다.")}</p>
            <p className="mt-2">{text("noticeTranscript", "Confirmed history, when supported, becomes available after the session ends.", "지원되는 경우 확인된 대화 기록은 세션 종료 후 제공됩니다.")}</p>
          </div>}
          {!started && config && !config.available && <div className="rounded-xl border border-[#ead7b3] bg-[#fff9ec] p-3 text-xs leading-5 text-[#725a32]" role="status" data-testid="tavus-blockers">
            <p className="font-semibold">{text("unavailable", "This pipeline is not available yet.", "현재 파이프라인을 사용할 수 없습니다.")}</p>
            {blockers.length > 0 && <ul className="mt-1 list-disc pl-4">{blockers.map((blocker, index) => <li key={`${blocker}-${index}`}>{reasonText(blocker)}</li>)}</ul>}
            {session.state === "idle" && <button type="button" onClick={() => void refreshStatus()} disabled={statusChecking || busy} className="mt-2 rounded-lg border border-[#d8c69f] px-3 py-2 font-semibold disabled:opacity-50" data-testid="tavus-availability-retry">{statusChecking ? text("checking", "Checking…", "확인 중…") : text("retryAvailability", "Check availability again", "실행 가능 상태 다시 확인")}</button>}
          </div>}
          {!started && config?.runtime && <div className="rounded-xl border border-[#d8e2e1] bg-white/95 p-3 text-xs leading-5 text-[#53696d]" data-testid="tavus-runtime-limits">
            <p>{text("requiredSeconds", "Required per session", "세션당 필요 시간")}: {config.runtime.sessionSeconds}s</p>
            <p>{text("userRemaining", "Your remaining time", "사용자 잔여 시간")}: {config.runtime.userRemainingSeconds}s</p>
            <p>{text("globalRemaining", "Project remaining time", "프로젝트 잔여 시간")}: {config.runtime.globalRemainingSeconds}s</p>
            <p>{text("resetsAt", "Budget resets at", "한도 초기화 시각")}: {Number.isNaN(Date.parse(config.runtime.resetsAt)) ? config.runtime.resetsAt : new Date(config.runtime.resetsAt).toLocaleString(i18n.language)}</p>
          </div>}
          {loading && <div className="space-y-2" aria-label={text("loading", "Loading", "불러오는 중")}><div className="h-3 animate-pulse rounded bg-[#e3ebea]" /><div className="h-3 w-4/5 animate-pulse rounded bg-[#e3ebea]" /></div>}
          {!started && <div className="border-t border-[#dce5e5] pt-4">
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#d8e2e1] bg-[#f2f6f4] p-3.5">
              <input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[#317367]" data-testid="tavus-consent" />
              <span className="text-xs leading-5 text-[#53696d]">{isAnam
                ? text("anamConsent", "I consent to sending my audio to Anam through AvatarRouter. A paid session starts only when I choose Start.", "AvatarRouter를 통해 Anam에 내 음성을 전송하는 데 동의합니다. 시작 버튼을 눌러야 유료 세션이 생성됩니다.")
                : text("consent", "I consent to sending my audio and conversation context to Tavus and its service providers to run this session.", "이 세션을 위해 내 음성과 대화 맥락을 Tavus 및 서비스 제공자에게 전송하는 데 동의합니다.")}</span>
            </label>
            <button type="button" onClick={() => void start()} disabled={!consent || busy || loading || !config?.available || startedRef.current} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-corporate-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-corporate-700 disabled:cursor-not-allowed disabled:opacity-50" data-testid="tavus-start">
              {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}{text("start", "Start Tavus session", "Tavus 세션 시작")}
            </button>
            <p className="mt-2 text-center text-[11px] leading-4 text-[#829395]">{text("noAutoRetry", "A room creation is never retried automatically.", "대화 공간 생성은 자동으로 다시 시도하지 않습니다.")}</p>
          </div>}
          {session.state === "active" && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
            <p className="text-xs text-slate-500">{text("scenario", "Scenario:", "시나리오:")} <span className="font-medium text-slate-700">{scenario.title}</span></p>
            <button type="button" onClick={() => void end()} disabled={busy} className="rounded-lg bg-[#a94338] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#90372f] disabled:opacity-60" data-testid="tavus-end">{ending ? text("endingButton", "Ending…", "종료 중…") : text("end", "End session", "세션 종료")}</button>
          </div>}
          {session.state === "ended" && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
            {feedbackReady && <button type="button" onClick={openFeedback} className="rounded-lg bg-corporate-600 px-4 py-2 text-sm font-semibold text-white hover:bg-corporate-700" data-testid="tavus-view-feedback">{text("viewFeedback", "View feedback", "피드백 보기")}</button>}
            <button type="button" onClick={onExit} className="rounded-lg border border-[#ccd8db] px-4 py-2 text-sm font-semibold text-[#32484e] hover:bg-white" data-testid="tavus-close">{text("close", "Close session", "세션 닫기")}</button>
          </div>}
          {session.state === "active" && !connection && !isAnam && <div className="rounded-xl border border-[#d8e2e1] bg-[#f2f6f4] p-3 text-xs text-[#53696d]" data-testid="tavus-connection-pending">
            {connectionError ? <><p className="font-semibold text-[#8f4137]">{connectionError.code}: {connectionError.message}</p><button type="button" onClick={() => { connectionAttemptedRef.current = false; setConnection(null); void checkConnection(); }} className="mt-2 rounded-lg border border-[#ccd8db] px-3 py-2 font-semibold hover:bg-white" data-testid="tavus-connection-retry">{text("retryConnection", "Retry connection details", "연결 정보 다시 확인")}</button></> : text("connecting", "Securely retrieving connection details…", "안전하게 연결 정보를 확인하고 있습니다…")}
          </div>}
          {(session.state === "creating" || session.state === "ending") && <div className="flex items-center gap-2 text-xs text-[#607a7d]" role="status"><LoaderCircle className="h-4 w-4 animate-spin" />{session.state === "creating" ? text("creatingHelp", "Checking room startup status…", "대화 공간 시작 상태 확인 중…") : text("endingHelp", "Waiting for the room to close…", "대화 공간 종료를 확인하고 있습니다…")}</div>}
          {transcriptUnavailable && <div className="flex items-center gap-2 rounded-xl border border-[#d6e8df] bg-[#edf6f1] p-3 text-xs leading-5 text-[#397568]" role="status" data-testid="tavus-evaluation-unavailable">
            <CheckCircle2 className="h-4 w-4 shrink-0" /><span>{transcript.transcriptState === "empty"
              ? text("evaluationEmpty", "Session closed. No learner utterance was available, so no feedback was queued.", "세션이 종료되었습니다. 학습자 발화가 없어 피드백이 생성되지 않았습니다.")
              : text("evaluationUnavailable", "Session closed. The router did not provide a final transcript, so feedback is unavailable.", "세션이 종료되었습니다. 라우터에서 최종 대화 기록을 제공하지 않아 피드백을 사용할 수 없습니다.")}</span>
            {evaluationAvailable && transcript.transcriptState === "unavailable" &&
              <button type="button" onClick={() => void transcript.retrySync()} disabled={transcript.syncing} className="shrink-0 underline disabled:opacity-50" data-testid="tavus-unavailable-retry">
                {text("retryTranscript", "Check transcript status", "대화 기록 상태 확인")}
              </button>}
          </div>}
          {session.state === "ended" && evaluationAvailable &&
            ["pending", "importing", "failed"].includes(transcript.transcriptState || "") && (
            <div className="rounded-xl border border-[#d8e2e1] bg-[#f2f6f4] p-3 text-xs leading-5 text-[#53696d]" role="status" data-testid="tavus-feedback-waiting">
              {transcript.transcriptState === "failed"
                ? text("feedbackDeferred", "Confirmed history could not be saved. Feedback has not been submitted. Retry the history check.", "확정 기록을 저장하지 못해 피드백 생성을 보류했습니다. 대화 기록 상태를 다시 확인해 주세요.")
                : transcript.pollingPaused
                  ? text("feedbackDelayed", "History is taking longer than five minutes. Background retrieval continues; check again to resume automatic opening.", "대화 기록 제공이 5분 이상 지연되고 있습니다. 백그라운드 조회는 계속되며, 상태를 다시 확인하면 자동 이동 대기를 재개합니다.")
                  : text("feedbackWaiting", "Waiting for confirmed conversation history. Feedback will be generated and opened automatically after it is saved.", "확정 대화 기록을 기다리고 있습니다. 기록이 저장되면 피드백 리포트를 자동으로 생성하고 피드백 화면으로 이동합니다.")}
              <button type="button" onClick={() => void transcript.retrySync()} disabled={transcript.syncing} className="ml-2 underline disabled:opacity-50">
                {text("retryTranscript", "Check transcript status", "대화 기록 상태 확인")}
              </button>
            </div>
          )}
          {feedbackReady && <div className="rounded-xl border border-[#d6e8df] bg-[#edf6f1] p-3 text-xs leading-5 text-[#397568]" role="status" data-testid="tavus-transcript-completed">
            {text("feedbackQueued", "Confirmed history is saved. Opening the feedback generation screen…", "확정 대화 기록이 저장되었습니다. 피드백 생성 화면으로 이동합니다…")}
          </div>}
          {apiDisplayError && <div className="rounded-xl border border-[#efd5d0] bg-[#fff7f4] p-3 text-[#8f4137]" role="alert" data-testid="tavus-error">
            <div className="flex items-start gap-2"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /><div className="min-w-0 text-xs leading-5"><p className="break-words font-semibold">{displayError(apiDisplayError)}</p>
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
      }
      history={<><TavusOverrideSummary conversationId={conversationId} />{historyContent}</>}
    />
  );

}

function TavusOverrideSummary({ conversationId }: { conversationId: string }) {
  const [state, setState] = useState<{ loading: boolean; error: boolean; metadata: OrganizationOverrideMetadata }>({ loading: true, error: false, metadata: null });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: false, metadata: null });
    apiRequest("GET", `/api/conversations/${encodeURIComponent(conversationId)}/organization-override`)
      .then(response => response.json())
      .then(data => { if (!cancelled) setState({ loading: false, error: false, metadata: data.organizationOverride ?? null }); })
      .catch(() => { if (!cancelled) setState({ loading: false, error: true, metadata: null }); });
    return () => { cancelled = true; };
  }, [conversationId, retry]);
  return <div className="p-4">
    {state.loading ? <p className="text-sm">조직 설정 적용 기록을 불러오는 중...</p>
      : state.error ? <p className="text-sm text-red-700">조직 설정 적용 기록 조회 실패. <button onClick={() => setRetry(value => value + 1)} className="underline">다시 시도</button></p>
      : <ScenarioOverrideSummary metadata={state.metadata} />}
  </div>;
}
