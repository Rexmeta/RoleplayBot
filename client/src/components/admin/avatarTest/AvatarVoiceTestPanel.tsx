import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import ManagedAvatarRoom from "@/components/chat/ManagedAvatarRoom";
import { AvatarSessionTiming } from "@/components/chat/AvatarSessionTiming";
import { avatarTestReady, avatarTestTerminal } from "@shared/avatar/adminAvatarTest";
import type { AvatarVoiceChoice, AvatarVoiceTestCatalogPage, AvatarVoiceTestSession } from "@shared/avatar/voiceTest";
import type { PersonaVoice } from "@shared/avatar/personaAvatar";

const genderLabels = { male: "남성", female: "여성", neutral: "중립", unclassified: "미분류" } as const;
type Props = {
  target: string;
  initialVoice?: AvatarVoiceChoice;
  initialVoiceName?: string;
  onActivityChange?: (active: boolean) => void;
};

function diagnosticError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("avatar_voice_test_unsupported")) return "현재 연결된 라우터가 이 음성 테스트를 지원하지 않습니다.";
  try {
    // apiRequest includes the HTTP status before the validated BFF error body.
    const result = JSON.parse(message.slice(message.indexOf(": ") + 2));
    if (typeof result.error === "string" && result.error !== result.code) return result.error;
  } catch { /* Use the diagnostic fallback below. */ }
  return "아바타 라우터 요청을 완료하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도하세요.";
}

