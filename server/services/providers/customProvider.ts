import type { ConversationMessage, DetailedFeedback } from "@shared/schema";
import type { AIServiceInterface, ScenarioPersona, AIServiceConfig } from "../aiService";

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

      const prompt = userMessage || "대화를 시작해주세요.";

      // 테스트 모드 확인 (실제 API 서버 없이 Mock 응답)
      if (this.config.apiKey === 'test-key') {
        console.log('🧪 Custom provider running in test mode');
        const mockResponses = [
          `안녕하세요, ${persona.name}입니다. ${userMessage ? `"${userMessage}"에 대해` : ''} 말씀드리겠습니다.`,
          `${persona.name}로서 ${userMessage ? `귀하의 "${userMessage}" 질문에` : ''} 성실히 답변드리겠습니다.`,
          `좋은 지적이세요. ${persona.name}의 입장에서 ${userMessage || '이 상황'}에 대해 설명드리겠습니다.`
        ];
        const content = mockResponses[Math.floor(Math.random() * mockResponses.length)];
        
        // Mock 응답에 감정 추가
        let emotion = "중립";
        let emotionReason = "테스트 모드에서의 기본 감정";
        
        if (userMessage && userMessage.includes('문제')) {
          emotion = "분노";
          emotionReason = "문제 상황에 대한 우려";
        } else if (userMessage && (userMessage.includes('감사') || userMessage.includes('좋'))) {
          emotion = "기쁨";
          emotionReason = "긍정적인 반응에 대한 만족";
        }
        
        return { content, emotion, emotionReason };
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

      // 테스트 모드이거나 커스텀 API 형식일 때 기본 피드백 반환
      if (this.config.apiKey === 'test-key' || this.config.apiFormat === 'custom') {
        console.log('🧪 Custom provider feedback in test/custom mode');
        return this.generateCustomFeedback(conversationText, persona);
      }

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

  private generateCustomFeedback(conversationText: string, persona: ScenarioPersona): DetailedFeedback {
    console.log('📊 Generating custom feedback based on conversation analysis');
    
    // 대화 분석을 통한 점수 계산
    const userMessages = conversationText.split('\n').filter(line => line.startsWith('사용자:'));
    const aiMessages = conversationText.split('\n').filter(line => line.startsWith(persona.name + ':'));
    
    // 기본 점수 설정
    let clarityScore = 3;
    let empathyScore = 3;
    let responsivenessScore = 3;
    let structureScore = 3;
    let professionalismScore = 3;
    
    // 대화 길이에 따른 구조화 점수
    if (userMessages.length >= 5) {
      structureScore = 4; // 충분한 대화량
    }
    if (userMessages.length >= 8) {
      structureScore = 5; // 풍부한 대화
    }
    
    // 키워드 분석을 통한 점수 조정
    const fullText = conversationText.toLowerCase();
    
    // 명확성 분석
    if (fullText.includes('구체적') || fullText.includes('자세히') || fullText.includes('명확')) {
      clarityScore = Math.min(5, clarityScore + 1);
    }
    
    // 공감 능력 분석
    if (fullText.includes('이해') || fullText.includes('공감') || fullText.includes('마음') || fullText.includes('느낌')) {
      empathyScore = Math.min(5, empathyScore + 1);
    }
    
    // 반응성 분석
    if (fullText.includes('빠르게') || fullText.includes('즉시') || fullText.includes('신속')) {
      responsivenessScore = Math.min(5, responsivenessScore + 1);
    }
    
    // 전문성 분석
    if (fullText.includes('전문') || fullText.includes('경험') || fullText.includes('기술') || fullText.includes('해결')) {
      professionalismScore = Math.min(5, professionalismScore + 1);
    }
    
    // 부정적 키워드 검출시 점수 감점
    if (fullText.includes('모르겠') || fullText.includes('어려워') || fullText.includes('힘들어')) {
      clarityScore = Math.max(1, clarityScore - 1);
      professionalismScore = Math.max(1, professionalismScore - 1);
    }
    
    // 전체 점수 계산 (가중 평균)
    const overallScore = Math.round(
      (clarityScore * 0.25 + empathyScore * 0.20 + responsivenessScore * 0.25 + 
       structureScore * 0.20 + professionalismScore * 0.10) * 20
    );
    
    // 시나리오별 맞춤 피드백
    const scenarioFeedback = this.getScenarioSpecificFeedback(persona.id, overallScore);
    
    return {
      overallScore: Math.min(100, Math.max(0, overallScore)),
      scores: {
        clarity: clarityScore,
        empathy: empathyScore,
        responsiveness: responsivenessScore,
        structure: structureScore,
        professionalism: professionalismScore
      },
      strengths: scenarioFeedback.strengths,
      improvements: scenarioFeedback.improvements,
      nextSteps: scenarioFeedback.nextSteps,
      summary: scenarioFeedback.summary
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