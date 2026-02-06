import OpenAI from "openai";
import type { ConversationMessage, DetailedFeedback } from "@shared/schema";
import type { AIServiceInterface, ScenarioPersona, EvaluationCriteriaWithDimensions, SupportedLanguage } from "../aiService";
import { LANGUAGE_INSTRUCTIONS } from "../aiService";
import { trackUsage, extractOpenAITokens, getModelPricingKey } from "../aiUsageTracker";

export class OpenAIProvider implements AIServiceInterface {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string = 'gpt-4') {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async generateResponse(
    scenario: string, 
    messages: ConversationMessage[], 
    persona: ScenarioPersona,
    userMessage?: string,
    language: SupportedLanguage = 'ko'
  ): Promise<{ content: string; emotion: string; emotionReason: string }> {
    const startTime = Date.now();
    const languageInstruction = LANGUAGE_INSTRUCTIONS[language] || LANGUAGE_INSTRUCTIONS.ko;
    
    try {
      const conversationHistory = messages.map(msg => ({
        role: msg.sender === 'user' ? 'user' as const : 'assistant' as const,
        content: `${msg.sender === 'user' ? '사용자' : persona.name}: ${msg.message}`
      }));

      const systemMessage = {
        role: 'system' as const,
        content: `당신은 ${persona.name}(${persona.role})입니다.

페르소나 설정:
- 성격: ${persona.personality}
- 응답 스타일: ${persona.responseStyle}
- 배경: ${persona.background}
- 목표: ${persona.goals.join(', ')}

대화 규칙:
1. 주어진 페르소나를 정확히 구현하세요
2. 자연스럽고 현실적인 대화를 유지하세요
3. ${languageInstruction}
4. 50-100단어 내외로 간결하게 응답하세요
5. 상황에 맞는 감정을 표현하세요`
      };

      // 건너뛰기 시 자연스럽게 대화 이어가기
      const userMessageContent = userMessage ? userMessage : "앞서 이야기를 자연스럽게 이어가거나 새로운 주제를 제시해주세요.";

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          systemMessage,
          ...conversationHistory,
          { role: 'user', content: userMessageContent }
        ],
        max_tokens: 200,
        temperature: 0.8
      });

      const totalTime = Date.now() - startTime;
      
      // Track usage asynchronously (fire and forget)
      const tokens = extractOpenAITokens(response);
      trackUsage({
        feature: 'conversation',
        model: getModelPricingKey(this.model),
        provider: 'openai',
        promptTokens: tokens.promptTokens,
        completionTokens: tokens.completionTokens,
        durationMs: totalTime,
      });

      const content = response.choices[0]?.message?.content || "죄송합니다. 응답을 생성할 수 없습니다.";

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
      console.error("OpenAI API error:", error);
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

