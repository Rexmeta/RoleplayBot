import { GoogleGenAI } from "@google/genai";
import type { ConversationMessage, DetailedFeedback } from "@shared/schema";
import type { AIServiceInterface, ScenarioPersona } from "../aiService";

export class GeminiProvider implements AIServiceInterface {
  private genAI: GoogleGenAI;
  private model: string;

  constructor(apiKey: string, model: string = 'gemini-2.5-flash') {
    this.genAI = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async generateResponse(
    scenario: any, 
    messages: ConversationMessage[], 
    persona: ScenarioPersona,
    userMessage?: string
  ): Promise<{ content: string; emotion: string; emotionReason: string }> {
    console.log("Attempting Gemini API call...");
    
    try {
      // messages가 undefined이거나 null인 경우 빈 배열로 처리
      const safeMessages = messages || [];
      const conversationHistory = safeMessages.map(msg => 
        `${msg.sender === 'user' ? '사용자' : persona.name}: ${msg.message}`
      ).join('\n');

      const systemPrompt = `당신은 ${persona.name}(${persona.role}, ${persona.department})입니다.

=== 시나리오 배경 ===
상황: ${scenario.context?.situation || '일반적인 업무 상황'}
시간적 제약: ${scenario.context?.timeline || '특별한 시간 제약 없음'}
핵심 이슈: ${scenario.context?.stakes || '의사결정이 필요한 상황'}
목표: ${scenario.objectives ? scenario.objectives.join(', ') : '문제 해결'}

사용자 역할: ${scenario.context?.playerRole ? 
  `${scenario.context.playerRole.position} (${scenario.context.playerRole.department}, ${scenario.context.playerRole.experience}) - ${scenario.context.playerRole.responsibility}` 
  : '신입 직원'}

=== 당신의 페르소나 특성 ===
MBTI 유형: ${(persona as any).mbti || 'MBTI 유형 미지정'}

성격 특성:
- 핵심 특성: ${(persona.personality as any)?.traits ? (persona.personality as any).traits.join(', ') : '기본 특성'}
- 의사소통 스타일: ${(persona.personality as any)?.communicationStyle || '균형 잡힌 의사소통'}
- 동기와 목표: ${(persona.personality as any)?.motivation || '문제 해결'}
- 주요 우려사항: ${(persona.personality as any)?.fears ? (persona.personality as any).fears.join(', ') : '없음'}

현재 상황에서의 당신의 입장:
- 기본 입장: ${(persona as any).stance || '상황에 따른 대응'}
- 달성하고자 하는 목표: ${(persona as any).goal || '최적의 결과 도출'}
- 트레이드오프 관점: ${(persona as any).tradeoff || '균형 잡힌 접근'}

의사소통 패턴:
- 대화 시작 방식: ${(persona as any).communicationPatterns?.openingStyle || '상황에 맞는 방식'}
- 자주 사용하는 표현: ${(persona as any).communicationPatterns?.keyPhrases ? (persona as any).communicationPatterns.keyPhrases.join(' / ') : '자연스러운 표현'}

대화 규칙:
1. MBTI 특성과 페르소나 설정을 정확히 구현하세요
2. 현재 상황에서의 입장과 목표를 명확히 표현하세요
3. 자연스럽고 현실적인 대화를 유지하세요
4. 한국어로 응답하세요
5. 20-120단어 내외로 응답하세요
6. 상황에 맞는 감정을 표현하세요

이전 대화:
${conversationHistory}

사용자의 새 메시지에 ${persona.name}로서 응답하세요.`;

      // 건너뛰기 시 자연스럽게 대화 이어가기
      const prompt = userMessage ? userMessage : "앞서 이야기를 자연스럽게 이어가거나 새로운 각도에서 문제를 제시해주세요.";

      const response = await this.genAI.models.generateContent({
        model: this.model,
        contents: [
          { role: "user", parts: [{ text: systemPrompt + "\n\n사용자: " + prompt }] }
        ],
      });

      const content = response.text || "죄송합니다. 응답을 생성할 수 없습니다.";
      console.log("✓ Gemini API call completed");
      console.log("Generated text:", content);

      // 감정 분석
      let emotion = "중립";
      let emotionReason = "일반적인 대화 상황";

      if (userMessage) {
        const emotionAnalysis = await this.analyzeEmotion(content, persona, userMessage);
        emotion = emotionAnalysis.emotion;
        emotionReason = emotionAnalysis.reason;
      }

      return { content, emotion, emotionReason };
    } catch (error) {
      console.error("Gemini API error:", error);
      const fallbackContent = this.getFallbackResponse(persona);
      return { 
        content: fallbackContent, 
        emotion: "중립", 
        emotionReason: "시스템 오류로 기본 응답 제공" 
      };
    }
  }

  private async analyzeEmotion(
    response: string, 
    persona: ScenarioPersona, 
    userMessage: string
  ): Promise<{ emotion: string; reason: string }> {
    try {
      const emotionPrompt = `다음 대화에서 ${persona.name}의 감정 상태를 분석하세요.

${persona.name}의 MBTI: ${(persona as any).mbti}
성격 특성: ${(persona.personality as any)?.traits ? (persona.personality as any).traits.join(', ') : '기본 특성'}
의사소통 스타일: ${(persona.personality as any)?.communicationStyle || '균형 잡힌 의사소통'}
주요 우려사항: ${(persona.personality as any)?.fears ? (persona.personality as any).fears.join(', ') : '없음'}
현재 입장: ${(persona as any).stance || '상황에 따른 대응'}

사용자 메시지: "${userMessage}"
${persona.name}의 응답: "${response}"

다음 중 하나의 감정으로 분류하고 이유를 설명하세요:
- 기쁨: 만족, 즐거움, 긍정적 반응
- 슬픔: 실망, 우울, 부정적 감정
- 분노: 화남, 짜증, 불만
- 놀람: 의외, 당황, 예상치 못한 반응
- 중립: 평상심, 차분함, 일반적 상태

JSON 형식으로 응답하세요:
{"emotion": "감정", "reason": "감정을 느끼는 이유"}`;

      const emotionResponse = await this.genAI.models.generateContent({
        model: "gemini-2.5-pro",
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              emotion: { type: "string" },
              reason: { type: "string" }
            },
            required: ["emotion", "reason"]
          }
        },
        contents: [{ role: "user", parts: [{ text: emotionPrompt }] }]
      });

