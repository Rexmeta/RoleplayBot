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
