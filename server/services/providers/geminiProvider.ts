import { GoogleGenAI } from "@google/genai";
import type { ConversationMessage, DetailedFeedback } from "@shared/schema";
import type { AIServiceInterface, ScenarioPersona } from "../aiService";
import { loadMBTIPersona, enrichPersonaWithMBTI, type MBTIPersona } from "../../utils/mbtiLoader";
import { ConversationCache } from "../ConversationCache";

export class GeminiProvider implements AIServiceInterface {
  private genAI: GoogleGenAI;
  private model: string;
  private mbtiCache: Map<string, MBTIPersona> = new Map();
  private personaCache: Map<string, ScenarioPersona> = new Map();

  constructor(apiKey: string, model: string = 'gemini-1.5-flash') {
    this.genAI = new GoogleGenAI({ apiKey });
    // ⚡ 안전한 모델 선택: 호환성 우선
    this.model = model.includes('2.5') ? 'gemini-1.5-flash' : model;
    console.log(`🤖 Using Gemini model: ${this.model}`);
  }

  async generateResponse(
    scenario: any, 
    messages: ConversationMessage[], 
    persona: ScenarioPersona,
    userMessage?: string
  ): Promise<{ content: string; emotion: string; emotionReason: string }> {
    console.log("Attempting Gemini API call...");
    
    // MBTI 데이터 캐싱 (성능 최적화)
    let enrichedPersona = persona;
    let mbtiData: MBTIPersona | null = null;
    
    try {
      
      // 시나리오에서 현재 페르소나의 personaRef 찾기
      const currentPersona = scenario.personas?.find((p: any) => p.id === persona.id || p.name === persona.name);
      const personaRef = currentPersona?.personaRef;
      
      if (personaRef) {
        // 캐시 확인 후 필요시에만 로딩
        if (!this.mbtiCache.has(personaRef)) {
          console.log(`🔍 Loading MBTI data from: ${personaRef}`);
          mbtiData = await loadMBTIPersona(personaRef);
          if (mbtiData) {
            this.mbtiCache.set(personaRef, mbtiData);
          }
        } else {
          mbtiData = this.mbtiCache.get(personaRef)!;
          console.log(`⚡ Using cached MBTI data: ${mbtiData.mbti}`);
        }
        
        if (mbtiData) {
          // 페르소나 캐싱도 추가
          const personaCacheKey = `${persona.id}_${personaRef}`;
          if (!this.personaCache.has(personaCacheKey)) {
            enrichedPersona = await enrichPersonaWithMBTI(currentPersona, personaRef);
            this.personaCache.set(personaCacheKey, enrichedPersona);
            console.log(`✅ MBTI integration successful: ${mbtiData.mbti}`);
          } else {
            enrichedPersona = this.personaCache.get(personaCacheKey)!;
            console.log(`⚡ Using cached persona: ${enrichedPersona.name}`);
          }
        }
      } else {
        console.warn(`⚠️ No personaRef found for persona: ${persona.name}`);
      }

      // messages가 undefined이거나 null인 경우 빈 배열로 처리
      const safeMessages = messages || [];
      
      // ⚡ 성능 최적화: 최근 4턴만 유지 (토큰 수 감소)
      const recentMessages = safeMessages.slice(-4);
      const conversationHistory = recentMessages.length > 0 
        ? recentMessages.map(msg => `${msg.sender === 'user' ? '👤' : '🤖'}: ${msg.message.substring(0, 50)}`).join('\n')
        : '';

      // ⚡ 개선된 프롬프트 (간단하고 명확하게)
      const systemPrompt = `당신은 ${enrichedPersona.name}(${enrichedPersona.role || '팀원'})입니다.

상황: ${scenario.context?.situation?.substring(0, 100) || '업무 상황'}
성격: ISFJ 타입으로 조용하고 신중한 성격
${conversationHistory ? `\n이전 대화:\n${conversationHistory}` : ''}

상황에 맞게 자연스럽게 대화하세요. 응답은 반드시 다음 JSON 형식으로만 하세요:
{"content": "대화 내용", "emotion": "기쁨", "emotionReason": "감정 이유"}`;

      // 건너뛰기 시 자연스럽게 대화 이어가기
      const prompt = userMessage ? userMessage : "앞서 이야기를 자연스럽게 이어가주세요";
      
      console.log(`🎭 Persona: ${enrichedPersona.name} (${mbtiData?.mbti || 'Unknown MBTI'})`);
      console.log(`📝 System Prompt: ${systemPrompt}`);
      console.log(`👤 User Prompt: ${prompt}`);

      // ⚡ 수정된 Google GenAI SDK 호출 (올바른 응답 처리)
      const result = await this.genAI.models.generateContent({
        model: this.model,
        generationConfig: {
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
          maxOutputTokens: 150,
          temperature: 0.3,
          candidateCount: 1
        },
        contents: [
          { role: "user", parts: [{ text: systemPrompt + "\n\n사용자: " + prompt }] }
        ],
      });

      // ✅ 올바른 응답 읽기 방법
      const rawResponse = result.response?.text() || "";
      console.log("🔍 Raw Gemini Response:", rawResponse);
      
      // 안전한 JSON 파싱
      let responseData;
      try {
        // JSON 코드 블록 제거 (```json ... ``` 형태)
        const cleanedResponse = rawResponse.replace(/```json\n?|\n?```/g, '').trim();
        responseData = JSON.parse(cleanedResponse);
      } catch (parseError) {
        console.error("JSON 파싱 오류:", parseError);
        console.error("원본 응답:", rawResponse);
        responseData = {
          content: "죄송합니다. 응답을 생성할 수 없습니다.",
          emotion: "중립",
          emotionReason: "JSON 파싱 오류"
        };
      }
      
      console.log("✓ Gemini API call completed");
      console.log("Generated response:", responseData);

      return {
        content: responseData.content || "죄송합니다. 응답을 생성할 수 없습니다.",
        emotion: responseData.emotion || "중립",
        emotionReason: responseData.emotionReason || "일반적인 대화 상황"
      };
    } catch (error) {
      console.error("🚨 Gemini API error:", error);
      console.error("🚨 Error details:", JSON.stringify(error, null, 2));
      const fallbackContent = this.getFallbackResponse(enrichedPersona, mbtiData);
      return { 
        content: fallbackContent, 
        emotion: "중립", 
        emotionReason: "시스템 오류로 기본 응답 제공" 
      };
    }
  }


