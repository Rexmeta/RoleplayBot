// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const fakes = vi.hoisted(() => ({ rooms: [] as any[], api: vi.fn() }));
vi.mock("../../client/src/lib/queryClient", () => ({ apiRequest: fakes.api }));
vi.mock("livekit-client", () => ({
  Track: { Kind: { Video: "video", Audio: "audio" } },
  RoomEvent: { TrackSubscribed: "sub", TrackUnsubscribed: "unsub", AudioPlaybackStatusChanged: "playback", Disconnected: "disconnected" },
  Room: class {
    handlers = new Map<string, (...args: any[]) => void>();
    remoteParticipants = new Map();
    disconnect = vi.fn();
    connect = vi.fn(async () => {});
    startAudio = vi.fn(async () => {});
    removeAllListeners() { this.handlers.clear(); }
    on(event: string, handler: any) { this.handlers.set(event, handler); return this; }
    constructor() { fakes.rooms.push(this); }
  },
}));
import { LiveAvatarTestPanel } from "../../client/src/components/admin/LiveAvatarTestPanel";
const base = "/api/live-avatar/test";
const current = (patch = {}) => ({
  id: "test-session", mode: "live", providerId: "tavus", avatarId: "tavus-stock-lucy",
  status: "active", rendererState: "running", stopRequested: false, cleanupPending: false,
  expiresAt: "2099-01-01T00:00:00Z", ...patch,
});
let preflight: any;
let session: any;
let failPoll: boolean;
const response = (body: any) => ({ json: async () => body }) as Response;
const turnPosts = () => fakes.api.mock.calls.filter(([m, p]) => m === "POST" && p.endsWith("/turn"));
const createPosts = () => fakes.api.mock.calls.filter(([m, p]) => m === "POST" && p === `${base}/sessions`);
beforeEach(() => {
  fakes.rooms.length = 0;
  session = current({ rendererState: "queued" });
  failPoll = false;
  preflight = {
    ready: true, aiReady: true, creationUncertain: false, missingScopes: [], sessions: [],
    limits: { workerReady: true, cleanupPending: 0, userRemainingSeconds: 600, globalRemainingSeconds: 3600,
      sessionSeconds: 120, providerCredits: "unknown", resetsAt: "2099-01-01T00:00:00Z" },
  };
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({})));
  fakes.api.mockReset();
  fakes.api.mockImplementation(async (method: string, url: string) => {
    const path = url.split("?")[0];
    if (path.endsWith("/preflight")) return response(preflight);
    if (path.endsWith("/connection")) return response({ url: "wss://room.livekit.cloud", token: "memory-only-token", expiresAt: "2099-01-01T00:00:00Z" });
    if (method === "POST" && path === `${base}/sessions`) {
      preflight = { ...preflight, ready: false, sessions: [session] };
      return response(session);
    }
    if (path.endsWith("/end")) {
      session = current({ status: "ended", rendererState: "stopped", stopRequested: true });
      preflight = { ...preflight, ready: true, sessions: [session] };
      return response(session);
    }
    if (path.endsWith("/interrupt")) return response(session);
    if (path.endsWith("/turn")) return response({ userText: "안녕하세요", replyText: "반가워요!" });
    if (failPoll) throw new Error("network failed");
    return response(session);
  });
});
afterEach(async () => {
  cleanup();
  await new Promise(resolve => setTimeout(resolve, 0));
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const consent = () => {
  const labels = screen.getAllByRole("checkbox");
  fireEvent.click(labels[0]);
  fireEvent.click(labels[1]);
};
const recoverRunning = async () => {
  session = current();
  preflight = { ...preflight, ready: false, sessions: [session] };
  render(<LiveAvatarTestPanel />);
  await waitFor(() => expect(fakes.rooms).toHaveLength(1));
  await waitFor(() => expect(fakes.rooms[0].connect).toHaveBeenCalledTimes(1));
  return fakes.rooms[0];
};
const track = (kind: string) => {
  const node = document.createElement(kind === "video" ? "video" : "audio");
  return { kind, attach: () => node, detach: () => [node] };
};
const mediaReady = async (room: any) => {
  await act(async () => {
    room.handlers.get("sub")?.(track("video"));
    room.handlers.get("sub")?.(track("audio"));
  });
};

describe("admin stock-avatar test UI", () => {
  it("only performs free preflight on mount and requires both unchecked consents", async () => {
    render(<LiveAvatarTestPanel />);
    const button = await screen.findByRole("button", { name: "확인 후 테스트 세션 생성" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(createPosts()).toHaveLength(0);
    consent();
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(createPosts()).toHaveLength(1));
    expect(createPosts()[0][2]).toEqual({ costConfirmed: true, audioConfirmed: true });
    expect(fakes.rooms).toHaveLength(0); // queued != video-ready
  });

  it("blocks ambiguous creation without retrying and exposes recovery warning", async () => {
    preflight = { ...preflight, ready: false, creationUncertain: true };
    render(<LiveAvatarTestPanel />);
    await screen.findByText(/세션 생성 결과 확인 중/);
    consent();
    const button = screen.getByRole("button", { name: "확인 후 테스트 세션 생성" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(createPosts()).toHaveLength(0);
  });

  it("does not connect ended sessions or treat terminal cleanup pending as ready", async () => {
    preflight = { ...preflight, ready: false, sessions: [current({ status: "failed", cleanupPending: true })] };
    render(<LiveAvatarTestPanel />);
    await screen.findByText(/내 테스트 세션 및 정리 상태/);
    expect(fakes.rooms).toHaveLength(0);
    expect(createPosts()).toHaveLength(0);
  });

  it("connects once despite connection state rerenders and requires both media tracks plus fresh consent", async () => {
    const room = await recoverRunning();
    const send = screen.getByRole("button", { name: "텍스트 전송" }) as HTMLButtonElement;
    await act(async () => room.handlers.get("sub")?.(track("video")));
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(send.disabled).toBe(true); // no remote audio yet
    await act(async () => room.handlers.get("sub")?.(track("audio")));
    const input = screen.getByPlaceholderText("테스트할 말을 입력하세요");
    fireEvent.change(input, { target: { value: "안녕하세요" } });
    fireEvent.click(send);
    await screen.findByText("반가워요!");
    expect(turnPosts()).toHaveLength(1);
    expect(room.connect).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("memory-only-token")).toBeNull();
  });

  it("blocks turns when autoplay is denied", async () => {
    const room = await recoverRunning();
    await mediaReady(room);
    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => room.handlers.get("playback")?.(false));
    expect(await screen.findByRole("button", { name: "오디오 재생 허용" })).toBeDefined();
    const input = screen.getByPlaceholderText("테스트할 말을 입력하세요") as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(turnPosts()).toHaveLength(0);
  });

  it("stops local media before requesting end and never reconnects the stopped room", async () => {
    const room = await recoverRunning();
    await mediaReady(room);
    fireEvent.click(screen.getByRole("button", { name: "테스트 중지" }));
    expect(room.disconnect).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(fakes.api.mock.calls.some(([m, p]) => m === "POST" && p.endsWith("/end"))).toBe(true));
    await waitFor(() => expect(screen.queryByRole("button", { name: "테스트 중지" })).toBeNull());
    expect(screen.getByRole("button", { name: "확인 후 테스트 세션 생성" })).toBeDefined();
    expect(fakes.rooms).toHaveLength(1);
  });

  it("fails closed on polling failure rather than continuing stale media", async () => {
    const room = await recoverRunning();
    await mediaReady(room);
    failPoll = true;
    await waitFor(() => expect(room.disconnect).toHaveBeenCalled(), { timeout: 2500 });
    expect((screen.getByPlaceholderText("테스트할 말을 입력하세요") as HTMLInputElement).disabled).toBe(true);
    expect(fakes.rooms).toHaveLength(1);
  });

  it("uses best-effort authenticated keepalive end on unmount", async () => {
    await recoverRunning();
    cleanup();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(`${base}/sessions/test-session/end`,
      expect.objectContaining({ method: "POST", keepalive: true, credentials: "include" })));
  });
});
