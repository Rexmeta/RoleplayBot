// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CultureProfile, CultureProfileInput, CultureSnapshot } from "@shared/cultureMap";
import { CULTURE_DIMENSIONS, SYSTEM_CULTURE_OWNER_ID, EDITORIAL_CULTURE_NOTICE } from "@shared/cultureMap";
import { countryCultureSeedProfiles } from "../../server/services/cultureMap/dataset";

const { apiRequest, invalidateQueries, authState } = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  invalidateQueries: vi.fn(),
  authState: { user: { id: "admin-1", role: "admin" as string } },
}));
vi.mock("@/lib/queryClient", () => ({ apiRequest, queryClient: { invalidateQueries } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => authState }));
vi.mock("@/components/ui/label", () => ({ Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => <label {...props}>{children}</label> }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, disabled, children }: any) => <select aria-label={value ? "selection" : undefined} value={value} disabled={disabled} onChange={(event) => onValueChange?.(event.target.value)}>{children}</select>,
  SelectTrigger: ({ children, ...props }: any) => <span {...props}>{children}</span>,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
  SelectValue: () => null,
}));
vi.mock("@/components/ui/slider", () => ({ Slider: ({ value, onValueChange, ...props }: any) => <input type="range" value={value?.[0] ?? 0} onChange={(event) => onValueChange?.([Number(event.target.value)])} {...props} /> }));

import { ActorCultureEditor } from "@/components/admin/cultureMap/ActorCultureEditor";
import { CultureProfilesManager } from "@/components/admin/cultureMap/CultureProfilesManager";
import { CultureMapWorkspace } from "@/components/admin/cultureMap/CultureMapWorkspace";
import { getScenarioPersonaTemplateId, stableActorIdForTemplate } from "@/components/admin/cultureMap/actorIdentity";

vi.mock("@/components/admin/cultureMap/CultureBehaviorExperiment", () => ({
  CultureBehaviorExperiment: () => <div>문화 행동 실험 화면</div>,
}));

const dimensions = (communicating: number) => ({
  communicating, evaluating: 50, persuading: 50, leading: 50,
  deciding: 50, trusting: 50, disagreeing: 50, scheduling: 50,
});
const input: CultureProfileInput = {
  name: "상황별 업무 컨텍스트", country: "한국", region: "수도권", description: "테스트 정의",
  dimensions: dimensions(82), sources: [], visibility: "private",
};
const profile: CultureProfile = {
  ...input, id: "profile-1", ownerId: "admin-1", version: 2,
  createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-02-01T00:00:00.000Z",
};
const secondProfile: CultureProfile = {
  ...input, name: "다른 프로필", country: "일본", region: "간사이",
  dimensions: dimensions(44), id: "profile-2", ownerId: "admin-1", version: 1,
  createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-02-01T00:00:00.000Z",
};
const oldInput = { ...input, name: "이전 문화 버전", dimensions: dimensions(17) };
const snapshot: CultureSnapshot = {
  enabled: true, snapshotVersion: 1, profileId: "deleted-profile", profileVersion: 4,
  intensity: 63, overrides: {}, name: "삭제된 프로필 스냅샷", country: "싱가포르", region: "중부",
  dimensions: dimensions(31), sources: [],
};

function response(data: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: async () => data } as Response);
}
function renderWithQuery(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>), client };
}

