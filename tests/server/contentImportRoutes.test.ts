import express, { type RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import createContentImportsRouter from "../../server/routes/contentImports";
import { ContentXImportConflictError } from "../../server/storage/contentxImports";

function validPackage() {
  return {
    schemaVersion: "1.0",
    packageKey: "sales-core",
    version: "1.2.0",
    publishedAt: "2026-09-05T12:00:00Z",
    metadata: { title: "Sales Core", description: "Core scenarios", locale: "en", tags: ["sales"] },
    competencies: [{ key: "empathy", name: "Empathy", description: "Understand the customer" }],
    provenance: { source: "ContentX", sourcePackageId: "cx-pkg-42", contentHash: "0123456789abcdef" },
    scenarios: [{
      key: "renewal",
      title: "Renewal conversation",
      description: "Retain an unhappy customer",
      locale: "en",
      competencies: ["empathy"],
      difficulty: 6,
      context: {
        situation: "The account may churn",
        timeline: "Renewal is tomorrow",
        stakes: "Annual contract",
        playerRole: { position: "Manager", department: "Success", experience: "Senior", responsibility: "Retain account" },
      },
      objectives: ["Find a workable resolution"],
      successCriteria: { optimal: "Renewed", good: "Follow-up", acceptable: "Understood", failure: "Churned" },
      personas: [{ key: "buyer", name: "Alex", department: "Finance", position: "Buyer", experience: "10 years", personaRef: "analyst", stance: "Skeptical", goal: "Reduce risk", tradeoff: "Can accept phased rollout", primary: true }],
      recommendedFlow: ["Discover", "Resolve"],
      personaSwitches: [],
      personaSwitchMode: "none",
      constraints: { authorityLevel: "manager", cannotOffer: ["Unlimited liability"] },
      evaluation: {
        name: "Renewal rubric",
        passThreshold: 70,
        dimensions: [
          { key: "empathy", name: "Empathy", weight: 6, minScore: 1, maxScore: 10 },
          { key: "clarity", name: "Clarity", weight: 4, minScore: 1, maxScore: 10 },
        ],
        requiredDimensions: [{ key: "empathy", minScore: 60 }],
      },
      targetDurationMinutes: 15,
      targetTurns: 12,
      minValidTurns: 4,
    }],
  };
}

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CATEGORY_ID = "22222222-2222-4222-8222-222222222222";

function makeStore(overrides: Record<string, unknown> = {}) {
  return {
    getOrganization: vi.fn().mockResolvedValue({ id: ORG_ID, companyId: "company-1", isActive: true }),
    getCategory: vi.fn().mockResolvedValue({ id: CATEGORY_ID, organizationId: ORG_ID, isActive: true }),
    canOperatorManageCategory: vi.fn().mockResolvedValue(false),
    importContentXPackage: vi.fn().mockResolvedValue({
      sourcePackageId: "cx-pkg-42",
      contentVersion: "1.2.0",
      imported: true,
      scenarios: [{
        sourceScenarioKey: "renewal",
        scenarioId: "scenario-1",
        criteriaSetId: "criteria-1",
        scenarioVersionId: "version-1",
      }],
    }),
    ...overrides,
  };
}

function makeApp(user: any, store = makeStore(), authenticated = true) {
  const app = express();
  app.use(express.json());
  const auth: RequestHandler = (req, res, next) => {
    if (!authenticated) return res.status(401).json({ message: "Authentication required" });
    (req as any).user = user;
    next();
  };
  app.use(createContentImportsRouter(auth, store as any));
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.status || 500).json({
      message: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(err.details ? { details: err.details } : {}),
    });
  });
  return { app, store };
}

const body = () => ({ organizationId: ORG_ID, categoryId: CATEGORY_ID, package: validPackage() });

