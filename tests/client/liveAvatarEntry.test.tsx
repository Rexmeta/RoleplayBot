// @vitest-environment happy-dom
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LiveAvatarEntry, useLiveAvatarSelection, type LiveAvatarPlaybackState } from "../../client/src/components/chat/LiveAvatarEntry";
import { LiveAvatarChoice } from "../../client/src/components/chat/LiveAvatarChoice";
import { TopMenuPanel } from "../../client/src/components/chat/TopMenuPanel";

const api = vi.hoisted(() => vi.fn());
vi.mock("../../client/src/lib/queryClient", () => ({ apiRequest: api }));
vi.mock("../../client/src/components/AppHeader", () => ({ AppHeader: () => <div>Menu</div> }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key }),
}));
vi.mock("../../client/src/components/admin/avatarTest/useAvatarTestRoom", () => {
  const room = {
    connecting: false, mediaConnected: false, videoTrack: null, audioBlocked: false,
    audioPlaybackReady: false, disconnectMedia: vi.fn(), startAudio: vi.fn(),
    videoHost: { current: null }, audioHost: { current: null },
  };
  return { useAvatarTestRoom: () => room };
});

function Harness({ voiceMode = true }: { voiceMode?: boolean }) {
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState(0);
  const selection = useLiveAvatarSelection("conversation", "actor");
  const [playbackState, setPlaybackState] = useState<LiveAvatarPlaybackState>("idle");
  return <>
    <div data-testid="visible-portrait">
      <LiveAvatarEntry conversationId="conversation" actorId="actor" optionsOpen={open} playbackState={playbackState}
        onOpenOptions={() => { setOpen(true); setRequest(n => n + 1); }} />
    </div>
    <TopMenuPanel isOpen={open} onToggle={() => setOpen(v => !v)} onClose={() => setOpen(false)}>
      {selection.data?.configured && <LiveAvatarChoice conversationId="conversation" actorId="actor" voiceMode={voiceMode} optionsRequest={request}
        onPlaybackStateChange={setPlaybackState} />}
    </TopMenuPanel>
  </>;
}

