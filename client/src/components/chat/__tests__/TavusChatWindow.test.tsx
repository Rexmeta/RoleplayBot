// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { apiRequestMock, roomMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
  roomMock: vi.fn(() => <div data-testid="mock-daily-room" />),
}));

vi.mock("@/lib/queryClient", () => ({ apiRequest: apiRequestMock }));
vi.mock("../DailyAvatarRoom", () => ({ default: roomMock }));
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
  it("requires explicit consent, starts a single session, retrieves Daily credentials separately, then closes without completion", async () => {
    const onChatComplete = vi.fn();
    const onExit = vi.fn();
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({ available: true, blockers: [] });
      if (url.endsWith("/connection")) return response(connection);
      if (url.endsWith("/start")) return response(active);
      if (url.endsWith("/end")) return response({ state: "ended", evaluationAvailable: false });
      return response({ state: "idle" });
    });
    render(<TavusChatWindow scenario={scenario} persona={persona} conversationId="run-1" onChatComplete={onChatComplete} onExit={onExit} onExitMode={vi.fn()} />);

    expect(await screen.findByTestId("tavus-start")).toBeTruthy();
    expect(screen.getByText(/120 seconds, including queue and startup time/)).toBeTruthy();
    expect(screen.getByText(/Confirmed history, when supported, becomes available after the session ends/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("tavus-history-toggle"));
    expect(screen.getByTestId("tavus-history-toggle").getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByTestId("tavus-consent"));
    fireEvent.click(screen.getByTestId("tavus-start"));
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
    render(<TavusChatWindow scenario={scenario} persona={persona} conversationId="blocked-1" onChatComplete={vi.fn()} onExit={vi.fn()} onExitMode={vi.fn()} />);
    expect(await screen.findByTestId("tavus-blockers")).toBeTruthy();
    fireEvent.click(screen.getByTestId("tavus-consent"));
    expect((screen.getByTestId("tavus-start") as HTMLButtonElement).disabled).toBe(true);
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
    render(<TavusChatWindow scenario={scenario} persona={persona} conversationId="unknown-1" onChatComplete={vi.fn()} onExit={vi.fn()} onExitMode={vi.fn()} />);
    fireEvent.click(await screen.findByTestId("tavus-consent"));
    fireEvent.click(screen.getByTestId("tavus-start"));
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
    expect(await screen.findByText(/worker is not ready/)).toBeTruthy();
    expect(screen.getByTestId("tavus-runtime-limits").textContent).toContain("80s");
    fireEvent.click(screen.getByTestId("tavus-consent"));
    expect((screen.getByTestId("tavus-start") as HTMLButtonElement).disabled).toBe(true);
    blocked = false;
    fireEvent.click(screen.getByTestId("tavus-availability-retry"));
    await waitFor(() => expect((screen.getByTestId("tavus-start") as HTMLButtonElement).disabled).toBe(false));
    expect(apiRequestMock.mock.calls.some(([method]) => method === "POST")).toBe(false);
  });
  it("allows manual retry only after an explicit pre-create refusal and a fresh free check", async () => {
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
    render(<TavusChatWindow scenario={scenario} persona={persona} conversationId="safe-retry" onChatComplete={vi.fn()} onExit={vi.fn()} onExitMode={vi.fn()} />);
    fireEvent.click(await screen.findByTestId("tavus-consent"));
    fireEvent.click(screen.getByTestId("tavus-start"));
    await screen.findByTestId("tavus-error");
    expect(screen.getByTestId("tavus-session-status").textContent).toContain("Ready when you are");
    expect((screen.getByTestId("tavus-start") as HTMLButtonElement).disabled).toBe(true);
    expect(attempts).toBe(1);
    expect(screen.queryByTestId("tavus-end-retry")).toBeNull();
    fireEvent.click(screen.getByTestId("tavus-availability-retry"));
    await waitFor(() => expect((screen.getByTestId("tavus-start") as HTMLButtonElement).disabled).toBe(false));
    expect(attempts).toBe(1);
    fireEvent.click(screen.getByTestId("tavus-start"));
    expect(await screen.findByTestId("mock-daily-room")).toBeTruthy();
    expect(attempts).toBe(2);
  });

  it("syncs only after end, renders canonical messages, and opens feedback only on explicit click after completion", async () => {
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
    expect(screen.getByText("A confirmed server message")).toBeTruthy();
    expect(onChatComplete).not.toHaveBeenCalled();
    expect(apiRequestMock).toHaveBeenCalledWith("POST", "/api/tavus/conversations/run-completed/sync", {});
    expect(apiRequestMock).toHaveBeenCalledWith("GET", "/api/conversations/run-completed");
    expect(apiRequestMock.mock.calls.some(([method, url]) => method === "POST" && String(url).endsWith("/start"))).toBe(false);

    fireEvent.click(feedbackButton);
    expect(onChatComplete).toHaveBeenCalledTimes(1);
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
    expect(screen.queryByText("A hard conversation")).toBeTruthy();
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
});
