// 새로운 시나리오 시스템 타입 정의
export interface ScenarioPersona {
  id: string;
  name: string;
  role: string;
  department: string;
  experience: string;
  gender?: 'male' | 'female'; // 성별 필드 추가 (optional)
  personality: {
    traits: string[];
    communicationStyle: string;
    motivation: string;
    fears: string[];
  };
  background: {
    education: string;
    previousExperience: string;
    majorProjects: string[];
    expertise: string[];
  };
  currentSituation: {
    workload: string;
    pressure: string;
    concerns: string[];
    position: string;
  };
  communicationPatterns: {
    openingStyle: string;
    keyPhrases: string[];
    responseToArguments: Record<string, string>;
    winConditions: string[];
  };
  image: string;
  voice: {
    tone: string;
    pace: string;
    emotion: string;
  };
  // MBTI 기반 시나리오 전용 필드들
  stance?: string;
  goal?: string;
  tradeoff?: string;
  mbti?: string;
  // 대화 난이도 (1-4 단계)
  conversationDifficultyLevel?: number; // 1: 매우 쉬움, 2: 기본, 3: 도전형, 4: 고난도 (기본값)
  conversationDifficultyDescription?: string; // 난이도 설명
}

export interface ComplexScenario {
  id: string;
  title: string;
  description: string;
  image?: string; // 시나리오를 상징하는 이미지 URL
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
  personas: string[]; // persona IDs
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

// 현재 시나리오/페르소나 데이터 (임시 - 실제로는 JSON에서 로드)
export const complexScenarios: ComplexScenario[] = [
  {
    id: "app-delay-crisis",
    title: "신규 스마트폰 앱 기능 출시 일정 지연 문제",
    description: "개발팀은 안정성과 품질 확보를 위해 시간이 필요하지만, 마케팅팀은 신제품 발표 행사에 맞춰 런칭을 강행 요구하는 상황입니다. 각 부서의 이해관계가 충돌하는 가운데, 신입사원으로서 합리적인 해결책을 찾아야 합니다.",
    context: {
      situation: "신규 스마트폰 UX 개선 기능의 출시 일정이 지연되면서 부서 간 갈등이 심화되고 있습니다.",
      timeline: "마케팅팀의 신제품 발표 행사까지 1주일 남음",
      stakes: "제품 품질 vs 마케팅 일정 vs 고객 만족도",
      playerRole: {
        position: "신입 개발자",
        department: "개발팀",
        experience: "6개월차",
        responsibility: "각 부서와 협의하여 최적의 해결안 도출"
      }
    },
    objectives: [
      "각 부서의 이해관계와 우려사항 파악",
      "부서 간 갈등을 중재하고 합의점 도출",
      "품질과 일정을 균형있게 고려한 현실적 해결책 제시",
      "모든 이해관계자가 수용할 수 있는 Win-Win 전략 수립"
    ],
    successCriteria: {
      optimal: "모든 부서가 만족하는 타협안 도출 (데모 버전 + 정식 출시 일정 분리)",
      good: "주요 이해관계자들의 핵심 요구사항 반영한 해결책",
      acceptable: "최소한의 품질 기준을 유지하면서 일정 준수",
      failure: "부서 간 갈등 심화 또는 비현실적 해결책 제시"
    },
    personas: [
      "dev-senior-lee",
      "marketing-manager-kim", 
      "qa-specialist-park",
      "service-manager-jung",
      "pm-director-oh"
    ],
    recommendedFlow: [
      "dev-senior-lee",
      "marketing-manager-kim",
      "qa-specialist-park", 
      "service-manager-jung",
      "pm-director-oh"
    ],
    difficulty: 4,
    estimatedTime: "60-90분",
    skills: [
      "갈등 중재",
      "이해관계자 관리", 
      "문제 해결",
      "협상",
      "의사소통",
      "프로젝트 관리"
    ]
  }
];

export const scenarioPersonas: Record<string, ScenarioPersona> = {
  "dev-senior-lee": {
    id: "dev-senior-lee",
    name: "이성민",
    role: "개발팀 선임",
    department: "개발팀",
    experience: "8년차",
    personality: {
      traits: ["꼼꼼함", "보수적", "완벽주의", "책임감 강함"],
      communicationStyle: "신중하고 논리적, 때로는 고집스러움",
      motivation: "안정적이고 완벽한 제품 출시",
      fears: ["불완전한 제품으로 인한 사용자 불만", "개발팀 신뢰도 하락", "기술적 부채 증가"]
    },
    background: {
      education: "컴퓨터공학과",
      previousExperience: "대기업 개발팀 5년, 현재 회사 3년",
      majorProjects: ["이전 앱 출시에서 성급한 런칭으로 인한 버그 대응 경험"],
      expertise: ["모바일 앱 개발", "품질 관리", "성능 최적화"]
    },
    currentSituation: {
      workload: "신규 기능 개발 및 테스트 진행 중",
      pressure: "마케팅팀과 상급자들의 출시 압박",
      concerns: [
        "현재 발견된 UX 이슈들이 완전히 해결되지 않음",
        "성능 테스트가 충분하지 않음", 
        "사용자 피드백 반영 시간 부족"
      ],
      position: "최소 2주의 추가 개발 시간 필요 주장"
    },
    communicationPatterns: {
      openingStyle: "신중하고 우려사항 중심으로 대화 시작",
      keyPhrases: [
        "완벽하게 검증되지 않으면 출시할 수 없습니다",
        "이전 프로젝트에서 성급한 출시로 고생한 경험이 있어서...",
        "사용자 경험을 생각하면 절대 타협할 수 없는 부분입니다",
        "기술적으로 보면..."
      ],
      responseToArguments: {
        "시간압박": "품질 저하는 더 큰 손실을 가져옵니다",
        "비즈니스요구": "사용자 만족도가 최우선이어야 합니다", 
        "타협제안": "최소한의 안전장치는 반드시 필요합니다"
      },
      winConditions: [
        "충분한 테스트 시간 보장",
        "핵심 기능의 품질 기준 유지",
        "단계적 출시 일정 수립"
      ]
    },
    image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=150&h=150",
    voice: {
      tone: "신중하고 진지함",
      pace: "느리고 신중함",
      emotion: "우려와 책임감"
    }
  },
  "marketing-manager-kim": {
    id: "marketing-manager-kim",
    name: "김혜린",
    role: "마케팅팀 차장",
    department: "마케팅팀",
    experience: "12년차",
    personality: {
      traits: ["성과 중심", "적극적", "추진력 강함", "결과 지향적"],
      communicationStyle: "직설적이고 강력함, 목표 달성에 집중",
      motivation: "신제품 발표 행사 성공적 진행",
      fears: ["마케팅 전략 실패", "경쟁사 대비 출시 지연", "투자 대비 효과 저하"]
    },
    background: {
      education: "경영학과, MBA",
      previousExperience: "글로벌 기업 마케팅팀 7년, 현재 회사 5년",
      majorProjects: ["작년 신제품 런칭으로 매출 30% 증가 달성"],
      expertise: ["제품 마케팅", "런칭 전략", "브랜드 관리", "언론 대응"]
    },
    currentSituation: {
      workload: "신제품 발표 행사 준비 및 언론 대응",
      pressure: "이미 확정된 발표 일정과 투자된 마케팅 비용",
      concerns: [
        "발표 행사에서 시연할 기능이 없으면 마케팅 효과 반감",
        "경쟁사 대비 출시 시기 지연으로 시장 기회 상실",
        "이미 공지된 일정 변경의 부정적 이미지"
      ],
      position: "무조건 예정된 발표 행사에 맞춰 출시 강행"
    },
    communicationPatterns: {
      openingStyle: "강력하고 직접적으로 요구사항 제시",
      keyPhrases: [
        "이미 모든 일정이 확정되어 움직일 수 없습니다",
        "행사에서 시연이 안 되면 마케팅 효과가 완전히 사라져요",
        "완벽하지 않아도 일단 출시하고 업데이트하면 됩니다",
        "시장 타이밍을 놓치면 돌이킬 수 없어요"
      ],
      responseToArguments: {
        "품질우려": "사용자들은 완벽함보다 혁신을 원합니다",
        "기술적문제": "마케팅적으로는 충분히 어필할 수 있습니다",
        "연기제안": "한 번 놓친 기회는 다시 오지 않습니다"
      },
      winConditions: [
        "발표 행사에서 시연 가능한 버전 확보",
        "언론과 고객에게 공개할 수 있는 기능",
        "마케팅 메시지와 일치하는 제품 경험"
      ]
    },
    image: "https://images.unsplash.com/photo-1580489944761-15a19d654956?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=150&h=150",
    voice: {
      tone: "강력하고 확신에 참",
      pace: "빠르고 역동적",
      emotion: "긴박함과 열정"
    }
  },
  "qa-specialist-park": {
    id: "qa-specialist-park",
    name: "박준혁",
    role: "QA 전문가",
    department: "품질보증팀",
    experience: "6년차",
    personality: {
      traits: ["신중함", "리스크 회피", "세심함", "원칙주의"],
      communicationStyle: "조심스럽고 데이터 기반, 위험 요소 강조",
      motivation: "제품 품질 보증 및 사용자 안전 확보",
      fears: ["품질 문제로 인한 대규모 클레임", "QA팀 책임 추궁", "브랜드 이미지 손상"]
    },
    background: {
      education: "산업공학과",
      previousExperience: "QA 전문회사 3년, 현재 회사 3년",
      majorProjects: ["이전 제품에서 QA 미흡으로 인한 리콜 사태 경험"],
      expertise: ["품질 관리", "테스트 설계", "리스크 분석", "프로세스 개선"]
    },
    currentSituation: {
      workload: "신규 기능 품질 검증 및 테스트 케이스 작성",
      pressure: "제한된 시간 내 완벽한 품질 보증 요구",
      concerns: [
        "충분한 테스트 시간 부족으로 숨겨진 버그 존재 가능성",
        "다양한 디바이스 환경에서의 호환성 미검증",
        "사용자 시나리오 기반 테스트 부족"
      ],
      position: "품질 기준을 충족할 때까지 출시 연기 필요"
    },
    communicationPatterns: {
      openingStyle: "우려사항과 데이터를 바탕으로 신중하게 접근",
      keyPhrases: [
        "현재 테스트 완성도는 60% 수준입니다",
        "불량 발생 시 모든 책임이 QA팀에게 돌아옵니다",
        "이전 사례를 보면 성급한 출시의 위험성이...",
        "최소한의 안전장치는 반드시 필요합니다"
      ],
      responseToArguments: {
        "일정압박": "품질 문제는 더 큰 비용과 시간을 요구합니다",
        "마케팅요구": "사용자 불만은 브랜드 이미지에 치명적입니다",
        "부분출시": "제한적 기능이라도 철저한 검증이 필요합니다"
      },
      winConditions: [
        "핵심 기능에 대한 완전한 테스트 완료",
        "리스크 수준을 허용 가능한 범위로 축소",
        "문제 발생 시 대응 방안 수립"
      ]
    },
    image: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=150&h=150",
    voice: {
      tone: "신중하고 분석적",
      pace: "차분하고 정확함",
      emotion: "우려와 책임감"
    }
  },
  "service-manager-jung": {
    id: "service-manager-jung",
    name: "정소영",
    role: "고객서비스팀 매니저",
    department: "고객서비스팀",
    experience: "9년차",
    personality: {
      traits: ["고객 중심", "현실적", "경험 기반", "해결책 지향"],
      communicationStyle: "실용적이고 구체적, 고객 관점에서 조언",
      motivation: "고객 만족도 유지 및 서비스 품질 확보",
      fears: ["고객 불만 폭증", "서비스팀 업무 과부하", "브랜드 신뢰도 하락"]
    },
    background: {
      education: "사회학과",
      previousExperience: "콜센터 상담원 3년, 팀리더 2년, 현재 매니저 4년",
      majorProjects: ["이전 제품 출시 시 고객 불만 대응 및 프로세스 개선"],
      expertise: ["고객 관리", "불만 처리", "서비스 프로세스", "팀 관리"]
    },
    currentSituation: {
      workload: "신제품 출시 대비 고객 대응 매뉴얼 준비",
      pressure: "예상되는 고객 문의 및 불만 대응 준비",
      concerns: [
        "미완성 기능으로 인한 고객 불만 및 문의 폭증",
        "서비스팀의 대응 능력 한계",
        "고객 신뢰도 회복의 어려움"
      ],
      position: "고객 영향을 최소화할 수 있는 안전한 출시 방안 필요"
    },
    communicationPatterns: {
      openingStyle: "고객 관점에서 현실적인 우려사항 제기",
      keyPhrases: [
        "고객들은 생각보다 민감하게 반응합니다",
        "이전에 비슷한 상황에서 CS 문의가 300% 증가했어요",
        "불완전한 기능이 나가면 우리 팀이 모든 불만을 감당해야 해요",
        "고객 입장에서 생각해보면..."
      ],
      responseToArguments: {
        "기술적완성도": "고객은 기술적 이유를 이해하지 못합니다",
        "마케팅필요성": "나쁜 첫인상은 회복하기 어렵습니다",
        "부분기능": "명확한 안내와 대응 방안이 필요합니다"
      },
      winConditions: [
        "고객이 이해할 수 있는 명확한 기능 범위 정의",
        "문제 발생 시 즉시 대응 가능한 시스템 구축",
        "고객 기대치 관리를 위한 사전 커뮤니케이션"
      ]
    },
    image: "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=150&h=150",
    voice: {
      tone: "따뜻하지만 현실적",
      pace: "안정적이고 설득력 있음",
      emotion: "공감과 걱정"
    }
  },
  "pm-director-oh": {
    id: "pm-director-oh",
    name: "오진우",
    role: "프로젝트 총괄 부장",
    department: "기획팀",
    experience: "15년차",
    personality: {
      traits: ["균형감각", "리더십", "전략적 사고", "결단력"],
      communicationStyle: "포괄적이고 균형잡힌 시각, 결정을 요구",
      motivation: "프로젝트 성공과 회사 전체 이익 추구",
      fears: ["프로젝트 실패", "회사 손실", "팀 간 갈등 심화", "상급자 책임 추궁"]
    },
    background: {
      education: "경영학과, 공학 석사",
      previousExperience: "대기업 PM 7년, 현재 회사 8년",
      majorProjects: ["다수의 성공적인 제품 출시 경험", "위기 상황 관리 및 해결"],
      expertise: ["프로젝트 관리", "이해관계자 조율", "전략 기획", "위기 관리"]
    },
    currentSituation: {
      workload: "전체 프로젝트 총괄 및 임원진 보고",
      pressure: "성공적인 프로젝트 완료와 부서 간 갈등 해결",
      concerns: [
        "부서 간 이해관계 충돌로 인한 프로젝트 지연",
        "잘못된 결정으로 인한 회사 손실",
        "팀워크 저하 및 조직 문화 악화"
      ],
      position: "모든 이해관계자가 수용할 수 있는 최적안 도출 필요"
    },
    communicationPatterns: {
      openingStyle: "전체적인 상황을 정리하고 해결책 모색 요구",
      keyPhrases: [
        "모든 부서의 입장을 종합해서 판단해야 합니다",
        "회사 전체의 이익을 생각해야 해요",
        "현실적이면서도 모두가 납득할 수 있는 방안이 필요합니다",
        "당신이라면 어떤 해결책을 제시하겠습니까?"
      ],
      responseToArguments: {
        "부서별요구": "각 부서의 핵심 요구사항을 파악해야 합니다",
        "타협안": "실현 가능성과 효과를 검토해봅시다",
        "위험요소": "리스크 관리 방안도 함께 고려해야 합니다"
      },
      winConditions: [
        "모든 이해관계자가 수용 가능한 해결책",
        "회사 전체 이익을 고려한 균형잡힌 방안",
        "실행 가능하고 측정 가능한 계획"
      ]
    },
    image: "https://images.unsplash.com/photo-1519345182560-3f2917c472ef?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=150&h=150",
    voice: {
      tone: "안정적이고 권위있음",
      pace: "신중하고 명확함",
      emotion: "냉정한 판단력과 책임감"
    }
  }
};

// 유틸리티 함수들
export const getComplexScenarioById = (id: string): ComplexScenario | undefined => {
  return complexScenarios.find(scenario => scenario.id === id);
};

export const getPersonaById = (id: string): ScenarioPersona | undefined => {
  return scenarioPersonas[id];
};

export const getPersonasForScenario = (scenarioId: string): ScenarioPersona[] => {
  const scenario = getComplexScenarioById(scenarioId);
  if (!scenario) return [];
  
  return scenario.personas.map(personaId => scenarioPersonas[personaId]).filter(Boolean);
};

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