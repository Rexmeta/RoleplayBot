import { z } from "zod";

/** A free inspection is never evidence of a working learner media path. */
export const liveAvatarPreflightSchema = z.object({
  checkedAt: z.string().datetime(),
  projectId: z.string().min(1).max(256),
  projectName: z.string().min(1).max(60),
  available: z.literal(false),
  sessionCreated: z.literal(false),
  externalMediaSent: z.literal(false),
  missingScopes: z.array(z.string().max(100)).max(9),
  candidate: z.object({
    assetId: z.string().uuid(),
    name: z.string().max(500),
    providerId: z.literal("tavus"),
    liveValidated: z.boolean(),
    runtimeSupported: z.boolean(),
  }).nullable(),
  capacity: z.object({
    workerReady: z.boolean(),
    cleanupPending: z.number().int().nonnegative(),
    userRemainingSeconds: z.number().nonnegative(),
    globalRemainingSeconds: z.number().nonnegative(),
    providerCredits: z.literal("unknown"),
  }).nullable(),
  blockers: z.array(z.string().max(100)).max(30),
});
export type LiveAvatarPreflight = z.infer<typeof liveAvatarPreflightSchema>;

export const LIVE_AVATAR_PREFLIGHT_BLOCKER_TEXT: Record<string, string> = {
  avatar_preflight_scopes_missing: "프로젝트 키에 필요한 권한이 없습니다.",
  avatar_preflight_assets_failed: "프로젝트 자산을 확인하지 못했습니다. 다시 점검해야 합니다.",
  avatar_preflight_limits_failed: "사용 한도와 worker 상태를 확인하지 못했습니다.",
  avatar_preflight_no_custom_asset: "준비된 커스텀 Tavus 자산이 없습니다. Stock 인물로 대체하지 않습니다.",
  custom_avatar_live_unverified: "후보 자산의 실제 재생 검증이 완료되지 않았습니다.",
  avatar_preflight_worker_unavailable: "렌더링 worker가 준비되지 않았습니다.",
  avatar_preflight_cleanup_pending: "이전 세션의 원격 정리가 남아 있습니다.",
  avatar_preflight_capacity_unavailable: "새 세션에 필요한 120초의 예약 가능 시간이 부족합니다.",
  tenant_mapping_unverified: "로컬 사용자·조직과 외부 프로젝트의 신뢰된 매핑을 검증해야 합니다.",
  persona_binding_unverified: "페르소나 연결의 현재 이미지 hash/version·소유권·권리 승인을 검증해야 합니다.",
  pcm_bridge_unverified: "기존 AI 출력의 PCM 형식과 음성 bridge를 실측·검증해야 합니다.",
  media_transport_unverified: "미디어 수신·단일 출력·장애 복귀·권한 철회를 검증해야 합니다.",
  paid_media_validation_not_authorized: "현재 승인 범위는 무료 사전 확인뿐입니다. 실제 미디어·유료 검증은 실행하지 않았습니다.",
};
