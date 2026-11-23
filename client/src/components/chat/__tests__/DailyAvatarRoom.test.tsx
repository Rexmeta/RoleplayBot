// @vitest-environment happy-dom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { createCallObjectMock, callMock } = vi.hoisted(() => {
  const handlers: Record<string, (event?: any) => void> = {};
  const call = {
    on: vi.fn((event: string, handler: (event?: any) => void) => { handlers[event] = handler; }),
    join: vi.fn(() => Promise.resolve()),
    leave: vi.fn(() => Promise.resolve()),
    destroy: vi.fn(() => Promise.resolve()),
    startLocalAudioLevelObserver: vi.fn(async () => {}),
    stopLocalAudioLevelObserver: vi.fn(),
    participants: vi.fn(() => ({ local: { session_id: "local", local: true }, remote: { session_id: "remote", local: false, tracks: {} } })),
  };
  return { createCallObjectMock: vi.fn(() => call), callMock: call };
});
vi.mock("@daily-co/daily-js", () => ({ default: { createCallObject: createCallObjectMock } }));

import DailyAvatarRoom from "../DailyAvatarRoom";

const connection = { transport: "daily" as const, pipeline: "tavus_full" as const, url: "https://daily.example/room", token: "temporary" };
const originalPlay = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "play");
const originalSrcObject = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "srcObject");
const defaultParticipants = callMock.participants.getMockImplementation()!;
afterEach(async () => {
  cleanup();
  await act(async () => { await Promise.resolve(); });
  vi.clearAllMocks();
  callMock.participants.mockReset().mockImplementation(defaultParticipants);
  if (originalPlay) Object.defineProperty(HTMLMediaElement.prototype, "play", originalPlay);
  if (originalSrcObject) Object.defineProperty(HTMLMediaElement.prototype, "srcObject", originalSrcObject);
});

describe("DailyAvatarRoom", () => {
  it("starts only a local audio level observer and clears the effect when the call ends", async () => {
    const handler = (name: string) => callMock.on.mock.calls.find(([event]) => event === name)?.[1];
    const view = render(<DailyAvatarRoom connection={connection} />);
    act(() => handler("joined-meeting")?.({}));
    await waitFor(() => expect(callMock.startLocalAudioLevelObserver).toHaveBeenCalledExactlyOnceWith(100));
    expect(handler("remote-participants-audio-level")).toBeUndefined();
    act(() => handler("local-audio-level")?.({ audioLevel: 0.005 }));
    expect(screen.queryByTestId("user-speech-glow")).toBeNull();
    act(() => handler("local-audio-level")?.({ audioLevel: 0.25 }));
    expect(screen.getByTestId("user-speech-glow")).toBeTruthy();
    act(() => handler("left-meeting")?.({}));
    expect(screen.queryByTestId("user-speech-glow")).toBeNull();
    view.unmount();
    expect(callMock.stopLocalAudioLevelObserver).toHaveBeenCalledTimes(1);
  });
  it("keeps the waiting screen after a playable track arrives until its first frame", async () => {
    const track = { kind: "video" };
    callMock.participants.mockReturnValue({
      local: { local: true },
      remote: { session_id: "remote", local: false, tracks: { video: { state: "playable", persistentTrack: track } } },
    } as any);
    render(<DailyAvatarRoom connection={connection} poster="/persona.png" />);
    act(() => callMock.on.mock.calls.find(([event]) => event === "joined-meeting")?.[1]({}));
    expect(screen.getByTestId("daily-waiting-media")).toBeTruthy();
    const video = screen.getByTestId("daily-remote-video");
    await act(async () => {
      Object.defineProperties(video, {
        paused: { value: false }, videoWidth: { value: 640 }, videoHeight: { value: 480 },
        currentTime: { value: 0.2, configurable: true },
      });
      fireEvent.playing(video);
      expect(screen.getByTestId("daily-waiting-media")).toBeTruthy();
      fireEvent.timeUpdate(video);
    });
    expect(screen.queryByTestId("daily-waiting-media")).toBeNull();
  });
  it("receives delayed/streaming browser captions from the remote room and stops after teardown", async () => {
    const onCaption = vi.fn();
    const view = render(<DailyAvatarRoom connection={connection} onCaption={onCaption} />);
    await waitFor(() => expect(callMock.join).toHaveBeenCalled());
    const handler = callMock.on.mock.calls.find(([name]) => name === "app-message")![1];
    const data = { event_type: "conversation.utterance", turn_idx: 1, properties: { role: "user", speech: "일정을 확인하고 싶습니다" } };
    act(() => {
      handler({ fromId: "local", data });
      handler({ fromId: "unknown", data });
      handler({ fromId: "remote", data });
      handler({ fromId: "remote", data });
    });
    expect(onCaption).toHaveBeenCalledTimes(1);
    expect(onCaption).toHaveBeenCalledWith(expect.objectContaining({ sender: "user", message: "일정을 확인하고 싶습니다" }));
    view.unmount();
    act(() => handler({ fromId: "remote", data: { ...data, turn_idx: 2 } }));
    expect(onCaption).toHaveBeenCalledTimes(1);
  });
  it("refreshes the caption callback without rejoining and handles available Daily captions", async () => {
    const oldCallback = vi.fn(), nextCallback = vi.fn();
    const view = render(<DailyAvatarRoom connection={connection} onCaption={oldCallback} />);
    await waitFor(() => expect(callMock.join).toHaveBeenCalled());
    view.rerender(<DailyAvatarRoom connection={connection} onCaption={nextCallback} />);
    const handler = callMock.on.mock.calls.find(([name]) => name === "transcription-message")![1];
    act(() => handler({ participantId: "local", text: "브라우저 전사", timestamp: new Date() }));
    expect(nextCallback).toHaveBeenCalledWith(expect.objectContaining({ sender: "user", message: "브라우저 전사" }));
    expect(oldCallback).not.toHaveBeenCalled();
    expect(callMock.join).toHaveBeenCalledTimes(1);
  });
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
