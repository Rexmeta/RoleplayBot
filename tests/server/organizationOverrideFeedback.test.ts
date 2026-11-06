import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ generate: vi.fn(), persist: vi.fn(), readCurrent: vi.fn() }));
vi.mock("../../server/storage", () => ({ storage: {
  getFeedbackByConversationId: vi.fn(async () => null),
  getSimulationEventsByPersonaRun: vi.fn(async () => []),
  getScenario: mocks.readCurrent, createFeedback: mocks.persist,
  getActiveEvaluationCriteriaSetWithDimensions: mocks.readCurrent,
} }));
vi.mock("../../server/services/fileManager", () => ({ fileManager: {} }));
vi.mock("../../server/services/aiServiceFactory", () => ({
  generateFeedback: mocks.generate, getModelForFeature: vi.fn(async () => "mock-model"),
  generateStrategyReflectionFeedback: vi.fn(),
}));
vi.mock("../../server/services/aiUsageTracker", () => ({ trackUsage: vi.fn() }));
vi.mock("../../server/services/voice/recognitionEvidence", () => ({
  prepareRecognitionConversation: vi.fn(async (_id: string, conversation: any) => ({ conversation, revision: "none" })),
  listRecognitionEvidence: vi.fn(async () => []),
}));
import { generateAndSaveFeedback, recalculateOverallScore } from "../../server/routes/routerHelpers";
const context = {
  id: "s", minValidTurns: 1, targetTurns: 4, _organizationOverride: {
    organizationId: "A", capturedAt: "2026-01-01", override: { evaluationWeights: { first: 0 } },
    dimensions: [{ key: "first", normalizedPercent: 0 }, { key: "second", normalizedPercent: 100 }],
  },
  _evaluationCriteriaSnapshot: { id: "r", name: "Snapshot rubric", dimensions: [
    { key: "first", name: "First", weight: 0, minScore: 0, maxScore: 10 },
    { key: "second", name: "Second", weight: 100, minScore: 0, maxScore: 10 },
  ] },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.persist.mockImplementation(async (payload: any) => payload);
  mocks.generate.mockResolvedValue({ overallScore: 99, summary: "Mock", scores: [
    { category: "first", score: 10, evidence: [{ text: "evidence" }] },
    { category: "second", score: 2, evidence: [{ text: "evidence" }] },
  ], scoreAdjustments: { completionPenalty: 0 } });
});
describe("feedback uses actual bound weights, not current authoring", () => {
  it("honors zero in server score verification", () => {
    expect(recalculateOverallScore([{ score: 10, maxScore: 10, weight: 0 }, { score: 2, maxScore: 10, weight: 100 }])).toBe(20);
  });
  it("passes the frozen rubric to the provider and regenerates with identical ratios", async () => {
    const conversation = { mode: "text", messages: Array.from({ length: 8 }, (_, i) => ({
      sender: i % 2 ? "ai" : "user", message: "충분히 자세한 업무 설명과 확인 질문입니다. ".repeat(20),
      timestamp: new Date(1700000000000 + i * 10000).toISOString(),
    })) };
    const result = await generateAndSaveFeedback("run", conversation, structuredClone(context), {});
    expect(mocks.generate.mock.calls[0][4].dimensions.map((d: any) => d.weight)).toEqual([0, 100]);
    expect(result.rubricSnapshot.organizationOverride.organizationId).toBe("A");
    expect(result.scores.map((d: any) => d.weight)).toEqual([0, 100]);
    expect(result.overallScore).toBe(20);
    await generateAndSaveFeedback("run", conversation, structuredClone(context), {});
    expect(mocks.generate.mock.calls[1][4]).toEqual(mocks.generate.mock.calls[0][4]);
    expect(mocks.readCurrent).not.toHaveBeenCalled();
  });
});
