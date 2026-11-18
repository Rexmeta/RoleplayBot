// @vitest-environment happy-dom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { reviewUser } from "../fixtures/adminEditorReviewData";

const state = vi.hoisted(() => ({ pending: false, fail: false }));
const api = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ json: async () => ({}) })));
const empty: unknown[] = [];
let settings = [
  { category: "ai", key: "model_conversation", value: "gemini-2.5-flash" },
  { category: "voice_audio", key: "agc_target_rms", value: "0.15" },
];
const companies = [{ id: "company-review", name: "기존 회사" }, { id: "company-other", name: "다른 회사" }];
const organizations = [{ id: "organization-review", name: "기존 조직", companyId: "company-review" }];
const categories = [{ id: "category-review", name: "기존 카테고리", organizationId: "organization-review" }];
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "admin-1", role: "admin" } }) }));
vi.mock("@/components/AppHeader", () => ({ AppHeader: () => <div>시스템 관리</div> }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, fallback?: unknown) => typeof fallback === "string" ? fallback : key, i18n: { language: "ko" } }),
}));
vi.mock("@/lib/queryClient", () => ({ apiRequest: api, queryClient: { invalidateQueries: vi.fn() } }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[0] === "/api/system-admin/users" ? [reviewUser] :
      queryKey[0] === "/api/system-admin/settings" ? settings :
      queryKey[0] === "/api/system-admin/companies" ? companies :
      queryKey[0] === "/api/admin/organizations-with-hierarchy" ? organizations :
      queryKey[0] === "/api/admin/categories" || queryKey[0] === "/api/categories" ? categories : empty,
    isLoading: false, refetch: vi.fn(),
  }),
  useMutation: (options: any) => ({
    isPending: state.pending,
    mutate: async (value: unknown, callbacks?: any) => {
      try {
        if (state.fail) throw new Error("저장 실패");
        const result = await options.mutationFn(value);
        await options.onSuccess?.(result, value);
        await callbacks?.onSuccess?.(result, value);
      } catch (error) { options.onError?.(error); callbacks?.onError?.(error); }
    },
  }),
}));
vi.mock("@/components/admin/LiveAvatarSettingsPanel", () => ({ LiveAvatarSettingsPanel: () => <div>라이브 아바타 설정</div> }));
vi.mock("@/components/admin/DuplexSettingsPanel", () => ({ default: () => <div>Duplex 설정</div> }));
vi.mock("@/components/admin/DefaultIntroVideoManager", () => ({ DefaultIntroVideoManager: () => null }));
vi.mock("@/components/HierarchyTreeManager", () => ({ HierarchyTreeManager: () => <div>회사 구조 관리</div> }));
vi.mock("@/components/LanguageManager", () => ({ LanguageManager: () => <div>언어 관리</div> }));
vi.mock("@/components/admin/AgentKeyManager", () => ({ AgentKeyManager: () => null }));
vi.mock("@/components/admin/PlansBillingTab", () => ({ PlansBillingTab: () => null }));
vi.mock("@/components/admin/StorePackManager", () => ({ StorePackManager: () => null }));
import SystemAdmin from "@/pages/system-admin";

beforeEach(() => {
  vi.clearAllMocks(); state.pending = false; state.fail = false;
  settings = [
    { category: "ai", key: "model_conversation", value: "gemini-2.5-flash" },
    { category: "voice_audio", key: "agc_target_rms", value: "0.15" },
  ];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 1; });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function editUser() {
  const user = userEvent.setup();
  render(<SystemAdmin />);
  await user.click(screen.getByTestId("button-edit-operator-review"));
  await user.click(await screen.findByRole("menuitem", { name: "systemAdmin.users.edit" }));
  return user;
}
function section(index: number) {
  const editor = screen.getByTestId("dialog-edit-user");
  fireEvent.click(editor.querySelectorAll(".scenario-editor-nav button")[index]);
}

it("uses the shared editor for user permissions and protects unsaved changes", async () => {
  const user = await editUser();
  expect(screen.getByTestId("dialog-edit-user").classList.contains("scenario-editor")).toBe(true);
  await user.click(screen.getByTestId("select-edit-role"));
  await user.click(screen.getByRole("option", { name: "systemAdmin.roles.user", exact: true }));
  section(1);
  section(0);
  await user.click(screen.getByRole("button", { name: "편집 닫기" }));
  expect(await screen.findByRole("alertdialog")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "계속 편집" }));
  expect(api).not.toHaveBeenCalled();
});

