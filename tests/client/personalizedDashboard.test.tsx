// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import PersonalizedDashboard from "../../client/src/components/PersonalizedDashboard";

const query = vi.hoisted(() => ({ data: {} as any, isLoading: false }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => query }));
vi.mock("../../client/src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "learner", name: "Learner", isGuest: false } }),
}));
afterEach(cleanup);
beforeEach(() => {
  query.data = {
    resumeScenario: null, lastCompletedScenario: null,
    recommendedScenarioId: "recommended", isRecommendationRechallenge: false,
    totalCompleted: 0, totalScenarios: 1, averageScore: null,
    totalPracticeCount: 0, categoryScores: [],
  };
});

it("shows all three personalized cards and opens the recommended scenario", () => {
  const select = vi.fn();
  render(<PersonalizedDashboard scenarios={[{ id: "recommended", title: "추천 시나리오" } as any]}
    onRecommendedScenario={select} />);
  expect(screen.getByText("이어하기")).toBeTruthy();
  expect(screen.getByText("마지막으로 연습한 시나리오")).toBeTruthy();
  expect(screen.getByText("오늘의 추천")).toBeTruthy();
  expect(screen.getByText("추천 시나리오")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "도전하기" }));
  expect(select).toHaveBeenCalledWith("recommended");
});

it("keeps the third card visible even when there is no recommendation", () => {
  query.data.recommendedScenarioId = null;
  render(<PersonalizedDashboard />);
  expect(screen.getByText("오늘의 추천")).toBeTruthy();
  expect(screen.getByText("추천할 시나리오가 없습니다")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "도전하기" })).toBeNull();
});

it("hides an empty resume card and keeps personal statistics collapsed in the sidebar", () => {
  render(<PersonalizedDashboard variant="sidebar" />);
  expect(screen.queryByTestId("dashboard-resume-card")).toBeNull();
  expect(screen.queryByTestId("learning-summary-panel")).toBeNull();
  fireEvent.click(screen.getByTestId("toggle-learning-summary"));
  expect(screen.getByTestId("learning-summary-panel")).toBeTruthy();
  expect(screen.getByTestId("link-mypage-summary").getAttribute("href")).toBe("/mypage");
});

it("resumes the existing run and preserves recommendation access in compact mode", () => {
  query.data.resumeScenario = {
    scenarioRunId: "existing-run", scenarioId: "saved-scenario", scenarioName: "진행 중인 연습",
    startedAt: new Date().toISOString(),
  };
  const resume = vi.fn();
  const recommended = vi.fn();
  render(<PersonalizedDashboard variant="sidebar" onResumeScenario={resume}
    onRecommendedScenario={recommended}
    scenarios={[{ id: "recommended", title: "추천 연습" } as any]} />);
  fireEvent.click(screen.getByTestId("button-resume-scenario"));
  expect(resume).toHaveBeenCalledWith("existing-run", "saved-scenario");
  expect(screen.queryByTestId("button-recommended-scenario")).toBeNull();
  fireEvent.click(screen.getByTestId("toggle-learning-summary"));
  fireEvent.click(screen.getByTestId("button-recommended-scenario"));
  expect(recommended).toHaveBeenCalledWith("recommended");
});
