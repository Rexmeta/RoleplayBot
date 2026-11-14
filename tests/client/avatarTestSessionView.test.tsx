// @vitest-environment happy-dom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AvatarTestSessionView } from "../../client/src/components/admin/avatarTest/AvatarTestSessionView";

vi.mock("../../client/src/components/chat/AvatarSessionTiming", () => ({
  AvatarSessionTiming: () => <div />,
}));

afterEach(cleanup);

const createTestState = (patch: Record<string, unknown> = {}) => ({
  session: { status: "active", timing: {}, cleanupPending: false, rendererState: "running" },
  mediaConnected: true,
  ready: true,
  audioConfirmed: true,
  turnBusy: false,
  stopping: false,
  recording: false,
  micPending: false,
  message: "  hello there  ",
  setMessage: vi.fn(),
  sendTurn: vi.fn(),
  videoHost: vi.fn(),
  audioHost: vi.fn(),
  videoTrack: null,
  connecting: false,
  pollFailed: false,
  audioBlocked: false,
  startAudio: vi.fn(),
  retryConnection: vi.fn(),
  stopped: false,
  terminal: false,
  stopSession: vi.fn(),
  timingReportFailed: false,
  conversation: [],
  toggleRecording: vi.fn(),
  ...patch,
}) as any;

const renderInsidePersonaForm = (testState = createTestState()) => {
  const parentSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
  const result = render(
    <form onSubmit={parentSubmit}>
      <AvatarTestSessionView test={testState} />
      <button type="submit">Save persona</button>
    </form>,
  );
  return { ...result, parentSubmit, testState };
};

describe("AvatarTestSessionView composer", () => {
  it("sends once from the button without submitting the enclosing persona form", () => {
    const { parentSubmit, testState, container } = renderInsidePersonaForm();
    expect(container.querySelectorAll("form")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "텍스트 전송" }));

    expect(testState.sendTurn).toHaveBeenCalledTimes(1);
    expect(testState.sendTurn).toHaveBeenCalledWith({ text: "hello there", history: [] });
    expect(parentSubmit).not.toHaveBeenCalled();
  });

  it("sends once on Enter and prevents the enclosing form submit", () => {
    const { parentSubmit, testState } = renderInsidePersonaForm();
    const input = screen.getByPlaceholderText("테스트할 말을 입력하세요");

    const event = fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(event).toBe(false);
    expect(testState.sendTurn).toHaveBeenCalledTimes(1);
    expect(testState.sendTurn).toHaveBeenCalledWith({ text: "hello there", history: [] });
    expect(parentSubmit).not.toHaveBeenCalled();
  });

  it("does not send blank text or send while the input is disabled", () => {
    const blank = createTestState({ message: "   " });
    const blankView = renderInsidePersonaForm(blank);
    expect((screen.getByRole("button", { name: "텍스트 전송" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "텍스트 전송" }));
    expect(blank.sendTurn).not.toHaveBeenCalled();
    blankView.unmount();

    const disabled = createTestState({ mediaConnected: false });
    renderInsidePersonaForm(disabled);
    expect((screen.getByRole("button", { name: "텍스트 전송" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByPlaceholderText("테스트할 말을 입력하세요") as HTMLInputElement).disabled).toBe(true);
    expect(disabled.sendTurn).not.toHaveBeenCalled();
  });

  it("does not send Enter during IME composition", () => {
    const { parentSubmit, testState } = renderInsidePersonaForm();
    const input = screen.getByPlaceholderText("테스트할 말을 입력하세요");

    fireEvent.keyDown(input, { key: "Enter", code: "Enter", isComposing: true, keyCode: 229 });

    expect(testState.sendTurn).not.toHaveBeenCalled();
    expect(parentSubmit).not.toHaveBeenCalled();
  });
});
