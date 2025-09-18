// Legacy file - 하위 호환성을 위해 유지됨
// 새로운 AI 서비스 사용을 위해서는 aiServiceFactory.ts를 사용하세요

import { getAIService, AIServiceFactory } from "./aiServiceFactory";
import { SCENARIO_PERSONAS, emotionEmojis } from "./aiService";
import type { ConversationMessage, DetailedFeedback } from "@shared/schema";
import type { ScenarioPersona } from "./aiService";

// 하위 호환성을 위한 기존 인터페이스 유지
export { ScenarioPersona, emotionEmojis };

// 페르소나 정보는 공통 모듈에서 가져옴
export { SCENARIO_PERSONAS } from "./aiService";

// Legacy 함수들 - AI 서비스 팩토리로 위임
export async function generateAIResponse(
  scenario: string, 
  messages: ConversationMessage[], 
  persona: ScenarioPersona,
  userMessage?: string
): Promise<{ content: string; emotion: string; emotionReason: string }> {
  // 🔄 개발 중: 코드 수정 반영을 위해 인스턴스 강제 재생성
  const aiService = AIServiceFactory.recreateInstance();
  console.log('🔄 AI 서비스 인스턴스 강제 재생성됨');
  
  return aiService.generateResponse(scenario, messages, persona, userMessage);
}

export async function generateFeedback(
  scenario: string, 
  messages: ConversationMessage[], 
  persona: ScenarioPersona
): Promise<DetailedFeedback> {
  // 🔄 개발 중: 코드 수정 반영을 위해 인스턴스 강제 재생성
  const aiService = AIServiceFactory.recreateInstance();
  console.log('🔄 피드백 생성 시 AI 서비스 인스턴스 재생성됨');
  
  return aiService.generateFeedback(scenario, messages, persona);
}