import React from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { LIVE_AVATAR_PREFLIGHT_BLOCKER_TEXT, liveAvatarPreflightSchema } from "@shared/avatar/liveAvatarPreflight";

/** Deliberate action only: mounting settings never inspects remote assets. */
export function LiveAvatarPreflightPanel({ configured }: { configured: boolean }) {
  const check = useMutation({
    mutationFn: async () => liveAvatarPreflightSchema.parse(
      await (await apiRequest("POST", "/api/live-avatar/runtime/preflight", {})).json(),
    ),
    retry: false,
  });
  // Hide historical success as soon as a recheck begins or fails.
  const result = configured && check.isSuccess ? check.data : undefined;
  return <div className="space-y-3 border-t pt-4" aria-label="라이브 연결 무료 사전 점검">
    <h4 className="text-sm font-medium">라이브 연결 무료 사전 점검</h4>
    <p className="text-xs text-muted-foreground">
      현재 프로젝트의 인증·자산·worker·사용 한도만 읽습니다. 재생 검증된 커스텀 Tavus 자산을 우선하여
      후보를 제안할 뿐, 페르소나에 저장하거나 세션을 생성하지 않습니다. 이미지·음성 전송과 AI 호출도 하지 않습니다.
    </p>
    <Button type="button" variant="outline" disabled={!configured || check.isPending} onClick={() => check.mutate()}>
      {check.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {check.isPending ? "무료 사전 점검 중…" : "무료 사전 점검 실행"}
    </Button>
    {check.isError && <p role="alert" className="text-sm text-destructive">
      무료 사전 점검에 실패했습니다. 서버 연결·권한을 확인한 후 다시 실행하세요.
    </p>}
    {result && <div className="space-y-2 rounded-md border p-3 text-sm" role="status">
      <p className="font-medium">사전 점검 결과 · 일반 대화 라이브는 아직 사용 불가</p>
      <p>프로젝트: {result.projectName} · {result.projectId}</p>
      <p>확인 시각: {new Date(result.checkedAt).toLocaleString()}</p>
      <p>{result.candidate
        ? `Tavus 후보: ${result.candidate.name} · ${result.candidate.assetId} · 실제 재생 ${result.candidate.liveValidated ? "검증 기록 있음" : "미검증"}`
        : "사용 가능한 커스텀 Tavus 후보를 확인하지 못했습니다."}</p>
      {result.capacity && <p>
        Worker: {result.capacity.workerReady ? "준비됨" : "미준비"} · 정리 대기: {result.capacity.cleanupPending} ·
        예약 가능 시간: 프로젝트 {result.capacity.userRemainingSeconds}초 / 전체 {result.capacity.globalRemainingSeconds}초
      </p>}
      <p className="text-xs text-muted-foreground">Provider 잔액은 알 수 없습니다. 예약 가능 시간은 금액 상한이 아닙니다.</p>
      {result.missingScopes.length > 0 && <p>부족한 권한: {result.missingScopes.join(", ")}</p>}
      <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
        {result.blockers.map(code => <li key={code}>{LIVE_AVATAR_PREFLIGHT_BLOCKER_TEXT[code] ?? code}</li>)}
      </ul>
      <p className="text-xs">세션 생성 없음 · 외부 이미지·음성 전송 없음 · 설정 변경 없음</p>
    </div>}
  </div>;
}
