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
    scenario: string, 
    messages: ConversationMessage[], 
    persona: ScenarioPersona,
    userMessage?: string
  ): Promise<{ content: string; emotion: string; emotionReason: string }> {
    console.log("Attempting Gemini API call...");
    
    try {
      const conversationHistory = messages.map(msg => 
        `${msg.sender === 'user' ? '사용자' : persona.name}: ${msg.message}`
      ).join('\n');

      const systemPrompt = `당신은 ${persona.name}(${persona.role})입니다.

페르소나 설정:
- 성격: ${persona.personality}
- 응답 스타일: ${persona.responseStyle}
- 배경: ${persona.background}
- 목표: ${persona.goals.join(', ')}

대화 규칙:
1. 주어진 페르소나를 정확히 구현하세요
2. 자연스럽고 현실적인 대화를 유지하세요
3. 한국어로 응답하세요
4. 50-100단어 내외로 간결하게 응답하세요
5. 상황에 맞는 감정을 표현하세요

이전 대화:
${conversationHistory}

사용자의 새 메시지에 ${persona.name}로서 응답하세요.`;

      const prompt = userMessage || "대화를 시작해주세요.";

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

${persona.name}의 성격: ${persona.personality}
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
    persona: ScenarioPersona
  ): Promise<DetailedFeedback> {
    try {
      const conversationText = messages.map(msg => 
        `${msg.sender === 'user' ? '사용자' : persona.name}: ${msg.message}`
      ).join('\n');

      const feedbackPrompt = `다음은 ${persona.name}(${persona.role})과의 대화입니다.

대화 내용:
${conversationText}

평가 목표: ${persona.goals.join(', ')}

다음 5가지 기준으로 1-5점(1=미흡, 2=개선필요, 3=보통, 4=좋음, 5=우수)으로 평가하고 종합적인 피드백을 제공하세요:

1. 메시지 명확성 (25%): 정확하고 이해하기 쉬운 의사소통
2. 상대방 배려 (20%): 청자의 입장과 상황 고려
3. 감정적 반응성 (25%): 상대방 감정에 대한 적절한 대응
4. 대화 구조화 (20%): 논리적이고 체계적인 대화 진행
5. 전문적 역량 (10%): 업무 상황에 맞는 전문성 발휘

JSON 형식으로 응답하세요:
{
  "overallScore": 전체점수(0-100),
  "scores": {
    "clarity": 점수1-5,
    "empathy": 점수1-5,
    "responsiveness": 점수1-5,
    "structure": 점수1-5,
    "professionalism": 점수1-5
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
                  clarity: { type: "number" },
                  empathy: { type: "number" },
                  responsiveness: { type: "number" },
                  structure: { type: "number" },
                  professionalism: { type: "number" }
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
          clarity: Math.min(5, Math.max(1, feedbackData.scores?.clarity || 3)),
          empathy: Math.min(5, Math.max(1, feedbackData.scores?.empathy || 3)),
          responsiveness: Math.min(5, Math.max(1, feedbackData.scores?.responsiveness || 3)),
          structure: Math.min(5, Math.max(1, feedbackData.scores?.structure || 3)),
          professionalism: Math.min(5, Math.max(1, feedbackData.scores?.professionalism || 3))
        },
        strengths: feedbackData.strengths || ["기본적인 대화 능력", "적절한 언어 사용", "상황 이해도"],
        improvements: feedbackData.improvements || ["더 구체적인 표현", "감정 교감 증진", "논리적 구조화"],
        nextSteps: feedbackData.nextSteps || ["추가 연습 필요", "전문가 피드백 받기", "실무 경험 쌓기"],
        summary: feedbackData.summary || "전반적으로 무난한 대화였습니다. 지속적인 연습을 통해 발전할 수 있습니다."
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
        clarity: 3,
        empathy: 3,
        responsiveness: 3,
        structure: 3,
        professionalism: 3
      },
      strengths: ["기본적인 대화 참여", "적절한 언어 사용", "상황에 맞는 응답"],
      improvements: ["시스템 안정성 확보 후 재평가 필요", "더 많은 대화 기회 필요", "기술적 문제 해결 후 재시도"],
      nextSteps: ["시스템 점검 완료 후 재도전", "안정적인 환경에서 재시도", "기술 지원팀 문의"],
      summary: "시스템 오류로 인해 정확한 평가가 어려웠습니다. 기술적 문제 해결 후 다시 시도해주세요."
    };
  }
}