// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  scenario: {
    id: "scenario-a", title: "협업 시나리오", description: "상황 설명", introVideoMode: "none",
    personas: [{ id: "actor", name: "상대역", mbti: "INTJ", gender: "male" }],
  },
}));
vi.mock("../../client/src/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  return { apiRequest: mocks.api, queryClient: new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn: async () => [] } },
  }) };
});
vi.mock("../../client/src/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "guest", isGuest: true } }) }));
vi.mock("../../client/src/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, options?: any) => options?.defaultValue ?? key, i18n: { language: "ko" } }),
}));
vi.mock("../../client/src/lib/i18n", () => ({ default: { language: "ko" } }));
vi.mock("wouter", () => ({
  useLocation: () => ["/home", vi.fn()], useSearch: () => "",
  Link: ({ children }: any) => <a>{children}</a>,
}));
// Exercise the real Home view transitions with small child-component contracts.
vi.mock("../../client/src/components/ScenarioSelector", () => ({
  default: (p: any) => <div>
    <button onClick={() => p.onScenarioSelect(mocks.scenario)}>시나리오 선택</button>
    {p.detailScenario && <div role="dialog" aria-label="시나리오 상세 보기">
      {p.detailScenario.title}
      <button onClick={() => p.onDetailScenarioChange(null)}>상세 닫기</button>
    </div>}
  </div>,
}));
vi.mock("../../client/src/components/SimplePersonaSelector", () => ({
  SimplePersonaSelector: (p: any) => <button onClick={() => p.onPersonaSelect(p.personas[0], 4)}>상대역 선택</button>,
}));
vi.mock("../../client/src/components/ChatWindow", () => ({
  default: (p: any) => <div>
    <button onClick={p.onLiveAvatarExit}>라이브 대화 종료</button>
    <button onClick={p.onExit}>일반 대화 나가기</button>
  </div>,
}));
vi.mock("../../client/src/components/PersonalDevelopmentReport", () => ({ default: () => null }));
vi.mock("../../client/src/components/StrategyReflection", () => ({ StrategyReflection: () => null }));
vi.mock("../../client/src/components/VideoIntro", () => ({ VideoIntro: () => null }));
vi.mock("../../client/src/components/PersonalizedDashboard", () => ({ default: () => null }));
vi.mock("../../client/src/components/AppHeader", () => ({ AppHeader: () => null }));
vi.mock("../../client/src/components/GuestDemoBanner", () => ({ GuestDemoBanner: () => null }));

import Home from "../../client/src/pages/home";
import { queryClient } from "../../client/src/lib/queryClient";

beforeEach(() => {
  queryClient.clear();
  queryClient.setQueryData(["/api/scenarios"], [mocks.scenario]);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [] })));
  mocks.api.mockReset();
  mocks.api.mockResolvedValue({ json: async () => ({ id: "conversation", scenarioRunId: "scenario-run" }) });
});
afterEach(() => { cleanup(); queryClient.clear(); vi.unstubAllGlobals(); });

async function enterConversation() {
  render(<QueryClientProvider client={queryClient}><Home /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "시나리오 선택" }));
  fireEvent.click(await screen.findByRole("button", { name: "상대역 선택" }));
  await screen.findByRole("button", { name: "라이브 대화 종료" });
}

describe("live avatar return destination", () => {
  it("opens the same scenario's detail view after exit, and lets it close normally", async () => {
    await enterConversation();
    fireEvent.click(screen.getByRole("button", { name: "라이브 대화 종료" }));
    expect((await screen.findByRole("dialog", { name: "시나리오 상세 보기" })).textContent).toContain("협업 시나리오");
    expect(screen.queryByRole("button", { name: "라이브 대화 종료" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "상세 닫기" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.api).toHaveBeenCalledTimes(1); // Only the original conversation creation.
  });
  it("preserves the normal chat exit destination without opening a detail sheet", async () => {
    await enterConversation();
    fireEvent.click(screen.getByRole("button", { name: "일반 대화 나가기" }));
    await screen.findByRole("button", { name: "시나리오 선택" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
