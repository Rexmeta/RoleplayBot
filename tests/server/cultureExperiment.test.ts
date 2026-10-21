import { describe, expect, it, vi } from "vitest";
import { cultureExperimentRequestSchema, DEFAULT_EXPERIMENT_FIXED, CULTURE_EXPERIMENT_SITUATIONS, type ExperimentVariant } from "../../shared/cultureExperiment";
import { newCultureValues, cultureSnapshotSchema } from "../../shared/cultureMap";
import { runCultureExperiment } from "../../server/services/cultureMap/experiment";
import { buildActorCultureLayer } from "../../server/services/cultureMap/prompt";

const selection = { enabled: true as const, profileId: "00000000-0000-4000-8000-000000000001", profileVersion: 1, intensity: 70, overrides: {} };
const requestInput = (mode: "mock" | "provider" = "mock") => cultureExperimentRequestSchema.parse({
  mode, confirmPaidRun: mode === "provider", fixed: DEFAULT_EXPERIMENT_FIXED, variants: [selection], repetitions: 2,
});
const variants = (): ExperimentVariant[] => [
  { id: "off", label: "문화 OFF", culture: { enabled: false } },
  { id: "culture-1", label: "시험", culture: cultureSnapshotSchema.parse({
    ...selection, snapshotVersion: 1, name: "시험", country: "시험", region: "", sources: [],
    dimensions: { ...newCultureValues(), communicating: 80 },
  }) },
];
const policy = { provider: "gemini" as const, model: "gemini-2.5-flash" };
const estimateCost = vi.fn(() => 0.001);

