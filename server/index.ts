import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { createServer } from "http";
import { registerRoutes } from "./routes";
import { serveStatic, log } from "./static";
import { GlobalMBTICache } from "./utils/globalMBTICache";
import { runMigrations } from "./migrate";
import { checkDatabaseConnection } from "./storage";
import * as pathModule from "path";

// ====================================================================
// Global crash handlers – prevent silent process exits that Cloud Run
// would surface as 503 errors with no log output.
// ====================================================================
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit – let the request error handler deal with individual failures.
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // Give pending I/O a moment to flush, then exit so Cloud Run restarts us.
  setTimeout(() => process.exit(1), 1000);
});

const app = express();

// ====================================================================
// CRITICAL: Open the port IMMEDIATELY for Cloud Run health checks.
// All route registration and heavy initialization happens AFTER this.
// ====================================================================
const port = parseInt(process.env.PORT || '5000', 10);
const host = "0.0.0.0"; // Cloud Run requires 0.0.0.0, not localhost

// Track whether the app has finished initializing.
let appReady = false;

// Track initialization progress for diagnostics.
const startupTimestamp = Date.now();
let initStatus = 'waiting_for_port';
let initError: string | null = null;
let initSteps: Array<{ step: string; status: string; durationMs?: number; error?: string }> = [];

function recordStep(step: string, status: 'start' | 'done' | 'error', error?: string) {
  const elapsed = Date.now() - startupTimestamp;
  if (status === 'start') {
    initSteps.push({ step, status: 'in_progress' });
    console.log(`[startup +${elapsed}ms] ${step}...`);
  } else if (status === 'done') {
    const existing = initSteps.find(s => s.step === step && s.status === 'in_progress');
    if (existing) {
      existing.status = 'done';
      existing.durationMs = elapsed;
    }
    console.log(`[startup +${elapsed}ms] ${step} - OK`);
  } else {
    const existing = initSteps.find(s => s.step === step && s.status === 'in_progress');
    if (existing) {
      existing.status = 'error';
      existing.durationMs = elapsed;
      existing.error = error;
    } else {
      initSteps.push({ step, status: 'error', durationMs: elapsed, error });
    }
    console.error(`[startup +${elapsed}ms] ${step} - FAILED: ${error}`);
  }
}

/** Mask sensitive parts of a URL for logging (hide password). */
function maskDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    // Not a valid URL – show first/last chars only
    if (url.length > 20) {
      return url.slice(0, 10) + '...' + url.slice(-10);
    }
    return '(invalid URL format)';
  }
}

// Liveness probe - always returns 200 so Cloud Run knows the process is alive.
app.get('/_ah/health', (_req, res) => {
  res.status(200).send('OK');
});

// Readiness / startup probe - returns 200 only after full initialisation
// (routes registered, database reachable). Cloud Run should be configured
// to use this endpoint as the startup probe so that traffic is not routed
// to the container until it is genuinely ready to serve requests.
app.get('/_ah/ready', (_req, res) => {
  if (appReady) {
    return res.status(200).send('READY');
  }
  res.status(503).send('NOT READY');
});

// Diagnostic endpoint – always accessible, shows initialization state.
// This helps debug 503 errors by revealing exactly where startup stalled.
app.get('/_ah/debug', (_req, res) => {
  const envVars = [
    'NODE_ENV', 'PORT', 'DATABASE_URL', 'JWT_SECRET',
    'GOOGLE_API_KEY', 'GEMINI_API_KEY', 'AI_PROVIDER',
    'OPENAI_API_KEY', 'ELEVENLABS_API_KEY',
  ];

  const envPresence: Record<string, boolean> = {};
  for (const key of envVars) {
    envPresence[key] = !!process.env[key];
  }

  const dbUrl = process.env.DATABASE_URL;
  let dbUrlInfo = 'not set';
  if (dbUrl) {
    dbUrlInfo = maskDatabaseUrl(dbUrl);
  }

  res.status(200).json({
    appReady,
    initStatus,
    initError,
    uptimeMs: Date.now() - startupTimestamp,
    steps: initSteps,
    env: envPresence,
    databaseUrlFormat: dbUrlInfo,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
  });
});

// Readiness gate: while the app is initializing, serve a loading page for
// browser requests and 503 for API requests. This prevents "Cannot GET /"
// errors during the startup window before routes are registered.
app.use((req, res, next) => {
  if (appReady) {
    return next();
  }
  // Allow debug endpoint through (already matched above)
  if (req.path.startsWith('/_ah/')) {
    return next();
  }
  if (req.path.startsWith('/api')) {
    return res.status(503).json({ message: 'Service is starting', initStatus, initError });
  }
  res.status(503).set('Retry-After', '5').send(
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Starting up…</title>' +
    '<meta http-equiv="refresh" content="3"></head>' +
    '<body style="display:flex;justify-content:center;align-items:center;height:100vh;margin:0;font-family:system-ui">' +
    `<div style="text-align:center"><p>Service is starting up&hellip;</p>` +
    `<p style="font-size:0.8em;color:#666">Status: ${initStatus}</p>` +
    `${initError ? `<p style="font-size:0.8em;color:red">${initError}</p>` : ''}` +
    `<p style="font-size:0.7em;color:#999">Uptime: ${Math.round((Date.now() - startupTimestamp) / 1000)}s` +
    ` | <a href="/_ah/debug">Debug Info</a></p></div></body></html>`
  );
});