  async generateFeedback(
    scenario: string, 
    messages: ConversationMessage[], 
    persona: ScenarioPersona,
    conversation?: any
  ): Promise<DetailedFeedback> {
    try {
      const safeMessages = messages || [];
      
      // 대화 통계 계산 (사용자 메시지만)
      const userMessages = safeMessages.filter(m => m.sender === 'user');
      const totalUserWords = userMessages.reduce((sum, msg) => sum + msg.message.length, 0);
      const averageMessageLength = userMessages.length > 0 ? Math.round(totalUserWords / userMessages.length) : 0;

      // 사용자 메시지만 추출 (평가 대상)
      const userConversationText = userMessages.map((msg, index) => 
        `사용자 발언 ${index + 1}: ${msg.message}`
      ).join('\n');

      // 전체 대화 맥락 (참고용)
      const fullConversationText = safeMessages.map(msg => 
        `${msg.sender === 'user' ? '사용자' : persona.name}: ${msg.message}`
      ).join('\n');

      const feedbackPrompt = `다음은 ${persona.name}(${persona.role})과의 대화에서 사용자의 발언만을 평가하는 것입니다.

⚠️ 중요: 사용자의 발언만을 평가하세요. AI 페르소나의 응답은 평가 대상이 아닙니다.

사용자 발언 내용 (평가 대상):
${userConversationText}

전체 대화 맥락 (참고용):
${fullConversationText}

대화 통계:
- 총 대화 턴: ${safeMessages.length}턴
- 사용자 발화 수: ${userMessages.length}회
- 평균 발화 길이: ${averageMessageLength}자
- 총 발화량: ${totalUserWords}자

평가 목표: ${persona.goals.join(', ')}

🎯 **평가 지침**: 오직 사용자의 발언만을 분석하여 다음 5가지 기준으로 1-5점(1=미흡, 2=개선필요, 3=보통, 4=좋음, 5=우수)으로 평가하세요:

1. 명확성 & 논리성 (20%): 발언의 구조화(서론-본론-결론), 메시지의 핵심 전달 여부, 불필요한 반복/모호성 최소화
2. 경청 & 공감 (20%): 상대방 발언 재진술·요약 능력, 감정 인식 및 언어적/비언어적 공감 표현, 상대방의 필요·우려를 존중하는 반응
3. 적절성 & 상황 대응 (20%): 시나리오 맥락에 맞는 표현 선택, 존칭/비공식 언어 사용의 적합성, 예상치 못한 질문·갈등 상황에 유연하게 대응
4. 설득력 & 영향력 (20%): 논리적 근거 제시, 사례/데이터/비유 활용, 상대방의 의사결정/행동 변화 유도
5. 전략적 커뮤니케이션 (20%): 목표 의식 있는 대화 전개, 갈등 회피 vs. 협상·조율 능력, 질문·피드백을 활용한 대화 주도성

**⚠️ 엄격한 평가 기준:**
- 사용자 발언이 부실하거나 부적절하면 낮은 점수를 주세요
- 발화량이 너무 적으면(평균 20자 미만) 명확성 점수 대폭 감점
- 의미 없는 짧은 답변이나 무성의한 응답은 엄격히 평가하세요
- AI의 좋은 응답은 무시하고 오직 사용자 발언의 품질만 평가하세요
- 대화 참여도가 낮거나 소극적이면 전략적 커뮤니케이션 점수 감점
- 맥락에 맞지 않는 응답이나 상황 파악 부족 시 적절성 점수 감점

**📋 추가 가이드 생성**: 이 시나리오(${persona.name} - ${persona.role})에 특화된 행동 가이드와 대화 가이드를 생성하세요.

JSON 형식으로 응답하세요:
{
  "overallScore": 전체점수(0-100),
  "scores": {
    "clarityLogic": 점수1-5,
    "listeningEmpathy": 점수1-5,
    "appropriatenessAdaptability": 점수1-5,
    "persuasivenessImpact": 점수1-5,
    "strategicCommunication": 점수1-5
  },
  "strengths": ["강점1", "강점2", "강점3"],
  "improvements": ["개선점1", "개선점2", "개선점3"],
  "nextSteps": ["다음단계1", "다음단계2", "다음단계3"],
  "summary": "종합평가요약",
  "behaviorGuides": [
    {
      "situation": "이 시나리오에서 발생할 수 있는 구체적 상황",
      "action": "해당 상황에서 취해야 할 구체적 행동",
      "example": "실제 말할 수 있는 구체적인 예시 문장",
      "impact": "이 행동으로 얻을 수 있는 긍정적 결과"
    }
  ],
  "conversationGuides": [
    {
      "scenario": "이 페르소나와의 대화에서 나타날 수 있는 상황",
      "goodExample": "효과적인 대화 방법과 예시",
      "badExample": "피해야 할 대화 방법과 예시", 
      "keyPoints": ["핵심포인트1", "핵심포인트2", "핵심포인트3"]
    }
  ]
}`;

      const result = await this.genAI.models.generateContent({
        model: "gemini-1.5-pro", // 안전한 모델 사용
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              overallScore: { type: "number" },
              scores: {
                type: "object",
                properties: {
                  clarityLogic: { type: "number" },
                  listeningEmpathy: { type: "number" },
                  appropriatenessAdaptability: { type: "number" },
                  persuasivenessImpact: { type: "number" },
                  strategicCommunication: { type: "number" }
                }
              },
              strengths: { type: "array", items: { type: "string" } },
              improvements: { type: "array", items: { type: "string" } },
              nextSteps: { type: "array", items: { type: "string" } },
              summary: { type: "string" },
              behaviorGuides: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    situation: { type: "string" },
                    action: { type: "string" },
                    example: { type: "string" },
                    impact: { type: "string" }
                  },
                  required: ["situation", "action", "example", "impact"]
                }
              },
              conversationGuides: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    scenario: { type: "string" },
                    goodExample: { type: "string" },
                    badExample: { type: "string" },
                    keyPoints: { type: "array", items: { type: "string" } }
                  },
                  required: ["scenario", "goodExample", "badExample", "keyPoints"]
                }
              }
            }
          }
        },
        contents: [{ role: "user", parts: [{ text: feedbackPrompt }] }]
      });

      // ✅ 올바른 응답 읽기 (generateFeedback)
      const rawFeedbackResponse = result.response?.text() || "";
      console.log("🔍 Raw Feedback Response:", rawFeedbackResponse);
      
      // 안전한 JSON 파싱 (피드백)
      let feedbackData;
      try {
        const cleanedResponse = rawFeedbackResponse.replace(/```json\n?|\n?```/g, '').trim();
        feedbackData = JSON.parse(cleanedResponse || '{}');
      } catch (parseError) {
        console.error("피드백 JSON 파싱 오류:", parseError);
        feedbackData = {};
      }
      
      // 사용자 발언이 없는 경우 감지 (userMessages 길이가 0이거나 모든 메시지가 공백)
      const hasUserInput = userMessages.length > 0 && userMessages.some(msg => msg.message.trim().length > 0);
      
      // 디버그 로그 추가
      console.log("사용자 발언 분석:", {
        userMessagesLength: userMessages.length,
        hasUserInput: hasUserInput,
        userMessages: userMessages.map(msg => ({ message: msg.message, length: msg.message.trim().length }))
      });
      
      // 시간 분석 (사용자 발언 여부와 상관없이 항상 계산)
      const conversationDurationSeconds = conversation?.completedAt && conversation?.createdAt 
        ? Math.floor((new Date(conversation.completedAt).getTime() - new Date(conversation.createdAt).getTime()) / 1000) 
        : 0; // 초 단위
      
      const conversationDuration = Math.floor(conversationDurationSeconds / 60); // 분 단위 (기존 로직 호환성)

      // 간단한 시간 평가 (인라인)
      const timePerformance = !hasUserInput || userMessages.length === 0 || totalUserWords === 0 
        ? { rating: 'slow' as const, feedback: '대화 참여 없음 - 시간 평가 불가' }
        : { rating: 'average' as const, feedback: `대화 참여함 (${totalUserWords}자, ${userMessages.length}회 발언)` };

      // 사용자 발언이 없으면 AI 응답 무시하고 모든 점수를 1점으로 강제 설정
      if (!hasUserInput) {
        console.log("사용자 발언 없음 - 모든 점수 1점으로 강제 설정");
        return {
          overallScore: 20, // 5개 카테고리 각각 1점씩 = 20점
          scores: {
            clarityLogic: 1,
            listeningEmpathy: 1,
            appropriatenessAdaptability: 1,
            persuasivenessImpact: 1,
            strategicCommunication: 1
          },
          strengths: ["평가할 사용자의 발언이 없습니다."],
          improvements: ["더 구체적인 표현", "감정 교감 증진", "논리적 구조화"],
          nextSteps: ["추가 연습 필요", "전문가 피드백 받기", "실무 경험 쌓기"],
          summary: "사용자의 발언이 없어 커뮤니케이션 역량을 평가할 수 없습니다. 대화에 전혀 참여하지 않았기 때문에 모든 평가 항목에서 최하점을 부여했습니다. 목표 달성을 위해서는 먼저 대화에 참여하여 자신의 의견을 표현하는 것이 필요합니다.",
          ranking: "전문가 분석 결과를 바탕으로 한 종합 평가입니다.",
          behaviorGuides: this.generateBehaviorGuides(persona),
          conversationGuides: this.generateConversationGuides(persona),
          developmentPlan: this.generateDevelopmentPlan(20),
          conversationDuration: conversationDuration * 60, // 초 단위로 저장
          averageResponseTime: Infinity,
          timePerformance: timePerformance
        };
      }
      
      // 정상적인 사용자 발언이 있는 경우의 평가
      const defaultScore = 3;
      const calculatedOverallScore = feedbackData.overallScore || 0;
      
      return {
        overallScore: Math.min(100, Math.max(0, calculatedOverallScore)),
        scores: {
          clarityLogic: Math.min(5, Math.max(1, feedbackData.scores?.clarityLogic || defaultScore)),
          listeningEmpathy: Math.min(5, Math.max(1, feedbackData.scores?.listeningEmpathy || defaultScore)),
          appropriatenessAdaptability: Math.min(5, Math.max(1, feedbackData.scores?.appropriatenessAdaptability || defaultScore)),
          persuasivenessImpact: Math.min(5, Math.max(1, feedbackData.scores?.persuasivenessImpact || defaultScore)),
          strategicCommunication: Math.min(5, Math.max(1, feedbackData.scores?.strategicCommunication || defaultScore))
        },
        strengths: feedbackData.strengths || ["기본적인 대화 능력", "적절한 언어 사용", "상황 이해도"],
        improvements: feedbackData.improvements || ["더 구체적인 표현", "감정 교감 증진", "논리적 구조화"],
        nextSteps: feedbackData.nextSteps || ["추가 연습 필요", "전문가 피드백 받기", "실무 경험 쌓기"],
        summary: feedbackData.summary || "전반적으로 무난한 대화였습니다. 지속적인 연습을 통해 발전할 수 있습니다.",
        ranking: "전문가 분석 결과를 바탕으로 한 종합 평가입니다.",
        behaviorGuides: feedbackData.behaviorGuides || this.generateBehaviorGuides(persona),
        conversationGuides: feedbackData.conversationGuides || this.generateConversationGuides(persona),
        developmentPlan: this.generateDevelopmentPlan(feedbackData.overallScore || 60),
        conversationDuration: conversationDuration,
        averageResponseTime: userMessages.length > 0 ? Math.round(conversationDuration * 60 / userMessages.length) : 0,
        timePerformance: timePerformance
      };
    } catch (error) {
      console.error("Feedback generation error:", error);
      console.error("Error details:", error instanceof Error ? error.message : String(error));
      
      // 사용자 발언이 없는 경우 최하점 반환  
      const safeMessages = messages || [];
      const userMessagesInCatch = safeMessages.filter(m => m.sender === 'user');
      const hasUserInput = userMessagesInCatch.length > 0 && userMessagesInCatch.some((msg: any) => msg.message.trim().length > 0);
      console.log("Fallback - 사용자 발언 있음:", hasUserInput);
      
      // 시간 분석 (사용자 발언 여부와 상관없이 항상 계산)
      const conversationDuration = conversation?.completedAt && conversation?.createdAt 
        ? Math.floor((new Date(conversation.completedAt).getTime() - new Date(conversation.createdAt).getTime()) / 1000 / 60) 
        : 0;

      // 간단한 시간 평가 (인라인)
      const timePerformance = { rating: 'slow' as const, feedback: '대화 참여 없음 - 시간 평가 불가' };

      if (!hasUserInput) {
        return {
          overallScore: 20,
          scores: {
            clarityLogic: 1,
            listeningEmpathy: 1,
            appropriatenessAdaptability: 1,
            persuasivenessImpact: 1,
            strategicCommunication: 1
          },
          strengths: ["평가할 사용자의 발언이 없습니다."],
          improvements: ["더 구체적인 표현", "감정 교감 증진", "논리적 구조화"],
          nextSteps: ["추가 연습 필요", "전문가 피드백 받기", "실무 경험 쌓기"],
          summary: "사용자의 발언이 없어 커뮤니케이션 역량을 평가할 수 없습니다. 대화에 전혀 참여하지 않았기 때문에 모든 평가 항목에서 최하점을 부여했습니다.",
          ranking: "전문가 분석 결과를 바탕으로 한 종합 평가입니다.",
          behaviorGuides: this.generateBehaviorGuides(persona),
          conversationGuides: this.generateConversationGuides(persona),
          developmentPlan: this.generateDevelopmentPlan(20),
          conversationDuration: conversationDuration * 60, // 초 단위로 저장
          averageResponseTime: Infinity,
          timePerformance: timePerformance
        };
      }
      
      return this.getFallbackFeedback();
    }
  }


  private getFallbackResponse(persona: any, mbtiData?: MBTIPersona | null): string {
    // MBTI 스타일에 맞는 개성화된 fallback 응답
    if (mbtiData) {
      const mbtiType = mbtiData.mbti;
      const keyPhrase = mbtiData.communication_patterns?.key_phrases?.[0] || "솔직히 말하면";
      const tone = mbtiData.voice?.tone || "차분한";
      
      // MBTI 유형별 맞춤형 fallback 메시지
      const mbtiResponses = {
        'ISTJ': `${keyPhrase}, 현재 시스템에 기술적 문제가 발생했습니다. 정확한 진단 후 다시 시도해주시기 바랍니다.`,
        'ENTJ': `${keyPhrase}, 시스템 오류로 인해 지금 당장 효율적인 대화가 어렵습니다. 빠른 복구 후 진행하겠습니다.`,
        'ENFJ': `정말 죄송합니다. 시스템 문제로 지금 제대로 소통하기 어려운 상황이에요. 조금만 기다려주실 수 있을까요?`,
        'INFP': `아... 미안해요. 지금 시스템이 잘 안 되고 있어서... 잠시 후에 다시 이야기해요.`,
        'INTP': `흥미롭네요. 시스템 오류 현상이 발생했습니다. 원인 분석 후 다시 접속해보시기 바랍니다.`,
        'ESFJ': `어머, 정말 죄송해요! 지금 시스템에 문제가 있어서 제대로 도움을 드리지 못하고 있어요. 곧 해결될 거예요.`,
        'ESTP': `아, 시스템이 먹통이네요! 빨리 고쳐서 다시 대화해봐요.`,
        'ISFP': `죄송해요... 지금 시스템 상태가 좋지 않아서... 잠시만 기다려주세요.`
      };
      
      if (mbtiResponses[mbtiType as keyof typeof mbtiResponses]) {
        return mbtiResponses[mbtiType as keyof typeof mbtiResponses];
      }
    }
    
    // 기본 fallback (persona.id 기반)
    const fallbacks = {
      istj: `솔직히 말씀드리면, 현재 시스템에 기술적 문제가 발생했습니다. 정확한 진단 후 다시 시도해주시기 바랍니다.`,
      entj: `직접적으로 말하면, 시스템 오류로 인해 지금 당장 효율적인 대화가 어렵습니다. 빠른 복구 후 진행하겠습니다.`,
      enfj: `정말 죄송합니다. 시스템 문제로 지금 제대로 소통하기 어려운 상황이에요. 조금만 기다려주실 수 있을까요?`,
      communication: `안녕하세요. ${persona.name}입니다. 현재 시스템에 문제가 있어 정상적인 응답이 어렵습니다. 잠시 후 다시 시도해주세요.`,
      empathy: "죄송해요... 지금 시스템 상태가 좋지 않아서 제대로 대화하기 어려울 것 같아요. 조금 기다려주실 수 있을까요?",
      negotiation: "시스템 연결에 문제가 있습니다. 중요한 협상이니만큼 안정적인 환경에서 다시 진행하는 것이 좋겠습니다.",
      presentation: "기술적인 문제로 인해 현재 정상적인 응답이 어렵습니다. 시스템 복구 후 다시 시도해주세요.",
      feedback: "아... 죄송합니다. 시스템 오류로 제대로 응답드리기 어려운 상황입니다. 잠시 후 다시 말씀해주세요.",
      crisis: "긴급 상황인데 시스템에 문제가 발생했습니다. 빠른 복구를 위해 기술팀에 연락하겠습니다."
    };
    
    return fallbacks[persona.id as keyof typeof fallbacks] || `${persona.name}입니다. 시스템 오류가 발생했습니다. 잠시 후 다시 시도해주세요.`;
  }

  private getFallbackFeedback(): DetailedFeedback {
    return {
      overallScore: 20,
      scores: {
        clarityLogic: 1,
        listeningEmpathy: 1,
        appropriatenessAdaptability: 1,
        persuasivenessImpact: 1,
        strategicCommunication: 1
      },
      strengths: ["평가할 사용자의 발언이 없습니다."],
      improvements: ["더 구체적인 표현", "감정 교감 증진", "논리적 구조화"],
      nextSteps: ["추가 연습 필요", "전문가 피드백 받기", "실무 경험 쌓기"],
      summary: "사용자의 발언이 없어 커뮤니케이션 역량을 평가할 수 없습니다. 대화에 전혀 참여하지 않았기 때문에 모든 평가 항목에서 최하점을 부여했습니다.",
      ranking: "전문가 분석 결과를 바탕으로 한 종합 평가입니다.",
      behaviorGuides: [],
      conversationGuides: [],
      developmentPlan: {
        shortTerm: [],
        mediumTerm: [],
        longTerm: [],
        recommendedResources: []
      },
      conversationDuration: 0,
      averageResponseTime: Infinity,
      timePerformance: { rating: 'slow', feedback: '대화 참여 없음 - 시간 평가 불가' }
    };
  }

  private generateBehaviorGuides(persona: ScenarioPersona) {
    const guides = {
      communication: [{
        situation: "기술적 문제 발생 시 대응",
        action: "문제 상황을 명확히 파악하고 체계적으로 접근하세요",
        example: "먼저 정확한 증상을 확인하고, 가능한 원인들을 단계별로 점검해보겠습니다",
        impact: "문제 해결 시간 단축 및 협력 관계 강화"
      }],
      empathy: [{
        situation: "상대방이 힘들어할 때",
        action: "감정을 인정하고 공감하는 메시지 전달",
        example: "정말 힘드셨겠어요. 그런 상황에서는 누구나 그렇게 느낄 수 있어요",
        impact: "신뢰 관계 구축 및 심리적 안정감 제공"
      }]
    };
    return guides[persona.id as keyof typeof guides] || [];
  }

  private generateConversationGuides(persona: ScenarioPersona) {
    const guides = {
      communication: [{
        scenario: "기술 협의 상황",
        goodExample: "구체적인 데이터와 근거를 바탕으로 논리적으로 설명",
        badExample: "막연한 추측이나 감정적 반응으로 대응",
        keyPoints: ["사실 기반 소통", "단계별 접근", "상호 이해 확인"]
      }],
      empathy: [{
        scenario: "감정적 지원 상황",
        goodExample: "상대방의 감정을 인정하고 공감하는 반응",
        badExample: "감정을 무시하거나 성급한 해결책 제시",
        keyPoints: ["경청하기", "감정 인정", "지지 표현"]
      }]
    };
    return guides[persona.id as keyof typeof guides] || [];
  }

  private generateDevelopmentPlan(score: number) {
    return {
      shortTerm: [{
        goal: "기본 커뮤니케이션 스킬 향상",
        actions: ["일일 대화 연습", "피드백 받기", "자기 성찰 시간 갖기"],
        measurable: "주 3회 이상 연습, 피드백 점수 10% 향상"
      }],
      mediumTerm: [{
        goal: "상황별 대응 능력 개발",
        actions: ["다양한 시나리오 연습", "전문가 조언 구하기", "실전 경험 쌓기"],
        measurable: "월 2회 이상 새로운 시나리오 도전, 성공률 70% 이상"
      }],
      longTerm: [{
        goal: "전문적 커뮤니케이션 역량 구축",
        actions: ["심화 교육 과정 수강", "멘토링 참여", "리더십 역할 수행"],
        measurable: "6개월 내 고급 과정 수료, 팀 내 커뮤니케이션 담당 역할"
      }],
      recommendedResources: [
        "효과적인 커뮤니케이션 기법 도서",
        "온라인 커뮤니케이션 강의",
        "전문가 멘토링 프로그램",
        "실전 시나리오 연습 플랫폼"
      ]
    };
  }
}