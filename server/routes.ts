import type { Express } from "express";
import { createServer, type Server } from "http";
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
import { generateAIResponse, generateFeedback } from "./services/geminiService";
import { createSampleData } from "./sampleData";
import ttsRoutes from "./routes/tts.js";
import imageGenerationRoutes, { saveImageToLocal } from "./routes/imageGeneration.js";
import { fileManager } from "./services/fileManager";
import { generateScenarioWithAI, enhanceScenarioWithAI } from "./services/aiScenarioGenerator";
import { realtimeVoiceService } from "./services/realtimeVoiceService";

export async function registerRoutes(app: Express): Promise<Server> {
  // 이메일 기반 인증 시스템 설정
  const cookieParser = (await import('cookie-parser')).default;
  app.use(cookieParser());
  
  // 인증 시스템 설정
  const { setupAuth, isAuthenticated } = await import('./auth');
  setupAuth(app);

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

  // Helper function to generate and save feedback automatically
  async function generateAndSaveFeedback(
    conversationId: string, 
    conversation: any, 
    scenarioObj: any, 
    persona: any
  ) {
    // 이미 피드백이 있는지 확인
    const existingFeedback = await storage.getFeedbackByConversationId(conversationId);
    if (existingFeedback) {
      console.log(`피드백이 이미 존재함: ${conversationId}`);
      return existingFeedback;
    }

    console.log(`피드백 생성 중: ${conversationId}`);

    // 대화 시간과 발화량 계산
    const conversationDurationSeconds = conversation.completedAt 
      ? Math.floor((new Date(conversation.completedAt).getTime() - new Date(conversation.createdAt).getTime()) / 1000) 
      : 0;
    
    const conversationDuration = Math.floor(conversationDurationSeconds / 60);
    const userMessages = conversation.messages.filter((m: any) => m.sender === 'user');
    const totalUserWords = userMessages.reduce((sum: number, msg: any) => sum + msg.message.length, 0);
    const averageResponseTime = conversationDuration > 0 ? Math.round(conversationDuration * 60 / userMessages.length) : 0;

    // 피드백 데이터 생성
    const feedbackData = await generateFeedback(
      scenarioObj,
      conversation.messages,
      persona,
      conversation
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

    // EvaluationScore 배열 생성
    const evaluationScores = [
      {
        category: "clarityLogic",
        name: "명확성 & 논리성",
        score: feedbackData.scores.clarityLogic,
        feedback: "발언의 구조화, 핵심 전달, 모호성 최소화",
        icon: "🎯",
        color: "blue"
      },
      {
        category: "listeningEmpathy", 
        name: "경청 & 공감",
        score: feedbackData.scores.listeningEmpathy,
        feedback: "재진술·요약, 감정 인식, 우려 존중",
        icon: "👂",
        color: "green"
      },
      {
        category: "appropriatenessAdaptability",
        name: "적절성 & 상황 대응", 
        score: feedbackData.scores.appropriatenessAdaptability,
        feedback: "맥락 적합한 표현, 유연한 갈등 대응",
        icon: "⚡",
        color: "yellow"
      },
      {
        category: "persuasivenessImpact",
        name: "설득력 & 영향력",
        score: feedbackData.scores.persuasivenessImpact, 
        feedback: "논리적 근거, 사례 활용, 행동 변화 유도",
        icon: "🎪",
        color: "purple"
      },
      {
        category: "strategicCommunication",
        name: "전략적 커뮤니케이션",
        score: feedbackData.scores.strategicCommunication,
        feedback: "목표 지향적 대화, 협상·조율, 주도성", 
        icon: "🎲",
        color: "red"
      }
    ];

    // 피드백 저장
    const feedback = await storage.createFeedback({
      conversationId,
      overallScore: feedbackData.overallScore,
      scores: evaluationScores,
      detailedFeedback: feedbackData,
    });

    console.log(`피드백 자동 생성 완료: ${conversationId}`);

    // 전략적 선택 분석도 백그라운드에서 수행
    performStrategicAnalysis(conversationId, conversation, scenarioObj)
      .catch(error => {
        console.error("전략 분석 오류 (무시):", error);
      });

    return feedback;
  }

  // Create new conversation (scenario_run + persona_run 구조)
  app.post("/api/conversations", isAuthenticated, async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      
      console.log('📥 클라이언트 요청 body:', JSON.stringify(req.body));
      
      const validatedData = insertConversationSchema.parse(req.body);
      console.log('✅ 검증된 데이터:', JSON.stringify(validatedData));
      
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

        const aiResult = await generateAIResponse(
          scenarioObj as any,
          [],
          persona
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

      // ✨ scenario_run 조회하여 권한 확인
      const scenarioRun = await storage.getScenarioRun(personaRun.scenarioRunId);
      if (!scenarioRun || scenarioRun.userId !== userId) {
        return res.status(403).json({ error: "Unauthorized access" });
      }

      // ✨ chat_messages 조회
      const chatMessages = await storage.getChatMessagesByPersonaRun(personaRunId);

      // 레거시 conversations 구조로 변환하여 반환
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
      
      // 시나리오에서 페르소나 정보와 MBTI 특성 결합
      const scenarios = await fileManager.getAllScenarios();
      const scenarioObj = scenarios.find(s => s.id === scenarioRun.scenarioId);
      if (!scenarioObj) {
        throw new Error(`Scenario not found: ${scenarioRun.scenarioId}`);
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

      // 사용자가 선택한 난이도를 시나리오 객체에 적용
      const scenarioWithUserDifficulty = {
        ...scenarioObj,
        difficulty: personaRun.difficulty || scenarioRun.difficulty // 사용자가 선택한 난이도 사용
      };

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

      const aiResult = await generateAIResponse(
        scenarioWithUserDifficulty,
        messagesForAI,
        persona,
        isSkipTurn ? undefined : message
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
          emotionReason: msg.emotionReason || null
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
      console.log(`📊 Scenario runs for user ${userId}:`, scenarioRunsWithPersonas.map(sr => ({
        id: sr.id,
        scenarioId: sr.scenarioId,
        status: sr.status,
        personaRunsCount: sr.personaRuns?.length || 0,
        personaRuns: sr.personaRuns?.map(pr => ({ id: pr.id, personaId: pr.personaId, status: pr.status }))
      })));
      res.json(scenarioRunsWithPersonas);
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
      
      // 전략 회고 저장과 동시에 scenario_run 완료 처리
      const updated = await storage.updateScenarioRun(id, {
        strategyReflection,
        conversationOrder,
        status: 'completed',
        completedAt: new Date()
      });
      
      res.json({ success: true, scenarioRun: updated });
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

      // ✨ scenario_run 조회하여 권한 확인
      const scenarioRun = await storage.getScenarioRun(personaRun.scenarioRunId);
      if (!scenarioRun || scenarioRun.userId !== userId) {
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

      console.log(`대화 상태: ${conversation.status}, 턴 수: ${conversation.turnCount}`);

      // 완료되지 않은 대화에 대해서도 피드백 생성 허용 (3턴 이상이면)
      if (conversation.status !== "completed" && conversation.turnCount < 3) {
        console.log("대화가 아직 완료되지 않음");
        return res.status(400).json({ error: "Conversation not completed yet" });
      }

      // Check if feedback already exists
      const existingFeedback = await storage.getFeedbackByConversationId(req.params.id);
      if (existingFeedback) {
        console.log("기존 피드백 발견, 반환");
        return res.json(existingFeedback);
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

      // 대화 시간과 발화량 계산 (초 단위)
      const conversationDurationSeconds = conversation.completedAt 
        ? Math.floor((new Date(conversation.completedAt).getTime() - new Date(conversation.createdAt).getTime()) / 1000) 
        : 0; // 초 단위
      
      const conversationDuration = Math.floor(conversationDurationSeconds / 60); // 분 단위 (기존 로직 호환성)

      const userMessages = conversation.messages.filter(m => m.sender === 'user');
      const totalUserWords = userMessages.reduce((sum, msg) => sum + msg.message.length, 0);
      const averageResponseTime = conversationDuration > 0 ? Math.round(conversationDuration * 60 / userMessages.length) : 0; // 초 단위


      const feedbackData = await generateFeedback(
        scenarioObj, // 전체 시나리오 객체 전달
        conversation.messages,
        persona,
        conversation // 전략 회고 평가를 위해 conversation 전달
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
      feedbackData.conversationDurationMinutes = conversationDuration; // 분 단위도 포함
      feedbackData.averageResponseTime = averageResponseTime;
      feedbackData.timePerformance = timePerformance;

      console.log("피드백 데이터 생성 완료:", feedbackData);

      // EvaluationScore 배열 생성
      const evaluationScores = [
        {
          category: "clarityLogic",
          name: "명확성 & 논리성",
          score: feedbackData.scores.clarityLogic,
          feedback: "발언의 구조화, 핵심 전달, 모호성 최소화",
          icon: "🎯",
          color: "blue"
        },
        {
          category: "listeningEmpathy", 
          name: "경청 & 공감",
          score: feedbackData.scores.listeningEmpathy,
          feedback: "재진술·요약, 감정 인식, 우려 존중",
          icon: "👂",
          color: "green"
        },
        {
          category: "appropriatenessAdaptability",
          name: "적절성 & 상황 대응", 
          score: feedbackData.scores.appropriatenessAdaptability,
          feedback: "맥락 적합한 표현, 유연한 갈등 대응",
          icon: "⚡",
          color: "yellow"
        },
        {
          category: "persuasivenessImpact",
          name: "설득력 & 영향력",
          score: feedbackData.scores.persuasivenessImpact, 
          feedback: "논리적 근거, 사례 활용, 행동 변화 유도",
          icon: "🎪",
          color: "purple"
        },
        {
          category: "strategicCommunication",
          name: "전략적 커뮤니케이션",
          score: feedbackData.scores.strategicCommunication,
          feedback: "목표 지향적 대화, 협상·조율, 주도성", 
          icon: "🎲",
          color: "red"
        }
      ];

      const feedback = await storage.createFeedback({
        conversationId: null, // 레거시 지원 (nullable)
        personaRunId: personaRunId, // ✨ 새 구조: persona_run ID 저장
        overallScore: feedbackData.overallScore,
        scores: evaluationScores,
        detailedFeedback: feedbackData,
      });

      console.log("피드백 저장 완료");

      // ✨ PersonaRun의 score도 업데이트 (통계 계산용)
      await storage.updatePersonaRun(personaRunId, {
        score: feedbackData.overallScore
      });
      console.log(`✅ PersonaRun score updated: ${feedbackData.overallScore}`);

      // ✨ 모든 페르소나가 완료되었는지 확인하고 시나리오 자동 완료
      await checkAndCompleteScenario(personaRun.scenarioRunId);

      // 전략적 선택 분석 수행 (백그라운드 - non-blocking)
      performStrategicAnalysis(req.params.id, conversation, scenarioObj)
        .catch(error => {
          console.error("전략 분석 오류 (무시):", error);
        });

      res.json(feedback);
    } catch (error) {
      console.error("Feedback generation error:", error);
      res.status(500).json({ 
        error: "Failed to generate feedback",
        details: error instanceof Error ? error.message : String(error),
        stack: process.env.NODE_ENV === 'development' && error instanceof Error ? error.stack : undefined
      });
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

      // ✨ scenario_run 조회하여 권한 확인
      const scenarioRun = await storage.getScenarioRun(personaRun.scenarioRunId);
      if (!scenarioRun || scenarioRun.userId !== userId) {
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
          totalSessions: completedScenarioRuns.length, // ✨ scenario_run 기준
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
      
      // 2. 카테고리별 평균 점수 계산
      const categoryTotals = {
        clarityLogic: 0,
        listeningEmpathy: 0,
        appropriatenessAdaptability: 0,
        persuasivenessImpact: 0,
        strategicCommunication: 0,
      };
      
      userFeedbacks.forEach(feedback => {
        const scores = (feedback.detailedFeedback as any).scores || {};
        categoryTotals.clarityLogic += scores.clarityLogic || 0;
        categoryTotals.listeningEmpathy += scores.listeningEmpathy || 0;
        categoryTotals.appropriatenessAdaptability += scores.appropriatenessAdaptability || 0;
        categoryTotals.persuasivenessImpact += scores.persuasivenessImpact || 0;
        categoryTotals.strategicCommunication += scores.strategicCommunication || 0;
      });
      
      const categoryAverages = {
        clarityLogic: Number((categoryTotals.clarityLogic / userFeedbacks.length).toFixed(2)),
        listeningEmpathy: Number((categoryTotals.listeningEmpathy / userFeedbacks.length).toFixed(2)),
        appropriatenessAdaptability: Number((categoryTotals.appropriatenessAdaptability / userFeedbacks.length).toFixed(2)),
        persuasivenessImpact: Number((categoryTotals.persuasivenessImpact / userFeedbacks.length).toFixed(2)),
        strategicCommunication: Number((categoryTotals.strategicCommunication / userFeedbacks.length).toFixed(2)),
      };
      
      // 3. 시간순 스코어 이력 (성장 추이 분석용)
      const scoreHistory = userFeedbacks
        .map(f => {
          const createdDate = new Date(f.createdAt);
          return {
            date: f.createdAt.toISOString(),
            time: createdDate.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
            score: f.overallScore,
            conversationId: f.personaRunId || f.conversationId
          };
        })
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      
      // 4. 강점/약점 패턴 분석 (반복되는 항목 추출)
      const allStrengths = userFeedbacks.flatMap(f => 
        ((f.detailedFeedback as any).strengths || []) as string[]
      );
      const allImprovements = userFeedbacks.flatMap(f => 
        ((f.detailedFeedback as any).improvements || []) as string[]
      );
      
      // 빈도수 계산 함수
      const getTopItems = (items: string[], limit: number = 5) => {
        const frequency = items.reduce((acc, item) => {
          acc[item] = (acc[item] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        
        return Object.entries(frequency)
          .sort((a, b) => b[1] - a[1])
          .slice(0, limit)
          .map(([item, count]) => ({ text: item, count }));
      };
      
      const topStrengths = getTopItems(allStrengths, 5);
      const topImprovements = getTopItems(allImprovements, 5);
      
      // 5. 성장 추이 판단 (최근 5개 vs 이전)
      let progressTrend: 'improving' | 'stable' | 'declining' | 'neutral' = 'neutral';
      if (scoreHistory.length >= 6) {
        const recentScores = scoreHistory.slice(-5).map(s => s.score);
        const olderScores = scoreHistory.slice(0, -5).map(s => s.score);
        const recentAvg = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
        const olderAvg = olderScores.reduce((a, b) => a + b, 0) / olderScores.length;
        
        if (recentAvg > olderAvg + 5) progressTrend = 'improving';
        else if (recentAvg < olderAvg - 5) progressTrend = 'declining';
        else progressTrend = 'stable';
      }
      
      // 6. 종합 등급 계산
      const getOverallGrade = (score: number) => {
        if (score >= 90) return 'A+';
        if (score >= 80) return 'A';
        if (score >= 70) return 'B';
        if (score >= 60) return 'C';
        return 'D';
      };
      
      res.json({
        totalSessions: completedScenarioRuns.length, // ✨ 완료한 시나리오 실행 (세션 기준)
        averageScore,
        categoryAverages,
        scoreHistory,
        topStrengths,
        topImprovements,
        overallGrade: getOverallGrade(averageScore),
        progressTrend,
        lastSessionDate: userFeedbacks[userFeedbacks.length - 1]?.createdAt.toISOString(),
      });
    } catch (error) {
      console.error("Analytics summary error:", error);
      res.status(500).json({ error: "Failed to generate analytics summary" });
    }
  });

  // Admin Dashboard Analytics Routes
  app.get("/api/admin/analytics/overview", async (req, res) => {
    try {
      // ✨ 새 테이블 구조 사용
      const scenarioRuns = await storage.getAllScenarioRuns();
      const personaRuns = await storage.getAllPersonaRuns();
      const feedbacks = await storage.getAllFeedbacks();
      const scenarios = await fileManager.getAllScenarios();
      
      // Calculate basic statistics from scenario_runs
      const totalSessions = scenarioRuns.length;
      const completedSessions = scenarioRuns.filter(sr => sr.status === "completed").length;
      
      // Average score from feedbacks (linked to persona_runs)
      const averageScore = feedbacks.length > 0 
        ? Math.round(feedbacks.reduce((acc, f) => acc + f.overallScore, 0) / feedbacks.length)
        : 0;
      
      // Scenario popularity - count scenario_runs grouped by scenarioId
      const scenarioStats = scenarioRuns.reduce((acc, run) => {
        const scenario = scenarios.find(s => s.id === run.scenarioId);
        const scenarioName = scenario?.title || run.scenarioId;
        acc[run.scenarioId] = {
          count: (acc[run.scenarioId]?.count || 0) + 1,
          name: scenarioName,
          difficulty: scenario?.difficulty || 2
        };
        return acc;
      }, {} as Record<string, { count: number; name: string; difficulty: number }>);
      
      // MBTI 사용 분석 - persona_runs의 mbtiType 사용
      const mbtiUsage = personaRuns.reduce((acc, pr) => {
        if (pr.mbtiType) {
          const mbtiKey = pr.mbtiType.toUpperCase();
          acc[mbtiKey] = (acc[mbtiKey] || 0) + 1;
        }
        return acc;
      }, {} as Record<string, number>);
      
      // Completion rate
      const completionRate = totalSessions > 0 
        ? Math.round((completedSessions / totalSessions) * 100)
        : 0;
        
      res.json({
        totalSessions,
        completedSessions,
        averageScore,
        completionRate,
        scenarioStats,
        mbtiUsage,
        totalScenarios: scenarios.length
      });
    } catch (error) {
      console.error("Error getting analytics overview:", error);
      res.status(500).json({ error: "Failed to get analytics overview" });
    }
  });

  app.get("/api/admin/analytics/performance", async (req, res) => {
    try {
      // ✨ 새 테이블 구조 사용
      const scenarioRuns = await storage.getAllScenarioRuns();
      const personaRuns = await storage.getAllPersonaRuns();
      const feedbacks = await storage.getAllFeedbacks();
      const scenarios = await fileManager.getAllScenarios();
      
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
      
      // Scenario performance - scenarioRuns & personaRuns 기반
      const scenarioPerformance: Record<string, { scores: number[]; name: string; difficulty: number; personaCount: number }> = {};
      
      for (const run of scenarioRuns.filter(sr => sr.status === "completed")) {
        const scenario = scenarios.find(s => s.id === run.scenarioId);
        
        // 이 scenarioRun에 속한 personaRuns의 피드백 수집
        const runPersonas = personaRuns.filter(pr => pr.scenarioRunId === run.id);
        for (const pr of runPersonas) {
          const feedback = feedbacks.find(f => f.personaRunId === pr.id);
          if (feedback) {
            if (!scenarioPerformance[run.scenarioId]) {
              scenarioPerformance[run.scenarioId] = {
                scores: [],
                name: scenario?.title || run.scenarioId,
                difficulty: scenario?.difficulty || 2,
                personaCount: Array.isArray(scenario?.personas) ? scenario.personas.length : 0
              };
            }
            scenarioPerformance[run.scenarioId].scores.push(feedback.overallScore);
          }
        }
      }
      
      // Calculate scenario averages
      Object.keys(scenarioPerformance).forEach(scenarioId => {
        const scores = scenarioPerformance[scenarioId].scores;
        (scenarioPerformance[scenarioId] as any) = {
          ...scenarioPerformance[scenarioId],
          average: scores.length > 0 ? Math.round(scores.reduce((acc, score) => acc + score, 0) / scores.length) : 0,
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
      
      res.json({
        scoreRanges,
        categoryPerformance,
        scenarioPerformance,
        mbtiPerformance
      });
    } catch (error) {
      console.error("Error getting performance analytics:", error);
      res.status(500).json({ error: "Failed to get performance analytics" });
    }
  });

  app.get("/api/admin/analytics/trends", async (req, res) => {
    try {
      // ✨ 새 테이블 구조 사용
      const scenarioRuns = await storage.getAllScenarioRuns();
      const feedbacks = await storage.getAllFeedbacks();
      
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

  // 메인 사용자용 시나리오/페르소나 API
  app.get("/api/scenarios", async (req, res) => {
    try {
      const scenarios = await fileManager.getAllScenarios();
      res.json(scenarios);
    } catch (error) {
      console.error("Failed to fetch scenarios:", error);
      res.status(500).json({ error: "Failed to fetch scenarios" });
    }
  });

  // ❌ 비효율적인 /api/personas 엔드포인트 제거됨 
  // (34개 전체 시나리오 처리 방지 최적화)
  // 이제 시나리오별 개별 페르소나 처리만 사용

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

      // 자동으로 시나리오 이미지 생성 및 로컬 저장
      let scenarioImage = null;
      try {
        const { GoogleGenAI } = await import("@google/genai");
        const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY });
        
        const imagePrompt = `A professional, cinematic business scene representing "${result.scenario.title}". Context: ${result.scenario.description}. Industry: ${industry || 'General business'}. Style: Clean, corporate, professional illustration with modern design elements, suitable for business training materials. Colors: Professional palette with blues, grays, and accent colors.`;
        
        console.log(`🎨 Gemini 시나리오 이미지 생성 시도: ${result.scenario.title}`);
        
        const imageResponse = await ai.models.generateContent({
          model: "gemini-2.5-flash-image-preview",
          contents: [{ role: 'user', parts: [{ text: imagePrompt }] }]
        });
        
        // 응답에서 이미지 데이터 추출
        let base64ImageUrl = null;
        if (imageResponse.candidates && imageResponse.candidates[0] && imageResponse.candidates[0].content && imageResponse.candidates[0].content.parts) {
          for (const part of imageResponse.candidates[0].content.parts) {
            if (part.inlineData) {
              const imageData = part.inlineData;
              base64ImageUrl = `data:${imageData.mimeType};base64,${imageData.data}`;
              console.log('✅ AI 시나리오 이미지 자동 생성 성공');
              break;
            }
          }
        }
        
        // 생성된 이미지를 로컬에 저장
        if (base64ImageUrl) {
          scenarioImage = await saveImageToLocal(base64ImageUrl, result.scenario.title);
        }
        
      } catch (error) {
        console.warn('시나리오 이미지 자동 생성 실패:', error);
        // 이미지 생성 실패해도 시나리오 생성은 계속 진행
      }

      // AI 생성된 시나리오에 페르소나 객체와 이미지를 포함하여 저장
      const scenarioWithPersonas = {
        ...result.scenario,
        image: scenarioImage, // 자동 생성된 이미지 추가
        personas: result.personas // 페르소나 객체를 직접 포함
      };
      
      const savedScenario = await fileManager.createScenario(scenarioWithPersonas);

      res.json({
        scenario: savedScenario,
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
  
  // 시나리오 관리 API
  app.get("/api/admin/scenarios", async (req, res) => {
    try {
      const scenarios = await fileManager.getAllScenarios();
      res.json(scenarios);
    } catch (error) {
      console.error("Error getting scenarios:", error);
      res.status(500).json({ error: "Failed to get scenarios" });
    }
  });

  app.post("/api/admin/scenarios", async (req, res) => {
    try {
      const scenario = await fileManager.createScenario(req.body);
      res.json(scenario);
    } catch (error) {
      console.error("Error creating scenario:", error);
      res.status(500).json({ error: "Failed to create scenario" });
    }
  });

  app.put("/api/admin/scenarios/:id", async (req, res) => {
    try {
      const scenario = await fileManager.updateScenario(req.params.id, req.body);
      res.json(scenario);
    } catch (error) {
      console.error("Error updating scenario:", error);
      res.status(500).json({ error: "Failed to update scenario" });
    }
  });

  app.delete("/api/admin/scenarios/:id", async (req, res) => {
    try {
      await fileManager.deleteScenario(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting scenario:", error);
      res.status(500).json({ error: "Failed to delete scenario" });
    }
  });

  // 페르소나 관리 API
  app.get("/api/admin/personas", async (req, res) => {
    try {
      const personas = await fileManager.getAllMBTIPersonas();
      res.json(personas);
    } catch (error) {
      console.error("Error getting MBTI personas:", error);
      res.status(500).json({ error: "Failed to get MBTI personas" });
    }
  });

  app.post("/api/admin/personas", async (req, res) => {
    try {
      const persona = await fileManager.createMBTIPersona(req.body);
      res.json(persona);
    } catch (error) {
      console.error("Error creating MBTI persona:", error);
      res.status(500).json({ error: "Failed to create MBTI persona" });
    }
  });

  app.put("/api/admin/personas/:id", async (req, res) => {
    try {
      const persona = await fileManager.updateMBTIPersona(req.params.id, req.body);
      res.json(persona);
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

  // TTS routes
  app.use("/api/tts", ttsRoutes);

  // 이미지 생성 라우트
  app.use("/api/image", imageGenerationRoutes);

  // Create sample data for development
  if (process.env.NODE_ENV === "development") {
    try {
      await createSampleData();
    } catch (error) {
      console.log("Sample data initialization:", error);
    }
  }

  const httpServer = createServer(app);
  
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
      // Create realtime voice session
      await realtimeVoiceService.createSession(
        sessionId,
        conversationId,
        scenarioId,
        personaId,
        userId,
        ws
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
  
  return httpServer;
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
