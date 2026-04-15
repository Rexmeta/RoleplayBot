/**
 * conversationContextBuilder.ts
 *
 * 롤플레이 대화 시스템의 모든 공유 상수와 순수 로직 함수를 한 곳에 정의한다.
 * optimizedGeminiProvider.ts / openaiProvider.ts 두 프로바이더가 모두 이 파일을 import한다.
 *
 * 수정 시 이 파일만 변경하면 두 프로바이더에 동시에 반영된다.
 * 설계 전체는 docs/roleplay-system.md 참조.
 */

import type { ConversationMessage } from "@shared/schema";
import { getTextModeGuidelines, validateDifficultyLevel } from "./conversationDifficultyPolicy";

// ─────────────────────────────────────────────────────────────────────────────
// 계층 감지 키워드 목록
// ─────────────────────────────────────────────────────────────────────────────

/** AI 페르소나가 상위직임을 나타내는 키워드 */
export const SUPERIOR_KEYWORDS = [
  '팀장', '부장', '차장', '과장', '선임', '시니어', '수석', '리드', '매니저',
  'manager', 'lead', 'senior', 'director',
  '대리', '주임', '본부장', '실장', 'cto', 'ceo', '임원', '이사', '상무', '전무', '대표', '사장'
];

/** AI 페르소나가 하위직임을 나타내는 키워드 */
export const SUBORDINATE_KEYWORDS = [
  '신입', '인턴', '주니어', 'junior', '신규', '초보', '수습', '신입사원',
  '신입 개발자', '신입개발자', '입문', '초급'
];

/** 고객/외부 관계자 키워드 — 유저가 이 역할이면 항상 ai_subordinate 처리 */
export const EXTERNAL_CLIENT_KEYWORDS = [
  '고객', '클라이언트', 'customer', 'client', '의뢰인', '소비자', '구매자', '방문객', '투자자', '파트너'
];

// ─────────────────────────────────────────────────────────────────────────────
// 순수 로직 함수
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 대화 히스토리 준비
 * - 전체 대화 히스토리 사용 (윈도우 제한 없음)
 * - 사용자 답변 완료 마커(✓) 추가로 AI의 반복 질문 방지
 */
export function prepareConversationHistory(
  messages: ConversationMessage[],
  personaName: string,
  playerPosition?: string
): string {
  const safeMessages = messages || [];
  const userLabel = playerPosition ? playerPosition : '사용자';

  return safeMessages.map((msg, idx) => {
    const truncated = msg.message.slice(0, 400) + (msg.message.length > 400 ? '...' : '');
    if (msg.sender === 'user') {
      const prevMsg = safeMessages[idx - 1];
      const isAnswerToQuestion = prevMsg && prevMsg.sender !== 'user';
      return isAnswerToQuestion
        ? `【${userLabel} 답변 ✓】 ${truncated}  ← 위 질문은 이미 답변받은 사안`
        : `【${userLabel}】 ${truncated}`;
    } else {
      return `【${personaName} - 당신의 발언】 ${truncated}`;
    }
  }).join('\n');
}

/**
 * AI 페르소나와 유저 역할 간의 직위 위계 판별
 * @returns 'ai_superior' | 'ai_subordinate' | 'peer'
 */
export function detectRoleHierarchy(
  aiRole: string,
  userRole: string
): 'ai_superior' | 'ai_subordinate' | 'peer' {
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, '');

  const aiRoleNorm = normalize(aiRole);
  const userRoleNorm = normalize(userRole);

  if (EXTERNAL_CLIENT_KEYWORDS.some(k => userRoleNorm.includes(normalize(k)))) {
    return 'ai_subordinate';
  }

  const aiIsSuperior    = SUPERIOR_KEYWORDS.some(k => aiRoleNorm.includes(normalize(k)));
  const aiIsSubordinate = SUBORDINATE_KEYWORDS.some(k => aiRoleNorm.includes(normalize(k)));
  const userIsSuperior  = SUPERIOR_KEYWORDS.some(k => userRoleNorm.includes(normalize(k)));
  const userIsSubordinate = SUBORDINATE_KEYWORDS.some(k => userRoleNorm.includes(normalize(k)));

  if (aiIsSuperior && userIsSubordinate)   return 'ai_superior';
  if (userIsSuperior && aiIsSubordinate)   return 'ai_subordinate';
  if (aiIsSuperior && userIsSuperior)      return 'peer';
  if (aiIsSubordinate && userIsSubordinate) return 'peer';
  if (aiIsSuperior && !userIsSubordinate && !userIsSuperior) return 'peer';
  if (userIsSuperior && !aiIsSubordinate && !aiIsSuperior)   return 'ai_subordinate';
  if (aiIsSubordinate && !userIsSuperior)  return 'ai_subordinate';
  if (userIsSubordinate && !aiIsSubordinate) return 'ai_superior';
  return 'peer';
}

/**
 * 직위 위계에 따른 말투 지시 문자열 생성
 * @param personaRole AI 페르소나의 직책
 * @param playerRoleLabel 유저의 직책
 * @param hierarchy detectRoleHierarchy() 반환값
 */
