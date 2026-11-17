// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ api: vi.fn(), actor: { user: { id: "owner" } } }));
vi.mock("../../client/src/lib/queryClient", () => ({ apiRequest: mocks.api }));
vi.mock("../../client/src/hooks/useAuth", () => ({ useAuth: () => mocks.actor }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, options: any) => options?.defaultValue ?? _key, i18n: { language: "ko" } }),
}));
vi.mock("../../client/src/components/chat/useTavusTranscript", () => ({
  useTavusTranscript: () => ({ transcriptState: "unavailable", messages: [] }),
}));
vi.mock("../../client/src/components/chat/TavusConversationLayout", () => ({
  default: (p: any) => <div>
    <button disabled={p.microphoneDisabled} onClick={p.onMicrophoneClick}>대화 마이크</button>
    {p.preStartControls}{p.stage}{p.sessionControls}
  </div>,
}));
vi.mock("../../client/src/components/chat/ManagedAvatarRoom", () => ({ default: () => <div>legacy media client</div> }));
vi.mock("../../client/src/components/chat/DailyAvatarRoom", () => ({ default: () => null }));
import TavusChatWindow from "../../client/src/components/chat/TavusChatWindow";
let state: any;
let config: any;
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
  state = { state: "active", id: "owned", managedClient: true, providerId: "anam", evaluationAvailable: false };
  config = { available: true, managedClient: true, providerId: "anam" };
  mocks.api.mockReset();
  mocks.api.mockImplementation(async (method, path) => {
    if (path.includes("/config?")) return { json: async () => config };
    if (method === "POST" && path.endsWith("/end")) {
      state = { ...state, state: "ending", rendererState: "closing", cleanupPending: true };
    }
    return { json: async () => state };
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function view(onExit = vi.fn()) {
  return render(<TavusChatWindow conversationId="run" persona={{ id: "actor", name: "Actor" } as any}
    scenario={{ title: "Scenario" } as any} onChatComplete={vi.fn()} onExit={onExit} onExitMode={vi.fn()} />);
}
describe("actual external app end and manual reconfirm screen", () => {
  it("removes header exit while preserving keepalive cleanup when an active room unmounts", async () => {
    const onExit = vi.fn();
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    const rendered = view(onExit);
    await screen.findByText("legacy media client");
    expect(screen.queryByTestId("tavus-exit")).toBeNull();
    rendered.unmount();
    expect(onExit).not.toHaveBeenCalled();
    expect(screen.queryByText("legacy media client")).toBeNull();
    expect(fetch).toHaveBeenCalledWith("/api/tavus/conversations/run/end",
      expect.objectContaining({ method: "POST", credentials: "include", keepalive: true }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mocks.api.mock.calls.every(c => c[0] === "GET")).toBe(true);
  });
  it("keeps pending startup cleanup on unmount without restoring a header exit or starting another session", async () => {
    state = { ...state, state: "creating" };
    const onExit = vi.fn();
    const rendered = view(onExit);
    await screen.findByText(/대화 공간 시작 상태 확인 중/);
    expect(screen.queryByTestId("tavus-exit")).toBeNull();
    rendered.unmount();
    expect(onExit).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mocks.api.mock.calls.every(c => c[0] === "GET")).toBe(true);
  });
  it("leaves an idle or already ended session without another end request", async () => {
    for (const stateName of ["idle", "ended"]) {
      state = { ...state, state: stateName };
      const onExit = vi.fn();
      const rendered = view(onExit);
      await waitFor(() => expect(mocks.api.mock.calls.some(c => c[1].includes("/config?"))).toBe(true));
      await waitFor(() => expect(screen.queryByText(/세션 상태를 확인하고 있습니다/)).toBeNull());
      expect(screen.queryByTestId("tavus-exit")).toBeNull();
      if (stateName === "ended") {
        fireEvent.click(screen.getByTestId("tavus-close"));
        expect(onExit).toHaveBeenCalledTimes(1);
      } else expect(onExit).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      rendered.unmount();
      mocks.api.mockClear();
    }
  });
  it("forwards a manual start despite unavailable metadata without exposing status-check controls", async () => {
    state = { state: "idle" };
    config = { ...config, available: false, blockers: ["avatar_runtime_worker_unavailable"] };
    view();
    await waitFor(() => expect((screen.getByRole("button", { name: "대화 마이크" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole("button", { name: "상태 확인" })).toBeNull();
    expect(screen.queryByTestId("tavus-availability-retry")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "대화 마이크" }));
    await waitFor(() => expect(mocks.api.mock.calls.filter(c => c[0] === "POST" && c[1].endsWith("/start"))).toHaveLength(1));
  });
  it("allows an explicit start after an unknown creation without requiring status recovery", async () => {
    state = { state: "create_unknown", error: "503: unavailable" };
    view();
    await screen.findByTestId("tavus-error");
    expect(screen.queryByRole("button", { name: "상태 확인" })).toBeNull();
    expect(screen.queryByTestId("tavus-create-unknown")).toBeNull();
    expect(screen.queryByTestId("tavus-start")).toBeNull();
    expect(mocks.api.mock.calls.every(c => c[0] === "GET")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "대화 마이크" }));
    await waitFor(() => expect(mocks.api.mock.calls.some(c => c[0] === "POST" && c[1].endsWith("/start"))).toBe(true));
  });
  it("does not start an unverified persona when the initial configuration request fails", async () => {
    state = { state: "idle" };
    const implementation = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation(async (method, path) => {
      if (path.includes("/config?")) throw new Error("503: temporarily unavailable");
      return implementation(method, path);
    });
    view();
    await screen.findByText("대화할 준비가 되었습니다");
    expect((screen.getByRole("button", { name: "대화 마이크" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "상태 확인" })).toBeNull();
    expect(screen.queryByTestId("tavus-start")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "대화 마이크" }));
    expect(mocks.api.mock.calls.some(c => c[0] === "POST" && c[1].endsWith("/start"))).toBe(false);
  });
  it("ends from the report control without asking the learner to reconfirm server cleanup", async () => {
    view();
    await screen.findByText("legacy media client");
    fireEvent.click(screen.getByTestId("tavus-end"));
    await screen.findByText(/대화 공간 종료를 확인하고 있습니다/);
    expect(screen.queryByTestId("tavus-start")).toBeNull();
    expect(screen.queryByTestId("avatar-cleanup-refresh")).toBeNull();
    expect(screen.queryByRole("button", { name: "상태 확인" })).toBeNull();
    expect(mocks.api.mock.calls.filter(c => c[0] === "POST" && c[1].endsWith("/end"))).toHaveLength(1);
  });
  it("does not require cleanup confirmation on a recovered ended session", async () => {
    state = { state: "ended", id: "owned", managedClient: true, providerId: "anam" };
    view();
    await screen.findByTestId("tavus-evaluation-unavailable");
    expect(screen.queryByTestId("avatar-cleanup-notice")).toBeNull();
    expect(screen.queryByTestId("avatar-cleanup-refresh")).toBeNull();
    expect(screen.queryByText("legacy media client")).toBeNull();
    expect(mocks.api.mock.calls.every(c => c[0] === "GET")).toBe(true);
    expect(screen.queryByTestId("tavus-start")).toBeNull();
  });
});
