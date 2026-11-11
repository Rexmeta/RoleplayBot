import { USER_PERSONA_LANG_PROHIBITION } from './languageInstructions';
import { defaultPersonaGreeting } from '../../../../shared/conversationLanguage';

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
  const greetingText = userPersonaData.greeting || defaultPersonaGreeting(userPersonaData.name, userLanguage);
  const hasRealName = userName && userName !== '사용자';

  return [
    `당신은 "${userPersonaData.name}"라는 AI 캐릭터입니다.`,
    userPersonaData.description ? `캐릭터 설명: ${userPersonaData.description}` : '',
    p.background ? `배경: ${p.background}` : '',
    p.traits?.length ? `성격 특성: ${p.traits.join(', ')}` : '',
    p.communicationStyle ? `대화 방식: ${p.communicationStyle}` : '',
    p.speechStyle ? `말투: ${p.speechStyle}` : '',
    ``,
    `위 캐릭터로서 자연스럽게 대화하세요. 캐릭터의 성격, 말투, 배경을 일관되게 유지하세요.`,
    hasRealName
      ? `대화 상대방의 이름은 "${userName}"입니다. 선택된 대화 언어에 맞는 자연스러운 호칭으로 불러주세요.`
      : `대화 상대방과 자연스럽게 대화하세요.`,
    hasRealName
      ? `⚠️ 상대방의 실제 이름 "${userName}"을 사용하세요. "사용자"라는 표현은 절대 사용하지 마세요.`
      : '',
    `사용자가 대화를 시작하면 다음 인사의 의미와 캐릭터 말투를 유지하되, 반드시 선택된 대화 언어로 표현하세요: "${greetingText}"`,
    ``,
    `⚠️ ${USER_PERSONA_LANG_PROHIBITION[userLanguage] || USER_PERSONA_LANG_PROHIBITION.ko}`,
  ].filter(Boolean).join('\n');
}
