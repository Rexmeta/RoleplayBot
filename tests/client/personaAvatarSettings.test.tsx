// @vitest-environment happy-dom
import React, { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PersonaAvatarSettings } from "../../client/src/components/admin/PersonaAvatarSettings";
import type { PersonaLiveAvatar, PersonaAvatarMode } from "../../shared/avatar/personaAvatar";
const api = vi.hoisted(() => vi.fn());
vi.mock("../../client/src/lib/queryClient", () => ({ apiRequest: api }));
vi.mock("../../client/src/components/admin/PersonaAvatarValidationPanel", () => ({
  PersonaAvatarValidationPanel: ({ assetId, onActivityChange }: { assetId: string; onActivityChange?: (active: boolean) => void }) => <div data-testid="custom-avatar-test">
    Custom test: {assetId}
    <button onClick={() => onActivityChange?.(true)}>Mock session start</button>
    <button onClick={() => onActivityChange?.(false)}>Mock session end</button>
  </div>,
}));
vi.mock("../../client/src/components/admin/LiveAvatarTestPanel", () => ({
  LiveAvatarTestPanel: () => <div data-testid="stock-avatar-test">Lucy test panel</div>,
}));
const id = "12345678-1234-4234-8234-123456789abc";
const saved: PersonaLiveAvatar = {
  assetId: id, providerId: "tavus", voiceMode: "roleplayx",
  activation: "draft", validationStatus: "unverified", projectId: "project-one",
};
const row = (patch: any = {}) => ({
  id, name: "테스트 인물", providerId: "tavus", providerAvatarId: "face",
  status: "ready", capabilities: { reusable: true, liveRendering: false, validation: "provisioned" },
  liveValidated: false, ...patch,
});
const response = (assets = [row()]) => ({ projectId: "project-one", runtimeAvailable: false, assets });
function Harness({ initial = null }: { initial?: PersonaLiveAvatar | null }) {
  const [mode, setMode] = useState<PersonaAvatarMode>("live");
  const [avatar, setAvatar] = useState(initial);
  return <>
    <PersonaAvatarSettings mode={mode} liveAvatar={avatar} onModeChange={setMode} onLiveAvatarChange={setAvatar} />
    <output data-testid="draft">{JSON.stringify(avatar)}</output>
  </>;
}
beforeEach(() => { api.mockReset(); api.mockResolvedValue({ json: async () => response() }); });
afterEach(cleanup);

