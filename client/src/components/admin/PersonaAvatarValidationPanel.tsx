import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ShieldCheck, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AvatarTestHeader, AvatarTestPreflightView } from "@/components/admin/avatarTest/AvatarTestPreflightView";
import { AvatarTestSessionView } from "@/components/admin/avatarTest/AvatarTestSessionView";
import { useAdminAvatarTest } from "@/components/admin/avatarTest/useAdminAvatarTest";
import { apiRequest } from "@/lib/queryClient";
import { avatarTestReady } from "@shared/avatar/adminAvatarTest";

const validationEndpoint = (assetId: string) =>
  `/api/admin/personas/live-avatar/assets/${encodeURIComponent(assetId)}/validation`;

export function PersonaAvatarValidationPanel({ assetId, assetName, onReported }: { assetId: string; assetName: string; onReported: () => void }) {
  const test = useAdminAvatarTest(validationEndpoint(assetId));
  const mountedRef = useRef(false);
  const [videoObserved, setVideoObserved] = useState(false);
  const [turnObserved, setTurnObserved] = useState(false);
  const [videoConfirmed, setVideoConfirmed] = useState(false);
  const [audioConfirmed, setAudioConfirmed] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportMessage, setReportMessage] = useState("");
  const generationRef = useRef(0);
  const turnBaselineRef = useRef(0);
  const session = test.session;
  const sessionRunning = Boolean(session && avatarTestReady(session) && !test.stopped && !test.stopping &&
    !test.pollFailed && Date.parse(session.expiresAt) > Date.now());
  const playbackReady = Boolean(test.mediaConnected && test.audioPlaybackReady && test.videoTrack && sessionRunning);
  const successfulTurn = turnObserved;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    generationRef.current += 1;
    setVideoObserved(false);
    setTurnObserved(false);
    turnBaselineRef.current = test.conversation.length;
    setVideoConfirmed(false);
    setAudioConfirmed(false);
    setReportMessage("");
    if (!playbackReady || !test.videoHost.current) return;
    const generation = generationRef.current;
    let frameSeen = false;
    let frameBaseline = 0;
    let video: HTMLVideoElement | null = null;
    let rafId: number | undefined;
    let observer: MutationObserver | undefined;
    const markFrame = () => {
      if (generationRef.current !== generation || frameSeen) return;
      frameSeen = true;
      setVideoObserved(true);
    };
    const inspect = () => {
      if (!video) return;
      const quality = video.getVideoPlaybackQuality?.();
      if (quality && quality.totalVideoFrames > frameBaseline) markFrame();
      const callbackVideo = video as HTMLVideoElement & {
        requestVideoFrameCallback?: (callback: () => void) => number;
        cancelVideoFrameCallback?: (id: number) => void;
      };
      if (!frameSeen && rafId === undefined && callbackVideo.requestVideoFrameCallback) {
        rafId = callbackVideo.requestVideoFrameCallback(() => { rafId = undefined; markFrame(); });
      }
    };
    const bind = () => {
      const candidate = test.videoHost.current?.querySelector("video") ?? null;
      if (candidate === video) { inspect(); return; }
      if (video && rafId !== undefined) {
        const oldVideo = video as HTMLVideoElement & { cancelVideoFrameCallback?: (id: number) => void };
        oldVideo.cancelVideoFrameCallback?.(rafId);
      }
      video = candidate;
      rafId = undefined;
      if (!video) return;
      frameBaseline = video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0;
      inspect();
      if (!frameSeen) {
        const id = window.setInterval(inspect, 300);
        intervalIds.push(id);
      }
    };
    const intervalIds: number[] = [];
    observer = new MutationObserver(bind);
    observer.observe(test.videoHost.current, { childList: true, subtree: true });
    bind();
    return () => {
      generationRef.current += 1;
      observer?.disconnect();
      intervalIds.forEach(window.clearInterval);
      if (video && rafId !== undefined) {
        const callbackVideo = video as HTMLVideoElement & { cancelVideoFrameCallback?: (id: number) => void };
        callbackVideo.cancelVideoFrameCallback?.(rafId);
      }
    };
  }, [session?.id, playbackReady, test.videoTrack, test.videoHost]);

  useEffect(() => {
    if (!playbackReady || test.conversation.length <= turnBaselineRef.current) return;
    const newMessages = test.conversation.slice(turnBaselineRef.current);
    if (newMessages.some(item => item.role === "assistant")) setTurnObserved(true);
  }, [playbackReady, test.conversation]);

  useEffect(() => {
    if (!playbackReady) {
      setVideoConfirmed(false);
      setAudioConfirmed(false);
    }
  }, [playbackReady]);

  const report = async () => {
    if (!session || !playbackReady || !sessionRunning || !videoObserved || !successfulTurn || test.turnBusy || !test.audioPlaybackReady ||
        !videoConfirmed || !audioConfirmed || reporting) return;
    const generation = generationRef.current;
    setReporting(true);
    setReportMessage("");
    try {
      await apiRequest("POST", `${validationEndpoint(assetId)}/report`, {
        sessionId: session.id, videoObserved: true, audioObserved: true,
      });
      if (!mountedRef.current || generationRef.current !== generation) return;
      setReportMessage("재생 확인 결과를 기록했습니다. 카탈로그를 다시 조회했습니다.");
      onReported();
    } catch {
      if (!mountedRef.current) return;
      setReportMessage("재생 확인 결과를 기록하지 못했습니다. 세션 상태와 연결을 확인하세요.");
    } finally { if (mountedRef.current) setReporting(false); }
  };

  const canReport = Boolean(playbackReady && sessionRunning && !test.turnBusy && videoObserved && successfulTurn && test.audioPlaybackReady &&
    videoConfirmed && audioConfirmed && !reporting);

  return <section className="mt-4 space-y-4 rounded-md border border-indigo-200 bg-indigo-50/40 p-4" aria-labelledby="persona-live-validation-title">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h4 id="persona-live-validation-title" className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <Video className="h-4 w-4 text-indigo-700" />Tavus 실제 재생 점검
        </h4>
        <p className="mt-1 text-xs leading-relaxed text-slate-600">{assetName} · 학습자 대화와 분리된 관리자 전용 테스트 세션입니다.</p>
      </div>
      <span className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900">독립 인증이 아닌 클라이언트 재생 보고</span>
    </header>
    <div className="flex items-start gap-2 rounded-md border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-700">
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-indigo-700" />
      <p>영상 프레임은 브라우저 재생 요소에서 직접 확인하고, 오디오 재생 준비와 성공한 테스트 턴을 확인합니다. 영상 시청 및 음성 청취 체크는 운영자가 직접 확인해야 합니다. 보고는 별도 버튼으로만 전송되며 Tavus 제공자나 실제 학습자 런타임의 독립 인증을 의미하지 않습니다.</p>
    </div>
    <AvatarTestHeader test={test} />
    {test.preflight?.runtimeError && <p role="alert" className="text-xs text-amber-900">
      현재 자산의 커스텀 런타임을 사용할 수 없어 새 세션 생성이 차단되었습니다. 기존 세션의 상태 확인과 종료는 계속할 수 있습니다.
    </p>}
    {test.creationUncertain && !test.preflight && <div role="alert" className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs">
      <AlertTriangle className="h-4 w-4 shrink-0" />세션 생성 결과가 불확실합니다. 상태를 새로고침하여 원격 조정 결과를 확인하세요.
    </div>}
    <AvatarTestPreflightView test={test} />
    {test.error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800">
      {test.error}<Button type="button" size="sm" variant="link" className="ml-2 h-auto p-0" onClick={() => void test.loadPreflight()}>상태 확인</Button>
    </div>}
    {test.preflightError && test.preflight && <p role="alert" className="text-xs text-red-700">사전 점검 오류: {test.preflightError}</p>}
    {test.stopWarning && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs">
      <span>{test.stopWarning}</span><Button type="button" size="sm" variant="outline" onClick={() => void test.loadPreflight()}>상태 다시 확인</Button>
      <Button type="button" size="sm" variant="outline" disabled={test.stopping || !session} onClick={() => void test.stopSession()}>종료 재시도</Button>
    </div>}
    {session && <>
      <AvatarTestSessionView test={test} assistantName={assetName} />
      <div className="grid gap-2 rounded-md border border-slate-200 bg-white p-3 text-xs sm:grid-cols-2">
        <Evidence label="브라우저 영상 프레임" ok={videoObserved} detail={videoObserved ? "실제 HTML video 재생 프레임 확인" : "프레임 재생 대기"} />
        <Evidence label="재생 오디오" ok={test.audioPlaybackReady} detail={test.audioPlaybackReady ? "브라우저 오디오 출력 준비됨" : "오디오 재생 준비 필요"} />
        <Evidence label="성공한 관리자 테스트 턴" ok={successfulTurn} detail={successfulTurn ? "응답 턴 기록됨" : "텍스트 또는 음성 테스트 턴 필요"} />
        <Evidence label="세션 유효" ok={sessionRunning} detail={sessionRunning ? `실행 중 · 만료 ${new Date(session.expiresAt).toLocaleTimeString()}` : session.cleanupPending ? "정리 대기" : "종료 또는 만료"} />
      </div>
      <div className="grid gap-2 rounded-md border border-slate-200 bg-white p-3 text-xs">
        <Confirm checked={videoConfirmed} disabled={!videoObserved || !playbackReady} onChange={setVideoConfirmed} label="영상이 실제로 재생되는 것을 직접 확인했습니다." />
        <Confirm checked={audioConfirmed} disabled={!test.audioPlaybackReady || !playbackReady} onChange={setAudioConfirmed} label="테스트 응답의 음성을 실제로 들었습니다." />
        <div className="flex flex-wrap items-center gap-3 border-t pt-3">
          <Button type="button" size="sm" onClick={() => void report()} disabled={!canReport}>
            {reporting ? "보고 중…" : "재생 확인 보고"}
          </Button>
          <span className="text-slate-500">영상 프레임 · 오디오 준비 · 성공 턴 · 두 운영자 확인 · 유효 세션이 모두 필요합니다.</span>
          {reportMessage && <span role="status" className="w-full text-slate-700">{reportMessage}</span>}
        </div>
      </div>
    </>}
    {!session && <p className="text-xs text-slate-600">사전 점검과 비용·음성 처리를 확인한 뒤에만 테스트 세션을 명시적으로 시작할 수 있습니다.</p>}
  </section>;
}

function Evidence({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return <div className="flex items-start gap-2 rounded border border-slate-100 p-2">
    <CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${ok ? "text-emerald-700" : "text-slate-300"}`} />
    <p><span className="font-semibold text-slate-800">{label}</span><br /><span className="text-slate-500">{detail}</span></p>
  </div>;
}

function Confirm({ checked, disabled, onChange, label }: { checked: boolean; disabled: boolean; onChange: (value: boolean) => void; label: string }) {
  return <label className={`flex items-start gap-2 leading-relaxed ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
    <input type="checkbox" className="mt-0.5 accent-indigo-700" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />{label}
  </label>;
}
