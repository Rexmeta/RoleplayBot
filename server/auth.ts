import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Express, RequestHandler } from "express";
import { storage } from "./storage";
import { z } from "zod";

/**
 * Detect whether an error originates from the database layer (pg / network).
 * These are transient failures that should be surfaced as HTTP 503 so
 * Cloud Run and clients can retry.
 */
function isDatabaseError(error: any): boolean {
  const msg: string = error?.message || '';
  const code: string = error?.code || '';

  // node-postgres error codes (e.g. ECONNREFUSED, ECONNRESET, ETIMEDOUT)
  if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN'].includes(code)) {
    return true;
  }

  // Connection timeout from pg Pool
  if (msg.includes('timeout') && (msg.includes('connect') || msg.includes('pool') || msg.includes('acquiring'))) {
    return true;
  }

  // Cloud SQL socket errors
  if (msg.includes('/cloudsql/') || msg.includes('UNIX socket')) {
    return true;
  }

  // Generic connection-related messages from pg
  if (msg.includes('ECONNREFUSED') || msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT')) {
    return true;
  }

  // pg "Connection terminated" (server closed the connection)
  if (msg.includes('Connection terminated') || msg.includes('connection terminated')) {
    return true;
  }

  // Pool ended while a query was running
  if (msg.includes('Cannot use a pool after calling end')) {
    return true;
  }

  return false;
}

// JWT_SECRET - read at module load time but only enforce at first use.
// This prevents the server from crashing before it can open the port.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("WARNING: JWT_SECRET environment variable is not set. Auth will fail at request time.");
}

function getJwtSecret(): string {
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET environment variable is required but not set.");
  }
  return JWT_SECRET;
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
  companyId: z.string().uuid().optional(),  // 소속 회사
  organizationId: z.string().uuid().optional(),  // 소속 조직
  preferredLanguage: z.enum(['ko', 'en', 'ja', 'zh']).optional().default('ko'),
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
  return jwt.sign({ userId }, getJwtSecret(), { expiresIn });
}

// JWT 토큰 검증
export function verifyToken(token: string): { userId: string } | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as { userId: string };
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

// 기본 회사/조직/카테고리 생성 또는 가져오기 (추후 입력)
const DEFAULT_PLACEHOLDER_NAME = "추후 입력";

async function getOrCreateDefaultHierarchy(): Promise<{ companyId: string; organizationId: string; categoryId: string }> {
  // 기본 회사 가져오기 또는 생성
  let company = await storage.getCompanyByName(DEFAULT_PLACEHOLDER_NAME);
  if (!company) {
    company = await storage.createCompany({
      name: DEFAULT_PLACEHOLDER_NAME,
      code: "TBD",
      description: "기본 회사 - 추후 입력",
      isActive: true,
    });
    console.log(`📦 Created default company: ${DEFAULT_PLACEHOLDER_NAME}`);
  }

  // 기본 조직 가져오기 또는 생성
  const organizations = await storage.getOrganizationsByCompany(company.id);
  let organization = organizations.find(org => org.name === DEFAULT_PLACEHOLDER_NAME);
  if (!organization) {
    organization = await storage.createOrganization({
      companyId: company.id,
      name: DEFAULT_PLACEHOLDER_NAME,
      description: "기본 조직 - 추후 입력",
      isActive: true,
    });
    console.log(`🏢 Created default organization: ${DEFAULT_PLACEHOLDER_NAME}`);
  }

  // 기본 카테고리 가져오기 또는 생성
  const categories = await storage.getCategoriesByOrganization(organization.id);
  let category = categories.find(cat => cat.name === DEFAULT_PLACEHOLDER_NAME);
  if (!category) {
    category = await storage.createCategory({
      organizationId: organization.id,
      name: DEFAULT_PLACEHOLDER_NAME,
      description: "기본 카테고리 - 추후 입력",
      isActive: true,
      order: 0,
    });
    console.log(`📂 Created default category: ${DEFAULT_PLACEHOLDER_NAME}`);
  }

  return {
    companyId: company.id,
    organizationId: organization.id,
    categoryId: category.id,
  };
}