it("saves changed role through the existing diff-only user PATCH", async () => {
  const user = await editUser();
  await user.click(screen.getByTestId("select-edit-role"));
  await user.click(screen.getByRole("option", { name: "systemAdmin.roles.admin", exact: true }));
  const editor = screen.getByTestId("dialog-edit-user");
  fireEvent.submit(editor.querySelector("form")!);
  await waitFor(() => expect(api).toHaveBeenCalledWith("PATCH", "/api/system-admin/users/operator-review", expect.objectContaining({ role: "admin" })));
  const body = api.mock.calls.find(call => call[0] === "PATCH")?.[2] as Record<string, unknown>;
  expect(body).not.toHaveProperty("name");
  expect(body).not.toHaveProperty("email");
});

it("preserves user edits on save failure and blocks closing while saving", async () => {
  state.fail = true;
  const user = await editUser();
  await user.click(screen.getByTestId("select-edit-role"));
  await user.click(screen.getByRole("option", { name: "systemAdmin.roles.admin", exact: true }));
  fireEvent.submit(screen.getByTestId("dialog-edit-user").querySelector("form")!);
  await waitFor(() => expect(screen.getByTestId("dialog-edit-user")).toBeTruthy());
  cleanup();
  state.pending = true;
  await editUser();
  expect((screen.getByRole("button", { name: "편집 닫기" }) as HTMLButtonElement).disabled).toBe(true);
});

it("clears organization and category when the operator's company changes", async () => {
  const user = await editUser();
  section(1);
  await user.click(screen.getByTestId("select-edit-company"));
  await user.click(screen.getByRole("option", { name: "다른 회사" }));
  fireEvent.submit(screen.getByTestId("dialog-edit-user").querySelector("form")!);
  await waitFor(() => expect(api).toHaveBeenCalledWith("PATCH", "/api/system-admin/users/operator-review", {
    assignedCompanyId: "company-other", assignedOrganizationId: null, assignedCategoryId: null,
  }));
});

it("hydrates cached non-default settings without treating them as unsaved drafts", async () => {
  settings[0].value = "gemini-2.5-pro";
  settings[1].value = "0.2";
  const user = userEvent.setup();
  render(<SystemAdmin />);
  await user.click(screen.getByTestId("tab-settings"));
  expect(screen.getByTestId("workspace-status").textContent).toBe("변경 없음");
  expect((screen.getByTestId("button-save-settings-top") as HTMLButtonElement).disabled).toBe(true);
});

it("preserves voice drafts on background refresh and discards them only after confirmation", async () => {
  const user = userEvent.setup();
  const rendered = render(<SystemAdmin />);
  await user.click(screen.getByTestId("tab-settings"));
  const input = screen.getAllByRole("spinbutton")[0] as HTMLInputElement;
  fireEvent.change(input, { target: { value: "0.23" } });
  settings = [...settings, { category: "features", key: "operator_video_avatar_enabled", value: "true" }];
  rendered.rerender(<SystemAdmin />);
  expect(input.value).toBe("0.23");
  await user.click(screen.getByTestId("tab-users"));
  expect(await screen.findByRole("alertdialog")).toBeTruthy();
  await user.click(screen.getByTestId("leave-cancel"));
  expect(input.value).toBe("0.23");
  await user.click(screen.getByTestId("tab-users"));
  await user.click(screen.getByTestId("leave-confirm"));
  await user.click(screen.getByTestId("tab-settings"));
  expect((screen.getAllByRole("spinbutton")[0] as HTMLInputElement).value).toBe("0.15");
  expect(api).not.toHaveBeenCalled();
});

it("the top save writes only changed voice settings, never unrelated actions", async () => {
  const user = userEvent.setup();
  render(<SystemAdmin />);
  await user.click(screen.getByTestId("tab-settings"));
  fireEvent.change(screen.getAllByRole("spinbutton")[0], { target: { value: "0.21" } });
  await user.click(screen.getByTestId("button-save-settings-top"));
  await waitFor(() => expect(api.mock.calls.length).toBe(5));
  for (const call of api.mock.calls) {
    expect(call[0]).toBe("PUT");
    expect(call[1]).toBe("/api/system-admin/settings");
    expect((call[2] as { category: string }).category).toBe("voice_audio");
  }
});
