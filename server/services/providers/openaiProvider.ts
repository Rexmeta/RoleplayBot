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

  private validateFeedbackQuality(feedback: DetailedFeedback): { isValid: boolean; reason: string } {
    const issues: string[] = [];
    if ((feedback.summary || '').length < 30) issues.push(`summary too short`);
    if (!feedback.dimensionFeedback || Object.keys(feedback.dimensionFeedback).length === 0) issues.push('missing dimensionFeedback');
    if (!feedback.strengths || feedback.strengths.length < 2) issues.push('insufficient strengths');
    if (!feedback.ranking || feedback.ranking.length < 20) issues.push('ranking too short');
    const scoreValues = Object.values(feedback.scores || {}).filter(v => typeof v === 'number') as number[];
    if (scoreValues.length > 1 && scoreValues.every(s => s === scoreValues[0])) issues.push('all scores identical');
    return issues.length > 0 ? { isValid: false, reason: issues.join('; ') } : { isValid: true, reason: 'OK' };
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
    const maxRetries = 2;
    let lastFeedback: DetailedFeedback | null = null;
    let lastReason = '';

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const conversationText = messages.map(msg => 
          `${msg.sender === 'user' ? '사용자' : persona.name}: ${msg.message}`
        ).join('\n');

        const feedbackPrompt = this.buildFeedbackPrompt(conversationText, persona, evaluationCriteria, language);

        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: [{ role: 'user', content: feedbackPrompt }],
          response_format: { type: "json_object" },
          temperature: attempt === 0 ? 0.3 : 0.5 + (attempt * 0.1),
          max_tokens: 16384
        });

        const totalTime = Date.now() - startTime;
        
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
        const feedback = this.parseFeedbackResponse(feedbackData, evaluationCriteria);
        
        const validation = this.validateFeedbackQuality(feedback);
        if (validation.isValid) {
          if (attempt > 0) console.log(`✅ OpenAI feedback quality validated on attempt ${attempt + 1}`);
          return feedback;
        }
        
        console.warn(`⚠️ OpenAI feedback quality check failed (attempt ${attempt + 1}): ${validation.reason}`);
        lastFeedback = feedback;
        lastReason = validation.reason;
      } catch (error) {
        console.error(`OpenAI feedback error (attempt ${attempt + 1}):`, error);
        if (attempt >= maxRetries) return this.getFallbackFeedback(evaluationCriteria);
      }
    }
    
    console.warn(`⚠️ Using best available OpenAI feedback. Issues: ${lastReason}`);
    return lastFeedback || this.getFallbackFeedback(evaluationCriteria);
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

    // 동적 scores 구조 생성 - 다양한 예시 점수로 AI의 동일 점수 반환 방지
    const exampleScores = [2, 4, 3, 5, 1, 3, 4, 2, 5, 3];
    const scoresStructure = dimensions.map((dim, idx) => {
      const exampleScore = Math.min(dim.maxScore, Math.max(dim.minScore, exampleScores[idx % exampleScores.length]));
      return `"${dim.key}": ${exampleScore}`;
    }).join(',\n    ');

    const dimensionFeedbackFormat = dimensions.map(d => `"${d.key}": "이 영역에서 사용자가 보인 구체적 행동과 근거를 2문장 이상 서술"`).join(', ');

    return `당신은 커뮤니케이션 평가 전문가입니다. 아래 대화를 분석하여 상세한 피드백 리포트를 JSON 형식으로 작성해주세요.

## 평가 기준 세트: ${criteriaName}

## 대화 내용:
${conversationText}

## 페르소나 정보:
- 이름: ${persona.name}
- 역할: ${persona.role}
- 평가 목표: ${persona.goals.join(', ')}

## 평가 차원 (${dimensions.length}개):
${dimensionsList}

## ⚠️ 독립 평가 필수 원칙:
- **각 평가 차원은 반드시 독립적으로 평가하세요. 모든 차원에 동일한 점수를 부여하는 것은 절대 금지합니다.**
- **반드시 dimensionFeedback에서 각 영역별 구체적 근거(실제 발화 인용)를 먼저 작성한 후, 그 근거를 바탕으로 점수를 결정하세요**
- 사용자의 각 발화를 분석하여 어떤 차원과 관련되는지 매핑하세요
- 예: 공감 표현이 있으면 경청&공감 점수를 높이고, 논리적 근거 없이 주장만 하면 설득력 점수를 낮추세요
- 점수 범위(1-5)를 고르게 활용하세요. 1점(매우 부족)~5점(탁월)까지 대화 내용에 따라 차등 부여
- 각 평가 차원에 "평가 지침"이 있는 경우, 반드시 해당 지침에 따라 채점하세요

## 📝 콘텐츠 품질 요구사항:
- **summary**: 3문장 이상으로 대화의 전체적인 흐름, 사용자의 핵심 강점, 주요 개선 영역을 구체적으로 서술
- **strengths/improvements/nextSteps**: 각각 3개 이상, 각 항목은 대화 내용을 직접 인용하거나 참조하는 구체적 문장
- **dimensionFeedback**: 각 차원별로 2문장 이상, 해당 차원에서 사용자가 보인 구체적 행동과 그 효과를 서술
- **behaviorGuides**: 3개 이상의 상황별 행동 가이드, 이 대화 맥락에 맞게 구체적으로 작성
- **conversationGuides**: 2개 이상, goodExample과 badExample은 실제 사용 가능한 구체적 대화문으로 작성
- **developmentPlan**: 단기/중기/장기 각 1개 이상, 이 대화에서 드러난 약점을 기반으로 구체적이고 측정 가능한 목표 설정
- **ranking**: 전문가 관점의 심층 분석 의견을 3문장 이상으로 서술

## 가중치 반영 지침:
- 종합평가(summary)는 가중치가 높은 차원의 결과를 중심으로 작성하세요
- strengths/improvements도 가중치가 높은 차원을 우선적으로 반영하세요

**중요**: ${languageInstruction}

JSON 형식으로 응답:
{
  "overallScore": 72,
  "scores": {
    ${scoresStructure}
  },
  "dimensionFeedback": {${dimensionFeedbackFormat}},
  "strengths": ["대화 초반 상대방의 입장을 경청하며 공감을 표현한 점이 신뢰 형성에 효과적이었습니다", "구체적인 데이터를 활용하여 논거를 뒷받침한 점이 설득력을 높였습니다", "상대방의 반론에 감정적으로 대응하지 않고 차분하게 대안을 제시한 점이 인상적이었습니다"],
  "improvements": ["핵심 주장을 먼저 제시하는 두괄식 구조가 부족하여 메시지 전달력이 떨어졌습니다", "상대방의 비언어적 신호에 대한 대응이 부족하여 대화의 흐름을 놓치는 순간이 있었습니다", "대화 마무리 단계에서 구체적인 합의 사항을 정리하지 않아 다음 단계가 불명확했습니다"],
  "nextSteps": ["PREP 구조를 활용하여 논리적으로 의견을 전달하는 연습을 해보세요", "상대방이 망설일 때 개방형 질문을 사용하는 습관을 들이세요", "대화 마무리 시 합의 내용을 요약하고 다음 액션 아이템을 정리하세요"],
  "summary": "이번 대화에서 사용자는 기본적인 공감 능력을 보여주었으나, 논리적 설득과 전략적 대화 구조화에서 개선이 필요합니다. 특히 핵심 주장의 명확한 전달과 협상 마무리 기술이 부족했습니다. 구조화된 논증 방식과 적극적 경청 기법을 훈련하면 커뮤니케이션 역량이 크게 향상될 것으로 기대됩니다.",
  "ranking": "전반적으로 기본적인 대화 역량은 갖추고 있으나, 전략적 소통 능력이 부족합니다. 공감 능력은 평균 이상이나, 이를 설득력 있는 논거와 결합하는 통합적 커뮤니케이션 역량 개발이 필요합니다. 체계적인 훈련을 통해 단기간 내 의미 있는 성장이 가능할 것으로 판단됩니다.",
  "behaviorGuides": [
    {"situation": "상대방이 강하게 반대 의견을 표명할 때", "action": "감정적 반응을 자제하고, 상대방의 핵심 우려사항을 먼저 인정한 후 대안을 제시합니다", "example": "'말씀하신 우려는 충분히 이해합니다. 그 점을 고려하여 단계적 도입 방안을 준비했는데 검토해 주시겠습니까?'", "impact": "상대방이 자신의 의견이 존중받았다고 느끼게 되어 방어적 태도가 줄어듭니다"},
    {"situation": "대화가 교착 상태에 빠졌을 때", "action": "공통 목표를 재확인하고 개방형 질문으로 새로운 가능성을 탐색합니다", "example": "'우리 모두 프로젝트 성공이라는 같은 목표를 갖고 있잖아요. 두 가지 방안의 장점을 결합할 수 있을까요?'", "impact": "대립에서 협력 구도로 전환되어 창의적 해결책 도출 가능성이 높아집니다"},
    {"situation": "중요한 정보를 전달해야 할 때", "action": "PREP 구조로 핵심 메시지를 명확히 전달합니다", "example": "'결론적으로 A방안을 추천합니다. 이유는 비용 절감 20%, 호환성 확보이며, B팀에서 성공한 사례가 있습니다.'", "impact": "의사결정 속도가 빨라지고 전문성 있는 인상을 줍니다"}
  ],
  "conversationGuides": [
    {"scenario": "갈등 상황에서의 대화", "goodExample": "'팀장님의 우려를 충분히 이해합니다. 기존 업무에 영향을 최소화하면서 시범 적용할 수 있는 방법을 생각해 보았습니다.'", "badExample": "'아니요, 그건 아닙니다. 제 방안이 더 효율적이에요.'", "keyPoints": ["상대방 감정 인정", "우려사항 구체적 언급", "부담 줄이는 대안 제시", "비난 대신 협력의 자세"]},
    {"scenario": "합의 도출이 필요한 상황", "goodExample": "'지금까지 논의를 정리하면, 1) 일정 유지, 2) 리스크 부분 추가 검토입니다. 다음 주까지 세부 계획을 공유드리겠습니다.'", "badExample": "'네, 알겠습니다. 그럼 그렇게 하죠.' (합의 내용 없이 마무리)", "keyPoints": ["합의 내용 구체적 요약", "액션 아이템과 기한 명시", "추가 의견 확인", "문서화"]}
  ],
  "developmentPlan": {
    "shortTerm": [{"goal": "구조화된 논증 능력 향상 (1-2주)", "actions": ["PREP 구조 사용 연습", "두괄식 의견 전달 훈련", "대화 후 복기 및 개선점 기록"], "measurable": "PREP 구조 사용 비율 80% 이상"}],
    "mediumTerm": [{"goal": "갈등 대응력 강화 (1-2개월)", "actions": ["갈등 시나리오 롤플레이 월 3회", "반영적 경청 기법 훈련", "Win-Win 협상 기법 학습"], "measurable": "갈등 해결 성공률 70% 이상"}],
    "longTerm": [{"goal": "전략적 커뮤니케이션 리더십 (3-6개월)", "actions": ["퍼실리테이터 역할 수행", "부서 간 조율자 역할", "전문 교육 이수"], "measurable": "팀 커뮤니케이션 만족도 80점 이상"}],
    "recommendedResources": ["'어떻게 원하는 것을 얻는가' - 협상 기법 서적", "'비폭력 대화' - 갈등 해결 커뮤니케이션", "커뮤니케이션 스킬 온라인 강의", "롤플레이 실전 훈련 과정"]
  }
}`;
  }

  private parseFeedbackResponse(feedbackData: any, evaluationCriteria?: EvaluationCriteriaWithDimensions): DetailedFeedback {
    const dimensions = evaluationCriteria?.dimensions || this.getDefaultDimensions();
    
    const scores: Record<string, number> = {};
    for (const dim of dimensions) {
      const rawScore = feedbackData.scores?.[dim.key];
      scores[dim.key] = Math.min(dim.maxScore, Math.max(dim.minScore, rawScore || Math.ceil((dim.minScore + dim.maxScore) / 2)));
    }

    return {
      overallScore: this.calculateWeightedOverallScore(scores, evaluationCriteria),
      scores: scores as any,
      dimensionFeedback: feedbackData.dimensionFeedback || {},
      strengths: feedbackData.strengths || ["기본적인 대화 능력", "적절한 언어 사용", "상황 이해도"],
      improvements: feedbackData.improvements || ["더 구체적인 표현", "감정 교감 증진", "논리적 구조화"],
      nextSteps: feedbackData.nextSteps || ["추가 연습 필요", "전문가 피드백 받기", "실무 경험 쌓기"],
      summary: feedbackData.summary || "전반적으로 무난한 대화였습니다. 지속적인 연습을 통해 발전할 수 있습니다.",
      ranking: feedbackData.ranking || feedbackData.summary || "전문가 분석을 통한 종합 평가 결과입니다.",
      behaviorGuides: feedbackData.behaviorGuides || this.generateBehaviorGuides(),
      conversationGuides: feedbackData.conversationGuides || this.generateConversationGuides(), 
      developmentPlan: feedbackData.developmentPlan || this.generateDevelopmentPlan(feedbackData.overallScore || 60),
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