export function AvatarVoiceTestPanel({ target, initialVoice, initialVoiceName, onActivityChange }: Props) {
  const base = `/api/live-avatar/voice-test/${encodeURIComponent(target)}`;
  const [choice, setChoice] = useState<AvatarVoiceChoice | undefined>(initialVoice);
  const [voices, setVoices] = useState<PersonaVoice[]>([]);
  const [status, setStatus] = useState<AvatarVoiceTestCatalogPage["status"]>();
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [catalogOffset, setCatalogOffset] = useState(0);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [catalogError, setCatalogError] = useState(false);
  const [checking, setChecking] = useState(true);
  const [session, setSession] = useState<AvatarVoiceTestSession | null>(null);
  const [playbackId, setPlaybackId] = useState<string>();
  const [roomId, setRoomId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const pending = useRef(false);
  const catalogPending = useRef(false);
  const sessionRef = useRef<AvatarVoiceTestSession | null>(null);
  const activity = useRef(onActivityChange);
  activity.current = onActivityChange;
  const initialVoiceId = initialVoice?.voiceId;
  const initialGender = initialVoice?.gender;
  useEffect(() => {
    setChoice(initialVoiceId ? { voiceId: initialVoiceId, ...(initialGender ? { gender: initialGender } : {}) } : undefined);
  }, [initialVoiceId, initialGender]);
  const active = !!session && !avatarTestTerminal(session);
  const endpoint = session ? `${base}/sessions/${encodeURIComponent(session.id)}` : null;
  const readyId = session && avatarTestReady(session) ? session.id : undefined;
  useEffect(() => {
    if (readyId && readyId === playbackId) setRoomId(readyId);
  }, [readyId, playbackId]);
  const saveSession = useCallback((value: AvatarVoiceTestSession | null) => {
    sessionRef.current = value;
    if (mounted.current) setSession(value);
  }, []);

  const loadVoices = useCallback(async (offset: number) => {
    if (catalogPending.current) return;
    catalogPending.current = true;
    setCatalogOffset(offset);
    setLoadingVoices(true);
    setCatalogError(false);
    try {
      const response = await apiRequest("GET", `${base}/voices?offset=${offset}`);
      const data: AvatarVoiceTestCatalogPage = await response.json();
      if (!mounted.current) return;
      setStatus(data.status);
      setVoices(previous => Array.from(new Map((offset === 0 ? data.voices : [...previous, ...data.voices])
        .map(voice => [voice.id, voice])).values()));
      setNextOffset(data.nextOffset);
    } catch {
      if (mounted.current) setCatalogError(true);
    } finally {
      catalogPending.current = false;
      if (mounted.current) setLoadingVoices(false);
    }
  }, [base]);

  useEffect(() => {
    activity.current?.(busy || active);
    return () => { activity.current?.(false); };
  }, [busy, active]);

  const keepaliveEnd = useCallback(() => {
    const current = sessionRef.current;
    if (!current || avatarTestTerminal(current)) return;
    const token = localStorage.getItem("authToken");
    void fetch(`${base}/sessions/${encodeURIComponent(current.id)}/end`, {
      method: "POST", keepalive: true, credentials: "include",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: "{}",
    }).catch(() => {});
  }, [base]);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void loadVoices(0);
    void apiRequest("GET", `${base}/session`).then(response => response.json()).then(value => {
      if (!cancelled) saveSession(value);
    }).catch(() => {}).finally(() => { if (!cancelled) setChecking(false); });
    window.addEventListener("pagehide", keepaliveEnd);
    return () => {
      mounted.current = false;
      cancelled = true;
      window.removeEventListener("pagehide", keepaliveEnd);
      setTimeout(() => { if (!mounted.current) keepaliveEnd(); }, 0);
    };
  }, [base, keepaliveEnd, loadVoices, saveSession]);

  useEffect(() => {
    if (!endpoint || !active || busy) return;
    let cancelled = false, polling = false;
    const timer = window.setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        const response = await apiRequest("GET", endpoint);
        const next: AvatarVoiceTestSession = await response.json();
        if (!cancelled && next.id === sessionRef.current?.id && !avatarTestTerminal(sessionRef.current)) saveSession(next);
      } catch {
        if (!cancelled) setError("테스트 세션 상태를 읽지 못했습니다. 라우터 연결을 확인해 주세요.");
      } finally { polling = false; }
    }, 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [active, busy, endpoint, saveSession]);

  async function start() {
    if (pending.current || checking || (sessionRef.current && !avatarTestTerminal(sessionRef.current))) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await apiRequest("POST", `${base}/sessions`, choice ? { voice: choice } : {});
      const next: AvatarVoiceTestSession = await response.json();
      saveSession(next);
      if (mounted.current) setPlaybackId(next.id);
      else keepaliveEnd();
    } catch (cause) {
      if (mounted.current) setError(diagnosticError(cause));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function end() {
    if (pending.current || !endpoint) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await apiRequest("POST", `${endpoint}/end`, {});
      const next: AvatarVoiceTestSession = await response.json();
      saveSession(next);
    } catch (cause) {
      if (mounted.current) setError(diagnosticError(cause));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const knownChoice = voices.find(voice => voice.id === choice?.voiceId);
  const request = session?.requestedVoice;
  const requestedLabel = request && (voices.find(voice => voice.id === request.voiceId)?.name ||
    (request.voiceId === initialVoice?.voiceId && initialVoiceName) || request.voiceId);
  const invalidChoice = !!choice && (status === "unsupported" || status === "unconfigured" || status === "unavailable");
  const catalogWarning = status === "unsupported" ? "현재 라우터에서 음성 선택을 지원하지 않습니다."
    : status === "unavailable" || status === "unconfigured" ? "이 공급자의 음성 목록을 사용할 수 없습니다." : "";
  return <section className="space-y-3 rounded-md border p-3" aria-label="라이브 아바타 음성 선택 테스트">
    <h4 className="font-semibold">음성 선택 테스트</h4>
    <p className="text-sm text-muted-foreground">
      라우터 음성을 골라 마이크로 대화해 보세요. 마이크 음성은 선택한 공급자로 전달됩니다.
      다른 음성은 테스트를 종료한 뒤 선택할 수 있으며, 페르소나 설정은 바뀌지 않습니다.
    </p>
    <label className="block text-sm font-medium">
      테스트 음성 모델
      <select className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm sm:max-w-md"
        value={choice?.voiceId ?? ""} disabled={busy || active} onChange={event => {
          const voice = voices.find(item => item.id === event.target.value);
          setChoice(voice ? { voiceId: voice.id, ...(voice.gender === "unclassified" ? {} : { gender: voice.gender }) } : undefined);
        }}>
        <option value="">공급자 기본 음성</option>
        {choice && !knownChoice && <option value={choice.voiceId}>{initialVoiceName || choice.voiceId} · 페르소나 선택</option>}
        {voices.map(voice => <option key={voice.id} value={voice.id}>{voice.name} · {genderLabels[voice.gender]}</option>)}
      </select>
    </label>
    {loadingVoices && <p role="status" className="text-sm text-muted-foreground">라우터 음성 목록을 불러오는 중…</p>}
    {catalogWarning && <p role="status" className="text-sm text-muted-foreground">{catalogWarning}</p>}
    {catalogError && <div className="flex flex-wrap items-center gap-2">
      <p role="alert" className="text-sm text-destructive">라우터 음성 목록을 불러오지 못했습니다.</p>
      <Button type="button" size="sm" variant="outline" onClick={() => void loadVoices(catalogOffset)}>목록 다시 불러오기</Button>
    </div>}
    {status === "available" && !loadingVoices && !catalogError && voices.length === 0 && nextOffset === null &&
      <p role="status" className="text-sm text-muted-foreground">선택할 수 있는 음성이 없습니다. 공급자 기본 음성으로 테스트할 수 있습니다.</p>}
    {nextOffset !== null && !catalogError && <Button type="button" size="sm" variant="outline" disabled={loadingVoices}
      onClick={() => void loadVoices(nextOffset)}>음성 더 보기</Button>}
    <div className="flex flex-wrap items-center gap-2">
      {!active && <Button type="button" onClick={() => void start()} disabled={busy || checking || invalidChoice}>
        {busy ? "라우터 연결 중…" : "선택 음성으로 테스트"}
      </Button>}
      {active && <Button type="button" variant="outline" onClick={() => void end()} disabled={busy || session.stopRequested}>
        {session.stopRequested ? "종료 처리 중…" : "테스트 종료"}
      </Button>}
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {session && <p role="status" className="text-sm text-muted-foreground">
      요청한 음성: {requestedLabel || "공급자 기본 음성"} · {session.cleanupPending ? "정리 중" : active ? "테스트 진행 중" : "테스트 종료"}
    </p>}
    {session && <AvatarSessionTiming timing={session.timing} />}
    {active && endpoint && playbackId !== session.id && !session.stopRequested &&
      <p className="text-sm text-muted-foreground">기존 테스트가 남아 있습니다. 종료한 뒤 새 음성으로 연결할 수 있습니다.</p>}
    {active && endpoint && roomId === session.id && !session.stopRequested &&
      <div className="h-80 overflow-hidden rounded-md"><ManagedAvatarRoom endpoint={endpoint} onError={setError} /></div>}
  </section>;
}
