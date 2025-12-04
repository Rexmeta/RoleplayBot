import type { AIServiceInterface, AIServiceConfig } from "./aiService";
import { getAIServiceConfig } from "./aiService";
import { OptimizedGeminiProvider } from "./providers/optimizedGeminiProvider";
import { OpenAIProvider } from "./providers/openaiProvider";
import { CustomProvider } from "./providers/customProvider";
import { storage } from "../storage";

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
        return new OptimizedGeminiProvider(process.env.GEMINI_API_KEY || '', 'gemini-2.5-flash');

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
        return new OptimizedGeminiProvider(config.apiKey, config.model);
    }
  }
}

/**
 * 편의를 위한 AI 서비스 인스턴스 getter
 */
export function getAIService(): AIServiceInterface {
  return AIServiceFactory.getInstance();
}

/**
 * DB 시스템 설정에서 AI 모델 설정을 읽어와 서비스에 적용
 * 대화 시작 전에 호출하여 최신 설정 반영
 */
export async function syncModelFromSettings(): Promise<void> {
  try {
    const modelSetting = await storage.getSystemSetting("ai", "model");
    if (modelSetting?.value) {
      const service = AIServiceFactory.getInstance();
      if (service.setModel) {
        service.setModel(modelSetting.value);
      }
    }
  } catch (error) {
    console.error("Failed to sync AI model from settings:", error);
    // 실패해도 기본 모델 사용하므로 에러 무시
  }
}

/**
 * 현재 사용 중인 AI 모델명 반환
 */
export function getCurrentModel(): string {
  const service = AIServiceFactory.getInstance();
  return service.getModel?.() || 'gemini-2.5-flash';
}