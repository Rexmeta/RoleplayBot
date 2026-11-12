import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { refreshCleanupSafely, type CleanupResult } from "@/lib/avatarCleanupCompat";

/** The ended screen has no media client. Always use the existing authenticated BFF GET. */
export function useAvatarCleanup(scope: string, endpoint: string, sessionId?: string) {
  const [result, setResult] = useState<CleanupResult>({ state: "unknown" });
  const [checking, setChecking] = useState(false);
  const generation = useRef(0);
  const busy = useRef(false);
  const current = useRef({ scope, endpoint, sessionId });
  current.current = { scope, endpoint, sessionId };

  useEffect(() => {
    generation.current++;
    busy.current = false;
    setChecking(false);
    setResult({ state: "unknown" });
    return () => { generation.current++; };
  }, [scope, endpoint, sessionId]);

  const invalidate = useCallback(() => {
    generation.current++;
    busy.current = false;
    setChecking(false);
    setResult({ state: "pending" });
  }, []);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setChecking(true);
    const revision = generation.current;
    const captured = current.current;
    const isCurrent = () => revision === generation.current &&
      captured.scope === current.current.scope && captured.endpoint === current.current.endpoint &&
      captured.sessionId === current.current.sessionId;
    // Do not remount/reload the SDK, reissue a descriptor or create a session to check cleanup.
    const next = await refreshCleanupSafely(null, captured.sessionId, async () => {
      const response = await apiRequest("GET", captured.endpoint);
      return response.json();
    });
    if (!isCurrent()) return;
    setResult(next);
    busy.current = false;
    setChecking(false);
  }, []);

  return { result, checking, refresh, invalidate };
}
