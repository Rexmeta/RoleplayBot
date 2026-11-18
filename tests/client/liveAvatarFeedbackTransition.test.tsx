// @vitest-environment happy-dom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queryClient", () => ({ apiRequest: api }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: any) => options?.defaultValue ?? key, i18n: { language: "ko" },
  }),
}));
vi.mock("@/components/chat/TavusConversationLayout", () => ({
  default: (p: any) => <div data-testid="live-avatar-layout">{p.stage}{p.sessionControls}</div>,
}));
vi.mock("@/components/chat/ManagedAvatarRoom", () => ({ default: () => <div>활성 아바타 영상</div> }));
vi.mock("@/components/chat/DailyAvatarRoom", () => ({ default: () => <div>활성 아바타 영상</div> }));
import TavusChatWindow from "@/components/chat/TavusChatWindow";
let session: any;
let failEnd: boolean;
let failSync: boolean;
const complete = vi.fn();
const exit = vi.fn();
const view = () => <TavusChatWindow conversationId="run" persona={{ id: "actor", name: "Actor" } as any}
  scenario={{ title: "Scenario" } as any} onChatComplete={complete} onExit={exit} onExitMode={vi.fn()} />;
const flush = async () => { await act(async () => {}); };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-18T00:00:00Z"));
  vi.clearAllMocks(); failEnd = false; failSync = false;
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
  session = { state: "active", id: "owned", providerId: "anam", managedClient: true,
    evaluationAvailable: true, transcriptState: "pending", createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 1000).toISOString() };
  api.mockImplementation(async (method: string, path: string) => {
    if (path.includes("/config?")) return { json: async () => ({
      available: true, managedClient: true, providerId: "anam", evaluationAvailable: true,
    }) };
    if (path.endsWith("/messages")) return { json: async () => [] };
    if (path.endsWith("/end")) {
      if (failEnd) throw new Error("503: end failed");
      session = { ...session, state: "ending" };
    }
    if (path.endsWith("/sync") && failSync) throw new Error("503: sync failed");
    return { json: async () => session };
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("moves straight from the time limit into feedback preparation while keeping transcript sync alive", async () => {
  const rendered = render(view());
  await flush();
  expect(screen.getByText("활성 아바타 영상")).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.getByTestId("feedback-transition-overlay")).toBeTruthy();
  expect(screen.queryByTestId("live-avatar-layout")).toBeNull();
  expect(screen.queryByText("대화할 준비가 되었습니다")).toBeNull();
  expect(complete).not.toHaveBeenCalled();
  session = { ...session, state: "ended", transcriptState: "pending" };
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(api).toHaveBeenCalledWith("POST", "/api/tavus/conversations/run/sync", {});
  expect(screen.getByTestId("feedback-transition-overlay")).toBeTruthy();
  expect(complete).not.toHaveBeenCalled();
  session = { ...session, transcriptState: "completed" };
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(complete).toHaveBeenCalledTimes(1);
  expect(exit).not.toHaveBeenCalled();
  rendered.rerender(view()); await flush();
  expect(complete).toHaveBeenCalledTimes(1);
});

it("shows the same preparation screen after a manual finish", async () => {
  render(view()); await flush();
  fireEvent.click(screen.getByTestId("tavus-end")); await flush();
  expect(screen.getByTestId("feedback-transition-overlay")).toBeTruthy();
  expect(screen.queryByTestId("live-avatar-layout")).toBeNull();
  expect(api.mock.calls.filter(call => call[1].endsWith("/end"))).toHaveLength(1);
});

it.each(["empty", "unavailable", "failed"])("preserves recovery instead of an endless spinner for %s history", async state => {
  session = { ...session, state: "ended", transcriptState: state };
  render(view()); await flush();
  expect(screen.queryByTestId("feedback-transition-overlay")).toBeNull();
  expect(screen.getByTestId("live-avatar-layout")).toBeTruthy();
  expect(complete).not.toHaveBeenCalled();
});

it("reveals retry controls if ending fails", async () => {
  failEnd = true;
  render(view()); await flush();
  fireEvent.click(screen.getByTestId("tavus-end")); await flush();
  expect(screen.queryByTestId("feedback-transition-overlay")).toBeNull();
  expect(screen.getByTestId("tavus-end-retry")).toBeTruthy();
});

it("reveals transcript recovery if confirmed history cannot be synchronized", async () => {
  failSync = true;
  session = { ...session, state: "ended" };
  render(view()); await flush();
  expect(screen.queryByTestId("feedback-transition-overlay")).toBeNull();
  expect(screen.getByTestId("live-avatar-layout")).toBeTruthy();
  expect(complete).not.toHaveBeenCalled();
});

it("does not introduce a report transition for sessions without evaluation support", async () => {
  session = { ...session, state: "ended", evaluationAvailable: false, transcriptState: "unavailable" };
  render(view()); await flush();
  expect(screen.queryByTestId("feedback-transition-overlay")).toBeNull();
  expect(screen.getByTestId("tavus-evaluation-unavailable")).toBeTruthy();
  expect(complete).not.toHaveBeenCalled();
});
