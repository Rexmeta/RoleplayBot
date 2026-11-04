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
const persona = { id: "persona", name: "Mina Park", role: "Operations director", image: "" } as unknown as ScenarioPersona;
const active = { state: "active" };
const connection = { transport: "daily", pipeline: "tavus_full", url: "https://daily.example/room", token: "ephemeral-secret" };
const response = (body: unknown) => ({ json: async () => body });

beforeEach(() => {
  apiRequestMock.mockReset();
  roomMock.mockClear();
  apiRequestMock.mockImplementation(async (_method: string, url: string) => {
    if (url.startsWith("/api/tavus/config?")) return response({ available: true, blockers: [] });
    if (url.endsWith("/connection")) return response(connection);
    return response({ state: "idle" });
  });
});
afterEach(() => { vi.clearAllMocks(); });

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
    expect(screen.getByText(/Final transcript and evaluation are not supported yet/)).toBeTruthy();
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
});
