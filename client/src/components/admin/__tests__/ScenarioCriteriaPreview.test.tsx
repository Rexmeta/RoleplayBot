// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ScenarioCriteriaPreview } from "../ScenarioCriteriaPreview";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queryClient", () => ({ apiRequest: api }));
afterEach(() => { cleanup(); api.mockReset(); });
const rubric = { id: "one", name: "갈등 평가", status: "draft", dimensions: [{
  id: "dimension", key: "resolution", name: "갈등 해결", description: "대안을 제시합니다.",
  weight: 60, minScore: 0, maxScore: 10, isActive: true,
  scoringRubric: [{ score: 8, label: "우수", description: "실행 가능한 대안", behaviorAnchor: "다른 방법을 제안합니다.",
    positiveIndicators: ["대안 제시"], negativeIndicators: ["책임 회피"] }],
}] };
function setup(id?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (value?: string) => <QueryClientProvider client={client}><ScenarioCriteriaPreview criteriaSetId={value} /></QueryClientProvider>;
  return { ...render(view(id)), view };
}
describe("scenario rubric preview in create and edit forms", () => {
  it("shows default guidance without requesting a specific rubric", () => {
    setup();
    expect(screen.getByText(/특정 세트를 선택하면/)).toBeTruthy();
    expect(api).not.toHaveBeenCalled();
  });
  it("loads the initial edit selection and exposes dimension details and score bands", async () => {
    api.mockResolvedValue({ json: async () => rubric });
    setup("one");
    expect(await screen.findByText("갈등 해결")).toBeTruthy();
    expect(screen.getByText("가중치 60")).toBeTruthy();
    expect(screen.getByText("점수 0–10")).toBeTruthy();
    expect(screen.getByText(/아직 승인되지 않은/)).toBeTruthy();
    await userEvent.click(screen.getByText("점수별 기준 및 행동 지표 보기"));
    expect(screen.getByText("긍정 지표: 대안 제시")).toBeTruthy();
    expect(screen.getByText("부정 지표: 책임 회피")).toBeTruthy();
    expect(api).toHaveBeenCalledWith("GET", "/api/admin/evaluation-criteria/one");
  });
  it("does not show stale indicators after switching to another set or default", async () => {
    let resolveSecond: (value: unknown) => void = () => {};
    api.mockImplementation(async (_method, url) => url.endsWith("/two")
      ? new Promise(resolve => { resolveSecond = resolve; })
      : { json: async () => rubric });
    const { rerender, view } = setup("one");
    await screen.findByText("갈등 해결");
    rerender(view("two"));
    expect(screen.queryByText("갈등 해결")).toBeNull();
    await waitFor(() => expect(api).toHaveBeenCalledWith("GET", "/api/admin/evaluation-criteria/two"));
    resolveSecond({ json: async () => ({ id: "two", name: "두 번째 기준", dimensions: [] }) });
    expect(await screen.findByText("등록된 하위 평가 지표가 없습니다.")).toBeTruthy();
    rerender(view());
    expect(screen.queryByText("두 번째 기준")).toBeNull();
  });
  it("preserves selection on error and supports retry", async () => {
    api.mockRejectedValueOnce(new Error("403")).mockResolvedValue({ json: async () => rubric });
    setup("one");
    expect(await screen.findByRole("alert")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("갈등 해결")).toBeTruthy();
  });
});
