// @vitest-environment happy-dom
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TopMenuPanel } from "../../client/src/components/chat/TopMenuPanel";
import { LiveAvatarChoice } from "../../client/src/components/chat/LiveAvatarChoice";

const api = vi.hoisted(() => vi.fn());
vi.mock("../../client/src/lib/queryClient", () => ({ apiRequest: api }));
vi.mock("../../client/src/components/AppHeader", () => ({ AppHeader: () => <div>Menu header</div> }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key }),
}));

function MenuHarness() {
  const [open, setOpen] = useState(false);
  return <TopMenuPanel isOpen={open} onToggle={() => setOpen(value => !value)} onClose={() => setOpen(false)}>
    <LiveAvatarChoice conversationId="conversation-1" voiceMode />
  </TopMenuPanel>;
}

afterEach(() => { cleanup(); api.mockReset(); });

describe("TopMenuPanel live avatar persistence", () => {
  it("keeps the choice mounted and does not end its session when the menu is hidden", async () => {
    api.mockImplementation(async (method: string, path: string) => ({
      json: async () => String(path).endsWith("/session")
        ? { session: null, creationUncertain: false }
        : { enabled: true, allowed: false, contractReady: false, available: false, blockers: [] },
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(<QueryClientProvider client={queryClient}><MenuHarness /></QueryClientProvider>);

    const choice = document.querySelector('[aria-label="실시간 아바타 선택"]');
    expect(choice).toBeTruthy();
    expect(choice?.closest("[inert]")).toBeTruthy();

    fireEvent.click(screen.getByTestId("button-toggle-top-menu"));
    fireEvent.click(screen.getByRole("button", { name: "실시간 아바타 옵션 보기" }));
    await screen.findByText("현재 사용할 수 없음");
    fireEvent.click(screen.getByTestId("button-toggle-top-menu"));

    await waitFor(() => expect(choice?.isConnected).toBe(true));
    expect(document.querySelector('[aria-label="실시간 아바타 선택"]')).toBe(choice);
    expect(choice?.closest("[inert]")).toBeTruthy();
    expect(api.mock.calls.some(([method, path]) => method === "POST" && String(path).endsWith("/end"))).toBe(false);
  });
});
