import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertConversationSchema, insertFeedbackSchema } from "@shared/schema";
import { generateAIResponse, generateFeedback, SCENARIO_PERSONAS } from "./services/geminiService";
import { createSampleData } from "./sampleData";
import ttsRoutes from "./routes/tts.js";
import { fileManager } from "./services/fileManager";
import { generateScenarioWithAI, enhanceScenarioWithAI } from "./services/aiScenarioGenerator";

export async function registerRoutes(app: Express): Promise<Server> {
  // Create new conversation
  app.post("/api/conversations", async (req, res) => {
    try {
      const validatedData = insertConversationSchema.parse(req.body);
      const conversation = await storage.createConversation(validatedData);
      
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
        
        // MBTI 특성 로드
        const allMbtiPersonas = await fileManager.getAllPersonas();
        const mbtiPersona = allMbtiPersonas.find(p => p.id === scenarioPersona.personaRef?.replace('.json', ''));
        
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
      
      // MBTI 특성 로드
      const allMbtiPersonas = await fileManager.getAllPersonas();
      const mbtiPersona = allMbtiPersonas.find(p => p.id === scenarioPersona.personaRef?.replace('.json', ''));
      
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
      const isCompleted = newTurnCount >= 10;

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

      // 완료되지 않은 대화에 대해서도 피드백 생성 허용 (10턴 이상이면)
      if (conversation.status !== "completed" && conversation.turnCount < 10) {
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
      
      // MBTI 특성 로드
      const allMbtiPersonas = await fileManager.getAllPersonas();
      const mbtiPersona = allMbtiPersonas.find(p => p.id === scenarioPersona.personaRef?.replace('.json', ''));
      
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

      // 대화 시간과 발화량 계산
      const conversationDuration = conversation.completedAt 
        ? Math.floor((new Date(conversation.completedAt).getTime() - new Date(conversation.createdAt).getTime()) / 1000 / 60) 
        : 0; // 분 단위

      const userMessages = conversation.messages.filter(m => m.sender === 'user');
      const totalUserWords = userMessages.reduce((sum, msg) => sum + msg.message.length, 0);
      const averageResponseTime = conversationDuration > 0 ? Math.round(conversationDuration * 60 / userMessages.length) : 0; // 초 단위


      const feedbackData = await generateFeedback(
        scenarioObj, // 전체 시나리오 객체 전달
        conversation.messages,
        persona
      );

      // 시간 성과 평가 추가
      const timePerformance = {
        rating: conversationDuration <= 5 ? 'excellent' as const :
                conversationDuration <= 10 ? 'good' as const :
                conversationDuration <= 15 ? 'average' as const : 'slow' as const,
        feedback: conversationDuration <= 5 ? '매우 효율적인 대화 진행' :
                  conversationDuration <= 10 ? '적절한 시간 내 대화 완료' :
                  conversationDuration <= 15 ? '평균적인 대화 속도' : '대화 시간이 다소 길었습니다'
      };

      // 피드백에 시간 정보 추가
      feedbackData.conversationDuration = conversationDuration;
      feedbackData.averageResponseTime = averageResponseTime;
      feedbackData.timePerformance = timePerformance;

      console.log("피드백 데이터 생성 완료:", feedbackData);

      // EvaluationScore 배열 생성
      const evaluationScores = [
        {
          category: "communication",
          name: "메시지 명확성",
          score: feedbackData.scores.clarity,
          feedback: "명확하고 이해하기 쉬운 의사소통",
          icon: "💬",
          color: "blue"
        },
        {
          category: "empathy", 
          name: "상대방 배려",
          score: feedbackData.scores.empathy,
          feedback: "청자의 입장과 상황 고려",
          icon: "❤️",
          color: "red"
        },
        {
          category: "responsiveness",
          name: "감정적 반응성", 
          score: feedbackData.scores.responsiveness,
          feedback: "상대방 감정에 대한 적절한 대응",
          icon: "🎭",
          color: "purple"
        },
        {
          category: "structure",
          name: "대화 구조화",
          score: feedbackData.scores.structure, 
          feedback: "논리적이고 체계적인 대화 진행",
          icon: "🏗️",
          color: "green"
        },
        {
          category: "professionalism",
          name: "전문적 역량",
          score: feedbackData.scores.professionalism,
          feedback: "업무 상황에 맞는 전문성 발휘", 
          icon: "👔",
          color: "indigo"
        }
      ];

      const feedback = await storage.createFeedback({
        conversationId: req.params.id,
        overallScore: feedbackData.overallScore,
        scores: evaluationScores,
        detailedFeedback: feedbackData,
      });

      console.log("피드백 저장 완료");
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
      
      // Calculate basic statistics
      const totalSessions = conversations.length;
      const completedSessions = conversations.filter(c => c.status === "completed").length;
      const averageScore = feedbacks.length > 0 
        ? Math.round(feedbacks.reduce((acc, f) => acc + f.overallScore, 0) / feedbacks.length)
        : 0;
      
      // Scenario popularity
      const scenarioStats = conversations.reduce((acc, conv) => {
        acc[conv.scenarioId] = (acc[conv.scenarioId] || 0) + 1;
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
        scenarioStats
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
      
      // Scenario difficulty vs performance
      const scenarioPerformance = conversations
        .filter(c => c.status === "completed")
        .reduce((acc, conv) => {
          const feedback = feedbacks.find(f => f.conversationId === conv.id);
          if (feedback) {
            if (!acc[conv.scenarioId]) {
              acc[conv.scenarioId] = { scores: [], name: conv.scenarioName };
            }
            acc[conv.scenarioId].scores.push(feedback.overallScore);
          }
          return acc;
        }, {} as Record<string, { scores: number[]; name: string }>);
      
      // Calculate scenario averages
      Object.keys(scenarioPerformance).forEach(scenarioId => {
        const scores = scenarioPerformance[scenarioId].scores;
        (scenarioPerformance[scenarioId] as any) = {
          ...scenarioPerformance[scenarioId],
          average: Math.round(scores.reduce((acc, score) => acc + score, 0) / scores.length),
          sessionCount: scores.length
        };
      });
      
      res.json({
        scoreRanges,
        categoryPerformance,
        scenarioPerformance
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

  app.get("/api/personas", async (req, res) => {
    try {
      const scenarios = await fileManager.getAllScenarios();
      const allPersonas: any[] = [];
      
      // 각 시나리오에서 MBTI 기반 페르소나 생성
      for (const scenario of scenarios) {
        const scenarioPersonas = await fileManager.getScenarioPersonas(scenario.id);
        
        for (const scenarioPersona of scenarioPersonas) {
          const fullPersona = await fileManager.createPersonaFromScenario(scenarioPersona);
          if (fullPersona) {
            allPersonas.push(fullPersona);
          }
        }
      }
      
      // 기존 페르소나도 포함 (하위 호환성)
      const existingPersonas = await fileManager.getAllPersonas();
      const mbtiPersonaIds = allPersonas.map(p => p.id);
      const nonMbtiPersonas = existingPersonas.filter(p => !mbtiPersonaIds.includes(p.id));
      
      res.json([...allPersonas, ...nonMbtiPersonas]);
    } catch (error) {
      console.error("Error fetching personas:", error);
      res.status(500).json({ error: "Failed to fetch personas" });
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

      // AI 생성된 시나리오를 파일로 저장
      const savedScenario = await fileManager.createScenario(result.scenario);
      
      // AI 생성된 페르소나들을 파일로 저장
      const savedPersonas = [];
      for (const persona of result.personas) {
        const savedPersona = await fileManager.createPersona(persona);
        savedPersonas.push(savedPersona);
      }

      // 시나리오의 personas 배열을 저장된 페르소나 ID로 업데이트
      const updatedScenario = await fileManager.updateScenario(savedScenario.id, {
        personas: savedPersonas.map(p => p.id)
      });

      res.json({
        scenario: updatedScenario,
        personas: savedPersonas
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
      const personas = await fileManager.getAllPersonas();
      res.json(personas);
    } catch (error) {
      console.error("Error getting personas:", error);
      res.status(500).json({ error: "Failed to get personas" });
    }
  });

  app.post("/api/admin/personas", async (req, res) => {
    try {
      const persona = await fileManager.createPersona(req.body);
      res.json(persona);
    } catch (error) {
      console.error("Error creating persona:", error);
      res.status(500).json({ error: "Failed to create persona" });
    }
  });

  app.put("/api/admin/personas/:id", async (req, res) => {
    try {
      const persona = await fileManager.updatePersona(req.params.id, req.body);
      res.json(persona);
    } catch (error) {
      console.error("Error updating persona:", error);
      res.status(500).json({ error: "Failed to update persona" });
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
      
      await fileManager.deletePersona(personaId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting persona:", error);
      res.status(500).json({ error: "Failed to delete persona" });
    }
  });

  // TTS routes
  app.use("/api/tts", ttsRoutes);

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
