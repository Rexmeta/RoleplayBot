import fs from "node:fs";
import path from "node:path";
import express, { type RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import createContentImportsRouter from "../../server/routes/contentImports";
import { assessmentScenarioPackageV1Schema } from "../../shared/schema/contentx";
import {
  EVALUATION_CRITERIA_SNAPSHOT_KEY,
  RUNTIME_PERSONA_PROFILE_KEY,
  resolveRuntimeScenario,
} from "../../server/services/runtimeScenario";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CATEGORY_ID = "22222222-2222-4222-8222-222222222222";
const fixturePath = path.resolve("tests/fixtures/contentx/team-leader-promotion-assessment.v1.json");

function loadFixture() {
  return assessmentScenarioPackageV1Schema.parse(JSON.parse(fs.readFileSync(fixturePath, "utf8")));
}

function createRegistryStore() {
  const versions = new Map<string, { digest: string; categoryId: string; scenarios: any[] }>();
  let serial = 0;
  return {
    versions,
    getOrganization: vi.fn().mockResolvedValue({ id: ORG_ID, companyId: "company-1", isActive: true }),
    getCategory: vi.fn().mockResolvedValue({ id: CATEGORY_ID, organizationId: ORG_ID, isActive: true }),
    canOperatorManageCategory: vi.fn().mockResolvedValue(false),
    importContentXPackage: vi.fn(async (input: any) => {
      const identity = `${input.organizationId}:${input.package.provenance.sourcePackageId}:${input.package.packageVersion}`;
      const existing = versions.get(identity);
      if (existing) {
        if (existing.digest !== input.sourceContentDigest || existing.categoryId !== input.categoryId) {
          throw new Error("fixture registry conflict");
        }
        return {
          sourcePackageId: input.package.provenance.sourcePackageId,
          contentVersion: input.package.packageVersion,
          imported: false,
          scenarios: existing.scenarios.map(({ sourceKey, scenarioId, criteriaSetId, versionId }) => ({
            sourceScenarioKey: sourceKey, scenarioId, criteriaSetId, scenarioVersionId: versionId,
          })),
        };
      }
      const scenarios = input.package.scenarios.map((mapped: any) => {
        serial += 1;
        const scenarioId = `scenario-${serial}`;
        const criteriaSetId = `criteria-${serial}`;
        const versionId = `version-${serial}`;
        const snapshot = {
          ...mapped.scenario,
          id: scenarioId,
          contentxPackageId: input.package.provenance.sourcePackageId,
          contentxVersion: input.package.packageVersion,
          evaluationCriteriaSetId: criteriaSetId,
          personas: mapped.scenario.personas.map((persona: any) => ({
            ...persona,
            [RUNTIME_PERSONA_PROFILE_KEY]: {
              communication_style: `${input.package.packageVersion}:${persona.personaRef}`,
              personality_traits: [persona.mbti ?? "workplace"],
              communication_patterns: { opening_style: persona.entryLine ?? "Open the conversation" },
            },
          })),
          [EVALUATION_CRITERIA_SNAPSHOT_KEY]: {
            ...mapped.criteriaSet,
            id: criteriaSetId,
            dimensions: mapped.dimensions.map((dimension: any) => dimension.input),
          },
        };
        return { sourceKey: mapped.sourceKey, scenarioId, criteriaSetId, versionId, snapshot };
      });
      versions.set(identity, { digest: input.sourceContentDigest, categoryId: input.categoryId, scenarios });
      return {
        sourcePackageId: input.package.provenance.sourcePackageId,
        contentVersion: input.package.packageVersion,
        imported: true,
        scenarios: scenarios.map(({ sourceKey, scenarioId, criteriaSetId, versionId }) => ({
          sourceScenarioKey: sourceKey, scenarioId, criteriaSetId, scenarioVersionId: versionId,
        })),
      };
    }),
  };
}

function createApp(user: any, store: ReturnType<typeof createRegistryStore>, authenticated = true) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  const auth: RequestHandler = (req, res, next) => {
    if (!authenticated) return res.status(401).json({ message: "Authentication required" });
    (req as any).user = user;
    next();
  };
  app.use(createContentImportsRouter(auth, store as any));
  app.use((error: any, _req: any, res: any, _next: any) => {
    res.status(error.status ?? 500).json({ message: error.message, code: error.code });
  });
  return app;
}

