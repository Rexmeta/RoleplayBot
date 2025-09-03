import { GoogleGenAI } from "@google/genai";
import { ComplexScenario, ScenarioPersona } from "@shared/schema";

// the newest Gemini model is "gemini-2.5-flash" which was released August 7, 2025. do not change this unless explicitly requested by the user
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface AIScenarioGenerationRequest {
  theme: string; // 주제 (예: "프로젝트 지연", "갈등 해결", "협상")
  industry?: string; // 업종 (예: "IT", "제조업", "서비스업")
  difficulty?: number; // 1-5 난이도
  personaCount?: number; // 생성할 페르소나 수 (1-6)
}

export async function generateScenarioWithAI(request: AIScenarioGenerationRequest): Promise<{
  scenario: Omit<ComplexScenario, 'id'>;
  personas: Omit<ScenarioPersona, 'id'>[];
}> {
  const prompt = `다음 조건에 맞는 직장 내 롤플레이 훈련 시나리오를 생성해주세요:

주제: ${request.theme}
${request.industry ? `업종: ${request.industry}` : ''}
난이도: ${request.difficulty || 3}/5
페르소나 수: ${request.personaCount || 3}명

다음 JSON 형식으로 응답해주세요:
{
  "scenario": {
    "title": "구체적이고 현실적인 시나리오 제목",
    "description": "200-300자의 상황 설명",
    "context": {
      "situation": "구체적인 상황 설명",
      "timeline": "시간적 제약 조건",
      "stakes": "이해관계 및 중요성",
      "playerRole": {
        "position": "참가자의 역할",
        "department": "소속 부서",
        "experience": "경력 수준",
        "responsibility": "핵심 책임"
      }
    },
    "objectives": [
      "목표1: 구체적이고 측정 가능한 목표",
      "목표2: 실행 가능한 목표",
      "목표3: 현실적인 목표"
    ],
    "successCriteria": {
      "optimal": "최상의 결과",
      "good": "좋은 결과",
      "acceptable": "수용 가능한 결과",
      "failure": "실패 조건"
    },
    "personas": ["persona1-id", "persona2-id", "persona3-id"],
    "recommendedFlow": ["추천 대화 순서"],
    "difficulty": ${request.difficulty || 3},
    "estimatedTime": "예상 소요 시간",
    "skills": ["핵심 역량1", "핵심 역량2", "핵심 역량3"]
  },
  "personas": [
    {
      "name": "인물 이름",
      "role": "역할/직책",
      "department": "소속 부서",
      "experience": "경력",
      "personality": {
        "traits": ["성격 특성1", "성격 특성2"],
        "communicationStyle": "소통 스타일 설명",
        "motivation": "동기 및 목표",
        "fears": ["우려사항1", "우려사항2"]
      },
      "background": {
        "education": "학력",
        "previousExperience": "이전 경험",
        "majorProjects": ["주요 프로젝트"],
        "expertise": ["전문 분야"]
      },
      "currentSituation": {
        "workload": "현재 업무",
        "pressure": "받고 있는 압박",
        "concerns": ["현재 우려사항들"],
        "position": "이 상황에서의 입장"
      },
      "communicationPatterns": {
        "openingStyle": "대화 시작 방식",
        "keyPhrases": ["자주 사용하는 표현들"],
        "responseToArguments": {
          "타입1": "이런 논리에 대한 반응",
          "타입2": "저런 제안에 대한 반응"
        },
        "winConditions": ["설득당할 수 있는 조건들"]
      },
      "image": "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?ixlib=rb-4.0.3&auto=format&fit=crop&w=150&h=150",
      "voice": {
        "tone": "목소리 톤",
        "pace": "말하는 속도",
        "emotion": "기본 감정 상태"
      }
    }
  ]
}

주의사항:
1. 현실적이고 구체적인 직장 상황을 만들어주세요
2. 각 페르소나는 서로 다른 이해관계와 관점을 가져야 합니다
3. 페르소나 ID는 "role-name" 형식으로 생성해주세요 (예: dev-senior-lee)
4. 한국어로 작성하고 한국 직장 문화를 반영해주세요
5. 갈등과 협상 요소가 포함되어야 합니다`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "object",
          properties: {
            scenario: {
              type: "object",
              properties: {
                title: { type: "string" },
                description: { type: "string" },
                context: {
                  type: "object",
                  properties: {
                    situation: { type: "string" },
                    timeline: { type: "string" },
                    stakes: { type: "string" },
                    playerRole: {
                      type: "object",
                      properties: {
                        position: { type: "string" },
                        department: { type: "string" },
                        experience: { type: "string" },
                        responsibility: { type: "string" }
                      }
                    }
                  }
                },
                objectives: { type: "array", items: { type: "string" } },
                successCriteria: {
                  type: "object",
                  properties: {
                    optimal: { type: "string" },
                    good: { type: "string" },
                    acceptable: { type: "string" },
                    failure: { type: "string" }
                  }
                },
                personas: { type: "array", items: { type: "string" } },
                recommendedFlow: { type: "array", items: { type: "string" } },
                difficulty: { type: "number" },
                estimatedTime: { type: "string" },
                skills: { type: "array", items: { type: "string" } }
              }
            },
            personas: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  role: { type: "string" },
                  department: { type: "string" },
                  experience: { type: "string" },
                  personality: {
                    type: "object",
                    properties: {
                      traits: { type: "array", items: { type: "string" } },
                      communicationStyle: { type: "string" },
                      motivation: { type: "string" },
                      fears: { type: "array", items: { type: "string" } }
                    }
                  },
                  background: {
                    type: "object",
                    properties: {
                      education: { type: "string" },
                      previousExperience: { type: "string" },
                      majorProjects: { type: "array", items: { type: "string" } },
                      expertise: { type: "array", items: { type: "string" } }
                    }
                  },
                  currentSituation: {
                    type: "object",
                    properties: {
                      workload: { type: "string" },
                      pressure: { type: "string" },
                      concerns: { type: "array", items: { type: "string" } },
                      position: { type: "string" }
                    }
                  },
                  communicationPatterns: {
                    type: "object",
                    properties: {
                      openingStyle: { type: "string" },
                      keyPhrases: { type: "array", items: { type: "string" } },
                      responseToArguments: { 
                        type: "object",
                        properties: {
                          defensive: { type: "string" },
                          aggressive: { type: "string" },
                          collaborative: { type: "string" }
                        }
                      },
                      winConditions: { type: "array", items: { type: "string" } }
                    }
                  },
                  image: { type: "string" },
                  voice: {
                    type: "object",
                    properties: {
                      tone: { type: "string" },
                      pace: { type: "string" },
                      emotion: { type: "string" }
                    }
                  }
                }
              }
            }
          },
          required: ["scenario", "personas"]
        }
      },
      contents: prompt
    });

    const rawJson = response.text;
    if (!rawJson) {
      throw new Error("AI에서 응답을 받을 수 없습니다");
    }

    const data = JSON.parse(rawJson);
    
    // 페르소나 ID 자동 생성
    data.personas.forEach((persona: any, index: number) => {
      const id = persona.name ? 
        persona.name.replace(/\s+/g, '-').toLowerCase() + `-${index + 1}` :
        `persona-${index + 1}`;
      persona.id = id;
    });

    // 시나리오의 페르소나 ID 목록 업데이트
    data.scenario.personas = data.personas.map((p: any) => p.id);
    data.scenario.recommendedFlow = data.personas.map((p: any) => p.id);

    return {
      scenario: data.scenario,
      personas: data.personas
    };

  } catch (error) {
    console.error("AI 시나리오 생성 오류:", error);
    throw new Error(`AI 시나리오 생성에 실패했습니다: ${error}`);
  }
}

export async function enhanceScenarioWithAI(
  existingScenario: ComplexScenario,
  enhancementType: 'improve' | 'expand' | 'simplify'
): Promise<Partial<ComplexScenario>> {
  const prompt = `다음 기존 시나리오를 ${enhancementType === 'improve' ? '개선' : enhancementType === 'expand' ? '확장' : '단순화'}해주세요:

기존 시나리오:
${JSON.stringify(existingScenario, null, 2)}

${enhancementType === 'improve' ? 
  '더 현실적이고 흥미로운 상황으로 개선하되, 기본 구조는 유지해주세요.' :
  enhancementType === 'expand' ?
  '더 복잡하고 도전적인 요소들을 추가해주세요.' :
  '더 명확하고 이해하기 쉽게 단순화해주세요.'
}

수정된 부분만 JSON 형식으로 반환해주세요.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt
    });

    const rawJson = response.text;
    if (!rawJson) {
      throw new Error("AI에서 응답을 받을 수 없습니다");
    }

    return JSON.parse(rawJson);
  } catch (error) {
    console.error("AI 시나리오 개선 오류:", error);
    throw new Error(`AI 시나리오 개선에 실패했습니다: ${error}`);
  }
}