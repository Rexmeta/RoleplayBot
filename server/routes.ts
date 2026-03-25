import type { Express } from "express";
import type { Server } from "http";
import WebSocket, { WebSocketServer } from "ws";
import { storage } from "./storage";
// Replit Auth 제거됨
import { 
  insertConversationSchema, 
  insertFeedbackSchema,
  insertPersonaSelectionSchema,
  insertStrategyChoiceSchema,
  insertSequenceAnalysisSchema
} from "@shared/schema";
import { generateAIResponse, generateFeedback, generateStrategyReflectionFeedback } from "./services/geminiService";
import { GoogleGenAI } from "@google/genai";
import { createSampleData } from "./sampleData";
import ttsRoutes from "./routes/tts.js";
import imageGenerationRoutes from "./routes/imageGeneration.js";
import { mediaStorage } from "./services/mediaStorage";
import mediaRoutes from "./routes/media.js";
import { fileManager } from "./services/fileManager";
import { generateScenarioWithAI, enhanceScenarioWithAI } from "./services/aiScenarioGenerator";
import { realtimeVoiceService } from "./services/realtimeVoiceService";
import { generateIntroVideo, deleteIntroVideo, getVideoGenerationStatus, getDefaultVideoPrompt } from "./services/gemini-video-generator";
import { generateImagePrompt } from "./routes/imageGeneration";
import { GlobalMBTICache } from "./utils/globalMBTICache";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
import { transformScenariosMedia, transformScenarioMedia, transformToSignedUrl, isGCSAvailable, transformPersonasMedia, transformPersonaMedia, listGCSFiles } from "./services/gcsStorage";

