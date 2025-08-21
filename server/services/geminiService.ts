import { GoogleGenAI } from "@google/genai";
import type { ConversationMessage, EvaluationScore, DetailedFeedback } from "@shared/schema";

// Using Google Gemini AI API  
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

// 감정 분류 매핑
const emotionEmojis: { [key: string]: string } = {
  '기쁨': '😊',
  '슬픔': '😢',
  '분노': '😠',
  '놀람': '😲',
  '중립': '😐'
};

export interface ScenarioPersona {
  id: string;
  name: string;
  role: string;
  personality: string;
  responseStyle: string;
  goals: string[];
  background: string;
}

const SCENARIO_PERSONAS: Record<string, ScenarioPersona> = {
  communication: {
    id: "communication",
    name: "김태훈",
    role: "선임 책임자 · 7년차",
    personality: "실무 경험이 풍부하고 일정 관리에 민감함. 현실적이고 실용적인 해결책을 선호하며, 리스크를 최소화하려 함.",
    responseStyle: "현실적인 제약사항을 강조하며 양산 일정의 중요성을 언급함. 구체적인 해결 방안을 요구하고 성과 지향적인 태도를 보임.",
    goals: ["논리적 문제 제기 능력 평가", "현실적 해결책 제시 능력 확인", "조직 내 협상 및 설득 능력 테스트"],
    background: "스마트폰 개발 7년차로 다양한 하드웨어 이슈와 양산 경험이 풍부함. 품질과 일정 사이의 균형을 중시하며, 신입 개발자들이 현실적인 업무 처리 능력을 갖추길 원함."
  },
  empathy: {
    id: "empathy",
    name: "이선영",
    role: "팀장 · 10년차",
    personality: "평소에는 차분하지만 스트레스 상황에서 감정적으로 반응함. 팀원들에 대한 책임감이 강하지만 때로는 과도한 부담을 느낌.",
    responseStyle: "감정이 앞서는 표현을 사용하며, 공감과 이해를 필요로 함. 해결책보다는 먼저 감정적 지지를 원함.",
    goals: ["공감 능력 테스트", "감정적 상황 대처 능력 평가", "갈등 해결 스킬 확인"],
    background: "10년간 팀을 이끌며 많은 성과를 거두었지만, 최근 업무 압박과 팀 관리의 어려움으로 스트레스가 많은 상황."
  },
  negotiation: {
    id: "negotiation",
    name: "박준호",
    role: "클라이언트 · 대표이사",
    personality: "비즈니스 중심적이고 실용적임. 명확한 이익과 결과를 중시하며, 협상에서 우위를 점하려 함.",
    responseStyle: "요구사항을 강하게 제시하며, 타협점을 찾기 위한 전략적 접근을 선호함. 비용과 일정에 대해 까다로움.",
    goals: ["협상 능력 평가", "설득력 테스트", "압박 상황 대응력 확인"],
    background: "성공한 기업의 대표로서 다양한 협상 경험이 풍부함. 효율성과 수익성을 최우선으로 생각함."
  },
  presentation: {
    id: "presentation",
    name: "정미경",
    role: "임원 · 15년차",
    personality: "분석적이고 세심함. 디테일에 강하며 날카로운 질문을 통해 본질을 파악하려 함.",
    responseStyle: "예상치 못한 각도에서 질문하며, 준비되지 않은 답변에 대해서는 추가 설명을 요구함.",
    goals: ["프레젠테이션 스킬 평가", "압박 질문 대응 능력 확인", "논리적 설명 능력 테스트"],
    background: "15년간 경영진으로 활동하며 수많은 프레젠테이션을 평가해온 경험이 있음."
  },
  feedback: {
    id: "feedback",
    name: "최민수",
    role: "후배 사원 · 1년차",
    personality: "성실하지만 자신감이 부족함. 실수를 반복하는 경향이 있으며, 건설적인 피드백을 받으면 개선하려고 노력함.",
    responseStyle: "방어적으로 반응할 수 있지만, 적절한 접근 시 수용적임. 구체적인 가이드라인을 선호함.",
    goals: ["피드백 전달 능력 평가", "멘토링 스킬 확인", "건설적인 소통 능력 테스트"],
    background: "1년차 신입사원으로 열심히 하려고 하지만 경험 부족으로 실수가 잦음."
  },
  crisis: {
    id: "crisis",
    name: "한지연",
    role: "프로젝트 매니저 · 8년차",
    personality: "평소에는 냉정하지만 위기 상황에서는 스트레스를 받음. 빠른 해결책을 원하며, 책임 소재에 민감함.",
    responseStyle: "긴급함을 강조하며, 즉각적인 대응을 요구함. 시간 압박 상황에서 감정적으로 될 수 있음.",
    goals: ["위기 관리 능력 평가", "빠른 의사결정 능력 확인", "스트레스 상황 대처 능력 테스트"],
    background: "8년간 다양한 프로젝트를 관리하며 위기 상황을 여러 번 경험함. 현재 중요한 프로젝트의 위기 상황에 직면."
  }
};

