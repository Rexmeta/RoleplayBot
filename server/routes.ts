import type { Express } from "express";
import { createServer, type Server } from "http";
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

export async function registerRoutes(app: Express): Promise<Server> {
  // 이메일 기반 인증 시스템 설정
  const cookieParser = (await import('cookie-parser')).default;
  app.use(cookieParser());
  
  // 인증 시스템 설정
  const { setupAuth } = await import('./auth');
  setupAuth(app);

  // Create new conversation
  app.post("/api/conversations", async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "인증이 필요합니다" });
      }
      
      const validatedData = insertConversationSchema.parse(req.body);
      const conversation = await storage.createConversation({ ...validatedData, userId });
      
      // 첫 번째 AI 메시지 자동 생성
      try {
        // personaId가 있으면 사용하고, 없으면 기존 scenarioId 사용 (하위 호환성)
        const personaId = conversation.personaId || conversation.scenarioId;
        
        // 시나리오에서 페르소나 정보와 MBTI 특성 결합
        const scenarios = await fileManager.getAllScenarios();
        const scenarioObj = scenarios.find(s => s.id === conversation.scenarioId);
        if (!scenarioObj) {
          throw new Error(`Scenario not found: ${conversation.scenarioId}`);
        }
        
        // 시나리오에서 해당 페르소나 객체 찾기
        const scenarioPersona = scenarioObj.personas.find((p: any) => p.id === personaId);
        if (!scenarioPersona) {
          throw new Error(`Persona not found in scenario: ${personaId}`);
        }
        
        // ⚡ 최적화: 특정 MBTI만 로드 (전체 페르소나 로드 방지)
        const mbtiType = scenarioPersona.personaRef?.replace('.json', '');
        const mbtiPersona = mbtiType ? await fileManager.getPersonaByMBTI(mbtiType) : null;
        
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


        const aiResult = await generateAIResponse(
          scenarioObj, // 전체 시나리오 객체 전달
          [],
          persona
        );

        const aiMessage = {
          sender: "ai" as const,
          message: aiResult.content,
          timestamp: new Date().toISOString(),
          emotion: aiResult.emotion,
          emotionReason: aiResult.emotionReason,
        };

        // 첫 번째 AI 메시지로 대화 업데이트
        const updatedConversation = await storage.updateConversation(conversation.id, {
          messages: [aiMessage],
          turnCount: 0
        });

        res.json(updatedConversation);
      } catch (aiError) {
        console.error("AI 초기 메시지 생성 실패:", aiError);
        // AI 메시지 생성 실패해도 대화는 생성되도록 함
        res.json(conversation);
      }
    } catch (error) {
      res.status(400).json({ error: "Invalid conversation data" });
    }
  });

  // Get all conversations for the current user
  app.get("/api/conversations", async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "인증이 필요합니다" });
      }
      
      const conversations = await storage.getUserConversations(userId);
      res.json(conversations);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  // Get conversation by ID
  app.get("/api/conversations/:id", async (req, res) => {
    try {
      const conversation = await storage.getConversation(req.params.id);
      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }
      res.json(conversation);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch conversation" });
    }
  });

  // Send message and get AI response
  app.post("/api/conversations/:id/messages", async (req, res) => {
    try {
      const { message } = req.body;
      if (typeof message !== "string") {
        return res.status(400).json({ error: "Message must be a string" });
      }
      
      // 빈 메시지는 건너뛰기 기능으로 허용
      const isSkipTurn = message.trim() === "";

      const conversation = await storage.getConversation(req.params.id);
      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      if (conversation.status === "completed") {
        return res.status(400).json({ error: "Conversation already completed" });
      }

      // 건너뛰기가 아닌 경우에만 사용자 메시지 추가
      let updatedMessages = conversation.messages;
      if (!isSkipTurn) {
        const userMessage = {
          sender: "user" as const,
          message,
          timestamp: new Date().toISOString(),
        };
        updatedMessages = [...conversation.messages, userMessage];
      }

      const newTurnCount = conversation.turnCount + 1;

      // Generate AI response
      // personaId가 있으면 사용하고, 없으면 기존 scenarioId 사용 (하위 호환성)
      const personaId = conversation.personaId || conversation.scenarioId;
      
      // 시나리오에서 페르소나 정보와 MBTI 특성 결합
      const scenarios = await fileManager.getAllScenarios();
      const scenarioObj = scenarios.find(s => s.id === conversation.scenarioId);
      if (!scenarioObj) {
        throw new Error(`Scenario not found: ${conversation.scenarioId}`);
      }
      
      // 시나리오에서 해당 페르소나 객체 찾기
      const scenarioPersona = scenarioObj.personas.find((p: any) => p.id === personaId);
      if (!scenarioPersona) {
        throw new Error(`Persona not found in scenario: ${personaId}`);
      }
      
      // ⚡ 최적화: 특정 MBTI 유형만 로드 (전체 로드 대신)
      const mbtiType = scenarioPersona.personaRef?.replace('.json', '');
      const mbtiPersona = mbtiType ? await fileManager.getPersonaByMBTI(mbtiType) : null;
      
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

      const aiResult = await generateAIResponse(
        scenarioObj, // 전체 시나리오 객체 전달
        updatedMessages,
        persona,
        isSkipTurn ? undefined : message
      );

      const aiMessage = {
        sender: "ai" as const,
        message: aiResult.content,
        timestamp: new Date().toISOString(),
        emotion: aiResult.emotion,
        emotionReason: aiResult.emotionReason,
      };

      const finalMessages = [...updatedMessages, aiMessage];
      const isCompleted = newTurnCount >= 3;

      // Update conversation
      const updatedConversation = await storage.updateConversation(req.params.id, {
        messages: finalMessages,
        turnCount: newTurnCount,
        status: isCompleted ? "completed" : "active",
        completedAt: isCompleted ? new Date() : null,
      });

      res.json({
        conversation: updatedConversation,
        aiResponse: aiResult.content,
        emotion: aiResult.emotion,
        emotionReason: aiResult.emotionReason,
        isCompleted,
      });
    } catch (error) {
      console.error("Message processing error:", error);
      res.status(500).json({ error: "Failed to process message" });
    }
  });

  // Strategic Selection APIs
  
  // Persona Selection APIs
  app.post("/api/conversations/:id/persona-selections", async (req, res) => {
    try {
      const { id } = req.params;
      
      // Check if conversation exists first
      const existingConversation = await storage.getConversation(id);
      if (!existingConversation) {
        return res.status(404).json({ error: "Conversation not found" });
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
  
  app.get("/api/conversations/:id/persona-selections", async (req, res) => {
    try {
      const { id } = req.params;
      const selections = await storage.getPersonaSelections(id);
      res.json(selections);
    } catch (error) {
      console.error("Error getting persona selections:", error);
      res.status(500).json({ error: "Failed to get persona selections" });
    }
  });

  // 순차 계획 전체를 한번에 저장하는 엔드포인트
  app.post("/api/conversations/:id/sequence-plan", async (req, res) => {
    try {
      const { id } = req.params;
      
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
  app.post("/api/conversations/:id/strategy-choices", async (req, res) => {
    try {
      const { id } = req.params;
      
      // Check if conversation exists first
      const existingConversation = await storage.getConversation(id);
      if (!existingConversation) {
        return res.status(404).json({ error: "Conversation not found" });
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
  
  app.get("/api/conversations/:id/strategy-choices", async (req, res) => {
    try {
      const { id } = req.params;
      const choices = await storage.getStrategyChoices(id);
      res.json(choices);
    } catch (error) {
      console.error("Error getting strategy choices:", error);
      res.status(500).json({ error: "Failed to get strategy choices" });
    }
  });
  
  // Sequence Analysis APIs
  app.post("/api/conversations/:id/sequence-analysis", async (req, res) => {
    try {
      const { id } = req.params;
      
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
  
  app.get("/api/conversations/:id/sequence-analysis", async (req, res) => {
    try {
      const { id } = req.params;
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
  app.post("/api/conversations/:id/strategy-reflection", async (req, res) => {
    try {
      const { id } = req.params;
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
  app.get("/api/feedbacks", async (req, res) => {
    try {
      // @ts-ignore - req.user는 auth 미들웨어에서 설정됨
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "인증이 필요합니다" });
      }
      
      const feedbacks = await storage.getUserFeedbacks(userId);
      res.json(feedbacks);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch feedbacks" });
    }
  });

  // Generate feedback for completed conversation
  app.post("/api/conversations/:id/feedback", async (req, res) => {
    try {
      console.log(`피드백 생성 요청: ${req.params.id}`);
      
      const conversation = await storage.getConversation(req.params.id);
      if (!conversation) {
        console.log(`대화를 찾을 수 없음: ${req.params.id}`);
        return res.status(404).json({ error: "Conversation not found" });
      }

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
      const scenarioPersona = scenarioObj.personas.find((p: any) => p.id === personaId);
      if (!scenarioPersona) {
        throw new Error(`Persona not found in scenario: ${personaId}`);
      }
      
      // ⚡ 최적화: 특정 MBTI 유형만 로드 (전체 로드 대신)
      const mbtiType = scenarioPersona.personaRef?.replace('.json', '');
      const mbtiPersona = mbtiType ? await fileManager.getPersonaByMBTI(mbtiType) : null;
      
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
        conversationId: req.params.id,
        overallScore: feedbackData.overallScore,
        scores: evaluationScores,
        detailedFeedback: feedbackData,
      });

      console.log("피드백 저장 완료");

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

  // Get feedback for conversation
  app.get("/api/conversations/:id/feedback", async (req, res) => {
    try {
      const feedback = await storage.getFeedbackByConversationId(req.params.id);
      if (!feedback) {
        return res.status(404).json({ error: "Feedback not found" });
      }
      res.json(feedback);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch feedback" });
    }
  });

  // Admin Dashboard Analytics Routes
  app.get("/api/admin/analytics/overview", async (req, res) => {
    try {
      const conversations = await storage.getAllConversations();
      const feedbacks = await storage.getAllFeedbacks();
      const scenarios = await fileManager.getAllScenarios();
      
      // Calculate basic statistics
      const totalSessions = conversations.length;
      const completedSessions = conversations.filter(c => c.status === "completed").length;
      const averageScore = feedbacks.length > 0 
        ? Math.round(feedbacks.reduce((acc, f) => acc + f.overallScore, 0) / feedbacks.length)
        : 0;
      
      // Scenario popularity with proper names
      const scenarioStats = conversations.reduce((acc, conv) => {
        const scenario = scenarios.find(s => s.id === conv.scenarioId);
        const scenarioName = scenario?.title || conv.scenarioName || conv.scenarioId;
        acc[conv.scenarioId] = {
          count: (acc[conv.scenarioId]?.count || 0) + 1,
          name: scenarioName,
          difficulty: scenario?.difficulty || 1
        };
        return acc;
      }, {} as Record<string, { count: number; name: string; difficulty: number }>);
      
      // MBTI 페르소나 사용 분석 (personaId → MBTI 유형 변환)
      const mbtiUsage = conversations.reduce((acc, conv) => {
        if (conv.personaId && conv.scenarioId) {
          // 시나리오에서 해당 페르소나 정보 찾기
          const scenario = scenarios.find(s => s.id === conv.scenarioId);
          if (scenario?.personas) {
            const persona = scenario.personas.find((p: any) => 
              (typeof p === 'object' && p.id === conv.personaId) ||
              (typeof p === 'string' && p === conv.personaId)
            );
            
            if (persona && typeof persona === 'object' && (persona as any).personaRef) {
              // personaRef에서 MBTI 유형 추출 (예: "istj.json" → "ISTJ")
              const mbtiType = (persona as any).personaRef.replace('.json', '').toUpperCase();
              acc[mbtiType] = (acc[mbtiType] || 0) + 1;
            }
          }
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
      const feedbacks = await storage.getAllFeedbacks();
      const conversations = await storage.getAllConversations();
      const scenarios = await fileManager.getAllScenarios();
      
      // Score distribution
      const scoreRanges = {
        excellent: feedbacks.filter(f => f.overallScore >= 90).length,
        good: feedbacks.filter(f => f.overallScore >= 80 && f.overallScore < 90).length,
        average: feedbacks.filter(f => f.overallScore >= 70 && f.overallScore < 80).length,
        needsImprovement: feedbacks.filter(f => f.overallScore >= 60 && f.overallScore < 70).length,
        poor: feedbacks.filter(f => f.overallScore < 60).length
      };
      
      // Category performance analysis
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
      
      // Scenario difficulty vs performance (현재 구조에 맞게 수정)
      const scenarioPerformance = conversations
        .filter(c => c.status === "completed")
        .reduce((acc, conv) => {
          const feedback = feedbacks.find(f => f.conversationId === conv.id);
          const scenario = scenarios.find(s => s.id === conv.scenarioId);
          if (feedback) {
            if (!acc[conv.scenarioId]) {
              acc[conv.scenarioId] = { 
                scores: [], 
                name: scenario?.title || conv.scenarioName || conv.scenarioId,
                difficulty: scenario?.difficulty || 1,
                personaCount: Array.isArray(scenario?.personas) ? scenario.personas.length : 0
              };
            }
            acc[conv.scenarioId].scores.push(feedback.overallScore);
          }
          return acc;
        }, {} as Record<string, { scores: number[]; name: string; difficulty: number; personaCount: number }>);
      
      // Calculate scenario averages
      Object.keys(scenarioPerformance).forEach(scenarioId => {
        const scores = scenarioPerformance[scenarioId].scores;
        (scenarioPerformance[scenarioId] as any) = {
          ...scenarioPerformance[scenarioId],
          average: Math.round(scores.reduce((acc, score) => acc + score, 0) / scores.length),
          sessionCount: scores.length
        };
      });
      
      // MBTI 유형별 성과 분석 (personaId → MBTI 유형 변환)
      const mbtiPerformance = conversations
        .filter(c => c.status === "completed" && c.personaId && c.scenarioId)
        .reduce((acc, conv) => {
          const feedback = feedbacks.find(f => f.conversationId === conv.id);
          if (feedback && conv.personaId && conv.scenarioId) {
            // 시나리오에서 해당 페르소나 정보 찾기
            const scenario = scenarios.find(s => s.id === conv.scenarioId);
            if (scenario?.personas) {
              const persona = scenario.personas.find((p: any) => 
                (typeof p === 'object' && p.id === conv.personaId) ||
                (typeof p === 'string' && p === conv.personaId)
              );
              
              if (persona && typeof persona === 'object' && (persona as any).personaRef) {
                // personaRef에서 MBTI 유형 추출 (예: "istj.json" → "ISTJ")
                const mbtiType = (persona as any).personaRef.replace('.json', '').toUpperCase();
                
                if (!acc[mbtiType]) {
                  acc[mbtiType] = { scores: [], count: 0 };
                }
                acc[mbtiType].scores.push(feedback.overallScore);
                acc[mbtiType].count += 1;
              }
            }
          }
          return acc;
        }, {} as Record<string, { scores: number[]; count: number }>);
      
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
      const conversations = await storage.getAllConversations();
      const feedbacks = await storage.getAllFeedbacks();
      
      // Daily usage over last 30 days
      const last30Days = Array.from({ length: 30 }, (_, i) => {
        const date = new Date();
        date.setDate(date.getDate() - (29 - i));
        return date.toISOString().split('T')[0];
      });
      
      const dailyUsage = last30Days.map(date => {
        const sessionsCount = conversations.filter(c => 
          c.createdAt && c.createdAt.toISOString().split('T')[0] === date
        ).length;
        
        const completedCount = conversations.filter(c => 
          c.status === "completed" && c.createdAt && c.createdAt.toISOString().split('T')[0] === date
        ).length;
        
        return {
          date,
          sessions: sessionsCount,
          completed: completedCount
        };
      });
      
      // Performance trends
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
