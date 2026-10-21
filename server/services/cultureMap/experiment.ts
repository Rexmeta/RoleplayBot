import { randomUUID } from "node:crypto";
import {
  CULTURE_EXPERIMENT_NOTICE, CULTURE_EXPERIMENT_SITUATIONS,
  type CultureExperimentRequest, type CultureExperimentResult, type ExperimentVariant,
} from "../../../shared/cultureExperiment";
import type { AIModelPolicy, AIServiceInterface, RoleplayScenario, ScenarioPersona } from "../aiService";
import { buildActorCultureLayer } from "./prompt";

export interface ExperimentDependencies {
  policy: AIModelPolicy;
  service?: Pick<AIServiceInterface, "generateStreamingResponse">;
  estimateCost: (model: string, input: number, output: number) => number | null;
}

/** No session creation, simulation scores, evaluator, or feedback/report writes.
 * Uses the same text streaming provider and bound Actor layer as normal chat.
 */
export async function runCultureExperiment(
  request: CultureExperimentRequest,
  variants: ExperimentVariant[],
  deps: ExperimentDependencies,
): Promise<CultureExperimentResult> {
  const startedAt = new Date().toISOString();
  if (request.mode === "provider" && (!request.confirmPaidRun || !deps.service?.generateStreamingResponse))
    throw new Error("Explicit paid-run confirmation and streaming provider are required");
  // Fail before any paid call if ANY bound snapshot is invalid.
  variants.forEach(variant => buildActorCultureLayer({ id: "controlled-actor", culture: variant.culture }));
  const persona: ScenarioPersona = {
    id: "controlled-actor", name: request.fixed.name, role: request.fixed.role,
    personality: request.fixed.personality, responseStyle: "상대방을 존중하며 자연스러운 업무 대화를 한다.",
    goals: ["필수 품질과 안전을 지키며 실행 가능한 다음 단계를 제안한다."],
    background: request.fixed.organization,
  };
  const cases: CultureExperimentResult["cases"] = [];
  for (const situation of CULTURE_EXPERIMENT_SITUATIONS) {
    for (let repetition = 1; repetition <= request.repetitions; repetition++) {
      // Rotate order to avoid always sampling OFF first on repeated trials.
      const order = [...variants.slice((repetition - 1) % variants.length), ...variants.slice(0, (repetition - 1) % variants.length)];
      for (const variant of order) {
        const start = Date.now();
        let raw = "";
        let failure: string | undefined;
        if (request.mode === "mock") {
          raw = "[MOCK · 제공자 미호출] 배선/결과 표시 확인용 고정 응답입니다. 문화 행동 차이의 증거가 아닙니다.";
        } else {
          const scenario: RoleplayScenario = {
            id: "culture-controlled-comparison", difficulty: 2,
            context: {
              situation: situation.situation,
              playerRole: { position: request.fixed.playerRole, department: request.fixed.organization },
            },
            personas: [Object.assign({}, persona, { culture: variant.culture })],
            personaSwitchMode: "none",
          };
          try {
            const stream = await deps.service!.generateStreamingResponse!(
              scenario, [], structuredClone(persona),
              `[고정 업무 상황]\n${situation.situation}\n[상대방의 발언]\n${situation.userMessage}`,
              "ko", "학습자",
            );
            for await (const chunk of stream) raw += chunk;
          } catch (error: any) {
            // Never expose arbitrary SDK messages (which can contain URLs/credentials).
            const status = Number(error?.status);
            failure = status === 429 ? "제공자 요청 한도 초과. 자동 대체 응답을 사용하지 않았습니다."
              : status === 401 || status === 403 ? "제공자 접근 권한 오류."
              : "제공자 호출/스트림 실패. 부분 응답이 있을 수 있으며 과금 여부는 확인이 필요합니다.";
          }
        }
        const usageMatches = Array.from(raw.matchAll(/\[USAGE:(\{[^\r\n]*?\})\]/g));
        let usage: { inputTokens: number; outputTokens: number } | null = null;
        try {
          const value = JSON.parse(usageMatches.at(-1)?.[1] ?? "null");
          if (value && [value.inputTokens, value.outputTokens].every(n => Number.isSafeInteger(n) && n >= 0))
            usage = { inputTokens: value.inputTokens, outputTokens: value.outputTokens };
        } catch { /* Usage not reported reliably: keep cost unknown, never zero. */ }
        const content = raw.replace(/\[(?:META|USAGE):\{[^\r\n]*\}\]/g, "").trim();
        if (!content && !failure) failure = "제공자가 유효한 대화 본문을 반환하지 않았습니다.";
        cases.push({
          situationId: situation.id, variantId: variant.id, repetition,
          status: failure ? "failed" : "completed", content,
          ...(failure ? { error: failure } : {}), durationMs: Date.now() - start,
          usage,
          estimatedCostUsd: request.mode === "mock" ? 0
            : usage ? deps.estimateCost(deps.policy.model, usage.inputTokens, usage.outputTokens) : null,
        });
      }
    }
  }
  return {
    id: randomUUID(), startedAt, finishedAt: new Date().toISOString(),
    mode: request.mode, fixed: structuredClone(request.fixed),
    policy: request.mode === "mock" ? { provider: "mock", model: "mock-no-provider" } : { provider: deps.policy.provider, model: deps.policy.model },
    repetitions: request.repetitions, variants: structuredClone(variants), cases,
    notice: CULTURE_EXPERIMENT_NOTICE,
    costNotice: "표시 비용은 보고된 토큰과 로컬 단가표로 계산한 추정치이며 청구액/지출 상한이 아닙니다. 캐시 할인·내부 재시도·실패한 호출 비용은 누락될 수 있습니다. 미보고 사용량/미등록 단가는 알 수 없음으로 표시합니다.",
    knownEstimatedCostUsd: cases.reduce((sum, item) => sum + (item.estimatedCostUsd ?? 0), 0),
    unknownCostCases: cases.filter(item => item.estimatedCostUsd === null).length,
  };
}
