import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import {
  AvatarTestPreflight,
  AvatarTestSession,
  avatarTestReady,
  avatarTestTerminal,
} from "@shared/avatar/adminAvatarTest";
import { useAvatarTestConversation } from "./useAvatarTestConversation";
import { useAvatarTestRoom } from "./useAvatarTestRoom";

const endpoint = "/api/live-avatar/test";
function friendlyError(cause: unknown): string {
  const code = (cause instanceof Error ? cause.message : "").toUpperCase();
  if (code.includes("SCOPE") || code.includes("FORBIDDEN") || code.includes("403")) return "관리자 테스트 권한을 확인할 수 없습니다. 필요한 권한 범위를 확인하세요.";
  if (code.includes("AI_NOT_READY") || code.includes("AI_UNAVAILABLE")) return "AI 응답 제공자가 준비되지 않았습니다. 사전 점검을 다시 확인하세요.";
  if (code.includes("WORKER") || code.includes("RENDERER")) return "아바타 워커가 준비되지 않았습니다. 새 세션을 만들지 말고 상태를 확인하세요.";
  if (code.includes("LIMIT") || code.includes("QUOTA") || code.includes("429")) return "관리자 테스트 사용 한도에 도달했습니다. 잔여 시간과 초기화 시각을 확인하세요.";
  if (code.includes("CREATION_UNCERTAIN")) return "이전 세션 생성 결과를 확인 중입니다. 원격 조정이 끝날 때까지 다시 생성할 수 없습니다.";
  if (code.includes("SESSION_EXPIRED") || code.includes("410")) return "테스트 세션이 만료되었습니다. 종료 상태를 확인하세요.";
  if (code.includes("NOT_READY")) return "아바타가 아직 준비되지 않았습니다. renderer 상태가 running이 될 때까지 기다리세요.";
  if (code.includes("CLEANUP_PENDING")) return "이전 세션 정리가 진행 중입니다. 정리 완료를 확인하세요.";
  if (code.includes("NETWORK") || code.includes("FAILED TO FETCH")) return "서버에 연결하지 못했습니다. 연결 상태를 확인한 뒤 새로고침하세요.";
  return "요청을 완료하지 못했습니다. 상태를 확인하고 필요한 경우 세션을 복구하거나 종료하세요.";
}

async function get<T>(path: string, base = endpoint): Promise<T> {
  const response = await apiRequest("GET", `${base}${path}?_=${Date.now()}`);
  return response.json() as Promise<T>;
}