// Request timeout: prevent a single slow request from starving the
// container and causing cascading 503 errors for other requests.
const REQUEST_TIMEOUT_MS = 30_000; // 30 seconds
const LONG_REQUEST_TIMEOUT_MS = 120_000; // 2 minutes for image/video generation
app.use((req, res, next) => {
  // Skip health checks
  if (req.path.startsWith('/_ah/')) return next();

  const isSlowEndpoint = 
    req.path.includes('/api/image/') || 
    req.path.includes('/api/video/') ||
    req.path.includes('/generate-persona') ||
    req.path.includes('/generate-scenario-image') ||
    req.path.includes('/generate-intro-video') ||
    (req.method === 'POST' && req.path.includes('/feedback'));
  
  const timeoutMs = isSlowEndpoint ? LONG_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS;

  res.setTimeout(timeoutMs, () => {
    if (!res.headersSent) {
      console.error(`Request timeout (${timeoutMs}ms): ${req.method} ${req.path}`);
      res.status(504).json({ message: 'Request timeout' });
    }
  });
  next();
});

const server = createServer(app);

console.log(`Starting server on ${host}:${port}...`);

server.listen(port, host, () => {
  console.log(`Server listening on ${host}:${port}`);
  initStatus = 'initializing';

  // Now that the port is open, initialize everything else.
  initializeApp().catch((err) => {
    initStatus = 'fatal_error';
    initError = err?.message || String(err);
    console.error('Fatal: Application initialization failed:', err);
    // Don't exit immediately – keep the server alive so /_ah/debug is accessible
    // for diagnosing the issue. Cloud Run will eventually kill the container
    // when the startup probe fails.
    console.error('Server will remain running for diagnostics. Hit /_ah/debug for details.');
  });
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use`);
  } else if (err.code === 'EACCES') {
    console.error(`Permission denied for port ${port}`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});

// ====================================================================
// Graceful shutdown – Cloud Run sends SIGTERM before killing the
// container. We stop accepting new connections and let in-flight
// requests finish (up to 10 s) to avoid 503 errors during scale-down.
// ====================================================================
let shuttingDown = false;

function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received – starting graceful shutdown`);

  // Stop the readiness probe from advertising this instance.
  appReady = false;

  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });

  // Force-exit after 10 seconds if connections don't drain.
  setTimeout(() => {
    console.error('Graceful shutdown timed out – forcing exit');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ====================================================================
// Full application initialization - runs AFTER the port is open.
// ====================================================================
async function initializeApp() {
  console.log('=== Application Initialization Start ===');
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Node.js: ${process.version}`);
  console.log(`CWD: ${process.cwd()}`);

  // Log which environment variables are present (not their values)
  const secretVars = ['DATABASE_URL', 'JWT_SECRET', 'GOOGLE_API_KEY', 'GEMINI_API_KEY', 'AI_PROVIDER', 'OPENAI_API_KEY', 'ELEVENLABS_API_KEY'];
  for (const key of secretVars) {
    const present = !!process.env[key];
    const len = process.env[key]?.length || 0;
    console.log(`  ${key}: ${present ? `SET (${len} chars)` : 'NOT SET'}`);
  }

  // Step 1: Body parser middleware
  recordStep('body_parser', 'start');
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: false, limit: '10mb' }));
  recordStep('body_parser', 'done');

  // Step 2: Static asset directories
  recordStep('static_assets', 'start');
  app.use('/scenarios/images', express.static(pathModule.join(process.cwd(), 'scenarios', 'images')));
  app.use('/scenarios/videos', express.static(pathModule.join(process.cwd(), 'scenarios', 'videos')));
  app.use('/personas', express.static(pathModule.join(process.cwd(), 'attached_assets', 'personas')));
  recordStep('static_assets', 'done');

  // Step 3: Request logging middleware
  recordStep('request_logging', 'start');
  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, any> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      const duration = Date.now() - start;
      if (path.startsWith("/api")) {
        let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
        if (capturedJsonResponse) {
          logLine += ` :: ${sanitizeLogData(capturedJsonResponse)}`;
        }
        if (logLine.length > 80) {
          logLine = logLine.slice(0, 79) + "\u2026";
        }
        log(logLine);
      }
    });

    next();
  });
  recordStep('request_logging', 'done');

  // Step 4: Register API routes (passes the existing server for WebSocket setup)
  recordStep('register_routes', 'start');
  initStatus = 'registering_routes';
  try {
    await registerRoutes(app, server);
    recordStep('register_routes', 'done');
  } catch (error: any) {
    recordStep('register_routes', 'error', error?.message);
    throw error;
  }

  // Step 5: Error handler (must be after routes)
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });

  // Step 6: Static file serving / Vite dev server (must be last - has catch-all)
  recordStep('static_serving', 'start');
  initStatus = 'setting_up_static';
  try {
    if (app.get("env") === "development") {
      const vitePath = "./vite";
      const viteModule = await import(/* @vite-ignore */ vitePath);
      await viteModule.setupVite(app, server);
    } else {
      serveStatic(app);
    }
    recordStep('static_serving', 'done');
  } catch (error: any) {
    recordStep('static_serving', 'error', error?.message);
    throw error;
  }

  // ----------------------------------------------------------------
  // Step 7: Database readiness
  //
  // The Cloud SQL Auth Proxy sidecar may take a few seconds to start,
  // so we retry the connection several times before giving up.
  //
  // TIMING: Must complete within the startup probe window.
  // Probe config: period=5s, threshold=24 → 120s max.
  // Retry config: 15 attempts with exponential backoff (1s→5s cap) ≈ 55s max.
  // ----------------------------------------------------------------
  const DB_MAX_RETRIES = 15;
  const DB_INITIAL_DELAY_MS = 1000;
  const DB_MAX_DELAY_MS = 5000;
  const DB_BACKOFF_FACTOR = 1.5;

  if (!process.env.DATABASE_URL) {
    initStatus = 'failed_no_database_url';
    initError = 'DATABASE_URL is not set';
    console.error('FATAL: DATABASE_URL is not set. Ensure the secret is configured on the Cloud Run service.');
    console.error('Deploy with: gcloud builds submit --config cloudbuild.yaml');
    recordStep('database_url_check', 'error', 'DATABASE_URL not set');
    // Do NOT mark as ready — the startup probe will fail and Cloud Run
    // will show a clear deployment error instead of silently broken requests.
    return;
  }

  // Log masked URL for diagnostics
  console.log(`DATABASE_URL format: ${maskDatabaseUrl(process.env.DATABASE_URL)}`);

  recordStep('database_connect', 'start');
  initStatus = 'connecting_to_database';
  let dbConnected = false;

  let currentDelay = DB_INITIAL_DELAY_MS;

  for (let attempt = 1; attempt <= DB_MAX_RETRIES; attempt++) {
    try {
      console.log(`Database connection attempt ${attempt}/${DB_MAX_RETRIES}...`);
      const dbOk = await checkDatabaseConnection();
      if (dbOk) {
        console.log(`Database connection verified on attempt ${attempt}`);
        dbConnected = true;
        break;
      }
      console.warn(`Database connection attempt ${attempt} returned false`);
    } catch (error: any) {
      console.warn(`Database connection attempt ${attempt} failed: ${error.message}`);
      if (error.code) console.warn(`  Error code: ${error.code}`);
    }

    if (attempt < DB_MAX_RETRIES) {
      console.log(`Retrying in ${(currentDelay / 1000).toFixed(1)}s... (attempt ${attempt + 1} next)`);
      await new Promise(resolve => setTimeout(resolve, currentDelay));
      currentDelay = Math.min(currentDelay * DB_BACKOFF_FACTOR, DB_MAX_DELAY_MS);
    }
  }

  if (!dbConnected) {
    initStatus = 'failed_database_connection';
    initError = `Could not connect to database after ${DB_MAX_RETRIES} attempts`;
    recordStep('database_connect', 'error', initError);
    console.error(`FATAL: ${initError}`);
    console.error('Check: 1) DATABASE_URL secret value  2) Cloud SQL Auth Proxy (--add-cloudsql-instances)  3) Cloud SQL instance status');
    // Do NOT mark as ready — the startup probe will fail and Cloud Run
    // will restart the container. This avoids serving requests that will
    // always fail with "cannot connect to database".
    return;
  }

  recordStep('database_connect', 'done');

  // Step 8: Run database migrations
  recordStep('migrations', 'start');
  initStatus = 'running_migrations';
  try {
    await runMigrations();
    recordStep('migrations', 'done');
  } catch (error: any) {
    // Non-fatal: tables likely already exist from a previous deployment.
    recordStep('migrations', 'error', error?.message);
    console.error('Database migration failed (non-fatal):', error);
  }

  // All routes, middleware, and database are ready - open the gate.
  appReady = true;
  initStatus = 'ready';

  log(`serving on port ${port} (host: ${host})`);
  console.log('=== Application Ready ===');
  console.log(`Total startup time: ${Date.now() - startupTimestamp}ms`);

  // Background: non-essential cache warming.
  warmCacheInBackground();
}

function sanitizeLogData(data: Record<string, any> | undefined): string {
  if (!data) return "";
  const sensitiveKeys = ['token', 'password', 'accessToken', 'refreshToken', 'jwt', 'secret', 'apiKey'];
  const sanitized = { ...data };
  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk.toLowerCase()))) {
      sanitized[key] = '[REDACTED]';
    }
  }
  return JSON.stringify(sanitized);
}

function warmCacheInBackground() {
  (async () => {
    try {
      console.log('Loading MBTI cache...');
      const mbtiCache = GlobalMBTICache.getInstance();
      await mbtiCache.preloadAllMBTIData();
      console.log('MBTI cache loaded');
    } catch (error) {
      console.error('MBTI cache preload failed (non-fatal):', error);
    }
    console.log('Background initialization complete');
  })();
}
