/**
 * evaluationEngine.ts
 *
 * 평가 시스템의 모든 공유 상수와 순수 로직 함수를 한 곳에 정의한다.
 * optimizedGeminiProvider.ts / openaiProvider.ts 두 프로바이더가 모두 이 파일을 import한다.
 *
 * 수정 시 이 파일만 변경하면 두 프로바이더에 동시에 반영된다.
 */

import type { ConversationMessage } from "@shared/schema";
import { EVIDENCE_SCORE_CAP } from "@shared/schema/types";
import type { EvaluationCriteriaWithDimensions } from "./aiService";
import type { PassingRule } from "@shared/schema/scenarios";

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
 * 80% 이상이면 패널티 없음 (정상 완성)
 */
export const COMPLETION_PENALTY_TIERS = [
  { threshold: 0.3, textPenalty: 25, voicePenalty: 15 },
  { threshold: 0.5, textPenalty: 15, voicePenalty: 10 },
  { threshold: 0.7, textPenalty: 8,  voicePenalty: 5  },
  { threshold: 0.8, textPenalty: 4,  voicePenalty: 2  },
] as const;

/**
 * 대화량 부족 시 개별 역량 점수 캡
 * effectiveRatio에 따라 최대 허용 점수 결정
 * 80% 이상이면 캡 없음 (정상 완성)
 */
