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
});
