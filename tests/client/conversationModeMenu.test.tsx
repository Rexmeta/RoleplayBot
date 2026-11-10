// @vitest-environment happy-dom
import React, { useState } from "react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChatInputBar } from "../../client/src/components/chat/ChatInputBar";
import { ConversationModeMenu } from "../../client/src/components/chat/ConversationModeMenu";
import { LiveAvatarOptionsDialog } from "../../client/src/components/chat/LiveAvatarOptionsDialog";
import { LiveAvatarChoice } from "../../client/src/components/chat/LiveAvatarChoice";

const api = vi.hoisted(() => vi.fn());
vi.mock("../../client/src/lib/queryClient", () => ({ apiRequest: api }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key }),
}));
vi.mock("../../client/src/components/admin/avatarTest/useAvatarTestRoom", () => {
  const room = {
    connecting: false, mediaConnected: false, videoTrack: null, audioBlocked: false,
    audioPlaybackReady: false, disconnectMedia: vi.fn(), startAudio: vi.fn(),
    videoHost: { current: null }, audioHost: { current: null },
  };
  return { useAvatarTestRoom: () => room };
});

const baseProps = {
  userInput: "", onUserInputChange: vi.fn(), onSendMessage: vi.fn(),
  onVoiceInput: vi.fn(), onSkipTurn: vi.fn(), isLoading: false,
  isRecording: false, speechSupported: true, mode: "realtime-voice" as const,
};
const voiceProps = {
  status: "connected", isRecording: false, isAISpeaking: false,
  isWaitingForGreeting: false, greetingFailed: false, greetingRetryCount: 0,
  conversationPhase: "active", showMicPrompt: false, onConnect: vi.fn(),
  onStartRecording: vi.fn(), onStopRecording: vi.fn(), onEndConversation: vi.fn(),
};

beforeEach(() => {
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function () {
    this.open = true;
  });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function () {
    this.open = false;
  });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  api.mockReset();
});

describe("optional bottom conversation modes", () => {
  it.each(["connected", "disconnected"])("offers text and live avatar without auto-switching in %s voice", async status => {
    const text = vi.fn();
    const live = vi.fn();
    render(<ChatInputBar {...baseProps} realtimeVoiceProps={{ ...voiceProps, status }}
      onTextModeToggle={text} onLiveAvatarOptions={live} />);
    expect(screen.queryByTestId("panel-conversation-mode-menu")).toBeNull();
    expect(text).not.toHaveBeenCalled();
    expect(live).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("button-conversation-mode-menu"));
    expect(await screen.findByTestId("button-conversation-mode-live-avatar")).toBeTruthy();
    fireEvent.click(screen.getByTestId("button-conversation-mode-text"));
    expect(text).toHaveBeenCalledOnce();
    expect(live).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId("panel-conversation-mode-menu")).toBeNull());
  });

  it("disables unavailable avatars but leaves text selection usable", async () => {
    render(<ConversationModeMenu onTextModeToggle={vi.fn()} />);
    fireEvent.click(screen.getByTestId("button-conversation-mode-menu"));
    expect((await screen.findByTestId("button-conversation-mode-live-avatar") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("text-live-avatar-unavailable")).toBeTruthy();
    expect((screen.getByTestId("button-conversation-mode-text") as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps live settings accessible while AI is speaking without allowing a text switch", async () => {
    const live = vi.fn();
    render(<ChatInputBar {...baseProps} realtimeVoiceProps={{ ...voiceProps, isAISpeaking: true }}
      onTextModeToggle={vi.fn()} onLiveAvatarOptions={live} />);
    fireEvent.click(screen.getByTestId("button-conversation-mode-menu"));
    expect((await screen.findByTestId("button-conversation-mode-text") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("button-conversation-mode-live-avatar"));
    expect(live).toHaveBeenCalledOnce();
  });

  it("moves the live choice out of the upper hidden bar in the actual chat", () => {
    const source = readFileSync("client/src/components/ChatWindow.tsx", "utf8");
    const topBar = source.slice(source.indexOf("<TopMenuPanel"), source.indexOf("</TopMenuPanel>"));
    expect(topBar).not.toContain("LiveAvatarChoice");
    expect(source).toContain("<LiveAvatarOptionsDialog");
    expect(source).toContain("onLiveAvatarOptions={liveAvatarSelection.data?.configured ? openLiveAvatarOptions : undefined}");
    expect(source).toContain("setLiveAvatarOptionsOpen(true)");
  });

  it("opens consent from the bottom and keeps a created session mounted when settings close", async () => {
    api.mockImplementation(async (method: string, path: string) => ({
      json: async () => path.endsWith("/session")
        ? { session: null, creationUncertain: false }
        : method === "POST" && path.endsWith("/sessions")
          ? { id: "session", providerId: "tavus", avatarId: "tavus-stock-lucy", mode: "live",
            status: "active", rendererState: "starting", cleanupPending: false, stopRequested: false,
            expiresAt: new Date(Date.now() + 60_000).toISOString() }
          : { enabled: true, allowed: true, contractReady: true, available: true, blockers: [] },
    }));
    function Harness() {
      const [open, setOpen] = useState(false);
      const [request, setRequest] = useState(0);
      return <>
        <ChatInputBar {...baseProps} realtimeVoiceProps={voiceProps} onTextModeToggle={vi.fn()}
          onLiveAvatarOptions={() => { setOpen(true); setRequest(n => n + 1); }} />
        <LiveAvatarOptionsDialog open={open} onClose={() => setOpen(false)}>
          <LiveAvatarChoice conversationId="bottom-1" voiceMode optionsRequest={request} />
        </LiveAvatarOptionsDialog>
      </>;
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);
    fireEvent.click(screen.getByTestId("button-conversation-mode-menu"));
    fireEvent.click(await screen.findByTestId("button-conversation-mode-live-avatar"));
    const dialog = screen.getByTestId("live-avatar-options-dialog") as HTMLDialogElement;
    await waitFor(() => expect(dialog.open).toBe(true));
    await screen.findByText("사용 가능");
    expect(api.mock.calls.some(([method]) => method === "POST")).toBe(false);
    fireEvent.click(screen.getByRole("checkbox"));
    const start = screen.getByRole("button", { name: "실시간 아바타 시작" });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(start);
    await waitFor(() => expect(api).toHaveBeenCalledWith("POST",
      "/api/live-avatar/conversations/bottom-1/sessions", { service: "avatar-router", consent: true }));
    await screen.findByRole("button", { name: "실시간 아바타 종료" });
    const choice = dialog.querySelector('[aria-label="실시간 아바타 선택"]');
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    await waitFor(() => expect(dialog.open).toBe(false));
    expect(choice?.isConnected).toBe(true);
    expect(api.mock.calls.some(([method, path]) => method === "POST" && path.endsWith("/end"))).toBe(false);
    fireEvent.click(screen.getByTestId("button-conversation-mode-menu"));
    fireEvent.click(await screen.findByTestId("button-conversation-mode-live-avatar"));
    await waitFor(() => expect(dialog.open).toBe(true));
    expect(dialog.querySelector('[aria-label="실시간 아바타 선택"]')).toBe(choice);
    expect(api.mock.calls.filter(([method, path]) => method === "POST" && path.endsWith("/sessions"))).toHaveLength(1);
  });
});
