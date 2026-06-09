import type { AIServiceInterface, StrategyReflectionEvaluation, StrategyEvaluationInput, RoleplayScenario, EvaluationCriteriaWithDimensions } from "./aiService";
import { OptimizedGeminiProvider } from "./providers/optimizedGeminiProvider";
import { OpenAIProvider } from "./providers/openaiProvider";
import { CustomProvider } from "./providers/customProvider";
import { storage } from "../storage";
import type { ConversationMessage, DetailedFeedback, Conversation } from "@shared/schema";
import type { ScenarioPersona, SupportedLanguage } from "./aiService";

export type { ScenarioPersona, SupportedLanguage, StrategyReflectionEvaluation, RoleplayScenario, EvaluationCriteriaWithDimensions };

// 기능별 설정 키 매핑
export type AIFeature = 'conversation' | 'feedback' | 'strategy' | 'scenario' | 'translation';

const FEATURE_SETTING_KEYS: Record<AIFeature, string> = {
  conversation: 'model_conversation',
  feedback: 'model_feedback',
  strategy: 'model_strategy',
  scenario: 'model_scenario',
  translation: 'model_translation',
};

// 기능별 환경변수 키 매핑
const FEATURE_ENV_KEYS: Record<AIFeature, string> = {
  conversation: 'AI_MODEL_CONVERSATION',
  feedback: 'AI_MODEL_FEEDBACK',
  strategy: 'AI_MODEL_STRATEGY',
  scenario: 'AI_MODEL_SCENARIO',
  translation: 'AI_MODEL_TRANSLATION',
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
    if (model.startsWith('gpt-')) return 'openai';
    if (model.startsWith('claude-')) return 'claude';
    return 'gemini';
  }
}

/**
 * 특정 기능에 대한 AI 모델을 결정하는 단일 진입점
 * 우선순위: 기능별 환경변수 → 전역 환경변수 → DB 시스템 설정 → 기본값
 */
export async function getModelForFeature(feature: AIFeature): Promise<string> {
  // 1. 기능별 환경변수 (예: AI_MODEL_CONVERSATION)
  const featureEnvModel = process.env[FEATURE_ENV_KEYS[feature]];
  if (featureEnvModel) return featureEnvModel;

  // 2. 전역 환경변수 (예: AI_MODEL)
  const globalEnvModel = process.env.AI_MODEL;
  if (globalEnvModel) return globalEnvModel;

  // 3. DB 시스템 설정
  try {
    const settingKey = FEATURE_SETTING_KEYS[feature];
    const setting = await storage.getSystemSetting("ai", settingKey);
    if (setting?.value) return setting.value;
  } catch (error) {
    console.error(`Failed to get model for feature ${feature}:`, error);
  }

  // 4. 기본값
  return 'gemini-2.5-flash';
}

/**
 * 특정 기능에 대해 구성된 AI 서비스 인스턴스를 반환합니다
 * 각 호출마다 새 인스턴스를 생성하여 레이스 컨디션 방지
 * @param feature 기능 유형 (conversation, feedback, strategy, scenario)
 */
export async function getAIServiceForFeature(feature: AIFeature): Promise<AIServiceInterface> {
  const model = await getModelForFeature(feature);
  console.log(`🤖 Creating AI service for ${feature} with model: ${model}`);
  return AIServiceFactory.createServiceWithModel(model);
}

// ─────────────────────────────────────────────────────────────────────────────
// 편의 함수: 기존 호출 코드와 동일한 시그니처를 유지하면서 Provider 패턴을 통해 호출
// ─────────────────────────────────────────────────────────────────────────────

export async function generateAIResponse(
  scenario: RoleplayScenario | string,
  messages: ConversationMessage[],
  persona: ScenarioPersona,
  userMessage?: string,
  language?: SupportedLanguage,
  userName?: string
): Promise<{ content: string; emotion: string; emotionReason: string }> {
  if (!language) {
    console.warn('⚠️ [generateAIResponse] language not provided — defaulting to ko. Check call site.');
  }
  const resolvedLanguage: SupportedLanguage = language || 'ko';
  const aiService = await getAIServiceForFeature('conversation');
  return aiService.generateResponse(scenario, messages, persona, userMessage, resolvedLanguage, userName);
}

