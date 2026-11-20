import type { TFunction } from "i18next";

const startRefusals = {
  avatar_persona_mismatch: {
    ko: "선택한 상대가 현재 대화에 배정된 상대와 다릅니다. 시나리오 상세로 돌아가 배정된 상대를 선택해 주세요.",
    en: "The selected partner is not the partner assigned to this conversation. Return to the scenario details and select the assigned partner.",
  },
  avatar_persona_not_selected: {
    ko: "현재 대화 상대에게 라이브 아바타가 배정되어 있지 않습니다. 담당자에게 아바타 설정을 요청한 뒤 새 대화를 시작해 주세요.",
    en: "No live avatar is assigned to this conversation partner. Ask the person managing the scenario to configure an avatar, then start a new conversation.",
  },
  avatar_persona_context_mismatch: {
    ko: "대화에 저장된 역할 정보가 현재 상대와 일치하지 않습니다. 담당자에게 시나리오의 역할 설정 확인을 요청한 뒤 새 대화를 시작해 주세요.",
    en: "The role saved for this conversation does not match the current partner. Ask the person managing the scenario to check the role settings, then start a new conversation.",
  },
  avatar_existing_session_target_mismatch: {
    ko: "이 대화에는 다른 상대의 라이브 세션이 이미 있습니다. 기존 세션을 안전하게 종료하고 기록 저장 상태를 확인한 뒤 시나리오 상세로 돌아가 주세요.",
    en: "This conversation already has a live session for another partner. Safely end the existing session and check its saved history before returning to the scenario details.",
  },
} as const;

export function liveAvatarStartRefusalText(code: string, t: TFunction, language?: string): string | null {
  if (!Object.prototype.hasOwnProperty.call(startRefusals, code)) return null;
  const copy = startRefusals[code as keyof typeof startRefusals];
  return t(`liveAvatar.blockers.${code}`, {
    defaultValue: language?.startsWith("ko") ? copy.ko : copy.en,
  });
}

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
  avatar_persona_not_found: "현재 대화에 연결된 페르소나를 찾지 못했습니다.",
  avatar_conversation_ended: "이미 종료된 대화에서는 라이브 아바타를 시작할 수 없습니다.",
  avatar_conversation_scopes_missing: "API 키에 아바타 조회 또는 라이브 세션 사용 권한이 부족합니다.",
  avatar_voice_catalog_unsupported: "연결된 AvatarRouter가 음성 카탈로그 기능을 제공하지 않아 저장된 음성을 안전하게 사용할 수 없습니다. 라우터 기능을 업데이트한 뒤 다시 시도하세요.",
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
  avatar_connection_rejected: "AvatarRouter가 프로젝트 API 키 인증을 거부했습니다. 관리자가 연결 설정을 확인해야 합니다.",
  avatar_connection_forbidden: "현재 프로젝트 또는 사용자에게 AvatarRouter 연결 권한이 없습니다.",
  avatar_test_read_failed: "외부 서비스의 상태 응답을 읽거나 확인하지 못했습니다. 재생 검증 부족을 뜻하지는 않습니다. 상태를 다시 확인해 주세요.",
  avatar_test_upstream_401: "외부 서비스 인증이 거부되었습니다. 관리자가 프로젝트 연결 설정을 확인해야 합니다.",
  avatar_test_upstream_403: "외부 서비스 조회 권한이 부족합니다. 관리자가 프로젝트 권한을 확인해야 합니다.",
  avatar_test_upstream_404: "외부 서비스에서 요청한 아바타 또는 연결 경로를 찾지 못했습니다.",
  avatar_test_upstream_409: "외부 서비스의 현재 세션 상태 때문에 요청을 진행할 수 없습니다. 기존 세션 상태를 다시 확인해 주세요.",
  avatar_test_upstream_429: "외부 서비스의 조회 요청이 많습니다. 잠시 후 상태를 다시 확인해 주세요.",
  avatar_test_upstream_502: "외부 서비스 상태 조회에 실패했습니다. 잠시 후 상태를 다시 확인해 주세요.",
  avatar_test_upstream_503: "외부 서비스가 일시적으로 응답하지 않습니다. 잠시 후 상태를 다시 확인해 주세요.",
  avatar_connection_timeout: "외부 아바타 서비스의 연결 확인 응답이 지연되고 있습니다. 잠시 후 기존 세션 상태를 다시 확인해 주세요.",
  avatar_connection_upstream_unavailable: "외부 아바타 서비스가 일시적으로 응답하지 않습니다. 잠시 후 다시 확인해 주세요.",
  avatar_connection_rate_limited: "외부 아바타 서비스의 조회 요청이 많습니다. 잠시 후 다시 확인해 주세요.",
};

export function liveAvatarBlockerText(code: string, t: TFunction, language = "ko"): string {
  const refusal = liveAvatarStartRefusalText(code, t, language);
  if (refusal) return refusal;
  return t(`liveAvatar.blockers.${code}`, {
    defaultValue: descriptions[code] ?? "라이브 아바타 시작 조건을 확인하지 못했습니다. 재생 검증 부족으로 단정할 수 없으므로 상태를 다시 확인해 주세요.",
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
