// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ScenarioOverrideManager } from "../ScenarioOverrideManager";

const mocks = vi.hoisted(() => ({ role: "admin" as "admin" | "operator", api: vi.fn(), toast: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { role: mocks.role } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: mocks.api }));

const options = {
  organizations: [
    { id: "org-a", name: "조직 A", companyId: "co-a", isActive: true, company: { id: "co-a", name: "회사 A", isActive: true } },
    { id: "org-b", name: "조직 B", companyId: "co-b", isActive: true, company: { id: "co-b", name: "회사 B", isActive: true } },
  ],
  scenarios: [{ id: "scene-a", title: "대화 시나리오", organizationId: null, categoryId: "category-a" }],
};
const original = {
  terminology: { 고객: "고객님" },
  policyConstraints: ["약속한 일정 안내"],
  forbiddenPhrases: ["그건 안 됩니다"],
  evaluationWeights: { clarity: 2 },
  customIncidents: ["납기 변경 상황"],
};
let stored: any = { id: "record-a", organizationId: "org-a", scenarioId: "scene-a", override: original, updatedAt: "2025-01-01T00:00:00Z" };
let calls: { method: string; url: string; body?: any }[];

function jsonResponse(value: unknown) {
  return { json: async () => value };
}
function setup(role: "admin" | "operator" = "admin") {
  mocks.role = role;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0, queryFn: async () => options }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={queryClient}><ScenarioOverrideManager /></QueryClientProvider>);
  return { ...view, queryClient, user: userEvent.setup() };
}
async function selectAt(user: ReturnType<typeof userEvent.setup>, index: number, label: string) {
  await user.click((await screen.findAllByRole("combobox"))[index]);
  await user.click(await screen.findByRole("option", { name: label }));
}
async function chooseTarget(user: ReturnType<typeof userEvent.setup>, org = "회사 A / 조직 A", scenario = "대화 시나리오") {
  await selectAt(user, 2, org);
  await selectAt(user, 3, scenario);
}

