// @vitest-environment happy-dom
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LiveAvatarEntry } from "../../client/src/components/chat/LiveAvatarEntry";
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
  return <>
    <div data-testid="visible-portrait">
      <LiveAvatarEntry conversationId="conversation" actorId="actor" optionsOpen={open}
        onOpenOptions={() => { setOpen(true); setRequest(n => n + 1); }} />
    </div>
    <TopMenuPanel isOpen={open} onToggle={() => setOpen(v => !v)} onClose={() => setOpen(false)}>
      <LiveAvatarChoice conversationId="conversation" actorId="actor" voiceMode={voiceMode} optionsRequest={request} />
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
  it("discovers the run's selection visibly without recovery, provider checks, consent, or paid creation", async () => {
    mockFlow();
    setup();
    const entry = await screen.findByRole("button", { name: "라이브 아바타 옵션 열기" });
    expect(entry.closest("[inert]")).toBeNull();
    expect(entry.closest('[aria-hidden="true"]')).toBeNull();
    expect(screen.getByTestId("visible-portrait").contains(entry)).toBe(true);
    expect(api.mock.calls).toEqual([["GET", "/api/live-avatar/conversations/conversation/selection"]]);
  });

  it("opens consent directly from the visible entry and creates only on explicit consent plus Start", async () => {
    mockFlow();
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "라이브 아바타 옵션 열기" }));
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
    expect(api.mock.calls.every(([method, path]) => method === "GET" && path.endsWith("/selection"))).toBe(true);
  });

  it("shows the voice-only restriction for text conversations rather than creating a live session", async () => {
    mockFlow();
    setup(false);
    fireEvent.click(await screen.findByRole("button", { name: "라이브 아바타 옵션 열기" }));
    await screen.findByText("라이브 아바타는 실시간 음성 대화에서만 사용할 수 있습니다.");
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "실시간 아바타 시작" }).hasAttribute("disabled")).toBe(true);
    expect(api.mock.calls.some(([method]) => method === "POST")).toBe(false);
  });
});
