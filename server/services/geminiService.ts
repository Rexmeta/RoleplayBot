import { GoogleGenAI } from "@google/genai";
import type { ConversationMessage, EvaluationScore, DetailedFeedback } from "@shared/schema";

// Using Google Gemini AI API
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "" });

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
    role: "선임 연구원 · 7년차",
    personality: "까다롭고 완벽주의적이며 논리적 사고를 중시함. 감정적인 접근보다는 데이터와 근거를 선호함.",
    responseStyle: "직설적이고 구체적인 질문을 던지며, 애매한 답변에 대해서는 재질문함. 전문적이지만 때로는 압박적임.",
    goals: ["명확한 커뮤니케이션 확인", "논리적 사고력 테스트", "문제 해결 능력 평가"],
    background: "7년간 연구개발 분야에서 일하며 다양한 프로젝트를 성공시킨 경험이 있음. 후배들의 성장을 위해 엄격한 기준을 적용함."
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

export async function generateAIResponse(
  scenarioId: string,
  conversationHistory: ConversationMessage[],
  turnCount: number
): Promise<string> {
  const persona = SCENARIO_PERSONAS[scenarioId];
  if (!persona) {
    throw new Error(`Unknown scenario: ${scenarioId}`);
  }

  const conversationContext = conversationHistory
    .map(msg => `${msg.sender === 'user' ? '사용자' : persona.name}: ${msg.message}`)
    .join('\n');

  const systemPrompt = `당신은 ${persona.name}(${persona.role})입니다.

성격: ${persona.personality}

대화 스타일: ${persona.responseStyle}

배경: ${persona.background}

현재 턴: ${turnCount}/10

이 역할을 완벽히 수행하여 사용자와 대화하세요. 
- 일관된 성격과 말투를 유지하세요
- 현실적이고 자연스러운 대화를 하세요
- 사용자의 커뮤니케이션 능력을 평가할 수 있는 상황을 만드세요
- 한국어로 대화하세요
- 응답은 2-3문장으로 간결하게 하세요`;

  const userPrompt = `다음은 지금까지의 대화입니다:

${conversationContext}

위 맥락을 바탕으로 ${persona.name}의 입장에서 자연스럽게 응답해주세요.`;

  // 임시로 더미 응답만 사용 (API 문제 해결까지)
  const dummyResponses: Record<string, string[]> = {
    communication: [
      "안녕하세요, 김신입씨. 잘 부탁드립니다. 그런데 새로 입사한 만큼 먼저 우리 팀의 업무 프로세스를 정확히 파악하는 것이 중요할 것 같은데, 어떤 준비를 하고 오셨나요?",
      "좋습니다. 그런데 구체적으로 어떤 부분을 어떻게 준비했는지 설명해주실 수 있을까요? 추상적인 답변보다는 실질적인 내용을 듣고 싶습니다.",
      "음, 그 정도면 기본적인 준비는 하신 것 같네요. 하지만 실제 업무에서는 더 구체적이고 정확한 데이터가 필요합니다. 앞으로 보고서를 작성할 때는 어떤 점들을 염두에 두실 건가요?"
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
  
  const responses = dummyResponses[scenarioId] || dummyResponses.communication;
  const responseIndex = Math.max(0, Math.min(turnCount - 1, responses.length - 1));
  return responses[responseIndex] || "네, 알겠습니다. 계속 진행해보죠.";
}

export async function generateFeedback(
  scenarioId: string,
  conversationHistory: ConversationMessage[]
): Promise<{ overallScore: number; scores: EvaluationScore[]; detailedFeedback: DetailedFeedback }> {
  const persona = SCENARIO_PERSONAS[scenarioId];
  if (!persona) {
    throw new Error(`Unknown scenario: ${scenarioId}`);
  }

  const conversationText = conversationHistory
    .map(msg => `${msg.sender === 'user' ? '사용자' : persona.name}: ${msg.message}`)
    .join('\n');

  const evaluationPrompt = `다음은 신입사원과 ${persona.name}(${persona.role}) 간의 역할극 대화입니다:

${conversationText}

이 대화를 바탕으로 신입사원의 커뮤니케이션 역량을 평가해주세요.

다음 JSON 형식으로 응답해주세요:
{
  "overallScore": 82,
  "scores": [
    {
      "category": "communication",
      "name": "커뮤니케이션 스킬",
      "score": 2,
      "feedback": "명확하고 논리적인 의사소통을 보여주셨습니다.",
      "icon": "fas fa-comments",
      "color": "blue"
    },
    {
      "category": "empathy", 
      "name": "공감 능력",
      "score": 1,
      "feedback": "상대방의 감정을 이해하려고 노력했지만 더 적극적인 공감 표현이 필요합니다.",
      "icon": "fas fa-heart",
      "color": "red"
    },
    {
      "category": "problem_solving",
      "name": "문제 해결력", 
      "score": 2,
      "feedback": "창의적이고 실현 가능한 해결책을 제시했습니다.",
      "icon": "fas fa-lightbulb",
      "color": "yellow"
    },
    {
      "category": "negotiation",
      "name": "협상 능력",
      "score": 1, 
      "feedback": "기본적인 협상 스킬은 보유하고 있으나 더 전략적인 접근이 필요합니다.",
      "icon": "fas fa-handshake",
      "color": "purple"
    },
    {
      "category": "pressure_response",
      "name": "압박 상황 대응",
      "score": 2,
      "feedback": "압박 상황에서도 침착함을 유지하고 논리적으로 대응했습니다.",
      "icon": "fas fa-shield-alt", 
      "color": "green"
    }
  ],
  "detailedFeedback": {
    "strengths": [
      "상대방의 문제 제기에 대해 방어적으로 반응하지 않고 경청하는 자세를 보였습니다.",
      "구체적인 데이터와 근거를 제시하여 신뢰성을 높였습니다."
    ],
    "improvements": [
      "상대방의 감정 상태를 더 세심하게 파악하고 공감하는 표현을 늘려보세요.",
      "문제 해결책 제시 시 상대방의 입장에서 얻을 수 있는 이익을 더 강조해보세요."
    ],
    "nextSteps": [
      "이선영 시나리오로 공감 능력을 더 집중적으로 훈련해보세요.",
      "실제 업무에서 비슷한 상황이 발생하면 오늘 학습한 내용을 적용해보세요."
    ],
    "ranking": "상위 15% 수준의 커뮤니케이션 스킬을 보여주셨습니다."
  }
}

평가 기준:
- 각 항목은 0-2점으로 채점 (0: 부족, 1: 보통, 2: 우수)
- 전체 점수는 0-100점으로 계산
- 구체적이고 건설적인 피드백 제공
- 실제 대화 내용을 바탕으로 정확한 평가 수행`;

  try {
    const response = await genAI.models.generateContent({
      model: "gemini-2.5-pro",
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            overallScore: { type: "number" },
            scores: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  name: { type: "string" },
                  score: { type: "number" },
                  feedback: { type: "string" },
                  icon: { type: "string" },
                  color: { type: "string" }
                }
              }
            },
            detailedFeedback: {
              type: "object",
              properties: {
                strengths: { type: "array", items: { type: "string" } },
                improvements: { type: "array", items: { type: "string" } },
                nextSteps: { type: "array", items: { type: "string" } },
                ranking: { type: "string" }
              }
            }
          }
        },
        temperature: 0.3,
      },
      contents: evaluationPrompt,
    });

    const result = JSON.parse(response.text || "{}");
    return {
      overallScore: result.overallScore || 0,
      scores: result.scores || [],
      detailedFeedback: result.detailedFeedback || { strengths: [], improvements: [], nextSteps: [], ranking: "" }
    };
  } catch (error) {
    console.error("Feedback generation error:", error);
    // 임시 더미 피드백 (API 키 문제 시)
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
        ranking: "상위 25% 수준의 커뮤니케이션 스킬을 보여주셨습니다."
      }
    };
  }
}