// 감정 분석을 위한 인터페이스
interface EmotionAnalysis {
  emotion: string;
  reason: string;
  response: string;
}

// 감정 분석 함수
async function analyzeEmotion(
  persona: ScenarioPersona,
  userMessage: string,
  aiResponse: string,
  conversationHistory: ConversationMessage[]
): Promise<{ emotion: string; emotionReason: string }> {
  console.log("Analyzing emotion for:", persona.name);
  try {
    const conversationContext = conversationHistory
      .slice(-3) // 최근 3턴만 참고
      .map(msg => `${msg.sender === 'user' ? '사용자' : persona.name}: ${msg.message}`)
      .join('\n');

    const emotionPrompt = `${persona.name}의 감정을 판단하세요.

사용자: ${userMessage}
AI응답: ${aiResponse}

감정 목록: 기쁨, 슬픔, 분노, 놀람, 중립
이유는 10자 이내로 간단히.

JSON으로만 응답:
{"emotion": "슬픔", "reason": "스트레스"}`;

    const response = await genAI.models.generateContent({
      model: "gemini-1.5-flash",
      contents: [{ role: "user", parts: [{ text: emotionPrompt }] }],
      config: {
        maxOutputTokens: 50,
        temperature: 0.1,
      }
    });

    let emotionText = "";
    if (response.candidates && response.candidates[0]) {
      const candidate = response.candidates[0];
      if (candidate.content && candidate.content.parts && candidate.content.parts[0]) {
        emotionText = candidate.content.parts[0].text || "";
      }
    }

    if (emotionText) {
      console.log("Raw emotion response:", emotionText);
      try {
        // JSON 코드블록 제거 처리
        let cleanEmotionJson = emotionText.trim();
        
        if (cleanEmotionJson.includes('```json')) {
          const jsonMatch = cleanEmotionJson.match(/```json\s*([\s\S]*?)\s*```/);
          if (jsonMatch) {
            cleanEmotionJson = jsonMatch[1].trim();
          } else {
            cleanEmotionJson = cleanEmotionJson.replace(/```json\s*/g, '').replace(/```\s*$/g, '');
          }
        }
        
        // JSON이 아닌 텍스트 제거
        const jsonStart = cleanEmotionJson.indexOf('{');
        const jsonEnd = cleanEmotionJson.lastIndexOf('}');
        
        if (jsonStart >= 0 && jsonEnd > jsonStart) {
          cleanEmotionJson = cleanEmotionJson.substring(jsonStart, jsonEnd + 1);
        }
        
        console.log("Cleaned emotion JSON:", cleanEmotionJson);
        
        const emotionData: EmotionAnalysis = JSON.parse(cleanEmotionJson);
        console.log("Parsed emotion data:", emotionData);
        
        return {
          emotion: emotionData.emotion || '중립',
          emotionReason: emotionData.reason || ''
        };
      } catch (parseError) {
        console.log("Emotion JSON parsing failed:", parseError);
        console.log("Failed text:", emotionText.substring(0, 200));
      }
    }
  } catch (error) {
    console.error("Emotion analysis error:", error);
  }

  // 폴백: 페르소나별 기본 감정
  const defaultEmotions: { [key: string]: string } = {
    'communication': '중립',
    'empathy': '슬픔',
    'negotiation': '중립',
    'presentation': '중립',
    'feedback': '놀람',
    'crisis': '분노'
  };

  return {
    emotion: defaultEmotions[persona.id] || '중립',
    emotionReason: `${persona.name}의 기본 감정 상태`
  };
}