describe("controlled Culture Map experiment (mocked providers, NOT live validation)", () => {
  it("bounds workload, rejects forged snapshots and arbitrary fixed-condition keys", () => {
    const valid = requestInput();
    expect(cultureExperimentRequestSchema.safeParse({ ...valid, repetitions: 3 }).success).toBe(false);
    expect(cultureExperimentRequestSchema.safeParse({ ...valid, variants: [] }).success).toBe(false);
    expect(cultureExperimentRequestSchema.safeParse({ ...valid, variants: Array(4).fill(selection) }).success).toBe(false);
    expect(cultureExperimentRequestSchema.safeParse({ ...valid, variants: [variants()[1].culture] }).success).toBe(false);
    expect(cultureExperimentRequestSchema.safeParse({ ...valid, fixed: { ...valid.fixed, model: "other" } }).success).toBe(false);
    expect(cultureExperimentRequestSchema.safeParse({ ...valid, variants: [{ ...selection, intensity: 101 }] }).success).toBe(false);
    expect(cultureExperimentRequestSchema.safeParse({ ...valid, variants: [{ ...selection, overrides: { leading: 0 } }] }).success).toBe(false);
  });
  it("mock makes no provider calls and returns all four situations and repetitions separately labeled", async () => {
    const generateStreamingResponse = vi.fn();
    const result = await runCultureExperiment(requestInput(), variants(), { policy, service: { generateStreamingResponse }, estimateCost });
    expect(generateStreamingResponse).not.toHaveBeenCalled();
    expect(result.mode).toBe("mock");
    expect(result.policy.provider).toBe("mock");
    expect(result.cases).toHaveLength(16);
    expect(new Set(result.cases.map(item => item.situationId)).size).toBe(4);
    expect(result.cases.every(item => item.content.includes("문화 행동 차이의 증거가 아닙니다"))).toBe(true);
    expect(result.knownEstimatedCostUsd).toBe(0);
    expect(result.unknownCostCases).toBe(0);
  });
  it("fixes persona, organization, roles, model, prompts and history while only culture varies", async () => {
    const input = requestInput("provider");
    const original = structuredClone(input);
    const observed: any[] = [];
    const generateStreamingResponse = vi.fn(async (...args: any[]) => {
      observed.push(structuredClone(args));
      return (async function* () {
        yield "검증 단계를 유지합시다.";
        yield '[META:{"emotion":"중립","complete":false}]';
        yield '[USAGE:{"inputTokens":100,"outputTokens":20}]';
      })();
    });
    const bound = variants();
    const result = await runCultureExperiment(input, bound, { policy, service: { generateStreamingResponse }, estimateCost });
    expect(result.cases).toHaveLength(16);
    expect(result.cases.every(item => item.content === "검증 단계를 유지합시다.")).toBe(true);
    expect(result.cases.every(item => item.usage?.inputTokens === 100)).toBe(true);
    expect(result.unknownCostCases).toBe(0);
    expect(result.knownEstimatedCostUsd).toBeCloseTo(0.016);
    expect(input).toEqual(original);
    for (const situation of CULTURE_EXPERIMENT_SITUATIONS) {
      const matching = observed.filter(args => args[0].context.situation === situation.situation);
      expect(matching).toHaveLength(4);
      const normalized = matching.map(args => {
        const copy = structuredClone(args);
        delete copy[0].personas[0].culture;
        return copy;
      });
      normalized.forEach(args => expect(args).toEqual(normalized[0]));
      expect(matching[0][1]).toEqual([]);
      expect(matching[0][2].background).toBe(input.fixed.organization);
      expect(matching[0][3]).toContain(situation.userMessage);
    }
    // Frozen result remains reproducible even when the caller changes its form.
    input.fixed.organization = "changed";
    (bound[1].culture as any).intensity = 10;
    expect(result.fixed.organization).toBe(original.fixed.organization);
    expect((result.variants[1].culture as any).intensity).toBe(70);
    expect(result.policy).toEqual(policy);
  });
  it("requires explicit consent and validates all snapshots before the first provider call", async () => {
    const generateStreamingResponse = vi.fn();
    const input = requestInput("provider");
    await expect(runCultureExperiment({ ...input, confirmPaidRun: false }, variants(), { policy, service: { generateStreamingResponse }, estimateCost })).rejects.toThrow("confirmation");
    const invalid = variants();
    (invalid[1].culture as any).dimensions.leading = 999;
    await expect(runCultureExperiment(input, invalid, { policy, service: { generateStreamingResponse }, estimateCost })).rejects.toThrow("Invalid bound");
    expect(generateStreamingResponse).not.toHaveBeenCalled();
  });
  it("retains partial failures, continues other cases, redacts SDK messages and never reports unknown charges as zero", async () => {
    let index = 0;
    const generateStreamingResponse = vi.fn(async () => (async function* () {
      if (index++ === 0) {
        yield "부분 응답";
        throw new Error("SECRET credentials in provider URL");
      }
      yield "정상 응답";
    })());
    const result = await runCultureExperiment(requestInput("provider"), variants(), { policy, service: { generateStreamingResponse }, estimateCost });
    expect(result.cases[0].status).toBe("failed");
    expect(result.cases[0].content).toBe("부분 응답");
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(result.cases.filter(item => item.status === "completed")).toHaveLength(15);
    expect(result.unknownCostCases).toBe(16);
    expect(result.cases[0].estimatedCostUsd).toBeNull();
  });
  it("marks empty output as failed, and unknown model pricing as unknown even with tokens", async () => {
    let index = 0;
    const generateStreamingResponse = vi.fn(async () => (async function* () {
      if (index++ === 0) yield '[META:{"emotion":"중립"}]';
      else yield '응답[USAGE:{"inputTokens":10,"outputTokens":5}]';
    })());
    const result = await runCultureExperiment(requestInput("provider"), variants(), { policy, service: { generateStreamingResponse }, estimateCost: () => null });
    expect(result.cases[0].status).toBe("failed");
    expect(result.unknownCostCases).toBe(16);
  });
  it("does not manufacture categorical changes for adjacent scores within the same behavior band; intensity zero equals OFF", () => {
    const low = variants()[1].culture as any;
    const high = structuredClone(low);
    high.dimensions.communicating = 81;
    const line = (culture: any) => buildActorCultureLayer({ culture }).split("\n").find(line => line.startsWith("- communicating"));
    expect(line(low)?.replace("80/100", "SCORE")).toBe(line(high)?.replace("81/100", "SCORE"));
    expect(buildActorCultureLayer({ culture: { ...low, intensity: 0 } })).toBe("");
    expect(buildActorCultureLayer({ culture: { enabled: false } })).toBe("");
  });
});