export function buildHierarchySpeechGuide(
  personaRole: string,
  playerRoleLabel: string,
  hierarchy: 'ai_superior' | 'ai_subordinate' | 'peer'
): string {
  if (!playerRoleLabel || !personaRole) return '';

  if (hierarchy === 'ai_superior') {
    return `
**【말투 위계 지시 - 최우선 적용】**:
- 당신(${personaRole})은 상대방(${playerRoleLabel})보다 직위가 높습니다
- 반드시 윗사람이 아랫사람에게 말하는 어체를 사용하세요
- 구체적으로: "~해", "~하게", "~하도록", "~봐", "~잖아" 등 반말 또는 직급에 맞는 지시·명령 어체를 사용하세요
- "찾아뵙겠습니다", "말씀드리려고요", "부탁드립니다" 같은 아랫사람 표현은 절대 사용하지 마세요
- 격식이 필요한 경우라도 "~하지", "~하면 돼", "~해봐", "자, 그럼" 등 자연스러운 상위자 어투를 유지하세요`;
  }

  if (hierarchy === 'ai_subordinate') {
    return `
**【말투 위계 지시 - 최우선 적용】**:
- 당신(${personaRole})은 상대방(${playerRoleLabel})보다 직위가 낮습니다
- 반드시 아랫사람이 윗사람에게 말하는 정중한 어체를 사용하세요
- 구체적으로: "~습니다", "~요", "~드리겠습니다", "말씀드리다", "여쭤보다" 등 존댓말과 겸양 표현을 사용하세요
- 지나치게 편한 반말이나 지시하는 어투는 절대 사용하지 마세요`;
  }

  return `
**【말투 위계 지시 - 최우선 적용】**:
- 당신(${personaRole})과 상대방(${playerRoleLabel})은 동등한 관계입니다
- 친근하고 편안한 동료 말투를 사용하세요 (예: "~요", "~죠", "그렇지 않아요?", "같이 해봐요")
- 지나치게 격식을 차리거나 지나치게 편한 반말보다는 자연스럽고 협력적인 어투를 유지하세요`;
}

/**
 * 난이도 레벨에 해당하는 텍스트 모드 지침 문자열 반환
 * conversationDifficultyPolicy.ts 의 getTextModeGuidelines 를 래핑한다.
 */
export function buildDifficultyGuidelines(level: number | undefined): string {
  const validatedLevel = validateDifficultyLevel(level);
  return getTextModeGuidelines(validatedLevel);
}

// ─────────────────────────────────────────────────────────────────────────────
// MBTI 컨텍스트 가이드 타입
// ─────────────────────────────────────────────────────────────────────────────

export interface MBTIContextGuides {
  psychologicalGuide: string;
  communicationBehaviorGuide: string;
  speechStyleGuide: string;
  reactionGuide: string;
}

/**
 * MBTI 데이터를 받아 프롬프트용 가이드 문자열 4종을 조립한다.
 *
 * 조립 순서:
 *   1. psychologicalGuide  — motivation + fears
 *   2. communicationBehaviorGuide — communicationStyle 행동 지침
 *   3. speechStyleGuide    — speech_style (formality, sentence_endings, …)
 *   4. reactionGuide       — reaction_phrases (agreement, disagreement, …)
 */
export function buildMBTIContextGuides(mbtiData: any): MBTIContextGuides {
  const motivation = mbtiData?.motivation || '';
  const fears = mbtiData?.fears
    ? (Array.isArray(mbtiData.fears) ? mbtiData.fears.join(', ') : mbtiData.fears)
    : '';

  const psychologicalGuide = (motivation || fears)
    ? `
**심리적 동기 (대화에 반드시 반영할 것)**:
${motivation ? `- 당신이 원하는 것: ${motivation}` : ''}
${fears ? `- 당신이 두려워하는 것: ${fears}` : ''}
- 이 동기와 두려움이 모든 대화 반응에 자연스럽게 드러나야 합니다
- 두려움과 관련된 상황이 발생하면 방어적/경계적/회피적으로 반응하세요
- 동기와 부합하는 제안에는 긍정적으로, 동기와 충돌하는 제안에는 저항적으로 반응하세요`
    : '';

  const communicationStyle = mbtiData?.communication_style || '균형 잡힌 의사소통';
  const communicationBehaviorGuide = `
**의사소통 행동 지침 (반드시 따를 것)**:
${communicationStyle}

위 의사소통 스타일을 다음과 같이 구체적으로 실행하세요:
- "명령조" 스타일이면: "~하세요", "~해야 합니다", "당연히~" 등의 표현 사용
- "형식적/정중" 스타일이면: "~인 것 같습니다", "확인이 필요할 것 같은데요" 등 완곡한 표현 사용
- "직설적" 스타일이면: 돌려 말하지 않고 핵심을 바로 말하기
- "침묵을 압박 수단으로" 사용한다면: 대화 중 "..." 을 사용하여 침묵을 표현하기 (괄호 행동 묘사 금지)
- "두괄식" 스타일이면: 결론을 먼저 말하고 이유는 나중에
- "질문으로 압박" 스타일이면: "그게 맞습니까?", "근거가 있습니까?" 등 추궁형 질문 사용`;

  const speechStyle = mbtiData?.speech_style;
  const speechStyleGuide = speechStyle
    ? `
말투 스타일:
- 격식: ${speechStyle.formality}
- 문장 끝: ${speechStyle.sentence_endings?.join(', ') || '~요, ~네요'}
- 추임새: ${speechStyle.filler_words?.join(', ') || '음, 아'}
- 특징적 표현: ${speechStyle.characteristic_expressions?.join(', ') || ''}`
    : '';

  const reactionPhrases = mbtiData?.reaction_phrases;
  const reactionGuide = reactionPhrases
    ? `
리액션 표현:
- 동의할 때: ${reactionPhrases.agreement?.slice(0, 2).join(', ') || '네, 맞아요'}
- 반대할 때: ${reactionPhrases.disagreement?.slice(0, 2).join(', ') || '글쎄요'}
- 놀랄 때: ${reactionPhrases.surprise?.slice(0, 2).join(', ') || '어머, 정말요?'}
- 생각할 때: ${reactionPhrases.thinking?.slice(0, 2).join(', ') || '음...'}`
    : '';

  return { psychologicalGuide, communicationBehaviorGuide, speechStyleGuide, reactionGuide };
}