export async function generateAIResponse(
  scenarioId: string,
  conversationHistory: ConversationMessage[],
  turnCount: number,
  userMessage?: string
): Promise<{ response: string; emotion?: string; emotionReason?: string }> {
  const persona = SCENARIO_PERSONAS[scenarioId];
  if (!persona) {
    throw new Error(`Unknown scenario: ${scenarioId}`);
  }

  const conversationContext = conversationHistory
    .map(msg => `${msg.sender === 'user' ? '사용자' : persona.name}: ${msg.message}`)
    .join('\n');

  // 김태훈 시나리오의 특별한 미션 컨텍스트
  const getMissionContext = (scenarioId: string, turnCount: number): string => {
    if (scenarioId === "communication") {
      return `
🎯 **미션 상황**: "노이즈 문제, 이대로 출시해도 될까요?"

**배경**: 스마트폰 통화 품질 테스트 중 마이크 모듈에서 특정 주파수 대역에서 노이즈(지지직 소리)가 감지됨. 
사양서 기준은 만족하지만 실사용에서 불편함이 예상되는 상황.

**제약**: 양산 스케줄이 촉박하며, 선임 책임자는 일정 준수를 우선시하는 입장.

**목표**: 신입 개발자(사용자)가 발견한 이슈를 선임 책임자에게 설득하여 개선을 위한 반영 혹은 협의된 검증 계획을 이끌어내는 것.

**평가 포인트**:
- 논리적 설명 능력 (문제를 명확하게 제시)
- 설득력 있는 커뮤니케이션 (일정 제약 고려한 현실적 해결책 제시)
- 조직 내 협상 능력 (권한 밖 요청을 적절히 처리)
- 현실적인 협상 (회의 안건화, 리스크 최소화 등)

**현재 턴**: ${turnCount}/10`;
    }
    return "";
  };

  const systemPrompt = `당신은 ${persona.name}(${persona.role})입니다.

성격: ${persona.personality}

대화 스타일: ${persona.responseStyle}

배경: ${persona.background}

${getMissionContext(scenarioId, turnCount)}

이 역할을 완벽히 수행하여 사용자와 대화하세요. 
- 일관된 성격과 말투를 유지하세요
- 현실적이고 자연스러운 대화를 하세요
- 사용자의 커뮤니케이션 능력을 평가할 수 있는 상황을 만드세요
- 한국어로 대화하세요
- 응답은 2-3문장으로 간결하게 하세요`;

  // 첫 번째 메시지인지 확인
  const isFirstMessage = conversationHistory.length === 0;
  
  let userPrompt = "";
  if (isFirstMessage) {
    // 김태훈 시나리오의 첫 번째 메시지
    if (scenarioId === "communication") {
      userPrompt = `🎯 **미션 상황 설명**: 
당신은 스마트폰 개발팀의 신입 개발자입니다. 오늘 새로 출시 예정인 스마트폰 모델의 마이크 모듈 품질 테스트를 진행하던 중, 특정 주파수 대역에서 "지지직" 하는 노이즈 소리가 반복적으로 발생하는 것을 발견했습니다.

사양서상 기준은 통과하지만, 실제 통화 시 사용자가 불편함을 느낄 수 있는 수준입니다. 하지만 현재 양산 일정이 매우 촉박한 상황입니다.

이 문제를 김태훈 선임 책임자에게 보고해야 하는데, 그는 지금 양산 스케줄 점검으로 매우 바쁜 상태입니다.

**당신의 목표**: 선임 책임자를 설득하여 이 문제에 대한 적절한 검증 계획을 수립하거나 해결 방안을 도출해내는 것입니다.

김태훈 선임 책임자의 첫 반응을 들어보세요:

"(양산 일정표를 보며 바쁜 모습으로) 아, 신입이군요. 지금 정말 바쁜데 무슨 일인가요? 혹시 마이크 모듈 테스트 관련해서 뭔가 있나요? 간단명료하게 말씀해주세요."`;
    } else {
      userPrompt = `${persona.name}의 입장에서 신입사원과의 첫 만남 인사를 해주세요.`;
    }
  } else {
    userPrompt = `다음은 지금까지의 대화입니다:

${conversationContext}

위 맥락을 바탕으로 ${persona.name}의 입장에서 자연스럽게 응답해주세요.`;
  }

  try {
    console.log("Attempting Gemini API call...");
    
    const prompt = `시스템 지시사항: ${systemPrompt}

사용자 메시지: ${userPrompt}`;

    const response = await genAI.models.generateContent({
      model: "gemini-1.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        maxOutputTokens: 200,
        temperature: 0.8,
      }
    });

    console.log("✓ Gemini API call completed");
    
    let generatedText = "";
    
    // Access response from candidates array
    if (response.candidates && response.candidates[0]) {
      const candidate = response.candidates[0];
      if (candidate.content && candidate.content.parts && candidate.content.parts[0]) {
        generatedText = candidate.content.parts[0].text || "";
      }
    }
    
    console.log("Generated text:", generatedText);
    
    if (generatedText && generatedText.length > 0) {
      console.log("✓ Gemini API response received successfully");
      
      // 감정 분석 수행 (userMessage가 있을 때만)
      console.log("UserMessage check:", userMessage ? "exists" : "missing");
      if (userMessage) {
        console.log("Starting emotion analysis for:", userMessage.substring(0, 50));
        try {
          const emotionResult = await analyzeEmotion(persona, userMessage, generatedText, conversationHistory);
          console.log("Emotion analysis completed:", emotionResult);
          return {
            response: generatedText,
            emotion: emotionResult.emotion,
            emotionReason: emotionResult.emotionReason
          };
        } catch (emotionError) {
          console.log("Emotion analysis failed:", emotionError);
        }
      } else {
        console.log("No userMessage provided, skipping emotion analysis");
      }
      
      return { response: generatedText };
    }
    
    throw new Error("Empty response from Gemini API");
  } catch (error) {
    console.error("Gemini API Error:", error);
    
    // 폴백 더미 응답 - 스마트폰 개발 미션 기반
    const dummyResponses: Record<string, string[]> = {
      communication: turnCount === 0 ? [
        "(양산 일정표를 보며 바쁜 모습으로) 아, 신입이군요. 지금 정말 바쁜데 무슨 일인가요? 혹시 마이크 모듈 테스트 관련해서 뭔가 있나요? 간단명료하게 말씀해주세요."
      ] : [
        "음... 그거 사양서 기준 벗어난 건 아니지 않아요? 지금 양산 일정 촉박한 거 알죠?",
        "재현이 된다면, 로그 남겨서 회의에 올릴 수는 있겠죠. 단, 기존 일정 영향 없게 진행 가능한지 체크 먼저 해주세요.",
        "그건 우리가 먼저 내부 검증 명확히 하고 말해야 돼요. 공급사랑 섣불리 이야기하면 일정에 타격 커요."
      ],
      empathy: [
        "저도 반갑습니다. 그런데 솔직히 말씀드리면 요즘 업무 스트레스가 많아서... 새로운 팀원이 들어오는 것도 걱정이 되네요.",
        "아니에요, 당신 탓이 아니라 전체적인 상황이 그런 거예요. 최근에 프로젝트 일정이 너무 빡빡해서 팀 전체가 힘들어하고 있거든요.",
        "고마워요. 그런 마음가짐이라면 잘 해낼 수 있을 것 같아요. 다만 처음엔 실수할 수도 있으니까 너무 부담 갖지 마세요."
      ],
      negotiation: [
        "박준호입니다. 바쁜 시간에 시간 내주셔서 감사합니다. 그런데 솔직히 말씀드리면, 현재 제안해주신 조건들이 우리 예산과 맞지 않아서 걱정이네요.",
        "네, 이해합니다. 하지만 우리 입장에서는 품질과 비용 효율성 둘 다 중요합니다. 다른 대안은 없을까요?",
        "흥미로운 제안이네요. 구체적인 수치와 일정을 다시 한 번 정리해서 제시해주실 수 있나요?"
      ]
    };
    
    console.log("Using fallback dummy response");
    const responses = dummyResponses[scenarioId] || dummyResponses.communication;
    const responseIndex = Math.max(0, Math.min(turnCount - 1, responses.length - 1));
    const fallbackResponse = responses[responseIndex] || "네, 알겠습니다. 계속 진행해보죠.";
    
    // 폴백 감정도 포함
    if (userMessage) {
      console.log("Using fallback emotion for:", persona.name);
      const defaultEmotions: { [key: string]: string } = {
        'communication': '중립',
        'empathy': '슬픔', 
        'negotiation': '중립',
        'presentation': '중립',
        'feedback': '놀람',
        'crisis': '분노'
      };
      
      return {
        response: fallbackResponse,
        emotion: defaultEmotions[scenarioId] || '중립',
        emotionReason: `${persona.name}의 기본 감정 상태`
      };
    }
    
    return { response: fallbackResponse };
  }
}

