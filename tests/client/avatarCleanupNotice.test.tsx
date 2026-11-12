// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AvatarCleanupNotice } from "../../client/src/components/chat/AvatarCleanupNotice";
import { useAvatarCleanup } from "../../client/src/components/chat/useAvatarCleanup";
const api = vi.hoisted(() => vi.fn());
vi.mock("../../client/src/lib/queryClient", () => ({ apiRequest: api }));
function Harness({ scope = "user:run", id = "owned" }) {
  const state = useAvatarCleanup(scope, "/api/tavus/conversations/run/session", id);
  return <><AvatarCleanupNotice result={state.result} checking={state.checking}
    onRefresh={() => void state.refresh()} />
    <button onClick={state.invalidate}>end</button></>;
}
beforeEach(() => { api.mockReset(); });
afterEach(cleanup);
describe("ended-screen authenticated cleanup reads", () => {
  it("shows the legacy update guidance and sends only GET, never media or creation requests", async () => {
    api.mockResolvedValue({ json: async () => ({ id: "owned", rendererState: "closed", cleanupPending: false }) });
    render(<Harness />);
    expect(screen.getByText(/SDK\/상태 조회 연동 업데이트/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("avatar-cleanup-refresh"));
    await screen.findByText(/해당 세션의 서버 정리가 확인/);
    expect(api.mock.calls).toEqual([["GET", "/api/tavus/conversations/run/session"]]);
    expect(screen.queryByText(/SDK\/상태 조회 연동 업데이트/)).toBeNull();
  });
  it("keeps unknown on authorization failure without leaking the response", async () => {
    api.mockRejectedValue(new Error("403: provider private detail"));
    render(<Harness />);
    fireEvent.click(screen.getByTestId("avatar-cleanup-refresh"));
    await waitFor(() => expect((screen.getByTestId("avatar-cleanup-refresh") as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByRole("status").textContent).toContain("생성 잠금을 유지");
    expect(screen.queryByText(/provider private detail/)).toBeNull();
  });
  it("keeps pending locked and disables concurrent manual reads", async () => {
    let resolve!: (value: unknown) => void;
    api.mockImplementation(() => new Promise(r => { resolve = r; }));
    render(<Harness />);
    fireEvent.click(screen.getByTestId("avatar-cleanup-refresh"));
    fireEvent.click(screen.getByTestId("avatar-cleanup-refresh"));
    await waitFor(() => expect(api).toHaveBeenCalledOnce());
    expect((screen.getByTestId("avatar-cleanup-refresh") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => resolve({ json: async () => ({ id: "owned", rendererState: "closed", cleanupPending: true }) }));
    expect(screen.getByRole("status").textContent).toContain("서버 정리 중");
  });
  it.each(["account", "session", "end"])("discards a delayed read after %s changes", async change => {
    let resolve!: (value: unknown) => void;
    api.mockImplementation(() => new Promise(r => { resolve = r; }));
    const view = render(<Harness />);
    fireEvent.click(screen.getByTestId("avatar-cleanup-refresh"));
    await waitFor(() => expect(api).toHaveBeenCalledOnce());
    if (change === "account") view.rerender(<Harness scope="other:run" />);
    else if (change === "session") view.rerender(<Harness id="other" />);
    else fireEvent.click(screen.getByText("end"));
    await act(async () => resolve({ json: async () => ({ id: "owned", rendererState: "closed", cleanupPending: false }) }));
    expect(screen.queryByText(/해당 세션의 서버 정리가 확인/)).toBeNull();
  });
});