describe("ContentX import routes", () => {
  it("requires authentication and an operator/admin role", async () => {
    const unauthenticated = makeApp(null, makeStore(), false);
    expect((await request(unauthenticated.app).post("/api/content/import/validate").send(body())).status).toBe(401);

    const ordinaryUser = makeApp({ id: "user-1", role: "user" });
    expect((await request(ordinaryUser.app).post("/api/content/import/validate").send(body())).status).toBe(403);
  });

  it("validates and maps without invoking persistence", async () => {
    const { app, store } = makeApp({ id: "admin-1", role: "admin" });
    const response = await request(app).post("/api/content/import/validate").send(body());
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({
      valid: true,
      target: { organizationId: ORG_ID, categoryId: CATEGORY_ID },
      package: { sourcePackageId: "cx-pkg-42", contentVersion: "1.2.0", scenarioCount: 1 },
    });
    expect(store.importContentXPackage).not.toHaveBeenCalled();
  });

  it("returns stable structured diagnostics for malformed packages", async () => {
    const { app } = makeApp({ id: "admin-1", role: "admin" });
    const response = await request(app).post("/api/content/import/validate").send({
      ...body(),
      package: { schemaVersion: "2.0" },
    });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("CONTENTX_INVALID_PACKAGE");
    expect(response.body.details.diagnostics.length).toBeGreaterThan(0);
  });

  it("rejects mismatched, inactive, and cross-tenant targets", async () => {
    const mismatch = makeApp({ id: "admin-1", role: "admin" }, makeStore({
      getCategory: vi.fn().mockResolvedValue({ id: CATEGORY_ID, organizationId: "other-org", isActive: true }),
    }));
    expect((await request(mismatch.app).post("/api/content/import").send(body())).body.code).toBe("CONTENTX_TARGET_MISMATCH");

    const inactive = makeApp({ id: "admin-1", role: "admin" }, makeStore({
      getCategory: vi.fn().mockResolvedValue({ id: CATEGORY_ID, organizationId: ORG_ID, isActive: false }),
    }));
    expect((await request(inactive.app).post("/api/content/import").send(body())).body.code).toBe("CONTENTX_TARGET_INACTIVE");

    const operator = makeApp({ id: "operator-1", role: "operator", assignedOrganizationId: "other-org" });
    const forbidden = await request(operator.app).post("/api/content/import").send(body());
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.code).toBe("CONTENTX_TARGET_FORBIDDEN");
  });

  it("imports into the trusted target and reports created identifiers", async () => {
    const { app, store } = makeApp({ id: "operator-1", role: "operator", assignedCategoryId: CATEGORY_ID });
    const response = await request(app).post("/api/content/import").send(body());
    expect(response.status).toBe(201);
    expect(store.importContentXPackage).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG_ID,
      categoryId: CATEGORY_ID,
      publishedBy: "operator-1",
      sourceContentDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(response.body).toMatchObject({
      package: { sourcePackageId: "cx-pkg-42", created: true },
      scenarios: [{
        scenario: { id: "scenario-1", created: true },
        criteriaSet: { id: "criteria-1", created: true },
        publishedVersion: { id: "version-1", created: true },
      }],
    });
  });

  it("reports exact retries as existing and maps immutable version conflicts to 409", async () => {
    const retryStore = makeStore();
    retryStore.importContentXPackage.mockResolvedValue({
      sourcePackageId: "cx-pkg-42",
      contentVersion: "1.2.0",
      imported: false,
      scenarios: [{ sourceScenarioKey: "renewal", scenarioId: "s", criteriaSetId: "c", scenarioVersionId: "v" }],
    });
    const retry = await request(makeApp({ id: "admin-1", role: "admin" }, retryStore).app)
      .post("/api/content/import").send(body());
    expect(retry.status).toBe(200);
    expect(retry.body.scenarios[0].scenario.created).toBe(false);

    const conflictStore = makeStore({
      importContentXPackage: vi.fn().mockRejectedValue(new ContentXImportConflictError("sensitive detail")),
    });
    const conflict = await request(makeApp({ id: "admin-1", role: "admin" }, conflictStore).app)
      .post("/api/content/import").send(body());
    expect(conflict.status).toBe(409);
    expect(conflict.body).toEqual({
      message: "This ContentX package version conflicts with an existing import",
      code: "CONTENTX_VERSION_CONFLICT",
    });
  });

  it("computes retry identity from package content rather than trusting the supplied hash", async () => {
    const store = makeStore();
    const app = makeApp({ id: "admin-1", role: "admin" }, store).app;
    await request(app).post("/api/content/import").send(body());
    const changed = body();
    changed.package.scenarios[0].title = "Changed title under the same supplied hash";
    await request(app).post("/api/content/import").send(changed);

    const firstDigest = store.importContentXPackage.mock.calls[0][0].sourceContentDigest;
    const secondDigest = store.importContentXPackage.mock.calls[1][0].sourceContentDigest;
    expect(firstDigest).not.toBe(secondDigest);
  });

  it("does not expose unexpected persistence error details", async () => {
    const store = makeStore({
      importContentXPackage: vi.fn().mockRejectedValue(new Error("password=secret constraint internal_table")),
    });
    const response = await request(makeApp({ id: "admin-1", role: "admin" }, store).app)
      .post("/api/content/import").send(body());
    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      message: "ContentX import failed",
      code: "CONTENTX_IMPORT_FAILED",
    });
    expect(JSON.stringify(response.body)).not.toContain("internal_table");
  });

  it("does not expose unexpected target lookup details during validation", async () => {
    const store = makeStore({
      getCategory: vi.fn().mockRejectedValue(new Error("password=secret categories_internal")),
    });
    const response = await request(makeApp({ id: "admin-1", role: "admin" }, store).app)
      .post("/api/content/import/validate").send(body());
    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      message: "ContentX validation failed",
      code: "CONTENTX_VALIDATION_FAILED",
    });
    expect(JSON.stringify(response.body)).not.toContain("categories_internal");
  });
});