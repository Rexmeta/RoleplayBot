import { GoogleGenAI } from "@google/genai";
import { getModelForFeature } from "./aiServiceFactory";

// 시나리오 타입 정의
export interface ComplexScenario {
  id: string;
  title: string;
  description: string;
  image?: string; // 시나리오를 상징하는 이미지 URL
  imagePrompt?: string; // 이미지 생성 프롬프트
  introVideoUrl?: string; // 인트로 비디오 URL
  videoPrompt?: string; // 비디오 생성 프롬프트
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
  personas: ScenarioPersona[]; // persona 객체들
  recommendedFlow: string[];
  difficulty: number;
  estimatedTime: string;
  skills: string[];
  isDeleted?: boolean;
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
const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "" });

function extractText(response: any): string {
  if (typeof response.text === 'function') return response.text();
  if (typeof response.text === 'string') return response.text;
  const candidate = response.candidates?.[0];
  if (candidate?.content?.parts?.[0]?.text) return candidate.content.parts[0].text;
  return '';
}

export interface AIScenarioGenerationRequest {
  idea?: string; // 시나리오 아이디어 (자유 입력 텍스트) — 최우선 입력값
  theme?: string; // 주제 (예: "프로젝트 지연", "갈등 해결", "협상")
  industry?: string; // 업종 (예: "IT", "제조업", "서비스업")
  situation?: string; // 구체적 상황 설명
  timeline?: string; // 시간적 제약
  stakes?: string; // 이해관계
  playerRole?: {
    position: string;
    department: string;
    experience: string;
    responsibility: string;
  };
  conflictType?: string; // 갈등 유형
  objectiveType?: string; // 목표 유형
  skills?: string; // 필요 역량
  estimatedTime?: string; // 예상 소요 시간
  difficulty?: number; // 1-4 난이도
  personaCount?: number; // 생성할 페르소나 수 (1-6)
}

// 키워드 기반 ID 생성 함수 (생성 일시 포함)
function generateScenarioId(title: string): string {
  // 한글을 영어로 변환하는 맵 (단어 단위)
  const koreanToEnglishMap: {[key: string]: string} = {
    '프로젝트': 'project', '지연': 'delay', '갈등': 'conflict', 
    '협상': 'negotiation', '회의': 'meeting', '위기': 'crisis',
    '앱': 'app', '개발': 'dev', '마케팅': 'marketing', '품질': 'quality',
    '출시': 'launch', '일정': 'schedule', '물류': 'logistics', 
    '마비': 'paralysis', '손상': 'damage', '폭설': 'snow', 
    '제조': 'manufacturing', '생산': 'production', '납기': 'delivery',
    '신제품': 'new-product', '내부': 'internal', '이슈': 'issue',
    '출고': 'shipping', '재작업': 'rework', '검수': 'inspection',
    '구조적': 'structural', '결함': 'defect', '안전': 'safety',
    '고객': 'customer', '서비스': 'service', '팀': 'team',
    '관리': 'management', '시스템': 'system', '데이터': 'data',
    '보안': 'security', '네트워크': 'network', '서버': 'server',
    '사용자': 'user', '인터페이스': 'interface', '디자인': 'design',
    '계획': 'plan', '예산': 'budget', '비용': 'cost',
    '효율': 'efficiency', '성능': 'performance', '최적화': 'optimization'
  };
  
  // 제목을 단어로 분리하고 변환
  const keywords = title
    .replace(/[^\w\s가-힣]/g, '') // 특수문자 제거
    .split(/\s+/) // 공백으로 분리
    .filter(word => word.length > 1) // 한 글자 단어 제거
    .slice(0, 3) // 최대 3개 키워드
    .map(word => {
      // 전체 단어를 영어로 변환하거나, 없으면 한글 그대로 사용
      const lowerWord = word.toLowerCase();
      return koreanToEnglishMap[word] || lowerWord;
    })
    .join('-');
  
  // 생성 일시 추가 (중복 방지용)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const baseId = keywords || 'scenario';
  
  return `${baseId}-${timestamp}`;
}

