import { Router } from "express";
import { isSystemAdmin } from "../middleware/authMiddleware";
import { asyncHandler } from "./routerHelpers";
import { cultureExperimentRequestSchema, CULTURE_EXPERIMENT_NOTICE, CULTURE_EXPERIMENT_SITUATIONS, type ExperimentVariant } from "../../shared/cultureExperiment";
import { bindActorCultures, CultureError } from "../services/cultureMap/service";
import { AIServiceFactory, getPolicyForFeature } from "../services/aiServiceFactory";
import { calculateCost, getModelPricingKey, MODEL_PRICING } from "../services/aiUsageTracker";
import { runCultureExperiment } from "../services/cultureMap/experiment";

export default function createCultureExperimentRouter(isAuthenticated: any) {
  const router = Router();
  // Process-local guard against double-clicks and unbounded parallel paid batches.
  const activeUsers = new Set<string>();
  router.use("/culture-experiment", isAuthenticated, isSystemAdmin);
  router.get("/culture-experiment/config", asyncHandler(async (_req, res) => {
    const { provider, model } = await getPolicyForFeature("conversation");
    res.json({ policy: { provider, model }, situations: CULTURE_EXPERIMENT_SITUATIONS, notice: CULTURE_EXPERIMENT_NOTICE, maxCalls: 32 });
  }));
  router.post("/culture-experiment", asyncHandler(async (req: any, res) => {
    const parsed = cultureExperimentRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "고정 조건, 비교 프로필, 강도와 반복 횟수를 확인해 주세요." });
    const input = parsed.data;
    if (input.mode === "provider" && !input.confirmPaidRun)
      return res.status(400).json({ error: "실제 제공자 호출과 비용 발생에 명시적으로 동의해야 합니다." });
    if (activeUsers.has(req.user.id) || activeUsers.size >= 2)
      return res.status(409).json({ error: "이미 비교가 실행 중입니다. 완료 후 다시 시작해 주세요." });
    activeUsers.add(req.user.id);
    try {
      const variants: ExperimentVariant[] = [{ id: "off", label: "문화 OFF", culture: { enabled: false } }];
      // Bind all selections before creating a paid provider. No client-authored snapshots.
      for (let index = 0; index < input.variants.length; index++) {
        const selection = input.variants[index];
        const [actor] = await bindActorCultures([{ id: "controlled-actor", culture: selection }], req.user);
        variants.push({ id: `culture-${index + 1}`, label: `${actor.culture.name} · 강도 ${selection.intensity}`, culture: actor.culture });
      }
      const policy = input.mode === "provider" ? await getPolicyForFeature("conversation") : { provider: "gemini" as const, model: "mock-no-provider" };
      let service;
      if (input.mode === "provider") {
        try {
          service = AIServiceFactory.createServiceWithPolicy(policy, { strict: true });
          if (!service.generateStreamingResponse) throw new Error("No streaming support");
        } catch {
          return res.status(400).json({ error: "설정된 제공자를 비교에 사용할 수 없습니다. Gemini/OpenAI/OpenRouter 텍스트 모델과 접근 설정을 확인해 주세요. 다른 모델로 대체하지 않았습니다." });
        }
      }
      res.json(await runCultureExperiment(input, variants, {
        policy, service,
        estimateCost: (model, inputTokens, outputTokens) => {
          // OpenRouter routing/prices are not equivalent to our direct-provider rates.
          const key = getModelPricingKey(model);
          return policy.provider !== "openrouter" && MODEL_PRICING[key]
            ? calculateCost(key, inputTokens, outputTokens).totalCost : null;
        },
      }));
    } catch (error) {
      if (error instanceof CultureError) return res.status(error.statusCode).json({ error: error.message });
      throw error;
    } finally {
      activeUsers.delete(req.user.id);
    }
  }));
  return router;
}
