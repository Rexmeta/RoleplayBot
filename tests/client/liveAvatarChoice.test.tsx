// @vitest-environment happy-dom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LiveAvatarChoice } from "../../client/src/components/chat/LiveAvatarChoice";

const api = vi.hoisted(() => vi.fn());
vi.mock("../../client/src/lib/queryClient", () => ({ apiRequest: api }));
vi.mock("../../client/src/components/admin/avatarTest/useAvatarTestRoom", () => ({
  useAvatarTestRoom: (() => {
    const disconnectMedia = vi.fn();
    const startAudio = vi.fn();
    const videoHost = { current: null };
    const audioHost = { current: null };
    return () => ({
    connecting: false, mediaConnected: false, videoTrack: null, audioBlocked: false,
    audioPlaybackReady: true, videoHost, audioHost, disconnectMedia, startAudio,
    });
  })(),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key }) }));

const availability = { enabled: true, allowed: true, contractReady: true, available: true, blockers: [] };
const session = {
  id: "session-1", providerId: "tavus", avatarId: "avatar-1", mode: "live" as const,
  status: "active" as const, rendererState: "starting", stopRequested: false, cleanupPending: false,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};
const jsonResponse = (body: unknown) => ({ json: async () => body });
function setup(voiceMode = true, portraitHost?: HTMLElement | null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={queryClient}>
    <LiveAvatarChoice conversationId="conversation-1" voiceMode={voiceMode} portraitHost={portraitHost} />
  </QueryClientProvider>);
}

afterEach(() => { cleanup(); api.mockReset(); });

