/**
 * evaluationEngine.ts
 *
 * 평가 시스템의 모든 공유 상수와 순수 로직 함수를 한 곳에 정의한다.
 * optimizedGeminiProvider.ts / openaiProvider.ts 두 프로바이더가 모두 이 파일을 import한다.
 *
 * 수정 시 이 파일만 변경하면 두 프로바이더에 동시에 반영된다.
 */

import type { ConversationMessage } from "@shared/schema";
import type { EvaluationCriteriaWithDimensions } from "./aiService";

// ─────────────────────────────────────────────────────────────────────────────
// 기본 평가 차원 (5개)
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_DIMENSIONS: EvaluationCriteriaWithDimensions['dimensions'] = [
  {
    key: 'clarityLogic',
    name: '명확성 & 논리성',
    description: '의사 표현의 명확성과 논리적 구성',
    weight: 20,
    minScore: 1,
    maxScore: 10,
  },
  {
    key: 'listeningEmpathy',
    name: '경청 & 공감',
    description: '상대방의 말을 듣고 공감하는 능력',
    weight: 20,
    minScore: 1,
    maxScore: 10,
  },
  {
    key: 'appropriatenessAdaptability',
    name: '적절성 & 상황대응',
    description: '상황에 맞는 적절한 대응',
    weight: 20,
    minScore: 1,
    maxScore: 10,
  },
  {
    key: 'persuasivenessImpact',
    name: '설득력 & 영향력',
    description: '상대방을 설득하고 영향을 미치는 능력',
    weight: 20,
    minScore: 1,
    maxScore: 10,
  },
  {
    key: 'strategicCommunication',
    name: '전략적 커뮤니케이션',
    description: '목표 달성을 위한 전략적 소통',
    weight: 20,
    minScore: 1,
    maxScore: 10,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 기본 10점 척도 루브릭 텍스트 (동적 루브릭이 없을 때 프롬프트에 삽입)
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_10PT_RUBRICS = `

**각 평가 영역 상세 채점 기준 (10점 척도)**:

▶ 명확성 & 논리성 (clarityLogic):
  - 1-2점: 발화가 거의 없거나 주제와 무관한 단어/짧은 소리 나열. 논리 구조 전혀 없음.
  - 3-4점: 의도는 파악되나 근거 없이 주장만 하거나 문장이 단편적. 두서없는 구성.
  - 5-6점: 기본적인 주장과 근거가 있으나 구조가 약하거나 핵심이 불분명한 경우가 있음.
  - 7-8점: 대체로 명확하고 논리적 근거 제시. 간혹 애매한 표현이나 논리 비약이 있음.
  - 9-10점: 명확한 핵심 메시지, 탄탄한 논리 구조, 구체적 사례/데이터 인용, 일관성 탁월.

▶ 경청 & 공감 (listeningEmpathy):
  - 1-2점: 상대방 발화를 완전히 무시하거나 엉뚱한 응답. 공감 표현 전무.
  - 3-4점: 상대방 말에 최소한 반응하나 내용 반영 없이 자기 이야기만 함.
  - 5-6점: 상대방 말을 일부 참조하나 요약·재진술 부족. 공감이 형식적("네", "알겠습니다" 수준).
  - 7-8점: 상대방 발화를 파악하고 관련 반응. 재진술·공감 표현. 감정 인식 시도.
  - 9-10점: 상대방 핵심 우려를 정확히 짚어 재진술하고, 감정 인식, 적극적 공감, 니즈 탐색.

▶ 적절성 & 상황대응 (appropriatenessAdaptability):
  - 1-2점: 상황과 전혀 어울리지 않는 발언, 갈등 악화, 역할 혼동.
  - 3-4점: 상황 인식이 부족하거나 부적절한 표현이 반복됨. 상황 변화에 둔감.
  - 5-6점: 대체로 상황에 맞는 발언이나 간혹 어색하거나 타이밍 미스. 대응 유연성 부족.
  - 7-8점: 상황 변화에 잘 대응하고 적절한 표현 선택. 소소한 실수는 있음.
  - 9-10점: 상황별 최적 표현과 어조 선택. 갈등 발생 시 유연하게 전환. 분위기 조율 능숙.

▶ 설득력 & 영향력 (persuasivenessImpact):
  - 1-2점: 설득 시도 없거나 근거 없이 요구·강요만 하여 역효과 발생.
  - 3-4점: 일부 주장이 있으나 논리적 근거나 구체적 사례 거의 없음. 상대방 이익 미반영.
  - 5-6점: 부분적 논거 제시. 상대 입장 일부 반영하나 설득력 약함. 합의 도출 미흡.
  - 7-8점: 논리적 근거와 상대 이익 제시. 설득 흐름 구축. 타협 여지 제시.
  - 9-10점: 체계적 논거, 상대 이익 부각, 감정적 공감과 논리 결합, 구체적 행동 변화 유도.

▶ 전략적 커뮤니케이션 (strategicCommunication):
  - 1-2점: 목표 없이 반응형 대화. 주도권 전혀 없음. 대화 방향 조율 불가.
  - 3-4점: 목표 의식이 희미하거나 산만하게 대화. 전략적 흐름 없음.
  - 5-6점: 어느 정도 목표 지향적이나 전략 일관성 부족. 기회 포착 미흡.
  - 7-8점: 대화 흐름 주도, 목표 지향적 발언, 타협·조율 시도.
  - 9-10점: 전략적 순서로 대화 구성. 상대 반응에 따른 전술 조정. 합의 도출 주도.`;

// ─────────────────────────────────────────────────────────────────────────────
// 점수 조정 상수
// ─────────────────────────────────────────────────────────────────────────────

/** 텍스트 모드 기준 기대 턴 수 */
export const EXPECTED_TURNS_TEXT = 10;

/** 음성 모드 기준 기대 턴 수 (STT 노이즈·재연결 고려해 낮게 설정) */
export const EXPECTED_TURNS_VOICE = 7;

/** 텍스트 1턴 기준 기대 글자 수 (음성 B-보정에 사용) */
export const BASELINE_CHARS_PER_TURN = 40;

/** 비언어적 패턴 감점 상한 (점) */
export const NON_VERBAL_PENALTY_CAP = 20;

/** Barge-in 순 조정 범위: 최소 -15점, 최대 +10점 */
export const BARGE_IN_MIN_ADJUSTMENT = -15;
export const BARGE_IN_MAX_ADJUSTMENT = 10;

/** Barge-in 긍정(적극적 참여) 가점 */
export const BARGE_IN_POSITIVE_BONUS = 2;

/** Barge-in 부정(경청 부족) 감점 */
export const BARGE_IN_NEGATIVE_PENALTY = 3;

/**
 * 대화 완성도 패널티 테이블
 * effectiveRatio < threshold → penalty (음성/텍스트 구분)
 */
export const COMPLETION_PENALTY_TIERS = [
  { threshold: 0.3, textPenalty: 25, voicePenalty: 15 },
  { threshold: 0.5, textPenalty: 15, voicePenalty: 10 },
  { threshold: 0.7, textPenalty: 8,  voicePenalty: 5  },
] as const;

/**
 * 대화량 부족 시 개별 역량 점수 캡
 * effectiveRatio에 따라 최대 허용 점수 결정
 */
export const SCORE_CAP_TIERS = [
  { maxRatio: 0.3, maxScore: 3 },
  { maxRatio: 0.5, maxScore: 5 },
  { maxRatio: 0.7, maxScore: 7 },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// 순수 로직 함수
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 대화 모드가 음성 기반인지 여부 확인
 * realtime_voice 또는 tts 이면 true
 */
export function isVoiceMode(conversation?: { mode?: string } | null): boolean {
  const mode = conversation?.mode;
  return mode === 'realtime_voice' || mode === 'tts';
}

/**
 * 음성 전사본에서 명백한 노이즈/잡음 메시지를 필터링
 * 실제 의미 있는 발화만 남긴다
 */
export function filterVoiceNoise(userMessages: ConversationMessage[]): ConversationMessage[] {
  return userMessages.filter(msg => {
    const text = msg.message.trim();
    if (text.length <= 1) return false;
    if (text.length <= 4 && /^[^가-힣a-zA-Z0-9]+$/.test(text)) return false;
    if (/^(skip|스킵|침묵)$/i.test(text)) return false;
    if (/^\.+$/.test(text)) return false;
    return true;
  });
}

/**
 * 실질 완성도(effectiveRatio) 계산
 * 음성 모드에서는 발화 밀도(B)로 보정
 */
export function calcEffectiveRatio(
  userMessages: ConversationMessage[],
  voiceMode: boolean
): number {
  const expectedTurns = voiceMode ? EXPECTED_TURNS_VOICE : EXPECTED_TURNS_TEXT;
  const turnRatio = userMessages.length / expectedTurns;

  if (!voiceMode) return turnRatio;

  const totalChars = userMessages.reduce((sum, msg) => sum + msg.message.length, 0);
  const expectedChars = EXPECTED_TURNS_VOICE * BASELINE_CHARS_PER_TURN;
  const contentRatio = Math.min(1.0, totalChars / expectedChars);
  return Math.min(1.0, Math.max(turnRatio, contentRatio));
}

/**
 * 비언어적 패턴 분석
 * 음성 모드에서는 STT 노이즈가 많으므로 비활성화(0 반환)
 */
export function analyzeNonVerbalPatterns(
  userMessages: ConversationMessage[],
  conversation?: { mode?: string } | null
): {
  count: number;
  patterns: string[];
  penaltyPoints: number;
} {
  if (isVoiceMode(conversation)) {
    return { count: 0, patterns: [], penaltyPoints: 0 };
  }

  const nonVerbalPatterns: string[] = [];
  let penaltyPoints = 0;

  userMessages.forEach(msg => {
    const text = msg.message.trim().toLowerCase();
    if (text.length < 3) {
      nonVerbalPatterns.push(`짧은 응답: "${msg.message}"`);
      penaltyPoints += 2;
    } else if (
      text.length < 6 &&
      text.match(/^[가-힣a-z\s'"'"""''.,!?~ㅋㅎ]{1,5}$/) &&
      !text.match(/[가-힣]{2,}/)
    ) {
      nonVerbalPatterns.push(`무의미한 단답: "${msg.message}"`);
      penaltyPoints += 1;
    } else if (text === '...' || text.match(/^\.+$/)) {
      nonVerbalPatterns.push(`침묵 표시: "${msg.message}"`);
      penaltyPoints += 3;
    } else if (text.match(/^(음+|어+|그+|아+|uh+|um+|hmm+|흠+)\.*/i)) {
      nonVerbalPatterns.push(`비언어적 표현: "${msg.message}"`);
      penaltyPoints += 2;
    } else if (text === '침묵' || text === 'skip' || text === '스킵') {
      nonVerbalPatterns.push(`스킵: "${msg.message}"`);
      penaltyPoints += 5;
    }
  });

  return {
    count: nonVerbalPatterns.length,
    patterns: nonVerbalPatterns,
    penaltyPoints: Math.min(penaltyPoints, NON_VERBAL_PENALTY_CAP),
  };
}

/**
 * 말 끊기(Barge-in) 분석
 * interrupted 플래그가 설정된 AI 발화를 찾아 긍정/부정/중립 평가
 */
export function analyzeBargeIn(messages: ConversationMessage[]): {
  count: number;
  contexts: Array<{
    aiMessage: string;
    userMessage: string;
    assessment: 'positive' | 'negative' | 'neutral';
  }>;
  netScoreAdjustment: number;
} {
  const contexts: Array<{
    aiMessage: string;
    userMessage: string;
    assessment: 'positive' | 'negative' | 'neutral';
  }> = [];
  let positiveCount = 0;
  let negativeCount = 0;

  messages.forEach((msg, idx) => {
    if (msg.sender === 'ai' && msg.interrupted) {
      const nextUserMsg = messages[idx + 1];
      if (nextUserMsg && nextUserMsg.sender === 'user') {
        const aiText = msg.message;
        const userText = nextUserMsg.message;

        let assessment: 'positive' | 'negative' | 'neutral' = 'neutral';

        if (
          aiText.includes('?') ||
          aiText.match(/어떻|무엇|왜|어디|누가|언제|how|what|why|where|who|when/i)
        ) {
          assessment = 'negative';
          negativeCount++;
        } else if (userText.length > 30 && !userText.match(/^(네|아니|음|어|uh|um)/i)) {
          assessment = 'positive';
          positiveCount++;
        } else {
          assessment = 'neutral';
        }

        contexts.push({
          aiMessage: aiText.substring(0, 100) + (aiText.length > 100 ? '...' : ''),
          userMessage: userText.substring(0, 100) + (userText.length > 100 ? '...' : ''),
          assessment,
        });
      }
    }
  });

  const netScoreAdjustment =
    positiveCount * BARGE_IN_POSITIVE_BONUS - negativeCount * BARGE_IN_NEGATIVE_PENALTY;

  return {
    count: contexts.length,
    contexts,
    netScoreAdjustment: Math.max(
      BARGE_IN_MIN_ADJUSTMENT,
      Math.min(BARGE_IN_MAX_ADJUSTMENT, netScoreAdjustment)
    ),
  };
}

/**
 * 대화 완성도에 따른 패널티 점수 계산
 * @param effectiveRatio 실질 완성도 (0.0 ~ 1.0)
 * @param voiceMode 음성 모드 여부
 * @returns 차감할 패널티 점수 (0 이상)
 */
export function calculateCompletionPenalty(effectiveRatio: number, voiceMode: boolean): number {
  for (const tier of COMPLETION_PENALTY_TIERS) {
    if (effectiveRatio < tier.threshold) {
      return voiceMode ? tier.voicePenalty : tier.textPenalty;
    }
  }
  return 0;
}

/**
 * 대화량 부족 시 적용할 역량 점수 최대값(캡) 반환
 * @param effectiveRatio 실질 완성도 (0.0 ~ 1.0)
 * @returns 최대 허용 점수 (대화량 충분하면 null)
 */
export function getScoreCap(effectiveRatio: number): number | null {
  for (const tier of SCORE_CAP_TIERS) {
    if (effectiveRatio < tier.maxRatio) {
      return tier.maxScore;
    }
  }
  return null;
}

/**
 * 가중치 기반 종합 점수 계산 (0-100)
 * 각 차원 점수를 (score / maxScore) × weight 로 환산 후 합산
 */
export function calculateWeightedOverallScore(
  scores: Record<string, number>,
  evaluationCriteria?: EvaluationCriteriaWithDimensions
): number {
  const dimensions = evaluationCriteria?.dimensions ?? DEFAULT_DIMENSIONS;
  const totalWeight = dimensions.reduce((sum, d) => sum + d.weight, 0);

  if (totalWeight === 0) return 50;

  const weightedSum = dimensions.reduce((sum, d) => {
    const score = scores[d.key] ?? d.minScore;
    return sum + (score / d.maxScore) * d.weight;
  }, 0);

  return Math.round((weightedSum / totalWeight) * 100);
}

/**
 * 기본 점수 객체 생성 (동적 평가 기준 지원)
 * 모든 차원을 minScore로 초기화
 */
export function getDefaultScores(
  evaluationCriteria?: EvaluationCriteriaWithDimensions
): Record<string, number> {
  const dimensions = evaluationCriteria?.dimensions ?? DEFAULT_DIMENSIONS;
  const scores: Record<string, number> = {};
  for (const dim of dimensions) {
    scores[dim.key] = dim.minScore;
  }
  return scores;
}
