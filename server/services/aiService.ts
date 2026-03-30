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
  ko: '반드시 한국어로 응답하세요.',
  en: 'You must respond in English.',
  ja: '必ず日本語で応答してください。',
  zh: '请务必用中文回复。'
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
  [key: string]: unknown;
}

// AI 서비스 공통 인터페이스
export interface AIServiceInterface {
  generateResponse(
    scenario: RoleplayScenario | string, 
    messages: ConversationMessage[], 
    persona: ScenarioPersona,
    userMessage?: string,
    language?: SupportedLanguage
  ): Promise<{ content: string; emotion: string; emotionReason: string }>;
  
  generateFeedback(
    scenario: RoleplayScenario | string, 
    messages: ConversationMessage[], 
    persona: ScenarioPersona,
    conversation?: Partial<Conversation>,
    evaluationCriteria?: EvaluationCriteriaWithDimensions,
    language?: SupportedLanguage
  ): Promise<DetailedFeedback>;

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

// AI 서비스 설정
export interface AIServiceConfig {
  provider: 'gemini' | 'openai' | 'claude' | 'custom';
  apiKey: string;
  model?: string;
  baseUrl?: string; // Custom API용
  headers?: Record<string, string>; // Custom API용
  apiFormat?: 'openai' | 'custom'; // API 형식 선택
}

// 환경 변수에서 AI 서비스 설정 로드
export function getAIServiceConfig(): AIServiceConfig {
  const provider = (process.env.AI_PROVIDER as any) || 'gemini';
  
  switch (provider) {
    case 'openai':
      return {
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY || '',
        model: process.env.OPENAI_MODEL || 'gpt-4'
      };
    case 'claude':
      return {
        provider: 'claude',
        apiKey: process.env.CLAUDE_API_KEY || '',
        model: process.env.CLAUDE_MODEL || 'claude-3-sonnet-20240229'
      };
    case 'custom':
      return {
        provider: 'custom',
        apiKey: process.env.CUSTOM_API_KEY || '',
        model: process.env.CUSTOM_MODEL || '',
        baseUrl: process.env.CUSTOM_API_URL || '',
        headers: process.env.CUSTOM_HEADERS ? JSON.parse(process.env.CUSTOM_HEADERS) : {},
        apiFormat: (process.env.CUSTOM_API_FORMAT as 'openai' | 'custom') || 'openai'
      };
    default: // gemini
      return {
        provider: 'gemini',
        apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash'
      };
  }
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

