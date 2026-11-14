import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAdminAvatarTest } from "./useAdminAvatarTest";

type TestState = ReturnType<typeof useAdminAvatarTest>;

/** Connection controls only. AvatarRouter owns admission and session policy. */
export function AvatarTestPreflightView({ test }: { test: TestState }) {
  if (test.recoverable) return null;
  return <Button type="button" onClick={() => void test.createSession()} disabled={test.creating}>
    {test.creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
    {test.creating ? "라우터 연결 중…" : "아바타 연결"}
  </Button>;
}

export function AvatarTestHeader({ test: _test }: { test: TestState }) {
  return <p className="text-sm text-muted-foreground">아바타 라우터에 연결합니다. 실행 상태와 세션 관리는 라우터 응답을 따릅니다.</p>;
}