JSON 형식으로 응답하세요: {"emotion": "감정", "reason": "감정을 느끼는 이유"}`;

      const emotionResponse = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: emotionPrompt }],
        response_format: { type: "json_object" },
        temperature: 0.3
      });

      const emotionData = JSON.parse(emotionResponse.choices[0]?.message?.content || '{"emotion": "중립", "reason": "분석 불가"}');
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
    conversation?: any,
    evaluationCriteria?: EvaluationCriteriaWithDimensions,
    language: SupportedLanguage = 'ko'
  ): Promise<DetailedFeedback> {
    const startTime = Date.now();
    const languageInstruction = LANGUAGE_INSTRUCTIONS[language] || LANGUAGE_INSTRUCTIONS.ko;
    
    try {
      const conversationText = messages.map(msg => 
        `${msg.sender === 'user' ? '사용자' : persona.name}: ${msg.message}`
      ).join('\n');

      // 동적 평가 기준 기반 프롬프트 생성 (언어 설정 포함)
      const feedbackPrompt = this.buildFeedbackPrompt(conversationText, persona, evaluationCriteria, language);

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: feedbackPrompt }],
        response_format: { type: "json_object" },
        temperature: 0.3
      });

      const totalTime = Date.now() - startTime;
      
      // Track usage asynchronously (fire and forget)
      const tokens = extractOpenAITokens(response);
      trackUsage({
        feature: 'feedback',
        model: getModelPricingKey(this.model),
        provider: 'openai',
        promptTokens: tokens.promptTokens,
        completionTokens: tokens.completionTokens,
        durationMs: totalTime,
      });

      const feedbackData = JSON.parse(response.choices[0]?.message?.content || '{}');
      
      return this.parseFeedbackResponse(feedbackData, evaluationCriteria);
    } catch (error) {
      console.error("Feedback generation error:", error);
      return this.getFallbackFeedback(evaluationCriteria);
    }
  }

  private getDefaultDimensions(): EvaluationCriteriaWithDimensions['dimensions'] {
    return [
      { key: 'clarityLogic', name: '명확성 & 논리성', description: '의사 표현의 명확성과 논리적 구성', weight: 20, minScore: 1, maxScore: 5 },
      { key: 'listeningEmpathy', name: '경청 & 공감', description: '상대방의 말을 듣고 공감하는 능력', weight: 20, minScore: 1, maxScore: 5 },
      { key: 'appropriatenessAdaptability', name: '적절성 & 상황대응', description: '상황에 맞는 적절한 대응', weight: 20, minScore: 1, maxScore: 5 },
      { key: 'persuasivenessImpact', name: '설득력 & 영향력', description: '상대방을 설득하고 영향을 미치는 능력', weight: 20, minScore: 1, maxScore: 5 },
      { key: 'strategicCommunication', name: '전략적 커뮤니케이션', description: '목표 달성을 위한 전략적 소통', weight: 20, minScore: 1, maxScore: 5 },
    ];
  }

  private calculateWeightedOverallScore(scores: Record<string, number>, evaluationCriteria?: EvaluationCriteriaWithDimensions): number {
    const dimensions = evaluationCriteria?.dimensions || this.getDefaultDimensions();
    const totalWeight = dimensions.reduce((sum, d) => sum + d.weight, 0);
    
    if (totalWeight === 0) return 75;
    
    const weightedSum = dimensions.reduce((sum, d) => {
      const score = scores[d.key] || 3;
      const normalizedScore = (score - d.minScore) / (d.maxScore - d.minScore);
      return sum + normalizedScore * d.weight;
    }, 0);
    
    return Math.round((weightedSum / totalWeight) * 100);
  }

  private buildFeedbackPrompt(conversationText: string, persona: ScenarioPersona, evaluationCriteria?: EvaluationCriteriaWithDimensions, language: SupportedLanguage = 'ko'): string {
    const dimensions = evaluationCriteria?.dimensions || this.getDefaultDimensions();
    const criteriaName = evaluationCriteria?.name || '기본 평가 기준';
    const languageInstruction = LANGUAGE_INSTRUCTIONS[language] || LANGUAGE_INSTRUCTIONS.ko;
    
    // 동적 평가 차원 목록 생성 (가중치 포함)
    const dimensionsList = dimensions.map((dim, idx) => {
      let line = `${idx + 1}. ${dim.name} (${dim.key}): ${dim.description} [${dim.minScore}-${dim.maxScore}점, 가중치: ${dim.weight}%]`;
      if (dim.evaluationPrompt) {
        line += `\n   평가 지침: ${dim.evaluationPrompt}`;
      }
      return line;
    }).join('\n');

    // 동적 scores 구조 생성
    const scoresStructure = dimensions.map(dim => `"${dim.key}": 점수${dim.minScore}-${dim.maxScore}`).join(',\n    ');

    return `당신은 커뮤니케이션 평가 전문가입니다.

## 평가 기준 세트: ${criteriaName}

## 대화 내용:
${conversationText}

## 페르소나 정보:
- 이름: ${persona.name}
- 역할: ${persona.role}
- 평가 목표: ${persona.goals.join(', ')}

## 평가 차원 (${dimensions.length}개):
${dimensionsList}

## 평가 지침:
1. 각 차원별로 지정된 점수 범위 내에서 평가
2. 전체 점수는 0-100점
3. **중요**: ${languageInstruction}