export function useAdminAvatarTest(endpoint = "/api/live-avatar/test") {
  const [preflight, setPreflight] = useState<AvatarTestPreflight | null>(null);
  const [session, setSession] = useState<AvatarTestSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [creationUncertainHold, setCreationUncertainHold] = useState(false);
  const [costConfirmed, setCostConfirmed] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState("");
  const [stopWarning, setStopWarning] = useState("");
  const [preflightError, setPreflightError] = useState("");
  const [pollFailed, setPollFailed] = useState(false);

  const sessionRef = useRef<AvatarTestSession | null>(null);
  const mountedRef = useRef(false);
  const stoppedRef = useRef(false);
  const pollFailedRef = useRef(false);
  const stoppingRef = useRef(false);
  const pollBusyRef = useRef(false);
  const creatingRef = useRef(false);
  const creationHoldRef = useRef(false);
  const endRequestedRef = useRef(new Set<string>());

  const setCurrentSession = useCallback((next: AvatarTestSession | null) => {
    sessionRef.current = next;
    if (mountedRef.current) setSession(next);
  }, []);
  const room = useAvatarTestRoom({
    endpoint,
    session,
    sessionRef,
    mountedRef,
    stoppedRef,
    stoppingRef,
    pollFailedRef,
    onError: setError,
  });
  const isMediaReady = () => Boolean(room.mediaConnected && room.audioPlaybackReady &&
    !pollFailedRef.current && !stoppedRef.current && !stoppingRef.current);
  const mediaReady = isMediaReady();
  const conversation = useAvatarTestConversation({
    endpoint,
    sessionRef,
    mountedRef,
    stoppedRef,
    stoppingRef,
    isMediaReady,
    onError: setError,
  });

  const stopMicrophone = conversation.stopMicrophone;
  const disconnectMedia = room.disconnectMedia;
  const bestEffortEnd = useCallback(() => {
    stoppedRef.current = true;
    stopMicrophone();
    conversation.cancelTurn();
    disconnectMedia();
    const current = sessionRef.current;
    if (!current || avatarTestTerminal(current) || endRequestedRef.current.has(current.id)) return;
    endRequestedRef.current.add(current.id);
    const auth = localStorage.getItem("authToken");
    void fetch(`${endpoint}/sessions/${encodeURIComponent(current.id)}/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
      body: "{}",
      credentials: "include",
      keepalive: true,
    }).catch(() => undefined);
  }, [conversation.cancelTurn, disconnectMedia, stopMicrophone, endpoint]);

  const loadPreflight = useCallback(async (initial = false) => {
    if (initial && mountedRef.current) setLoading(true);
    try {
      const result = await get<AvatarTestPreflight>("/preflight", endpoint);
      if (!result?.limits || typeof result.ready !== "boolean" || typeof result.aiReady !== "boolean" ||
          typeof result.creationUncertain !== "boolean" || !Array.isArray(result.sessions) ||
          !Array.isArray(result.missingScopes)) throw new Error("invalid preflight response");
      if (!mountedRef.current) return;
      setPreflight(result);
      setCreationUncertainHold(result.creationUncertain);
      creationHoldRef.current = result.creationUncertain;
      setPreflightError("");
      const current = sessionRef.current;
      if (current) {
        const fresh = result.sessions.find((item) => item.id === current.id);
        if (fresh) setCurrentSession(fresh);
      } else {
        const recoverable = result.sessions.find((item) => item.status === "active" || item.cleanupPending);
        if (recoverable) setCurrentSession(recoverable);
      }
    } catch (cause) {
      if (mountedRef.current) setPreflightError(friendlyError(cause));
    } finally {
      if (initial && mountedRef.current) setLoading(false);
    }
  }, [setCurrentSession, endpoint]);

  useEffect(() => {
    mountedRef.current = true;
    void loadPreflight(true);
    const onPageHide = () => bestEffortEnd();
    window.addEventListener("pagehide", onPageHide);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("pagehide", onPageHide);
      stopMicrophone();
      conversation.cancelTurn();
      disconnectMedia();
      window.setTimeout(() => {
        if (!mountedRef.current) bestEffortEnd();
      }, 0);
    };
  }, [bestEffortEnd, conversation.cancelTurn, disconnectMedia, loadPreflight, stopMicrophone]);

  useEffect(() => {
    const activeId = session?.id;
    if (!activeId || avatarTestTerminal(session)) return;
    const poll = async () => {
      if (pollBusyRef.current || !mountedRef.current || sessionRef.current?.id !== activeId || avatarTestTerminal(sessionRef.current)) return;
      pollBusyRef.current = true;
      try {
        const fresh = await get<AvatarTestSession>(`/sessions/${encodeURIComponent(activeId)}`, endpoint);
        if (!mountedRef.current || sessionRef.current?.id !== activeId) return;
        setCurrentSession(fresh);
        pollFailedRef.current = false;
        setPollFailed(false);
        if (!avatarTestReady(fresh)) {
          stopMicrophone();
          disconnectMedia();
        }
      } catch (cause) {
        if (mountedRef.current && sessionRef.current?.id === activeId) {
          pollFailedRef.current = true;
          setPollFailed(true);
          stopMicrophone();
          disconnectMedia();
          setError(friendlyError(cause));
        }
      } finally {
        pollBusyRef.current = false;
      }
    };
    const timer = window.setInterval(() => void poll(), 1500);
    return () => window.clearInterval(timer);
  }, [session?.id, session?.status, session?.cleanupPending, disconnectMedia, setCurrentSession, stopMicrophone, endpoint]);

  const refresh = async () => {
    setError("");
    setPreflightError("");
    await loadPreflight();
  };
  const createSession = async () => {
    if (!costConfirmed || !conversation.audioConsentRef.current || creatingRef.current ||
        creationHoldRef.current || preflight?.creationUncertain ||
        (session && !avatarTestTerminal(session))) return;
    creatingRef.current = true;
    setCreating(true);
    setError("");
    setStopWarning("");
    try {
      const response = await apiRequest("POST", `${endpoint}/sessions`, { costConfirmed: true, audioConfirmed: true });
      const created = await response.json() as AvatarTestSession;
      if (!mountedRef.current) {
        sessionRef.current = created;
        bestEffortEnd();
        return;
      }
      stoppedRef.current = false;
      setStopped(false);
      setCostConfirmed(false);
      pollFailedRef.current = false;
      setPollFailed(false);
      conversation.setConversation([]);
      setCurrentSession(created);
      await loadPreflight();
    } catch (cause) {
      if (mountedRef.current) {
        creationHoldRef.current = true;
        setCreationUncertainHold(true);
        setError(friendlyError(cause));
        await loadPreflight();
      }
    } finally {
      creatingRef.current = false;
      if (mountedRef.current) setCreating(false);
    }
  };

  const stopSession = async () => {
    const current = sessionRef.current;
    if (!current || stoppingRef.current) return;
    stoppedRef.current = true;
    stoppingRef.current = true;
    setStopped(true);
    setStopping(true);
    setStopWarning("");
    conversation.cancelTurn();
    stopMicrophone();
    disconnectMedia();
    try {
      if (!avatarTestTerminal(current)) {
        if (current.status === "active") {
          try { await apiRequest("POST", `${endpoint}/sessions/${encodeURIComponent(current.id)}/interrupt`, {}); } catch { /* end cancels the server turn */ }
        }
        await apiRequest("POST", `${endpoint}/sessions/${encodeURIComponent(current.id)}/end`, {});
        endRequestedRef.current.add(current.id);
      }
      let ended: AvatarTestSession | null = null;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        if (!mountedRef.current) return;
        ended = await get<AvatarTestSession>(`/sessions/${encodeURIComponent(current.id)}`, endpoint);
        setCurrentSession(ended);
        if (avatarTestTerminal(ended)) break;
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
      }
      if (mountedRef.current && (!ended || !avatarTestTerminal(ended))) {
        setStopWarning("종료는 요청했지만 정리 완료를 확인하지 못했습니다. 상태를 새로고침하거나 종료를 재시도하세요. 워커의 120초 제한은 브라우저 종료만으로 보장되지 않습니다.");
      }
      await loadPreflight();
    } catch (cause) {
      if (mountedRef.current) setStopWarning(`종료 상태를 확인하지 못했습니다: ${friendlyError(cause)}`);
    } finally {
      stoppingRef.current = false;
      if (mountedRef.current) setStopping(false);
    }
  };

  const recoverSession = (item: AvatarTestSession) => {
    disconnectMedia();
    stoppedRef.current = false;
    setStopped(false);
    pollFailedRef.current = false;
    setPollFailed(false);
    setStopWarning("");
    setError("");
    conversation.setAudioConfirmed(false);
    setCurrentSession(item);
    room.setConnectionAttempt((attempt) => attempt + 1);
  };
  const isReady = Boolean(session && avatarTestReady(session));
  const terminal = Boolean(session && avatarTestTerminal(session));
  const creationUncertain = Boolean(preflight?.creationUncertain || creationUncertainHold);

  return {
    preflight, session, loading, creating, creationUncertain, costConfirmed,
    setCostConfirmed, stopping, stopped, error, stopWarning, preflightError, pollFailed,
    connecting: room.connecting, mediaConnected: mediaReady, videoTrack: room.videoTrack,
    audioBlocked: room.audioBlocked, audioPlaybackReady: room.audioPlaybackReady,
    audioConfirmed: conversation.audioConfirmed, setAudioConfirmed: conversation.setAudioConfirmed,
    message: conversation.message, setMessage: conversation.setMessage, conversation: conversation.conversation,
    turnBusy: conversation.turnBusy, recording: conversation.recording, micPending: conversation.micPending,
    ready: isReady, recoverable: Boolean(session && !terminal), terminal,
    videoHost: room.videoHost, audioHost: room.audioHost, loadPreflight: refresh, createSession,
    sendTurn: conversation.sendTurn, toggleRecording: conversation.toggleRecording, stopSession,
    retryConnection: room.retryConnection, recoverSession, startAudio: room.startAudio,
  };
}
