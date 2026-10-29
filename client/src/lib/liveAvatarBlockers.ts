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
};

export function liveAvatarBlockerText(code: string, t: TFunction): string {
  return t(`liveAvatar.blockers.${code}`, {
    defaultValue: descriptions[code] ?? "외부 서비스 연결에 필요한 검증이 완료되지 않았습니다.",
  });
}