export async function generateFeedback(
  scenarioId: string,
  conversationHistory: ConversationMessage[]
): Promise<{ overallScore: number; scores: EvaluationScore[]; detailedFeedback: DetailedFeedback }> {
  console.log("피드백 생성 시작 - 시나리오:", scenarioId, "메시지 수:", conversationHistory.length);
  
  const persona = SCENARIO_PERSONAS[scenarioId];
  if (!persona) {
    console.error("알 수 없는 시나리오:", scenarioId);
    throw new Error(`Unknown scenario: ${scenarioId}`);
  }

  const conversationText = conversationHistory
    .map(msg => `${msg.sender === 'user' ? '사용자' : persona.name}: ${msg.message}`)
    .join('\n');

  const evaluationPrompt = `다음은 신입사원(사용자)과 ${persona.name}(${persona.role}) 간의 역할극 대화입니다:

${conversationText}

**중요: 사용자(신입사원)의 커뮤니케이션 능력만을 평가해주세요. ${persona.name}의 대화는 평가 대상이 아닙니다.**

사용자의 대화에서 나타난 다음 요소들을 ComOn Check 연구 기반 커뮤니케이션 평가 프레임워크로 분석해주세요:
- 사용자가 얼마나 명확하고 체계적으로 의사를 전달했는가
- 상대방(${persona.name})의 상황과 성격을 고려한 맞춤형 소통을 했는가  
- 대화 상대의 감정 변화를 인식하고 적절히 반응했는가
- 논리적이고 구조화된 대화 흐름을 만들어갔는가
- 전문적이고 업무에 적합한 커뮤니케이션을 보여줬는가

반드시 아래 JSON 형식으로만 응답하세요:
{
  "overallScore": 75,
  "scores": [
    {
      "category": "message_clarity",
      "name": "메시지 명확성",
      "score": 3,
      "feedback": "구체적 피드백 내용",
      "icon": "fas fa-bullseye",
      "color": "blue"
    },
    {
      "category": "audience_adaptation", 
      "name": "상대방 배려",
      "score": 2,
      "feedback": "구체적 피드백 내용",
      "icon": "fas fa-users",
      "color": "green"
    },
    {
      "category": "emotional_responsiveness",
      "name": "감정적 반응성", 
      "score": 4,
      "feedback": "구체적 피드백 내용",
      "icon": "fas fa-heart",
      "color": "red"
    },
    {
      "category": "conversation_structure",
      "name": "대화 구조화",
      "score": 3, 
      "feedback": "구체적 피드백 내용",
      "icon": "fas fa-list-ol",
      "color": "purple"
    },
    {
      "category": "professional_competence",
      "name": "전문적 역량",
      "score": 2,
      "feedback": "구체적 피드백 내용",
      "icon": "fas fa-briefcase", 
      "color": "orange"
    }
  ],
  "detailedFeedback": {
    "strengths": ["관찰된 구체적 강점들"],
    "improvements": ["측정 가능한 개선점들"],
    "nextSteps": ["실행 가능한 다음 단계들"],
    "ranking": "백분위 기반 순위",
    "behaviorGuides": [
      {
        "situation": "상급자 보고 상황",
        "action": "구체적인 데이터와 함께 간결하게 핵심만 전달하기",
        "example": "프로젝트 진행률 85%, 예상 지연 2일입니다. 원인은 외부 API 연동 이슈이며, 대안책으로 임시 솔루션을 적용해 일정을 맞추겠습니다.",
        "impact": "신뢰감 향상과 효율적인 의사결정 지원"
      }
    ],
    "conversationGuides": [
      {
        "scenario": "어려운 상황을 상급자에게 보고할 때",
        "goodExample": "문제 상황과 원인을 명확히 설명하고, 해결방안과 일정을 구체적으로 제시",
        "badExample": "문제만 나열하거나 책임 회피성 발언",
        "keyPoints": ["사실 기반 설명", "해결방안 제시", "명확한 일정 약속", "필요한 지원사항 요청"]
      }
    ],
    "developmentPlan": {
      "shortTerm": [
        {
          "goal": "메시지 구조화 능력 향상",
          "actions": ["PREP 기법 연습", "일일 업무 보고 시 구조화 적용"],
          "measurable": "1주일 내 보고서/이메일 작성 시 PREP 구조 100% 적용"
        }
      ],
      "mediumTerm": [
        {
          "goal": "상황별 맞춤 커뮤니케이션 스타일 개발",
          "actions": ["다양한 상황별 대화 시뮬레이션", "피드백 수집 및 개선"],
          "measurable": "1개월 내 5가지 상황별 대화 패턴 정립"
        }
      ],
      "longTerm": [
        {
          "goal": "리더십 커뮤니케이션 역량 구축",
          "actions": ["프레젠테이션 스킬 향상", "팀 내 의견 조율 역할 경험"],
          "measurable": "3개월 내 팀 내 소규모 프로젝트 리딩 경험"
        }
      ],
      "recommendedResources": [
        "도서: 『논리적 글쓰기』- 구조화된 의사소통 기법",
        "온라인 강의: 직장인 커뮤니케이션 실전 과정",
        "실습: 토스트마스터즈 클럽 참여",
        "멘토링: 사내 커뮤니케이션 우수자와의 정기 면담"
      ]
    }
  }
}

과학적 평가 기준 (ComOn Check 5점 척도):
1점 (20점): 미흡 - 기본 요구사항 충족 안됨
2점 (40점): 발전 필요 - 일부 요소는 보이나 일관성 부족  
3점 (60점): 보통 - 기대 수준을 충족
4점 (80점): 우수 - 기대를 초과하는 성과
5점 (100점): 탁월 - 모든 영역에서 뛰어난 역량

측정 지표:
- 메시지 명확성: 논리적 구조, 핵심 전달력, 언어 적절성
- 상대방 배려: 상황 인식, 니즈 파악, 맞춤형 소통
- 감정적 반응성: 공감 표현, 감정 인식, 적절한 반응
- 대화 구조화: 순서와 흐름, 주도권, 마무리
- 전문적 역량: 업무 적합성, 목표 달성도, 결과 지향

전체 점수 = (각 항목 점수 합계 ÷ 5) × 20`;

  try {
    console.log("Attempting Gemini API call for feedback...");
    
    const response = await genAI.models.generateContent({
      model: "gemini-1.5-flash",
      contents: [{ role: "user", parts: [{ text: evaluationPrompt }] }],
      config: {
        maxOutputTokens: 2000,
        temperature: 0.3,
      }
    });

    console.log("✓ Gemini feedback API call completed");
    
    let generatedText = "";
    
    // Access response from candidates array
    if (response.candidates && response.candidates[0]) {
      const candidate = response.candidates[0];
      if (candidate.content && candidate.content.parts && candidate.content.parts[0]) {
        generatedText = candidate.content.parts[0].text || "";
      }
    }
    
    console.log("Generated feedback text length:", generatedText.length);
    
    if (generatedText && generatedText.length > 0) {
      console.log("✓ Gemini feedback API response received successfully");
      try {
        console.log("Raw Gemini feedback response:", generatedText.substring(0, 200) + "...");
        
        // ```json 형식으로 감싸진 응답 처리
        let cleanJson = generatedText.trim();
        
        // JSON 코드블록 제거
        if (cleanJson.includes('```json')) {
          const jsonMatch = cleanJson.match(/```json\s*([\s\S]*?)\s*```/);
          if (jsonMatch) {
            cleanJson = jsonMatch[1].trim();
          } else {
            // ```json으로 시작하지만 닫는 ```가 없는 경우
            cleanJson = cleanJson.replace(/```json\s*/g, '').replace(/```\s*$/g, '');
          }
        }
        
        // 일반 ``` 코드블록 제거
        if (cleanJson.includes('```')) {
          cleanJson = cleanJson.replace(/```[\s\S]*?```/g, '').trim();
        }
        
        // JSON이 아닌 텍스트가 앞/뒤에 있는 경우 제거
        const jsonStart = cleanJson.indexOf('{');
        const jsonEnd = cleanJson.lastIndexOf('}');
        
        if (jsonStart >= 0 && jsonEnd > jsonStart) {
          cleanJson = cleanJson.substring(jsonStart, jsonEnd + 1);
        }
        
        // 불완전한 JSON 처리 - 마지막 완전한 객체까지만 파싱
        if (!cleanJson.endsWith('}')) {
          const lastBraceIndex = cleanJson.lastIndexOf('}');
          if (lastBraceIndex > 0) {
            cleanJson = cleanJson.substring(0, lastBraceIndex + 1);
          }
        }
        
        console.log("Cleaned JSON for parsing:", cleanJson.substring(0, 200) + "...");
        
        const result = JSON.parse(cleanJson);
        // 확장된 피드백 구조 지원
        const detailedFeedback = result.detailedFeedback || {};
        return {
          overallScore: result.overallScore || 85,
          scores: result.scores || [],
          detailedFeedback: {
            strengths: detailedFeedback.strengths || [],
            improvements: detailedFeedback.improvements || [],
            nextSteps: detailedFeedback.nextSteps || [],
            ranking: detailedFeedback.ranking || "",
            behaviorGuides: detailedFeedback.behaviorGuides || [],
            conversationGuides: detailedFeedback.conversationGuides || [],
            developmentPlan: detailedFeedback.developmentPlan || {
              shortTerm: [],
              mediumTerm: [],
              longTerm: [],
              recommendedResources: []
            }
          }
        };
      } catch (parseError) {
        console.error("JSON parsing failed:", parseError);
        console.log("Attempting fallback feedback generation...");
        
        // 폴백: 구조화된 기본 피드백 생성
        return generateFallbackFeedback(scenarioId, conversationHistory);
      }
    }
    
    throw new Error("Empty feedback response from Gemini API");
  } catch (error) {
    console.error("Gemini Feedback API Error:", error);
    console.log("Using fallback feedback due to API error");
    return generateFallbackFeedback(scenarioId, conversationHistory);
  }
}

