import { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { fileManager } from "../services/fileManager";
import { generateFeedback, generateStrategyReflectionFeedback } from "../services/aiServiceFactory";
import { trackUsage } from "../services/aiUsageTracker";
import { EvaluationScore } from "@shared/schema";
import {
  calcEffectiveRatio,
  filterVoiceNoise,
  isVoiceMode,
  calculateEvaluationConfidence,
  determineReportStatus,
  applyPassingRule,
} from "../services/evaluationEngine";

export function asyncHandler(fn: (req: any, res: Response, next: NextFunction) => Promise<any>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function createHttpError(status: number, message: string): Error {
  const err: any = new Error(message);
  err.status = status;
  return err;
}

export async function verifyConversationOwnership(conversationId: string, userId: string) {
  const conversation = await storage.getConversation(conversationId);
  if (!conversation) {
    throw createHttpError(404, "Conversation not found");
  }
  if (conversation.userId !== userId) {
    throw createHttpError(403, "Unauthorized access");
  }
  return { conversation };
}

export async function verifyPersonaRunOwnership(personaRunId: string, userId: string, userRole?: string) {
  const personaRun = await storage.getPersonaRun(personaRunId);
  if (!personaRun) {
    throw createHttpError(404, "Persona run not found");
  }

  const scenarioRun = await storage.getScenarioRun(personaRun.scenarioRunId);
  if (!scenarioRun) {
    throw createHttpError(404, "Scenario run not found");
  }

  // Admin and operator have access to any persona run — parity with
  // conversation GET and feedback routes that already allow this.
  if (userRole === 'admin' || userRole === 'operator') {
    return { personaRun, scenarioRun };
  }

  if (scenarioRun.userId !== userId) {
    throw createHttpError(403, "Unauthorized access");
  }

  return { personaRun, scenarioRun };
}

export async function checkAndCompleteScenario(scenarioRunId: string) {
  try {
    const scenarioRun = await storage.getScenarioRun(scenarioRunId);
    if (!scenarioRun || scenarioRun.status === 'completed') {
      return;
    }

    const scenarios = await fileManager.getAllScenarios();
    const scenario = scenarios.find(s => s.id === scenarioRun.scenarioId);
    if (!scenario) {
      return;
    }

    const totalPersonas = scenario.personas?.length || 0;
    if (totalPersonas === 0) {
      return;
    }

    const allPersonaRuns = await storage.getPersonaRunsByScenarioRun(scenarioRunId);
    const completedPersonaRuns = allPersonaRuns.filter(pr => pr.status === 'completed');

    if (completedPersonaRuns.length === totalPersonas) {
      await storage.updateScenarioRun(scenarioRunId, {
        status: 'completed',
        completedAt: new Date()
      });
      console.log(`✅ Scenario run ${scenarioRunId} auto-completed (${completedPersonaRuns.length}/${totalPersonas} personas completed)`);
    }
  } catch (error) {
    console.error("Error checking scenario completion:", error);
  }
}

export function recalculateOverallScore(evaluationScores: any[]): number {
  const totalWeight = evaluationScores.reduce((sum: number, s: any) => sum + (s.weight || 20), 0);
  if (totalWeight === 0) return 50;

  const weightedSum = evaluationScores.reduce((sum: number, s: any) => {
    const maxScore = s.maxScore || 10;
    const weight = s.weight || 20;
    return sum + (s.score / maxScore) * weight;
  }, 0);

  return Math.round((weightedSum / totalWeight) * 100);
}

export async function loadEvaluationCriteria(
  scenarioObj: any,
  userLanguage: 'ko' | 'en' | 'ja' | 'zh' = 'ko'
): Promise<any | null> {
  const applyTranslations = async (criteriaSet: any): Promise<any> => {
    let translatedName = criteriaSet.name;
    let translatedDescription = criteriaSet.description;
    if (userLanguage !== 'ko') {
      const setTr = await storage.getEvaluationCriteriaSetTranslation(criteriaSet.id, userLanguage);
      if (setTr) {
        translatedName = setTr.name;
        translatedDescription = setTr.description || criteriaSet.description;
      }
    }
    const translatedDimensions = await Promise.all(
      (criteriaSet.dimensions || []).filter((d: any) => d.isActive).map(async (dim: any) => {
        if (userLanguage !== 'ko') {
          const dimTr = await storage.getEvaluationDimensionTranslation(dim.id, userLanguage);
          if (dimTr) {
            return { ...dim, name: dimTr.name, description: dimTr.description || dim.description, scoringRubric: dimTr.scoringRubric || dim.scoringRubric };
          }
        }
        return dim;
      })
    );
    return {
      id: criteriaSet.id,
      name: translatedName,
      description: translatedDescription,
      dimensions: translatedDimensions,
      version: criteriaSet.version ?? null,
      status: criteriaSet.status ?? null,
    };
  };

  if (scenarioObj?.evaluationCriteriaSetId) {
    const cs = await storage.getEvaluationCriteriaSetWithDimensions(scenarioObj.evaluationCriteriaSetId);
    if (cs && cs.dimensions && cs.dimensions.length > 0) {
      if (cs.status && cs.status !== 'approved') {
        console.log(`📊 [평가기준] 시나리오 직접 연결 루브릭 '${cs.name}'의 상태가 '${cs.status}'이어서 평가에 사용 불가 → 카테고리/기본값으로 대체`);
      } else {
        const result = await applyTranslations(cs);
        console.log(`📊 [평가기준] 시나리오 직접 연결: ${cs.name} v${cs.version ?? 1} (${result.dimensions.length}개 차원)`);
        return result;
      }
    }
  }

  const categoryId = scenarioObj?.categoryId;
  const cs2 = await storage.getActiveEvaluationCriteriaSetWithDimensions(categoryId || undefined);
  if (cs2 && cs2.dimensions && cs2.dimensions.length > 0) {
    const result = await applyTranslations(cs2);
    const source = categoryId ? `카테고리(${categoryId})` : '시스템 기본';
    console.log(`📊 [평가기준] ${source}: ${cs2.name} (${result.dimensions.length}개 차원)`);
    return result;
  }

  console.log('📊 [평가기준] 사용 가능한 기준 없음 → AI 내장 기본값 사용');
  return null;
}

const IDLE_THRESHOLD_MS = 5 * 60 * 1000;

function calculateActualConversationTime(messages: any[]): number {
  if (messages.length < 2) {
    return messages.length > 0 ? 60 : 0;
  }

  const sortedMessages = [...messages].sort((a, b) =>
    new Date(a.timestamp || a.createdAt).getTime() - new Date(b.timestamp || b.createdAt).getTime()
  );

  let totalActiveTime = 0;

  for (let i = 1; i < sortedMessages.length; i++) {
    const prevTime = new Date(sortedMessages[i - 1].timestamp || sortedMessages[i - 1].createdAt).getTime();
    const currTime = new Date(sortedMessages[i].timestamp || sortedMessages[i].createdAt).getTime();
    const gap = currTime - prevTime;

    if (gap <= IDLE_THRESHOLD_MS) {
      totalActiveTime += gap;
    } else {
      console.log(`⏸️ 대화 중단 감지: ${Math.floor(gap / 1000 / 60)}분 간격 (제외됨)`);
    }
  }

  return Math.floor(totalActiveTime / 1000);
}

const INSUFFICIENT_CONVERSATION_THRESHOLD_MESSAGES = 3;
const INSUFFICIENT_CONVERSATION_THRESHOLD_CHARS = 50;

function generateInsufficientConversationFeedback(
  evaluationCriteria: any,
  userMessageCount: number,
  totalChars: number,
  validMessageCount: number,
  confidence: number
): any {
  const reasons: string[] = [];
  if (userMessageCount < INSUFFICIENT_CONVERSATION_THRESHOLD_MESSAGES) {
    reasons.push(`발화 수 부족: ${userMessageCount}회 (최소 ${INSUFFICIENT_CONVERSATION_THRESHOLD_MESSAGES}회 이상 필요)`);
  }
  if (totalChars < INSUFFICIENT_CONVERSATION_THRESHOLD_CHARS) {
    reasons.push(`총 발화량 부족: ${totalChars}자 (최소 ${INSUFFICIENT_CONVERSATION_THRESHOLD_CHARS}자 이상 필요)`);
  }
  if (validMessageCount < userMessageCount) {
    reasons.push(`유효 발화 부족: 노이즈 제거 후 유효 발화 ${validMessageCount}회`);
  }

  return {
    overallScore: null,
    scores: [],
    dimensionFeedback: {},
    strengths: [],
    improvements: [],
    nextSteps: ['더 긴 대화 후 평가를 시도하세요', '각 역량 영역별로 충분한 발화를 해 주세요', `목표 발화 수(최소 ${INSUFFICIENT_CONVERSATION_THRESHOLD_MESSAGES}회) 이상 대화하세요`],
    summary: `대화 내용이 부족하여 역량 분석이 불가합니다. (발화 수: ${userMessageCount}회, 총 글자 수: ${totalChars}자) 더 충분한 대화를 나눈 후 다시 평가해 주세요.`,
    behaviorGuides: [],
    conversationGuides: [],
    developmentPlan: { shortTerm: [], mediumTerm: [], longTerm: [], recommendedResources: [] },
    evaluationCriteriaSetName: evaluationCriteria?.name,
    insufficientConversation: true,
    confidence,
    reportStatus: 'insufficient_data',
    insufficientReasons: reasons,
  };
}

export async function generateAndSaveFeedback(
  conversationId: string,
  conversation: any,
  scenarioObj: any,
  persona: any,
  userLanguage: 'ko' | 'en' | 'ja' | 'zh' = 'ko'
) {
  const existingFeedback = await storage.getFeedbackByConversationId(conversationId);
  if (existingFeedback) {
    console.log(`피드백이 이미 존재함: ${conversationId}`);
    return existingFeedback;
  }

  console.log(`피드백 생성 중: ${conversationId}`);

  // Fetch simulation turn-score history from persisted auto_evaluation events
  // (canonical source for NPC simulation engine carry-forward data)
  let simTurnScores: Array<{ turnIndex: number; turnScore: Record<string, number> }> = [];
  let simIncidents: Array<{ turnIndex: number; type: string; severity: string }> = [];
  try {
    const simEvents = await storage.getSimulationEventsByPersonaRun(conversationId);
    for (const ev of simEvents) {
      if (ev.eventType === 'auto_evaluation' && ev.includeInReport) {
        const r = ev.result as any;
        if (r?.turnScore) simTurnScores.push({ turnIndex: ev.turnIndex, turnScore: r.turnScore });
      }
      if (ev.eventType === 'tool_call' && ev.includeInReport) {
        const r = ev.result as any;
        if (r?.incident?.type) simIncidents.push({ turnIndex: ev.turnIndex, type: r.incident.type, severity: r.incident.severity ?? 'medium' });
      }
    }
  } catch (e) {
    console.warn('[generateAndSaveFeedback] Failed to fetch simulation events:', e);
  }

  const conversationDurationSeconds = calculateActualConversationTime(conversation.messages);
  const conversationDuration = Math.floor(conversationDurationSeconds / 60);
  const userMessages = conversation.messages.filter((m: any) => m.sender === 'user');
  const totalUserWords = userMessages.reduce((sum: number, msg: any) => sum + msg.message.length, 0);
  const averageResponseTime = userMessages.length > 0 ? Math.round(conversationDurationSeconds / userMessages.length) : 0;

  const evaluationCriteria = await loadEvaluationCriteria(scenarioObj, userLanguage);

  let feedbackModelName = 'gemini-2.5-flash';
  try {
    const { getModelForFeature } = await import('../services/aiServiceFactory');
    feedbackModelName = await getModelForFeature('feedback');
  } catch {
    // fallback to default
  }

  const rubricSnapshot: Record<string, any> | null = evaluationCriteria ? {
    id: evaluationCriteria.id,
    name: evaluationCriteria.name,
    version: evaluationCriteria.version ?? null,
    status: evaluationCriteria.status ?? null,
    dimensions: (evaluationCriteria.dimensions || []).map((d: any) => ({
      key: d.key,
      name: d.name,
      weight: d.weight,
      minScore: d.minScore,
      maxScore: d.maxScore,
      icon: d.icon,
      color: d.color,
      scoringRubric: d.scoringRubric,
    })),
  } : null;

  const conversationSnapshot: any[] = conversation.messages.map((m: any) => ({
    sender: m.sender,
    message: m.message,
    timestamp: m.timestamp,
  }));

  const evaluationPromptSnapshot: Record<string, any> | null = evaluationCriteria ? {
    criteriaSetId: evaluationCriteria.id,
    dimensions: (evaluationCriteria.dimensions || []).map((d: any) => ({
      key: d.key,
      evaluationPrompt: d.evaluationPrompt || null,
    })),
  } : null;

  const modelSnapshot: Record<string, any> = {
    model: feedbackModelName,
    capturedAt: new Date().toISOString(),
  };

  // 시나리오별 minValidTurns 우선, 없으면 전역 기본값 — 턴 수만으로 판정 (단일 소스)
  const scenarioMinValidTurns: number =
    typeof scenarioObj?.minValidTurns === 'number'
      ? scenarioObj.minValidTurns
      : INSUFFICIENT_CONVERSATION_THRESHOLD_MESSAGES;

  const voiceMode = isVoiceMode(conversation);
  const validUserMessages = filterVoiceNoise(userMessages);
  const effectiveRatio = calcEffectiveRatio(validUserMessages, voiceMode, scenarioObj?.targetTurns);

  // confidence/reportStatus를 insufficient 판단 전에 계산
  const activeDimensionsForConfidence = evaluationCriteria?.dimensions ?? [];
  const earlyConfidence = calculateEvaluationConfidence({
    validUserMessages,
    rawUserMessages: userMessages,
    effectiveRatio,
    evidenceMap: {},
    dimensions: activeDimensionsForConfidence,
    voiceMode,
    scenarioTargetTurns: scenarioObj?.targetTurns,
  });

  const isInsufficientConversation = userMessages.length < scenarioMinValidTurns;

  let feedbackData: any;
  if (isInsufficientConversation) {
    console.log(`⚠️ 대화 부족 감지 (발화 수: ${userMessages.length}, 글자 수: ${totalUserWords}) → AI 호출 없이 평가 불가 피드백 생성`);
    feedbackData = generateInsufficientConversationFeedback(evaluationCriteria, userMessages.length, totalUserWords, validUserMessages.length, earlyConfidence);
  } else {
    feedbackData = await generateFeedback(
      scenarioObj,
      conversation.messages,
      persona,
      conversation,
      evaluationCriteria,
      userLanguage
    );
  }

  const timePerformance = (() => {
    if (userMessages.length === 0 || totalUserWords === 0) {
      return {
        rating: 'slow' as const,
        feedback: '대화 참여 없음 - 시간 평가 불가'
      };
    }

    const speechDensity = conversationDuration > 0 ? totalUserWords / conversationDuration : 0;
    const avgMessageLength = totalUserWords / userMessages.length;

    let rating: 'excellent' | 'good' | 'average' | 'slow' = 'slow';
    let feedback = '';

    if (speechDensity >= 30 && avgMessageLength >= 20) {
      rating = conversationDuration <= 10 ? 'excellent' : 'good';
      feedback = `활발한 대화 참여 (밀도: ${speechDensity.toFixed(1)}자/분, 평균: ${avgMessageLength.toFixed(0)}자/발언)`;
    } else if (speechDensity >= 15 && avgMessageLength >= 10) {
      rating = conversationDuration <= 15 ? 'good' : 'average';
      feedback = `적절한 대화 참여 (밀도: ${speechDensity.toFixed(1)}자/분, 평균: ${avgMessageLength.toFixed(0)}자/발언)`;
    } else if (speechDensity >= 5 && avgMessageLength >= 5) {
      rating = 'average';
      feedback = `소극적 참여 (밀도: ${speechDensity.toFixed(1)}자/분, 평균: ${avgMessageLength.toFixed(0)}자/발언)`;
    } else {
      rating = 'slow';
      feedback = `매우 소극적 참여 (밀도: ${speechDensity.toFixed(1)}자/분, 평균: ${avgMessageLength.toFixed(0)}자/발언)`;
    }

    return { rating, feedback };
  })();

  feedbackData.conversationDuration = conversationDurationSeconds;
  feedbackData.averageResponseTime = averageResponseTime;
  feedbackData.timePerformance = timePerformance;

  // Attach simulation engine carry-forward data to the report:
  // - turn-by-turn score timeline (from auto_evaluation events)
  // - critical moments (incidents from tool_call events)
  // - simulation-based average score (cross-check anchor against AI holistic score)
  if (simTurnScores.length > 0) {
    feedbackData.simulationTurnScores = simTurnScores;
    const simAvg = simTurnScores.reduce((s, t) => s + (t.turnScore.total ?? 0), 0) / simTurnScores.length;
    feedbackData.simulationAverageScore = Math.round(simAvg);
    console.log(`📊 [simulation carry-forward] ${simTurnScores.length} turns, avg=${feedbackData.simulationAverageScore}`);
  }
  if (simIncidents.length > 0) {
    feedbackData.criticalMoments = simIncidents;
    console.log(`🚨 [simulation carry-forward] ${simIncidents.length} critical moments`);
  }

  // 평가 불가(insufficientConversation) 상태이면 점수 재계산 우회 — 상태 중심으로 저장
  if (feedbackData.insufficientConversation) {
    console.log(`⚠️ insufficientConversation=true — 점수 재계산 우회, 상태 중심 저장`);
    const feedback = await storage.createFeedback({
      personaRunId: conversationId,
      overallScore: null,
      confidence: feedbackData.confidence ?? null,
      reportStatus: 'insufficient_data',
      scores: [],
      detailedFeedback: feedbackData,
      rubricSnapshot,
      conversationSnapshot,
      evaluationPromptSnapshot,
      modelSnapshot,
      criteriaSetVersion: evaluationCriteria?.version ?? null,
      scoreAdjustments: feedbackData.scoreAdjustments ?? null,
    });
    return feedback;
  }

  const dimFeedback = feedbackData.dimensionFeedback || {};
  const fallbackDimensions = [
    { key: 'clarityLogic', name: '명확성 & 논리성', weight: 20, minScore: 1, maxScore: 10, icon: '🎯', color: 'blue', description: '발언의 구조화, 핵심 전달, 모호성 최소화' },
    { key: 'listeningEmpathy', name: '경청 & 공감', weight: 20, minScore: 1, maxScore: 10, icon: '👂', color: 'green', description: '재진술·요약, 감정 인식, 우려 존중' },
    { key: 'appropriatenessAdaptability', name: '적절성 & 상황 대응', weight: 20, minScore: 1, maxScore: 10, icon: '⚡', color: 'yellow', description: '맥락 적합한 표현, 유연한 갈등 대응' },
    { key: 'persuasivenessImpact', name: '설득력 & 영향력', weight: 20, minScore: 1, maxScore: 10, icon: '🎪', color: 'purple', description: '논리적 근거, 사례 활용, 행동 변화 유도' },
    { key: 'strategicCommunication', name: '전략적 커뮤니케이션', weight: 20, minScore: 1, maxScore: 10, icon: '🎲', color: 'red', description: '목표 지향적 대화, 협상·조율, 주도성' },
  ];
  const activeDimensions = (evaluationCriteria?.dimensions && evaluationCriteria.dimensions.length > 0)
    ? evaluationCriteria.dimensions
    : fallbackDimensions;
  if (evaluationCriteria?.dimensions && evaluationCriteria.dimensions.length > 0) {
    console.log(`📊 [점수매핑] 시나리오 평가기준 적용: ${evaluationCriteria.name} (${evaluationCriteria.dimensions.length}개 차원: ${evaluationCriteria.dimensions.map((d: any) => d.key).join(', ')})`);
  } else {
    console.log(`📊 [점수매핑] 기본 평가기준 적용 (5개 차원)`);
  }
  const evaluationScores: EvaluationScore[] = activeDimensions.map((dim: any) => {
    const existingScore = Array.isArray(feedbackData.scores)
      ? feedbackData.scores.find((s: EvaluationScore) => s.category === dim.key)
      : undefined;
    return {
      category: dim.key,
      name: dim.name,
      score: existingScore?.score || dim.minScore || 1,
      feedback: dimFeedback[dim.key] || dim.description || '',
      icon: dim.icon || '📊',
      color: dim.color || 'blue',
      weight: dim.weight || 20,
      maxScore: dim.maxScore || 10,
    };
  });

  if (!isInsufficientConversation) {
    const scoreValues = evaluationScores.map(s => s.score);
    const allSameScore = scoreValues.length > 1 && scoreValues.every(s => s === scoreValues[0]);
    const isLowConversation =
      userMessages.length < INSUFFICIENT_CONVERSATION_THRESHOLD_MESSAGES * 2 ||
      totalUserWords < INSUFFICIENT_CONVERSATION_THRESHOLD_CHARS * 3;
    if (allSameScore && isLowConversation) {
      console.log(`⚠️ 동일 점수 감지 (모두 ${scoreValues[0]}점) + 대화량 부족 → 점수 보정`);
      const correctedScores = [3, 6, 4, 7, 3];
      evaluationScores.forEach((s, idx) => {
        s.score = correctedScores[idx % correctedScores.length];
        if (Array.isArray(feedbackData.scores)) {
          const existingScoreItem = feedbackData.scores.find((fs: EvaluationScore) => fs.category === s.category);
          if (existingScoreItem) existingScoreItem.score = s.score;
        }
      });
      if (!feedbackData.summary || !feedbackData.summary.includes('대화 내용이 충분하지 않아')) {
        feedbackData.summary = '대화 내용이 충분하지 않아 정확한 역량 분석이 어렵습니다. ' + (feedbackData.summary || '');
      }
    }
  }

  const baseVerifiedScore = recalculateOverallScore(evaluationScores);
  // 완성도 패널티는 차원 점수에 반영되지 않으므로 별도 보관된 값을 재적용
  const storedPenalty: number = feedbackData.scoreAdjustments?.completionPenalty ?? 0;
  const verifiedOverallScore = Math.max(0, baseVerifiedScore - storedPenalty);
  if (verifiedOverallScore !== feedbackData.overallScore) {
    console.log(`📊 종합 점수 보정: AI=${feedbackData.overallScore} → 가중치계산${baseVerifiedScore} - 패널티${storedPenalty} = ${verifiedOverallScore}`);
    feedbackData.overallScore = verifiedOverallScore;
  }

  // Apply evaluationHarness.passingRule if configured on the scenario.
  // scenarioObj is file-based and does not carry DB columns, so we fetch
  // the DB record explicitly to get evaluationHarness.
  try {
    const scenarioId = scenarioObj?.id ? String(scenarioObj.id) : null;
    const scenarioDbRow = scenarioId
      ? await storage.getScenario(scenarioId).catch(() => null)
      : null;
    const harnessPR = (scenarioDbRow as any)?.evaluationHarness?.passingRule ?? null;
    if (harnessPR) {
      // Build per-dimension averages from simulation turn scores.
      // These use EvaluationDimensionKey values (clarity/empathy/logic/ownership/actionPlan)
      // which match requiredDimensions keys exactly. Scores are 0-100 scale.
      const simDimAvgs: Array<{ category: string; score: number; maxScore: number }> = [];
      if (simTurnScores.length > 0) {
        for (const key of ['clarity', 'empathy', 'logic', 'ownership', 'actionPlan'] as const) {
          const vals = simTurnScores
            .map(t => (t.turnScore as Record<string, number>)[key])
            .filter((v): v is number => typeof v === 'number');
          if (vals.length > 0) {
            const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
            simDimAvgs.push({ category: key, score: avg, maxScore: 100 });
          }
        }
      }
      // Fall back to holistic evaluation scores if no sim scores are available
      const dimsForPassRule = simDimAvgs.length > 0 ? simDimAvgs : evaluationScores;
      const harnessPassResult = applyPassingRule(verifiedOverallScore, dimsForPassRule, harnessPR);
      feedbackData.harnessPassResult = harnessPassResult;
      console.log(
        `📊 [passingRule] passed=${harnessPassResult.passed}, required≥${harnessPR.minAverageScore} (actual=${verifiedOverallScore}), failedDims=[${harnessPassResult.failedDimensions.join(',')}], simDimSrc=${simDimAvgs.length > 0 ? 'sim' : 'holistic'}`
      );
    }
  } catch (e) {
    console.warn('[generateAndSaveFeedback] passingRule evaluation failed:', e);
  }

  // evidence 맵 추출 (AI 피드백에서)
  const evidenceMapForConfidence: Record<string, { isSystemFallback?: boolean }[]> = {};
  if (Array.isArray(feedbackData.scores)) {
    for (const s of feedbackData.scores) {
      if (s.category && Array.isArray(s.evidence)) {
        evidenceMapForConfidence[s.category] = s.evidence;
      }
    }
  }

  const finalConfidence = calculateEvaluationConfidence({
    validUserMessages,
    rawUserMessages: userMessages,
    effectiveRatio,
    evidenceMap: evidenceMapForConfidence,
    dimensions: activeDimensions,
    voiceMode,
    scenarioTargetTurns: scenarioObj?.targetTurns,
  });
  const finalReportStatus = determineReportStatus(finalConfidence);

  feedbackData.confidence = finalConfidence;
  feedbackData.reportStatus = finalReportStatus;
  console.log(`📊 평가 신뢰도: confidence=${finalConfidence.toFixed(3)}, reportStatus=${finalReportStatus}`);

  // insufficient_data로 판정된 경우 점수 데이터를 정규화해서 저장 (일관성 보장)
  const isInsufficientByConfidence = finalReportStatus === 'insufficient_data';
  const savedOverallScore = isInsufficientByConfidence ? null : verifiedOverallScore;
  const savedScores = isInsufficientByConfidence ? [] : evaluationScores;
  if (isInsufficientByConfidence) {
    feedbackData.insufficientConversation = true;
    console.log(`⚠️ insufficient_data 판정 (신뢰도 기반) → overallScore=null, scores=[] 로 정규화`);
  }

  // Check system setting: operators can disable per-persona segment feedback globally
  let segmentFeedbackEnabled = true;
  try {
    const segSetting = await storage.getSystemSetting('feedback', 'segment_feedback_enabled');
    if (segSetting?.value !== undefined) {
      segmentFeedbackEnabled = segSetting.value !== 'false' && segSetting.value !== '0';
    }
  } catch {
    // default to enabled if the setting is missing
  }

  // Generate per-persona segment feedbacks for multi-persona scenarios
  if (!isInsufficientByConfidence && segmentFeedbackEnabled) {
    try {
      const personaRunForSegments = await storage.getPersonaRun(conversationId);
      const personaSwitchLog: Array<{ turn: number; fromPersonaIndex: number; toPersonaIndex: number }> =
        Array.isArray(personaRunForSegments?.personaSwitchLog)
          ? (personaRunForSegments!.personaSwitchLog as any[])
          : [];
      const scenarioPersonas: any[] = scenarioObj?.personas ?? [];

      if (personaSwitchLog.length > 0 && scenarioPersonas.length > 1) {
        const dbMessages = await storage.getChatMessagesByPersonaRun(conversationId);
        const sortedLog = [...personaSwitchLog].sort((a, b) => a.turn - b.turn);
        const maxTurn = dbMessages.length > 0
          ? Math.max(...dbMessages.map((m: any) => m.turnIndex ?? 0))
          : 0;
        const switchMode: string = scenarioObj?.personaSwitchMode ?? 'replace';

        let segments: Array<{ personaIndex: number; turnStart: number; turnEnd: number }> = [];

        if (switchMode === 'join') {
          // Join mode: each persona is active from their first appearance turn to end of session.
          // Build per-persona active windows (overlapping).
          const personaWindowStart: Map<number, number> = new Map([[0, 0]]);
          for (const sw of sortedLog) {
            if (!personaWindowStart.has(sw.toPersonaIndex)) {
              // Joining persona becomes active from the turn AFTER the switch turn
              personaWindowStart.set(sw.toPersonaIndex, sw.turn + 1);
            }
          }
          Array.from(personaWindowStart.entries()).forEach(([personaIndex, turnStart]) => {
            segments.push({ personaIndex, turnStart, turnEnd: maxTurn });
          });
        } else {
          // Replace mode: sequential non-overlapping segments
          let prevTurn = -1;
          let prevIdx = 0;
          for (const sw of sortedLog) {
            segments.push({ personaIndex: prevIdx, turnStart: prevTurn + 1, turnEnd: sw.turn });
            prevTurn = sw.turn;
            prevIdx = sw.toPersonaIndex;
          }
          segments.push({ personaIndex: prevIdx, turnStart: sortedLog[sortedLog.length - 1].turn + 1, turnEnd: maxTurn });
        }

        const segmentFeedbacks: any[] = [];
        for (const seg of segments) {
          const segMsgs = dbMessages.filter((m: any) => {
            const ti = m.turnIndex ?? 0;
            return ti >= seg.turnStart && ti <= seg.turnEnd;
          });
          const segUserMsgs = segMsgs.filter((m: any) => m.sender === 'user');
          if (segUserMsgs.length < scenarioMinValidTurns) continue;

          const segPersona = scenarioPersonas[seg.personaIndex];
          if (!segPersona) continue;

          const segConvMessages = segMsgs.map((m: any) => ({
            sender: m.sender,
            message: m.message,
            timestamp: new Date(m.createdAt ?? Date.now()).toISOString(),
          }));

          try {
            const segStartMs = Date.now();
            const segFeedback = await generateFeedback(
              scenarioObj, segConvMessages, segPersona,
              { messages: segConvMessages }, evaluationCriteria, userLanguage
            );
            const segDurationMs = Date.now() - segStartMs;
            segmentFeedbacks.push({
              personaIndex: seg.personaIndex,
              personaName: segPersona.name,
              turnStart: seg.turnStart,
              turnEnd: seg.turnEnd,
              feedback: {
                overallScore: segFeedback.overallScore ?? null,
                summary: segFeedback.summary ?? '',
                strengths: segFeedback.strengths ?? [],
                improvements: segFeedback.improvements ?? [],
                nextSteps: segFeedback.nextSteps ?? [],
              },
            });
            trackUsage({
              feature: 'feedback',
              model: feedbackModelName,
              provider: feedbackModelName.startsWith('gpt') ? 'openai' : 'gemini',
              promptTokens: 0,
              completionTokens: 0,
              tokensEstimated: true,
              conversationId,
              userId: conversation.userId ?? undefined,
              durationMs: segDurationMs,
              metadata: {
                type: 'persona_segment_feedback',
                personaIndex: seg.personaIndex,
                personaName: segPersona.name,
                segmentUserMessages: segUserMsgs.length,
              },
            }).catch(() => {});
          } catch (segErr) {
            console.warn(`[generateAndSaveFeedback] Segment ${seg.personaIndex} feedback failed:`, segErr);
          }
        }

        if (segmentFeedbacks.length > 0) {
          feedbackData.personaSegmentFeedbacks = segmentFeedbacks;
          console.log(`📊 [persona segments] ${segmentFeedbacks.length} segment feedbacks generated`);
        }
      }
    } catch (err) {
      console.warn('[generateAndSaveFeedback] Per-persona segment feedback error:', err);
    }
  }

  // Extract metric snapshot based on scenario's analyticsSpec.trackedMetrics
  let metricSnapshot: Record<string, number | null> | null = null;
  try {
    const analyticsSpec = (scenarioDbRow as any)?.analyticsSpec as { trackedMetrics?: string[]; reportSections?: string[]; benchmarkGroup?: string } | null;
    if (analyticsSpec?.trackedMetrics && analyticsSpec.trackedMetrics.length > 0) {
      const snapshot: Record<string, number | null> = {};
      // Gather emotion timeline from simulation events stateAfter
      const emotionTimeline: Array<{ anger?: number; trust?: number }> = [];
      for (const ev of (await storage.getSimulationEventsByPersonaRun(conversationId).catch(() => []))) {
        const sa = ev.stateAfter as any;
        if (sa?.npcEmotions) emotionTimeline.push(sa.npcEmotions);
      }
      // Also include the final simulation state
      const personaRunForMetrics = await storage.getPersonaRun(conversationId).catch(() => null);
      const finalSimState = (personaRunForMetrics?.simulationState as any) ?? null;
      if (finalSimState?.npcEmotions) emotionTimeline.push(finalSimState.npcEmotions);

      for (const metric of analyticsSpec.trackedMetrics) {
        switch (metric) {
          case 'angerMax': {
            const vals = emotionTimeline.map(s => s.anger).filter((v): v is number => typeof v === 'number');
            snapshot.angerMax = vals.length > 0 ? Math.max(...vals) : null;
            break;
          }
          case 'trustMin': {
            const vals = emotionTimeline.map(s => s.trust).filter((v): v is number => typeof v === 'number');
            snapshot.trustMin = vals.length > 0 ? Math.min(...vals) : null;
            break;
          }
          case 'trustMax': {
            const vals = emotionTimeline.map(s => s.trust).filter((v): v is number => typeof v === 'number');
            snapshot.trustMax = vals.length > 0 ? Math.max(...vals) : null;
            break;
          }
          case 'trustAverage': {
            const vals = emotionTimeline.map(s => s.trust).filter((v): v is number => typeof v === 'number');
            snapshot.trustAverage = vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
            break;
          }
          case 'angerAverage': {
            const vals = emotionTimeline.map(s => s.anger).filter((v): v is number => typeof v === 'number');
            snapshot.angerAverage = vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
            break;
          }
          case 'empathyAverage': {
            const vals = simTurnScores.map(t => (t.turnScore as Record<string, number>)['empathy']).filter((v): v is number => typeof v === 'number');
            snapshot.empathyAverage = vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
            break;
          }
          case 'escalationCount': {
            snapshot.escalationCount = simIncidents.filter(i =>
              ['customer_escalation', 'manager_interrupt', 'executive_join'].includes(i.type)
            ).length;
            break;
          }
          case 'interruptionCount': {
            snapshot.interruptionCount = simIncidents.length;
            break;
          }
          case 'timeToResolution': {
            snapshot.timeToResolution = Math.round(conversationDurationSeconds);
            break;
          }
          case 'totalTurns': {
            snapshot.totalTurns = userMessages.length;
            break;
          }
          case 'turnsToFirstActionPlan': {
            const actionPlanKeywords = ['계획', '방안', '해결책', '조치', 'action plan', 'plan of action'];
            let firstTurn: number | null = null;
            userMessages.forEach((m: any, idx: number) => {
              if (firstTurn !== null) return;
              const msg = (m.message || '').toLowerCase();
              if (actionPlanKeywords.some(k => msg.includes(k))) firstTurn = idx + 1;
            });
            snapshot.turnsToFirstActionPlan = firstTurn;
            break;
          }
        }
      }
      if (Object.keys(snapshot).length > 0) {
        metricSnapshot = snapshot;
        console.log(`📊 [metricSnapshot] ${Object.keys(snapshot).length} metrics captured:`, snapshot);
      }
    }
  } catch (e) {
    console.warn('[generateAndSaveFeedback] metricSnapshot extraction failed:', e);
  }

  const feedback = await storage.createFeedback({
    personaRunId: conversationId,
    overallScore: savedOverallScore,
    confidence: finalConfidence,
    reportStatus: finalReportStatus,
    scores: savedScores,
    detailedFeedback: feedbackData,
    rubricSnapshot,
    conversationSnapshot,
    evaluationPromptSnapshot,
    modelSnapshot,
    criteriaSetVersion: evaluationCriteria?.version ?? null,
    scoreAdjustments: feedbackData.scoreAdjustments ?? null,
    metricSnapshot,
  });

  // insufficient_data 판정 시 PersonaRun score를 업데이트하지 않음 (무점수 상태 유지)
  if (!isInsufficientByConfidence) {
    try {
      const personaRun = await storage.getPersonaRun(conversationId);
      if (personaRun) {
        await storage.updatePersonaRun(conversationId, {
          score: verifiedOverallScore
        });
        console.log(`✅ PersonaRun ${conversationId} score 업데이트: ${verifiedOverallScore}`);
      }
    } catch (error) {
      console.warn(`PersonaRun score 업데이트 실패: ${error}`);
    }
  }

  console.log(`피드백 자동 생성 완료: ${conversationId}`);

  performStrategicAnalysis(conversationId, conversation, scenarioObj, userLanguage)
    .catch(error => {
      console.error("전략 분석 오류 (무시):", error);
    });

  return feedback;
}

export async function performStrategicAnalysis(conversationId: string, conversation: any, scenarioObj: any, userLanguage: 'ko' | 'en' | 'ja' | 'zh' = 'ko') {
  try {
    const strategyChoices = await storage.getStrategyChoices(conversationId);
    if (!strategyChoices || strategyChoices.length === 0) {
      return;
    }

    const sequenceAnalysis = await storage.getSequenceAnalysis(conversationId);
    if (sequenceAnalysis) {
      return;
    }

    const reflectionData = await generateStrategyReflectionFeedback(
      "전략적 선택 자동 분석",
      [],
      {
        title: scenarioObj?.title || '',
        context: scenarioObj?.context?.situation || scenarioObj?.description || '',
        objectives: scenarioObj?.objectives || [],
        personas: (scenarioObj?.personas || []).map((p: any) => ({
          id: p.id,
          name: p.name,
          role: p.role || '',
          department: p.department || ''
        }))
      },
      userLanguage
    );

    await storage.saveSequenceAnalysis(conversationId, {
      strategicScore: reflectionData.strategicScore,
      strategicRationale: reflectionData.strategicRationale,
      sequenceEffectiveness: reflectionData.sequenceEffectiveness,
      alternativeApproaches: reflectionData.alternativeApproaches,
      strategicInsights: reflectionData.strategicInsights,
      strengths: reflectionData.strengths,
      improvements: reflectionData.improvements,
    });
  } catch (error) {
    console.error("전략 분석 실패:", error);
  }
}

export function buildFreeChatPersona(mbtiPersona: any): any {
  return {
    id: mbtiPersona.id,
    name: mbtiPersona.mbti,
    role: "동료",
    department: "팀",
    mbti: mbtiPersona.mbti,
    gender: mbtiPersona.gender,
    personality: mbtiPersona.communicationStyle || mbtiPersona.communication_style || '균형 잡힌 의사소통',
    responseStyle: mbtiPersona.communicationPatterns?.opening_style || mbtiPersona.communication_patterns?.opening_style || '자연스럽게 대화 시작',
    goals: mbtiPersona.communicationPatterns?.win_conditions || mbtiPersona.communication_patterns?.win_conditions || ['편안한 대화'],
    background: (mbtiPersona.background?.personal_values || []).join(', ') || '다양한 경험',
  };
}

export function buildFreeChatScenario(mbtiPersona: any, difficulty: number): any {
  return {
    id: "__free_chat__",
    title: `${mbtiPersona.mbti || mbtiPersona.id} 유형과의 자유 대화`,
    description: `${mbtiPersona.mbti || mbtiPersona.id} 유형의 페르소나와 자유롭게 대화를 나눕니다`,
    isFreeChat: true,
    context: {
      situation: "직장 내 자연스러운 대화 상황. 별도의 협상 목표나 시나리오 없이 상대방과 편안하게 대화합니다.",
      timeline: "현재",
      stakes: "상호 이해와 커뮤니케이션 능력 향상",
      playerRole: {
        position: "직원",
        department: "팀",
        experience: "근무 중",
        responsibility: "자유롭게 대화하기"
      }
    },
    objectives: [
      "자연스러운 대화를 통해 상대방을 이해하고 소통하기",
      "상대방의 MBTI 유형에 맞는 커뮤니케이션 스타일 연습하기"
    ],
    personas: [],
    difficulty: difficulty || 4,
  };
}

export interface MetricSnapshotInput {
  trackedMetrics: string[];
  emotionTimeline: Array<{ anger?: number; trust?: number }>;
  simTurnScores: Array<{ turnIndex: number; turnScore: Record<string, number> }>;
  simIncidents: Array<{ turnIndex: number; type: string; severity: string }>;
  conversationDurationSeconds: number;
  userMessages: Array<{ message: string }>;
}

export function computeMetricSnapshot(input: MetricSnapshotInput): Record<string, number | null> {
  const {
    trackedMetrics,
    emotionTimeline,
    simTurnScores,
    simIncidents,
    conversationDurationSeconds,
    userMessages,
  } = input;

  const snapshot: Record<string, number | null> = {};
  for (const metric of trackedMetrics) {
    switch (metric) {
      case 'angerMax': {
        const vals = emotionTimeline.map(s => s.anger).filter((v): v is number => typeof v === 'number');
        snapshot.angerMax = vals.length > 0 ? Math.max(...vals) : null;
        break;
      }
      case 'trustMin': {
        const vals = emotionTimeline.map(s => s.trust).filter((v): v is number => typeof v === 'number');
        snapshot.trustMin = vals.length > 0 ? Math.min(...vals) : null;
        break;
      }
      case 'trustMax': {
        const vals = emotionTimeline.map(s => s.trust).filter((v): v is number => typeof v === 'number');
        snapshot.trustMax = vals.length > 0 ? Math.max(...vals) : null;
        break;
      }
      case 'trustAverage': {
        const vals = emotionTimeline.map(s => s.trust).filter((v): v is number => typeof v === 'number');
        snapshot.trustAverage = vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
        break;
      }
      case 'angerAverage': {
        const vals = emotionTimeline.map(s => s.anger).filter((v): v is number => typeof v === 'number');
        snapshot.angerAverage = vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
        break;
      }
      case 'empathyAverage': {
        const vals = simTurnScores.map(t => (t.turnScore as Record<string, number>)['empathy']).filter((v): v is number => typeof v === 'number');
        snapshot.empathyAverage = vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
        break;
      }
      case 'escalationCount': {
        snapshot.escalationCount = simIncidents.filter(i =>
          ['customer_escalation', 'manager_interrupt', 'executive_join'].includes(i.type)
        ).length;
        break;
      }
      case 'interruptionCount': {
        snapshot.interruptionCount = simIncidents.length;
        break;
      }
      case 'timeToResolution': {
        snapshot.timeToResolution = Math.round(conversationDurationSeconds);
        break;
      }
      case 'totalTurns': {
        snapshot.totalTurns = userMessages.length;
        break;
      }
      case 'turnsToFirstActionPlan': {
        const actionPlanKeywords = ['계획', '방안', '해결책', '조치', 'action plan', 'plan of action'];
        let firstTurn: number | null = null;
        userMessages.forEach((m, idx) => {
          if (firstTurn !== null) return;
          const msg = (m.message || '').toLowerCase();
          if (actionPlanKeywords.some(k => msg.includes(k))) firstTurn = idx + 1;
        });
        snapshot.turnsToFirstActionPlan = firstTurn;
        break;
      }
    }
  }
  return snapshot;
}

export async function getOperatorAccessibleCategoryIds(user: any): Promise<string[]> {
  if (user.role === 'admin') {
    const allCategories = await storage.getAllCategories();
    return allCategories.map(c => c.id);
  }
  if (user.role !== 'operator') return [];

  if (user.assignedCategoryId) {
    return [user.assignedCategoryId];
  }

  if (user.assignedOrganizationId) {
    const allCategories = await storage.getAllCategories();
    return allCategories.filter(c => c.organizationId === user.assignedOrganizationId).map(c => c.id);
  }

  if (user.assignedCompanyId) {
    const allOrgs = await storage.getAllOrganizations();
    const companyOrgIds = allOrgs.filter(o => o.companyId === user.assignedCompanyId).map(o => o.id);
    const allCategories = await storage.getAllCategories();
    return allCategories.filter(c => c.organizationId && companyOrgIds.includes(c.organizationId)).map(c => c.id);
  }

  return [];
}