export async function generateScenarioWithAI(request: AIScenarioGenerationRequest): Promise<{
  scenario: ComplexScenario;
  personas: ScenarioPersona[];
}> {
  // 사용 가능한 MBTI 유형 (시스템에 등록된 페르소나들)
  const availableMBTITypes = [
    'istj', 'isfj', 'infj', 'intj', 
    'istp', 'isfp', 'infp', 'intp',
    'estp', 'esfp', 'enfp', 'entp',
    'estj', 'esfj', 'enfj', 'entj'
  ];
  
  // personaCount에 맞는 MBTI 유형 선택 (중복 없이)
  const selectedMBTI = availableMBTITypes.slice(0, request.personaCount || 3);

  // idea가 있으면 그것을 핵심 입력으로 사용
  const coreIdea = request.idea || request.theme || '';

  const prompt = `당신은 기업 교육용 롤플레이 시나리오를 설계하는 전문가입니다. 피평가자가 상황을 충분히 이해하고 몰입할 수 있도록 풍부하고 체계적인 시나리오를 작성해주세요.

## 시나리오 생성 조건
시나리오 아이디어: ${coreIdea}
${request.playerRole ? `참가자 역할: ${request.playerRole.position} (${request.playerRole.department}, ${request.playerRole.experience}), 핵심 책임: ${request.playerRole.responsibility}` : ''}
${request.industry ? `업종: ${request.industry}` : '업종: (아이디어를 바탕으로 가장 적합한 업종을 자동 추론하세요)'}
${request.situation ? `상황 설명: ${request.situation}` : '상황 설명: (아이디어를 바탕으로 구체적인 상황을 자동 생성하세요)'}
${request.timeline ? `시간적 제약: ${request.timeline}` : '시간적 제약: (아이디어에 맞는 현실적인 시간 제약을 자동 설정하세요)'}
${request.stakes ? `이해관계: ${request.stakes}` : '이해관계: (아이디어에 관련된 현실적인 이해관계를 자동 추론하세요)'}
${request.conflictType ? `갈등 유형: ${request.conflictType}` : '갈등 유형: (아이디어에서 가장 자연스럽게 도출되는 갈등 유형을 선택하세요)'}
${request.objectiveType ? `목표 유형: ${request.objectiveType}` : '목표 유형: (아이디어에 맞는 핵심 목표 유형을 자동 설정하세요)'}
${request.skills ? `필요 역량: ${request.skills}` : '필요 역량: (이 시나리오에서 연습할 수 있는 핵심 역량을 자동 도출하세요)'}
난이도: ${request.difficulty || 3}/4
페르소나 수: ${request.personaCount || 3}명
사용 가능한 MBTI 유형: ${selectedMBTI.join(', ')} (이 유형들만 사용하세요)

## 중요: 위에서 "자동 추론/생성/설정/도출"이라고 표시된 항목들은 "시나리오 아이디어"와 "참가자 역할"을 바탕으로 AI가 직접 창의적으로 설정합니다. 별도 입력 없이도 완전한 시나리오가 생성되어야 합니다.

## 필수 작성 기준 (매우 중요!)
1. **description (시나리오 설명)**: 반드시 1000자 이상으로 작성하세요!
   - 첫 번째 단락: 회사/조직의 배경과 현재 처한 상황 개요 (200자 이상)
   - 두 번째 단락: 문제가 발생한 구체적인 경위와 원인 (200자 이상)
   - 세 번째 단락: 각 이해관계자들의 입장과 갈등 구조 (200자 이상)
   - 네 번째 단락: 해결하지 않을 경우 예상되는 결과와 리스크 (200자 이상)
   - 다섯 번째 단락: 참가자가 이 상황에서 수행해야 할 역할과 기대 (200자 이상)

2. **context.situation (상황 설명)**: 반드시 500자 이상으로 작성하세요!
   - 구체적인 사건의 시작점과 전개 과정
   - 관련된 사람들의 감정 상태와 우려 사항
   - 현재 시점에서의 긴급성과 중요도
   - 조직 내 정치적 역학 관계나 과거 이력

3. **context.stakes (이해관계)**: 200자 이상으로 구체적으로 작성
   - 각 당사자가 얻을 수 있는 것과 잃을 수 있는 것
   - 단기적 영향과 장기적 영향
   - 정량적 지표 (비용, 시간, 매출 등)와 정성적 지표 (신뢰, 관계, 평판 등)

4. **objectives**: 각 목표를 2-3문장으로 구체화 (단순한 한 줄이 아님)

5. **successCriteria**: 각 기준을 2-3문장으로 구체적인 상황과 함께 설명

6. **personas의 stance, goal, tradeoff**: 각각 100자 이상으로 심층적으로 작성

## JSON 형식

{
  "title": "구체적이고 현실적인 시나리오 제목 (문제 상황이 명확히 드러나도록)",
  "description": "1000자 이상의 포괄적인 시나리오 설명. 위의 5개 단락 구조를 반드시 따라주세요. 피평가자가 상황에 몰입할 수 있도록 구체적인 숫자, 날짜, 이름, 사건 등을 포함하세요.",
  "context": {
    "situation": "500자 이상의 구체적이고 상세한 상황 설명. 사건의 발단부터 현재까지의 전개, 관련자들의 감정과 입장, 긴급성과 복잡성을 모두 포함하세요.",
    "timeline": "시간적 제약 조건과 마일스톤 (예: '신제품 출시까지 2주 남음. 다음 주 월요일까지 디자인 확정, 수요일까지 개발 완료 필요. 경쟁사는 이미 유사 제품을 출시 준비 중')",
    "stakes": "200자 이상의 이해관계 설명. 각 당사자의 득실, 단기/장기 영향, 정량적/정성적 지표를 구체적으로 포함하세요.",
    "playerRole": {
      "position": "참가자의 역할 (예: 개발자, 매니저, 팀장)",
      "department": "소속 부서 (예: 개발팀, 마케팅팀)",
      "experience": "경력 수준 (예: 3년차, 신입, 10년차)",
      "responsibility": "핵심 책임과 권한 범위 (예: '이 프로젝트의 기술 리드로서 품질과 일정 사이의 균형을 잡고, 모든 이해관계자가 수용할 수 있는 해결책을 도출해야 함')"
    }
  },
  "objectives": [
    "목표1: 구체적이고 측정 가능한 목표. 왜 이 목표가 중요한지, 달성 시 어떤 가치가 있는지 2-3문장으로 설명",
    "목표2: 실행 가능한 목표. 목표 달성을 위해 필요한 조건과 과정을 2-3문장으로 설명",
    "목표3: 현실적인 목표. 제약 조건 내에서 어떻게 달성할 수 있는지 2-3문장으로 설명",
    "목표4: Win-Win 전략 수립. 모든 이해관계자의 핵심 니즈를 파악하고 통합하는 방법을 2-3문장으로 설명"
  ],
  "successCriteria": {
    "optimal": "최상의 결과에 대한 구체적 묘사 (예: '모든 팀이 합의한 일정과 품질 기준을 달성하고, 추가 예산 없이 프로젝트 완료. 각 부서의 핵심 KPI도 충족')",
    "good": "좋은 결과에 대한 구체적 묘사 (예: '핵심 기능은 예정대로 출시하고, 일부 부가 기능은 다음 버전으로 연기. 고객 불만 최소화')",
    "acceptable": "수용 가능한 결과에 대한 구체적 묘사 (예: '일정이 1주 지연되지만, 품질은 유지. 추가 비용 10% 이내로 통제')",
    "failure": "실패 조건에 대한 구체적 묘사 (예: '팀 간 갈등이 심화되어 핵심 인력이 이탈 의사 표명. 프로젝트 전면 재검토 필요')"
  },
  "personas": [
    {
      "id": "${selectedMBTI[0] || 'istj'}",
      "name": "실제 한국 이름 (예: 김민수, 이지영)",
      "department": "부서명1 (예: 개발팀, QA팀, 마케팅팀 중 하나)",
      "position": "직책1 (예: 선임 개발자, 매니저, 대리)",
      "experience": "경력1 (예: 3년차, 5년차, 신입, 10년차)",
      "personaRef": "${selectedMBTI[0] || 'istj'}.json",
      "stance": "100자 이상으로 ${selectedMBTI[0]?.toUpperCase() || 'ISTJ'} 성격 유형의 특성을 반영한 이 상황에 대한 구체적인 입장과 의견을 작성하세요. 왜 그런 입장을 취하는지, 어떤 가치와 원칙에 기반하는지, 과거 경험이나 전문성이 어떻게 영향을 미치는지 포함",
      "goal": "100자 이상으로 ${selectedMBTI[0]?.toUpperCase() || 'ISTJ'} 성격의 특성을 반영한 개인적 목표와 원하는 결과를 작성하세요. 단기 목표와 장기 목표, 이 상황에서 달성하고 싶은 것과 피하고 싶은 것 포함",
      "tradeoff": "100자 이상으로 ${selectedMBTI[0]?.toUpperCase() || 'ISTJ'} 성격의 특성을 반영한 양보 가능한 부분을 작성하세요. 어떤 조건에서 양보할 수 있는지, 반대로 절대 양보할 수 없는 것은 무엇인지 포함"
    }${selectedMBTI.length > 1 ? `,
    {
      "id": "${selectedMBTI[1]}",
      "name": "실제 한국 이름 (다른 이름)",
      "department": "부서명2 (첫 번째와 다른 부서)",
      "position": "직책2 (첫 번째와 다른 직책)",
      "experience": "경력2 (첫 번째와 다른 경력)",
      "personaRef": "${selectedMBTI[1]}.json",
      "stance": "100자 이상으로 ${selectedMBTI[1].toUpperCase()} 성격 유형의 특성을 반영한 이 상황에 대한 구체적인 입장과 의견을 작성하세요. 왜 그런 입장을 취하는지, 어떤 가치와 원칙에 기반하는지 포함",
      "goal": "100자 이상으로 ${selectedMBTI[1].toUpperCase()} 성격의 특성을 반영한 개인적 목표와 원하는 결과를 작성하세요. 이 상황에서 달성하고 싶은 것과 피하고 싶은 것 포함",
      "tradeoff": "100자 이상으로 ${selectedMBTI[1].toUpperCase()} 성격의 특성을 반영한 양보 가능한 부분을 작성하세요. 어떤 조건에서 양보할 수 있는지 포함"
    }` : ''}${selectedMBTI.length > 2 ? `,
    {
      "id": "${selectedMBTI[2]}",
      "name": "실제 한국 이름 (또 다른 이름)",
      "department": "부서명3 (앞의 두 부서와 다른 부서)",
      "position": "직책3 (앞의 두 직책과 다른 직책)",
      "experience": "경력3 (앞의 두 경력과 다른 경력)",
      "personaRef": "${selectedMBTI[2]}.json",
      "stance": "100자 이상으로 ${selectedMBTI[2].toUpperCase()} 성격 유형의 특성을 반영한 이 상황에 대한 구체적인 입장과 의견을 작성하세요. 왜 그런 입장을 취하는지, 어떤 가치와 원칙에 기반하는지 포함",
      "goal": "100자 이상으로 ${selectedMBTI[2].toUpperCase()} 성격의 특성을 반영한 개인적 목표와 원하는 결과를 작성하세요. 이 상황에서 달성하고 싶은 것과 피하고 싶은 것 포함",
      "tradeoff": "100자 이상으로 ${selectedMBTI[2].toUpperCase()} 성격의 특성을 반영한 양보 가능한 부분을 작성하세요. 어떤 조건에서 양보할 수 있는지 포함"
    }` : ''}
  ],
  "recommendedFlow": ["${selectedMBTI[0] || 'istj'}"${selectedMBTI.length > 1 ? `, "${selectedMBTI[1]}"` : ''}${selectedMBTI.length > 2 ? `, "${selectedMBTI[2]}"` : ''}],
  "difficulty": ${request.difficulty || 3},
  "estimatedTime": "${request.estimatedTime || '60-90분'}",
  "skills": [${request.skills ? request.skills.split(',').map(skill => `"${skill.trim()}"`).join(', ') : '"갈등 중재", "협상", "문제 해결", "의사소통", "리더십"'}]
}

## 필수 준수 사항 (매우 중요!)
1. **description은 반드시 1000자 이상**, **situation은 반드시 500자 이상**으로 작성하세요. 이보다 짧으면 다시 작성해야 합니다.
2. 반드시 ${selectedMBTI.length}명의 페르소나만 생성하세요 (지정된 MBTI 유형: ${selectedMBTI.join(', ')})
3. 각 페르소나의 "id"는 정확히 지정된 MBTI 소문자 4글자를 사용하세요
4. 각 페르소나는 서로 다른 부서에 소속시켜 부서간 갈등 상황을 만드세요
5. 페르소나의 name, department, position, experience는 구체적인 한국 이름과 직장 정보를 사용하세요
6. **stance, goal, tradeoff는 각각 100자 이상**으로 해당 MBTI 성격 유형 특성에 맞는 현실적인 내용으로 작성하세요
7. personaRef는 반드시 "MBTI유형.json" 형태로 작성하세요 (예: istj.json, enfj.json)
8. JSON 형식을 정확히 지켜주세요 (마지막 요소 뒤에 쉼표 없음)
9. 모든 텍스트는 자연스러운 한국어로 작성하고, 피평가자가 상황에 몰입할 수 있도록 구체적인 디테일을 포함하세요

## MBTI 유형별 특성 참고
- ISTJ: 신중하고 체계적, 규정과 절차 중시, 품질과 안정성 우선
- ISFJ: 배려심 깊고 헌신적, 조화와 팀워크 중시, 실질적 도움 제공
- INFJ: 통찰력 있고 이상적, 의미와 가치 추구, 장기적 비전 중시
- INTJ: 전략적이고 독립적, 효율성과 혁신 추구, 높은 기준 유지
- ISTP: 분석적이고 실용적, 문제 해결 능력, 유연한 대응
- ISFP: 적응력 있고 온화함, 개인의 가치 중시, 조화로운 환경 선호
- INFP: 이상주의적이고 공감적, 진정성과 의미 추구, 창의적 해결책
- INTP: 논리적이고 분석적, 지적 호기심, 혁신적 아이디어
- ESTP: 행동 지향적이고 현실적, 즉각적 문제 해결, 위험 감수
- ESFP: 열정적이고 사교적, 즐거움과 조화 추구, 실용적 접근
- ENFP: 창의적이고 열정적, 가능성 탐색, 변화와 혁신 추구
- ENTP: 혁신적이고 도전적, 논쟁과 아이디어 탐구, 새로운 방법 시도
- ESTJ: 조직적이고 실용적, 효율성과 결과 중시, 명확한 체계 선호
- ESFJ: 협력적이고 배려심 깊음, 조화와 팀워크 중시, 실질적 도움 제공
- ENFJ: 카리스마 있고 공감적, 팀 발전과 조화 추구, 사람 중심적
- ENTJ: 결단력 있고 목표 지향적, 효율성과 결과 중시, 리더십 발휘`;

  try {
    // DB에서 설정된 모델 가져오기 (Gemini만 지원)
    let configuredModel = await getModelForFeature('scenario');
    // Gemini 모델만 지원하므로 비-Gemini 모델이 설정되면 기본값으로 폴백
    if (!configuredModel.startsWith('gemini-')) {
      console.log(`⚠️ 시나리오 생성은 Gemini만 지원합니다. ${configuredModel} → gemini-2.5-flash로 폴백`);
      configuredModel = 'gemini-2.5-flash';
    }
    console.log(`🎬 시나리오 생성 모델: ${configuredModel}`);
    
    const response = await ai.models.generateContent({
      model: configuredModel,
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

    const rawJson = extractText(response);
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
    
    // 내용 길이 검증
    const descriptionLength = data.description?.length || 0;
    const situationLength = data.context?.situation?.length || 0;
    const stakesLength = data.context?.stakes?.length || 0;
    
    console.log(`📝 시나리오 내용 길이 검증:`);
    console.log(`   - description: ${descriptionLength}자 (최소 1000자 필요)`);
    console.log(`   - situation: ${situationLength}자 (최소 500자 필요)`);
    console.log(`   - stakes: ${stakesLength}자 (최소 200자 필요)`);
    
    // 경고 로그 출력 (기준 미달 시)
    if (descriptionLength < 1000) {
      console.warn(`⚠️ description이 ${descriptionLength}자로 1000자 미만입니다. 더 상세한 시나리오가 권장됩니다.`);
    }
    if (situationLength < 500) {
      console.warn(`⚠️ situation이 ${situationLength}자로 500자 미만입니다. 더 상세한 상황 설명이 권장됩니다.`);
    }
    if (stakesLength < 200) {
      console.warn(`⚠️ stakes가 ${stakesLength}자로 200자 미만입니다. 더 상세한 이해관계 설명이 권장됩니다.`);
    }
    
    // 페르소나별 내용 길이 검증
    if (data.personas && Array.isArray(data.personas)) {
      data.personas.forEach((persona: any, index: number) => {
        const stanceLen = persona.stance?.length || 0;
        const goalLen = persona.goal?.length || 0;
        const tradeoffLen = persona.tradeoff?.length || 0;
        
        if (stanceLen < 100 || goalLen < 100 || tradeoffLen < 100) {
          console.warn(`⚠️ 페르소나 ${index + 1} (${persona.name || persona.id})의 내용이 부족합니다: stance=${stanceLen}자, goal=${goalLen}자, tradeoff=${tradeoffLen}자`);
        }
      });
    }
    
    // 키워드 기반 시나리오 ID 생성 (타임스탬프 포함)
    const scenarioId = generateScenarioId(data.title);
    console.log('생성된 시나리오 ID:', scenarioId);
    
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
    // DB에서 설정된 모델 가져오기 (Gemini만 지원)
    let configuredModel = await getModelForFeature('scenario');
    // Gemini 모델만 지원하므로 비-Gemini 모델이 설정되면 기본값으로 폴백
    if (!configuredModel.startsWith('gemini-')) {
      console.log(`⚠️ 시나리오 개선은 Gemini만 지원합니다. ${configuredModel} → gemini-2.5-flash로 폴백`);
      configuredModel = 'gemini-2.5-flash';
    }
    console.log(`🔧 시나리오 개선 모델: ${configuredModel}`);
    
    const response = await ai.models.generateContent({
      model: configuredModel,
      config: {
        responseMimeType: "application/json"
      },
      contents: prompt
    });

    const rawJson = extractText(response);
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