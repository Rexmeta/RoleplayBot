import type { AIServiceInterface, AIServiceConfig } from "./aiService";
import { getAIServiceConfig } from "./aiService";
import { GeminiProvider } from "./providers/geminiProvider";
import { OpenAIProvider } from "./providers/openaiProvider";
import { CustomProvider } from "./providers/customProvider";

/**
 * AI 서비스 팩토리
 * 환경 설정에 따라 적절한 AI 제공업체를 반환합니다.
 */
export class AIServiceFactory {
  private static instance: AIServiceInterface | null = null;

  /**
   * AI 서비스 인스턴스를 반환합니다 (싱글톤 패턴)
   */
  static getInstance(): AIServiceInterface {
    if (!this.instance) {
      this.instance = this.createService();
    }
    return this.instance;
  }

  /**
   * AI 서비스 인스턴스를 재생성합니다
   * 환경 변수가 변경된 경우 사용합니다.
   */
  static recreateInstance(): AIServiceInterface {
    this.instance = this.createService();
    return this.instance;
  }

  private static createService(): AIServiceInterface {
    const config = getAIServiceConfig();

    console.log(`Creating AI service with provider: ${config.provider}`);

    switch (config.provider) {
      case 'openai':
        if (!config.apiKey) {
          throw new Error('OPENAI_API_KEY is required for OpenAI provider');
        }
        return new OpenAIProvider(config.apiKey, config.model);

      case 'claude':
        if (!config.apiKey) {
          throw new Error('CLAUDE_API_KEY is required for Claude provider');
        }
        // Claude는 아직 구현되지 않았으므로 Gemini로 fallback
        console.warn('Claude provider not implemented yet, falling back to Gemini');
        return new GeminiProvider(process.env.GEMINI_API_KEY || '', 'gemini-2.5-flash');

      case 'custom':
        if (!config.apiKey || !config.baseUrl) {
          throw new Error('CUSTOM_API_KEY and CUSTOM_API_URL are required for custom provider');
        }
        return new CustomProvider(config);

      default: // gemini
        if (!config.apiKey) {
          throw new Error('GEMINI_API_KEY is required for Gemini provider');
        }
        return new GeminiProvider(config.apiKey, config.model);
    }
  }
}

/**
 * 편의를 위한 AI 서비스 인스턴스 getter
 */
export function getAIService(): AIServiceInterface {
  return AIServiceFactory.getInstance();
}