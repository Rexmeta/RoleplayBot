import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  apply: vi.fn(), read: vi.fn(), enqueue: vi.fn(), update: vi.fn(), complete: vi.fn(),
}));
vi.mock("../../server/storage", () => ({
  db: {}, storage: { updatePersonaRun: mocks.update },
}));
vi.mock("../../server/services/conversationLedger/service", () => ({
  applyLedgerCommand: mocks.apply, readLedgerProjection: mocks.read,
}));
vi.mock("../../server/services/conversationLedger/transcript", () => ({
  usesLedger: (run: any) => run?.transcriptProtocol === "ledger-v1",
}));
vi.mock("../../server/services/feedbackGenerationService", () => ({ enqueueFeedbackJob: mocks.enqueue }));
vi.mock("../../server/routes/routerHelpers", () => ({ checkAndCompleteScenario: mocks.complete }));
import { importTavusTranscript } from "../../server/services/tavus/importTranscript";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue({ version: "ledger-v1", generation: 3, utterances: [] });
  mocks.apply.mockResolvedValue({});
  mocks.enqueue.mockResolvedValue({ status: "queued" });
});
const binding: any = {
  run: { id: "run", scenarioRunId: "srun", personaId: "actor", transcriptProtocol: "ledger-v1" },
  scenario: { id: "scenario" }, persona: { id: "actor" }, language: "ko",
  evaluationHarnessSnapshot: { rubric: "bound" },
};
const messages: any = [
  { sender: "ai", message: "무엇이 문제인가요?", timestamp: "2026-11-04T01:00:00.000Z" },
  { sender: "user", message: "납기가 촉박합니다.", timestamp: "2026-11-04T01:00:03.000Z" },
];

