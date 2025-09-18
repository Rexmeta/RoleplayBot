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
    console.log("🔧 FACTORY DEBUG: config 객체 전체:", JSON.stringify(config, null, 2));

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
          console.warn('CUSTOM_API_KEY and CUSTOM_API_URL not set, using test mode');
          // 테스트 모드: 실제 API 없이 Mock 응답 제공
          const testConfig = {
            provider: 'custom' as const,
            apiKey: 'test-key',
            model: 'test-model',
            baseUrl: 'http://localhost:11434/v1',
            headers: {}
          };
          return new CustomProvider(testConfig);
        }
        return new CustomProvider(config);

      default: // gemini
        if (!config.apiKey) {
          throw new Error('GEMINI_API_KEY is required for Gemini provider');
        }
        console.log("🔧 FACTORY: Gemini Provider 생성 중");
        console.log(`🔧 FACTORY: API Key 길이: ${config.apiKey.length}`);
        console.log(`🔧 FACTORY: 전달될 모델: ${config.model}`);
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