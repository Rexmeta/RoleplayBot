// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PersonalizedDashboard from "../../client/src/components/PersonalizedDashboard";

const auth = vi.hoisted(() => ({
  user: { id: "learner", name: "Learner", isGuest: false } as {
    id: string; name: string; isGuest: boolean;
  } | null,
  isLoading: false,
  isAuthenticated: true,
}));
vi.mock("../../client/src/hooks/useAuth", () => ({ useAuth: () => auth }));

const emptySummary = () => ({
  resumeScenario: null as null | {
    scenarioRunId: string; scenarioId: string; scenarioName: string; startedAt: string;
  },
  lastCompletedScenario: null,
  recommendedScenarioId: "recommended",
  isRecommendationRechallenge: false,
  totalCompleted: 0, totalScenarios: 1, averageScore: null as number | null,
  totalPracticeCount: 0, categoryScores: [],
});
function ownedSummary(owner: string, score: number) {
  return {
    ...emptySummary(),
    resumeScenario: {
      scenarioRunId: `${owner}-run`, scenarioId: `${owner}-saved`, scenarioName: `${owner}의 진행 중인 연습`,
      startedAt: new Date().toISOString(),
    },
    averageScore: score,
    recommendedScenarioId: `${owner}-recommended`,
  };
}
const recommendationScenarios = ["A", "B"].map(owner => ({
  id: `${owner}-recommended`, title: `${owner}의 추천 연습`,
}));
const response = (data: unknown) => ({ ok: true, json: async () => data }) as Response;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
let client: QueryClient;
let summary: ReturnType<typeof emptySummary>;
function view(props: React.ComponentProps<typeof PersonalizedDashboard> = {}) {
  return <QueryClientProvider client={client}><PersonalizedDashboard {...props} /></QueryClientProvider>;
}
beforeEach(() => {
  auth.user = { id: "learner", name: "Learner", isGuest: false };
  auth.isLoading = false;
  auth.isAuthenticated = true;
  client = new QueryClient({ defaultOptions: {
    queries: { retry: false, gcTime: Infinity, placeholderData: previous => previous },
  } });
  summary = emptySummary();
  client.setQueryData(["/api/dashboard/summary", "learner"], summary);
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
});

it("shows all three personalized cards and opens the recommended scenario", () => {
  const select = vi.fn();
  render(view({ scenarios: [{ id: "recommended", title: "추천 시나리오" } as any],
    onRecommendedScenario: select }));
  expect(screen.getByText("이어하기")).toBeTruthy();
  expect(screen.getByText("마지막으로 연습한 시나리오")).toBeTruthy();
  expect(screen.getByText("오늘의 추천")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "도전하기" }));
  expect(select).toHaveBeenCalledWith("recommended");
});

it("keeps the third card visible even when there is no recommendation", () => {
  client.setQueryData(["/api/dashboard/summary", "learner"], { ...summary, recommendedScenarioId: null });
  render(view());
  expect(screen.getByText("오늘의 추천")).toBeTruthy();
  expect(screen.getByText("추천할 시나리오가 없습니다")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "도전하기" })).toBeNull();
});

it("hides an empty resume card and keeps personal statistics collapsed in the sidebar", () => {
  render(view({ variant: "sidebar" }));
  expect(screen.queryByTestId("dashboard-resume-card")).toBeNull();
  expect(screen.queryByTestId("learning-summary-panel")).toBeNull();
  fireEvent.click(screen.getByTestId("toggle-learning-summary"));
  expect(screen.getByTestId("learning-summary-panel")).toBeTruthy();
  expect(screen.getByTestId("link-mypage-summary").getAttribute("href")).toBe("/mypage");
});

it("resumes the existing run and preserves recommendation access in compact mode", () => {
  client.setQueryData(["/api/dashboard/summary", "learner"], ownedSummary("A", 91));
  const resume = vi.fn();
  const recommended = vi.fn();
  render(view({ variant: "sidebar", onResumeScenario: resume, onRecommendedScenario: recommended,
    scenarios: recommendationScenarios as any }));
  fireEvent.click(screen.getByTestId("button-resume-scenario"));
  expect(resume).toHaveBeenCalledWith("A-run", "A-saved");
  fireEvent.click(screen.getByTestId("toggle-learning-summary"));
  fireEvent.click(screen.getByTestId("button-recommended-scenario"));
  expect(recommended).toHaveBeenCalledWith("A-recommended");
});

