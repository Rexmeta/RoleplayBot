import { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { fileManager } from "../services/fileManager";
import { generateFeedback, generateStrategyReflectionFeedback } from "../services/geminiService";

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

export async function verifyPersonaRunOwnership(personaRunId: string, userId: string) {
  const personaRun = await storage.getPersonaRun(personaRunId);
  if (!personaRun) {
    throw createHttpError(404, "Persona run not found");
  }

  const scenarioRun = await storage.getScenarioRun(personaRun.scenarioRunId);
  if (!scenarioRun || scenarioRun.userId !== userId) {
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
    const maxScore = 5;
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
    return { id: criteriaSet.id, name: translatedName, description: translatedDescription, dimensions: translatedDimensions };
  };

  if (scenarioObj?.evaluationCriteriaSetId) {
    const cs = await storage.getEvaluationCriteriaSetWithDimensions(scenarioObj.evaluationCriteriaSetId);
    if (cs && cs.dimensions && cs.dimensions.length > 0) {
      const result = await applyTranslations(cs);
      console.log(`📊 [평가기준] 시나리오 직접 연결: ${cs.name} (${result.dimensions.length}개 차원)`);
      return result;
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

  const conversationDurationSeconds = calculateActualConversationTime(conversation.messages);
  const conversationDuration = Math.floor(conversationDurationSeconds / 60);
  const userMessages = conversation.messages.filter((m: any) => m.sender === 'user');
  const totalUserWords = userMessages.reduce((sum: number, msg: any) => sum + msg.message.length, 0);
  const averageResponseTime = userMessages.length > 0 ? Math.round(conversationDurationSeconds / userMessages.length) : 0;

  const evaluationCriteria = await loadEvaluationCriteria(scenarioObj, userLanguage);

  const feedbackData = await generateFeedback(
    scenarioObj,
    conversation.messages,
    persona,
    conversation,
    evaluationCriteria,
    userLanguage
  );

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

  const dimFeedback = feedbackData.dimensionFeedback || {};
  const defaultDimensions = [
    { key: 'clarityLogic', name: '명확성 & 논리성', weight: 20, minScore: 1, maxScore: 5, icon: '🎯', color: 'blue', description: '발언의 구조화, 핵심 전달, 모호성 최소화' },
    { key: 'listeningEmpathy', name: '경청 & 공감', weight: 20, minScore: 1, maxScore: 5, icon: '👂', color: 'green', description: '재진술·요약, 감정 인식, 우려 존중' },
    { key: 'appropriatenessAdaptability', name: '적절성 & 상황 대응', weight: 20, minScore: 1, maxScore: 5, icon: '⚡', color: 'yellow', description: '맥락 적합한 표현, 유연한 갈등 대응' },
    { key: 'persuasivenessImpact', name: '설득력 & 영향력', weight: 20, minScore: 1, maxScore: 5, icon: '🎪', color: 'purple', description: '논리적 근거, 사례 활용, 행동 변화 유도' },
    { key: 'strategicCommunication', name: '전략적 커뮤니케이션', weight: 20, minScore: 1, maxScore: 5, icon: '🎲', color: 'red', description: '목표 지향적 대화, 협상·조율, 주도성' },
  ];
  const evaluationScores = defaultDimensions.map(dim => ({
    category: dim.key,
    name: dim.name,
    score: feedbackData.scores[dim.key] || 3,
    feedback: dimFeedback[dim.key] || dim.description,
    icon: dim.icon,
    color: dim.color,
    weight: dim.weight
  }));

  const verifiedOverallScore = recalculateOverallScore(evaluationScores);
  if (verifiedOverallScore !== feedbackData.overallScore) {
    console.log(`📊 종합 점수 보정: AI=${feedbackData.overallScore} → 가중치 계산=${verifiedOverallScore}`);
    feedbackData.overallScore = verifiedOverallScore;
  }

  const feedback = await storage.createFeedback({
    personaRunId: conversationId,
    overallScore: verifiedOverallScore,
    scores: evaluationScores,
    detailedFeedback: feedbackData,
  });

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

  console.log(`피드백 자동 생성 완료: ${conversationId}`);

  performStrategicAnalysis(conversationId, conversation, scenarioObj)
    .catch(error => {
      console.error("전략 분석 오류 (무시):", error);
    });

  return feedback;
}

export async function performStrategicAnalysis(conversationId: string, conversation: any, scenarioObj: any) {
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
      'ko'
    );

    await storage.saveSequenceAnalysis(conversationId, {
      conversationId,
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
    difficulty: difficulty || 2,
  };
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
