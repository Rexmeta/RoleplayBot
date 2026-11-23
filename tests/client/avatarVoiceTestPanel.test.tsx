// @vitest-environment happy-dom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AvatarVoiceTestPanel } from "../../client/src/components/admin/avatarTest/AvatarVoiceTestPanel";

const api = vi.hoisted(() => vi.fn());
vi.mock("../../client/src/lib/queryClient", () => ({ apiRequest: api }));
vi.mock("../../client/src/components/chat/ManagedAvatarRoom", () => ({
  default: ({ endpoint }: { endpoint: string }) => <div data-testid="native-room">{endpoint}</div>,
}));
vi.mock("../../client/src/components/chat/AvatarSessionTiming", () => ({ AvatarSessionTiming: () => null }));
const target = "tavus-stock-lucy";
const base = `/api/live-avatar/voice-test/${target}`;
const voice = (id: string, name: string, gender = "female") =>
  ({ id, name, gender, providerId: "tavus", description: "", genderSource: "provider", languages: [], available: true });
const reply = (body: unknown) => ({ json: async () => body });
const session = (id: string, voice: unknown) => ({
  id, providerId: "tavus", avatarId: target, pipeline: "tavus_full", mode: "live", status: "active", rendererState: "running",
  stopRequested: false, cleanupPending: false, expiresAt: "2099-01-01T00:00:00Z", requestedVoice: voice,
});
let current: ReturnType<typeof session> | null;
let count = 0;
beforeEach(() => {
  current = null;
  count = 0;
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
  api.mockReset().mockImplementation(async (method, url, data) => {
    if (url.endsWith("/voices?offset=0")) return reply({ status: "available", voices: [voice("v1", "First voice")], nextOffset: 100 });
    if (url.endsWith("/voices?offset=100")) return reply({ status: "available", voices: [voice("v2", "Second voice", "unclassified")], nextOffset: null });
    if (url.endsWith("/end")) { current = { ...current!, status: "ended", rendererState: "closed" }; return reply(current); }
    if (method === "POST" && url === `${base}/sessions`) {
      current = session(`test-${++count}`, data.voice ?? null);
    }
    return reply(current);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const picker = () => screen.getByLabelText<HTMLSelectElement>("테스트 음성 모델");
const start = () => screen.getByRole<HTMLButtonElement>("button", { name: "선택 음성으로 테스트" });
const posts = () => api.mock.calls.filter(([method]) => method === "POST");

describe("voice model selection in avatar diagnostics", () => {
  it("loads real options on demand, starts only on click, and changes voice for the next test", async () => {
    render(<AvatarVoiceTestPanel target={target} initialVoice={{ voiceId: "v1", gender: "female" }} />);
    await screen.findByRole("option", { name: "First voice · 여성" });
    expect(picker().value).toBe("v1");
    expect(posts()).toHaveLength(0);
    await waitFor(() => expect(start().disabled).toBe(false));
    fireEvent.click(start());
    await screen.findByTestId("native-room");
    expect(posts()[0]).toEqual(["POST", `${base}/sessions`, { voice: { voiceId: "v1", gender: "female" } }]);
    expect(picker().disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "테스트 종료" }));
    await waitFor(() => expect(start().disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "음성 더 보기" }));
    await screen.findByRole("option", { name: "Second voice · 미분류" });
    fireEvent.change(picker(), { target: { value: "v2" } });
    fireEvent.click(start());
    await waitFor(() => expect(screen.getByTestId("native-room").textContent).toContain("test-2"));
    expect(posts()).toEqual([
      ["POST", `${base}/sessions`, { voice: { voiceId: "v1", gender: "female" } }],
      ["POST", `${base}/sessions/test-1/end`, {}],
      ["POST", `${base}/sessions`, { voice: { voiceId: "v2" } }],
    ]);
  });

  it("shows the prior request after reopening without getting a new one-time connection", async () => {
    current = session("old", { voiceId: "v1", gender: "female" });
    render(<AvatarVoiceTestPanel target={target} />);
    await screen.findByText(/기존 테스트가 남아 있습니다/);
    await screen.findByText(/요청한 음성: First voice/);
    expect(screen.queryByTestId("native-room")).toBeNull();
    expect(posts()).toHaveLength(0);
  });

  it("does not replace the persona's selected voice with the default when catalog support is missing", async () => {
    api.mockImplementation(async (_method, path) => reply(path.includes("/voices")
      ? { status: "unsupported", voices: [], nextOffset: null } : null));
    render(<AvatarVoiceTestPanel target={target} initialVoice={{ voiceId: "v1" }} initialVoiceName="Saved voice" />);
    await screen.findByText(/현재 라우터에서 음성 선택을 지원하지 않습니다/);
    expect(picker().value).toBe("v1");
    expect(start().disabled).toBe(true);
    expect(posts()).toHaveLength(0);
  });
});