JSON 형식으로 응답:
{
  "overallScore": 전체점수(0-100),
  "scores": {
    ${scoresStructure}
  },
  "strengths": ["강점1", "강점2", "강점3"],
  "improvements": ["개선점1", "개선점2", "개선점3"],
  "nextSteps": ["다음단계1", "다음단계2", "다음단계3"],
  "summary": "종합평가요약"
}`;
  }

  private parseFeedbackResponse(feedbackData: any, evaluationCriteria?: EvaluationCriteriaWithDimensions): DetailedFeedback {
    const dimensions = evaluationCriteria?.dimensions || this.getDefaultDimensions();
    
    // 동적 scores 객체 생성
    const scores: Record<string, number> = {};
    for (const dim of dimensions) {
      const rawScore = feedbackData.scores?.[dim.key];
      scores[dim.key] = Math.min(dim.maxScore, Math.max(dim.minScore, rawScore || Math.ceil((dim.minScore + dim.maxScore) / 2)));
    }

    return {
      overallScore: this.calculateWeightedOverallScore(scores, evaluationCriteria),
      scores: scores as any,
      strengths: feedbackData.strengths || ["기본적인 대화 능력", "적절한 언어 사용", "상황 이해도"],
      improvements: feedbackData.improvements || ["더 구체적인 표현", "감정 교감 증진", "논리적 구조화"],
      nextSteps: feedbackData.nextSteps || ["추가 연습 필요", "전문가 피드백 받기", "실무 경험 쌓기"],
      summary: feedbackData.summary || "전반적으로 무난한 대화였습니다. 지속적인 연습을 통해 발전할 수 있습니다.",
      ranking: "전문가 분석을 통한 종합 평가 결과입니다.",
      behaviorGuides: this.generateBehaviorGuides(),
      conversationGuides: this.generateConversationGuides(), 
      developmentPlan: this.generateDevelopmentPlan(feedbackData.overallScore || 60),
      evaluationCriteriaSetName: evaluationCriteria?.name
    };
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

  private getFallbackFeedback(evaluationCriteria?: EvaluationCriteriaWithDimensions): DetailedFeedback {
    const dimensions = evaluationCriteria?.dimensions || this.getDefaultDimensions();
    const scores: Record<string, number> = {};
    for (const dim of dimensions) {
      scores[dim.key] = Math.ceil((dim.minScore + dim.maxScore) / 2);
    }

    return {
      overallScore: 60,
      scores: scores as any,
      strengths: ["기본적인 대화 참여", "적절한 언어 사용", "상황에 맞는 응답"],
      improvements: ["시스템 안정성 확보 후 재평가 필요", "더 많은 대화 기회 필요", "기술적 문제 해결 후 재시도"],
      nextSteps: ["시스템 점검 완료 후 재도전", "안정적인 환경에서 재시도", "기술 지원팀 문의"],
      summary: "시스템 오류로 인해 정확한 평가가 어려웠습니다. 기술적 문제 해결 후 다시 시도해주세요.",
      ranking: "시스템 오류로 인한 임시 평가입니다.",
      behaviorGuides: [],
      conversationGuides: [],
      developmentPlan: {
        shortTerm: [],
        mediumTerm: [],
        longTerm: [],
        recommendedResources: []
      },
      evaluationCriteriaSetName: evaluationCriteria?.name
    };
  }

  private generateBehaviorGuides() {
    return [{
      situation: "전문적 대화 상황",
      action: "명확하고 논리적인 의사소통을 지향하세요",
      example: "구체적인 사례와 데이터를 바탕으로 설명드리겠습니다",
      impact: "신뢰성 향상 및 효과적인 의사결정 지원"
    }];
  }

  private generateConversationGuides() {
    return [{
      scenario: "업무 협의 상황",
      goodExample: "사실에 기반한 논리적 설명과 상대방 입장 고려",
      badExample: "일방적 주장이나 감정적 대응",
      keyPoints: ["명확한 의사표현", "상호 존중", "건설적 피드백"]
    }];
  }

  private generateDevelopmentPlan(score: number) {
    return {
      shortTerm: [{
        goal: "커뮤니케이션 기본기 강화",
        actions: ["매일 대화 연습", "피드백 분석", "개선점 실천"],
        measurable: "주 5회 연습, 점수 15% 향상"
      }],
      mediumTerm: [{
        goal: "상황별 대응력 개발",
        actions: ["다양한 시나리오 경험", "전문가 조언", "동료 피드백"],
        measurable: "월 3회 새 시나리오, 성공률 80% 달성"
      }],
      longTerm: [{
        goal: "고급 커뮤니케이션 역량 확보",
        actions: ["전문 교육 이수", "멘토 활동", "리더십 개발"],
        measurable: "6개월 내 전문가 수준 도달"
      }],
      recommendedResources: [
        "커뮤니케이션 심화 과정",
        "비즈니스 대화법 도서",
        "실전 시나리오 훈련",
        "전문가 멘토링"
      ]
    };
  }
}