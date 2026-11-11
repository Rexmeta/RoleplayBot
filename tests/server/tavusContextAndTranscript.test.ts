import { describe, expect, it, vi } from "vitest";
vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/services/fileManager", () => ({ fileManager: {} }));
vi.mock("../../server/services/conversationLedger/transcript", () => ({ ledgerRuntimeBinding: vi.fn() }));
import { buildTavusContext, resolveTavusContext } from "../../server/services/tavus/context";
import { adaptTavusTranscript, transcriptIdentity } from "../../server/services/tavus/transcriptAdapter";
import { ledgerPayloadSchema } from "../../shared/conversationLedger";

describe("Tavus dynamic context", () => {
  it.each(["ko", "en", "ja", "zh"])("keeps %s in the avatar context after profile changes", async language => {
    const deps: any = {
      storage: {
        getPersonaRun: vi.fn(async () => ({ personaId: "p", scenarioRunId: "sr", difficulty: 3, language: "en" })),
        getScenarioRun: vi.fn(async () => ({ userId: "owner", scenarioId: "s" })),
        getScenario: vi.fn(), getMbtiPersona: vi.fn(),
        getUser: vi.fn(async () => ({ preferredLanguage: "zh" })),
      }, fileManager: { getAllScenarios: vi.fn() },
      ledgerRuntimeBinding: vi.fn(async () => ({ language, scenarioSnapshot: {
        id: "s", title: "Frozen", personas: [{ id: "p", name: "Actor", _runtimeProfile: {} }],
      } })),
    };
    const result = await resolveTavusContext("owner", "run", deps);
    expect(result.language).toBe(language);
    expect(result.context).toContain(`"language":"${language}"`);
  });
  it("varies character and scenario without changing the common PAL", () => {
    const first = buildTavusContext({ title: "납기 협상", objectives: ["일정 합의"] },
      { name: "김 팀장", personality: "단호함", goal: "품질 보장" }, "ko", 4);
    const second = buildTavusContext({ title: "성과 면담", objectives: ["개선 계획"] },
      { name: "박 대리", personality: "신중함", goal: "우려 전달" }, "ko", 2);
    expect(first).toContain("단호함");
    expect(first).toContain("납기 협상");
    expect(second).toContain("신중함");
    expect(second).toContain("성과 면담");
    expect(first).not.toEqual(second);
  });

  it("does not serialize private unrelated fields or rubrics", () => {
    const context = buildTavusContext({ title: "Test", evaluationHarness: { privateScoringKey: "hidden" } },
      { name: "Actor", apiKey: "secret", email: "private@example.com", image: "https://private.example/pic" }, "ko", 3);
    expect(context).not.toMatch(/secret|private@example|privateScoringKey|private.example/);
  });

  it("loads DB scenario and persona for unbound runs and checks ownership first", async () => {
    const deps: any = {
      storage: {
        getPersonaRun: vi.fn(async () => ({ personaId: "actor", scenarioRunId: "srun", difficulty: 4 })),
        getScenarioRun: vi.fn(async () => ({ userId: "owner", scenarioId: "scenario" })),
        getScenario: vi.fn(async () => ({ id: "scenario", title: "Negotiation",
          personas: [{ id: "actor", name: "Manager", personaRef: "ENTJ.json" }] })),
        getMbtiPersona: vi.fn(async () => ({ communication_style: "직설적", communication_patterns: { opening_style: "짧게" } })),
        getUser: vi.fn(async () => ({ preferredLanguage: "ko" })),
      },
      fileManager: { getAllScenarios: vi.fn() }, ledgerRuntimeBinding: vi.fn(async () => null),
    };
    const result = await resolveTavusContext("owner", "run", deps);
    expect(result.context).toContain("직설적");
    expect(deps.storage.getMbtiPersona).toHaveBeenCalledWith("entj");
    await expect(resolveTavusContext("other", "run", deps)).rejects.toMatchObject({ status: 403 });
    expect(deps.storage.getScenario).toHaveBeenCalledTimes(1);
  });

  it("does not replace published scenario or persona snapshots with current DB edits", async () => {
    const scenario = { id: "s", title: "Published", personas: [{
      id: "p", name: "Frozen", _runtimeProfile: { communication_style: "차분하게" },
    }] };
    const deps: any = {
      storage: {
        getPersonaRun: vi.fn(async () => ({ personaId: "p", scenarioRunId: "sr", difficulty: 3 })),
        getScenarioRun: vi.fn(async () => ({ userId: "owner", scenarioId: "s", scenarioSnapshot: scenario })),
        getScenario: vi.fn(), getMbtiPersona: vi.fn(), getUser: vi.fn(async () => ({ preferredLanguage: "ko" })),
      }, fileManager: { getAllScenarios: vi.fn() }, ledgerRuntimeBinding: vi.fn(async () => null),
    };
    expect((await resolveTavusContext("owner", "run", deps)).context).toContain("차분하게");
    expect(deps.storage.getScenario).not.toHaveBeenCalled();
    expect(deps.storage.getMbtiPersona).not.toHaveBeenCalled();
  });

  it("keeps ledger-bound actor role and organization instructions instead of later run or authoring edits", async () => {
    const frozen = {
      id: "s", title: "Frozen negotiation", _overridePromptBlock: "Frozen organization instructions",
      personas: [{ id: "p", name: "Frozen actor", role: "Supplier",
        _runtimeProfile: { communication_style: "Calm", communication_patterns: { win_conditions: ["Protect quality"] } } }],
      evaluationHarness: { privateRubric: "Do not export this rubric" },
    };
    const original = structuredClone(frozen);
    const deps: any = {
      storage: {
        getPersonaRun: vi.fn(async () => ({ personaId: "p", scenarioRunId: "sr", difficulty: 3 })),
        getScenarioRun: vi.fn(async () => ({
          userId: "owner", scenarioId: "s",
          scenarioSnapshot: { ...frozen, _overridePromptBlock: "Later organization instructions", personas: [] },
        })),
        getScenario: vi.fn(), getMbtiPersona: vi.fn(),
        getUser: vi.fn(async () => ({ preferredLanguage: "ko" })),
      },
      fileManager: { getAllScenarios: vi.fn() },
      ledgerRuntimeBinding: vi.fn(async () => ({ scenarioSnapshot: frozen })),
    };
    const result = await resolveTavusContext("owner", "run", deps);
    expect(result.context).toContain('"role":"Supplier"');
    expect(result.context).toContain("Frozen organization instructions");
    expect(result.context).toContain("Protect quality");
    expect(result.context).not.toMatch(/Later organization|privateRubric|Do not export/);
    expect(deps.storage.getScenario).not.toHaveBeenCalled();
    expect(deps.storage.getMbtiPersona).not.toHaveBeenCalled();
    expect(deps.fileManager.getAllScenarios).not.toHaveBeenCalled();
    expect(frozen).toEqual(original);
  });
});

