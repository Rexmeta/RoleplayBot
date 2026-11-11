import type { CleanupResult } from "@/lib/avatarCleanupCompat";

export function AvatarCleanupNotice({ result, checking, disabled, onRefresh }: {
  result: CleanupResult; checking: boolean; disabled?: boolean; onRefresh(): void;
}) {
  return <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"
    data-testid="avatar-cleanup-notice">
    <p role="status">{result.state === "confirmed"
      ? "해당 세션의 서버 정리가 확인되었습니다. 새 유료 세션의 생성 허용 여부는 서버에서 별도로 확인합니다."
      : result.state === "pending"
        ? "서버 정리 중입니다. 정리 완료가 확인될 때까지 새 세션 생성 잠금을 유지합니다."
        : "정리 확인이 필요합니다. 상태가 미확인이므로 새 세션 생성 잠금을 유지합니다."}</p>
    {result.state === "unknown" && <p className="mt-1">
      SDK에 정리 확인 기능이 없어도 기존 로그인으로 서버 상태를 조회합니다. 조회 연동이 없거나 확인되지 않으면 SDK/상태 조회 연동 업데이트가 필요합니다.
      통화가 끝난 뒤 업데이트하세요. 새 연결이나 세션을 만들지 않습니다.
    </p>}
    <button type="button" onClick={onRefresh} disabled={checking || disabled}
      className="mt-2 rounded-lg border border-amber-300 px-3 py-2 font-semibold disabled:opacity-50"
      data-testid="avatar-cleanup-refresh">
      {checking ? "정리 상태 확인 중…" : "정리 상태 다시 확인"}
    </button>
  </div>;
}
