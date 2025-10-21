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
    persona: ScenarioPersona,
    conversation?: Partial<import("@shared/schema").Conversation>
  ): Promise<DetailedFeedback> {
    console.log("🔥 Optimized feedback generation...");
    const startTime = Date.now();

    try {
      // 압축된 피드백 프롬프트
      const feedbackPrompt = this.buildCompactFeedbackPrompt(scenario, messages, persona, conversation);

      const response = await this.genAI.models.generateContent({
        model: this.model,
        config: {
          responseMimeType: "application/json",
          maxOutputTokens: 4096,
          temperature: 0.3
        },
        contents: [
          { role: "user", parts: [{ text: feedbackPrompt }] }
        ],
      });

      const totalTime = Date.now() - startTime;
      console.log(`✓ Optimized feedback completed in ${totalTime}ms`);

      const responseText = this.extractResponseText(response);
      console.log("📝 Feedback response (first 500 chars):", responseText.substring(0, 500));
      
      return this.parseFeedbackResponse(responseText, conversation);

    } catch (error) {
      console.error("Optimized feedback error:", error);
      return this.getFallbackFeedback();
    }
  }

  /**
   * 상세 피드백 프롬프트 (행동가이드, 대화가이드, 개발계획 포함)
   */
  private buildCompactFeedbackPrompt(scenario: string, messages: ConversationMessage[], persona: ScenarioPersona, conversation?: Partial<import("@shared/schema").Conversation>): string {
    const conversationText = messages.map((msg, idx) => 
      `${idx + 1}. ${msg.sender === 'user' ? '사용자' : persona.name}: ${msg.message}`
    ).join('\n');

    // 전략 회고가 있는 경우 추가 평가 수행
    const hasStrategyReflection = conversation?.strategyReflection && conversation?.conversationOrder;
    
    let strategySection = '';
    if (hasStrategyReflection && conversation.conversationOrder) {
      strategySection = `

전략적 선택 분석:
사용자가 선택한 대화 순서: ${conversation.conversationOrder.join(' → ')}
사용자의 전략 회고: "${conversation.strategyReflection}"

이 전략 선택을 다음 기준으로 평가하세요:
1. 전략적 논리성 (1-5점): 순서 선택이 논리적이고 목표 달성에 효과적인가?
2. 전략적 효과성 (1-5점): 이 순서가 실제로 좋은 결과를 가져올 가능성이 높은가?
3. 전략적 통찰력 (1-5점): 사용자가 전략적 사고를 잘 보여주는가?

sequenceAnalysis 필드에 다음 형식으로 포함:
{
  "strategicScore": 85,
  "strategicRationale": "전략 점수 이유",
  "sequenceEffectiveness": "순서 선택의 효과성 평가",
  "alternativeApproaches": ["대안적 접근법1", "대안적 접근법2"],
  "strategicInsights": "전략적 통찰"
}`;
    }

    return `업무 대화 분석:

${conversationText}
${strategySection}

5개 영역 평가(1-5점): 명확성&논리성, 경청&공감, 적절성&상황대응, 설득력&영향력, 전략적커뮤니케이션

JSON 응답${hasStrategyReflection ? ' (sequenceAnalysis 포함)' : ''}:
{
  "overallScore": 85,
  "scores": {"clarityLogic": 4, "listeningEmpathy": 4, "appropriatenessAdaptability": 3, "persuasivenessImpact": 4, "strategicCommunication": 4},
  "strengths": ["강점1", "강점2", "강점3"],
  "improvements": ["개선점1", "개선점2", "개선점3"],
  "nextSteps": ["다음단계1", "다음단계2", "다음단계3"],
  "summary": "종합평가",
  "conversationDuration": 10,
  "behaviorGuides": [
    {"situation": "상황설명", "action": "행동가이드", "example": "예시", "impact": "효과"},
    {"situation": "다른상황", "action": "다른행동", "example": "다른예시", "impact": "다른효과"}
  ],
  "conversationGuides": [
    {"scenario": "시나리오", "goodExample": "좋은예시", "badExample": "나쁜예시", "keyPoints": ["포인트1", "포인트2", "포인트3"]}
  ],
  "developmentPlan": {
    "shortTerm": [{"goal": "단기목표", "actions": ["행동1", "행동2"], "measurable": "지표"}],
    "mediumTerm": [{"goal": "중기목표", "actions": ["행동1", "행동2"], "measurable": "지표"}],
    "longTerm": [{"goal": "장기목표", "actions": ["행동1", "행동2"], "measurable": "지표"}],
    "recommendedResources": ["자료1", "자료2", "자료3"]
  }${hasStrategyReflection ? `,
  "sequenceAnalysis": {
    "strategicScore": 85,
    "strategicRationale": "전략 점수 이유",
    "sequenceEffectiveness": "순서 선택 효과성",
    "alternativeApproaches": ["대안1", "대안2"],
    "strategicInsights": "전략적 통찰"
  }` : ''}
}`;
  }

  /**
   * 피드백 응답 파싱
   */
  private parseFeedbackResponse(responseText: string, conversation?: Partial<import("@shared/schema").Conversation>): DetailedFeedback {
    try {
      // 빈 응답이나 JSON이 아닌 응답 처리
      if (!responseText || responseText.trim() === '' || responseText === '{}') {
        console.error("Empty or invalid response text received");
        return this.getFallbackFeedback();
      }
      
      // JSON 파싱 시도
      let parsed;
      try {
        parsed = JSON.parse(responseText);
      } catch (parseError) {
        console.error("JSON parse failed, response text:", responseText.substring(0, 1000));
        console.error("Parse error:", parseError);
        
        // 불완전한 JSON을 복구 시도
        try {
          // 잘린 JSON을 감지하고 닫기 시도
          let fixedText = responseText.trim();
          
          // 배열이나 객체가 닫히지 않은 경우 닫기
          const openBraces = (fixedText.match(/{/g) || []).length;
          const closeBraces = (fixedText.match(/}/g) || []).length;
          
          if (openBraces > closeBraces) {
            fixedText += '}'.repeat(openBraces - closeBraces);
            console.log("Attempting to fix incomplete JSON...");
            parsed = JSON.parse(fixedText);
            console.log("✓ JSON fixed successfully");
          } else {
            throw parseError;
          }
        } catch (fixError) {
          return this.getFallbackFeedback();
        }
      }
      
      const feedback: DetailedFeedback = {
        overallScore: parsed.overallScore || 75,
        scores: parsed.scores || this.getDefaultScores(),
        strengths: parsed.strengths || ["대화 참여"],
        improvements: parsed.improvements || ["더 구체적인 표현"],
        nextSteps: parsed.nextSteps || ["연습 지속"],
        summary: parsed.summary || "전반적으로 무난한 대화",
        conversationDuration: parsed.conversationDuration || 10,
        behaviorGuides: parsed.behaviorGuides || this.getDefaultBehaviorGuides(),
        conversationGuides: parsed.conversationGuides || this.getDefaultConversationGuides(),
        developmentPlan: parsed.developmentPlan || this.getDefaultDevelopmentPlan()
      };
      
      // 전략 분석이 있는 경우 추가
      if (parsed.sequenceAnalysis && conversation?.strategyReflection) {
        feedback.sequenceAnalysis = parsed.sequenceAnalysis;
      }
      
      return feedback;
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
   * 기본 행동가이드
   */
  private getDefaultBehaviorGuides() {
    return [
      {
        situation: "회의나 대화에서 의견 제시 시",
        action: "논리적 근거와 함께 구체적인 사례를 들어 설명하기",
        example: "'이 방법을 제안하는 이유는 A, B, C입니다. 지난번 유사한 프로젝트에서...'",
        impact: "설득력 있는 커뮤니케이션으로 동의 확보"
      },
      {
        situation: "갈등 상황이나 의견 차이 발생 시",
        action: "상대방의 관점을 먼저 인정하고 공통점 찾기",
        example: "'말씀하신 우려사항을 이해합니다. 우리 모두 품질을 중요시한다는 점에서는 동의하시죠?'",
        impact: "갈등 완화와 협력적 분위기 조성"
      }
    ];
  }

  /**
   * 기본 대화가이드
   */
  private getDefaultConversationGuides() {
    return [
      {
        scenario: "업무 협의 및 의사결정 상황",
        goodExample: "체계적인 논거 제시 → 상대방 의견 청취 → 공통점 확인 → 구체적 해결책 제안",
        badExample: "일방적 주장 → 상대방 의견 무시 → 감정적 대응 → 모호한 결론",
        keyPoints: ["논리적 구조화", "적극적 경청", "공감적 소통", "구체적 제안"]
      }
    ];
  }

  /**
   * 기본 개발계획
   */
  private getDefaultDevelopmentPlan() {
    return {
      shortTerm: [
        {
          goal: "일상 대화에서 논리적 표현 연습",
          actions: ["의견 제시 시 3가지 근거 준비하기", "상대방 말을 요약해서 재확인하기"],
          measurable: "회의에서 발언 빈도 2배 증가"
        }
      ],
      mediumTerm: [
        {
          goal: "갈등 상황에서의 중재 능력 향상",
          actions: ["다양한 관점 이해하기 연습", "감정적 반응 대신 논리적 대응 훈련"],
          measurable: "갈등 해결 성공률 70% 이상"
        }
      ],
      longTerm: [
        {
          goal: "전략적 커뮤니케이션 리더십 개발",
          actions: ["팀 프레젠테이션 기회 확대", "외부 이해관계자와의 협상 경험 쌓기"],
          measurable: "팀 내 커뮤니케이션 만족도 80% 이상"
        }
      ],
      recommendedResources: ["비즈니스 커뮤니케이션 서적", "협상 기법 온라인 강의", "프레젠테이션 스킬 워크샵"]
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
      conversationDuration: 10,
      behaviorGuides: this.getDefaultBehaviorGuides(),
      conversationGuides: this.getDefaultConversationGuides(),
      developmentPlan: this.getDefaultDevelopmentPlan()
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
        
        // finishReason이 MAX_TOKENS인 경우에도 부분 응답 추출 시도
        if (candidate.finishReason === 'MAX_TOKENS') {
          console.warn("Response truncated due to MAX_TOKENS, but attempting to use partial response");
          
          // 부분 응답이라도 추출 시도
          if (candidate.content?.parts?.[0]?.text) {
            const partialText = candidate.content.parts[0].text;
            console.log("Extracted partial response:", partialText.substring(0, 100) + "...");
            return partialText;
          }
          
          if (typeof candidate.content === 'string') {
            console.log("Extracted partial string content");
            return candidate.content;
          }
        }
        
        // 정상적인 경우 parts 배열이 있는 경우
        if (candidate.content?.parts?.[0]?.text) {
          return candidate.content.parts[0].text;
        }
        
        // parts가 없고 content가 string인 경우  
        if (typeof candidate.content === 'string') {
          return candidate.content;
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