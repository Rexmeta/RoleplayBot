import { describe, expect, it } from "vitest";
import { createBrowserCaptionReader } from "../../client/src/components/chat/tavusBrowserCaptions";

const utterance = (overrides: Record<string, unknown> = {}, properties: Record<string, unknown> = {}) => ({
  message_type: "conversation", event_type: "conversation.utterance.streaming",
  conversation_id: "room-one", turn_idx: 1, inference_id: "inference-one", seq: 1,
  properties: { role: "pal", speech: "안녕하세요", ...properties }, ...overrides,
});
describe("display-only browser captions", () => {
  it("updates cumulative streaming text in the same row and deduplicates pal/replica aliases", () => {
    const reader = createBrowserCaptionReader();
    const first = reader.appMessage(utterance(), 1000)!;
    const second = reader.appMessage(utterance({ seq: 2 }, { speech: "안녕하세요. 반갑습니다" }), 2000)!;
    expect(second).toMatchObject({ id: first.id, message: "안녕하세요. 반갑습니다", sender: "ai", timestamp: first.timestamp });
    expect(reader.appMessage(utterance({ seq: 2 }, { role: "replica", speech: second.message }), 2001)).toBeNull();
  });
  it("accepts delayed complete turns, keeps user and AI separate, and never exposes provider resource IDs", () => {
    const reader = createBrowserCaptionReader();
    const ai = reader.appMessage(utterance({ event_type: "conversation.utterance" }))!;
    const user = reader.appMessage(utterance({ event_type: "conversation.utterance", seq: 2 }, { role: "user", speech: "네" }))!;
    expect(user.sender).toBe("user");
    expect(user.id).not.toBe(ai.id);
    expect(JSON.stringify(user)).not.toContain("room-one");
    expect(JSON.stringify(user)).not.toContain("inference-one");
  });
  it("ignores out-of-order partials and does not replace a completed turn with a late partial", () => {
    const reader = createBrowserCaptionReader();
    reader.appMessage(utterance({ seq: 3 }, { speech: "안녕하세요. 반갑습니다" }));
    expect(reader.appMessage(utterance({ seq: 2 }))).toBeNull();
    reader.appMessage(utterance({ seq: 4, event_type: "conversation.utterance" }, { speech: "전체 답변" }));
    expect(reader.appMessage(utterance({ seq: 5 }, { speech: "뒤늦은 일부" }))).toBeNull();
  });
  it("marks interrupted turns and never expands a known interrupted partial to an unspoken full response", () => {
    const reader = createBrowserCaptionReader();
    const partial = reader.appMessage(utterance())!;
    expect(reader.appMessage(utterance({ seq: 2, event_type: "conversation.replica.interrupted", properties: {} })))
      .toMatchObject({ id: partial.id, interrupted: true, message: partial.message });
    expect(reader.appMessage(utterance({ seq: 3, event_type: "conversation.utterance" }, { speech: "안녕하세요. 아직 말하지 않은 긴 문장입니다." }))).toBeNull();
  });
  it("handles interruption flags on streaming text itself", () => {
    const reader = createBrowserCaptionReader();
    expect(reader.appMessage(utterance({}, { is_interrupted: true }))).toMatchObject({ interrupted: true });
  });
  it("keeps repeated words in distinct identified turns", () => {
    const reader = createBrowserCaptionReader();
    const first = reader.appMessage(utterance({}, { role: "user", speech: "네" }), 1000)!;
    const second = reader.appMessage(utterance({ turn_idx: 2, inference_id: "another", seq: 3 }, { role: "user", speech: "네" }), 1200)!;
    expect(second.id).not.toBe(first.id);
  });
  it("supports legacy content payloads and stringified packets", () => {
    const reader = createBrowserCaptionReader();
    const payload = { event_type: "conversation.utterance", properties: { role: "user", content: "일정 확인 부탁드립니다" } };
    expect(reader.appMessage(JSON.stringify(payload), 1000)).toMatchObject({ sender: "user", message: "일정 확인 부탁드립니다" });
    expect(reader.appMessage(payload, 1001)).toBeNull();
    expect(reader.appMessage(payload, 3000)).not.toBeNull();
  });
  it("binds a reader to one room and accepts no cross-room updates", () => {
    const reader = createBrowserCaptionReader();
    reader.appMessage(utterance());
    expect(reader.appMessage(utterance({ conversation_id: "another-room", seq: 2 }))).toBeNull();
  });
  it("does not treat tool/system/perception payloads, malformed JSON, or large text as conversation", () => {
    const reader = createBrowserCaptionReader();
    for (const input of [
      null, "not-json", [], utterance({}, { role: "system" }), utterance({}, { role: "tool" }),
      utterance({ event_type: "conversation.perception_analysis" }),
      utterance({}, { speech: "x".repeat(10001) }), utterance({}, { speech: "" }),
      utterance({ message_type: "other" }), "x".repeat(40001),
    ]) expect(reader.appMessage(input)).toBeNull();
  });
  it("uses optional Daily final STT events without starting transcription or duplicating provider captions", () => {
    const reader = createBrowserCaptionReader();
    expect(reader.dailyTranscription({ text: "미완성", rawResponse: { is_final: false } }, "user")).toBeNull();
    const daily = reader.dailyTranscription({ text: "안녕하세요", timestamp: new Date(1000) }, "ai", 1000)!;
    expect(reader.appMessage(utterance(), 1100)).toBeNull();
    const expanded = reader.appMessage(utterance({ seq: 2 }, { speech: "안녕하세요. 반갑습니다" }), 1500)!;
    expect(expanded).toMatchObject({ id: daily.id, message: "안녕하세요. 반갑습니다" });
    expect(reader.appMessage(utterance({ event_type: "conversation.utterance", seq: 3 }, { speech: "안녕하세요. 반갑습니다" }), 1600)).toBeNull();
  });
});
