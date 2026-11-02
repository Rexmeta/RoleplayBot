import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Loader2, Radio, Video } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { apiRequest } from "@/lib/queryClient";
import { liveAvatarBlockerText, liveAvatarConnectionError } from "@/lib/liveAvatarBlockers";
import { AvatarTestSession, avatarTestReady, avatarTestTerminal } from "@shared/avatar/adminAvatarTest";
import { useAvatarTestRoom } from "@/components/admin/avatarTest/useAvatarTestRoom";

type Props = {
  conversationId: string;
  voiceMode: boolean;
  portraitHost?: HTMLElement | null;
  actorId?: string | number;
  optionsRequest?: number;
};
type Availability = {
  enabled: boolean;
  allowed: boolean;
  contractReady: boolean;
  available: boolean;
  blockers: string[];
};

export function LiveAvatarChoice({ conversationId, voiceMode, portraitHost = null, actorId, optionsRequest = 0 }: Props) {
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;
  const endpoint = `/api/live-avatar/conversations/${encodeURIComponent(conversationId)}`;
  const [requested, setRequested] = useState(false);
  const [consent, setConsent] = useState(false);
  const [session, setSession] = useState<AvatarTestSession | null>(null);
  const [creating, setCreating] = useState(false);
  const [creationLocked, setCreationLocked] = useState(false);
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [recoveryFailed, setRecoveryFailed] = useState(false);
  const [creationUncertain, setCreationUncertain] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [endAccepted, setEndAccepted] = useState(false);
  const [pollFailed, setPollFailed] = useState(false);
  const [error, setError] = useState("");
  const [fallbackWarning, setFallbackWarning] = useState("");
  const [mediaReady, setMediaReady] = useState(false);
  const sessionRef = useRef<AvatarTestSession | null>(null);
  const mountedRef = useRef(false);
  const stoppedRef = useRef(false);
  const stoppingRef = useRef(false);
  const pollFailedRef = useRef(false);
  const creatingRef = useRef(false);
  const mediaReadyRef = useRef(false);
  const previousMediaReadyRef = useRef(false);
  const endRequestedRef = useRef(new Set<string>());
  const pollBusyRef = useRef(false);
  const recoveryConversationRef = useRef(conversationId);
  recoveryConversationRef.current = conversationId;
  const currentActorRef = useRef(actorId);
  currentActorRef.current = actorId;
  const previousActorRef = useRef(actorId);
  const retiredSessionIdRef = useRef<string | null>(null);

  const assignSession = useCallback((value: AvatarTestSession | null) => {
    sessionRef.current = value;
    if (mountedRef.current) setSession(value);
  }, []);
  const setRoomError = useCallback((message: string) => setError(message), []);
  const room = useAvatarTestRoom({
    endpoint,
    session,
    sessionRef,
    mountedRef,
    stoppedRef,
    stoppingRef,
    pollFailedRef,
    onError: setRoomError,
  });

  const availabilityQuery = useQuery<Availability>({
    queryKey: ["/api/live-avatar/conversations", conversationId, "availability", actorId],
    enabled: Boolean(conversationId && requested),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    queryFn: async () =>
      (await apiRequest("GET", `${endpoint}/availability`)).json(),
  });
  const availability = availabilityQuery.data;
  const canStart = Boolean(voiceMode && consent && availability?.enabled && availability.allowed &&
    availability.contractReady && availability.available && !creating && !creationLocked &&
    !recoveryPending && !recoveryFailed && !creationUncertain &&
    !sessionRef.current && !session);

  const endKeepalive = useCallback((target: AvatarTestSession | null) => {
    if (!target || avatarTestTerminal(target) || endRequestedRef.current.has(target.id)) return;
    endRequestedRef.current.add(target.id);
    const auth = localStorage.getItem("authToken");
    void fetch(`${endpoint}/sessions/${encodeURIComponent(target.id)}/end`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
      body: "{}",
      credentials: "include",
      keepalive: true,
    }).then((response) => {
      if (!response.ok) endRequestedRef.current.delete(target.id);
    }).catch(() => endRequestedRef.current.delete(target.id));
  }, [endpoint]);

  const recoverSession = useCallback(async () => {
    const recoveryConversationId = conversationId;
    const recoveryActorId = actorId;
    setRecoveryPending(true);
    setRecoveryFailed(false);
    setError("");
    setFallbackWarning("");
    try {
      const recovery = await (await apiRequest("GET", `${endpoint}/session`)).json() as {
        session: AvatarTestSession | null;
        creationUncertain: boolean;
      };
      if (!mountedRef.current || recoveryConversationRef.current !== recoveryConversationId || currentActorRef.current !== recoveryActorId) return;
      setCreationUncertain(recovery.creationUncertain);
      if (recovery.session && !(avatarTestTerminal(recovery.session) && !recovery.session.cleanupPending)) {
        if (recovery.session.id === retiredSessionIdRef.current) {
          setCreationLocked(true);
          assignSession(null);
          setError("이전 배우의 라이브 세션 종료를 확인하고 있습니다. 중복 연결을 막기 위해 새 시작은 잠겨 있습니다.");
          return;
        }
        setCreationLocked(recovery.creationUncertain);
        stoppedRef.current = false;
        setEndAccepted(false);
        assignSession(recovery.session);
      } else {
        if (recovery.session?.id === retiredSessionIdRef.current) retiredSessionIdRef.current = null;
        setCreationLocked(recovery.creationUncertain);
        assignSession(null);
        stoppedRef.current = false;
      }
    } catch (cause) {
      if (mountedRef.current && recoveryConversationRef.current === recoveryConversationId && currentActorRef.current === recoveryActorId) {
        setRecoveryFailed(true);
        setCreationLocked(true);
        const detail = liveAvatarConnectionError(cause, tRef.current) ?? (cause instanceof Error ? cause.message : "");
        setError(detail ? `기존 세션 복구에 실패했습니다: ${detail}` : "기존 세션 복구에 실패했습니다.");
      }
    } finally {
      if (mountedRef.current && recoveryConversationRef.current === recoveryConversationId && currentActorRef.current === recoveryActorId) setRecoveryPending(false);
    }
  }, [conversationId, actorId, endpoint, assignSession]);

  const stopMedia = useCallback(async (keepalive = false) => {
    const current = sessionRef.current;
    if (!current || avatarTestTerminal(current) || stoppingRef.current) {
      room.disconnectMedia();
      stoppedRef.current = true;
      return;
    }
    stoppedRef.current = true;
    stoppingRef.current = true;
    setStopping(true);
    setMediaReady(false);
    mediaReadyRef.current = false;
    room.disconnectMedia();
    if (keepalive) {
      endKeepalive(current);
    } else {
      if (endRequestedRef.current.has(current.id) && (current.cleanupPending || endAccepted)) {
        endRequestedRef.current.delete(current.id);
        setEndAccepted(false);
      }
      if (endRequestedRef.current.has(current.id)) {
        stoppingRef.current = false;
        if (mountedRef.current) setStopping(false);
        return;
      }
      endRequestedRef.current.add(current.id);
      try {
        try { await apiRequest("POST", `${endpoint}/sessions/${encodeURIComponent(current.id)}/interrupt`, {}); } catch { /* end remains authoritative */ }
        await apiRequest("POST", `${endpoint}/sessions/${encodeURIComponent(current.id)}/end`, {});
        setEndAccepted(true);
      } catch (cause) {
        endRequestedRef.current.delete(current.id);
        setEndAccepted(false);
        setError(cause instanceof Error ? cause.message : "세션 종료 상태를 확인하지 못했습니다.");
      }
    }
    stoppingRef.current = false;
    if (mountedRef.current) setStopping(false);
  }, [endpoint, endAccepted, endKeepalive, room.disconnectMedia]);

  const failAndEnd = useCallback((message: string) => {
    setError(message);
    pollFailedRef.current = true;
    setPollFailed(true);
    room.disconnectMedia();
    void stopMedia();
  }, [room.disconnectMedia, stopMedia]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const current = sessionRef.current;
      stoppedRef.current = true;
      room.disconnectMedia();
      endKeepalive(current);
    };
  }, [room.disconnectMedia, endKeepalive]);

  useEffect(() => {
    setRequested(false);
    setConsent(false);
    setCreationLocked(false);
    setRecoveryPending(false);
    setRecoveryFailed(false);
    setCreationUncertain(false);
    setError("");
    setFallbackWarning("");
    setEndAccepted(false);
    setPollFailed(false);
    pollFailedRef.current = false;
    mediaReadyRef.current = false;
    previousMediaReadyRef.current = false;
    stoppedRef.current = false;
    assignSession(null);
    room.disconnectMedia();
  }, [conversationId, assignSession, room.disconnectMedia]);

  useEffect(() => {
    if (previousActorRef.current === actorId) return;
    previousActorRef.current = actorId;
    setRequested(false);
    setConsent(false);
    setRecoveryPending(false);
    setRecoveryFailed(false);
    setError("");
    setFallbackWarning("");
    setEndAccepted(false);
    const current = sessionRef.current;
    if (current && !avatarTestTerminal(current)) {
      retiredSessionIdRef.current = current.id;
      void stopMedia(true);
    }
    else {
      stoppedRef.current = true;
      room.disconnectMedia();
    }
  }, [actorId, room.disconnectMedia, stopMedia]);

  useEffect(() => {
    if (optionsRequest <= 0) return;
    setRequested(true);
    setConsent(false);
    void recoverSession();
  }, [optionsRequest, recoverSession]);

  useEffect(() => {
    if (voiceMode) return;
    setConsent(false);
    const current = sessionRef.current;
    if (current && !avatarTestTerminal(current)) void stopMedia(true);
  }, [voiceMode, stopMedia]);

  useEffect(() => {
    const onFallback = (event: Event) => {
      const detail = (event as CustomEvent<{ conversationId?: string }>).detail;
      const current = sessionRef.current;
      if (detail?.conversationId !== conversationId || !current || avatarTestTerminal(current)) return;
      stoppedRef.current = true;
      previousMediaReadyRef.current = true;
      mediaReadyRef.current = false;
      setMediaReady(false);
      setFallbackWarning("실시간 아바타 오디오 소유권이 종료되었거나 대화가 중단되어 라이브 미디어를 종료했습니다. 기존 음성 대화로 계속 진행합니다.");
      room.disconnectMedia();
      void stopMedia();
    };
    window.addEventListener("live-avatar-fallback", onFallback);
    return () => window.removeEventListener("live-avatar-fallback", onFallback);
  }, [conversationId, room.disconnectMedia, stopMedia]);

  useEffect(() => {
    const activeId = session?.id;
    if (!activeId || avatarTestTerminal(session)) return;
    const poll = async () => {
      if (pollBusyRef.current || !mountedRef.current || sessionRef.current?.id !== activeId) return;
      pollBusyRef.current = true;
      try {
        const fresh = await (await apiRequest("GET", `${endpoint}/sessions/${encodeURIComponent(activeId)}`)).json() as AvatarTestSession;
        if (!mountedRef.current || sessionRef.current?.id !== activeId) return;
        assignSession(fresh);
        pollFailedRef.current = false;
        setPollFailed(false);
        if (avatarTestTerminal(fresh)) {
          stoppedRef.current = true;
          endRequestedRef.current.delete(activeId);
          setEndAccepted(false);
          setMediaReady(false);
          mediaReadyRef.current = false;
          previousMediaReadyRef.current = false;
          room.disconnectMedia();
          assignSession(null);
        }
      } catch (cause) {
        if (mountedRef.current && sessionRef.current?.id === activeId) {
          failAndEnd(cause instanceof Error ? `세션 상태 확인에 실패했습니다: ${cause.message}` : "세션 상태 확인에 실패했습니다.");
        }
      } finally {
        pollBusyRef.current = false;
      }
    };
    const timer = window.setInterval(() => void poll(), 2000);
    return () => window.clearInterval(timer);
  }, [session?.id, endpoint, assignSession, failAndEnd, room.disconnectMedia]);

  useEffect(() => {
    if (!session || !room.mediaConnected || !room.audioPlaybackReady || !room.videoTrack ||
        !avatarTestReady(session) || pollFailed || stoppedRef.current) return;
    if (mediaReadyRef.current) return;
    mediaReadyRef.current = true;
    previousMediaReadyRef.current = true;
    void (async () => {
      try {
        await apiRequest("POST", `${endpoint}/sessions/${encodeURIComponent(session.id)}/media-ready`, {});
        if (mountedRef.current && sessionRef.current?.id === session.id && !stoppedRef.current) setMediaReady(true);
      } catch (cause) {
        failAndEnd(cause instanceof Error ? `미디어 준비를 서버에 알리지 못했습니다: ${cause.message}` : "미디어 준비를 서버에 알리지 못했습니다.");
      }
    })();
  }, [session, room.mediaConnected, room.audioPlaybackReady, room.videoTrack, pollFailed, endpoint, failAndEnd]);

  useEffect(() => {
    if (!previousMediaReadyRef.current || room.mediaConnected || !sessionRef.current || stoppedRef.current || stoppingRef.current) return;
    failAndEnd("실시간 아바타 미디어 연결이 끊기거나 재연결 중입니다. 라이브 미디어를 종료했으며 기존 음성 대화로 계속할 수 있습니다.");
  }, [room.mediaConnected, failAndEnd]);

  const startSession = async () => {
    if (!canStart || creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    setError("");
    stoppedRef.current = false;
    const startingActorId = actorId;
    try {
      const created = await (await apiRequest("POST", `${endpoint}/sessions`, { service: "avatar-router", consent: true })).json() as AvatarTestSession;
      if (currentActorRef.current !== startingActorId) {
        retiredSessionIdRef.current = created.id;
        stoppedRef.current = true;
        setCreationLocked(true);
        assignSession(created);
        setError("페르소나가 변경되어 이전 아바타 세션을 종료하고 있습니다. 정리가 완료된 뒤 현재 페르소나로 다시 시작하세요.");
        endKeepalive(created);
        return;
      }
      if (!mountedRef.current) {
        sessionRef.current = created;
        endKeepalive(created);
        return;
      }
      assignSession(created);
      setCreationLocked(false);
      setCreationUncertain(false);
      setRecoveryFailed(false);
      mediaReadyRef.current = false;
      previousMediaReadyRef.current = false;
      setMediaReady(false);
      setPollFailed(false);
      pollFailedRef.current = false;
    } catch (cause) {
      // A timeout may have created a billable session remotely. Lock creation until reload/recovery.
      setCreationLocked(true);
      setError(cause instanceof Error ? cause.message : "세션 요청 결과를 확인할 수 없습니다. 중복 생성을 막기 위해 다시 시작하려면 페이지를 새로고침하세요.");
    } finally {
      creatingRef.current = false;
      if (mountedRef.current) setCreating(false);
    }
  };

  const errorText = (cause: unknown) => cause instanceof Error ? cause.message : t("liveAvatar.errors.unknown", { defaultValue: "알 수 없는 오류가 발생했습니다." });
  const activeSession = Boolean(session && !avatarTestTerminal(session));
  const mediaPlaybackReady = Boolean(mediaReady && room.mediaConnected && room.videoTrack && !stoppedRef.current);

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4" aria-label={t("liveAvatar.choice.title", { defaultValue: "실시간 아바타 선택" })}>
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-primary/10 p-2 text-primary"><Radio className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{t("liveAvatar.choice.title", { defaultValue: "실시간 아바타" })}</h3>
            <Badge variant="secondary">{t("liveAvatar.choice.optional", { defaultValue: "선택 사항" })}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("liveAvatar.choice.voiceModeNote", { defaultValue: "기존 음성 대화는 그대로 유지됩니다. 실시간 영상·음성은 직접 선택하고 동의한 경우에만 연결됩니다." })}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {mediaReady ? "현재: 실제 아바타 영상과 오디오 재생 중" : "현재: 기존 아바타·음성 사용"}
          </p>
        </div>
      </div>

      {!requested && !activeSession ? (
        <Button type="button" variant="outline" onClick={() => { setRequested(true); void recoverSession(); }}>
          {t("liveAvatar.choice.request", { defaultValue: "실시간 아바타 옵션 보기" })}
        </Button>
      ) : (
        <div className="space-y-3 border-t pt-3">
          {!activeSession && <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
            <Checkbox checked={consent} onCheckedChange={(checked) => setConsent(checked === true)}
              aria-label={t("liveAvatar.choice.consent", { defaultValue: "외부 AI 오디오 사용에 동의합니다." })} />
            <span className="text-sm leading-5">
              <span className="font-medium">{t("liveAvatar.choice.consentTitle", { defaultValue: "외부 AI 오디오에 동의" })}</span>
              <span className="mt-1 block text-muted-foreground">
                {t("liveAvatar.choice.consent", { defaultValue: "외부 AI 서비스로 오디오가 전송될 수 있으며 사용 요금이 발생할 수 있음을 확인합니다." })}
              </span>
            </span>
          </label>}

          {availabilityQuery.isLoading ? (
            <div className="h-14 animate-pulse rounded-md bg-muted/70" aria-label={t("common.loading", { defaultValue: "불러오는 중" })} />
          ) : availabilityQuery.isError ? (
            <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <p>{t("liveAvatar.errors.availability", { defaultValue: "실시간 사용 가능 상태를 확인하지 못했습니다." })} {errorText(availabilityQuery.error)}</p>
              <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => void availabilityQuery.refetch()}>
                {t("common.retry", { defaultValue: "다시 시도" })}
              </Button>
            </div>
          ) : availability ? (
            <>
              <div className="flex items-center gap-2 text-sm">
                {availability.enabled && availability.allowed && availability.available && availability.contractReady
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                  : <AlertTriangle className="h-4 w-4 text-amber-700" />}
                <span className="font-medium">
                  {availability.enabled && availability.allowed && availability.available && availability.contractReady ? "사용 가능" : "현재 사용할 수 없음"}
                </span>
              </div>
              {!availability.enabled && <p className="text-sm text-muted-foreground">전역 설정이 꺼져 있습니다.</p>}
              {!availability.allowed && <p className="text-sm text-muted-foreground">이 시나리오에서 허용되지 않았습니다.</p>}
              {!availability.contractReady && <p className="text-sm text-muted-foreground">외부 서비스 연동 계약이 준비되지 않아 실시간 세션을 시작할 수 없습니다.</p>}
              {!voiceMode && <p className="text-sm text-muted-foreground">라이브 아바타는 실시간 음성 대화에서만 사용할 수 있습니다.</p>}
              {availability.blockers.length > 0 && (
                <ul className="list-inside list-disc space-y-1 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-muted-foreground">
                  {availability.blockers.map((blocker, index) => <li key={`${index}-${blocker}`}>{liveAvatarBlockerText(blocker, t)}</li>)}
                </ul>
              )}
            </>
          ) : null}

          {error && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}
          {fallbackWarning && <p role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-900">{fallbackWarning}</p>}
          {recoveryPending && <div role="status" className="h-10 animate-pulse rounded-md bg-muted/70" aria-label="기존 세션 상태 확인 중" />}
          {(creationLocked || creationUncertain) && <p role="status" className="text-sm text-amber-800">
            {creationUncertain
              ? "기존 요청의 생성 결과를 확인 중입니다. 중복 생성을 막기 위해 새 세션은 잠겨 있습니다."
              : "요청 결과가 불확실하여 중복 세션 생성을 잠갔습니다. 기존 세션 상태를 복구하세요."}
          </p>}
          {(recoveryFailed || creationLocked || creationUncertain) && <Button type="button" size="sm" variant="outline" disabled={recoveryPending} onClick={() => {
            void availabilityQuery.refetch();
            void recoverSession();
          }}>
            {recoveryPending ? "복구 확인 중…" : "기존 세션 상태 다시 확인"}
          </Button>}
          {session && (
            <div className="space-y-3 rounded-md border p-3">
              {portraitHost ? createPortal(
                <div
                  data-testid="live-avatar-portrait-video"
                  aria-hidden="true"
                  className={`pointer-events-none absolute inset-0 overflow-hidden transition-opacity duration-300 ${mediaPlaybackReady ? "opacity-100" : "opacity-0"}`}
                >
                  <div ref={room.videoHost} className="absolute inset-0" />
                  {mediaPlaybackReady && <span className="absolute bottom-20 right-3 rounded-full border border-white/25 bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white shadow">
                    실시간 아바타
                  </span>}
                </div>,
                portraitHost,
              ) : (
                <div className="relative aspect-video overflow-hidden rounded-md bg-slate-950">
                  <div ref={room.videoHost} className="absolute inset-0" />
                  {!room.videoTrack && <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center text-slate-100">
                    {room.connecting ? <Loader2 className="h-6 w-6 animate-spin" /> : <Video className="h-6 w-6 opacity-70" />}
                    <span className="text-sm">{room.connecting ? "아바타 미디어 연결 중…" : "영상 트랙 대기 중"}</span>
                  </div>}
                </div>
              )}
              <div ref={room.audioHost} className="sr-only" aria-label="아바타 음성 출력" />
              <p role="status" className="text-sm">
                {pollFailed ? "상태 확인 실패 · 미디어 연결 종료" : mediaReady ? "실시간 영상과 재생 가능한 오디오 연결됨" :
                  room.audioBlocked ? "오디오 재생 허용이 필요합니다." : room.connecting ? "아바타 미디어 연결 중…" :
                    `세션 ${session.status} · ${session.rendererState || "renderer 확인 중"}`}
              </p>
              {room.audioBlocked && <Button type="button" variant="outline" onClick={() => void room.startAudio()}>오디오 재생 허용</Button>}
              {(activeSession || session.cleanupPending) && <Button type="button" variant="destructive" disabled={stopping} onClick={() => void stopMedia()}>
                {stopping ? "종료 요청 중…" : session.cleanupPending || endAccepted ? "종료 상태 재확인" : "실시간 아바타 종료"}
              </Button>}
              {(session.cleanupPending || endAccepted) && <p role="status" className="text-sm text-amber-800">종료 요청은 접수됐지만 정리 완료는 아직 확인되지 않았습니다. 세션 상태를 확인 중입니다.</p>}
              {!mediaReady && previousMediaReadyRef.current && <p className="text-sm text-amber-800">라이브 미디어가 중단되었습니다. 기존 음성 대화는 계속 사용할 수 있습니다.</p>}
            </div>
          )}
          {!session && (
            <>
              <Button type="button" variant="outline" className="mr-2" onClick={() => { setRequested(false); setConsent(false); }}>
                {t("liveAvatar.choice.keepExisting", { defaultValue: "기존 방식 유지" })}
              </Button>
              <Button type="button" disabled={!canStart} onClick={() => void startSession()}>
                {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {creating ? "세션 시작 중…" : t("liveAvatar.choice.start", { defaultValue: "실시간 아바타 시작" })}
              </Button>
              <p className="text-xs text-muted-foreground">전역·시나리오 허용, 서비스 준비, 음성 모드, 명시적 동의가 모두 충족될 때만 세션을 요청합니다. 기존 음성 대화는 유지됩니다.</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