beforeEach(() => {
  stored = { id: "record-a", organizationId: "org-a", scenarioId: "scene-a", override: structuredClone(original), updatedAt: "2025-01-01T00:00:00Z" };
  calls = [];
  mocks.toast.mockReset();
  mocks.api.mockReset().mockImplementation(async (method: string, url: string, body?: any) => {
    calls.push({ method, url, body });
    if (method === "GET" && url.includes("/scenario-overrides/org-")) return jsonResponse(stored?.organizationId === url.split("/").at(-2) && stored?.scenarioId === url.split("/").at(-1) ? stored : null);
    if (method === "POST" && url.endsWith("/preview")) {
      return jsonResponse({
        base: {}, override: body, effective: body, errors: [], organizationActive: true,
        dimensions: [{ key: "clarity", name: "명확성", baseWeight: 2, weight: body.evaluationWeights?.clarity ?? 2, normalizedPercent: 100 }],
      });
    }
    if (method === "PUT") { stored = { id: "record-a", organizationId: "org-a", scenarioId: "scene-a", override: body, updatedAt: "2025-01-02T00:00:00Z" }; return jsonResponse(stored); }
    if (method === "DELETE") { stored = null; return jsonResponse({ ok: true }); }
    if (method === "GET") return jsonResponse([]);
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(options), { status: 200, headers: { "Content-Type": "application/json" } })));
  vi.stubGlobal("confirm", vi.fn(() => true));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("ScenarioOverrideManager", () => {
  it("hydrates the complete record and preserves untouched fields on a partial edit", async () => {
    const { user } = setup();
    await chooseTarget(user);
    expect(await screen.findByText("약속한 일정 안내")).toBeTruthy();
    await user.type(screen.getByLabelText("원래 용어"), "납기");
    await user.type(screen.getByLabelText("조직 용어 지침"), "예정일");
    await user.click(screen.getAllByRole("button", { name: "추가 / 교체" })[0]);
    await waitFor(() => expect(screen.getByRole("button", { name: "변경 사항 저장" }).hasAttribute("disabled")).toBe(false));
    await user.click(screen.getByRole("button", { name: "변경 사항 저장" }));
    await waitFor(() => expect(calls.some(call => call.method === "PUT")).toBe(true));
    const payload = calls.find(call => call.method === "PUT")!.body;
    expect(payload.terminology).toEqual({ 고객: "고객님", 납기: "예정일" });
    expect(payload.policyConstraints).toEqual(original.policyConstraints);
    expect(payload.forbiddenPhrases).toEqual(original.forbiddenPhrases);
    expect(payload.evaluationWeights).toEqual(original.evaluationWeights);
    expect(payload.customIncidents).toEqual(original.customIncidents);
  });

  it("removing the last value does not resurrect the fetched value", async () => {
    const { user } = setup();
    await chooseTarget(user);
    await screen.findByText("약속한 일정 안내");
    await user.click(screen.getByRole("button", { name: "정책 제약 항목 삭제" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "변경 사항 저장" }).hasAttribute("disabled")).toBe(false));
    await user.click(screen.getByRole("button", { name: "변경 사항 저장" }));
    await waitFor(() => expect(calls.some(call => call.method === "PUT")).toBe(true));
    expect(calls.find(call => call.method === "PUT")!.body.policyConstraints).toEqual([]);
    expect(calls.find(call => call.method === "PUT")!.body.terminology).toEqual(original.terminology);
  });

  it("blocks an empty new save and keeps unadded inputs in the dirty guard", async () => {
    stored = null;
    const { user } = setup();
    await chooseTarget(user);
    const save = await screen.findByRole("button", { name: "새 Override 저장" });
    expect(save.hasAttribute("disabled")).toBe(true);
    await user.type(screen.getByLabelText("원래 용어"), "새 용어");
    expect(save.hasAttribute("disabled")).toBe(true);
    vi.mocked(window.confirm).mockReturnValue(false);
    await selectAt(user, 2, "회사 B / 조직 B");
    expect(window.confirm).toHaveBeenCalled();
    expect(screen.getAllByRole("combobox")[2].textContent).toContain("조직 A");
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(calls.some(call => call.method === "PUT")).toBe(false);
  });

  it("rejects an old pair preview while the newly selected pair is waiting for its own result", async () => {
    stored = null;
    let finishA: ((value: any) => void) | undefined;
    let finishB: ((value: any) => void) | undefined;
    const { user } = setup();
    mocks.api.mockImplementation(async (method: string, url: string, body?: any) => {
      calls.push({ method, url, body });
      if (method === "GET" && url.includes("/scenario-overrides/org-")) return jsonResponse(null);
      if (method === "POST" && url.includes("/org-a/")) return new Promise(resolve => { finishA = resolve; });
      if (method === "POST" && url.includes("/org-b/")) return new Promise(resolve => { finishB = resolve; });
      return jsonResponse([]);
    });
    await chooseTarget(user);
    await waitFor(() => expect(finishA).toBeDefined(), { timeout: 2000 });
    await selectAt(user, 2, "회사 B / 조직 B");
    await waitFor(() => expect(finishB).toBeDefined(), { timeout: 2000 });
    finishA!(jsonResponse({ base: {}, override: {}, effective: {}, errors: [], organizationActive: true, dimensions: [{ key: "clarity", name: "명확성", baseWeight: 1, weight: 1, normalizedPercent: 100 }] }));
    await waitFor(() => expect(screen.getAllByRole("combobox")[4].hasAttribute("disabled")).toBe(true));
    finishB!(jsonResponse({ base: {}, override: {}, effective: {}, errors: [], organizationActive: true, dimensions: [{ key: "empathy", name: "공감", baseWeight: 1, weight: 1, normalizedPercent: 100 }] }));
    await user.click((await screen.findAllByRole("combobox"))[4]);
    expect(await screen.findByRole("option", { name: "공감" })).toBeTruthy();
  });

  it("uses organization and scenario filters together and refreshes prefix queries after save", async () => {
    const { user, queryClient } = setup();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await selectAt(user, 0, "회사 A / 조직 A");
    await selectAt(user, 1, "대화 시나리오");
    await waitFor(() => expect(calls.some(call => call.method === "GET" && call.url.includes("organizationId=org-a") && call.url.includes("scenarioId=scene-a"))).toBe(true));
    await chooseTarget(user);
    await screen.findByText("약속한 일정 안내");
    await user.click(screen.getByRole("button", { name: "정책 제약 항목 삭제" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "변경 사항 저장" }).hasAttribute("disabled")).toBe(false));
    await user.click(screen.getByRole("button", { name: "변경 사항 저장" }));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["/api/admin/scenario-overrides"] })));
  });

  it("renders operator mode read-only and reports detail load failures with retry", async () => {
    const { user } = setup("operator");
    await chooseTarget(user);
    const termInput = await screen.findByLabelText("원래 용어");
    expect((termInput as HTMLInputElement).disabled).toBe(true);
    cleanup();
    mocks.api.mockImplementation(async (method: string, url: string) => {
      if (method === "GET" && url.includes("/scenario-overrides/org-")) throw new Error("접근 권한이 없습니다.");
      return jsonResponse([]);
    });
    const retryView = setup();
    await chooseTarget(retryView.user);
    expect(await screen.findByText(/설정 조회에 실패했습니다/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeTruthy();
  });
});
