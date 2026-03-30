import { Router } from "express";
import { storage } from "../storage";
import { fileManager } from "../services/fileManager";
import { getOperatorAccessibleCategoryIds, asyncHandler, createHttpError } from "./routerHelpers";

export default function createAnalyticsRouter(isAuthenticated: any) {
  const router = Router();

  router.get("/api/users/me/feedback-history", isAuthenticated, asyncHandler(async (req, res) => {
    // @ts-ignore
    const userId = req.user?.id;
    const { scenarioId, personaId } = req.query;

    if (!scenarioId || !personaId) {
      throw createHttpError(400, "scenarioId and personaId are required");
    }

    const userScenarioRuns = await storage.getUserScenarioRuns(userId);
    const matchingScenarioRuns = userScenarioRuns.filter(sr => sr.scenarioId === scenarioId);

    if (matchingScenarioRuns.length === 0) {
      return res.json([]);
    }

    const scenarioRunIds = matchingScenarioRuns.map(sr => sr.id);

    const allPersonaRuns: any[] = [];
    for (const srId of scenarioRunIds) {
      const pRuns = await storage.getPersonaRunsByScenarioRun(srId);
      allPersonaRuns.push(...pRuns);
    }

    const matchingPersonaRuns = allPersonaRuns
      .filter(pr => pr.personaId === personaId && pr.status === 'completed')
      .sort((a, b) => new Date(b.completedAt || b.startedAt).getTime() - new Date(a.completedAt || a.startedAt).getTime())
      .slice(0, 5);

    if (matchingPersonaRuns.length === 0) {
      return res.json([]);
    }

    const historyItems = [];
    for (const pr of matchingPersonaRuns) {
      const fb = await storage.getFeedbackByConversationId(pr.id);
      if (fb) {
        historyItems.push({
          personaRunId: pr.id,
          completedAt: pr.completedAt || pr.startedAt,
          overallScore: fb.overallScore,
          scores: fb.scores,
        });
      }
    }

    res.json(historyItems);
  }));

  router.get("/api/analytics/summary", isAuthenticated, asyncHandler(async (req, res) => {
    // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
    const userId = req.user?.id;

    const userScenarioRuns = await storage.getUserScenarioRuns(userId);

    // 롤플레이X 전용 분석: __free_chat__ 및 __user_persona__:* 등 특수 ID 제외
    const roleplayScenarioRuns = userScenarioRuns.filter(sr => !sr.scenarioId.startsWith('__'));
    const completedScenarioRuns = roleplayScenarioRuns.filter(sr => sr.status === 'completed');

    // 롤플레이X 페르소나 런 ID 세트 구성 (feedbacks 필터링용)
    const roleplayPersonaRunIds = await (async () => {
      const runIdSets = await Promise.all(
        roleplayScenarioRuns.map(sr => storage.getPersonaRunsByScenarioRun(sr.id))
      );
      const ids = new Set<string>();
      runIdSets.forEach(runs => runs.forEach(pr => ids.add(pr.id)));
      return ids;
    })();

    const allUserFeedbacks = await storage.getUserFeedbacks(userId);
    // 롤플레이X 피드백만 사용 (자유 대화 제외)
    const userFeedbacks = allUserFeedbacks.filter(
      f => f.personaRunId != null && roleplayPersonaRunIds.has(f.personaRunId)
    );

    if (userFeedbacks.length === 0) {
      return res.json({
        totalSessions: roleplayScenarioRuns.length,
        completedSessions: completedScenarioRuns.length,
        totalFeedbacks: 0,
        averageScore: 0,
        categoryAverages: {},
        scoreHistory: [],
        topStrengths: [],
        topImprovements: [],
        overallGrade: 'N/A',
        progressTrend: 'neutral'
      });
    }

    const averageScore = Math.round(
      userFeedbacks.reduce((acc, f) => acc + f.overallScore, 0) / userFeedbacks.length
    );

    const criteriaSetStats: Record<string, {
      setId: string;
      setName: string;
      feedbackCount: number;
      criteria: Record<string, { total: number; count: number; name: string; icon: string; color: string; }>;
    }> = {};

    userFeedbacks.forEach(feedback => {
      const detailedFb = feedback.detailedFeedback as any;
      const setId = detailedFb?.evaluationCriteriaSetId || 'default-criteria-set';
      const setName = detailedFb?.evaluationCriteriaSetName || '기본 평가 기준';

      if (!criteriaSetStats[setId]) {
        criteriaSetStats[setId] = {
          setId,
          setName,
          feedbackCount: 0,
          criteria: {}
        };
      }
      criteriaSetStats[setId].feedbackCount += 1;

      const scoresArray = feedback.scores as any[];
      if (Array.isArray(scoresArray)) {
        scoresArray.forEach(scoreItem => {
          const key = scoreItem.category;
          if (!criteriaSetStats[setId].criteria[key]) {
            criteriaSetStats[setId].criteria[key] = {
              total: 0,
              count: 0,
              name: scoreItem.name || key,
              icon: scoreItem.icon || '📊',
              color: scoreItem.color || 'blue'
            };
          }
          criteriaSetStats[setId].criteria[key].total += scoreItem.score || 0;
          criteriaSetStats[setId].criteria[key].count += 1;
        });
      }
    });

    const usedCriteriaSets = Object.entries(criteriaSetStats).map(([setId, stats]) => ({
      id: setId,
      name: stats.setName,
      feedbackCount: stats.feedbackCount
    })).sort((a, b) => b.feedbackCount - a.feedbackCount);

    const criteriaStats: Record<string, {
      total: number;
      count: number;
      name: string;
      icon: string;
      color: string;
    }> = {};

    Object.values(criteriaSetStats).forEach(setStats => {
      Object.entries(setStats.criteria).forEach(([key, stats]) => {
        if (!criteriaStats[key]) {
          criteriaStats[key] = { total: 0, count: 0, name: stats.name, icon: stats.icon, color: stats.color };
        }
        criteriaStats[key].total += stats.total;
        criteriaStats[key].count += stats.count;
      });
    });

    const categoryAverages: Record<string, number> = {};
    Object.entries(criteriaStats).forEach(([key, stats]) => {
      if (stats.count > 0) {
        categoryAverages[key] = Number((stats.total / stats.count).toFixed(2));
      }
    });

    const criteriaDetails = Object.entries(criteriaStats).map(([key, stats]) => ({
      key,
      name: stats.name,
      icon: stats.icon,
      color: stats.color,
      averageScore: stats.count > 0 ? Number((stats.total / stats.count).toFixed(2)) : 0,
      evaluationCount: stats.count
    })).sort((a, b) => b.evaluationCount - a.evaluationCount);

    const scoreHistory = userFeedbacks
      .map(f => {
        const createdDate = new Date(f.createdAt);
        const year = createdDate.getFullYear();
        const month = String(createdDate.getMonth() + 1).padStart(2, '0');
        const day = String(createdDate.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;
        return {
          date: dateStr,
          time: createdDate.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
          score: f.overallScore,
          conversationId: f.personaRunId || f.conversationId
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    const allStrengths = userFeedbacks.flatMap(f => {
      const strengths = (f.detailedFeedback as any)?.strengths || [];
      return Array.isArray(strengths) ? strengths : [];
    });
    const allImprovements = userFeedbacks.flatMap(f => {
      const improvements = (f.detailedFeedback as any)?.improvements || [];
      return Array.isArray(improvements) ? improvements : [];
    });

    const categorizeItem = (text: string, type: 'strength' | 'improvement'): string => {
      const lower = text.toLowerCase();

      if (type === 'strength') {
        if (lower.includes('명확') || lower.includes('핵심') || lower.includes('제시')) return '명확한 문제 제시';
        if (lower.includes('일관') || lower.includes('주장') || lower.includes('설득')) return '일관된 주장 유지';
        if (lower.includes('논리') || lower.includes('대응') || lower.includes('반박')) return '논리적 대응';
        if (lower.includes('대안') || lower.includes('해결')) return '적극적 태도와 대안 제시';
        if (lower.includes('태도') || lower.includes('적극')) return '적극적 태도와 대안 제시';
        if (lower.includes('인지') || lower.includes('전환')) return '상황 인식과 전환';
        if (lower.includes('공감') || lower.includes('상대') || lower.includes('이해')) return '상대방 고려';
        return '의사소통 능력';
      } else {
        if (lower.includes('비언어') || lower.includes('침묵') || lower.includes('망설')) return '명확한 표현과 자신감';
        if (lower.includes('공감') || lower.includes('이해') || lower.includes('감정')) return '공감 표현 강화';
        if (lower.includes('구체') || lower.includes('대안') || lower.includes('실행')) return '구체적 대안 제시';
        if (lower.includes('비난') || lower.includes('표현') || lower.includes('용어')) return '협력적 표현';
        if (lower.includes('현실') || lower.includes('실현') || lower.includes('가능')) return '현실성 검토';
        if (lower.includes('데이터') || lower.includes('근거') || lower.includes('논거')) return '데이터 기반 설득';
        return '의사소통 개선';
      }
    };

    const categorizedStrengths = allStrengths.map(s => categorizeItem(s, 'strength'));
    const categorizedImprovements = allImprovements.map(i => categorizeItem(i, 'improvement'));

    const getTopItemsWithDetails = (originalItems: string[], categorizedItems: string[], limit: number = 5) => {
      if (originalItems.length === 0) return [];

      const categoryMap: Record<string, string[]> = {};
      originalItems.forEach((original, index) => {
        const category = categorizedItems[index];
        if (!categoryMap[category]) {
          categoryMap[category] = [];
        }
        categoryMap[category].push(original);
      });

      const frequency = categorizedItems.reduce((acc, category) => {
        acc[category] = (acc[category] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      return Object.entries(frequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([category, count]) => ({
          category,
          count,
          items: categoryMap[category] || []
        }));
    };

    const topStrengths = getTopItemsWithDetails(allStrengths, categorizedStrengths, 5);
    const topImprovements = getTopItemsWithDetails(allImprovements, categorizedImprovements, 5);

    let progressTrend: 'improving' | 'stable' | 'declining' | 'neutral' = 'neutral';
    if (scoreHistory.length >= 2) {
      if (scoreHistory.length >= 6) {
        const recentScores = scoreHistory.slice(-5).map(s => s.score);
        const olderScores = scoreHistory.slice(0, -5).map(s => s.score);
        const recentAvg = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
        const olderAvg = olderScores.reduce((a, b) => a + b, 0) / olderScores.length;

        if (recentAvg > olderAvg + 2) progressTrend = 'improving';
        else if (recentAvg < olderAvg - 2) progressTrend = 'declining';
        else progressTrend = 'stable';
      } else {
        const midpoint = Math.ceil(scoreHistory.length / 2);
        const recentScores = scoreHistory.slice(midpoint).map(s => s.score);
        const olderScores = scoreHistory.slice(0, midpoint).map(s => s.score);
        const recentAvg = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
        const olderAvg = olderScores.reduce((a, b) => a + b, 0) / olderScores.length;

        if (recentAvg > olderAvg + 1) progressTrend = 'improving';
        else if (recentAvg < olderAvg - 1) progressTrend = 'declining';
        else progressTrend = 'stable';
      }
    }

    const getOverallGrade = (score: number) => {
      if (score >= 90) return 'A+';
      if (score >= 80) return 'A';
      if (score >= 70) return 'B';
      if (score >= 60) return 'C';
      return 'D';
    };

    const lastCompletedScenario = completedScenarioRuns.length > 0
      ? completedScenarioRuns.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0]
      : null;

    const criteriaDetailsBySet: Record<string, typeof criteriaDetails> = {};
    Object.entries(criteriaSetStats).forEach(([setId, setStats]) => {
      criteriaDetailsBySet[setId] = Object.entries(setStats.criteria).map(([key, stats]) => ({
        key,
        name: stats.name,
        icon: stats.icon,
        color: stats.color,
        averageScore: stats.count > 0 ? Number((stats.total / stats.count).toFixed(2)) : 0,
        evaluationCount: stats.count
      })).sort((a, b) => b.evaluationCount - a.evaluationCount);
    });

    res.json({
      totalSessions: userScenarioRuns.length,
      completedSessions: completedScenarioRuns.length,
      totalFeedbacks: userFeedbacks.length,
      averageScore,
      categoryAverages,
      criteriaDetails,
      criteriaDetailsBySet,
      usedCriteriaSets,
      scoreHistory,
      topStrengths,
      topImprovements,
      overallGrade: getOverallGrade(averageScore),
      progressTrend,
      lastSessionDate: lastCompletedScenario?.startedAt.toISOString(),
    });
  }));

  router.get("/api/admin/analytics/overview", isAuthenticated, asyncHandler(async (req: any, res) => {
    const user = req.user;
    const categoryIdParam = req.query.categoryId as string | undefined;

    const allScenarioRuns = await storage.getAllScenarioRuns();
    const allPersonaRuns = await storage.getAllPersonaRuns();
    const allFeedbacks = await storage.getAllFeedbacks();
    const allScenarios = await fileManager.getAllScenarios();

    let accessibleCategoryIds: string[] = [];
    let restrictToEmpty = false;

    if (user.role === 'admin') {
      if (categoryIdParam) {
        accessibleCategoryIds = [categoryIdParam];
      } else {
        accessibleCategoryIds = [];
      }
    } else if (user.role === 'operator') {
      accessibleCategoryIds = await getOperatorAccessibleCategoryIds(user);
      if (accessibleCategoryIds.length === 0) {
        restrictToEmpty = true;
      }
    } else if (user.assignedCategoryId) {
      accessibleCategoryIds = [user.assignedCategoryId];
    }

    const scenarios = restrictToEmpty
      ? []
      : accessibleCategoryIds.length > 0
        ? allScenarios.filter((s: any) => accessibleCategoryIds.includes(String(s.categoryId)))
        : allScenarios;
    const scenarioIds = new Set(scenarios.map((s: any) => s.id));

    const scenarioRuns = restrictToEmpty
      ? []
      : accessibleCategoryIds.length > 0
        ? allScenarioRuns.filter(sr => scenarioIds.has(sr.scenarioId))
        : allScenarioRuns;
    const scenarioRunIds = new Set(scenarioRuns.map(sr => sr.id));

    const personaRuns = restrictToEmpty
      ? []
      : accessibleCategoryIds.length > 0
        ? allPersonaRuns.filter(pr => scenarioRunIds.has(pr.scenarioRunId))
        : allPersonaRuns;
    const personaRunIds = new Set(personaRuns.map(pr => pr.id));

    const feedbacks = restrictToEmpty
      ? []
      : accessibleCategoryIds.length > 0
        ? allFeedbacks.filter(f => f.personaRunId && personaRunIds.has(f.personaRunId))
        : allFeedbacks;

    const completedPersonaRuns = personaRuns.filter(pr => {
      const scenarioRun = scenarioRuns.find(sr => sr.id === pr.scenarioRunId);
      return scenarioRun?.status === "completed";
    });

    const totalSessions = personaRuns.length;
    const completedSessions = completedPersonaRuns.length;

    const completedFeedbacks = feedbacks.filter(f =>
      completedPersonaRuns.some(pr => pr.id === f.personaRunId)
    );

    const averageScore = completedFeedbacks.length > 0
      ? Math.round(completedFeedbacks.reduce((acc, f) => acc + f.overallScore, 0) / completedFeedbacks.length)
      : 0;

    const personaRunUserIds = new Set(personaRuns.map(pr => {
      const scenarioRun = scenarioRuns.find(sr => sr.id === pr.scenarioRunId);
      return scenarioRun?.userId;
    }).filter(Boolean));
    const activeUsers = personaRunUserIds.size;

    const totalUsers = activeUsers;

    const participationRate = activeUsers > 0 ? 100 : 0;

    const scenarioStatsRaw = personaRuns.reduce((acc, pr) => {
      const scenarioRun = scenarioRuns.find(sr => sr.id === pr.scenarioRunId);
      if (!scenarioRun) return acc;

      const scenario = scenarios.find(s => s.id === scenarioRun.scenarioId);
      const scenarioName = scenario?.title || scenarioRun.scenarioId;
      const userDifficulty = scenarioRun.difficulty || 2;

      if (!acc[scenarioRun.scenarioId]) {
        acc[scenarioRun.scenarioId] = {
          count: 0,
          name: scenarioName,
          difficulties: [] as number[]
        };
      }
      acc[scenarioRun.scenarioId].count += 1;
      acc[scenarioRun.scenarioId].difficulties.push(userDifficulty);

      return acc;
    }, {} as Record<string, { count: number; name: string; difficulties: number[] }>);

    const scenarioStats = Object.entries(scenarioStatsRaw).reduce((acc, [id, data]) => {
      const avgDifficulty = data.difficulties.length > 0
        ? Math.round(data.difficulties.reduce((sum, d) => sum + d, 0) / data.difficulties.length)
        : 2;
      acc[id] = {
        count: data.count,
        name: data.name,
        difficulty: avgDifficulty
      };
      return acc;
    }, {} as Record<string, { count: number; name: string; difficulty: number }>);

    const mbtiUsage = personaRuns.reduce((acc, pr) => {
      const mbti = pr.personaId;
      acc[mbti] = (acc[mbti] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    res.json({
      totalUsers,
      activeUsers,
      totalSessions,
      completedSessions,
      participationRate,
      averageScore,
      scenarioStats,
      mbtiUsage
    });
  }));

  router.get("/api/admin/analytics/trends", isAuthenticated, asyncHandler(async (req: any, res) => {
    const user = req.user;
    const categoryIdParam = req.query.categoryId as string | undefined;

    const allScenarioRuns = await storage.getAllScenarioRuns();
    const allPersonaRuns = await storage.getAllPersonaRuns();
    const allFeedbacks = await storage.getAllFeedbacks();
    const allScenarios = await fileManager.getAllScenarios();

    let accessibleCategoryIds: string[] = [];
    let restrictToEmpty = false;

    if (user.role === 'admin') {
      if (categoryIdParam) {
        accessibleCategoryIds = [categoryIdParam];
      } else {
        accessibleCategoryIds = [];
      }
    } else if (user.role === 'operator') {
      accessibleCategoryIds = await getOperatorAccessibleCategoryIds(user);
      if (accessibleCategoryIds.length === 0) {
        restrictToEmpty = true;
      }
    } else if (user.assignedCategoryId) {
      accessibleCategoryIds = [user.assignedCategoryId];
    }

    const scenarios = restrictToEmpty
      ? []
      : accessibleCategoryIds.length > 0
        ? allScenarios.filter((s: any) => accessibleCategoryIds.includes(String(s.categoryId)))
        : allScenarios;
    const scenarioIds = new Set(scenarios.map((s: any) => s.id));

    const scenarioRuns = restrictToEmpty
      ? []
      : accessibleCategoryIds.length > 0
        ? allScenarioRuns.filter(sr => scenarioIds.has(sr.scenarioId))
        : allScenarioRuns;
    const scenarioRunIds = new Set(scenarioRuns.map(sr => sr.id));

    const personaRuns = restrictToEmpty
      ? []
      : accessibleCategoryIds.length > 0
        ? allPersonaRuns.filter(pr => scenarioRunIds.has(pr.scenarioRunId))
        : allPersonaRuns;
    const personaRunIds = new Set(personaRuns.map(pr => pr.id));

    const feedbacks = restrictToEmpty
      ? []
      : accessibleCategoryIds.length > 0
        ? allFeedbacks.filter(f => f.personaRunId && personaRunIds.has(f.personaRunId))
        : allFeedbacks;

    const last30Days = Array.from({ length: 30 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (29 - i));
      return date.toISOString().split('T')[0];
    });

    const dailyUsage = last30Days.map(date => {
      const sessionsCount = scenarioRuns.filter(sr =>
        sr.startedAt && sr.startedAt.toISOString().split('T')[0] === date
      ).length;

      const completedCount = scenarioRuns.filter(sr =>
        sr.status === "completed" && sr.startedAt && sr.startedAt.toISOString().split('T')[0] === date
      ).length;

      return {
        date,
        sessions: sessionsCount,
        completed: completedCount
      };
    });

    const performanceTrends = feedbacks
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(-20)
      .map((feedback, index) => ({
        session: index + 1,
        score: feedback.overallScore,
        date: feedback.createdAt
      }));

    res.json({
      dailyUsage,
      performanceTrends
    });
  }));

  router.get("/api/admin/analytics/emotions", isAuthenticated, asyncHandler(async (req: any, res) => {
    const user = req.user;

    if (user.role !== 'admin' && user.role !== 'operator') {
      throw createHttpError(403, "관리자 또는 운영자만 접근할 수 있습니다");
    }

    const categoryIdParam = req.query.categoryId as string | undefined;

    const allScenarios = await fileManager.getAllScenarios();
    let scenarioIds: string[] | undefined = undefined;

    if (user.role === 'admin') {
      if (categoryIdParam) {
        scenarioIds = allScenarios
          .filter((s: any) => String(s.categoryId) === String(categoryIdParam))
          .map((s: any) => s.id as string);
      }
    } else if (user.role === 'operator') {
      const accessible = await getOperatorAccessibleCategoryIds(user);
      if (accessible.length > 0) {
        scenarioIds = allScenarios
          .filter((s: any) => accessible.includes(String(s.categoryId)))
          .map((s: any) => s.id as string);
      } else {
        scenarioIds = [];
      }
    }

    if (scenarioIds && scenarioIds.length === 0) {
      return res.json({
        emotions: [],
        totalEmotions: 0,
        uniqueEmotions: 0
      });
    }

    const emotionStats = await storage.getAllEmotionStats(scenarioIds);

    const emotionEmojis: Record<string, string> = {
      '기쁨': '😊', '슬픔': '😢', '분노': '😠', '놀람': '😲', '중립': '😐',
      '호기심': '🤔', '불안': '😰', '피로': '😫', '실망': '😞', '당혹': '😕', '단호': '😤'
    };

    const totalEmotions = emotionStats.reduce((sum, e) => sum + e.count, 0);

    const emotionsWithDetails = emotionStats.map(e => ({
      emotion: e.emotion,
      emoji: emotionEmojis[e.emotion] || '❓',
      count: e.count,
      percentage: totalEmotions > 0 ? Math.round((e.count / totalEmotions) * 100) : 0
    }));

    res.json({
      emotions: emotionsWithDetails,
      totalEmotions,
      uniqueEmotions: emotionStats.length
    });
  }));

  router.get("/api/admin/analytics/emotions/by-scenario", isAuthenticated, asyncHandler(async (req: any, res) => {
    const user = req.user;

    if (user.role !== 'admin' && user.role !== 'operator') {
      throw createHttpError(403, "관리자 또는 운영자만 접근할 수 있습니다");
    }

    const categoryIdParam = req.query.categoryId as string | undefined;

    const allScenarios = await fileManager.getAllScenarios();
    let scenarioIds: string[] | undefined = undefined;

    if (user.role === 'admin') {
      if (categoryIdParam) {
        scenarioIds = allScenarios
          .filter((s: any) => String(s.categoryId) === String(categoryIdParam))
          .map((s: any) => s.id as string);
      }
    } else if (user.role === 'operator') {
      const accessible = await getOperatorAccessibleCategoryIds(user);
      if (accessible.length > 0) {
        scenarioIds = allScenarios
          .filter((s: any) => accessible.includes(String(s.categoryId)))
          .map((s: any) => s.id as string);
      } else {
        scenarioIds = [];
      }
    }

    if (scenarioIds && scenarioIds.length === 0) {
      return res.json({ scenarios: [] });
    }

    const scenarioStats = await storage.getEmotionStatsByScenario(scenarioIds);

    const emotionEmojis: Record<string, string> = {
      '기쁨': '😊', '슬픔': '😢', '분노': '😠', '놀람': '😲', '중립': '😐',
      '호기심': '🤔', '불안': '😰', '피로': '😫', '실망': '😞', '당혹': '😕', '단호': '😤'
    };

    const scenariosWithDetails = scenarioStats.map(scenario => ({
      ...scenario,
      emotions: scenario.emotions.map(e => ({
        ...e,
        emoji: emotionEmojis[e.emotion] || '❓',
        percentage: scenario.totalCount > 0 ? Math.round((e.count / scenario.totalCount) * 100) : 0
      })),
      topEmotion: scenario.emotions[0] ? {
        emotion: scenario.emotions[0].emotion,
        emoji: emotionEmojis[scenario.emotions[0].emotion] || '❓',
        count: scenario.emotions[0].count
      } : null
    }));

    res.json({ scenarios: scenariosWithDetails });
  }));

  router.get("/api/admin/analytics/emotions/by-mbti", isAuthenticated, asyncHandler(async (req: any, res) => {
    const user = req.user;

    if (user.role !== 'admin' && user.role !== 'operator') {
      throw createHttpError(403, "관리자 또는 운영자만 접근할 수 있습니다");
    }

    const categoryIdParam = req.query.categoryId as string | undefined;

    const allScenarios = await fileManager.getAllScenarios();
    let scenarioIds: string[] | undefined = undefined;

    if (user.role === 'admin') {
      if (categoryIdParam) {
        scenarioIds = allScenarios
          .filter((s: any) => String(s.categoryId) === String(categoryIdParam))
          .map((s: any) => s.id as string);
      }
    } else if (user.role === 'operator') {
      const accessible = await getOperatorAccessibleCategoryIds(user);
      if (accessible.length > 0) {
        scenarioIds = allScenarios
          .filter((s: any) => accessible.includes(String(s.categoryId)))
          .map((s: any) => s.id as string);
      } else {
        scenarioIds = [];
      }
    }

    if (scenarioIds && scenarioIds.length === 0) {
      return res.json({ mbtiStats: [] });
    }

    const mbtiStats = await storage.getEmotionStatsByMbti(scenarioIds);

    const emotionEmojis: Record<string, string> = {
      '기쁨': '😊', '슬픔': '😢', '분노': '😠', '놀람': '😲', '중립': '😐',
      '호기심': '🤔', '불안': '😰', '피로': '😫', '실망': '😞', '당혹': '😕', '단호': '😤'
    };

    const mbtiWithDetails = mbtiStats.map(mbti => ({
      ...mbti,
      emotions: mbti.emotions.map(e => ({
        ...e,
        emoji: emotionEmojis[e.emotion] || '❓',
        percentage: mbti.totalCount > 0 ? Math.round((e.count / mbti.totalCount) * 100) : 0
      })),
      topEmotion: mbti.emotions[0] ? {
        emotion: mbti.emotions[0].emotion,
        emoji: emotionEmojis[mbti.emotions[0].emotion] || '❓',
        count: mbti.emotions[0].count
      } : null
    }));

    res.json({ mbtiStats: mbtiWithDetails });
  }));

  router.get("/api/admin/analytics/emotions/by-difficulty", isAuthenticated, asyncHandler(async (req: any, res) => {
    const user = req.user;

    if (user.role !== 'admin' && user.role !== 'operator') {
      throw createHttpError(403, "관리자 또는 운영자만 접근할 수 있습니다");
    }

    const categoryIdParam = req.query.categoryId as string | undefined;

    const allScenarios = await fileManager.getAllScenarios();
    let scenarioIds: string[] | undefined = undefined;

    if (user.role === 'admin') {
      if (categoryIdParam) {
        scenarioIds = allScenarios
          .filter((s: any) => String(s.categoryId) === String(categoryIdParam))
          .map((s: any) => s.id as string);
      }
    } else if (user.role === 'operator') {
      const accessible = await getOperatorAccessibleCategoryIds(user);
      if (accessible.length > 0) {
        scenarioIds = allScenarios
          .filter((s: any) => accessible.includes(String(s.categoryId)))
          .map((s: any) => s.id as string);
      } else {
        scenarioIds = [];
      }
    }

    if (scenarioIds && scenarioIds.length === 0) {
      return res.json({ difficultyStats: [] });
    }

    const difficultyStats = await storage.getEmotionStatsByDifficulty(scenarioIds);

    const emotionEmojis: Record<string, string> = {
      '기쁨': '😊', '슬픔': '😢', '분노': '😠', '놀람': '😲', '중립': '😐',
      '호기심': '🤔', '불안': '😰', '피로': '😫', '실망': '😞', '당혹': '😕', '단호': '😤'
    };

    const difficultyNames: Record<number, string> = {
      1: '입문', 2: '기본', 3: '심화', 4: '전문가'
    };

    const difficultyWithDetails = difficultyStats.map(diff => ({
      ...diff,
      difficultyName: difficultyNames[diff.difficulty] || `레벨 ${diff.difficulty}`,
      emotions: diff.emotions.map(e => ({
        ...e,
        emoji: emotionEmojis[e.emotion] || '❓',
        percentage: diff.totalCount > 0 ? Math.round((e.count / diff.totalCount) * 100) : 0
      })),
      topEmotion: diff.emotions[0] ? {
        emotion: diff.emotions[0].emotion,
        emoji: emotionEmojis[diff.emotions[0].emotion] || '❓',
        count: diff.emotions[0].count
      } : null
    }));

    res.json({ difficultyStats: difficultyWithDetails });
  }));

  router.get("/api/admin/analytics/emotions/timeline/:personaRunId", isAuthenticated, asyncHandler(async (req, res) => {
    const { personaRunId } = req.params;

    if (!personaRunId) {
      throw createHttpError(400, "personaRunId is required");
    }

    const timeline = await storage.getEmotionTimelineByPersonaRun(personaRunId);

    const emotionEmojis: Record<string, string> = {
      '기쁨': '😊', '슬픔': '😢', '분노': '😠', '놀람': '😲', '중립': '😐',
      '호기심': '🤔', '불안': '😰', '피로': '😫', '실망': '😞', '당혹': '😕', '단호': '😤'
    };

    const timelineWithEmojis = timeline.map(item => ({
      ...item,
      emoji: item.emotion ? (emotionEmojis[item.emotion] || '❓') : null
    }));

    res.json({ timeline: timelineWithEmojis });
  }));

  router.get("/api/admin/analytics/participants", isAuthenticated, asyncHandler(async (req: any, res) => {
    const user = req.user;
    const categoryIdParam = req.query.categoryId as string | undefined;
    const search = (req.query.search as string || '').toLowerCase().trim();

    const allScenarioRuns = await storage.getAllScenarioRuns();
    const allPersonaRuns = await storage.getAllPersonaRuns();
    const allFeedbacks = await storage.getAllFeedbacks();
    const allScenarios = await fileManager.getAllScenarios();
    const allUsers = await storage.getAllUsers();
    const allCategories = await storage.getAllCategories();

    let accessibleCategoryIds: string[] = [];
    let restrictToEmpty = false;

    if (user.role === 'admin') {
      if (categoryIdParam) {
        accessibleCategoryIds = [categoryIdParam];
      } else {
        accessibleCategoryIds = [];
      }
    } else if (user.role === 'operator') {
      accessibleCategoryIds = await getOperatorAccessibleCategoryIds(user);
      if (accessibleCategoryIds.length === 0) {
        restrictToEmpty = true;
      }
    }

    if (restrictToEmpty) {
      return res.json({ participants: [] });
    }

    const scenarios = accessibleCategoryIds.length > 0
      ? allScenarios.filter((s: any) => accessibleCategoryIds.includes(String(s.categoryId)))
      : allScenarios;
    const scenarioIds = new Set(scenarios.map((s: any) => s.id));

    const scenarioRuns = accessibleCategoryIds.length > 0
      ? allScenarioRuns.filter(sr => scenarioIds.has(sr.scenarioId))
      : allScenarioRuns;

    const scenarioRunIds = new Set(scenarioRuns.map(sr => sr.id));
    const personaRuns = accessibleCategoryIds.length > 0
      ? allPersonaRuns.filter(pr => scenarioRunIds.has(pr.scenarioRunId))
      : allPersonaRuns;
    const personaRunIds = new Set(personaRuns.map(pr => pr.id));

    const feedbacks = allFeedbacks.filter(f => f.personaRunId && personaRunIds.has(f.personaRunId));

    const scenarioRunsByUser = new Map<string, any[]>();
    for (const sr of scenarioRuns) {
      if (!scenarioRunsByUser.has(sr.userId)) {
        scenarioRunsByUser.set(sr.userId, []);
      }
      scenarioRunsByUser.get(sr.userId)!.push(sr);
    }

    const scenarioRunMap = new Map(scenarioRuns.map(sr => [sr.id, sr]));

    const personaRunToUserId = new Map<string, string>();
    for (const pr of personaRuns) {
      const sr = scenarioRunMap.get(pr.scenarioRunId);
      if (sr) personaRunToUserId.set(pr.id, sr.userId);
    }

    const feedbacksByUser = new Map<string, any[]>();
    for (const f of feedbacks) {
      if (!f.personaRunId) continue;
      const uid = personaRunToUserId.get(f.personaRunId);
      if (!uid) continue;
      if (!feedbacksByUser.has(uid)) feedbacksByUser.set(uid, []);
      feedbacksByUser.get(uid)!.push(f);
    }

    const lastTrainingByUser = new Map<string, Date>();
    for (const sr of scenarioRuns) {
      if (!sr.completedAt) continue;
      const existing = lastTrainingByUser.get(sr.userId);
      if (!existing || sr.completedAt > existing) {
        lastTrainingByUser.set(sr.userId, sr.completedAt);
      }
    }

    const scenarioToCategoryName = new Map<string, string>();
    for (const s of scenarios) {
      const cat = allCategories.find(c => c.id === String((s as any).categoryId));
      if (cat) scenarioToCategoryName.set(s.id, cat.name);
    }

    const userCategoriesMap = new Map<string, Set<string>>();
    for (const sr of scenarioRuns) {
      const catName = scenarioToCategoryName.get(sr.scenarioId);
      if (!catName) continue;
      if (!userCategoriesMap.has(sr.userId)) userCategoriesMap.set(sr.userId, new Set<string>());
      userCategoriesMap.get(sr.userId)!.add(catName);
    }

    const participantUserIds = new Set(personaRuns.map(pr => {
      const sr = scenarioRunMap.get(pr.scenarioRunId);
      return sr?.userId;
    }).filter(Boolean) as string[]);

    const participants = [];
    for (const uid of Array.from(participantUserIds)) {
      const u = allUsers.find(u => u.id === uid);
      if (!u) continue;

      if (search) {
        const nameMatch = u.name.toLowerCase().includes(search);
        const emailMatch = u.email.toLowerCase().includes(search);
        if (!nameMatch && !emailMatch) continue;
      }

      const userScenarioRuns = scenarioRunsByUser.get(uid) || [];
      const completedRuns = userScenarioRuns.filter(sr => sr.status === 'completed');
      const userFeedbacks = feedbacksByUser.get(uid) || [];
      const avgScore = userFeedbacks.length > 0
        ? Math.round(userFeedbacks.reduce((acc, f) => acc + f.overallScore, 0) / userFeedbacks.length)
        : null;
      const latestFeedback = userFeedbacks.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )[0];
      const lastTraining = lastTrainingByUser.get(uid);
      const categories = Array.from(userCategoriesMap.get(uid) || []);

      participants.push({
        userId: uid,
        name: u.name,
        email: u.email,
        role: u.role,
        tier: u.tier,
        totalSessions: userScenarioRuns.length,
        completedSessions: completedRuns.length,
        averageScore: avgScore,
        latestScore: latestFeedback?.overallScore ?? null,
        lastTrainingAt: lastTraining?.toISOString() ?? null,
        categories,
      });
    }

    participants.sort((a, b) => {
      if (!a.lastTrainingAt && !b.lastTrainingAt) return 0;
      if (!a.lastTrainingAt) return 1;
      if (!b.lastTrainingAt) return -1;
      return new Date(b.lastTrainingAt).getTime() - new Date(a.lastTrainingAt).getTime();
    });

    res.json({ participants });
  }));

  router.get("/api/admin/users/:userId/scenario-runs", isAuthenticated, asyncHandler(async (req: any, res) => {
    const requestUser = req.user;
    const { userId } = req.params;

    if (requestUser.role !== 'admin' && requestUser.role !== 'operator') {
      throw createHttpError(403, "Access denied");
    }

    const userScenarioRuns = await storage.getUserScenarioRuns(userId);
    const allScenarios = await fileManager.getAllScenarios();
    const allCategories = await storage.getAllCategories();

    let filteredRuns = userScenarioRuns;
    if (requestUser.role === 'operator') {
      const accessibleCategoryIds = await getOperatorAccessibleCategoryIds(requestUser);
      filteredRuns = userScenarioRuns.filter(sr => {
        const scenario = allScenarios.find(s => s.id === sr.scenarioId);
        return scenario && accessibleCategoryIds.includes(String(scenario.categoryId));
      });
    }

    const runsWithDetails = await Promise.all(filteredRuns.map(async (run: any) => {
      const scenario = allScenarios.find(s => s.id === run.scenarioId);
      const category = scenario ? allCategories.find(c => c.id === String(scenario.categoryId)) : null;

      const personaRuns = await storage.getPersonaRunsByScenarioRun(run.id);
      const personaRunsWithFeedback = await Promise.all(personaRuns.map(async (pr) => {
        const feedback = await storage.getFeedbackByConversationId(pr.id);
        return {
          ...pr,
          feedback: feedback ? {
            overallScore: feedback.overallScore,
            scores: feedback.scores,
          } : null
        };
      }));

      return {
        ...run,
        scenarioTitle: scenario?.title || run.scenarioId,
        categoryName: category?.name || "Unknown",
        personaRuns: personaRunsWithFeedback
      };
    }));

    res.json(runsWithDetails.sort((a: any, b: any) =>
      new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    ));
  }));

  router.get("/api/admin/analytics/performance", isAuthenticated, asyncHandler(async (req: any, res) => {
    const user = req.user;
    const categoryIdParam = req.query.categoryId as string | undefined;

    const allFeedbacks = await storage.getAllFeedbacks();
    const allPersonaRuns = await storage.getAllPersonaRuns();
    const allScenarioRuns = await storage.getAllScenarioRuns();
    const allScenarios = await fileManager.getAllScenarios();
    const allCategories = await storage.getAllCategories();

    let accessibleCategoryIds: string[] = [];
    if (user.role === 'admin') {
      if (categoryIdParam) {
        accessibleCategoryIds = [categoryIdParam];
      }
    } else if (user.role === 'operator') {
      accessibleCategoryIds = await getOperatorAccessibleCategoryIds(user);
    }

    const filteredScenarios = accessibleCategoryIds.length > 0
      ? allScenarios.filter((s: any) => accessibleCategoryIds.includes(String(s.categoryId)))
      : allScenarios;
    const scenarioIds = new Set(filteredScenarios.map((s: any) => s.id));

    const filteredScenarioRuns = accessibleCategoryIds.length > 0
      ? allScenarioRuns.filter(sr => scenarioIds.has(sr.scenarioId))
      : allScenarioRuns;
    const scenarioRunIds = new Set(filteredScenarioRuns.map(sr => sr.id));

    const filteredPersonaRuns = allPersonaRuns.filter(pr => scenarioRunIds.has(pr.scenarioRunId));
    const personaRunIds = new Set(filteredPersonaRuns.map(pr => pr.id));

    const feedbacks = allFeedbacks.filter(f => f.personaRunId && personaRunIds.has(f.personaRunId));

    const scenarioRunMap = new Map(filteredScenarioRuns.map(sr => [sr.id, sr]));
    const personaRunMap = new Map(filteredPersonaRuns.map(pr => [pr.id, pr]));

    const scoreRanges = { excellent: 0, good: 0, average: 0, needsImprovement: 0, poor: 0 };
    const categoryPerformance: Record<string, { total: number; count: number; name: string; average: number }> = {};
    const scenarioPerformance: Record<string, { scores: number[]; name: string; average: number; sessionCount: number; difficulty: number; personaCount: number }> = {};
    const mbtiPerformance: Record<string, { scores: number[]; count: number; average: number }> = {};
    const strengthCounts: Record<string, number> = {};
    const improvementCounts: Record<string, number> = {};
    let totalScore = 0;
    let highestScore = 0;
    const recentSessions: any[] = [];

    for (const fb of feedbacks) {
      const score = fb.overallScore || 0;
      totalScore += score;
      if (score > highestScore) highestScore = score;

      if (score >= 90) scoreRanges.excellent++;
      else if (score >= 80) scoreRanges.good++;
      else if (score >= 70) scoreRanges.average++;
      else if (score >= 60) scoreRanges.needsImprovement++;
      else scoreRanges.poor++;

      const personaRun = personaRunMap.get(fb.personaRunId || '');
      const scenarioRun = personaRun ? scenarioRunMap.get(personaRun.scenarioRunId) : null;
      if (!scenarioRun) continue;

      const scenario = allScenarios.find((s: any) => s.id === scenarioRun.scenarioId);
      if (!scenario) continue;

      const catId = String((scenario as any).categoryId || '');
      const category = allCategories.find((c: any) => String(c.id) === catId);
      if (catId) {
        if (!categoryPerformance[catId]) {
          categoryPerformance[catId] = { total: 0, count: 0, name: category?.name || catId, average: 0 };
        }
        categoryPerformance[catId].total += score;
        categoryPerformance[catId].count++;
        categoryPerformance[catId].average = Math.round(categoryPerformance[catId].total / categoryPerformance[catId].count);
      }

      const scenId = (scenario as any).id;
      if (!scenarioPerformance[scenId]) {
        scenarioPerformance[scenId] = {
          scores: [],
          name: (scenario as any).title || scenId,
          average: 0,
          sessionCount: 0,
          difficulty: (scenario as any).difficulty || 2,
          personaCount: ((scenario as any).personas || []).length
        };
      }
      scenarioPerformance[scenId].scores.push(score);
      scenarioPerformance[scenId].sessionCount++;
      scenarioPerformance[scenId].average = Math.round(
        scenarioPerformance[scenId].scores.reduce((a: number, b: number) => a + b, 0) / scenarioPerformance[scenId].scores.length
      );

      const mbti = (personaRun as any)?.mbti || (scenario as any)?.personas?.[0]?.mbti || 'UNKNOWN';
      if (!mbtiPerformance[mbti]) mbtiPerformance[mbti] = { scores: [], count: 0, average: 0 };
      mbtiPerformance[mbti].scores.push(score);
      mbtiPerformance[mbti].count++;
      mbtiPerformance[mbti].average = Math.round(
        mbtiPerformance[mbti].scores.reduce((a: number, b: number) => a + b, 0) / mbtiPerformance[mbti].count
      );

      const scores = (fb.scores as any[]) || [];
      for (const dim of scores) {
        if (dim.score >= 4 && dim.name) {
          strengthCounts[dim.name] = (strengthCounts[dim.name] || 0) + 1;
        }
        if (dim.score <= 2 && dim.name) {
          improvementCounts[dim.name] = (improvementCounts[dim.name] || 0) + 1;
        }
      }

      recentSessions.push({
        id: fb.id,
        score,
        scenarioName: (scenario as any).title || scenId,
        mbti,
        userId: scenarioRun.userId,
        completedAt: scenarioRun.completedAt || scenarioRun.startedAt,
        difficulty: (scenario as any).difficulty || 2,
      });
    }

    recentSessions.sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());

    const topStrengths = Object.entries(strengthCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([text, count]) => ({ text, count }));

    const topImprovements = Object.entries(improvementCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([text, count]) => ({ text, count }));

    const totalFeedbacks = feedbacks.length;
    const averageScore = totalFeedbacks > 0 ? Math.round(totalScore / totalFeedbacks) : 0;
    const completedPersonaRuns = filteredPersonaRuns.filter(pr => pr.status === 'completed').length;
    const feedbackCompletionRate = completedPersonaRuns > 0
      ? Math.round((totalFeedbacks / completedPersonaRuns) * 100)
      : 0;

    res.json({
      scoreRanges,
      categoryPerformance,
      scenarioPerformance,
      mbtiPerformance,
      topStrengths,
      topImprovements,
      highestScore,
      averageScore,
      feedbackCompletionRate,
      totalFeedbacks,
      recentSessions: recentSessions.slice(0, 20),
    });
  }));

  return router;
}
