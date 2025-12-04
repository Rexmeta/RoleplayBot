import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { GlobalMBTICache } from "./utils/globalMBTICache";
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

// 사용자 프로필 이미지 업로드 폴더를 정적으로 제공
app.use('/uploads', express.static(pathModule.join(process.cwd(), 'public', 'uploads')));

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
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
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
  // 🚀 MBTI 캐시 프리로드 (성능 최적화)
  const mbtiCache = GlobalMBTICache.getInstance();
  await mbtiCache.preloadAllMBTIData();

  const server = await registerRoutes(app);

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
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  const host = process.env.HOST || "0.0.0.0";
  
  // Windows에서는 reusePort가 지원되지 않으므로 제거
  const listenOptions: any = {
    port,
    host,
  };
  
  // Linux/macOS에서만 reusePort 사용 (Windows 호환성)
  if (process.platform !== 'win32') {
    listenOptions.reusePort = true;
  }
  
  server.listen(listenOptions, () => {
    log(`serving on port ${port} (host: ${host})`);
    log(`platform: ${process.platform}`);
    
    // 로컬 접속 가이드
    if (host === "127.0.0.1" || host === "localhost") {
      log(`Local access: http://localhost:${port}`);
    } else {
      log(`Network access: http://${host}:${port}`);
    }
  });
})();