export async function registerRoutes(app: Express, httpServer: Server): Promise<void> {
  // 이메일 기반 인증 시스템 설정
  const cookieParser = (await import('cookie-parser')).default;
  app.use(cookieParser());
  
  // 인증 시스템 설정
  const { setupAuth, isAuthenticated } = await import('./auth');
  setupAuth(app);
  
  // 시스템 헬스체크 엔드포인트 (운영 모니터링용)
  app.get('/api/health', (req, res) => {
    const memoryUsage = process.memoryUsage();
    const activeRealtimeSessions = realtimeVoiceService.getActiveSessionCount();
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: {
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        rss: Math.round(memoryUsage.rss / 1024 / 1024),
        external: Math.round(memoryUsage.external / 1024 / 1024),
        unit: 'MB',
      },
      realtimeVoice: {
        ...realtimeVoiceService.getSessionStatus(),
        isAvailable: realtimeVoiceService.isServiceAvailable(),
      },
    });
  });
  
  // 업로드 파일 접근 (프로필 이미지는 공개, 기타 파일은 인증 필요)
  const path = await import('path');
  const fs = await import('fs');
  
  // 프로필 이미지는 공개 접근 허용 (img 태그에서 Authorization 헤더 불가)
  app.get('/uploads/profiles/*', (req: any, res) => {
    const filePath = path.join(process.cwd(), 'public', req.path);
    
    // 경로 조작(Path Traversal) 방지
    const normalizedPath = path.normalize(filePath);
    const profilesDir = path.join(process.cwd(), 'public', 'uploads', 'profiles');
    
    if (!normalizedPath.startsWith(profilesDir)) {
      return res.status(403).json({ message: "접근이 거부되었습니다" });
    }
    
    if (fs.existsSync(normalizedPath)) {
      res.sendFile(normalizedPath);
    } else {
      res.status(404).json({ message: "파일을 찾을 수 없습니다" });
    }
  });
  
  // 기타 업로드 파일은 인증 필요
  app.get('/uploads/*', isAuthenticated, (req: any, res) => {
    const filePath = path.join(process.cwd(), 'public', req.path);
    
    // 경로 조작(Path Traversal) 방지
    const normalizedPath = path.normalize(filePath);
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
    
    if (!normalizedPath.startsWith(uploadsDir)) {
      return res.status(403).json({ message: "접근이 거부되었습니다" });
    }
    
    if (fs.existsSync(normalizedPath)) {
      res.sendFile(normalizedPath);
    } else {
      res.status(404).json({ message: "파일을 찾을 수 없습니다" });
    }
  });

  // Helper function to verify conversation ownership (레거시)
  async function verifyConversationOwnership(conversationId: string, userId: string) {
    const conversation = await storage.getConversation(conversationId);
    if (!conversation) {
      return { error: "Conversation not found", status: 404 };
    }
    if (conversation.userId !== userId) {
      return { error: "Unauthorized access", status: 403 };
    }
    return { conversation };
  }

  // Helper function to verify persona run ownership (새 구조)
  async function verifyPersonaRunOwnership(personaRunId: string, userId: string) {
    const personaRun = await storage.getPersonaRun(personaRunId);
    if (!personaRun) {
      return { error: "Persona run not found", status: 404 };
    }
    
    const scenarioRun = await storage.getScenarioRun(personaRun.scenarioRunId);
    if (!scenarioRun || scenarioRun.userId !== userId) {
      return { error: "Unauthorized access", status: 403 };
    }
    
    return { personaRun, scenarioRun };
  }

  // Helper function to check if scenario should be auto-completed
  async function checkAndCompleteScenario(scenarioRunId: string) {
    try {
      const scenarioRun = await storage.getScenarioRun(scenarioRunId);
      if (!scenarioRun || scenarioRun.status === 'completed') {
        return; // 이미 완료됨 또는 존재하지 않음
      }

      // 시나리오 정보 조회하여 총 페르소나 수 확인
      const scenarios = await fileManager.getAllScenarios();
      const scenario = scenarios.find(s => s.id === scenarioRun.scenarioId);
      if (!scenario) {
        return;
      }

      const totalPersonas = scenario.personas?.length || 0;
      if (totalPersonas === 0) {
        return;
      }

      // 해당 시나리오 실행의 모든 페르소나 실행 조회
      const allPersonaRuns = await storage.getPersonaRunsByScenarioRun(scenarioRunId);
      const completedPersonaRuns = allPersonaRuns.filter(pr => pr.status === 'completed');

      // 모든 페르소나가 완료되었으면 시나리오도 완료
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

  function recalculateOverallScore(evaluationScores: any[]): number {
    const totalWeight = evaluationScores.reduce((sum: number, s: any) => sum + (s.weight || 20), 0);
    if (totalWeight === 0) return 50;
    
    const weightedSum = evaluationScores.reduce((sum: number, s: any) => {
      const maxScore = 5;
      const weight = s.weight || 20;
      return sum + (s.score / maxScore) * weight;
    }, 0);
    
    return Math.round((weightedSum / totalWeight) * 100);
  }

  // ─── 공통 헬퍼: 시나리오/카테고리/기본 순으로 평가 기준 로드 + 번역 적용 ───
  async function loadEvaluationCriteria(
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

    // 1순위: 시나리오에 직접 연결된 평가 기준
    if (scenarioObj?.evaluationCriteriaSetId) {
      const cs = await storage.getEvaluationCriteriaSetWithDimensions(scenarioObj.evaluationCriteriaSetId);
      if (cs && cs.dimensions && cs.dimensions.length > 0) {
        const result = await applyTranslations(cs);
        console.log(`📊 [평가기준] 시나리오 직접 연결: ${cs.name} (${result.dimensions.length}개 차원)`);
        return result;
      }
    }

    // 2순위: 시나리오 카테고리에 연결된 평가 기준
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
  // ──────────────────────────────────────────────────────────────────────────

  // Helper function to generate and save feedback automatically
  async function generateAndSaveFeedback(
    conversationId: string, 
    conversation: any, 
    scenarioObj: any, 
    persona: any,
    userLanguage: 'ko' | 'en' | 'ja' | 'zh' = 'ko'
  ) {
    // 이미 피드백이 있는지 확인
    const existingFeedback = await storage.getFeedbackByConversationId(conversationId);
    if (existingFeedback) {
      console.log(`피드백이 이미 존재함: ${conversationId}`);
      return existingFeedback;
    }

    console.log(`피드백 생성 중: ${conversationId}`);

    // ✨ 메시지 기반 대화 시간 계산 - 5분 이상 간격은 제외하여 실제 대화 시간만 계산
    const IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5분 = 대화 중단으로 간주
    
    const calculateActualConversationTime = (messages: any[]): number => {
      if (messages.length < 2) {
        // 메시지가 1개 이하면 기본값 반환
        return messages.length > 0 ? 60 : 0; // 최소 1분
      }
      
      // 메시지를 시간순으로 정렬
      const sortedMessages = [...messages].sort((a, b) => 
        new Date(a.timestamp || a.createdAt).getTime() - new Date(b.timestamp || b.createdAt).getTime()
      );
      
      let totalActiveTime = 0;
      
      for (let i = 1; i < sortedMessages.length; i++) {
        const prevTime = new Date(sortedMessages[i - 1].timestamp || sortedMessages[i - 1].createdAt).getTime();
        const currTime = new Date(sortedMessages[i].timestamp || sortedMessages[i].createdAt).getTime();
        const gap = currTime - prevTime;
        
        // 5분 이하의 간격만 대화 시간에 포함
        if (gap <= IDLE_THRESHOLD_MS) {
          totalActiveTime += gap;
        } else {
          console.log(`⏸️ 대화 중단 감지: ${Math.floor(gap / 1000 / 60)}분 간격 (제외됨)`);
        }
      }
      
      return Math.floor(totalActiveTime / 1000); // 초 단위로 반환
    };
    
    const conversationDurationSeconds = calculateActualConversationTime(conversation.messages);
    const conversationDuration = Math.floor(conversationDurationSeconds / 60);
    const userMessages = conversation.messages.filter((m: any) => m.sender === 'user');
    const totalUserWords = userMessages.reduce((sum: number, msg: any) => sum + msg.message.length, 0);
    const averageResponseTime = userMessages.length > 0 ? Math.round(conversationDurationSeconds / userMessages.length) : 0;

    // 평가 기준 로드 (시나리오 → 카테고리 → 기본 순)
    const evaluationCriteria = await loadEvaluationCriteria(scenarioObj, userLanguage);

    // 피드백 데이터 생성 (사용자 언어 전달)
    const feedbackData = await generateFeedback(
      scenarioObj,
      conversation.messages,
      persona,
      conversation,
      evaluationCriteria, // ✨ 동적 평가 기준 세트 전달
      userLanguage
    );

    // 시간 성과 평가
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

    // 피드백에 시간 정보 추가
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

    // 피드백 저장
    const feedback = await storage.createFeedback({
      conversationId,
      personaRunId: conversationId,
      overallScore: verifiedOverallScore,
      scores: evaluationScores,
      detailedFeedback: feedbackData,
    });

    // ✨ personaRun의 score 업데이트
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

    // 전략적 선택 분석도 백그라운드에서 수행
    performStrategicAnalysis(conversationId, conversation, scenarioObj)
      .catch(error => {
        console.error("전략 분석 오류 (무시):", error);
      });

    return feedback;
  }

  // ===== User Profile Management =====
  // Update user profile (name and/or password)
  app.patch("/api/user/profile", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { name, currentPassword, newPassword, profileImage } = req.body;
      
      // 현재 사용자 정보 조회
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const updates: { name?: string; password?: string; profileImage?: string } = {};

      // 이름 업데이트
      if (name && name.trim()) {
        updates.name = name.trim();
      }

      // 프로필 이미지 업데이트
      if (profileImage !== undefined) {
        updates.profileImage = profileImage;
      }

      // 비밀번호 변경
      if (newPassword) {
        if (!currentPassword) {
          return res.status(400).json({ error: "Current password is required to change password" });
        }

        // 현재 비밀번호 확인
        const { verifyPassword, hashPassword } = await import('./auth');
        const isValidPassword = await verifyPassword(currentPassword, user.password);
        if (!isValidPassword) {
          return res.status(400).json({ error: "Current password is incorrect" });
        }

        // 새 비밀번호 해싱
        updates.password = await hashPassword(newPassword);
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No updates provided" });
      }

      // 사용자 정보 업데이트
      const updatedUser = await storage.updateUser(userId, updates);

      res.json({
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        role: updatedUser.role,
        profileImage: updatedUser.profileImage,
        tier: updatedUser.tier,
        updatedAt: updatedUser.updatedAt,
      });
    } catch (error: any) {
      console.error("Error updating user profile:", error);
      res.status(500).json({ error: error.message || "Failed to update profile" });
    }
  });

  // Upload profile image
  app.post("/api/user/profile-image", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { imageData } = req.body; // Base64 encoded image
      if (!imageData) {
        return res.status(400).json({ error: "Image data is required" });
      }

      // Base64 이미지를 파일로 저장
      const fs = await import('fs');
      const path = await import('path');
      
      // 이미지 데이터 파싱
      const matches = imageData.match(/^data:image\/(\w+);base64,(.+)$/);
      if (!matches) {
        return res.status(400).json({ error: "Invalid image format" });
      }
      
      const ext = matches[1];
      const base64Data = matches[2];
      const buffer = Buffer.from(base64Data, 'base64');
      
      // 프로필 이미지 저장 디렉토리 생성
      const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'profiles');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      
      // 파일명 생성 (userId + timestamp)
      const filename = `${userId}-${Date.now()}.${ext}`;
      const filepath = path.join(uploadDir, filename);
      
      // 파일 저장
      fs.writeFileSync(filepath, buffer);
      
      // 이미지 URL 생성
      const imageUrl = `/uploads/profiles/${filename}`;
      
      // 사용자 프로필 업데이트
      const updatedUser = await storage.updateUser(userId, { profileImage: imageUrl });
      
      res.json({
        profileImage: updatedUser.profileImage,
        message: "Profile image uploaded successfully"
      });
    } catch (error: any) {
      console.error("Error uploading profile image:", error);
      res.status(500).json({ error: error.message || "Failed to upload profile image" });
    }
  });

  // Get current user profile
  app.get("/api/user/profile", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // 게스트 계정 체크 및 데모 완료 여부 확인
      const isGuest = user.email === 'guest@mothle.com';
      let hasCompletedDemo = false;
      
      if (isGuest) {
        // 게스트가 완료한 시나리오 실행이 있는지 확인
        const scenarioRuns = await storage.getUserScenarioRuns(userId);
        hasCompletedDemo = scenarioRuns.some((run: any) => run.status === 'completed');
      }
      
      res.json({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        profileImage: user.profileImage,
        tier: user.tier,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        isGuest,
        hasCompletedDemo,
      });
    } catch (error: any) {
      console.error("Error fetching user profile:", error);
      res.status(500).json({ error: error.message || "Failed to fetch profile" });
    }
  });

  // ============================== 자유 대화 (Free Chat) ==============================

  /** MBTI 페르소나에서 ScenarioPersona 형식의 객체 생성 */
  function buildFreeChatPersona(mbtiPersona: any): any {
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

  /** 자유 대화용 합성 시나리오 객체 생성 (AI에 컨텍스트 제공용) */
  function buildFreeChatScenario(mbtiPersona: any, difficulty: number): any {
    return {
      id: "__free_chat__",
      title: `${mbtiPersona.mbti || mbtiPersona.id} 유형과의 자유 대화`,
      description: `${mbtiPersona.mbti || mbtiPersona.id} 유형의 페르소나와 자유롭게 대화를 나눕니다`,
      isFreeChat: true, // AI 프롬프트에서 시나리오 목표 없이 자유 대화임을 알림
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

  /** GET /api/free-chat/personas — 자유 대화 가능한 MBTI 페르소나 목록 (시스템 관리자 전용) */
  app.get("/api/free-chat/personas", isAuthenticated, async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: "Access denied. System admin only." });
    }
    try {
      const personas = await storage.getFreeChatPersonas();
      res.json(personas);
    } catch (error: any) {
      console.error("Free chat personas fetch error:", error);
      res.status(500).json({ error: "Failed to fetch free chat personas" });
    }
  });

  /** POST /api/free-chat/start — 자유 대화 시작 (시스템 관리자 전용) */
  app.post("/api/free-chat/start", isAuthenticated, async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: "Access denied. System admin only." });
    }
    try {
      // @ts-ignore
      const userId = req.user?.id;
      const { personaId, mode = "text", difficulty = 2, gender } = req.body;

      if (!personaId) return res.status(400).json({ error: "personaId is required" });

      const mbtiPersona = await storage.getMbtiPersona(personaId);
      if (!mbtiPersona) return res.status(404).json({ error: "Persona not found" });
      if (!mbtiPersona.freeChatAvailable) return res.status(403).json({ error: "This persona is not available for free chat" });

      const user = await storage.getUser(userId);

      // ScenarioRun 생성 (__free_chat__ 센티넬 값)
      const existingRuns = await storage.getUserScenarioRuns(userId);
      const freeChatAttempts = existingRuns.filter(r => r.scenarioId === "__free_chat__").length;
      const scenarioRun = await storage.createScenarioRun({
        userId,
        scenarioId: "__free_chat__",
        scenarioName: `자유 대화 - ${mbtiPersona.mbti}`,
        attemptNumber: freeChatAttempts + 1,
        mode,
        difficulty,
        status: "active"
      });

      // PersonaSnapshot 구성 (ChatWindow 이미지 렌더링에 필요한 필드 포함)
      const effectiveGender = gender || mbtiPersona.gender || "male";
      const personaSnapshot = {
        id: mbtiPersona.id,
        name: mbtiPersona.mbti,
        mbti: mbtiPersona.mbti,
        gender: effectiveGender,
        images: mbtiPersona.images,
        freeChatDescription: mbtiPersona.freeChatDescription,
        communicationStyle: mbtiPersona.communicationStyle,
        personalityTraits: mbtiPersona.personalityTraits,
        motivation: mbtiPersona.motivation,
        background: mbtiPersona.background,
        communicationPatterns: mbtiPersona.communicationPatterns,
      };

      // PersonaRun 생성
      const personaRun = await storage.createPersonaRun({
        scenarioRunId: scenarioRun.id,
        personaId: mbtiPersona.id,
        personaName: mbtiPersona.mbti,
        personaSnapshot,
        mbtiType: mbtiPersona.id,
        phase: 1,
        mode,
        difficulty,
        status: "active"
      });

      const responseBase = {
        id: personaRun.id,
        scenarioRunId: scenarioRun.id,
        scenarioId: "__free_chat__",
        scenarioName: `자유 대화 - ${mbtiPersona.mbti}`,
        personaId: mbtiPersona.id,
        personaSnapshot,
        turnCount: 0,
        status: "active",
        mode,
        difficulty,
        userId,
        createdAt: scenarioRun.startedAt,
      };

      // 실시간 음성 모드는 WebSocket 연결 후 첫 메시지 수신
      if (mode === "realtime_voice") {
        return res.json({ ...responseBase, messages: [] });
      }

      // 텍스트/TTS: 첫 AI 인사말 생성
      const persona = buildFreeChatPersona(mbtiPersona);
      const freeChatScenario = buildFreeChatScenario(mbtiPersona, difficulty);
      const userLanguage = (user?.preferredLanguage as "ko" | "en" | "ja" | "zh") || "ko";

      const aiResult = await generateAIResponse(freeChatScenario as any, [], persona, undefined, userLanguage);

      await storage.createChatMessage({
        personaRunId: personaRun.id,
        sender: "ai",
        message: aiResult.content,
        turnIndex: 0,
        emotion: aiResult.emotion || null,
        emotionReason: aiResult.emotionReason || null
      });
      await storage.updatePersonaRun(personaRun.id, { actualStartedAt: new Date() });

      return res.json({
        ...responseBase,
        messages: [{
          sender: "ai",
          message: aiResult.content,
          timestamp: new Date().toISOString(),
          emotion: aiResult.emotion,
          emotionReason: aiResult.emotionReason,
        }],
      });
    } catch (error: any) {
      console.error("Free chat start error:", error);
      res.status(500).json({ error: error.message || "Failed to start free chat" });
    }
  });

  // ============================== 사용자 제작 페르소나 ==============================

  /** GET /api/user-personas — 내가 만든 페르소나 목록 (시스템 관리자 전용) */
  app.get("/api/user-personas", isAuthenticated, async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: "Access denied. System admin only." });
    }
    try {
      const userId = req.user?.id;
      const personas = await storage.getUserPersonasByCreator(userId);
      res.json(personas);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch user personas" });
    }
  });

  /** GET /api/user-personas/discover — 공개 페르소나 탐색 (시스템 관리자 전용) */
  app.get("/api/user-personas/discover", isAuthenticated, async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: "Access denied. System admin only." });
    }
    try {
      const sortBy = (req.query.sort as string) === 'recent' ? 'recent' : 'likes';
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;
      const personas = await storage.getPublicUserPersonas(sortBy, limit, offset);
      res.json(personas);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch public personas" });
    }
  });

  /** GET /api/user-personas/:id — 특정 페르소나 조회 (시스템 관리자 전용) */
  app.get("/api/user-personas/:id", isAuthenticated, async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: "Access denied. System admin only." });
    }
    try {
      const persona = await storage.getUserPersonaById(req.params.id);
      if (!persona) return res.status(404).json({ error: "Persona not found" });
      if (!persona.isPublic && persona.creatorId !== req.user?.id) {
        return res.status(403).json({ error: "Access denied" });
      }
      const liked = await storage.getUserPersonaLike(req.user?.id, persona.id);
      res.json({ ...persona, liked });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch persona" });
    }
  });

  /** POST /api/user-personas — 페르소나 생성 (시스템 관리자 전용) */
  app.post("/api/user-personas", isAuthenticated, async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: "Access denied. System admin only." });
    }
    try {
      const userId = req.user?.id;
      const { name, description, greeting, avatarUrl, personality, tags, isPublic } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ error: "Name is required" });
      const persona = await storage.createUserPersona({
        creatorId: userId,
        name: name.trim(),
        description: description?.trim() || "",
        greeting: greeting?.trim() || `안녕하세요! 저는 ${name.trim()}입니다.`,
        avatarUrl: avatarUrl || null,
        personality: personality || { traits: [], communicationStyle: "", background: "", speechStyle: "" },
        tags: tags || [],
        isPublic: isPublic ?? false,
      });
      res.status(201).json(persona);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to create persona" });
    }
  });

  /** PUT /api/user-personas/:id — 페르소나 수정 (시스템 관리자 전용) */
  app.put("/api/user-personas/:id", isAuthenticated, async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: "Access denied. System admin only." });
    }
    try {
      const userId = req.user?.id;
      const { name, description, greeting, avatarUrl, personality, tags, isPublic } = req.body;
      const persona = await storage.updateUserPersona(req.params.id, userId, {
        ...(name !== undefined && { name: name.trim() }),
        ...(description !== undefined && { description: description.trim() }),
        ...(greeting !== undefined && { greeting: greeting.trim() }),
        ...(avatarUrl !== undefined && { avatarUrl }),
        ...(personality !== undefined && { personality }),
        ...(tags !== undefined && { tags }),
        ...(isPublic !== undefined && { isPublic }),
      });
      res.json(persona);
    } catch (error: any) {
      if (error.message?.includes("not found or unauthorized")) return res.status(403).json({ error: error.message });
      res.status(500).json({ error: "Failed to update persona" });
    }
  });

  /** DELETE /api/user-personas/:id — 페르소나 삭제 (시스템 관리자 전용) */
  app.delete("/api/user-personas/:id", isAuthenticated, async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: "Access denied. System admin only." });
    }
    try {
      await storage.deleteUserPersona(req.params.id, req.user?.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete persona" });
    }
  });

  /** POST /api/user-personas/:id/like — 좋아요 토글 (시스템 관리자 전용) */
  app.post("/api/user-personas/:id/like", isAuthenticated, async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: "Access denied. System admin only." });
    }
    try {
      const result = await storage.toggleUserPersonaLike(req.user?.id, req.params.id);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to toggle like" });
    }
  });

  /** POST /api/user-personas/:id/start-chat — 채팅 시작 (시스템 관리자 전용) */
  app.post("/api/user-personas/:id/start-chat", isAuthenticated, async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: "Access denied. System admin only." });
    }
    try {
      const userId = req.user?.id;
      const { mode = "text", difficulty = 2 } = req.body;
      const persona = await storage.getUserPersonaById(req.params.id);
      if (!persona) return res.status(404).json({ error: "Persona not found" });
      if (!persona.isPublic && persona.creatorId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }

      const scenarioId = `__user_persona__:${persona.id}`;
      const scenarioName = `${persona.name}와의 대화`;

      // ScenarioRun 생성 (free-chat 패턴과 동일)
      const existingRuns = await storage.getUserScenarioRuns(userId);
      const prevAttempts = existingRuns.filter(r => r.scenarioId === scenarioId).length;

      const scenarioRun = await storage.createScenarioRun({
        userId,
        scenarioId,
        scenarioName,
        attemptNumber: prevAttempts + 1,
        mode,
        difficulty,
        status: "active",
      });

      // PersonaSnapshot 구성
      const pers = (persona.personality as any) || {};
      const personaSnapshot = {
        id: persona.id,
        name: persona.name,
        avatarUrl: persona.avatarUrl,
        description: persona.description,
        greeting: persona.greeting,
        personality: pers,
        tags: persona.tags,
      };

      // PersonaRun 생성
      const personaRun = await storage.createPersonaRun({
        scenarioRunId: scenarioRun.id,
        personaId: persona.id,
        personaName: persona.name,
        personaSnapshot,
        phase: 1,
        mode,
        difficulty,
        status: "active",
      });

      await storage.incrementUserPersonaChatCount(persona.id);

      const greetingText = persona.greeting || `안녕하세요! 저는 ${persona.name}입니다. 무슨 이야기든 편하게 나눠요.`;

      // 실시간 음성 모드는 WebSocket 연결 후 첫 메시지 수신
      if (mode === "realtime_voice") {
        return res.json({
          id: personaRun.id,
          scenarioRunId: scenarioRun.id,
          scenarioId,
          scenarioName,
          personaId: persona.id,
          personaSnapshot,
          turnCount: 0,
          status: "active",
          mode,
          difficulty,
          userId,
          messages: [],
        });
      }

      // 텍스트/TTS: 첫 인사말 저장
      await storage.createChatMessage({
        personaRunId: personaRun.id,
        sender: "ai",
        message: greetingText,
        turnIndex: 0,
        emotion: "중립",
        emotionReason: "인사",
      });

      res.json({
        id: personaRun.id,
        scenarioRunId: scenarioRun.id,
        scenarioId,
        scenarioName,
        personaId: persona.id,
        personaSnapshot,
        turnCount: 0,
        status: "active",
        mode,
        difficulty,
        userId,
        messages: [{
          sender: "ai",
          message: greetingText,
          timestamp: new Date().toISOString(),
          emotion: "중립",
          emotionReason: "인사",
        }],
      });
    } catch (error: any) {
      console.error("User persona chat start error:", error);
      res.status(500).json({ error: error.message || "Failed to start chat" });
    }
  });

  // ============================== / 사용자 제작 페르소나 ==============================

  // ============================== / 자유 대화 ==============================

  // Create new conversation (scenario_run + persona_run 구조)
  app.post("/api/conversations", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      
      // 게스트 계정 1회 체험 제한 체크
      const user = await storage.getUser(userId);
      if (user && user.email === 'guest@mothle.com') {
        const existingRuns = await storage.getUserScenarioRuns(userId);
        const hasCompletedDemo = existingRuns.some((run: any) => run.status === 'completed');
        if (hasCompletedDemo) {
          return res.status(403).json({ 
            error: "게스트 계정은 1회만 체험할 수 있습니다. 회원가입 후 계속 이용해주세요.",
            errorCode: "GUEST_DEMO_LIMIT_REACHED"
          });
        }
      }
      
      const validatedData = insertConversationSchema.parse(req.body);
      
      // ✨ forceNewRun 플래그 확인 - true이면 항상 새 scenario_run 생성
      // @ts-ignore - forceNewRun은 옵션 필드
      const forceNewRun = req.body.forceNewRun === true;
      
      // ✨ 기존 active scenarioRun 찾기 또는 새로 생성
      let scenarioRun;
      
      if (forceNewRun) {
        console.log(`🆕 forceNewRun=true, 새 Scenario Run 강제 생성`);
        scenarioRun = null;
      } else {
        scenarioRun = await storage.findActiveScenarioRun(userId, validatedData.scenarioId);
      }
      
      if (scenarioRun) {
        console.log(`♻️ 기존 Scenario Run 재사용: ${scenarioRun.id} (attempt #${scenarioRun.attemptNumber})`);
      } else {
        // 시도 번호 계산 (같은 사용자가 같은 시나리오를 몇 번째로 실행하는지)
        const existingRuns = await storage.getUserScenarioRuns(userId);
        const sameScenarioRuns = existingRuns.filter(r => r.scenarioId === validatedData.scenarioId);
        const attemptNumber = sameScenarioRuns.length + 1;
        
        scenarioRun = await storage.createScenarioRun({
          userId,
          scenarioId: validatedData.scenarioId,
          scenarioName: validatedData.scenarioName,
          attemptNumber,
          mode: validatedData.mode,
          difficulty: validatedData.difficulty,
          status: 'active'
        });
        
        console.log(`📋 새로운 Scenario Run 생성: ${scenarioRun.id} (attempt #${attemptNumber})`);
      }
      
      // ✨ 새로운 구조: persona_run 생성
      const personaId = validatedData.personaId || validatedData.scenarioId;
      
      // 시나리오에서 페르소나 정보 가져오기
      const scenarioFromDb = await storage.getScenario(validatedData.scenarioId);
      if (!scenarioFromDb) {
        return res.status(404).json({ error: "시나리오를 찾을 수 없습니다.", errorCode: "SCENARIO_NOT_FOUND" });
      }
      if (scenarioFromDb.isDeleted) {
        return res.status(410).json({ error: "이 시나리오는 삭제되어 더 이상 이용할 수 없습니다.", errorCode: "SCENARIO_DELETED" });
      }
      
      const scenarios = await fileManager.getAllScenarios();
      const scenarioObj = scenarios.find(s => s.id === validatedData.scenarioId);
      if (!scenarioObj) {
        throw new Error(`Scenario not found: ${validatedData.scenarioId}`);
      }
      
      const scenarioPersona = scenarioObj.personas.find((p: any) => p.id === personaId) as any;
      if (!scenarioPersona) {
        throw new Error(`Persona not found in scenario: ${personaId}`);
      }
      
      const mbtiType = (scenarioPersona as any).mbti || (scenarioPersona as any).personaRef?.replace('.json', '');
      const mbtiPersona = mbtiType ? await fileManager.getPersonaByMBTI(mbtiType) : null;
      
      // ✨ phase 자동 계산: 같은 scenario_run 내의 persona_run 개수 + 1
      const existingPersonaRuns = await storage.getPersonaRunsByScenarioRun(scenarioRun.id);
      const phase = existingPersonaRuns.length + 1;
      
      const personaRun = await storage.createPersonaRun({
        scenarioRunId: scenarioRun.id,
        personaId,
        personaName: (scenarioPersona as any).name,
        personaSnapshot: validatedData.personaSnapshot || {},
        mbtiType: mbtiType || null,
        phase,
        mode: validatedData.mode,
        difficulty: validatedData.difficulty || 2,
        status: 'active'
      });
      
      console.log(`👤 Persona Run 생성: ${personaRun.id}, mode=${validatedData.mode}`);
      
      // 실시간 음성 모드는 WebSocket을 통해 초기 메시지를 받으므로 건너뛰기
      if (validatedData.mode === 'realtime_voice') {
        console.log('🎙️ 실시간 음성 모드 - Gemini 호출 건너뛰기');
        return res.json({
          id: personaRun.id,
          scenarioRunId: scenarioRun.id,
          scenarioId: validatedData.scenarioId,
          scenarioName: validatedData.scenarioName,
          personaId,
          personaSnapshot: validatedData.personaSnapshot,
          messages: [],
          turnCount: 0,
          status: 'active',
          mode: validatedData.mode,
          difficulty: validatedData.difficulty || 2,
          userId,
          createdAt: scenarioRun.startedAt,
          updatedAt: scenarioRun.startedAt
        });
      }
      
      console.log('💬 텍스트/TTS 모드 - Gemini로 초기 메시지 생성');
      
      try {
        const persona = {
          id: (scenarioPersona as any).id,
          name: (scenarioPersona as any).name,
          role: (scenarioPersona as any).position,
          department: (scenarioPersona as any).department,
          personality: mbtiPersona?.communication_style || '균형 잡힌 의사소통',
          responseStyle: mbtiPersona?.communication_patterns?.opening_style || '상황에 맞는 방식으로 대화 시작',
          goals: mbtiPersona?.communication_patterns?.win_conditions || ['목표 달성'],
          background: mbtiPersona?.background?.personal_values?.join(', ') || '전문성'
        };

        // 사용자가 선택한 난이도를 시나리오 객체에 적용
        const scenarioWithUserDifficulty = {
          ...scenarioObj,
          difficulty: validatedData.difficulty || 2 // 사용자가 선택한 난이도 사용
        };

        // 사용자 언어 설정 가져오기
        const user = await storage.getUser(userId);
        const userLanguage = (user?.preferredLanguage as 'ko' | 'en' | 'ja' | 'zh') || 'ko';
        
        const aiResult = await generateAIResponse(
          scenarioWithUserDifficulty as any,
          [],
          persona,
          undefined,
          userLanguage
        );

        // ✨ 새로운 구조: chat_messages에 첫 AI 메시지 저장
        await storage.createChatMessage({
          personaRunId: personaRun.id,
          sender: "ai",
          message: aiResult.content,
          turnIndex: 0,
          emotion: aiResult.emotion || null,
          emotionReason: aiResult.emotionReason || null
        });
        
        // ✨ actualStartedAt 업데이트 (첫 AI 응답 생성 시점)
        await storage.updatePersonaRun(personaRun.id, {
          actualStartedAt: new Date()
        });
        
        console.log(`💬 첫 AI 메시지 생성 완료`);

        // 레거시 호환성을 위해 conversations 구조로 반환
        res.json({
          id: personaRun.id,
          scenarioRunId: scenarioRun.id,
          scenarioId: validatedData.scenarioId,
          scenarioName: validatedData.scenarioName,
          personaId,
          personaSnapshot: validatedData.personaSnapshot,
          messages: [{
            sender: "ai",
            message: aiResult.content,
            timestamp: new Date().toISOString(),
            emotion: aiResult.emotion,
            emotionReason: aiResult.emotionReason
          }],
          turnCount: 0,
          status: 'active',
          mode: validatedData.mode,
          difficulty: validatedData.difficulty,
          userId,
          createdAt: scenarioRun.startedAt,
          updatedAt: scenarioRun.startedAt
        });
      } catch (aiError) {
        console.error("AI 초기 메시지 생성 실패:", aiError);
        // AI 메시지 생성 실패해도 대화는 생성되도록 함
        res.json({
          id: personaRun.id,
          scenarioRunId: scenarioRun.id,
          scenarioId: validatedData.scenarioId,
          scenarioName: validatedData.scenarioName,
          personaId,
          personaSnapshot: validatedData.personaSnapshot,
          messages: [],
          turnCount: 0,
          status: 'active',
          mode: validatedData.mode,
          difficulty: validatedData.difficulty,
          userId,
          createdAt: scenarioRun.startedAt,
          updatedAt: scenarioRun.startedAt
        });
      }
    } catch (error) {
      console.error("대화 생성 오류:", error);
      res.status(400).json({ error: "Invalid conversation data" });
    }
  });

  // Get all conversations for the current user
  app.get("/api/conversations", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      
      const conversations = await storage.getUserConversations(userId);
      res.json(conversations);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  // Get conversation by ID (persona_run 구조)
  app.get("/api/conversations/:id", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      const personaRunId = req.params.id;

      // ✨ 새로운 구조: persona_run 조회
      const personaRun = await storage.getPersonaRun(personaRunId);
      if (!personaRun) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      // ✨ scenario_run 조회하여 권한 확인 (관리자/운영자는 모든 대화 열람 가능)
      const scenarioRun = await storage.getScenarioRun(personaRun.scenarioRunId);
      const requestUser = req.user as any;
      const isAdminOrOperator = requestUser?.role === 'admin' || requestUser?.role === 'operator';
      if (!scenarioRun || (!isAdminOrOperator && scenarioRun.userId !== userId)) {
        return res.status(403).json({ error: "Unauthorized access" });
      }

      // ✨ chat_messages 조회
      const chatMessages = await storage.getChatMessagesByPersonaRun(personaRunId);

      // 레거시 conversations 구조로 변환하여 반환 (GET /api/conversations/:id)
      const messages = chatMessages.map(msg => ({
        sender: msg.sender,
        message: msg.message,
        timestamp: msg.createdAt.toISOString(),
        emotion: msg.emotion,
        emotionReason: msg.emotionReason
      }));

      res.json({
        id: personaRun.id,
        scenarioRunId: scenarioRun.id, // scenarioRunId 추가
        scenarioId: scenarioRun.scenarioId,
        scenarioName: scenarioRun.scenarioName,
        personaId: personaRun.personaId,
        personaSnapshot: personaRun.personaSnapshot,
        messages,
        turnCount: personaRun.turnCount,
        status: personaRun.status,
        mode: personaRun.mode || scenarioRun.mode, // personaRun에서 먼저 가져오기
        difficulty: personaRun.difficulty || scenarioRun.difficulty, // personaRun에서 먼저 가져오기
        userId: scenarioRun.userId,
        createdAt: personaRun.startedAt,
        updatedAt: personaRun.completedAt || personaRun.startedAt
      });
    } catch (error) {
      console.error("대화 조회 오류:", error);
      res.status(500).json({ error: "Failed to fetch conversation" });
    }
  });

  // Delete conversation by ID (시나리오 세션 단위 삭제)
  app.delete("/api/conversations/:id", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      const result = await verifyConversationOwnership(req.params.id, userId);
      
      if ('error' in result) {
        return res.status(result.status).json({ error: result.error });
      }
      
      const sessionConversation = result.conversation;
      const conversationOrder = sessionConversation.conversationOrder || [];
      
      // conversationOrder가 있는 경우, 연관된 모든 페르소나 대화도 삭제
      if (conversationOrder.length > 0) {
        console.log(`시나리오 세션 삭제: ${req.params.id}, 연관 페르소나: ${conversationOrder.length}개`);
        
        const sessionTime = new Date(sessionConversation.createdAt).getTime();
        const TIME_WINDOW = 24 * 60 * 60 * 1000; // 24시간
        const allConversations = await storage.getUserConversations(userId);
        
        // conversationOrder에 있는 personaId와 매칭되는 페르소나 대화 찾기
        // 안전성을 위해 여러 조건 확인:
        // 1. 같은 scenarioId
        // 2. personaId가 conversationOrder에 있음
        // 3. status가 'completed'
        // 4. 세션 대화 이전에 생성됨 (페르소나 대화가 먼저 완료되고 세션이 생성됨)
        // 5. 세션과 시간이 너무 멀지 않음 (24시간 이내)
        // 6. 세션 자체가 아님 (중복 삭제 방지)
        const personaConversationsToDelete = allConversations.filter(c => {
          if (c.id === req.params.id) return false; // 세션 자체 제외
          
          const convTime = new Date(c.createdAt).getTime();
          const isWithinTimeWindow = Math.abs(sessionTime - convTime) < TIME_WINDOW;
          const isBeforeSession = convTime <= sessionTime;
          
          return c.scenarioId === sessionConversation.scenarioId &&
            conversationOrder.includes(c.personaId) &&
            c.status === 'completed' &&
            isBeforeSession &&
            isWithinTimeWindow;
        });
        
        // 중복 제거 (같은 personaId가 여러 번 있을 수 있으므로 최신 것만 선택)
        const personaConversationsByPersona = new Map<string, any>();
        for (const conv of personaConversationsToDelete) {
          const existing = personaConversationsByPersona.get(conv.personaId);
          if (!existing || new Date(conv.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
            personaConversationsByPersona.set(conv.personaId, conv);
          }
        }
        
        // 식별된 페르소나 대화들 삭제
        for (const [personaId, personaConversation] of personaConversationsByPersona) {
          console.log(`  - 페르소나 대화 삭제: ${personaConversation.id} (${personaId})`);
          try {
            await storage.deleteConversation(personaConversation.id);
          } catch (err) {
            console.error(`    페르소나 대화 삭제 실패: ${personaConversation.id}`, err);
            // 계속 진행 (다른 대화들도 삭제 시도)
          }
        }
        
        console.log(`  총 ${personaConversationsByPersona.size}개의 페르소나 대화 삭제 완료`);
      } else {
        console.log(`단일 대화 삭제: ${req.params.id}`);
      }
      
      // 세션 대화 자체 삭제
      await storage.deleteConversation(req.params.id);
      
      res.json({ success: true, message: "대화가 삭제되었습니다." });
    } catch (error) {
      console.error("대화 삭제 오류:", error);
      res.status(500).json({ error: "Failed to delete conversation" });
    }
  });

  // Send message and get AI response (새 구조: persona_runs + chat_messages)
  app.post("/api/conversations/:id/messages", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      const personaRunId = req.params.id;
      
      // ✨ 새 구조: persona_run 권한 확인
      const ownershipResult = await verifyPersonaRunOwnership(personaRunId, userId);
      
      if ('error' in ownershipResult) {
        return res.status(ownershipResult.status).json({ error: ownershipResult.error });
      }

      const { personaRun, scenarioRun } = ownershipResult;

      const { message } = req.body;
      if (typeof message !== "string") {
        return res.status(400).json({ error: "Message must be a string" });
      }
      
      // 빈 메시지는 건너뛰기 기능으로 허용
      const isSkipTurn = message.trim() === "";

      if (personaRun.status === "completed") {
        return res.status(400).json({ error: "Conversation already completed" });
      }

      // ✨ 새 구조: chat_messages에서 기존 메시지 조회
      const existingMessages = await storage.getChatMessagesByPersonaRun(personaRunId);
      const currentTurnIndex = Math.floor(existingMessages.length / 2); // user + ai = 1 turn

      // ✨ 대화 재개 감지: 마지막 메시지 이후 5분 이상 지났으면 actualStartedAt 업데이트
      if (existingMessages.length > 0) {
        const lastMessage = existingMessages[existingMessages.length - 1];
        const timeSinceLastMessage = Date.now() - new Date(lastMessage.createdAt).getTime();
        const RESUME_THRESHOLD_MS = 5 * 60 * 1000; // 5분
        
        if (timeSinceLastMessage > RESUME_THRESHOLD_MS) {
          console.log(`🔄 대화 재개 감지: ${Math.floor(timeSinceLastMessage / 1000 / 60)}분 경과, actualStartedAt 업데이트`);
          await storage.updatePersonaRun(personaRunId, {
            actualStartedAt: new Date()
          });
        }
      }

      // 건너뛰기가 아닌 경우에만 사용자 메시지 추가
      if (!isSkipTurn) {
        await storage.createChatMessage({
          personaRunId,
          sender: "user",
          message,
          turnIndex: currentTurnIndex
        });
      }

      const newTurnCount = personaRun.turnCount + 1;

      // Generate AI response
      const personaId = personaRun.personaId;

      // ── 자유 대화 vs 시나리오 대화 분기 ────────────────────────────────────
      let persona: any;
      let scenarioWithUserDifficulty: any;

      if (scenarioRun.scenarioId === "__free_chat__") {
        // 자유 대화: personaRun.personaSnapshot에서 페르소나 구성
        const snapshot = personaRun.personaSnapshot as any || {};
        persona = buildFreeChatPersona(snapshot);
        scenarioWithUserDifficulty = buildFreeChatScenario(snapshot, personaRun.difficulty || scenarioRun.difficulty || 2);
      } else if (scenarioRun.scenarioId?.startsWith("__user_persona__:")) {
        // 사용자 제작 페르소나 대화
        const userPersonaId = scenarioRun.scenarioId.split(":")[1];
        const userPersonaData = await storage.getUserPersonaById(userPersonaId);
        if (!userPersonaData) throw new Error(`UserPersona not found: ${userPersonaId}`);
        const p = userPersonaData.personality as any || {};
        persona = {
          id: userPersonaData.id,
          name: userPersonaData.name,
          role: "대화 상대",
          department: "",
          mbti: "",
          gender: "neutral",
          image: userPersonaData.avatarUrl || undefined,
          personality: {
            traits: p.traits || [],
            communicationStyle: p.communicationStyle || "",
            motivation: p.background || "",
            fears: [],
          },
          rawPersonality: p,
          description: userPersonaData.description,
          greeting: userPersonaData.greeting,
        };
        scenarioWithUserDifficulty = {
          id: `__user_persona__:${userPersonaData.id}`,
          title: `${userPersonaData.name}와의 대화`,
          description: userPersonaData.description,
          context: {
            situation: userPersonaData.description || "자유로운 대화 상황",
            timeline: "현재",
            stakes: "자유 대화",
            playerRole: { position: "대화 참여자", department: "", experience: "", responsibility: "편하게 대화하기" },
          },
          objectives: ["자유롭게 대화하기"],
          personas: [],
          difficulty: personaRun.difficulty || scenarioRun.difficulty || 2,
          successCriteria: { optimal: "자연스러운 대화", good: "적극적인 소통", acceptable: "기본 대화 유지", failure: "대화 거부" },
          _userPersonaMode: true,
          _userPersonaSystemPrompt: `당신은 "${userPersonaData.name}"라는 AI 캐릭터입니다.

${userPersonaData.description ? `캐릭터 설명: ${userPersonaData.description}` : ""}
${p.background ? `배경: ${p.background}` : ""}
${p.traits?.length ? `성격 특성: ${p.traits.join(", ")}` : ""}
${p.communicationStyle ? `대화 방식: ${p.communicationStyle}` : ""}
${p.speechStyle ? `말투: ${p.speechStyle}` : ""}

위 캐릭터로서 자연스럽게 대화하세요. 캐릭터의 성격, 말투, 배경을 일관되게 유지하세요.
사용자와 자유롭게 대화하고, 사용자가 묻는 것에 캐릭터에 맞게 답변하세요.`,
        };
      } else {
        // 시나리오 기반 대화: 기존 로직
        const scenarios = await fileManager.getAllScenarios();
        const scenarioObj = scenarios.find(s => s.id === scenarioRun.scenarioId);
        if (!scenarioObj) throw new Error(`Scenario not found: ${scenarioRun.scenarioId}`);

        const scenarioPersona: any = scenarioObj.personas.find((p: any) => p.id === personaId);
        if (!scenarioPersona) throw new Error(`Persona not found in scenario: ${personaId}`);

        const mbtiType = scenarioPersona.personaRef?.replace('.json', '');
        const mbtiPersonaData: any = mbtiType ? await fileManager.getPersonaByMBTI(mbtiType) : null;

        persona = {
          id: scenarioPersona.id,
          name: scenarioPersona.name,
          role: scenarioPersona.position,
          department: scenarioPersona.department,
          personality: mbtiPersonaData?.communication_style || '균형 잡힌 의사소통',
          responseStyle: mbtiPersonaData?.communication_patterns?.opening_style || '상황에 맞는 방식으로 대화 시작',
          goals: mbtiPersonaData?.communication_patterns?.win_conditions || ['목표 달성'],
          background: mbtiPersonaData?.background?.personal_values?.join(', ') || '전문성'
        };

        scenarioWithUserDifficulty = {
          ...scenarioObj,
          difficulty: personaRun.difficulty || scenarioRun.difficulty
        };
      }
      // ────────────────────────────────────────────────────────────────────────

      // ✨ 메시지를 ConversationMessage 형식으로 변환
      const messagesForAI = (isSkipTurn ? existingMessages : [...existingMessages, {
        id: "temp",
        createdAt: new Date(),
        personaRunId,
        sender: "user" as const,
        message,
        turnIndex: currentTurnIndex,
        emotion: null,
        emotionReason: null
      }]).map(msg => ({
        sender: msg.sender,
        message: msg.message,
        timestamp: (msg.createdAt || new Date()).toISOString(),
        emotion: msg.emotion || undefined,
        emotionReason: msg.emotionReason || undefined
      }));

      // 사용자 언어 설정 가져오기
      const user = await storage.getUser(scenarioRun.userId);
      const userLanguage = (user?.preferredLanguage as 'ko' | 'en' | 'ja' | 'zh') || 'ko';
      
      const aiResult = await generateAIResponse(
        scenarioWithUserDifficulty,
        messagesForAI,
        persona,
        isSkipTurn ? undefined : message,
        userLanguage
      );

      // ✨ 새 구조: AI 메시지를 chat_messages에 저장
      await storage.createChatMessage({
        personaRunId,
        sender: "ai",
        message: aiResult.content,
        turnIndex: currentTurnIndex,
        emotion: aiResult.emotion,
        emotionReason: aiResult.emotionReason
      });

      const isCompleted = newTurnCount >= 3;

      // ✨ 새 구조: persona_run 업데이트
      const updatedPersonaRun = await storage.updatePersonaRun(personaRunId, {
        turnCount: newTurnCount,
        status: isCompleted ? "completed" : "active",
        completedAt: isCompleted ? new Date() : undefined
      });

      // ✨ 모든 페르소나가 완료되었는지 확인하고 시나리오 자동 완료
      if (isCompleted) {
        await checkAndCompleteScenario(personaRun.scenarioRunId);
      }

      // ✨ 업데이트된 메시지 목록 조회
      const updatedMessages = await storage.getChatMessagesByPersonaRun(personaRunId);
      
      // ✨ 응답 형식을 기존과 동일하게 유지 (호환성)
      const messagesInOldFormat = updatedMessages.map(msg => ({
        sender: msg.sender,
        message: msg.message,
        timestamp: (msg.createdAt || new Date()).toISOString(),
        emotion: msg.emotion || undefined,
        emotionReason: msg.emotionReason || undefined
      }));

      res.json({
        conversation: {
          id: personaRunId,
          scenarioId: scenarioRun.scenarioId,
          personaId: personaRun.personaId,
          scenarioName: scenarioRun.scenarioName,
          messages: messagesInOldFormat,
          turnCount: newTurnCount,
          status: updatedPersonaRun.status,
          userId: scenarioRun.userId,
          createdAt: personaRun.startedAt,
          completedAt: updatedPersonaRun.completedAt
        },
        aiResponse: aiResult.content,
        emotion: aiResult.emotion,
        emotionReason: aiResult.emotionReason,
        messages: messagesInOldFormat, // 클라이언트에서 사용
        isCompleted,
      });
    } catch (error) {
      console.error("Message processing error:", error);
      res.status(500).json({ error: "Failed to process message" });
    }
  });

  // 실시간 음성 대화 메시지 일괄 저장 (AI 응답 생성 없이) - 새로운 구조
  app.post("/api/conversations/:id/realtime-messages", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      const personaRunId = req.params.id;

      const { messages } = req.body;
      if (!Array.isArray(messages)) {
        return res.status(400).json({ error: "Messages must be an array" });
      }

      // ✨ 새로운 구조: persona_run 조회
      const personaRun = await storage.getPersonaRun(personaRunId);
      if (!personaRun) {
        return res.status(404).json({ error: "Persona run not found" });
      }

      // ✨ scenario_run 조회하여 권한 확인
      const scenarioRun = await storage.getScenarioRun(personaRun.scenarioRunId);
      if (!scenarioRun || scenarioRun.userId !== userId) {
        return res.status(403).json({ error: "Unauthorized access" });
      }

      // ✨ 새로운 구조: 각 메시지를 chat_messages에 저장
      let turnIndex = 0;
      const existingMessages = await storage.getChatMessagesByPersonaRun(personaRunId);
      turnIndex = existingMessages.length;

      for (const msg of messages) {
        await storage.createChatMessage({
          personaRunId,
          sender: msg.sender,
          message: msg.message,
          turnIndex,
          emotion: msg.emotion || null,
          emotionReason: msg.emotionReason || null,
          interrupted: msg.interrupted || false, // Barge-in 플래그 저장
          createdAt: msg.timestamp ? new Date(msg.timestamp) : undefined
        });
        turnIndex++;
      }

      // 턴 카운트 계산 (사용자 메시지 개수 기반)
      const userMessageCount = messages.filter((msg: any) => msg.sender === 'user').length;

      // ✨ persona_run 상태 업데이트
      await storage.updatePersonaRun(personaRunId, {
        status: 'completed',
        completedAt: new Date()
      });

      // ✨ 모든 페르소나가 완료되었는지 확인하고 시나리오 자동 완료
      await checkAndCompleteScenario(personaRun.scenarioRunId);

      console.log(`✅ Saved ${messages.length} realtime messages to chat_messages (${userMessageCount} user turns), persona_run status: completed`);

      // 레거시 호환성을 위한 응답
      res.json({
        conversation: {
          id: personaRunId,
          status: 'completed'
        },
        messagesSaved: messages.length,
        turnCount: userMessageCount,
      });
    } catch (error) {
      console.error("Realtime messages save error:", error);
      res.status(500).json({ error: "Failed to save realtime messages" });
    }
  });

  // 대화 초기화 API - 메시지 삭제 및 상태 리셋
  app.delete("/api/conversations/:id/messages", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      const personaRunId = req.params.id;

      // persona_run 조회
      const personaRun = await storage.getPersonaRun(personaRunId);
      if (!personaRun) {
        return res.status(404).json({ error: "Persona run not found" });
      }

      // scenario_run 조회하여 권한 확인
      const scenarioRun = await storage.getScenarioRun(personaRun.scenarioRunId);
      if (!scenarioRun || scenarioRun.userId !== userId) {
        return res.status(403).json({ error: "Unauthorized access" });
      }

      // 메시지 삭제
      await storage.deleteChatMessagesByPersonaRun(personaRunId);

      // persona_run 상태를 'in_progress'로 리셋
      await storage.updatePersonaRun(personaRunId, {
        status: 'in_progress',
        completedAt: null
      });

      console.log(`🔄 Reset conversation: deleted messages and reset persona_run ${personaRunId} to in_progress`);

      res.json({
        success: true,
        message: "Conversation reset successfully"
      });
    } catch (error) {
      console.error("Conversation reset error:", error);
      res.status(500).json({ error: "Failed to reset conversation" });
    }
  });

  // Strategic Selection APIs
  
  // Persona Selection APIs
  app.post("/api/conversations/:id/persona-selections", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      const { id } = req.params;
      const ownershipResult = await verifyConversationOwnership(id, userId);
      
      if ('error' in ownershipResult) {
        return res.status(ownershipResult.status).json({ error: ownershipResult.error });
      }
      
      // Validate selection data using Zod schema
      const validationResult = insertPersonaSelectionSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          error: "Invalid selection data", 
          details: validationResult.error.issues 
        });
      }
      
      const conversation = await storage.addPersonaSelection(id, validationResult.data);
      res.json({ success: true, conversation });
    } catch (error) {
      console.error("Error adding persona selection:", error);
      res.status(500).json({ error: "Failed to add persona selection" });
    }
  });
  
  app.get("/api/conversations/:id/persona-selections", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      const { id } = req.params;
      const ownershipResult = await verifyConversationOwnership(id, userId);
      
      if ('error' in ownershipResult) {
        return res.status(ownershipResult.status).json({ error: ownershipResult.error });
      }
      
      const selections = await storage.getPersonaSelections(id);
      res.json(selections);
    } catch (error) {
      console.error("Error getting persona selections:", error);
      res.status(500).json({ error: "Failed to get persona selections" });
    }
  });

  // 순차 계획 전체를 한번에 저장하는 엔드포인트
  app.post("/api/conversations/:id/sequence-plan", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      const { id } = req.params;
      const ownershipResult = await verifyConversationOwnership(id, userId);
      
      if ('error' in ownershipResult) {
        return res.status(ownershipResult.status).json({ error: ownershipResult.error });
      }
      
      // Check if conversation exists first
      const existingConversation = await storage.getConversation(id);
      if (!existingConversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }
      
      // Validate sequence plan data
      const { sequencePlan, conversationType } = req.body;
      if (!Array.isArray(sequencePlan)) {
        return res.status(400).json({ error: "sequencePlan must be an array" });
      }
      
      // Validate each selection in the plan
      for (const selection of sequencePlan) {
        const validationResult = insertPersonaSelectionSchema.safeParse(selection);
        if (!validationResult.success) {
          return res.status(400).json({ 
            error: "Invalid selection in sequence plan", 
            details: validationResult.error.issues 
          });
        }
      }
      
      // Update conversation with sequence plan
      const conversation = await storage.updateConversation(id, {
        personaSelections: sequencePlan,
        conversationType: conversationType || 'sequential',
        totalPhases: sequencePlan.length
      });
      
      res.json({ success: true, conversation });
    } catch (error) {
      console.error("Error saving sequence plan:", error);
      res.status(500).json({ error: "Failed to save sequence plan" });
    }
  });
  
  // Strategy Choice APIs
  app.post("/api/conversations/:id/strategy-choices", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      const { id } = req.params;
      const ownershipResult = await verifyConversationOwnership(id, userId);
      
      if ('error' in ownershipResult) {
        return res.status(ownershipResult.status).json({ error: ownershipResult.error });
      }
      
      // Validate choice data using Zod schema
      const validationResult = insertStrategyChoiceSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          error: "Invalid strategy choice data", 
          details: validationResult.error.issues 
        });
      }
      
      const conversation = await storage.addStrategyChoice(id, validationResult.data);
      res.json({ success: true, conversation });
    } catch (error) {
      console.error("Error adding strategy choice:", error);
      res.status(500).json({ error: "Failed to add strategy choice" });
    }
  });
  
  app.get("/api/conversations/:id/strategy-choices", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      const { id } = req.params;
      const ownershipResult = await verifyConversationOwnership(id, userId);
      
      if ('error' in ownershipResult) {
        return res.status(ownershipResult.status).json({ error: ownershipResult.error });
      }
      
      const choices = await storage.getStrategyChoices(id);
      res.json(choices);
    } catch (error) {
      console.error("Error getting strategy choices:", error);
      res.status(500).json({ error: "Failed to get strategy choices" });
    }
  });
  
  // Sequence Analysis APIs
  app.post("/api/conversations/:id/sequence-analysis", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      const { id } = req.params;
      const ownershipResult = await verifyConversationOwnership(id, userId);
      
      if ('error' in ownershipResult) {
        return res.status(ownershipResult.status).json({ error: ownershipResult.error });
      }
      
      // Check if conversation exists first
      const existingConversation = await storage.getConversation(id);
      if (!existingConversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }
      
      // Validate analysis data using Zod schema
      const validationResult = insertSequenceAnalysisSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({ 
          error: "Invalid sequence analysis data", 
          details: validationResult.error.issues 
        });
      }
      
      const conversation = await storage.saveSequenceAnalysis(id, validationResult.data);
      res.json({ success: true, conversation });
    } catch (error) {
      console.error("Error saving sequence analysis:", error);
      res.status(500).json({ error: "Failed to save sequence analysis" });
    }
  });
  
  app.get("/api/conversations/:id/sequence-analysis", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      const { id } = req.params;
      const ownershipResult = await verifyConversationOwnership(id, userId);
      
      if ('error' in ownershipResult) {
        return res.status(ownershipResult.status).json({ error: ownershipResult.error });
      }
      
      const analysis = await storage.getSequenceAnalysis(id);
      
      if (!analysis) {
        return res.status(404).json({ error: "Sequence analysis not found" });
      }
      
      res.json(analysis);
    } catch (error) {
      console.error("Error getting sequence analysis:", error);
      res.status(500).json({ error: "Failed to get sequence analysis" });
    }
  });

  // Strategy Reflection API - 사용자의 전략 회고 저장
  app.post("/api/conversations/:id/strategy-reflection", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      const { id } = req.params;
      const ownershipResult = await verifyConversationOwnership(id, userId);
      
      if ('error' in ownershipResult) {
        return res.status(ownershipResult.status).json({ error: ownershipResult.error });
      }

      const { strategyReflection, conversationOrder } = req.body;
      
      if (!strategyReflection || typeof strategyReflection !== 'string') {
        return res.status(400).json({ error: "Strategy reflection text is required" });
      }
      
      if (!Array.isArray(conversationOrder)) {
        return res.status(400).json({ error: "Conversation order must be an array" });
      }
      
      // 빈 문자열이나 유효하지 않은 ID 검증
      if (conversationOrder.some(id => typeof id !== 'string' || id.trim() === '')) {
        return res.status(400).json({ error: "All conversation order IDs must be non-empty strings" });
      }
      
      const existingConversation = await storage.getConversation(id);
      if (!existingConversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }
      
      const conversation = await storage.saveStrategyReflection(
        id,
        strategyReflection,
        conversationOrder
      );
      
      res.json({ success: true, conversation });
    } catch (error) {
      console.error("Error saving strategy reflection:", error);
      res.status(500).json({ error: "Failed to save strategy reflection" });
    }
  });

  // Get all feedbacks for the current user
  app.get("/api/feedbacks", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      
      const feedbacks = await storage.getUserFeedbacks(userId);
      res.json(feedbacks);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch feedbacks" });
    }
  });

  // 새로운 데이터 구조: Scenario Runs API
  // Get all scenario runs for the current user (with persona runs)
  app.get("/api/scenario-runs", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      
      // ✨ 개선: personaRuns와 함께 조회하여 프론트엔드에서 추가 쿼리 불필요
      const scenarioRunsWithPersonas = await storage.getUserScenarioRunsWithPersonaRuns(userId);
      
      // 시나리오 삭제 상태 확인하여 추가
      const scenarioIds = [...new Set(scenarioRunsWithPersonas.map(sr => sr.scenarioId))];
      const deletedScenarioIds = new Set<string>();
      for (const scenarioId of scenarioIds) {
        const scenario = await storage.getScenario(scenarioId);
        if (!scenario || scenario.isDeleted) {
          deletedScenarioIds.add(scenarioId);
        }
      }
      
      const enrichedRuns = scenarioRunsWithPersonas.map(sr => ({
        ...sr,
        isScenarioDeleted: deletedScenarioIds.has(sr.scenarioId),
      }));
      
      console.log(`📊 Scenario runs for user ${userId}:`, enrichedRuns.map(sr => ({
        id: sr.id,
        scenarioId: sr.scenarioId,
        status: sr.status,
        isScenarioDeleted: sr.isScenarioDeleted,
        personaRunsCount: sr.personaRuns?.length || 0,
        personaRuns: sr.personaRuns?.map(pr => ({ id: pr.id, personaId: pr.personaId, status: pr.status, score: pr.score }))
      })));
      res.json(enrichedRuns);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch scenario runs" });
    }
  });

  // Get scenario run with all persona runs
  app.get("/api/scenario-runs/:id", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      const scenarioRun = await storage.getScenarioRunWithPersonaRuns(req.params.id);
      
      if (!scenarioRun) {
        return res.status(404).json({ error: "Scenario run not found" });
      }
      
      // 권한 확인
      if (scenarioRun.userId !== userId) {
        return res.status(403).json({ error: "Unauthorized" });
      }
      
      res.json(scenarioRun);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch scenario run" });
    }
  });

  // Complete a scenario run
  app.post("/api/scenario-runs/:id/complete", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      const { id } = req.params;
      
      const scenarioRun = await storage.getScenarioRun(id);
      if (!scenarioRun) {
        return res.status(404).json({ error: "Scenario run not found" });
      }
      
      if (scenarioRun.userId !== userId) {
        return res.status(403).json({ error: "Unauthorized" });
      }
      
      const updated = await storage.updateScenarioRun(id, {
        status: 'completed',
        completedAt: new Date()
      });
      
      res.json({ success: true, scenarioRun: updated });
    } catch (error) {
      console.error("Error completing scenario run:", error);
      res.status(500).json({ error: "Failed to complete scenario run" });
    }
  });

  // Strategy Reflection API for Scenario Runs
  app.post("/api/scenario-runs/:id/strategy-reflection", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      const { id } = req.params;
      const { strategyReflection, conversationOrder } = req.body;
      
      if (!strategyReflection || typeof strategyReflection !== 'string') {
        return res.status(400).json({ error: "Strategy reflection text is required" });
      }
      
      if (!Array.isArray(conversationOrder)) {
        return res.status(400).json({ error: "Conversation order must be an array" });
      }
      
      const scenarioRun = await storage.getScenarioRun(id);
      if (!scenarioRun) {
        return res.status(404).json({ error: "Scenario run not found" });
      }
      
      if (scenarioRun.userId !== userId) {
        return res.status(403).json({ error: "Unauthorized" });
      }
      
      // 시나리오 정보 가져오기
      const scenarios = await fileManager.getAllScenarios();
      const scenario = scenarios.find(s => s.id === scenarioRun.scenarioId);
      
      let sequenceAnalysis = null;
      
      // 사용자 언어 설정 가져오기
      const strategyUser = await storage.getUser(userId);
      const strategyUserLanguage = (strategyUser?.preferredLanguage as 'ko' | 'en' | 'ja' | 'zh') || 'ko';
      
      if (scenario) {
        // AI 평가 생성
        const evaluation = await generateStrategyReflectionFeedback(
          strategyReflection,
          conversationOrder,
          {
            title: scenario.title,
            context: scenario.context?.situation || scenario.description || '',
            objectives: scenario.objectives || [],
            personas: (scenario.personas || []).map((p: any) => ({
              id: p.id,
              name: p.name,
              role: p.role,
              department: p.department || ''
            }))
          },
          strategyUserLanguage
        );
        
        // sequenceAnalysis 형식으로 변환
        sequenceAnalysis = {
          strategicScore: evaluation.strategicScore,
          strategicRationale: evaluation.strategicRationale,
          sequenceEffectiveness: evaluation.sequenceEffectiveness,
          alternativeApproaches: evaluation.alternativeApproaches,
          strategicInsights: evaluation.strategicInsights,
          strengths: evaluation.strengths,
          improvements: evaluation.improvements
        };
      }
      
      // 전략 회고 저장과 동시에 scenario_run 완료 처리 (sequenceAnalysis 포함)
      const updated = await storage.updateScenarioRun(id, {
        strategyReflection,
        conversationOrder,
        sequenceAnalysis,
        status: 'completed',
        completedAt: new Date()
      });
      
      res.json({ success: true, scenarioRun: updated, sequenceAnalysis });
    } catch (error) {
      console.error("Error saving strategy reflection:", error);
      res.status(500).json({ error: "Failed to save strategy reflection" });
    }
  });

  // Get persona runs for a scenario run
  app.get("/api/scenario-runs/:id/persona-runs", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      const scenarioRun = await storage.getScenarioRun(req.params.id);
      
      if (!scenarioRun) {
        return res.status(404).json({ error: "Scenario run not found" });
      }
      
      if (scenarioRun.userId !== userId) {
        return res.status(403).json({ error: "Unauthorized" });
      }
      
      const personaRuns = await storage.getPersonaRunsByScenarioRun(req.params.id);
      res.json(personaRuns);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch persona runs" });
    }
  });

  // Get chat messages for a persona run
  app.get("/api/persona-runs/:id/messages", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      const personaRun = await storage.getPersonaRun(req.params.id);
      
      if (!personaRun) {
        return res.status(404).json({ error: "Persona run not found" });
      }
      
      // 권한 확인: persona run의 scenario run이 현재 사용자 소유인지 확인
      const scenarioRun = await storage.getScenarioRun(personaRun.scenarioRunId);
      if (!scenarioRun || scenarioRun.userId !== userId) {
        return res.status(403).json({ error: "Unauthorized" });
      }
      
      const messages = await storage.getChatMessagesByPersonaRun(req.params.id);
      res.json(messages);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch chat messages" });
    }
  });

  // Delete scenario run (cascade deletes persona_runs and chat_messages)
  app.delete("/api/scenario-runs/:id", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      const scenarioRun = await storage.getScenarioRun(req.params.id);
      
      if (!scenarioRun) {
        return res.status(404).json({ error: "Scenario run not found" });
      }
      
      if (scenarioRun.userId !== userId) {
        return res.status(403).json({ error: "Unauthorized" });
      }
      
      await storage.deleteScenarioRun(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting scenario run:", error);
      res.status(500).json({ error: "Failed to delete scenario run" });
    }
  });

  // Generate feedback for completed conversation (persona_run 구조)
  app.post("/api/conversations/:id/feedback", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      const personaRunId = req.params.id;
      console.log(`피드백 생성 요청: ${personaRunId}`);
      
      // ✨ persona_run 조회
      const personaRun = await storage.getPersonaRun(personaRunId);
      if (!personaRun) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      // ✨ scenario_run 조회하여 권한 확인 (관리자/운영자는 모든 피드백 생성 가능)
      const scenarioRun = await storage.getScenarioRun(personaRun.scenarioRunId);
      const feedbackReqUser = req.user as any;
      const isFeedbackAdminOrOp = feedbackReqUser?.role === 'admin' || feedbackReqUser?.role === 'operator';
      if (!scenarioRun || (!isFeedbackAdminOrOp && scenarioRun.userId !== userId)) {
        return res.status(403).json({ error: "Unauthorized access" });
      }

      // ✨ chat_messages 조회
      const chatMessages = await storage.getChatMessagesByPersonaRun(personaRunId);

      // 레거시 conversation 구조로 변환
      const conversation = {
        id: personaRun.id,
        scenarioId: scenarioRun.scenarioId,
        scenarioName: scenarioRun.scenarioName,
        personaId: personaRun.personaId,
        personaSnapshot: personaRun.personaSnapshot,
        messages: chatMessages.map(msg => ({
          sender: msg.sender,
          message: msg.message,
          timestamp: msg.createdAt.toISOString(),
          emotion: msg.emotion,
          emotionReason: msg.emotionReason
        })),
        turnCount: personaRun.turnCount,
        status: personaRun.status,
        mode: scenarioRun.mode,
        difficulty: scenarioRun.difficulty,
        createdAt: personaRun.startedAt,
        completedAt: personaRun.completedAt
      };

      console.log(`대화 상태: ${conversation.status}, 턴 수: ${conversation.turnCount}, 모드: ${conversation.mode}`);

      // 실시간 음성 대화는 status가 completed이면 피드백 생성 허용 (턴 카운트 체크 제외)
      // 텍스트/TTS 모드는 기존 로직 유지 (completed 또는 3턴 이상)
      const isRealtimeVoice = conversation.mode === 'realtime_voice';
      const isCompleted = conversation.status === "completed";
      const hasEnoughTurns = conversation.turnCount >= 3;
      
      if (!isCompleted && !hasEnoughTurns && !isRealtimeVoice) {
        console.log("대화가 아직 완료되지 않음 (텍스트/TTS 모드)");
        return res.status(400).json({ error: "Conversation not completed yet" });
      }
      
      // 실시간 음성 모드에서 completed가 아닌 경우도 체크
      if (isRealtimeVoice && !isCompleted) {
        console.log("실시간 음성 대화가 아직 완료되지 않음");
        return res.status(400).json({ error: "Realtime voice conversation not completed yet" });
      }

      // Check if feedback already exists
      const forceRegenerate = req.body?.force === true;
      const existingFeedback = await storage.getFeedbackByConversationId(req.params.id);
      if (existingFeedback && !forceRegenerate) {
        console.log("기존 피드백 발견, 반환");
        return res.json(existingFeedback);
      }
      
      if (existingFeedback && forceRegenerate) {
        console.log("🔄 피드백 강제 재생성 요청 - 기존 피드백 삭제");
        await storage.deleteFeedback(existingFeedback.id);
      }

      console.log("새 피드백 생성 시작");
      // Generate new feedback
      const personaId = conversation.personaId || conversation.scenarioId;
      
      // 시나리오 객체 로드 먼저
      const scenarios = await fileManager.getAllScenarios();
      const scenarioObj = scenarios.find(s => s.id === conversation.scenarioId);
      if (!scenarioObj) {
        throw new Error(`Scenario not found: ${conversation.scenarioId}`);
      }
      
      // 시나리오에서 해당 페르소나 객체 찾기
      const scenarioPersona: any = scenarioObj.personas.find((p: any) => p.id === personaId);
      if (!scenarioPersona) {
        throw new Error(`Persona not found in scenario: ${personaId}`);
      }
      
      // ⚡ 최적화: 특정 MBTI 유형만 로드 (전체 로드 대신)
      const mbtiType = scenarioPersona.personaRef?.replace('.json', '');
      const mbtiPersona: any = mbtiType ? await fileManager.getPersonaByMBTI(mbtiType) : null;
      
      // 시나리오 정보와 MBTI 특성 결합
      const persona = {
        id: scenarioPersona.id,
        name: scenarioPersona.name,
        role: scenarioPersona.position,
        department: scenarioPersona.department,
        personality: mbtiPersona?.communication_style || '균형 잡힌 의사소통',
        responseStyle: mbtiPersona?.communication_patterns?.opening_style || '상황에 맞는 방식으로 대화 시작',
        goals: mbtiPersona?.communication_patterns?.win_conditions || ['목표 달성'],
        background: mbtiPersona?.background?.personal_values?.join(', ') || '전문성'
      };

      // ✨ 메시지 기반 대화 시간 계산 - 5분 이상 간격은 제외하여 실제 대화 시간만 계산
      const IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5분 = 대화 중단으로 간주
      
      const calculateActualConversationTime = (messages: any[]): number => {
        if (messages.length < 2) {
          return messages.length > 0 ? 60 : 0; // 최소 1분
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
        
        return Math.floor(totalActiveTime / 1000); // 초 단위로 반환
      };
      
      const conversationDurationSeconds = calculateActualConversationTime(conversation.messages);
      const conversationDuration = Math.floor(conversationDurationSeconds / 60); // 분 단위 (기존 로직 호환성)

      const userMessages = conversation.messages.filter(m => m.sender === 'user');
      const totalUserWords = userMessages.reduce((sum, msg) => sum + msg.message.length, 0);
      const averageResponseTime = userMessages.length > 0 ? Math.round(conversationDurationSeconds / userMessages.length) : 0; // 초 단위

      // 사용자 언어 설정 먼저 가져오기 (번역 적용에 필요)
      const feedbackUser = await storage.getUser(userId);
      const feedbackUserLanguage = (feedbackUser?.preferredLanguage as 'ko' | 'en' | 'ja' | 'zh') || 'ko';

      // ✨ 평가 기준 로드 (시나리오 직접 연결 → 카테고리 → 시스템 기본 순)
      const evaluationCriteria = await loadEvaluationCriteria(scenarioObj, feedbackUserLanguage);
      
      const feedbackData = await generateFeedback(
        scenarioObj, // 전체 시나리오 객체 전달
        conversation.messages,
        persona,
        conversation, // 전략 회고 평가를 위해 conversation 전달
        evaluationCriteria, // ✨ 동적 평가 기준 세트 전달
        feedbackUserLanguage // 사용자 언어 전달
      );

      // 체계적인 시간 성과 평가 시스템
      const timePerformance = (() => {
        // 1. 사용자 발언이 없으면 최하점
        if (userMessages.length === 0 || totalUserWords === 0) {
          return {
            rating: 'slow' as const,
            feedback: '대화 참여 없음 - 시간 평가 불가'
          };
        }

        // 2. 발화 밀도 계산 (분당 글자 수)
        const speechDensity = conversationDuration > 0 ? totalUserWords / conversationDuration : 0;
        
        // 3. 평균 발언 길이
        const avgMessageLength = totalUserWords / userMessages.length;

        // 4. 종합 평가 (발화량과 시간 고려)
        let rating: 'excellent' | 'good' | 'average' | 'slow' = 'slow';
        let feedback = '';

        if (speechDensity >= 30 && avgMessageLength >= 20) {
          // 활발하고 충실한 대화
          rating = conversationDuration <= 10 ? 'excellent' : 'good';
          feedback = `활발한 대화 참여 (밀도: ${speechDensity.toFixed(1)}자/분, 평균: ${avgMessageLength.toFixed(0)}자/발언)`;
        } else if (speechDensity >= 15 && avgMessageLength >= 10) {
          // 보통 수준의 대화
          rating = conversationDuration <= 15 ? 'good' : 'average';
          feedback = `적절한 대화 참여 (밀도: ${speechDensity.toFixed(1)}자/분, 평균: ${avgMessageLength.toFixed(0)}자/발언)`;
        } else if (speechDensity >= 5 && avgMessageLength >= 5) {
          // 소극적이지만 참여한 대화
          rating = 'average';
          feedback = `소극적 참여 (밀도: ${speechDensity.toFixed(1)}자/분, 평균: ${avgMessageLength.toFixed(0)}자/발언)`;
        } else {
          // 매우 소극적인 대화
          rating = 'slow';
          feedback = `매우 소극적 참여 (밀도: ${speechDensity.toFixed(1)}자/분, 평균: ${avgMessageLength.toFixed(0)}자/발언)`;
        }

        return { rating, feedback };
      })();

      // 피드백에 시간 정보 추가
      feedbackData.conversationDuration = conversationDurationSeconds; // 초 단위로 저장
      feedbackData.averageResponseTime = averageResponseTime;
      feedbackData.timePerformance = timePerformance;

      console.log("피드백 데이터 생성 완료:", feedbackData);

      const dimFb = feedbackData.dimensionFeedback || {};
      let evaluationScores: any[];
      
      if (evaluationCriteria && evaluationCriteria.dimensions && evaluationCriteria.dimensions.length > 0) {
        evaluationScores = evaluationCriteria.dimensions.map((dim: any) => ({
          category: dim.key,
          name: dim.name,
          score: feedbackData.scores[dim.key] || 3,
          feedback: dimFb[dim.key] || dim.description || dim.name,
          icon: dim.icon || '📊',
          color: dim.color || '#6366f1',
          weight: dim.weight || 20
        }));
        console.log(`📊 동적 evaluationScores 생성: ${evaluationScores.length}개`);
      } else {
        const defaultDims = [
          { key: 'clarityLogic', name: '명확성 & 논리성', weight: 20, icon: '🎯', color: 'blue', desc: '발언의 구조화, 핵심 전달, 모호성 최소화' },
          { key: 'listeningEmpathy', name: '경청 & 공감', weight: 20, icon: '👂', color: 'green', desc: '재진술·요약, 감정 인식, 우려 존중' },
          { key: 'appropriatenessAdaptability', name: '적절성 & 상황 대응', weight: 20, icon: '⚡', color: 'yellow', desc: '맥락 적합한 표현, 유연한 갈등 대응' },
          { key: 'persuasivenessImpact', name: '설득력 & 영향력', weight: 20, icon: '🎪', color: 'purple', desc: '논리적 근거, 사례 활용, 행동 변화 유도' },
          { key: 'strategicCommunication', name: '전략적 커뮤니케이션', weight: 20, icon: '🎲', color: 'red', desc: '목표 지향적 대화, 협상·조율, 주도성' },
        ];
        evaluationScores = defaultDims.map(dim => ({
          category: dim.key,
          name: dim.name,
          score: feedbackData.scores[dim.key] || 3,
          feedback: dimFb[dim.key] || dim.desc,
          icon: dim.icon,
          color: dim.color,
          weight: dim.weight
        }));
      }

      const verifiedOverallScore = recalculateOverallScore(evaluationScores);
      if (verifiedOverallScore !== feedbackData.overallScore) {
        console.log(`📊 종합 점수 보정: AI=${feedbackData.overallScore} → 가중치 계산=${verifiedOverallScore}`);
        feedbackData.overallScore = verifiedOverallScore;
      }

      const feedback = await storage.createFeedback({
        conversationId: null, // 레거시 지원 (nullable)
        personaRunId: personaRunId, // ✨ 새 구조: persona_run ID 저장
        overallScore: verifiedOverallScore,
        scores: evaluationScores,
        detailedFeedback: feedbackData,
      });

      console.log("피드백 저장 완료");

      // ✨ PersonaRun의 score도 업데이트 (통계 계산용)
      await storage.updatePersonaRun(personaRunId, {
        score: verifiedOverallScore
      });
      console.log(`✅ PersonaRun score updated: ${feedbackData.overallScore}`);

      // ✨ 모든 페르소나가 완료되었는지 확인하고 시나리오 자동 완료
      await checkAndCompleteScenario(personaRun.scenarioRunId);

      // 전략적 선택 분석 수행 (백그라운드 - non-blocking)
      performStrategicAnalysis(req.params.id, conversation, scenarioObj)
        .catch(error => {
          console.error("전략 분석 오류 (무시):", error);
        });

      if (!res.headersSent) {
        res.json(feedback);
      }
    } catch (error) {
      console.error("Feedback generation error:", error);
      if (!res.headersSent) {
        res.status(500).json({ 
          error: "Failed to generate feedback",
          details: error instanceof Error ? error.message : String(error),
          stack: process.env.NODE_ENV === 'development' && error instanceof Error ? error.stack : undefined
        });
      }
    }
  });

  // Get feedback for conversation (persona_run 구조)
  app.get("/api/conversations/:id/feedback", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      const personaRunId = req.params.id;
      
      // ✨ persona_run 조회
      const personaRun = await storage.getPersonaRun(personaRunId);
      if (!personaRun) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      // ✨ scenario_run 조회하여 권한 확인 (관리자/운영자는 모든 피드백 열람 가능)
      const scenarioRun = await storage.getScenarioRun(personaRun.scenarioRunId);
      const reqUser = req.user as any;
      const isAdminOrOp = reqUser?.role === 'admin' || reqUser?.role === 'operator';
      if (!scenarioRun || (!isAdminOrOp && scenarioRun.userId !== userId)) {
        return res.status(403).json({ error: "Unauthorized access" });
      }
      
      const feedback = await storage.getFeedbackByConversationId(personaRunId);
      if (!feedback) {
        return res.status(404).json({ error: "Feedback not found" });
      }
      res.json(feedback);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch feedback" });
    }
  });

  // User Analytics - 사용자 전체 피드백 종합 분석
  app.get("/api/analytics/summary", isAuthenticated, async (req, res) => {
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
      
      console.log(`📊 강점 수집: ${allStrengths.length}개, 개선점 수집: ${allImprovements.length}개`);
      console.log(`📝 강점 내용:`, allStrengths);
      console.log(`📝 개선점 내용:`, allImprovements);
      
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
      
      console.log(`📊 카테고리화된 강점:`, categorizedStrengths);
      console.log(`📊 카테고리화된 개선점:`, categorizedImprovements);
      
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
      console.log(`✅ 최종 강점:`, topStrengths);
      console.log(`✅ 최종 개선점:`, topImprovements);
      
      // 5. 성장 추이 판단 (더 적응적인 알고리즘)
      let progressTrend: 'improving' | 'stable' | 'declining' | 'neutral' = 'neutral';
      if (scoreHistory.length >= 2) {
        // 충분한 데이터가 있으면 최근과 이전 비교
        if (scoreHistory.length >= 6) {
          const recentScores = scoreHistory.slice(-5).map(s => s.score);
          const olderScores = scoreHistory.slice(0, -5).map(s => s.score);
          const recentAvg = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
          const olderAvg = olderScores.reduce((a, b) => a + b, 0) / olderScores.length;
          const difference = recentAvg - olderAvg;
          
          console.log(`📈 성장추세 계산 (6개 이상):`);
          console.log(`  - 최근 5개: ${recentScores.join(', ')} (평균: ${recentAvg.toFixed(1)})`);
          console.log(`  - 이전 점수: ${olderScores.join(', ')} (평균: ${olderAvg.toFixed(1)})`);
          console.log(`  - 차이: ${difference.toFixed(1)}`);
          
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
          const difference = recentAvg - olderAvg;
          
          console.log(`📈 성장추세 계산 (2-5개):`);
          console.log(`  - 전체: ${scoreHistory.map(s => s.score).join(', ')}`);
          console.log(`  - 최근: ${recentScores.join(', ')} (평균: ${recentAvg.toFixed(1)})`);
          console.log(`  - 이전: ${olderScores.join(', ')} (평균: ${olderAvg.toFixed(1)})`);
          console.log(`  - 차이: ${difference.toFixed(1)}`);
          
          if (recentAvg > olderAvg + 1) progressTrend = 'improving';
          else if (recentAvg < olderAvg - 1) progressTrend = 'declining';
          else progressTrend = 'stable';
        }
        console.log(`  ✅ 결과: ${progressTrend}`);
      } else {
        console.log(`📈 성장추세 미계산: 데이터 부족 (${scoreHistory.length}개, 필요: 2개 이상)`);
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
      
      console.log(`📊 Analytics Summary - criteriaDetails: ${criteriaDetails.length} items, usedCriteriaSets: ${usedCriteriaSets.length} sets`);
      console.log(`📊 UsedCriteriaSets:`, JSON.stringify(usedCriteriaSets, null, 2));
      
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
  app.get("/api/admin/analytics/overview", isAuthenticated, async (req: any, res) => {
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
          ? allFeedbacks.filter(f => personaRunIds.has(f.personaRunId))
          : allFeedbacks;
      
      // ✨ 롤플레이 참여 유저 기준으로 지표 계산
      // 롤플레이 참여 = personaRuns가 있는 유저 (시나리오 시작이 아닌 실제 대화)
      
      // 1. 완료된 시나리오 & 페르소나 런 필터링
      const completedScenarioRuns = scenarioRuns.filter(sr => sr.status === "completed");
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
        if (pr.mbtiType) {
          const mbtiKey = pr.mbtiType.toUpperCase();
          acc[mbtiKey] = (acc[mbtiKey] || 0) + 1;
        }
        return acc;
      }, {} as Record<string, number>);
      
      // 9. 완료율 - personaRuns 기준
      const completionRate = totalSessions > 0 
        ? Math.round((completedSessions / totalSessions) * 100)
        : 0;
      
      // ✨ 확장된 지표 (많은 유저 시나리오)
      
      // 10. DAU/WAU/MAU 계산 (캘린더 기준)
      const now = new Date();
      
      // 오늘 시작 (00:00:00)
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      // 이번 주 시작 (일요일 기준)
      const dayOfWeek = now.getDay();
      const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
      
      // 이번 달 시작
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      
      const getDauUsers = () => {
        const userIds = new Set<string>();
        personaRuns.forEach(pr => {
          const scenarioRun = scenarioRuns.find(sr => sr.id === pr.scenarioRunId);
          if (scenarioRun && pr.startedAt && new Date(pr.startedAt) >= startOfToday) {
            userIds.add(scenarioRun.userId);
          }
        });
        return userIds.size;
      };
      
      const getWauUsers = () => {
        const userIds = new Set<string>();
        personaRuns.forEach(pr => {
          const scenarioRun = scenarioRuns.find(sr => sr.id === pr.scenarioRunId);
          if (scenarioRun && pr.startedAt && new Date(pr.startedAt) >= startOfWeek) {
            userIds.add(scenarioRun.userId);
          }
        });
        return userIds.size;
      };
      
      const getMauUsers = () => {
        const userIds = new Set<string>();
        personaRuns.forEach(pr => {
          const scenarioRun = scenarioRuns.find(sr => sr.id === pr.scenarioRunId);
          if (scenarioRun && pr.startedAt && new Date(pr.startedAt) >= startOfMonth) {
            userIds.add(scenarioRun.userId);
          }
        });
        return userIds.size;
      };
      
      const dau = getDauUsers();
      const wau = getWauUsers();
      const mau = getMauUsers();
      
      // 11. 유저당 평균 세션 수
      const sessionsPerUser = activeUsers > 0 
        ? Math.round((totalSessions / activeUsers) * 10) / 10
        : 0;
      
      // 12. 신규 vs 재방문 비율 계산
      const userSessionCounts: Record<string, number> = {};
      personaRuns.forEach(pr => {
        const scenarioRun = scenarioRuns.find(sr => sr.id === pr.scenarioRunId);
        if (scenarioRun) {
          userSessionCounts[scenarioRun.userId] = (userSessionCounts[scenarioRun.userId] || 0) + 1;
        }
      });
      
      const newUsers = Object.values(userSessionCounts).filter(count => count === 1).length;
      const returningUsers = Object.values(userSessionCounts).filter(count => count > 1).length;
      const returningRate = activeUsers > 0 
        ? Math.round((returningUsers / activeUsers) * 100)
        : 0;
      
      // 13. 시나리오별 평균 점수
      const scenarioScores: Record<string, { scores: number[]; name: string }> = {};
      completedFeedbacks.forEach(f => {
        const personaRun = completedPersonaRuns.find(pr => pr.id === f.personaRunId);
        if (personaRun) {
          const scenarioRun = scenarioRuns.find(sr => sr.id === personaRun.scenarioRunId);
          if (scenarioRun) {
            const scenario = scenarios.find(s => s.id === scenarioRun.scenarioId);
            if (!scenarioScores[scenarioRun.scenarioId]) {
              scenarioScores[scenarioRun.scenarioId] = {
                scores: [],
                name: scenario?.title || scenarioRun.scenarioId
              };
            }
            scenarioScores[scenarioRun.scenarioId].scores.push(f.overallScore);
          }
        }
      });
      
      const scenarioAverages = Object.entries(scenarioScores).map(([id, data]) => ({
        id,
        name: data.name,
        averageScore: Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length),
        sessionCount: data.scores.length
      })).sort((a, b) => b.averageScore - a.averageScore);
      
      // 14. MBTI별 평균 점수
      const mbtiScores: Record<string, number[]> = {};
      completedFeedbacks.forEach(f => {
        const personaRun = completedPersonaRuns.find(pr => pr.id === f.personaRunId);
        if (personaRun) {
          // mbtiType이 없으면 personaSnapshot 또는 scenario에서 MBTI 추출
          let mbtiType = personaRun.mbtiType;
          
          if (!mbtiType && personaRun.personaSnapshot) {
            // personaSnapshot에서 mbti 필드 추출
            const snapshot = typeof personaRun.personaSnapshot === 'string' 
              ? JSON.parse(personaRun.personaSnapshot) 
              : personaRun.personaSnapshot;
            mbtiType = snapshot?.mbti || snapshot?.personaId?.toUpperCase();
          }
          
          if (!mbtiType) {
            // scenario의 persona 정보에서 MBTI 추출
            const scenarioRun = scenarioRuns.find(sr => sr.id === personaRun.scenarioRunId);
            if (scenarioRun) {
              const scenario = scenarios.find(s => s.id === scenarioRun.scenarioId);
              // personaId나 personaRef에서 MBTI 추출
              const personaId = (personaRun.personaSnapshot as any)?.personaId || 
                               (personaRun.personaSnapshot as any)?.id;
              if (personaId) {
                mbtiType = personaId.toUpperCase();
              }
            }
          }
          
          if (mbtiType) {
            const mbtiKey = mbtiType.toUpperCase();
            if (!mbtiScores[mbtiKey]) {
              mbtiScores[mbtiKey] = [];
            }
            mbtiScores[mbtiKey].push(f.overallScore);
          }
        }
      });
      
      const mbtiAverages = Object.entries(mbtiScores).map(([mbti, scores]) => ({
        mbti,
        averageScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
        sessionCount: scores.length
      })).sort((a, b) => b.averageScore - a.averageScore);
      
      // 15. Top 활동 유저 (세션 수 기준)
      const topActiveUsers = Object.entries(userSessionCounts)
        .map(([userId, sessionCount]) => ({ userId, sessionCount }))
        .sort((a, b) => b.sessionCount - a.sessionCount)
        .slice(0, 10);
      
      // 16. 가장 인기있는 시나리오 Top 5
      const topScenarios = Object.entries(scenarioStats)
        .map(([id, data]) => ({ id, ...data }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
      
      // 17. 가장 어려운 시나리오 Top 5 (평균 점수 낮은 순)
      const hardestScenarios = scenarioAverages
        .filter(s => s.sessionCount >= 1)
        .sort((a, b) => a.averageScore - b.averageScore)
        .slice(0, 5);
      
      // 18. 난이도별 선택 통계 - scenarioRun의 difficulty 기반
      const difficultyStats = scenarioRuns.reduce((acc, sr) => {
        const level = sr.difficulty || 4;
        acc[level] = (acc[level] || 0) + 1;
        return acc;
      }, {} as Record<number, number>);
      
      const difficultyUsage = [1, 2, 3, 4].map(level => ({
        level,
        count: difficultyStats[level] || 0
      }));
      
      // 19. 마지막 콘텐츠 업데이트 시간 (가장 최근의 personaRun 생성 시간)
      const lastContentUpdate = personaRuns.length > 0 
        ? new Date(Math.max(...personaRuns.map(pr => new Date(pr.startedAt).getTime())))
        : null;
        
      res.json({
        totalSessions,
        completedSessions,
        averageScore,
        completionRate,
        totalUsers,
        activeUsers,
        participationRate,
        scenarioStats,
        mbtiUsage,
        totalScenarios: scenarios.length,
        // 확장 지표
        dau,
        wau,
        mau,
        sessionsPerUser,
        newUsers,
        returningUsers,
        returningRate,
        scenarioAverages,
        mbtiAverages,
        topActiveUsers,
        topScenarios,
        hardestScenarios,
        difficultyUsage,
        lastContentUpdate
      });
    } catch (error) {
      console.error("Error getting analytics overview:", error);
      res.status(500).json({ error: "Failed to get analytics overview" });
    }
  });

  app.get("/api/admin/analytics/performance", isAuthenticated, async (req: any, res) => {
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
          ? allFeedbacks.filter(f => personaRunIds.has(f.personaRunId))
          : allFeedbacks;
      
      // Score distribution - feedbacks에서 직접 계산
      const scoreRanges = {
        excellent: feedbacks.filter(f => f.overallScore >= 90).length,
        good: feedbacks.filter(f => f.overallScore >= 80 && f.overallScore < 90).length,
        average: feedbacks.filter(f => f.overallScore >= 70 && f.overallScore < 80).length,
        needsImprovement: feedbacks.filter(f => f.overallScore >= 60 && f.overallScore < 70).length,
        poor: feedbacks.filter(f => f.overallScore < 60).length
      };
      
      // Category performance analysis - feedbacks에서 직접 계산
      const categoryPerformance = feedbacks.reduce((acc, feedback) => {
        feedback.scores.forEach(score => {
          if (!acc[score.category]) {
            acc[score.category] = { total: 0, count: 0, name: score.name };
          }
          acc[score.category].total += score.score;
          acc[score.category].count += 1;
        });
        return acc;
      }, {} as Record<string, { total: number; count: number; name: string }>);
      
      // Calculate averages
      Object.keys(categoryPerformance).forEach(category => {
        const data = categoryPerformance[category];
        (categoryPerformance[category] as any) = {
          ...data,
          average: Math.round((data.total / data.count) * 100) / 100
        };
      });
      
      // Scenario performance - scenarioRuns & personaRuns 기반 (difficulty는 사용자 선택 난이도 사용)
      const scenarioPerformance: Record<string, { scores: number[]; name: string; difficulties: number[]; personaCount: number }> = {};
      
      for (const run of scenarioRuns.filter(sr => sr.status === "completed")) {
        const scenario = scenarios.find(s => s.id === run.scenarioId);
        const userDifficulty = run.difficulty || 2; // 사용자가 선택한 난이도
        
        // 이 scenarioRun에 속한 personaRuns의 피드백 수집
        const runPersonas = personaRuns.filter(pr => pr.scenarioRunId === run.id);
        for (const pr of runPersonas) {
          const feedback = feedbacks.find(f => f.personaRunId === pr.id);
          if (feedback) {
            if (!scenarioPerformance[run.scenarioId]) {
              scenarioPerformance[run.scenarioId] = {
                scores: [],
                name: scenario?.title || run.scenarioId,
                difficulties: [], // 사용자가 선택한 난이도들 수집
                personaCount: Array.isArray(scenario?.personas) ? scenario.personas.length : 0
              };
            }
            scenarioPerformance[run.scenarioId].scores.push(feedback.overallScore);
            scenarioPerformance[run.scenarioId].difficulties.push(userDifficulty);
          }
        }
      }
      
      // Calculate scenario averages (점수 및 난이도 평균)
      Object.keys(scenarioPerformance).forEach(scenarioId => {
        const scores = scenarioPerformance[scenarioId].scores;
        const difficulties = scenarioPerformance[scenarioId].difficulties;
        (scenarioPerformance[scenarioId] as any) = {
          ...scenarioPerformance[scenarioId],
          average: scores.length > 0 ? Math.round(scores.reduce((acc, score) => acc + score, 0) / scores.length) : 0,
          avgDifficulty: difficulties.length > 0 ? Math.round((difficulties.reduce((acc, d) => acc + d, 0) / difficulties.length) * 10) / 10 : 2,
          sessionCount: scores.length
        };
      });
      
      // MBTI 유형별 성과 분석 - personaRuns 기반
      const mbtiPerformance: Record<string, { scores: number[]; count: number }> = {};
      
      for (const pr of personaRuns.filter(pr => pr.status === "completed")) {
        const feedback = feedbacks.find(f => f.personaRunId === pr.id);
        if (feedback && pr.mbtiType) {
          const mbtiKey = pr.mbtiType.toUpperCase();
          if (!mbtiPerformance[mbtiKey]) {
            mbtiPerformance[mbtiKey] = { scores: [], count: 0 };
          }
          mbtiPerformance[mbtiKey].scores.push(feedback.overallScore);
          mbtiPerformance[mbtiKey].count += 1;
        }
      }
      
      // Calculate MBTI averages
      Object.keys(mbtiPerformance).forEach(mbtiId => {
        const scores = mbtiPerformance[mbtiId].scores;
        (mbtiPerformance[mbtiId] as any) = {
          ...mbtiPerformance[mbtiId],
          average: scores.length > 0 ? Math.round(scores.reduce((acc, score) => acc + score, 0) / scores.length) : 0
        };
      });
      
      // ✨ 강점/개선점 Top 5 집계 (detailedFeedback 내부에서 추출)
      const strengthCounts: Record<string, number> = {};
      const improvementCounts: Record<string, number> = {};
      
      feedbacks.forEach(f => {
        const detailed = f.detailedFeedback;
        if (detailed?.strengths && Array.isArray(detailed.strengths)) {
          detailed.strengths.forEach((s: string) => {
            if (s && s.trim()) {
              strengthCounts[s] = (strengthCounts[s] || 0) + 1;
            }
          });
        }
        if (detailed?.improvements && Array.isArray(detailed.improvements)) {
          detailed.improvements.forEach((i: string) => {
            if (i && i.trim()) {
              improvementCounts[i] = (improvementCounts[i] || 0) + 1;
            }
          });
        }
      });
      
      const topStrengths = Object.entries(strengthCounts)
        .map(([text, count]) => ({ text, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
      
      const topImprovements = Object.entries(improvementCounts)
        .map(([text, count]) => ({ text, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
      
      // ✨ 최고 점수 및 평가 통계
      const allScores = feedbacks.map(f => f.overallScore);
      const highestScore = allScores.length > 0 ? Math.max(...allScores) : 0;
      // 피드백이 있는 personaRuns 수만 계산
      const personaRunsWithFeedback = new Set(feedbacks.map(f => f.personaRunId)).size;
      const feedbackCompletionRate = personaRuns.length > 0 
        ? Math.round((personaRunsWithFeedback / personaRuns.length) * 100)
        : 0;
      const averageScore = allScores.length > 0 
        ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
        : 0;
      
      // ✨ 최근 세션 상세 테이블 (최근 20건)
      const recentSessions = feedbacks
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 20)
        .map(f => {
          const personaRun = personaRuns.find(pr => pr.id === f.personaRunId);
          const scenarioRun = personaRun ? scenarioRuns.find(sr => sr.id === personaRun.scenarioRunId) : null;
          const scenario = scenarioRun ? scenarios.find(s => s.id === scenarioRun.scenarioId) : null;
          
          return {
            id: f.id,
            score: f.overallScore,
            scenarioName: scenario?.title || '알 수 없음',
            mbti: personaRun?.mbtiType?.toUpperCase() || 'N/A',
            userId: scenarioRun?.userId?.slice(0, 8) || 'N/A',
            completedAt: f.createdAt,
            difficulty: scenarioRun?.difficulty || 2
          };
        });
      
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
        totalFeedbacks: feedbacks.length,
        recentSessions
      });
    } catch (error) {
      console.error("Error getting performance analytics:", error);
      res.status(500).json({ error: "Failed to get performance analytics" });
    }
  });

  app.get("/api/admin/analytics/trends", isAuthenticated, async (req: any, res) => {
    try {
      const user = req.user;
      const categoryIdParam = req.query.categoryId as string | undefined;
      
      // ✨ 새 테이블 구조 사용
      const allScenarioRuns = await storage.getAllScenarioRuns();
      const allFeedbacks = await storage.getAllFeedbacks();
      const allScenarios = await fileManager.getAllScenarios();
      const allPersonaRuns = await storage.getAllPersonaRuns();
      
      // 카테고리 필터링 결정 (계층적 권한 지원)
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
          ? allFeedbacks.filter(f => personaRunIds.has(f.personaRunId))
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
  app.get("/api/admin/analytics/emotions", isAuthenticated, async (req: any, res) => {
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
            .map((s: any) => s.id);
        }
      } else if (user.role === 'operator') {
        if (user.assignedCategoryId) {
          scenarioIds = allScenarios
            .filter((s: any) => String(s.categoryId) === String(user.assignedCategoryId))
            .map((s: any) => s.id);
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
  app.get("/api/admin/analytics/emotions/by-scenario", isAuthenticated, async (req: any, res) => {
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
            .map((s: any) => s.id);
        }
      } else if (user.role === 'operator') {
        if (user.assignedCategoryId) {
          scenarioIds = allScenarios
            .filter((s: any) => String(s.categoryId) === String(user.assignedCategoryId))
            .map((s: any) => s.id);
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
  app.get("/api/admin/analytics/emotions/by-mbti", isAuthenticated, async (req: any, res) => {
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
            .map((s: any) => s.id);
        }
      } else if (user.role === 'operator') {
        if (user.assignedCategoryId) {
          scenarioIds = allScenarios
            .filter((s: any) => String(s.categoryId) === String(user.assignedCategoryId))
            .map((s: any) => s.id);
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
  app.get("/api/admin/analytics/emotions/by-difficulty", isAuthenticated, async (req: any, res) => {
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
            .map((s: any) => s.id);
        }
      } else if (user.role === 'operator') {
        if (user.assignedCategoryId) {
          scenarioIds = allScenarios
            .filter((s: any) => String(s.categoryId) === String(user.assignedCategoryId))
            .map((s: any) => s.id);
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
  app.get("/api/admin/analytics/emotions/timeline/:personaRunId", async (req, res) => {
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

  // ===== 운영자 권한 헬퍼 함수들 (시나리오 API보다 먼저 정의되어야 함) =====
  // 운영자가 접근 가능한 카테고리 ID 목록 가져오기
  const getOperatorAccessibleCategoryIds = async (user: any): Promise<string[]> => {
    if (user.role === 'admin') {
      const allCategories = await storage.getAllCategories();
      return allCategories.map(c => c.id);
    }
    if (user.role !== 'operator') return [];
    
    // 카테고리 레벨: 해당 카테고리만
    if (user.assignedCategoryId) {
      return [user.assignedCategoryId];
    }
    
    // 조직 레벨: 해당 조직의 모든 카테고리
    if (user.assignedOrganizationId) {
      const allCategories = await storage.getAllCategories();
      return allCategories.filter(c => c.organizationId === user.assignedOrganizationId).map(c => c.id);
    }
    
    // 회사 레벨: 해당 회사의 모든 조직의 모든 카테고리
    if (user.assignedCompanyId) {
      const allOrgs = await storage.getAllOrganizations();
      const companyOrgIds = allOrgs.filter(o => o.companyId === user.assignedCompanyId).map(o => o.id);
      const allCategories = await storage.getAllCategories();
      return allCategories.filter(c => c.organizationId && companyOrgIds.includes(c.organizationId)).map(c => c.id);
    }
    
    return [];
  };

  // ===== 참석자 관리 API =====
  app.get("/api/admin/analytics/participants", isAuthenticated, async (req: any, res) => {
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
      const scenarioRunsByUser = new Map<string, typeof scenarioRuns>();
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
      const feedbacksByUser = new Map<string, typeof feedbacks>();
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
        if (!userCategoriesMap.has(sr.userId)) userCategoriesMap.set(sr.userId, new Set());
        userCategoriesMap.get(sr.userId)!.add(catName);
      }

      // 참여자 목록 생성 (personaRuns가 1개 이상인 사용자만)
      const participantUserIds = new Set(personaRuns.map(pr => {
        const sr = scenarioRunMap.get(pr.scenarioRunId);
        return sr?.userId;
      }).filter(Boolean) as string[]);

      const participants = [];
      for (const uid of participantUserIds) {
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
  app.get("/api/admin/users/:userId/scenario-runs", isAuthenticated, async (req: any, res) => {
    try {
      const requestUser = req.user;
      if (requestUser.role !== 'admin' && requestUser.role !== 'operator') {
        return res.status(403).json({ error: "Access denied" });
      }
      const { userId } = req.params;
      const scenarioRunsWithPersonas = await storage.getUserScenarioRunsWithPersonaRuns(userId);

      // 시나리오 삭제 상태 체크
      const scenarioIds = [...new Set(scenarioRunsWithPersonas.map(sr => sr.scenarioId))];
      const deletedScenarioIds = new Set<string>();
      for (const scenarioId of scenarioIds) {
        const scenario = await storage.getScenario(scenarioId);
        if (!scenario || scenario.isDeleted) deletedScenarioIds.add(scenarioId);
      }
      const enriched = scenarioRunsWithPersonas.map(sr => ({
        ...sr,
        isScenarioDeleted: deletedScenarioIds.has(sr.scenarioId),
      }));
      res.json(enriched);
    } catch (error) {
      console.error("Error fetching user scenario runs for admin:", error);
      res.status(500).json({ error: "Failed to fetch scenario runs" });
    }
  });

  app.get("/api/admin/users/:userId/feedbacks", isAuthenticated, async (req: any, res) => {
    try {
      const requestUser = req.user;
      if (requestUser.role !== 'admin' && requestUser.role !== 'operator') {
        return res.status(403).json({ error: "Access denied" });
      }
      const { userId } = req.params;
      const feedbacks = await storage.getUserFeedbacks(userId);
      res.json(feedbacks);
    } catch (error) {
      console.error("Error fetching user feedbacks for admin:", error);
      res.status(500).json({ error: "Failed to fetch feedbacks" });
    }
  });

  // 일괄 피드백 내보내기 — 선택한 사용자들의 최신 완료 피드백 반환
  app.post("/api/admin/bulk-feedback-export", isAuthenticated, async (req: any, res) => {
    try {
      const requestUser = req.user;
      if (requestUser.role !== 'admin' && requestUser.role !== 'operator') {
        return res.status(403).json({ error: "Access denied" });
      }
      const { userIds } = req.body as { userIds: string[] };
      if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ error: "userIds required" });
      }

      const results: any[] = [];

      for (const userId of userIds) {
        try {
          const user = await storage.getUser(userId);
          if (!user) continue;

          const scenarioRunsWithPersonas = await storage.getUserScenarioRunsWithPersonaRuns(userId);
          
          // 완료된 persona run 중 가장 최근 것(completedAt 기준) 찾기
          let latestPersonaRun: any = null;
          let latestCompletedAt: Date | null = null;
          let matchedScenarioRun: any = null;

          for (const sr of scenarioRunsWithPersonas) {
            for (const pr of sr.personaRuns) {
              if (pr.status === 'completed' && pr.score !== null) {
                const completedAt = pr.completedAt ? new Date(pr.completedAt) : new Date(pr.createdAt);
                if (!latestCompletedAt || completedAt > latestCompletedAt) {
                  latestCompletedAt = completedAt;
                  latestPersonaRun = pr;
                  matchedScenarioRun = sr;
                }
              }
            }
          }

          if (!latestPersonaRun) continue;

          const feedback = await storage.getFeedbackByConversationId(latestPersonaRun.id);
          if (!feedback) continue;

          // 시나리오 이름 조회
          let scenarioTitle = '알 수 없는 시나리오';
          try {
            const scenario = await storage.getScenario(matchedScenarioRun.scenarioId);
            if (scenario) scenarioTitle = (scenario as any).title || scenarioTitle;
          } catch {}

          // 페르소나 이름 조회
          let personaName = '알 수 없는 페르소나';
          try {
            const persona = await storage.getMbtiPersona(latestPersonaRun.personaId);
            if (persona) personaName = persona.name || personaName;
          } catch {}

          results.push({
            user: { id: user.id, name: user.name, email: user.email },
            scenarioTitle,
            personaName,
            completedAt: latestCompletedAt?.toISOString(),
            overallScore: feedback.overallScore,
            scores: feedback.scores,
            detailedFeedback: feedback.detailedFeedback,
          });
        } catch (userError) {
          console.error(`Error processing userId ${userId}:`, userError);
        }
      }

      res.json({ results });
    } catch (error) {
      console.error("Error in bulk feedback export:", error);
      res.status(500).json({ error: "Failed to export feedback" });
    }
  });

  // 메인 사용자용 시나리오/페르소나 API
  app.get("/api/scenarios", async (req, res) => {
    try {
      const scenarios = await fileManager.getAllScenarios();
      const categoryIdParam = req.query.categoryId as string | undefined;
      
      // 인증된 사용자인지 확인 (토큰이 있는 경우)
      const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
      
      let userLanguage = 'ko'; // 기본 언어
      let filteredScenarios = scenarios;
      
      if (token) {
        try {
          const jwt = await import('jsonwebtoken');
          const decoded = jwt.default.verify(token, process.env.JWT_SECRET!) as any;
          const user = await storage.getUser(decoded.userId);
          
          
          if (user) {
            userLanguage = (user as any).preferredLanguage || 'ko';
            
            // 게스트 계정 체크 (guest@mothle.com)
            const isGuestAccount = user.email === 'guest@mothle.com';
            if (isGuestAccount) {
              // 게스트는 데모 시나리오만 볼 수 있음
              filteredScenarios = scenarios.filter((s: any) => s.isDemo === true);
            }
            // 시스템관리자(admin)는 모든 시나리오 접근 가능 (카테고리 필터 선택 가능)
            else if (user.role === 'admin') {
              if (categoryIdParam) {
                filteredScenarios = scenarios.filter((s: any) => 
                  String(s.categoryId) === String(categoryIdParam)
                );
              } else {
              }
            } else {
              // 운영자/일반 사용자: 계층적 권한에 따라 필터링
              const userWithAssignments = user as any;
              
              // 운영자: 할당된 회사/조직/카테고리 기반 필터링
              if (user.role === 'operator') {
                const accessibleCategoryIds = await getOperatorAccessibleCategoryIds(user);
                
                if (accessibleCategoryIds.length > 0) {
                  // 카테고리 파라미터가 있으면 추가 필터링
                  if (categoryIdParam) {
                    if (accessibleCategoryIds.includes(String(categoryIdParam))) {
                      filteredScenarios = scenarios.filter((s: any) => 
                        String(s.categoryId) === String(categoryIdParam)
                      );
                    } else {
                      filteredScenarios = [];
                    }
                  } else {
                    filteredScenarios = scenarios.filter((s: any) => 
                      accessibleCategoryIds.includes(String(s.categoryId))
                    );
                  }
                } else {
                  filteredScenarios = [];
                }
              }
              // 일반 사용자: 자신이 속한 조직/회사 기반 필터링
              else {
                let accessibleCategoryIds: string[] = [];
                
                // 사용자에게 할당된 카테고리가 있으면 포함
                if (userWithAssignments.assignedCategoryId) {
                  accessibleCategoryIds.push(userWithAssignments.assignedCategoryId);
                }
                
                // 사용자의 조직/회사에 속한 카테고리 찾기
                if (userWithAssignments.organizationId || userWithAssignments.companyId) {
                  try {
                    const allCategories = await storage.getAllCategories();
                    
                    for (const cat of allCategories) {
                      const catAny = cat as any;
                      // 조직이 일치하면 해당 카테고리 포함
                      if (userWithAssignments.organizationId && catAny.organizationId === userWithAssignments.organizationId) {
                        if (!accessibleCategoryIds.includes(cat.id)) {
                          accessibleCategoryIds.push(cat.id);
                        }
                      }
                      // 회사가 일치하면 해당 카테고리 포함 (조직 미지정인 경우)
                      else if (userWithAssignments.companyId && catAny.companyId === userWithAssignments.companyId) {
                        if (!accessibleCategoryIds.includes(cat.id)) {
                          accessibleCategoryIds.push(cat.id);
                        }
                      }
                    }
                  } catch (err) {
                    console.error('[Scenarios API] Error fetching categories for org filtering:', err);
                  }
                }
                
                // 접근 가능한 카테고리가 있으면 필터링
                if (accessibleCategoryIds.length > 0) {
                  filteredScenarios = scenarios.filter((s: any) => 
                    accessibleCategoryIds.includes(String(s.categoryId))
                  );
                } else {
                  // 조직/카테고리 할당이 없으면 모든 시나리오 접근 가능
                }
              }
            }
          }
        } catch (tokenError) {
          // 토큰 검증 실패 시 전체 시나리오 반환 (비로그인 사용자와 동일 처리)
        }
      }
      
      // 사용자 언어에 따라 번역 적용
      if (userLanguage !== 'ko') {
        const translatedScenarios = await Promise.all(
          filteredScenarios.map(async (scenario: any) => {
            try {
              const translation = await storage.getScenarioTranslation(scenario.id, userLanguage);
              if (translation) {
                return {
                  ...scenario,
                  title: translation.title || scenario.title,
                  description: translation.description || scenario.description,
                  context: {
                    ...scenario.context,
                    playerRole: scenario.context?.playerRole,
                    situation: translation.situation || scenario.context?.situation,
                    timeline: translation.timeline || scenario.context?.timeline,
                    stakes: translation.stakes || scenario.context?.stakes,
                    playerRoleText: translation.playerRole || null,
                  },
                  objectives: translation.objectives || scenario.objectives,
                  successCriteria: {
                    optimal: translation.successCriteriaOptimal || scenario.successCriteria?.optimal,
                    good: translation.successCriteriaGood || scenario.successCriteria?.good,
                    acceptable: translation.successCriteriaAcceptable || scenario.successCriteria?.acceptable,
                    failure: translation.successCriteriaFailure || scenario.successCriteria?.failure,
                  },
                  _translated: true,
                  _translationLocale: userLanguage,
                };
              }
              return scenario;
            } catch (err) {
              console.error(`[Scenarios API] Translation fetch error for ${scenario.id}:`, err);
              return scenario;
            }
          })
        );
        // Transform media URLs to signed URLs for GCS environment
        const transformedScenarios = await transformScenariosMedia(translatedScenarios);
        return res.json(transformedScenarios);
      }
      
      // 비로그인 사용자 또는 카테고리 미할당 사용자는 전체 시나리오 접근 가능
      console.log(`[Scenarios API] Returning ${filteredScenarios.length} scenarios (language: ${userLanguage})`);
      // Transform media URLs to signed URLs for GCS environment
      const transformedScenarios = await transformScenariosMedia(filteredScenarios);
      res.json(transformedScenarios);
    } catch (error) {
      console.error("Failed to fetch scenarios:", error);
      res.status(500).json({ error: "Failed to fetch scenarios" });
    }
  });

  app.get("/api/scenarios/:scenarioId", isAuthenticated, async (req, res) => {
    try {
      const scenario = await fileManager.getScenarioById(req.params.scenarioId);
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }
      res.json(scenario);
    } catch (error) {
      console.error("Failed to fetch scenario:", error);
      res.status(500).json({ error: "Failed to fetch scenario" });
    }
  });

  // ❌ 비효율적인 /api/personas 엔드포인트 제거됨 
  // (34개 전체 시나리오 처리 방지 최적화)
  // 이제 시나리오별 개별 페르소나 처리만 사용

  // Replit OS → GCS 미디어 동기화 API (관리자 전용)
  app.post("/api/admin/sync-media-to-gcs", isAuthenticated, async (req: any, res) => {
    try {
      if (req.user?.role !== 'admin') {
        return res.status(403).json({ message: "관리자 권한이 필요합니다" });
      }

      if (!process.env.GCS_BUCKET_NAME) {
        return res.status(400).json({ message: "GCS_BUCKET_NAME이 설정되지 않았습니다" });
      }

      console.log(`[Admin] Media sync to GCS triggered by user: ${req.user.email}`);

      const { syncToGCS } = await import("./scripts/syncToGCS");
      const result = await syncToGCS();

      res.json({
        message: "미디어 동기화 완료",
        ...result,
      });
    } catch (error: any) {
      console.error("[Admin] Media sync failed:", error);
      res.status(500).json({ message: "동기화 실패", error: error.message });
    }
  });

  // AI 시나리오 생성 API
  app.post("/api/admin/generate-scenario", async (req, res) => {
    try {
      const { 
        theme, 
        industry, 
        situation,
        timeline,
        stakes,
        playerRole,
        conflictType,
        objectiveType,
        skills,
        estimatedTime,
        difficulty, 
        personaCount 
      } = req.body;
      
      if (!theme) {
        return res.status(400).json({ error: "주제는 필수입니다" });
      }

      const result = await generateScenarioWithAI({
        theme,
        industry,
        situation,
        timeline,
        stakes,
        playerRole,
        conflictType,
        objectiveType,
        skills,
        estimatedTime,
        difficulty: Number(difficulty) || 3,
        personaCount: Number(personaCount) || 3
      });

      // AI 생성된 시나리오에 페르소나 객체를 포함 (저장하지 않음 - 폼에서 저장)
      const scenarioWithPersonas = {
        ...result.scenario,
        personas: result.personas
      };
      
      // 저장하지 않고 데이터만 반환 - 사용자가 폼에서 저장 버튼 클릭 시 저장됨
      res.json({
        scenario: scenarioWithPersonas,
        personas: result.personas
      });
    } catch (error) {
      console.error("AI 시나리오 생성 오류:", error);
      res.status(500).json({ error: "AI 시나리오 생성에 실패했습니다" });
    }
  });

  app.post("/api/admin/enhance-scenario/:id", async (req, res) => {
    try {
      const { enhancementType } = req.body;
      
      if (!enhancementType || !['improve', 'expand', 'simplify'].includes(enhancementType)) {
        return res.status(400).json({ error: "올바른 개선 유형을 선택해주세요" });
      }

      // 기존 시나리오 가져오기
      const scenarios = await fileManager.getAllScenarios();
      const existingScenario = scenarios.find(s => s.id === req.params.id);
      
      if (!existingScenario) {
        return res.status(404).json({ error: "시나리오를 찾을 수 없습니다" });
      }

      const enhancedData = await enhanceScenarioWithAI(existingScenario, enhancementType);
      
      res.json(enhancedData);
    } catch (error) {
      console.error("AI 시나리오 개선 오류:", error);
      res.status(500).json({ error: "AI 시나리오 개선에 실패했습니다" });
    }
  });

  // Admin API routes for scenario and persona management
  
  // 운영자/관리자 권한 확인 미들웨어
  const isOperatorOrAdmin = (req: any, res: any, next: any) => {
    // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
    const user = req.user;
    if (!user || (user.role !== 'admin' && user.role !== 'operator')) {
      return res.status(403).json({ error: "Access denied. Operator or admin only." });
    }
    next();
  };

  // 시나리오 관리 API
  // 운영자가 시나리오에 접근 가능한지 확인
  const checkOperatorScenarioAccess = async (user: any, scenarioId: string): Promise<{ hasAccess: boolean; error?: string }> => {
    if (user.role === 'admin') return { hasAccess: true };
    if (user.role !== 'operator') return { hasAccess: false, error: 'Unauthorized' };
    
    const scenarios = await fileManager.getAllScenarios();
    const scenario = scenarios.find((s: any) => s.id === scenarioId);
    if (!scenario) return { hasAccess: false, error: 'Scenario not found' };
    
    const accessibleCategoryIds = await getOperatorAccessibleCategoryIds(user);
    return { hasAccess: accessibleCategoryIds.includes(scenario.categoryId) };
  };

  app.get("/api/admin/scenarios", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const scenarios = await fileManager.getAllScenarios();
      const lang = req.query.lang as string;
      const mode = req.query.mode as string; // 'edit' = 원본 반환, 그 외 = 번역 적용
      
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const user = req.user;
      
      let filteredScenarios = scenarios;
      
      // 계층적 권한에 따라 시나리오 필터링
      if (user.role === 'operator') {
        const accessibleCategoryIds = await getOperatorAccessibleCategoryIds(user);
        if (accessibleCategoryIds.length === 0) {
          return res.json([]);
        }
        filteredScenarios = scenarios.filter((s: any) => accessibleCategoryIds.includes(s.categoryId));
      }
      
      // 편집 모드: 원본 데이터만 반환 (번역 적용 안함)
      if (mode === 'edit') {
        // 원본 번역이 있으면 그것을 사용, 없으면 시나리오 기본값 사용
        const scenariosWithOriginal = await Promise.all(
          filteredScenarios.map(async (scenario: any) => {
            try {
              const original = await storage.getOriginalScenarioTranslation(scenario.id);
              if (original) {
                return {
                  ...scenario,
                  title: original.title,
                  description: original.description || scenario.description,
                  context: {
                    ...scenario.context,
                    situation: original.situation || scenario.context?.situation,
                    timeline: original.timeline || scenario.context?.timeline,
                    stakes: original.stakes || scenario.context?.stakes,
                  },
                  objectives: original.objectives || scenario.objectives,
                  successCriteria: {
                    optimal: original.successCriteriaOptimal || scenario.successCriteria?.optimal,
                    good: original.successCriteriaGood || scenario.successCriteria?.good,
                    acceptable: original.successCriteriaAcceptable || scenario.successCriteria?.acceptable,
                    failure: original.successCriteriaFailure || scenario.successCriteria?.failure,
                  },
                  _isOriginal: true,
                  _sourceLocale: scenario.sourceLocale || 'ko',
                };
              }
              return { ...scenario, _sourceLocale: scenario.sourceLocale || 'ko' };
            } catch (err) {
              console.error(`[Admin Scenarios API] Original fetch error for ${scenario.id}:`, err);
              return scenario;
            }
          })
        );
        return res.json(scenariosWithOriginal);
      }
      
      // 표시 모드: 언어에 따라 번역 적용
      if (lang) {
        const translatedScenarios = await Promise.all(
          filteredScenarios.map(async (scenario: any) => {
            try {
              // 새 구조: 번역 테이블에서 우선 조회, 없으면 원본 폴백
              const translation = await storage.getScenarioTranslationWithFallback(scenario.id, lang);
              if (translation) {
                const isOriginal = translation.isOriginal || translation.locale === scenario.sourceLocale;
                return {
                  ...scenario,
                  title: translation.title || scenario.title,
                  description: translation.description || scenario.description,
                  context: {
                    ...scenario.context,
                    situation: translation.situation || scenario.context?.situation,
                    timeline: translation.timeline || scenario.context?.timeline,
                    stakes: translation.stakes || scenario.context?.stakes,
                  },
                  objectives: translation.objectives || scenario.objectives,
                  successCriteria: {
                    optimal: translation.successCriteriaOptimal || scenario.successCriteria?.optimal,
                    good: translation.successCriteriaGood || scenario.successCriteria?.good,
                    acceptable: translation.successCriteriaAcceptable || scenario.successCriteria?.acceptable,
                    failure: translation.successCriteriaFailure || scenario.successCriteria?.failure,
                  },
                  _translated: !isOriginal,
                  _translationLocale: translation.locale,
                  _sourceLocale: scenario.sourceLocale || 'ko',
                };
              }
              return { ...scenario, _sourceLocale: scenario.sourceLocale || 'ko' };
            } catch (err) {
              console.error(`[Admin Scenarios API] Translation fetch error for ${scenario.id}:`, err);
              return scenario;
            }
          })
        );
        // Transform media URLs to signed URLs for GCS environment
        const transformedScenarios = await transformScenariosMedia(translatedScenarios);
        return res.json(transformedScenarios);
      }
      
      // Transform media URLs to signed URLs for GCS environment
      const transformedScenarios = await transformScenariosMedia(filteredScenarios);
      res.json(transformedScenarios);
    } catch (error) {
      console.error("Error getting scenarios:", error);
      res.status(500).json({ error: "Failed to get scenarios" });
    }
  });

  app.post("/api/admin/scenarios", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const user = req.user;
      
      let scenarioData = req.body;
      const sourceLocale = scenarioData.sourceLocale || user.preferredLanguage || 'ko';
      
      // 운영자는 자신의 권한 범위 내 카테고리에만 시나리오 생성 가능
      if (user.role === 'operator') {
        const accessibleCategoryIds = await getOperatorAccessibleCategoryIds(user);
        if (accessibleCategoryIds.length === 0) {
          return res.status(403).json({ error: "No category assigned. Contact admin." });
        }
        
        // 카테고리 레벨 할당: 해당 카테고리에만 생성
        if (user.assignedCategoryId) {
          scenarioData.categoryId = user.assignedCategoryId;
        }
        // 조직/회사 레벨 할당: 클라이언트가 보낸 카테고리가 접근 가능한지 확인
        else if (scenarioData.categoryId) {
          if (!accessibleCategoryIds.includes(scenarioData.categoryId)) {
            return res.status(403).json({ error: "You cannot create scenarios in this category" });
          }
        } else {
          return res.status(400).json({ error: "Category is required" });
        }
      }
      
      // sourceLocale 설정
      scenarioData.sourceLocale = sourceLocale;
      
      const scenario = await fileManager.createScenario(scenarioData);
      
      // 원본 콘텐츠를 번역 테이블에도 저장 (isOriginal=true)
      try {
        await storage.upsertScenarioTranslation({
          scenarioId: scenario.id,
          locale: sourceLocale,
          sourceLocale: sourceLocale,
          isOriginal: true,
          title: scenario.title,
          description: scenario.description,
          situation: scenario.context?.situation || null,
          timeline: scenario.context?.timeline || null,
          stakes: scenario.context?.stakes || null,
          playerRole: scenario.context?.playerRole ? 
            `${scenario.context.playerRole.position} / ${scenario.context.playerRole.department}` : null,
          objectives: scenario.objectives || null,
          skills: scenario.skills || null,
          successCriteriaOptimal: scenario.successCriteria?.optimal || null,
          successCriteriaGood: scenario.successCriteria?.good || null,
          successCriteriaAcceptable: scenario.successCriteria?.acceptable || null,
          successCriteriaFailure: scenario.successCriteria?.failure || null,
          isMachineTranslated: false,
          isReviewed: true, // 원본은 검토 완료 상태
        });
      } catch (translationError) {
        console.error("Error saving original translation:", translationError);
      }
      
      // Transform media URLs to signed URLs for GCS environment
      const transformedScenario = await transformScenarioMedia(scenario);
      res.json(transformedScenario);
    } catch (error) {
      console.error("Error creating scenario:", error);
      res.status(500).json({ error: "Failed to create scenario" });
    }
  });

  app.put("/api/admin/scenarios/:id", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const user = req.user;
      const scenarioId = req.params.id;
      
      // Debug logging for image/video updates
      console.log(`[Scenario Update] ===== REQUEST RECEIVED =====`);
      console.log(`[Scenario Update] ID: ${scenarioId}`);
      console.log(`[Scenario Update] Body keys: ${Object.keys(req.body).join(', ')}`);
      console.log(`[Scenario Update] image: "${req.body.image || '(EMPTY)'}"`);
      console.log(`[Scenario Update] introVideoUrl: "${req.body.introVideoUrl || '(EMPTY)'}"`);
      console.log(`[Scenario Update] imagePrompt: "${req.body.imagePrompt || '(EMPTY)'}"`);
      console.log(`[Scenario Update] videoPrompt: "${req.body.videoPrompt || '(EMPTY)'}"`);
      console.log(`[Scenario Update] Full media fields JSON:`, JSON.stringify({
        image: req.body.image,
        introVideoUrl: req.body.introVideoUrl,
        imagePrompt: req.body.imagePrompt,
        videoPrompt: req.body.videoPrompt
      }));
      console.log(`[Scenario Update] ===== END REQUEST =====`);
      
      // 번역된 데이터가 원본을 덮어쓰는 것 방지
      if (req.body._translated) {
        return res.status(400).json({ 
          error: "Cannot save translated content as original. Please edit in original language mode." 
        });
      }
      
      // 운영자는 계층적 권한에 따라 시나리오 수정 가능
      if (user.role === 'operator') {
        const accessCheck = await checkOperatorScenarioAccess(user, scenarioId);
        if (!accessCheck.hasAccess) {
          return res.status(403).json({ error: accessCheck.error || "Access denied. Not authorized for this scenario." });
        }
        
        // 운영자는 카테고리 변경 불가 (자신의 권한 범위 내로 제한)
        if (req.body.categoryId) {
          const accessibleCategoryIds = await getOperatorAccessibleCategoryIds(user);
          if (!accessibleCategoryIds.includes(req.body.categoryId)) {
            return res.status(403).json({ error: "You cannot move scenario to this category" });
          }
        }
      }
      
      // 기존 시나리오의 sourceLocale 유지
      const existingScenarios = await fileManager.getAllScenarios();
      const existingScenario = existingScenarios.find((s: any) => s.id === scenarioId);
      const sourceLocale = req.body.sourceLocale || existingScenario?.sourceLocale || 'ko';
      
      const scenario = await fileManager.updateScenario(scenarioId, req.body);
      
      // Debug: log what was saved
      console.log(`[Scenario Update] After save - image: ${scenario.image || '(empty)'}`);
      console.log(`[Scenario Update] After save - introVideoUrl: ${(scenario as any).introVideoUrl || '(empty)'}`);
      
      // Verify by fetching directly from database
      const verifyScenario = await storage.getScenario(scenarioId);
      console.log(`[Scenario Update] DB Verification - image: "${verifyScenario?.image || '(NULL)'}"`);
      console.log(`[Scenario Update] DB Verification - introVideoUrl: "${verifyScenario?.introVideoUrl || '(NULL)'}"`);
      console.log(`[Scenario Update] ===== UPDATE COMPLETE =====`);
      
      // 원본 콘텐츠 번역 테이블도 업데이트 (isOriginal=true)
      try {
        await storage.upsertScenarioTranslation({
          scenarioId: scenario.id,
          locale: sourceLocale,
          sourceLocale: sourceLocale,
          isOriginal: true,
          title: scenario.title,
          description: scenario.description,
          situation: scenario.context?.situation || null,
          timeline: scenario.context?.timeline || null,
          stakes: scenario.context?.stakes || null,
          playerRole: scenario.context?.playerRole ? 
            `${scenario.context.playerRole.position} / ${scenario.context.playerRole.department}` : null,
          objectives: scenario.objectives || null,
          skills: scenario.skills || null,
          successCriteriaOptimal: scenario.successCriteria?.optimal || null,
          successCriteriaGood: scenario.successCriteria?.good || null,
          successCriteriaAcceptable: scenario.successCriteria?.acceptable || null,
          successCriteriaFailure: scenario.successCriteria?.failure || null,
          isMachineTranslated: false,
          isReviewed: true,
        });
      } catch (translationError) {
        console.error("Error updating original translation:", translationError);
      }
      
      // Transform media URLs to signed URLs for GCS environment
      const transformedScenario = await transformScenarioMedia(scenario);
      res.json(transformedScenario);
    } catch (error) {
      console.error("Error updating scenario:", error);
      res.status(500).json({ error: "Failed to update scenario" });
    }
  });

  app.delete("/api/admin/scenarios/:id", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const user = req.user;
      const scenarioId = req.params.id;
      
      // 운영자는 계층적 권한에 따라 시나리오 삭제 가능
      if (user.role === 'operator') {
        const accessCheck = await checkOperatorScenarioAccess(user, scenarioId);
        if (!accessCheck.hasAccess) {
          return res.status(403).json({ error: accessCheck.error || "Access denied. Not authorized for this scenario." });
        }
      }
      
      await fileManager.deleteScenario(scenarioId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting scenario:", error);
      res.status(500).json({ error: "Failed to delete scenario" });
    }
  });

  // 시나리오 이미지 기본 프롬프트 조회 API
  app.post("/api/admin/scenarios/default-image-prompt", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const { scenarioTitle, description, theme, industry } = req.body;
      
      if (!scenarioTitle) {
        return res.status(400).json({ error: "scenarioTitle is required" });
      }
      
      const prompt = generateImagePrompt(scenarioTitle, description, theme, industry);
      res.json({ success: true, prompt });
    } catch (error: any) {
      console.error("Error generating default image prompt:", error);
      res.status(500).json({ error: "Failed to generate default prompt", details: error.message });
    }
  });

  // 시나리오 비디오 기본 프롬프트 조회 API
  app.post("/api/admin/scenarios/default-video-prompt", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const { scenarioTitle, description, context } = req.body;
      
      if (!scenarioTitle) {
        return res.status(400).json({ error: "scenarioTitle is required" });
      }
      
      const prompt = getDefaultVideoPrompt({
        scenarioTitle,
        description,
        context
      });
      res.json({ success: true, prompt });
    } catch (error: any) {
      console.error("Error generating default video prompt:", error);
      res.status(500).json({ error: "Failed to generate default prompt", details: error.message });
    }
  });

  // 기존 시나리오 이미지 목록 조회 API
  app.get("/api/admin/scenarios/images", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const files = await listGCSFiles('scenarios/');
      
      // 이미지 파일만 필터링 (.webp, .png, .jpg, .jpeg)
      const imageFiles = files.filter(f => 
        /\.(webp|png|jpg|jpeg)$/i.test(f.name)
      );
      
      res.json({ 
        success: true, 
        images: imageFiles.map(f => ({
          path: f.name,
          url: f.signedUrl,
          updatedAt: f.updatedAt
        }))
      });
    } catch (error: any) {
      console.error("Error listing scenario images:", error);
      res.status(500).json({ error: "Failed to list images", details: error.message });
    }
  });

  // 기존 시나리오 비디오 목록 조회 API
  app.get("/api/admin/scenarios/videos", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const files = await listGCSFiles('videos/');
      
      // 비디오 파일만 필터링 (.webm, .mp4)
      const videoFiles = files.filter(f => 
        /\.(webm|mp4)$/i.test(f.name)
      );
      
      res.json({ 
        success: true, 
        videos: videoFiles.map(f => ({
          path: f.name,
          url: f.signedUrl,
          updatedAt: f.updatedAt
        }))
      });
    } catch (error: any) {
      console.error("Error listing scenario videos:", error);
      res.status(500).json({ error: "Failed to list videos", details: error.message });
    }
  });

  // 시나리오 인트로 비디오 생성 API
  app.post("/api/admin/scenarios/:id/generate-intro-video", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const scenarioId = req.params.id;
      const { customPrompt } = req.body;
      
      // 시나리오 정보 가져오기
      const scenarios = await fileManager.getAllScenarios();
      const scenario = scenarios.find((s: any) => s.id === scenarioId);
      
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }
      
      // 비디오 생성 상태 확인
      const status = getVideoGenerationStatus();
      if (!status.available) {
        return res.status(503).json({ 
          error: "비디오 생성 서비스를 사용할 수 없습니다.", 
          reason: status.reason 
        });
      }
      
      // 기존 비디오 경로 저장 (재생성 시 삭제를 위해)
      const oldVideoPath = scenario.introVideoUrl || null;
      
      console.log(`🎬 시나리오 인트로 비디오 생성 시작: ${scenario.title}`);
      
      // 비디오 생성 요청
      const result = await generateIntroVideo({
        scenarioId: scenario.id,
        scenarioTitle: scenario.title,
        description: scenario.description,
        customPrompt: customPrompt,
        context: {
          situation: scenario.context?.situation || scenario.description,
          stakes: scenario.context?.stakes || '',
          timeline: scenario.context?.timeline || ''
        }
      });
      
      if (!result.success) {
        return res.status(500).json({ 
          error: result.error || "비디오 생성 실패",
          prompt: result.prompt
        });
      }
      
      // 시나리오에 비디오 URL만 업데이트 (부분 업데이트)
      await fileManager.updateScenario(scenarioId, {
        introVideoUrl: result.videoUrl
      } as any);
      
      // 기존 비디오 삭제 (새 비디오 저장 성공 후)
      if (oldVideoPath && oldVideoPath !== result.videoUrl) {
        await deleteIntroVideo(oldVideoPath);
      }
      
      console.log(`✅ 시나리오 인트로 비디오 생성 완료: ${result.videoUrl}`);
      
      // GCS 환경에서는 Signed URL로 변환하여 응답
      const signedVideoUrl = await transformToSignedUrl(result.videoUrl) || result.videoUrl;
      
      res.json({
        success: true,
        videoUrl: signedVideoUrl,
        storagePath: result.videoUrl,
        prompt: result.prompt,
        metadata: result.metadata
      });
      
    } catch (error: any) {
      console.error("Error generating intro video:", error);
      res.status(500).json({ 
        error: "Failed to generate intro video",
        details: error.message 
      });
    }
  });

  // 시나리오 인트로 비디오 삭제 API
  app.delete("/api/admin/scenarios/:id/intro-video", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const scenarioId = req.params.id;
      
      // 시나리오 정보 가져오기
      const scenarios = await fileManager.getAllScenarios();
      const scenario = scenarios.find((s: any) => s.id === scenarioId);
      
      if (!scenario) {
        return res.status(404).json({ error: "Scenario not found" });
      }
      
      if (!scenario.introVideoUrl) {
        return res.json({ success: true, message: "No intro video to delete" });
      }
      
      // 비디오 파일 삭제
      const deleted = await deleteIntroVideo(scenario.introVideoUrl);
      
      // 시나리오에서 비디오 URL 제거 (부분 업데이트)
      await fileManager.updateScenario(scenarioId, {
        introVideoUrl: ''
      } as any);
      
      console.log(`🗑️ 시나리오 인트로 비디오 삭제 완료: ${scenarioId}`);
      
      res.json({ 
        success: true,
        deleted 
      });
      
    } catch (error: any) {
      console.error("Error deleting intro video:", error);
      res.status(500).json({ 
        error: "Failed to delete intro video",
        details: error.message 
      });
    }
  });

  // 비디오 생성 서비스 상태 확인 API
  app.get("/api/admin/video-generation-status", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const status = getVideoGenerationStatus();
      res.json(status);
    } catch (error: any) {
      console.error("Error checking video generation status:", error);
      res.status(500).json({ 
        available: false, 
        reason: error.message 
      });
    }
  });

  // 페르소나 관리 API
  app.get("/api/admin/personas", async (req, res) => {
    try {
      const personas = await fileManager.getAllMBTIPersonas();
      // Transform persona image URLs to signed URLs for GCS environment
      const transformedPersonas = await transformPersonasMedia(personas);
      res.json(transformedPersonas);
    } catch (error) {
      console.error("Error getting MBTI personas:", error);
      res.status(500).json({ error: "Failed to get MBTI personas" });
    }
  });

  app.post("/api/admin/personas", async (req, res) => {
    try {
      const persona = await fileManager.createMBTIPersona(req.body);
      // Transform persona image URLs to signed URLs for GCS environment
      const transformedPersona = await transformPersonaMedia(persona);
      res.json(transformedPersona);
    } catch (error) {
      console.error("Error creating MBTI persona:", error);
      res.status(500).json({ error: "Failed to create MBTI persona" });
    }
  });

  app.put("/api/admin/personas/:id", async (req, res) => {
    try {
      const persona = await fileManager.updateMBTIPersona(req.params.id, req.body);
      // Transform persona image URLs to signed URLs for GCS environment
      const transformedPersona = await transformPersonaMedia(persona);
      res.json(transformedPersona);
    } catch (error) {
      console.error("Error updating MBTI persona:", error);
      res.status(500).json({ error: "Failed to update MBTI persona" });
    }
  });

  app.delete("/api/admin/personas/:id", async (req, res) => {
    try {
      const personaId = req.params.id;
      
      // 연결된 시나리오 확인
      const scenarios = await fileManager.getAllScenarios();
      const connectedScenarios = scenarios.filter(scenario => 
        scenario.personas.includes(personaId)
      );
      
      if (connectedScenarios.length > 0) {
        return res.status(400).json({ 
          error: "Cannot delete persona with connected scenarios",
          connectedScenarios: connectedScenarios.map(s => ({ id: s.id, title: s.title }))
        });
      }
      
      await fileManager.deleteMBTIPersona(personaId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting persona:", error);
      res.status(500).json({ error: "Failed to delete persona" });
    }
  });

  // ==========================================
  // System Admin API (시스템 관리자 전용)
  // ==========================================
  
  // 시스템 관리자 권한 확인 미들웨어
  const isSystemAdmin = (req: any, res: any, next: any) => {
    // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: "Access denied. System admin only." });
    }
    next();
  };

  // 전체 사용자 목록 조회 (시스템 관리자 전용)
  app.get("/api/system-admin/users", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      
      // 비밀번호 제외한 사용자 정보 반환
      const usersWithoutPassword = allUsers.map(user => ({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tier: user.tier,
        isActive: user.isActive ?? true,
        profileImage: user.profileImage,
        lastLoginAt: user.lastLoginAt,
        assignedCompanyId: user.assignedCompanyId,
        assignedOrganizationId: user.assignedOrganizationId,
        assignedCategoryId: user.assignedCategoryId,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      }));
      
      res.json(usersWithoutPassword);
    } catch (error: any) {
      console.error("Error fetching all users:", error);
      res.status(500).json({ error: error.message || "Failed to fetch users" });
    }
  });

  // 사용자 정보 수정 (역할/등급/활성화 상태 - 시스템 관리자 전용)
  app.patch("/api/system-admin/users/:id", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { role, tier, isActive, assignedCompanyId, assignedOrganizationId, assignedCategoryId } = req.body;
      
      // 자기 자신의 역할 변경 방지 (안전장치)
      // @ts-ignore
      if (id === req.user?.id && role && role !== 'admin') {
        return res.status(400).json({ error: "Cannot change your own admin role" });
      }
      
      const updates: { role?: string; tier?: string; isActive?: boolean; assignedCompanyId?: string | null; assignedOrganizationId?: string | null; assignedCategoryId?: string | null } = {};
      
      if (role !== undefined) {
        if (!['admin', 'operator', 'user'].includes(role)) {
          return res.status(400).json({ error: "Invalid role. Must be admin, operator, or user" });
        }
        updates.role = role;
      }
      
      if (tier !== undefined) {
        if (!['bronze', 'silver', 'gold', 'platinum', 'diamond'].includes(tier)) {
          return res.status(400).json({ error: "Invalid tier" });
        }
        updates.tier = tier;
      }
      
      if (isActive !== undefined) {
        updates.isActive = isActive;
      }
      
      // 운영자 계층적 권한 할당 (회사/조직/카테고리)
      if (assignedCompanyId !== undefined) {
        updates.assignedCompanyId = assignedCompanyId;
      }
      if (assignedOrganizationId !== undefined) {
        updates.assignedOrganizationId = assignedOrganizationId;
      }
      if (assignedCategoryId !== undefined) {
        updates.assignedCategoryId = assignedCategoryId;
      }
      
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No valid updates provided" });
      }
      
      const updatedUser = await storage.adminUpdateUser(id, updates);
      
      res.json({
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        role: updatedUser.role,
        tier: updatedUser.tier,
        isActive: updatedUser.isActive ?? true,
        profileImage: updatedUser.profileImage,
        lastLoginAt: updatedUser.lastLoginAt,
        assignedCompanyId: updatedUser.assignedCompanyId,
        assignedOrganizationId: updatedUser.assignedOrganizationId,
        assignedCategoryId: updatedUser.assignedCategoryId,
        createdAt: updatedUser.createdAt,
        updatedAt: updatedUser.updatedAt,
      });
    } catch (error: any) {
      console.error("Error updating user:", error);
      res.status(500).json({ error: error.message || "Failed to update user" });
    }
  });

  // 비밀번호 재설정 (시스템 관리자 전용)
  app.post("/api/system-admin/users/:id/reset-password", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { newPassword } = req.body;
      
      if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }
      
      // 비밀번호 해싱
      const bcrypt = await import("bcryptjs");
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      
      // 사용자 비밀번호 업데이트
      const updatedUser = await storage.updateUser(id, { password: hashedPassword });
      
      res.json({
        success: true,
        message: "Password reset successfully",
        userId: updatedUser.id,
      });
    } catch (error: any) {
      console.error("Error resetting password:", error);
      res.status(500).json({ error: error.message || "Failed to reset password" });
    }
  });

  // ========== 카테고리 관리 API (시스템 관리자 전용) ==========
  
  // 모든 카테고리 조회 (공개 - 회원가입 시 카테고리 선택에 필요)
  app.get("/api/categories", async (req, res) => {
    try {
      const allCategories = await storage.getAllCategories();
      
      // 🚀 최적화: 캐시된 시나리오 카운트 사용 (파일 전체 파싱 대신 카운트만)
      const scenarioCounts = await fileManager.getScenarioCountsByCategory();
      const categoriesWithCount = allCategories.map(category => ({
        ...category,
        scenarioCount: scenarioCounts.get(category.id) || 0
      }));
      
      res.json(categoriesWithCount);
    } catch (error: any) {
      console.error("Error getting categories:", error);
      res.status(500).json({ error: error.message || "Failed to get categories" });
    }
  });

  // 카테고리 생성 (시스템 관리자 전용)
  app.post("/api/system-admin/categories", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { name, description, order } = req.body;
      
      if (!name || name.trim() === "") {
        return res.status(400).json({ error: "Category name is required" });
      }
      
      const category = await storage.createCategory({
        name: name.trim(),
        description: description || null,
        order: order || 0,
      });
      
      res.json(category);
    } catch (error: any) {
      console.error("Error creating category:", error);
      if (error.message?.includes("unique") || error.code === "23505") {
        res.status(400).json({ error: "Category name already exists" });
      } else {
        res.status(500).json({ error: error.message || "Failed to create category" });
      }
    }
  });

  // 카테고리 수정 (시스템 관리자 전용)
  app.patch("/api/system-admin/categories/:id", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, order } = req.body;
      
      const updates: any = {};
      if (name !== undefined) updates.name = name.trim();
      if (description !== undefined) updates.description = description;
      if (order !== undefined) updates.order = order;
      
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No valid updates provided" });
      }
      
      const category = await storage.updateCategory(id, updates);
      res.json(category);
    } catch (error: any) {
      console.error("Error updating category:", error);
      if (error.message?.includes("unique") || error.code === "23505") {
        res.status(400).json({ error: "Category name already exists" });
      } else {
        res.status(500).json({ error: error.message || "Failed to update category" });
      }
    }
  });

  // 카테고리 삭제 (시스템 관리자 전용)
  app.delete("/api/system-admin/categories/:id", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      
      // 해당 카테고리에 연결된 시나리오가 있는지 확인
      const scenarios = await fileManager.getAllScenarios();
      const connectedScenarios = scenarios.filter((s: any) => s.categoryId === id);
      
      if (connectedScenarios.length > 0) {
        return res.status(400).json({
          error: "Cannot delete category with connected scenarios",
          connectedScenarios: connectedScenarios.map((s: any) => ({ id: s.id, title: s.title })),
        });
      }
      
      // 해당 카테고리가 할당된 운영자가 있는지 확인
      const allUsers = await storage.getAllUsers();
      const assignedOperators = allUsers.filter(u => u.assignedCategoryId === id);
      
      if (assignedOperators.length > 0) {
        return res.status(400).json({
          error: "Cannot delete category with assigned operators",
          assignedOperators: assignedOperators.map(u => ({ id: u.id, name: u.name, email: u.email })),
        });
      }
      
      await storage.deleteCategory(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting category:", error);
      res.status(500).json({ error: error.message || "Failed to delete category" });
    }
  });

  // ========== 조직 계층 조회 API ==========
  
  // 모든 조직 조회 (회사 정보 포함)
  app.get("/api/admin/organizations-with-hierarchy", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const organizations = await storage.getAllOrganizations();
      const companies = await storage.getAllCompanies();
      
      const organizationsWithHierarchy = organizations.map(org => {
        const company = companies.find(c => c.id === org.companyId);
        return {
          ...org,
          company: company ? { id: company.id, name: company.name, code: company.code } : null,
        };
      });
      
      res.json(organizationsWithHierarchy);
    } catch (error: any) {
      console.error("Error getting organizations with hierarchy:", error);
      res.status(500).json({ error: error.message || "Failed to get organizations" });
    }
  });

  // ========== 조직 관리 API (운영자용 - 회사 레벨 운영자만) ==========
  
  // 회사 레벨 운영자 권한 체크 헬퍼
  const isCompanyLevelOperator = (user: any): boolean => {
    return user.role === 'operator' && 
           user.assignedCompanyId && 
           !user.assignedOrganizationId && 
           !user.assignedCategoryId;
  };
  
  // 운영자용 조직 목록 조회 (회사 레벨 운영자: 자신의 회사 조직만)
  app.get("/api/admin/organizations", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const user = req.user as any;
      const organizations = await storage.getAllOrganizations();
      const companies = await storage.getAllCompanies();
      
      let filteredOrgs = organizations;
      
      // 회사 레벨 운영자인 경우 해당 회사의 조직만 반환
      if (user.role === 'operator') {
        if (isCompanyLevelOperator(user)) {
          filteredOrgs = organizations.filter(org => org.companyId === user.assignedCompanyId);
        } else if (user.assignedOrganizationId) {
          // 조직/카테고리 레벨 운영자는 자신의 조직만
          filteredOrgs = organizations.filter(org => org.id === user.assignedOrganizationId);
        } else {
          filteredOrgs = [];
        }
      }
      
      const organizationsWithHierarchy = filteredOrgs.map(org => {
        const company = companies.find(c => c.id === org.companyId);
        return {
          ...org,
          company: company ? { id: company.id, name: company.name, code: company.code } : null,
        };
      });
      
      res.json(organizationsWithHierarchy);
    } catch (error: any) {
      console.error("Error getting organizations for operator:", error);
      res.status(500).json({ error: error.message || "Failed to get organizations" });
    }
  });
  
  // 운영자용 조직 생성 (회사 레벨 운영자만)
  app.post("/api/admin/organizations", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const user = req.user as any;
      const { name, code, description, isActive } = req.body;
      
      // 권한 체크: admin 또는 회사 레벨 운영자만 가능
      if (user.role === 'operator' && !isCompanyLevelOperator(user)) {
        return res.status(403).json({ error: "Only company-level operators can create organizations" });
      }
      
      // 운영자인 경우 companyId는 자동으로 할당된 회사로 설정
      const companyId = user.role === 'admin' ? req.body.companyId : user.assignedCompanyId;
      
      if (!companyId) {
        return res.status(400).json({ error: "Company ID is required" });
      }
      if (!name || name.trim() === "") {
        return res.status(400).json({ error: "Organization name is required" });
      }
      
      const organization = await storage.createOrganization({
        companyId,
        name: name.trim(),
        code: code?.trim() || null,
        description: description || null,
        isActive: isActive !== false,
      });
      
      res.json(organization);
    } catch (error: any) {
      console.error("Error creating organization:", error);
      res.status(500).json({ error: error.message || "Failed to create organization" });
    }
  });
  
  // 운영자용 조직 수정 (회사 레벨 운영자만, 자신의 회사 조직만)
  app.patch("/api/admin/organizations/:id", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const user = req.user as any;
      const { id } = req.params;
      const { name, code, description, isActive } = req.body;
      
      // 권한 체크
      if (user.role === 'operator') {
        if (!isCompanyLevelOperator(user)) {
          return res.status(403).json({ error: "Only company-level operators can update organizations" });
        }
        
        // 해당 조직이 운영자의 회사에 속하는지 확인
        const organization = await storage.getOrganization(id);
        if (!organization || organization.companyId !== user.assignedCompanyId) {
          return res.status(403).json({ error: "You can only update organizations in your assigned company" });
        }
      }
      
      const updates: any = {};
      if (name !== undefined) updates.name = name.trim();
      if (code !== undefined) updates.code = code?.trim() || null;
      if (description !== undefined) updates.description = description;
      if (isActive !== undefined) updates.isActive = isActive;
      
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No valid updates provided" });
      }
      
      const organization = await storage.updateOrganization(id, updates);
      res.json(organization);
    } catch (error: any) {
      console.error("Error updating organization:", error);
      res.status(500).json({ error: error.message || "Failed to update organization" });
    }
  });
  
  // 운영자용 조직 삭제 (회사 레벨 운영자만, 자신의 회사 조직만)
  app.delete("/api/admin/organizations/:id", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const user = req.user as any;
      const { id } = req.params;
      
      // 권한 체크
      if (user.role === 'operator') {
        if (!isCompanyLevelOperator(user)) {
          return res.status(403).json({ error: "Only company-level operators can delete organizations" });
        }
        
        // 해당 조직이 운영자의 회사에 속하는지 확인
        const organization = await storage.getOrganization(id);
        if (!organization || organization.companyId !== user.assignedCompanyId) {
          return res.status(403).json({ error: "You can only delete organizations in your assigned company" });
        }
      }
      
      // 해당 조직에 카테고리가 있는지 확인
      const categories = await storage.getCategoriesByOrganization(id);
      if (categories.length > 0) {
        return res.status(400).json({
          error: "Cannot delete organization with categories",
          categories: categories.map(c => ({ id: c.id, name: c.name })),
        });
      }
      
      await storage.deleteOrganization(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting organization:", error);
      res.status(500).json({ error: error.message || "Failed to delete organization" });
    }
  });

  // ========== 카테고리 관리 API (관리자/운영자용 - 계층적 권한 지원) ==========
  
  // 운영자 계층적 권한 체크 헬퍼 함수
  // 회사만 할당: 해당 회사의 모든 조직/카테고리 접근 가능
  // 회사+조직 할당: 해당 조직의 모든 카테고리 접근 가능
  // 회사+조직+카테고리 할당: 해당 카테고리만 접근 가능
  const checkOperatorCategoryAccess = async (user: any, categoryId: string): Promise<{ hasAccess: boolean; error?: string }> => {
    if (user.role === 'admin') return { hasAccess: true };
    if (user.role !== 'operator') return { hasAccess: false, error: 'Unauthorized' };
    
    // 어떤 권한도 할당되지 않은 경우
    if (!user.assignedCompanyId && !user.assignedOrganizationId && !user.assignedCategoryId) {
      return { hasAccess: false, error: 'Operator must be assigned to manage categories' };
    }
    
    const category = await storage.getCategory(categoryId);
    if (!category) return { hasAccess: false, error: 'Category not found' };
    
    // 카테고리 레벨 할당: 해당 카테고리만 접근 가능
    if (user.assignedCategoryId) {
      return { hasAccess: category.id === user.assignedCategoryId };
    }
    
    // 조직 레벨 할당: 해당 조직의 모든 카테고리 접근 가능
    if (user.assignedOrganizationId) {
      return { hasAccess: category.organizationId === user.assignedOrganizationId };
    }
    
    // 회사 레벨 할당: 해당 회사의 모든 조직/카테고리 접근 가능
    if (user.assignedCompanyId && category.organizationId) {
      const org = await storage.getOrganization(category.organizationId);
      return { hasAccess: org?.companyId === user.assignedCompanyId };
    }
    
    return { hasAccess: false };
  };
  
  // 운영자가 접근 가능한 조직 목록 가져오기
  const getOperatorAccessibleOrganizations = async (user: any): Promise<string[]> => {
    if (user.role === 'admin') {
      const allOrgs = await storage.getAllOrganizations();
      return allOrgs.map(o => o.id);
    }
    if (user.role !== 'operator') return [];
    
    // 카테고리 레벨: 해당 카테고리의 조직만
    if (user.assignedCategoryId) {
      const cat = await storage.getCategory(user.assignedCategoryId);
      return cat?.organizationId ? [cat.organizationId] : [];
    }
    
    // 조직 레벨: 해당 조직만
    if (user.assignedOrganizationId) {
      return [user.assignedOrganizationId];
    }
    
    // 회사 레벨: 해당 회사의 모든 조직
    if (user.assignedCompanyId) {
      const allOrgs = await storage.getAllOrganizations();
      return allOrgs.filter(o => o.companyId === user.assignedCompanyId).map(o => o.id);
    }
    
    return [];
  };
  
  // 모든 카테고리 조회 (조직 정보 포함 - 계층적 권한 적용)
  app.get("/api/admin/categories", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      // @ts-ignore
      const user = req.user;
      
      console.log(`[Categories API] User: ${user.email}, role: ${user.role}, assignedCompanyId: ${user.assignedCompanyId}, assignedOrgId: ${user.assignedOrganizationId}, assignedCatId: ${user.assignedCategoryId}`);
      
      let allCategories = await storage.getAllCategories();
      const organizations = await storage.getAllOrganizations();
      const companies = await storage.getAllCompanies();
      
      console.log(`[Categories API] Total categories: ${allCategories.length}, Total orgs: ${organizations.length}`);
      
      // 운영자는 계층적 권한에 따라 카테고리 필터링
      if (user.role === 'operator') {
        // 카테고리 레벨 할당: 해당 카테고리만
        if (user.assignedCategoryId) {
          allCategories = allCategories.filter(cat => cat.id === user.assignedCategoryId);
          console.log(`[Categories API] Category-level filter applied: ${allCategories.length} categories`);
        }
        // 조직 레벨 할당: 해당 조직의 모든 카테고리
        else if (user.assignedOrganizationId) {
          allCategories = allCategories.filter(cat => cat.organizationId === user.assignedOrganizationId);
          console.log(`[Categories API] Org-level filter applied: ${allCategories.length} categories`);
        }
        // 회사 레벨 할당: 해당 회사의 모든 조직의 카테고리
        else if (user.assignedCompanyId) {
          const companyOrgIds = organizations.filter(o => o.companyId === user.assignedCompanyId).map(o => o.id);
          console.log(`[Categories API] Company ${user.assignedCompanyId} has orgs: ${companyOrgIds.join(', ')}`);
          allCategories = allCategories.filter(cat => cat.organizationId && companyOrgIds.includes(cat.organizationId));
          console.log(`[Categories API] Company-level filter applied: ${allCategories.length} categories`);
        }
        // 어떤 권한도 없으면 빈 배열
        else {
          console.log(`[Categories API] No assignments - returning empty array`);
          return res.json([]);
        }
      }
      
      const categoriesWithHierarchy = allCategories.map(category => {
        const org = organizations.find(o => o.id === category.organizationId);
        const company = org ? companies.find(c => c.id === org.companyId) : null;
        return {
          ...category,
          organization: org ? { id: org.id, name: org.name, code: org.code } : null,
          company: company ? { id: company.id, name: company.name, code: company.code } : null,
        };
      });
      
      res.json(categoriesWithHierarchy);
    } catch (error: any) {
      console.error("Error getting categories with hierarchy:", error);
      res.status(500).json({ error: error.message || "Failed to get categories" });
    }
  });

  // 카테고리 생성 (계층적 권한 적용)
  app.post("/api/admin/categories", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const { name, description, organizationId, order } = req.body;
      // @ts-ignore
      const user = req.user;
      
      if (!name || name.trim() === "") {
        return res.status(400).json({ error: "Category name is required" });
      }
      
      // 운영자는 자신의 권한 범위 내 조직에만 카테고리 생성 가능
      let effectiveOrganizationId = organizationId || null;
      if (user.role === 'operator') {
        const accessibleOrgIds = await getOperatorAccessibleOrganizations(user);
        
        // 카테고리 레벨 할당: 카테고리 생성 불가
        if (user.assignedCategoryId) {
          return res.status(403).json({ error: "Category-level operators cannot create new categories" });
        }
        
        // 조직 레벨 할당: 해당 조직에만 생성 가능
        if (user.assignedOrganizationId) {
          effectiveOrganizationId = user.assignedOrganizationId;
        }
        // 회사 레벨 할당: 클라이언트가 보낸 조직이 접근 가능한 조직인지 확인
        else if (user.assignedCompanyId) {
          if (!organizationId || !accessibleOrgIds.includes(organizationId)) {
            return res.status(400).json({ error: "Please select a valid organization within your assigned company" });
          }
          effectiveOrganizationId = organizationId;
        }
        else {
          return res.status(403).json({ error: "Operator must be assigned to create categories" });
        }
      }
      
      const category = await storage.createCategory({
        name: name.trim(),
        description: description || null,
        organizationId: effectiveOrganizationId,
        order: order || 0,
      });
      
      res.json(category);
    } catch (error: any) {
      console.error("Error creating category:", error);
      if (error.message?.includes("unique") || error.code === "23505") {
        res.status(400).json({ error: "Category name already exists" });
      } else {
        res.status(500).json({ error: error.message || "Failed to create category" });
      }
    }
  });

  // 카테고리 수정 (계층적 권한 적용)
  app.patch("/api/admin/categories/:id", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, organizationId, order, isActive } = req.body;
      // @ts-ignore
      const user = req.user;
      
      // 운영자는 계층적 권한에 따라 수정 가능
      if (user.role === 'operator') {
        const accessCheck = await checkOperatorCategoryAccess(user, id);
        if (!accessCheck.hasAccess) {
          return res.status(403).json({ error: accessCheck.error || "You cannot update this category" });
        }
      }
      
      const updates: any = {};
      if (name !== undefined) updates.name = name.trim();
      if (description !== undefined) updates.description = description;
      // 조직 변경: admin은 무제한, 회사 레벨 운영자는 자신의 회사 내 조직만 가능
      if (organizationId !== undefined) {
        if (user.role === 'admin') {
          updates.organizationId = organizationId;
        } else if (user.role === 'operator' && user.assignedCompanyId && !user.assignedOrganizationId && !user.assignedCategoryId) {
          // 회사 레벨 운영자: 해당 회사 내 조직인지 확인
          const accessibleOrgIds = await getOperatorAccessibleOrganizations(user);
          if (accessibleOrgIds.includes(organizationId)) {
            updates.organizationId = organizationId;
          } else {
            return res.status(403).json({ error: "You can only move categories to organizations within your assigned company" });
          }
        }
        // 조직/카테고리 레벨 운영자는 조직 변경 불가 (기존 동작 유지)
      }
      if (order !== undefined) updates.order = order;
      if (isActive !== undefined) updates.isActive = isActive;
      
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No valid updates provided" });
      }
      
      const category = await storage.updateCategory(id, updates);
      res.json(category);
    } catch (error: any) {
      console.error("Error updating category:", error);
      if (error.message?.includes("unique") || error.code === "23505") {
        res.status(400).json({ error: "Category name already exists" });
      } else {
        res.status(500).json({ error: error.message || "Failed to update category" });
      }
    }
  });

  // 카테고리 삭제 (계층적 권한 적용)
  app.delete("/api/admin/categories/:id", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      // @ts-ignore
      const user = req.user;
      
      // 운영자는 계층적 권한에 따라 삭제 가능 (카테고리 레벨 할당은 삭제 불가)
      if (user.role === 'operator') {
        // 카테고리 레벨 할당: 카테고리 삭제 불가
        if (user.assignedCategoryId) {
          return res.status(403).json({ error: "Category-level operators cannot delete categories" });
        }
        
        const accessCheck = await checkOperatorCategoryAccess(user, id);
        if (!accessCheck.hasAccess) {
          return res.status(403).json({ error: accessCheck.error || "You cannot delete this category" });
        }
      }
      
      // 해당 카테고리에 연결된 시나리오가 있는지 확인
      const scenarios = await fileManager.getAllScenarios();
      const connectedScenarios = scenarios.filter((s: any) => s.categoryId === id);
      
      if (connectedScenarios.length > 0) {
        return res.status(400).json({
          error: "Cannot delete category with connected scenarios",
          connectedScenarios: connectedScenarios.map((s: any) => ({ id: s.id, title: s.title })),
        });
      }
      
      await storage.deleteCategory(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting category:", error);
      res.status(500).json({ error: error.message || "Failed to delete category" });
    }
  });

  // ========== 3단 계층 구조 API: 회사 > 조직 > 카테고리 ==========
  
  // ========== 회사 관리 API (시스템 관리자 전용) ==========
  
  // 모든 회사 조회
  app.get("/api/system-admin/companies", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const allCompanies = await storage.getAllCompanies();
      res.json(allCompanies);
    } catch (error: any) {
      console.error("Error getting companies:", error);
      res.status(500).json({ error: error.message || "Failed to get companies" });
    }
  });
  
  // 활성 회사 목록 조회 (회원가입용 - 인증 불필요)
  app.get("/api/public/companies", async (req, res) => {
    try {
      const activeCompanies = await storage.getActiveCompanies();
      res.json(activeCompanies);
    } catch (error: any) {
      console.error("Error getting active companies:", error);
      res.status(500).json({ error: error.message || "Failed to get companies" });
    }
  });
  
  // 회사 생성
  app.post("/api/system-admin/companies", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { name, code, description, logo, isActive } = req.body;
      
      if (!name || name.trim() === "") {
        return res.status(400).json({ error: "Company name is required" });
      }
      
      const company = await storage.createCompany({
        name: name.trim(),
        code: code?.trim() || null,
        description: description || null,
        logo: logo || null,
        isActive: isActive !== false,
      });
      
      res.json(company);
    } catch (error: any) {
      console.error("Error creating company:", error);
      if (error.message?.includes("unique") || error.code === "23505") {
        res.status(400).json({ error: "Company name or code already exists" });
      } else {
        res.status(500).json({ error: error.message || "Failed to create company" });
      }
    }
  });
  
  // 회사 수정
  app.patch("/api/system-admin/companies/:id", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, code, description, logo, isActive } = req.body;
      
      const updates: any = {};
      if (name !== undefined) updates.name = name.trim();
      if (code !== undefined) updates.code = code?.trim() || null;
      if (description !== undefined) updates.description = description;
      if (logo !== undefined) updates.logo = logo;
      if (isActive !== undefined) updates.isActive = isActive;
      
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No valid updates provided" });
      }
      
      const company = await storage.updateCompany(id, updates);
      res.json(company);
    } catch (error: any) {
      console.error("Error updating company:", error);
      res.status(500).json({ error: error.message || "Failed to update company" });
    }
  });
  
  // 회사 삭제
  app.delete("/api/system-admin/companies/:id", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      
      // 해당 회사에 조직이 있는지 확인
      const organizations = await storage.getOrganizationsByCompany(id);
      if (organizations.length > 0) {
        return res.status(400).json({
          error: "Cannot delete company with organizations",
          organizations: organizations.map(o => ({ id: o.id, name: o.name })),
        });
      }
      
      await storage.deleteCompany(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting company:", error);
      res.status(500).json({ error: error.message || "Failed to delete company" });
    }
  });
  
  // ========== 조직 관리 API ==========
  
  // 회사별 조직 목록 조회 (시스템 관리자)
  app.get("/api/system-admin/companies/:companyId/organizations", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { companyId } = req.params;
      const organizations = await storage.getOrganizationsByCompany(companyId);
      res.json(organizations);
    } catch (error: any) {
      console.error("Error getting organizations:", error);
      res.status(500).json({ error: error.message || "Failed to get organizations" });
    }
  });
  
  // 활성 조직 목록 조회 (회원가입용 - 인증 불필요)
  app.get("/api/public/companies/:companyId/organizations", async (req, res) => {
    try {
      const { companyId } = req.params;
      const activeOrganizations = await storage.getActiveOrganizationsByCompany(companyId);
      res.json(activeOrganizations);
    } catch (error: any) {
      console.error("Error getting active organizations:", error);
      res.status(500).json({ error: error.message || "Failed to get organizations" });
    }
  });
  
  // 모든 조직 조회 (시스템 관리자)
  app.get("/api/system-admin/organizations", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const organizations = await storage.getAllOrganizations();
      res.json(organizations);
    } catch (error: any) {
      console.error("Error getting all organizations:", error);
      res.status(500).json({ error: error.message || "Failed to get organizations" });
    }
  });
  
  // 조직 생성
  app.post("/api/system-admin/organizations", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { companyId, name, code, description, isActive } = req.body;
      
      if (!companyId) {
        return res.status(400).json({ error: "Company ID is required" });
      }
      if (!name || name.trim() === "") {
        return res.status(400).json({ error: "Organization name is required" });
      }
      
      const organization = await storage.createOrganization({
        companyId,
        name: name.trim(),
        code: code?.trim() || null,
        description: description || null,
        isActive: isActive !== false,
      });
      
      res.json(organization);
    } catch (error: any) {
      console.error("Error creating organization:", error);
      res.status(500).json({ error: error.message || "Failed to create organization" });
    }
  });
  
  // 조직 수정
  app.patch("/api/system-admin/organizations/:id", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, code, description, isActive } = req.body;
      
      const updates: any = {};
      if (name !== undefined) updates.name = name.trim();
      if (code !== undefined) updates.code = code?.trim() || null;
      if (description !== undefined) updates.description = description;
      if (isActive !== undefined) updates.isActive = isActive;
      
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No valid updates provided" });
      }
      
      const organization = await storage.updateOrganization(id, updates);
      res.json(organization);
    } catch (error: any) {
      console.error("Error updating organization:", error);
      res.status(500).json({ error: error.message || "Failed to update organization" });
    }
  });
  
  // 조직 삭제
  app.delete("/api/system-admin/organizations/:id", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      
      // 해당 조직에 카테고리가 있는지 확인
      const categories = await storage.getCategoriesByOrganization(id);
      if (categories.length > 0) {
        return res.status(400).json({
          error: "Cannot delete organization with categories",
          categories: categories.map(c => ({ id: c.id, name: c.name })),
        });
      }
      
      await storage.deleteOrganization(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting organization:", error);
      res.status(500).json({ error: error.message || "Failed to delete organization" });
    }
  });
  
  // ========== 운영자 권한 할당 API ==========
  
  // 사용자별 운영자 권한 조회
  app.get("/api/system-admin/users/:userId/operator-assignments", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { userId } = req.params;
      const assignments = await storage.getOperatorAssignmentsByUser(userId);
      res.json(assignments);
    } catch (error: any) {
      console.error("Error getting operator assignments:", error);
      res.status(500).json({ error: error.message || "Failed to get operator assignments" });
    }
  });
  
  // 운영자 권한 할당
  app.post("/api/system-admin/operator-assignments", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { userId, companyId, organizationId } = req.body;
      
      if (!userId) {
        return res.status(400).json({ error: "User ID is required" });
      }
      if (!companyId && !organizationId) {
        return res.status(400).json({ error: "Either company ID or organization ID is required" });
      }
      
      const assignment = await storage.createOperatorAssignment({
        userId,
        companyId: companyId || null,
        organizationId: organizationId || null,
      });
      
      res.json(assignment);
    } catch (error: any) {
      console.error("Error creating operator assignment:", error);
      res.status(500).json({ error: error.message || "Failed to create operator assignment" });
    }
  });
  
  // 운영자 권한 삭제
  app.delete("/api/system-admin/operator-assignments/:id", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteOperatorAssignment(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting operator assignment:", error);
      res.status(500).json({ error: error.message || "Failed to delete operator assignment" });
    }
  });
  
  // 사용자의 운영자 권한 전체 삭제
  app.delete("/api/system-admin/users/:userId/operator-assignments", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { userId } = req.params;
      await storage.deleteOperatorAssignmentsByUser(userId);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting operator assignments:", error);
      res.status(500).json({ error: error.message || "Failed to delete operator assignments" });
    }
  });
  
  // 사용자 소속 회사/조직 업데이트
  app.patch("/api/system-admin/users/:userId/organization", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { userId } = req.params;
      const { companyId, organizationId } = req.body;
      
      const user = await storage.updateUserCompanyOrganization(
        userId, 
        companyId || null, 
        organizationId || null
      );
      res.json(user);
    } catch (error: any) {
      console.error("Error updating user organization:", error);
      res.status(500).json({ error: error.message || "Failed to update user organization" });
    }
  });

  // ========== 시스템 설정 API (시스템 관리자 전용) ==========
  
  // 모든 시스템 설정 조회
  app.get("/api/system-admin/settings", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const settings = await storage.getSystemSettings();
      res.json(settings);
    } catch (error: any) {
      console.error("Error getting system settings:", error);
      res.status(500).json({ error: error.message || "Failed to get system settings" });
    }
  });

  // 카테고리별 시스템 설정 조회
  app.get("/api/system-admin/settings/:category", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { category } = req.params;
      const settings = await storage.getSystemSettingsByCategory(category);
      res.json(settings);
    } catch (error: any) {
      console.error("Error getting system settings by category:", error);
      res.status(500).json({ error: error.message || "Failed to get system settings" });
    }
  });

  // 시스템 설정 저장/수정 (Upsert)
  app.put("/api/system-admin/settings", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { category, key, value, description } = req.body;
      
      if (!category || !key) {
        return res.status(400).json({ error: "Category and key are required" });
      }
      
      const user = req.user as any;
      const setting = await storage.upsertSystemSetting({
        category,
        key,
        value: typeof value === 'object' ? JSON.stringify(value) : String(value),
        description,
        updatedBy: user?.id,
      });
      
      res.json(setting);
    } catch (error: any) {
      console.error("Error saving system setting:", error);
      res.status(500).json({ error: error.message || "Failed to save system setting" });
    }
  });

  // 여러 설정 일괄 저장
  app.put("/api/system-admin/settings/batch", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { settings } = req.body;
      
      if (!Array.isArray(settings)) {
        return res.status(400).json({ error: "Settings must be an array" });
      }
      
      const user = req.user as any;
      const savedSettings = [];
      
      for (const setting of settings) {
        const { category, key, value, description } = setting;
        
        if (!category || !key) {
          continue; // Skip invalid settings
        }
        
        const saved = await storage.upsertSystemSetting({
          category,
          key,
          value: typeof value === 'object' ? JSON.stringify(value) : String(value),
          description,
          updatedBy: user?.id,
        });
        savedSettings.push(saved);
      }
      
      res.json(savedSettings);
    } catch (error: any) {
      console.error("Error saving system settings batch:", error);
      res.status(500).json({ error: error.message || "Failed to save system settings" });
    }
  });

  // 시스템 설정 삭제
  app.delete("/api/system-admin/settings/:category/:key", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { category, key } = req.params;
      await storage.deleteSystemSetting(category, key);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting system setting:", error);
      res.status(500).json({ error: error.message || "Failed to delete system setting" });
    }
  });

  // API Key 상태 확인 (값은 반환하지 않고 설정 여부만 확인)
  app.get("/api/system-admin/api-keys-status", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const status = {
        gemini: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
        openai: !!process.env.OPENAI_API_KEY,
        elevenlabs: !!process.env.ELEVENLABS_API_KEY,
      };
      res.json(status);
    } catch (error: any) {
      console.error("Error checking API keys status:", error);
      res.status(500).json({ error: error.message || "Failed to check API keys status" });
    }
  });

  // ===== AI Usage Tracking APIs =====
  
  // 날짜를 해당 날짜의 끝(23:59:59.999)으로 설정하는 헬퍼 함수
  const setEndOfDay = (date: Date): Date => {
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    return endOfDay;
  };
  
  // AI 사용량 요약 조회
  app.get("/api/system-admin/ai-usage/summary", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      
      // Default: last 30 days
      let end = endDate ? new Date(endDate as string) : new Date();
      end = setEndOfDay(end); // 해당 날짜의 끝으로 설정
      const start = startDate ? new Date(startDate as string) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      const summary = await storage.getAiUsageSummary(start, end);
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.json(summary);
    } catch (error: any) {
      console.error("Error fetching AI usage summary:", error);
      res.status(500).json({ error: error.message || "Failed to fetch AI usage summary" });
    }
  });

  // 기능별 AI 사용량 조회
  app.get("/api/system-admin/ai-usage/by-feature", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      
      let end = endDate ? new Date(endDate as string) : new Date();
      end = setEndOfDay(end); // 해당 날짜의 끝으로 설정
      const start = startDate ? new Date(startDate as string) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      const usageByFeature = await storage.getAiUsageByFeature(start, end);
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.json(usageByFeature);
    } catch (error: any) {
      console.error("Error fetching AI usage by feature:", error);
      res.status(500).json({ error: error.message || "Failed to fetch AI usage by feature" });
    }
  });

  // 모델별 AI 사용량 조회
  app.get("/api/system-admin/ai-usage/by-model", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      
      let end = endDate ? new Date(endDate as string) : new Date();
      end = setEndOfDay(end); // 해당 날짜의 끝으로 설정
      const start = startDate ? new Date(startDate as string) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      const usageByModel = await storage.getAiUsageByModel(start, end);
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.json(usageByModel);
    } catch (error: any) {
      console.error("Error fetching AI usage by model:", error);
      res.status(500).json({ error: error.message || "Failed to fetch AI usage by model" });
    }
  });

  // 일별 AI 사용량 조회
  app.get("/api/system-admin/ai-usage/daily", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      
      let end = endDate ? new Date(endDate as string) : new Date();
      end = setEndOfDay(end); // 해당 날짜의 끝으로 설정
      const start = startDate ? new Date(startDate as string) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      const dailyUsage = await storage.getAiUsageDaily(start, end);
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.json(dailyUsage);
    } catch (error: any) {
      console.error("Error fetching daily AI usage:", error);
      res.status(500).json({ error: error.message || "Failed to fetch daily AI usage" });
    }
  });

  // 상세 AI 사용 로그 조회
  app.get("/api/system-admin/ai-usage/logs", isAuthenticated, isSystemAdmin, async (req, res) => {
    try {
      const { startDate, endDate, limit } = req.query;
      
      let end = endDate ? new Date(endDate as string) : new Date();
      end = setEndOfDay(end); // 해당 날짜의 끝으로 설정
      const start = startDate ? new Date(startDate as string) : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
      const logLimit = limit ? parseInt(limit as string) : 100;
      
      const logs = await storage.getAiUsageLogs(start, end, logLimit);
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.json(logs);
    } catch (error: any) {
      console.error("Error fetching AI usage logs:", error);
      res.status(500).json({ error: error.message || "Failed to fetch AI usage logs" });
    }
  });

  // ===== Difficulty Settings APIs (운영자/관리자 접근 가능) =====
  
  // 대화 난이도 설정 조회 (전체)
  app.get("/api/admin/difficulty-settings", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const settings = await storage.getSystemSettingsByCategory('difficulty');
      
      // 설정을 레벨별로 파싱하여 반환
      const difficultySettings: Record<number, any> = {};
      for (const setting of settings) {
        if (setting.key.startsWith('level_')) {
          const level = parseInt(setting.key.replace('level_', ''));
          try {
            difficultySettings[level] = JSON.parse(setting.value);
          } catch (e) {
            console.warn(`Failed to parse difficulty setting for level ${level}:`, e);
          }
        }
      }
      
      res.json(difficultySettings);
    } catch (error: any) {
      console.error("Error getting difficulty settings:", error);
      res.status(500).json({ error: error.message || "Failed to get difficulty settings" });
    }
  });
  
  // 특정 레벨의 난이도 설정 조회
  app.get("/api/admin/difficulty-settings/:level", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const level = parseInt(req.params.level);
      if (isNaN(level) || level < 1 || level > 4) {
        return res.status(400).json({ error: "Invalid level. Must be 1-4." });
      }
      
      const settings = await storage.getSystemSettingsByCategory('difficulty');
      const levelSetting = settings.find(s => s.key === `level_${level}`);
      
      if (levelSetting) {
        try {
          res.json(JSON.parse(levelSetting.value));
        } catch (e) {
          res.status(500).json({ error: "Failed to parse difficulty setting" });
        }
      } else {
        // 기본값 반환
        const { getDifficultyGuidelines } = await import('./services/conversationDifficultyPolicy');
        res.json(getDifficultyGuidelines(level));
      }
    } catch (error: any) {
      console.error("Error getting difficulty setting:", error);
      res.status(500).json({ error: error.message || "Failed to get difficulty setting" });
    }
  });
  
  // 난이도 설정 저장 (단일 레벨)
  app.put("/api/admin/difficulty-settings/:level", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const level = parseInt(req.params.level);
      if (isNaN(level) || level < 1 || level > 4) {
        return res.status(400).json({ error: "Invalid level. Must be 1-4." });
      }
      
      const { name, description, responseLength, tone, pressure, feedback, constraints } = req.body;
      
      // 유효성 검사
      if (!name || !description || !responseLength || !tone || !pressure || !feedback) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      
      const user = req.user as any;
      const settingValue = {
        level,
        name,
        description,
        responseLength,
        tone,
        pressure,
        feedback,
        constraints: constraints || []
      };
      
      const saved = await storage.upsertSystemSetting({
        category: 'difficulty',
        key: `level_${level}`,
        value: JSON.stringify(settingValue),
        description: `Difficulty level ${level} settings`,
        updatedBy: user?.id,
      });
      
      // 캐시 무효화 (있는 경우)
      const { invalidateDifficultyCache } = await import('./services/conversationDifficultyPolicy');
      invalidateDifficultyCache();
      
      res.json({ success: true, setting: settingValue });
    } catch (error: any) {
      console.error("Error saving difficulty setting:", error);
      res.status(500).json({ error: error.message || "Failed to save difficulty setting" });
    }
  });
  
  // 난이도 설정 일괄 저장 (모든 레벨)
  app.put("/api/admin/difficulty-settings", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const { settings } = req.body;
      
      if (!settings || typeof settings !== 'object') {
        return res.status(400).json({ error: "Settings must be an object with level keys" });
      }
      
      const user = req.user as any;
      const savedSettings: Record<number, any> = {};
      
      for (const [levelKey, setting] of Object.entries(settings)) {
        const level = parseInt(levelKey);
        if (isNaN(level) || level < 1 || level > 4) continue;
        
        const { name, description, responseLength, tone, pressure, feedback, constraints } = setting as any;
        
        if (!name || !description || !responseLength || !tone || !pressure || !feedback) {
          continue; // Skip invalid settings
        }
        
        const settingValue = {
          level,
          name,
          description,
          responseLength,
          tone,
          pressure,
          feedback,
          constraints: constraints || []
        };
        
        await storage.upsertSystemSetting({
          category: 'difficulty',
          key: `level_${level}`,
          value: JSON.stringify(settingValue),
          description: `Difficulty level ${level} settings`,
          updatedBy: user?.id,
        });
        
        savedSettings[level] = settingValue;
      }
      
      // 캐시 무효화
      const { invalidateDifficultyCache } = await import('./services/conversationDifficultyPolicy');
      invalidateDifficultyCache();
      
      res.json({ success: true, settings: savedSettings });
    } catch (error: any) {
      console.error("Error saving difficulty settings batch:", error);
      res.status(500).json({ error: error.message || "Failed to save difficulty settings" });
    }
  });
  
  // 난이도 설정 초기화 (기본값으로 복원)
  app.post("/api/admin/difficulty-settings/reset", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const user = req.user as any;
      const { getDefaultDifficultySettings, invalidateDifficultyCache } = await import('./services/conversationDifficultyPolicy');
      
      const defaultSettings = getDefaultDifficultySettings();
      
      for (const [level, setting] of Object.entries(defaultSettings)) {
        await storage.upsertSystemSetting({
          category: 'difficulty',
          key: `level_${level}`,
          value: JSON.stringify(setting),
          description: `Difficulty level ${level} settings (reset to default)`,
          updatedBy: user?.id,
        });
      }
      
      invalidateDifficultyCache();
      
      res.json({ success: true, settings: defaultSettings });
    } catch (error: any) {
      console.error("Error resetting difficulty settings:", error);
      res.status(500).json({ error: error.message || "Failed to reset difficulty settings" });
    }
  });

  // ===== Evaluation Criteria APIs (운영자/관리자 접근 가능) =====
  
  // 모든 평가 기준 세트 조회
  app.get("/api/admin/evaluation-criteria", isAuthenticated, isOperatorOrAdmin, async (req: any, res) => {
    try {
      const lang = req.query.lang as string | undefined;
      const criteriaSets = await storage.getAllEvaluationCriteriaSets();
      
      // If language is specified and not Korean (source), apply translations
      if (lang && lang !== 'ko') {
        const translatedSets = await Promise.all(criteriaSets.map(async (set) => {
          const translation = await storage.getEvaluationCriteriaSetTranslation(set.id, lang);
          if (translation) {
            return {
              ...set,
              name: translation.name || set.name,
              description: translation.description || set.description,
            };
          }
          return set;
        }));
        return res.json(translatedSets);
      }
      
      res.json(criteriaSets);
    } catch (error: any) {
      console.error("Error getting evaluation criteria sets:", error);
      res.status(500).json({ error: error.message || "Failed to get evaluation criteria sets" });
    }
  });
  
  // 활성화된 평가 기준 세트만 조회
  app.get("/api/admin/evaluation-criteria/active", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const criteriaSets = await storage.getActiveEvaluationCriteriaSets();
      res.json(criteriaSets);
    } catch (error: any) {
      console.error("Error getting active evaluation criteria sets:", error);
      res.status(500).json({ error: error.message || "Failed to get active evaluation criteria sets" });
    }
  });
  
  // 특정 평가 기준 세트 조회 (차원 포함)
  app.get("/api/admin/evaluation-criteria/:id", isAuthenticated, isOperatorOrAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const lang = req.query.lang as string | undefined;
      const criteriaSetWithDimensions = await storage.getEvaluationCriteriaSetWithDimensions(id);
      
      if (!criteriaSetWithDimensions) {
        return res.status(404).json({ error: "Evaluation criteria set not found" });
      }
      
      // Apply translations if language is specified and not Korean
      if (lang && lang !== 'ko') {
        const setTranslation = await storage.getEvaluationCriteriaSetTranslation(id, lang);
        
        // Translate dimensions
        const translatedDimensions = await Promise.all(
          (criteriaSetWithDimensions.dimensions || []).map(async (dim: any) => {
            const dimTranslation = await storage.getEvaluationDimensionTranslation(dim.id, lang);
            if (dimTranslation) {
              return {
                ...dim,
                name: dimTranslation.name || dim.name,
                description: dimTranslation.description || dim.description,
                scoringRubric: dimTranslation.scoringRubric || dim.scoringRubric,
              };
            }
            return dim;
          })
        );
        
        return res.json({
          ...criteriaSetWithDimensions,
          name: setTranslation?.name || criteriaSetWithDimensions.name,
          description: setTranslation?.description || criteriaSetWithDimensions.description,
          dimensions: translatedDimensions,
        });
      }
      
      res.json(criteriaSetWithDimensions);
    } catch (error: any) {
      console.error("Error getting evaluation criteria set:", error);
      res.status(500).json({ error: error.message || "Failed to get evaluation criteria set" });
    }
  });
  
  // 모든 평가 기준 세트 목록 조회 (시나리오 생성/수정 시 사용)
  app.get("/api/evaluation-criteria", isAuthenticated, async (req, res) => {
    try {
      const criteriaSets = await storage.getAllEvaluationCriteriaSets();
      const sanitized = criteriaSets.map((set: any) => ({
        ...set,
        dimensions: set.dimensions?.map(({ evaluationPrompt, ...dim }: any) => dim),
      }));
      res.json(sanitized);
    } catch (error: any) {
      console.error("Error getting evaluation criteria sets:", error);
      res.status(500).json({ error: error.message || "Failed to get evaluation criteria sets" });
    }
  });
  
  // 카테고리 또는 기본 평가 기준 세트 조회 (피드백 생성 시 사용)
  app.get("/api/evaluation-criteria/active", isAuthenticated, async (req, res) => {
    try {
      const { categoryId } = req.query;
      const criteriaSet = await storage.getActiveEvaluationCriteriaSetWithDimensions(categoryId as string | undefined);
      
      if (!criteriaSet) {
        return res.status(404).json({ error: "No active evaluation criteria set found" });
      }
      
      const sanitized = {
        ...criteriaSet,
        dimensions: (criteriaSet as any).dimensions?.map(({ evaluationPrompt, ...dim }: any) => dim),
      };
      res.json(sanitized);
    } catch (error: any) {
      console.error("Error getting active evaluation criteria set:", error);
      res.status(500).json({ error: error.message || "Failed to get active evaluation criteria set" });
    }
  });
  
  // 평가 기준 세트 생성
  app.post("/api/admin/evaluation-criteria", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const user = req.user as any;
      const { name, description, isDefault, isActive, categoryId, dimensions, autoTranslate } = req.body;
      
      if (!name || name.trim() === "") {
        return res.status(400).json({ error: "Name is required" });
      }
      
      // 기본 기준으로 설정하려면 기존 기본 기준 해제
      if (isDefault) {
        const existingDefault = await storage.getDefaultEvaluationCriteriaSet();
        if (existingDefault) {
          await storage.updateEvaluationCriteriaSet(existingDefault.id, { isDefault: false });
        }
      }
      
      // 기준 세트 생성
      const criteriaSet = await storage.createEvaluationCriteriaSet({
        name: name.trim(),
        description: description || null,
        isDefault: isDefault || false,
        isActive: isActive !== false,
        categoryId: categoryId || null,
        createdBy: user?.id || null,
      });
      
      // 차원 생성 (있는 경우)
      const createdDimensions = [];
      if (dimensions && Array.isArray(dimensions)) {
        for (let i = 0; i < dimensions.length; i++) {
          const dim = dimensions[i];
          const dimension = await storage.createEvaluationDimension({
            criteriaSetId: criteriaSet.id,
            key: dim.key,
            name: dim.name,
            description: dim.description || null,
            weight: dim.weight || 1,
            minScore: dim.minScore || 0,
            maxScore: dim.maxScore || 100,
            icon: dim.icon || '📊',
            color: dim.color || 'blue',
            displayOrder: dim.displayOrder ?? i,
            scoringRubric: dim.scoringRubric || null,
            evaluationPrompt: dim.evaluationPrompt || null,
            isActive: dim.isActive !== false,
          });
          createdDimensions.push(dimension);
        }
      }
      
      // Auto-translate if requested
      if (autoTranslate) {
        const sourceLocale = 'ko';
        const criteriaSetWithDims = { ...criteriaSet, dimensions: createdDimensions };
        
        const languages = await storage.getActiveSupportedLanguages();
        const targetLocales = languages.filter(l => l.code !== sourceLocale).map(l => l.code);
        
        const languageNames: Record<string, string> = {
          'ko': 'Korean (한국어)',
          'en': 'English',
          'ja': 'Japanese (日本語)',
          'zh': 'Chinese Simplified (简体中文)',
        };
        
        // Save original content first
        await storage.upsertEvaluationCriteriaSetTranslation({
          criteriaSetId: criteriaSet.id,
          locale: sourceLocale,
          sourceLocale: sourceLocale,
          isOriginal: true,
          name: criteriaSet.name,
          description: criteriaSet.description || null,
          isMachineTranslated: false,
          isReviewed: true,
        });
        
        for (const dim of createdDimensions) {
          await storage.upsertEvaluationDimensionTranslation({
            dimensionId: dim.id,
            locale: sourceLocale,
            sourceLocale: sourceLocale,
            isOriginal: true,
            name: dim.name,
            description: dim.description || null,
            scoringRubric: dim.scoringRubric || null,
            isMachineTranslated: false,
            isReviewed: true,
          });
        }
        
        // Translate to all other languages (async, non-blocking)
        const translateApiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
        if (translateApiKey) {
          const translateGenAI = new GoogleGenAI({ apiKey: translateApiKey });
          (async () => {
            for (const targetLocale of targetLocales) {
              try {
                const setPrompt = `Translate the following ${languageNames[sourceLocale] || sourceLocale} evaluation criteria set into ${languageNames[targetLocale] || targetLocale}. 
This is for a workplace communication training system. Maintain professional tone.
Return ONLY valid JSON.

Source:
Name: ${criteriaSet.name}
Description: ${criteriaSet.description || ''}

Return JSON: {"name": "translated name", "description": "translated description"}`;

                const setResult = await translateGenAI.models.generateContent({
                  model: 'gemini-2.5-flash',
                  contents: setPrompt,
                });
                const setResponse = setResult.text || '';
                const setJsonMatch = setResponse.match(/\{[\s\S]*\}/);
                if (setJsonMatch) {
                  const setTranslation = JSON.parse(setJsonMatch[0]);
                  await storage.upsertEvaluationCriteriaSetTranslation({
                    criteriaSetId: criteriaSet.id,
                    locale: targetLocale,
                    sourceLocale: sourceLocale,
                    isOriginal: false,
                    name: setTranslation.name,
                    description: setTranslation.description,
                    isMachineTranslated: true,
                    isReviewed: false,
                  });
                }
                
                for (const dim of createdDimensions) {
                  const rubricText = dim.scoringRubric?.map((r: any) => 
                    `Score ${r.score} (${r.label}): ${r.description}`
                  ).join('\n') || '';
                  
                  const dimPrompt = `Translate the following ${languageNames[sourceLocale] || sourceLocale} evaluation dimension into ${languageNames[targetLocale] || targetLocale}. 
This is for a workplace communication training system. Maintain professional tone.
Return ONLY valid JSON.

Source:
Name: ${dim.name}
Description: ${dim.description || ''}
Scoring Rubric:
${rubricText}

Return JSON: {
  "name": "translated name",
  "description": "translated description",
  "scoringRubric": [{"score": 1, "label": "label", "description": "description"}, ...]
}`;

                  const dimResult = await translateGenAI.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: dimPrompt,
                  });
                  const dimResponse = dimResult.text || '';
                  const dimJsonMatch = dimResponse.match(/\{[\s\S]*\}/);
                  if (dimJsonMatch) {
                    const dimTranslation = JSON.parse(dimJsonMatch[0]);
                    await storage.upsertEvaluationDimensionTranslation({
                      dimensionId: dim.id,
                      locale: targetLocale,
                      sourceLocale: sourceLocale,
                      isOriginal: false,
                      name: dimTranslation.name,
                      description: dimTranslation.description,
                      scoringRubric: dimTranslation.scoringRubric,
                      isMachineTranslated: true,
                      isReviewed: false,
                    });
                  }
                }
              } catch (e) {
                console.error(`Failed to auto-translate criteria set ${criteriaSet.id} to ${targetLocale}:`, e);
              }
            }
            console.log(`✅ Auto-translation completed for criteria set: ${criteriaSet.name}`);
          })();
        }
      }
      
      res.json({ ...criteriaSet, dimensions: createdDimensions });
    } catch (error: any) {
      console.error("Error creating evaluation criteria set:", error);
      res.status(500).json({ error: error.message || "Failed to create evaluation criteria set" });
    }
  });
  
  // 평가 기준 세트 수정
  app.put("/api/admin/evaluation-criteria/:id", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, isDefault, isActive, categoryId } = req.body;
      
      const existing = await storage.getEvaluationCriteriaSet(id);
      if (!existing) {
        return res.status(404).json({ error: "Evaluation criteria set not found" });
      }
      
      // 기본 기준으로 변경하려면 기존 기본 기준 해제
      if (isDefault && !existing.isDefault) {
        const existingDefault = await storage.getDefaultEvaluationCriteriaSet();
        if (existingDefault && existingDefault.id !== id) {
          await storage.updateEvaluationCriteriaSet(existingDefault.id, { isDefault: false });
        }
      }
      
      const updated = await storage.updateEvaluationCriteriaSet(id, {
        name: name?.trim(),
        description: description !== undefined ? description : undefined,
        isDefault: isDefault !== undefined ? isDefault : undefined,
        isActive: isActive !== undefined ? isActive : undefined,
        categoryId: categoryId !== undefined ? categoryId : undefined,
      });
      
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating evaluation criteria set:", error);
      res.status(500).json({ error: error.message || "Failed to update evaluation criteria set" });
    }
  });
  
  // 평가 기준 세트 삭제
  app.delete("/api/admin/evaluation-criteria/:id", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      
      const existing = await storage.getEvaluationCriteriaSet(id);
      if (!existing) {
        return res.status(404).json({ error: "Evaluation criteria set not found" });
      }
      
      await storage.deleteEvaluationCriteriaSet(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting evaluation criteria set:", error);
      res.status(500).json({ error: error.message || "Failed to delete evaluation criteria set" });
    }
  });
  
  // 기본 평가 기준 세트 설정
  app.post("/api/admin/evaluation-criteria/:id/set-default", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      
      const existing = await storage.getEvaluationCriteriaSet(id);
      if (!existing) {
        return res.status(404).json({ error: "Evaluation criteria set not found" });
      }
      
      await storage.setDefaultEvaluationCriteriaSet(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error setting default evaluation criteria set:", error);
      res.status(500).json({ error: error.message || "Failed to set default evaluation criteria set" });
    }
  });
  
  // ===== Evaluation Dimension APIs =====
  
  // 차원 추가
  app.post("/api/admin/evaluation-criteria/:criteriaSetId/dimensions", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const { criteriaSetId } = req.params;
      const { key, name, description, weight, minScore, maxScore, icon, color, displayOrder, scoringRubric, evaluationPrompt, isActive } = req.body;
      
      if (!key || !name) {
        return res.status(400).json({ error: "Key and name are required" });
      }
      
      // 기준 세트 존재 확인
      const criteriaSet = await storage.getEvaluationCriteriaSet(criteriaSetId);
      if (!criteriaSet) {
        return res.status(404).json({ error: "Evaluation criteria set not found" });
      }
      
      // 기존 차원 수 조회하여 displayOrder 기본값 설정
      const existingDimensions = await storage.getEvaluationDimensionsByCriteriaSet(criteriaSetId);
      
      const dimension = await storage.createEvaluationDimension({
        criteriaSetId,
        key,
        name,
        description: description || null,
        weight: weight || 1,
        minScore: minScore || 0,
        maxScore: maxScore || 100,
        icon: icon || null,
        color: color || null,
        displayOrder: displayOrder ?? existingDimensions.length,
        scoringRubric: scoringRubric || null,
        evaluationPrompt: evaluationPrompt || null,
        isActive: isActive !== false,
      });
      
      res.json(dimension);
    } catch (error: any) {
      console.error("Error creating evaluation dimension:", error);
      res.status(500).json({ error: error.message || "Failed to create evaluation dimension" });
    }
  });
  
  // 차원 수정
  app.put("/api/admin/evaluation-dimensions/:id", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      
      const existing = await storage.getEvaluationDimension(id);
      if (!existing) {
        return res.status(404).json({ error: "Evaluation dimension not found" });
      }
      
      const updated = await storage.updateEvaluationDimension(id, updates);
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating evaluation dimension:", error);
      res.status(500).json({ error: error.message || "Failed to update evaluation dimension" });
    }
  });
  
  // 차원 삭제
  app.delete("/api/admin/evaluation-dimensions/:id", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      
      const existing = await storage.getEvaluationDimension(id);
      if (!existing) {
        return res.status(404).json({ error: "Evaluation dimension not found" });
      }
      
      await storage.deleteEvaluationDimension(id);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting evaluation dimension:", error);
      res.status(500).json({ error: error.message || "Failed to delete evaluation dimension" });
    }
  });

  // TTS routes
  app.use("/api/tts", ttsRoutes);

  // 이미지 생성 라우트
  app.use("/api/image", imageGenerationRoutes);

  // GCS 미디어 라우트 (Signed URL)
  app.use("/api/media", mediaRoutes);

  // Object Storage routes (미디어 파일 영구 저장)
  registerObjectStorageRoutes(app);

  // Create sample data for development
  if (process.env.NODE_ENV === "development") {
    try {
      await createSampleData();
    } catch (error) {
      console.log("Sample data initialization:", error);
    }
  }

  // WebSocket server for OpenAI Realtime API
  const wss = new WebSocketServer({ 
    server: httpServer,
    path: '/api/realtime-voice'
  });

  wss.on('connection', async (ws: WebSocket, req) => {
    console.log('🎙️ New WebSocket connection for realtime voice');
    
    // Check if realtime voice service is available
    if (!realtimeVoiceService.isServiceAvailable()) {
      ws.send(JSON.stringify({ 
        type: 'error', 
        error: 'Realtime voice service is not available. OpenAI API key is not configured.' 
      }));
      ws.close(1011, 'Service unavailable');
      return;
    }
    
    // Parse query parameters from URL
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const conversationId = url.searchParams.get('conversationId');
    const scenarioId = url.searchParams.get('scenarioId');
    const personaId = url.searchParams.get('personaId');
    const token = url.searchParams.get('token');

    // Validate required parameters
    if (!conversationId || !scenarioId || !personaId) {
      ws.send(JSON.stringify({ 
        type: 'error', 
        error: 'Missing required parameters: conversationId, scenarioId, personaId' 
      }));
      ws.close(1008, 'Missing parameters');
      return;
    }

    // Authenticate user via token
    let userId: string;
    try {
      if (!token || token === 'null' || token === 'undefined') {
        throw new Error('인증 토큰이 없습니다. 다시 로그인해주세요.');
      }
      
      // Use same default as auth.ts for consistency
      const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
      
      const jwt = (await import('jsonwebtoken')).default;
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      userId = decoded.userId; // JWT payload uses 'userId', not 'id'
      console.log(`✅ User authenticated: ${userId}`);
    } catch (error) {
      console.error('Authentication failed:', error);
      ws.send(JSON.stringify({ 
        type: 'error', 
        error: 'Authentication failed: ' + (error instanceof Error ? error.message : 'Invalid token')
      }));
      ws.close(1008, 'Authentication failed');
      return;
    }

    // ✨ Verify persona_run ownership (새로운 구조)
    const personaRun = await storage.getPersonaRun(conversationId);
    if (!personaRun) {
      ws.send(JSON.stringify({ type: 'error', error: 'Conversation not found' }));
      ws.close();
      return;
    }

    const scenarioRun = await storage.getScenarioRun(personaRun.scenarioRunId);
    if (!scenarioRun || scenarioRun.userId !== userId) {
      ws.send(JSON.stringify({ type: 'error', error: 'Unauthorized access' }));
      ws.close();
      return;
    }

    // Create unique session ID
    const sessionId = `${userId}-${conversationId}-${Date.now()}`;

    try {
      // 사용자가 선택한 난이도 가져오기
      const userSelectedDifficulty = personaRun.difficulty || scenarioRun.difficulty || 2;
      console.log(`🎯 실시간 음성 세션 난이도: Level ${userSelectedDifficulty}`);
      
      // 사용자 언어 설정 가져오기
      const voiceUser = await storage.getUser(userId);
      const voiceUserLanguage = (voiceUser?.preferredLanguage as 'ko' | 'en' | 'ja' | 'zh') || 'ko';
      console.log(`🌐 실시간 음성 세션 언어: ${voiceUserLanguage}`);
      
      // Create realtime voice session
      await realtimeVoiceService.createSession(
        sessionId,
        conversationId,
        scenarioId,
        personaId,
        userId,
        ws,
        userSelectedDifficulty,
        voiceUserLanguage
      );

      console.log(`✅ Realtime voice session created: ${sessionId}`);

      // Handle incoming client messages
      ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          realtimeVoiceService.handleClientMessage(sessionId, message);
        } catch (error) {
          console.error('Error handling client message:', error);
          ws.send(JSON.stringify({ type: 'error', error: 'Invalid message format' }));
        }
      });

      // Handle connection close
      ws.on('close', () => {
        console.log(`🔌 WebSocket closed for session: ${sessionId}`);
        realtimeVoiceService.closeSession(sessionId);
      });

      // Handle errors
      ws.on('error', (error) => {
        console.error(`WebSocket error for session ${sessionId}:`, error);
        realtimeVoiceService.closeSession(sessionId);
      });

    } catch (error) {
      console.error('Error creating realtime voice session:', error);
      ws.send(JSON.stringify({ 
        type: 'error', 
        error: error instanceof Error ? error.message : 'Failed to create session' 
      }));
      ws.close();
    }
  });

  console.log('✅ WebSocket server initialized at /api/realtime-voice');
  
  // ================================
  // Translation Management API
  // ================================
  
  // Get all supported languages
  app.get("/api/languages", async (req, res) => {
    try {
      const languages = await storage.getActiveSupportedLanguages();
      res.json(languages);
    } catch (error) {
      console.error("Error fetching languages:", error);
      res.status(500).json({ message: "지원 언어 목록 조회 실패" });
    }
  });
  
  // Admin: Get all languages (including inactive)
  app.get("/api/admin/languages", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const languages = await storage.getSupportedLanguages();
      res.json(languages);
    } catch (error) {
      console.error("Error fetching languages:", error);
      res.status(500).json({ message: "지원 언어 목록 조회 실패" });
    }
  });
  
  // Admin: Create new language
  app.post("/api/admin/languages", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const { code, name, nativeName, displayOrder } = req.body;
      if (!code || !name || !nativeName) {
        return res.status(400).json({ message: "언어 코드, 이름, 네이티브 이름은 필수입니다" });
      }
      
      const language = await storage.createSupportedLanguage({
        code,
        name,
        nativeName,
        isActive: true,
        isDefault: false,
        displayOrder: displayOrder || 99,
      });
      res.json(language);
    } catch (error) {
      console.error("Error creating language:", error);
      res.status(500).json({ message: "언어 생성 실패" });
    }
  });
  
  // Admin: Update language
  app.put("/api/admin/languages/:code", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const { code } = req.params;
      const updates = req.body;
      const language = await storage.updateSupportedLanguage(code, updates);
      res.json(language);
    } catch (error) {
      console.error("Error updating language:", error);
      res.status(500).json({ message: "언어 수정 실패" });
    }
  });
  
  // Admin: Delete language
  app.delete("/api/admin/languages/:code", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const { code } = req.params;
      
      // 기본 언어(ko)는 삭제 불가
      if (code === 'ko') {
        return res.status(400).json({ message: "기본 언어(한국어)는 삭제할 수 없습니다" });
      }
      
      await storage.deleteSupportedLanguage(code);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting language:", error);
      res.status(500).json({ message: "언어 삭제 실패" });
    }
  });
  
  // ================================
  // Scenario Translations API
  // ================================
  
  // Get scenario translation for a specific locale
  app.get("/api/scenarios/:scenarioId/translations/:locale", async (req, res) => {
    try {
      const { scenarioId, locale } = req.params;
      const translation = await storage.getScenarioTranslation(scenarioId, locale);
      
      if (!translation) {
        return res.status(404).json({ message: "번역을 찾을 수 없습니다" });
      }
      
      res.json(translation);
    } catch (error) {
      console.error("Error fetching scenario translation:", error);
      res.status(500).json({ message: "시나리오 번역 조회 실패" });
    }
  });
  
  // Get all translations for a scenario
  app.get("/api/scenarios/:scenarioId/translations", async (req, res) => {
    try {
      const { scenarioId } = req.params;
      const translations = await storage.getScenarioTranslations(scenarioId);
      res.json(translations);
    } catch (error) {
      console.error("Error fetching scenario translations:", error);
      res.status(500).json({ message: "시나리오 번역 목록 조회 실패" });
    }
  });
  
  // Admin: Upsert scenario translation (시나리오별 페르소나 컨텍스트 번역 포함)
  app.put("/api/admin/scenarios/:scenarioId/translations/:locale", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const { scenarioId, locale } = req.params;
      const { 
        title, 
        description, 
        situation,
        timeline,
        stakes,
        playerRole, 
        objectives,
        skills,
        successCriteriaOptimal,
        successCriteriaGood,
        successCriteriaAcceptable,
        successCriteriaFailure,
        personaContexts, // 시나리오별 페르소나 컨텍스트 번역 (position, department, role, stance, goal, tradeoff)
        isMachineTranslated 
      } = req.body;
      
      if (!title) {
        return res.status(400).json({ message: "제목은 필수입니다" });
      }
      
      const translation = await storage.upsertScenarioTranslation({
        scenarioId,
        locale,
        title,
        description,
        situation,
        timeline,
        stakes,
        playerRole,
        objectives: objectives || null,
        skills: skills || null,
        successCriteriaOptimal,
        successCriteriaGood,
        successCriteriaAcceptable,
        successCriteriaFailure,
        personaContexts: personaContexts || null,
        isMachineTranslated: isMachineTranslated || false,
        isReviewed: false,
      });
      
      res.json(translation);
    } catch (error) {
      console.error("Error upserting scenario translation:", error);
      res.status(500).json({ message: "시나리오 번역 저장 실패" });
    }
  });
  
  // Admin: Mark translation as reviewed
  app.post("/api/admin/scenarios/:scenarioId/translations/:locale/review", isAuthenticated, isOperatorOrAdmin, async (req: any, res) => {
    try {
      const { scenarioId, locale } = req.params;
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({ message: "인증이 필요합니다" });
      }
      
      const translation = await storage.markScenarioTranslationReviewed(scenarioId, locale, userId);
      res.json(translation);
    } catch (error) {
      console.error("Error marking translation reviewed:", error);
      res.status(500).json({ message: "번역 검수 처리 실패" });
    }
  });
  
  // Admin: Delete scenario translation
  app.delete("/api/admin/scenarios/:scenarioId/translations/:locale", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const { scenarioId, locale } = req.params;
      
      if (locale === 'ko') {
        return res.status(400).json({ message: "기본 언어 번역은 삭제할 수 없습니다" });
      }
      
      await storage.deleteScenarioTranslation(scenarioId, locale);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting scenario translation:", error);
      res.status(500).json({ message: "시나리오 번역 삭제 실패" });
    }
  });
  
  // Admin: Generate AI translation for scenario (supports bidirectional translation)
  app.post("/api/admin/scenarios/:scenarioId/generate-translation", isAuthenticated, isOperatorOrAdmin, async (req: any, res) => {
    try {
      const { scenarioId } = req.params;
      const { targetLocale, sourceLocale = 'ko' } = req.body;
      
      if (!targetLocale) {
        return res.status(400).json({ message: "대상 언어가 필요합니다" });
      }
      
      if (sourceLocale === targetLocale) {
        return res.status(400).json({ message: "원문 언어와 대상 언어가 동일합니다" });
      }
      
      const allScenarios = await fileManager.getAllScenarios();
      const scenario = allScenarios.find(s => s.id === scenarioId);
      if (!scenario) {
        return res.status(404).json({ message: "시나리오를 찾을 수 없습니다" });
      }
      
      const languages = await storage.getActiveSupportedLanguages();
      const targetLang = languages.find(l => l.code === targetLocale);
      const sourceLang = languages.find(l => l.code === sourceLocale);
      if (!targetLang) {
        return res.status(400).json({ message: "지원하지 않는 대상 언어입니다" });
      }
      if (!sourceLang) {
        return res.status(400).json({ message: "지원하지 않는 원문 언어입니다" });
      }
      
      const languageNames: Record<string, string> = {
        'ko': 'Korean (한국어)',
        'en': 'English',
        'ja': 'Japanese (日本語)',
        'zh': 'Chinese Simplified (简体中文)',
      };
      
      let sourceData: any = {
        title: scenario.title,
        description: scenario.description,
        situation: (scenario as any).context?.situation || '',
        timeline: (scenario as any).context?.timeline || '',
        stakes: (scenario as any).context?.stakes || '',
        playerRole: '',
        objectives: (scenario as any).objectives || [],
        skills: (scenario as any).skills || [],
        successCriteriaOptimal: (scenario as any).successCriteria?.optimal || '',
        successCriteriaGood: (scenario as any).successCriteria?.good || '',
        successCriteriaAcceptable: (scenario as any).successCriteria?.acceptable || '',
        successCriteriaFailure: (scenario as any).successCriteria?.failure || '',
      };
      
      const playerRoleObj = (scenario as any).context?.playerRole;
      sourceData.playerRole = typeof playerRoleObj === 'object' 
        ? [playerRoleObj?.position, playerRoleObj?.department, playerRoleObj?.experience, playerRoleObj?.responsibility].filter(Boolean).join(' / ')
        : (playerRoleObj || '');
      
      // 시나리오의 페르소나 컨텍스트 데이터 추출
      const scenarioPersonas = (scenario as any).personas || [];
      const personaContextsSource = scenarioPersonas.map((p: any) => ({
        personaId: p.id || p.personaRef || '',
        personaName: p.name || p.id || '',
        position: p.position || '',
        department: p.department || '',
        role: p.role || '',
        stance: p.stance || '',
        goal: p.goal || '',
        tradeoff: p.tradeoff || '',
      })).filter((p: any) => p.personaId);
      sourceData.personaContexts = personaContextsSource;
      
      if (sourceLocale !== 'ko') {
        const sourceTranslation = await storage.getScenarioTranslation(scenarioId, sourceLocale);
        if (!sourceTranslation) {
          return res.status(400).json({ message: `원문 언어(${sourceLocale})의 번역이 존재하지 않습니다` });
        }
        sourceData = {
          title: sourceTranslation.title,
          description: sourceTranslation.description || '',
          situation: sourceTranslation.situation || '',
          timeline: sourceTranslation.timeline || '',
          stakes: sourceTranslation.stakes || '',
          playerRole: sourceTranslation.playerRole || '',
          objectives: sourceTranslation.objectives || [],
          skills: (sourceTranslation as any).skills || (scenario as any).skills || [],
          successCriteriaOptimal: sourceTranslation.successCriteriaOptimal || '',
          successCriteriaGood: sourceTranslation.successCriteriaGood || '',
          successCriteriaAcceptable: sourceTranslation.successCriteriaAcceptable || '',
          successCriteriaFailure: sourceTranslation.successCriteriaFailure || '',
          personaContexts: (sourceTranslation as any).personaContexts || personaContextsSource,
        };
      }
      
      // 페르소나 컨텍스트 프롬프트 구성
      const personaContextsPrompt = sourceData.personaContexts?.length > 0 
        ? `\nPersona Contexts (translate position, department, role, stance, goal, tradeoff for each persona):\n${JSON.stringify(sourceData.personaContexts, null, 2)}`
        : '';
      
      const personaContextsJsonFormat = sourceData.personaContexts?.length > 0
        ? `,
  "personaContexts": [
    {
      "personaId": "keep the original personaId unchanged",
      "position": "translated position",
      "department": "translated department",
      "role": "translated role",
      "stance": "translated stance",
      "goal": "translated goal",
      "tradeoff": "translated tradeoff"
    }
  ]`
        : '';

      const prompt = `Translate the following ${languageNames[sourceLocale] || sourceLocale} roleplay scenario into ${languageNames[targetLocale] || targetLocale}. 
Maintain the professional tone and context. Provide translations in JSON format.

Source scenario:
Title: ${sourceData.title}
Description: ${sourceData.description}
Situation: ${sourceData.situation}
Timeline: ${sourceData.timeline}
Stakes: ${sourceData.stakes}
Player Role: ${sourceData.playerRole}
Objectives: ${JSON.stringify(sourceData.objectives)}
Skills (Key Competencies): ${JSON.stringify(sourceData.skills)}
Success Criteria (Optimal): ${sourceData.successCriteriaOptimal}
Success Criteria (Good): ${sourceData.successCriteriaGood}
Success Criteria (Acceptable): ${sourceData.successCriteriaAcceptable}
Success Criteria (Failure): ${sourceData.successCriteriaFailure}${personaContextsPrompt}

Return ONLY valid JSON in this exact format:
{
  "title": "translated title",
  "description": "translated description",
  "situation": "translated situation",
  "timeline": "translated timeline",
  "stakes": "translated stakes",
  "playerRole": "translated player role",
  "objectives": ["translated objective 1", "translated objective 2"],
  "skills": ["translated skill 1", "translated skill 2"],
  "successCriteriaOptimal": "translated optimal criteria",
  "successCriteriaGood": "translated good criteria",
  "successCriteriaAcceptable": "translated acceptable criteria",
  "successCriteriaFailure": "translated failure criteria"${personaContextsJsonFormat}
}`;

      const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ message: "API 키가 설정되지 않았습니다" });
      }
      
      const genAI = new GoogleGenAI({ apiKey });
      const result = await genAI.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });
      
      const response = result.text || '';
      
      let translation;
      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          translation = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("JSON not found in response");
        }
      } catch (parseError) {
        console.error("Failed to parse AI translation response:", parseError);
        return res.status(500).json({ message: "AI 응답 파싱 실패" });
      }
      
      res.json({ success: true, translation });
    } catch (error) {
      console.error("Error generating scenario translation:", error);
      res.status(500).json({ message: "AI 번역 생성 실패" });
    }
  });

  // Auto-translate scenario to all supported languages at once
  app.post("/api/admin/scenarios/:scenarioId/auto-translate", isAuthenticated, isOperatorOrAdmin, async (req: any, res) => {
    try {
      const { scenarioId } = req.params;
      const { sourceLocale = 'ko' } = req.body;
      
      const allScenarios = await fileManager.getAllScenarios();
      const scenario = allScenarios.find(s => s.id === scenarioId);
      if (!scenario) {
        return res.status(404).json({ message: "시나리오를 찾을 수 없습니다" });
      }
      
      const languages = await storage.getActiveSupportedLanguages();
      const targetLocales = languages.filter(l => l.code !== sourceLocale).map(l => l.code);
      
      const languageNames: Record<string, string> = {
        'ko': 'Korean (한국어)',
        'en': 'English',
        'ja': 'Japanese (日本語)',
        'zh': 'Chinese Simplified (简体中文)',
      };
      
      let translatedCount = 0;
      
      // Save original content first
      const playerRoleObj = (scenario as any).context?.playerRole;
      const playerRoleStr = typeof playerRoleObj === 'object' 
        ? [playerRoleObj?.position, playerRoleObj?.department, playerRoleObj?.experience, playerRoleObj?.responsibility].filter(Boolean).join(' / ')
        : (playerRoleObj || '');
      
      const scenarioPersonas = (scenario as any).personas || [];
      const personaContexts = scenarioPersonas.map((p: any) => ({
        personaId: p.id || p.personaRef || '',
        position: p.position || '',
        department: p.department || '',
        role: p.role || '',
        stance: p.stance || '',
        goal: p.goal || '',
        tradeoff: p.tradeoff || '',
      })).filter((p: any) => p.personaId);
      
      await storage.upsertScenarioTranslation({
        scenarioId,
        locale: sourceLocale,
        sourceLocale,
        isOriginal: true,
        title: scenario.title,
        description: scenario.description,
        situation: (scenario as any).context?.situation || '',
        timeline: (scenario as any).context?.timeline || '',
        stakes: (scenario as any).context?.stakes || '',
        playerRole: playerRoleStr,
        objectives: (scenario as any).objectives || [],
        successCriteriaOptimal: (scenario as any).successCriteria?.optimal || '',
        successCriteriaGood: (scenario as any).successCriteria?.good || '',
        successCriteriaAcceptable: (scenario as any).successCriteria?.acceptable || '',
        successCriteriaFailure: (scenario as any).successCriteria?.failure || '',
        personaContexts,
        isMachineTranslated: false,
        isReviewed: true,
      });
      
      // Translate to all other languages
      for (const targetLocale of targetLocales) {
        const personaContextsPrompt = personaContexts.length > 0 
          ? `\nPersona Contexts (translate position, department, role, stance, goal, tradeoff for each persona):\n${JSON.stringify(personaContexts, null, 2)}`
          : '';
        
        const personaContextsJsonFormat = personaContexts.length > 0
          ? `,
  "personaContexts": [
    {
      "personaId": "keep the original personaId unchanged",
      "position": "translated position",
      "department": "translated department",
      "role": "translated role",
      "stance": "translated stance",
      "goal": "translated goal",
      "tradeoff": "translated tradeoff"
    }
  ]`
          : '';
        
        const prompt = `Translate the following ${languageNames[sourceLocale] || sourceLocale} roleplay scenario into ${languageNames[targetLocale] || targetLocale}. 
Maintain the professional tone and context. Provide translations in JSON format.

Source scenario:
Title: ${scenario.title}
Description: ${scenario.description}
Situation: ${(scenario as any).context?.situation || ''}
Timeline: ${(scenario as any).context?.timeline || ''}
Stakes: ${(scenario as any).context?.stakes || ''}
Player Role: ${playerRoleStr}
Objectives: ${JSON.stringify((scenario as any).objectives || [])}
Success Criteria - Optimal: ${(scenario as any).successCriteria?.optimal || ''}
Success Criteria - Good: ${(scenario as any).successCriteria?.good || ''}
Success Criteria - Acceptable: ${(scenario as any).successCriteria?.acceptable || ''}
Success Criteria - Failure: ${(scenario as any).successCriteria?.failure || ''}${personaContextsPrompt}

Return ONLY valid JSON:
{
  "title": "translated title",
  "description": "translated description",
  "situation": "translated situation",
  "timeline": "translated timeline",
  "stakes": "translated stakes",
  "playerRole": "translated player role",
  "objectives": ["translated objective 1", "translated objective 2"],
  "successCriteriaOptimal": "translated optimal criteria",
  "successCriteriaGood": "translated good criteria",
  "successCriteriaAcceptable": "translated acceptable criteria",
  "successCriteriaFailure": "translated failure criteria"${personaContextsJsonFormat}
}`;

        try {
          const response = await generateAIResponse('gemini-2.5-flash-preview-05-20', prompt, 'translate');
          const jsonMatch = response.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const translation = JSON.parse(jsonMatch[0]);
            await storage.upsertScenarioTranslation({
              scenarioId,
              locale: targetLocale,
              sourceLocale,
              isOriginal: false,
              title: translation.title,
              description: translation.description,
              situation: translation.situation,
              timeline: translation.timeline,
              stakes: translation.stakes,
              playerRole: translation.playerRole,
              objectives: translation.objectives || [],
              successCriteriaOptimal: translation.successCriteriaOptimal,
              successCriteriaGood: translation.successCriteriaGood,
              successCriteriaAcceptable: translation.successCriteriaAcceptable,
              successCriteriaFailure: translation.successCriteriaFailure,
              personaContexts: translation.personaContexts || personaContexts,
              isMachineTranslated: true,
              isReviewed: false,
            });
            translatedCount++;
          }
        } catch (e) {
          console.error(`Failed to translate scenario ${scenarioId} to ${targetLocale}:`, e);
        }
      }
      
      res.json({ 
        success: true, 
        message: `${translatedCount}개 언어로 번역 완료`,
        translatedCount,
        targetLocales 
      });
    } catch (error) {
      console.error("Error auto-translating scenario:", error);
      res.status(500).json({ message: "자동 번역 실패" });
    }
  });
  
  // ================================
  // Persona Translations API
  // ================================
  
  // Get persona translation for a specific locale
  app.get("/api/personas/:personaId/translations/:locale", async (req, res) => {
    try {
      const { personaId, locale } = req.params;
      const translation = await storage.getPersonaTranslation(personaId, locale);
      
      if (!translation) {
        return res.status(404).json({ message: "번역을 찾을 수 없습니다" });
      }
      
      res.json(translation);
    } catch (error) {
      console.error("Error fetching persona translation:", error);
      res.status(500).json({ message: "페르소나 번역 조회 실패" });
    }
  });
  
  // Get all translations for a persona
  app.get("/api/personas/:personaId/translations", async (req, res) => {
    try {
      const { personaId } = req.params;
      const translations = await storage.getPersonaTranslations(personaId);
      res.json(translations);
    } catch (error) {
      console.error("Error fetching persona translations:", error);
      res.status(500).json({ message: "페르소나 번역 목록 조회 실패" });
    }
  });
  
  // Admin: Upsert persona translation (마스터 페르소나 기본 정보만 - 시나리오 컨텍스트 제외)
  // 주의: position, department, role은 시나리오에서 정의되므로 scenarioTranslations.personaContexts에서 관리
  app.put("/api/admin/personas/:personaId/translations/:locale", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const { personaId, locale } = req.params;
      const { 
        name,
        personalityTraits, communicationStyle, motivation, fears, personalityDescription,
        education, previousExperience, majorProjects, expertise, background,
        isMachineTranslated, sourceLocale
      } = req.body;
      
      if (!name) {
        return res.status(400).json({ message: "이름은 필수입니다" });
      }
      
      const translation = await storage.upsertPersonaTranslation({
        personaId,
        sourceLocale: sourceLocale || 'ko',
        locale,
        name,
        personalityTraits,
        communicationStyle,
        motivation,
        fears,
        personalityDescription,
        education,
        previousExperience,
        majorProjects,
        expertise,
        background,
        isMachineTranslated: isMachineTranslated || false,
        isReviewed: false,
      });
      
      res.json(translation);
    } catch (error) {
      console.error("Error upserting persona translation:", error);
      res.status(500).json({ message: "페르소나 번역 저장 실패" });
    }
  });
  
  // Admin: Mark translation as reviewed
  app.post("/api/admin/personas/:personaId/translations/:locale/review", isAuthenticated, isOperatorOrAdmin, async (req: any, res) => {
    try {
      const { personaId, locale } = req.params;
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({ message: "인증이 필요합니다" });
      }
      
      const translation = await storage.markPersonaTranslationReviewed(personaId, locale, userId);
      res.json(translation);
    } catch (error) {
      console.error("Error marking translation reviewed:", error);
      res.status(500).json({ message: "번역 검수 처리 실패" });
    }
  });
  
  // Admin: Delete persona translation
  app.delete("/api/admin/personas/:personaId/translations/:locale", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const { personaId, locale } = req.params;
      
      if (locale === 'ko') {
        return res.status(400).json({ message: "기본 언어 번역은 삭제할 수 없습니다" });
      }
      
      await storage.deletePersonaTranslation(personaId, locale);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting persona translation:", error);
      res.status(500).json({ message: "페르소나 번역 삭제 실패" });
    }
  });
  
  // Admin: Generate AI translation for persona (supports bidirectional translation)
  app.post("/api/admin/personas/:personaId/generate-translation", isAuthenticated, isOperatorOrAdmin, async (req: any, res) => {
    try {
      const { personaId } = req.params;
      const { targetLocale, sourceLocale = 'ko' } = req.body;
      
      if (!targetLocale) {
        return res.status(400).json({ message: "대상 언어가 필요합니다" });
      }
      
      if (sourceLocale === targetLocale) {
        return res.status(400).json({ message: "원문 언어와 대상 언어가 동일합니다" });
      }
      
      const mbtiCache = GlobalMBTICache.getInstance();
      const persona = mbtiCache.getMBTIPersona(personaId);
      if (!persona) {
        return res.status(404).json({ message: "페르소나를 찾을 수 없습니다" });
      }
      
      const languages = await storage.getActiveSupportedLanguages();
      const targetLang = languages.find(l => l.code === targetLocale);
      const sourceLang = languages.find(l => l.code === sourceLocale);
      if (!targetLang) {
        return res.status(400).json({ message: "지원하지 않는 대상 언어입니다" });
      }
      if (!sourceLang) {
        return res.status(400).json({ message: "지원하지 않는 원문 언어입니다" });
      }
      
      const languageNames: Record<string, string> = {
        'ko': 'Korean (한국어)',
        'en': 'English',
        'ja': 'Japanese (日本語)',
        'zh': 'Chinese Simplified (简体中文)',
      };
      
      const personaData = persona as any;
      let sourceData: any = {
        mbti: personaData.mbti || personaId.replace('.json', '').toUpperCase(),
        personalityTraits: personaData.personality_traits || [],
        communicationStyle: personaData.communication_style || '',
        motivation: personaData.motivation || '',
        fears: personaData.fears || [],
        backgroundData: personaData.background || {},
        name: personaData.mbti || personaId.replace('.json', '').toUpperCase(),
        education: personaData.background?.social?.preference || '',
        previousExperience: personaData.background?.social?.behavior || '',
        majorProjects: personaData.background?.hobbies || [],
        expertise: personaData.background?.personal_values || [],
        background: '',
      };
      
      if (sourceLocale !== 'ko') {
        const sourceTranslation = await storage.getPersonaTranslation(personaId, sourceLocale);
        if (!sourceTranslation) {
          return res.status(400).json({ message: `원문 언어(${sourceLocale})의 번역이 존재하지 않습니다` });
        }
        sourceData = {
          ...sourceData,
          name: sourceTranslation.name || '',
          personalityTraits: sourceTranslation.personalityTraits || [],
          communicationStyle: sourceTranslation.communicationStyle || '',
          motivation: sourceTranslation.motivation || '',
          fears: sourceTranslation.fears || [],
          personalityDescription: sourceTranslation.personalityDescription || '',
          education: sourceTranslation.education || '',
          previousExperience: sourceTranslation.previousExperience || '',
          majorProjects: sourceTranslation.majorProjects || [],
          expertise: sourceTranslation.expertise || [],
          background: sourceTranslation.background || '',
        };
      }
      
      // 마스터 페르소나 번역: MBTI 성격 유형 정보만 번역 (position/department/role은 시나리오에서 정의)
      const prompt = `Translate the following ${languageNames[sourceLocale] || sourceLocale} MBTI persona information into ${languageNames[targetLocale] || targetLocale}. 
Maintain the professional tone and context appropriate for a workplace roleplay training system.
Note: This is for MASTER MBTI persona identity translation only. Position, department, role, stance, goal, tradeoff are scenario-specific and translated separately.

Source persona:
MBTI Type: ${sourceData.mbti}
${sourceLocale === 'ko' ? `Personality Traits: ${JSON.stringify(sourceData.personalityTraits)}
Communication Style: ${sourceData.communicationStyle}
Motivation: ${sourceData.motivation}
Fears: ${JSON.stringify(sourceData.fears)}
Background: ${JSON.stringify(sourceData.background)}` : `Name: ${sourceData.name}
Personality Traits: ${JSON.stringify(sourceData.personalityTraits)}
Communication Style: ${sourceData.communicationStyle}
Motivation: ${sourceData.motivation}
Fears: ${JSON.stringify(sourceData.fears)}
Personality Description: ${sourceData.personalityDescription}
Education: ${sourceData.education}
Previous Experience: ${sourceData.previousExperience}
Major Projects: ${JSON.stringify(sourceData.majorProjects)}
Expertise: ${JSON.stringify(sourceData.expertise)}
Background: ${sourceData.background}`}

Return ONLY valid JSON in this exact format (include all fields, use null for unavailable data):
{
  "name": "localized MBTI type name (e.g., 'The Analyst' for English, '分析家' for Chinese)",
  "personalityTraits": ["translated trait 1", "translated trait 2"],
  "communicationStyle": "translated communication style description",
  "motivation": "translated motivation",
  "fears": ["translated fear 1", "translated fear 2"],
  "personalityDescription": "translated personality description summary",
  "education": "translated education background",
  "previousExperience": "translated previous experience",
  "majorProjects": ["translated project 1", "translated project 2"],
  "expertise": ["translated expertise 1", "translated expertise 2"],
  "background": "translated background summary"
}`;

      const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ message: "API 키가 설정되지 않았습니다" });
      }
      
      const genAI = new GoogleGenAI({ apiKey });
      const result = await genAI.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });
      
      const response = result.text || '';
      
      let translation;
      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          translation = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("JSON not found in response");
        }
      } catch (parseError) {
        console.error("Failed to parse AI translation response:", parseError);
        return res.status(500).json({ message: "AI 응답 파싱 실패" });
      }
      
      res.json({ success: true, translation });
    } catch (error) {
      console.error("Error generating persona translation:", error);
      res.status(500).json({ message: "AI 번역 생성 실패" });
    }
  });
  
  // ================================
  // Category Translations API
  // ================================
  
  // Get category translation for a specific locale
  app.get("/api/categories/:categoryId/translations/:locale", async (req, res) => {
    try {
      const { categoryId, locale } = req.params;
      const translation = await storage.getCategoryTranslation(categoryId, locale);
      
      if (!translation) {
        return res.status(404).json({ message: "번역을 찾을 수 없습니다" });
      }
      
      res.json(translation);
    } catch (error) {
      console.error("Error fetching category translation:", error);
      res.status(500).json({ message: "카테고리 번역 조회 실패" });
    }
  });
  
  // Get all translations for a category
  app.get("/api/categories/:categoryId/translations", async (req, res) => {
    try {
      const { categoryId } = req.params;
      const translations = await storage.getCategoryTranslations(categoryId);
      res.json(translations);
    } catch (error) {
      console.error("Error fetching category translations:", error);
      res.status(500).json({ message: "카테고리 번역 목록 조회 실패" });
    }
  });
  
  // Admin: Upsert category translation
  app.put("/api/admin/categories/:categoryId/translations/:locale", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const { categoryId, locale } = req.params;
      const { name, description, isMachineTranslated } = req.body;
      
      if (!name) {
        return res.status(400).json({ message: "이름은 필수입니다" });
      }
      
      const translation = await storage.upsertCategoryTranslation({
        categoryId,
        locale,
        name,
        description,
        isMachineTranslated: isMachineTranslated || false,
        isReviewed: false,
      });
      
      res.json(translation);
    } catch (error) {
      console.error("Error upserting category translation:", error);
      res.status(500).json({ message: "카테고리 번역 저장 실패" });
    }
  });
  
  // Admin: Delete category translation
  app.delete("/api/admin/categories/:categoryId/translations/:locale", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const { categoryId, locale } = req.params;
      
      if (locale === 'ko') {
        return res.status(400).json({ message: "기본 언어 번역은 삭제할 수 없습니다" });
      }
      
      await storage.deleteCategoryTranslation(categoryId, locale);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting category translation:", error);
      res.status(500).json({ message: "카테고리 번역 삭제 실패" });
    }
  });
  
  // ================================
  // Translation Dashboard API
  // ================================
  
  // Get translation status for all content types
  app.get("/api/admin/translation-status", isAuthenticated, isOperatorOrAdmin, async (req, res) => {
    try {
      const languages = await storage.getActiveSupportedLanguages();
      const nonDefaultLanguages = languages.filter(l => !l.isDefault);
      
      const scenarios = await storage.getAllScenarios();
      const personas = await storage.getAllPersonas();
      const categories = await storage.getAllCategories();
      
      const scenarioTranslations: Record<string, { count: number; reviewed: number; machine: number }> = {};
      const personaTranslations: Record<string, { count: number; reviewed: number; machine: number }> = {};
      const categoryTranslations: Record<string, { count: number; reviewed: number; machine: number }> = {};
      
      for (const lang of nonDefaultLanguages) {
        scenarioTranslations[lang.code] = { count: 0, reviewed: 0, machine: 0 };
        personaTranslations[lang.code] = { count: 0, reviewed: 0, machine: 0 };
        categoryTranslations[lang.code] = { count: 0, reviewed: 0, machine: 0 };
      }
      
      for (const scenario of scenarios) {
        const translations = await storage.getScenarioTranslations(String(scenario.id));
        for (const t of translations) {
          if (scenarioTranslations[t.locale]) {
            scenarioTranslations[t.locale].count++;
            if (t.isReviewed) scenarioTranslations[t.locale].reviewed++;
            if (t.isMachineTranslated) scenarioTranslations[t.locale].machine++;
          }
        }
      }
      
      for (const persona of personas) {
        const translations = await storage.getPersonaTranslations(persona.id);
        for (const t of translations) {
          if (personaTranslations[t.locale]) {
            personaTranslations[t.locale].count++;
            if (t.isReviewed) personaTranslations[t.locale].reviewed++;
            if (t.isMachineTranslated) personaTranslations[t.locale].machine++;
          }
        }
      }
      
      for (const category of categories) {
        const translations = await storage.getCategoryTranslations(String(category.id));
        for (const t of translations) {
          if (categoryTranslations[t.locale]) {
            categoryTranslations[t.locale].count++;
            if (t.isReviewed) categoryTranslations[t.locale].reviewed++;
            if (t.isMachineTranslated) categoryTranslations[t.locale].machine++;
          }
        }
      }
      
      res.json({
        scenarios: {
          total: scenarios.length,
          translated: scenarioTranslations,
        },
        personas: {
          total: personas.length,
          translated: personaTranslations,
        },
        categories: {
          total: categories.length,
          translated: categoryTranslations,
        },
      });
    } catch (error) {
      console.error("Error fetching translation status:", error);
      res.status(500).json({ message: "번역 상태 조회 실패" });
    }
  });
  
  // Auto-translate a single evaluation criteria set with all its dimensions
  app.post("/api/admin/evaluation-criteria/:id/auto-translate", isAuthenticated, isOperatorOrAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { sourceLocale = 'ko' } = req.body;
      
      const criteriaSet = await storage.getEvaluationCriteriaSetWithDimensions(id);
      if (!criteriaSet) {
        return res.status(404).json({ message: "평가 기준 세트를 찾을 수 없습니다" });
      }
      
      const languages = await storage.getActiveSupportedLanguages();
      const targetLocales = languages.filter(l => l.code !== sourceLocale).map(l => l.code);
      
      const languageNames: Record<string, string> = {
        'ko': 'Korean (한국어)',
        'en': 'English',
        'ja': 'Japanese (日本語)',
        'zh': 'Chinese Simplified (简体中文)',
      };
      
      let translatedCount = 0;
      
      // Save original content first
      await storage.upsertEvaluationCriteriaSetTranslation({
        criteriaSetId: id,
        locale: sourceLocale,
        sourceLocale: sourceLocale,
        isOriginal: true,
        name: criteriaSet.name,
        description: criteriaSet.description || null,
        isMachineTranslated: false,
        isReviewed: true,
      });
      
      // Save original dimensions
      for (const dim of criteriaSet.dimensions || []) {
        await storage.upsertEvaluationDimensionTranslation({
          dimensionId: dim.id,
          locale: sourceLocale,
          sourceLocale: sourceLocale,
          isOriginal: true,
          name: dim.name,
          description: dim.description || null,
          scoringRubric: dim.scoringRubric || null,
          isMachineTranslated: false,
          isReviewed: true,
        });
      }
      
      // Get API key for direct Gemini API calls
      const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ message: "API 키가 설정되지 않았습니다" });
      }
      const genAI = new GoogleGenAI({ apiKey });
      
      // Translate to all other languages
      for (const targetLocale of targetLocales) {
        // Translate criteria set name and description
        const setPrompt = `Translate the following ${languageNames[sourceLocale] || sourceLocale} evaluation criteria set into ${languageNames[targetLocale] || targetLocale}. 
This is for a workplace communication training system. Maintain professional tone.
Return ONLY valid JSON.

Source:
Name: ${criteriaSet.name}
Description: ${criteriaSet.description || ''}

Return JSON: {"name": "translated name", "description": "translated description"}`;

        try {
          const setResult = await genAI.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: setPrompt,
          });
          const setResponse = setResult.text || '';
          const setJsonMatch = setResponse.match(/\{[\s\S]*\}/);
          if (setJsonMatch) {
            const setTranslation = JSON.parse(setJsonMatch[0]);
            await storage.upsertEvaluationCriteriaSetTranslation({
              criteriaSetId: id,
              locale: targetLocale,
              sourceLocale: sourceLocale,
              isOriginal: false,
              name: setTranslation.name,
              description: setTranslation.description,
              isMachineTranslated: true,
              isReviewed: false,
            });
            translatedCount++;
          }
        } catch (e) {
          console.error(`Failed to translate criteria set ${id} to ${targetLocale}:`, e);
        }
        
        // Translate each dimension
        for (const dim of criteriaSet.dimensions || []) {
          const rubricText = dim.scoringRubric?.map((r: any) => 
            `Score ${r.score} (${r.label}): ${r.description}`
          ).join('\n') || '';
          
          const dimPrompt = `Translate the following ${languageNames[sourceLocale] || sourceLocale} evaluation dimension into ${languageNames[targetLocale] || targetLocale}. 
This is for a workplace communication training system. Maintain professional tone.
Return ONLY valid JSON.

Source:
Name: ${dim.name}
Description: ${dim.description || ''}
Scoring Rubric:
${rubricText}

Return JSON: {
  "name": "translated name",
  "description": "translated description",
  "scoringRubric": [{"score": 1, "label": "label", "description": "description"}, ...]
}`;

          try {
            const dimResult = await genAI.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: dimPrompt,
            });
            const dimResponse = dimResult.text || '';
            const dimJsonMatch = dimResponse.match(/\{[\s\S]*\}/);
            if (dimJsonMatch) {
              const dimTranslation = JSON.parse(dimJsonMatch[0]);
              await storage.upsertEvaluationDimensionTranslation({
                dimensionId: dim.id,
                locale: targetLocale,
                sourceLocale: sourceLocale,
                isOriginal: false,
                name: dimTranslation.name,
                description: dimTranslation.description,
                scoringRubric: dimTranslation.scoringRubric,
                isMachineTranslated: true,
                isReviewed: false,
              });
              translatedCount++;
            }
          } catch (e) {
            console.error(`Failed to translate dimension ${dim.id} to ${targetLocale}:`, e);
          }
        }
      }
      
      res.json({ 
        success: true, 
        message: `${translatedCount}개 항목이 번역되었습니다`,
        translatedCount,
        targetLocales 
      });
    } catch (error) {
      console.error("Error auto-translating evaluation criteria:", error);
      res.status(500).json({ message: "자동 번역 생성 실패" });
    }
  });
  
  // Batch generate translations for a content type (supports bidirectional translation)
  app.post("/api/admin/generate-all-translations", isAuthenticated, isOperatorOrAdmin, async (req: any, res) => {
    try {
      const { targetLocale, contentType, sourceLocale = 'ko' } = req.body;
      
      if (!targetLocale || !contentType) {
        return res.status(400).json({ message: "대상 언어와 콘텐츠 타입이 필요합니다" });
      }
      
      if (sourceLocale === targetLocale) {
        return res.status(400).json({ message: "원문 언어와 대상 언어가 동일합니다" });
      }
      
      const languages = await storage.getActiveSupportedLanguages();
      const targetLang = languages.find(l => l.code === targetLocale);
      const sourceLang = languages.find(l => l.code === sourceLocale);
      if (!targetLang) {
        return res.status(400).json({ message: "지원하지 않는 대상 언어입니다" });
      }
      if (!sourceLang) {
        return res.status(400).json({ message: "지원하지 않는 원문 언어입니다" });
      }
      
      const languageNames: Record<string, string> = {
        'ko': 'Korean (한국어)',
        'en': 'English',
        'ja': 'Japanese (日本語)',
        'zh': 'Chinese Simplified (简体中文)',
      };
      
      let count = 0;
      
      if (contentType === 'scenarios') {
        const scenarios = await storage.getAllScenarios();
        for (const scenario of scenarios) {
          const existing = await storage.getScenarioTranslation(String(scenario.id), targetLocale);
          if (!existing) {
            let sourceTitle = scenario.title;
            let sourceDesc = scenario.description;
            
            if (sourceLocale !== 'ko') {
              const sourceTranslation = await storage.getScenarioTranslation(String(scenario.id), sourceLocale);
              if (!sourceTranslation) {
                console.log(`Skipping scenario ${scenario.id}: no source translation for ${sourceLocale}`);
                continue;
              }
              sourceTitle = sourceTranslation.title;
              sourceDesc = sourceTranslation.description || '';
            }
            
            const prompt = `Translate the following ${languageNames[sourceLocale] || sourceLocale} roleplay scenario into ${languageNames[targetLocale] || targetLocale}. 
Maintain the professional tone and context. Return ONLY valid JSON.

Source scenario:
Title: ${sourceTitle}
Description: ${sourceDesc}

Return JSON: {"title": "translated title", "description": "translated description"}`;

            try {
              const response = await generateAIResponse('gemini-2.5-flash-preview-05-20', prompt, 'translate');
              const jsonMatch = response.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                const translation = JSON.parse(jsonMatch[0]);
                await storage.upsertScenarioTranslation({
                  scenarioId: String(scenario.id),
                  locale: targetLocale,
                  title: translation.title,
                  description: translation.description,
                  isMachineTranslated: true,
                  isReviewed: false,
                  sourceLocale: sourceLocale,
                });
                count++;
              }
            } catch (e) {
              console.error(`Failed to translate scenario ${scenario.id}:`, e);
            }
          }
        }
      } else if (contentType === 'personas') {
        const personas = await storage.getAllPersonas();
        for (const persona of personas) {
          const existing = await storage.getPersonaTranslation(persona.id, targetLocale);
          if (!existing) {
            const personaData = persona as any;
            let sourceName = '';
            let sourceDesc = '';
            
            if (sourceLocale !== 'ko') {
              const sourceTranslation = await storage.getPersonaTranslation(persona.id, sourceLocale);
              if (!sourceTranslation) {
                console.log(`Skipping persona ${persona.id}: no source translation for ${sourceLocale}`);
                continue;
              }
              sourceName = sourceTranslation.name;
              sourceDesc = sourceTranslation.personalityDescription || '';
            }
            
            const prompt = sourceLocale === 'ko' 
              ? `Translate the following ${languageNames[sourceLocale] || sourceLocale} MBTI persona into ${languageNames[targetLocale] || targetLocale}. 
Return ONLY valid JSON.

Source: MBTI ${personaData.mbti}, Traits: ${JSON.stringify(personaData.personality_traits || [])}

Return JSON: {"name": "type name", "personalityDescription": "description"}`
              : `Translate the following ${languageNames[sourceLocale] || sourceLocale} MBTI persona into ${languageNames[targetLocale] || targetLocale}. 
Return ONLY valid JSON.

Source: Name: ${sourceName}, Description: ${sourceDesc}

Return JSON: {"name": "type name", "personalityDescription": "description"}`;

            try {
              const response = await generateAIResponse('gemini-2.5-flash-preview-05-20', prompt, 'translate');
              const jsonMatch = response.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                const translation = JSON.parse(jsonMatch[0]);
                await storage.upsertPersonaTranslation({
                  personaId: persona.id,
                  locale: targetLocale,
                  name: translation.name,
                  personalityDescription: translation.personalityDescription,
                  isMachineTranslated: true,
                  isReviewed: false,
                  sourceLocale: sourceLocale,
                });
                count++;
              }
            } catch (e) {
              console.error(`Failed to translate persona ${persona.id}:`, e);
            }
          }
        }
      } else if (contentType === 'categories') {
        const categories = await storage.getAllCategories();
        for (const category of categories) {
          const existing = await storage.getCategoryTranslation(String(category.id), targetLocale);
          if (!existing) {
            let sourceName = category.name;
            let sourceDesc = category.description || '';
            
            if (sourceLocale !== 'ko') {
              const sourceTranslation = await storage.getCategoryTranslation(String(category.id), sourceLocale);
              if (!sourceTranslation) {
                console.log(`Skipping category ${category.id}: no source translation for ${sourceLocale}`);
                continue;
              }
              sourceName = sourceTranslation.name;
              sourceDesc = sourceTranslation.description || '';
            }
            
            const prompt = `Translate the following ${languageNames[sourceLocale] || sourceLocale} category into ${languageNames[targetLocale] || targetLocale}. 
Return ONLY valid JSON.

Source: Name: ${sourceName}, Description: ${sourceDesc}

Return JSON: {"name": "translated name", "description": "translated description"}`;

            try {
              const response = await generateAIResponse('gemini-2.5-flash-preview-05-20', prompt, 'translate');
              const jsonMatch = response.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                const translation = JSON.parse(jsonMatch[0]);
                await storage.upsertCategoryTranslation({
                  categoryId: String(category.id),
                  locale: targetLocale,
                  name: translation.name,
                  description: translation.description,
                  isMachineTranslated: true,
                  isReviewed: false,
                  sourceLocale: sourceLocale,
                });
                count++;
              }
            } catch (e) {
              console.error(`Failed to translate category ${category.id}:`, e);
            }
          }
        }
      }
      
      res.json({ success: true, count });
    } catch (error) {
      console.error("Error generating batch translations:", error);
      res.status(500).json({ message: "일괄 번역 생성 실패" });
    }
  });
  
}