describe("LiveAvatarChoice", () => {
  it.each([
    ["avatar_provider_cleanup_required", "이전 세션이 남아 있습니다"],
    ["avatar_test_read_failed", "상태 응답을 읽거나 확인하지 못했습니다"],
    ["avatar_future_runtime_condition", "라이브 아바타 시작 조건을 확인하지 못했습니다"],
  ])("explains %s and refreshes free reads without bypassing the paid-start gate", async (blocker, explanation) => {
    let blocked = true;
    api.mockImplementation(async (method: string, path: string) => {
      if (method === "GET" && path.endsWith("/availability")) {
        return jsonResponse(blocked ? { ...availability, available: false, blockers: [blocker] } : availability);
      }
      if (method === "GET" && path.endsWith("/session")) return jsonResponse({ session: null, creationUncertain: false });
      return jsonResponse({});
    });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "실시간 아바타 옵션 보기" }));
    await screen.findByText(new RegExp(explanation));
    expect(screen.getByText(`(${blocker})`)).toBeTruthy();
    expect(screen.queryByText("외부 서비스 연결에 필요한 검증이 완료되지 않았습니다.")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox"));
    const start = screen.getByRole("button", { name: "실시간 아바타 시작" });
    expect(start.hasAttribute("disabled")).toBe(true);
    const refresh = await screen.findByRole("button", { name: "연결 상태 다시 확인" });
    await waitFor(() => expect(refresh.hasAttribute("disabled")).toBe(false));
    fireEvent.click(refresh);
    await screen.findByRole("button", { name: "연결 상태 다시 확인" });
    expect(start.hasAttribute("disabled")).toBe(true);
    expect(api.mock.calls.some(([method]) => method === "POST")).toBe(false);
    blocked = false;
    fireEvent.click(screen.getByRole("button", { name: "연결 상태 다시 확인" }));
    await screen.findByText("사용 가능");
    await waitFor(() => expect(start.hasAttribute("disabled")).toBe(false));
    expect(api.mock.calls.some(([method]) => method === "POST")).toBe(false);
  });

  it("keeps paid creation locked after an auth timeout and refreshes both availability and recovery on retry", async () => {
    let recoveryCalls = 0, availabilityCalls = 0;
    api.mockImplementation(async (method: string, path: string) => {
      if (method === "GET" && path.endsWith("/availability")) {
        availabilityCalls++;
        return jsonResponse(availabilityCalls === 1
          ? { ...availability, available: false, blockers: ["avatar_connection_timeout"] } : availability);
      }
      if (method === "GET" && path.endsWith("/session")) {
        recoveryCalls++;
        if (recoveryCalls === 1) throw new Error('504: {"code":"avatar_connection_timeout","error":"avatar_connection_timeout"}');
        return jsonResponse({ session: null, creationUncertain: false });
      }
      return jsonResponse({});
    });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "실시간 아바타 옵션 보기" }));
    await screen.findByText(/기존 세션 복구에 실패했습니다: 외부 아바타 서비스의 연결 확인 응답이 지연/);
    expect(screen.queryByText(/504:/)).toBeNull();
    fireEvent.click(screen.getByRole("checkbox"));
    const start = screen.getByRole("button", { name: "실시간 아바타 시작" });
    expect(start.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "기존 세션 상태 다시 확인" }));
    await screen.findByText("사용 가능");
    await waitFor(() => expect(start.hasAttribute("disabled")).toBe(false));
    expect(recoveryCalls).toBe(2);
    expect(availabilityCalls).toBe(2);
    expect(api.mock.calls.some(([method]) => method === "POST")).toBe(false);
  });

  it("retires a session created after an actor switch without attaching it or creating a replacement", async () => {
    let completeCreate!: (response: any) => void;
    api.mockImplementation((method: string, path: string) => {
      if (method === "GET" && path.endsWith("/session")) return Promise.resolve(jsonResponse({ session: null, creationUncertain: false }));
      if (method === "GET" && path.endsWith("/availability")) return Promise.resolve(jsonResponse(availability));
      if (method === "POST" && path.endsWith("/sessions")) return new Promise(resolve => { completeCreate = resolve; });
      return Promise.resolve(jsonResponse({}));
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const ui = (actorId: string) => <QueryClientProvider client={client}>
      <LiveAvatarChoice conversationId="conversation-1" voiceMode actorId={actorId} optionsRequest={1} />
    </QueryClientProvider>;
    const view = render(ui("first"));
    await screen.findByText("사용 가능");
    fireEvent.click(screen.getByRole("checkbox"));
    const start = screen.getByRole("button", { name: "실시간 아바타 시작" });
    await waitFor(() => expect(start.hasAttribute("disabled")).toBe(false));
    fireEvent.click(start);
    view.rerender(ui("second"));
    await act(async () => completeCreate(jsonResponse(session)));
    await screen.findByText(/페르소나가 변경되어 이전 아바타 세션을 종료하고 있습니다/);
    expect(api.mock.calls.filter(([method, path]) => method === "POST" && path.endsWith("/sessions"))).toHaveLength(1);
    expect(screen.getByRole("button", { name: "실시간 아바타 종료" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "실시간 아바타 시작" })).toBeNull();
  });

  it("does not create a session automatically and keeps start gated until consent", async () => {
    api.mockResolvedValue(jsonResponse(availability));
    setup();
    expect(api).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "실시간 아바타 옵션 보기" }));
    await screen.findByText("사용 가능");
    const start = screen.getByRole("button", { name: "실시간 아바타 시작" });
    expect(start.hasAttribute("disabled")).toBe(true);
    expect(api.mock.calls.some(([method, path]) => method === "POST" && String(path).endsWith("/sessions"))).toBe(false);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(start.hasAttribute("disabled")).toBe(false);
  });

  it("requires voice mode and sends an explicit consented start request", async () => {
    api.mockImplementation((method: string, path: string) => {
      if (method === "GET" && String(path).endsWith("/availability")) return Promise.resolve(jsonResponse(availability));
      if (method === "POST" && String(path).endsWith("/sessions")) return Promise.resolve(jsonResponse(session));
      return Promise.resolve(jsonResponse({}));
    });
    const view = setup(false);
    fireEvent.click(screen.getByRole("button", { name: "실시간 아바타 옵션 보기" }));
    await screen.findByText("라이브 아바타는 실시간 음성 대화에서만 사용할 수 있습니다.");
    expect(screen.getByRole("button", { name: "실시간 아바타 시작" }).hasAttribute("disabled")).toBe(true);
    view.rerender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LiveAvatarChoice conversationId="conversation-1" voiceMode />
    </QueryClientProvider>);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "실시간 아바타 시작" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("POST", "/api/live-avatar/conversations/conversation-1/sessions", {
      service: "avatar-router", consent: true,
    }));
  });

  it("restores a persisted same-conversation session without creating a replacement", async () => {
    api.mockImplementation((method: string, path: string) => {
      if (method === "GET" && String(path).endsWith("/session")) return Promise.resolve(jsonResponse({ session, creationUncertain: false }));
      if (method === "GET" && String(path).endsWith("/availability")) return Promise.resolve(jsonResponse(availability));
      return Promise.resolve(jsonResponse({}));
    });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "실시간 아바타 옵션 보기" }));
    await screen.findByText("세션 active · starting");
    expect(api).toHaveBeenCalledWith("GET", "/api/live-avatar/conversations/conversation-1/session");
    expect(api.mock.calls.some(([method, path]) => method === "POST" && String(path).endsWith("/sessions"))).toBe(false);
  });

  it("portals the single video mount to the portrait host and leaves it transparent until media is ready", async () => {
    api.mockImplementation((method: string, path: string) => {
      if (method === "GET" && String(path).endsWith("/session")) return Promise.resolve(jsonResponse({ session, creationUncertain: false }));
      if (method === "GET" && String(path).endsWith("/availability")) return Promise.resolve(jsonResponse(availability));
      return Promise.resolve(jsonResponse({}));
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = setup(true, host);
    fireEvent.click(screen.getByRole("button", { name: "실시간 아바타 옵션 보기" }));
    await screen.findByText("세션 active · starting");
    const portalVideo = host.querySelector('[data-testid="live-avatar-portrait-video"]') as HTMLElement;
    expect(portalVideo).toBeTruthy();
    expect(portalVideo.className).toContain("opacity-0");
    expect(screen.queryByText("영상 트랙 대기 중")).toBeNull();
    expect(host.querySelectorAll('[data-testid="live-avatar-portrait-video"]')).toHaveLength(1);
    view.unmount();
    host.remove();
  });

  it("ends immediately on the matching fallback event and retries a failed end request", async () => {
    let failFirstEnd = true;
    api.mockImplementation((method: string, path: string) => {
      if (method === "GET" && String(path).endsWith("/session")) return Promise.resolve(jsonResponse({ session, creationUncertain: false }));
      if (method === "GET" && String(path).endsWith("/availability")) return Promise.resolve(jsonResponse(availability));
      if (method === "POST" && String(path).endsWith("/end") && failFirstEnd) {
        failFirstEnd = false;
        return Promise.reject(new Error("end unavailable"));
      }
      return Promise.resolve(jsonResponse({}));
    });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "실시간 아바타 옵션 보기" }));
    await screen.findByText("세션 active · starting");
    act(() => window.dispatchEvent(new CustomEvent("live-avatar-fallback", { detail: { conversationId: "conversation-1" } })));
    expect(await screen.findByText(/오디오 소유권이 종료되었거나 대화가 중단/)).toBeTruthy();
    await waitFor(() => expect(api).toHaveBeenCalledWith("POST", "/api/live-avatar/conversations/conversation-1/sessions/session-1/end", {}));
    fireEvent.click(screen.getByRole("button", { name: "실시간 아바타 종료" }));
    await waitFor(() => expect(api.mock.calls.filter(([method, path]) => method === "POST" && String(path).endsWith("/end"))).toHaveLength(2));
  });
});
