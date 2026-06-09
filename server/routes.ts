import type { Express } from "express";
import type { Server } from "http";
import WebSocket, { WebSocketServer } from "ws";
import { storage } from "./storage";
import { UNLIMITED_QUOTA } from "@shared/schema";
import { createSampleData } from "./sampleData";
import { TRANSLATION_MODEL_DEFAULT } from "./constants/aiModels";
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
import createAdminScenarioOverridesRouter from "./routes/adminScenarioOverrides";
import createSystemAdminRouter from "./routes/systemAdmin";
import createEvaluationCriteriaRouter from "./routes/evaluationCriteria";
import createTranslationsRouter from "./routes/translations";
import createPersonaScenesRouter from "./routes/personaScenes";
import createPersonaUserScenesRouter from "./routes/personaUserScenes";
import createSimulationRouter from "./routes/simulation";
import agentApiRouter from "./routes/agentApi";
import adminAgentKeysRouter from "./routes/adminAgentKeys";
import createSubscriptionsRouter from "./routes/subscriptions";
import createHrAnalyticsRouter from "./routes/hrAnalytics";
import createStoreRouter from "./routes/store";
import swaggerUi from "swagger-ui-express";
import agentApiSpec from "./openapi/agentApi";

export async function registerRoutes(app: Express, httpServer: Server): Promise<void> {
  const cookieParser = (await import('cookie-parser')).default;
  app.use(cookieParser());

  const { setupAuth, isAuthenticated } = await import('./auth');
  setupAuth(app);

  // Seed model_translation setting if not present
  try {
    const existing = await storage.getSystemSetting('ai', 'model_translation');
    if (!existing) {
      await storage.upsertSystemSetting({
        category: 'ai',
        key: 'model_translation',
        value: TRANSLATION_MODEL_DEFAULT,
        description: 'AI model used for translation (auto-translate and evaluation criteria translation)',
      });
    }
  } catch (err) {
    console.error('[seed] Failed to seed model_translation setting:', err);
  }

  // Public: current default intro video URL (authenticated users only)
  app.get('/api/media/default-intro-video', isAuthenticated, async (req, res) => {
    try {
      const { storage: storageModule } = await import('./storage');
      const setting = await storageModule.getSystemSetting('media', 'default_intro_video');
      if (!setting?.value) {
        return res.json({ url: '/videos/intro_default.webm', hasCustomVideo: false });
      }
      const { transformToSignedUrl } = await import('./services/gcsStorage');
      const candidate = await transformToSignedUrl(setting.value);
      const isHttpUrl = candidate && /^https?:\/\//i.test(candidate);
      const servingUrl = isHttpUrl ? candidate : `/objects?key=${encodeURIComponent(setting.value)}`;
      return res.json({ url: servingUrl, storagePath: setting.value, hasCustomVideo: true });
    } catch (err) {
      return res.json({ url: '/videos/intro_default.webm', hasCustomVideo: false });
    }
  });

  // Voice audio AGC settings (readable by any authenticated user, seeded on first access)
  const VOICE_AUDIO_DEFAULTS = [
    { key: 'agc_target_rms', value: '0.15', description: 'Target RMS level for automatic gain control (default 0.15)' },
    { key: 'agc_min_gain', value: '0.5', description: 'Minimum gain clamp for AGC (default 0.5, i.e. −6 dB)' },
    { key: 'agc_max_gain', value: '4.0', description: 'Maximum gain clamp for AGC (default 4.0, i.e. +12 dB)' },
    { key: 'agc_attack_coeff', value: '0.05', description: 'AGC attack coefficient — how quickly gain rises (default 0.05)' },
    { key: 'agc_release_coeff', value: '0.015', description: 'AGC release coefficient — how quickly gain falls (default 0.015)' },
  ];

  app.get('/api/settings/voice-audio', isAuthenticated, async (_req, res) => {
    try {
      let rows = await storage.getSystemSettingsByCategory('voice_audio');
      if (rows.length === 0) {
        for (const d of VOICE_AUDIO_DEFAULTS) {
          await storage.upsertSystemSetting({ category: 'voice_audio', ...d });
        }
        rows = await storage.getSystemSettingsByCategory('voice_audio');
      }
      const out: Record<string, number> = {};
      for (const d of VOICE_AUDIO_DEFAULTS) {
        const row = rows.find(r => r.key === d.key);
        out[d.key] = parseFloat(row?.value ?? d.value);
      }
      res.json(out);
    } catch (err) {
      console.error('[voice-audio settings]', err);
      res.status(500).json({ error: 'Failed to fetch voice audio settings' });
    }
  });

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
  app.use(createAdminScenarioOverridesRouter(isAuthenticated));
  app.use(createEvaluationCriteriaRouter(isAuthenticated));
  app.use(createTranslationsRouter(isAuthenticated));
  app.use(createPersonaScenesRouter(isAuthenticated));
  app.use(createPersonaUserScenesRouter(isAuthenticated));
  app.use(createHrAnalyticsRouter(isAuthenticated));

  // Routers that use relative paths — mount at their domain prefix
  app.use('/api/bookmarks', createBookmarksRouter(isAuthenticated));
  app.use('/api/scenarios', createScenariosRouter(isAuthenticated));
  app.use('/api/conversations', createConversationsRouter(isAuthenticated));
  app.use('/api/simulation', createSimulationRouter(isAuthenticated));
  app.use('/api/system-admin', createSystemAdminRouter(isAuthenticated));
  app.use('/api/subscriptions', createSubscriptionsRouter(isAuthenticated));
  app.use('/api/store', createStoreRouter(isAuthenticated));

  // ================================
  // Agent API (Enterprise B2B)
  // ================================
  // Public docs — mounted directly on app so swagger-ui static serving
  // is not intercepted by the auth middleware inside agentApiRouter.
  //
  // The openapi.json endpoint dynamically sets servers[0].url so that
  // Swagger UI "Try it out" calls hit the correct absolute base URL.
  // Priority: AGENT_API_PUBLIC_URL env var → inferred from request host.
  app.get('/api/v1/agent/openapi.json', (req, res) => {
    // Derive the public base URL for the OpenAPI servers[] entry.
    // Priority:
    //   1. AGENT_API_PUBLIC_URL env var (most reliable for production)
    //   2. X-Forwarded-Proto / X-Forwarded-Host headers set by reverse proxies
    //      (e.g. nginx, Cloudflare, GCP LB) — needed because Express's
    //      req.protocol defaults to "http" when trust proxy is not set.
    //   3. req.protocol + Host header (works in development / direct access)
    let publicBase: string;
    if (process.env.AGENT_API_PUBLIC_URL) {
      publicBase = process.env.AGENT_API_PUBLIC_URL.replace(/\/+$/, '');
    } else {
      const proto =
        (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0].trim() ??
        req.protocol;
      const host =
        (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0].trim() ??
        req.get('host');
      publicBase = `${proto}://${host}`;
    }
    const activeServerUrl = `${publicBase}/api/v1/agent`;
    const urlSource = process.env.AGENT_API_PUBLIC_URL
      ? '`AGENT_API_PUBLIC_URL` environment variable'
      : 'inferred from request headers';

    const serverBanner = `\n---\n\n> **🌐 Active base URL for "Try it out"**\n>\n> \`\`\`\n> ${activeServerUrl}\n> \`\`\`\n>\n> Source: ${urlSource}. If this URL doesn't match your expected endpoint (e.g. behind a load balancer or custom domain), set the \`AGENT_API_PUBLIC_URL\` environment variable on the server to the correct public base URL.\n>\n> API keys are managed from the **[Key Management page](/system-admin)**.\n`;

    const dynamicSpec = {
      ...agentApiSpec,
      info: {
        ...agentApiSpec.info,
        description: agentApiSpec.info.description + serverBanner,
      },
      servers: [
        {
          url: activeServerUrl,
          description: 'Agent API',
        },
      ],
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.json(dynamicSpec);
  });
  // Swagger UI fetches the spec from the dynamic endpoint above so that
  // the server URL and Authorize button work correctly for all origins.
  app.use('/api/v1/agent/docs', ...swaggerUi.serve, swaggerUi.setup(undefined, {
    customSiteTitle: 'Agent API Docs',
    swaggerOptions: {
      url: '/api/v1/agent/openapi.json',
      persistAuthorization: true,
      displayRequestDuration: true,
      defaultModelsExpandDepth: 2,
      defaultModelExpandDepth: 3,
    },
    customJsStr: `
(function () {
  var STORAGE_KEY = 'agentApiKeyPrefill';
  var apiKey = localStorage.getItem(STORAGE_KEY);
  if (!apiKey) return;
  localStorage.removeItem(STORAGE_KEY);
  var attempts = 0;
  var interval = setInterval(function () {
    attempts++;
    if (attempts > 200) { clearInterval(interval); return; }
    if (window.ui && window.ui.authActions && typeof window.ui.authActions.authorize === 'function') {
      clearInterval(interval);
      window.ui.authActions.authorize({
        BearerAuth: {
          name: 'BearerAuth',
          schema: { type: 'http', in: 'header', scheme: 'bearer', bearerFormat: 'API Key' },
          value: apiKey
        }
      });
    }
  }, 100);
})();
`,
  }));
  // Agent API key-authenticated routes (no JWT required — uses Bearer api_key)
  app.use('/api/v1/agent', agentApiRouter);
  // Admin routes for API key management (JWT + admin/operator required)
  app.use('/api/admin/agent-keys', isAuthenticated, adminAgentKeysRouter);

  // ================================
  // Existing sub-routes
  // ================================
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

    // Token quota check before starting a real-time voice session
    try {
      const { subscription, plan } = await storage.getOrCreateSubscription(userId);
      if (plan.tokenQuotaMonthly !== UNLIMITED_QUOTA && subscription.tokensUsedThisCycle >= plan.tokenQuotaMonthly) {
        ws.send(JSON.stringify({
          type: 'error',
          error: 'quota_exceeded',
          message: `Monthly token quota of ${(plan.tokenQuotaMonthly / 1_000_000).toFixed(1)}M tokens exhausted. Please upgrade your plan.`,
        }));
        ws.close(1008, 'Quota exceeded');
        return;
      }
    } catch (err) {
      console.warn('[voice-ws] Could not check quota, proceeding anyway:', err);
    }

    const sessionId = `${userId}-${conversationId}-${Date.now()}`;

    try {
      const userSelectedDifficulty = personaRun.difficulty || scenarioRun.difficulty || 4;
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