/**
 * 전략적 선택 분석을 수행하고 결과를 저장하는 함수
 */
async function performStrategicAnalysis(
  conversationId: string, 
  conversation: any,
  scenarioObj: any
): Promise<void> {
  console.log(`전략 분석 시작: ${conversationId}`);
  
  // PersonaSelection 데이터 조회
  const personaSelections = await storage.getPersonaSelections(conversationId);
  
  if (!personaSelections || personaSelections.length === 0) {
    console.log("전략적 선택 데이터가 없어 분석 건너뜀");
    return;
  }
  
  console.log(`발견된 persona selections: ${personaSelections.length}개`);
  
  // 기존 분석 결과가 있는지 확인
  const existingAnalysis = await storage.getSequenceAnalysis(conversationId);
  if (existingAnalysis) {
    console.log("기존 전략 분석 결과 존재, 건너뜀");
    return;
  }
  
  try {
    // PersonaStatus 배열 생성 (시나리오의 페르소나 정보 기반)
    const personaStatuses = scenarioObj.personas.map((persona: any, index: number) => ({
      personaId: persona.id,
      name: persona.name,
      currentMood: 'neutral' as const, // 기본값
      approachability: 3, // 기본값 (1-5)
      influence: persona.influence || 3, // 시나리오에서 가져오거나 기본값
      hasBeenContacted: personaSelections.some(sel => sel.personaId === persona.id),
      lastInteractionResult: undefined,
      availableInfo: persona.availableInfo || [`${persona.name}에 대한 정보`],
      keyRelationships: persona.keyRelationships || []
    }));
    
    // SequenceLogicAnalyzer 사용하여 분석 수행 
    const analysis = analyzeSelectionSequence(
      personaSelections, 
      personaStatuses, 
      scenarioObj
    );
    
    // 스키마 검증 후 분석 결과 저장
    const validationResult = insertSequenceAnalysisSchema.safeParse(analysis);
    if (!validationResult.success) {
      console.error("전략 분석 결과 스키마 검증 실패:", validationResult.error.issues);
      throw new Error("Invalid analysis data schema");
    }
    
    await storage.saveSequenceAnalysis(conversationId, validationResult.data);
    console.log("전략 분석 완료 및 저장");
    
  } catch (error) {
    console.error("전략 분석 수행 중 오류:", error);
    throw error;
  }
}

