import { beforeEach, describe, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({ gemini: vi.fn(), openai: vi.fn() }));
vi.mock("@google/genai", () => ({ GoogleGenAI: class {
  models = { generateContent: sdk.gemini, generateContentStream: sdk.gemini };
} }));
vi.mock("openai", () => ({ default: class { chat = { completions: { create: sdk.openai } }; } }));
vi.mock("../../server/utils/globalMBTICache", () => ({
  GlobalMBTICache: { getInstance: () => ({ getMBTIPersona: () => null }) },
}));
vi.mock("../../server/services/aiUsageTracker", () => ({
  trackUsage: vi.fn(), getModelPricingKey: (model: string) => model,
  extractGeminiTokens: () => ({ promptTokens: 0, completionTokens: 0 }),
}));
vi.mock("../../server/utils/concurrency", () => ({
  conversationSemaphore: { run: (fn: any) => fn() }, feedbackSemaphore: { run: (fn: any) => fn() },
  retryWithBackoff: (fn: any) => fn(),
}));
import { OptimizedGeminiProvider } from "../../server/services/providers/optimizedGeminiProvider";
import { OpenAIProvider } from "../../server/services/providers/openaiProvider";
import { OpenRouterProvider } from "../../server/services/providers/openrouterProvider";
import { applyScenarioOverride } from "../../server/services/scenarios/overrideResolver";
const persona: any = { id: "actor", name: "Actor", role: "Customer", personality: "Direct", responseStyle: "Brief", goals: ["Resolve"], background: "Customer" };
const base: any = { id: "s", title: "Base", difficulty: 2, personas: [persona] };
beforeEach(() => {
  vi.clearAllMocks();
  sdk.gemini.mockResolvedValue((async function* () {
    yield { candidates: [{ content: { parts: [{ text: "Answer" }] } }] };
  })());
  sdk.openai.mockImplementation(async (payload: any) => payload.stream
    ? (async function* () { yield { choices: [{ delta: { content: "Answer" } }] }; })()
    : { choices: [{ message: { content: JSON.stringify({ content: "Answer", emotion: "중립" }) } }] });
});
describe("organization instructions reach actual SDK requests without paid calls", () => {
  it.each(["gemini", "openai", "openrouter"])("%s streams the frozen A/B instructions without touching learner words", async kind => {
    const provider = kind === "gemini" ? new OptimizedGeminiProvider("test", "test-model")
      : kind === "openai" ? new OpenAIProvider("test", "test-model") : new OpenRouterProvider("test", "test-model");
    for (const org of ["A", "B"]) {
      sdk.gemini.mockResolvedValue((async function* () { yield { candidates: [{ content: { parts: [{ text: "Answer" }] } }] }; })());
      const scenario = applyScenarioOverride(base, { terminology: { customer: `${org}-member` }, policyConstraints: [`${org}-policy`] });
      const stream = await provider.generateStreamingResponse(scenario, [], persona, "customer", "ko");
      for await (const _chunk of stream) { /* consume SDK mock */ }
    }
    const calls = (kind === "gemini" ? sdk.gemini : sdk.openai).mock.calls;
    const prompt = (payload: any) => kind === "gemini" ? payload.config.systemInstruction : payload.messages[0].content;
    expect(prompt(calls[0][0])).toContain("A-policy");
    expect(prompt(calls[0][0])).not.toContain("B-policy");
    expect(prompt(calls[1][0])).toContain("B-policy");
    expect(prompt(calls[1][0])).toContain("시스템 안전 규칙보다 우선하지 않습니다");
    expect(JSON.stringify(calls[0][0])).toContain("customer");
    expect(base).not.toHaveProperty("_overridePromptBlock");
  });
  it("OpenAI non-streaming requests also receive the same frozen instructions", async () => {
    const provider = new OpenAIProvider("test", "test-model");
    await provider.generateResponse(applyScenarioOverride(base, { policyConstraints: ["A-policy"] }), [], persona, "hello", "ko");
    expect(sdk.openai.mock.calls[0][0].messages[0].content).toContain("A-policy");
  });
});
