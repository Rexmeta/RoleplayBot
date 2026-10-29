import { AlertTriangle, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AvatarTestHeader, AvatarTestPreflightView } from "@/components/admin/avatarTest/AvatarTestPreflightView";
import { AvatarTestSessionView } from "@/components/admin/avatarTest/AvatarTestSessionView";
import { useAdminAvatarTest } from "@/components/admin/avatarTest/useAdminAvatarTest";

export function LiveAvatarTestPanel() {
  const test = useAdminAvatarTest();
  return <section className="space-y-4 border-t pt-5" aria-labelledby="avatar-test-title">
    <header>
      <h3 id="avatar-test-title" className="flex items-center gap-2 font-semibold">
        <Video className="h-4 w-4 text-primary" />
        라이브 아바타 관리자 테스트
      </h3>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
        실제 기본 아바타 Lucy/Tavus의 분리된 턴 기반 점검입니다. 학습자 시나리오와 무관하며, 커스텀 페르소나나 연속 실시간 Gemini 세션이 아닙니다.
      </p>
    </header>

    <AvatarTestHeader test={test} />
    {test.creationUncertain && !test.preflight && <div role="alert" className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
      <p>세션 생성 결과가 불확실하여 새 생성은 잠겼습니다. 사전 점검이 성공해 서버 원격 조정 결과를 확인할 때까지 기다려 주세요.</p>
    </div>}
    <AvatarTestPreflightView test={test} />

    {test.error && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
      {test.error}
      <Button type="button" size="sm" variant="outline" className="ml-3" onClick={() => void test.loadPreflight()}>상태 확인</Button>
    </div>}
    {test.preflightError && test.preflight && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
      사전 점검을 불러오지 못했습니다. {test.preflightError}
    </div>}
    {test.stopWarning && <div role="alert" className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
      <p>{test.stopWarning}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => void test.loadPreflight()}>상태 다시 확인</Button>
        <Button type="button" size="sm" variant="outline" disabled={test.stopping || !test.session} onClick={() => void test.stopSession()}>종료 재시도</Button>
      </div>
    </div>}
    {test.session && <AvatarTestSessionView test={test} />}
  </section>;
}