export async function generateFeedback(
  scenario: RoleplayScenario | string,
  messages: ConversationMessage[],
  persona: ScenarioPersona,
  conversation?: Partial<Conversation>,
  evaluationCriteria?: EvaluationCriteriaWithDimensions,
  language?: SupportedLanguage
): Promise<DetailedFeedback> {
  if (!language) {
    console.warn('⚠️ [generateFeedback] language not provided — defaulting to ko. Check call site.');
  }
  const resolvedLanguage: SupportedLanguage = language || 'ko';
  const aiService = await getAIServiceForFeature('feedback');
  return aiService.generateFeedback(scenario, messages, persona, conversation, evaluationCriteria, resolvedLanguage);
}

// ─────────────────────────────────────────────────────────────────────────────
// 전략 회고 평가 — Provider 패턴을 통해 호출
// ─────────────────────────────────────────────────────────────────────────────

export async function generateStrategyReflectionFeedback(
  strategyReflection: string,
  conversationOrder: string[],
  scenarioInfo: {
    title: string;
    context: string;
    objectives: string[];
    personas: Array<{ id: string; name: string; role: string; department: string }>;
  },
  language?: SupportedLanguage
): Promise<StrategyReflectionEvaluation> {
  if (!language) {
    console.warn('⚠️ [generateStrategyReflectionFeedback] language not provided — defaulting to ko. Check call site.');
  }
  const resolvedLanguage: SupportedLanguage = language || 'ko';
  const aiService = await getAIServiceForFeature('strategy');

  if (typeof aiService.generateStrategyEvaluation === 'function') {
    const input: StrategyEvaluationInput = { strategyReflection, conversationOrder, scenarioInfo, language: resolvedLanguage };
    return aiService.generateStrategyEvaluation(input);
  }

  // 현재 Provider가 전략 평가를 지원하지 않는 경우 Gemini로 대체
  // 모델은 getModelForFeature를 통해 중앙 정책에 따라 결정 (Gemini 모델만 사용 가능)
  console.warn('Current provider does not support generateStrategyEvaluation, falling back to Gemini');
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!geminiKey) {
    return getDefaultStrategyEvaluation();
  }
  const strategyModel = await getModelForFeature('strategy');
  const fallbackModel = strategyModel.startsWith('gemini-') ? strategyModel : 'gemini-2.5-flash';
  const geminiService = new OptimizedGeminiProvider(geminiKey, fallbackModel);
  const input: StrategyEvaluationInput = { strategyReflection, conversationOrder, scenarioInfo, language: resolvedLanguage };
  return geminiService.generateStrategyEvaluation!(input);
}

/**
 * 스트리밍 AI 응답 생성 — SSE 텍스트 대화에서 사용
 * AsyncIterable<string>을 반환하며, 각 청크는 텍스트 델타임.
 * 응답 끝에 [META:{...}] 마커가 포함됨 (호출자가 파싱).
 */
export async function generateStreamingAIResponse(
  scenario: RoleplayScenario | string,
  messages: ConversationMessage[],
  persona: ScenarioPersona,
  userMessage?: string,
  language?: SupportedLanguage,
  userName?: string
): Promise<AsyncIterable<string>> {
  const resolvedLanguage: SupportedLanguage = language || 'ko';
  const aiService = await getAIServiceForFeature('conversation');
  if (aiService.generateStreamingResponse) {
    return aiService.generateStreamingResponse(
      scenario, messages, persona, userMessage, resolvedLanguage, userName
    );
  }
  // Fallback: wrap regular response as a single-chunk stream with META marker
  console.warn('[generateStreamingAIResponse] Provider does not support streaming, falling back to regular response');
  const response = await aiService.generateResponse(scenario, messages, persona, userMessage, resolvedLanguage, userName);
  async function* singleChunk() {
    const meta = JSON.stringify({ emotion: response.emotion, emotionReason: response.emotionReason, complete: false });
    yield response.content + `\n[META:${meta}]`;
  }
  return singleChunk();
}

function getDefaultStrategyEvaluation(): StrategyReflectionEvaluation {
  return {
    strategicScore: 70,
    strategicRationale: "전략 회고를 작성해 주셔서 감사합니다. 시스템 오류로 인해 상세한 평가를 제공하지 못했습니다.",
    sequenceEffectiveness: "대화 순서 선택에 대한 평가를 수행하지 못했습니다.",
    alternativeApproaches: ["다양한 순서로 대화를 시도해보세요."],
    strategicInsights: "다음에 다시 시도해 주세요.",
    strengths: ["전략 회고를 작성했습니다."],
    improvements: ["더 구체적인 피드백을 위해 다시 시도해 주세요."]
  };
}
