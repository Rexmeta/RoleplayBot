import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic, log } from "./static";
import { GlobalMBTICache } from "./utils/globalMBTICache";
import { runMigrations } from "./migrate";
import * as pathModule from "path";

const app = express();
// 시나리오 데이터가 크기 때문에 body-parser limit 증가 (기본: 100kb → 10MB)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

// scenarios/images 폴더의 이미지 파일들을 정적으로 제공 (보안상 images만 공개)
app.use('/scenarios/images', express.static(pathModule.join(process.cwd(), 'scenarios', 'images')));

// scenarios/videos 폴더의 영상 파일들을 정적으로 제공 (인트로 영상)
app.use('/scenarios/videos', express.static(pathModule.join(process.cwd(), 'scenarios', 'videos')));

// attached_assets/personas 폴더의 페르소나별 표정 이미지를 정적으로 제공
app.use('/personas', express.static(pathModule.join(process.cwd(), 'attached_assets', 'personas')));

// 사용자 프로필 이미지 업로드 폴더 - 인증 필요
// 참고: 실제 인증된 접근은 server/routes.ts에서 처리
// 기본 정적 파일 제공은 비활성화 (보안상 이유)

// 민감 정보 제거 함수
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
      // 민감 정보 제거된 로그만 출력
      if (capturedJsonResponse) {
        logLine += ` :: ${sanitizeLogData(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  console.log('🚀 Starting server initialization...');
  console.log(`📋 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔌 PORT: ${process.env.PORT || '5000'}`);
  
  // 🗄️ 데이터베이스 마이그레이션 실행 (테이블 자동 생성)
  try {
    console.log('🗄️ Running database migrations...');
    await runMigrations();
  } catch (error) {
    console.error('⚠️ Database migration failed (non-fatal):', error);
  }
  
  // 🚀 MBTI 캐시 프리로드 (성능 최적화) - 실패해도 서버 시작 계속
  try {
    console.log('📦 Loading MBTI cache...');
    const mbtiCache = GlobalMBTICache.getInstance();
    await mbtiCache.preloadAllMBTIData();
    console.log('✅ MBTI cache loaded successfully');
  } catch (error) {
    console.error('⚠️ MBTI cache preload failed (non-fatal):', error);
  }

  console.log('📡 Registering routes...');
  const server = await registerRoutes(app);
  console.log('✅ Routes registered successfully');

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    console.log('🔧 Setting up Vite (development)...');
    const vitePath = "./vite";
    const viteModule = await import(/* @vite-ignore */ vitePath);
    await viteModule.setupVite(app, server);
  } else {
    console.log('📁 Setting up static file serving (production)...');
    serveStatic(app);
    console.log('✅ Static file serving configured');
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  const host = "0.0.0.0"; // Cloud Run requires 0.0.0.0, not localhost
  
  console.log(`🌐 Starting server on ${host}:${port}...`);
  
  // Cloud Run 호환성을 위해 reusePort 옵션 제거
  server.listen(port, host, () => {
    console.log('✅ Server started successfully!');
    console.log(`🎉 Application ready at http://${host}:${port}`);
    log(`serving on port ${port} (host: ${host})`);
    log(`platform: ${process.platform}`);
    log(`Network access: http://${host}:${port}`);
  });
  
  // 서버 시작 오류 핸들링
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
})();
