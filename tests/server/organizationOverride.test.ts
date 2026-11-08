import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({
  store: Object.fromEntries([
    "getScenario", "getLatestPublishedVersion", "getOrganization", "getCompany", "getCategory",
    "getScenarioOverrideByOrgAndScenario", "getAllScenarioOverrides", "getScenarioOverridesByOrganization",
    "getScenarioOverridesByScenario", "upsertScenarioOverride", "deleteScenarioOverrideByOrgAndScenario", "getScenarioOverrideAudit",
    "canOperatorManageOrganization", "getOperatorManagedOrganizationIds", "getAllOrganizations", "getAllScenarios",
  ].map(key => [key, vi.fn()])),
  criteria: vi.fn(),
  persona: vi.fn(),
}));
vi.mock("../../server/storage", () => ({ storage: mocks.store, db: {} }));
vi.mock("../../server/routes/conversationLedger", () => ({
  createConversationLedgerRouter: () => express.Router(),
}));
vi.mock("../../server/services/conversationLedger/enrollment", () => ({ ledgerRolloutEnabled: () => false }));
vi.mock("../../server/services/conversationLedger/transcript", () => ({ usesLedger: () => false, ledgerRuntimeBinding: vi.fn(async () => null) }));
vi.mock("../../server/services/conversationLedger/textTurn", () => ({ beginLedgerTextTurn: vi.fn() }));
vi.mock("../../server/services/feedbackGenerationService", () => ({
  enqueueFeedbackJob: vi.fn(), getFeedbackJobStatus: vi.fn(), resetFeedbackJob: vi.fn(),
}));
vi.mock("../../server/services/aiServiceFactory", () => ({
  generateAIResponse: vi.fn(), generateStreamingAIResponse: vi.fn(),
}));
vi.mock("../../server/services/fileManager", () => ({
  fileManager: { getPersonaByMBTI: mocks.persona, getPersonaAvatarSettings: vi.fn(async () => ({})), getAllScenarios: vi.fn(async () => []) },
}));
vi.mock("../../server/routes/routerHelpers", () => ({
  asyncHandler: (fn: any) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res, next)).catch(next),
  createHttpError: (status: number, message: string) => Object.assign(new Error(message), { status }),
  loadEvaluationCriteria: mocks.criteria,
}));

import createRouter from "../../server/routes/adminScenarioOverrides";
import createConversationsRouter from "../../server/routes/conversations";
import { scenarioOverrideDataSchema } from "../../shared/schema/scenarios";
import { resolveOverrideWeights } from "../../shared/organizationOverride";
import { buildOrganizationPreview, captureOrganizationRunSnapshot, resolveExecutionOrganization } from "../../server/services/scenarios/organizationOverride";
import { resolveRuntimeScenario } from "../../server/services/runtimeScenario";
import { calculateWeightedOverallScore } from "../../server/services/evaluationEngine";
import { buildSystemInstructions } from "../../server/services/voice/systemPromptBuilder";
import { buildTavusContext } from "../../server/services/tavus/context";

