import { Router, json } from "express";
import { storage } from "../storage";
import { scenarioOverrideDataSchema } from "@shared/schema";
import { isOrganizationOverrideEmpty } from "@shared/organizationOverride";
import { assertOrganizationContentAccess, buildOrganizationPreview, loadOverrideBase } from "../services/scenarios/organizationOverride";
import { asyncHandler, createHttpError } from "./routerHelpers";
import { ScenarioOverrideConflictError } from "../storage/scenarioOverrides";

export default function createAdminScenarioOverridesRouter(isAuthenticated: any) {
  const router = Router();
  const prefix = "/api/admin/scenario-overrides";
  router.use(prefix, isAuthenticated, (req: any, _res, next) => {
    if (!["admin", "operator"].includes(req.user?.role)) return next(createHttpError(403, "관리자 또는 운영자 권한이 필요합니다"));
    next();
  }, json({ limit: "32kb" }));

  const scope = async (user: any, id: string) => {
    if (user.role !== "admin" && !await storage.canOperatorManageOrganization(user.id, id)) {
      throw createHttpError(403, "위임받은 조직만 조회할 수 있습니다");
    }
    const org = await storage.getOrganization(id);
    if (!org) throw createHttpError(404, "조직을 찾을 수 없습니다");
    return org;
  };
  const scopedRows = async (user: any, orgId?: string, scenarioId?: string) => {
    if (orgId) await scope(user, orgId);
    const allowed = user.role === "admin" ? null : new Set(await storage.getOperatorManagedOrganizationIds(user.id));
    const rows = orgId ? await storage.getScenarioOverridesByOrganization(orgId)
      : scenarioId ? await storage.getScenarioOverridesByScenario(scenarioId) : await storage.getAllScenarioOverrides();
    const filtered = rows.filter(row => (!allowed || allowed.has(row.organizationId))
      && (!orgId || row.organizationId === orgId) && (!scenarioId || row.scenarioId === scenarioId));
    const visible = [];
    for (const row of filtered) {
      const scenario = await storage.getScenario(row.scenarioId);
      if (!scenario) continue;
      try { await assertOrganizationContentAccess(row.organizationId, scenario); visible.push(row); }
      catch (error: any) { if (error.status !== 403 && error.statusCode !== 403 && error.status !== 410 && error.statusCode !== 410) throw error; }
    }
    return visible;
  };
  const context = async (user: any, orgId: string, scenarioId: string) => {
    const org = await scope(user, orgId);
    const loaded = await loadOverrideBase(scenarioId);
    await assertOrganizationContentAccess(orgId, loaded.source);
    const company = await storage.getCompany(org.companyId);
    return { ...loaded, organizationActive: org.isActive && company?.isActive === true };
  };
  const draft = (body: unknown) => {
    // Enforce limit even if a global Express parser has already consumed the body.
    if (Buffer.byteLength(JSON.stringify(body ?? {})) > 32768) throw createHttpError(413, "요청은 32KB 이하여야 합니다");
    const parsed = scenarioOverrideDataSchema.safeParse(body);
    if (!parsed.success) throw createHttpError(400, `유효하지 않은 Override: ${parsed.error.message}`);
    return parsed.data;
  };
  const write = (user: any) => { if (user.role !== "admin") throw createHttpError(403, "관리자만 수정할 수 있습니다"); };
  const expectedVersion = (body: any): { updatedAt: string | null; id: string | null } => {
    if (!body || !Object.prototype.hasOwnProperty.call(body, "expectedUpdatedAt") ||
      !Object.prototype.hasOwnProperty.call(body, "expectedOverrideId")) {
      throw createHttpError(428, "수정시각과 설정 식별 정보가 필요합니다. 설정을 다시 조회하세요.");
    }
    const value = body.expectedUpdatedAt;
    const id = body.expectedOverrideId;
    if (value === null && id === null) return { updatedAt: null, id: null };
    if (typeof id !== "string" || !id.trim() || id.length > 128) {
      throw createHttpError(400, "유효하지 않은 설정 식별 정보입니다.");
    }
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
      throw createHttpError(400, "유효하지 않은 수정시각입니다.");
    }
    return { updatedAt: value, id };
  };
  const conditionalWrite = async (res: any, action: () => Promise<unknown>) => {
    try { res.json(await action()); }
    catch (error) {
      if (!(error instanceof ScenarioOverrideConflictError)) throw error;
      res.status(409).json({ code: "OVERRIDE_CONFLICT", message: error.message });
    }
  };

  router.get("/api/admin/scenario-overrides/options", asyncHandler(async (req: any, res) => {
    const allowed = req.user.role === "admin" ? null : new Set(await storage.getOperatorManagedOrganizationIds(req.user.id));
    const orgs = (await storage.getAllOrganizations()).filter(org => !allowed || allowed.has(org.id));
    const organizations = await Promise.all(orgs.map(async org => ({ ...org, company: await storage.getCompany(org.companyId) })));
    const all = await storage.getAllScenarios();
    const scenarios = [];
    for (const scenario of all) {
      if (scenario.isDeleted) continue;
      const category = scenario.categoryId ? await storage.getCategory(scenario.categoryId) : null;
      const owner = scenario.organizationId ?? category?.organizationId;
      if (owner && !orgs.some(org => org.id === owner)) continue;
      scenarios.push({ id: scenario.id, title: scenario.title, organizationId: owner ?? null, categoryId: scenario.categoryId });
    }
    res.json({ organizations, scenarios });
  }));
  router.get("/api/admin/scenario-overrides/organization/:organizationId/audit-logs", asyncHandler(async (req: any, res) => {
    await scope(req.user, req.params.organizationId);
    const integer = (value: unknown, fallback: number, max: number) => {
      if (value === undefined) return fallback;
      if (typeof value !== "string" || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) {
        throw createHttpError(400, "유효하지 않은 이력 조회 범위입니다");
      }
      return Number(value);
    };
    const limit = integer(req.query.limit, 25, 100);
    const offset = integer(req.query.offset, 0, 100000);
    if (!limit) throw createHttpError(400, "조회 개수는 1 이상이어야 합니다");
    if (req.query.scenarioId !== undefined && (typeof req.query.scenarioId !== "string" || !req.query.scenarioId.trim())) {
      throw createHttpError(400, "유효하지 않은 시나리오입니다");
    }
    // History survives override deletion/content withdrawal; delegation, not current content access, governs reads.
    const rows = await storage.getScenarioOverrideAudit(req.params.organizationId, req.query.scenarioId, limit + 1, offset);
    res.json({ entries: rows.slice(0, limit), hasMore: rows.length > limit });
  }));
  router.get("/api/admin/scenario-overrides", asyncHandler(async (req: any, res) => {
    res.json(await scopedRows(req.user, typeof req.query.organizationId === "string" ? req.query.organizationId : undefined,
      typeof req.query.scenarioId === "string" ? req.query.scenarioId : undefined));
  }));
  router.get("/api/admin/scenario-overrides/organization/:organizationId", asyncHandler(async (req: any, res) => {
    res.json(await scopedRows(req.user, req.params.organizationId,
      typeof req.query.scenarioId === "string" ? req.query.scenarioId : undefined));
  }));
  router.get("/api/admin/scenario-overrides/scenario/:scenarioId", asyncHandler(async (req: any, res) => {
    res.json(await scopedRows(req.user, undefined, req.params.scenarioId));
  }));
  router.get("/api/admin/scenario-overrides/:organizationId/:scenarioId", asyncHandler(async (req: any, res) => {
    await context(req.user, req.params.organizationId, req.params.scenarioId);
    res.json(await storage.getScenarioOverrideByOrgAndScenario(req.params.organizationId, req.params.scenarioId) ?? null);
  }));
  router.post("/api/admin/scenario-overrides/:organizationId/:scenarioId/preview", asyncHandler(async (req: any, res) => {
    const loaded = await context(req.user, req.params.organizationId, req.params.scenarioId);
    res.json({ ...buildOrganizationPreview(loaded.base, draft(req.body)), organizationActive: loaded.organizationActive });
  }));
  router.put("/api/admin/scenario-overrides/:organizationId/:scenarioId", asyncHandler(async (req: any, res) => {
    write(req.user);
    const loaded = await context(req.user, req.params.organizationId, req.params.scenarioId);
    if (!loaded.organizationActive) throw createHttpError(409, "비활성 조직에는 신규 적용할 수 없습니다");
    const version = expectedVersion(req.body);
    const { expectedUpdatedAt: _version, expectedOverrideId: _id, ...payload } = req.body;
    const value = draft(payload);
    if (isOrganizationOverrideEmpty(value)) throw createHttpError(400, "빈 설정은 저장할 수 없습니다. 기존 설정 제거는 삭제를 사용하세요");
    const preview = buildOrganizationPreview(loaded.base, value);
    if (preview.errors.length) throw createHttpError(422, preview.errors.join("; "));
    await conditionalWrite(res, () => storage.upsertScenarioOverride(req.params.organizationId, req.params.scenarioId, value, req.user.id, version.updatedAt, version.id));
  }));
  router.delete("/api/admin/scenario-overrides/:organizationId/:scenarioId", asyncHandler(async (req: any, res) => {
    write(req.user);
    await context(req.user, req.params.organizationId, req.params.scenarioId);
    const version = expectedVersion(req.body);
    await conditionalWrite(res, async () => {
      await storage.deleteScenarioOverrideByOrgAndScenario(req.params.organizationId, req.params.scenarioId, req.user.id, version.updatedAt, version.id);
      return { success: true };
    });
  }));
  return router;
}
