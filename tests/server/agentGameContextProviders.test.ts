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
import { withGameContext } from "../../server/services/agentGameContext";

const persona: any = { id: "actor", name: "Actor", role: "Customer", personality: "Direct", responseStyle: "Brief", goals: ["Resolve"], background: "Customer" };
const base: any = { id: "s", title: "Base", difficulty: 2, personas: [persona], context: { situation: "Base situation" } };
const scenario = withGameContext(base, { contextId: "c1", sceneSummary: "UNIQUE-SCENE-MARKER", playerState: { gold: 40 } }, "en");
const messages: any[] = Array.from({ length: 5 }, (_, i) => [
  { sender: "user", message: `I will fix it today, attempt ${i}.`, timestamp: new Date(Date.now() + i * 20000).toISOString() },
  { sender: "ai", message: "Okay.", emotion: "중립", timestamp: new Date(Date.now() + i * 20000 + 5000).toISOString() },
]).flat();
beforeEach(() => {
  vi.clearAllMocks();
  sdk.gemini.mockImplementation(async () => (async function* () {
    yield { candidates: [{ content: { parts: [{ text: "{}" }] } }], text: "{}" };
  })());
  sdk.openai.mockImplementation(async (payload: any) => payload.stream
    ? (async function* () { yield { choices: [{ delta: { content: "Answer" } }] }; })()
    : { choices: [{ message: { content: JSON.stringify({ content: "Answer", emotion: "중립" }) } }] });
});
const allText = (payload: any) => JSON.stringify(payload);

describe("game context reaches the final model requests", () => {
  it("OpenAI conversation (streaming and non-streaming)", async () => {
    const p = new OpenAIProvider("test", "test-model");
    await p.generateResponse(scenario, [], persona, "hello", "ko");
    const stream = await p.generateStreamingResponse(scenario, [], persona, "hello", "ko");
    for await (const _c of stream) { /* drain */ }
    expect(sdk.openai.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const call of sdk.openai.mock.calls) expect(allText(call[0])).toContain("UNIQUE-SCENE-MARKER");
  });

  it("Gemini conversation", async () => {
    const p = new OptimizedGeminiProvider("test", "test-model");
    const stream = await p.generateStreamingResponse(scenario, [], persona, "hello", "ko");
    for await (const _c of stream) { /* drain */ }
    expect(allText(sdk.gemini.mock.calls[0][0])).toContain("UNIQUE-SCENE-MARKER");
  });

  it("OpenAI feedback evaluation", async () => {
    const p = new OpenAIProvider("test", "test-model");
    await p.generateFeedback(scenario, messages, persona, undefined, undefined, "ko").catch(() => {});
    expect(sdk.openai).toHaveBeenCalled();
    expect(allText(sdk.openai.mock.calls[0][0])).toContain("UNIQUE-SCENE-MARKER");
  });

  it("Gemini feedback evaluation", async () => {
    const p = new OptimizedGeminiProvider("test", "test-model");
    await p.generateFeedback(scenario, messages, persona, undefined, undefined, "ko").catch(() => {});
    expect(sdk.gemini).toHaveBeenCalled();
    expect(allText(sdk.gemini.mock.calls[0][0])).toContain("UNIQUE-SCENE-MARKER");
  });

  it("requests without game context carry no marker", async () => {
    const p = new OpenAIProvider("test", "test-model");
    await p.generateResponse(base, [], persona, "hello", "ko");
    expect(allText(sdk.openai.mock.calls[0][0])).not.toContain("UNIQUE-SCENE-MARKER");
  });
});