it.each(["default", "sidebar"] as const)(
  "isolates cached data across logout and login in the %s dashboard", async variant => {
    auth.user = { id: "A", name: "A", isGuest: false };
    client.setQueryData(["/api/dashboard/summary", "A"], ownedSummary("A", 91));
    // A legacy URL-only cache must not be used by the new observer either.
    client.setQueryData(["/api/dashboard/summary"], ownedSummary("A", 91));
    const pending = deferred<Response>();
    vi.mocked(fetch).mockReturnValue(pending.promise);
    const resume = vi.fn();
    const recommended = vi.fn();
    const props = { variant, scenarios: recommendationScenarios as any,
      onResumeScenario: resume, onRecommendedScenario: recommended };
    const shown = render(view(props));
    if (variant === "sidebar") fireEvent.click(screen.getByTestId("toggle-learning-summary"));
    expect(screen.getByText("A의 진행 중인 연습")).toBeTruthy();
    expect(screen.getByText("A의 추천 연습")).toBeTruthy();

    auth.user = null;
    auth.isAuthenticated = false;
    shown.rerender(view(props));
    expect(shown.container.textContent).toBe("");
    expect(fetch).not.toHaveBeenCalled();

    auth.user = { id: "B", name: "B", isGuest: false };
    auth.isAuthenticated = true;
    shown.rerender(view(props));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(shown.container.textContent).not.toContain("A의");
    expect(shown.container.textContent).not.toContain("91");
    expect(screen.queryByRole("button", { name: "이어서 연습하기" })).toBeNull();
    expect(screen.queryByTestId("button-recommended-scenario")).toBeNull();

    const bSummary = ownedSummary("B", 62);
    await act(async () => pending.resolve(response(bSummary)));
    expect(await screen.findByText("B의 진행 중인 연습")).toBeTruthy();
    expect(screen.getByText("B의 추천 연습")).toBeTruthy();
    expect(shown.container.textContent).not.toContain("A의");
    if (variant === "sidebar") {
      fireEvent.click(screen.getByTestId("button-resume-scenario"));
      fireEvent.click(screen.getByTestId("button-recommended-scenario"));
    } else {
      fireEvent.click(screen.getByRole("button", { name: "이어서 연습하기" }));
      fireEvent.click(screen.getByRole("button", { name: "도전하기" }));
    }
    expect(resume).toHaveBeenCalledWith("B-run", "B-saved");
    expect(recommended).toHaveBeenCalledWith("B-recommended");
    expect(client.getQueryData(["/api/dashboard/summary", "B"])).toEqual(bSummary);
  },
);

it("cancels an old account request and ignores it even if its response arrives late", async () => {
  const a = deferred<Response>();
  const b = deferred<Response>();
  vi.mocked(fetch).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  auth.user = { id: "A", name: "A", isGuest: false };
  const props = { variant: "sidebar" as const, scenarios: recommendationScenarios as any };
  const shown = render(view(props));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const signalA = vi.mocked(fetch).mock.calls[0][1]?.signal;
  expect(signalA).toBeTruthy();
  expect(signalA?.aborted).toBe(false);
  auth.user = { id: "B", name: "B", isGuest: false };
  shown.rerender(view(props));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(signalA?.aborted).toBe(true);
  await act(async () => b.resolve(response(ownedSummary("B", 62))));
  expect(await screen.findByText("B의 진행 중인 연습")).toBeTruthy();
  await act(async () => a.resolve(response(ownedSummary("A", 91))));
  expect(screen.queryByText("A의 진행 중인 연습")).toBeNull();
  expect(client.getQueryData(["/api/dashboard/summary", "B"])).toMatchObject({ averageScore: 62 });
  expect(client.getQueryData(["/api/dashboard/summary", "A"])).toBeUndefined();
});

it("uses only the current account's cache when both accounts have fresh summaries", () => {
  client.setQueryData(["/api/dashboard/summary", "A"], ownedSummary("A", 91));
  client.setQueryData(["/api/dashboard/summary", "B"], ownedSummary("B", 62));
  auth.user = { id: "A", name: "A", isGuest: false };
  const props = { scenarios: recommendationScenarios as any };
  const shown = render(view(props));
  expect(screen.getByText("A의 추천 연습")).toBeTruthy();
  auth.user = { id: "B", name: "B", isGuest: false };
  shown.rerender(view(props));
  expect(screen.getByText("B의 추천 연습")).toBeTruthy();
  expect(shown.container.textContent).not.toContain("A의");
  expect(fetch).not.toHaveBeenCalled();
});

it("does not fall back to another account's summary if the new request fails", async () => {
  client.setQueryData(["/api/dashboard/summary", "learner"], ownedSummary("A", 91));
  const shown = render(view());
  auth.user = { id: "B", name: "B", isGuest: false };
  vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401 } as Response);
  shown.rerender(view());
  await waitFor(() => expect(client.getQueryState(["/api/dashboard/summary", "B"])?.status).toBe("error"));
  expect(shown.container.textContent).toBe("");
  expect(screen.queryByRole("button", { name: "이어서 연습하기" })).toBeNull();
});

it.each(["restoring", "unauthenticated", "guest", "missing-id"] as const)(
  "does not fetch or render private cached summaries while %s", state => {
    if (state === "restoring") auth.isLoading = true;
    if (state === "unauthenticated") auth.isAuthenticated = false;
    if (state === "guest") auth.user!.isGuest = true;
    if (state === "missing-id") auth.user!.id = "";
    const shown = render(view());
    expect(shown.container.textContent).toBe("");
    expect(fetch).not.toHaveBeenCalled();
  },
);
