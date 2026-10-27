/** Additive opt-in capability; never infer readiness from provider key presence. */
export const AVATAR_ROUTER_ORIGIN = "https://avatar-router.replit.app";
export const LIVE_AVATAR_CONTRACT_BLOCKERS = [
  "machine_auth_unverified",
  "tenant_mapping_unverified",
  "pcm_bridge_unverified",
  "media_transport_unverified",
  "custom_avatar_live_unverified",
] as const;

export interface LiveAvatarConfig {
  enabled: boolean;
  service: "avatar-router";
  origin: string;
  contractReady: false;
  blockers: string[];
}

export interface LiveAvatarAvailability extends LiveAvatarConfig {
  allowed: boolean;
  available: false;
}

export interface AvatarProviderDiagnostic {
  id: string;
  name: string;
  status: "available" | "unconfigured" | "unavailable";
  externalAudio: boolean;
  implemented: boolean;
}

export interface LiveAvatarDiagnostics {
  reachable: boolean;
  liveEnabled: boolean;
  providers: AvatarProviderDiagnostic[];
  blockers: string[];
  checkedAt: string;
}

/** AI output only. A provider adapter must measure/validate the format upstream. */
export interface AvatarPcmFrame {
  source: "ai";
  encoding: "pcm_s16le";
  sampleRate: 24000;
  channels: 1;
  turnSeq: number;
  sequence: number;
  generation: number;
  data: Uint8Array;
}

export type LiveAvatarState = "idle" | "connecting" | "ready" | "fallback" | "closed";

/** Deliberately independent of image and prerecorded video renderers. */
export interface LiveAvatarTransport {
  sendAudio(frame: AvatarPcmFrame, signal: AbortSignal): Promise<void>;
  finishTurn(turnSeq: number, signal: AbortSignal): Promise<void>;
  interrupt(generation: number, signal: AbortSignal): Promise<void>;
  close(): Promise<void>;
}

export function liveAvatarAvailability(enabled: boolean, allowed: boolean): LiveAvatarAvailability {
  return {
    enabled, allowed, service: "avatar-router", origin: AVATAR_ROUTER_ORIGIN,
    contractReady: false, available: false,
    blockers: [
      ...(!enabled ? ["globally_disabled"] : []),
      ...(!allowed ? ["scenario_not_allowed"] : []),
      ...LIVE_AVATAR_CONTRACT_BLOCKERS,
    ],
  };
}
