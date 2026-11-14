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
const failedCandidate = {
  ...candidate, status: "failed", nextAction: "inspect_failure", failure: {
    code: "TRAINING_IMAGE_AI_MODEL_UNAVAILABLE", stage: "unknown", trainingImageStage: "inspection",
    category: "permission_or_plan", providerHttpStatus: null, providerErrorCode: null, reasonState: "not_retained",
    message: "Old model error", messageKo: "과거 모델 오류 원문",
    automaticRetryAllowed: false, nextAction: "operator_review", creationOutcome: "not_created",
  },
};
const retryState = () => {
  const result = state([failedCandidate]);
  result.options.canProvision = true;
  return result;
};
const response = (value: any) => ({ json: async () => value });
const props = () => ({ personaId: "coach", source: "personas/coach/a.webp", draft,
  onDraftChange: vi.fn(), onSelect: vi.fn() });
beforeEach(() => { vi.clearAllMocks(); mocks.user.id = "admin"; mocks.api.mockResolvedValue(response(state())); });
afterEach(cleanup);
describe("seed editor mock UI", () => {
  it("uploads the saved image and requests creation with one click after three consents", async () => {
    mocks.api.mockResolvedValueOnce(response({ stage: "idle", uncertain: false, draft: null, options: null }));
    render(<PersonaSeedLivePanel {...props()} draft={null} />);
    const button = await screen.findByTestId("button-seed-upload-create");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("이미지 사용 권리와 초상 사용 권한을 확인했습니다."));
    fireEvent.click(screen.getByLabelText("저장된 이미지가 외부 서비스에 전송됨을 확인했습니다."));
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("외부 제공자 비용이 발생할 수 있음을 확인했습니다."));
    mocks.api.mockResolvedValueOnce(response({ stage: "submitted", uncertain: false, draft, options: null }));
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByTestId("status-seed-transmission");
    expect(screen.getByTestId("status-seed-transmission").textContent).toContain("아바타 생성 API 접수 완료");
    expect(mocks.api.mock.calls.filter(c => c[0] === "POST")).toEqual([
      ["POST", expect.stringContaining("/seed/create?"), { costConfirmed: true,
        registration: { rightsConfirmed: true, transferConfirmed: true, likeness: "synthetic" } }],
    ]);
    expect(screen.getByAltText("아바타 라우터에 전달한 시드 이미지").getAttribute("src")).toContain(`imageAssetId=${imageId}`);
  });
  it("distinguishes an image upload rejection from a creation API failure", async () => {
    mocks.api.mockResolvedValueOnce(response({ stage: "idle", uncertain: false, draft: null, options: null }));
    render(<PersonaSeedLivePanel {...props()} draft={null} />);
    await screen.findByTestId("button-seed-upload-create");
    for (const label of ["이미지 사용 권리와 초상 사용 권한을 확인했습니다.", "저장된 이미지가 외부 서비스에 전송됨을 확인했습니다.",
      "외부 제공자 비용이 발생할 수 있음을 확인했습니다."]) fireEvent.click(screen.getByLabelText(label));
    mocks.api.mockRejectedValueOnce(new Error("422: persona_seed_upload_avatar_test_upstream_422"));
    fireEvent.click(screen.getByTestId("button-seed-upload-create"));
    expect((await screen.findByTestId("text-seed-error")).textContent).toContain("아바타 생성 API는 호출하지 않았습니다");
    expect(screen.getByTestId("text-seed-error").textContent).toContain("시드 이미지 업로드 단계");
    expect(screen.queryByText(/이전 요청 결과가 불확실합니다/)).toBeNull();
  });
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
    await screen.findByText(/이전 요청 결과가 불확실합니다/);
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
  it("labels retained model failure as history and manually retries after separate cost consent", async () => {
    mocks.api.mockResolvedValueOnce(response(retryState()));
    render(<PersonaSeedLivePanel {...props()} />);
    const history = await screen.findByTestId(`history-seed-failure-${assetId}`);
    expect(history.getAttribute("role")).toBe("note");
    expect(history.textContent).toContain("아바타 라우터가 반환한 처리 결과");
    expect(history.textContent).toContain("과거 모델 오류 원문");
    expect(history.textContent).toContain("이미지 처리 단계 inspection");
    expect(history.textContent).not.toContain("현재 모델 상태");
    expect(history.textContent).not.toContain("제공자 아바타 생성이 전송되지 않았습니다");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("text-seed-retry-available")).toBeTruthy();
    expect((screen.getByTestId("button-seed-create") as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.api.mock.calls.every(c => c[0] === "GET")).toBe(true);
    fireEvent.click(screen.getByLabelText("외부 제공자 비용이 발생할 수 있음을 확인했습니다."));
    let resolve!: (value: any) => void;
    mocks.api.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    fireEvent.click(screen.getByTestId("button-seed-create"));
    fireEvent.click(screen.getByTestId("button-seed-create"));
    await act(async () => resolve(response({ ...state([{ ...candidate, status: "queued", nextAction: "wait" }]), stage: "submitted" })));
    expect(mocks.api.mock.calls.filter(c => c[0] === "POST")).toHaveLength(1);
    expect(mocks.api.mock.calls.find(c => c[0] === "POST")).toEqual([
      "POST", expect.stringContaining("/seed/create?"), { costConfirmed: true },
    ]);
    expect((screen.getByLabelText("외부 제공자 비용이 발생할 수 있음을 확인했습니다.") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId("button-seed-create") as HTMLButtonElement).disabled).toBe(true);
  });
  it("does not mislabel a definitive local creation block as an ambiguous paid request", async () => {
    mocks.api.mockResolvedValueOnce(response(retryState()));
    render(<PersonaSeedLivePanel {...props()} />);
    await screen.findByTestId("text-seed-retry-available");
    fireEvent.click(screen.getByLabelText("외부 제공자 비용이 발생할 수 있음을 확인했습니다."));
    mocks.api.mockRejectedValueOnce(new Error("409: persona_seed_creation_blocked"));
    fireEvent.click(screen.getByTestId("button-seed-create"));
    const error = await screen.findByTestId("text-seed-error");
    expect(error.textContent).toContain("현재 요청 오류");
    expect(error.textContent).toContain("새 생성 요청은 전송하지 않았습니다");
    expect(screen.queryByText(/상태 조회에서 불확실 상태가 해제될 때까지/)).toBeNull();
    expect(screen.getByTestId(`history-seed-failure-${assetId}`).getAttribute("role")).toBe("note");
  });
  it.each(["queued", "processing", "reconciliation_required", "ready"])(
    "forwards manual requests for %s candidates without local admission checks", async status => {
      const current = retryState(); current.options.candidates = [{ ...failedCandidate, status }];
      current.options.canProvision = false;
      mocks.api.mockResolvedValueOnce(response(current));
      render(<PersonaSeedLivePanel {...props()} />);
      await screen.findByTestId("button-seed-create");
      fireEvent.click(screen.getByLabelText("외부 제공자 비용이 발생할 수 있음을 확인했습니다."));
      expect((screen.getByTestId("button-seed-create") as HTMLButtonElement).disabled).toBe(false);
      mocks.api.mockResolvedValueOnce(response({ ...current, stage: "submitted" }));
      fireEvent.click(screen.getByTestId("button-seed-create"));
      await waitFor(() => expect(mocks.api.mock.calls.filter(c => c[0] === "POST")).toHaveLength(1));
    },
  );
  it("warns about uncertainty without blocking explicit router forwarding", async () => {
    mocks.api.mockResolvedValueOnce(response({ ...retryState(), stage: "creating", uncertain: true }));
    render(<PersonaSeedLivePanel {...props()} />);
    await screen.findByTestId("button-seed-create");
    fireEvent.click(screen.getByLabelText("외부 제공자 비용이 발생할 수 있음을 확인했습니다."));
    expect((screen.getByTestId("button-seed-create") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId("button-seed-reset") as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.api.mock.calls.every(c => c[0] === "GET")).toBe(true);
  });
  it("shows the exact registered router image/version instead of the current base image", async () => {
    render(<PersonaSeedLivePanel {...props()} />);
    await screen.findByTestId("button-seed-create");
    const image = screen.getByAltText("아바타 라우터에 전달한 시드 이미지");
    expect(image.getAttribute("src")).toContain("/personas/coach/seed/image?");
    expect(image.getAttribute("src")).toContain(`imageAssetId=${imageId}&imageVersion=1`);
    expect(image.getAttribute("src")).not.toContain("/objects?");
    expect(screen.getByTestId("preview-seed-image").textContent).toContain("v1");
    fireEvent.error(image);
    expect(screen.getByText(/다른 이미지로 대체 표시하지 않습니다/)).toBeTruthy();
    expect(screen.queryByAltText("등록할 페르소나 기본 이미지")).toBeNull();
    fireEvent.click(screen.getByText("이미지 다시 불러오기"));
    expect(screen.getByAltText("아바타 라우터에 전달한 시드 이미지").getAttribute("src")).toContain("previewRefresh=1");
    expect(mocks.api.mock.calls.every(c => c[0] === "GET")).toBe(true);
  });
  it("clearly labels a local image as not yet registered", async () => {
    mocks.api.mockResolvedValueOnce(response({ stage: "idle", uncertain: false, draft: null, options: null }));
    render(<PersonaSeedLivePanel {...props()} draft={null} />);
    await screen.findByTestId("button-seed-register");
    expect(screen.getByAltText("등록할 페르소나 기본 이미지").getAttribute("src")).toContain("/objects?key=");
    expect(screen.getByText("등록 전 기본 이미지")).toBeTruthy();
    expect(screen.queryByAltText("아바타 라우터에 전달한 시드 이미지")).toBeNull();
  });
  it("still allows a saved seed request if the status read is unavailable, and displays router rejection", async () => {
    mocks.api.mockRejectedValueOnce(new Error("avatar_test_read_failed"));
    render(<PersonaSeedLivePanel {...props()} />);
    await screen.findByTestId("text-seed-error");
    fireEvent.click(screen.getByLabelText("외부 제공자 비용이 발생할 수 있음을 확인했습니다."));
    expect((screen.getByTestId("button-seed-create") as HTMLButtonElement).disabled).toBe(false);
    mocks.api.mockRejectedValueOnce(new Error("409: avatar_test_upstream_409"));
    fireEvent.click(screen.getByTestId("button-seed-create"));
    await screen.findByText(/아바타 라우터 응답: HTTP 409/);
    expect(mocks.api.mock.calls.filter(c => c[0] === "POST")).toHaveLength(1);
  });
  it("shows the router's public error without replacing it with local model guidance", async () => {
    render(<PersonaSeedLivePanel {...props()} />);
    await screen.findByTestId("button-seed-create");
    fireEvent.click(screen.getByLabelText("외부 제공자 비용이 발생할 수 있음을 확인했습니다."));
    mocks.api.mockRejectedValueOnce(new Error(`409: ${JSON.stringify({
      code: "avatar_test_upstream_409", avatarRouter: { code: "ROUTER_JOB_REJECTED", error: "Router returned this exact message." },
    })}`));
    fireEvent.click(screen.getByTestId("button-seed-create"));
    const error = await screen.findByTestId("text-seed-error");
    expect(error.textContent).toContain("ROUTER_JOB_REJECTED: Router returned this exact message.");
    expect(error.textContent).not.toContain("모델");
  });
});
