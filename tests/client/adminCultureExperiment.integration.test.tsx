// @vitest-environment happy-dom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { newCultureValues } from "@shared/cultureMap";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "admin", role: "admin" } }) }));
vi.mock("@/lib/queryClient", () => ({ apiRequest }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("wouter", () => ({ useSearch: () => "" }));
vi.mock("@/components/AppHeader", () => ({ AppHeader: () => <header>콘텐츠 관리</header> }));
vi.mock("@/components/admin/OrganizationCategoryTree", () => ({ OrganizationCategoryTree: () => null }));
vi.mock("@/components/admin/ScenarioManager", () => ({ ScenarioManager: () => null }));
vi.mock("@/components/admin/PersonaManager", () => ({ PersonaManager: () => null }));
vi.mock("@/components/admin/DifficultySettingsTab", () => ({ DifficultySettingsTab: () => null }));
vi.mock("@/components/admin/EvaluationCriteriaManager", () => ({ EvaluationCriteriaManager: () => null }));
vi.mock("@/components/admin/ScenarioOverrideManager", () => ({ ScenarioOverrideManager: () => null }));
import AdminManagement from "@/pages/admin-management";

afterEach(cleanup);
describe("real admin and Culture Map nested tabs", () => {
  it("supports clicking, typing, keyboard focus and selecting with the real sibling panels mounted", async () => {
    const profile = {
      id: "4ecf679c-75ed-420b-a77c-cbdcab04f5b0", version: 1, name: "통합 검증",
      country: "검증", region: "", description: "", dimensions: newCultureValues(),
      sources: [], visibility: "private", ownerId: "admin", createdAt: "", updatedAt: "",
    };
    apiRequest.mockReset();
    apiRequest.mockImplementation(async (_method, path) => ({
      json: async () => path === "/api/admin/culture-profiles" ? [profile] : {
        policy: { provider: "mock", model: "test" }, maxCalls: 32,
      },
    }));
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><AdminManagement /></QueryClientProvider>);
    await user.click(screen.getByRole("tab", { name: "Culture Map", exact: true }));
    // Open and close the real notice popover before changing panels.
    await user.click(screen.getByRole("button", { name: "문화 프로필 자료 안내" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("tab", { name: "새 프로필 만들기", exact: true }));
    await user.click(screen.getByRole("tab", { name: "행동 실험", exact: true }));
    await screen.findByRole("option", { name: /통합 검증/ });
    for (const key of ["name", "role", "player-role", "organization", "personality"]) {
      const input = screen.getByTestId(`experiment-fixed-${key}`) as HTMLInputElement;
      await user.clear(input);
      await user.type(input, "수동 입력");
      expect(input.value).toBe("수동 입력");
      expect(document.activeElement).toBe(input);
    }
    await user.selectOptions(screen.getByTestId("experiment-profile-0"), profile.id);
    await user.selectOptions(screen.getByTestId("experiment-repetitions"), "2");
    screen.getByTestId("experiment-fixed-name").focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByTestId("experiment-fixed-role"));
    await user.click(screen.getByRole("tab", { name: "프로필 관리", exact: true }));
    await user.click(screen.getByRole("tab", { name: "행동 실험", exact: true }));
    expect((screen.getByTestId("experiment-fixed-name") as HTMLInputElement).value).toBe("수동 입력");
    expect((screen.getByTestId("experiment-repetitions") as HTMLSelectElement).value).toBe("2");
    expect(apiRequest.mock.calls.every(([method]) => method === "GET")).toBe(true);
  });
});
