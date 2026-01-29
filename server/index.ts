import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { createServer } from "http";
import { registerRoutes } from "./routes";
import { serveStatic, log } from "./static";
import { GlobalMBTICache } from "./utils/globalMBTICache";
import { runMigrations } from "./migrate";
import * as pathModule from "path";

const app = express();

// ====================================================================
// CRITICAL: Open the port IMMEDIATELY for Cloud Run health checks.
// All route registration and heavy initialization happens AFTER this.
// ====================================================================
const port = parseInt(process.env.PORT || '5000', 10);
const host = "0.0.0.0"; // Cloud Run requires 0.0.0.0, not localhost

// Track whether the app has finished initializing.
let appReady = false;

// Minimal health check - available before any routes are registered.
// Cloud Run startup probe hits this endpoint to verify the container is alive.
app.get('/_ah/health', (_req, res) => {
  res.status(200).send('OK');
});

// Readiness gate: while the app is initializing, serve a loading page for
// browser requests and 503 for API requests. This prevents "Cannot GET /"
// errors during the startup window before routes are registered.
app.use((req, res, next) => {
  if (appReady) {
    return next();
  }
  if (req.path.startsWith('/api')) {
    return res.status(503).json({ message: 'Service is starting' });
  }
  res.status(503).set('Retry-After', '5').send(
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Starting up…</title>' +
    '<meta http-equiv="refresh" content="3"></head>' +
    '<body style="display:flex;justify-content:center;align-items:center;height:100vh;margin:0;font-family:system-ui">' +
    '<p>Service is starting up&hellip;</p></body></html>'
  );
});

const server = createServer(app);

console.log(`Starting server on ${host}:${port}...`);

server.listen(port, host, () => {
  console.log(`Server listening on ${host}:${port}`);

  // Now that the port is open, initialize everything else.
  initializeApp().catch((err) => {
    console.error('Fatal: Application initialization failed:', err);
    process.exit(1);
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
// Full application initialization - runs AFTER the port is open.
// ====================================================================
async function initializeApp() {
  console.log('Initializing application...');
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

  // Body parser middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: false, limit: '10mb' }));

  // Static asset directories
  app.use('/scenarios/images', express.static(pathModule.join(process.cwd(), 'scenarios', 'images')));
  app.use('/scenarios/videos', express.static(pathModule.join(process.cwd(), 'scenarios', 'videos')));
  app.use('/personas', express.static(pathModule.join(process.cwd(), 'attached_assets', 'personas')));

  // Request logging middleware
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

  // Register API routes (passes the existing server for WebSocket setup)
  console.log('Registering routes...');
  await registerRoutes(app, server);
  console.log('Routes registered');

  // Error handler (must be after routes)
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });

  // Static file serving / Vite dev server (must be last - has catch-all)
  if (app.get("env") === "development") {
    const vitePath = "./vite";
    const viteModule = await import(/* @vite-ignore */ vitePath);
    await viteModule.setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // All routes and middleware are registered - open the gate.
  appReady = true;

  log(`serving on port ${port} (host: ${host})`);
  console.log('Application ready');

  // Background initialization: database migrations and cache warming.
  initializeAsync();
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

async function initializeAsync() {
  try {
    console.log('Running database migrations...');
    await runMigrations();
    console.log('Database migrations completed');
  } catch (error) {
    console.error('Database migration failed (non-fatal):', error);
  }

  try {
    console.log('Loading MBTI cache...');
    const mbtiCache = GlobalMBTICache.getInstance();
    await mbtiCache.preloadAllMBTIData();
    console.log('MBTI cache loaded');
  } catch (error) {
    console.error('MBTI cache preload failed (non-fatal):', error);
  }

  console.log('Background initialization complete');
}