const rubric = { id: "r", name: "Actual rubric", dimensions: [
  { key: "discovery", name: "Discovery", weight: 60, minScore: 0, maxScore: 10 },
  { key: "resolution", name: "Resolution", weight: 40, minScore: 0, maxScore: 10 },
] };
let scenario: any;
let records: any[];
function app(role = "admin") {
  const app = express();
  app.use(express.json());
  app.use(createRouter((req: any, _res: any, next: any) => { req.user = { id: "u", role }; next(); }));
  app.use((error: any, _req: any, res: any, _next: any) => res.status(error.status ?? 500).json({ error: error.message }));
  return app;
}
beforeEach(() => {
  vi.clearAllMocks();
  scenario = { id: "s", title: "Base title", organizationId: null, context: { situation: "Original customer" },
    personas: [{ id: "a", name: "Actor", personaRef: "entj.json", goal: "Resolve" }] };
  records = [
    { id: "oa", organizationId: "A", scenarioId: "s", override: { terminology: { customer: "A-member" }, policyConstraints: ["A-policy"] }, updatedAt: "2026-01-01" },
    { id: "ob", organizationId: "B", scenarioId: "s", override: { terminology: { customer: "B-member" }, policyConstraints: ["B-policy"] }, updatedAt: "2026-01-02" },
    { id: "other", organizationId: "A", scenarioId: "other", override: {} },
  ];
  mocks.store.getScenario.mockImplementation(async (id: string) => ({ ...scenario, id }));
  mocks.store.getLatestPublishedVersion.mockResolvedValue(null);
  mocks.store.getOrganization.mockImplementation(async (id: string) => ({ id, companyId: "c", name: id, isActive: true }));
  mocks.store.getCompany.mockResolvedValue({ id: "c", name: "Company", isActive: true });
  mocks.store.getCategory.mockResolvedValue(null);
  mocks.store.getAllOrganizations.mockResolvedValue([{ id: "A", companyId: "c", isActive: true }, { id: "B", companyId: "c", isActive: true }]);
  mocks.store.getAllScenarios.mockImplementation(async () => [scenario]);
  mocks.store.getAllScenarioOverrides.mockImplementation(async () => records);
  mocks.store.getScenarioOverridesByOrganization.mockImplementation(async (org: string) => records.filter(row => row.organizationId === org));
  mocks.store.getScenarioOverridesByScenario.mockImplementation(async (id: string) => records.filter(row => row.scenarioId === id));
  mocks.store.getScenarioOverrideByOrgAndScenario.mockImplementation(async (org: string, id: string) => records.find(row => row.organizationId === org && row.scenarioId === id));
  mocks.store.getOperatorManagedOrganizationIds.mockResolvedValue(["A"]);
  mocks.store.canOperatorManageOrganization.mockImplementation(async (_user: string, org: string) => org === "A");
  mocks.store.upsertScenarioOverride.mockImplementation(async (org: string, id: string, override: any) => {
    const row = { id: "new", organizationId: org, scenarioId: id, override, updatedAt: "2026-02-01" };
    records = [...records.filter(r => r.organizationId !== org || r.scenarioId !== id), row];
    return row;
  });
  mocks.store.deleteScenarioOverrideByOrgAndScenario.mockImplementation(async (org: string, id: string) => {
    records = records.filter(r => r.organizationId !== org || r.scenarioId !== id);
  });
  mocks.criteria.mockResolvedValue(structuredClone(rubric));
  mocks.persona.mockResolvedValue({ communication_style: "direct", communication_patterns: {}, background: {} });
});

