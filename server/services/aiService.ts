import type { ConversationMessage, EvaluationScore, DetailedFeedback, Conversation, EvaluationDimension, EvaluationCriteriaSet } from "@shared/schema";

// 전략 평가를 위한 대화 컨텍스트
export type StrategyContext = Pick<Conversation, 'strategyReflection' | 'conversationOrder'>;

// 동적 평가 기준 세트 (차원 포함)
export interface EvaluationCriteriaWithDimensions {
  id: string;
  name: string;
  description?: string | null;
  dimensions: Array<{
    key: string;
    name: string;
    description?: string | null;
    weight: number;
    minScore: number;
    maxScore: number;
    icon?: string | null;
    color?: string | null;
    scoringRubric?: Array<{
      score: number;
      label: string;
      description: string;
    }> | null;
    evaluationPrompt?: string | null;
  }>;
}

// 지원되는 언어 코드
export type SupportedLanguage = 'ko' | 'en' | 'ja' | 'zh';

// 언어별 응답 지시문
export const LANGUAGE_INSTRUCTIONS: Record<SupportedLanguage, string> = {
  ko: '이 세션은 한국어로만 진행하며, 다른 어떤 언어로도 절대 전환해서는 안 됩니다. 모든 응답은 반드시 한국어로만 하세요.',
  en: 'This session is conducted in English only. Do not switch to any other language under any circumstances. Always respond in English.',
  ja: 'このセッションは日本語のみで進行します。いかなる場合も他の言語に切り替えてはいけません。必ず日本語だけで応答してください。',
  zh: '本次会话仅使用中文进行，任何情况下都不得切换为其他语言。必须只用中文回答。',
};

// 롤플레이 시나리오 타입 (AI 서비스 레이어에서 사용)
export interface RoleplayScenario {
  id?: string;
  difficulty?: number;
  objectives?: string[];
  context?: {
    situation?: string;
    timeline?: string;
    stakes?: string;
    playerRole?: {
      position?: string;
      department?: string;
      experience?: string;
      responsibility?: string;
    };
  };
  personas?: Array<{
    id: string;
    name: string;
    personaRef?: string;
    stance?: string;
    goal?: string;
    tradeoff?: string;
    department?: string;
    experience?: string;
    gender?: string;
    mbti?: string;
  }>;
  /** 모드 전환 시 AI 스타일 연속성 유지를 위해 일회성으로 주입되는 시스템 힌트 */
  modeTransitionHint?: string;
  /** 시뮬레이션 품질 모드에서 AI 응답 생성 전 주입되는 [SIMULATION_STATE] 블록 */
  simulationStateBlock?: string;
  /** 시나리오별 목표 대화 시간 (분) */
  targetDurationMinutes?: number;
  /** 시나리오별 목표 턴 수 */
  targetTurns?: number;
  /** 최소 유효 턴 수 (미달 시 평가 불가) */
  minValidTurns?: number;
  /** 다중 페르소나 전환 시스템: 전체 페르소나 목록 */
  allPersonas?: Array<{ id: string; name: string; position?: string; department?: string; triggerHints?: string[]; entryLine?: string; [key: string]: any }>;
  /** 현재 활성 페르소나 인덱스 (multi-persona 전환 시) */
  activePersonaIndex?: number;
  [key: string]: unknown;
}

// 전략 회고 평가 결과
export interface StrategyReflectionEvaluation {
  strategicScore: number;
  strategicRationale: string;
  sequenceEffectiveness: string;
  alternativeApproaches: string[];
  strategicInsights: string;
  strengths: string[];
  improvements: string[];
}

// 전략 회고 입력 컨텍스트
export interface StrategyEvaluationInput {
  strategyReflection: string;
  conversationOrder: string[];
  scenarioInfo: {
    title: string;
    context: string;
    objectives: string[];
    personas: Array<{ id: string; name: string; role: string; department: string }>;
  };
  language?: SupportedLanguage;
}

// AI 서비스 공통 인터페이스
export interface AIServiceInterface {
  generateResponse(
    scenario: RoleplayScenario | string,
    messages: ConversationMessage[],
    persona: ScenarioPersona,
    userMessage?: string,
    language?: SupportedLanguage,
    userName?: string
  ): Promise<{ content: string; emotion: string; emotionReason: string }>;

  generateFeedback(
    scenario: RoleplayScenario | string,
    messages: ConversationMessage[],
    persona: ScenarioPersona,
    conversation?: Partial<Conversation>,
    evaluationCriteria?: EvaluationCriteriaWithDimensions,
    language?: SupportedLanguage
  ): Promise<DetailedFeedback>;

  // 전략 회고 평가 (선택적 — 지원하지 않는 Provider는 구현하지 않아도 됨)
  generateStrategyEvaluation?(input: StrategyEvaluationInput): Promise<StrategyReflectionEvaluation>;

  // 모델 동적 변경 지원 (선택적)
  getModel?(): string;
  setModel?(model: string): void;
}

export interface ScenarioPersona {
  id: string;
  name: string;
  role: string;
  personality: string;
  responseStyle: string;
  goals: string[];
  background: string;
}

// AI 서비스 설정 (CustomProvider에서 사용)
export interface AIServiceConfig {
  provider: 'gemini' | 'openai' | 'claude' | 'custom';
  apiKey: string;
  model?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  apiFormat?: 'openai' | 'custom';
}

// 감정 분류 매핑 (공통)
export const emotionEmojis: { [key: string]: string } = {
  '기쁨': '😊',
  '슬픔': '😢',
  '분노': '😠',
  '놀람': '😲',
  '중립': '😐',
  '호기심': '🤔',
  '불안': '😰',
  '피로': '😫',
  '실망': '😞',
  '당혹': '😕'
};
