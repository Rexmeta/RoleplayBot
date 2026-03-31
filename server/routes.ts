import type { Express } from "express";
import type { Server } from "http";
import WebSocket, { WebSocketServer } from "ws";
import { storage } from "./storage";
import { createSampleData } from "./sampleData";
import ttsRoutes from "./routes/tts.js";
import imageGenerationRoutes from "./routes/imageGeneration.js";
import userPersonaImageRoutes from "./routes/userPersonaImage.js";
import mediaRoutes from "./routes/media.js";
import { realtimeVoiceService } from "./services/realtimeVoiceService";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";

import createUserRouter from "./routes/user";
import createFreeChatRouter from "./routes/freeChat";
import createConversationsRouter from "./routes/conversations";
import createScenarioRunsRouter from "./routes/scenarioRuns";
import createAnalyticsRouter from "./routes/analytics";
import createBookmarksRouter from "./routes/bookmarks";
import createScenariosRouter from "./routes/scenarios";
import createAdminScenariosRouter from "./routes/adminScenarios";
import createAdminPersonasRouter from "./routes/adminPersonas";
import createAdminOrganizationsRouter from "./routes/adminOrganizations";
import createSystemAdminRouter from "./routes/systemAdmin";
import createEvaluationCriteriaRouter from "./routes/evaluationCriteria";
import createTranslationsRouter from "./routes/translations";
import createPersonaScenesRouter from "./routes/personaScenes";

export async function registerRoutes(app: Express, httpServer: Server): Promise<void> {
  const cookieParser = (await import('cookie-parser')).default;
  app.use(cookieParser());

  const { setupAuth, isAuthenticated } = await import('./auth');
  setupAuth(app);

  // Health check
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

  // ================================
  // Domain Routers
  // ================================

  // Routers that use absolute paths — mount at root
  app.use(createUserRouter(isAuthenticated));
  app.use(createFreeChatRouter(isAuthenticated));
  app.use(createScenarioRunsRouter(isAuthenticated));
  app.use(createAnalyticsRouter(isAuthenticated));
  app.use(createAdminScenariosRouter(isAuthenticated));
  app.use(createAdminPersonasRouter(isAuthenticated));
  app.use(createAdminOrganizationsRouter(isAuthenticated));
  app.use(createEvaluationCriteriaRouter(isAuthenticated));
  app.use(createTranslationsRouter(isAuthenticated));
  app.use(createPersonaScenesRouter(isAuthenticated));

  // Routers that use relative paths — mount at their domain prefix
  app.use('/api/bookmarks', createBookmarksRouter(isAuthenticated));
  app.use('/api/scenarios', createScenariosRouter(isAuthenticated));
  app.use('/api/conversations', createConversationsRouter(isAuthenticated));
  app.use('/api/system-admin', createSystemAdminRouter(isAuthenticated));

  // ================================
  // Existing sub-routes
  // ================================
  app.use("/api/tts", ttsRoutes);
  app.use("/api/image", imageGenerationRoutes);
  app.use("/api/user-personas", userPersonaImageRoutes);
  app.use("/api/media", mediaRoutes);
  registerObjectStorageRoutes(app);

  // Sample data for development
  if (process.env.NODE_ENV === "development") {
    try {
      await createSampleData();
    } catch (error) {
      console.log("Sample data initialization:", error);
    }
  }

  // ================================
  // WebSocket Server (OpenAI Realtime Voice)
  // ================================
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/api/realtime-voice'
  });

  wss.on('connection', async (ws: WebSocket, req) => {
    console.log('🎙️ New WebSocket connection for realtime voice');

    if (!realtimeVoiceService.isServiceAvailable()) {
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Realtime voice service is not available. OpenAI API key is not configured.'
      }));
      ws.close(1011, 'Service unavailable');
      return;
    }

    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const conversationId = url.searchParams.get('conversationId');
    const scenarioId = url.searchParams.get('scenarioId');
    const personaId = url.searchParams.get('personaId');
    const token = url.searchParams.get('token');

    if (!conversationId || !scenarioId || !personaId) {
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Missing required parameters: conversationId, scenarioId, personaId'
      }));
      ws.close(1008, 'Missing parameters');
      return;
    }

    let userId: string;
    try {
      if (!token || token === 'null' || token === 'undefined') {
        throw new Error('인증 토큰이 없습니다. 다시 로그인해주세요.');
      }
      const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
      const jwt = (await import('jsonwebtoken')).default;
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      userId = decoded.userId;
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

    const sessionId = `${userId}-${conversationId}-${Date.now()}`;

    try {
      const userSelectedDifficulty = personaRun.difficulty || scenarioRun.difficulty || 2;
      console.log(`🎯 실시간 음성 세션 난이도: Level ${userSelectedDifficulty}`);

      const voiceUser = await storage.getUser(userId);
      const voiceUserLanguage = (voiceUser?.preferredLanguage as 'ko' | 'en' | 'ja' | 'zh') || 'ko';
      console.log(`🌐 실시간 음성 세션 언어: ${voiceUserLanguage}`);

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

      ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          realtimeVoiceService.handleClientMessage(sessionId, message);
        } catch (error) {
          console.error('Error handling client message:', error);
          ws.send(JSON.stringify({ type: 'error', error: 'Invalid message format' }));
        }
      });

      ws.on('close', () => {
        console.log(`🔌 WebSocket closed for session: ${sessionId}`);
        realtimeVoiceService.closeSession(sessionId);
      });

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

  // Heartbeat to prevent proxy idle timeout
  const wsHeartbeatInterval = setInterval(() => {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.ping();
      }
    });
  }, 25000);

  wss.on('close', () => {
    clearInterval(wsHeartbeatInterval);
  });

  console.log('✅ WebSocket server initialized at /api/realtime-voice');
}
