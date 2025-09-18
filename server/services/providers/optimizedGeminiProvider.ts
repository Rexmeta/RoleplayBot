import { GoogleGenAI } from "@google/genai";
import type { ConversationMessage, DetailedFeedback } from "@shared/schema";
import type { AIServiceInterface, ScenarioPersona } from "../aiService";
import { enrichPersonaWithMBTI } from "../../utils/mbtiLoader";
import { GlobalMBTICache } from "../../utils/globalMBTICache";

/**
 * 최적화된 Gemini Provider
 * - 글로벌 MBTI 캐시 사용
 * - 병렬 처리 구현
 * - 스트리밍 응답 지원
 * - 압축된 프롬프트
 */
export class OptimizedGeminiProvider implements AIServiceInterface {
  private genAI: GoogleGenAI;
  private model: string;
  private globalCache: GlobalMBTICache;
  private enrichedPersonaCache: Map<string, ScenarioPersona> = new Map();

  constructor(apiKey: string, model: string = 'gemini-2.5-flash') {
    this.genAI = new GoogleGenAI({ apiKey });
    this.model = model;
    this.globalCache = GlobalMBTICache.getInstance();
  }

  async generateResponse(
    scenario: any, 
    messages: ConversationMessage[], 
    persona: ScenarioPersona,
    userMessage?: string
  ): Promise<{ content: string; emotion: string; emotionReason: string }> {
    console.log("🔥 Optimized Gemini API call...");
    const startTime = Date.now();
    
    try {
      // 병렬 처리: 페르소나 enrichment와 대화 히스토리 준비를 동시에
      const [enrichedPersona, conversationHistory] = await Promise.all([
        this.getEnrichedPersona(scenario, persona),
        this.prepareConversationHistory(messages, persona.name)
      ]);
      
      const enrichTime = Date.now() - startTime;
      console.log(`⚡ Parallel processing completed in ${enrichTime}ms`);

      // 압축된 시스템 프롬프트 생성
      const compactPrompt = this.buildCompactPrompt(scenario, enrichedPersona, conversationHistory);
      
      // 건너뛰기 처리
      const prompt = userMessage ? userMessage : "이전 대화의 흐름을 자연스럽게 이어가세요.";
      
      console.log(`🎭 Persona: ${enrichedPersona.name} (${(enrichedPersona as any).mbti || 'Unknown'})`);

      // Gemini API 호출 (더 빠른 설정)
      const response = await this.genAI.models.generateContent({
        model: this.model,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              content: { type: "string" },
              emotion: { type: "string" },
              emotionReason: { type: "string" }
            },
            required: ["content", "emotion", "emotionReason"]
          },
          maxOutputTokens: 150, // 토큰 수 제한으로 속도 향상
          temperature: 0.7 // 일관성 향상
        },
        contents: [
          { role: "user", parts: [{ text: compactPrompt + "\n\n사용자: " + prompt }] }
        ],
      });

      const responseData = JSON.parse(response.text || '{"content": "죄송합니다. 응답을 생성할 수 없습니다.", "emotion": "중립", "emotionReason": "시스템 오류"}');
      
      const totalTime = Date.now() - startTime;
      console.log(`✓ Optimized Gemini call completed in ${totalTime}ms`);

      return {
        content: responseData.content || "죄송합니다. 응답을 생성할 수 없습니다.",
        emotion: responseData.emotion || "중립",
        emotionReason: responseData.emotionReason || "시스템 오류로 기본 응답 제공"
      };

    } catch (error) {
      console.error("Optimized Gemini API error:", error);
      return this.getFallbackResponse(persona);
    }
  }

  /**
   * 페르소나 enrichment 최적화 (캐시 활용)
   */
  private async getEnrichedPersona(scenario: any, persona: ScenarioPersona): Promise<ScenarioPersona> {
    try {
      // 시나리오에서 페르소나 찾기
      const currentPersona = scenario.personas?.find((p: any) => p.id === persona.id || p.name === persona.name);
      const personaRef = currentPersona?.personaRef;
      
      if (!personaRef) {
        console.log(`⚠️ No personaRef found for persona: ${persona.name}`);
        return persona;
      }

      // 캐시 키 생성
      const cacheKey = `${persona.id}_${personaRef}`;
      
      // enriched persona 캐시 확인
      if (this.enrichedPersonaCache.has(cacheKey)) {
        console.log(`⚡ Using cached enriched persona: ${persona.name}`);
        return this.enrichedPersonaCache.get(cacheKey)!;
      }

      // 글로벌 MBTI 캐시에서 즉시 가져오기
      const mbtiData = this.globalCache.getMBTIPersona(personaRef);
      if (!mbtiData) {
        console.log(`⚠️ MBTI data not found in cache: ${personaRef}`);
        return persona;
      }

      console.log(`⚡ Using global cached MBTI: ${mbtiData.mbti}`);
      
      // enrichment 수행
      const enrichedPersona = await enrichPersonaWithMBTI(currentPersona, personaRef);
      
      // 캐시에 저장
      this.enrichedPersonaCache.set(cacheKey, enrichedPersona);
      console.log(`✅ Persona enriched and cached: ${enrichedPersona.name}`);
      
      return enrichedPersona;

    } catch (error) {
      console.error("Error in persona enrichment:", error);
      return persona;
    }
  }

  /**
   * 대화 히스토리 준비 (병렬 처리용)
   */
  private async prepareConversationHistory(messages: ConversationMessage[], personaName: string): Promise<string> {
    const safeMessages = messages || [];
    
    // 성능 최적화: 최근 4턴만 유지 (더 짧게)
    const recentMessages = safeMessages.slice(-4);
    
    return recentMessages.map(msg => 
      `${msg.sender === 'user' ? '사용자' : personaName}: ${msg.message}`
    ).join('\n');
  }

  /**
   * 압축된 시스템 프롬프트 생성
   */
  private buildCompactPrompt(scenario: any, persona: ScenarioPersona, conversationHistory: string): string {
    const mbti = (persona as any).mbti || 'N/A';
    const situation = scenario.context?.situation || '업무 상황';
    
    return `당신은 ${persona.name}(${persona.role})입니다.

MBTI: ${mbti}
상황: ${situation}
성격: ${persona.personality || '균형 잡힌 성격'}

${conversationHistory ? `이전 대화:\n${conversationHistory}\n` : ''}

규칙:
1. 20-80단어로 한국어 응답
2. 현실적 감정 표현
3. JSON 형식 필수

JSON 응답:
{
  "content": "대화 내용",
  "emotion": "기쁨|슬픔|분노|놀람|중립 중 하나",
  "emotionReason": "감정을 느끼는 이유"
}`;
  }

  /**
   * 스트리밍 응답 생성 (향후 구현용)
   */
  async generateStreamingResponse(
    scenario: any,
    messages: ConversationMessage[],
    persona: ScenarioPersona,
    userMessage?: string
  ): Promise<AsyncIterable<string>> {
    // 향후 스트리밍 구현을 위한 placeholder
    const response = await this.generateResponse(scenario, messages, persona, userMessage);
    
    // 현재는 단일 응답을 반환
    async function* generateStream() {
      yield JSON.stringify(response);
    }
    
    return generateStream();
  }

  async generateFeedback(
    scenario: string, 
    messages: ConversationMessage[], 
    persona: ScenarioPersona
  ): Promise<DetailedFeedback> {
    console.log("🔥 Optimized feedback generation...");
    const startTime = Date.now();

    try {
      // 압축된 피드백 프롬프트
      const feedbackPrompt = this.buildCompactFeedbackPrompt(scenario, messages, persona);

      const response = await this.genAI.models.generateContent({
        model: this.model,
        config: {
          responseMimeType: "application/json",
          maxOutputTokens: 400, // 피드백은 조금 더 길게
          temperature: 0.3 // 평가는 더 일관되게
        },
        contents: [
          { role: "user", parts: [{ text: feedbackPrompt }] }
        ],
      });

      const totalTime = Date.now() - startTime;
      console.log(`✓ Optimized feedback completed in ${totalTime}ms`);

      return this.parseFeedbackResponse(response.text || '{}');

    } catch (error) {
      console.error("Optimized feedback error:", error);
      return this.getFallbackFeedback();
    }
  }

  /**
   * 압축된 피드백 프롬프트
   */
  private buildCompactFeedbackPrompt(scenario: string, messages: ConversationMessage[], persona: ScenarioPersona): string {
    const conversation = messages.map((msg, idx) => 
      `${idx + 1}. ${msg.sender === 'user' ? '사용자' : persona.name}: ${msg.message}`
    ).join('\n');

    return `다음 대화를 분석하여 피드백을 제공하세요.

대화:
${conversation}

JSON 형식으로 응답:
{
  "overallScore": 85,
  "scores": {
    "clarityLogic": 4,
    "listeningEmpathy": 4,
    "appropriatenessAdaptability": 3,
    "persuasivenessImpact": 4,
    "strategicCommunication": 4
  },
  "strengths": ["강점1", "강점2"],
  "improvements": ["개선점1", "개선점2"],
  "nextSteps": ["다음단계1", "다음단계2"],
  "summary": "전반적으로 우수한 대화",
  "conversationDuration": 10
}`;
  }

  /**
   * 피드백 응답 파싱
   */
  private parseFeedbackResponse(responseText: string): DetailedFeedback {
    try {
      const parsed = JSON.parse(responseText);
      return {
        overallScore: parsed.overallScore || 75,
        scores: parsed.scores || this.getDefaultScores(),
        strengths: parsed.strengths || ["대화 참여"],
        improvements: parsed.improvements || ["더 구체적인 표현"],
        nextSteps: parsed.nextSteps || ["연습 지속"],
        summary: parsed.summary || "전반적으로 무난한 대화",
        conversationDuration: parsed.conversationDuration || 10
      };
    } catch (error) {
      console.error("Feedback parsing error:", error);
      return this.getFallbackFeedback();
    }
  }

  /**
   * 기본 점수
   */
  private getDefaultScores() {
    return {
      clarityLogic: 3,
      listeningEmpathy: 3,
      appropriatenessAdaptability: 3,
      persuasivenessImpact: 3,
      strategicCommunication: 3
    };
  }

  /**
   * 폴백 응답
   */
  private getFallbackResponse(persona: ScenarioPersona): { content: string; emotion: string; emotionReason: string } {
    const responses = [
      "현재 상황을 더 자세히 설명해주시겠어요?",
      "그 부분에 대해서는 좀 더 신중하게 접근해야 할 것 같습니다.",
      "말씀하신 내용을 잘 이해했습니다. 다른 관점은 어떠신가요?"
    ];
    
    return {
      content: responses[Math.floor(Math.random() * responses.length)],
      emotion: "중립",
      emotionReason: "시스템 오류로 기본 응답 제공"
    };
  }

  /**
   * 폴백 피드백
   */
  private getFallbackFeedback(): DetailedFeedback {
    return {
      overallScore: 75,
      scores: this.getDefaultScores(),
      strengths: ["대화 참여", "적극적인 자세"],
      improvements: ["더 구체적인 표현", "논리적 구조화"],
      nextSteps: ["더 많은 연습", "다양한 시나리오 경험"],
      summary: "전반적으로 무난한 대화 진행",
      conversationDuration: 10
    };
  }
}