describe("persona avatar settings", () => {
  it("offers three modes and never automatically calls remote endpoints", () => {
    render(<Harness />);
    expect(within(screen.getByRole("radiogroup", { name: "아바타 표시 방식" })).getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByText("저장된 설정은 아바타 참조 정보입니다.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /커스텀 아바타 생성/ })).toBeNull();
    expect(screen.getByRole("radio", { name: /^기본 아바타/ }).getAttribute("aria-checked")).toBe("true");
    expect(api).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "이미지" }));
    expect(screen.getByRole("radio", { name: "이미지" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText("아바타 목록 조회")).toBeNull();
  });

  it("loads only on explicit action and saves a project-bound unverified draft", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: /^커스텀 아바타/ }));
    fireEvent.click(screen.getByRole("button", { name: "아바타 목록 조회" }));
    await screen.findByLabelText("연결할 커스텀 자산");
    expect(api.mock.calls).toEqual([["GET", "/api/admin/personas/live-avatar/assets"]]);
    fireEvent.change(screen.getByLabelText("연결할 커스텀 자산"), { target: { value: id } });
    expect(JSON.parse(screen.getByTestId("draft").textContent!)).toEqual({ ...saved, kind: "custom" });
    expect(screen.getByText(/현재 자산 상태: 준비 완료 · Live 검증: 미검증/)).toBeTruthy();
    expect(screen.getByText(/미리보기 URL은 제공되지 않습니다/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "아바타 연결 해제" }));
    expect(screen.getByTestId("draft").textContent).toBe("null");
  });

  it("disables unready assets, separates live validation and preserves missing selections", async () => {
    api.mockResolvedValue({ json: async () => response([row({ id: "22345678-1234-4234-8234-123456789abc", status: "processing" })]) });
    render(<Harness initial={saved} />);
    fireEvent.click(screen.getByRole("button", { name: "아바타 목록 조회" }));
    await screen.findByLabelText("연결할 커스텀 자산");
    expect(screen.getByRole("option", { name: /처리 중 · 선택 불가/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/새로 조회한 목록에서 저장된 자산을 찾지 못했습니다/)).toBeTruthy();
    expect(JSON.parse(screen.getByTestId("draft").textContent!)).toEqual(saved);
  });

  it("shows explicit scope, empty and malformed response errors instead of fake success", async () => {
    api.mockRejectedValue(new Error("403: avatar_assets_read_scope_missing"));
    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: /^커스텀 아바타/ }));
    fireEvent.click(screen.getByRole("button", { name: "아바타 목록 조회" }));
    expect((await screen.findByRole("alert")).textContent).toContain("assets:read");
    api.mockResolvedValue({ json: async () => response([]) });
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await screen.findByText(/조회 가능한 프로젝트 소유 커스텀 자산이 없습니다/);
    api.mockResolvedValue({ json: async () => ({ assets: "invalid" }) });
    fireEvent.click(screen.getByRole("button", { name: "목록 새로고침" }));
    await screen.findByRole("alert");
    expect(screen.queryByText(/조회 가능한 아바타 자산이 없습니다/)).toBeNull();
  });

  it("ignores requests resolved after the panel is removed", async () => {
    let complete: (value: any) => void = () => {};
    api.mockReturnValue(new Promise(resolve => { complete = resolve; }));
    const view = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "아바타 목록 조회" }));
    view.unmount();
    await act(async () => complete({ json: async () => response() }));
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("does not bypass disabled operator video management", () => {
    const change = vi.fn();
    render(<PersonaAvatarSettings mode="image" liveAvatar={null} onModeChange={change}
      onLiveAvatarChange={vi.fn()} videoManagementAllowed={false} />);
    fireEvent.click(screen.getByRole("radio", { name: "비디오" }));
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: "Live" }));
    expect(change).toHaveBeenCalledWith("live");
  });

  it("selects stock Lucy separately, replaces custom references and never starts validation or a session", async () => {
    api.mockResolvedValue({ json: async () => ({ ...response(), stockAvatars: [
      { id: "tavus-stock-lucy", providerId: "tavus", name: "Lucy", description: "Stock",
        kind: "configured", configured: true, languages: ["en"] },
      { id: "mock-orbit", providerId: "mock", name: "Orbit", description: "Mock",
        kind: "mock", configured: true, languages: [] },
    ] }) });
    render(<Harness initial={saved} />);
    fireEvent.click(screen.getByRole("button", { name: "아바타 목록 조회" }));
    await screen.findByLabelText("연결할 커스텀 자산");
    expect(screen.queryByLabelText("기본 아바타")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /^기본 아바타/ }));
    expect(screen.getByTestId("draft").textContent).toBe("null");
    await screen.findByLabelText("기본 아바타");
    expect(screen.getByRole("option", { name: /Orbit.*선택 불가/ }).hasAttribute("disabled")).toBe(true);
    // An existing custom draft mounts its read-only preflight before we switch.
    api.mockClear();
    fireEvent.change(screen.getByLabelText("기본 아바타"), { target: { value: "tavus-stock-lucy" } });
    expect(JSON.parse(screen.getByTestId("draft").textContent!)).toEqual({
      kind: "stock", avatarId: "tavus-stock-lucy", providerId: "tavus", voiceMode: "roleplayx",
      validationStatus: "unverified", activation: "draft", projectId: "project-one",
    });
    expect(screen.getByText(/기본 아바타 ID: tavus-stock-lucy/)).toBeTruthy();
    expect(screen.queryByLabelText("연결할 커스텀 자산")).toBeNull();
    expect(screen.queryByText(/저장된 Tavus 자산/)).toBeNull();
    expect(api).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: /^커스텀 아바타/ }));
    expect(screen.getByTestId("draft").textContent).toBe("null");
    expect(screen.queryByLabelText("기본 아바타")).toBeNull();
    fireEvent.change(screen.getByLabelText("연결할 커스텀 자산"), { target: { value: id } });
    expect(JSON.parse(screen.getByTestId("draft").textContent!)).toEqual({ ...saved, kind: "custom" });
  });

  it("retains a saved stock selection when removed after refresh, and supports unlink", async () => {
    const stockDraft: PersonaLiveAvatar = {
      kind: "stock", avatarId: "tavus-stock-lucy", providerId: "tavus", voiceMode: "roleplayx",
      activation: "draft", validationStatus: "unverified", projectId: "project-one",
    };
    render(<Harness initial={stockDraft} />);
    fireEvent.click(screen.getByRole("button", { name: "아바타 목록 조회" }));
    await screen.findByText(/새로 조회한 목록에서 저장된 기본 아바타를 찾지 못했습니다/);
    expect(JSON.parse(screen.getByTestId("draft").textContent!)).toEqual(stockDraft);
    expect(screen.queryByText(/저장된 Tavus 자산/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "아바타 연결 해제" }));
    expect(screen.getByTestId("draft").textContent).toBe("null");
  });

  it("opens the selected saved custom Tavus test before the catalog has been loaded", () => {
    render(<Harness initial={saved} />);
    expect(api).not.toHaveBeenCalled();
    expect(screen.queryByTestId("custom-avatar-test")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "선택 아바타 테스트" }));
    expect(screen.getByTestId("custom-avatar-test").textContent).toContain(id);
    expect(api).not.toHaveBeenCalled();
  });

  it("shows only the chosen kind and opens custom creation explicitly without starting requests", () => {
    render(<Harness />);
    expect(screen.queryByRole("button", { name: "생성 양식 열기" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "커스텀 아바타" }));
    expect(screen.getByRole("radio", { name: "커스텀 아바타" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("button", { name: /커스텀 아바타 생성/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "생성 양식 열기" }));
    expect(screen.getByRole("button", { name: /커스텀 아바타 생성/ }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "생성 양식 닫기" }));
    expect(screen.queryByRole("button", { name: /커스텀 아바타 생성/ })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "기본 아바타" }));
    expect(screen.queryByRole("button", { name: "생성 양식 열기" })).toBeNull();
    expect(api).not.toHaveBeenCalled();
  });

  it("keeps active test controls visible until cleanup, then resets the test when switching kind", () => {
    render(<Harness initial={saved} />);
    fireEvent.click(screen.getByRole("button", { name: "선택 아바타 테스트" }));
    fireEvent.click(screen.getByRole("button", { name: "Mock session start" }));
    expect(screen.getByRole("radio", { name: "기본 아바타" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("radio", { name: "이미지" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "선택 아바타 테스트 닫기" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "기본 아바타" }));
    expect(screen.getByTestId("custom-avatar-test")).toBeTruthy();
    expect(JSON.parse(screen.getByTestId("draft").textContent!)).toEqual(saved);
    fireEvent.click(screen.getByRole("button", { name: "Mock session end" }));
    fireEvent.click(screen.getByRole("radio", { name: "기본 아바타" }));
    expect(screen.queryByTestId("custom-avatar-test")).toBeNull();
    expect(screen.getByTestId("draft").textContent).toBe("null");
    fireEvent.click(screen.getByRole("radio", { name: "커스텀 아바타" }));
    expect(screen.queryByTestId("custom-avatar-test")).toBeNull();
    expect(screen.queryByRole("button", { name: "선택 아바타 테스트" })).toBeNull();
    expect(api).not.toHaveBeenCalled();
  });

  it("offers the existing Lucy-only stock test for an explicitly selected stock avatar", async () => {
    api.mockResolvedValue({ json: async () => ({ ...response(), stockAvatars: [
      { id: "tavus-stock-lucy", providerId: "tavus", name: "Lucy", description: "Stock",
        kind: "configured", configured: true, languages: ["en"] },
    ] }) });
    const stockDraft: PersonaLiveAvatar = {
      kind: "stock", avatarId: "tavus-stock-lucy", providerId: "tavus", voiceMode: "roleplayx",
      activation: "draft", validationStatus: "unverified",
    };
    render(<Harness initial={stockDraft} />);
    expect(api).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "선택 아바타 테스트" }));
    expect(screen.getByTestId("stock-avatar-test").textContent).toContain("Lucy");
    expect(api).not.toHaveBeenCalled();
  });
});
