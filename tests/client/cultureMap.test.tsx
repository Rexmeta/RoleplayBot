// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CultureProfile, CultureProfileInput, CultureSnapshot } from "@shared/cultureMap";

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
import { getScenarioPersonaTemplateId, stableActorIdForTemplate } from "@/components/admin/cultureMap/actorIdentity";

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
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("Culture Map actor and profile management", () => {
  beforeEach(() => {
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
    const selects = await screen.findAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "profile-1" } });
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

  it("previews historical dimensions and clears overrides when switching profiles", async () => {
    const onChange = vi.fn();
    renderWithQuery(<ActorCultureEditor actorKey="actor-a" onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "문화적 특성 추가" }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("GET", "/api/admin/culture-profiles"));
    const selects = await screen.findAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "profile-1" } });
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("GET", "/api/admin/culture-profiles/profile-1/versions"));
    const communicatingSummary = () => screen.getAllByText("의사소통").find((element) => element.tagName === "DT")?.parentElement?.textContent;
    await waitFor(() => expect(communicatingSummary()).toContain("82"));
    fireEvent.change(selects[1], { target: { value: "1" } });
    await waitFor(() => expect(communicatingSummary()).toContain("17"));
    expect(onChange).toHaveBeenLastCalledWith({
      enabled: true, profileId: "profile-1", profileVersion: 1, intensity: 70, overrides: {},
    });
    fireEvent.click(screen.getByText("차원별 override (선택)"));
    fireEvent.change(screen.getByLabelText("의사소통 override 값"), { target: { value: "12" } });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({
      enabled: true, profileId: "profile-1", profileVersion: 1, intensity: 70, overrides: { communicating: 12 },
    }));
    fireEvent.change(selects[0], { target: { value: "profile-2" } });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({
      enabled: true, profileId: "profile-2", profileVersion: 1, intensity: 70, overrides: {},
    }));
    await waitFor(() => expect(communicatingSummary()).toContain("44"));
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

  it("creates a profile through the management API", async () => {
    renderWithQuery(<CultureProfilesManager />);
    fireEvent.change(screen.getByLabelText("프로필 이름 *"), { target: { value: input.name } });
    fireEvent.change(screen.getByLabelText("국가/문화권 *"), { target: { value: input.country } });
    fireEvent.click(screen.getByRole("button", { name: "프로필 생성" }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("POST", "/api/admin/culture-profiles", expect.objectContaining({
      name: input.name, country: input.country, visibility: "private", dimensions: expect.objectContaining({ communicating: 50 }),
    })));
  });

  it("edits with only CultureProfileInput fields and expectedVersion", async () => {
    renderWithQuery(<CultureProfilesManager />);
    fireEvent.click(await screen.findByRole("button", { name: /상황별 업무 컨텍스트/ }));
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
    renderWithQuery(<CultureProfilesManager />);
    const profileRow = within((await screen.findAllByRole("listitem"))[0]);
    fireEvent.click(profileRow.getByRole("button", { name: "복제" }));
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("POST", "/api/admin/culture-profiles/profile-1/duplicate"));
    fireEvent.click(profileRow.getByRole("button", { name: "기록" }));
    expect(await screen.findByRole("dialog", { name: /버전 기록/ })).toBeTruthy();
    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("GET", "/api/admin/culture-profiles/profile-1/versions"));
    expect(screen.getByText(/버전 1 · 이전 문화 버전/)).toBeTruthy();
  });

  it("requires delete confirmation and sends the expected version", async () => {
    renderWithQuery(<CultureProfilesManager />);
    const profileRow = within((await screen.findAllByRole("listitem"))[0]);
    fireEvent.click(profileRow.getByRole("button", { name: "삭제" }));
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
    fireEvent.click(await screen.findByRole("button", { name: /상황별 업무 컨텍스트/ }));
    expect((screen.getByLabelText("프로필 이름 *") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "변경 저장" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByLabelText("공유 프로필")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "새 프로필" }));
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