export const SCORE_CAP_TIERS = [
  { maxRatio: 0.3, maxScore: 3 },
  { maxRatio: 0.5, maxScore: 5 },
  { maxRatio: 0.7, maxScore: 7 },
  { maxRatio: 0.8, maxScore: 8 },
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
 * scenarioTargetTurns가 제공되면 전역 상수 대신 시나리오별 목표값을 사용
 */
export function calcEffectiveRatio(
  userMessages: ConversationMessage[],
  voiceMode: boolean,
  scenarioTargetTurns?: number,
  actualDurationSeconds?: number,
  scenarioTargetDurationMinutes?: number
): number {
  const expectedTurns = scenarioTargetTurns ?? (voiceMode ? EXPECTED_TURNS_VOICE : EXPECTED_TURNS_TEXT);
  const turnRatio = userMessages.length / expectedTurns;

  // 텍스트 및 음성 모두 턴 수 + 문자 수 기반 공정 비교 (최댓값 사용)
  const totalChars = userMessages.reduce((sum, msg) => sum + msg.message.length, 0);
  const expectedChars = expectedTurns * BASELINE_CHARS_PER_TURN;
  const contentRatio = Math.min(1.0, totalChars / expectedChars);

  // 시나리오별 목표 시간이 있으면 실제 대화 시간 비율도 반영
  const timeRatio: number =
    typeof actualDurationSeconds === 'number' &&
    typeof scenarioTargetDurationMinutes === 'number' &&
    scenarioTargetDurationMinutes > 0
      ? Math.min(1.0, actualDurationSeconds / (scenarioTargetDurationMinutes * 60))
      : 0;

  return Math.min(1.0, Math.max(turnRatio, contentRatio, timeRatio));
}

/**
 * 최소 유효 턴 수 충족 여부 확인
 * @param userMessages 사용자 메시지 목록 (노이즈 필터링 후)
 * @param minValidTurns 최소 유효 턴 수
 * @returns true면 평가 가능, false면 대화량 부족
 */
export function checkMinValidTurns(
  userMessages: ConversationMessage[],
  minValidTurns: number
): boolean {
  return userMessages.length >= minValidTurns;
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

// ─────────────────────────────────────────────────────────────────────────────
// 루브릭 저장 검증 함수
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evidence가 없는 차원에 적용되는 최대 점수 상한 (증거 없이 고득점 불가)
 * evidence 배열이 비어있으면 이 값 이하로 점수를 제한한다
 */
export const NO_EVIDENCE_SCORE_CAP = EVIDENCE_SCORE_CAP;

/**
 * 근거 발화가 없을 때 삽입하는 시스템 폴백 evidence 항목
 * isSystemFallback: true 로 명시적으로 표시되어 UI가 구분 처리할 수 있다
 */
export function makeInsufficientEvidenceFallback(wasCapped: boolean): {
  turnIndex: number;
  quote: string;
  behaviorObserved: string;
  rubricBand: string;
  reason: string;
  isSystemFallback: true;
} {
  return {
    turnIndex: -1,
    quote: '',
    behaviorObserved: '근거 발화 미제공 (Insufficient Evidence)',
    rubricBand: wasCapped ? `최대 ${NO_EVIDENCE_SCORE_CAP}점 제한 적용` : '근거 없음',
    reason: wasCapped
      ? `AI가 이 차원에 대한 근거 발화를 제공하지 않아 시스템이 점수를 최대 ${NO_EVIDENCE_SCORE_CAP}점으로 자동 제한했습니다.`
      : 'AI가 이 차원에 대한 구체적인 근거 발화를 제공하지 않았습니다.',
    isSystemFallback: true,
  };
}

/**
 * 개별 evidence 항목의 품질을 검사한다.
 * turnIndex >= 0이고 quote 또는 reason 중 하나 이상이 비어있지 않아야 유효하다.
 * isSystemFallback 항목은 항상 유효하지 않은 것으로 간주 (시스템 생성 마커)
 */
export function isValidEvidenceItem(ev: {
  turnIndex: number;
  quote?: string;
  reason?: string;
  isSystemFallback?: boolean;
}): boolean {
  if (ev.isSystemFallback) return false;
  if (ev.turnIndex < 0) return false;
  const hasQuote = typeof ev.quote === 'string' && ev.quote.trim().length > 0;
  const hasReason = typeof ev.reason === 'string' && ev.reason.trim().length > 0;
  return hasQuote || hasReason;
}

/**
 * Evidence 기반 점수 상한 적용
 * evidence가 없는 차원의 점수를 NO_EVIDENCE_SCORE_CAP 이하로 제한
 */
export function applyEvidenceScoreCap(
  scores: Record<string, number>,
  evidenceMap: Record<string, { turnIndex: number; quote: string; behaviorObserved: string; rubricBand: string; reason: string }[]>,
  dimensions: { key: string }[]
): { scores: Record<string, number>; cappedDimensions: string[] } {
  const cappedDimensions: string[] = [];
  const result = { ...scores };
  for (const dim of dimensions) {
    const ev = evidenceMap[dim.key];
    const hasEvidence = Array.isArray(ev) && ev.length > 0;
    if (!hasEvidence && result[dim.key] !== undefined && result[dim.key] > NO_EVIDENCE_SCORE_CAP) {
      console.log(`   - 증거 없음 캡 적용: ${dim.key} ${result[dim.key]}점 → ${NO_EVIDENCE_SCORE_CAP}점`);
      result[dim.key] = NO_EVIDENCE_SCORE_CAP;
      cappedDimensions.push(dim.key);
    }
  }
  return { scores: result, cappedDimensions };
}

/**
 * 개별 평가 차원의 유효성 검사
 * 점수 범위(1~10)와 루브릭 단계 수(5개 이상)를 검증한다
 * 루브릭 항목에 behaviorAnchor가 없으면 저장 차단
 */
export function validateEvaluationDimension(dim: {
  key?: string;
  name?: string;
  minScore?: number;
  maxScore?: number;
  scoringRubric?: { score: number; label: string; description: string; behaviorAnchor?: string }[] | null;
  evaluationPrompt?: string | null;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const label = dim.name || dim.key || '(차원)';
  const minScore = dim.minScore ?? 1;
  const maxScore = dim.maxScore ?? 10;

  if (minScore < 1) {
    errors.push(`"${label}": 최소 점수는 1 이상이어야 합니다 (현재: ${minScore})`);
  }
  if (maxScore > 10) {
    errors.push(`"${label}": 최대 점수는 10 이하이어야 합니다 (현재: ${maxScore})`);
  }
  if (minScore >= maxScore) {
    errors.push(`"${label}": 최소 점수(${minScore})는 최대 점수(${maxScore})보다 작아야 합니다`);
  }

  if (!dim.scoringRubric || dim.scoringRubric.length < 5) {
    const count = dim.scoringRubric ? dim.scoringRubric.length : 0;
    errors.push(`"${label}": 채점 루브릭은 최소 5단계 이상 필요합니다 (현재: ${count}단계)`);
  }

  if (dim.scoringRubric && dim.scoringRubric.length >= 5) {
    const missingAnchor = dim.scoringRubric.filter(r => !r.behaviorAnchor || r.behaviorAnchor.trim().length === 0);
    if (missingAnchor.length > 0) {
      errors.push(`"${label}": 모든 루브릭 단계에 행동 기준(behaviorAnchor)이 필요합니다 (현재 ${missingAnchor.length}개 누락)`);
    }
  }

  if (dim.evaluationPrompt !== null && dim.evaluationPrompt !== undefined && dim.evaluationPrompt.trim().length > 0 && dim.evaluationPrompt.trim().length < 10) {
    errors.push(`"${label}": 평가 프롬프트는 최소 10자 이상이어야 합니다 (현재: ${dim.evaluationPrompt.trim().length}자)`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 평가 기준 세트 전체 유효성 검사
 * 차원 수(3개 이상), 가중치 합계(100%), 점수 범위, key 중복, 루브릭 단계 수를 검증한다
 */
export function validateEvaluationCriteriaSet(dimensions: Array<{
  key?: string;
  name?: string;
  weight?: number;
  minScore?: number;
  maxScore?: number;
  isActive?: boolean;
  scoringRubric?: { score: number; label: string; description: string }[] | null;
  evaluationPrompt?: string | null;
}>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const activeDims = dimensions.filter(d => d.isActive !== false);

  if (activeDims.length < 3) {
    errors.push(`평가 차원은 최소 3개 이상 필요합니다 (현재 활성: ${activeDims.length}개)`);
  }

  const totalWeight = activeDims.reduce((sum, d) => sum + (d.weight ?? 0), 0);
  if (Math.abs(totalWeight - 100) > 0.5) {
    errors.push(`가중치 합계는 100%여야 합니다 (현재: ${totalWeight.toFixed(1)}%)`);
  }

  const keys = dimensions.map(d => d.key).filter(Boolean) as string[];
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const k of keys) {
    if (seen.has(k)) dupes.add(k);
    seen.add(k);
  }
  if (dupes.size > 0) {
    errors.push(`중복된 차원 키가 있습니다: ${Array.from(dupes).join(', ')}`);
  }

  for (const dim of dimensions) {
    const dimResult = validateEvaluationDimension(dim);
    errors.push(...dimResult.errors);
  }

  return { valid: errors.length === 0, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// 루브릭 품질 점수 계산
// ─────────────────────────────────────────────────────────────────────────────

export interface RubricQualityScoreResult {
  totalScore: number;
  breakdown: {
    scoreConsistency: { score: number; maxScore: number; issues: string[] };
    weightAccuracy: { score: number; maxScore: number; issues: string[] };
    behaviorAnchorSpecificity: { score: number; maxScore: number; issues: string[] };
    rubricStageCompleteness: { score: number; maxScore: number; issues: string[] };
    evaluationPromptQuality: { score: number; maxScore: number; issues: string[] };
  };
  recommendations: string[];
}

/**
 * 루브릭 품질 점수 계산 (0~100)
 * - 점수 체계 일관성 (20)
 * - 가중치 정확성 (20)
 * - 행동 기준 구체성 (25)
 * - 루브릭 단계 완전성 (20)
 * - 평가 프롬프트 품질 (15)
 */
export function calculateRubricQualityScore(dimensions: Array<{
  key?: string;
  name?: string;
  weight?: number;
  minScore?: number;
  maxScore?: number;
  isActive?: boolean;
  scoringRubric?: Array<{
    score: number;
    label?: string;
    description?: string;
    behaviorAnchor?: string;
  }> | null;
  evaluationPrompt?: string | null;
}>): RubricQualityScoreResult {
  const activeDims = dimensions.filter(d => d.isActive !== false);
  const recommendations: string[] = [];

  // ── 1. 점수 체계 일관성 (20점) ──
  const scoreConsistencyIssues: string[] = [];
  let scoreConsistency = 20;

  for (const dim of activeDims) {
    const min = dim.minScore ?? 1;
    const max = dim.maxScore ?? 10;
    if (min < 1 || max > 10) {
      scoreConsistencyIssues.push(`"${dim.name}": 점수 범위가 1~10을 벗어남 (${min}~${max})`);
      scoreConsistency -= 5;
    }
    if (min >= max) {
      scoreConsistencyIssues.push(`"${dim.name}": 최소 점수가 최대 점수 이상임`);
      scoreConsistency -= 5;
    }
    if (!dim.key || dim.key.trim().length === 0) {
      scoreConsistencyIssues.push(`차원 키가 없는 항목 존재`);
      scoreConsistency -= 3;
    }
  }

  if (activeDims.length < 3) {
    scoreConsistencyIssues.push(`활성 차원 수 부족 (${activeDims.length}개 / 최소 3개)`);
    scoreConsistency -= 10;
  }
  scoreConsistency = Math.max(0, scoreConsistency);
  if (scoreConsistencyIssues.length > 0) {
    recommendations.push('점수 체계: ' + scoreConsistencyIssues[0]);
  }

  // ── 2. 가중치 정확성 (20점) ──
  const weightAccuracyIssues: string[] = [];
  let weightAccuracy = 20;

  const totalWeight = activeDims.reduce((sum, d) => sum + (d.weight ?? 0), 0);
  const weightDiff = Math.abs(totalWeight - 100);

  if (weightDiff > 5) {
    weightAccuracyIssues.push(`가중치 합계가 100%에서 ${weightDiff.toFixed(1)}%p 벗어남 (현재: ${totalWeight.toFixed(1)}%)`);
    weightAccuracy = weightDiff > 20 ? 0 : weightDiff > 10 ? 8 : 12;
  } else if (weightDiff > 0.5) {
    weightAccuracyIssues.push(`가중치 합계 미세 조정 필요 (현재: ${totalWeight.toFixed(1)}%)`);
    weightAccuracy = 16;
  }

  const zeroWeightDims = activeDims.filter(d => (d.weight ?? 0) === 0);
  if (zeroWeightDims.length > 0) {
    weightAccuracyIssues.push(`가중치 0인 차원 존재: ${zeroWeightDims.map(d => d.name).join(', ')}`);
    weightAccuracy = Math.max(0, weightAccuracy - 5);
  }
  weightAccuracy = Math.max(0, weightAccuracy);
  if (weightAccuracyIssues.length > 0) {
    recommendations.push('가중치: ' + weightAccuracyIssues[0]);
  }

  // ── 3. 행동 기준 구체성 (25점) ──
  const behaviorAnchorIssues: string[] = [];
  let behaviorAnchorSpecificity = 25;

  let totalRubricItems = 0;
  let missingAnchorCount = 0;
  let shortAnchorCount = 0;

  for (const dim of activeDims) {
    const rubric = dim.scoringRubric || [];
    totalRubricItems += rubric.length;
    for (const item of rubric) {
      if (!item.behaviorAnchor || item.behaviorAnchor.trim().length === 0) {
        missingAnchorCount++;
      } else if (item.behaviorAnchor.trim().length < 20) {
        shortAnchorCount++;
      }
    }
  }

  if (totalRubricItems > 0) {
    const missingRatio = missingAnchorCount / totalRubricItems;
    const shortRatio = shortAnchorCount / totalRubricItems;
    if (missingRatio > 0) {
      behaviorAnchorIssues.push(`행동 기준 누락: ${missingAnchorCount}개 항목 (전체의 ${Math.round(missingRatio * 100)}%)`);
      behaviorAnchorSpecificity = Math.round(25 * (1 - missingRatio));
    }
    if (shortRatio > 0.3) {
      behaviorAnchorIssues.push(`행동 기준이 너무 짧음 (20자 미만): ${shortAnchorCount}개 항목`);
      behaviorAnchorSpecificity = Math.max(0, behaviorAnchorSpecificity - Math.round(10 * shortRatio));
    }
  } else {
    behaviorAnchorIssues.push('루브릭 항목이 없어 행동 기준을 평가할 수 없음');
    behaviorAnchorSpecificity = 0;
  }
  behaviorAnchorSpecificity = Math.max(0, behaviorAnchorSpecificity);
  if (behaviorAnchorIssues.length > 0) {
    recommendations.push('행동 기준: ' + behaviorAnchorIssues[0]);
  }

  // ── 4. 루브릭 단계 완전성 (20점) ──
  const rubricStageIssues: string[] = [];
  let rubricStageCompleteness = 20;

  let dimsWithInsufficientStages = 0;
  for (const dim of activeDims) {
    const stages = (dim.scoringRubric || []).length;
    if (stages < 5) {
      dimsWithInsufficientStages++;
      rubricStageIssues.push(`"${dim.name}": 루브릭 단계 부족 (${stages}단계 / 최소 5단계)`);
    }
  }

  if (dimsWithInsufficientStages > 0) {
    const ratio = dimsWithInsufficientStages / Math.max(1, activeDims.length);
    rubricStageCompleteness = Math.round(20 * (1 - ratio));
  }

  // Score coverage check: scores should spread across the range
  for (const dim of activeDims) {
    const rubric = dim.scoringRubric || [];
    if (rubric.length >= 5) {
      const scores = rubric.map(r => r.score);
      const min = Math.min(...scores);
      const max = Math.max(...scores);
      const dimMin = dim.minScore ?? 1;
      const dimMax = dim.maxScore ?? 10;
      if (min > dimMin + 1 || max < dimMax - 1) {
        rubricStageIssues.push(`"${dim.name}": 루브릭 점수 범위가 차원 범위(${dimMin}~${dimMax})를 충분히 커버하지 않음`);
        rubricStageCompleteness = Math.max(0, rubricStageCompleteness - 3);
      }
    }
  }
  rubricStageCompleteness = Math.max(0, rubricStageCompleteness);
  if (rubricStageIssues.length > 0) {
    recommendations.push('루브릭 단계: ' + rubricStageIssues[0]);
  }

  // ── 5. 평가 프롬프트 품질 (15점) ──
  const promptQualityIssues: string[] = [];
  let evaluationPromptQuality = 15;

  let missingPromptCount = 0;
  let shortPromptCount = 0;
  for (const dim of activeDims) {
    const prompt = dim.evaluationPrompt;
    if (!prompt || prompt.trim().length === 0) {
      missingPromptCount++;
    } else if (prompt.trim().length < 30) {
      shortPromptCount++;
    }
  }

  if (activeDims.length > 0) {
    const missingRatio = missingPromptCount / activeDims.length;
    if (missingRatio > 0) {
      promptQualityIssues.push(`평가 프롬프트 없음: ${missingPromptCount}개 차원 (전체의 ${Math.round(missingRatio * 100)}%)`);
      evaluationPromptQuality = Math.round(15 * (1 - missingRatio * 0.8));
    }
    if (shortPromptCount > 0) {
      promptQualityIssues.push(`평가 프롬프트가 너무 짧음 (30자 미만): ${shortPromptCount}개 차원`);
      evaluationPromptQuality = Math.max(0, evaluationPromptQuality - shortPromptCount * 2);
    }
  }
  evaluationPromptQuality = Math.max(0, evaluationPromptQuality);
  if (promptQualityIssues.length > 0) {
    recommendations.push('평가 프롬프트: ' + promptQualityIssues[0]);
  }

  const totalScore = Math.min(100, Math.max(0,
    scoreConsistency + weightAccuracy + behaviorAnchorSpecificity + rubricStageCompleteness + evaluationPromptQuality
  ));

  return {
    totalScore,
    breakdown: {
      scoreConsistency: { score: scoreConsistency, maxScore: 20, issues: scoreConsistencyIssues },
      weightAccuracy: { score: weightAccuracy, maxScore: 20, issues: weightAccuracyIssues },
      behaviorAnchorSpecificity: { score: behaviorAnchorSpecificity, maxScore: 25, issues: behaviorAnchorIssues },
      rubricStageCompleteness: { score: rubricStageCompleteness, maxScore: 20, issues: rubricStageIssues },
      evaluationPromptQuality: { score: evaluationPromptQuality, maxScore: 15, issues: promptQualityIssues },
    },
    recommendations,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 평가 신뢰도(confidence) 및 리포트 상태값(reportStatus) 로직
// ─────────────────────────────────────────────────────────────────────────────

export type ReportStatus = 'valid' | 'low_confidence' | 'insufficient_data' | 'system_fallback';

/**
 * 평가 신뢰도(confidence) 계산 — 0~1 반환
 *
 * 5개 요소를 가중 합산:
 *  - 유효 사용자 발화 수 (25%)  — validUserCount / expectedTurns
 *  - 총 발화량 (20%)           — totalChars / expectedChars
 *  - 대화 완성도 (20%)         — effectiveRatio
 *  - evidence 충족률 (20%)     — dimensions with ≥1 valid evidence / total dimensions
 *  - 음성 노이즈 품질 (15%)    — validMessages / rawMessages (텍스트 모드는 1.0 고정)
 *
 * @param params.validUserMessages  노이즈 필터링 후 유효 사용자 메시지
 * @param params.rawUserMessages    필터링 전 원본 사용자 메시지
 * @param params.effectiveRatio     calcEffectiveRatio() 결과
 * @param params.evidenceMap        차원별 evidence 배열 (없으면 빈 객체)
 * @param params.dimensions         평가 차원 목록
 * @param params.voiceMode          음성 모드 여부
 * @param params.scenarioTargetTurns 시나리오 목표 턴 수 (없으면 전역 기본값)
 */
export function calculateEvaluationConfidence(params: {
  validUserMessages: ConversationMessage[];
  rawUserMessages: ConversationMessage[];
  effectiveRatio: number;
  evidenceMap?: Record<string, { isSystemFallback?: boolean }[]>;
  dimensions?: { key: string }[];
  voiceMode: boolean;
  scenarioTargetTurns?: number;
}): number {
  const {
    validUserMessages,
    rawUserMessages,
    effectiveRatio,
    evidenceMap = {},
    dimensions = [],
    voiceMode,
    scenarioTargetTurns,
  } = params;

  const expectedTurns = scenarioTargetTurns ?? (voiceMode ? EXPECTED_TURNS_VOICE : EXPECTED_TURNS_TEXT);
  const expectedChars = expectedTurns * BASELINE_CHARS_PER_TURN;

  // 1) 유효 발화 수 점수 (25%)
  const utteranceScore = Math.min(1.0, validUserMessages.length / expectedTurns);

  // 2) 총 발화량 점수 (20%)
  const totalChars = validUserMessages.reduce((s, m) => s + m.message.length, 0);
  const volumeScore = Math.min(1.0, totalChars / expectedChars);

  // 3) 대화 완성도 점수 (20%) — 이미 계산된 effectiveRatio 사용
  const completionScore = Math.min(1.0, effectiveRatio);

  // 4) evidence 충족률 (20%)
  let evidenceScore = 1.0;
  if (dimensions.length > 0) {
    const dimsWithEvidence = dimensions.filter(dim => {
      const ev = evidenceMap[dim.key];
      if (!Array.isArray(ev) || ev.length === 0) return false;
      return ev.some(e => !e.isSystemFallback);
    }).length;
    evidenceScore = dimsWithEvidence / dimensions.length;
  }

  // 5) 음성 노이즈 품질 (15%) — 텍스트 모드는 패널티 없음
  let noiseScore = 1.0;
  if (voiceMode && rawUserMessages.length > 0) {
    noiseScore = Math.min(1.0, validUserMessages.length / rawUserMessages.length);
  }

  const confidence =
    utteranceScore * 0.25 +
    volumeScore    * 0.20 +
    completionScore * 0.20 +
    evidenceScore  * 0.20 +
    noiseScore     * 0.15;

  return Math.round(confidence * 1000) / 1000;
}

/**
 * confidence 값으로 reportStatus 결정
 *  - confidence < 0.4  → insufficient_data
 *  - 0.4 ≤ c < 0.7    → low_confidence
 *  - 0.7 ≤ c          → valid
 */
export function determineReportStatus(confidence: number, error?: unknown): ReportStatus {
  if (error != null || !Number.isFinite(confidence)) return 'system_fallback';
  if (confidence < 0.4) return 'insufficient_data';
  if (confidence < 0.7) return 'low_confidence';
  return 'valid';
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

// ─────────────────────────────────────────────────────────────────────────────
// evaluationHarness passingRule 적용
// ─────────────────────────────────────────────────────────────────────────────

export interface HarnessPassResult {
  /** Overall pass/fail verdict */
  passed: boolean;
  /** true when overallScore < passingRule.minAverageScore */
  failedMinScore: boolean;
  /** dimension keys whose percentage score fell below requiredDimensions.minScore */
  failedDimensions: string[];
}

/**
 * Applies `evaluationHarness.passingRule` to the final feedback score.
 *
 * @param overallScore  0-100 final score (after all adjustments)
 * @param dimensionScores  Array of per-dimension scores with raw score and maxScore
 * @param passingRule  Nullable — if null/undefined, always returns passed=true
 * @returns  HarnessPassResult
 */
export function applyPassingRule(
  overallScore: number,
  dimensionScores: Array<{ category: string; score: number; maxScore?: number }>,
  passingRule: PassingRule | null | undefined
): HarnessPassResult {
  if (!passingRule) {
    return { passed: true, failedMinScore: false, failedDimensions: [] };
  }

  const failedMinScore = overallScore < passingRule.minAverageScore;

  const failedDimensions: string[] = [];
  if (passingRule.requiredDimensions && passingRule.requiredDimensions.length > 0) {
    for (const req of passingRule.requiredDimensions) {
      const dim = dimensionScores.find(s => s.category === req.key);
      if (!dim) continue;
      const maxScore = dim.maxScore ?? 10;
      const scorePct = Math.round((dim.score / maxScore) * 100);
      if (scorePct < req.minScore) {
        failedDimensions.push(req.key);
      }
    }
  }

  return {
    passed: !failedMinScore && failedDimensions.length === 0,
    failedMinScore,
    failedDimensions,
  };
}
