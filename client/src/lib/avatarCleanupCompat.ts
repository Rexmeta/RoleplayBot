export type CleanupResult = {
  state: "unknown" | "pending" | "confirmed";
  code?: string;
};
export type CleanupClient = { sessionId?: string; refreshCleanup?: () => Promise<unknown> };

/** Copy of AvatarRouter's bounded compatibility contract. Reads never issue media credentials. */
export async function refreshCleanupSafely(
  client: CleanupClient | null | undefined,
  sessionId: string | undefined,
  getSessionStatus?: (sessionId: string) => Promise<unknown>,
): Promise<CleanupResult> {
  const unknown = (code: string): CleanupResult => ({ state: "unknown", code });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bounded = (operation: () => Promise<unknown>) => Promise.race([
    Promise.resolve().then(operation),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("STATUS_TIMEOUT")), 8000);
    }),
  ]);
  try {
    if (typeof sessionId !== "string" || !sessionId) return unknown("ROUTER_STATUS_INVALID");
    if (typeof client?.refreshCleanup === "function") {
      if (client.sessionId !== sessionId) return unknown("ROUTER_STATUS_INVALID");
      const state = await bounded(() => client.refreshCleanup!());
      return state === "unknown" || state === "pending" || state === "confirmed"
        ? { state } : unknown("ROUTER_STATUS_INVALID");
    }
    if (typeof getSessionStatus !== "function") return unknown("CLIENT_SDK_UPDATE_REQUIRED");
    const status = await bounded(() => getSessionStatus(sessionId)) as {
      id?: unknown; cleanupPending?: unknown; rendererState?: unknown;
    } | null;
    if (!status || status.id !== sessionId || typeof status.cleanupPending !== "boolean" ||
        !(status.rendererState === null || typeof status.rendererState === "string")) {
      return unknown("ROUTER_STATUS_INVALID");
    }
    return { state: status.rendererState === "closed" && status.cleanupPending === false ? "confirmed" : "pending" };
  } catch {
    return unknown("ROUTER_STATUS_UNCONFIRMED");
  } finally {
    clearTimeout(timer);
  }
}