describe("common input and weight contract", () => {
  it("trims strings, deduplicates arrays, and refuses collapsed duplicate terminology keys", () => {
    expect(scenarioOverrideDataSchema.parse({ terminology: { " x ": " y " }, customIncidents: [" hint ", "hint"] }))
      .toEqual({ terminology: { x: "y" }, customIncidents: ["hint"] });
    expect(scenarioOverrideDataSchema.safeParse({ terminology: { x: "one", " x ": "two" } }).success).toBe(false);
  });
  it.each([
    { terminology: { " ": "value" } }, { terminology: { x: " " } }, { unknown: true },
    { evaluationWeights: { discovery: NaN } }, { evaluationWeights: { discovery: Infinity } },
    { evaluationWeights: { discovery: -1 } }, { evaluationWeights: { discovery: 11 } },
    { policyConstraints: Array(31).fill("policy") }, { customIncidents: ["x".repeat(1001)] },
  ])("rejects malformed input %#", input => expect(scenarioOverrideDataSchema.safeParse(input).success).toBe(false));
  it("retains unspecified default ratios, permits zero, rejects unknown keys and zero sum", () => {
    const resolved = resolveOverrideWeights(rubric.dimensions, { discovery: 0 });
    expect(resolved.dimensions.map(d => d.normalizedPercent)).toEqual([0, 100]);
    expect(resolveOverrideWeights(rubric.dimensions, { discovery: 0, resolution: 0 }).errors).not.toHaveLength(0);
    expect(resolveOverrideWeights(rubric.dimensions, { clarity: 5 }).errors).toContain("적용 불가 평가항목: clarity");
    expect(buildOrganizationPreview({ _evaluationCriteriaSnapshot: rubric }, { evaluationWeights: { discovery: 10 } }).dimensions[1].weight).toBe(4);
  });
});
describe("management API authorization and persistence", () => {
  it("scopes audit history to current delegation even after override deletion and validates pagination", async () => {
    mocks.store.getScenarioOverrideAudit.mockResolvedValue([{ id: "audit", organizationId: "A" }]);
    records = [];
    const result = await request(app("operator")).get("/api/admin/scenario-overrides/organization/A/audit-logs?scenarioId=s&limit=1");
    expect(result.status).toBe(200);
    expect(result.body.entries[0].id).toBe("audit");
    expect(mocks.store.getScenarioOverrideAudit).toHaveBeenLastCalledWith("A", "s", 2, 0);
    mocks.store.getScenarioOverrideAudit.mockClear();
    expect((await request(app("operator")).get("/api/admin/scenario-overrides/organization/B/audit-logs")).status).toBe(403);
    expect((await request(app("user")).get("/api/admin/scenario-overrides/organization/A/audit-logs")).status).toBe(403);
    expect(mocks.store.getScenarioOverrideAudit).not.toHaveBeenCalled();
    for (const query of ["limit=0", "limit=101", "offset=-1", "offset=x", "scenarioId[x]=A"]) {
      expect((await request(app()).get(`/api/admin/scenario-overrides/organization/A/audit-logs?${query}`)).status).toBe(400);
    }
    mocks.store.canOperatorManageOrganization.mockResolvedValueOnce(false);
    expect((await request(app("operator")).get("/api/admin/scenario-overrides/organization/A/audit-logs")).status).toBe(403);
  });
  it("passes only the authenticated actor to audited writes and reports persistence failure", async () => {
    const value = { policyConstraints: ["p"] };
    expect((await request(app()).put("/api/admin/scenario-overrides/A/s").send(value)).status).toBe(200);
    expect(mocks.store.upsertScenarioOverride).toHaveBeenCalledWith("A", "s", value, "u");
    expect((await request(app()).delete("/api/admin/scenario-overrides/A/s")).status).toBe(200);
    expect(mocks.store.deleteScenarioOverrideByOrgAndScenario).toHaveBeenCalledWith("A", "s", "u");
    mocks.store.upsertScenarioOverride.mockRejectedValueOnce(new Error("audit unavailable"));
    expect((await request(app()).put("/api/admin/scenario-overrides/A/s").send(value)).status).toBe(500);
  });
  it("intersects organization and scenario filters", async () => {
    const result = await request(app()).get("/api/admin/scenario-overrides?organizationId=A&scenarioId=s");
    expect(result.status).toBe(200); expect(result.body.map((r: any) => r.id)).toEqual(["oa"]);
  });
  it.each(["", "/organization/A", "/scenario/s", "/A/s"])("only exposes delegated organization in operator read %s", async suffix => {
    const result = await request(app("operator")).get("/api/admin/scenario-overrides" + suffix);
    expect(result.status).toBe(200);
    expect((Array.isArray(result.body) ? result.body : [result.body]).every((row: any) => row.organizationId === "A")).toBe(true);
  });
  it.each(["/organization/B", "/B/s"])("denies a tampered operator organization %s", async suffix => {
    expect((await request(app("operator")).get("/api/admin/scenario-overrides" + suffix)).status).toBe(403);
  });
  it("limits options and preview; blocks operator writes and all ordinary-user management requests", async () => {
    expect((await request(app("operator")).get("/api/admin/scenario-overrides/options")).body.organizations).toHaveLength(1);
    expect((await request(app("operator")).post("/api/admin/scenario-overrides/B/s/preview").send({})).status).toBe(403);
    expect((await request(app("operator")).put("/api/admin/scenario-overrides/A/s").send({ policyConstraints: ["p"] })).status).toBe(403);
    expect((await request(app("operator")).delete("/api/admin/scenario-overrides/A/s")).status).toBe(403);
    expect((await request(app("user")).get("/api/admin/scenario-overrides")).status).toBe(403);
    expect((await request(app("user")).post("/api/admin/scenario-overrides/A/s/preview").send({})).status).toBe(403);
  });
  it("rejects empty saves, unknown rubric keys, zero weights and oversized requests", async () => {
    expect((await request(app()).put("/api/admin/scenario-overrides/A/s").send({})).status).toBe(400);
    expect((await request(app()).put("/api/admin/scenario-overrides/A/s").send({ evaluationWeights: { clarity: 5 } })).status).toBe(422);
    expect((await request(app()).put("/api/admin/scenario-overrides/A/s").send({ evaluationWeights: { discovery: 0, resolution: 0 } })).status).toBe(422);
    expect((await request(app()).put("/api/admin/scenario-overrides/A/s").send({ policyConstraints: ["x".repeat(33000)] })).status).toBe(413);
    expect(mocks.store.upsertScenarioOverride).not.toHaveBeenCalled();
  });
  it("roundtrips a partial-field edit as a full draft and explicitly deletes the last field", async () => {
    const draft = { ...records[0].override, forbiddenPhrases: ["never"] };
    expect((await request(app()).put("/api/admin/scenario-overrides/A/s").send(draft)).status).toBe(200);
    expect((await request(app()).get("/api/admin/scenario-overrides/A/s")).body.override).toEqual(draft);
    expect((await request(app()).delete("/api/admin/scenario-overrides/A/s")).status).toBe(200);
    expect((await request(app()).get("/api/admin/scenario-overrides/A/s")).body).toBeNull();
  });
  it("allows inactive inspection/deletion but refuses new applications", async () => {
    mocks.store.getOrganization.mockResolvedValue({ id: "A", companyId: "c", isActive: false });
    expect((await request(app()).get("/api/admin/scenario-overrides/A/s")).status).toBe(200);
    expect((await request(app()).post("/api/admin/scenario-overrides/A/s/preview").send({})).body.organizationActive).toBe(false);
    expect((await request(app()).put("/api/admin/scenario-overrides/A/s").send({ policyConstraints: ["p"] })).status).toBe(409);
    await expect(captureOrganizationRunSnapshot("s", "A")).rejects.toMatchObject({ status: 409 });
  });
  it("blocks other-organization content for details, preview, writes and runtime", async () => {
    scenario.organizationId = "B";
    for (const method of ["get", "post", "put", "delete"] as const) {
      const path = "/api/admin/scenario-overrides/A/s" + (method === "post" ? "/preview" : "");
      expect((await request(app())[method](path).send({ policyConstraints: ["p"] })).status).toBe(403);
    }
    expect((await request(app()).get("/api/admin/scenario-overrides?organizationId=A")).body).toEqual([]);
    await expect(captureOrganizationRunSnapshot("s", "A")).rejects.toMatchObject({ status: 403 });
    scenario.organizationId = null; scenario.categoryId = "category";
    mocks.store.getCategory.mockResolvedValue({ organizationId: "B" });
    expect((await request(app()).put("/api/admin/scenario-overrides/A/s").send({ policyConstraints: ["p"] })).status).toBe(403);
  });
  it("does not treat a failed read as a missing configuration", async () => {
    mocks.store.getScenarioOverrideByOrgAndScenario.mockRejectedValue(new Error("offline"));
    expect((await request(app()).get("/api/admin/scenario-overrides/A/s")).status).toBe(500);
    await expect(captureOrganizationRunSnapshot("s", "A")).rejects.toMatchObject({ status: 503 });
  });
});
describe("execution binding and provider context", () => {
  it.each(["A", "B", null])("creates a private org-owned web conversation only for its owner (%s)", async membership => {
    scenario.organizationId = "A";
    scenario.isPublic = false;
    Object.assign(mocks.store, {
      getUser: vi.fn().mockResolvedValue({ id: "learner", role: "user", organizationId: membership }),
      findActiveScenarioRun: vi.fn().mockResolvedValue(null),
      getUserScenarioRuns: vi.fn().mockResolvedValue([]),
      createScenarioRun: vi.fn().mockImplementation(async data => ({ ...data, id: "private-run", startedAt: new Date() })),
      getPersonaRunsByScenarioRun: vi.fn().mockResolvedValue([]),
      createPersonaRun: vi.fn().mockImplementation(async data => ({ ...data, id: "private-actor-run" })),
      getSimulationState: vi.fn().mockResolvedValue(null),
      saveSimulationState: vi.fn().mockResolvedValue(undefined),
      createSimulationEvent: vi.fn().mockResolvedValue(undefined),
    });
    const app = express();
    app.use(express.json());
    app.use("/api/conversations", createConversationsRouter((req: any, _res: any, next: any) => {
      req.user = { id: "learner", role: "user" }; next();
    }));
    app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode ?? error.status ?? 500).json({ message: error.message }));
    const response = await request(app).post("/api/conversations").send({
      scenarioId: "s", scenarioName: "Private training", personaId: "a", messages: [], mode: "text",
    });
    expect(response.status, JSON.stringify(response.body)).toBe(membership === "A" ? 200 : 403);
    if (membership === "A") {
      expect(response.body.scenarioRunId).toBe("private-run");
      expect(mocks.store.createScenarioRun.mock.calls[0][0].scenarioSnapshot._organizationOverride.organizationId).toBe("A");
    } else {
      expect(mocks.store.createScenarioRun).not.toHaveBeenCalled();
      expect(mocks.store.createPersonaRun).not.toHaveBeenCalled();
    }
  });
  it("validates actual membership rather than delegation or arbitrary precedence", async () => {
    await expect(resolveExecutionOrganization({ role: "operator", organizationId: "A", assignedOrganizationId: "B" })).rejects.toMatchObject({ status: 409 });
    await expect(resolveExecutionOrganization({ organizationId: "A", companyId: "other" })).rejects.toMatchObject({ status: 409 });
    await expect(resolveExecutionOrganization({ organizationId: "A", assignedOrganizationId: "A", companyId: "c" })).resolves.toBe("A");
    await expect(resolveExecutionOrganization({ role: "operator" })).resolves.toBeNull();
    expect(mocks.store.canOperatorManageOrganization).not.toHaveBeenCalled();
  });
  it("isolates A/B/unaffiliated runs, never replaces source content, and pins all later reads", async () => {
    const a = await captureOrganizationRunSnapshot("s", "A");
    const b = await captureOrganizationRunSnapshot("s", "B");
    const none = await captureOrganizationRunSnapshot("s", null);
    expect(a.scenarioSnapshot._overridePromptBlock).toContain("A-policy");
    expect(a.scenarioSnapshot._overridePromptBlock).not.toContain("B-policy");
    expect(b.scenarioSnapshot._overridePromptBlock).toContain("B-policy");
    expect(none.scenarioSnapshot._overridePromptBlock).not.toContain("A-policy");
    expect(a.scenarioSnapshot.context.situation).toBe("Original customer");
    expect(scenario).not.toHaveProperty("_organizationOverride");
    records[0].override.policyConstraints = ["changed"]; records = [];
    const runtime = resolveRuntimeScenario({ scenarioId: "s", ...a }, { ...scenario, context: { situation: "changed" } })!;
    expect(runtime._overridePromptBlock).toContain("A-policy");
    expect(runtime._organizationOverride.override.policyConstraints).toEqual(["A-policy"]);
    expect((await captureOrganizationRunSnapshot("s", "A")).scenarioSnapshot._organizationOverride.overrideId).toBeNull();
    const voice = buildSystemInstructions(runtime, runtime.personas[0], {}, undefined, "ko");
    expect(voice).toContain("A-policy");
    expect(buildTavusContext(runtime, runtime.personas[0], "ko", 4)).toContain("A-policy");
  });
  it("freezes actual rubric weights for final and regenerated feedback, including zero", async () => {
    records[0].override.evaluationWeights = { discovery: 0 };
    const bound = await captureOrganizationRunSnapshot("s", "A");
    const frozen = bound.scenarioSnapshot._evaluationCriteriaSnapshot;
    expect(frozen.dimensions.map((d: any) => d.weight)).toEqual([0, 100]);
    expect(calculateWeightedOverallScore({ discovery: 10, resolution: 2 }, frozen)).toBe(20);
    records[0].override.evaluationWeights = { discovery: 10, resolution: 0 };
    expect(calculateWeightedOverallScore({ discovery: 10, resolution: 2 }, frozen)).toBe(20);
    expect(bound.scenarioSnapshot._organizationOverride.dimensions.map((d: any) => d.normalizedPercent)).toEqual([0, 100]);
  });
  it("applies published/imported copies without changing original persona/culture/rubric/version", async () => {
    const published = { ...scenario, contentxPackageId: "import", _evaluationCriteriaSnapshot: structuredClone(rubric),
      personas: [{ id: "a", _runtimeProfile: { communication_style: "published" }, culture: { enabled: false } }] };
    const before = structuredClone(published);
    mocks.store.getLatestPublishedVersion.mockResolvedValue({ id: "v1", contentSnapshot: published, evaluationHarnessSnapshot: { dimensions: [] } });
    const bound = await captureOrganizationRunSnapshot("s", "A");
    expect(bound.scenarioVersionId).toBe("v1");
    expect(bound.scenarioSnapshot._overridePromptBlock).toContain("A-policy");
    expect(bound.scenarioSnapshot.personas).toEqual(before.personas);
    expect(published).toEqual(before);
    expect(mocks.persona).not.toHaveBeenCalled();
  });
  it("does not retroactively resolve organization settings for legacy runs", () => {
    const legacy = resolveRuntimeScenario({ scenarioId: "s" }, scenario);
    expect(legacy).not.toHaveProperty("_organizationOverride");
    expect(mocks.store.getScenarioOverrideByOrgAndScenario).not.toHaveBeenCalled();
  });
  it("freezes native published actor behavior without consulting the mutable persona registry", async () => {
    mocks.store.getLatestPublishedVersion.mockResolvedValue({ id: "native-v1", contentSnapshot: scenario, evaluationHarnessSnapshot: null });
    const bound = await captureOrganizationRunSnapshot("s", "A");
    expect(bound.scenarioSnapshot.personas[0]._runtimeProfile.name).toBe("Actor");
    expect(mocks.persona).not.toHaveBeenCalled();
  });
  it.each([{}, { policyConstraints: ["Prompt only"] }, { evaluationWeights: { clarity: 0 } }])(
    "never changes overlapping simulation weights when binding %j", async override => {
      const harness = { dimensions: [{ key: "clarity", weight: 9 }, { key: "empathy", weight: 1 }] };
      scenario.evaluationHarness = structuredClone(harness);
      const overlappingRubric = { id: "overlap", dimensions: [
        { key: "clarity", weight: 60 }, { key: "empathy", weight: 40 },
      ] };
      mocks.criteria.mockResolvedValue(structuredClone(overlappingRubric));
      records[0].override = override;
      const bound = await captureOrganizationRunSnapshot("s", "A");
      expect(bound.evaluationHarnessSnapshot).toEqual(harness);
      expect(bound.scenarioSnapshot.evaluationHarness).toEqual(harness);
      expect(scenario.evaluationHarness).toEqual(harness);
      expect(bound.scenarioSnapshot._evaluationCriteriaSnapshot.dimensions.map((d: any) => d.weight))
        .toEqual("evaluationWeights" in override ? [0, 100] : [60, 40]);
    },
  );
});
