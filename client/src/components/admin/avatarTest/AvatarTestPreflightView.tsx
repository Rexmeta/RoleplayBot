import { AlertTriangle, Loader2, Play, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAdminAvatarTest } from "./useAdminAvatarTest";

type TestState = ReturnType<typeof useAdminAvatarTest>;
const formatTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

export function AvatarTestPreflightView({ test }: { test: TestState }) {
  const { preflight } = test;
  if (test.loading) {
    return <div className="space-y-3 rounded-lg border p-4" aria-label="상태 불러오는 중">
      <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
      <div className="h-20 animate-pulse rounded bg-muted/70" />
    </div>;
  }
  if (!preflight) {
    return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
      <span>관리자 테스트 사전 점검에 실패했습니다. {test.preflightError}</span>
      <Button type="button" variant="outline" size="sm" onClick={() => void test.loadPreflight()}>다시 시도</Button>
    </div>;
  }
  const canCreate = preflight.ready && preflight.aiReady && !test.preflightError && !test.creationUncertain && test.costConfirmed &&
    test.audioConfirmed && !test.creating && !test.recoverable;
  return <>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Metric label="내 잔여 시간" value={`${preflight.limits.userRemainingSeconds}초`} />
      <Metric label="전체 잔여 시간" value={`${preflight.limits.globalRemainingSeconds}초`} />
      <Metric label="세션 예약 한도" value={`${preflight.limits.sessionSeconds}초`} />
      <Metric label="대기 중 정리" value={`${preflight.limits.cleanupPending}건`} />
    </div>
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Badge variant={preflight.limits.workerReady ? "default" : "destructive"}>워커 {preflight.limits.workerReady ? "준비됨" : "미준비"}</Badge>
      <Badge variant={preflight.aiReady ? "default" : "secondary"}>AI 처리 {preflight.aiReady ? "준비됨" : "미준비"}</Badge>
      <Badge variant={preflight.ready ? "default" : "destructive"}>테스트 범위 {preflight.ready ? "허용" : "차단"}</Badge>
      <span className="text-xs text-muted-foreground">초기화: {formatTime(preflight.limits.resetsAt)} · 제공자 크레딧: 알 수 없음</span>
    </div>
    {preflight.missingScopes.length > 0 && <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
      <p className="font-medium">부족한 권한 범위</p>
      <p className="mt-1 text-muted-foreground">{preflight.missingScopes.join(", ")}</p>
    </div>}
    {test.creationUncertain && <div role="alert" className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
      <div>
        <p className="font-medium">세션 생성 결과 확인 중 — 새 세션 생성을 잠갔습니다.</p>
        <p className="mt-1 text-muted-foreground">이전 요청의 결과가 불확실합니다. 서버가 본인 세션 목록과 대조해 확인할 때까지 다시 생성하지 마세요. 새로고침으로 원격 조정 결과를 확인하세요.</p>
      </div>
    </div>}
    {(!preflight.ready || !preflight.aiReady) && <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
      <p>사전 조건이 충족되지 않아 세션을 만들 수 없습니다. 이 화면은 자동으로 세션을 생성하지 않습니다.</p>
    </div>}
    {preflight.sessions.length > 0 && <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-medium">내 테스트 세션 및 정리 상태</p>
        <span className="text-xs text-muted-foreground">종료 세션은 활성 세션으로 자동 선택하지 않습니다.</span>
      </div>
      <ul className="space-y-2">
        {preflight.sessions.map((item) => {
          const isCurrent = test.session?.id === item.id;
          return <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/30 px-3 py-2 text-sm">
            <div className="min-w-0">
              <p className="font-medium">{item.status} · {item.rendererState || "renderer 상태 미확인"}</p>
              <p className="text-xs text-muted-foreground">만료 {formatTime(item.expiresAt)}{item.cleanupPending ? " · 정리 대기 중" : ""}</p>
            </div>
            <div className="flex items-center gap-2">
              {item.cleanupPending && <Badge variant="secondary">정리 대기</Badge>}
              {isCurrent && <Badge variant="outline">현재 표시 중</Badge>}
              {!isCurrent && (item.status === "active" || item.cleanupPending) &&
                <Button type="button" variant="outline" size="sm" onClick={() => test.recoverSession(item)}>복구</Button>}
            </div>
          </li>;
        })}
      </ul>
    </div>}
    {!test.recoverable && <div className="space-y-3 rounded-lg border bg-muted/10 p-4">
      <div className="flex items-start gap-2 text-sm">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p><strong>120초 예약은 비용 상한이나 달러 보장이 아닙니다.</strong> 제공자 크레딧은 확인되지 않으며 워커가 세션을 최대 120초로 제한합니다.</p>
      </div>
      <label className="flex cursor-pointer items-start gap-3 text-sm">
        <input className="mt-1 h-4 w-4 accent-primary" type="checkbox" checked={test.costConfirmed} onChange={(event) => test.setCostConfirmed(event.target.checked)} />
        <span>실제 외부 아바타 서비스 사용 및 비용 가능성을 확인했습니다. 120초 예약은 달러 비용 보장이 아닙니다.</span>
      </label>
      <label className="flex cursor-pointer items-start gap-3 text-sm">
        <input className="mt-1 h-4 w-4 accent-primary" type="checkbox" checked={test.audioConfirmed} onChange={(event) => test.setAudioConfirmed(event.target.checked)} />
        <span>입력한 텍스트·마이크 녹음은 OpenAI의 인식·응답·음성 생성에, 생성된 응답 음성은 AvatarRouter·Tavus·LiveKit에 전달됨에 동의합니다. 마이크 원음은 LiveKit에 게시하지 않습니다.</span>
      </label>
      <p className="text-xs text-muted-foreground">테스트 AI: OpenAI gpt-4o-mini / whisper-1 / tts-1. 아바타 서비스와 별도로 AI 사용료가 발생할 수 있습니다. 이 대화는 시나리오 기록·평가에 저장되지 않습니다.</p>
      <Button type="button" onClick={() => void test.createSession()} disabled={!canCreate}>
        {test.creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
        확인 후 테스트 세션 생성
      </Button>
    </div>}
  </>;
}

export function AvatarTestHeader({ test }: { test: TestState }) {
  return <div className="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h3 className="font-semibold">상태와 세션 권한</h3>
      <p className="mt-1 text-sm text-muted-foreground">남은 시간과 워커 상태를 확인하고, 확인된 세션만 복구할 수 있습니다.</p>
    </div>
    <Button type="button" size="sm" variant="outline" onClick={() => void test.loadPreflight()} disabled={test.loading || test.creating}>
      {test.loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
      상태 새로고침
    </Button>
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border bg-muted/10 px-3 py-2.5">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="mt-1 font-mono text-lg font-semibold tabular-nums">{value}</p>
  </div>;
}
