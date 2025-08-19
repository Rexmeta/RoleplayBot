import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertConversationSchema, insertFeedbackSchema } from "@shared/schema";
import { generateAIResponse, generateFeedback } from "./services/openaiService";

export async function registerRoutes(app: Express): Promise<Server> {
  // Create new conversation
  app.post("/api/conversations", async (req, res) => {
    try {
      const validatedData = insertConversationSchema.parse(req.body);
      const conversation = await storage.createConversation(validatedData);
      res.json(conversation);
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
      const aiResponse = await generateAIResponse(
        conversation.scenarioId,
        updatedMessages,
        newTurnCount
      );

      const aiMessage = {
        sender: "ai" as const,
        message: aiResponse,
        timestamp: new Date().toISOString(),
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
        aiResponse,
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
      const conversation = await storage.getConversation(req.params.id);
      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      if (conversation.status !== "completed") {
        return res.status(400).json({ error: "Conversation not completed yet" });
      }

      // Check if feedback already exists
      const existingFeedback = await storage.getFeedbackByConversationId(req.params.id);
      if (existingFeedback) {
        return res.json(existingFeedback);
      }

      // Generate new feedback
      const feedbackData = await generateFeedback(
        conversation.scenarioId,
        conversation.messages
      );

      const feedback = await storage.createFeedback({
        conversationId: req.params.id,
        overallScore: feedbackData.overallScore,
        scores: feedbackData.scores,
        detailedFeedback: feedbackData.detailedFeedback,
      });

      res.json(feedback);
    } catch (error) {
      console.error("Feedback generation error:", error);
      res.status(500).json({ error: "Failed to generate feedback" });
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

  const httpServer = createServer(app);
  return httpServer;
}
