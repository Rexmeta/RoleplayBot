// @vitest-environment happy-dom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LiveAvatarEntry, useLiveAvatarSelection } from "../../client/src/components/chat/LiveAvatarEntry";

const api = vi.hoisted(() => vi.fn());
vi.mock("../../client/src/lib/queryClient", () => ({ apiRequest: api }));
afterEach(() => { cleanup(); api.mockReset(); });
function Harness({ actorId }: { actorId: string }) {
  const query = useLiveAvatarSelection("conversation", actorId);
  const selectable = !query.isFetching && !query.isError && query.data?.configured &&
    query.data?.personaId === actorId;
  return <>
    {selectable && <button>Live choice</button>}
    <LiveAvatarEntry conversationId="conversation" actorId={actorId} optionsOpen={false}
      onOpenOptions={vi.fn()} playbackState="playing" />
  </>;
}
function setup(actorId: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const ui = (id: string) => <QueryClientProvider client={client}><Harness actorId={id} /></QueryClientProvider>;
  return { ...render(ui(actorId)), ui };
}
const selection = (personaId: string, configured = true) => ({ configured, personaId, enabled: true, allowed: true, blockers: [] });
describe("persona-bound avatar discovery", () => {
  it.each(["first", "live", "third"])("only offers live on the assigned persona %s", async actorId => {
    api.mockResolvedValue({ json: async () => selection(actorId, actorId === "live") });
    setup(actorId);
    await waitFor(() => expect(api).toHaveBeenCalledWith("GET",
      `/api/live-avatar/conversations/conversation/selection?actorId=${actorId}`));
    await act(async () => {});
    expect(Boolean(screen.queryByText("Live choice"))).toBe(actorId === "live");
    expect(Boolean(screen.queryByRole("button", { name: "라이브 아바타 옵션 열기" }))).toBe(actorId === "live");
  });
  it("ignores a late response from the previous persona and hides while checking", async () => {
    let resolveFirst!: (value: unknown) => void;
    api.mockImplementation((_method: string, path: string) => path.endsWith("actorId=live")
      ? new Promise(resolve => { resolveFirst = resolve; })
      : Promise.resolve({ json: async () => selection("third", false) }));
    const view = setup("live");
    expect(screen.queryByText("Live choice")).toBeNull();
    view.rerender(view.ui("third"));
    await act(async () => { resolveFirst({ json: async () => selection("live") }); });
    await waitFor(() => expect(api).toHaveBeenCalledWith("GET",
      "/api/live-avatar/conversations/conversation/selection?actorId=third"));
    expect(screen.queryByText("Live choice")).toBeNull();
    expect(screen.queryByRole("button", { name: "라이브 아바타 옵션 열기" })).toBeNull();
  });
  it("hides a configured response whose target does not match the visible actor", async () => {
    api.mockResolvedValue({ json: async () => selection("live") });
    setup("third");
    await act(async () => {});
    expect(screen.queryByText("Live choice")).toBeNull();
    expect(screen.queryByRole("button", { name: "라이브 아바타 옵션 열기" })).toBeNull();
  });
});
