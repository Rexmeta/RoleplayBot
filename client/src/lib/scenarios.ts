export interface Scenario {
  id: string;
  name: string;
  role: string;
  description: string;
  skills: string[];
  difficulty: number;
  estimatedTime: string;
  image: string;
  difficultyStars: string;
}

export const scenarios: Scenario[] = [
  {
    id: "communication",
    name: "김태훈",
    role: "선임 연구원 · 7년차", 
    description: "까다로운 성격의 선임으로, 명확하고 논리적인 커뮤니케이션을 요구합니다.",
    skills: ["커뮤니케이션", "논리적 사고"],
    difficulty: 2,
    estimatedTime: "약 15분",
    image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=150&h=150",
    difficultyStars: "★★☆"
  },
  {
    id: "empathy", 
    name: "이선영",
    role: "팀장 · 10년차",
    description: "스트레스가 많은 상황에서 감정적으로 반응하는 팀장과의 대화 훈련입니다.",
    skills: ["공감력", "갈등 해결"],
    difficulty: 3,
    estimatedTime: "약 20분", 
    image: "https://images.unsplash.com/photo-1494790108755-2616b612b587?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=150&h=150",
    difficultyStars: "★★★"
  },
  {
    id: "negotiation",
    name: "박준호", 
    role: "클라이언트 · 대표이사",
    description: "예산과 일정에 대해 강하게 요구사항을 제시하는 클라이언트와의 협상 훈련입니다.",
    skills: ["협상력", "설득력"],
    difficulty: 3,
    estimatedTime: "약 25분",
    image: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=150&h=150",
    difficultyStars: "★★★"
  },
  {
    id: "presentation",
    name: "정미경",
    role: "임원 · 15년차", 
    description: "날카로운 질문을 던지는 임원진 앞에서 프레젠테이션하는 상황입니다.",
    skills: ["프레젠테이션", "압박 대응"],
    difficulty: 2,
    estimatedTime: "약 18분",
    image: "https://images.unsplash.com/photo-1580489944761-15a19d654956?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=150&h=150",
    difficultyStars: "★★☆"
  },
  {
    id: "feedback",
    name: "최민수",
    role: "후배 사원 · 1년차",
    description: "실수를 반복하는 후배에게 건설적인 피드백을 전달하는 훈련입니다.",
    skills: ["피드백", "멘토링"],
    difficulty: 1,
    estimatedTime: "약 12분",
    image: "https://images.unsplash.com/photo-1519345182560-3f2917c472ef?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=150&h=150",
    difficultyStars: "★☆☆"
  },
  {
    id: "crisis",
    name: "한지연",
    role: "프로젝트 매니저 · 8년차",
    description: "긴급한 문제 상황에서 빠른 의사결정과 대응이 필요한 위기 관리 훈련입니다.",
    skills: ["위기 관리", "의사결정"],
    difficulty: 3,
    estimatedTime: "약 22분",
    image: "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=150&h=150",
    difficultyStars: "★★★"
  }
];

export const getScenarioById = (id: string): Scenario | undefined => {
  return scenarios.find(scenario => scenario.id === id);
};

export const getSkillColor = (skill: string): string => {
  const colorMap: Record<string, string> = {
    "커뮤니케이션": "blue",
    "논리적 사고": "purple", 
    "공감력": "green",
    "갈등 해결": "orange",
    "협상력": "red",
    "설득력": "yellow",
    "프레젠테이션": "indigo",
    "압박 대응": "pink",
    "피드백": "teal", 
    "멘토링": "gray",
    "위기 관리": "red",
    "의사결정": "orange"
  };
  
  return colorMap[skill] || "gray";
};
