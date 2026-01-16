// Legacy file - 하위 호환성을 위해 유지됨
// 새로운 AI 서비스 사용을 위해서는 aiServiceFactory.ts를 사용하세요

import { GoogleGenAI } from "@google/genai";
import { getAIServiceForFeature, getModelForFeature } from "./aiServiceFactory";
import { emotionEmojis } from "./aiService";
import type { ConversationMessage, DetailedFeedback, SequenceAnalysis } from "@shared/schema";
import type { ScenarioPersona, SupportedLanguage } from "./aiService";

// 하위 호환성을 위한 기존 인터페이스 유지
export { ScenarioPersona, emotionEmojis };
export type { SupportedLanguage };


// AI 서비스 팩토리로 위임 - 기능별 모델 사용
export async function generateAIResponse(
  scenario: string, 
  messages: ConversationMessage[], 
  persona: ScenarioPersona,
  userMessage?: string,
  language: SupportedLanguage = 'ko'
): Promise<{ content: string; emotion: string; emotionReason: string }> {
  // 대화 기능에 설정된 모델을 사용하는 AI 서비스 인스턴스 생성
  const aiService = await getAIServiceForFeature('conversation');
  return aiService.generateResponse(scenario, messages, persona, userMessage, language);
}

export async function generateFeedback(
  scenario: string, 
  messages: ConversationMessage[], 
  persona: ScenarioPersona,
  conversation?: Partial<import("@shared/schema").Conversation>,
  evaluationCriteria?: any,
  language: SupportedLanguage = 'ko'
): Promise<DetailedFeedback> {
  // 피드백 기능에 설정된 모델을 사용하는 AI 서비스 인스턴스 생성
  const aiService = await getAIServiceForFeature('feedback');
  return aiService.generateFeedback(scenario, messages, persona, conversation, evaluationCriteria, language);
}

// 전략 회고 평가 타입
export interface StrategyReflectionEvaluation {
  strategicScore: number;
  strategicRationale: string;
  sequenceEffectiveness: string;
  alternativeApproaches: string[];
  strategicInsights: string;
  strengths: string[];
  improvements: string[];
}

// 전략 회고에 대한 AI 평가 생성
export async function generateStrategyReflectionFeedback(
  strategyReflection: string,
  conversationOrder: string[],
  scenarioInfo: {
    title: string;
    context: string;
    objectives: string[];
    personas: Array<{ id: string; name: string; role: string; department: string }>;
  },
  language: SupportedLanguage = 'ko'
): Promise<StrategyReflectionEvaluation> {
  // 전략 기능에 설정된 모델 가져오기
  const configuredModel = await getModelForFeature('strategy');
  console.log(`🧠 전략 회고 AI 평가 시작... (모델: ${configuredModel})`);
  
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY 또는 GOOGLE_API_KEY가 설정되지 않았습니다.");
    return getDefaultStrategyEvaluation();
  }

  const genAI = new GoogleGenAI({ apiKey });
  
  // 대화 순서 매핑
  const orderedPersonas = conversationOrder.map((personaId, index) => {
    const persona = scenarioInfo.personas.find(p => p.id === personaId);
    return persona 
      ? `${index + 1}. ${persona.name} (${persona.role}, ${persona.department})`
      : `${index + 1}. 알 수 없는 인물`;
  }).join('\n');

  const prompt = `당신은 기업 커뮤니케이션 전문가이자 교육 평가자입니다.
사용자가 역할극 시나리오에서 대화 순서를 선택한 후 작성한 전략 회고를 평가해주세요.

## 시나리오 정보
제목: ${scenarioInfo.title}
상황: ${scenarioInfo.context}
목표: ${scenarioInfo.objectives.join(', ')}

## 등장인물
${scenarioInfo.personas.map(p => `- ${p.name}: ${p.role} (${p.department})`).join('\n')}

## 사용자가 선택한 대화 순서
${orderedPersonas}

## 사용자의 전략 회고
"${strategyReflection}"

## 평가 기준
1. 전략적 사고력 (0-100): 대화 순서 선택의 논리성과 전략적 근거
2. 순서 효과성: 선택한 순서가 목표 달성에 얼마나 효과적인지
3. 대안적 접근법: 다른 효과적인 순서나 전략 제안
4. 전략적 통찰: 사용자의 사고 과정에서 발견된 인사이트

## 응답 형식 (JSON)
{
  "strategicScore": 0-100 사이의 점수,
  "strategicRationale": "점수에 대한 상세한 설명 (2-3문장)",
  "sequenceEffectiveness": "대화 순서 선택의 효과성 평가 (2-3문장)",
  "alternativeApproaches": ["대안적 접근법 1", "대안적 접근법 2"],
  "strategicInsights": "사용자의 전략적 사고에서 발견된 통찰 (2-3문장)",
  "strengths": ["강점 1", "강점 2", "강점 3"],
  "improvements": ["개선점 1", "개선점 2", "개선점 3"]
}

${language === 'ko' ? '한국어로 친절하고 구체적으로 평가해주세요.' : 
  language === 'en' ? 'Please evaluate kindly and specifically in English.' :
  language === 'ja' ? '日本語で親切かつ具体的に評価してください。' :
  '请用中文友好且具体地进行评估。'} 격려적인 톤을 유지하되 구체적인 피드백을 제공하세요.`;

  try {
    // Gemini 모델만 지원, OpenAI/Claude 모델이 설정된 경우 기본값 사용
    const modelToUse = configuredModel.startsWith('gemini-') ? configuredModel : 'gemini-2.5-flash';
    
    const response = await genAI.models.generateContent({
      model: modelToUse,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            strategicScore: { type: "number" },
            strategicRationale: { type: "string" },
            sequenceEffectiveness: { type: "string" },
            alternativeApproaches: { type: "array", items: { type: "string" } },
            strategicInsights: { type: "string" },
            strengths: { type: "array", items: { type: "string" } },
            improvements: { type: "array", items: { type: "string" } }
          },
          required: ["strategicScore", "strategicRationale", "sequenceEffectiveness", "alternativeApproaches", "strategicInsights", "strengths", "improvements"]
        },
        maxOutputTokens: 2000,
        temperature: 0.7
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }]
    });

    const responseText = response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!responseText) {
      console.error("AI 응답이 비어있습니다.");
      return getDefaultStrategyEvaluation();
    }

    const evaluation = JSON.parse(responseText) as StrategyReflectionEvaluation;
    console.log("✅ 전략 회고 AI 평가 완료:", evaluation.strategicScore);
    
    return evaluation;
  } catch (error) {
    console.error("전략 회고 AI 평가 오류:", error);
    return getDefaultStrategyEvaluation();
  }
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