import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Express, RequestHandler } from "express";
import { storage } from "./storage";
import { z } from "zod";

// JWT_SECRET 필수 - 환경 변수가 없으면 서버 시작 시 에러 발생
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("⛔ CRITICAL: JWT_SECRET environment variable is required. Server cannot start without it.");
}
const JWT_EXPIRES_IN = "7d"; // 7일

// Rate Limiting 설정 (메모리 기반)
const loginAttempts = new Map<string, { count: number; firstAttempt: number }>();
const RATE_LIMIT_WINDOW = 5 * 60 * 1000; // 5분
const MAX_LOGIN_ATTEMPTS = 5;

function checkRateLimit(identifier: string): { allowed: boolean; remainingTime?: number } {
  const now = Date.now();
  const attempts = loginAttempts.get(identifier);
  
  if (!attempts) {
    return { allowed: true };
  }
  
  // 윈도우 시간이 지났으면 초기화
  if (now - attempts.firstAttempt > RATE_LIMIT_WINDOW) {
    loginAttempts.delete(identifier);
    return { allowed: true };
  }
  
  if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
    const remainingTime = Math.ceil((RATE_LIMIT_WINDOW - (now - attempts.firstAttempt)) / 1000);
    return { allowed: false, remainingTime };
  }
  
  return { allowed: true };
}

function recordLoginAttempt(identifier: string): void {
  const now = Date.now();
  const attempts = loginAttempts.get(identifier);
  
  if (!attempts || now - attempts.firstAttempt > RATE_LIMIT_WINDOW) {
    loginAttempts.set(identifier, { count: 1, firstAttempt: now });
  } else {
    attempts.count++;
  }
}

function clearLoginAttempts(identifier: string): void {
  loginAttempts.delete(identifier);
}

// 비밀번호 복잡성 검증
const passwordSchema = z.string()
  .min(8, "비밀번호는 최소 8자 이상이어야 합니다")
  .regex(/[A-Z]/, "비밀번호에 대문자를 포함해야 합니다")
  .regex(/[a-z]/, "비밀번호에 소문자를 포함해야 합니다")
  .regex(/[0-9]/, "비밀번호에 숫자를 포함해야 합니다")
  .regex(/[!@#$%^&*(),.?":{}|<>]/, "비밀번호에 특수문자를 포함해야 합니다");

// 회원가입 스키마
const registerSchema = z.object({
  email: z.string().email("유효한 이메일을 입력해주세요"),
  password: passwordSchema,
  name: z.string().min(1, "이름을 입력해주세요").max(50, "이름은 50자 이하여야 합니다"),
  categoryId: z.string().uuid().optional(),
});

// 로그인 스키마
const loginSchema = z.object({
  email: z.string().email("유효한 이메일을 입력해주세요"),
  password: z.string().min(1, "비밀번호를 입력해주세요"),
  rememberMe: z.boolean().optional().default(false),
});

// JWT 토큰 생성
export function generateToken(userId: string, rememberMe: boolean = false) {
  const expiresIn = rememberMe ? "30d" : JWT_EXPIRES_IN; // 자동로그인시 30일
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn });
}

// JWT 토큰 검증
export function verifyToken(token: string): { userId: string } | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    return decoded;
  } catch (error) {
    return null;
  }
}

// 비밀번호 해시
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

// 비밀번호 검증
export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

// 인증 미들웨어
export const isAuthenticated: RequestHandler = async (req: any, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') 
      ? authHeader.substring(7) 
      : req.cookies?.token;

    if (!token) {
      return res.status(401).json({ message: "인증 토큰이 필요합니다" });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ message: "유효하지 않은 토큰입니다" });
    }

    const user = await storage.getUser(decoded.userId);
    if (!user) {
      return res.status(401).json({ message: "사용자를 찾을 수 없습니다" });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("Authentication error:", error);
    res.status(401).json({ message: "인증 오류" });
  }
};

