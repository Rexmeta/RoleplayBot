// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CultureExperimentResult } from "@shared/cultureExperiment";
import type { CultureProfile } from "@shared/cultureMap";

const { apiRequest, authState } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  authState: { user: { id: "admin-1", role: "admin" as string } },
}));
vi.mock("@/lib/queryClient", () => ({ apiRequest }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => authState }));

import { CultureBehaviorExperiment } from "@/components/admin/cultureMap/CultureBehaviorExperiment";

const profile: CultureProfile = {
  id: "4ecf679c-75ed-420b-a77c-cbdcab04f5b0",
  ownerId: "admin-1",
  name: "업무 대화 프로필",
  country: "한국",
  region: "수도권",
  description: "검증용",
  dimensions: {
    communicating: 60, evaluating: 50, persuading: 50, leading: 50,
    deciding: 50, trusting: 50, disagreeing: 50, scheduling: 50,
  },
  sources: [],
  visibility: "private",
  version: 3,
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
};
const config = {
  policy: { provider: "test-provider", model: "fixed-model" },
  situations: [{
    id: "negative-feedback",
    title: "부정적 피드백",
    situation: "보고서에 근거가 빠져 있다.",
    userMessage: "부족한 점을 말씀해 주세요.",
  }],
  notice: "통제 비교",
  maxCalls: 32,
};
const result = (mode: "mock" | "provider" = "mock"): CultureExperimentResult => ({
  id: "run-001",
  startedAt: "2025-01-01T00:00:00.000Z",
  finishedAt: "2025-01-01T00:00:02.000Z",
  mode,
  fixed: {
    name: "업무 담당자",
    personality: "책임감 있고 신중하다.",
    organization: "제품 개발팀",
    role: "프로젝트 실무 담당자",
    playerRole: "프로젝트 책임자",
  },
  policy: { provider: "test-provider", model: "fixed-model" },
  repetitions: 1,
  variants: [
    { id: "off", label: "문화 OFF", culture: { enabled: false } },
    {
      id: "profile-variant",
      label: "한국 · 업무 대화 프로필",
      culture: {
        enabled: true,
        profileId: profile.id,
        profileVersion: profile.version,
        intensity: 50,
        overrides: {},
        snapshotVersion: 1,
        name: profile.name,
        country: profile.country,
        region: profile.region,
        dimensions: profile.dimensions,
        sources: [],
      },
    },
  ],
  cases: [
    { situationId: "negative-feedback", variantId: "off", repetition: 1, status: "completed", content: "OFF 결과", durationMs: 120, usage: { inputTokens: 20, outputTokens: 10 }, estimatedCostUsd: 0 },
    { situationId: "negative-feedback", variantId: "profile-variant", repetition: 1, status: "completed", content: "문화 적용 결과", durationMs: 140, usage: { inputTokens: 22, outputTokens: 12 }, estimatedCostUsd: 0 },
  ],
  notice: "통제 비교",
  costNotice: "추정 비용",
  knownEstimatedCostUsd: 0,
  unknownCostCases: 0,
});

function response(data: unknown) {
  return Promise.resolve({ json: async () => data } as Response);
}
function renderWithQuery() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><CultureBehaviorExperiment /></QueryClientProvider>);
}

