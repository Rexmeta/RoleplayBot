// @vitest-environment happy-dom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sampleCriteria } from "../fixtures/contentEditorReviewData";

const controls = vi.hoisted(() => ({ role: "admin", pending: false, failSave: false, withDimension: false, approved: false }));
const dimension = {
  id: "dimension-review", criteriaSetId: "criteria-review", key: "listening", name: "경청 역량",
  description: "질문으로 이해를 확인합니다.", weight: 100, dimensionType: "standard",
  minScore: 1, maxScore: 10, icon: "Ear", color: "#6366f1", isActive: true, displayOrder: 0,
  evaluationPrompt: "근거를 찾아 평가하세요.",
  scoringRubric: [2, 4, 6, 8, 10].map(score => ({ score, label: `${score}점`, description: "", behaviorAnchor: `${score}점 행동 기준` })),
};
const api = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ json: async () => ({ id: "new-set" }) })));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "admin-1", role: controls.role } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/localeUtils", () => ({ useDefaultSourceLocale: () => "ko" }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "ko" } }) }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: api, queryClient: { invalidateQueries: vi.fn() } }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[0] === "/api/admin/evaluation-criteria"
      ? (queryKey.length === 2 ? [{ ...sampleCriteria, status: controls.approved ? "approved" : "draft" }] : queryKey[2] === "ko"
        ? { ...sampleCriteria, status: controls.approved ? "approved" : "draft", dimensions: controls.withDimension ? [dimension] : [] } : [])
      : [],
    isLoading: false, refetch: vi.fn(),
  }),
  useMutation: (options: any) => ({
    isPending: controls.pending,
    mutate: async (value: unknown) => {
      try {
        if (controls.failSave) throw new Error("Save failed");
        const result = await options.mutationFn(value);
        await options.onSuccess?.(result, value);
      } catch (error) { options.onError?.(error); }
    },
  }),
}));
import { EvaluationCriteriaManager } from "@/components/admin/EvaluationCriteriaManager";

beforeEach(() => {
  vi.clearAllMocks();
  controls.role = "admin"; controls.pending = false; controls.failSave = false; controls.withDimension = false; controls.approved = false;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 1; });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function input(id: string, value: string) {
  const field = document.getElementById(id);
  expect(field).toBeTruthy();
  fireEvent.change(field!, { target: { value } });
}
function navigate(index: number) {
  fireEvent.click(document.querySelectorAll(".scenario-editor-nav button")[index]);
}
function create() {
  render(<EvaluationCriteriaManager />);
  fireEvent.click(screen.getByRole("button", { name: "admin.evaluationCriteria.newCriteriaSet" }));
}
function expand() {
  render(<EvaluationCriteriaManager />);
  fireEvent.click(screen.getByRole("button", { name: /협업 대화 평가/ }));
}

it("creates through one shared editor and retains all section values in the existing payload", async () => {
  create();
  expect(screen.getByTestId("evaluation-editor").classList.contains("scenario-editor")).toBe(true);
  input("name", "새 협업 평가");
  input("description", "공통 편집기에서 작성");
  navigate(1);
  fireEvent.click(document.getElementById("useDefault")!);
  navigate(2);
  fireEvent.click(document.getElementById("autoTranslate")!);
  navigate(0);
  expect((document.getElementById("description") as HTMLTextAreaElement).value).toBe("공통 편집기에서 작성");
  fireEvent.click(screen.getByTestId("button-save-evaluation"));
  await waitFor(() => expect(api).toHaveBeenCalledWith("POST", "/api/admin/evaluation-criteria", expect.objectContaining({
    name: "새 협업 평가", description: "공통 편집기에서 작성", categoryId: null, dimensions: [],
  })));
  expect(api.mock.calls.some(call => String(call[1]).includes("auto-translate"))).toBe(false);
});

it("updates the selected set without sending create-only options", async () => {
  expand();
  fireEvent.click(screen.getByRole("button", { name: "admin.evaluationCriteria.edit" }));
  input("edit-name", "수정된 평가 이름");
  navigate(2);
  fireEvent.click(document.getElementById("edit-isActive")!);
  fireEvent.click(screen.getByTestId("button-save-evaluation"));
  await waitFor(() => expect(api).toHaveBeenCalledWith("PUT", "/api/admin/evaluation-criteria/criteria-review", {
    name: "수정된 평가 이름", description: sampleCriteria.description,
    isDefault: false, isActive: false, categoryId: null,
  }));
});