describe("ContentX Team Leader Promotion demo", () => {
  it("validates, imports, retries, imports v1.1, starts a bound run, and preserves v1 history", async () => {
    const pkgV1 = loadFixture();
    expect(pkgV1.metadata.title).toBe("Team Leader Promotion Assessment");
    expect(pkgV1.scenarios.map(scenario => scenario.title)).toEqual([
      "Low Performer Coaching",
      "Key Talent Retention",
      "Team Conflict Resolution",
    ]);
    for (const scenario of pkgV1.scenarios) {
      expect(scenario.context.playerRole.responsibility).toBeTruthy();
      expect(scenario.objectives.length).toBeGreaterThan(0);
      expect(scenario.personas.some(persona => persona.primary)).toBe(true);
      expect(scenario.evaluation.dimensions.length).toBeGreaterThanOrEqual(4);
      expect(scenario.difficultyProfile).toBeDefined();
      expect(scenario.constraints.requiredBehaviors?.length).toBeGreaterThan(0);
      expect(scenario.termination?.timeout?.maxTurns).toBeGreaterThan(0);
    }

    const store = createRegistryStore();
    const app = createApp({ id: "operator-1", role: "operator", assignedCategoryId: CATEGORY_ID }, store);
    const bodyV1 = { organizationId: ORG_ID, categoryId: CATEGORY_ID, package: pkgV1 };

    const validation = await request(app).post("/api/content/import/validate").send(bodyV1);
    expect(validation.status, JSON.stringify(validation.body)).toBe(200);
    expect(validation.body.package.scenarioCount).toBe(3);

    const firstImport = await request(app).post("/api/content/import").send(bodyV1);
    expect(firstImport.status, JSON.stringify(firstImport.body)).toBe(201);
    expect(firstImport.body.scenarios).toHaveLength(3);

    const retry = await request(app).post("/api/content/import").send(bodyV1);
    expect(retry.status).toBe(200);
    expect(retry.body.package.created).toBe(false);
    expect(retry.body.scenarios.map((item: any) => item.scenario.id))
      .toEqual(firstImport.body.scenarios.map((item: any) => item.scenario.id));

    const pkgV11 = structuredClone(pkgV1);
    pkgV11.version = "1.1.0";
    pkgV11.publishedAt = "2026-10-01T12:00:00Z";
    pkgV11.provenance.contentHash = "demo-v1-1-content-00000000000001";
    pkgV11.scenarios[0].title = "Low Performer Coaching — Revised";
    const nextImport = await request(app).post("/api/content/import").send({
      organizationId: ORG_ID, categoryId: CATEGORY_ID, package: pkgV11,
    });
    expect(nextImport.status, JSON.stringify(nextImport.body)).toBe(201);
    expect(nextImport.body.scenarios[0].scenario.id).not.toBe(firstImport.body.scenarios[0].scenario.id);

    const v1Record = [...store.versions.values()][0].scenarios[0];
    const v11Record = [...store.versions.values()][1].scenarios[0];
    const run = {
      scenarioId: v1Record.scenarioId,
      scenarioVersionId: v1Record.versionId,
      scenarioSnapshot: structuredClone(v1Record.snapshot),
      evaluationHarnessSnapshot: structuredClone(v1Record.snapshot.evaluationHarness),
    };
    const runtime = resolveRuntimeScenario(run, v11Record.snapshot);
    expect(runtime.title).toBe("Low Performer Coaching");
    expect(runtime.contentxVersion).toBe("1.0.0");
    expect(runtime[EVALUATION_CRITERIA_SNAPSHOT_KEY].name).toBe("Low Performer Coaching Rubric");
    expect(runtime.personas[0][RUNTIME_PERSONA_PROFILE_KEY].communication_style).toContain("1.0.0");
  });

  it("rejects unauthenticated, ordinary-user, and cross-tenant operator requests", async () => {
    const payload = { organizationId: ORG_ID, categoryId: CATEGORY_ID, package: loadFixture() };
    expect((await request(createApp(null, createRegistryStore(), false)).post("/api/content/import").send(payload)).status).toBe(401);
    expect((await request(createApp({ id: "user-1", role: "user" }, createRegistryStore())).post("/api/content/import").send(payload)).status).toBe(403);
    const forbidden = await request(createApp(
      { id: "operator-1", role: "operator", assignedOrganizationId: "33333333-3333-4333-8333-333333333333" },
      createRegistryStore(),
    )).post("/api/content/import").send(payload);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.code).toBe("CONTENTX_TARGET_FORBIDDEN");
  });
});