/**
 * SequenceLogicAnalyzer의 analyzeSelectionOrder 메서드를 구현
 * (클라이언트 코드를 서버로 이식)
 */
function analyzeSelectionSequence(
  selections: any[],
  personaStatuses: any[],
  scenarioContext: any
): any {
  const selectionOrder = selections.map((_, index) => index + 1);
  const optimalOrder = calculateOptimalOrder(personaStatuses, scenarioContext);
  
  // 각 평가 요소별 점수 계산
  const orderScore = evaluateOrderLogic(selections, personaStatuses, scenarioContext);
  const reasoningQuality = evaluateReasoningQuality(selections);
  const strategicThinking = evaluateStrategicThinking(selections, scenarioContext);
  const adaptability = evaluateAdaptability(selections, personaStatuses);
  
  const overallEffectiveness = Math.round(
    (orderScore + reasoningQuality + strategicThinking + adaptability) / 4
  );
  
  return {
    selectionOrder,
    optimalOrder,
    orderScore,
    reasoningQuality,
    strategicThinking,
    adaptability,
    overallEffectiveness,
    detailedAnalysis: generateDetailedAnalysis(selections, personaStatuses, scenarioContext),
    improvements: generateImprovements(orderScore, reasoningQuality, strategicThinking, adaptability),
    strengths: generateStrengths(orderScore, reasoningQuality, strategicThinking, adaptability)
  };
}

