// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { apiRequestMock, roomMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
  roomMock: vi.fn((props: { onCaption?: (caption: { id: string; sender: "user" | "ai"; message: string; timestamp: string; interrupted: boolean }) => void }) => (
    <div data-testid="mock-daily-room" data-caption-connected={String(typeof props.onCaption === "function")} />
  )),
}));

vi.mock("@/lib/queryClient", () => ({ apiRequest: apiRequestMock }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "test-user" } }) }));
vi.mock("../DailyAvatarRoom", () => ({ default: roomMock }));
vi.mock("../ManagedAvatarRoom", () => ({ default: (props: any) => (
  <div data-testid="mock-managed-room">
    <button data-testid="emit-router-caption" onClick={() => props.onCaption?.({
      id: "router-caption", sender: "user", message: "Unified provisional caption",
      timestamp: "2026-11-09T10:00:00Z", interrupted: false,
    })}>Caption</button>
  </div>
) }));
vi.mock("../RecognitionReview", () => ({
  RecognitionReview: () => null,
  useRecognitionEvidence: () => ({ data: undefined }),
}));
vi.mock("../tavusBrowserCaptions", async () => {
  const React = await import("react");
  return {
    useBrowserCaptions: (conversationId: string) => {
      const [captions, setCaptions] = React.useState<Array<{ id: string; sender: "user" | "ai"; message: string; timestamp: string; interrupted: boolean }>>([]);
      React.useEffect(() => { setCaptions([]); }, [conversationId]);
      const onCaption = React.useCallback((caption: { id: string; sender: "user" | "ai"; message: string; timestamp: string; interrupted: boolean }) => {
        setCaptions(previous => {
          const existingIndex = previous.findIndex(item => item.id === caption.id);
          if (existingIndex >= 0) {
            const updated = [...previous];
            updated[existingIndex] = caption;
            return updated;
          }
          return [...previous, caption].slice(-500);
        });
      }, [conversationId]);
      return { captions, onCaption };
    },
  };
});
vi.mock("react-i18next", async importOriginal => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
    i18n: { language: "en" },
  }),
}));

import TavusChatWindow from "../TavusChatWindow";
import type { ComplexScenario, ScenarioPersona } from "@/lib/scenario-system";

