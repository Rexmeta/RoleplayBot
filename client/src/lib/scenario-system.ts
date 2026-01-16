// 시나리오 페르소나 타입 정의 (실제 JSON 구조와 일치)
// AI 생성 시나리오와 하드코딩된 레거시 시나리오 모두 지원
export interface ScenarioPersona {
  id: string;
  name: string;
  department?: string;      // AI 생성 시나리오에서는 포함됨
  experience?: string;      // AI 생성 시나리오에서는 포함됨
  gender?: 'male' | 'female';
  
  // 실제 JSON에서 사용하는 필드들 (AI 생성 시나리오)
  position?: string;        // 직급/직책 (예: "연구소장", "팀장")
  personaRef?: string;      // MBTI 기반 페르소나 참조 (예: "intp.json")
  stance?: string;          // 입장/태도
  goal?: string;            // 목표
  tradeoff?: string;        // 협상 가능 범위
  mbti?: string;            // MBTI 유형
  
  // 레거시 호환성을 위한 필드들 (하드코딩 시나리오)
  role?: string;            // 역할 설명 (예: "개발팀 선임")
  image?: string;
  personality?: {
    traits: string[];
    communicationStyle: string;
    motivation: string;
    fears: string[];
  };
  background?: {
    education: string;
    previousExperience: string;
    majorProjects: string[];
    expertise: string[];
  };
  currentSituation?: {
    workload: string;
    pressure: string;
    concerns: string[];
    position: string;
  };
  communicationPatterns?: {
    openingStyle: string;
    keyPhrases: string[];
    responseToArguments: Record<string, string>;
    winConditions: string[];
  };
  voice?: {
    tone: string;
    pace: string;
    emotion: string;
  };
}

export interface ComplexScenario {
  id: string;
  title: string;
  description: string;
  image?: string;
  imagePrompt?: string;
  categoryId?: string;
  introVideoUrl?: string;
  videoPrompt?: string;
  objectiveType?: string;
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
  // 실제 JSON에서는 ScenarioPersona 객체 배열로 저장됨
  // 모든 시나리오는 객체 배열로 통일됨 (레거시 string[] 지원 제거)
  personas: ScenarioPersona[];
  recommendedFlow: string[];
  difficulty: number;
  estimatedTime: string;
  skills: string[];
}

export interface PlayerProfile {
  position: string;
  department: string;
  experience: string;
  role: string;
}

// 유틸리티 함수들
export const getDifficultyColor = (difficulty: number): string => {
  if (difficulty === 1) return "green";
  if (difficulty === 2) return "yellow"; 
  if (difficulty === 3) return "orange";
  return "red";
};

export const getDifficultyLabel = (difficulty: number): string => {
  if (difficulty === 1) return "매우 쉬움";
  if (difficulty === 2) return "기본";
  if (difficulty === 3) return "도전형";
  return "고난도";
};

// 페르소나에서 표시용 직급/역할 정보 추출 헬퍼
export const getPersonaDisplayRole = (persona: ScenarioPersona): string => {
  // position 필드 우선 (AI 생성 시나리오)
  if (persona.position) return persona.position;
  // role 필드 (레거시 시나리오)
  if (persona.role) return persona.role;
  // currentSituation.position (레거시 중첩 구조)
  if (persona.currentSituation?.position) return persona.currentSituation.position;
  return '';
};