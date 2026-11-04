// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { apiRequestMock, realtimeHookMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
  realtimeHookMock: vi.fn(),
}));

vi.mock("@/lib/queryClient", () => ({ apiRequest: apiRequestMock }));
vi.mock("@/hooks/useRealtimeVoice", () => ({ useRealtimeVoice: realtimeHookMock }));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
    i18n: { language: "en" },
  }),
}));

import ChatWindow from "@/components/ChatWindow";
import type { ComplexScenario, ScenarioPersona } from "@/lib/scenario-system";

const scenario = {
  id: "tavus-test",
  title: "A difficult conversation",
  description: "",
  personas: [],
} as unknown as ComplexScenario;

const persona = {
  id: "persona-1",
  name: "Mina Park",
  role: "Operations director",
  image: "",
} as unknown as ScenarioPersona;

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});

describe("ChatWindow Tavus mode", () => {
  it("offers a configured pipeline choice before Gemini preconnects and never auto-starts a paid room", async () => {
    apiRequestMock.mockImplementation(async (_method: string, url: string) => ({
      json: async () => url.endsWith("/config") ? { available: true, blockers: [] } : { state: "idle" },
    }));
    render(
      <ChatWindow scenario={scenario} persona={persona} conversationId="new-run"
        onChatComplete={vi.fn()} onExit={vi.fn()} earlyConnect />,
    );
    expect(await screen.findByTestId("conversation-pipeline-choice")).toBeTruthy();
    expect(realtimeHookMock).not.toHaveBeenCalled();
    expect(apiRequestMock.mock.calls.every(call => call[0] === "GET")).toBe(true);
    fireEvent.click(screen.getByText("Tavus Full Pipeline"));
    expect(await screen.findByTestId("tavus-start")).toBeTruthy();
    expect(realtimeHookMock).not.toHaveBeenCalled();
  });
  it("renders Tavus without mounting the Gemini realtime hook", async () => {
    const onReady = vi.fn();
    apiRequestMock.mockResolvedValue({
      json: async () => ({ state: "idle" }),
    });
    render(
      <ChatWindow
        scenario={scenario}
        persona={persona}
        conversationId="conversation-1"
        onChatComplete={vi.fn()}
        onExit={vi.fn()}
        onReady={onReady}
        initialInputMode="tavus"
      />,
    );

    expect(await screen.findByText("Tavus Full Pipeline")).toBeTruthy();
    expect(realtimeHookMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("tavus-start")).toBeTruthy();
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(apiRequestMock).toHaveBeenCalledWith("GET", "/api/tavus/conversations/conversation-1/session", undefined);
  });

  it("restores an active backend Tavus session before mounting standard voice", async () => {
    apiRequestMock.mockResolvedValue({
      json: async () => ({ state: "active", conversationUrl: "https://room.example/restored" }),
    });
    render(
      <ChatWindow
        scenario={scenario}
        persona={persona}
        conversationId="resume-1"
        onChatComplete={vi.fn()}
        onExit={vi.fn()}
        initialInputMode="realtime-voice"
      />,
    );

    expect(await screen.findByTestId("tavus-conversation-frame")).toBeTruthy();
    expect(apiRequestMock).toHaveBeenCalledWith("GET", "/api/tavus/conversations/resume-1/session");
    expect(realtimeHookMock).not.toHaveBeenCalled();
  });

  it("restores completed transcripts with a report action and no new-start control", async () => {
    const onChatComplete = vi.fn();
    apiRequestMock.mockResolvedValue({
      json: async () => ({
        state: "completed",
        messages: [{ sender: "ai", message: "A completed response", timestamp: new Date().toISOString() }],
      }),
    });
    render(
      <ChatWindow
        scenario={scenario}
        persona={persona}
        conversationId="completed-1"
        onChatComplete={onChatComplete}
        onExit={vi.fn()}
        initialInputMode="text"
      />,
    );

    expect(await screen.findByTestId("tavus-review-report")).toBeTruthy();
    expect(screen.getByText("A completed response")).toBeTruthy();
    expect(screen.queryByTestId("tavus-start")).toBeNull();
    expect(onChatComplete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("tavus-review-report"));
    expect(onChatComplete).toHaveBeenCalledTimes(1);
    expect(realtimeHookMock).not.toHaveBeenCalled();
  });

  it("requires consent, starts once, embeds the room, and ends before completion", async () => {
    const onChatComplete = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (method === "GET") return { json: async () => ({ state: "idle" }) };
      if (url.endsWith("/start")) {
        return { json: async () => ({ state: "active", conversationUrl: "https://room.example/join?token=short-lived" }) };
      }
      if (url.endsWith("/end")) return { json: async () => ({ state: "completed", messages: [] }) };
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    render(
      <ChatWindow
        scenario={scenario}
        persona={persona}
        conversationId="conversation-1"
        onChatComplete={onChatComplete}
        onExit={vi.fn()}
        initialInputMode="tavus"
      />,
    );

    const start = await screen.findByTestId("tavus-start");
    expect((start as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("tavus-consent"));
    fireEvent.click(start);

    const frame = await screen.findByTestId("tavus-conversation-frame");
    expect(frame.getAttribute("src")).toContain("short-lived");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.getAttribute("allow")).toContain("microphone");
    expect(apiRequestMock).toHaveBeenCalledWith("POST", expect.stringMatching(/\/start$/), { consent: true });

    fireEvent.click(await screen.findByTestId("tavus-end"));
    await waitFor(() => expect(onChatComplete).toHaveBeenCalledTimes(1));
    expect(apiRequestMock).toHaveBeenCalledWith("POST", expect.stringMatching(/\/end$/), {});
    expect(realtimeHookMock).not.toHaveBeenCalled();
  });

  it("single-flights ending-session sync and calls completion once after pending becomes complete", async () => {
    const onChatComplete = vi.fn();
    let syncCalls = 0;
    const originalSetTimeout = window.setTimeout.bind(window);
    vi.spyOn(window, "setTimeout").mockImplementation(((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (delay === 3000) {
        queueMicrotask(() => {
          if (typeof callback === "function") callback(...args);
        });
        return 0;
      }
      return originalSetTimeout(callback, delay, ...args);
    }) as typeof window.setTimeout);
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (method === "GET") return { json: async () => ({ state: "active", conversationUrl: "https://room.example/live" }) };
      if (url.endsWith("/end")) return { json: async () => ({ state: "transcript_pending" }) };
      if (url.endsWith("/sync")) {
        syncCalls += 1;
        return { json: async () => syncCalls === 1
          ? ({ state: "transcript_pending" })
          : ({ state: "completed", messages: [{ sender: "ai", message: "Complete", timestamp: new Date().toISOString() }] }) };
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    render(
      <ChatWindow
        scenario={scenario}
        persona={persona}
        conversationId="sync-1"
        onChatComplete={onChatComplete}
        onExit={vi.fn()}
        initialInputMode="tavus"
      />,
    );

    fireEvent.click(await screen.findByTestId("tavus-end"));
    await waitFor(() => expect(screen.getByText("Conversation complete")).toBeTruthy());
    expect(syncCalls).toBe(2);
    expect(onChatComplete).toHaveBeenCalledTimes(1);
  });

  it("does not retry an uncertain room creation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (method === "GET") return { json: async () => ({ state: "idle" }) };
      if (url.endsWith("/start")) throw new Error("503: provider outcome unknown");
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    render(
      <ChatWindow
        scenario={scenario}
        persona={persona}
        conversationId="unknown-1"
        onChatComplete={vi.fn()}
        onExit={vi.fn()}
        initialInputMode="tavus"
      />,
    );
    fireEvent.click(await screen.findByTestId("tavus-consent"));
    fireEvent.click(screen.getByTestId("tavus-start"));
    expect(await screen.findByTestId("tavus-error")).toBeTruthy();
    expect(apiRequestMock.mock.calls.filter(([, url]) => String(url).endsWith("/start"))).toHaveLength(1);
    expect(screen.queryByTestId("tavus-start")).toBeNull();
  });

  it("sends a second keepalive end if the pending start resolves after unmount", async () => {
    let resolveStart!: (value: { json: () => Promise<{ state: string; conversationUrl: string }> }) => void;
    const pendingStart = new Promise<{ json: () => Promise<{ state: string; conversationUrl: string }> }>((resolve) => {
      resolveStart = resolve;
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", fetchMock);
    apiRequestMock.mockImplementation((method: string, url: string) => {
      if (method === "GET") return Promise.resolve({ json: async () => ({ state: "idle" }) });
      if (url.endsWith("/start")) return pendingStart;
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const view = render(
      <ChatWindow
        scenario={scenario}
        persona={persona}
        conversationId="unmount-1"
        onChatComplete={vi.fn()}
        onExit={vi.fn()}
        initialInputMode="tavus"
      />,
    );
    fireEvent.click(await screen.findByTestId("tavus-consent"));
    fireEvent.click(screen.getByTestId("tavus-start"));
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith("POST", expect.stringMatching(/\/start$/), { consent: true }));
    view.unmount();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveStart({ json: async () => ({ state: "active", conversationUrl: "https://room.example/late" }) });
      await pendingStart;
      await Promise.resolve();
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls.every(([url]) => String(url).endsWith("/unmount-1/session/end"))).toBe(true);
  });
});
