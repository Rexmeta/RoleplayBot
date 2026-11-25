// @vitest-environment happy-dom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SimplePersonaSelector } from "@/components/SimplePersonaSelector";

afterEach(cleanup);

const scenario: any = {
  id: "s1", title: "T", description: "D", skills: ["a"], objectives: ["o1"],
  successCriteria: { optimal: "x", good: "y", acceptable: "z" },
  context: { situation: "sit", timeline: "tl", stakes: "st", playerRole: {} },
};
const personas: any[] = [{ id: "p1", name: "Kim", role: "Lead", mbti: "INTJ" }];

function setup(extra: any = {}) {
  const onPersonaSelect = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SimplePersonaSelector personas={personas} completedPersonaIds={[]} onPersonaSelect={onPersonaSelect}
        scenarioTitle="T" scenario={scenario} onBack={() => {}} selectedDifficulty={2} onDifficultyChange={() => {}} {...extra} />
    </QueryClientProvider>,
  );
  return { onPersonaSelect };
}

it("renders left rail with section nav tabs and keeps testids", () => {
  const { onPersonaSelect } = setup();
  expect(screen.getByTestId("scenario-detail-rail")).toBeTruthy();
  const nav = screen.getByTestId("scenario-section-nav");
  expect(nav.getAttribute("role")).toBe("tablist");
  expect(screen.getAllByRole("tab")).toHaveLength(4);
  ["overview", "situation", "objectives", "criteria"].forEach((v) => expect(screen.getByTestId(`section-nav-${v}`)).toBeTruthy());
  expect(screen.getByTestId("difficulty-1")).toBeTruthy();
  expect(screen.getByTestId("back-to-scenarios")).toBeTruthy();
  expect(screen.getByTestId("persona-card-p1")).toBeTruthy();
  fireEvent.click(screen.getByTestId("view-persona-p1"));
  expect(onPersonaSelect).not.toHaveBeenCalled();
  expect(screen.getByTestId("persona-detail-dialog")).toBeTruthy();
  fireEvent.click(screen.getByTestId("select-persona-p1"));
  expect(onPersonaSelect).toHaveBeenCalledWith(personas[0], 2);
});

it("locks difficulty when personas are completed", () => {
  setup({ completedPersonaIds: ["p1"] });
  expect((screen.getByTestId("difficulty-1") as HTMLButtonElement).disabled).toBe(true);
});

it("shows live avatar availability on each partner card", () => {
  setup({ personas: [{ ...personas[0], liveAvatarConfigured: true }, { id: "p2", name: "Lee", role: "Dev" }] });
  expect(screen.getAllByTestId("live-avatar-badge-on")).toHaveLength(1);
  expect(screen.getAllByTestId("live-avatar-badge-off")).toHaveLength(1);
});
