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
  default: (p: any) => <div>{p.preStartControls}{p.headerActions}{p.stage}{p.sessionControls}</div>,
}));
vi.mock("../../client/src/components/chat/ManagedAvatarRoom", () => ({ default: () => <div>legacy media client</div> }));
vi.mock("../../client/src/components/chat/DailyAvatarRoom", () => ({ default: () => null }));
import TavusChatWindow from "../../client/src/components/chat/TavusChatWindow";
let state: any;
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
  state = { state: "active", id: "owned", managedClient: true, providerId: "anam", evaluationAvailable: false };
  mocks.api.mockReset();
  mocks.api.mockImplementation(async (method, path) => {
    if (path.includes("/config?")) return { json: async () => ({ available: true, managedClient: true, providerId: "anam" }) };
    if (method === "POST" && path.endsWith("/end")) {
      state = { ...state, state: "ending", rendererState: "closing", cleanupPending: true };
    }
    return { json: async () => state };
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function view() {
  return render(<TavusChatWindow conversationId="run" persona={{ name: "Actor" } as any}
    scenario={{ title: "Scenario" } as any} onChatComplete={vi.fn()} onExit={vi.fn()} onExitMode={vi.fn()} />);
}
describe("actual external app end and manual reconfirm screen", () => {
  it("keeps the creation fence after end acceptance and checks the same session using GET only", async () => {
    view();
    await screen.findByText("legacy media client");
    fireEvent.click(screen.getByTestId("tavus-exit"));
    await screen.findByText(/서버 정리 중입니다/);
    expect(screen.queryByTestId("tavus-start")).toBeNull();
    await waitFor(() => expect((screen.getByTestId("avatar-cleanup-refresh") as HTMLButtonElement).disabled).toBe(false));
    mocks.api.mockClear();
    state = { ...state, state: "ended", rendererState: "closed", cleanupPending: false };
    fireEvent.click(screen.getByTestId("avatar-cleanup-refresh"));
    await screen.findByText(/해당 세션의 서버 정리가 확인/);
    expect(mocks.api.mock.calls).toEqual([["GET", "/api/tavus/conversations/run/session"]]);
    expect(screen.queryByTestId("tavus-start")).toBeNull();
  });
  it("shows update guidance on a recovered ended session with incomplete status, never starts a client", async () => {
    state = { state: "ended", id: "owned", managedClient: true, providerId: "anam" };
    view();
    await screen.findByTestId("avatar-cleanup-notice");
    fireEvent.click(screen.getByTestId("avatar-cleanup-refresh"));
    await waitFor(() => expect((screen.getByTestId("avatar-cleanup-refresh") as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText(/SDK\/상태 조회 연동 업데이트/)).toBeTruthy();
    expect(screen.queryByText("legacy media client")).toBeNull();
    expect(mocks.api.mock.calls.every(c => c[0] === "GET")).toBe(true);
    expect(screen.queryByTestId("tavus-start")).toBeNull();
  });
});