// 폴백 피드백 생성 함수
function generateFallbackFeedback(
  scenarioId: string,
  conversationHistory: ConversationMessage[]
): { overallScore: number; scores: EvaluationScore[]; detailedFeedback: DetailedFeedback } {
  console.log("Generating fallback feedback for scenario:", scenarioId);
  
  const userMessages = conversationHistory.filter(msg => msg.sender === 'user');
  const messageCount = userMessages.length;
  
  // 기본 점수 계산 (메시지 길이와 수를 기반으로)
  let baseScore = Math.min(85, 40 + (messageCount * 8)); // 최대 85점
  
  // 키워드 기반 점수 조정
  const allUserText = userMessages.map(msg => msg.message).join(' ').toLowerCase();
  
  const positiveKeywords = ['감사', '죄송', '도움', '이해', '노력', '개선', '발전', '학습'];
  const negativeKeywords = ['모르겠', '잘', '네', '그냥', '음'];
  
  const positiveCount = positiveKeywords.filter(keyword => allUserText.includes(keyword)).length;
  const negativeCount = negativeKeywords.filter(keyword => allUserText.includes(keyword)).length;
  
  baseScore += (positiveCount * 3) - (negativeCount * 2);
  baseScore = Math.max(45, Math.min(95, baseScore)); // 45-95 점 범위
  
  const scores: EvaluationScore[] = [
    {
      category: "message_clarity",
      name: "메시지 명확성",
      score: Math.min(5, Math.max(2, Math.round(baseScore / 20))),
      feedback: "대화에서 기본적인 의사전달이 이루어졌습니다. 더욱 구체적이고 명확한 표현을 연습해보세요.",
      icon: "fas fa-bullseye",
      color: "blue"
    },
    {
      category: "audience_adaptation",
      name: "상대방 배려",
      score: Math.min(5, Math.max(2, Math.round((baseScore + 5) / 20))),
      feedback: "상대방의 입장을 어느 정도 고려한 대화를 나누었습니다. 상황에 맞는 맞춤형 소통을 더 연습해보세요.",
      icon: "fas fa-users",
      color: "green"
    },
    {
      category: "emotional_responsiveness",
      name: "감정적 반응성",
      score: Math.min(5, Math.max(2, Math.round((baseScore - 5) / 20))),
      feedback: "기본적인 감정 인식은 보여주었습니다. 더 적극적인 공감 표현과 감정적 반응을 개발해보세요.",
      icon: "fas fa-heart",
      color: "red"
    },
    {
      category: "conversation_structure",
      name: "대화 구조화",
      score: Math.min(5, Math.max(2, Math.round(baseScore / 20))),
      feedback: "대화의 기본 구조는 유지했습니다. 더 체계적이고 논리적인 대화 흐름을 만들어보세요.",
      icon: "fas fa-list-ol",
      color: "purple"
    },
    {
      category: "professional_competence",
      name: "전문적 역량",
      score: Math.min(5, Math.max(2, Math.round((baseScore + 3) / 20))),
      feedback: "업무상 기본적인 소통은 가능합니다. 전문성을 보여줄 수 있는 구체적인 표현을 개발해보세요.",
      icon: "fas fa-briefcase",
      color: "orange"
    }
  ];
  
  const overallScore = Math.round((scores.reduce((sum, score) => sum + score.score, 0) / 5) * 20);
  
  const detailedFeedback: DetailedFeedback = {
    strengths: [
      "대화에 적극적으로 참여하여 소통 의지를 보여주었습니다",
      "예의바른 태도로 상대방을 존중하는 자세를 유지했습니다",
      "질문에 성실하게 응답하며 이해하려고 노력했습니다"
    ],
    improvements: [
      "더 구체적이고 논리적인 근거를 제시하여 설득력을 높여보세요",
      "상대방의 상황과 감정을 더욱 세심하게 배려해보세요", 
      "주도적인 질문과 제안으로 대화를 효과적으로 이끌어보세요"
    ],
    nextSteps: [
      "시나리오별 핵심 커뮤니케이션 기법을 학습하고 연습하세요",
      "다양한 상황에서의 적절한 응답 패턴을 익혀보세요",
      "실제 업무 환경에서 배운 기법들을 점진적으로 적용해보세요"
    ],
    ranking: `상위 ${100 - Math.round(overallScore)}%`,
    behaviorGuides: [
      {
        situation: "상급자에게 업무 진행사항 보고할 때",
        action: "구체적인 수치와 명확한 일정을 포함해 체계적으로 보고하기",
        example: "현재 진행률 80%이며, 금요일 완료 예정입니다. 지연 요소는 디자인 검토 단계로, 내일까지 완료하겠습니다.",
        impact: "신뢰성 확보 및 효율적인 업무 소통"
      }
    ],
    conversationGuides: [
      {
        scenario: "업무 문의 상황",
        goodExample: "명확한 질문과 배경 설명, 기대하는 답변의 방향 제시",
        badExample: "막연한 질문이나 준비되지 않은 문의",
        keyPoints: ["구체적인 상황 설명", "명확한 질문", "배경 정보 제공", "기대 결과 명시"]
      }
    ],
    developmentPlan: {
      shortTerm: [
        {
          goal: "메시지 구조화 능력 향상",
          actions: ["PREP 기법 학습 및 연습", "일일 업무 보고 시 구조화 적용"],
          measurable: "1주일 내 모든 업무 커뮤니케이션에 PREP 구조 적용"
        }
      ],
      mediumTerm: [
        {
          goal: "상황별 맞춤 커뮤니케이션 개발",
          actions: ["다양한 직급/상황별 대화 연습", "피드백 수집 및 개선"],
          measurable: "1개월 내 5가지 업무 상황별 표준 대화 패턴 확립"
        }
      ],
      longTerm: [
        {
          goal: "전문적 커뮤니케이션 역량 구축",
          actions: ["프레젠테이션 스킬 향상", "업무 관련 전문성 강화"],
          measurable: "3개월 내 팀 내 커뮤니케이션 우수 사례로 인정받기"
        }
      ],
      recommendedResources: [
        "도서: 『직장인 커뮤니케이션의 기술』",
        "온라인 강의: 비즈니스 커뮤니케이션 실전 과정",
        "실습: 사내 발표 기회 적극 활용",
        "멘토링: 커뮤니케이션 우수 선배와의 정기 면담"
      ]
    }
  };
  
  console.log("Fallback feedback generated successfully");
  return {
    overallScore,
    scores,
    detailedFeedback
  };
}

