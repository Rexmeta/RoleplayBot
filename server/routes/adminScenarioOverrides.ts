import { Router } from "express";
import { storage } from "../storage";
import { scenarioOverrideDataSchema } from "@shared/schema";
import { asyncHandler, createHttpError } from "./routerHelpers";

export default function createAdminScenarioOverridesRouter(isAuthenticated: any) {
  const router = Router();

  router.get("/api/admin/scenario-overrides", isAuthenticated, asyncHandler(async (req: any, res) => {
    if (req.user?.role !== 'admin' && req.user?.role !== 'operator') {
      throw createHttpError(403, "관리자 또는 운영자 권한이 필요합니다");
    }
    const overrides = await storage.getAllScenarioOverrides();
    res.json(overrides);
  }));

  router.get("/api/admin/scenario-overrides/organization/:organizationId", isAuthenticated, asyncHandler(async (req: any, res) => {
    if (req.user?.role !== 'admin' && req.user?.role !== 'operator') {
      throw createHttpError(403, "관리자 또는 운영자 권한이 필요합니다");
    }
    const { organizationId } = req.params;
    const overrides = await storage.getScenarioOverridesByOrganization(organizationId);
    res.json(overrides);
  }));

  router.get("/api/admin/scenario-overrides/scenario/:scenarioId", isAuthenticated, asyncHandler(async (req: any, res) => {
    if (req.user?.role !== 'admin' && req.user?.role !== 'operator') {
      throw createHttpError(403, "관리자 또는 운영자 권한이 필요합니다");
    }
    const { scenarioId } = req.params;
    const overrides = await storage.getScenarioOverridesByScenario(scenarioId);
    res.json(overrides);
  }));

  router.get("/api/admin/scenario-overrides/:organizationId/:scenarioId", isAuthenticated, asyncHandler(async (req: any, res) => {
    if (req.user?.role !== 'admin' && req.user?.role !== 'operator') {
      throw createHttpError(403, "관리자 또는 운영자 권한이 필요합니다");
    }
    const { organizationId, scenarioId } = req.params;
    const override = await storage.getScenarioOverrideByOrgAndScenario(organizationId, scenarioId);
    res.json(override ?? null);
  }));

  router.put("/api/admin/scenario-overrides/:organizationId/:scenarioId", isAuthenticated, asyncHandler(async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      throw createHttpError(403, "관리자 권한이 필요합니다");
    }
    const { organizationId, scenarioId } = req.params;

    const parsed = scenarioOverrideDataSchema.safeParse(req.body);
    if (!parsed.success) {
      throw createHttpError(400, `유효하지 않은 override 데이터: ${parsed.error.message}`);
    }

    const org = await storage.getOrganization(organizationId);
    if (!org) throw createHttpError(404, "조직을 찾을 수 없습니다");

    const scenario = await storage.getScenario(scenarioId);
    if (!scenario) throw createHttpError(404, "시나리오를 찾을 수 없습니다");

    const override = await storage.upsertScenarioOverride(organizationId, scenarioId, parsed.data);
    res.json(override);
  }));

  router.delete("/api/admin/scenario-overrides/:organizationId/:scenarioId", isAuthenticated, asyncHandler(async (req: any, res) => {
    if (req.user?.role !== 'admin') {
      throw createHttpError(403, "관리자 권한이 필요합니다");
    }
    const { organizationId, scenarioId } = req.params;
    await storage.deleteScenarioOverrideByOrgAndScenario(organizationId, scenarioId);
    res.json({ success: true });
  }));

  return router;
}
