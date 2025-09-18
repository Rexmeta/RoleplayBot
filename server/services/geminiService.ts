// Legacy file - 하위 호환성을 위해 유지됨
// 새로운 AI 서비스 사용을 위해서는 aiServiceFactory.ts를 사용하세요

import { getAIService } from "./aiServiceFactory";
import { emotionEmojis } from "./aiService";
import type { ConversationMessage, DetailedFeedback } from "@shared/schema";
import type { ScenarioPersona } from "./aiService";

// 하위 호환성을 위한 기존 인터페이스 유지
export { ScenarioPersona, emotionEmojis };


// Legacy 함수들 - AI 서비스 팩토리로 위임
export async function generateAIResponse(
  scenario: string, 
  messages: ConversationMessage[], 
  persona: ScenarioPersona,
  userMessage?: string
): Promise<{ content: string; emotion: string; emotionReason: string }> {
  const aiService = getAIService();
  return aiService.generateResponse(scenario, messages, persona, userMessage);
}

export async function generateFeedback(
  scenario: string, 
  messages: ConversationMessage[], 
  persona: ScenarioPersona
): Promise<DetailedFeedback> {
  const aiService = getAIService();
  return aiService.generateFeedback(scenario, messages, persona);
}