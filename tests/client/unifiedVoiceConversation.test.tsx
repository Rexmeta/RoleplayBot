// @vitest-environment happy-dom
import React, { useEffect } from "react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import TavusConversationLayout, { type TavusConversationLayoutProps } from "../../client/src/components/chat/TavusConversationLayout";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
    i18n: { language: "en" },
  }),
}));
vi.mock("../../client/src/components/chat/RecognitionReview", () => ({
  RecognitionReview: () => null,
  useRecognitionEvidence: () => ({ data: undefined }),
}));
const props: TavusConversationLayoutProps = {
  scenario: { id: "s", title: "Scenario", description: "", personas: [] } as any,
  persona: { id: "p", name: "Mina", role: "Manager" } as any,
  statusLabel: "Conversation live", active: true, elapsedSeconds: 17, remainingSeconds: 103,
  headerActions: <button>End conversation</button>, stage: <div data-testid="video-stage" />,
  sessionControls: <button data-testid="real-session-start">Consent and start</button>,
  history: <p>Confirmed history</p>, transcriptMessages: [],
  captionsAreProvisional: true, hasCaptionEvents: false,
};
beforeEach(() => {
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function () { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function () { this.open = false; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("shared voice and live-avatar conversation experience", () => {
  it("shows the assigned scenario name rather than the reusable avatar's persona ID", () => {
    const { rerender } = render(<TavusConversationLayout {...props}
      persona={{ ...props.persona, id: "entj", name: "김 팀장", liveAvatar: { name: "entj" } } as any} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("김 팀장");
    rerender(<TavusConversationLayout {...props}
      persona={{ ...props.persona, id: "entj", name: "박 부장", liveAvatar: { name: "entj" } } as any} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("박 부장");
    expect(screen.queryByText("entj")).toBeNull();
  });
  it("uses the same header/control primitives as the existing voice screen", () => {
    const standard = readFileSync("client/src/components/ChatWindow.tsx", "utf8");
    const live = readFileSync("client/src/components/chat/TavusConversationLayout.tsx", "utf8");
    expect(standard).toContain("<VoiceOverlayHeader");
    expect(standard).toContain('? VoiceControlSurface : Card');
    expect(live).toContain("<VoiceOverlayHeader");
    expect(live).toContain("<VoiceControlSurface");
    render(<TavusConversationLayout {...props} />);
    expect(screen.getByTestId("elapsed-time").textContent).toBe("0:17");
    expect(screen.getByTestId("remaining-time").textContent).toBe("1:43");
    expect(screen.getByTestId("tavus-control-surface").className).toContain("bg-[#ffffff9c]");
  });

  it("keeps real media and session controls mounted while settings are opened and closed", async () => {
    const mounted = vi.fn();
    const unmounted = vi.fn();
    function Stage() {
      useEffect(() => { mounted(); return unmounted; }, []);
      return <div data-testid="actual-live-stage" />;
    }
    render(<TavusConversationLayout {...props} stage={<Stage />} />);
    const dialog = screen.getByTestId("live-avatar-options-dialog") as HTMLDialogElement;
    expect(dialog.open).toBe(false);
    const control = screen.getByTestId("real-session-start");
    fireEvent.click(screen.getByTestId("button-open-live-avatar-settings"));
    await waitFor(() => expect(dialog.open).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    await waitFor(() => expect(dialog.open).toBe(false));
    fireEvent.click(screen.getByTestId("button-open-live-avatar-settings"));
    await waitFor(() => expect(dialog.open).toBe(true));
    expect(screen.getByTestId("real-session-start")).toBe(control);
    expect(mounted).toHaveBeenCalledOnce();
    expect(unmounted).not.toHaveBeenCalled();
  });

  it("keeps optional modes quiet, allows text before start and disables switching during paid playback", async () => {
    const exit = vi.fn();
    const view = render(<TavusConversationLayout {...props} active={false} onExitMode={exit} />);
    expect(screen.queryByTestId("panel-conversation-mode-menu")).toBeNull();
    fireEvent.click(screen.getByTestId("button-conversation-mode-menu"));
    fireEvent.click(await screen.findByTestId("button-conversation-mode-text"));
    expect(exit).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenLastCalledWith("text");
    fireEvent.click(screen.getByTestId("button-conversation-mode-menu"));
    expect(screen.queryByTestId("button-conversation-mode-live-avatar")).toBeNull();
    fireEvent.click(await screen.findByTestId("button-conversation-mode-voice"));
    expect(exit).toHaveBeenLastCalledWith("realtime-voice");
    view.rerender(<TavusConversationLayout {...props} />);
    fireEvent.click(screen.getByTestId("button-conversation-mode-menu"));
    expect((await screen.findByTestId("button-conversation-mode-text") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("button-conversation-mode-live-avatar")).toBeNull();
    expect((screen.getByTestId("button-conversation-mode-voice") as HTMLButtonElement).disabled).toBe(true);
  });

  it("opens real errors for attention without interrupting the live stage", async () => {
    const view = render(<TavusConversationLayout {...props} requiresAttention />);
    const dialog = screen.getByTestId("live-avatar-options-dialog") as HTMLDialogElement;
    await waitFor(() => expect(dialog.open).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    await waitFor(() => expect(dialog.open).toBe(false));
    view.rerender(<TavusConversationLayout {...props} requiresAttention />);
    expect(dialog.open).toBe(false);
    expect(screen.getByTestId("video-stage")).toBeTruthy();
    view.rerender(<TavusConversationLayout {...props} requiresAttention={false} />);
    view.rerender(<TavusConversationLayout {...props} requiresAttention />);
    await waitFor(() => expect(dialog.open).toBe(true));
  });

  it("puts provisional-caption warnings inside the shared transcript, not over the portrait", () => {
    const view = render(<TavusConversationLayout {...props} />);
    expect(screen.getByTestId("transcript-panel").contains(screen.getByTestId("live-captions-notice"))).toBe(true);
    view.rerender(<TavusConversationLayout {...props} captionsAreProvisional={false} />);
    expect(screen.queryByTestId("live-captions-notice")).toBeNull();
  });
});