describe("Culture behavior experiment", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    authState.user = { id: "admin-1", role: "admin" };
    apiRequest.mockImplementation(async (method: string, url: string, body?: { mode?: "mock" | "provider" }) => {
      if (method === "GET" && url === "/api/admin/culture-profiles") return response([profile]);
      if (method === "GET" && url === "/api/simulation/culture-experiment/config") return response(config);
      return response(result(body?.mode ?? "mock"));
    });
  });
  afterEach(cleanup);

  it("allows the same country at different intensities and preserves those values in the paid request", async () => {
    renderWithQuery();
    await screen.findByRole("option", { name: /한국 · 업무 대화 프로필/ });
    fireEvent.change(screen.getByTestId("experiment-profile-0"), { target: { value: profile.id } });
    fireEvent.change(screen.getByTestId("experiment-intensity-0"), { target: { value: "0" } });
    fireEvent.click(screen.getByTestId("experiment-add-variant"));
    fireEvent.change(screen.getByTestId("experiment-profile-1"), { target: { value: profile.id } });
    fireEvent.change(screen.getByTestId("experiment-intensity-1"), { target: { value: "100" } });
    fireEvent.click(screen.getByTestId("experiment-paid-acknowledgement"));
    expect((screen.getByTestId("experiment-run-provider") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("experiment-run-provider"));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("POST", "/api/simulation/culture-experiment", expect.objectContaining({
      variants: [
        expect.objectContaining({ profileId: profile.id, intensity: 0 }),
        expect.objectContaining({ profileId: profile.id, intensity: 100 }),
      ],
    })));
  });

  it("hides the experiment for operators without fetching configuration or invoking providers", () => {
    authState.user.role = "operator";
    renderWithQuery();
    expect(screen.queryByTestId("culture-behavior-experiment")).toBeNull();
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("shows partial failures and exports the frozen run with manual observations instead of learner grades", async () => {
    const partial = result("provider");
    partial.cases[1] = { ...partial.cases[1], status: "failed", content: "일부 받은 응답", error: "스트림 실패", usage: null, estimatedCostUsd: null };
    partial.unknownCostCases = 1;
    apiRequest.mockImplementation(async (method: string, url: string) => {
      if (method === "GET" && url === "/api/admin/culture-profiles") return response([profile]);
      if (method === "GET" && url === "/api/simulation/culture-experiment/config") return response(config);
      return response(partial);
    });
    renderWithQuery();
    await screen.findByRole("option", { name: /한국 · 업무 대화 프로필/ });
    fireEvent.change(screen.getByTestId("experiment-profile-0"), { target: { value: profile.id } });
    fireEvent.click(screen.getByTestId("experiment-paid-acknowledgement"));
    fireEvent.click(screen.getByTestId("experiment-run-provider"));
    expect(await screen.findByText("일부 받은 응답")).toBeTruthy();
    expect(screen.getByText("스트림 실패")).toBeTruthy();
    expect(screen.getAllByText(/수동 행동 관찰 · 학습자 점수 아님/)).toHaveLength(2);
    fireEvent.change(screen.getByTestId("observation-negative-feedback-off-1-explicitness"), { target: { value: "요구를 직접 표현" } });
    fireEvent.change(screen.getByTestId("evidence-negative-feedback-off-1-explicitness"), { target: { value: "OFF 결과" } });
    const createUrl = vi.fn(() => "blob:test");
    const revokeUrl = vi.fn();
    vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL: createUrl, revokeObjectURL: revokeUrl }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      fireEvent.click(screen.getByTestId("experiment-download-json"));
      const exported = JSON.parse(await createUrl.mock.calls[0][0].text());
      expect(exported.result.id).toBe("run-001");
      expect(exported.observations["negative-feedback::off::1::explicitness"]).toEqual({ value: "요구를 직접 표현", evidence: "OFF 결과" });
      expect(exported.result).not.toHaveProperty("learnerScore");
      expect(exported.result.cases[1].estimatedCostUsd).toBeNull();
      expect(click).toHaveBeenCalled();
      expect(revokeUrl).toHaveBeenCalledWith("blob:test");
    } finally {
      click.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("does not call the experiment endpoint on render and requires consent before paid provider execution", async () => {
    renderWithQuery();
    await screen.findByRole("option", { name: /한국 · 업무 대화 프로필/ });
    expect(apiRequest.mock.calls.filter(([method, url]) => method === "POST" && url === "/api/simulation/culture-experiment")).toHaveLength(0);

    fireEvent.change(screen.getByLabelText("변형 1 · 국가/프로필"), { target: { value: profile.id } });
    const providerButton = screen.getByTestId("experiment-run-provider") as HTMLButtonElement;
    expect(providerButton.disabled).toBe(true);
    fireEvent.click(providerButton);
    expect(apiRequest.mock.calls.filter(([method, url]) => method === "POST" && url === "/api/simulation/culture-experiment")).toHaveLength(0);

    fireEvent.click(screen.getByTestId("experiment-paid-acknowledgement"));
    fireEvent.click(providerButton);
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("POST", "/api/simulation/culture-experiment", expect.objectContaining({
      mode: "provider",
      confirmPaidRun: true,
      variants: [expect.objectContaining({ enabled: true, profileId: profile.id, profileVersion: 3, overrides: {} })],
    })));
    expect((await screen.findByTestId("experiment-result-mode")).textContent).toContain("PROVIDER");
  });

  it("runs mock mode and preserves its frozen result after a later provider error", async () => {
    renderWithQuery();
    await screen.findByRole("option", { name: /한국 · 업무 대화 프로필/ });
    fireEvent.change(screen.getByLabelText("변형 1 · 국가/프로필"), { target: { value: profile.id } });

    fireEvent.click(screen.getByTestId("experiment-run-mock"));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("POST", "/api/simulation/culture-experiment", expect.objectContaining({
      mode: "mock",
      confirmPaidRun: false,
      fixed: expect.objectContaining({ name: "업무 담당자" }),
    })));
    expect(await screen.findByText("OFF 결과")).toBeTruthy();
    expect(screen.getByTestId("experiment-result-mode").textContent).toContain("MOCK");

    fireEvent.change(screen.getByTestId("experiment-fixed-name"), { target: { value: "화면에서 바꾼 이름" } });
    fireEvent.click(screen.getByTestId("experiment-paid-acknowledgement"));
    apiRequest.mockImplementation(async (method: string, url: string) => {
      if (method === "GET" && url === "/api/admin/culture-profiles") return response([profile]);
      if (method === "GET" && url === "/api/simulation/culture-experiment/config") return response(config);
      throw new Error("provider timed out");
    });
    fireEvent.click(screen.getByTestId("experiment-run-provider"));

    expect((await screen.findByTestId("experiment-run-error")).textContent).toContain("provider timed out");
    expect(screen.getByTestId("experiment-result-mode").textContent).toContain("MOCK");
    expect(screen.getByText("이전 실행 결과")).toBeTruthy();
    fireEvent.click(screen.getByText("이 실행의 고정 입력과 출처 보기"));
    expect(screen.getByText(/"name": "업무 담당자"/)).toBeTruthy();
    expect(screen.queryByText(/"name": "화면에서 바꾼 이름"/)).toBeNull();
  });
});
