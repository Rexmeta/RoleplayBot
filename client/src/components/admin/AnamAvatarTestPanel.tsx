import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { avatarTestReady, avatarTestTerminal, type AvatarTestPreflight, type AvatarTestSession } from "@shared/avatar/adminAvatarTest";
import ManagedAvatarRoom from "@/components/chat/ManagedAvatarRoom";

const base = "/api/live-avatar/stock/anam-persona-default/test";
export function AnamAvatarTestPanel({ onActivityChange }: { onActivityChange?: (active: boolean) => void }) {
  const [preflight, setPreflight] = useState<AvatarTestPreflight>();
  const [session, setSession] = useState<AvatarTestSession>();
  const [playbackSessionId, setPlaybackSessionId] = useState<string>();
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const sessionRef = useRef<AvatarTestSession>();
  const creating = useRef(false);
  const mounted = useRef(false);
  const terminal = !!session && avatarTestTerminal(session);
  const activityRef = useRef(onActivityChange);
  activityRef.current = onActivityChange;
  useEffect(() => { activityRef.current?.(busy || uncertain || !!session && !terminal); }, [busy, uncertain, session, terminal]);
  const refresh = useCallback(async () => {
    try {
      const response = await apiRequest("GET", `${base}/preflight`);
      const data = await response.json() as AvatarTestPreflight;
      if (!mounted.current) return;
      setPreflight(data);
      setUncertain(data.creationUncertain);
      const recovered = data.sessions.find(s => !avatarTestTerminal(s));
      if (recovered) { sessionRef.current = recovered; setSession(recovered); }
    } catch { if (mounted.current) setError("라이브 아바타 상태를 확인하지 못했습니다. 새 세션을 시작하지 마세요."); }
  }, []);
  const keepaliveEnd = () => {
    const current = sessionRef.current;
    if (!current || avatarTestTerminal(current)) return;
    const token = localStorage.getItem("authToken");
    void fetch(`${base}/sessions/${encodeURIComponent(current.id)}/end`, {
      method: "POST", keepalive: true, credentials: "include",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: "{}",
    }).catch(() => {});
  };
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const hide = () => keepaliveEnd();
    window.addEventListener("pagehide", hide);
    return () => {
      mounted.current = false;
      window.removeEventListener("pagehide", hide);
      setTimeout(() => { if (!mounted.current) keepaliveEnd(); }, 0);
    };
  }, [refresh]);
  useEffect(() => {
    if (!session || terminal) return;
    let polling = false, cancelled = false;
    const timer = setInterval(() => {
      if (polling) return;
      polling = true;
      void apiRequest("GET", `${base}/sessions/${encodeURIComponent(session.id)}`)
        .then(response => response.json()).then((next: AvatarTestSession) => {
          if (cancelled) return;
          sessionRef.current = next; setSession(next);
          if (avatarTestTerminal(next)) void refresh();
        }).catch(() => { if (!cancelled) setError("세션 상태 조회 실패. 종료를 요청한 뒤 정리 상태를 확인하세요."); })
        .finally(() => { polling = false; });
    }, 2000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [session?.id, terminal, refresh]);
  const start = async () => {
    if (creating.current || !consent || !preflight?.ready || uncertain) return;
    creating.current = true; setBusy(true); setError(""); setUncertain(true);
    try {
      const response = await apiRequest("POST", `${base}/sessions`, { costConfirmed: true, audioConfirmed: true });
      const next = await response.json() as AvatarTestSession;
      sessionRef.current = next;
      if (!mounted.current) { keepaliveEnd(); return; }
      setSession(next); setPlaybackSessionId(next.id); setUncertain(false);
    } catch {
      if (mounted.current) {
        setError("생성 요청을 완료하지 못했습니다. 결과가 확인될 때까지 다시 생성하지 마세요.");
        void refresh();
      }
    } finally {
      creating.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const end = async () => {
    if (!session) return;
    setBusy(true);
    try {
      const response = await apiRequest("POST", `${base}/sessions/${encodeURIComponent(session.id)}/end`, {});
      const next = await response.json() as AvatarTestSession;
      if (mounted.current) { sessionRef.current = next; setSession(next); }
    } catch { if (mounted.current) setError("종료를 확인하지 못했습니다. 종료 요청을 다시 시도하세요."); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <section className="space-y-3 border-t pt-4" aria-label="기본 아바타 테스트">
    <h4 className="font-semibold">기본 아바타 테스트</h4>
    <p className="text-sm text-slate-600">외부 서비스가 마이크·대화·음성을 처리합니다. 다른 음성 응답 기능은 동시에 실행하지 않습니다. 서비스에 저장된 페르소나를 사용하며 이 앱의 시나리오 지침과 평가 기록은 전달되지 않습니다.</p>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={consent} disabled={busy || !!session && !terminal}
      onChange={e => setConsent(e.target.checked)} />유료 세션 생성과 마이크·음성 전송에 동의합니다.</label>
    <div className="flex gap-2">
      <Button type="button" disabled={!consent || !preflight?.ready || busy || uncertain || !!session && !terminal} onClick={() => void start()}>기본 아바타 테스트 시작</Button>
      <Button type="button" variant="outline" onClick={() => void refresh()} disabled={busy}>상태 확인</Button>
      {session && !terminal && <Button type="button" variant="outline" disabled={busy} onClick={() => void end()}>종료 요청</Button>}
    </div>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {uncertain && <p role="alert" className="text-sm text-amber-800">생성 결과 확인 중입니다. 새 세션 생성은 차단됩니다.</p>}
    {preflight && !preflight.ready && <p className="text-sm text-amber-800">현재 시작할 수 없습니다. {preflight.runtimeError ?? (preflight.missingScopes.length ? `권한 부족: ${preflight.missingScopes.join(", ")}` : "사용량·작업 서버·이전 세션 정리 상태를 확인하세요.")}</p>}
    {session && <p role="status" className="text-sm">{session.status} · {session.rendererState} {session.cleanupPending ? "· 제공자 정리 중" : ""}</p>}
    {session && !terminal && playbackSessionId !== session.id && <p className="text-sm text-amber-800">기존 세션을 복구했습니다. 일회용 연결을 다시 요청하지 않습니다. 종료 후 정리 상태를 확인하세요.</p>}
    {session && playbackSessionId === session.id && avatarTestReady(session) && !terminal &&
      <div className="h-80 overflow-hidden rounded"><ManagedAvatarRoom endpoint={`${base}/sessions/${encodeURIComponent(session.id)}`} onError={setError} /></div>}
  </section>;
}
