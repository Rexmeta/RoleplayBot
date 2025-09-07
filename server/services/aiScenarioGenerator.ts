import { GoogleGenAI } from "@google/genai";

// 시나리오 타입 정의
export interface ComplexScenario {
  id: string;
  title: string;
  description: string;
  context: {
    situation: string;
    timeline: string;
    stakes: string;
    playerRole: {
      position: string;
      department: string;
      experience: string;
      responsibility: string;
    };
  };
  objectives: string[];
  successCriteria: {
    optimal: string;
    good: string;
    acceptable: string;
    failure: string;
  };
  personas: any[]; // persona 객체들
  recommendedFlow: string[];
  difficulty: number;
  estimatedTime: string;
  skills: string[];
}

export interface ScenarioPersona {
  id: string;
  name: string;
  department: string;
  position: string;
  experience: string;
  personaRef: string;
  stance: string;
  goal: string;
  tradeoff: string;
}

// the newest Gemini model is "gemini-2.5-flash" which was released August 7, 2025. do not change this unless explicitly requested by the user
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface AIScenarioGenerationRequest {
  theme: string; // 주제 (예: "프로젝트 지연", "갈등 해결", "협상")
  industry?: string; // 업종 (예: "IT", "제조업", "서비스업")
  difficulty?: number; // 1-5 난이도
  personaCount?: number; // 생성할 페르소나 수 (1-6)
}

// 키워드 기반 ID 생성 함수
function generateScenarioId(title: string): string {
  const keywords = title
    .replace(/[^\w\s가-힣]/g, '') // 특수문자 제거
    .split(/\s+/) // 공백으로 분리
    .filter(word => word.length > 1) // 한 글자 단어 제거
    .slice(0, 3) // 최대 3개 키워드
    .map(word => word.toLowerCase().replace(/[가-힣]/g, (char) => {
      // 한글을 영어로 간단 변환 (예시)
      const map: {[key: string]: string} = {
        '프로젝트': 'project', '지연': 'delay', '갈등': 'conflict', 
        '협상': 'negotiation', '회의': 'meeting', '위기': 'crisis',
        '앱': 'app', '개발': 'dev', '마케팅': 'marketing', '품질': 'quality',
        '출시': 'launch', '일정': 'schedule', '물류': 'logistics', 
        '마비': 'paralysis', '손상': 'damage', '폭설': 'snow', 
        '제조': 'manufacturing', '생산': 'production', '납기': 'delivery'
      };
      return map[char] || char;
    }))
    .join('-');
  
  return keywords || 'scenario';
}