function calculateOptimalOrder(personaStatuses: any[], scenarioContext: any): number[] {
  const weights = {
    influence: 0.3,
    approachability: 0.25,
    information: 0.25,
    relationships: 0.2
  };
  
  const priorityScores = personaStatuses.map((persona, index) => ({
    index: index + 1,
    score: calculatePriorityScore(persona, weights, scenarioContext),
    persona
  }));
  
  return priorityScores
    .sort((a, b) => b.score - a.score)
    .map(item => item.index);
}

function calculatePriorityScore(persona: any, weights: any, scenarioContext: any): number {
  let score = 0;
  
  score += persona.influence * weights.influence;
  score += persona.approachability * weights.approachability;
  
  const infoScore = Math.min(5, persona.availableInfo.length) * weights.information;
  score += infoScore;
  
  const relationshipScore = Math.min(5, persona.keyRelationships.length) * weights.relationships;
  score += relationshipScore;
  
  const moodMultiplier = {
    'positive': 1.2,
    'neutral': 1.0,
    'negative': 0.8,
    'unknown': 0.9
  }[persona.currentMood] || 1.0;
  
  return score * moodMultiplier;
}

function evaluateOrderLogic(selections: any[], personaStatuses: any[], scenarioContext: any): number {
  const optimalOrder = calculateOptimalOrder(personaStatuses, scenarioContext);
  const actualOrder = selections.map((_, index) => index + 1);
  
  const correlation = calculateOrderCorrelation(actualOrder, optimalOrder);
  return Math.max(1, Math.min(5, Math.round(1 + (correlation + 1) * 2)));
}

