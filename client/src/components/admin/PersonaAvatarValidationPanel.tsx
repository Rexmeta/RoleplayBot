import { useEffect, useRef } from "react";
import { AvatarTestPreflightView } from "@/components/admin/avatarTest/AvatarTestPreflightView";
import { AvatarTestSessionView } from "@/components/admin/avatarTest/AvatarTestSessionView";
import { useAdminAvatarTest } from "@/components/admin/avatarTest/useAdminAvatarTest";

// Keep the existing BFF path compatible; it no longer performs playback validation.
const connectionEndpoint = (assetId: string) =>
  `/api/admin/personas/live-avatar/assets/${encodeURIComponent(assetId)}/validation`;

export function PersonaAvatarValidationPanel({ assetId, assetName, onActivityChange }: {
  assetId: string; assetName: string; onReported?: () => void; onActivityChange?: (active: boolean) => void;
}) {
  const test = useAdminAvatarTest(connectionEndpoint(assetId));
  const activityRef = useRef(onActivityChange);
  activityRef.current = onActivityChange;
  useEffect(() => {
    activityRef.current?.(test.creating || test.stopping || Boolean(test.session && !test.terminal));
  }, [test.creating, test.stopping, test.session, test.terminal]);
  return <section className="space-y-3 rounded-md border p-3" aria-label="선택 아바타 연결">
    <p className="text-sm font-medium">{assetName} · 아바타 라우터 연결</p>
    <AvatarTestPreflightView test={test} />
    {test.error && <p role="alert" className="text-sm text-destructive">{test.error}</p>}
    {test.stopWarning && <p role="alert" className="text-sm text-destructive">{test.stopWarning}</p>}
    {test.session && <AvatarTestSessionView test={test} />}
  </section>;
}
