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

      // Gemini API 호출 (정확한 SDK 방식)
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
          maxOutputTokens: 1500,
          temperature: 0.7
        },
        contents: [
          { role: "user", parts: [{ text: compactPrompt + "\n\n사용자: " + prompt }] }
        ],
      });

      const responseText = this.extractResponseText(response);
      const responseData = JSON.parse(responseText || '{"content": "죄송합니다. 응답을 생성할 수 없습니다.", "emotion": "중립", "emotionReason": "시스템 오류"}');
      
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

      // 시나리오별 독립적인 캐시 키 생성
      const scenarioId = scenario.id || 'default';
      const cacheKey = `${scenarioId}_${persona.id}_${personaRef}`;
      
      // enriched persona 캐시 확인
      if (this.enrichedPersonaCache.has(cacheKey)) {
        console.log(`⚡ Using cached enriched persona: ${persona.name} (scenario: ${scenarioId})`);
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
      
      // 시나리오별로 캐시에 저장
      this.enrichedPersonaCache.set(cacheKey, enrichedPersona);
      console.log(`✅ Persona enriched and cached: ${enrichedPersona.name} (scenario: ${scenarioId})`);
      
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
    
    // 성능 최적화: 최근 3턴만 유지 (맥락 유지를 위해)
    const recentMessages = safeMessages.slice(-3);
    
    return recentMessages.map(msg => 
      `${msg.sender === 'user' ? '사용자' : personaName}: ${msg.message.slice(0, 80)}${msg.message.length > 80 ? '...' : ''}`
    ).join('\n');
  }

  /**
   * 압축된 시스템 프롬프트 생성
   */
  private buildCompactPrompt(scenario: any, persona: ScenarioPersona, conversationHistory: string): string {
    const situation = scenario.context?.situation || '업무 상황';
    const objectives = scenario.objectives?.join(', ') || '문제 해결';
    const mbtiData = (persona as any).mbti ? this.globalCache.getMBTIPersona((persona as any).mbti.toLowerCase()) : null;
    
    // 페르소나의 입장과 목표
    const stance = (persona as any).stance || '신중한 접근';
    const goal = (persona as any).goal || '최적의 결과 도출';
    
    return `당신은 ${persona.name}(${persona.role})입니다.

상황: ${situation}
목표: ${objectives}
당신의 입장: ${stance}
당신의 목표: ${goal}

${conversationHistory ? `이전 대화:\n${conversationHistory}\n` : ''}

역할:
- ${persona.name}의 관점에서 반대 의견이나 어려운 질문을 제기하세요
- 상대방이 쉽게 동의할 수 없는 도전적인 입장을 취하세요
- ${mbtiData?.communication_style || '균형 잡힌 의사소통'} 스타일로 대화하세요
- 30-120단어로 현실적이고 구체적으로 응답하세요

JSON 형식으로 응답:
{"content":"대화내용","emotion":"기쁨|슬픔|분노|놀람|중립","emotionReason":"감정이유"}`;
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
          maxOutputTokens: 2000,
          temperature: 0.3
        },
        contents: [
          { role: "user", parts: [{ text: feedbackPrompt }] }
        ],
      });

      const totalTime = Date.now() - startTime;
      console.log(`✓ Optimized feedback completed in ${totalTime}ms`);

      return this.parseFeedbackResponse(this.extractResponseText(response));

    } catch (error) {
      console.error("Optimized feedback error:", error);
      return this.getFallbackFeedback();
    }
  }

  /**
   * 상세 피드백 프롬프트 (행동가이드, 대화가이드, 개발계획 포함)
   */
  private buildCompactFeedbackPrompt(scenario: string, messages: ConversationMessage[], persona: ScenarioPersona): string {
    const conversation = messages.map((msg, idx) => 
      `${idx + 1}. ${msg.sender === 'user' ? '사용자' : persona.name}: ${msg.message}`
    ).join('\n');

    return `다음 직장 내 커뮤니케이션 대화를 전문적으로 분석하여 종합적인 피드백을 제공하세요.

시나리오 배경: ${scenario}
대화 상대: ${persona.name} (${persona.role})

대화 내용:
${conversation}

다음 5개 영역을 1-5점으로 평가하고 상세한 분석을 제공하세요:
1. 명확성 & 논리성: 발언 구조화, 핵심 전달, 모호성 최소화
2. 경청 & 공감: 재진술·요약, 감정 인식, 우려 존중
3. 적절성 & 상황 대응: 맥락 적합한 표현, 유연한 갈등 대응
4. 설득력 & 영향력: 논리적 근거, 사례 활용, 행동 변화 유도
5. 전략적 커뮤니케이션: 목표 지향적 대화, 협상·조율, 주도성

JSON 형식으로 응답 (모든 필드 필수):
{
  "overallScore": 85,
  "scores": {
    "clarityLogic": 4,
    "listeningEmpathy": 4,
    "appropriatenessAdaptability": 3,
    "persuasivenessImpact": 4,
    "strategicCommunication": 4
  },
  "strengths": ["구체적인 강점1", "구체적인 강점2", "구체적인 강점3"],
  "improvements": ["구체적인 개선점1", "구체적인 개선점2", "구체적인 개선점3"],
  "nextSteps": ["실행가능한 다음단계1", "실행가능한 다음단계2", "실행가능한 다음단계3"],
  "summary": "대화의 핵심 성과와 개선방향을 포함한 종합평가",
  "conversationDuration": 10,
  "behaviorGuides": [
    {
      "situation": "비슷한 상황 설명",
      "action": "구체적인 행동 가이드",
      "example": "실제 적용 예시",
      "impact": "기대 효과"
    },
    {
      "situation": "다른 상황 설명",
      "action": "다른 행동 가이드",
      "example": "다른 적용 예시",
      "impact": "다른 기대 효과"
    }
  ],
  "conversationGuides": [
    {
      "scenario": "유사한 시나리오",
      "goodExample": "바람직한 대화 예시",
      "badExample": "피해야 할 대화 예시",
      "keyPoints": ["핵심 포인트1", "핵심 포인트2", "핵심 포인트3"]
    }
  ],
  "developmentPlan": {
    "shortTerm": [
      {
        "goal": "1-2주 내 달성할 목표",
        "actions": ["구체적 행동1", "구체적 행동2"],
        "measurable": "측정 가능한 성과 지표"
      }
    ],
    "mediumTerm": [
      {
        "goal": "1-2개월 내 달성할 목표",
        "actions": ["구체적 행동1", "구체적 행동2"],
        "measurable": "측정 가능한 성과 지표"
      }
    ],
    "longTerm": [
      {
        "goal": "3-6개월 내 달성할 목표",
        "actions": ["구체적 행동1", "구체적 행동2"],
        "measurable": "측정 가능한 성과 지표"
      }
    ],
    "recommendedResources": ["추천 자료1", "추천 자료2", "추천 자료3"]
  }
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

  /**
   * Google Generative AI SDK 응답에서 텍스트 추출
   */
  private extractResponseText(response: any): string {
    try {
      // Google Generative AI 새로운 SDK 구조 지원
      if (response.response?.text) {
        return typeof response.response.text === 'function' ? response.response.text() : response.response.text;
      }
      
      // 새로운 SDK에서 .text() 메서드 지원
      if (response.text && typeof response.text === 'function') {
        return response.text();
      }
      
      // 직접 텍스트 속성
      if (response.text && typeof response.text === 'string') {
        return response.text;
      }

      // response.response.text() 시도
      if (response.response && typeof response.response.text === 'function') {
        return response.response.text();
      }
      
      // candidates 구조 확인
      if (response.candidates?.[0]) {
        const candidate = response.candidates[0];
        
        // parts 배열이 있는 경우
        if (candidate.content?.parts?.[0]?.text) {
          return candidate.content.parts[0].text;
        }
        
        // parts가 없고 content가 string인 경우  
        if (typeof candidate.content === 'string') {
          return candidate.content;
        }
        
        // finishReason이 MAX_TOKENS인 경우에도 일단 응답을 시도
        if (candidate.finishReason === 'MAX_TOKENS') {
          console.warn("Response truncated due to MAX_TOKENS, but attempting to use partial response");
          // 빈 응답이 아니면 부분 응답이라도 사용 시도
        }
      }
      
      // 응답이 없으면 기본 JSON 반환
      console.warn("No valid response found, using fallback");
      return '{"content": "죄송합니다. 잠시 생각할 시간을 주세요.", "emotion": "중립", "emotionReason": "시스템 처리 중"}';
    } catch (error) {
      console.error("Error extracting response text:", error);
      return '{}';
    }
  }
}