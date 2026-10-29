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
import { LiveAvatarIdentityPanel } from "../../client/src/components/admin/LiveAvatarIdentityPanel";
import { LiveAvatarConnectionPanel } from "../../client/src/components/admin/LiveAvatarConnectionPanel";

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
    if (url.endsWith("/connection")) return response({ authMode: "api-key", state: "unconfigured" });
    if (url.endsWith("/identity")) return response({ state: "unconfigured", audience: "avatarrouter-api", clientId: "roleplayx-avatarrouter", tokenLifetimeSeconds: 45 });
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
  it("defaults to API-key setup without requesting a key or checking external auth", async () => {
    view(<LiveAvatarConnectionPanel />);
    await screen.findByText("미구성");
    expect((screen.getByRole("button", { name: "API 키 연결 확인" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText(/기본 API 키 방식에는 issuer나 JWKS 설정이 필요하지 않습니다/)).toBeTruthy();
    expect(calls.every(call => call.method === "GET" && call.url === "/api/live-avatar/connection")).toBe(true);
  });

  it("uses API-key connection as default and does not query advanced JWT until expanded", async () => {
    view(<LiveAvatarSettingsPanel />);
    await screen.findByRole("button", { name: "API 키 연결 확인" });
    expect(calls.some(call => call.url.endsWith("/identity"))).toBe(false);
    const disclosure = screen.getByText("고급 JWT 위임 · 선택 사항").closest("details")!;
    disclosure.open = true;
    fireEvent(disclosure, new Event("toggle"));
    await screen.findByText("서버 위임 신원");
    await waitFor(() => expect(calls.some(call => call.url.endsWith("/identity"))).toBe(true));
  });

  it("checks the configured key only on a click and keeps live activation blocked", async () => {
    api.mockImplementation(async (method, url, body) => {
      calls.push({ method, url, body });
      return response(method === "GET"
        ? { authMode: "api-key", state: "configured", baseUrl: "https://avatar.example.test/api/v1" }
        : { authenticated: true, authType: "api-key", projectId: "project-one", projectName: "RoleplayX",
            scopes: ["live-limits:read"], expiresAt: "2099-01-01T00:00:00Z", userContext: true, checkedAt: "2026-10-29T00:00:00Z" });
    });
    view(<LiveAvatarConnectionPanel />);
    await screen.findByText("구성됨 · 확인 필요");
    expect(calls.filter(call => call.method === "POST")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "API 키 연결 확인" }));
    await screen.findByText("API 키 인증 확인됨");
    expect(calls.filter(call => call.method === "POST")).toEqual([{ method: "POST", url: "/api/live-avatar/connection/check", body: {} }]);
    expect(screen.getByText("RoleplayX · project-one")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "실시간 아바타 시작" })).toBeNull();
  });

  it("shows failed API-key auth without silently falling back or claiming success", async () => {
    api.mockImplementation(async method => {
      if (method === "POST") throw new Error("502: avatar_connection_rejected");
      return response({ authMode: "api-key", state: "configured" });
    });
    view(<LiveAvatarConnectionPanel />);
    await screen.findByText("구성됨 · 확인 필요");
    fireEvent.click(screen.getByRole("button", { name: "API 키 연결 확인" }));
    expect((await screen.findByRole("alert")).textContent).toContain("avatar_connection_rejected");
    expect(screen.queryByText("API 키 인증 확인됨")).toBeNull();
    expect(screen.queryByText("서버 위임 신원")).toBeNull();
  });

  it("shows missing signing configuration without requesting credentials or checking protected upstream APIs", async () => {
    view(<LiveAvatarIdentityPanel />);
    await screen.findByText("미구성");
    expect((screen.getByRole("button", { name: "위임 인증 확인" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(calls.every(call => call.method === "GET")).toBe(true);
  });

  it("checks configured delegation only after an explicit click, without enabling live sessions", async () => {
    api.mockImplementation(async (method, url, body) => {
      calls.push({ method, url, body });
      if (method === "GET") return response({
        state: "configured", issuer: "https://issuer.example.test", jwksUrl: "https://issuer.example.test/.well-known/jwks.json",
        kid: "public-kid", audience: "avatarrouter-api", clientId: "roleplayx-avatarrouter", tokenLifetimeSeconds: 45,
      });
      return response({ accepted: true, checkedAt: "2026-10-27T00:00:00Z", limits: {
        userDailySeconds: 600, userRemainingSeconds: 600, globalDailySeconds: 3600, globalRemainingSeconds: 3600,
        sessionSeconds: 120, cleanupPending: 0, workerReady: true, providerCredits: "unknown", resetsAt: "2026-10-28T00:00:00Z",
      } });
    });
    view(<LiveAvatarIdentityPanel />);
    await screen.findByText("구성됨 · 미검증");
    expect(screen.getByText("public-kid")).toBeTruthy();
    expect(calls.filter(call => call.method === "POST")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "위임 인증 확인" }));
    await screen.findByText("현재 계정의 위임 인증이 수락되었습니다.");
    expect(calls.filter(call => call.method === "POST")).toEqual([{ method: "POST", url: "/api/live-avatar/identity/check", body: {} }]);
    expect(screen.getByText(/테넌트가 공유하는 예약 가능 시간/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "실시간 아바타 시작" })).toBeNull();
  });

  it("defaults to existing mode, blocks live even with consent and never creates a session", async () => {
    view(<LiveAvatarChoice conversationId="pr" voiceMode />);
    expect(screen.getByText("현재: 기존 아바타·음성 사용")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "실시간 아바타 옵션 보기" }));
    await screen.findByText("현재 사용할 수 없음");
    expect(screen.getByText("Base URL·프로젝트 API 키 설정과 실제 연결 확인이 필요합니다.")).toBeTruthy();
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
