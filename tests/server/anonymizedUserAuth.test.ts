/**
 * anonymizedUserAuth.test.ts
 *
 * Verifies that anonymized / inactive accounts are permanently blocked from
 * logging in, even when their credentials are valid, and that the admin
 * anonymize endpoint is idempotent (returns 400 on a second call).
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import cookieParser from "cookie-parser";

// ─── Hoist mocks ─────────────────────────────────────────────────────────────

// Mock bcryptjs so compare always returns true (simulates leaked-but-valid creds)
vi.mock("bcryptjs", () => ({
  default: {
    compare: vi.fn().mockResolvedValue(true),
    hash: vi.fn().mockResolvedValue("hashed"),
    genSalt: vi.fn().mockResolvedValue("salt"),
  },
  compare: vi.fn().mockResolvedValue(true),
  hash: vi.fn().mockResolvedValue("hashed"),
  genSalt: vi.fn().mockResolvedValue("salt"),
}));

// Mock Redis so rate limiting uses the in-memory fallback
vi.mock("../../server/redisClient", () => ({
  redis: null,
  redisAvailable: false,
}));

// Mock DB to prevent any real database calls
vi.mock("../../server/storage/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  },
}));

// Storage mock — individual methods are configured per test
const storageMock = {
  getUserByEmail: vi.fn(),
  getUserByEmailWithPassword: vi.fn(),
  updateUserLastLogin: vi.fn().mockResolvedValue(undefined),
  createSession: vi.fn().mockResolvedValue({ id: "session-1" }),
  deleteSessionsByUserId: vi.fn().mockResolvedValue(undefined),
  getUser: vi.fn(),
  anonymizeUser: vi.fn(),
  getAllCompanies: vi.fn().mockResolvedValue([]),
};

vi.mock("../../server/storage", () => ({
  storage: storageMock,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-123",
    email: "test@example.com",
    name: "Test User",
    password: "irrelevant-bcrypt-hash",
    role: "user",
    isActive: true,
    isAnonymized: false,
    companyId: "company-1",
    organizationId: "org-1",
    assignedCategoryId: null,
    ...overrides,
  };
}

// ─── App setup ───────────────────────────────────────────────────────────────

let app: express.Express;

beforeAll(async () => {
  process.env.JWT_SECRET = "test-secret-that-is-long-enough-32chars";

  const expressApp = express();
  expressApp.use(express.json());
  expressApp.use(cookieParser());

  // Register the auth routes (login endpoint lives here)
  const { setupAuth } = await import("../../server/auth");
  setupAuth(expressApp);

  app = expressApp;
});

afterAll(() => {
  delete process.env.JWT_SECRET;
});

// ─── Login endpoint tests ─────────────────────────────────────────────────────

describe("POST /api/auth/login — anonymized / inactive account guard", () => {
  const credentials = { email: "test@example.com", password: "anyPassword1!" };

  it("returns 401 for an anonymized user even when credentials are valid", async () => {
    storageMock.getUserByEmail.mockResolvedValue(
      makeUser({ isAnonymized: true, isActive: false })
    );

    const res = await request(app)
      .post("/api/auth/login")
      .send(credentials);

    expect(res.status).toBe(401);
  });

  it("returns 401 for an inactive (non-anonymized) user even when credentials are valid", async () => {
    storageMock.getUserByEmail.mockResolvedValue(
      makeUser({ isActive: false, isAnonymized: false })
    );

    const res = await request(app)
      .post("/api/auth/login")
      .send(credentials);

    expect(res.status).toBe(401);
  });

  it("allows a normal active user to log in successfully", async () => {
    storageMock.getUserByEmail.mockResolvedValue(
      makeUser({ isActive: true, isAnonymized: false })
    );

    const res = await request(app)
      .post("/api/auth/login")
      .send(credentials);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("token");
  });
});

// ─── Anonymize endpoint idempotency test ─────────────────────────────────────

describe("POST /api/admin/users/:userId/anonymize — idempotency guard", () => {
  it("returns 400 when the target user is already anonymized", async () => {
    // Set up a separate app that includes the admin router with a stubbed
    // isAuthenticated middleware that injects an admin actor.
    const adminApp = express();
    adminApp.use(express.json());
    adminApp.use(cookieParser());

    // Stub isAuthenticated to inject an admin actor into req.user
    const fakeIsAuthenticated = (req: any, _res: any, next: any) => {
      req.user = {
        id: "admin-1",
        role: "admin",
        isActive: true,
        isAnonymized: false,
      };
      next();
    };

    const { default: createAdminOrganizationsRouter } = await import(
      "../../server/routes/adminOrganizations"
    );
    adminApp.use(createAdminOrganizationsRouter(fakeIsAuthenticated));

    // Target user is already anonymized
    storageMock.getUser.mockResolvedValue(
      makeUser({ isAnonymized: true, isActive: false })
    );

    const res = await request(adminApp)
      .post("/api/admin/users/user-123/anonymize")
      .set("Authorization", "Bearer fake-token");

    expect(res.status).toBe(400);
  });
});