// 인증 라우트 설정
export function setupAuth(app: Express) {
  // 회원가입
  app.post("/api/auth/register", async (req, res) => {
    try {
      const { email, password, name, categoryId } = registerSchema.parse(req.body);

      // 이미 존재하는 사용자 확인
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "이미 존재하는 이메일입니다" });
      }

      // 비밀번호 해시
      const hashedPassword = await hashPassword(password);

      // 사용자 생성 (categoryId는 선택사항으로 저장)
      const user = await storage.createUser({
        email,
        password: hashedPassword,
        name,
        assignedCategoryId: categoryId || null,
      });

      // JWT 토큰 생성
      const token = generateToken(user.id);

      res.status(201).json({
        message: "회원가입이 완료되었습니다",
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role || 'user',
        },
        token,
      });
    } catch (error) {
      console.error("Registration error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "입력 오류",
          errors: error.errors.map(e => e.message),
        });
      }
      res.status(500).json({ message: "서버 오류가 발생했습니다" });
    }
  });

  // 로그인
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password, rememberMe } = loginSchema.parse(req.body);
      
      // Rate Limiting 체크 (IP + 이메일 조합)
      const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
      const rateLimitKey = `${clientIp}:${email}`;
      const rateCheck = checkRateLimit(rateLimitKey);
      
      if (!rateCheck.allowed) {
        return res.status(429).json({ 
          message: `로그인 시도가 너무 많습니다. ${rateCheck.remainingTime}초 후에 다시 시도해주세요.` 
        });
      }

      // 사용자 찾기
      const user = await storage.getUserByEmail(email);
      if (!user) {
        recordLoginAttempt(rateLimitKey);
        return res.status(400).json({ message: "이메일 또는 비밀번호가 일치하지 않습니다" });
      }

      // 비밀번호 검증
      const isPasswordValid = await verifyPassword(password, user.password);
      if (!isPasswordValid) {
        recordLoginAttempt(rateLimitKey);
        return res.status(400).json({ message: "이메일 또는 비밀번호가 일치하지 않습니다" });
      }
      
      // 로그인 성공 시 실패 횟수 초기화
      clearLoginAttempts(rateLimitKey);

      // JWT 토큰 생성
      const token = generateToken(user.id, rememberMe);

      // 마지막 로그인 시간 업데이트
      await storage.updateUserLastLogin(user.id);

      // 쿠키 설정 (자동로그인용) - 보안 강화
      if (rememberMe) {
        res.cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict', // CSRF 방지
          maxAge: 30 * 24 * 60 * 60 * 1000, // 30일
        });
      }

      res.json({
        message: "로그인이 완료되었습니다",
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role || 'user',
        },
        token,
      });
    } catch (error) {
      console.error("Login error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          message: "입력 오류",
          errors: error.errors.map(e => e.message),
        });
      }
      res.status(500).json({ message: "서버 오류가 발생했습니다" });
    }
  });

  // 로그아웃
  app.post("/api/auth/logout", (req, res) => {
    res.clearCookie('token');
    res.json({ message: "로그아웃이 완료되었습니다" });
  });

  // 현재 사용자 정보 조회
  app.get("/api/auth/user", isAuthenticated, (req: any, res) => {
    const { password, ...userWithoutPassword } = req.user;
    res.json(userWithoutPassword);
  });

  // 토큰 검증
  app.post("/api/auth/verify", (req, res) => {
    try {
      const { token } = req.body;
      if (!token) {
        return res.status(400).json({ valid: false, message: "토큰이 필요합니다" });
      }

      const decoded = verifyToken(token);
      if (!decoded) {
        return res.status(401).json({ valid: false, message: "유효하지 않은 토큰입니다" });
      }

      res.json({ valid: true, userId: decoded.userId });
    } catch (error) {
      console.error("Token verification error:", error);
      res.status(500).json({ valid: false, message: "서버 오류" });
    }
  });

  // WebSocket 실시간 통신 전용 단기 토큰 발급
  app.post("/api/auth/realtime-token", isAuthenticated, (req: any, res) => {
    try {
      const user = req.user;
      
      // 5분 유효 WebSocket 전용 토큰 생성
      const realtimeToken = jwt.sign(
        { userId: user.id, type: 'realtime' },
        JWT_SECRET,
        { expiresIn: '5m' }
      );

      res.json({
        token: realtimeToken,
        expiresIn: 300, // 5분 (초 단위)
      });
    } catch (error) {
      console.error("Realtime token generation error:", error);
      res.status(500).json({ message: "토큰 생성 오류" });
    }
  });
}