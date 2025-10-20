import type { ConversationMessage, EvaluationScore, DetailedFeedback, Conversation } from "@shared/schema";

// 전략 평가를 위한 대화 컨텍스트
export type StrategyContext = Pick<Conversation, 'strategyReflection' | 'conversationOrder'>;

// AI 서비스 공통 인터페이스
export interface AIServiceInterface {
  generateResponse(
    scenario: string, 
    messages: ConversationMessage[], 
    persona: ScenarioPersona,
    userMessage?: string
  ): Promise<{ content: string; emotion: string; emotionReason: string }>;
  
  generateFeedback(
    scenario: string, 
    messages: ConversationMessage[], 
    persona: ScenarioPersona,
    conversation?: Partial<Conversation>
  ): Promise<DetailedFeedback>;
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
        apiKey: process.env.GEMINI_API_KEY || '',
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
  '중립': '😐'
};