const json = (body: unknown) => ({ json: async () => body });
function mockFlow({ configured = true, enabled = true, allowed = true } = {}) {
  api.mockImplementation(async (method: string, path: string) => {
    if (method === "GET" && path.endsWith("/selection")) return json({
      configured, enabled, allowed, personaId: "actor",
      blockers: [...(!enabled ? ["globally_disabled"] : []), ...(!allowed ? ["scenario_not_allowed"] : [])],
    });
    if (method === "GET" && path.endsWith("/availability")) return json({
      enabled, allowed, contractReady: true, available: enabled && allowed, blockers: [],
    });
    if (method === "GET" && path.endsWith("/session")) return json({ session: null, creationUncertain: false });
    if (method === "POST" && path.endsWith("/sessions")) return json({
      id: "session", providerId: "tavus", avatarId: "tavus-stock-lucy", mode: "live",
      status: "active", rendererState: "starting", stopRequested: false, cleanupPending: false,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    return json({});
  });
}
function setup(voiceMode = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><Harness voiceMode={voiceMode} /></QueryClientProvider>);
}
afterEach(() => { cleanup(); api.mockReset(); });

describe("visible learner live-avatar entry", () => {
  it("hides the idle status card while keeping controls available in the top menu", async () => {
    mockFlow();
    setup();
    await waitFor(() => expect(api).toHaveBeenCalledWith("GET", "/api/live-avatar/conversations/conversation/selection"));
    expect(screen.queryByText("라이브 아바타 연결 대기")).toBeNull();
    expect(screen.queryByRole("button", { name: "라이브 아바타 옵션 열기" })).toBeNull();
    fireEvent.click(screen.getByTestId("button-toggle-top-menu"));
    fireEvent.click(await screen.findByRole("button", { name: "실시간 아바타 옵션 보기" }));
    expect(await screen.findByRole("checkbox")).toBeTruthy();
    expect(api.mock.calls[0]).toEqual(["GET", "/api/live-avatar/conversations/conversation/selection"]);
    expect(api.mock.calls.some(([method]) => method === "POST")).toBe(false);
  });

  it("opens consent from the top menu and creates only on explicit consent plus Start", async () => {
    mockFlow();
    setup();
    fireEvent.click(screen.getByTestId("button-toggle-top-menu"));
    fireEvent.click(await screen.findByRole("button", { name: "실시간 아바타 옵션 보기" }));
    const consent = await screen.findByRole("checkbox");
    const start = await screen.findByRole("button", { name: "실시간 아바타 시작" });
    await screen.findByText("사용 가능");
    expect(start.hasAttribute("disabled")).toBe(true);
    expect(api.mock.calls.some(([method]) => method === "POST")).toBe(false);
    fireEvent.click(consent);
    await waitFor(() => expect(start.hasAttribute("disabled")).toBe(false));
    fireEvent.click(start);
    await waitFor(() => expect(api).toHaveBeenCalledWith("POST",
      "/api/live-avatar/conversations/conversation/sessions", { service: "avatar-router", consent: true }));
    const choice = document.querySelector('[aria-label="실시간 아바타 선택"]');
    fireEvent.click(screen.getByTestId("button-toggle-top-menu"));
    expect(choice?.isConnected).toBe(true);
    expect(choice?.closest("[inert]")).toBeTruthy();
    expect(api.mock.calls.filter(([method]) => method === "POST")).toHaveLength(1);
  });

  it("keeps configured-but-disabled live visible and explains both policy gates without starting a session", async () => {
    mockFlow({ enabled: false, allowed: false });
    setup();
    await screen.findByText("라이브 아바타 사용 조건 확인 필요");
    fireEvent.click(screen.getByRole("button", { name: "라이브 아바타 옵션 열기" }));
    await screen.findByText("전역 설정이 꺼져 있습니다.");
    expect(screen.getByText("이 시나리오에서 허용되지 않았습니다.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "실시간 아바타 시작" }).hasAttribute("disabled")).toBe(true);
    expect(api.mock.calls.some(([method]) => method === "POST")).toBe(false);
  });

  it("does not add a live entry to image/video-only personas", async () => {
    mockFlow({ configured: false });
    setup();
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(screen.getByTestId("visible-portrait").children).toHaveLength(0);
    fireEvent.click(screen.getByTestId("button-toggle-top-menu"));
    expect(screen.queryByLabelText("실시간 아바타 선택")).toBeNull();
    expect(screen.queryByRole("button", { name: "실시간 아바타 옵션 보기" })).toBeNull();
    expect(api.mock.calls.every(([method, path]) => method === "GET" && path.endsWith("/selection"))).toBe(true);
  });

  it("does not label a saved selection as playing and shows real renderer startup after explicit Start", async () => {
    mockFlow();
    setup();
    await waitFor(() => expect(api).toHaveBeenCalledWith("GET", "/api/live-avatar/conversations/conversation/selection"));
    expect(screen.queryByText("라이브 아바타 연결 대기")).toBeNull();
    expect(screen.queryByText("라이브 아바타 재생 중")).toBeNull();
    fireEvent.click(screen.getByTestId("button-toggle-top-menu"));
    fireEvent.click(await screen.findByRole("button", { name: "실시간 아바타 옵션 보기" }));
    await screen.findByText("사용 가능");
    fireEvent.click(screen.getByRole("checkbox"));
    const start = screen.getByRole("button", { name: "실시간 아바타 시작" });
    await waitFor(() => expect(start.hasAttribute("disabled")).toBe(false));
    fireEvent.click(start);
    await screen.findByText("라이브 아바타 영상 준비 중");
    fireEvent.click(screen.getByTestId("button-toggle-top-menu"));
    expect(screen.getByText("라이브 아바타 영상 준비 중").closest("[inert]")).toBeNull();
    expect(screen.queryByText("라이브 아바타 재생 중")).toBeNull();
  });

  it("keeps provider reconciliation failures visible outside the menu without automatically creating again", async () => {
    mockFlow();
    const original = api.getMockImplementation()!;
    api.mockImplementation(async (method: string, path: string) => {
      if (method === "GET" && path.endsWith("/session")) return json({
        session: { id: "failed-session", providerId: "tavus", avatarId: "tavus-stock-lucy", mode: "live",
          status: "expired", rendererState: "reconciliation_required", cleanupPending: true, stopRequested: false,
          errorCode: "LIVE_CREATE_RECONCILIATION_REQUIRED", expiresAt: new Date().toISOString() },
        creationUncertain: false,
      });
      return original(method, path);
    });
    setup();
    fireEvent.click(screen.getByTestId("button-toggle-top-menu"));
    fireEvent.click(await screen.findByRole("button", { name: "실시간 아바타 옵션 보기" }));
    await screen.findByText("라이브 아바타 연결 실패");
    expect(screen.getByText(/외부 아바타 제공자가 생성 결과를 확정하지 못했습니다/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("button-toggle-top-menu"));
    expect(screen.getByText("라이브 아바타 연결 실패").closest("[inert]")).toBeNull();
    expect(api.mock.calls.some(([method, path]) => method === "POST" && path.endsWith("/sessions"))).toBe(false);
  });

  it("shows the voice-only restriction for text conversations rather than creating a live session", async () => {
    mockFlow();
    setup(false);
    fireEvent.click(screen.getByTestId("button-toggle-top-menu"));
    fireEvent.click(await screen.findByRole("button", { name: "실시간 아바타 옵션 보기" }));
    await screen.findByText("라이브 아바타는 실시간 음성 대화에서만 사용할 수 있습니다.");
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "실시간 아바타 시작" }).hasAttribute("disabled")).toBe(true);
    expect(api.mock.calls.some(([method]) => method === "POST")).toBe(false);
  });
});
