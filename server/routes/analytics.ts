import { Router } from "express";
import { storage } from "../storage";
import { fileManager } from "../services/fileManager";
import { getOperatorAccessibleCategoryIds } from "./routerHelpers";

export default function createAnalyticsRouter(isAuthenticated: any) {
  const router = Router();

  // 피드백 히스토리 - 동일 시나리오+페르소나 과거 피드백 목록 (벤치마킹용)
  router.get("/api/users/me/feedback-history", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore
      const userId = req.user?.id;
      const { scenarioId, personaId } = req.query;

      if (!scenarioId || !personaId) {
        return res.status(400).json({ error: "scenarioId and personaId are required" });
      }

      // 사용자의 모든 scenarioRuns에서 동일 시나리오 필터
      const userScenarioRuns = await storage.getUserScenarioRuns(userId);
      const matchingScenarioRuns = userScenarioRuns.filter(sr => sr.scenarioId === scenarioId);

      if (matchingScenarioRuns.length === 0) {
        return res.json([]);
      }

      const scenarioRunIds = matchingScenarioRuns.map(sr => sr.id);

      // 해당 scenarioRun들의 모든 personaRun 조회
      const allPersonaRuns: any[] = [];
      for (const srId of scenarioRunIds) {
        const pRuns = await storage.getPersonaRunsByScenarioRun(srId);
        allPersonaRuns.push(...pRuns);
      }

      // 동일 personaId 필터 (최근 5건)
      const matchingPersonaRuns = allPersonaRuns
        .filter(pr => pr.personaId === personaId && pr.status === 'completed')
        .sort((a, b) => new Date(b.completedAt || b.startedAt).getTime() - new Date(a.completedAt || a.startedAt).getTime())
        .slice(0, 5);

      if (matchingPersonaRuns.length === 0) {
        return res.json([]);
      }

      // 각 personaRun의 피드백 조회
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
    } catch (error) {
      console.error("Error fetching feedback history:", error);
      res.status(500).json({ error: "Failed to fetch feedback history" });
    }
  });

  // User Analytics - 사용자 전체 피드백 종합 분석
  router.get("/api/analytics/summary", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      
      // ✨ 완료된 시나리오 실행 조회 (세션 기준)
      const userScenarioRuns = await storage.getUserScenarioRuns(userId);
      const completedScenarioRuns = userScenarioRuns.filter(sr => sr.status === 'completed');
      
      // 사용자의 모든 피드백 가져오기
      const userFeedbacks = await storage.getUserFeedbacks(userId);
      
      if (userFeedbacks.length === 0) {
        return res.json({
          totalSessions: userScenarioRuns.length, // ✨ 진행한 시나리오 (모든 scenarioRuns)
          completedSessions: completedScenarioRuns.length, // ✨ 완료한 시나리오
          totalFeedbacks: 0, // ✨ 총 피드백
          averageScore: 0,
          categoryAverages: {},
          scoreHistory: [],
          topStrengths: [],
          topImprovements: [],
          overallGrade: 'N/A',
          progressTrend: 'neutral'
        });
      }
      
      // 1. 전체 평균 스코어 계산 (피드백 기반)
      const averageScore = Math.round(
        userFeedbacks.reduce((acc, f) => acc + f.overallScore, 0) / userFeedbacks.length
      );
      
      // 2. 평가 기준 세트별로 그룹화 및 집계
      // criteriaSetId별 피드백 수집
      const criteriaSetStats: Record<string, {
        setId: string;
        setName: string;
        feedbackCount: number;
        criteria: Record<string, { total: number; count: number; name: string; icon: string; color: string; }>;
      }> = {};
      
      // 피드백의 scores 배열에서 동적으로 평가 기준 집계 (세트별로)
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
      
      // 사용된 평가 기준 세트 목록 (필터 UI용)
      const usedCriteriaSets = Object.entries(criteriaSetStats).map(([setId, stats]) => ({
        id: setId,
        name: stats.setName,
        feedbackCount: stats.feedbackCount
      })).sort((a, b) => b.feedbackCount - a.feedbackCount);
      
      // 전체 기준별 통계도 유지 (호환성)
      const criteriaStats: Record<string, {
        total: number;
        count: number;
        name: string;
        icon: string;
        color: string;
      }> = {};
      
      // 모든 세트의 criteria를 합산
      Object.values(criteriaSetStats).forEach(setStats => {
        Object.entries(setStats.criteria).forEach(([key, stats]) => {
          if (!criteriaStats[key]) {
            criteriaStats[key] = { total: 0, count: 0, name: stats.name, icon: stats.icon, color: stats.color };
          }
          criteriaStats[key].total += stats.total;
          criteriaStats[key].count += stats.count;
        });
      });
      
      // categoryAverages 계산 (기존 호환성 유지 + 동적 기준)
      const categoryAverages: Record<string, number> = {};
      Object.entries(criteriaStats).forEach(([key, stats]) => {
        if (stats.count > 0) {
          categoryAverages[key] = Number((stats.total / stats.count).toFixed(2));
        }
      });
      
      // 상세 평가 기준 정보 (평가 횟수 포함)
      const criteriaDetails = Object.entries(criteriaStats).map(([key, stats]) => ({
        key,
        name: stats.name,
        icon: stats.icon,
        color: stats.color,
        averageScore: stats.count > 0 ? Number((stats.total / stats.count).toFixed(2)) : 0,
        evaluationCount: stats.count
      })).sort((a, b) => b.evaluationCount - a.evaluationCount);
      
      // 사용된 모든 평가 기준 목록 (필터 UI용)
      const usedCriteria = criteriaDetails.map(c => ({
        key: c.key,
        name: c.name,
        count: c.evaluationCount
      }));
      
      // 3. 시간순 스코어 이력 (성장 추이 분석용)
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
      
      // 4. 강점/약점 패턴 분석 (반복되는 항목 추출)
      const allStrengths = userFeedbacks.flatMap(f => {
        const strengths = (f.detailedFeedback as any)?.strengths || [];
        return Array.isArray(strengths) ? strengths : [];
      });
      const allImprovements = userFeedbacks.flatMap(f => {
        const improvements = (f.detailedFeedback as any)?.improvements || [];
        return Array.isArray(improvements) ? improvements : [];
      });
      
      // 키워드 매핑으로 유사한 항목 카테고리화
      const categorizeItem = (text: string, type: 'strength' | 'improvement'): string => {
        const lower = text.toLowerCase();
        
        if (type === 'strength') {
          // 강점 카테고리
          if (lower.includes('명확') || lower.includes('핵심') || lower.includes('제시')) return '명확한 문제 제시';
          if (lower.includes('일관') || lower.includes('주장') || lower.includes('설득')) return '일관된 주장 유지';
          if (lower.includes('논리') || lower.includes('대응') || lower.includes('반박')) return '논리적 대응';
          if (lower.includes('대안') || lower.includes('해결')) return '적극적 태도와 대안 제시';
          if (lower.includes('태도') || lower.includes('적극')) return '적극적 태도와 대안 제시';
          if (lower.includes('인지') || lower.includes('전환')) return '상황 인식과 전환';
          if (lower.includes('공감') || lower.includes('상대') || lower.includes('이해')) return '상대방 고려';
          return '의사소통 능력';
        } else {
          // 개선점 카테고리
          if (lower.includes('비언어') || lower.includes('침묵') || lower.includes('망설')) return '명확한 표현과 자신감';
          if (lower.includes('공감') || lower.includes('이해') || lower.includes('감정')) return '공감 표현 강화';
          if (lower.includes('구체') || lower.includes('대안') || lower.includes('실행')) return '구체적 대안 제시';
          if (lower.includes('비난') || lower.includes('표현') || lower.includes('용어')) return '협력적 표현';
          if (lower.includes('현실') || lower.includes('실현') || lower.includes('가능')) return '현실성 검토';
          if (lower.includes('데이터') || lower.includes('근거') || lower.includes('논거')) return '데이터 기반 설득';
          return '의사소통 개선';
        }
      };
      
      // 카테고리화된 강점/개선점
      const categorizedStrengths = allStrengths.map(s => categorizeItem(s, 'strength'));
      const categorizedImprovements = allImprovements.map(i => categorizeItem(i, 'improvement'));
      
      // 빈도수 계산 함수 (원본 항목 포함)
      const getTopItemsWithDetails = (originalItems: string[], categorizedItems: string[], limit: number = 5) => {
        if (originalItems.length === 0) return [];
        
        // 카테고리별 원본 항목 그룹화
        const categoryMap: Record<string, string[]> = {};
        originalItems.forEach((original, index) => {
          const category = categorizedItems[index];
          if (!categoryMap[category]) {
            categoryMap[category] = [];
          }
          categoryMap[category].push(original);
        });
        
        // 카테고리별 출현 빈도 계산
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
      
      // 5. 성장 추이 판단 (더 적응적인 알고리즘)
      let progressTrend: 'improving' | 'stable' | 'declining' | 'neutral' = 'neutral';
      if (scoreHistory.length >= 2) {
        // 충분한 데이터가 있으면 최근과 이전 비교
        if (scoreHistory.length >= 6) {
          const recentScores = scoreHistory.slice(-5).map(s => s.score);
          const olderScores = scoreHistory.slice(0, -5).map(s => s.score);
          const recentAvg = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
          const olderAvg = olderScores.reduce((a, b) => a + b, 0) / olderScores.length;
          
          if (recentAvg > olderAvg + 2) progressTrend = 'improving';
          else if (recentAvg < olderAvg - 2) progressTrend = 'declining';
          else progressTrend = 'stable';
        } else {
          // 데이터가 2-5개면 최근 vs 초기 비교
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
      
      // 6. 종합 등급 계산
      const getOverallGrade = (score: number) => {
        if (score >= 90) return 'A+';
        if (score >= 80) return 'A';
        if (score >= 70) return 'B';
        if (score >= 60) return 'C';
        return 'D';
      };
      
      // 마지막 완료 시나리오 날짜 계산
      const lastCompletedScenario = completedScenarioRuns.length > 0 
        ? completedScenarioRuns.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0]
        : null;
      
      // 평가 기준 세트별 criteriaDetails 생성
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
        totalSessions: userScenarioRuns.length, // ✨ 진행한 시나리오 (모든 scenarioRuns)
        completedSessions: completedScenarioRuns.length, // ✨ 완료한 시나리오
        totalFeedbacks: userFeedbacks.length, // ✨ 총 피드백
        averageScore,
        categoryAverages,
        criteriaDetails, // ✨ 동적 평가 기준 상세 (전체 합산)
        criteriaDetailsBySet, // ✨ 세트별 평가 기준 상세
        usedCriteriaSets, // ✨ 필터 UI용 사용된 평가 기준 세트 목록
        scoreHistory,
        topStrengths,
        topImprovements,
        overallGrade: getOverallGrade(averageScore),
        progressTrend,
        lastSessionDate: lastCompletedScenario?.startedAt.toISOString(),
      });
    } catch (error) {
      console.error("Analytics summary error:", error);
      res.status(500).json({ error: "Failed to generate analytics summary" });
    }
  });

  // Admin Dashboard Analytics Routes
  router.get("/api/admin/analytics/overview", isAuthenticated, async (req: any, res) => {
    try {
      const user = req.user;
      const categoryIdParam = req.query.categoryId as string | undefined;
      
      // ✨ 새 테이블 구조 사용
      const allScenarioRuns = await storage.getAllScenarioRuns();
      const allPersonaRuns = await storage.getAllPersonaRuns();
      const allFeedbacks = await storage.getAllFeedbacks();
      const allScenarios = await fileManager.getAllScenarios();
      
      // 카테고리 필터링 결정 (계층적 권한 지원)
      let accessibleCategoryIds: string[] = [];
      let restrictToEmpty = false;
      
      if (user.role === 'admin') {
        // 관리자: categoryId 파라미터가 있으면 해당 카테고리만, 없으면 전체
        if (categoryIdParam) {
          accessibleCategoryIds = [categoryIdParam];
        } else {
          accessibleCategoryIds = []; // 빈 배열 = 전체 접근
        }
      } else if (user.role === 'operator') {
        // 운영자: 계층적 권한에 따라 접근 가능한 카테고리 목록 결정
        accessibleCategoryIds = await getOperatorAccessibleCategoryIds(user);
        if (accessibleCategoryIds.length === 0) {
          restrictToEmpty = true;
        }
      } else if (user.assignedCategoryId) {
        // 일반유저: assignedCategoryId가 있으면 해당 카테고리만
        accessibleCategoryIds = [user.assignedCategoryId];
      }
      
      // 시나리오 필터링
      const scenarios = restrictToEmpty 
        ? []
        : accessibleCategoryIds.length > 0
          ? allScenarios.filter((s: any) => accessibleCategoryIds.includes(String(s.categoryId)))
          : allScenarios;
      const scenarioIds = new Set(scenarios.map((s: any) => s.id));
      
      // scenarioRuns 필터링 (해당 카테고리 시나리오만)
      const scenarioRuns = restrictToEmpty 
        ? []
        : accessibleCategoryIds.length > 0
          ? allScenarioRuns.filter(sr => scenarioIds.has(sr.scenarioId))
          : allScenarioRuns;
      const scenarioRunIds = new Set(scenarioRuns.map(sr => sr.id));
      
      // personaRuns 필터링
      const personaRuns = restrictToEmpty 
        ? []
        : accessibleCategoryIds.length > 0
          ? allPersonaRuns.filter(pr => scenarioRunIds.has(pr.scenarioRunId))
          : allPersonaRuns;
      const personaRunIds = new Set(personaRuns.map(pr => pr.id));
      
      // feedbacks 필터링
      const feedbacks = restrictToEmpty 
        ? []
        : accessibleCategoryIds.length > 0
          ? allFeedbacks.filter(f => f.personaRunId && personaRunIds.has(f.personaRunId))
          : allFeedbacks;
      
      // ✨ 롤플레이 참여 유저 기준으로 지표 계산
      // 롤플레이 참여 = personaRuns가 있는 유저 (시나리오 시작이 아닌 실제 대화)
      
      // 1. 완료된 시나리오 & 페르소나 런 필터링
      const completedPersonaRuns = personaRuns.filter(pr => {
        const scenarioRun = scenarioRuns.find(sr => sr.id === pr.scenarioRunId);
        return scenarioRun?.status === "completed";
      });
      
      // 2. 총 세션: 롤플레이(personaRuns)에 참여한 세션
      const totalSessions = personaRuns.length;
      const completedSessions = completedPersonaRuns.length;
      
      // 3. 완료된 대화의 피드백만으로 평균 점수 계산
      const completedFeedbacks = feedbacks.filter(f => 
        completedPersonaRuns.some(pr => pr.id === f.personaRunId)
      );
      
      const averageScore = completedFeedbacks.length > 0 
        ? Math.round(completedFeedbacks.reduce((acc, f) => acc + f.overallScore, 0) / completedFeedbacks.length)
        : 0;
      
      // 4. 활동 유저: 실제 대화(personaRuns)에 참여한 고유 userId
      const personaRunUserIds = new Set(personaRuns.map(pr => {
        const scenarioRun = scenarioRuns.find(sr => sr.id === pr.scenarioRunId);
        return scenarioRun?.userId;
      }).filter(Boolean));
      const activeUsers = personaRunUserIds.size;
      
      // 5. 전체 사용자 = 활동 사용자
      const totalUsers = activeUsers;
      
      // 6. 참여율
      const participationRate = activeUsers > 0 ? 100 : 0;
      
      // 7. 시나리오 인기도 - personaRuns 기준 (difficulty는 사용자 선택 난이도 사용)
      const scenarioStatsRaw = personaRuns.reduce((acc, pr) => {
        const scenarioRun = scenarioRuns.find(sr => sr.id === pr.scenarioRunId);
        if (!scenarioRun) return acc;
        
        const scenario = scenarios.find(s => s.id === scenarioRun.scenarioId);
        const scenarioName = scenario?.title || scenarioRun.scenarioId;
        const userDifficulty = scenarioRun.difficulty || 2; // 사용자가 선택한 난이도
        
        if (!acc[scenarioRun.scenarioId]) {
          acc[scenarioRun.scenarioId] = {
            count: 0,
            name: scenarioName,
            difficulties: [] as number[] // 사용자가 선택한 난이도들 수집
          };
        }
        acc[scenarioRun.scenarioId].count += 1;
        acc[scenarioRun.scenarioId].difficulties.push(userDifficulty);
        
        return acc;
      }, {} as Record<string, { count: number; name: string; difficulties: number[] }>);
      
      // difficulties 배열을 평균 difficulty로 변환
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
      
      // 8. MBTI 사용 분석
      const mbtiUsage = personaRuns.reduce((acc, pr) => {
        const mbti = pr.personaId; // personaId가 MBTI 코드임
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
    } catch (error) {
      console.error("Error getting admin analytics overview:", error);
      res.status(500).json({ error: "Failed to get analytics overview" });
    }
  });

  router.get("/api/admin/analytics/trends", isAuthenticated, async (req: any, res) => {
    try {
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
      
      // 시나리오 필터링
      const scenarios = restrictToEmpty 
        ? []
        : accessibleCategoryIds.length > 0
          ? allScenarios.filter((s: any) => accessibleCategoryIds.includes(String(s.categoryId)))
          : allScenarios;
      const scenarioIds = new Set(scenarios.map((s: any) => s.id));
      
      // scenarioRuns 필터링
      const scenarioRuns = restrictToEmpty 
        ? []
        : accessibleCategoryIds.length > 0
          ? allScenarioRuns.filter(sr => scenarioIds.has(sr.scenarioId))
          : allScenarioRuns;
      const scenarioRunIds = new Set(scenarioRuns.map(sr => sr.id));
      
      // personaRuns 필터링
      const personaRuns = restrictToEmpty 
        ? []
        : accessibleCategoryIds.length > 0
          ? allPersonaRuns.filter(pr => scenarioRunIds.has(pr.scenarioRunId))
          : allPersonaRuns;
      const personaRunIds = new Set(personaRuns.map(pr => pr.id));
      
      // feedbacks 필터링
      const feedbacks = restrictToEmpty 
        ? []
        : accessibleCategoryIds.length > 0
          ? allFeedbacks.filter(f => f.personaRunId && personaRunIds.has(f.personaRunId))
          : allFeedbacks;
      
      // Daily usage over last 30 days - scenarioRuns 기반
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
      
      // Performance trends - feedbacks 기반 (변경 없음)
      const performanceTrends = feedbacks
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .slice(-20) // Last 20 sessions
        .map((feedback, index) => ({
          session: index + 1,
          score: feedback.overallScore,
          date: feedback.createdAt
        }));
      
      res.json({
        dailyUsage,
        performanceTrends
      });
    } catch (error) {
      console.error("Error getting trends analytics:", error);
      res.status(500).json({ error: "Failed to get trends analytics" });
    }
  });

  // 감정 분석 통계 API - 카테고리 필터링 적용 (admin/operator 전용)
  router.get("/api/admin/analytics/emotions", isAuthenticated, async (req: any, res) => {
    try {
      const user = req.user;
      
      // 역할 체크: admin 또는 operator만 접근 가능
      if (user.role !== 'admin' && user.role !== 'operator') {
        return res.status(403).json({ error: "관리자 또는 운영자만 접근할 수 있습니다" });
      }
      
      const categoryIdParam = req.query.categoryId as string | undefined;
      
      // 카테고리 필터링을 위한 시나리오 ID 목록 조회
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
      
      // scenarioIds가 빈 배열이면 빈 결과 반환
      if (scenarioIds && scenarioIds.length === 0) {
        return res.json({
          emotions: [],
          totalEmotions: 0,
          uniqueEmotions: 0
        });
      }
      
      const emotionStats = await storage.getAllEmotionStats(scenarioIds);
      
      // 감정 이모지 매핑
      const emotionEmojis: Record<string, string> = {
        '기쁨': '😊',
        '슬픔': '😢',
        '분노': '😠',
        '놀람': '😲',
        '중립': '😐',
        '호기심': '🤔',
        '불안': '😰',
        '피로': '😫',
        '실망': '😞',
        '당혹': '😕',
        '단호': '😤'
      };
      
      // 총 감정 수
      const totalEmotions = emotionStats.reduce((sum, e) => sum + e.count, 0);
      
      // 감정별 데이터 가공
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
    } catch (error) {
      console.error("Error getting emotion analytics:", error);
      res.status(500).json({ error: "Failed to get emotion analytics" });
    }
  });

  // 시나리오별 감정 분석 API - 카테고리 필터링 적용 (admin/operator 전용)
  router.get("/api/admin/analytics/emotions/by-scenario", isAuthenticated, async (req: any, res) => {
    try {
      const user = req.user;
      
      // 역할 체크: admin 또는 operator만 접근 가능
      if (user.role !== 'admin' && user.role !== 'operator') {
        return res.status(403).json({ error: "관리자 또는 운영자만 접근할 수 있습니다" });
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
    } catch (error) {
      console.error("Error getting scenario emotion analytics:", error);
      res.status(500).json({ error: "Failed to get scenario emotion analytics" });
    }
  });

  // MBTI별 감정 분석 API - 카테고리 필터링 적용 (admin/operator 전용)
  router.get("/api/admin/analytics/emotions/by-mbti", isAuthenticated, async (req: any, res) => {
    try {
      const user = req.user;
      
      // 역할 체크: admin 또는 operator만 접근 가능
      if (user.role !== 'admin' && user.role !== 'operator') {
        return res.status(403).json({ error: "관리자 또는 운영자만 접근할 수 있습니다" });
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
    } catch (error) {
      console.error("Error getting MBTI emotion analytics:", error);
      res.status(500).json({ error: "Failed to get MBTI emotion analytics" });
    }
  });

  // 난이도별 감정 분석 API - 카테고리 필터링 적용 (admin/operator 전용)
  router.get("/api/admin/analytics/emotions/by-difficulty", isAuthenticated, async (req: any, res) => {
    try {
      const user = req.user;
      
      // 역할 체크: admin 또는 operator만 접근 가능
      if (user.role !== 'admin' && user.role !== 'operator') {
        return res.status(403).json({ error: "관리자 또는 운영자만 접근할 수 있습니다" });
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
        1: '입문',
        2: '기본',
        3: '심화',
        4: '전문가'
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
    } catch (error) {
      console.error("Error getting difficulty emotion analytics:", error);
      res.status(500).json({ error: "Failed to get difficulty emotion analytics" });
    }
  });

  // 대화별 감정 타임라인 API
  router.get("/api/admin/analytics/emotions/timeline/:personaRunId", isAuthenticated, async (req, res) => {
    try {
      const { personaRunId } = req.params;
      
      if (!personaRunId) {
        return res.status(400).json({ error: "personaRunId is required" });
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
    } catch (error) {
      console.error("Error getting emotion timeline:", error);
      res.status(500).json({ error: "Failed to get emotion timeline" });
    }
  });

  // ===== 참석자 관리 API =====
  router.get("/api/admin/analytics/participants", isAuthenticated, async (req: any, res) => {
    try {
      const user = req.user;
      const categoryIdParam = req.query.categoryId as string | undefined;
      const search = (req.query.search as string || '').toLowerCase().trim();

      const allScenarioRuns = await storage.getAllScenarioRuns();
      const allPersonaRuns = await storage.getAllPersonaRuns();
      const allFeedbacks = await storage.getAllFeedbacks();
      const allScenarios = await fileManager.getAllScenarios();
      const allUsers = await storage.getAllUsers();
      const allCategories = await storage.getAllCategories();

      // 접근 가능한 카테고리 결정
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

      // 접근 가능한 시나리오 필터링
      const scenarios = accessibleCategoryIds.length > 0
        ? allScenarios.filter((s: any) => accessibleCategoryIds.includes(String(s.categoryId)))
        : allScenarios;
      const scenarioIds = new Set(scenarios.map((s: any) => s.id));

      // scenarioRuns 필터링
      const scenarioRuns = accessibleCategoryIds.length > 0
        ? allScenarioRuns.filter(sr => scenarioIds.has(sr.scenarioId))
        : allScenarioRuns;

      // personaRuns 필터링
      const scenarioRunIds = new Set(scenarioRuns.map(sr => sr.id));
      const personaRuns = accessibleCategoryIds.length > 0
        ? allPersonaRuns.filter(pr => scenarioRunIds.has(pr.scenarioRunId))
        : allPersonaRuns;
      const personaRunIds = new Set(personaRuns.map(pr => pr.id));

      // feedbacks 필터링
      const feedbacks = allFeedbacks.filter(f => f.personaRunId && personaRunIds.has(f.personaRunId));

      // 사용자 ID 기준으로 통계 집계
      const scenarioRunsByUser = new Map<string, any[]>();
      for (const sr of scenarioRuns) {
        if (!scenarioRunsByUser.has(sr.userId)) {
          scenarioRunsByUser.set(sr.userId, []);
        }
        scenarioRunsByUser.get(sr.userId)!.push(sr);
      }

      // personaRun → scenarioRun → userId 매핑을 위한 빠른 조회 맵
      const scenarioRunMap = new Map(scenarioRuns.map(sr => [sr.id, sr]));

      // personaRunId → userId 맵
      const personaRunToUserId = new Map<string, string>();
      for (const pr of personaRuns) {
        const sr = scenarioRunMap.get(pr.scenarioRunId);
        if (sr) personaRunToUserId.set(pr.id, sr.userId);
      }

      // 사용자별 피드백 그룹화
      const feedbacksByUser = new Map<string, any[]>();
      for (const f of feedbacks) {
        if (!f.personaRunId) continue;
        const uid = personaRunToUserId.get(f.personaRunId);
        if (!uid) continue;
        if (!feedbacksByUser.has(uid)) feedbacksByUser.set(uid, []);
        feedbacksByUser.get(uid)!.push(f);
      }

      // 사용자별 마지막 훈련일 (scenarioRun.completedAt 기준)
      const lastTrainingByUser = new Map<string, Date>();
      for (const sr of scenarioRuns) {
        if (!sr.completedAt) continue;
        const existing = lastTrainingByUser.get(sr.userId);
        if (!existing || sr.completedAt > existing) {
          lastTrainingByUser.set(sr.userId, sr.completedAt);
        }
      }

      // 사용자별 카테고리 목록 (시나리오 categoryId 기준)
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

      // 참여자 목록 생성 (personaRuns가 1개 이상인 사용자만)
      const participantUserIds = new Set(personaRuns.map(pr => {
        const sr = scenarioRunMap.get(pr.scenarioRunId);
        return sr?.userId;
      }).filter(Boolean) as string[]);

      const participants = [];
      for (const uid of Array.from(participantUserIds)) {
        const u = allUsers.find(u => u.id === uid);
        if (!u) continue;

        // 검색 필터
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

      // 최근 훈련일 내림차순 정렬
      participants.sort((a, b) => {
        if (!a.lastTrainingAt && !b.lastTrainingAt) return 0;
        if (!a.lastTrainingAt) return 1;
        if (!b.lastTrainingAt) return -1;
        return new Date(b.lastTrainingAt).getTime() - new Date(a.lastTrainingAt).getTime();
      });

      res.json({ participants });
    } catch (error) {
      console.error("Error getting participants:", error);
      res.status(500).json({ error: "Failed to get participants" });
    }
  });

  // ===== 관리자/운영자: 특정 사용자 이력 조회 API =====
  router.get("/api/admin/users/:userId/scenario-runs", isAuthenticated, async (req: any, res) => {
    try {
      const requestUser = req.user;
      const { userId } = req.params;

      // 권한 체크
      if (requestUser.role !== 'admin' && requestUser.role !== 'operator') {
        return res.status(403).json({ error: "Access denied" });
      }

      const userScenarioRuns = await storage.getUserScenarioRuns(userId);
      const allScenarios = await fileManager.getAllScenarios();
      const allCategories = await storage.getAllCategories();

      // 운영자인 경우 접근 권한 있는 카테고리의 시나리오 런만 필터링
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
    } catch (error) {
      console.error("Error getting user scenario runs:", error);
      res.status(500).json({ error: "Failed to get user scenario runs" });
    }
  });

  // GET /api/admin/analytics/performance — performance analytics dashboard
  router.get("/api/admin/analytics/performance", isAuthenticated, async (req: any, res) => {
    try {
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
    } catch (error: any) {
      console.error("Error getting analytics performance:", error);
      res.status(500).json({ error: error.message || "Failed to get performance analytics" });
    }
  });

  return router;
}
