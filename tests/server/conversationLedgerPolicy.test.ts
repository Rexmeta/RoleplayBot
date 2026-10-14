import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ledgerCommandSchema } from "../../shared/conversationLedger";
import type { LedgerRun, LedgerUtterance } from "../../shared/schema/conversationLedger";
import { transitionUtterance, snapshotBlockers } from "../../server/services/conversationLedger/policy";

function voice(overrides: Partial<LedgerUtterance> = {}): LedgerUtterance {
  return {
    id: randomUUID(), personaRunId: "run", sequence: 1, updatedSequence: 1,
    revision: 1, generation: 0, speaker: "user", mode: "voice", personaId: "persona",
    responseTo: null, provider: "gemini", providerEventId: null, providerResponseId: null,
    captureGeneration: 1, captureSequence: 1, captureState: "committed", captureReason: null,
    providerState: "pending", recognitionState: "pending", recognitionSource: null, playbackState: "not_required",
    providerText: "", candidateText: null, canonicalText: null, reason: null,
    metadata: {}, createdAt: new Date(),
    ...overrides,
  };
}
const run = { status: "closed", captureGaps: 0 } as LedgerRun;

describe("ledger independent evidence states", () => {
  it("rejects audio and unknown metadata rather than persisting raw sound", () => {
    expect(ledgerCommandSchema.safeParse({
      eventId: randomUUID(), generation: 0,
      payload: { kind: "capture.commit", utteranceId: randomUUID(), audio: "PCM" },
    }).success).toBe(false);
  });
  it("provider finality alone never verifies Korean recognition", () => {
    const row = voice();
    const next = transitionUtterance(row, { kind: "provider.final", utteranceId: row.id, text: "안녕하세요." });
    expect(next.providerState).toBe("final");
    expect(next.recognitionState).toBe("pending");
    expect(next.canonicalText).toBeNull();
  });
  it.each(["stt_first", "provider_first"])("converges regardless of evidence order: %s", order => {
    let row = voice();
    const final = { kind: "provider.final" as const, utteranceId: row.id, text: "안녕하세요." };
    const stt = { kind: "recognition.stt" as const, utteranceId: row.id, text: "안녕 하세요." };
    for (const event of order === "stt_first" ? [stt, final] : [final, stt]) row = transitionUtterance(row, event);
    expect(row.recognitionState).toBe("verified");
    expect(row.canonicalText).toBe("안녕 하세요.");
  });
  it("does not ignore punctuation differences", () => {
    const row = voice({ providerState: "final", providerText: "안녕하세요." });
    expect(transitionUtterance(row, {
      kind: "recognition.stt", utteranceId: row.id, text: "안녕하세요",
    }).recognitionState).toBe("needs_confirmation");
  });
  it("does not clear disabled/failed STT holds on late provider completion", () => {
    let row = voice({ candidateText: "안녕하세요.", reason: "stt_disabled", recognitionState: "needs_confirmation" });
    row = transitionUtterance(row, { kind: "provider.final", utteranceId: row.id, text: "안녕하세요." });
    expect(row.reason).toBe("stt_disabled");
    expect(row.canonicalText).toBeNull();
  });
  it("user confirmation survives late STT and provider completion", () => {
    let row = voice();
    row = transitionUtterance(row, { kind: "recognition.confirm", utteranceId: row.id, text: "실제 내용", expectedRevision: 1 });
    row = transitionUtterance(row, { kind: "recognition.stt", utteranceId: row.id, text: "다른 내용" });
    row = transitionUtterance(row, { kind: "provider.final", utteranceId: row.id, text: "Live 원문" });
    expect(row.canonicalText).toBe("실제 내용");
    expect(row.providerText).toBe("Live 원문");
    expect(row.recognitionState).toBe("confirmed");
  });
  it("does not turn forced interruption into immutable provider finality", () => {
    let row = voice();
    row = transitionUtterance(row, { kind: "provider.interrupted", utteranceId: row.id, text: "안녕" });
    expect(row.providerState).toBe("interrupted");
    row = transitionUtterance(row, { kind: "provider.final", utteranceId: row.id, text: "안녕하세요." });
    expect(row.providerText).toBe("안녕하세요.");
    expect(() => transitionUtterance(row, {
      kind: "provider.final", utteranceId: row.id, text: "다른 원문",
    })).toThrow("final_text_immutable");
  });
  it("confirmation cannot conceal capture gaps or missing speech", () => {
    const row = voice({ captureState: "gap", captureReason: "connection_lost", recognitionState: "confirmed", canonicalText: "확인" });
    expect(snapshotBlockers(run, [row])).toContain(`${row.id}:capture_gap`);
    expect(snapshotBlockers({ ...run, captureGaps: 1 }, [row])).toContain("capture_sequence_gap");
  });
  it("generated AI voice is not treated as playback-observed", () => {
    const row = voice({
      speaker: "ai", providerState: "final", providerText: "응답", canonicalText: "응답",
      captureState: "not_required", recognitionState: "not_required", playbackState: "not_observed",
    });
    expect(snapshotBlockers(run, [row])).toContain(`${row.id}:playback_not_observed`);
    const next = transitionUtterance(row, { kind: "playback.observed", utteranceId: row.id, state: "completed" });
    expect(snapshotBlockers(run, [next])).not.toContain(`${row.id}:playback_not_observed`);
  });
  it("does not apply Korean confirmation policy to other languages", () => {
    const row = voice({ recognitionState: "not_required" });
    const next = transitionUtterance(row, { kind: "provider.final", utteranceId: row.id, text: "Hello." });
    expect(next.canonicalText).toBe("Hello.");
    expect(() => transitionUtterance(next, {
      kind: "recognition.confirm", utteranceId: row.id, text: "Hello.", expectedRevision: 1,
    })).toThrow("recognition_not_applicable");
  });
});
