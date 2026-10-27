import { Router } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { fileManager } from "../services/fileManager";
import { isOperatorOrAdmin, isSystemAdmin } from "../middleware/authMiddleware";
import { asyncHandler, createHttpError, getOperatorAccessibleCategoryIds } from "./routerHelpers";
import { AvatarRouterAdapter, LiveAvatarContractError } from "../services/liveAvatar/avatarRouterAdapter";
import { liveAvatarAvailability } from "../../shared/avatar/liveAvatar";

const enabledSchema = z.object({ enabled: z.boolean() }).strict();
const policySchema = z.object({ allowed: z.boolean() }).strict();
const selectionSchema = z.object({ service: z.literal("avatar-router"), consent: z.literal(true) }).strict();
export const LIVE_AVATAR_SETTINGS_CATEGORY = "live_avatar";
export const LIVE_AVATAR_POLICY_CATEGORY = "live_avatar_policy";

/** Factory injection is only for contract tests; no browser-controlled upstream. */
export default function createLiveAvatarRouter(
  isAuthenticated: any,
  deps = { storage, fileManager, getOperatorAccessibleCategoryIds, adapter: new AvatarRouterAdapter() },
) {
  const router = Router();
  router.use(isAuthenticated);
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  const getEnabled = async () =>
    (await deps.storage.getSystemSetting(LIVE_AVATAR_SETTINGS_CATEGORY, "enabled"))?.value === "true";
  const getAllowed = async (scenarioId: string) =>
    (await deps.storage.getSystemSetting(LIVE_AVATAR_POLICY_CATEGORY, scenarioId))?.value === "true";
  const getConfig = async () => {
    const { allowed, available, ...config } = liveAvatarAvailability(await getEnabled(), false);
    config.blockers = config.blockers.filter(code => code !== "scenario_not_allowed");
    return config;
  };

  const ownedConversation = async (conversationId: string, userId: string) => {
    const personaRun = await deps.storage.getPersonaRun(conversationId);
    if (!personaRun) throw createHttpError(404, "Conversation not found");
    const scenarioRun = await deps.storage.getScenarioRun(personaRun.scenarioRunId);
    // No admin/operator bypass for creating an external session for another user.
    if (!scenarioRun || scenarioRun.userId !== userId) throw createHttpError(403, "Conversation access denied");
    return { personaRun, scenarioRun };
  };

  const managedScenario = async (scenarioId: string, user: any) => {
    const scenario = (await deps.fileManager.getAllScenarios()).find(s => s.id === scenarioId);
    if (!scenario) throw createHttpError(404, "Scenario not found");
    if (user.role !== "admin") {
      if (user.role !== "operator") throw createHttpError(403, "Scenario management access denied");
      const categories = await deps.getOperatorAccessibleCategoryIds(user);
      if (!categories.includes(scenario.categoryId ?? "")) throw createHttpError(403, "Scenario management access denied");
    }
  };

  router.get("/config", asyncHandler(async (_req, res) => {
    res.json(await getConfig());
  }));

  router.put("/config", isSystemAdmin, asyncHandler(async (req: any, res) => {
    const parsed = enabledSchema.safeParse(req.body);
    if (!parsed.success) throw createHttpError(400, "Expected { enabled: boolean }");
    await deps.storage.upsertSystemSetting({
      category: LIVE_AVATAR_SETTINGS_CATEGORY, key: "enabled", value: String(parsed.data.enabled),
      description: "Optional live avatar service (default OFF; contract verification still required)",
      updatedBy: req.user.id,
    });
    res.json(await getConfig());
  }));

  router.post("/diagnostics", isSystemAdmin, asyncHandler(async (_req, res) => {
    res.json(await deps.adapter.diagnose());
  }));

  router.get("/scenarios/:scenarioId/policy", isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    await managedScenario(req.params.scenarioId, req.user);
    res.json({ allowed: await getAllowed(req.params.scenarioId) });
  }));

  router.put("/scenarios/:scenarioId/policy", isOperatorOrAdmin, asyncHandler(async (req: any, res) => {
    const parsed = policySchema.safeParse(req.body);
    if (!parsed.success) throw createHttpError(400, "Expected { allowed: boolean }");
    await managedScenario(req.params.scenarioId, req.user);
    await deps.storage.upsertSystemSetting({
      category: LIVE_AVATAR_POLICY_CATEGORY, key: req.params.scenarioId, value: String(parsed.data.allowed),
      description: "Live avatar permission only; does not alter scenario content or video-avatar preference",
      updatedBy: req.user.id,
    });
    res.json(parsed.data);
  }));

  router.get("/conversations/:conversationId/availability", asyncHandler(async (req: any, res) => {
    const { scenarioRun } = await ownedConversation(req.params.conversationId, req.user.id);
    res.json(liveAvatarAvailability(await getEnabled(), await getAllowed(scenarioRun.scenarioId)));
  }));

  router.post("/conversations/:conversationId/sessions", asyncHandler(async (req: any, res) => {
    if (!selectionSchema.safeParse(req.body).success) throw createHttpError(400, "Explicit live service selection and consent required");
    const { personaRun, scenarioRun } = await ownedConversation(req.params.conversationId, req.user.id);
    if (personaRun.status === "completed" || scenarioRun.status === "completed") {
      throw createHttpError(409, "Conversation has ended");
    }
    const availability = liveAvatarAvailability(await getEnabled(), await getAllowed(scenarioRun.scenarioId));
    // Check policies before invoking even the disabled adapter.
    if (!availability.enabled || !availability.allowed) {
      res.status(409).json({ code: "live_avatar_contract_unverified", blockers: availability.blockers });
      return;
    }
    try {
      await deps.adapter.openSession({ ownerId: req.user.id, conversationId: req.params.conversationId });
    } catch (error) {
      if (!(error instanceof LiveAvatarContractError)) throw error;
      res.status(409).json({ code: error.code, error: error.message, blockers: availability.blockers });
    }
  }));
  return router;
}
