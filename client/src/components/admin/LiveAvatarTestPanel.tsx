import { useEffect, useRef } from "react";
import { Video } from "lucide-react";
import { AvatarTestHeader, AvatarTestPreflightView } from "@/components/admin/avatarTest/AvatarTestPreflightView";
import { AvatarTestSessionView } from "@/components/admin/avatarTest/AvatarTestSessionView";
import { useAdminAvatarTest } from "@/components/admin/avatarTest/useAdminAvatarTest";

export function LiveAvatarTestPanel({ onActivityChange }: { onActivityChange?: (active: boolean) => void } = {}) {
  const test = useAdminAvatarTest();
  const activityRef = useRef(onActivityChange);
  activityRef.current = onActivityChange;
  useEffect(() => {
    activityRef.current?.(test.creating || test.stopping || Boolean(test.session && !test.terminal));
  }, [test.creating, test.stopping, test.session, test.terminal]);
  return <section className="space-y-4 border-t pt-5" aria-labelledby="avatar-test-title">
    <h3 id="avatar-test-title" className="flex items-center gap-2 font-semibold">
      <Video className="h-4 w-4 text-primary" />라이브 아바타 연결
    </h3>
    <AvatarTestHeader test={test} />
    <AvatarTestPreflightView test={test} />
    {test.error && <p role="alert" className="text-sm text-destructive">{test.error}</p>}
    {test.stopWarning && <p role="alert" className="text-sm text-destructive">{test.stopWarning}</p>}
    {test.session && <AvatarTestSessionView test={test} />}
  </section>;
}