function evaluateReasoningQuality(selections: any[]): number {
  let totalScore = 0;
  let validSelections = 0;
  
  for (const selection of selections) {
    if (selection.selectionReason && selection.selectionReason.trim().length > 0) {
      const reasoning = selection.selectionReason.toLowerCase();
      let score = 1;
      
      if (reasoning.includes('때문에') || reasoning.includes('위해') || reasoning.includes('통해')) {
        score += 1;
      }
      
      if (reasoning.includes('상황') || reasoning.includes('문제') || reasoning.includes('해결')) {
        score += 1;
      }
      
      if (selection.expectedOutcome && selection.expectedOutcome.trim().length > 10) {
        score += 1;
      }
      
      if (selection.selectionReason.length > 20) {
        score += 1;
      }
      
      totalScore += Math.min(5, score);
      validSelections++;
    }
  }
  
  return validSelections > 0 ? Math.round(totalScore / validSelections) : 1;
}

function evaluateStrategicThinking(selections: any[], scenarioContext: any): number {
  let strategicElements = 0;
  const maxElements = 5;
  
  if (selections.length > 1) {
    const hasProgression = selections.some((sel, idx) => 
      idx > 0 && (sel.selectionReason.includes('이전') || sel.selectionReason.includes('다음'))
    );
    if (hasProgression) strategicElements++;
  }
  
  const hasInfoGathering = selections.some(sel => 
    sel.selectionReason.includes('정보') || sel.selectionReason.includes('파악') || sel.expectedOutcome.includes('확인')
  );
  if (hasInfoGathering) strategicElements++;
  
  const hasInfluenceConsideration = selections.some(sel => 
    sel.selectionReason.includes('영향') || sel.selectionReason.includes('결정권') || sel.selectionReason.includes('권한')
  );
  if (hasInfluenceConsideration) strategicElements++;
  
  const hasTimeConsideration = selections.some(sel => 
    sel.selectionReason.includes('시간') || sel.selectionReason.includes('빠르게') || sel.selectionReason.includes('즉시')
  );
  if (hasTimeConsideration) strategicElements++;
  
  const hasRiskManagement = selections.some(sel => 
    sel.selectionReason.includes('위험') || sel.selectionReason.includes('안전') || sel.selectionReason.includes('신중')
  );
  if (hasRiskManagement) strategicElements++;
  
  return Math.max(1, Math.min(5, Math.round(1 + (strategicElements / maxElements) * 4)));
}

