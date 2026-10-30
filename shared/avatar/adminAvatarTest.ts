/** Isolated stock-avatar diagnostic, not the scenario conversation runtime. */
export type AvatarTestSession = {
  id: string;
  providerId: string;
  avatarId: string;
  mode: "live";
  status: "active" | "ended" | "expired" | "failed";
  rendererState: string | null;
  stopRequested: boolean;
  cleanupPending: boolean;
  expiresAt: string;
};
export type AvatarTestLimits = {
  userRemainingSeconds: number;
  globalRemainingSeconds: number;
  sessionSeconds: number;
  cleanupPending: number;
  workerReady: boolean;
  providerCredits: "unknown";
  resetsAt: string;
};
export type AvatarTestPreflight = {
  runtimeError?: string;
  ready: boolean;
  aiReady: boolean;
  creationUncertain: boolean;
  missingScopes: string[];
  limits: AvatarTestLimits;
  sessions: AvatarTestSession[];
};
export type AvatarTestMessage = { role: "user" | "assistant"; content: string };
export type AvatarTestTurnInput = {
  text?: string;
  audioBase64?: string;
  mimeType?: "audio/webm" | "audio/mp4" | "audio/ogg";
  history: AvatarTestMessage[];
};
export const avatarTestReady = (s: AvatarTestSession) =>
  s.status === "active" && s.rendererState === "running" && !s.stopRequested && !s.cleanupPending;
export const avatarTestTerminal = (s: AvatarTestSession) =>
  ["ended", "expired", "failed"].includes(s.status) && !s.cleanupPending;
