// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { summarizeOverrideChange } from "@shared/organizationOverrideAudit";
import { ScenarioOverrideHistory } from "../ScenarioOverrideHistory";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queryClient", () => ({ apiRequest: api }));
const entry = {
  id: "audit-1", actorUserId: "admin-123", actorName: "설정 관리자", organizationId: "org-a",
  action: "scenario_override_saved", targetId: "scene", createdAt: "2026-11-06T10:00:00Z",
  metadata: summarizeOverrideChange(null, { policyConstraints: ["private text"], evaluationWeights: { empathy: 3 } }),
};
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = render(<QueryClientProvider client={client}><ScenarioOverrideHistory organizationId="org-a" scenarioId="scene" /></QueryClientProvider>);
  return { client, ...view, user: userEvent.setup() };
}
beforeEach(() => api.mockReset());
afterEach(cleanup);

describe("organization override history", () => {
  it("shows actor, time, action, before/after summaries and pagination with scoped requests", async () => {
    api.mockResolvedValueOnce({ json: async () => ({ entries: [entry], hasMore: true }) })
      .mockResolvedValueOnce({ json: async () => ({ entries: [{ ...entry, id: "audit-2", action: "scenario_override_deleted" }], hasMore: false }) });
    const { user } = setup();
    expect(await screen.findByText("admin-123")).toBeTruthy();
    expect(screen.getByText("설정 관리자")).toBeTruthy();
    expect(screen.getByText("저장")).toBeTruthy();
    expect(screen.getByText("이전: 조직 설정 없음")).toBeTruthy();
    expect(screen.getByText(/이후:.*정책 제약 1개/)).toBeTruthy();
    expect(screen.queryByText("private text")).toBeNull();
    expect(api).toHaveBeenLastCalledWith("GET", expect.stringContaining("/organization/org-a/audit-logs?limit=25&offset=0&scenarioId=scene"));
    await user.click(screen.getByRole("button", { name: "다음 이력" }));
    expect(await screen.findByText("삭제")).toBeTruthy();
    expect(api).toHaveBeenLastCalledWith("GET", expect.stringContaining("offset=25"));
    expect(screen.getByRole("button", { name: "다음 이력" }).hasAttribute("disabled")).toBe(true);
  });
  it("shows an explicit error instead of treating failed reads as empty, and can retry", async () => {
    api.mockRejectedValueOnce(new Error("denied")).mockResolvedValueOnce({ json: async () => ({ entries: [], hasMore: false }) });
    const { user } = setup();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("기록된 변경 이력이 없습니다.")).toBeNull();
    await user.click(screen.getByRole("button", { name: "이력 새로고침" }));
    expect(await screen.findByText("기록된 변경 이력이 없습니다.")).toBeTruthy();
  });
  it("refreshes after a save/delete invalidates the existing override query family", async () => {
    api.mockResolvedValue({ json: async () => ({ entries: [], hasMore: false }) });
    const { client } = setup();
    await screen.findByText("기록된 변경 이력이 없습니다.");
    api.mockResolvedValue({ json: async () => ({ entries: [entry], hasMore: false }) });
    await client.invalidateQueries({ queryKey: ["/api/admin/scenario-overrides"] });
    expect(await screen.findByText("admin-123")).toBeTruthy();
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
  });
});
