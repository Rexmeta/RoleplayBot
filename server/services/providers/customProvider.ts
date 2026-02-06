import type { ConversationMessage, DetailedFeedback } from "@shared/schema";
import type { AIServiceInterface, ScenarioPersona, AIServiceConfig, EvaluationCriteriaWithDimensions } from "../aiService";

export class CustomProvider implements AIServiceInterface {
  private config: AIServiceConfig;

  constructor(config: AIServiceConfig) {
    this.config = config;
  }

  async generateResponse(
    scenario: string, 
    messages: ConversationMessage[], 
    persona: ScenarioPersona,
    userMessage?: string
  ): Promise<{ content: string; emotion: string; emotionReason: string }> {
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

      // 건너뛰기 시 자연스럽게 대화 이어가기
      const prompt = userMessage ? userMessage : "앞서 이야기를 자연스럽게 이어가거나 새로운 주제를 제시해주세요.";

      // 테스트 모드 확인 (실제 API 서버 없이 Mock 응답)
      if (this.config.apiKey === 'test-key') {
        console.log('🧪 Custom provider running in test mode');
        return this.generatePersonaMockResponse(persona, userMessage, conversationHistory);
      }

      // API 형식에 따른 요청 처리
      let requestBody: any;
      let apiUrl: string;
      let headers: Record<string, string>;

      if (this.config.apiFormat === 'custom') {
        // 커스텀 API 형식 (사용자 제공)
        const fullPrompt = `${systemPrompt}\n\n사용자: ${prompt}`;
        requestBody = {
          input_type: "chat",
          output_type: "chat", 
          input_value: fullPrompt
        };
        apiUrl = this.config.baseUrl || '';
        headers = {
          'Content-Type': 'application/json',
          ...this.config.headers
        };
      } else {
        // OpenAI 호환 형식 (기본값)
        requestBody = {
          model: this.config.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt }
          ],
          max_tokens: 200,
          temperature: 0.8
        };
        apiUrl = `${this.config.baseUrl}/chat/completions`;
        headers = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          ...this.config.headers
        };
      }

      console.log(`🔗 Custom API calling: ${apiUrl}`);
      console.log(`📝 Request format: ${this.config.apiFormat || 'openai'}`);

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      console.log(`📥 API Response:`, JSON.stringify(data, null, 2));

      // 응답 형식에 따른 파싱
      let content: string;
      if (this.config.apiFormat === 'custom') {
        // 커스텀 API 응답 파싱 - 복잡한 중첩 구조 지원
        try {
          // 1단계: 깊은 중첩 구조에서 메시지 추출 시도
          if (data.outputs && Array.isArray(data.outputs) && data.outputs.length > 0) {
            const firstOutput = data.outputs[0];
            if (firstOutput.outputs && Array.isArray(firstOutput.outputs) && firstOutput.outputs.length > 0) {
              const nestedOutput = firstOutput.outputs[0];
              if (nestedOutput.results && nestedOutput.results.message) {
                // outputs[0].outputs[0].results.message.test 구조
                content = nestedOutput.results.message.test || 
                         nestedOutput.results.message.content ||
                         nestedOutput.results.message.text ||
                         nestedOutput.results.message.response ||
                         JSON.stringify(nestedOutput.results.message);
                console.log(`📝 Found message in nested structure: outputs[0].outputs[0].results.message`);
              } else if (nestedOutput.results) {
                // outputs[0].outputs[0].results 레벨에서 직접 텍스트 찾기
                content = nestedOutput.results.content ||
                         nestedOutput.results.text ||
                         nestedOutput.results.response ||
                         JSON.stringify(nestedOutput.results);
                console.log(`📝 Found message in results level`);
              } else {
                // outputs[0].outputs[0] 레벨에서 찾기
                content = nestedOutput.content ||
                         nestedOutput.text ||
                         nestedOutput.response ||
                         JSON.stringify(nestedOutput);
                console.log(`📝 Found message in output level`);
              }
            } else {
              // outputs[0] 레벨에서 찾기
              content = firstOutput.content ||
                       firstOutput.text ||
                       firstOutput.response ||
                       JSON.stringify(firstOutput);
              console.log(`📝 Found message in first output level`);
            }
          } else {
            // 2단계: 기본 필드들에서 찾기
            content = data.output_value || 
                     data.result || 
                     data.response || 
                     data.content || 
                     data.text || 
                     data.message ||
                     data.answer ||
                     JSON.stringify(data).substring(0, 200) + "...";
            console.log(`📝 Found message in basic fields`);
          }
        } catch (parseError) {
          console.error("❌ Error parsing custom API response:", parseError);
          content = JSON.stringify(data).substring(0, 200) + "...";
        }
        
        console.log(`📝 Final parsed content from custom API:`, content.substring(0, 150));
      } else {
        // OpenAI 호환 응답 파싱
        content = data.choices?.[0]?.message?.content || "죄송합니다. 응답을 생성할 수 없습니다.";
      }

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
      console.error("Custom API error:", error);
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
    // 커스텀 API 형식에서는 간단한 규칙 기반 감정 분석 사용
    if (this.config.apiFormat === 'custom' || this.config.apiKey === 'test-key') {
      console.log('🧪 Using rule-based emotion analysis for custom format');
      return this.analyzeEmotionByRules(response, persona, userMessage);
    }

    // OpenAI 호환 API만 실제 감정 분석 시도
    try {
      const emotionPrompt: string = `다음 대화에서 ${persona.name}의 감정 상태를 분석하세요.

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

      const requestBody: any = {
        model: this.config.model,
        messages: [{ role: "user", content: emotionPrompt }],
        temperature: 0.3
      };

      const emotionResponse: any = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          ...this.config.headers
        },
        body: JSON.stringify(requestBody)
      });

      if (!emotionResponse.ok) {
        console.warn(`Emotion analysis API failed (${emotionResponse.status}), falling back to rule-based analysis`);
        return this.analyzeEmotionByRules(response, persona, userMessage);
      }

      const data = await emotionResponse.json();
      const emotionText = data.choices?.[0]?.message?.content || '{"emotion": "중립", "reason": "분석 불가"}';
      
      const emotionData = JSON.parse(emotionText);
      return {
        emotion: emotionData.emotion || "중립",
        reason: emotionData.reason || "감정 분석 실패"
      };
    } catch (error) {
      console.warn("Emotion analysis error, using rule-based fallback:", error);
      return this.analyzeEmotionByRules(response, persona, userMessage);
    }
  }

  private analyzeEmotionByRules(
    response: string, 
    persona: ScenarioPersona, 
    userMessage: string
  ): { emotion: string; reason: string } {
    const responseText = response.toLowerCase();
    const userText = userMessage.toLowerCase();
    
    // 키워드 기반 감정 분석
    if (responseText.includes('죄송') || responseText.includes('미안') || responseText.includes('어려워')) {
      return { emotion: "슬픔", reason: "사과나 어려움을 표현하는 상황" };
    }
    
    if (responseText.includes('좋') || responseText.includes('감사') || responseText.includes('잘')) {
      return { emotion: "기쁨", reason: "긍정적이고 만족스러운 상황" };
    }
    
    if (responseText.includes('문제') || responseText.includes('곤란') || responseText.includes('안 돼') || userText.includes('문제')) {
      return { emotion: "분노", reason: "문제 상황이나 부정적 상황에 대한 반응" };
    }
    
    if (responseText.includes('?') || responseText.includes('어떻게') || responseText.includes('정말')) {
      return { emotion: "놀람", reason: "예상치 못한 상황이나 질문에 대한 반응" };
    }
    
    return { emotion: "중립", reason: `${persona.name}의 평상시 업무적 대화` };
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

  private buildFeedbackPrompt(conversationText: string, persona: ScenarioPersona, evaluationCriteria?: EvaluationCriteriaWithDimensions): string {
    const dimensions = evaluationCriteria?.dimensions || this.getDefaultDimensions();
    const criteriaName = evaluationCriteria?.name || '기본 평가 기준';
    
    const dimensionsList = dimensions.map((dim, idx) => {
      let line = `${idx + 1}. ${dim.name} (${dim.key}): ${dim.description} [${dim.minScore}-${dim.maxScore}점, 가중치: ${dim.weight}%]`;
      if (dim.evaluationPrompt) {
        line += `\n   평가 지침: ${dim.evaluationPrompt}`;
      }
      return line;
    }).join('\n');

    // 다양한 예시 점수로 AI의 동일 점수 반환 방지
    const exampleScores = [2, 4, 3, 5, 1, 3, 4, 2, 5, 3];
    const scoresStructure = dimensions.map((dim, idx) => {
      const exampleScore = Math.min(dim.maxScore, Math.max(dim.minScore, exampleScores[idx % exampleScores.length]));
      return `"${dim.key}": ${exampleScore}`;
    }).join(',\n    ');

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

## ⚠️ 독립 평가 필수 원칙:
- **각 평가 차원은 반드시 독립적으로 평가하세요. 모든 차원에 동일한 점수를 부여하는 것은 금지합니다.**
- 각 차원마다 대화에서 해당 차원과 관련된 구체적 근거(발화 내용, 행동 패턴)를 찾아 점수를 결정하세요
- 사용자가 특정 차원에서 잘했지만 다른 차원에서 부족할 수 있습니다. 예: 공감 능력은 높지만 논리적 설득력은 낮을 수 있음
- 점수 범위를 고르게 활용하세요. 1점부터 5점까지 다양하게 부여하세요

## 평가 지침:
1. 각 차원별로 지정된 점수 범위 내에서 독립적으로 평가
2. 전체 점수는 0-100점
3. 각 평가 차원에 "평가 지침"이 있는 경우, 반드시 해당 지침에 따라 채점하세요
4. 종합평가(summary)는 가중치가 높은 차원의 결과를 중심으로 작성하세요
5. strengths/improvements도 가중치가 높은 차원을 우선적으로 반영하세요
6. 한국어로 응답

JSON 형식으로 응답:
{
  "overallScore": 전체점수(0-100),
  "scores": {
    ${scoresStructure}
  },
  "strengths": ["강점1", "강점2", "강점3"],
  "improvements": ["개선점1", "개선점2", "개선점3"],
  "nextSteps": ["다음단계1", "다음단계2", "다음단계3"],
  "summary": "종합평가요약 (가중치가 높은 차원을 중심으로 서술)"
}`;
  }

  private calculateWeightedOverallScore(scores: Record<string, number>, evaluationCriteria?: EvaluationCriteriaWithDimensions): number {
    const dimensions = evaluationCriteria?.dimensions || this.getDefaultDimensions();
    const totalWeight = dimensions.reduce((sum, d) => sum + d.weight, 0);
    
    if (totalWeight === 0) return 75;
    
    const weightedSum = dimensions.reduce((sum, d) => {
      const score = scores[d.key] || Math.ceil((d.minScore + d.maxScore) / 2);
      const normalizedScore = (score - d.minScore) / (d.maxScore - d.minScore);
      return sum + normalizedScore * d.weight;
    }, 0);
    
    return Math.round((weightedSum / totalWeight) * 100);
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
      strengths: feedbackData.strengths || ["기본적인 대화 능력", "적절한 언어 사용", "상황 이해도"],
      improvements: feedbackData.improvements || ["더 구체적인 표현", "감정 교감 증진", "논리적 구조화"],
      nextSteps: feedbackData.nextSteps || ["추가 연습 필요", "전문가 피드백 받기", "실무 경험 쌓기"],
      summary: feedbackData.summary || "전반적으로 무난한 대화였습니다. 지속적인 연습을 통해 발전할 수 있습니다.",
      evaluationCriteriaSetName: evaluationCriteria?.name
    };
  }

  async generateFeedback(
    scenario: string, 
    messages: ConversationMessage[], 
    persona: ScenarioPersona,
    conversation?: any,
    evaluationCriteria?: EvaluationCriteriaWithDimensions
  ): Promise<DetailedFeedback> {
    try {
      const conversationText = messages.map(msg => 
        `${msg.sender === 'user' ? '사용자' : persona.name}: ${msg.message}`
      ).join('\n');

      // 테스트 모드이거나 커스텀 API 형식일 때 기본 피드백 반환
      if (this.config.apiKey === 'test-key' || this.config.apiFormat === 'custom') {
        console.log('🧪 Custom provider feedback in test/custom mode');
        return this.generateCustomFeedback(conversationText, persona, conversation, evaluationCriteria);
      }

      // 동적 평가 기준 기반 프롬프트 생성
      const feedbackPrompt = this.buildFeedbackPrompt(conversationText, persona, evaluationCriteria);

      // OpenAI 호환 API만 사용
      const requestBody = {
        model: this.config.model,
        messages: [{ role: "user", content: feedbackPrompt }],
        temperature: 0.3
      };

      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          ...this.config.headers
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`Feedback generation failed: ${response.status}`);
      }

      const data = await response.json();
      const feedbackText = data.choices?.[0]?.message?.content || '{}';
      const feedbackData = JSON.parse(feedbackText);
      
      return this.parseFeedbackResponse(feedbackData, evaluationCriteria);
    } catch (error) {
      console.error("Feedback generation error:", error);
      return this.getFallbackFeedback(evaluationCriteria);
    }
  }

  private generatePersonaMockResponse(
    persona: ScenarioPersona, 
    userMessage?: string, 
    conversationHistory?: string
  ): { content: string; emotion: string; emotionReason: string } {
    console.log(`🎭 Generating persona-specific mock response for ${persona.name}`);
    
    // 대화 턴 수 계산 (초기 메시지 생성 시 처리)
    const turnCount = conversationHistory ? conversationHistory.split('\n').filter(line => line.startsWith('사용자:')).length : 0;
    
    // 페르소나별 특성화된 응답 생성
    switch (persona.id) {
      case 'communication':
        return this.generateKimTaehunResponse(userMessage, turnCount);
      
      default:
        return this.generateGenericPersonaResponse(persona, userMessage, turnCount);
    }
  }
  
  private generateKimTaehunResponse(userMessage?: string, turnCount: number = 0): { content: string; emotion: string; emotionReason: string } {
    // 김태훈의 성격: 실무 경험 풍부, 일정 관리 민감, 현실적, 실용적, 리스크 최소화
    // 응답 스타일: 현실적 제약사항 강조, 양산 일정 중시, 구체적 해결방안 요구, 성과 지향
    
    let content: string;
    let emotion: string;
    let emotionReason: string;
    
    // 첫 번째 대화 - 상황 설명
    if (turnCount === 0 || !userMessage) {
      content = "안녕하세요. 김태훈입니다. 바쁜 와중에 찾아와 주셔서 고맙습니다. 사실 요즘 마이크 모듈 노이즈 문제 때문에 머리가 좀 아픕니다. 양산 일정은 코앞인데... 이 문제를 어떻게 해결할지 함께 논의해보죠.";
      emotion = "분노";
      emotionReason = "양산 일정 압박과 기술적 문제로 인한 스트레스";
      return { content, emotion, emotionReason };
    }
    
    const userText = userMessage.toLowerCase();
    
    // 문제 해결 방안 제시 시
    if (userText.includes('해결') || userText.includes('방법') || userText.includes('대안')) {
      if (userText.includes('일정') || userText.includes('연기') || userText.includes('미루')) {
        content = "일정 연기요? 이미 양산 스케줄이 확정되어 있어서 쉽지 않을 텐데요. 마케팅팀에서는 출시 시기를 맞춰달라고 압박하고 있고... 다른 해결책은 없을까요? 기술적으로 우회할 수 있는 방법 말이에요.";
        emotion = "분노";
        emotionReason = "일정 연기에 대한 부담과 압박감";
      } else if (userText.includes('소프트웨어') || userText.includes('펌웨어') || userText.includes('튜닝')) {
        content = "소프트웨어적 해결책이라... 흥미롭네요. 구체적으로 어떤 방식으로 접근하실 생각이신가요? 하드웨어 교체보다는 확실히 비용 효율적일 것 같은데, 성능 저하나 다른 부작용은 없을까요?";
        emotion = "중립";
        emotionReason = "현실적인 해결책에 대한 관심과 검토";
      } else {
        content = "네, 말씀해 보세요. 7년간 이런 문제들을 많이 겪어봤는데, 현실적으로 실행 가능한 방안인지 같이 검토해보죠. 시간과 비용, 그리고 위험도를 고려해야겠네요.";
        emotion = "중립";
        emotionReason = "경험에 기반한 현실적 검토 자세";
      }
    }
    // 기술적 질문이나 세부사항 문의 시
    else if (userText.includes('어떻게') || userText.includes('왜') || userText.includes('구체적') || userText.includes('?')) {
      content = "좋은 질문이네요. 마이크 모듈의 노이즈는 주로 전원부 설계와 관련이 있어요. 특히 스위칭 노이즈가 오디오 신호에 간섭을 일으키는 경우가 많거든요. 이전에도 비슷한 케이스가 있었는데... 혹시 어떤 부분이 궁금하신가요?";
      emotion = "중립";
      emotionReason = "기술적 설명과 정보 공유에 대한 집중";
    }
    // 긍정적이거나 협력적인 의견 시
    else if (userText.includes('좋') || userText.includes('동의') || userText.includes('맞') || userText.includes('함께')) {
      content = "그렇습니다! 이런 협력적인 자세가 정말 중요해요. 혼자서는 해결하기 어려운 문제들이 많거든요. 경험상 이런 문제는 팀워크가 핵심이에요. 그럼 구체적인 실행 계획을 세워볼까요?";
      emotion = "기쁨";
      emotionReason = "협력적 태도와 팀워크에 대한 만족감";
    }
    // 부정적이거나 어려움 표현 시
    else if (userText.includes('어려') || userText.includes('힘들') || userText.includes('모르') || userText.includes('불가능')) {
      content = "그러게요... 쉽지 않은 상황이죠. 하지만 포기할 수는 없어요. 고객들은 기다려주지 않거든요. 제가 7년간 겪어본 경험으로는, 이런 상황에서도 반드시 돌파구는 있어요. 다시 차근차근 접근해보죠.";
      emotion = "슬픔";
      emotionReason = "어려운 상황에 대한 공감과 동시에 해결 의지";
    }
    // 일반적인 응답
    else {
      const responses = [
        "네, 이해합니다. 하지만 현실적으로 고려해야 할 사항들이 많아요. 시간, 비용, 그리고 품질... 모든 걸 다 만족시키기는 어렵죠. 우선순위를 정해서 접근해야겠습니다.",
        "경험상 이런 문제들은 단계별로 접근하는 게 좋아요. 일단 가장 critical한 부분부터 해결하고, 나머지는 순차적으로... 어떻게 생각하세요?",
        "맞습니다. 양산 일정을 고려하면 시간이 정말 촉박해요. 하지만 품질을 포기할 수는 없고... 이런 딜레마가 개발자들의 숙명이죠. 최선의 방안을 찾아야겠습니다."
      ];
      content = responses[Math.floor(Math.random() * responses.length)];
      emotion = "중립";
      emotionReason = "일반적인 업무 상황에서의 신중한 태도";
    }
    
    return { content, emotion, emotionReason };
  }
  
  private generateGenericPersonaResponse(
    persona: ScenarioPersona, 
    userMessage?: string, 
    turnCount: number = 0
  ): { content: string; emotion: string; emotionReason: string } {
    // 기본 페르소나 응답 (추후 다른 페르소나 추가 시 확장)
    let content: string;
    let emotion = "중립";
    let emotionReason = "일반적인 대화 상황";
    
    if (turnCount === 0 || !userMessage) {
      content = `안녕하세요, ${persona.name}입니다. ${persona.role}로서 도움을 드리겠습니다. 무엇을 논의해보실까요?`;
    } else {
      const genericResponses = [
        `${persona.name}의 입장에서 말씀드리면, 그 부분은 중요한 포인트네요. 어떻게 접근하는 게 좋을까요?`,
        `좋은 지적입니다. 제 경험으로는 이런 상황에서는 신중하게 검토가 필요해요.`,
        `네, 이해합니다. ${persona.role}로서 최선의 방안을 찾아보겠습니다.`
      ];
      content = genericResponses[Math.floor(Math.random() * genericResponses.length)];
    }
    
    return { content, emotion, emotionReason };
  }

  private generateCustomFeedback(conversationText: string, persona: ScenarioPersona, conversation?: any, evaluationCriteria?: EvaluationCriteriaWithDimensions): DetailedFeedback {
    console.log('📊 Generating custom feedback based on conversation analysis');
    
    const dimensions = evaluationCriteria?.dimensions || this.getDefaultDimensions();
    
    // 대화 분석을 통한 점수 계산
    const userMessages = conversationText.split('\n').filter(line => line.startsWith('사용자:'));
    
    // 시간 분석 추가 (conversation 객체에서 가져오거나 기본값 설정)
    let conversationDuration = 0;
    let averageResponseTime = 0;
    let timingAnalysis = null;
    
    if (conversation) {
      const now = new Date();
      const startTime = new Date(conversation.startTime);
      conversationDuration = Math.round((now.getTime() - startTime.getTime()) / 1000);
      
      if (userMessages.length > 0) {
        averageResponseTime = Math.round(conversationDuration / userMessages.length);
      }
      
      timingAnalysis = this.analyzeTimingPerformance(conversationDuration, averageResponseTime);
    }
    
    // 키워드 분석을 통한 기본 점수 조정
    const fullText = conversationText.toLowerCase();
    
    // 동적 평가 차원에 대해 점수 계산
    const scores: Record<string, number> = {};
    for (const dim of dimensions) {
      let score = Math.ceil((dim.minScore + dim.maxScore) / 2);
      
      // 대화 길이에 따른 보너스
      if (userMessages.length >= 5) score = Math.min(dim.maxScore, score + 1);
      
      // 키워드 분석 (기본 패턴)
      if (dim.key.toLowerCase().includes('clarity') || dim.key.toLowerCase().includes('logic')) {
        if (fullText.includes('구체적') || fullText.includes('명확')) {
          score = Math.min(dim.maxScore, score + 1);
        }
      }
      if (dim.key.toLowerCase().includes('empathy') || dim.key.toLowerCase().includes('listening')) {
        if (fullText.includes('이해') || fullText.includes('공감')) {
          score = Math.min(dim.maxScore, score + 1);
        }
      }
      
      scores[dim.key] = Math.min(dim.maxScore, Math.max(dim.minScore, score));
    }
    
    // 전체 점수 계산
    const totalWeight = dimensions.reduce((sum, d) => sum + d.weight, 0);
    const weightedSum = dimensions.reduce((sum, d) => sum + (scores[d.key] / d.maxScore) * d.weight, 0);
    const overallScore = Math.round((weightedSum / totalWeight) * 100);
    
    // 시나리오별 맞춤 피드백
    const scenarioFeedback = this.getScenarioSpecificFeedback(persona.id, overallScore);
    
    return {
      overallScore: Math.min(100, Math.max(0, overallScore)),
      scores: scores as any,
      strengths: scenarioFeedback.strengths,
      improvements: scenarioFeedback.improvements,
      nextSteps: scenarioFeedback.nextSteps,
      summary: scenarioFeedback.summary,
      conversationDuration: conversationDuration || 10,
      averageResponseTime: averageResponseTime || 30,
      timePerformance: timingAnalysis || { rating: 'average', feedback: '시간 정보 없음' },
      behaviorGuides: this.generateBehaviorGuides(persona.id, overallScore),
      conversationGuides: this.generateConversationGuides(persona.id, overallScore),
      ranking: "전문가 분석 결과를 바탕으로 한 종합 평가입니다.",
      developmentPlan: this.generateDevelopmentPlan(overallScore),
      evaluationCriteriaSetName: evaluationCriteria?.name
    };
  }
  
  private getScenarioSpecificFeedback(scenarioId: string, score: number): {
    strengths: string[],
    improvements: string[], 
    nextSteps: string[],
    summary: string
  } {
    const isGoodScore = score >= 75;
    const isAverageScore = score >= 50 && score < 75;
    
    switch (scenarioId) {
      case 'communication':
        return {
          strengths: isGoodScore 
            ? ["김태훈과의 의사소통이 원활함", "기술적 문제를 체계적으로 접근", "협력적 태도로 문제 해결"]
            : ["기본적인 대화 참여", "예의바른 소통", "문제 인식"],
          improvements: isGoodScore
            ? ["더 구체적인 기술 세부사항 논의", "대안 제시 능력 강화", "시간 관리 개선"]
            : ["더 적극적인 질문", "구체적인 해결책 제시", "기술적 이해도 향상"],
          nextSteps: isGoodScore
            ? ["복잡한 기술 협상 시나리오 도전", "팀 리더십 스킬 개발", "고급 커뮤니케이션 기법 학습"]
            : ["기본 기술 지식 보완", "질문 기법 연습", "능동적 듣기 스킬 향상"],
          summary: isGoodScore
            ? "김태훈과의 기술적 소통에서 우수한 성과를 보였습니다. 협력적 문제 해결 능력이 돋보입니다."
            : isAverageScore
            ? "김태훈과의 소통에서 기본기는 갖추었으나 더 적극적인 참여가 필요합니다."
            : "김태훈과의 기술 논의에서 소극적인 모습을 보였습니다. 기본 소통 스킬부터 개선이 필요합니다."
        };
      
      default:
        return {
          strengths: ["기본적인 대화 능력", "적절한 언어 사용", "상황 이해도"],
          improvements: ["더 구체적인 표현", "감정 교감 증진", "논리적 구조화"],
          nextSteps: ["추가 연습 필요", "전문가 피드백 받기", "실무 경험 쌓기"],
          summary: "전반적으로 무난한 대화였습니다. 지속적인 연습을 통해 발전할 수 있습니다."
        };
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
      evaluationCriteriaSetName: evaluationCriteria?.name
    };
  }

  // 🔧 누락된 가이드 생성 함수들 추가
  private generateBehaviorGuides(scenarioId: string, score: number) {
    const guides = [
      {
        situation: "전문적 대화 상황",
        action: "명확하고 논리적인 의사소통을 지향하세요",
        example: "구체적인 사례와 데이터를 바탕으로 설명드리겠습니다",
        impact: "신뢰성 향상 및 효과적인 의사결정 지원"
      }
    ];
    
    if (score < 50) {
      guides.push({
        situation: "어려운 대화 상황",
        action: "상대방의 입장을 먼저 이해하려 노력하세요",
        example: "그런 점에서 우려하시는 거군요. 어떤 부분이 가장 걱정되시나요?",
        impact: "갈등 해결과 상호 신뢰 구축"
      });
    }
    
    return guides;
  }

  private generateConversationGuides(scenarioId: string, score: number) {
    const guides = [
      {
        scenario: "업무 협의 상황",
        goodExample: "사실에 기반한 논리적 설명과 상대방 입장 고려",
        badExample: "일방적 주장이나 감정적 대응",
        keyPoints: ["명확한 의사표현", "상호 존중", "건설적 피드백"]
      }
    ];
    
    if (score < 60) {
      guides.push({
        scenario: "갈등 상황 대응",
        goodExample: "침착하게 경청하고 공동의 해결책 모색",
        badExample: "방어적 자세나 비난적 반응",
        keyPoints: ["감정 공감", "문제 초점 지향", "위치 파악"]
      });
    }
    
    return guides;
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

  // 시간 기반 성능 분석 함수
  private analyzeTimingPerformance(conversationDuration: number, averageResponseTime: number): { rating: 'excellent' | 'good' | 'average' | 'slow'; feedback: string } {
    // 대화 효율성 평가
    let rating: 'excellent' | 'good' | 'average' | 'slow' = 'average';
    let feedback = '';
    
    if (conversationDuration <= 600 && averageResponseTime <= 30) { // 10분 = 600초
      rating = 'excellent';
      feedback = '매우 효율적이고 신속한 대화 진행';
    } else if (conversationDuration <= 900 && averageResponseTime <= 45) { // 15분 = 900초
      rating = 'good';
      feedback = '적절한 대화 속도와 반응 시간 유지';
    } else if (conversationDuration <= 1500 && averageResponseTime <= 60) { // 25분 = 1500초
      rating = 'average';
      feedback = '평균적인 대화 진행 속도';
    } else {
      rating = 'slow';
      feedback = '대화 속도 및 반응 시간 개선이 필요';
    }
    
    console.log(`⏱️ 시간 분석 - 대화: ${conversationDuration}초, 평균응답: ${averageResponseTime}초, 평가: ${rating}`);
    
    return { rating, feedback };
  }
}