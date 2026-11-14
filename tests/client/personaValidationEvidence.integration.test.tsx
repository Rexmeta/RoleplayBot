// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
// Only network, auth and transport are fake. Panel, session view, room hook,
// conversation hook, first-frame detector and timing card are real.
const fakes = vi.hoisted(() => ({ rooms: [] as any[], api: vi.fn() }));
vi.mock("../../client/src/lib/queryClient", () => ({ apiRequest: fakes.api }));
vi.mock("../../client/src/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "admin" } }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "ko" } }) }));
vi.mock("livekit-client", () => ({
  Track: { Kind: { Video: "video", Audio: "audio" } },
  RoomEvent: { TrackSubscribed: "sub", TrackUnsubscribed: "unsub", AudioPlaybackStatusChanged: "playback", Disconnected: "disconnected" },
  Room: class {
    handlers = new Map<string, (...args: any[]) => void>();
    remoteParticipants = new Map();
    disconnect = vi.fn(); connect = vi.fn(async () => {}); startAudio = vi.fn(async () => {});
    removeAllListeners() { this.handlers.clear(); }
    on(event: string, callback: any) { this.handlers.set(event, callback); return this; }
    constructor() { fakes.rooms.push(this); }
  },
}));
import { PersonaAvatarValidationPanel } from "../../client/src/components/admin/PersonaAvatarValidationPanel";

const assetId = "12345678-1234-4234-8234-123456789abc";
const sessionId = "32345678-1234-4234-8234-123456789abc";
const base = `/api/admin/personas/live-avatar/assets/${assetId}/validation`;
const callbacks = new Map<number, () => void>();
let nextCallback = 0, timingFails = false, validationFails = false, assetStatus = "unvalidated";
let oldFrame: PropertyDescriptor | undefined, oldCancel: PropertyDescriptor | undefined;
const session = () => ({
  id: sessionId, providerId: "tavus", avatarId: "custom-replica", avatarAssetId: assetId, purpose: "validation",
  mode: "live", status: "active", rendererState: "running", stopRequested: false, cleanupPending: false,
  expiresAt: "2099-01-01T00:00:00Z",
});
const response = (value: unknown) => ({ json: async () => value });
const reports = () => fakes.api.mock.calls.filter(c => c[1] === `${base}/report`);
const observations = () => fakes.api.mock.calls.filter(c => c[1].endsWith("/video-playing"));
const reportButton = () => screen.getByRole("button", { name: "재생 확인 보고" }) as HTMLButtonElement;
beforeEach(() => {
  callbacks.clear(); nextCallback = 0; timingFails = false; validationFails = false; assetStatus = "unvalidated";
  fakes.rooms.length = 0;
  oldFrame = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, "requestVideoFrameCallback");
  oldCancel = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, "cancelVideoFrameCallback");
  Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", {
    configurable: true, value: (callback: () => void) => { callbacks.set(++nextCallback, callback); return nextCallback; },
  });
  Object.defineProperty(HTMLVideoElement.prototype, "cancelVideoFrameCallback", {
    configurable: true, value: (id: number) => { callbacks.delete(id); },
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  // The only direct fetch is existing best-effort cleanup. It cannot escape.
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
  fakes.api.mockReset().mockImplementation(async (method: string, url: string) => {
    const path = url.split("?")[0];
    if (method === "GET" && path === `${base}/preflight`) return response({
      ready: false, aiReady: true, creationUncertain: false, missingScopes: [], sessions: [session()],
      limits: { workerReady: true, cleanupPending: 0, userRemainingSeconds: 600, globalRemainingSeconds: 3600,
        sessionSeconds: 120, providerCredits: "unknown", resetsAt: "2099-01-01T00:00:00Z" },
    });
    if (method === "GET" && path.endsWith("/connection")) return response({
      url: "wss://fixture.livekit.cloud", token: "offline-only-token", expiresAt: "2099-01-01T00:00:00Z",
    });
    if (method === "GET" && path === `${base}/sessions/${sessionId}`) return response(session());
    if (method === "POST" && path.endsWith("/video-playing")) {
      if (timingFails) throw Error("fixture observation rejected");
      return response({ ...session(), timing: {
        routerElapsedSeconds: 26, clientVideoReportedAt: "2026-11-14T00:00:09Z",
        preparationSeconds: 9, connectedSeconds: 17, evidence: "authenticated_client_report",
      } });
    }
    if (method === "POST" && path.endsWith("/turn")) return response({ userText: "안녕하세요", replyText: "오프라인 테스트 응답" });
    if (method === "POST" && path === `${base}/report`) {
      if (validationFails) throw Error("fixture validation rejected");
      assetStatus = "validated"; return response({ status: assetStatus });
    }
    if (method === "POST" && /\/(end|interrupt)$/.test(path)) return response({ ...session(), status: "ended" });
    throw Error(`Unexpected fixture request: ${method} ${path}`);
  });
});
afterEach(async () => {
  cleanup(); await new Promise(resolve => setTimeout(resolve, 0));
  for (const [key, previous] of [["requestVideoFrameCallback", oldFrame], ["cancelVideoFrameCallback", oldCancel]] as const) {
    if (previous) Object.defineProperty(HTMLVideoElement.prototype, key, previous);
    else Reflect.deleteProperty(HTMLVideoElement.prototype, key);
  }
  callbacks.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function track(kind: "video" | "audio") {
  const node = document.createElement(kind);
  if (kind === "video") Object.defineProperties(node, {
    paused: { value: false, configurable: true },
    videoWidth: { value: 640, configurable: true }, videoHeight: { value: 480, configurable: true },
    currentTime: { value: 1, configurable: true, writable: true },
    getVideoPlaybackQuality: { value: () => ({ totalVideoFrames: 0 }), configurable: true },
  });
  return { kind, attach: () => node, detach: () => [node] };
}
async function mount(audio = true) {
  const onReported = vi.fn();
  render(<PersonaAvatarValidationPanel assetId={assetId} assetName="오프라인 커스텀" onReported={onReported} />);
  await waitFor(() => expect(fakes.rooms).toHaveLength(1));
  const room = fakes.rooms[0], video = track("video");
  await act(async () => {
    room.handlers.get("sub")?.(video);
    if (audio) room.handlers.get("sub")?.(track("audio"));
  });
  await waitFor(() => expect(callbacks.size).toBeGreaterThanOrEqual(audio ? 2 : 1));
  return { room, video, onReported };
}
async function frame() {
  await act(async () => {
    const pending = [...callbacks.entries()];
    for (const [id, callback] of pending) { callbacks.delete(id); callback(); }
  });
}
async function successfulTurn() {
  const send = screen.getByRole("button", { name: "텍스트 전송" }) as HTMLButtonElement;
  expect(send.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(/텍스트와 녹음이 음성 인식/));
  fireEvent.change(screen.getByPlaceholderText("테스트할 말을 입력하세요"), { target: { value: "안녕하세요" } });
  fireEvent.click(send);
  await screen.findByText("오프라인 테스트 응답");
}
function acknowledge() {
  fireEvent.click(screen.getByLabelText("영상이 실제로 재생되는 것을 직접 확인했습니다."));
  fireEvent.click(screen.getByLabelText("테스트 응답의 음성을 실제로 들었습니다."));
}
function unchanged(onReported: ReturnType<typeof vi.fn>) {
  expect(reports()).toHaveLength(0); expect(assetStatus).toBe("unvalidated");
  expect(onReported).not.toHaveBeenCalled();
  expect(fakes.api.mock.calls.some(c => c[0] === "POST" && c[1] === `${base}/sessions`)).toBe(false);
}

describe("real persona validation/session view evidence separation", () => {
  it("first-frame timing succeeds without audio, but never validates the asset or unlocks completion", async () => {
    const f = await mount(false);
    expect(observations()).toHaveLength(0);
    fireEvent.playing(f.video.attach());
    expect(observations()).toHaveLength(0);
    await frame(); await frame();
    expect(observations()).toEqual([["POST", `${base}/sessions/${sessionId}/video-playing`, { event: "video_frame_presented" }]]);
    expect(reportButton().disabled).toBe(true);
    expect((screen.getByLabelText("테스트 응답의 음성을 실제로 들었습니다.") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(reportButton()); unchanged(f.onReported);
  });
  it("ready tracks, consent and a successful turn cannot replace a presented video frame", async () => {
    const f = await mount(); await successfulTurn();
    expect(observations()).toHaveLength(0); expect(reportButton().disabled).toBe(true);
    acknowledge(); expect(reportButton().disabled).toBe(true); unchanged(f.onReported);
  });
  it("a frame and manual acknowledgements cannot replace a new successful audio-processing turn", async () => {
    const f = await mount(); await frame(); acknowledge();
    expect(reportButton().disabled).toBe(true); unchanged(f.onReported);
    expect(fakes.api.mock.calls.some(c => c[1].endsWith("/turn"))).toBe(false);
  });
  it("requires both acknowledgements and a separate explicit report even after frame and successful turn", async () => {
    const f = await mount(); await frame(); await successfulTurn();
    expect(reportButton().disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("영상이 실제로 재생되는 것을 직접 확인했습니다."));
    expect(reportButton().disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("테스트 응답의 음성을 실제로 들었습니다."));
    expect(reportButton().disabled).toBe(false); unchanged(f.onReported);
    fireEvent.click(reportButton());
    await waitFor(() => expect(f.onReported).toHaveBeenCalledTimes(1));
    expect(reports()).toEqual([["POST", `${base}/report`, { sessionId, videoObserved: true, audioObserved: true }]]);
    expect(assetStatus).toBe("validated"); expect(observations()).toHaveLength(1);
  });
  it("keeps timing and asset-validation errors distinct without ending or recreating media", async () => {
    timingFails = true; validationFails = true;
    const f = await mount(); await frame();
    await screen.findByText(/영상 시간 보고에 실패했습니다/);
    expect(screen.queryByText(/재생 확인 결과를 기록하지 못했습니다/)).toBeNull();
    await successfulTurn(); acknowledge(); fireEvent.click(reportButton());
    await screen.findByText(/재생 확인 결과를 기록하지 못했습니다/);
    expect(screen.getByText(/영상 시간 보고에 실패했습니다/)).toBeTruthy();
    expect(assetStatus).toBe("unvalidated"); expect(f.onReported).not.toHaveBeenCalled();
    expect(observations()).toHaveLength(1); expect(reports()).toHaveLength(1);
    expect(f.room.disconnect).not.toHaveBeenCalled();
    expect(fakes.api.mock.calls.some(c => c[0] === "POST" && /\/(end|sessions)$/.test(c[1]))).toBe(false);
  });
  it("a validation failure alone is not mislabeled as a timing failure", async () => {
    validationFails = true;
    const f = await mount(); await frame(); await successfulTurn(); acknowledge();
    fireEvent.click(reportButton()); await screen.findByText(/재생 확인 결과를 기록하지 못했습니다/);
    expect(screen.queryByText(/영상 시간 보고에 실패했습니다/)).toBeNull();
    expect(assetStatus).toBe("unvalidated"); expect(f.onReported).not.toHaveBeenCalled();
  });
  it("losing audio playback revokes earlier evidence and confirmations without validating", async () => {
    const f = await mount(); await frame(); await successfulTurn(); acknowledge();
    expect(reportButton().disabled).toBe(false);
    await act(async () => f.room.handlers.get("playback")?.(false));
    expect(reportButton().disabled).toBe(true); unchanged(f.onReported);
    await act(async () => f.room.handlers.get("playback")?.(true));
    expect(reportButton().disabled).toBe(true);
    await frame(); acknowledge();
    expect(reportButton().disabled).toBe(true); // A fresh successful turn is required.
    unchanged(f.onReported);
  });
});
