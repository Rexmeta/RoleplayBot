// @vitest-environment happy-dom
import React from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, options?: any) => typeof options === "string" ? options : options?.defaultValue ?? _key }),
}));
vi.mock("../../client/src/lib/queryClient", async importOriginal => {
  const original = await importOriginal<typeof import("../../client/src/lib/queryClient")>();
  return { ...original, apiRequest: vi.fn() };
});
import { apiRequest, queryClient } from "../../client/src/lib/queryClient";
import { LiveAvatarChoice } from "../../client/src/components/chat/LiveAvatarChoice";
import { LiveAvatarSettingsPanel } from "../../client/src/components/admin/LiveAvatarSettingsPanel";
import { ScenarioLiveAvatarPolicy } from "../../client/src/components/admin/ScenarioLiveAvatarPolicy";

const config = {
  enabled: false, service: "avatar-router", contractReady: false,
  blockers: ["machine_auth_unverified", "pcm_bridge_unverified"], origin: "https://avatar-router.replit.app",
};
let api: ReturnType<typeof vi.mocked<typeof apiRequest>>;
let calls: Array<{ method: string; url: string; body: any }>;
const view = (ui: React.ReactNode) => render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
const response = (body: unknown) => ({ json: async () => body }) as Response;

beforeEach(() => {
  calls = [];
  queryClient.clear();
  queryClient.setDefaultOptions({ queries: { retry: false }, mutations: { retry: false } });
  api = vi.mocked(apiRequest);
  api.mockReset();
  api.mockImplementation(async (method, url, body) => {
    calls.push({ method, url, body });
    if (url.endsWith("/availability")) return response({ ...config, allowed: false, available: false });
    if (url.endsWith("/policy")) return response({ allowed: method === "PUT" ? (body as any).allowed : false });
    if (url.endsWith("/config")) return response({ ...config, ...(method === "PUT" ? body as any : {}) });
    if (url.endsWith("/diagnostics")) return response({
      reachable: true, liveEnabled: true, checkedAt: "2026-10-27T00:00:00Z",
      providers: [{ id: "tavus", name: "Tavus", status: "available", externalAudio: true, implemented: true }],
      blockers: config.blockers,
    });
    throw new Error("Unexpected request");
  });
});
afterEach(() => { cleanup(); queryClient.clear(); });

describe("optional live avatar UI", () => {
  it("defaults to existing mode, blocks live even with consent and never creates a session", async () => {
    view(<LiveAvatarChoice conversationId="pr" voiceMode />);
    expect(screen.getByText("현재: 기존 아바타·음성 사용")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "실시간 아바타 옵션 보기" }));
    await screen.findByText("현재 사용할 수 없음");
    expect(screen.getByText("서버 간 인증 규격이 확인되지 않았습니다.")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox"));
    const start = screen.getByRole("button", { name: "실시간 아바타 시작" });
    expect((start as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(start);
    expect(calls.every(call => call.method === "GET")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "기존 방식 유지" }));
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("keeps text chat intact and never starts live in text mode", async () => {
    view(<LiveAvatarChoice conversationId="pr" voiceMode={false} />);
    fireEvent.click(screen.getByRole("button", { name: "실시간 아바타 옵션 보기" }));
    await screen.findByText("현재 사용할 수 없음");
    expect(screen.getByText("라이브 아바타는 실시간 음성 대화에서만 사용할 수 있습니다.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "실시간 아바타 시작" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not trust server availability without an installed media consumer", async () => {
    api.mockResolvedValue(response({ ...config, enabled: true, allowed: true, contractReady: true, available: true, blockers: [] }));
    view(<LiveAvatarChoice conversationId="pr" voiceMode />);
    fireEvent.click(screen.getByRole("button", { name: "실시간 아바타 옵션 보기" }));
    await screen.findByText("현재 사용할 수 없음");
    fireEvent.click(screen.getByRole("checkbox"));
    expect((screen.getByRole("button", { name: "실시간 아바타 시작" }) as HTMLButtonElement).disabled).toBe(true);
    expect(calls.filter(call => call.method === "POST")).toHaveLength(0);
  });

  it("shows availability errors instead of claiming success", async () => {
    api.mockRejectedValue(new Error("403: access denied"));
    view(<LiveAvatarChoice conversationId="pr" voiceMode />);
    fireEvent.click(screen.getByRole("button", { name: "실시간 아바타 옵션 보기" }));
    expect((await screen.findByRole("alert")).textContent).toContain("확인하지 못했습니다");
    expect(screen.queryByText("사용 가능")).toBeNull();
  });

  it("global switch persists separately and diagnostics run only on an explicit click", async () => {
    view(<LiveAvatarSettingsPanel />);
    const toggle = await screen.findByRole("switch", { name: "실시간 아바타 전역 허용" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(calls.some(call => call.url.endsWith("/diagnostics"))).toBe(false);
    fireEvent.click(toggle);
    await waitFor(() => expect(calls.some(call => call.method === "PUT" && call.body.enabled === true)).toBe(true));
    await screen.findByText("전역 사용");
    expect(screen.getByText("외부 연동 계약 미검증")).toBeTruthy();
    const diagnostics = screen.getAllByRole("button").find(button => button.textContent?.includes("진단"));
    expect(diagnostics).toBeTruthy();
    fireEvent.click(diagnostics!);
    await screen.findByText("Tavus");
    expect(calls.filter(call => call.method === "POST")).toHaveLength(1);
    expect(screen.getByText("외부 연동 계약 미검증")).toBeTruthy();
  });

  it("offers scenario policy only after the scenario is saved", async () => {
    view(<ScenarioLiveAvatarPolicy />);
    await screen.findByText(/먼저/);
    expect(calls.some(call => call.url.endsWith("/policy"))).toBe(false);
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("stores scenario permission while global OFF, without changing video-avatar content", async () => {
    view(<ScenarioLiveAvatarPolicy scenarioId="scenario" />);
    const toggle = await screen.findByRole("switch", { name: "이 시나리오에서 허용" });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "정책 저장" }));
    await screen.findByText("정책을 저장했습니다.");
    const writes = calls.filter(call => call.method === "PUT");
    expect(writes).toEqual([{ method: "PUT", url: "/api/live-avatar/scenarios/scenario/policy", body: { allowed: true } }]);
  });

  it("shows a failed global save and restores the previous setting", async () => {
    api.mockImplementation(async (method) => {
      if (method === "PUT") throw new Error("403: denied");
      return response(config);
    });
    view(<LiveAvatarSettingsPanel />);
    const toggle = await screen.findByRole("switch", { name: "실시간 아바타 전역 허용" });
    fireEvent.click(toggle);
    expect((await screen.findByRole("alert")).textContent).toContain("저장하지 못했습니다");
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("false"));
  });
});
