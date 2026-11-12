// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ api: vi.fn(), user: { id: "admin" } }));
vi.mock("../../client/src/lib/queryClient", () => ({ apiRequest: mocks.api }));
vi.mock("../../client/src/hooks/useAuth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("../../client/src/components/admin/PersonaAvatarValidationPanel", () => ({ PersonaAvatarValidationPanel: () => <div>검증 화면</div> }));
import { PersonaSeedLivePanel } from "../../client/src/components/admin/PersonaSeedLivePanel";
const imageId = "22345678-1234-4234-8234-123456789abc", assetId = "12345678-1234-4234-8234-123456789abc";
const draft = { imageAssetId: imageId, imageVersion: 1, projectId: "project", sourceFingerprint: "a".repeat(64) };
const state = (candidates: any[] = []) => ({ stage: "registered", uncertain: false, draft,
  options: { imageAssetId: imageId, imageVersion: 1, providerId: "tavus", canProvision: !candidates.length, nextAction: "provision", candidates } });
const candidate = { avatarAssetId: assetId, status: "ready", nextAction: "validate", canActivate: false, liveReference: null };
const response = (value: any) => ({ json: async () => value });
const props = () => ({ personaId: "coach", source: "personas/coach/a.webp", draft,
  onDraftChange: vi.fn(), onSelect: vi.fn() });
beforeEach(() => { vi.clearAllMocks(); mocks.user.id = "admin"; mocks.api.mockResolvedValue(response(state())); });
afterEach(cleanup);
describe("seed editor mock UI", () => {
  it("hydrates by GET only and does not clear saved selection simply by mounting", async () => {
    const p = props(); render(<PersonaSeedLivePanel {...p} />);
    await waitFor(() => expect(p.onDraftChange).toHaveBeenCalledWith(draft));
    expect(p.onSelect).not.toHaveBeenCalled();
    expect(mocks.api.mock.calls.every(c => c[0] === "GET")).toBe(true);
    expect((screen.getByTestId("button-seed-create") as HTMLButtonElement).disabled).toBe(true);
  });
  it("discards delayed previous-source response, clearing selection on actual source change", async () => {
    let resolve!: (value: any) => void;
    mocks.api.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const p = props(); const view = render(<PersonaSeedLivePanel {...p} />);
    mocks.api.mockResolvedValue(response({ stage: "idle", uncertain: false, draft: null, options: null }));
    view.rerender(<PersonaSeedLivePanel {...p} source="personas/coach/b.webp" />);
    await waitFor(() => expect(p.onSelect).toHaveBeenCalledWith(null));
    await act(async () => resolve(response(state([candidate]))));
    expect(screen.queryByTestId(`card-seed-candidate-${assetId}`)).toBeNull();
    expect(p.onDraftChange).not.toHaveBeenCalledWith(draft);
    expect(mocks.api.mock.calls.every(c => c[0] === "GET")).toBe(true);
  });
  it("shows exact safe failure and retains failed candidate as unverified draft without POST", async () => {
    mocks.api.mockResolvedValue(response(state([{ ...candidate, status: "failed", nextAction: "replace_image", failure: {
      code: "PROVIDER_TRAINING_FAILED", stage: "status", category: "input", providerHttpStatus: 200,
      providerErrorCode: "training_image_framing_invalid", reasonState: "safe_code",
      message: "Crop", messageKo: "배꼽 위로 자르고 팔을 낮추세요.", automaticRetryAllowed: false,
      nextAction: "replace_image", creationOutcome: "created",
    } }])));
    const p = props(); render(<PersonaSeedLivePanel {...p} />);
    await screen.findByText("배꼽 위로 자르고 팔을 낮추세요.");
    fireEvent.click(screen.getByTestId(`button-seed-select-${assetId}`));
    expect(p.onSelect).toHaveBeenCalledWith(expect.objectContaining({ assetId, validationStatus: "unverified", seedImageAssetId: imageId }));
    expect(mocks.api.mock.calls.every(c => c[0] === "GET")).toBe(true);
  });
  it("requires separate cost consent, sends one create, and fences ambiguity until a fresh GET", async () => {
    const p = props(); render(<PersonaSeedLivePanel {...p} />);
    await screen.findByTestId("button-seed-create");
    fireEvent.click(screen.getByLabelText("외부 제공자 비용이 발생할 수 있음을 확인했습니다."));
    mocks.api.mockRejectedValueOnce(new Error("avatar_test_operation_uncertain"));
    fireEvent.click(screen.getByTestId("button-seed-create"));
    await screen.findByText(/요청 결과가 불확실합니다/);
    fireEvent.click(screen.getByTestId("button-seed-create"));
    expect(mocks.api.mock.calls.filter(c => c[0] === "POST")).toHaveLength(1);
    expect(mocks.api.mock.calls.find(c => c[0] === "POST")?.[2]).toEqual({ costConfirmed: true });
  });
  it("confirms reset, clears selection and consents, then allows explicit registration and resubmission", async () => {
    mocks.api.mockResolvedValueOnce(response({ ...state([candidate]), stage: "submitted" }));
    const p = props(); render(<PersonaSeedLivePanel {...p} />);
    await screen.findByTestId(`card-seed-candidate-${assetId}`);
    fireEvent.click(screen.getByLabelText("외부 제공자 비용이 발생할 수 있음을 확인했습니다."));
    fireEvent.click(screen.getByTestId("button-seed-reset"));
    expect(mocks.api.mock.calls.every(c => c[0] === "GET")).toBe(true);
    expect(screen.getByText(/기존 아바타 자산은 삭제하지/)).toBeTruthy();
    mocks.api.mockResolvedValueOnce(response({ stage: "idle", draft: null, options: null, uncertain: false }));
    fireEvent.click(screen.getByTestId("button-seed-reset-confirm"));
    await screen.findByTestId("button-seed-register");
    expect(p.onSelect).toHaveBeenCalledWith(null);
    expect(p.onDraftChange).toHaveBeenLastCalledWith(null);
    expect(mocks.api.mock.calls.find(c => c[0] === "POST")).toEqual([
      "POST", expect.stringContaining("/seed/reset?"), { confirmed: true, draft },
    ]);
    expect((screen.getByTestId("button-seed-register") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("이미지 사용 권리와 초상 사용 권한을 확인했습니다."));
    fireEvent.click(screen.getByLabelText("저장된 이미지가 외부 서비스에 전송됨을 확인했습니다."));
    mocks.api.mockResolvedValueOnce(response(state()));
    fireEvent.click(screen.getByTestId("button-seed-register"));
    await screen.findByTestId("button-seed-create");
    expect((screen.getByTestId("button-seed-create") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("외부 제공자 비용이 발생할 수 있음을 확인했습니다."));
    mocks.api.mockResolvedValueOnce(response({ ...state(), stage: "submitted" }));
    fireEvent.click(screen.getByTestId("button-seed-create"));
    await waitFor(() => expect(mocks.api.mock.calls.filter(c => c[0] === "POST")).toHaveLength(3));
    expect(mocks.api.mock.calls.filter(c => c[0] === "POST").map(c => c[1])).toEqual([
      expect.stringContaining("/seed/reset?"), expect.stringContaining("/seed?"), expect.stringContaining("/seed/create?"),
    ]);
  });
  it.each(["queued", "processing", "reconciliation_required"])("disables reset for %s candidates", async status => {
    mocks.api.mockResolvedValueOnce(response({ ...state([{ ...candidate, status }]), stage: "submitted" }));
    render(<PersonaSeedLivePanel {...props()} />);
    await screen.findByTestId("button-seed-reset");
    expect((screen.getByTestId("button-seed-reset") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("button-seed-reset"));
    expect(screen.queryByTestId("button-seed-reset-confirm")).toBeNull();
    expect(mocks.api.mock.calls.every(c => c[0] === "GET")).toBe(true);
  });
  it("cancels reset without a POST and keeps the current candidate", async () => {
    mocks.api.mockResolvedValueOnce(response({ ...state([candidate]), stage: "submitted" }));
    render(<PersonaSeedLivePanel {...props()} />);
    await screen.findByTestId("button-seed-reset");
    fireEvent.click(screen.getByTestId("button-seed-reset"));
    fireEvent.click(screen.getByText("취소"));
    expect(screen.queryByTestId("button-seed-reset-confirm")).toBeNull();
    expect(screen.getByTestId(`card-seed-candidate-${assetId}`)).toBeTruthy();
    expect(mocks.api.mock.calls.every(c => c[0] === "GET")).toBe(true);
  });
});
