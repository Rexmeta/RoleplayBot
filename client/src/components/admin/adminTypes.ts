export interface AnalyticsOverview {
  totalSessions: number;
  completedSessions: number;
  averageScore: number;
  completionRate: number;
  totalUsers: number;
  activeUsers: number;
  participationRate: number;
  scenarioStats: Record<string, { count: number; name: string; difficulty: number }>;
  mbtiUsage: Record<string, number>;
  totalScenarios: number;
  dau: number;
  wau: number;
  mau: number;
  sessionsPerUser: number;
  newUsers: number;
  returningUsers: number;
  returningRate: number;
  scenarioAverages: Array<{ id: string; name: string; averageScore: number; sessionCount: number }>;
  mbtiAverages: Array<{ mbti: string; averageScore: number; sessionCount: number }>;
  topActiveUsers: Array<{ userId: string; sessionCount: number }>;
  topScenarios: Array<{ id: string; name: string; count: number; difficulty: number }>;
  hardestScenarios: Array<{ id: string; name: string; averageScore: number; sessionCount: number }>;
  difficultyUsage: Array<{ level: number; count: number }>;
  lastContentUpdate: string | null;
}

export interface PerformanceData {
  scoreRanges: {
    excellent: number;
    good: number;
    average: number;
    needsImprovement: number;
    poor: number;
  };
  categoryPerformance: Record<string, {
    total: number;
    count: number;
    name: string;
    average: number;
  }>;
  scenarioPerformance: Record<string, {
    scores: number[];
    name: string;
    average: number;
    sessionCount: number;
    difficulty: number;
    personaCount: number;
  }>;
  mbtiPerformance: Record<string, { scores: number[]; count: number; average: number }>;
  topStrengths: Array<{ text: string; count: number }>;
  topImprovements: Array<{ text: string; count: number }>;
  highestScore: number;
  averageScore: number;
  feedbackCompletionRate: number;
  totalFeedbacks: number;
  recentSessions: Array<{
    id: number;
    score: number;
    scenarioName: string;
    mbti: string;
    userId: string;
    completedAt: string;
    difficulty: number;
    criteriaSetVersion?: number | null;
    personaRunId?: string | null;
  }>;
}

export interface TrendsData {
  dailyUsage: Array<{
    date: string;
    sessions: number;
    completed: number;
  }>;
  performanceTrends: Array<{
    session: number;
    score: number;
    date: string;
  }>;
}

export interface EmotionData {
  emotions: Array<{
    emotion: string;
    emoji: string;
    count: number;
    percentage: number;
  }>;
  totalEmotions: number;
  uniqueEmotions: number;
}

export interface ScenarioEmotionData {
  scenarios: Array<{
    scenarioId: string;
    scenarioName: string;
    emotions: Array<{ emotion: string; emoji: string; count: number; percentage: number }>;
    totalCount: number;
    topEmotion: { emotion: string; emoji: string; count: number } | null;
  }>;
}

export interface DifficultyEmotionData {
  difficultyStats: Array<{
    difficulty: number;
    difficultyName: string;
    emotions: Array<{ emotion: string; emoji: string; count: number; percentage: number }>;
    totalCount: number;
    topEmotion: { emotion: string; emoji: string; count: number } | null;
  }>;
}

export interface Participant {
  userId: string;
  name: string;
  email: string;
  role: string;
  tier: string;
  totalSessions: number;
  completedSessions: number;
  averageScore: number | null;
  latestScore: number | null;
  lastTrainingAt: string | null;
  categories: string[];
}
