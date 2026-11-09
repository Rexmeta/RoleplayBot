// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AnamAvatarTestPanel } from "../../client/src/components/admin/AnamAvatarTestPanel";
const api = vi.hoisted(() => vi.fn());
vi.mock("../../client/src/lib/queryClient", () => ({ apiRequest: api }));
vi.mock("../../client/src/components/chat/ManagedAvatarRoom", () => ({
  default: ({ endpoint }: { endpoint: string }) => <div data-testid="native-room">{endpoint}</div>,
}));
const base = "/api/live-avatar/stock/anam-persona-default/test";
const preflight = {
  ready: true, aiReady: true, creationUncertain: false, missingScopes: [], sessions: [],
  limits: { workerReady: true },
};
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
  api.mockReset().mockImplementation(async (_method, path) => ({ json: async () =>
    path.endsWith("/preflight") ? preflight : {
      id: "native-one", providerId: "anam", avatarId: "anam-persona-default", mode: "live",
      status: "active", rendererState: "running", stopRequested: false, cleanupPending: false,
      expiresAt: "2099-01-01T00:00:00Z",
    },
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("Anam native test consent and lifecycle", () => {
  it("only reads on opening and creates exactly the selected native session after consent", async () => {
    render(<AnamAvatarTestPanel />);
    await waitFor(() => expect(api).toHaveBeenCalledWith("GET", `${base}/preflight`));
    const start = screen.getByRole("button", { name: "Anam 테스트 시작" });
    expect((start as HTMLButtonElement).disabled).toBe(true);
    expect(api.mock.calls.every(c => c[0] === "GET")).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(start);
    expect((await screen.findByTestId("native-room")).textContent).toContain(`${base}/sessions/native-one`);
    expect(api.mock.calls.filter(c => c[0] === "POST")).toEqual([
      ["POST", `${base}/sessions`, { costConfirmed: true, audioConfirmed: true }],
    ]);
    expect(screen.getByText(/시나리오 지침과 평가 기록은 전달되지 않습니다/)).toBeTruthy();
  });
  it("does not create or reconnect automatically when the server reports an uncertain create", async () => {
    api.mockResolvedValue({ json: async () => ({ ...preflight, ready: false, creationUncertain: true }) });
    render(<AnamAvatarTestPanel />);
    await screen.findByText(/생성 결과 확인 중/);
    fireEvent.click(screen.getByRole("checkbox"));
    expect((screen.getByRole("button", { name: "Anam 테스트 시작" }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.mock.calls.every(c => c[0] === "GET")).toBe(true);
  });
  it("recovers an existing session for cleanup without requesting a new media handoff", async () => {
    api.mockResolvedValue({ json: async () => ({ ...preflight, ready: false, sessions: [{
      id: "old", providerId: "anam", avatarId: "anam-persona-default", mode: "live",
      status: "active", rendererState: "running", stopRequested: false, cleanupPending: false,
      expiresAt: "2099-01-01T00:00:00Z",
    }] }) });
    render(<AnamAvatarTestPanel />);
    await screen.findByText(/기존 세션을 복구했습니다/);
    expect(screen.queryByTestId("native-room")).toBeNull();
    expect(api.mock.calls.every(c => c[0] === "GET")).toBe(true);
  });
});
