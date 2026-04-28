import { USER_PERSONA_LANG_PROHIBITION } from './languageInstructions';

interface UserPersonaData {
  name: string;
  description?: string | null;
  greeting?: string | null;
  gender?: string | null;
  personality?: unknown;
}

export function buildUserPersonaInstructions(
  userPersonaData: UserPersonaData,
  userName: string,
  userLanguage: 'ko' | 'en' | 'ja' | 'zh' = 'ko'
): string {
  const p = (userPersonaData.personality as any) || {};
  const greetingText = userPersonaData.greeting || `안녕하세요! 저는 ${userPersonaData.name}입니다.`;

  return [
    `당신은 "${userPersonaData.name}"라는 AI 캐릭터입니다.`,
    userPersonaData.description ? `캐릭터 설명: ${userPersonaData.description}` : '',
    p.background ? `배경: ${p.background}` : '',
    p.traits?.length ? `성격 특성: ${p.traits.join(', ')}` : '',
    p.communicationStyle ? `대화 방식: ${p.communicationStyle}` : '',
    p.speechStyle ? `말투: ${p.speechStyle}` : '',
    ``,
    `위 캐릭터로서 자연스럽게 대화하세요. 캐릭터의 성격, 말투, 배경을 일관되게 유지하세요.`,
    `사용자(이름: ${userName})와 편안하고 자유롭게 대화하세요.`,
    `세션이 시작되면 반드시 먼저 이렇게 인사하세요: "${greetingText}"`,
    ``,
    `⚠️ ${USER_PERSONA_LANG_PROHIBITION[userLanguage] || USER_PERSONA_LANG_PROHIBITION.ko}`,
  ].filter(Boolean).join('\n');
}