export async function generateScenarioWithAI(request: AIScenarioGenerationRequest): Promise<{
  scenario: ComplexScenario;
  personas: ScenarioPersona[];
}> {
  const prompt = `다음 조건에 맞는 직장 내 롤플레이 훈련 시나리오를 정확히 다음 JSON 형식으로 생성해주세요:

주제: ${request.theme}
${request.industry ? `업종: ${request.industry}` : ''}
난이도: ${request.difficulty || 3}/5
페르소나 수: ${request.personaCount || 3}명

{
  "title": "구체적이고 현실적인 시나리오 제목",
  "description": "200-300자의 상황 설명. 갈등 상황과 해결이 필요한 문제를 구체적으로 설명",
  "context": {
    "situation": "구체적인 상황 설명",
    "timeline": "시간적 제약 조건 (예: 1주일 남음, 내일 마감 등)",
    "stakes": "이해관계 및 중요성 (예: 품질 vs 일정, 비용 vs 효과)",
    "playerRole": {
      "position": "참가자의 역할 (예: 개발자, 매니저, 팀장)",
      "department": "소속 부서 (예: 개발팀, 마케팅팀)",
      "experience": "경력 수준 (예: 3년차, 신입, 10년차)",
      "responsibility": "핵심 책임 (예: 최적의 해결안 도출, 팀 간 협의)"
    }
  },
  "objectives": [
    "목표1: 구체적이고 측정 가능한 목표",
    "목표2: 실행 가능한 목표",
    "목표3: 현실적인 목표",
    "목표4: Win-Win 전략 수립"
  ],
  "successCriteria": {
    "optimal": "최상의 결과 (모든 이해관계자 만족)",
    "good": "좋은 결과 (핵심 요구사항 충족)",
    "acceptable": "수용 가능한 결과 (최소 기준 충족)",
    "failure": "실패 조건 (갈등 심화 또는 비현실적 해결책)"
  },
  "personas": [
    {
      "id": "istj",
      "name": "한국식 이름",
      "department": "부서명",
      "position": "직책",
      "experience": "경력",
      "personaRef": "istj.json",
      "stance": "이 상황에 대한 구체적인 입장과 의견. 왜 그런 입장인지 배경도 포함",
      "goal": "개인적인 목표와 원하는 결과",
      "tradeoff": "양보할 수 있는 부분이나 조건"
    },
    {
      "id": "entj",
      "name": "한국식 이름",
      "department": "부서명",
      "position": "직책",
      "experience": "경력",
      "personaRef": "entj.json",
      "stance": "이 상황에 대한 구체적인 입장과 의견",
      "goal": "개인적인 목표와 원하는 결과",
      "tradeoff": "양보할 수 있는 부분이나 조건"
    },
    {
      "id": "intp",
      "name": "한국식 이름",
      "department": "부서명",
      "position": "직책",
      "experience": "경력",
      "personaRef": "intp.json",
      "stance": "이 상황에 대한 구체적인 입장과 의견",
      "goal": "개인적인 목표와 원하는 결과",
      "tradeoff": "양보할 수 있는 부분이나 조건"
    }
  ],
  "recommendedFlow": ["istj", "entj", "intp"],
  "difficulty": ${request.difficulty || 3},
  "estimatedTime": "예상 소요 시간 (예: 60-90분)",
  "skills": ["갈등 중재", "협상", "문제 해결", "의사소통", "리더십"]
}

주의사항:
1. 현실적이고 구체적인 한국 직장 상황을 만들어주세요
2. 각 페르소나는 서로 다른 MBTI 유형을 사용하세요 (istj, entj, intp, isfj, enfj 등)
3. persona의 stance, goal, tradeoff는 이 시나리오에 특화된 구체적인 내용이어야 합니다
4. 갈등과 협상 요소가 반드시 포함되어야 합니다
5. 한국 직장 문화와 현실적인 업무 상황을 반영해주세요`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      config: {
        responseMimeType: "application/json",
        responseSchema: {
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
                  },
                  required: ["position", "department", "experience", "responsibility"]
                }
              },
              required: ["situation", "timeline", "stakes", "playerRole"]
            },
            objectives: { type: "array", items: { type: "string" } },
            successCriteria: {
              type: "object",
              properties: {
                optimal: { type: "string" },
                good: { type: "string" },
                acceptable: { type: "string" },
                failure: { type: "string" }
              },
              required: ["optimal", "good", "acceptable", "failure"]
            },
            personas: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  department: { type: "string" },
                  position: { type: "string" },
                  experience: { type: "string" },
                  personaRef: { type: "string" },
                  stance: { type: "string" },
                  goal: { type: "string" },
                  tradeoff: { type: "string" }
                },
                required: ["id", "name", "department", "position", "experience", "personaRef", "stance", "goal", "tradeoff"]
              }
            },
            recommendedFlow: { type: "array", items: { type: "string" } },
            difficulty: { type: "number" },
            estimatedTime: { type: "string" },
            skills: { type: "array", items: { type: "string" } }
          },
          required: ["title", "description", "context", "objectives", "successCriteria", "personas", "recommendedFlow", "difficulty", "estimatedTime", "skills"]
        }
      },
      contents: prompt
    });

    const rawJson = response.text;
    if (!rawJson) {
      throw new Error("AI에서 응답을 받을 수 없습니다");
    }

    // JSON 응답 정리 (마크다운 코드 블록 제거)
    const cleanJson = rawJson
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .replace(/^\s*[\r\n]/gm, '')
      .trim();
    
    console.log('정리된 JSON:', cleanJson.substring(0, 500) + '...');
    
    const data = JSON.parse(cleanJson);
    
    // 키워드 기반 시나리오 ID 생성
    const scenarioId = generateScenarioId(data.title);
    
    // ComplexScenario 객체 생성 (app-delay-crisis.json과 동일한 구조)
    const scenario: ComplexScenario = {
      id: scenarioId,
      title: data.title,
      description: data.description,
      context: data.context,
      objectives: data.objectives,
      successCriteria: data.successCriteria,
      personas: data.personas,
      recommendedFlow: data.recommendedFlow,
      difficulty: data.difficulty,
      estimatedTime: data.estimatedTime,
      skills: data.skills
    };

    // ScenarioPersona 객체들 생성 (이미 올바른 형식)
    const personas: ScenarioPersona[] = data.personas;

    return {
      scenario,
      personas
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
  '개선 요청: 더 현실적이고 구체적으로 만들어주세요. 갈등 요소를 강화하고 해결 방안을 다양화해주세요.' :
  enhancementType === 'expand' ?
  '확장 요청: 페르소나를 추가하고 시나리오를 더 복잡하게 만들어주세요. 추가적인 이해관계자와 갈등 요소를 포함해주세요.' :
  '단순화 요청: 핵심 갈등만 남기고 복잡한 요소들을 제거해주세요. 초보자도 쉽게 이해할 수 있도록 만들어주세요.'
}

다음 JSON 형식으로 개선된 부분만 반환해주세요:
{
  "title": "개선된 제목 (변경이 있을 경우만)",
  "description": "개선된 설명 (변경이 있을 경우만)",
  "objectives": ["개선된 목표들"],
  "personas": [개선된 페르소나 배열],
  "skills": ["개선된 필요 역량들"]
}`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      config: {
        responseMimeType: "application/json"
      },
      contents: prompt
    });

    const rawJson = response.text;
    if (!rawJson) {
      throw new Error("AI에서 응답을 받을 수 없습니다");
    }

    const cleanJson = rawJson
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    return JSON.parse(cleanJson);

  } catch (error) {
    console.error("AI 시나리오 개선 오류:", error);
    throw new Error(`AI 시나리오 개선에 실패했습니다: ${error}`);
  }
}