function evaluateAdaptability(selections: any[], personaStatuses: any[]): number {
  let adaptabilityScore = 3;
  
  for (let i = 0; i < selections.length; i++) {
    const selection = selections[i];
    const personaStatus = personaStatuses.find(p => p.personaId === selection.personaId);
    
    if (personaStatus) {
      if (personaStatus.approachability < 3 && i > 0) {
        adaptabilityScore += 0.5;
      }
      
      if (personaStatus.currentMood === 'negative' && 
          (selection.selectionReason.includes('신중') || selection.selectionReason.includes('조심'))) {
        adaptabilityScore += 0.5;
      }
    }
  }
  
  return Math.max(1, Math.min(5, Math.round(adaptabilityScore)));
}

function calculateOrderCorrelation(order1: number[], order2: number[]): number {
  if (order1.length !== order2.length) return 0;
  
  let concordantPairs = 0;
  let discordantPairs = 0;
  
  for (let i = 0; i < order1.length - 1; i++) {
    for (let j = i + 1; j < order1.length; j++) {
      const diff1 = order1[i] - order1[j];
      const diff2 = order2[i] - order2[j];
      
      if (diff1 * diff2 > 0) {
        concordantPairs++;
      } else if (diff1 * diff2 < 0) {
        discordantPairs++;
      }
    }
  }
  
  const totalPairs = concordantPairs + discordantPairs;
  return totalPairs === 0 ? 0 : (concordantPairs - discordantPairs) / totalPairs;
}

