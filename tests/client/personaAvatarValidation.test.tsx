// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PersonaAvatarValidationPanel } from "../../client/src/components/admin/PersonaAvatarValidationPanel";
const mocks = vi.hoisted(() => ({ api: vi.fn(), state: {} as any, hook: vi.fn() }));
vi.mock("../../client/src/lib/queryClient", () => ({ apiRequest: mocks.api }));
vi.mock("../../client/src/components/admin/avatarTest/useAdminAvatarTest", () => ({
  useAdminAvatarTest: (endpoint: string) => { mocks.hook(endpoint); return mocks.state; },
}));
vi.mock("../../client/src/components/admin/avatarTest/AvatarTestPreflightView", () => ({
  AvatarTestHeader: () => null, AvatarTestPreflightView: () => null,
}));
vi.mock("../../client/src/components/admin/avatarTest/AvatarTestSessionView", () => ({
  AvatarTestSessionView: ({ test }: any) => <div ref={test.videoHost}><video /></div>,
}));
const assetId = "12345678-1234-4234-8234-123456789abc";
const sessionId = "32345678-1234-4234-8234-123456789abc";
let frame: (() => void) | undefined;
let originalFrameCallback: PropertyDescriptor | undefined;
beforeEach(() => {
  mocks.api.mockReset(); mocks.hook.mockClear(); frame = undefined;
  originalFrameCallback = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, "requestVideoFrameCallback");
  Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", {
    configurable: true, value: vi.fn((callback) => { frame = callback; return 1; }),
  });
  mocks.state = {
    session: { id: sessionId, status: "active", rendererState: "running", cleanupPending: false, stopRequested: false,
      expiresAt: "2099-01-01T00:00:00Z" },
    mediaConnected: true, audioPlaybackReady: true, videoTrack: {}, videoHost: { current: null },
    stopped: false, stopping: false, pollFailed: false, conversation: [], turnBusy: false,
  };
});
afterEach(() => {
  cleanup();
  if (originalFrameCallback) Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", originalFrameCallback);
  else delete (HTMLVideoElement.prototype as any).requestVideoFrameCallback;
});
const button = () => screen.getByRole("button", { name: "재생 확인 보고" }) as HTMLButtonElement;
const component = (onReported = vi.fn()) => <PersonaAvatarValidationPanel assetId={assetId} assetName="커스텀 인물" onReported={onReported} />;

describe("manual playback report evidence", () => {
  it("does not treat track subscription or audio readiness as observed playback", () => {
    render(component());
    expect(mocks.hook).toHaveBeenCalledWith(`/api/admin/personas/live-avatar/assets/${assetId}/validation`);
    expect(button().disabled).toBe(true);
    expect(mocks.api).not.toHaveBeenCalled();
  });
  it("requires actual frames, a successful turn and two explicit confirmations, then reports manually", async () => {
    const reported = vi.fn();
    mocks.api.mockResolvedValue({});
    const view = render(component(reported));
    expect(frame).toBeTypeOf("function");
    act(() => frame?.());
    expect(button().disabled).toBe(true);
    mocks.state = { ...mocks.state, conversation: [{ role: "assistant", content: "실제 테스트 응답" }] };
    view.rerender(component(reported));
    expect(button().disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("영상이 실제로 재생되는 것을 직접 확인했습니다."));
    fireEvent.click(screen.getByLabelText("테스트 응답의 음성을 실제로 들었습니다."));
    expect(button().disabled).toBe(false);
    expect(mocks.api).not.toHaveBeenCalled();
    fireEvent.click(button());
    await waitFor(() => expect(reported).toHaveBeenCalledTimes(1));
    expect(mocks.api).toHaveBeenCalledExactlyOnceWith("POST",
      `/api/admin/personas/live-avatar/assets/${assetId}/validation/report`,
      { sessionId, videoObserved: true, audioObserved: true });
  });
  it("discards all prior evidence on reconnection and session change", () => {
    const view = render(component());
    act(() => frame?.());
    mocks.state = { ...mocks.state, conversation: [{ role: "assistant", content: "응답" }] };
    view.rerender(component());
    for (const checkbox of screen.getAllByRole("checkbox")) fireEvent.click(checkbox);
    expect(button().disabled).toBe(false);
    mocks.state = { ...mocks.state, mediaConnected: false };
    view.rerender(component());
    expect(button().disabled).toBe(true);
    mocks.state = { ...mocks.state, mediaConnected: true };
    view.rerender(component());
    expect(button().disabled).toBe(true);
    act(() => frame?.());
    for (const checkbox of screen.getAllByRole("checkbox")) fireEvent.click(checkbox);
    expect(button().disabled).toBe(true); // A new successful turn is required after reconnect.
    mocks.state = { ...mocks.state, session: { ...mocks.state.session, id: assetId } };
    view.rerender(component());
    expect(button().disabled).toBe(true);
    expect(mocks.api).not.toHaveBeenCalled();
  });
});
