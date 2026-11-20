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
  LiveAvatarTestPanel: () => <div data-testid="stock-avatar-test">Default avatar test</div>,
}));
vi.mock("../../client/src/components/admin/AnamAvatarTestPanel", () => ({
  AnamAvatarTestPanel: () => <div data-testid="anam-avatar-test">Default avatar test</div>,
}));
vi.mock("../../client/src/components/admin/PersonaSeedLivePanel", () => ({
  PersonaSeedLivePanel: ({ onDraftChange }: { onDraftChange: (draft: unknown) => void }) => <div data-testid="seed-panel">
    Seed preparation <button onClick={() => onDraftChange(null)}>Mock clear seed draft</button>
  </div>,
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
const voiceCatalog = {
  providers: [
    { providerId: "anam", status: "available", errorCode: null },
    { providerId: "tavus", status: "available", errorCode: null },
  ],
  voices: [],
};
const response = (assets = [row()], voices = voiceCatalog.voices) => ({
  projectId: "project-one", runtimeAvailable: false, assets, voiceCatalog: { ...voiceCatalog, voices },
});
function Harness({ initial = null }: { initial?: PersonaLiveAvatar | null }) {
  const [mode, setMode] = useState<PersonaAvatarMode>("live");
  const [avatar, setAvatar] = useState(initial);
  return <>
    <PersonaAvatarSettings mode={mode} liveAvatar={avatar} onModeChange={setMode} onLiveAvatarChange={setAvatar} />
    <output data-testid="draft">{JSON.stringify(avatar)}</output>
  </>;
}
beforeEach(() => { api.mockReset(); api.mockResolvedValue({ json: async () => response() }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("persona avatar settings", () => {
  it("selects a configured stock avatar while preserving provider routing and offers its test", async () => {
    api.mockResolvedValue({ json: async () => ({ ...response(), stockAvatars: [
      { id: "anam-persona-default", providerId: "anam", name: "Anam saved persona", description: "native",
        kind: "configured", configured: true, languages: [] },
    ] }) });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "아바타 목록 조회" }));
    const option = await screen.findByRole("radio", { name: /아바타 saved persona 외부 서비스/ });
    expect(option.getAttribute("aria-disabled")).toBe("false");
    expect(option.textContent).not.toMatch(/\b(Tavus|Anam)\b/i);
    fireEvent.click(option);
    expect(JSON.parse(screen.getByTestId("draft").textContent!)).toMatchObject({
      kind: "stock", avatarId: "anam-persona-default", providerId: "anam",
      projectId: "project-one", activation: "draft", validationStatus: "unverified",
    });
    expect(screen.getByText("기본 아바타 · 외부 서비스 연결")).toBeTruthy();
    expect(screen.getByRole("region", { name: "아바타 표시 방식" }).textContent).not.toMatch(/anam-persona-default|tavus-stock-/i);
    expect(api).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "선택 아바타 테스트" }));
    expect(screen.getByTestId("anam-avatar-test")).toBeTruthy();
    expect(screen.queryByTestId("stock-avatar-test")).toBeNull();
  });
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
    fireEvent.click(screen.getByRole("radio", { name: /^맞춤 아바타/ }));
    fireEvent.click(screen.getByRole("button", { name: "아바타 목록 조회" }));
    await screen.findByLabelText("연결할 커스텀 자산");
    expect(api.mock.calls).toEqual([["GET", "/api/admin/personas/live-avatar/assets"]]);
    fireEvent.change(screen.getByLabelText("연결할 커스텀 자산"), { target: { value: id } });
    expect(JSON.parse(screen.getByTestId("draft").textContent!)).toEqual({ ...saved, kind: "custom" });
    expect(screen.getByText(/라우터 자산 상태: 준비 완료/)).toBeTruthy();
    expect(screen.getByText(/이미지가 연결된 자산은 프로젝트 보안 경로로 미리보기를 불러옵니다/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "아바타 연결 해제" }));
    expect(screen.getByTestId("draft").textContent).toBe("null");
  });

  it("lets a persona select a provider voice by gender without starting Gemini or a live session", async () => {
    const voices = [{
      id: "tavus-female-voice", providerId: "tavus", name: "Female voice", description: "Provider voice",
      gender: "female", genderSource: "provider", languages: ["ko"], available: true,
    }] as const;
    api.mockResolvedValue({ json: async () => response([row()], [...voices]) });
    render(<Harness initial={saved} />);
    fireEvent.click(screen.getByRole("button", { name: "아바타 목록 조회" }));
    await screen.findByLabelText("음성 모델");
    fireEvent.change(screen.getByLabelText("음성 성별"), { target: { value: "female" } });
    fireEvent.change(screen.getByLabelText("음성 모델"), { target: { value: "tavus-female-voice" } });
    expect(JSON.parse(screen.getByTestId("draft").textContent!)).toMatchObject({
      voiceSelection: { voiceId: "tavus-female-voice", gender: "female" },
    });
    expect(screen.getByText(/Gemini Live 음성을 함께 실행하지 않습니다/)).toBeTruthy();
    expect(api.mock.calls).toEqual([["GET", "/api/admin/personas/live-avatar/assets"]]);
    fireEvent.change(screen.getByLabelText("음성 성별"), { target: { value: "male" } });
    expect(JSON.parse(screen.getByTestId("draft").textContent!)).not.toHaveProperty("voiceSelection");
  });

  it("disables unready assets, separates live validation and preserves missing selections", async () => {
    api.mockResolvedValue({ json: async () => response([row({ id: "22345678-1234-4234-8234-123456789abc", status: "processing" })]) });
    render(<Harness initial={saved} />);
    fireEvent.click(screen.getByRole("button", { name: "아바타 목록 조회" }));
    await screen.findByText(/선택할 수 있는 프로젝트 커스텀 아바타가 없습니다/);
    expect(screen.queryByLabelText("연결할 커스텀 자산")).toBeNull();
    expect(screen.queryByRole("option", { name: /처리 중/ })).toBeNull();
    expect(screen.getByText(/새로 조회한 목록에서 저장된 자산을 찾지 못했습니다/)).toBeTruthy();
    expect(JSON.parse(screen.getByTestId("draft").textContent!)).toEqual(saved);
  });

  it("shows explicit scope, empty and malformed response errors instead of fake success", async () => {
    api.mockRejectedValue(new Error("403: avatar_assets_read_scope_missing"));
    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: /^맞춤 아바타/ }));
    fireEvent.click(screen.getByRole("button", { name: "아바타 목록 조회" }));
    expect((await screen.findByRole("alert")).textContent).toContain("assets:read");
    api.mockResolvedValue({ json: async () => response([]) });
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await screen.findByText(/선택할 수 있는 프로젝트 커스텀 아바타가 없습니다/);
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
    fireEvent.click(screen.getByRole("radio", { name: "라이브 아바타" }));
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
    expect(screen.getByRole("radio", { name: /Orbit.*선택 불가/ }).getAttribute("aria-disabled")).toBe("true");
    // An existing custom draft mounts its read-only preflight before we switch.
    api.mockClear();
    fireEvent.click(screen.getByRole("radio", { name: /Lucy 외부 서비스/ }));
    expect(JSON.parse(screen.getByTestId("draft").textContent!)).toEqual({
      kind: "stock", avatarId: "tavus-stock-lucy", providerId: "tavus", voiceMode: "roleplayx",
      validationStatus: "unverified", activation: "draft", projectId: "project-one",
    });
    expect(screen.getByText("기본 아바타 · 외부 서비스 연결")).toBeTruthy();
    expect(screen.getByRole("region", { name: "아바타 표시 방식" }).textContent).not.toMatch(/tavus-stock-lucy/i);
    expect(screen.queryByLabelText("연결할 커스텀 자산")).toBeNull();
    expect(screen.queryByText(/저장된 Tavus 자산/)).toBeNull();
    expect(api).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("radio", { name: /^맞춤 아바타/ }));
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

  it("opens the chosen custom test from a seed-linked persona without starting a paid session", async () => {
    const seedLinked: PersonaLiveAvatar = { ...saved, seedImageAssetId: "seed-image-id" };
    const seedDraft = { imageAssetId: "seed-image-id", imageVersion: 2, projectId: "project-one" } as any;
    function PersonaHarness() {
      const [avatar, setAvatar] = useState<PersonaLiveAvatar | null>(seedLinked);
      const [draft, setDraft] = useState<any>(seedDraft);
      return <>
        <PersonaAvatarSettings mode="live" liveAvatar={avatar} onModeChange={() => {}}
          onLiveAvatarChange={setAvatar} personaId="persona-123" seedSource="/media/persona.png"
          seedDraft={draft} onSeedDraftChange={setDraft} />
        <output data-testid="persona-avatar">{JSON.stringify(avatar)}</output>
      </>;
    }
    render(<PersonaHarness />);
    expect(await screen.findByTestId("seed-panel")).toBeTruthy();
    expect(api.mock.calls).toEqual([["GET", "/api/admin/personas/live-avatar/assets"]]);

    fireEvent.click(screen.getByRole("button", { name: "선택 아바타 테스트" }));
    expect(screen.getByTestId("custom-avatar-test").textContent).toContain(id);
    expect(screen.queryByTestId("seed-panel")).toBeNull();
    expect(api.mock.calls).toEqual([["GET", "/api/admin/personas/live-avatar/assets"]]);
    expect(screen.getByText(/선택한 아바타를 라우터에 연결/)).toBeTruthy();
  });

  it("opens the correct catalog-selected test in the persona editor and locks the selection through cleanup", async () => {
    const otherId = "22345678-1234-4234-8234-123456789abc";
    const seedDraft = { imageAssetId: "seed-image-id", imageVersion: 2, projectId: "project-one" } as any;
    function PersonaHarness() {
      const [avatar, setAvatar] = useState<PersonaLiveAvatar | null>(null);
      const [draft, setDraft] = useState<any>(seedDraft);
      return <>
        <PersonaAvatarSettings mode="live" liveAvatar={avatar} onModeChange={() => {}}
          onLiveAvatarChange={setAvatar} personaId="persona-123" seedSource="/media/persona.png"
          seedDraft={draft} onSeedDraftChange={setDraft} />
        <output data-testid="persona-avatar">{JSON.stringify(avatar)}</output>
      </>;
    }
    api.mockResolvedValue({ json: async () => response([row(), row({ id: otherId, name: "두 번째 아바타" })]) });
    render(<PersonaHarness />);
    expect(await screen.findByText("프로젝트 커스텀 아바타")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "이 자산 선택" })[1]);
    expect(JSON.parse(screen.getByTestId("persona-avatar").textContent!)).toMatchObject({ kind: "custom", assetId: otherId });
    fireEvent.click(screen.getByRole("button", { name: "선택 아바타 테스트" }));
    expect(screen.getByTestId("custom-avatar-test").textContent).toContain(otherId);
    expect(screen.queryByTestId("seed-panel")).toBeNull();
    expect(api.mock.calls).toEqual([["GET", "/api/admin/personas/live-avatar/assets"]]);

    fireEvent.click(screen.getByRole("button", { name: "Mock session start" }));
    expect(screen.getByRole("radio", { name: "기본 아바타" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("radio", { name: "이미지" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "선택 아바타 테스트 닫기" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "이 자산 선택" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("custom-avatar-test").textContent).toContain(otherId);

    fireEvent.click(screen.getByRole("button", { name: "Mock session end" }));
    fireEvent.click(screen.getByRole("button", { name: "선택 아바타 테스트 닫기" }));
    expect(screen.queryByTestId("custom-avatar-test")).toBeNull();
    expect(screen.getByRole("button", { name: "시드 준비 열기" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "시드 준비 열기" }));
    expect(await screen.findByTestId("seed-panel")).toBeTruthy();
    expect(api.mock.calls).toEqual([["GET", "/api/admin/personas/live-avatar/assets"]]);
  });

  it("does not offer a selected-avatar test without a selection in persona editor props", async () => {
    const seedDraft = { imageAssetId: "seed-image-id", imageVersion: 2, projectId: "project-one" } as any;
    render(<PersonaAvatarSettings mode="live" liveAvatar={null} onModeChange={() => {}}
      onLiveAvatarChange={vi.fn()} personaId="persona-123" seedDraft={seedDraft} onSeedDraftChange={vi.fn()} />);
    await screen.findByText("프로젝트 커스텀 아바타");
    expect(screen.queryByRole("button", { name: "선택 아바타 테스트" })).toBeNull();
    expect(screen.queryByTestId("custom-avatar-test")).toBeNull();
    expect(api.mock.calls).toEqual([["GET", "/api/admin/personas/live-avatar/assets"]]);
  });

  it("shows only the chosen kind and opens custom creation explicitly without starting requests", () => {
    render(<Harness />);
    expect(screen.queryByRole("button", { name: "생성 양식 열기" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "맞춤 아바타" }));
    expect(screen.getByRole("radio", { name: "맞춤 아바타" }).getAttribute("aria-checked")).toBe("true");
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
    fireEvent.click(screen.getByRole("radio", { name: "맞춤 아바타" }));
    expect(screen.queryByTestId("custom-avatar-test")).toBeNull();
    expect(screen.queryByRole("button", { name: "선택 아바타 테스트" })).toBeNull();
    expect(api).not.toHaveBeenCalled();
  });

  it("offers the existing stock test for an explicitly selected supported avatar", async () => {
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
    expect(screen.getByTestId("stock-avatar-test").textContent).toContain("Default avatar test");
    expect(api).not.toHaveBeenCalled();
  });

  it("neutralizes vendor-branded dynamic catalog names and provider labels", async () => {
    api.mockResolvedValue({ json: async () => ({
      ...response([row({ name: "Tavus custom asset" })]),
      stockAvatars: [
        { id: "anam-persona-default", providerId: "anam", name: "Anam saved persona", description: "native",
          kind: "configured", configured: true, languages: [] },
      ],
    }) });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "아바타 목록 조회" }));
    const stockOption = await screen.findByRole("radio", { name: /아바타 saved persona 외부 서비스/ });
    expect(stockOption.textContent).not.toMatch(/\b(Tavus|Anam)\b/i);
    fireEvent.click(screen.getByRole("radio", { name: "맞춤 아바타" }));
    const assetOption = await screen.findByRole("option", { name: /아바타 custom asset · 외부 서비스 · 준비 완료/ });
    expect(assetOption.textContent).not.toMatch(/\b(Tavus|Anam)\b/i);
    expect(stockOption.textContent).toContain("외부 서비스");
    expect(assetOption.textContent).toContain("외부 서비스");
  });

  it("loads the project catalog in persona seed flow and only clears seed draft on explicit asset selection", async () => {
    const seedDraft = { imageAssetId: "image-id", imageVersion: 2, projectId: "project-one" } as any;
    function PersonaHarness() {
      const [avatar, setAvatar] = useState<PersonaLiveAvatar | null>(null);
      const [draft, setDraft] = useState<any>(seedDraft);
      return <>
        <PersonaAvatarSettings mode="live" liveAvatar={avatar} onModeChange={() => {}}
          onLiveAvatarChange={setAvatar} personaId="persona-123" seedSource="/media/persona.png"
          seedDraft={draft} onSeedDraftChange={setDraft} />
        <output data-testid="persona-avatar">{JSON.stringify(avatar)}</output>
        <output data-testid="persona-seed-draft">{JSON.stringify(draft)}</output>
      </>;
    }
    api.mockImplementation(async (_method: string, url: string) => url.endsWith("/thumbnail")
      ? { blob: async () => new Blob(["thumbnail"], { type: "image/png" }) }
      : { json: async () => response([row({ imageAssetId: "22345678-1234-4234-8234-123456789abc" })]) });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:avatar-thumbnail");
    render(<PersonaHarness />);

    expect(screen.getByRole("radio", { name: "맞춤 아바타" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/Live 아바타 표시가 선택되어 있지만 연결된 아바타는 없습니다/)).toBeTruthy();
    expect(await screen.findByText("프로젝트 커스텀 아바타")).toBeTruthy();
    expect(screen.getByText("테스트 인물")).toBeTruthy();
    expect(screen.getByText(`자산 ID · ${id}`)).toBeTruthy();
    const thumbnail = await screen.findByRole("img", { name: "테스트 인물 썸네일" }) as HTMLImageElement;
    expect(thumbnail.getAttribute("src")).toBe("blob:avatar-thumbnail");
    expect(screen.queryByText("선택할 수 없음")).toBeNull();
    expect(api.mock.calls).toEqual([
      ["GET", "/api/admin/personas/live-avatar/assets"],
      ["GET", `/api/admin/personas/live-avatar/assets/${id}/thumbnail`],
    ]);

    fireEvent.click(screen.getByRole("button", { name: "이 자산 선택" }));
    expect(JSON.parse(screen.getByTestId("persona-avatar").textContent!)).toMatchObject({
      kind: "custom", assetId: id, providerId: "tavus", projectId: "project-one",
    });
    expect(screen.getByTestId("persona-seed-draft").textContent).toBe("null");
    expect(screen.queryByTestId("seed-panel")).toBeNull();
    expect(api.mock.calls).toEqual([
      ["GET", "/api/admin/personas/live-avatar/assets"],
      ["GET", `/api/admin/personas/live-avatar/assets/${id}/thumbnail`],
    ]);
  });

  it("shows only selectable project avatars and explains when none are available", async () => {
    api.mockResolvedValue({ json: async () => response([
      row({ id, name: "준비된 아바타" }),
      row({ id: "32345678-1234-4234-8234-123456789abc", name: "처리 중인 아바타", status: "processing" }),
    ]) });
    const seedDraft = { imageAssetId: "seed-image-id", imageVersion: 2, projectId: "project-one" } as any;
    render(<PersonaAvatarSettings mode="live" liveAvatar={null} onModeChange={() => {}}
      onLiveAvatarChange={vi.fn()} personaId="persona-123" seedDraft={seedDraft} onSeedDraftChange={vi.fn()} />);
    expect(await screen.findByText("준비된 아바타")).toBeTruthy();
    expect(screen.queryByText("처리 중인 아바타")).toBeNull();

    api.mockResolvedValue({ json: async () => response([row({ status: "processing" })]) });
    fireEvent.click(screen.getByRole("button", { name: "목록 새로고침" }));
    expect(await screen.findByText(/선택할 수 있는 프로젝트 커스텀 아바타가 없습니다/)).toBeTruthy();
    expect(screen.queryByText("준비된 아바타")).toBeNull();
  });

  it("keeps a saved custom selection on catalog refresh errors in persona editor", async () => {
    api.mockRejectedValue(new Error("network unavailable"));
    function PersonaHarness() {
      const [avatar, setAvatar] = useState<PersonaLiveAvatar | null>(saved);
      const [draft, setDraft] = useState<any>(null);
      return <>
        <PersonaAvatarSettings mode="live" liveAvatar={avatar} onModeChange={() => {}}
          onLiveAvatarChange={setAvatar} personaId="persona-123" seedDraft={draft} onSeedDraftChange={setDraft} />
        <output data-testid="persona-avatar">{JSON.stringify(avatar)}</output>
      </>;
    }
    render(<PersonaHarness />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(JSON.parse(screen.getByTestId("persona-avatar").textContent!)).toEqual(saved);
    fireEvent.click(screen.getByRole("button", { name: "아바타 목록 조회" }));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    expect(JSON.parse(screen.getByTestId("persona-avatar").textContent!)).toEqual(saved);
    expect(api.mock.calls).toEqual([
      ["GET", "/api/admin/personas/live-avatar/assets"],
      ["GET", "/api/admin/personas/live-avatar/assets"],
    ]);
  });
});
