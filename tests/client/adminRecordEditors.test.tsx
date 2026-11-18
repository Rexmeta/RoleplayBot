// @vitest-environment happy-dom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ json: async () => ({}) })));
const state = vi.hoisted(() => ({ pending: false, role: "admin", fail: false, tree: false, categoryLevel: false }));
const empty: unknown[] = [];
const treeValues: Record<string, unknown> = {
  "/api/public/companies": [{ id: "company-1", name: "운영 회사", code: "ORG" }],
  "/api/admin/organizations": [{ id: "org-1", name: "운영 조직", code: "TEAM", description: "기존 설명", companyId: "company-1", isActive: true, company: { id: "company-1", name: "운영 회사", code: "ORG" } }],
  "/api/admin/categories": [{ id: "category-1", name: "기존 카테고리", description: "설명", order: 3, organizationId: "org-1" }],
};
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, fallback?: unknown) => typeof fallback === "string" ? fallback : key }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { role: state.role, assignedCompanyId: "company-1", assignedCategoryId: state.categoryLevel ? "category-1" : null } }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: api, queryClient: { invalidateQueries: vi.fn() } }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[0] === "/api/admin/difficulty-settings" ? undefined : state.tree ? treeValues[queryKey[0]] ?? empty : empty,
    isLoading: false,
  }),
  useMutation: (options: any) => ({
    isPending: state.pending,
    mutate: async (value: unknown) => {
      try {
        if (state.fail) throw new Error("저장 실패");
        const result = await options.mutationFn(value);
        await options.onSuccess?.(result);
      } catch (error) { options.onError?.(error); }
    },
  }),
}));
import { LanguageManager } from "@/components/LanguageManager";
import { HierarchyTreeManager } from "@/components/HierarchyTreeManager";
import { DifficultySettingsTab } from "@/components/admin/DifficultySettingsTab";
import { OperatorOrganizationManager } from "@/components/admin/OperatorOrganizationManager";
import { OrganizationCategoryTree } from "@/components/admin/OrganizationCategoryTree";

beforeEach(() => {
  vi.clearAllMocks(); state.pending = false; state.role = "admin"; state.fail = false; state.tree = false; state.categoryLevel = false;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 1; });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function form() { return document.querySelector(".scenario-editor form") as HTMLFormElement; }
function moveTo(id: string) {
  fireEvent.click(document.querySelector(`.scenario-editor-nav [data-section-id="${id}"]`)!);
}

it("creates a language with the existing POST and preserves drafts between sections", async () => {
  const user = userEvent.setup();
  render(<LanguageManager />);
  await user.click(screen.getByRole("button", { name: "언어 추가" }));
  await user.type(screen.getByLabelText(/언어 코드/), "fr");
  await user.type(screen.getByLabelText(/영어 이름/), "French");
  await user.type(screen.getByLabelText(/네이티브 이름/), "Français");
  fireEvent.click(screen.getByTestId("section-next"));
  fireEvent.click(screen.getByTestId("section-prev"));
  expect((screen.getByLabelText(/영어 이름/) as HTMLInputElement).value).toBe("French");
  fireEvent.submit(form());
  await waitFor(() => expect(api).toHaveBeenCalledWith("POST", "/api/admin/languages", {
    code: "fr", name: "French", nativeName: "Français", displayOrder: 99,
  }));
});

it("keeps failed language edits and confirms discarding them", async () => {
  state.fail = true;
  const user = userEvent.setup();
  render(<LanguageManager />);
  await user.click(screen.getByRole("button", { name: "언어 추가" }));
  await user.type(screen.getByLabelText(/언어 코드/), "fr");
  await user.type(screen.getByLabelText(/영어 이름/), "French");
  await user.type(screen.getByLabelText(/네이티브 이름/), "Français");
  fireEvent.submit(form());
  expect(screen.getByLabelText(/언어 코드/)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "편집 닫기" }));
  expect(await screen.findByRole("alertdialog")).toBeTruthy();
  await user.click(screen.getByTestId("leave-confirm"));
  expect(document.querySelector(".scenario-editor")).toBeNull();
});

it("creates a company through the shared hierarchy editor without changing the API", async () => {
  const user = userEvent.setup();
  render(<HierarchyTreeManager />);
  await user.click(screen.getByRole("button", { name: "회사 추가" }));
  const name = document.querySelector<HTMLInputElement>("#hierarchy-name")!;
  expect(name).toBeTruthy();
  await user.type(name, "테스트 회사");
  fireEvent.submit(form());
  await waitFor(() => expect(api).toHaveBeenCalledWith("POST", "/api/system-admin/companies", expect.objectContaining({ name: "테스트 회사" })));
});

it("retains difficulty behavior and constraints while changing the definition", async () => {
  const user = userEvent.setup();
  render(<DifficultySettingsTab />);
  await user.click(screen.getByTestId("button-edit-1"));
  const originalTone = (screen.getByTestId("input-difficulty-tone-1") as HTMLTextAreaElement).value;
  const name = screen.getByTestId("input-difficulty-name-1");
  await user.clear(name); await user.type(name, "맞춤 난이도");
  moveTo("behavior");
  expect((screen.getByTestId("input-difficulty-tone-1") as HTMLTextAreaElement).value).toBe(originalTone);
  moveTo("constraints");
  await user.click(screen.getByTestId("button-add-constraint-1"));
  const constraints = Array.from(document.querySelectorAll<HTMLTextAreaElement>('[data-testid^="input-difficulty-constraint-1-"]'));
  await user.type(constraints.at(-1)!, "추가 운영 지침");
  fireEvent.submit(form());
  await waitFor(() => expect(api).toHaveBeenCalledWith("PUT", "/api/admin/difficulty-settings/1", expect.objectContaining({
    name: "맞춤 난이도", tone: originalTone, constraints: expect.arrayContaining(["추가 운영 지침"]),
  })));
});