const scenario = { id: "scenario", title: "A hard conversation", description: "", personas: [] } as unknown as ComplexScenario;
const persona = { id: "persona", name: "Mina Park", role: "Operations director", image: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" } as unknown as ScenarioPersona;
const active = { state: "active" };
const connection = { transport: "daily", pipeline: "tavus_full", url: "https://daily.example/room", token: "ephemeral-secret" };
const response = (body: unknown) => ({ json: async () => body });
async function pressMicrophone() {
  const microphone = await screen.findByTestId("button-live-avatar-microphone") as HTMLButtonElement;
  await waitFor(() => expect(microphone.disabled).toBe(false));
  fireEvent.click(microphone);
}

beforeEach(() => {
  apiRequestMock.mockReset();
  roomMock.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
  apiRequestMock.mockImplementation(async (_method: string, url: string) => {
    if (url.startsWith("/api/tavus/config?")) return response({ available: true, blockers: [] });
    if (url.endsWith("/connection")) return response(connection);
    return response({ state: "idle" });
  });
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("TavusChatWindow Daily pipeline", () => {
  it("uses the voice-style early-exit header and leaves mode switching to the bottom menu", async () => {
    const exit = vi.fn();
    const exitMode = vi.fn();
    render(<TavusChatWindow scenario={scenario} persona={persona} conversationId="header-menu"
      onChatComplete={vi.fn()} onExit={exit} onExitMode={exitMode} />);
    await waitFor(() => expect((screen.getByTestId("button-live-avatar-microphone") as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByTestId("tavus-exit").textContent).toBe("End early");
    expect(screen.queryByText("Back to chat modes")).toBeNull();
    fireEvent.click(screen.getByTestId("tavus-exit"));
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exitMode).not.toHaveBeenCalled();
    expect(apiRequestMock.mock.calls.some(([method]) => method === "POST")).toBe(false);
  });
  it("omits introductory notices while keeping the router's current limit in settings", async () => {
    apiRequestMock.mockImplementation(async (_method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({
        available: true, runtime: { sessionSeconds: 600, userRemainingSeconds: 3000, globalRemainingSeconds: 6600, resetsAt: "tomorrow" },
      });
      return response({ state: "idle" });
    });
    render(<TavusChatWindow scenario={scenario} persona={persona} conversationId="duration"
      onChatComplete={vi.fn()} onExit={vi.fn()} onExitMode={vi.fn()} />);
    await waitFor(() => expect((screen.getByTestId("button-live-avatar-microphone") as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByTestId("tavus-duration-notice")).toBeNull();
    expect(screen.queryByText(/including connection time/)).toBeNull();
    expect(screen.queryByText(/Uses this session's persona and scenario instructions/)).toBeNull();
    expect(screen.queryByText(/Press the microphone to start a usage-billed connection/)).toBeNull();
    expect(screen.getByTestId("tavus-runtime-limits").textContent).toContain("600s");
    expect(screen.queryByText(/120 seconds/)).toBeNull();
    expect(apiRequestMock.mock.calls.some(([method]) => method === "POST")).toBe(false);
  });
  it("never creates a new session merely because the recovery screen was mounted", async () => {
    render(<TavusChatWindow scenario={scenario} persona={persona} conversationId="recovery-only"
      onChatComplete={vi.fn()} onExit={vi.fn()} onExitMode={vi.fn()} />);
    await waitFor(() => expect((screen.getByTestId("button-live-avatar-microphone") as HTMLButtonElement).disabled).toBe(false));
    expect(apiRequestMock.mock.calls.some(([method]) => method === "POST")).toBe(false);
    expect(screen.queryByTestId("tavus-consent")).toBeNull();
    expect(screen.queryByTestId("tavus-start")).toBeNull();
  });

  it("does not auto-create when the existing session cannot be checked", async () => {
    apiRequestMock.mockImplementation(async (_method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({ available: true });
      throw new Error("503: session status unavailable");
    });
    render(<TavusChatWindow autoStart scenario={scenario} persona={persona} conversationId="status-failed"
      onChatComplete={vi.fn()} onExit={vi.fn()} onExitMode={vi.fn()} />);
    await screen.findByTestId("tavus-error");
    expect(apiRequestMock.mock.calls.some(([method]) => method === "POST")).toBe(false);
  });

  it.each(["tavus", "anam"])("automatically follows %s natural end and delayed history into feedback without any further click", async providerId => {
    vi.useFakeTimers();
    const onChatComplete = vi.fn();
    let current: Record<string, unknown> = { state: "idle" };
    const contract = { providerId, managedClient: true, evaluationAvailable: true };
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({ available: true, ...contract });
      if (url.endsWith("/start")) current = { state: "active", ...contract };
      if (url === "/api/conversations/natural-end") return response({ messages: [] });
      return response(current);
    });
    let view: ReturnType<typeof render> | undefined;
    try {
      await act(async () => {
        view = render(<TavusChatWindow autoStart scenario={scenario} persona={persona} conversationId="natural-end"
          onChatComplete={onChatComplete} onExit={vi.fn()} onExitMode={vi.fn()} />);
      });
      await act(async () => { fireEvent.click(screen.getByTestId("button-live-avatar-microphone")); });
      expect(screen.getByTestId("mock-managed-room")).toBeTruthy();
      current = { state: "ended", ...contract, transcriptState: "pending" };
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(screen.getByText("Preparing your feedback report")).toBeTruthy();
      expect(onChatComplete).not.toHaveBeenCalled();
      expect(apiRequestMock.mock.calls.filter(([method, url]) => method === "POST" && url.endsWith("/sync"))).toHaveLength(1);
      current = { state: "ended", ...contract, transcriptState: "completed" };
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(onChatComplete).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
      expect(onChatComplete).toHaveBeenCalledTimes(1);
      expect(apiRequestMock.mock.calls.filter(([method, url]) => method === "POST" && url.endsWith("/start"))).toHaveLength(1);
      expect(apiRequestMock.mock.calls.some(([method, url]) => method === "POST" && url.endsWith("/end"))).toBe(false);
    } finally {
      view?.unmount();
      vi.useRealTimers();
    }
  });

  it.each([false, undefined])("does not recover a legacy Anam call with session availability %s after capabilities change", async evaluationAvailable => {
    const onChatComplete = vi.fn();
    apiRequestMock.mockImplementation(async (_method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({
        available: true, providerId: "anam", managedClient: true, evaluationAvailable: true,
      });
      return response({
        state: "ended", providerId: "anam", managedClient: true,
        evaluationAvailable, transcriptState: "unavailable",
      });
    });
    render(<TavusChatWindow scenario={scenario} persona={persona} conversationId="legacy-anam"
      onChatComplete={onChatComplete} onExit={vi.fn()} onExitMode={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("tavus-session-status").textContent).toContain("Session closed"));
    expect(apiRequestMock.mock.calls.some(([method, url]) => method === "POST" && url.endsWith("/sync"))).toBe(false);
    expect(onChatComplete).not.toHaveBeenCalled();
  });
  it.each([undefined, false])("recovers a persisted legacy Daily call with managedClient=%s despite new config defaults", async managedClient => {
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({
        available: true, providerId: "tavus", managedClient: true,
      });
      if (method === "GET" && url.endsWith("/session")) return response({
        state: "active", providerId: "tavus", ...(managedClient !== undefined ? { managedClient } : {}),
      });
      if (url.endsWith("/connection")) return response(connection);
      return response({ state: "active" });
    });
    render(<TavusChatWindow scenario={scenario} persona={persona} conversationId="legacy-resume"
      onChatComplete={vi.fn()} onExit={vi.fn()} onExitMode={vi.fn()} />);
    expect(await screen.findByTestId("mock-daily-room")).toBeTruthy();
    expect(screen.queryByTestId("mock-managed-room")).toBeNull();
    expect(apiRequestMock).toHaveBeenCalledWith("GET", "/api/tavus/conversations/legacy-resume/connection");
    expect(apiRequestMock.mock.calls.some(call => call[1].endsWith("/client-connection"))).toBe(false);
    expect(apiRequestMock.mock.calls.some(call => call[0] === "POST")).toBe(false);
  });
  it("starts only on the microphone click, fences double clicks, and ends on the same microphone", async () => {
    apiRequestMock.mockImplementation(async (_method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({ available: true, providerId: "anam", blockers: [] });
      if (url.endsWith("/start")) return response({ state: "active", providerId: "anam" });
      if (url.endsWith("/end")) return response({ state: "ended", providerId: "anam" });
      return response({ state: "idle" });
    });
    const view = render(<React.StrictMode><TavusChatWindow autoStart scenario={scenario} persona={persona} conversationId="direct-live" onChatComplete={vi.fn()} onExit={vi.fn()} onExitMode={vi.fn()} /></React.StrictMode>);
    await waitFor(() => expect((screen.getByTestId("button-live-avatar-microphone") as HTMLButtonElement).disabled).toBe(false));
    expect(apiRequestMock.mock.calls.some(([method]) => method === "POST")).toBe(false);
    act(() => {
      fireEvent.click(screen.getByTestId("button-live-avatar-microphone"));
      fireEvent.click(screen.getByTestId("button-live-avatar-microphone"));
    });
    await screen.findByTestId("mock-managed-room");
    expect((screen.getByTestId("live-avatar-options-dialog") as HTMLDialogElement).open).toBe(false);
    expect(screen.queryByTestId("tavus-consent")).toBeNull();
    expect(screen.queryByTestId("tavus-start")).toBeNull();
    expect(view.container.textContent).not.toMatch(/\b(Anam|Tavus)\b/i);
    expect(apiRequestMock.mock.calls.filter(([method, url]) => method === "POST" && url.endsWith("/start"))).toHaveLength(1);
    expect(apiRequestMock).toHaveBeenCalledWith("POST", "/api/tavus/conversations/direct-live/start", { consent: true });
    expect(screen.getByTestId("button-live-avatar-microphone").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("button-live-avatar-microphone"));
    await waitFor(() => expect(apiRequestMock.mock.calls.filter(([method, url]) => method === "POST" && url.endsWith("/end"))).toHaveLength(1));
    await waitFor(() => expect((screen.getByTestId("button-live-avatar-microphone") as HTMLButtonElement).disabled).toBe(true));
  });

  it("keeps the phone screen awake during a live session and releases it on end", async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const request = vi.fn().mockResolvedValue({
      released: false,
      release,
      addEventListener: vi.fn(),
    });
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request },
    });
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({ available: true, blockers: [] });
      if (url.endsWith("/connection")) return response(connection);
      if (url.endsWith("/start")) return response(active);
      if (url.endsWith("/end")) return response({ state: "ended", evaluationAvailable: false });
      return response({ state: "idle" });
    });
    render(<TavusChatWindow autoStart scenario={scenario} persona={persona} conversationId="wake-lock-1" onChatComplete={vi.fn()} onExit={vi.fn()} onExitMode={vi.fn()} />);
    await pressMicrophone();
    await waitFor(() => expect(request).toHaveBeenCalledWith("screen"));
    expect(await screen.findByTestId("mock-daily-room")).toBeTruthy();
    fireEvent.click(await screen.findByTestId("tavus-end"));
    await waitFor(() => expect(release).toHaveBeenCalledTimes(1));
  });
  it.each(["tavus", "anam"])("uses common %s captions and automatically opens feedback only after final import", async providerId => {
    const onChatComplete = vi.fn();
    const completed = { state: "ended", providerId, managedClient: true,
      evaluationAvailable: true, transcriptState: "completed" };
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({
        available: true, providerId, managedClient: true, evaluationAvailable: true,
      });
      if (url.endsWith("/start")) return response({ state: "active", providerId, managedClient: true, evaluationAvailable: true });
      if (url.endsWith("/end")) return response({ state: "ended", providerId, managedClient: true, evaluationAvailable: true, transcriptState: "pending" });
      if (url.endsWith("/sync")) return response(completed);
      if (url === "/api/conversations/common-run") return response({ messages: [
        { sender: "user", message: "Unified confirmed history", timestamp: "2026-11-09T10:00:00Z" },
      ] });
      return response({ state: "idle" });
    });
    render(<TavusChatWindow autoStart scenario={scenario} persona={persona} conversationId="common-run"
      onChatComplete={onChatComplete} onExit={vi.fn()} onExitMode={vi.fn()} />);
    await pressMicrophone();
    await screen.findByTestId("mock-managed-room");
    fireEvent.click(screen.getByTestId("emit-router-caption"));
    expect(await screen.findByText("Unified provisional caption")).toBeTruthy();
    expect(onChatComplete).not.toHaveBeenCalled();
    expect(apiRequestMock.mock.calls.some(call => call[1].endsWith("/connection"))).toBe(false);
    fireEvent.click(screen.getByTestId("tavus-end"));
    expect(await screen.findByText("Unified confirmed history")).toBeTruthy();
    await waitFor(() => expect(onChatComplete).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Unified provisional caption")).toBeNull();
  });
  it("starts on entry, retrieves Daily credentials separately, and does not invent unsupported feedback", async () => {
    const onChatComplete = vi.fn();
    const onExit = vi.fn();
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({ available: true, blockers: [] });
      if (url.endsWith("/connection")) return response(connection);
      if (url.endsWith("/start")) return response(active);
      if (url.endsWith("/end")) return response({ state: "ended", evaluationAvailable: false });
      return response({ state: "idle" });
    });
    render(<TavusChatWindow autoStart scenario={scenario} persona={persona} conversationId="run-1" onChatComplete={onChatComplete} onExit={onExit} onExitMode={vi.fn()} />);
    await pressMicrophone();
    expect(await screen.findByTestId("mock-daily-room")).toBeTruthy();
    expect(screen.queryByText(/Live captions are not shown/)).toBeNull();
    fireEvent.click(screen.getByTestId("button-toggle-transcript"));
    expect(screen.getByTestId("button-toggle-transcript")).toBeTruthy();
    expect(await screen.findByTestId("mock-daily-room")).toBeTruthy();
    expect(apiRequestMock.mock.calls.filter(([method, url]) => method === "POST" && String(url).endsWith("/start"))).toHaveLength(1);
    expect(apiRequestMock).toHaveBeenCalledWith("GET", "/api/tavus/conversations/run-1/session", undefined);
    expect(apiRequestMock).toHaveBeenCalledWith("POST", "/api/tavus/conversations/run-1/start", { consent: true });
    expect(apiRequestMock).toHaveBeenCalledWith("GET", "/api/tavus/conversations/run-1/connection");
    expect(apiRequestMock.mock.calls.some(([, , body]) => (JSON.stringify(body) || "").includes("ephemeral-secret"))).toBe(false);

    fireEvent.click(await screen.findByTestId("tavus-end"));
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith("POST", "/api/tavus/conversations/run-1/end", {}));
    expect(await screen.findByTestId("tavus-evaluation-unavailable")).toBeTruthy();
    expect(onChatComplete).not.toHaveBeenCalled();
    expect(screen.queryByTestId("mock-daily-room")).toBeNull();
    fireEvent.click(screen.getByTestId("tavus-close"));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("does not issue paid start requests when the config is blocked", async () => {
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({ available: false, blockers: ["Provider is not configured"] });
      return response({ state: "idle" });
    });
    render(<TavusChatWindow autoStart scenario={scenario} persona={persona} conversationId="blocked-1" onChatComplete={vi.fn()} onExit={vi.fn()} onExitMode={vi.fn()} />);
    expect(await screen.findByTestId("tavus-blockers")).toBeTruthy();
    expect(screen.queryByTestId("tavus-start")).toBeNull();
    expect(apiRequestMock.mock.calls.some(([method, url]) => method === "POST" && String(url).endsWith("/start"))).toBe(false);
  });

  it("never automatically retries an uncertain start and offers status/end recovery", async () => {
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({ available: true });
      if (method === "POST" && url.endsWith("/start")) throw new Error("503: provider status unknown");
      if (method === "GET") return response({ state: "idle" });
      if (url.endsWith("/end")) return response({ state: "ended" });
      return response({ state: "idle" });
    });
    render(<TavusChatWindow autoStart scenario={scenario} persona={persona} conversationId="unknown-1" onChatComplete={vi.fn()} onExit={vi.fn()} onExitMode={vi.fn()} />);
    await pressMicrophone();
    expect(await screen.findByTestId("tavus-error")).toBeTruthy();
    await waitFor(() => expect(apiRequestMock.mock.calls.filter(([method, url]) => method === "POST" && String(url).endsWith("/start"))).toHaveLength(1));
    expect(screen.queryByTestId("tavus-start")).toBeNull();
    fireEvent.click(screen.getByTestId("tavus-end-retry"));
    expect(await screen.findByTestId("tavus-evaluation-unavailable")).toBeTruthy();
  });
  it("shows actionable admission reasons and refreshes availability without creating a session", async () => {
    let blocked = true;
    apiRequestMock.mockImplementation(async (_method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({
        available: !blocked, blockers: blocked ? ["avatar_runtime_worker_unavailable"] : [],
        runtime: { userRemainingSeconds: 80, globalRemainingSeconds: 900, sessionSeconds: 120, resetsAt: "tomorrow" },
      });
      return response({ state: "idle" });
    });
    render(<TavusChatWindow scenario={scenario} persona={persona} conversationId="capacity" onChatComplete={vi.fn()} onExit={vi.fn()} onExitMode={vi.fn()} />);
    expect(await screen.findByText(/live avatar service is not ready/)).toBeTruthy();
    expect(screen.getByTestId("tavus-runtime-limits").textContent).toContain("80s");
    expect(screen.queryByTestId("tavus-start")).toBeNull();
    blocked = false;
    fireEvent.click(screen.getByTestId("tavus-availability-retry"));
    await waitFor(() => expect(screen.queryByTestId("tavus-blockers")).toBeNull());
    expect(apiRequestMock.mock.calls.some(([method]) => method === "POST")).toBe(false);
  });
  it("retries only after a proven pre-create refusal and an explicit fresh availability check", async () => {
    let attempts = 0;
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({ available: true, blockers: [] });
      if (url.endsWith("/connection")) return response(connection);
      if (method === "POST" && url.endsWith("/start")) {
        attempts++;
        if (attempts === 1) throw new Error('409: {"code":"avatar_runtime_cleanup_pending","creationAttempted":false}');
        return response(active);
      }
      return response({ state: "idle" });
    });
    render(<TavusChatWindow autoStart scenario={scenario} persona={persona} conversationId="safe-retry" onChatComplete={vi.fn()} onExit={vi.fn()} onExitMode={vi.fn()} />);
    await pressMicrophone();
    await screen.findByTestId("tavus-error");
    expect(screen.getByTestId("tavus-session-status").textContent).toContain("Connection unavailable");
    expect(screen.queryByTestId("tavus-start")).toBeNull();
    expect(attempts).toBe(1);
    expect(screen.queryByTestId("tavus-end-retry")).toBeNull();
    fireEvent.click(screen.getByTestId("tavus-availability-retry"));
    await pressMicrophone();
    expect(await screen.findByTestId("mock-daily-room")).toBeTruthy();
    expect(attempts).toBe(2);
  });

  it("syncs only after end, renders canonical messages, and automatically opens the shared feedback screen once", async () => {
    const onChatComplete = vi.fn();
    const canonicalMessage = {
      sender: "user",
      message: "A confirmed server message",
      timestamp: "2025-04-10T10:00:00.000Z",
    };
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({ available: true, evaluationAvailable: true });
      if (url.endsWith("/session")) return response({
        state: "ended",
        createdAt: "2025-04-10T09:58:00.000Z",
        expiresAt: "2025-04-10T10:00:00.000Z",
        evaluationAvailable: true,
        transcriptState: "pending",
      });
      if (method === "POST" && url.endsWith("/sync")) return response({
        state: "ended",
        evaluationAvailable: true,
        transcriptState: "completed",
      });
      if (url === "/api/conversations/run-completed") return response({ messages: [canonicalMessage] });
      return response({ state: "idle" });
    });

    render(<TavusChatWindow scenario={scenario} persona={persona} conversationId="run-completed" onChatComplete={onChatComplete} onExit={vi.fn()} onExitMode={vi.fn()} />);

    const feedbackButton = await screen.findByTestId("tavus-view-feedback");
    expect(await screen.findByText("A confirmed server message")).toBeTruthy();
    await waitFor(() => expect(onChatComplete).toHaveBeenCalledTimes(1));
    expect(apiRequestMock).toHaveBeenCalledWith("POST", "/api/tavus/conversations/run-completed/sync", {});
    expect(apiRequestMock).toHaveBeenCalledWith("GET", "/api/conversations/run-completed");
    expect(apiRequestMock.mock.calls.some(([method, url]) => method === "POST" && String(url).endsWith("/start"))).toBe(false);

    fireEvent.click(feedbackButton);
    expect(onChatComplete).toHaveBeenCalledTimes(1);
  });

  it("waits for final history after user end before opening feedback, and never ends a closed room again on exit", async () => {
    const onChatComplete = vi.fn();
    let syncs = 0;
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({ available: true, evaluationAvailable: true });
      if (url.endsWith("/connection")) return response(connection);
      if (url.endsWith("/start")) return response({ ...active, evaluationAvailable: true, transcriptState: "pending" });
      if (url.endsWith("/end")) return response({ state: "ended", evaluationAvailable: true, transcriptState: "pending" });
      if (method === "POST" && url.endsWith("/sync")) return response({
        state: "ended", evaluationAvailable: true, transcriptState: ++syncs === 1 ? "pending" : "completed",
      });
      if (url === "/api/conversations/report-flow") return response({ messages: [] });
      return response({ state: "idle" });
    });
    const view = render(<TavusChatWindow autoStart scenario={scenario} persona={persona} conversationId="report-flow" onChatComplete={onChatComplete} onExit={vi.fn()} onExitMode={vi.fn()} />);
    await pressMicrophone();
    await screen.findByTestId("mock-daily-room");
    expect(onChatComplete).not.toHaveBeenCalled();
    expect(syncs).toBe(0);
    expect(screen.getByTestId("tavus-end").textContent).toContain("Finish conversation and generate report");
    fireEvent.click(screen.getByTestId("tavus-end"));
    await screen.findByTestId("tavus-feedback-waiting");
    expect(screen.getByText("Preparing your feedback report")).toBeTruthy();
    await waitFor(() => expect(syncs).toBe(1));
    expect(onChatComplete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("tavus-transcript-retry"));
    await waitFor(() => expect(onChatComplete).toHaveBeenCalledTimes(1));
    view.unmount();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves older Tavus recovery when fresh discovery advertises confirmed transcripts", async () => {
    const onChatComplete = vi.fn();
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({ available: true, providerId: "tavus", evaluationAvailable: true });
      if (method === "POST" && url.endsWith("/sync")) return response({
        state: "ended", evaluationAvailable: true, transcriptState: "completed",
      });
      if (url === "/api/conversations/old-capability") return response({ messages: [] });
      return response({ state: "ended", evaluationAvailable: false, transcriptState: "unavailable" });
    });
    render(<TavusChatWindow scenario={scenario} persona={persona} conversationId="old-capability" onChatComplete={onChatComplete} onExit={vi.fn()} onExitMode={vi.fn()} />);
    await waitFor(() => expect(onChatComplete).toHaveBeenCalledTimes(1));
    expect(apiRequestMock.mock.calls.filter(([method, url]) => method === "POST" && String(url).endsWith("/sync"))).toHaveLength(1);
  });

  it("ignores an older sync response after switching conversation IDs", async () => {
    let releaseOldSync: ((value: ReturnType<typeof response>) => void) | undefined;
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({ available: true, evaluationAvailable: true });
      if (url.endsWith("/session")) return response({ state: "ended", evaluationAvailable: true });
      if (method === "POST" && url.endsWith("/sync")) {
        if (url.includes("run-old")) {
          return await new Promise<ReturnType<typeof response>>((resolve) => { releaseOldSync = resolve; });
        }
        return response({ state: "ended", evaluationAvailable: true, transcriptState: "completed" });
      }
      if (url === "/api/conversations/run-new") {
        return response({ messages: [{ sender: "user", message: "New conversation record", timestamp: "2025-04-10T10:00:00.000Z" }] });
      }
      return response({ state: "idle" });
    });
    const props = { scenario, persona, onChatComplete: vi.fn(), onExit: vi.fn(), onExitMode: vi.fn() };
    const view = render(<TavusChatWindow {...props} conversationId="run-old" />);
    await waitFor(() => expect(releaseOldSync).toBeTypeOf("function"));

    view.rerender(<TavusChatWindow {...props} conversationId="run-new" />);
    expect(await screen.findByText("New conversation record")).toBeTruthy();
    releaseOldSync?.(response({ state: "ended", evaluationAvailable: true, transcriptState: "failed", transcriptError: "stale" }));

    await waitFor(() => expect(screen.getByText("New conversation record")).toBeTruthy());
    expect(screen.getByTestId("tavus-view-feedback")).toBeTruthy();
    expect(screen.queryByTestId("tavus-transcript-failed")).toBeNull();
    expect(screen.queryByText("A stale old conversation record")).toBeNull();
  });

  it("keeps pending retrieval visible and exposes a safe manual retry without inventing messages", async () => {
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({ available: true, evaluationAvailable: true });
      if (url.endsWith("/session")) return response({ state: "ended", evaluationAvailable: true });
      if (method === "POST" && url.endsWith("/sync")) return response({
        state: "ended",
        evaluationAvailable: true,
        transcriptState: "pending",
      });
      return response({ state: "idle" });
    });
    render(<TavusChatWindow scenario={scenario} persona={persona} conversationId="run-pending" onChatComplete={vi.fn()} onExit={vi.fn()} onExitMode={vi.fn()} />);

    expect(await screen.findByTestId("tavus-transcript-pending")).toBeTruthy();
    expect(screen.queryByTestId("chat-messages")).toBeNull();
    expect(screen.queryByText(/A hard conversation/)).toBeTruthy();
    expect(screen.queryByTestId("tavus-view-feedback")).toBeNull();
    expect(apiRequestMock.mock.calls.some(([, url]) => String(url) === "/api/conversations/run-pending")).toBe(false);
    fireEvent.click(screen.getByTestId("tavus-transcript-retry"));
    await waitFor(() => expect(apiRequestMock.mock.calls.filter(([method, url]) => method === "POST" && String(url).endsWith("/sync"))).toHaveLength(2));
    expect(apiRequestMock.mock.calls.some(([method, url]) => method === "POST" && String(url).endsWith("/start"))).toBe(false);
  });

  it("shows final-transcript unsupported status without sync, fake messages, or feedback action", async () => {
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({ available: true, evaluationAvailable: false });
      if (url.endsWith("/session")) return response({
        state: "ended",
        evaluationAvailable: false,
        transcriptState: "unavailable",
      });
      return response({ state: "idle" });
    });
    render(<TavusChatWindow scenario={scenario} persona={persona} conversationId="run-unavailable" onChatComplete={vi.fn()} onExit={vi.fn()} onExitMode={vi.fn()} />);

    expect(await screen.findByTestId("tavus-evaluation-unavailable")).toBeTruthy();
    expect(screen.queryByTestId("tavus-view-feedback")).toBeNull();
    expect(apiRequestMock.mock.calls.some(([method, url]) => method === "POST" && String(url).endsWith("/sync"))).toBe(false);
    expect(apiRequestMock.mock.calls.some(([, url]) => String(url) === "/api/conversations/run-unavailable")).toBe(false);
  });

  it("loads saved AI-only history for an empty transcript without offering feedback", async () => {
    apiRequestMock.mockImplementation(async (_method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({ available: true, evaluationAvailable: true });
      if (url.endsWith("/session")) return response({
        state: "ended",
        evaluationAvailable: true,
        transcriptState: "empty",
      });
      if (url === "/api/conversations/run-empty") {
        return response({ messages: [{ sender: "ai", message: "Confirmed AI-only turn", timestamp: "2025-04-10T10:00:00.000Z" }] });
      }
      return response({ state: "idle" });
    });
    render(<TavusChatWindow scenario={scenario} persona={persona} conversationId="run-empty" onChatComplete={vi.fn()} onExit={vi.fn()} onExitMode={vi.fn()} />);

    expect(await screen.findByText("Confirmed AI-only turn")).toBeTruthy();
    expect(screen.getByTestId("tavus-evaluation-unavailable").textContent).toMatch(/No learner utterance was available/);
    expect(screen.queryByTestId("tavus-view-feedback")).toBeNull();
    expect(apiRequestMock).toHaveBeenCalledWith("GET", "/api/conversations/run-empty");
    expect(apiRequestMock.mock.calls.some(([method, url]) => method === "POST" && String(url).endsWith("/sync"))).toBe(false);
  });

  it("shows failed sync and final-history read errors with separate retry actions", async () => {
    let syncCount = 0;
    let readCount = 0;
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({ available: true, evaluationAvailable: true });
      if (url.endsWith("/session")) return response({ state: "ended", evaluationAvailable: true });
      if (method === "POST" && url.endsWith("/sync")) {
        syncCount++;
        return syncCount === 1
          ? response({ state: "ended", evaluationAvailable: true, transcriptState: "failed", transcriptError: "router_unavailable" })
          : response({ state: "ended", evaluationAvailable: true, transcriptState: "completed" });
      }
      if (url === "/api/conversations/run-read-error") {
        readCount++;
        if (readCount === 1) throw new Error("history read failed");
        return response({ messages: [{ sender: "ai", message: "Server-confirmed line", timestamp: "2025-04-10T10:00:00.000Z" }] });
      }
      return response({ state: "idle" });
    });
    render(<TavusChatWindow scenario={scenario} persona={persona} conversationId="run-read-error" onChatComplete={vi.fn()} onExit={vi.fn()} onExitMode={vi.fn()} />);

    expect(await screen.findByTestId("tavus-transcript-failed")).toBeTruthy();
    expect(screen.queryByTestId("tavus-view-feedback")).toBeNull();
    fireEvent.click(screen.getByTestId("tavus-transcript-retry"));
    await waitFor(() => expect(syncCount).toBe(2));
    expect(await screen.findByTestId("tavus-history-error")).toBeTruthy();
    fireEvent.click(screen.getByTestId("tavus-history-retry"));
    expect(await screen.findByText("Server-confirmed line")).toBeTruthy();
  });

  it("passes the browser caption callback through and replaces duplicate caption IDs in place", async () => {
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({ available: true });
      if (url.endsWith("/session")) return response({ state: "active" });
      if (url.endsWith("/connection")) return response(connection);
      return response({ state: "active" });
    });
    render(<TavusChatWindow scenario={scenario} persona={persona} conversationId="caption-dedup" onChatComplete={vi.fn()} onExit={vi.fn()} onExitMode={vi.fn()} />);
    expect(await screen.findByTestId("mock-daily-room")).toBeTruthy();
    const roomProps = roomMock.mock.calls.at(-1)?.[0];
    expect(typeof roomProps?.onCaption).toBe("function");
    expect(screen.getByText(/Browser captions · unverified/)).toBeTruthy();

    act(() => {
      roomProps?.onCaption?.({ id: "draft-1", sender: "ai", message: "A partial thought", timestamp: "2025-04-10T10:00:00.000Z", interrupted: false });
      roomProps?.onCaption?.({ id: "draft-1", sender: "ai", message: "The updated interrupted thought", timestamp: "2025-04-10T10:00:01.000Z", interrupted: true });
    });

    expect(await screen.findByText(/The updated interrupted thought · interrupted draft/)).toBeTruthy();
    expect(screen.queryByText("A partial thought")).toBeNull();
    expect(screen.getByText(/Unconfirmed captions are lost on reload/)).toBeTruthy();
  });

  it("replaces provisional browser captions with final canonical messages when history completes", async () => {
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({ available: true, evaluationAvailable: true });
      if (url.endsWith("/connection")) return response(connection);
      if (method === "POST" && url.endsWith("/start")) return response({ state: "active" });
      if (method === "POST" && url.endsWith("/end")) return response({ state: "ended", evaluationAvailable: true });
      if (url.endsWith("/session")) return response({ state: "idle" });
      if (method === "POST" && url.endsWith("/sync")) return response({
        state: "ended",
        evaluationAvailable: true,
        transcriptState: "completed",
      });
      if (url === "/api/conversations/caption-final") {
        return response({ messages: [{ sender: "user", message: "Confirmed server utterance", timestamp: "2025-04-10T10:00:02.000Z" }] });
      }
      return response({ state: "ended", evaluationAvailable: true, transcriptState: "completed" });
    });
    render(<TavusChatWindow autoStart scenario={scenario} persona={persona} conversationId="caption-final" onChatComplete={vi.fn()} onExit={vi.fn()} onExitMode={vi.fn()} />);
    await pressMicrophone();
    expect(await screen.findByTestId("mock-daily-room")).toBeTruthy();
    act(() => {
      roomMock.mock.calls.at(-1)?.[0].onCaption?.({
        id: "provisional-1",
        sender: "user",
        message: "Unverified live draft",
        timestamp: "2025-04-10T10:00:01.000Z",
        interrupted: false,
      });
    });
    expect(await screen.findByText("Unverified live draft")).toBeTruthy();

    fireEvent.click(await screen.findByTestId("tavus-end"));
    expect(await screen.findByText("Confirmed server utterance")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Unverified live draft")).toBeNull());
    expect(screen.queryByText(/Browser captions · unverified/)).toBeNull();
  });
});
