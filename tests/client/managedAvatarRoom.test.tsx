// @vitest-environment happy-dom
import React, { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ManagedAvatarRoom from "../../client/src/components/chat/ManagedAvatarRoom";
const api = vi.hoisted(() => vi.fn());
vi.mock("../../client/src/lib/queryClient", () => ({ apiRequest: api }));
let index = 0;
let options: any, start: any, stop: any, interrupt: any, create: any;
beforeEach(() => {
  const append = document.head.appendChild.bind(document.head);
  vi.spyOn(document.head, "appendChild").mockImplementation((node: any) => {
    // Simulate script load/error explicitly; never fetch third-party code in a unit test.
    if (node.tagName === "SCRIPT") node.type = "text/plain";
    return append(node);
  });
  api.mockReset(); index++;
  start = vi.fn(async () => { await options.onAudioOwner("avatarrouter"); options.onState("playing"); });
  stop = vi.fn(async () => {});
  interrupt = vi.fn(async () => {});
  create = vi.fn((input) => { options = input; return { start, stop, interrupt }; });
  window.AvatarRouter = { createClient: create };
  api.mockImplementation(async (_method, path) => ({ json: async () => path.endsWith("/client-connection") ? {
    sessionId: "owned", pipeline: "anam_full", audioOwner: "avatarrouter",
    clientScriptUrl: `https://router-${index}.example/sdk/avatarrouter-client.js`,
    clientScriptPath: "/sdk/avatarrouter-client.js", expiresAt: "2099-01-01T00:00:00Z",
    connection: { opaqueToken: "do-not-store" },
  } : {} }));
});
afterEach(() => { cleanup(); document.querySelectorAll('script[src*="/sdk/avatarrouter-client.js"]').forEach(s => s.remove()); vi.restoreAllMocks(); });
async function loadScript() {
  await waitFor(() => expect(document.querySelector('script[src*="/sdk/avatarrouter-client.js"]')).toBeTruthy());
  fireEvent.load(document.querySelector('script[src*="/sdk/avatarrouter-client.js"]')!);
}
describe("managed native browser handoff", () => {
  it.each(["anam_full", "tavus_full"])("uses one common client for %s captions and owned cleanup reads", async pipeline => {
    const original = api.getMockImplementation()!;
    api.mockImplementation(async (...args) => {
      const response = await original(...args);
      const data = await response.json();
      return { json: async () => args[1].endsWith("/client-connection") ? { ...data, pipeline } :
        { id: "owned", rendererState: "closed", cleanupPending: false } };
    });
    const onCaption = vi.fn();
    const { unmount } = render(<ManagedAvatarRoom endpoint="/owned" statusEndpoint="/owned/session" onCaption={onCaption} />);
    await loadScript();
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    options.onMessages([{ id: "one", role: "user", text: "납기를 확인하고 싶습니다." },
      { id: "two", role: "assistant", text: "금요일입니다." }, { id: "bad", role: "system", text: "private" }]);
    expect(onCaption.mock.calls.map(call => call[0].sender)).toEqual(["user", "ai"]);
    expect(onCaption.mock.calls[0][0]).toMatchObject({
      id: "router:owned:one", message: "납기를 확인하고 싶습니다.", interrupted: false,
    });
    expect(await options.getSessionStatus("owned")).toEqual({ id: "owned", rendererState: "closed", cleanupPending: false });
    await expect(options.getSessionStatus("foreign")).rejects.toThrow("avatar_status_session_mismatch");
    expect(api.mock.calls.filter(call => call[0] === "POST")).toHaveLength(1);
    unmount();
    options.onMessages([{ id: "late", role: "user", text: "late" }]);
    expect(onCaption).toHaveBeenCalledTimes(2);
  });
  it("starts once in StrictMode, keeps opaque credentials out of storage and always sends server end", async () => {
    const { unmount } = render(<StrictMode><ManagedAvatarRoom endpoint="/owned" /></StrictMode>);
    await loadScript();
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(api.mock.calls.filter(c => c[1].endsWith("/client-connection"))).toEqual([["POST", "/owned/client-connection", {}]]);
    expect(screen.getByRole("status").textContent).toContain("영상 재생 중");
    expect(JSON.stringify(localStorage)).not.toContain("do-not-store");
    expect(JSON.stringify(sessionStorage)).not.toContain("do-not-store");
    await expect(options.onAudioOwner("application")).rejects.toThrow("native_audio_owner_required");
    fireEvent.click(screen.getByRole("button", { name: "응답 중단" }));
    expect(interrupt).toHaveBeenCalledTimes(1);
    stop.mockImplementation(() => new Promise(() => {}));
    unmount();
    await waitFor(() => expect(api).toHaveBeenCalledWith("POST", "/owned/end", {}));
  });
  it("ends a reserved session if script loading fails and does not retry the one-time handoff", async () => {
    const onError = vi.fn();
    render(<ManagedAvatarRoom endpoint="/owned" onError={onError} />);
    await waitFor(() => expect(document.querySelector('script[src*="/sdk/avatarrouter-client.js"]')).toBeTruthy());
    fireEvent.error(document.querySelector('script[src*="/sdk/avatarrouter-client.js"]')!);
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(api).toHaveBeenCalledWith("POST", "/owned/end", {});
    expect(api.mock.calls.filter(c => c[1].endsWith("/client-connection"))).toHaveLength(1);
    expect(start).not.toHaveBeenCalled();
  });
});