// 인증 라우트 설정
export function setupAuth(app: Express) {
  // 회원가입
  app.post("/api/auth/register", async (req, res) => {
    try {
      const { email, password, name, categoryId, companyId, organizationId, preferredLanguage } = registerSchema.parse(req.body);

      // 이미 존재하는 사용자 확인
      const existingUser = await storage.getUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: "이미 존재하는 이메일입니다" });
      }

      // 비밀번호 해시
      const hashedPassword = await hashPassword(password);

      // 첫 번째 회원가입자는 자동으로 admin으로 설정
      const allUsers = await storage.getAllUsers();
      const isFirstUser = allUsers.length === 0;

      // 기본 회사/조직/카테고리 가져오기 (지정되지 않은 경우)
      const defaults = await getOrCreateDefaultHierarchy();
      const finalCompanyId = companyId || defaults.companyId;
      const finalOrganizationId = organizationId || defaults.organizationId;
      const finalCategoryId = categoryId || defaults.categoryId;

      // 사용자 생성 (회사/조직/카테고리는 기본값으로 설정)
      const user = await storage.createUser({
        email,
        password: hashedPassword,
        name,
        assignedCategoryId: finalCategoryId,
        companyId: finalCompanyId,
        organizationId: finalOrganizationId,
        preferredLanguage: preferredLanguage || 'ko',
      });

      // 첫 번째 사용자면 admin으로 업그레이드
      let finalRole = user.role || 'user';
      if (isFirstUser) {
        await storage.adminUpdateUser(user.id, { role: 'admin' });
        finalRole = 'admin';
        console.log(`🔑 First user ${email} automatically set as admin`);
      }

      // JWT 토큰 생성
      const token = generateToken(user.id);

      res.status(201).json({
        message: isFirstUser ? "회원가입이 완료되었습니다. 첫 번째 사용자로 관리자 권한이 부여되었습니다." : "회원가입이 완료되었습니다",
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: finalRole,
        },
        token,
      });
    } catch (error: any) {
      console.error("Registration error:", error);
      if (error instanceof z.ZodError) {
        const errorMessages = error.errors.map(e => e.message);
        return res.status(400).json({
          message: errorMessages.join(', '),
          errors: errorMessages,
        });
      }
      // Detect database / infrastructure errors and surface as 503 so
      // Cloud Run (and clients) know the failure is transient.
      if (isDatabaseError(error)) {
        return res.status(503).json({ message: "데이터베이스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요." });
      }
      res.status(500).json({ message: "서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요." });
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
      if (isDatabaseError(error)) {
        return res.status(503).json({ message: "데이터베이스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요." });
      }
      res.status(500).json({ message: "서버 오류가 발생했습니다" });
    }
  });

  // 로그아웃
  app.post("/api/auth/logout", (req, res) => {
    res.clearCookie('token');
    res.json({ message: "로그아웃이 완료되었습니다" });
  });

  // 현재 사용자 정보 조회 (조직 정보 포함)
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const { password, ...userWithoutPassword } = req.user;
      
      let organizationInfo = null;
      let companyInfo = null;
      
      if (userWithoutPassword.assignedOrganizationId) {
        const organization = await storage.getOrganization(userWithoutPassword.assignedOrganizationId);
        if (organization) {
          organizationInfo = { id: organization.id, name: organization.name, code: organization.code };
          
          if (organization.companyId) {
            const company = await storage.getCompany(organization.companyId);
            if (company) {
              companyInfo = { id: company.id, name: company.name, code: company.code };
            }
          }
        }
      }
      
      res.json({
        ...userWithoutPassword,
        organization: organizationInfo,
        company: companyInfo,
      });
    } catch (error) {
      console.error("Error fetching user info:", error);
      const { password, ...userWithoutPassword } = req.user;
      res.json(userWithoutPassword);
    }
  });

  // 사용자 언어 설정 업데이트
  app.patch("/api/auth/user/language", isAuthenticated, async (req: any, res) => {
    try {
      const { language } = req.body;
      
      const validLanguages = ['ko', 'en', 'ja', 'zh'];
      if (!language || !validLanguages.includes(language)) {
        return res.status(400).json({ message: "유효하지 않은 언어 코드입니다" });
      }

      const updatedUser = await storage.updateUserLanguage(req.user.id, language);
      const { password, ...userWithoutPassword } = updatedUser;
      
      res.json(userWithoutPassword);
    } catch (error) {
      console.error("Language update error:", error);
      res.status(500).json({ message: "언어 설정 업데이트 중 오류가 발생했습니다" });
    }
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
        getJwtSecret(),
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

  // 게스트 로그인 (비밀번호 없이 서버에서 직접 세션 생성)
  // POST 메서드 사용 (상태 변경 작업), rate limiting 적용
  app.post("/api/auth/guest-login", async (req, res) => {
    try {
      const GUEST_EMAIL = 'guest@mothle.com';
      
      // Rate Limiting 체크 (IP 기반)
      const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
      const rateLimitKey = `${clientIp}:guest-login`;
      const rateCheck = checkRateLimit(rateLimitKey);
      
      if (!rateCheck.allowed) {
        return res.status(429).json({ 
          message: `로그인 시도가 너무 많습니다. ${rateCheck.remainingTime}초 후에 다시 시도해주세요.` 
        });
      }
      
      // 게스트 사용자 찾기
      const guestUser = await storage.getUserByEmail(GUEST_EMAIL);
      if (!guestUser) {
        recordLoginAttempt(rateLimitKey);
        return res.status(404).json({ 
          message: "게스트 계정이 설정되지 않았습니다. 관리자에게 문의하세요." 
        });
      }

      // 게스트 데모 완료 여부 확인
      const existingRuns = await storage.getUserScenarioRuns(guestUser.id);
      const hasCompletedDemo = existingRuns.some((run: any) => run.status === 'completed');
      
      if (hasCompletedDemo) {
        return res.status(403).json({ 
          message: "게스트 체험이 이미 완료되었습니다. 정식 회원가입을 해주세요.",
          demoCompleted: true
        });
      }

      // 로그인 성공 시 실패 횟수 초기화
      clearLoginAttempts(rateLimitKey);

      // JWT 토큰 생성 (게스트용 - 24시간 유효)
      const token = jwt.sign(
        { userId: guestUser.id },
        getJwtSecret(),
        { expiresIn: '24h' }
      );

      // 마지막 로그인 시간 업데이트
      await storage.updateUserLastLogin(guestUser.id);

      // 쿠키 설정 (24시간) - httpOnly로만 저장, localStorage 사용 안 함
      res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000, // 24시간
      });

      // 사용자 정보 반환 (토큰은 httpOnly 쿠키로만 전달, 클라이언트에 노출하지 않음)
      res.json({
        message: "게스트 로그인이 완료되었습니다",
        user: {
          id: guestUser.id,
          email: guestUser.email,
          name: guestUser.name,
          role: guestUser.role || 'user',
          isGuest: true,
          hasCompletedDemo: false,
        },
      });
    } catch (error) {
      console.error("Guest login error:", error);
      res.status(500).json({ message: "게스트 로그인 중 오류가 발생했습니다" });
    }
  });
}