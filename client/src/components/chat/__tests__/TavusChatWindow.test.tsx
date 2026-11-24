// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { apiRequestMock, roomMock, locale } = vi.hoisted(() => ({
  locale: { language: "en" },
  apiRequestMock: vi.fn(),
  roomMock: vi.fn((props: { onCaption?: (caption: { id: string; sender: "user" | "ai"; message: string; timestamp: string; interrupted: boolean }) => void }) => (
    <div data-testid="mock-daily-room" data-caption-connected={String(typeof props.onCaption === "function")} />
  )),
}));

vi.mock("@/lib/queryClient", () => ({ apiRequest: apiRequestMock }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "test-user" } }) }));
vi.mock("../DailyAvatarRoom", () => ({ default: roomMock }));
vi.mock("../TopMenuPanel", () => ({ TopMenuPanel: ({ isOpen, onClose, children }: any) => isOpen ? <div data-testid="top-menu">{children}<button type="button" onClick={onClose}>close-context</button></div> : null }));
vi.mock("../ManagedAvatarRoom", () => ({ default: (props: any) => (
  <div data-testid="mock-managed-room" data-report-timing={String(props.reportTiming)}>
    <button data-testid="fail-timing-report" onClick={() => props.onTimingReport?.("failed")}>Fail timing report</button>
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
    i18n: locale,
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
  locale.language = "en";
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
  const refusals = [
    ["avatar_persona_mismatch", "not the partner assigned", "배정된 상대와 다릅니다"],
    ["avatar_persona_not_selected", "No live avatar is assigned", "라이브 아바타가 배정되어 있지 않습니다"],
    ["avatar_persona_context_mismatch", "The role saved", "저장된 역할 정보"],
    ["avatar_existing_session_target_mismatch", "already has a live session for another partner", "다른 상대의 라이브 세션이 이미 있습니다"],
  ];
  describe.each(["en", "ko"])("%s start refusal guidance", language => {
    it.each(refusals)("explains %s and offers only a safe return path", async (code, english, korean) => {
      locale.language = language;
      const onExit = vi.fn();
      const onExitMode = vi.fn();
      apiRequestMock.mockImplementation(async (method: string, url: string) => {
        if (url.startsWith("/api/tavus/config?")) return response({ available: true });
        if (url.endsWith("/start")) throw new Error(`409: ${JSON.stringify({ code, creationAttempted: false })}`);
        if (url.endsWith("/end")) return response({ state: "ended", transcriptState: "unavailable" });
        return response({ state: "idle" });
      });
      const view = render(<TavusChatWindow autoStart scenario={scenario} persona={persona} conversationId="refused"
        onChatComplete={vi.fn()} onExit={onExit} onExitMode={onExitMode} />);
      await pressMicrophone();
      const alert = await screen.findByTestId("tavus-error");
      expect(alert.textContent).toContain(language === "en" ? english : korean);
      expect(alert.textContent).toContain(language === "en" ? "No new live connection was created by this request" : "이번 요청으로 새 라이브 연결은 생성되지 않았습니다");
      expect(alert.textContent).toContain(language === "en" ? "saved history" : "저장된 기록");
      expect(alert.textContent).not.toContain(code);
      if (code === "avatar_existing_session_target_mismatch") {
        expect(screen.getByTestId("tavus-session-status").textContent).toContain(language === "en" ? "Start request did not complete" : "시작 요청을 완료하지 못했습니다");
        expect(alert.textContent).toContain(language === "en" ? "does not mean that session has ended" : "이전 세션이 종료되었다는 뜻이 아닙니다");
        expect(screen.queryByTestId("tavus-refusal-back")).toBeNull();
        fireEvent.click(screen.getByTestId("button-conversation-mode-menu"));
        expect((screen.getByTestId("button-conversation-mode-text") as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(screen.getByTestId("tavus-end-retry"));
        await screen.findByTestId("tavus-close");
        fireEvent.click(screen.getByTestId("tavus-close"));
      } else {
        expect(screen.getByTestId("tavus-session-status").textContent).toContain(language === "en" ? "Ready when you are" : "준비되었습니다");
        expect(screen.queryByTestId("tavus-end-retry")).toBeNull();
        fireEvent.click(screen.getByTestId("tavus-refusal-back"));
        expect(apiRequestMock.mock.calls.some(([, url]) => url.endsWith("/end"))).toBe(false);
      }
      expect(onExit).toHaveBeenCalledTimes(1);
      expect(onExitMode).not.toHaveBeenCalled();
      expect(apiRequestMock.mock.calls.filter(([method, url]) => method === "POST" && url.endsWith("/start"))).toHaveLength(1);
      view.unmount();
    });
  });

  it.each([undefined, true])("does not infer that no connection was created from a refusal code alone (%s)", async creationAttempted => {
    apiRequestMock.mockImplementation(async (_method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({ available: true });
      if (url.endsWith("/start")) throw new Error(`409: ${JSON.stringify({ code: "avatar_persona_context_mismatch", creationAttempted })}`);
      return response({ state: "idle" });
    });
    render(<TavusChatWindow scenario={scenario} persona={persona} conversationId="uncertain-refusal"
      onChatComplete={vi.fn()} onExit={vi.fn()} onExitMode={vi.fn()} />);
    await pressMicrophone();
    const alert = await screen.findByTestId("tavus-error");
    expect(alert.textContent).not.toContain("No new live connection");
    expect(alert.textContent).toContain("An earlier session may still need recovery");
    expect(screen.queryByTestId("tavus-refusal-back")).toBeNull();
    expect(screen.getByTestId("tavus-end-retry")).toBeTruthy();
  });

  it("keeps an older uncertain session when a later request is definitely refused before creation", async () => {
    let attempts = 0;
    apiRequestMock.mockImplementation(async (_method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({ available: true });
      if (url.endsWith("/start")) {
        attempts++;
        throw new Error(attempts === 1 ? "503: unknown" : '409: {"code":"avatar_persona_mismatch","creationAttempted":false}');
      }
      return response({ state: "idle" });
    });
    render(<TavusChatWindow scenario={scenario} persona={persona} conversationId="older-unknown"
      onChatComplete={vi.fn()} onExit={vi.fn()} onExitMode={vi.fn()} />);
    await pressMicrophone();
    await screen.findByTestId("tavus-error");
    await pressMicrophone();
    await waitFor(() => expect(screen.getByTestId("tavus-error").textContent).toContain("not the partner assigned"));
    expect(screen.getByTestId("tavus-session-status").textContent).toContain("Start request did not complete");
    expect(screen.getByTestId("tavus-start-refusal-help").textContent).toContain("An earlier session may still need recovery");
    expect(screen.queryByTestId("tavus-refusal-back")).toBeNull();
    expect(screen.getByTestId("tavus-end-retry")).toBeTruthy();
    expect(attempts).toBe(2);
  });

  it.each(refusals)("does not automatically retry or end after %s", async code => {
    apiRequestMock.mockImplementation(async (_method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({ available: true });
      if (url.endsWith("/start")) throw new Error(`409: ${JSON.stringify({ code, creationAttempted: false })}`);
      return response({ state: "idle" });
    });
    const view = render(<TavusChatWindow autoStart scenario={scenario} persona={persona} conversationId="no-auto-retry"
      onChatComplete={vi.fn()} onExit={vi.fn()} onExitMode={vi.fn()} />);
    await pressMicrophone();
    await screen.findByTestId("tavus-error");
    vi.useFakeTimers();
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
      expect(apiRequestMock.mock.calls.filter(([method]) => method === "POST")).toHaveLength(1);
      expect(apiRequestMock.mock.calls.some(([, url]) => url.endsWith("/end"))).toBe(false);
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it.each(["text", "voice"])("returns safely to %s after a confirmed pre-create refusal", async mode => {
    const onExitMode = vi.fn();
    apiRequestMock.mockImplementation(async (_method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({ available: true });
      if (url.endsWith("/start")) throw new Error('409: {"code":"avatar_persona_not_selected","creationAttempted":false}');
      return response({ state: "idle" });
    });
    render(<TavusChatWindow scenario={scenario} persona={persona} conversationId="safe-mode-return"
      onChatComplete={vi.fn()} onExit={vi.fn()} onExitMode={onExitMode} />);
    await pressMicrophone();
    await screen.findByTestId("tavus-error");
    fireEvent.click(screen.getByTestId("button-conversation-mode-menu"));
    fireEvent.click(screen.getByTestId(`button-conversation-mode-${mode}`));
    expect(onExitMode).toHaveBeenCalledWith(mode === "text" ? "text" : "realtime-voice");
    expect(apiRequestMock.mock.calls.some(([, url]) => url.endsWith("/end"))).toBe(false);
  });

  it("disables a direct live entry when the server rejects the selected persona", async () => {
    apiRequestMock.mockImplementation(async (_method: string, url: string) =>
      response(url.startsWith("/api/tavus/config?")
        ? { available: false, targetMatched: false, blockers: ["avatar_persona_mismatch"] }
        : { state: "idle" }));
    render(<TavusChatWindow scenario={scenario} persona={persona} conversationId="unassigned"
      onChatComplete={vi.fn()} onExit={vi.fn()} onExitMode={vi.fn()} />);
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith("GET",
      "/api/tavus/config?runId=unassigned&actorId=persona"));
    await act(async () => {});
    fireEvent.click(screen.getByTestId("button-live-avatar-microphone"));
    expect(apiRequestMock.mock.calls.some(([method]) => method === "POST")).toBe(false);
    expect((screen.getByTestId("button-live-avatar-microphone") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("tavus-error").textContent).toContain("not the partner assigned");
    expect(screen.getByTestId("tavus-error").textContent).not.toContain("No new live connection");
    expect(screen.getByTestId("tavus-refusal-back")).toBeTruthy();
  });
  it("ends a late old-persona creation without connecting it on the new screen", async () => {
    let finishStart!: (value: unknown) => void;
    apiRequestMock.mockImplementation(async (_method: string, url: string) => {
      if (url.endsWith("/start")) return new Promise(resolve => { finishStart = resolve; });
      if (url.startsWith("/api/tavus/config?")) return response({ available: true, targetMatched: true });
      return response({ state: "idle" });
    });
    const props = { scenario, conversationId: "late", onChatComplete: vi.fn(), onExit: vi.fn(), onExitMode: vi.fn() };
    const view = render(<TavusChatWindow {...props} persona={persona} />);
    await pressMicrophone();
    view.rerender(<TavusChatWindow {...props} persona={{ ...persona, id: "third", name: "Third" }} />);
    await act(async () => { finishStart(response({ id: "old-session", state: "active", personaId: "persona" })); });
    expect(screen.queryByTestId("mock-daily-room")).toBeNull();
    expect(apiRequestMock.mock.calls.some(([, url]) => url.endsWith("/connection"))).toBe(false);
    expect(fetch).toHaveBeenCalledWith("/api/tavus/conversations/late/end", expect.objectContaining({ keepalive: true }));
  });
  it.each([[5, 5], [12, 10]])("shows the scenario duration %s with a live limit of %s minutes", async (target, expected) => {
    render(<TavusChatWindow scenario={{ ...scenario, targetDurationMinutes: target }} persona={persona}
      conversationId="duration" onChatComplete={vi.fn()} onExit={vi.fn()} onExitMode={vi.fn()} />);
    await screen.findByTestId("button-live-avatar-microphone");
    expect(screen.getByTestId("tavus-session-status").textContent)
      .toContain(`Live avatar limit ${expected} min (up to 10 min)`);
    expect(apiRequestMock.mock.calls.some(([method]) => method === "POST")).toBe(false);
  });

  it("connects timing reporting and displays server observations without treating report failure as session failure", async () => {
    apiRequestMock.mockImplementation(async (_method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({ available: true, managedClient: true });
      return response({ id: "owned", state: "active", managedClient: true, providerId: "tavus",
        timing: { routerElapsedSeconds: 26, clientVideoReportedAt: "2026-11-13T00:00:09Z",
          preparationSeconds: 9, connectedSeconds: 17, evidence: "authenticated_client_report" } });
    });
    render(<TavusChatWindow scenario={scenario} persona={persona} conversationId="timing"
      onChatComplete={vi.fn()} onExit={vi.fn()} onExitMode={vi.fn()} />);
    expect((await screen.findByTestId("mock-managed-room")).getAttribute("data-report-timing")).toBe("true");
    expect(screen.getByTestId("avatar-session-timing").textContent).toContain("0:09");
    expect(screen.getByTestId("avatar-session-timing").textContent).toContain("0:17");
    fireEvent.click(screen.getByTestId("fail-timing-report"));
    expect(screen.getByText(/Video timing report failed/)).toBeTruthy();
    expect(screen.getByTestId("mock-managed-room")).toBeTruthy();
    expect(apiRequestMock.mock.calls.some(([method]) => method === "POST")).toBe(false);
  });
  it("delegates exhausted-budget admission to the router only after a microphone click", async () => {
    apiRequestMock.mockImplementation(async (_method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({
        available: false, selectable: true, providerId: "tavus",
        blockers: ["avatar_runtime_user_budget_insufficient", "avatar_runtime_creation_blocked"],
        runtime: { userRemainingSeconds: 0, globalRemainingSeconds: 3600, sessionSeconds: 600,
          resetsAt: "2026-11-13T00:00:00.000Z" },
      });
      if (url.endsWith("/start")) return response(active);
      return response({ state: "idle" });
    });
    render(<TavusChatWindow scenario={scenario} persona={persona} conversationId="stock-budget"
      onChatComplete={vi.fn()} onExit={vi.fn()} onExitMode={vi.fn()} />);
    await waitFor(() => expect((screen.getByTestId("button-live-avatar-microphone") as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByTestId("tavus-blockers")).toBeNull();
    expect(screen.queryByTestId("tavus-runtime-limits")).toBeNull();
    expect(apiRequestMock.mock.calls.some(([method]) => method === "POST")).toBe(false);
    await pressMicrophone();
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith(
      "POST", "/api/tavus/conversations/stock-budget/start", { consent: true, actorId: "persona" },
    ));
    expect(apiRequestMock.mock.calls.filter(([method, url]) => method === "POST" && url.endsWith("/start"))).toHaveLength(1);
  });
  it("removes the duplicate header exit and leaves mode switching to the bottom menu", async () => {
    const exit = vi.fn();
    const exitMode = vi.fn();
    render(<TavusChatWindow scenario={scenario} persona={persona} conversationId="header-menu"
      onChatComplete={vi.fn()} onExit={exit} onExitMode={exitMode} />);
    await waitFor(() => expect((screen.getByTestId("button-live-avatar-microphone") as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByTestId("tavus-exit")).toBeNull();
    expect(screen.getByTestId("button-conversation-mode-menu")).toBeTruthy();
    expect(screen.queryByText("Back to chat modes")).toBeNull();
    expect(exit).not.toHaveBeenCalled();
    expect(exitMode).not.toHaveBeenCalled();
    expect(apiRequestMock.mock.calls.some(([method]) => method === "POST")).toBe(false);
  });
  it("shows the scenario duration rather than obsolete capacity metadata without auto-connecting", async () => {
    apiRequestMock.mockImplementation(async (_method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({
        available: true, runtime: { sessionSeconds: 600, userRemainingSeconds: 3000, globalRemainingSeconds: 6600, resetsAt: "tomorrow" },
      });
      return response({ state: "idle" });
    });
    render(<TavusChatWindow scenario={{ ...scenario, targetDurationMinutes: 5 }} persona={persona} conversationId="duration"
      onChatComplete={vi.fn()} onExit={vi.fn()} onExitMode={vi.fn()} />);
    await waitFor(() => expect((screen.getByTestId("button-live-avatar-microphone") as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByTestId("tavus-duration-notice")).toBeNull();
    expect(screen.queryByText(/including connection time/)).toBeNull();
    expect(screen.queryByText(/Uses this session's persona and scenario instructions/)).toBeNull();
    expect(screen.queryByText(/Press the microphone to start a usage-billed connection/)).toBeNull();
    expect(screen.queryByText(/Connecting automatically/)).toBeNull();
    expect(screen.queryByTestId("tavus-stage-status")).toBeNull();
    expect(screen.queryByTestId("tavus-runtime-limits")).toBeNull();
    expect(screen.getByTestId("tavus-session-status").textContent).toContain("Live avatar limit 5 min (up to 10 min)");
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
      expect(screen.getByTestId("feedback-transition-overlay")).toBeTruthy();
      expect(screen.queryByTestId("button-live-avatar-microphone")).toBeNull();
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
    expect(apiRequestMock).toHaveBeenCalledWith("POST", "/api/tavus/conversations/direct-live/start", { consent: true, actorId: "persona" });
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
    expect(await screen.findByTestId("feedback-transition-overlay")).toBeTruthy();
    await waitFor(() => expect(onChatComplete).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith("GET", "/api/conversations/common-run"));
    expect(screen.queryByText("Unified provisional caption")).toBeNull();
  });
  it("starts on the microphone, retrieves Daily credentials separately, and does not invent unsupported feedback", async () => {
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
    expect(apiRequestMock).toHaveBeenCalledWith("POST", "/api/tavus/conversations/run-1/start", { consent: true, actorId: "persona" });
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

  it("does not use config blockers to prevent an explicit start request", async () => {
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({ available: false, blockers: ["Provider is not configured"] });
      if (url.endsWith("/start")) return response(active);
      if (url.endsWith("/connection")) return response(connection);
      return response({ state: "idle" });
    });
    render(<TavusChatWindow autoStart scenario={scenario} persona={persona} conversationId="blocked-1" onChatComplete={vi.fn()} onExit={vi.fn()} onExitMode={vi.fn()} />);
    await waitFor(() => expect((screen.getByTestId("button-live-avatar-microphone") as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByTestId("tavus-blockers")).toBeNull();
    expect(screen.queryByTestId("tavus-start")).toBeNull();
    expect(apiRequestMock.mock.calls.some(([method, url]) => method === "POST" && String(url).endsWith("/start"))).toBe(false);
    await pressMicrophone();
    expect(await screen.findByTestId("mock-daily-room")).toBeTruthy();
    expect(apiRequestMock.mock.calls.filter(([method, url]) => method === "POST" && url.endsWith("/start"))).toHaveLength(1);
  });

  it("never automatically retries an uncertain start but forwards another explicit microphone request", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({ available: true });
      if (method === "POST" && url.endsWith("/start")) {
        if (++attempts === 1) throw new Error("503: provider status unknown");
        return response(active);
      }
      if (url.endsWith("/connection")) return response(connection);
      return response({ state: "idle" });
    });
    let view: ReturnType<typeof render> | undefined;
    try {
      await act(async () => {
        view = render(<TavusChatWindow autoStart scenario={scenario} persona={persona} conversationId="unknown-1" onChatComplete={vi.fn()} onExit={vi.fn()} onExitMode={vi.fn()} />);
      });
      expect(attempts).toBe(0);
      await act(async () => { fireEvent.click(screen.getByTestId("button-live-avatar-microphone")); });
      expect(screen.getByTestId("tavus-error")).toBeTruthy();
      expect(screen.getByTestId("tavus-session-status").textContent).toContain("Start request did not complete");
      expect(screen.queryByTestId("tavus-end-retry")).toBeNull();
      expect(screen.queryByTestId("tavus-availability-retry")).toBeNull();
      const readsAfterFailure = apiRequestMock.mock.calls.filter(([method]) => method === "GET").length;
      await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
      expect(attempts).toBe(1);
      expect(apiRequestMock.mock.calls.filter(([method]) => method === "GET")).toHaveLength(readsAfterFailure);
      await act(async () => { fireEvent.click(screen.getByTestId("button-live-avatar-microphone")); });
      expect(screen.getByTestId("mock-daily-room")).toBeTruthy();
      expect(attempts).toBe(2);
      expect(screen.queryByTestId("tavus-error")).toBeNull();
      expect(apiRequestMock.mock.calls.some(([, url]) => url.endsWith("/end"))).toBe(false);
    } finally {
      view?.unmount();
      vi.useRealTimers();
    }
  });
  it("displays a router refusal after manual start and lets the microphone retry without availability checks", async () => {
    let attempts = 0;
    apiRequestMock.mockImplementation(async (_method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({
        available: false, blockers: ["avatar_runtime_worker_unavailable"],
        runtime: { userRemainingSeconds: 80, globalRemainingSeconds: 900, sessionSeconds: 120, resetsAt: "tomorrow" },
      });
      if (url.endsWith("/start")) {
        if (++attempts === 1) throw new Error('503: {"creationAttempted":false,"avatarRouter":{"code":"WORKER_UNAVAILABLE","error":"No avatar worker is available."}}');
        return response(active);
      }
      if (url.endsWith("/connection")) return response(connection);
      return response({ state: "idle" });
    });
    render(<TavusChatWindow scenario={scenario} persona={persona} conversationId="capacity" onChatComplete={vi.fn()} onExit={vi.fn()} onExitMode={vi.fn()} />);
    await pressMicrophone();
    expect((await screen.findByTestId("tavus-error")).textContent).toContain("No avatar worker is available. (WORKER_UNAVAILABLE)");
    expect(attempts).toBe(1);
    expect(screen.queryByTestId("tavus-availability-retry")).toBeNull();
    expect(screen.queryByTestId("tavus-runtime-limits")).toBeNull();
    await pressMicrophone();
    expect(await screen.findByTestId("mock-daily-room")).toBeTruthy();
    expect(attempts).toBe(2);
    expect(apiRequestMock.mock.calls.filter(([, url]) => url.startsWith("/api/tavus/config?"))).toHaveLength(1);
    expect(apiRequestMock.mock.calls.some(([, url]) => url.endsWith("/end"))).toBe(false);
  });
  it("allows a manual retry after a pre-create refusal without a fresh availability or cleanup check", async () => {
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
    expect(screen.getByTestId("tavus-session-status").textContent).toContain("Ready when you are");
    expect(screen.queryByTestId("tavus-start")).toBeNull();
    expect(attempts).toBe(1);
    expect(screen.queryByTestId("tavus-end-retry")).toBeNull();
    expect(screen.queryByTestId("tavus-availability-retry")).toBeNull();
    await pressMicrophone();
    expect(await screen.findByTestId("mock-daily-room")).toBeTruthy();
    expect(attempts).toBe(2);
    expect(apiRequestMock.mock.calls.filter(([, url]) => url.startsWith("/api/tavus/config?"))).toHaveLength(1);
    expect(apiRequestMock.mock.calls.some(([, url]) => url.endsWith("/end"))).toBe(false);
  });

  it("syncs only after end, loads canonical messages behind the transition, and opens feedback once", async () => {
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

    const view = render(<TavusChatWindow scenario={scenario} persona={persona} conversationId="run-completed" onChatComplete={onChatComplete} onExit={vi.fn()} onExitMode={vi.fn()} />);

    expect(await screen.findByTestId("feedback-transition-overlay")).toBeTruthy();
    await waitFor(() => expect(onChatComplete).toHaveBeenCalledTimes(1));
    expect(apiRequestMock).toHaveBeenCalledWith("POST", "/api/tavus/conversations/run-completed/sync", {});
    expect(apiRequestMock).toHaveBeenCalledWith("GET", "/api/conversations/run-completed");
    expect(apiRequestMock.mock.calls.some(([method, url]) => method === "POST" && String(url).endsWith("/start"))).toBe(false);

    expect(screen.queryByTestId("tavus-view-feedback")).toBeNull();
    view.rerender(<TavusChatWindow scenario={scenario} persona={persona} conversationId="run-completed" onChatComplete={onChatComplete} onExit={vi.fn()} onExitMode={vi.fn()} />);
    expect(onChatComplete).toHaveBeenCalledTimes(1);
  });

  it("waits for final history after user end before opening feedback, and never ends a closed room again on exit", async () => {
    vi.useFakeTimers();
    const onChatComplete = vi.fn();
    let syncs = 0;
    let historyReady = false;
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({ available: true, evaluationAvailable: true });
      if (url.endsWith("/connection")) return response(connection);
      if (url.endsWith("/start")) return response({ ...active, evaluationAvailable: true, transcriptState: "pending" });
      if (url.endsWith("/end")) return response({ state: "ended", evaluationAvailable: true, transcriptState: "pending" });
      if (method === "POST" && url.endsWith("/sync")) {
        syncs++;
        return response({ state: "ended", evaluationAvailable: true, transcriptState: "pending" });
      }
      if (url.endsWith("/session") && syncs > 0) return response({
        state: "ended", evaluationAvailable: true, transcriptState: historyReady ? "completed" : "pending",
      });
      if (url === "/api/conversations/report-flow") return response({ messages: [] });
      return response({ state: "idle" });
    });
    let view: ReturnType<typeof render> | undefined;
    try {
      await act(async () => {
        view = render(<TavusChatWindow autoStart scenario={scenario} persona={persona} conversationId="report-flow" onChatComplete={onChatComplete} onExit={vi.fn()} onExitMode={vi.fn()} />);
      });
      await act(async () => { fireEvent.click(screen.getByTestId("button-live-avatar-microphone")); });
      expect(screen.getByTestId("mock-daily-room")).toBeTruthy();
      expect(onChatComplete).not.toHaveBeenCalled();
      expect(syncs).toBe(0);
      expect(screen.getByTestId("tavus-end").textContent).toContain("Finish conversation and generate report");
      await act(async () => { fireEvent.click(screen.getByTestId("tavus-end")); });
      expect(screen.getByTestId("feedback-transition-overlay")).toBeTruthy();
      expect(syncs).toBe(1);
      expect(onChatComplete).not.toHaveBeenCalled();
      expect(screen.queryByTestId("tavus-transcript-retry")).toBeNull();
      historyReady = true;
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(onChatComplete).toHaveBeenCalledTimes(1);
      expect(syncs).toBe(1);
    } finally {
      view?.unmount();
      vi.useRealTimers();
    }
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
    await waitFor(() => expect(props.onChatComplete).toHaveBeenCalledTimes(1));
    expect(apiRequestMock).toHaveBeenCalledWith("GET", "/api/conversations/run-new");
    await act(async () => {
      releaseOldSync?.(response({ state: "ended", evaluationAvailable: true, transcriptState: "failed", transcriptError: "stale" }));
    });

    expect(screen.getByTestId("feedback-transition-overlay")).toBeTruthy();
    expect(props.onChatComplete).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("tavus-transcript-failed")).toBeNull();
    expect(screen.queryByText("stale")).toBeNull();
    expect(apiRequestMock.mock.calls.some(([, url]) => url === "/api/conversations/run-old")).toBe(false);
  });

  it("keeps the feedback transition visible while polling and exposes a safe retry after polling pauses", async () => {
    vi.useFakeTimers();
    const onChatComplete = vi.fn();
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({ available: true, evaluationAvailable: true });
      if (url.endsWith("/session")) return response({ state: "ended", evaluationAvailable: true, transcriptState: "pending" });
      if (method === "POST" && url.endsWith("/sync")) return response({
        state: "ended",
        evaluationAvailable: true,
        transcriptState: "pending",
      });
      return response({ state: "idle" });
    });
    let view: ReturnType<typeof render> | undefined;
    try {
      await act(async () => {
        view = render(<TavusChatWindow scenario={scenario} persona={persona} conversationId="run-pending" onChatComplete={onChatComplete} onExit={vi.fn()} onExitMode={vi.fn()} />);
      });
      expect(screen.getByTestId("feedback-transition-overlay")).toBeTruthy();
      expect(screen.queryByTestId("chat-messages")).toBeNull();
      expect(screen.queryByTestId("tavus-view-feedback")).toBeNull();
      expect(apiRequestMock.mock.calls.filter(([method, url]) => method === "POST" && url.endsWith("/sync"))).toHaveLength(1);
      expect(apiRequestMock.mock.calls.some(([, url]) => String(url) === "/api/conversations/run-pending")).toBe(false);
      await act(async () => { await vi.advanceTimersByTimeAsync(300000); });
      expect(screen.getByTestId("tavus-transcript-pending")).toBeTruthy();
      expect(screen.queryByTestId("feedback-transition-overlay")).toBeNull();
      expect(onChatComplete).not.toHaveBeenCalled();
      await act(async () => { fireEvent.click(screen.getByTestId("tavus-transcript-retry")); });
      expect(apiRequestMock.mock.calls.filter(([method, url]) => method === "POST" && String(url).endsWith("/sync"))).toHaveLength(2);
      expect(screen.getByTestId("feedback-transition-overlay")).toBeTruthy();
      expect(apiRequestMock.mock.calls.some(([method, url]) => method === "POST" && String(url).endsWith("/start"))).toBe(false);
      expect(apiRequestMock.mock.calls.some(([, url]) => String(url) === "/api/conversations/run-pending")).toBe(false);
    } finally {
      view?.unmount();
      vi.useRealTimers();
    }
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

  it("shows separate sync and history-read retries when the final transcript has no learner speech", async () => {
    let syncCount = 0;
    let readCount = 0;
    apiRequestMock.mockImplementation(async (method: string, url: string) => {
      if (url.startsWith("/api/tavus/config?")) return response({ available: true, evaluationAvailable: true });
      if (url.endsWith("/session")) return response({ state: "ended", evaluationAvailable: true });
      if (method === "POST" && url.endsWith("/sync")) {
        syncCount++;
        return syncCount === 1
          ? response({ state: "ended", evaluationAvailable: true, transcriptState: "failed", transcriptError: "router_unavailable" })
          : response({ state: "ended", evaluationAvailable: true, transcriptState: "empty" });
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

  it("removes provisional captions and loads canonical history while transitioning to feedback", async () => {
    const onChatComplete = vi.fn();
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
    render(<TavusChatWindow autoStart scenario={scenario} persona={persona} conversationId="caption-final" onChatComplete={onChatComplete} onExit={vi.fn()} onExitMode={vi.fn()} />);
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
    expect(await screen.findByTestId("feedback-transition-overlay")).toBeTruthy();
    await waitFor(() => expect(onChatComplete).toHaveBeenCalledTimes(1));
    expect(apiRequestMock).toHaveBeenCalledWith("GET", "/api/conversations/caption-final");
    await waitFor(() => expect(screen.queryByText("Unverified live draft")).toBeNull());
    expect(screen.queryByText(/Browser captions · unverified/)).toBeNull();
  });
});

describe('TavusChatWindow scenario context bar source contract', () => {
  it('uses explicit close notice and no org override summary', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(require('node:path').resolve(__dirname, '../TavusChatWindow.tsx'), 'utf8');
    expect(src).toContain('closeNotice="explicit"');
    expect(src).not.toContain('ScenarioOverrideSummary');
    expect(src).toMatch(/onClose=\{\(\) => setContextOpen\(false\)\}/);
  });
});