      const emotionData = JSON.parse(emotionResponse.text || '{"emotion": "중립", "reason": "분석 불가"}');
      return {
        emotion: emotionData.emotion || "중립",
        reason: emotionData.reason || "감정 분석 실패"
      };
    } catch (error) {
      console.error("Emotion analysis error:", error);
      return { emotion: "중립", reason: "감정 분석 오류" };
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
      const conversationText = safeMessages.map(msg => 
        `${msg.sender === 'user' ? '사용자' : persona.name}: ${msg.message}`
      ).join('\n');

      // 대화 통계 계산
      const userMessages = safeMessages.filter(m => m.sender === 'user');
      const totalUserWords = userMessages.reduce((sum, msg) => sum + msg.message.length, 0);
      const averageMessageLength = userMessages.length > 0 ? Math.round(totalUserWords / userMessages.length) : 0;

      const feedbackPrompt = `다음은 ${persona.name}(${persona.role})과의 대화입니다.

대화 내용:
${conversationText}

대화 통계:
- 총 대화 턴: ${safeMessages.length}턴
- 사용자 발화 수: ${userMessages.length}회
- 평균 발화 길이: ${averageMessageLength}자
- 총 발화량: ${totalUserWords}자

평가 목표: ${persona.goals.join(', ')}

다음 5가지 기준으로 1-5점(1=미흡, 2=개선필요, 3=보통, 4=좋음, 5=우수)으로 평가하고 종합적인 피드백을 제공하세요:

1. 명확성 & 논리성 (20%): 발언의 구조화(서론-본론-결론), 메시지의 핵심 전달 여부, 불필요한 반복/모호성 최소화
2. 경청 & 공감 (20%): 상대방 발언 재진술·요약 능력, 감정 인식 및 언어적/비언어적 공감 표현, 상대방의 필요·우려를 존중하는 반응
3. 적절성 & 상황 대응 (20%): 시나리오 맥락에 맞는 표현 선택, 존칭/비공식 언어 사용의 적합성, 예상치 못한 질문·갈등 상황에 유연하게 대응
4. 설득력 & 영향력 (20%): 논리적 근거 제시, 사례/데이터/비유 활용, 상대방의 의사결정/행동 변화 유도
5. 전략적 커뮤니케이션 (20%): 목표 의식 있는 대화 전개, 갈등 회피 vs. 협상·조율 능력, 질문·피드백을 활용한 대화 주도성

**평가 시 고려사항:**
- 발화량이 너무 적으면(평균 20자 미만) 명확성 점수 감점
- 발화량이 적절하면(평균 30-80자) 가산점
- 대화 턴이 충분하면(8턴 이상) 구조화 점수 가산점
- 총 발화량이 풍부하면(400자 이상) 참여도 우수 평가

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
  "summary": "종합평가요약"
}`;

      const response = await this.genAI.models.generateContent({
        model: "gemini-2.5-pro",
        config: {
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
              summary: { type: "string" }
            }
          }
        },
        contents: [{ role: "user", parts: [{ text: feedbackPrompt }] }]
      });

      const feedbackData = JSON.parse(response.text || '{}');
      
      return {
        overallScore: Math.min(100, Math.max(0, feedbackData.overallScore || 0)),
        scores: {
          clarityLogic: Math.min(5, Math.max(1, feedbackData.scores?.clarityLogic || 3)),
          listeningEmpathy: Math.min(5, Math.max(1, feedbackData.scores?.listeningEmpathy || 3)),
          appropriatenessAdaptability: Math.min(5, Math.max(1, feedbackData.scores?.appropriatenessAdaptability || 3)),
          persuasivenessImpact: Math.min(5, Math.max(1, feedbackData.scores?.persuasivenessImpact || 3)),
          strategicCommunication: Math.min(5, Math.max(1, feedbackData.scores?.strategicCommunication || 3))
        },
        strengths: feedbackData.strengths || ["기본적인 대화 능력", "적절한 언어 사용", "상황 이해도"],
        improvements: feedbackData.improvements || ["더 구체적인 표현", "감정 교감 증진", "논리적 구조화"],
        nextSteps: feedbackData.nextSteps || ["추가 연습 필요", "전문가 피드백 받기", "실무 경험 쌓기"],
        summary: feedbackData.summary || "전반적으로 무난한 대화였습니다. 지속적인 연습을 통해 발전할 수 있습니다.",
        ranking: "전문가 분석 결과를 바탕으로 한 종합 평가입니다.",
        behaviorGuides: this.generateBehaviorGuides(persona),
        conversationGuides: this.generateConversationGuides(persona),
        developmentPlan: this.generateDevelopmentPlan(feedbackData.overallScore || 60)
      };
    } catch (error) {
      console.error("Feedback generation error:", error);
      return this.getFallbackFeedback();
    }
  }

  private getFallbackResponse(persona: ScenarioPersona): string {
    const fallbacks = {
      communication: "안녕하세요. 김태훈입니다. 현재 시스템에 문제가 있어 정상적인 응답이 어렵습니다. 잠시 후 다시 시도해주세요.",
      empathy: "죄송해요... 지금 시스템 상태가 좋지 않아서 제대로 대화하기 어려울 것 같아요. 조금 기다려주실 수 있을까요?",
      negotiation: "시스템 연결에 문제가 있습니다. 중요한 협상이니만큼 안정적인 환경에서 다시 진행하는 것이 좋겠습니다.",
      presentation: "기술적인 문제로 인해 현재 정상적인 응답이 어렵습니다. 시스템 복구 후 다시 시도해주세요.",
      feedback: "아... 죄송합니다. 시스템 오류로 제대로 응답드리기 어려운 상황입니다. 잠시 후 다시 말씀해주세요.",
      crisis: "긴급 상황인데 시스템에 문제가 발생했습니다. 빠른 복구를 위해 기술팀에 연락하겠습니다."
    };
    
    return fallbacks[persona.id as keyof typeof fallbacks] || "시스템 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
  }

  private getFallbackFeedback(): DetailedFeedback {
    return {
      overallScore: 60,
      scores: {
        clarityLogic: 3,
        listeningEmpathy: 3,
        appropriatenessAdaptability: 3,
        persuasivenessImpact: 3,
        strategicCommunication: 3
      },
      strengths: ["기본적인 대화 참여", "적절한 언어 사용", "상황에 맞는 응답"],
      improvements: ["시스템 안정성 확보 후 재평가 필요", "더 많은 대화 기회 필요", "기술적 문제 해결 후 재시도"],
      nextSteps: ["시스템 점검 완료 후 재도전", "안정적인 환경에서 재시도", "기술 지원팀 문의"],
      summary: "시스템 오류로 인해 정확한 평가가 어려웠습니다. 기술적 문제 해결 후 다시 시도해주세요.",
      ranking: "기술적 문제로 인한 임시 평가입니다.",
      behaviorGuides: [],
      conversationGuides: [],
      developmentPlan: {
        shortTerm: [],
        mediumTerm: [],
        longTerm: [],
        recommendedResources: []
      }
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