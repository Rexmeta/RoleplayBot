import type { TFunction } from "i18next";

const descriptions: Record<string, string> = {
  globally_disabled: "관리자가 라이브 아바타 서비스를 꺼 두었습니다.",
  scenario_not_allowed: "이 시나리오에서 라이브 아바타가 허용되지 않았습니다.",
  machine_auth_unverified: "Base URL·프로젝트 API 키 설정과 실제 연결 확인이 필요합니다.",
  avatar_connection_invalid: "서버의 AvatarRouter Base URL 설정 형식을 확인해야 합니다.",
  tenant_mapping_unverified: "현재 사용자·조직의 외부 접근 권한 분리 검증이 필요합니다.",
  pcm_bridge_unverified: "AI 음성 연속 전송·턴 중단 처리가 검증되지 않았습니다.",
  media_transport_unverified: "이 앱의 라이브 영상·음성 수신이 검증되지 않았습니다.",
  custom_avatar_live_unverified: "이 페르소나 이미지의 라이브 아바타 사용이 검증되지 않았습니다.",
  avatar_router_diagnostics_failed: "AvatarRouter 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  avatar_persona_not_selected: "현재 대화의 페르소나에 Live 아바타가 설정되지 않았습니다. 설정 저장 후 새 대화를 시작하세요.",
  avatar_persona_not_found: "현재 대화에 연결된 페르소나를 찾지 못했습니다.",
  avatar_conversation_ended: "이미 종료된 대화에서는 라이브 아바타를 시작할 수 없습니다.",
  avatar_conversation_scopes_missing: "API 키에 아바타 조회 또는 라이브 세션 사용 권한이 부족합니다.",
  persona_avatar_project_mismatch: "저장된 아바타와 현재 API 키의 프로젝트가 다릅니다.",
  persona_stock_avatar_unavailable: "선택한 기본 아바타를 현재 프로젝트에서 사용할 수 없습니다.",
  persona_avatar_playback_validation_required: "페르소나 수정 화면에서 선택한 커스텀 아바타의 실제 재생을 확인하고 보고를 저장하세요.",
  persona_avatar_custom_runtime_unavailable: "선택한 제공자 또는 커스텀 라이브 계약을 현재 사용할 수 없습니다.",
  avatar_runtime_unavailable: "라이브 아바타 연결 상태를 확인하지 못했습니다. 다시 조회하세요.",
  avatar_renderer_not_ready: "외부 아바타 영상 처리 서버가 준비되지 않았습니다. 기존 이미지·음성은 유지됩니다.",
  avatar_provider_cleanup_required: "외부 아바타 서비스에 생성·종료 결과 확인이 필요한 이전 세션이 남아 있습니다. 관리자 확인 전에는 새 유료 연결을 시작할 수 없습니다.",
  avatar_runtime_limits_unavailable: "외부 아바타 서비스의 남은 이용 시간이 부족하여 새 라이브 연결을 시작할 수 없습니다.",
  avatar_connection_unconfigured: "관리자가 AvatarRouter 서버 연결을 설정해야 합니다.",
  avatar_connection_check_failed: "AvatarRouter 인증 상태를 확인하지 못했습니다.",
  avatar_connection_timeout: "외부 아바타 서비스의 연결 확인 응답이 지연되고 있습니다. 잠시 후 기존 세션 상태를 다시 확인해 주세요.",
  avatar_connection_upstream_unavailable: "외부 아바타 서비스가 일시적으로 응답하지 않습니다. 잠시 후 다시 확인해 주세요.",
  avatar_connection_rate_limited: "외부 아바타 서비스의 조회 요청이 많습니다. 잠시 후 다시 확인해 주세요.",
};

export function liveAvatarBlockerText(code: string, t: TFunction): string {
  return t(`liveAvatar.blockers.${code}`, {
    defaultValue: descriptions[code] ?? "외부 서비스 연결에 필요한 검증이 완료되지 않았습니다.",
  });
}

/** API errors are status-prefixed JSON; translate known connection codes, not raw transport text. */
export function liveAvatarConnectionError(cause: unknown, t: TFunction): string | null {
  if (!(cause instanceof Error)) return null;
  const start = cause.message.indexOf("{");
  if (start < 0) return null;
  try {
    const { code } = JSON.parse(cause.message.slice(start));
    return typeof code === "string" && code.startsWith("avatar_connection_") && descriptions[code]
      ? liveAvatarBlockerText(code, t) : null;
  } catch {
    return null;
  }
}