function generateDetailedAnalysis(selections: any[], personaStatuses: any[], scenarioContext: any): string {
  const optimalOrder = calculateOptimalOrder(personaStatuses, scenarioContext);
  const actualOrder = selections.map((_, index) => index + 1);
  
  let analysis = `선택된 대화 순서: ${actualOrder.join(' → ')}\n`;
  analysis += `권장 순서: ${optimalOrder.join(' → ')}\n\n`;
  
  selections.forEach((selection, index) => {
    const persona = personaStatuses.find(p => p.personaId === selection.personaId);
    analysis += `${index + 1}순위 선택 분석:\n`;
    analysis += `- 대상: ${persona?.name || '알 수 없음'}\n`;
    analysis += `- 선택 사유: ${selection.selectionReason}\n`;
    analysis += `- 기대 효과: ${selection.expectedOutcome}\n`;
    
    if (persona) {
      analysis += `- 대상자 특성: 영향력 ${persona.influence}/5, 접근성 ${persona.approachability}/5\n`;
    }
    analysis += '\n';
  });
  
  return analysis;
}

function generateImprovements(orderScore: number, reasoningQuality: number, strategicThinking: number, adaptability: number): string[] {
  const improvements: string[] = [];
  
  if (orderScore < 3) {
    improvements.push('대화 순서를 더 논리적으로 계획해보세요. 영향력과 접근성을 고려한 우선순위 설정이 필요합니다.');
  }
  
  if (reasoningQuality < 3) {
    improvements.push('선택 사유를 더 구체적이고 논리적으로 설명해주세요. "왜 이 사람을 선택했는지" 명확한 근거를 제시하세요.');
  }
  
  if (strategicThinking < 3) {
    improvements.push('전체적인 해결 전략을 수립하고, 단계별 목표를 설정해보세요. 정보 수집 → 의견 조율 → 결정권자 설득 등의 순서를 고려하세요.');
  }
  
  if (adaptability < 3) {
    improvements.push('상대방의 성격, 기분, 상황을 더 섬세하게 고려한 접근이 필요합니다.');
  }
  
  return improvements;
}

function generateStrengths(orderScore: number, reasoningQuality: number, strategicThinking: number, adaptability: number): string[] {
  const strengths: string[] = [];
  
  if (orderScore >= 4) {
    strengths.push('논리적이고 효율적인 대화 순서를 잘 계획했습니다.');
  }
  
  if (reasoningQuality >= 4) {
    strengths.push('선택에 대한 명확하고 설득력 있는 근거를 제시했습니다.');
  }
  
  if (strategicThinking >= 4) {
    strengths.push('전략적 사고와 단계적 접근 방식이 뛰어납니다.');
  }
  
  if (adaptability >= 4) {
    strengths.push('상황과 상대방의 특성을 잘 고려한 유연한 대응을 보였습니다.');
  }
  
  return strengths;
}