describe("Culture Map actor and profile management", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView ??= vi.fn();
    apiRequest.mockReset();
    authState.user = { id: "admin-1", role: "admin" };
    apiRequest.mockImplementation(async (method: string, url: string, body?: unknown) => {
      if (method === "GET" && url === "/api/admin/culture-profiles") return response([profile, secondProfile]);
      if (method === "GET" && url.endsWith("/profile-1/versions")) {
        return response([
          { version: 1, content: oldInput, createdAt: "2025-01-10T00:00:00.000Z" },
          { version: 2, content: input, createdAt: "2025-02-01T00:00:00.000Z" },
        ]);
      }
      if (method === "POST" && url === "/api/admin/culture-profiles") return response({ ...body as object, id: "created", ownerId: "admin-1", version: 1 });
      if (method === "POST" && url.endsWith("/duplicate")) return response({ ...profile, id: "clone-1", ownerId: "admin-1" });
      if (method === "PUT" && url === "/api/admin/culture-profiles/profile-1") return response({ ...profile, ...(body as object), version: 3 });
      return response([]);
    });
  });
  afterEach(cleanup);
  it("places a real creation tab to the right of management and displays its form in the tab page, never a popup", async () => {
    const user = userEvent.setup();
    renderWithQuery(<CultureMapWorkspace />);
    const navigation = screen.getByRole("tablist", { name: "Culture Map 기능" });
    const profilesTab = within(navigation).getByRole("tab", { name: "프로필 관리" });
    const create = within(navigation).getByRole("tab", { name: "새 프로필 만들기" });
    const experimentTab = within(navigation).getByRole("tab", { name: "행동 실험" });
    expect(profilesTab.nextElementSibling).toBe(create);
    expect(create.compareDocumentPosition(experimentTab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("button", { name: "새 프로필 만들기" })).toBeNull();
    expect(within(screen.getByRole("region", { name: "Culture Map 프로필 관리" })).queryByRole("button", { name: "새 프로필 만들기" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(create);
    expect(create.getAttribute("aria-selected")).toBe("true");
    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(create.id);
    const form = within(panel).getByRole("form", { name: "새 프로필 만들기" });
    expect(within(form).getByLabelText("프로필 이름 *")).toBeTruthy();
    expect(within(form).getAllByRole("slider")).toHaveLength(8);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("list", { name: "문화 프로필 목록" })).toBeNull();
    expect(apiRequest.mock.calls.some(([method]) => method !== "GET")).toBe(false);
  });

  it("preserves the creation draft when navigating through management and experiments; cancel returns to management", async () => {
    const user = userEvent.setup();
    renderWithQuery(<CultureMapWorkspace />);
    const experimentTab = screen.getByRole("tab", { name: "행동 실험" });
    const create = screen.getByRole("tab", { name: "새 프로필 만들기" });
    await user.click(create);
    await user.type(within(screen.getByRole("form", { name: "새 프로필 만들기" })).getByLabelText("프로필 이름 *"), "유지할 초안");
    await user.click(screen.getByRole("tab", { name: "프로필 관리" }));
    await user.click(experimentTab);
    expect(screen.getByText("문화 행동 실험 화면")).toBeTruthy();
    await user.click(create);
    expect((within(screen.getByRole("form", { name: "새 프로필 만들기" })).getByLabelText("프로필 이름 *") as HTMLInputElement).value).toBe("유지할 초안");
    await user.click(screen.getByRole("button", { name: "취소" }));
    const management = screen.getByRole("tab", { name: "프로필 관리" });
    await waitFor(() => expect(document.activeElement).toBe(management));
    expect(management.getAttribute("aria-selected")).toBe("true");
    await user.click(create);
    expect((within(screen.getByRole("form", { name: "새 프로필 만들기" })).getByLabelText("프로필 이름 *") as HTMLInputElement).value).toBe("");
  });

  it("creates from the tab page, refreshes saved profiles, and returns to management with a fresh creation form", async () => {
    const user = userEvent.setup();
    renderWithQuery(<CultureMapWorkspace />);
    const create = screen.getByRole("tab", { name: "새 프로필 만들기" });
    await user.click(create);
    const form = within(screen.getByRole("form", { name: "새 프로필 만들기" }));
    await user.type(form.getByLabelText("프로필 이름 *"), "페이지 생성");
    await user.type(form.getByLabelText("국가/문화권 *"), "한국");
    await user.click(form.getByRole("button", { name: "프로필 생성" }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("POST", "/api/admin/culture-profiles", expect.objectContaining({
      name: "페이지 생성", country: "한국", visibility: "private", dimensions: expect.objectContaining({ communicating: 50 }),
    })));
    await waitFor(() => expect(screen.getByRole("tab", { name: "프로필 관리" }).getAttribute("aria-selected")).toBe("true"));
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/admin/culture-profiles"] });
    await user.click(create);
    expect((within(screen.getByRole("form", { name: "새 프로필 만들기" })).getByLabelText("프로필 이름 *") as HTMLInputElement).value).toBe("");
  });

  it("shows creation validation and server errors inline without losing the page draft", async () => {
    const user = userEvent.setup();
    apiRequest.mockImplementation(async (method: string) => {
      if (method === "POST") throw new Error("생성 서버 오류");
      return response([profile]);
    });
    renderWithQuery(<CultureMapWorkspace />);
    await user.click(screen.getByRole("tab", { name: "새 프로필 만들기" }));
    const form = within(screen.getByRole("form", { name: "새 프로필 만들기" }));
    await user.click(form.getByRole("button", { name: "프로필 생성" }));
    expect(form.getByRole("alert").textContent).toContain("프로필 이름과 국가/지역");
    expect(apiRequest.mock.calls.some(([method]) => method === "POST")).toBe(false);
    await user.type(form.getByLabelText("프로필 이름 *"), "오류 후 유지");
    await user.type(form.getByLabelText("국가/문화권 *"), "한국");
    await user.click(form.getByRole("button", { name: "프로필 생성" }));
    await waitFor(() => expect(form.getByRole("alert").textContent).toContain("생성 서버 오류"));
    expect((form.getByLabelText("프로필 이름 *") as HTMLInputElement).value).toBe("오류 후 유지");
    expect(screen.getByRole("tab", { name: "새 프로필 만들기" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("allows operator creation in its page without exposing shared-profile or experiment controls", async () => {
    authState.user = { id: "operator-1", role: "operator" };
    const user = userEvent.setup();
    renderWithQuery(<CultureMapWorkspace />);
    await user.click(screen.getByRole("tab", { name: "새 프로필 만들기" }));
    expect(screen.getByRole("tab", { name: "새 프로필 만들기" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("form", { name: "새 프로필 만들기" })).toBeTruthy();
    expect(screen.queryByLabelText("공유 프로필")).toBeNull();
    expect(screen.queryByRole("tab", { name: "행동 실험" })).toBeNull();
  });

  it("shows all eight saved values on compact cards with title before the comparison control", async () => {
    renderWithQuery(<CultureProfilesManager />);
    const list = await screen.findByRole("list", { name: "문화 프로필 목록" });
    const row = within(list).getAllByRole("listitem")[0];
    const card = within(row);
    expect(card.getAllByRole("meter")).toHaveLength(8);
    for (const dimension of CULTURE_DIMENSIONS) {
      const meter = card.getByRole("meter", { name: dimension.label });
      expect(meter.getAttribute("aria-valuenow")).toBe(String(profile.dimensions[dimension.key]));
      expect(meter.getAttribute("aria-valuemin")).toBe("0");
      expect(meter.getAttribute("aria-valuemax")).toBe("100");
      expect(meter.getAttribute("aria-valuetext")).toContain(`0: ${dimension.low}, 100: ${dimension.high}`);
    }
    const title = card.getByRole("button", { name: `${profile.name} 프로필 미리보기 및 편집` });
    const compare = card.getByRole("checkbox");
    expect(title.compareDocumentPosition(compare) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.getByText("비교", { exact: true })).toBeTruthy();
    expect(card.queryByText("비교에 포함")).toBeNull();
    expect(card.queryByRole("button", { name: "복제" })).toBeNull();
    expect(card.queryByRole("button", { name: "기록" })).toBeNull();
    expect(card.queryByRole("button", { name: "삭제" })).toBeNull();
  });

  it("prevents deleting system profiles from the keyboard-accessible card menu", async () => {
    const user = userEvent.setup();
    const seed = countryCultureSeedProfiles[0];
    apiRequest.mockImplementation(() => response([{ ...seed.content, id: seed.id, ownerId: SYSTEM_CULTURE_OWNER_ID, version: 1 }]));
    renderWithQuery(<CultureProfilesManager />);
    const menu = await screen.findByRole("button", { name: `${seed.content.name} 프로필 메뉴` });
    menu.focus();
    await user.keyboard("{Enter}");
    const blocked = await screen.findByRole("menuitem", { name: "삭제할 수 없음" });
    expect(blocked.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("menuitem", { name: "복제" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "기록" })).toBeTruthy();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(apiRequest.mock.calls.some(([method]) => method === "DELETE")).toBe(false);
  });

  it("compares saved app dimensions and reverses signed deltas when the reference changes", async () => {
    renderWithQuery(<CultureProfilesManager />);
    fireEvent.click(screen.getByRole("button", { name: "새 프로필 만들기" }));
    fireEvent.change(screen.getByLabelText("프로필 이름 *"), { target: { value: "비교하지 않을 초안" } });
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /한국 상황별 업무 컨텍스트 비교에 추가/ }));
    expect((screen.getByRole("button", { name: "비교하기" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /일본 다른 프로필 비교에 추가/ }));
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByText("비교하지 않을 초안")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "비교하기" }));
    const table = screen.getByRole("table");
    expect(screen.queryByRole("list", { name: "문화 프로필 목록" })).toBeNull();
    expect(within(table).getAllByRole("row")).toHaveLength(9);
    expect(within(table).getByText("-38")).toBeTruthy();
    expect(within(table).getAllByText("비슷함")).toHaveLength(7);
    expect(within(table).getByText("원리 우선 ↔ 적용 우선")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("차이 비교 기준 프로필"), { target: { value: "profile-2" } });
    expect(within(screen.getByRole("table")).getByText("+38")).toBeTruthy();
    expect(screen.queryByRole("option", { name: /비교하지 않을 초안/ })).toBeNull();
    const comparison = screen.getByRole("region", { name: "문화 행동 프로필 비교" });
    fireEvent.click(within(comparison).getAllByRole("button", { name: "살펴보기" })[0]);
    expect((screen.getByLabelText("프로필 이름 *") as HTMLInputElement).value).toBe("다른 프로필");
    expect(apiRequest.mock.calls.filter(([method]) => method !== "GET")).toHaveLength(0);
  });

  it("limits selection to five, retains comparisons through filters, and allows removal and reset", async () => {
    const countries: CultureProfile[] = countryCultureSeedProfiles.slice(0, 6).map(seed => ({
      ...seed.content, id: seed.id, ownerId: SYSTEM_CULTURE_OWNER_ID, version: 1, createdAt: "", updatedAt: "",
    }));
    apiRequest.mockImplementation(() => response(countries));
    renderWithQuery(<CultureProfilesManager />);
    const checkboxes = await screen.findAllByRole("checkbox", { name: /비교에 추가/ });
    checkboxes.slice(0, 5).forEach(checkbox => fireEvent.click(checkbox));
    expect((checkboxes[5] as HTMLInputElement).disabled).toBe(true);
    expect((checkboxes[0] as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.change(screen.getByLabelText("국가, 지역, 프로필 검색"), { target: { value: "없는 국가" } });
    expect(screen.getByText("조건에 맞는 프로필이 없습니다")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "비교하기" }));
    expect(screen.getAllByRole("table")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "목록으로 돌아가기" }));
    expect((screen.getByLabelText("국가, 지역, 프로필 검색") as HTMLInputElement).value).toBe("없는 국가");
    fireEvent.click(screen.getByRole("button", { name: "필터 모두 초기화" }));
    const chips = screen.getByRole("button", { name: "비교하기" }).closest("aside")!;
    fireEvent.click(within(chips).getAllByRole("button", { name: /비교에서 제거/ })[0]);
    expect((screen.getByRole("checkbox", { name: `${countries[5].country} ${countries[5].name} 비교에 추가` }) as HTMLInputElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "선택 모두 지우기" }));
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("button", { name: "비교하기" })).toBeNull();
  });

  it("allows the document to scroll without a height-limited card list", async () => {
    renderWithQuery(<CultureProfilesManager />);
    const list = await screen.findByRole("list", { name: "문화 프로필 목록" });
    expect(list.className).not.toMatch(/max-h-|overflow-y-|overscroll-/);
    expect(getComputedStyle(list).overflowY).not.toBe("auto");
    expect(getComputedStyle(list).overflowY).not.toBe("scroll");
  });

  it("collects selected names at the screen bottom and synchronizes removals with checkboxes", async () => {
    const user = userEvent.setup();
    renderWithQuery(<CultureProfilesManager />);
    expect(screen.queryByRole("button", { name: "비교하기" })).toBeNull();
    const first = await screen.findByRole("checkbox", { name: /한국 상황별 업무 컨텍스트 비교에 추가/ });
    await user.click(first);
    const compare = screen.getByRole("button", { name: "비교하기" }) as HTMLButtonElement;
    const tray = compare.closest("aside")!;
    expect(tray).toBeTruthy();
    expect(within(tray).getByText(profile.name, { exact: false })).toBeTruthy();
    expect(compare.disabled).toBe(true);
    expect(screen.queryByRole("region", { name: "문화 행동 프로필 비교" })).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: /일본 다른 프로필 비교에 추가/ }));
    expect(within(tray).getByText(secondProfile.name, { exact: false })).toBeTruthy();
    expect(compare.disabled).toBe(false);
    await user.click(within(tray).getByRole("button", { name: `${profile.name} 비교에서 제거` }));
    expect((first as HTMLInputElement).checked).toBe(false);
    expect(compare.disabled).toBe(true);
    await user.click(within(tray).getByRole("button", { name: "선택 모두 지우기" }));
    expect(screen.queryByRole("button", { name: "비교하기" })).toBeNull();
    expect(screen.queryAllByRole("checkbox", { name: /포함됨/ })).toHaveLength(0);
    expect(apiRequest.mock.calls.some(([method]) => method !== "GET")).toBe(false);
  });

  it("returns to the list when too few profiles remain in a comparison without losing the last selection", async () => {
    const user = userEvent.setup();
    renderWithQuery(<CultureProfilesManager />);
    await user.click(await screen.findByRole("checkbox", { name: /한국 상황별 업무 컨텍스트 비교에 추가/ }));
    await user.click(screen.getByRole("checkbox", { name: /일본 다른 프로필 비교에 추가/ }));
    await user.click(screen.getByRole("button", { name: "비교하기" }));
    const comparison = screen.getByRole("region", { name: "문화 행동 프로필 비교" });
    await user.click(within(comparison).getAllByRole("button", { name: `${profile.name} 비교에서 제거` })[0]);
    await screen.findByRole("list", { name: "문화 프로필 목록" });
    expect(screen.queryByRole("table")).toBeNull();
    expect((screen.getByRole("checkbox", { name: /일본 다른 프로필 비교에 포함됨/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("button", { name: "비교하기" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("hides the selection tray on other Culture Map tabs and restores it on returning", async () => {
    const user = userEvent.setup();
    renderWithQuery(<CultureMapWorkspace />);
    await user.click(await screen.findByRole("checkbox", { name: /한국 상황별 업무 컨텍스트 비교에 추가/ }));
    expect(screen.getByRole("button", { name: "비교하기" })).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "새 프로필 만들기" }));
    expect(screen.queryByRole("button", { name: "비교하기" })).toBeNull();
    await user.click(screen.getByRole("tab", { name: "행동 실험" }));
    expect(screen.queryByRole("button", { name: "비교하기" })).toBeNull();
    await user.click(screen.getByRole("tab", { name: "프로필 관리" }));
    expect(screen.getByRole("button", { name: "비교하기" })).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: /한국 상황별 업무 컨텍스트 비교에 포함됨/ }) as HTMLInputElement).checked).toBe(true);
  });

  it("frees selection capacity when a previously selected profile disappears from refreshed data", async () => {
    const user = userEvent.setup();
    const countries: CultureProfile[] = countryCultureSeedProfiles.slice(0, 6).map(seed => ({
      ...seed.content, id: seed.id, ownerId: SYSTEM_CULTURE_OWNER_ID, version: 1, createdAt: "", updatedAt: "",
    }));
    apiRequest.mockImplementation(() => response(countries));
    const { client } = renderWithQuery(<CultureProfilesManager />);
    const checkboxes = await screen.findAllByRole("checkbox", { name: /비교에 추가/ });
    for (const checkbox of checkboxes.slice(0, 5)) await user.click(checkbox);
    expect((checkboxes[5] as HTMLInputElement).disabled).toBe(true);
    await act(async () => { client.setQueryData(["/api/admin/culture-profiles"], countries.slice(1)); });
    await waitFor(() => expect((checkboxes[5] as HTMLInputElement).disabled).toBe(false));
    const tray = screen.getByRole("complementary", { name: "비교할 프로필 선택함" });
    expect(within(tray).queryByRole("button", { name: `${countries[0].name} 비교에서 제거` })).toBeNull();
    await user.click(checkboxes[5]);
    expect(within(tray).getAllByRole("button", { name: /비교에서 제거/ })).toHaveLength(5);
  });

  it("combines manager region and confidence filters and keeps custom profiles available as unspecified", async () => {
    const seed = countryCultureSeedProfiles[0];
    const country = { ...seed.content, id: seed.id, ownerId: SYSTEM_CULTURE_OWNER_ID, version: 1, createdAt: "", updatedAt: "" };
    apiRequest.mockImplementation(() => response([country, profile]));
    renderWithQuery(<CultureProfilesManager />);
    await screen.findByRole("checkbox", { name: /한국 상황별 업무 컨텍스트 비교에 추가/ });
    fireEvent.change(screen.getByLabelText("출처 신뢰도"), { target: { value: "unspecified" } });
    expect(screen.getAllByRole("checkbox", { name: /비교에 추가/ })).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("지역"), { target: { value: country.region } });
    expect(screen.getByText("조건에 맞는 프로필이 없습니다")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "필터 모두 초기화" }));
    expect(screen.getAllByRole("checkbox", { name: /비교에 추가/ })).toHaveLength(2);
  });

  it("labels country baselines as unvalidated estimates and keeps them read-only even for admins; clone opens for editing", async () => {
    const baseline = countryCultureSeedProfiles.find(p => p.content.origin!.originalProfile.countryCode === "US")!;
    const base: CultureProfile = { ...baseline.content, id: baseline.id, ownerId: SYSTEM_CULTURE_OWNER_ID, version: 1, createdAt: profile.createdAt, updatedAt: profile.updatedAt };
    const clone = { ...base, id: "private-clone", ownerId: "admin-1", name: "미국 (복제)", visibility: "private" };
    apiRequest.mockImplementation(async (method: string, url: string) => {
      if (method === "POST") return response(clone);
      return response([base]);
    });
    renderWithQuery(<CultureProfilesManager />);
    fireEvent.click(await screen.findByText("미국", { exact: true }));
    expect((screen.getByLabelText("프로필 이름 *") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "변경 저장" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "삭제" })).toBeNull();
    expect(screen.getAllByText(EDITORIAL_CULTURE_NOTICE).length).toBeGreaterThan(0);
    expect(screen.getByText(/원본 설득 축:/).textContent).toContain("원본 20 → 기본 적용 80");
    fireEvent.click(screen.getByRole("button", { name: "복제 후 편집" }));
    await waitFor(() => expect((screen.getByLabelText("프로필 이름 *") as HTMLInputElement).value).toBe("미국 (복제)"));
    expect((screen.getByRole("button", { name: "변경 저장" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("shows data version, original values and review warning when a country is selected for an Actor", async () => {
    const baseline = countryCultureSeedProfiles.find(p => p.content.origin!.originalProfile.countryCode === "US")!;
    const base: CultureProfile = { ...baseline.content, id: baseline.id, ownerId: SYSTEM_CULTURE_OWNER_ID, version: 1, createdAt: profile.createdAt, updatedAt: profile.updatedAt };
    apiRequest.mockImplementation(async (_method: string, url: string) => url.endsWith("/versions")
      ? response([{ version: 1, content: baseline.content, createdAt: profile.createdAt }])
      : response([base]));
    renderWithQuery(<ActorCultureEditor actorKey="country-actor" value={{ enabled: true, profileId: baseline.id, profileVersion: 1, intensity: 70, overrides: {} }} onChange={vi.fn()} />);
    await screen.findByText(EDITORIAL_CULTURE_NOTICE);
    expect(screen.getByText(/국가 코드 US/).textContent).toContain("2026.1");
    expect(screen.getByText(/공식 점수 아님/).textContent).toContain("검토 필요");
  });

  it("starts OFF and emits explicit disabled state only when switched off", () => {
    const onChange = vi.fn();
    renderWithQuery(<ActorCultureEditor actorKey="actor-a" onChange={onChange} />);
    const toggle = screen.getByRole("checkbox", { name: "문화적 특성 추가" });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ enabled: false });
  });

  it("marks ON without a profile incomplete, then clears that validation after profile selection", async () => {
    const onChange = vi.fn();
    const onValidityChange = vi.fn();
    renderWithQuery(<ActorCultureEditor actorKey="actor-a" onChange={onChange} onValidityChange={onValidityChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "문화적 특성 추가" }));
    expect((await screen.findByRole("alert")).textContent).toContain("프로필을 선택해야");
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("GET", "/api/admin/culture-profiles"));
    fireEvent.click(await screen.findByRole("combobox", { name: "문화 프로필 선택" }));
    fireEvent.click(await screen.findByRole("option", { name: /상황별 업무 컨텍스트/ }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({
      enabled: true, profileId: "profile-1", profileVersion: 2, intensity: 70, overrides: {},
    }));
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
  });

  it("shows and preserves a saved snapshot even when the source profile is unavailable", () => {
    apiRequest.mockImplementation(async (method: string, url: string) => {
      if (method === "GET" && url === "/api/admin/culture-profiles") return response([]);
      return response([]);
    });
    const onChange = vi.fn();
    renderWithQuery(<ActorCultureEditor actorKey="actor-a" value={snapshot} onChange={onChange} />);
    const savedSnapshot = screen.getByRole("region", { name: "저장된 문화 스냅샷" });
    expect(savedSnapshot.textContent).toContain("삭제된 프로필 스냅샷");
    expect(savedSnapshot.textContent).toContain("싱가포르");
    expect(savedSnapshot.textContent).toContain("v4");
    expect(savedSnapshot.textContent).toContain("31");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("filters Actor choices by region and source confidence without changing saved selection", async () => {
    const onChange = vi.fn();
    renderWithQuery(<ActorCultureEditor actorKey="filters" value={{ enabled: true, profileId: profile.id, profileVersion: 2, intensity: 70, overrides: {} }} onChange={onChange} />);
    const trigger = await screen.findByRole("combobox", { name: "문화 프로필 선택" });
    expect(screen.queryByLabelText("프로필 검색")).toBeNull();
    fireEvent.click(trigger);
    await screen.findByRole("option", { name: /다른 프로필/ });
    fireEvent.change(screen.getByLabelText("지역 필터"), { target: { value: "수도권" } });
    expect(screen.queryByRole("option", { name: /다른 프로필/ })).toBeNull();
    expect(screen.getByRole("option", { name: /상황별 업무 컨텍스트/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("출처 신뢰도 필터"), { target: { value: "high" } });
    expect(screen.getByText("조건에 맞는 프로필이 없습니다.")).toBeTruthy();
    expect(trigger.textContent).toContain(profile.name);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "필터 초기화" }));
    expect(screen.getByRole("option", { name: /다른 프로필/ })).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("previews historical dimensions and clears overrides when switching profiles", async () => {
    const onChange = vi.fn();
    renderWithQuery(<ActorCultureEditor actorKey="actor-a" onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "문화적 특성 추가" }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("GET", "/api/admin/culture-profiles"));
    fireEvent.click(await screen.findByRole("combobox", { name: "문화 프로필 선택" }));
    fireEvent.click(await screen.findByRole("option", { name: /상황별 업무 컨텍스트/ }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("GET", "/api/admin/culture-profiles/profile-1/versions"));
    const communicatingSummary = () => screen.getAllByText("의사소통").find((element) => element.tagName === "DT")?.parentElement?.textContent;
    await waitFor(() => expect(communicatingSummary()).toContain("82"));
    fireEvent.change(screen.getByRole("combobox", { name: "selection" }), { target: { value: "1" } });
    await waitFor(() => expect(communicatingSummary()).toContain("17"));
    expect(onChange).toHaveBeenLastCalledWith({
      enabled: true, profileId: "profile-1", profileVersion: 1, intensity: 70, overrides: {},
    });
    fireEvent.click(screen.getByText("차원별 override (선택)"));
    fireEvent.change(screen.getByLabelText("의사소통 override 값"), { target: { value: "12" } });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({
      enabled: true, profileId: "profile-1", profileVersion: 1, intensity: 70, overrides: { communicating: 12 },
    }));
    fireEvent.click(screen.getByRole("combobox", { name: "문화 프로필 선택" }));
    fireEvent.click(await screen.findByRole("option", { name: /다른 프로필/ }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({
      enabled: true, profileId: "profile-2", profileVersion: 1, intensity: 70, overrides: {},
    }));
    await waitFor(() => expect(communicatingSummary()).toContain("44"));
  });

  it("searches inside the picker and applies a profile with the keyboard, then restores focus", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderWithQuery(<ActorCultureEditor actorKey="keyboard" value={{ enabled: true, profileId: profile.id, profileVersion: 2, intensity: 63, overrides: { leading: 12 } }} onChange={onChange} />);
    const trigger = await screen.findByRole("combobox", { name: "문화 프로필 선택" });
    await user.click(trigger);
    const search = await screen.findByLabelText("프로필 검색");
    await user.type(search, "일본");
    expect(screen.queryByRole("option", { name: /상황별 업무 컨텍스트/ })).toBeNull();
    expect(screen.getByRole("option", { name: /다른 프로필/ })).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({
      enabled: true, profileId: secondProfile.id, profileVersion: 1, intensity: 63, overrides: {},
    }));
    await waitFor(() => expect(screen.queryByLabelText("프로필 검색")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(trigger.textContent).toContain(secondProfile.name);
    await user.click(trigger);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByLabelText("프로필 검색")).toBeNull());
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("keeps actor selection callbacks independent", () => {
    const firstChange = vi.fn();
    const secondChange = vi.fn();
    const firstValidity = vi.fn();
    const secondValidity = vi.fn();
    renderWithQuery(<><ActorCultureEditor actorKey="first" onChange={firstChange} onValidityChange={firstValidity} /><ActorCultureEditor actorKey="second" onChange={secondChange} onValidityChange={secondValidity} /></>);
    fireEvent.click(screen.getAllByRole("checkbox", { name: "문화적 특성 추가" })[0]);
    expect(firstValidity).toHaveBeenLastCalledWith(true);
    expect(secondValidity).not.toHaveBeenCalled();
    expect(secondChange).not.toHaveBeenCalled();
  });

  it("reveals and focuses a fresh editor from the prominent action, including repeated creation", async () => {
    renderWithQuery(<CultureProfilesManager />);
    fireEvent.click(await screen.findByRole("button", { name: /상황별 업무 컨텍스트 프로필 미리보기 및 편집/ }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("프로필 이름 *")));
    expect((screen.getByLabelText("프로필 이름 *") as HTMLInputElement).value).toBe(profile.name);
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    fireEvent.click(screen.getByRole("button", { name: "새 프로필 만들기" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("프로필 이름 *")));
    expect((screen.getByLabelText("프로필 이름 *") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("프로필 이름 *"), { target: { value: "임시 초안" } });
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    fireEvent.click(screen.getByRole("button", { name: "새 프로필 만들기" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("프로필 이름 *")));
    expect((screen.getByLabelText("프로필 이름 *") as HTMLInputElement).value).toBe("");
    expect(apiRequest.mock.calls.some(([method]) => method !== "GET")).toBe(false);
  });

  it("opens only on demand, closes with Escape, and returns focus to the create action", async () => {
    const user = userEvent.setup();
    renderWithQuery(<CultureProfilesManager />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByLabelText("프로필 이름 *")).toBeNull();
    const trigger = screen.getByRole("button", { name: "새 프로필 만들기" });
    await user.click(trigger);
    expect(await screen.findByRole("dialog", { name: "새 프로필 만들기" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("프로필 이름 *")));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("keeps a pending save in its dialog and shows failures inside it without losing the draft", async () => {
    const user = userEvent.setup();
    let rejectRequest!: (error: Error) => void;
    const pending = new Promise<Response>((_resolve, reject) => { rejectRequest = reject; });
    apiRequest.mockImplementation(async (method: string) => method === "POST" ? pending : response([profile]));
    renderWithQuery(<CultureProfilesManager />);
    const trigger = screen.getByRole("button", { name: "새 프로필 만들기" });
    await user.click(trigger);
    await user.type(screen.getByLabelText("프로필 이름 *"), "저장할 초안");
    await user.type(screen.getByLabelText("국가/문화권 *"), "한국");
    await user.click(screen.getByRole("button", { name: "프로필 생성" }));
    await screen.findByRole("button", { name: "저장 중…" });
    expect((screen.getByRole("button", { name: "취소" }) as HTMLButtonElement).disabled).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "새 프로필 만들기" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("dialog", { name: "새 프로필 만들기" })).toBeTruthy();
    rejectRequest(new Error("저장 서버 오류"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("저장 서버 오류");
    expect(screen.getByRole("dialog").contains(alert)).toBe(true);
    expect((screen.getByLabelText("프로필 이름 *") as HTMLInputElement).value).toBe("저장할 초안");
    await user.click(screen.getByRole("button", { name: "취소" }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("creates a profile through the management API", async () => {
    renderWithQuery(<CultureProfilesManager />);
    expect(screen.queryByLabelText("프로필 이름 *")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "새 프로필 만들기" }));
    fireEvent.change(screen.getByLabelText("프로필 이름 *"), { target: { value: input.name } });
    fireEvent.change(screen.getByLabelText("국가/문화권 *"), { target: { value: input.country } });
    fireEvent.click(screen.getByRole("button", { name: "프로필 생성" }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("POST", "/api/admin/culture-profiles", expect.objectContaining({
      name: input.name, country: input.country, visibility: "private", dimensions: expect.objectContaining({ communicating: 50 }),
    })));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("edits with only CultureProfileInput fields and expectedVersion", async () => {
    renderWithQuery(<CultureProfilesManager />);
    fireEvent.click(await screen.findByRole("button", { name: /상황별 업무 컨텍스트 프로필 미리보기 및 편집/ }));
    fireEvent.change(screen.getByLabelText("프로필 이름 *"), { target: { value: "편집된 컨텍스트" } });
    fireEvent.click(screen.getByRole("button", { name: "변경 저장" }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("PUT", "/api/admin/culture-profiles/profile-1", expect.any(Object)));
    const putBody = apiRequest.mock.calls.find(([method, url]) => method === "PUT" && url === "/api/admin/culture-profiles/profile-1")?.[2];
    expect(putBody).toEqual({ ...input, name: "편집된 컨텍스트", expectedVersion: 2 });
    expect(Object.keys(putBody as object).sort()).toEqual([
      "country", "description", "dimensions", "expectedVersion", "name", "region", "sources", "visibility",
    ]);
  });

  it("supports profile clone and version-history viewing", async () => {
    const user = userEvent.setup();
    renderWithQuery(<CultureProfilesManager />);
    const profileRow = within((await screen.findAllByRole("listitem"))[0]);
    expect(profileRow.queryByRole("button", { name: "복제" })).toBeNull();
    await user.click(profileRow.getByRole("button", { name: `${profile.name} 프로필 메뉴` }));
    await user.click(await screen.findByRole("menuitem", { name: "복제" }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("POST", "/api/admin/culture-profiles/profile-1/duplicate"));
    await screen.findByRole("dialog", { name: "프로필 편집" });
    await user.click(screen.getByRole("button", { name: "취소" }));
    await user.click(profileRow.getByRole("button", { name: `${profile.name} 프로필 메뉴` }));
    await user.click(await screen.findByRole("menuitem", { name: "기록" }));
    expect(await screen.findByRole("dialog", { name: /버전 기록/ })).toBeTruthy();
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("GET", "/api/admin/culture-profiles/profile-1/versions"));
    expect(screen.getByText(/버전 1 · 이전 문화 버전/)).toBeTruthy();
  });

  it("requires delete confirmation and sends the expected version", async () => {
    const user = userEvent.setup();
    renderWithQuery(<CultureProfilesManager />);
    const profileRow = within((await screen.findAllByRole("listitem"))[0]);
    await user.click(profileRow.getByRole("button", { name: `${profile.name} 프로필 메뉴` }));
    await user.click(await screen.findByRole("menuitem", { name: "삭제" }));
    const confirmation = screen.getByRole("alertdialog", { name: "프로필을 삭제할까요?" });
    fireEvent.click(within(confirmation).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("DELETE", "/api/admin/culture-profiles/profile-1", { expectedVersion: 2 }));
  });

  it("keeps admin-shared profiles read-only for operators while new profiles remain private", async () => {
    authState.user = { id: "operator-1", role: "operator" };
    const sharedProfile = { ...profile, visibility: "shared" as const };
    apiRequest.mockImplementation(async (method: string, url: string) => {
      if (method === "GET" && url === "/api/admin/culture-profiles") return response([sharedProfile]);
      return response([]);
    });
    renderWithQuery(<CultureProfilesManager />);
    fireEvent.click(await screen.findByRole("button", { name: /상황별 업무 컨텍스트 프로필 미리보기 및 편집/ }));
    expect((screen.getByLabelText("프로필 이름 *") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "변경 저장" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByLabelText("공유 프로필")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    fireEvent.click(screen.getByRole("button", { name: "새 프로필 만들기" }));
    expect((screen.getByLabelText("프로필 이름 *") as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByLabelText("공유 프로필")).toBeNull();
  });
});

describe("Scenario Actor and Persona template identity", () => {
  it("allows multiple Actors to reference one Persona template with unique stable Actor ids", () => {
    const firstActor = { id: "persona-template", personaRef: "persona-template" };
    const secondActor = { id: "", personaRef: "" };
    const actors = [firstActor, secondActor];
    const duplicateActorId = stableActorIdForTemplate("persona-template", secondActor, actors);
    expect(duplicateActorId).toBe("persona-template__actor_2");
    expect(getScenarioPersonaTemplateId({ id: duplicateActorId, personaRef: "persona-template" })).toBe("persona-template");
    expect(stableActorIdForTemplate("persona-template", { id: duplicateActorId }, [...actors, { id: duplicateActorId }])).toBe(duplicateActorId);
  });

  it("does not rekey a saved Actor when its selected Persona template changes", () => {
    const savedActor = { id: "scenario-actor-12", personaRef: "old-template.json" };
    expect(getScenarioPersonaTemplateId(savedActor)).toBe("old-template");
    expect(stableActorIdForTemplate("new-template", savedActor, [savedActor])).toBe("scenario-actor-12");
  });
});