describe("Tavus final transcript to existing evaluation", () => {
  it.each(["anam", "tavus"] as const)("keeps %s provenance through ledger finality and durable feedback", async provider => {
    const provenance = { provider, projectId: "project", sessionId: "router-session", revision: "a".repeat(64) };
    await importTavusTranscript(binding, "router-session", messages, provenance);
    expect(mocks.apply.mock.calls[0][1].payload).toMatchObject({ provider, mode: "text" });
    expect(mocks.apply.mock.calls[1][1].payload.metadata).toEqual({
      sourceTimestamp: messages[0].timestamp, routerTranscript: provenance,
    });
    expect(mocks.enqueue.mock.calls[0][0].conversation.transcriptSource).toMatchObject({
      provider, projectId: "project", routerSessionId: "router-session", revision: "a".repeat(64),
    });
  });
  it("separates Anam IDs across projects and runs without changing old Tavus identities", async () => {
    const provenance = { provider: "anam" as const, projectId: "one", sessionId: "same-session", revision: "a".repeat(64) };
    await importTavusTranscript(binding, "same-session", messages, provenance);
    const first = mocks.apply.mock.calls[0][1].payload.utteranceId;
    mocks.apply.mockClear();
    await importTavusTranscript(binding, "same-session", messages, { ...provenance, projectId: "two" });
    expect(mocks.apply.mock.calls[0][1].payload.utteranceId).not.toBe(first);
    mocks.apply.mockClear();
    await importTavusTranscript({ ...binding, run: { ...binding.run, id: "other-run" } }, "same-session", messages, provenance);
    expect(mocks.apply.mock.calls[0][1].payload.utteranceId).not.toBe(first);
  });
  it("rejects records from a different provider before writing an Anam transcript", async () => {
    mocks.read.mockResolvedValue({ version: "ledger-v1", generation: 3, utterances: [{ provider: "tavus" }] });
    await expect(importTavusTranscript(binding, "room", messages, {
      provider: "anam", projectId: "project", sessionId: "room", revision: "a".repeat(64),
    })).rejects.toMatchObject({ code: "tavus_mixed_transcript" });
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("accepts identical Anam retries after JSONB reorders provenance keys, but rejects another session", async () => {
    const provenance = { provider: "anam" as const, projectId: "project", sessionId: "room", revision: "a".repeat(64) };
    await importTavusTranscript(binding, "room", messages, provenance);
    const id = mocks.apply.mock.calls[0][1].payload.utteranceId;
    const reordered = { revision: provenance.revision, sessionId: "room", projectId: "project", provider: "anam" };
    mocks.read.mockResolvedValue({ version: "ledger-v1", generation: 3,
      utterances: [{ id, provider: "anam", metadata: { routerTranscript: reordered } }] });
    await expect(importTavusTranscript(binding, "room", messages, provenance)).resolves.toBeUndefined();
    reordered.sessionId = "other";
    await expect(importTavusTranscript(binding, "room", messages, provenance))
      .rejects.toMatchObject({ code: "tavus_mixed_transcript" });
  });
  it("imports text with provider provenance and original timestamps before closing and enqueueing", async () => {
    await importTavusTranscript(binding, "provider-room", messages);
    const commands = mocks.apply.mock.calls.map(call => call[1]);
    expect(commands.map(command => command.payload.kind)).toEqual([
      "utterance.register", "provider.final", "utterance.register", "provider.final", "session.close",
    ]);
    expect(commands[0].payload).toMatchObject({
      provider: "tavus", mode: "text", speaker: "ai", personaId: "actor",
      providerResponseId: "provider-room:0",
    });
    expect(commands[1].payload.metadata).toEqual({ sourceTimestamp: messages[0].timestamp });
    expect(commands.every(command => command.generation === 3)).toBe(true);
    expect(mocks.apply.mock.calls.every(call => call[2] === "server")).toBe(true);
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: "run", scenario: binding.scenario, persona: binding.persona,
      evaluationHarnessSnapshot: binding.evaluationHarnessSnapshot,
      conversation: expect.objectContaining({
        mode: "realtime_voice", messages,
        transcriptSource: { provider: "tavus", conversationId: "provider-room", kind: "final_transcript" },
      }),
    }));
    expect(mocks.update).toHaveBeenCalledWith("run", expect.objectContaining({ status: "completed", turnCount: 1 }));
    expect(mocks.complete).toHaveBeenCalledWith("srun");
  });

  it("uses stable command IDs across retries without asserting playback/STT observations", async () => {
    await importTavusTranscript(binding, "provider-room", messages);
    const first = mocks.apply.mock.calls.map(call => call[1]);
    mocks.apply.mockClear();
    await importTavusTranscript(binding, "provider-room", messages);
    expect(mocks.apply.mock.calls.map(call => call[1])).toEqual(first);
    expect(first.some(command => /playback|recognition/.test(command.payload.kind))).toBe(false);
  });

  it("never mixes preexisting Gemini evidence into an imported Tavus session", async () => {
    mocks.read.mockResolvedValue({ version: "ledger-v1", generation: 3,
      utterances: [{ provider: "gemini" }] });
    await expect(importTavusTranscript(binding, "provider-room", messages)).rejects.toMatchObject({ code: "tavus_mixed_transcript" });
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("does not complete a run when queueing its report fails", async () => {
    mocks.enqueue.mockRejectedValue(new Error("queue unavailable"));
    await expect(importTavusTranscript(binding, "provider-room", messages)).rejects.toThrow("queue unavailable");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it.each(["error", "expired"])("does not advertise completion when durable enqueue returns %s", async status => {
    mocks.enqueue.mockResolvedValue({ status });
    await expect(importTavusTranscript(binding, "provider-room", messages))
      .rejects.toMatchObject({ code: "tavus_feedback_enqueue_failed" });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it.each(["generating", "completed"])("reuses a durable report already %s without another evaluation path", async status => {
    mocks.enqueue.mockResolvedValue({ status });
    await importTavusTranscript(binding, "provider-room", messages);
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith("run", expect.objectContaining({ status: "completed" }));
  });
  it("retains AI-only final history without inventing learner evaluation", async () => {
    await importTavusTranscript(binding, "provider-room", [messages[0]]);
    expect(mocks.apply).toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith("run", expect.objectContaining({ status: "completed", turnCount: 0 }));
  });
});