describe("Tavus transcript adapter", () => {
  const input = (transcript: unknown[]) => ({
    conversation_id: "c1", status: "ended",
    events: [{ event_type: "application.transcription_ready", properties: { transcript } }],
  });
  it("maps official roles and Unix-second times; preserves repeated utterances and event order", () => {
    const result = adaptTavusTranscript(input([
      { role: "system", content: "private system text", timestamp: 100 },
      { role: "assistant", content: "질문입니다.", timestamp: 101 },
      { role: "user", content: "네", timestamp: 102 },
      { role: "user", content: "네", timestamp: 103 },
      { role: "tool", content: "private tool result", timestamp: 104 },
    ]));
    expect(result).toEqual([
      { sender: "ai", message: "질문입니다.", timestamp: "1970-01-01T00:01:41.000Z" },
      { sender: "user", message: "네", timestamp: "1970-01-01T00:01:42.000Z" },
      { sender: "user", message: "네", timestamp: "1970-01-01T00:01:43.000Z" },
    ]);
    expect(transcriptIdentity("c1", 1)).toBe(transcriptIdentity("c1", 1));
    expect(transcriptIdentity("c1", 1)).not.toBe(transcriptIdentity("c1", 2));
  });
  it("does not evaluate an active session or assume a missing final transcript is empty", () => {
    expect(adaptTavusTranscript({ ...input([]), status: "active" })).toBeNull();
    expect(adaptTavusTranscript({ conversation_id: "c1", status: "ended", events: [] })).toBeNull();
  });
  it("fails explicitly on malformed transcripts", () => {
    expect(() => adaptTavusTranscript(input([{ role: "user", content: "missing time" }]))).toThrow("tavus_invalid_transcript");
  });
  it("ignores non-dialogue system/tool payloads even if their structure differs", () => {
    expect(adaptTavusTranscript(input([
      { role: "system", content: { private: "system state" } },
      { role: "tool", content: { result: "private" } },
      { role: "user", content: "안녕하세요", timestamp: 100 },
    ]))).toEqual([{ sender: "user", message: "안녕하세요", timestamp: "1970-01-01T00:01:40.000Z" }]);
  });
  it("supports explicit Tavus text-import provenance without claiming playback or STT verification", () => {
    expect(ledgerPayloadSchema.parse({
      kind: "utterance.register", utteranceId: transcriptIdentity("c1", 1),
      speaker: "user", mode: "text", personaId: "p", provider: "tavus",
    })).toMatchObject({ provider: "tavus", mode: "text" });
  });
});
