import { Router } from "express";
import { isSystemAdmin } from "../middleware/authMiddleware";
import { asyncHandler } from "./routerHelpers";
import { cultureExperimentRequestSchema, cultureExperimentAutofillRequestSchema, CULTURE_EXPERIMENT_NOTICE, CULTURE_EXPERIMENT_SITUATIONS, type ExperimentVariant } from "../../shared/cultureExperiment";
import { bindActorCultures, CultureError, listCultureProfiles } from "../services/cultureMap/service";
import { generateExperimentAutofill, validateAutofillProfiles } from "../services/cultureMap/experimentAutofill";
import { AIServiceFactory, getPolicyForFeature } from "../services/aiServiceFactory";
import { calculateCost, getModelPricingKey, MODEL_PRICING } from "../services/aiUsageTracker";
import { runCultureExperiment } from "../services/cultureMap/experiment";
import { withCultureExperimentLease } from "../services/cultureMap/experimentLease";

export default function createCultureExperimentRouter(isAuthenticated: any) {
  const router = Router();
  router.use("/culture-experiment", isAuthenticated, isSystemAdmin);
  router.get("/culture-experiment/config", asyncHandler(async (_req, res) => {
    const { provider, model } = await getPolicyForFeature("conversation");
    res.json({ policy: { provider, model }, situations: CULTURE_EXPERIMENT_SITUATIONS, notice: CULTURE_EXPERIMENT_NOTICE, maxCalls: 32 });
  }));
  router.post("/culture-experiment/autofill", asyncHandler(async (req: any, res) => {
    if (!cultureExperimentAutofillRequestSchema.safeParse(req.body).success)
      return res.status(400).json({ error: "자동 채움 요청을 확인해 주세요." });
    try {
      const result = await withCultureExperimentLease(req.user.id, async (signal, assertActive) => {
        const profiles = await listCultureProfiles(req.user);
        signal.throwIfAborted();
        if (!profiles.length) throw new CultureError("사용 가능한 문화 프로필이 없습니다. 먼저 프로필을 등록해 주세요.", 400);
        const policy = await getPolicyForFeature("conversation");
        signal.throwIfAborted();
        const service = AIServiceFactory.createServiceWithPolicy(policy, { strict: true });
        await assertActive();
        const suggestion = await generateExperimentAutofill(profiles, service, signal);
        signal.throwIfAborted();
        // Recheck access and versions after the provider call; no snapshot or DB writes.
        return validateAutofillProfiles(suggestion, await listCultureProfiles(req.user));
      }, {
        timeoutMs: 45000,
        timeoutMessage: "AI 자동 채움 시간이 초과되었습니다. 기존 입력은 유지됩니다. 잠시 후 다시 시도해 주세요.",
      });
      res.json(result);
    } catch (error) {
      if (error instanceof CultureError) return res.status(error.statusCode).json({ error: error.message });
      return res.status(502).json({ error: "설정된 텍스트 AI로 자동 채우지 못했습니다. 모델과 접근 설정을 확인해 주세요. 다른 모델이나 샘플로 대체하지 않았으며 기존 입력은 유지됩니다." });
    }
  }));
  router.post("/culture-experiment", asyncHandler(async (req: any, res) => {
    const parsed = cultureExperimentRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "고정 조건, 비교 프로필, 강도와 반복 횟수를 확인해 주세요." });
    const input = parsed.data;
    if (input.mode === "provider" && !input.confirmPaidRun)
      return res.status(400).json({ error: "실제 제공자 호출과 비용 발생에 명시적으로 동의해야 합니다." });
    try {
      const result = await withCultureExperimentLease(req.user.id, async (signal, assertActive) => {
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
            throw new CultureError("설정된 제공자를 비교에 사용할 수 없습니다. Gemini/OpenAI/OpenRouter 텍스트 모델과 접근 설정을 확인해 주세요. 다른 모델로 대체하지 않았습니다.", 400);
          }
        }
        return runCultureExperiment(input, variants, {
          policy, service, signal, assertActive,
          estimateCost: (model, inputTokens, outputTokens) => {
            // OpenRouter routing/prices are not equivalent to our direct-provider rates.
            const key = getModelPricingKey(model);
            return policy.provider !== "openrouter" && MODEL_PRICING[key]
              ? calculateCost(key, inputTokens, outputTokens).totalCost : null;
          },
        });
      });
      res.json(result);
    } catch (error) {
      if (error instanceof CultureError) return res.status(error.statusCode).json({ error: error.message });
      throw error;
    }
  }));
  return router;
}
