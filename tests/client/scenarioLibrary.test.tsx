// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ScenarioSelector from "../../client/src/components/ScenarioSelector";

vi.mock("../../client/src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "learner", isGuest: false } }),
}));
vi.mock("../../client/src/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: any) => options?.defaultValue ?? key,
    i18n: { language: "ko" },
  }),
}));
vi.mock("../../client/src/lib/i18n", () => ({ default: { language: "ko" } }));

const scenarios = [
  { id: "negotiation", title: "일정 협상", description: "개발 일정 조율", categoryId: "team",
    estimatedTime: "15분", skills: ["협상"], personas: [{ id: "a", name: "Kim", department: "개발팀" }], context: {} },
  { id: "service", title: "고객 불만 대응", description: "고객 응대", categoryId: "customer",
    estimatedTime: "10분", skills: ["공감"], personas: [{ id: "b", name: "Lee", department: "고객서비스팀" }], context: {} },
];
let client: QueryClient;
const select = vi.fn();
beforeEach(() => {
  select.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["/api/scenarios"], scenarios);
  client.setQueryData(["/api/categories"], [
    { id: "team", name: "팀 협업", order: 0 }, { id: "customer", name: "고객 응대", order: 1 },
  ]);
  client.setQueryData(["/api/bookmarks", "learner"], [{ id: "bookmark", scenarioId: "negotiation" }]);
  client.setQueryData(["/api/scenarios/stats"], []);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });
function show() {
  return render(<QueryClientProvider client={client}>
    <ScenarioSelector onScenarioSelect={select} />
  </QueryClientProvider>);
}

it("searches titles and descriptions without navigating away", () => {
  show();
  expect(screen.getByTestId("scenario-card-negotiation")).toBeTruthy();
  expect(screen.getByTestId("scenario-card-service")).toBeTruthy();
  fireEvent.change(screen.getByTestId("filter-search"), { target: { value: "개발 일정" } });
  expect(screen.getByTestId("scenario-card-negotiation")).toBeTruthy();
  expect(screen.queryByTestId("scenario-card-service")).toBeNull();
  expect(select).not.toHaveBeenCalled();
});

it("filters favorites and can return to all scenarios", () => {
  show();
  fireEvent.click(screen.getByTestId("filter-bookmarked"));
  expect(screen.getByTestId("scenario-card-negotiation")).toBeTruthy();
  expect(screen.queryByTestId("scenario-card-service")).toBeNull();
  fireEvent.click(screen.getByTestId("reset-filters"));
  expect(screen.getByTestId("scenario-card-service")).toBeTruthy();
});

it("keeps bookmarks separate from opening or starting a scenario", async () => {
  show();
  fireEvent.click(screen.getByTestId("button-bookmark-negotiation"));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/bookmarks/negotiation",
    expect.objectContaining({ method: "DELETE", credentials: "include" })));
  expect(select).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("combines category and skill filters and removes each condition independently", () => {
  show();
  fireEvent.click(screen.getByTestId("filter-category-team"));
  fireEvent.click(screen.getByTestId("filter-skill-협상"));
  expect(screen.getByTestId("scenario-card-negotiation")).toBeTruthy();
  expect(screen.queryByTestId("scenario-card-service")).toBeNull();
  fireEvent.click(screen.getByTestId("active-filter-category"));
  expect(screen.queryByTestId("active-filter-category")).toBeNull();
  expect(screen.getByTestId("active-filter-skill")).toBeTruthy();
  fireEvent.click(screen.getByTestId("active-filter-skill"));
  expect(screen.getByTestId("scenario-card-service")).toBeTruthy();
});

it("keeps search available when the desktop panel is collapsed", () => {
  show();
  fireEvent.click(screen.getByTestId("sidebar-toggle"));
  expect(screen.getByTestId("sidebar-toggle").getAttribute("aria-expanded")).toBe("false");
  fireEvent.change(screen.getByTestId("filter-search"), { target: { value: "협상" } });
  expect(screen.queryByTestId("scenario-card-service")).toBeNull();
  fireEvent.click(screen.getByTestId("sidebar-toggle"));
  expect(screen.getByTestId("filter-category-team")).toBeTruthy();
  expect((screen.getByTestId("filter-search") as HTMLInputElement).value).toBe("협상");
});

it("opens a detail overlay, preserves search on close, and starts from details", () => {
  show();
  fireEvent.change(screen.getByTestId("filter-search"), { target: { value: "협상" } });
  fireEvent.click(screen.getByTestId("button-detail-scenario-negotiation"));
  expect(screen.getByTestId("scenario-detail-title").textContent).toBe("일정 협상");
  expect(select).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect((screen.getByTestId("filter-search") as HTMLInputElement).value).toBe("협상");
  fireEvent.click(screen.getByTestId("button-open-detail-negotiation"));
  fireEvent.click(screen.getByTestId("button-detail-start-scenario"));
  expect(select).toHaveBeenCalledWith(scenarios[0]);
});

it("starts a scenario directly without opening its detail overlay", () => {
  show();
  fireEvent.click(screen.getByTestId("button-start-scenario-service"));
  expect(select).toHaveBeenCalledWith(scenarios[1]);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("applies mobile filters in a drawer without duplicating desktop controls", () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })));
  show();
  expect(screen.queryByTestId("scenario-sidebar")).toBeNull();
  fireEvent.click(screen.getByTestId("mobile-filter-toggle"));
  const drawer = screen.getByTestId("mobile-filter-drawer");
  fireEvent.click(within(drawer).getByTestId("filter-category-team"));
  fireEvent.click(within(drawer).getByTestId("filter-skill-협상"));
  expect(screen.getByTestId("mobile-filter-drawer")).toBeTruthy();
  fireEvent.click(within(drawer).getByTestId("mobile-filter-apply"));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByTestId("scenario-card-negotiation")).toBeTruthy();
  expect(screen.queryByTestId("scenario-card-service")).toBeNull();
  expect(screen.getByTestId("active-filter-category")).toBeTruthy();
});

it("treats the six-person option as six or more and keeps advanced conditions removable", () => {
  const group = { ...scenarios[0], id: "large-group", personas: Array.from({ length: 7 }, (_, id) => ({
    id: String(id), department: "개발팀",
  })) };
  client.setQueryData(["/api/scenarios"], [...scenarios, group]);
  show();
  fireEvent.click(screen.getByTestId("toggle-advanced-filters"));
  fireEvent.keyDown(screen.getByTestId("filter-persona-count"), { key: "Enter" });
  fireEvent.click(screen.getByRole("option", { name: "scenario.personaCount6Plus" }));
  expect(screen.getByTestId("scenario-card-large-group")).toBeTruthy();
  expect(screen.queryByTestId("scenario-card-negotiation")).toBeNull();
  fireEvent.click(screen.getByTestId("active-filter-persona-count"));
  fireEvent.keyDown(screen.getByTestId("filter-department"), { key: "Enter" });
  fireEvent.click(screen.getByRole("option", { name: "scenario.devTeam" }));
  expect(screen.getByTestId("scenario-card-negotiation")).toBeTruthy();
  expect(screen.queryByTestId("scenario-card-service")).toBeNull();
  fireEvent.click(screen.getByTestId("active-filter-department"));
  expect(screen.getByTestId("scenario-card-service")).toBeTruthy();
});
