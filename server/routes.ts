import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertConversationSchema, insertFeedbackSchema } from "@shared/schema";
import { generateAIResponse, generateFeedback } from "./services/geminiService";
import { createSampleData } from "./sampleData";

export async function registerRoutes(app: Express): Promise<Server> {
  // Create new conversation
  app.post("/api/conversations", async (req, res) => {
    try {
      const validatedData = insertConversationSchema.parse(req.body);
      const conversation = await storage.createConversation(validatedData);
      
      // 첫 번째 AI 메시지 자동 생성
      try {
        const aiResult = await generateAIResponse(
          conversation.scenarioId,
          [],
          0
        );

        const aiMessage = {
          sender: "ai" as const,
          message: aiResult.response,
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
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Message is required" });
      }

      const conversation = await storage.getConversation(req.params.id);
      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      if (conversation.status === "completed") {
        return res.status(400).json({ error: "Conversation already completed" });
      }

      // Add user message
      const userMessage = {
        sender: "user" as const,
        message,
        timestamp: new Date().toISOString(),
      };

      const updatedMessages = [...conversation.messages, userMessage];
      const newTurnCount = conversation.turnCount + 1;

      // Generate AI response
      const aiResult = await generateAIResponse(
        conversation.scenarioId,
        updatedMessages,
        newTurnCount,
        message
      );

      const aiMessage = {
        sender: "ai" as const,
        message: aiResult.response,
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
        aiResponse: aiResult.response,
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
      const feedbackData = await generateFeedback(
        conversation.scenarioId,
        conversation.messages
      );

      console.log("피드백 데이터 생성 완료:", feedbackData);

      const feedback = await storage.createFeedback({
        conversationId: req.params.id,
        overallScore: feedbackData.overallScore,
        scores: feedbackData.scores,
        detailedFeedback: feedbackData.detailedFeedback,
      });

      console.log("피드백 저장 완료");
      res.json(feedback);
    } catch (error) {
      console.error("Feedback generation error:", error);
      res.status(500).json({ 
        error: "Failed to generate feedback",
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
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