it("guards dirty close and preserves edits after save failure", async () => {
  controls.failSave = true;
  create();
  input("name", "보존할 변경");
  fireEvent.click(screen.getByRole("button", { name: "편집 닫기" }));
  fireEvent.click(screen.getByRole("button", { name: "계속 편집" }));
  fireEvent.click(screen.getByTestId("button-save-evaluation"));
  await waitFor(() => expect((document.getElementById("name") as HTMLInputElement).value).toBe("보존할 변경"));
  expect(screen.getByTestId("evaluation-editor")).toBeTruthy();
});

it("reveals required fields and blocks saving and closing while pending", () => {
  create();
  navigate(2);
  fireEvent.invalid(document.getElementById("name")!);
  expect(document.getElementById("name")!.closest("[hidden]")).toBeNull();
  cleanup();
  controls.pending = true;
  create();
  expect((screen.getByTestId("button-save-evaluation") as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "편집 닫기" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  expect(api).not.toHaveBeenCalled();
});

it("opens dimension creation in the same shell and keeps the behavior-anchor validation gate", () => {
  expand();
  fireEvent.click(screen.getByRole("button", { name: "admin.evaluationCriteria.addDimension" }));
  expect(screen.getByTestId("evaluation-dimension-editor").classList.contains("scenario-editor")).toBe(true);
  input("dim-key", "collaboration");
  input("dim-name", "협업");
  navigate(2);
  expect((screen.getByTestId("button-save-evaluation-dimension") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  expect(api).not.toHaveBeenCalled();
  navigate(0);
  expect((document.getElementById("dim-name") as HTMLInputElement).value).toBe("협업");
});

it("saves dimension values from every section without submitting when choosing an icon", async () => {
  expand();
  fireEvent.click(screen.getByRole("button", { name: "admin.evaluationCriteria.addDimension" }));
  input("dim-key", "collaboration");
  input("dim-name", "협업");
  navigate(2);
  const anchors = screen.getAllByPlaceholderText(/이 점수대에서 관찰되는 구체적 행동 패턴/);
  expect(anchors).toHaveLength(5);
  anchors.forEach((anchor, index) => fireEvent.change(anchor, { target: { value: `${index + 1}단계 관찰 행동` } }));
  navigate(3);
  const colors = Array.from(document.querySelectorAll<HTMLButtonElement>(".scenario-editor-main button"))
    .filter(button => button.style.backgroundColor);
  if (colors.length) fireEvent.click(colors[0]);
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("button-save-evaluation-dimension"));
  await waitFor(() => expect(api).toHaveBeenCalledWith("POST", "/api/admin/evaluation-criteria/criteria-review/dimensions", expect.objectContaining({
    key: "collaboration", name: "협업",
    scoringRubric: expect.arrayContaining([expect.objectContaining({ behaviorAnchor: "1단계 관찰 행동" })]),
  })));
});

it("does not expose creation to a learner", () => {
  controls.role = "user";
  render(<EvaluationCriteriaManager />);
  expect(screen.queryByRole("button", { name: "admin.evaluationCriteria.newCriteriaSet" })).toBeNull();
});

it("edits an existing dimension through the same editor instead of a second inline implementation", async () => {
  controls.withDimension = true;
  expand();
  fireEvent.click(screen.getByText("경청 역량", { exact: true }));
  expect(screen.getByTestId("evaluation-dimension-editor")).toBeTruthy();
  expect((document.getElementById("dim-key") as HTMLInputElement).disabled).toBe(true);
  input("dim-name", "수정된 경청 역량");
  navigate(3);
  fireEvent.click(screen.getByRole("button", { name: "직접 입력 추가" }));
  expect(api).not.toHaveBeenCalled();
  navigate(2);
  input("dim-evaluationPrompt", "상대 발화를 재진술했는지 평가하세요.");
  fireEvent.click(screen.getByTestId("button-save-evaluation-dimension"));
  await waitFor(() => expect(api).toHaveBeenCalledWith("PUT", "/api/admin/evaluation-dimensions/dimension-review", expect.objectContaining({
    key: "listening", name: "수정된 경청 역량", weight: 100,
    evaluationPrompt: "상대 발화를 재진술했는지 평가하세요.", scoringRubric: dimension.scoringRubric,
  })));
});

it("does not open dimension editing for approved sets or learners", () => {
  controls.withDimension = true; controls.approved = true;
  expand();
  fireEvent.click(screen.getByText("경청 역량", { exact: true }));
  expect(screen.queryByTestId("evaluation-dimension-editor")).toBeNull();
  cleanup();
  controls.approved = false; controls.role = "user";
  expand();
  fireEvent.click(screen.getByText("경청 역량", { exact: true }));
  expect(screen.queryByTestId("evaluation-dimension-editor")).toBeNull();
  expect(api).not.toHaveBeenCalled();
});
