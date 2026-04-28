export type ConversationMessage = {
  sender: "user" | "ai";
  message: string;
  timestamp: string;
  emotion?: string;
  emotionReason?: string;
  personaId?: string;
  interrupted?: boolean;
};

export type EvaluationScore = {
  category: string;
  name: string;
  score: number;
  feedback: string;
  icon: string;
  color: string;
};

export type ActionGuide = {
  situation: string;
  action: string;
  example: string;
  impact: string;
};

export type ConversationGuide = {
  scenario: string;
  goodExample: string;
  badExample: string;
  keyPoints: string[];
};

export type PlanItem = {
  goal: string;
  actions: string[];
  measurable: string;
};

export type DevelopmentPlan = {
  shortTerm: PlanItem[];
  mediumTerm: PlanItem[];
  longTerm: PlanItem[];
  recommendedResources: string[];
};

export type DetailedFeedback = {
  overallScore: number;
  scores: {
    clarityLogic: number;
    listeningEmpathy: number;
    appropriatenessAdaptability: number;
    persuasivenessImpact: number;
    strategicCommunication: number;
    strategicSelection?: number;
    [key: string]: number | undefined;
  };
  dimensionFeedback?: Record<string, string>;
  strengths: string[];
  improvements: string[];
  nextSteps: string[];
  summary: string;
  ranking?: string;
  behaviorGuides?: ActionGuide[];
  conversationGuides?: ConversationGuide[];
  developmentPlan?: DevelopmentPlan;
  conversationDuration?: number;
  averageResponseTime?: number;
  timePerformance?: {
    rating: 'excellent' | 'good' | 'average' | 'slow';
    feedback: string;
  };
  sequenceAnalysis?: SequenceAnalysis;
  evaluationCriteriaSetId?: string;
  evaluationCriteriaSetName?: string;
  scoreAdjustments?: {
    baseScore: number;
    nonVerbalPenalty: number;
    bargeInAdjustment: number;
    completionPenalty: number;
    scoreCap: number | null;
    finalScore: number;
    nonVerbalCount?: number;
    bargeInCount?: number;
    completionRatio?: number;
  };
};

export type PersonaSelection = {
  phase: number;
  personaId: string;
  selectionReason: string;
  timestamp: string;
  expectedOutcome: string;
};

export type StrategyChoice = {
  phase: number;
  choice: string;
  reasoning: string;
  expectedImpact: string;
  actualOutcome?: string;
  effectiveness?: number;
};

export type PersonaStatus = {
  personaId: string;
  name: string;
  currentMood: 'positive' | 'neutral' | 'negative' | 'unknown';
  approachability: number;
  influence: number;
  hasBeenContacted: boolean;
  lastInteractionResult?: 'success' | 'neutral' | 'failure';
  availableInfo: string[];
  keyRelationships: string[];
};

export type SequenceAnalysis = {
  selectionOrder?: number[];
  optimalOrder?: number[];
  orderScore?: number;
  reasoningQuality?: number;
  strategicThinking?: number;
  adaptability?: number;
  overallEffectiveness?: number;
  detailedAnalysis?: string;
  improvements?: string[];
  strengths?: string[];
  strategicScore?: number;
  strategicRationale?: string;
  sequenceEffectiveness?: string;
  alternativeApproaches?: string[];
  strategicInsights?: string;
};

export type ScoringRubric = {
  score: number;
  label: string;
  description: string;
};

export type AiUsageSummary = {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  totalCostUsd: number;
  requestCount: number;
};

export type AiUsageByFeature = {
  feature: string;
  totalTokens: number;
  totalCostUsd: number;
  requestCount: number;
};

export type AiUsageByModel = {
  model: string;
  provider: string;
  totalTokens: number;
  totalCostUsd: number;
  requestCount: number;
};

export type AiUsageDaily = {
  date: string;
  totalTokens: number;
  totalCostUsd: number;
  requestCount: number;
};

export type PersonaContextTranslation = {
  personaId: string;
  position?: string;
  department?: string;
  role?: string;
  stance?: string;
  goal?: string;
  tradeoff?: string;
};

export type TranslationStats = {
  locale: string;
  totalScenarios: number;
  translatedScenarios: number;
  reviewedScenarios: number;
  totalPersonas: number;
  translatedPersonas: number;
  reviewedPersonas: number;
};
