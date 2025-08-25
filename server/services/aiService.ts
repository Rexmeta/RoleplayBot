import type { ConversationMessage, EvaluationScore, DetailedFeedback } from "@shared/schema";

// AI 서비스 공통 인터페이스
export interface AIServiceInterface {
  generateResponse(
    scenario: string, 
    messages: ConversationMessage[], 
    persona: ScenarioPersona,
    userMessage?: string
  ): Promise<{ content: string; emotion: string; emotionReason: string }>;
  
  generateFeedback(
    scenario: string, 
    messages: ConversationMessage[], 
    persona: ScenarioPersona
  ): Promise<DetailedFeedback>;
}

export interface ScenarioPersona {
  id: string;
  name: string;
  role: string;
  personality: string;
  responseStyle: string;
  goals: string[];
  background: string;
}

// AI 서비스 설정
export interface AIServiceConfig {
  provider: 'gemini' | 'openai' | 'claude' | 'custom';
  apiKey: string;
  model?: string;
  baseUrl?: string; // Custom API용
  headers?: Record<string, string>; // Custom API용
}

// 환경 변수에서 AI 서비스 설정 로드
export function getAIServiceConfig(): AIServiceConfig {
  const provider = (process.env.AI_PROVIDER as any) || 'gemini';
  
  switch (provider) {
    case 'openai':
      return {
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY || '',
        model: process.env.OPENAI_MODEL || 'gpt-4'
      };
    case 'claude':
      return {
        provider: 'claude',
        apiKey: process.env.CLAUDE_API_KEY || '',
        model: process.env.CLAUDE_MODEL || 'claude-3-sonnet-20240229'
      };
    case 'custom':
      return {
        provider: 'custom',
        apiKey: process.env.CUSTOM_API_KEY || '',
        model: process.env.CUSTOM_MODEL || '',
        baseUrl: process.env.CUSTOM_API_URL || '',
        headers: process.env.CUSTOM_HEADERS ? JSON.parse(process.env.CUSTOM_HEADERS) : {}
      };
    default: // gemini
      return {
        provider: 'gemini',
        apiKey: process.env.GEMINI_API_KEY || '',
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash'
      };
  }
}

// 감정 분류 매핑 (공통)
export const emotionEmojis: { [key: string]: string } = {
  '기쁨': '😊',
  '슬픔': '😢',
  '분노': '😠',
  '놀람': '😲',
  '중립': '😐'
};

// 시나리오 페르소나 정보 (공통)
export const SCENARIO_PERSONAS: Record<string, ScenarioPersona> = {
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
    personality: "위기 상황에서 냉정함을 유지하려 하지만 내적으로는 불안함. 문제 해결을 위한 즉각적인 행동을 선호함.",
    responseStyle: "급박한 상황의 심각성을 강조하며, 빠른 의사결정과 실행을 요구함. 압박감을 조성하는 표현을 자주 사용함.",
    goals: ["위기 관리 능력 평가", "의사결정 스킬 확인", "압박 상황 대응력 테스트"],
    background: "8년간 다양한 프로젝트를 관리하며 위기 상황을 많이 경험함. 빠른 해결책을 찾는 것에 능숙함."
  }
};