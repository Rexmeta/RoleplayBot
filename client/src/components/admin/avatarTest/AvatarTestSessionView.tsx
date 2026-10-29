import { Check, CircleStop, Headphones, Loader2, Mic, MicOff, Send, Video } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAdminAvatarTest } from "./useAdminAvatarTest";

type TestState = ReturnType<typeof useAdminAvatarTest>;

export function AvatarTestSessionView({ test }: { test: TestState }) {
  const { session } = test;
  if (!session) return null;
  const inputDisabled = !test.mediaConnected || !test.ready || !test.audioConfirmed || test.turnBusy ||
    test.stopping || test.recording || test.micPending;
  return <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,.85fr)]">
    <div className="space-y-3">
      <div className="relative aspect-video overflow-hidden rounded-lg border bg-slate-950">
        <div ref={test.videoHost} className="absolute inset-0" />
        {!test.videoTrack && <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-5 text-center text-slate-100">
          {test.connecting ? <Loader2 className="h-6 w-6 animate-spin" /> : <Video className="h-6 w-6 opacity-70" />}
          <p className="text-sm">{test.connecting ? "아바타 미디어 연결 중…" : test.ready ? "영상 트랙 대기 중" : "활성 테스트 세션 없음"}</p>
        </div>}
        {test.videoTrack && <div className="absolute bottom-3 left-3"><Badge>실제 아바타 영상 연결</Badge></div>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <span className={`h-2 w-2 rounded-full ${test.mediaConnected ? "bg-emerald-600" : "bg-amber-500"}`} />
          {test.pollFailed ? "세션 상태 확인 실패 · 미디어 안전 차단" : test.audioBlocked ? "영상 구독됨 · 오디오 재생 허용 필요" :
            test.mediaConnected ? "영상 트랙 구독됨 · 오디오 재생 가능" : test.connecting ? "연결 중" :
              session.cleanupPending ? "정리 대기" : `세션 ${session.status} · ${session.rendererState || "renderer 미확인"}`}
        </div>
        <div className="flex gap-2">
          {test.audioBlocked && <Button type="button" size="sm" variant="outline" onClick={() => void test.startAudio()}>
            <Headphones className="mr-2 h-4 w-4" />오디오 재생 허용
          </Button>}
          <Button type="button" size="sm" variant="outline" onClick={test.retryConnection} disabled={test.connecting || test.stopping || !test.ready || test.stopped}>
            연결 다시 시도
          </Button>
          {!test.terminal && <Button type="button" size="sm" variant="destructive" onClick={() => void test.stopSession()} disabled={test.stopping}>
            {test.stopping ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CircleStop className="mr-2 h-4 w-4" />}
            {test.stopping ? "종료 확인 중…" : "테스트 중지"}
          </Button>}
        </div>
      </div>
      <div ref={test.audioHost} className="sr-only" aria-label="아바타 음성 출력" />
      <p className="text-xs text-muted-foreground">브라우저를 닫아도 제공자 작업이 즉시 중단됐다는 증거가 되지 않습니다. 서버 워커의 120초 제한과 정리 상태를 확인하세요.</p>
    </div>

    <div className="flex min-h-[360px] flex-col rounded-lg border">
      <div className="border-b px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium">관리자 턴 테스트</p>
          <Badge variant="outline">{session.status}</Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">텍스트 또는 최대 15초 음성 · 동의한 입력만 외부 AI 처리</p>
        <label className="mt-2 flex cursor-pointer items-start gap-2 text-xs text-muted-foreground">
          <input className="mt-0.5 h-3.5 w-3.5 accent-primary" type="checkbox" checked={test.audioConfirmed} onChange={(event) => test.setAudioConfirmed(event.target.checked)} />
          <span>텍스트·녹음의 OpenAI 처리와 생성된 응답 음성의 AvatarRouter·Tavus·LiveKit 전송 및 AI 사용료 발생 가능성에 동의합니다. 세션 복구 시 다시 확인해야 합니다.</span>
        </label>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {test.conversation.length === 0 ? <div className="flex h-full min-h-40 flex-col items-center justify-center text-center">
          <div className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary"><Check className="h-5 w-5" /></div>
          <p className="text-sm font-medium">미디어 연결과 음성 처리 동의 후 첫 턴을 보낼 수 있습니다</p>
          <p className="mt-1 max-w-xs text-xs text-muted-foreground">실제 영상 트랙 구독 및 오디오 재생 가능 상태가 확인되기 전에는 입력이 비활성화됩니다.</p>
        </div> : test.conversation.map((item, index) =>
          <div key={`${index}-${item.role}`} className={`max-w-[90%] rounded-lg px-3 py-2 text-sm ${item.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"}`}>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide opacity-70">{item.role === "user" ? "관리자" : "Lucy"}</p>
            <p className="whitespace-pre-wrap break-words">{item.content}</p>
          </div>)}
        {test.turnBusy && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />응답 생성 중… 중지 버튼은 계속 사용할 수 있습니다.</div>}
      </div>
      <form className="space-y-2 border-t p-3" onSubmit={(event) => {
        event.preventDefault();
        if (test.message.trim()) void test.sendTurn({ text: test.message.trim(), history: [] });
      }}>
        <div className="flex gap-2">
          <input value={test.message} onChange={(event) => test.setMessage(event.target.value.slice(0, 500))} maxLength={500}
            disabled={inputDisabled} placeholder="테스트할 말을 입력하세요"
            className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" />
          <Button type="submit" size="icon" aria-label="텍스트 전송" disabled={inputDisabled || !test.message.trim()}><Send className="h-4 w-4" /></Button>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{test.message.length}/500 · 음성은 서버 STT에만 전달</span>
          <Button type="button" variant={test.recording ? "destructive" : "outline"} size="sm" onClick={() => void test.toggleRecording()}
            disabled={test.stopping || test.turnBusy || test.micPending || !test.mediaConnected || !test.ready || !test.audioConfirmed || test.pollFailed}>
            {test.recording ? <MicOff className="mr-2 h-4 w-4" /> : <Mic className="mr-2 h-4 w-4" />}
            {test.recording ? "녹음 완료 전송" : test.micPending ? "마이크 권한 확인 중…" : "최대 15초 녹음"}
          </Button>
        </div>
      </form>
    </div>
  </div>;
}
