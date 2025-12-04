import type { AIServiceInterface, AIServiceConfig } from "./aiService";
import { getAIServiceConfig } from "./aiService";
import { OptimizedGeminiProvider } from "./providers/optimizedGeminiProvider";
import { OpenAIProvider } from "./providers/openaiProvider";
import { CustomProvider } from "./providers/customProvider";
import { storage } from "../storage";

// 기능별 설정 키 매핑
export type AIFeature = 'conversation' | 'feedback' | 'strategy';

const FEATURE_SETTING_KEYS: Record<AIFeature, string> = {
  conversation: 'model_conversation',
  feedback: 'model_feedback',
  strategy: 'model_strategy',
};

/**
 * AI 서비스 팩토리
 * 기능별로 독립적인 AI 제공업체 인스턴스를 생성합니다.
 * 레이스 컨디션을 방지하기 위해 각 요청마다 새 인스턴스를 생성합니다.
 */
export class AIServiceFactory {
  /**
   * 특정 모델을 사용하는 새 AI 서비스 인스턴스를 생성합니다
   * @param model 사용할 모델명 (예: gemini-2.5-flash, gpt-4o)
   */
  static createServiceWithModel(model: string): AIServiceInterface {
    // 모델명으로 프로바이더 결정
    const provider = this.getProviderFromModel(model);
    
    switch (provider) {
      case 'openai':
        const openaiKey = process.env.OPENAI_API_KEY;
        if (!openaiKey) {
          console.warn('OPENAI_API_KEY not set, falling back to Gemini');
          return new OptimizedGeminiProvider(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '', 'gemini-2.5-flash');
        }
        return new OpenAIProvider(openaiKey, model);

      case 'claude':
        // Claude는 아직 구현되지 않았으므로 Gemini로 fallback
        console.warn('Claude provider not implemented yet, falling back to Gemini');
        return new OptimizedGeminiProvider(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '', 'gemini-2.5-flash');

      default: // gemini
        const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        if (!geminiKey) {
          throw new Error('GEMINI_API_KEY or GOOGLE_API_KEY is required');
        }
        return new OptimizedGeminiProvider(geminiKey, model);
    }
  }

  /**
   * 모델명에서 프로바이더를 추론합니다
   */
  private static getProviderFromModel(model: string): 'gemini' | 'openai' | 'claude' {
    if (model.startsWith('gpt-')) {
      return 'openai';
    }
    if (model.startsWith('claude-')) {
      return 'claude';
    }
    return 'gemini';
  }

  /**
   * @deprecated Use getAIServiceForFeature instead
   */
  static getInstance(): AIServiceInterface {
    return this.createServiceWithModel('gemini-2.5-flash');
  }
}

/**
 * 특정 기능에 대한 AI 모델 설정을 DB에서 읽어옵니다
 */
export async function getModelForFeature(feature: AIFeature): Promise<string> {
  try {
    const settingKey = FEATURE_SETTING_KEYS[feature];
    const setting = await storage.getSystemSetting("ai", settingKey);
    if (setting?.value) {
      return setting.value;
    }
    // 기본값 반환
    return 'gemini-2.5-flash';
  } catch (error) {
    console.error(`Failed to get model for feature ${feature}:`, error);
    return 'gemini-2.5-flash';
  }
}

/**
 * 특정 기능에 대해 구성된 AI 서비스 인스턴스를 반환합니다
 * 각 호출마다 새 인스턴스를 생성하여 레이스 컨디션 방지
 * @param feature 기능 유형 (conversation, feedback, strategy)
 */
export async function getAIServiceForFeature(feature: AIFeature): Promise<AIServiceInterface> {
  const model = await getModelForFeature(feature);
  console.log(`🤖 Creating AI service for ${feature} with model: ${model}`);
  return AIServiceFactory.createServiceWithModel(model);
}

/**
 * @deprecated Use getAIServiceForFeature instead
 * 편의를 위한 AI 서비스 인스턴스 getter (기본 모델 사용)
 */
export function getAIService(): AIServiceInterface {
  return AIServiceFactory.getInstance();
}

/**
 * @deprecated Use getAIServiceForFeature instead
 */
export async function syncModelForFeature(feature: AIFeature): Promise<void> {
  // 더 이상 사용하지 않음 - getAIServiceForFeature를 사용하세요
  console.warn('syncModelForFeature is deprecated, use getAIServiceForFeature instead');
}

/**
 * @deprecated Use getAIServiceForFeature instead
 */
export async function syncModelFromSettings(): Promise<void> {
  console.warn('syncModelFromSettings is deprecated, use getAIServiceForFeature instead');
}

/**
 * 현재 사용 중인 AI 모델명 반환 (기본값)
 */
export function getCurrentModel(): string {
  return 'gemini-2.5-flash';
}