function generateOldFallbackFeedback() {
  // 기존 더미 피드백 (완전한 API 실패 시만 사용)
    return {
      overallScore: 75,
      scores: [
        {
          category: "communication",
          name: "커뮤니케이션 스킬",
          score: 2,
          feedback: "명확하고 논리적인 의사소통을 보여주셨습니다.",
          icon: "fas fa-comments",
          color: "blue"
        },
        {
          category: "empathy", 
          name: "공감 능력",
          score: 1,
          feedback: "상대방의 감정을 이해하려고 노력했지만 더 적극적인 공감 표현이 필요합니다.",
          icon: "fas fa-heart",
          color: "red"
        },
        {
          category: "problem_solving",
          name: "문제 해결력", 
          score: 2,
          feedback: "창의적이고 실현 가능한 해결책을 제시했습니다.",
          icon: "fas fa-lightbulb",
          color: "yellow"
        },
        {
          category: "negotiation",
          name: "협상 능력",
          score: 1, 
          feedback: "기본적인 협상 스킬은 보유하고 있으나 더 전략적인 접근이 필요합니다.",
          icon: "fas fa-handshake",
          color: "purple"
        },
        {
          category: "pressure_response",
          name: "압박 상황 대응",
          score: 2,
          feedback: "압박 상황에서도 침착함을 유지하고 논리적으로 대응했습니다.",
          icon: "fas fa-shield-alt", 
          color: "green"
        }
      ],
      detailedFeedback: {
        strengths: [
          "상대방의 문제 제기에 대해 방어적으로 반응하지 않고 경청하는 자세를 보였습니다.",
          "구체적인 데이터와 근거를 제시하여 신뢰성을 높였습니다."
        ],
        improvements: [
          "상대방의 감정 상태를 더 세심하게 파악하고 공감하는 표현을 늘려보세요.",
          "문제 해결책 제시 시 상대방의 입장에서 얻을 수 있는 이익을 더 강조해보세요."
        ],
        nextSteps: [
          "이선영 시나리오로 공감 능력을 더 집중적으로 훈련해보세요.",
          "실제 업무에서 비슷한 상황이 발생하면 오늘 학습한 내용을 적용해보세요."
        ],
        ranking: "상위 25% 수준의 커뮤니케이션 스킬을 보여주셨습니다.",
        behaviorGuides: [
          {
            situation: "상급자 보고 시",
            action: "핵심사항을 3개 이내로 정리하여 간결하게 전달",
            example: "진행상황, 이슈사항, 필요 지원을 순서대로 보고",
            impact: "효율적인 의사결정 지원"
          }
        ],
        conversationGuides: [
          {
            scenario: "업무 협의",
            goodExample: "목적과 기대결과를 먼저 공유한 후 세부사항 논의",
            badExample: "세부사항부터 나열하여 혼란 야기",
            keyPoints: ["목적 명확화", "상호 기대치 확인", "구체적 실행방안 합의"]
          }
        ],
        developmentPlan: {
          shortTerm: [
            {
              goal: "명확한 의사소통",
              actions: ["핵심 메시지 먼저 전달", "구체적 근거 제시"],
              measurable: "일주일간 보고/상담 시 구조화 적용"
            }
          ],
          mediumTerm: [
            {
              goal: "상황별 대응능력 향상",
              actions: ["다양한 상황 시뮬레이션", "피드백 수집"],
              measurable: "한 달 내 5가지 상황별 대응법 습득"
            }
          ],
          longTerm: [
            {
              goal: "리더십 커뮤니케이션",
              actions: ["팀 내 조율 역할", "프레젠테이션 기회 확대"],
              measurable: "분기별 팀 프로젝트 리딩 경험"
            }
          ],
          recommendedResources: [
            "커뮤니케이션 관련 도서 학습",
            "사내 커뮤니케이션 교육 참여",
            "멘토와의 정기 면담"
          ]
        }
      }
    };
}
