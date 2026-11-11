// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { useVoiceRecording } from "../../client/src/hooks/chat/useVoiceRecording";
import { ConversationLanguageNotice } from "../../client/src/components/chat/ConversationLanguageNotice";
import type { ConversationLanguage } from "../../shared/conversationLanguage";

const mocks = vi.hoisted(() => ({
  i18n: { language: "en", resolvedLanguage: "en" },
  toast: vi.fn(), t: (key: string) => key,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: mocks.i18n, t: mocks.t }) }));
vi.mock("../../client/src/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

class Recognition {
  static instances: Recognition[] = [];
  lang = "";
  onstart: any; onresult: any; onerror: any; onend: any;
  start = vi.fn(); stop = vi.fn(); abort = vi.fn();
  constructor() { Recognition.instances.push(this); }
}
afterEach(() => {
  cleanup();
  Recognition.instances = [];
  mocks.i18n.language = mocks.i18n.resolvedLanguage = "en";
  vi.unstubAllGlobals();
});
describe("server-owned browser input language", () => {
  it.each([["ko", "ko-KR"], ["en", "en-US"], ["ja", "ja-JP"], ["zh", "zh-CN"]] as const)(
    "recognizes %s even when the screen language differs", (language, locale) => {
      vi.stubGlobal("SpeechRecognition", Recognition);
      renderHook(() => useVoiceRecording({ language, onTranscript: vi.fn(), onInterimTranscript: vi.fn() }));
      expect(Recognition.instances.at(-1)?.lang).toBe(locale);
    });
  it("waits for the server language, preserves it across UI changes, and aborts stale input on run changes", () => {
    vi.stubGlobal("SpeechRecognition", Recognition);
    const onTranscript = vi.fn();
    const hook = renderHook(({ language }: { language?: ConversationLanguage }) =>
      useVoiceRecording({ language, onTranscript, onInterimTranscript: vi.fn() }), { initialProps: { language: undefined } as { language?: ConversationLanguage } });
    act(() => hook.result.current.startRecording());
    expect(Recognition.instances.at(-1)?.start).not.toHaveBeenCalled();
    hook.rerender({ language: "ja" });
    const old = Recognition.instances.at(-1)!;
    const staleResult = old.onresult;
    mocks.i18n.language = mocks.i18n.resolvedLanguage = "zh";
    hook.rerender({ language: "ja" });
    expect(Recognition.instances.at(-1)).toBe(old);
    expect(old.abort).not.toHaveBeenCalled();
    hook.rerender({ language: "en" });
    expect(old.abort).toHaveBeenCalledOnce();
    expect(old.onresult).toBeNull();
    expect(Recognition.instances.at(-1)?.lang).toBe("en-US");
    expect(staleResult).toBeTypeOf("function");
    act(() => staleResult({ results: [{ 0: { transcript: "stale text" }, isFinal: true }] }));
    expect(onTranscript).not.toHaveBeenCalled();
  });
  it("explains that a profile change applies to new conversations", () => {
    const view = render(<ConversationLanguageNotice language="ko" />);
    expect(screen.getByRole("status").textContent).toContain("new conversations");
    view.rerender(<ConversationLanguageNotice language="en" />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