it("prevents editing and dismissal while a difficulty save is pending", async () => {
  state.pending = true;
  const user = userEvent.setup();
  render(<DifficultySettingsTab />);
  await user.click(screen.getByTestId("button-edit-1"));
  expect((screen.getByTestId("button-save-1") as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByTestId("button-cancel-1") as HTMLButtonElement).disabled).toBe(true);
  expect(form().querySelector("fieldset")?.disabled).toBe(true);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(document.querySelector(".scenario-editor")).toBeTruthy();
});

it("preserves company-level operator creation and denies ordinary users", async () => {
  state.role = "operator";
  const user = userEvent.setup();
  const mounted = render(<OperatorOrganizationManager />);
  await user.click(screen.getByRole("button", { name: "조직 추가" }));
  await user.type(screen.getByLabelText(/조직 이름/), "연습 조직");
  fireEvent.submit(form());
  await waitFor(() => expect(api).toHaveBeenCalledWith("POST", "/api/admin/organizations", expect.objectContaining({ name: "연습 조직" })));
  mounted.unmount();
  state.role = "user";
  render(<OperatorOrganizationManager />);
  expect(screen.getByText("조직 관리 권한이 없습니다.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "조직 추가" })).toBeNull();
});

it("creates organizations from the actual content-management tree with their selected company", async () => {
  state.tree = true;
  const user = userEvent.setup();
  render(<OrganizationCategoryTree />);
  await user.click(screen.getByTestId("button-create-org"));
  await user.click(screen.getByTestId("select-org-company"));
  await user.click(screen.getByRole("option", { name: "운영 회사" }));
  fireEvent.click(screen.getByTestId("section-next"));
  await user.type(screen.getByTestId("input-org-name"), "신규 조직");
  fireEvent.submit(form());
  await waitFor(() => expect(api).toHaveBeenCalledWith("POST", "/api/admin/organizations", {
    name: "신규 조직", code: "", description: "", companyId: "company-1",
  }));
});

it("edits an organization's information without changing its company relationship", async () => {
  state.tree = true;
  const user = userEvent.setup();
  render(<OrganizationCategoryTree />);
  await user.click(screen.getByTestId("button-edit-org-org-1"));
  expect((screen.getByTestId("input-org-company-readonly") as HTMLInputElement).readOnly).toBe(true);
  fireEvent.click(screen.getByTestId("section-next"));
  await user.clear(screen.getByTestId("input-org-name"));
  await user.type(screen.getByTestId("input-org-name"), "변경 조직");
  fireEvent.submit(form());
  await waitFor(() => expect(api).toHaveBeenCalledWith("PATCH", "/api/admin/organizations/org-1", {
    name: "변경 조직", code: "TEAM", description: "기존 설명",
  }));
});

it("creates a category under the organization where creation was requested", async () => {
  state.tree = true;
  const user = userEvent.setup();
  render(<OrganizationCategoryTree />);
  await user.click(screen.getByText("운영 조직"));
  await user.click(screen.getByTestId("button-create-category-org-1"));
  expect((screen.getByTestId("input-category-parent-org") as HTMLInputElement).value).toBe("운영 조직");
  fireEvent.click(screen.getByTestId("section-next"));
  await user.type(screen.getByTestId("input-category-name"), "신규 카테고리");
  fireEvent.click(screen.getByTestId("section-next"));
  fireEvent.change(screen.getByTestId("input-category-order"), { target: { value: "7" } });
  fireEvent.submit(form());
  await waitFor(() => expect(api).toHaveBeenCalledWith("POST", "/api/admin/categories", {
    name: "신규 카테고리", description: "", order: 7, organizationId: "org-1",
  }));
});

it("edits category details and display order without reassigning the category", async () => {
  state.tree = true;
  const user = userEvent.setup();
  render(<OrganizationCategoryTree />);
  await user.click(screen.getByText("운영 조직"));
  await user.click(screen.getByTestId("button-edit-category-category-1"));
  fireEvent.click(screen.getByTestId("section-next"));
  await user.clear(screen.getByTestId("input-category-name"));
  await user.type(screen.getByTestId("input-category-name"), "수정 카테고리");
  fireEvent.click(screen.getByTestId("section-next"));
  fireEvent.change(screen.getByTestId("input-category-order"), { target: { value: "8" } });
  fireEvent.submit(form());
  await waitFor(() => expect(api).toHaveBeenCalledWith("PATCH", "/api/admin/categories/category-1", {
    name: "수정 카테고리", description: "설명", order: 8,
  }));
});

it("keeps category-level operators out of organization and category editing", async () => {
  state.tree = true; state.role = "operator"; state.categoryLevel = true;
  const user = userEvent.setup();
  render(<OrganizationCategoryTree />);
  await user.click(screen.getByText("운영 조직"));
  expect(screen.queryByTestId("button-create-org")).toBeNull();
  expect(screen.queryByTestId("button-create-category-org-1")).toBeNull();
  expect(screen.queryByTestId("button-edit-category-category-1")).toBeNull();
});
