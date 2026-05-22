export type ConversationMessage = {
  sender: "user" | "ai";
  message: string;
  timestamp: string;
  emotion?: string;
  emotionReason?: string;
  personaId?: string;
  interrupted?: boolean;
  turnIndex?: number;
};

export type ScoreAdjustments = {
  baseScore: number;
  nonVerbalPenalty: number;
  noisePenalty: number;
  bargeInAdjustment: number;
  completionPenalty: number;
  evidencePenalty: number;
  scoreCap: number | null;
  finalScore: number;
  nonVerbalCount?: number;
  bargeInCount?: number;
  completionRatio?: number;
  evidenceCappedDimensions?: string[];
};

export type EvaluationScore = {
  category: string;
  name: string;
  score: number;
  feedback: string;
  icon: string;
  color: string;
  maxScore?: number;
  weight?: number;
  evidence?: EvaluationEvidence[];
  evidenceCapped?: boolean;
  originalScore?: number;
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

export type ReportStatus = 'valid' | 'low_confidence' | 'insufficient_data' | 'system_fallback';

export type PersonaSegmentFeedback = {
  personaIndex: number;
  personaName: string;
  turnStart: number;
  turnEnd: number;
  feedback: {
    overallScore: number | null;
    scores?: EvaluationScore[];
    strengths: string[];
    improvements: string[];
    nextSteps: string[];
    summary: string;
    insufficientConversation?: boolean;
  };
};

export type DetailedFeedback = {
  overallScore: number | null;
  scores: EvaluationScore[];
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
  scoreAdjustments?: ScoreAdjustments;
  insufficientConversation?: boolean;
  confidence?: number;
  reportStatus?: ReportStatus;
  insufficientReasons?: string[];
  personaSegmentFeedbacks?: PersonaSegmentFeedback[];
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
  behaviorAnchor?: string;
  positiveIndicators?: string[];
  negativeIndicators?: string[];
};

export type EvaluationEvidence = {
  turnIndex: number;
  quote: string;
  behaviorObserved: string;
  rubricBand: string;
  reason: string;
  isSystemFallback?: boolean;
};

export const EVIDENCE_SCORE_CAP = 4 as const;

export function normalizeRubricBand(band: {
  score: number;
  label: string;
  description: string;
  behaviorAnchor?: string;
  positiveIndicators?: string[];
  negativeIndicators?: string[];
} | null | undefined): ScoringRubric | null {
  if (!band) return null;
  return {
    score: band.score,
    label: band.label ?? '',
    description: band.description ?? '',
    behaviorAnchor: band.behaviorAnchor ?? '',
    positiveIndicators: Array.isArray(band.positiveIndicators) ? band.positiveIndicators : [],
    negativeIndicators: Array.isArray(band.negativeIndicators) ? band.negativeIndicators : [],
  };
}

export type AiUsageSummary = {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  totalCostUsd: number;
  cacheSavingsUsd: number;
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
