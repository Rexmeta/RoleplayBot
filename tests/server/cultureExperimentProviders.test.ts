import { beforeEach, describe, expect, it, vi } from "vitest";
import { newCultureValues } from "../../shared/cultureMap";
import type { ScenarioPersona } from "../../server/services/aiService";
const sdk = vi.hoisted(() => ({ gemini: vi.fn(), openai: vi.fn() }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class { models = { generateContentStream: sdk.gemini }; },
}));
vi.mock("openai", () => ({
  default: class { chat = { completions: { create: sdk.openai } }; },
}));
vi.mock("../../server/utils/globalMBTICache", () => ({
  GlobalMBTICache: { getInstance: () => ({ getMBTIPersona: () => null }) },
}));
vi.mock("../../server/services/aiUsageTracker", () => ({
  trackUsage: vi.fn(), getModelPricingKey: (model: string) => model,
}));
vi.mock("../../server/utils/concurrency", () => ({
  conversationSemaphore: { run: (fn: any) => fn() },
  feedbackSemaphore: { run: (fn: any) => fn() },
  retryWithBackoff: (fn: any) => fn(),
}));
import { OptimizedGeminiProvider } from "../../server/services/providers/optimizedGeminiProvider";
import { OpenAIProvider } from "../../server/services/providers/openaiProvider";
import { OpenRouterProvider } from "../../server/services/providers/openrouterProvider";
import { AIServiceFactory } from "../../server/services/aiServiceFactory";

const persona: ScenarioPersona = {
  id: "controlled-actor", name: "Actor", role: "담당자", personality: "신중함",
  responseStyle: "차분함", goals: ["안전"], background: "제품 개발팀",
};
const snapshot = {
  enabled: true, profileId: "00000000-0000-4000-8000-000000000001",
  profileVersion: 1, snapshotVersion: 1, name: "Custom", country: "Custom", region: "",
  intensity: 70, overrides: {}, sources: [], dimensions: { ...newCultureValues(), leading: 80 },
};
async function consume(provider: any, culture: any) {
  const stream = await provider.generateStreamingResponse({
    id: "culture-controlled-comparison", personas: [{ ...persona, culture }], difficulty: 2,
    context: { playerRole: { position: "책임자" } }, personaSwitchMode: "none",
  }, [], persona, "고정 업무 상황과 발화", "ko", "학습자");
  const chunks: string[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}
beforeEach(() => {
  vi.clearAllMocks();
  sdk.gemini.mockImplementation(async () => (async function* () {
    yield { candidates: [{ content: { parts: [{ text: "응답" }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 } };
  })());
  sdk.openai.mockImplementation(async () => (async function* () {
    yield { choices: [{ delta: { content: "응답" } }], usage: { prompt_tokens: 100, completion_tokens: 20 } };
  })());
});
describe("culture experiment existing provider SDK payloads (mock SDK only)", () => {
  it.each(["gemini", "openai", "openrouter"])("%s keeps model and other prompt content fixed while adding only the bound culture layer", async kind => {
    const provider = kind === "gemini" ? new OptimizedGeminiProvider("test", "gemini-2.5-flash")
      : kind === "openai" ? new OpenAIProvider("test", "gpt-4o-mini")
      : new OpenRouterProvider("test", "openai/gpt-4o-mini");
    const spy = kind === "gemini" ? sdk.gemini : sdk.openai;
    await consume(provider, { enabled: false });
    await consume(provider, snapshot);
    await consume(provider, { ...snapshot, intensity: 0 });
    const [off, on, zero] = spy.mock.calls.map(call => call[0]);
    const prompt = (payload: any) => kind === "gemini" ? payload.config.systemInstruction : payload.messages[0].content;
    expect(prompt(off)).not.toContain("CULTURE_CONTEXT");
    expect(prompt(on)).toContain('[CULTURE_CONTEXT actorId="controlled-actor"');
    expect(prompt(on)).toContain("acknowledge role hierarchy");
    expect(prompt(on).split("\n[CULTURE_CONTEXT")[0]).toBe(prompt(off));
    expect(prompt(zero)).toBe(prompt(off));
    expect(off.model).toBe(on.model);
    expect(off).toEqual(zero);
    if (kind === "gemini") expect(off.contents).toEqual(on.contents);
    else expect(off.messages.slice(1)).toEqual(on.messages.slice(1));
  });
  it("strict creation refuses unimplemented providers rather than silently switching models", () => {
    expect(() => AIServiceFactory.createServiceWithPolicy({ provider: "claude", model: "claude-test" }, { strict: true })).toThrow("does not support");
    expect(() => AIServiceFactory.createServiceWithPolicy({ provider: "custom", model: "custom-test" }, { strict: true })).toThrow("does not support");
  });
});
