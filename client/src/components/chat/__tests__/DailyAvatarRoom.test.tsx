// @vitest-environment happy-dom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { createCallObjectMock, callMock } = vi.hoisted(() => {
  const handlers: Record<string, (event?: any) => void> = {};
  const call = {
    on: vi.fn((event: string, handler: (event?: any) => void) => { handlers[event] = handler; }),
    join: vi.fn(() => Promise.resolve()),
    leave: vi.fn(() => Promise.resolve()),
    destroy: vi.fn(() => Promise.resolve()),
    participants: vi.fn(() => ({ local: { local: true }, remote: { session_id: "remote", local: false, tracks: {} } })),
  };
  return { createCallObjectMock: vi.fn(() => call), callMock: call };
});
vi.mock("@daily-co/daily-js", () => ({ default: { createCallObject: createCallObjectMock } }));

import DailyAvatarRoom from "../DailyAvatarRoom";

const connection = { transport: "daily" as const, pipeline: "tavus_full" as const, url: "https://daily.example/room", token: "temporary" };
const originalPlay = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "play");
const originalSrcObject = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "srcObject");
afterEach(() => {
  vi.clearAllMocks();
  if (originalPlay) Object.defineProperty(HTMLMediaElement.prototype, "play", originalPlay);
  if (originalSrcObject) Object.defineProperty(HTMLMediaElement.prototype, "srcObject", originalSrcObject);
});

describe("DailyAvatarRoom", () => {
  it("joins with microphone enabled and camera disabled, then leaves and destroys on unmount", async () => {
    const view = render(<DailyAvatarRoom connection={connection} />);
    await waitFor(() => expect(callMock.join).toHaveBeenCalledWith({
      url: connection.url, token: connection.token, audioSource: true, videoSource: false,
    }));
    act(() => {
      const handler = callMock.on.mock.calls.find(([name]) => name === "joined-meeting")?.[1];
      handler?.({});
    });
    expect(screen.queryByTestId("daily-joining")).toBeNull();
    view.unmount();
    await waitFor(() => {
      expect(callMock.leave).toHaveBeenCalledTimes(1);
      expect(callMock.destroy).toHaveBeenCalledTimes(1);
    });
  });

  it("waits for an in-flight join before ensuring cleanup and surfaces blocked playback with retry", async () => {
    let resolveJoin!: () => void;
    callMock.join.mockImplementationOnce(() => new Promise<void>(resolve => { resolveJoin = resolve; }));
    const play = vi.fn().mockRejectedValueOnce(new Error("autoplay blocked")).mockResolvedValue(undefined);
    Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: play });
    const view = render(<DailyAvatarRoom connection={connection} />);
    view.unmount();
    await act(async () => { resolveJoin(); await Promise.resolve(); });
    await waitFor(() => {
      expect(callMock.leave).toHaveBeenCalled();
      expect(callMock.destroy).toHaveBeenCalled();
    });
  });

  it("shows a user retry when audio playback is blocked", async () => {
    const play = vi.fn().mockRejectedValueOnce(new Error("blocked")).mockResolvedValue(undefined);
    Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: play });
    const attachedStreams = new WeakMap<HTMLMediaElement, unknown>();
    Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
      configurable: true,
      get() { return attachedStreams.get(this) || null; },
      set(value: unknown) { attachedStreams.set(this, value); },
    });
    callMock.participants.mockReturnValue({
      local: { local: true },
      remote: { session_id: "remote", local: false, tracks: { audio: { state: "playable", persistentTrack: { kind: "audio" } } } },
    } as any);
    render(<DailyAvatarRoom connection={connection} />);
    await act(async () => {
      const handler = callMock.on.mock.calls.find(([name]) => name === "joined-meeting")?.[1];
      handler?.({});
      await Promise.resolve();
    });
    expect(await screen.findByTestId("daily-playback-error")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByTestId("daily-playback-retry"));
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.queryByTestId("daily-playback-error")).toBeNull());
    expect(play).toHaveBeenCalledTimes(2);
  });
});
