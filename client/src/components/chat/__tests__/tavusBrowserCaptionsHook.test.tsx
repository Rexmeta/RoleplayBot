// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useBrowserCaptions, type BrowserCaption } from "../tavusBrowserCaptions";

afterEach(cleanup);
const caption = (id = "one", message = "첫 발화"): BrowserCaption => ({
  id, sender: "user", message, timestamp: "2026-11-05T10:00:00.000Z", interrupted: false,
});
describe("session-local provisional caption state", () => {
  it("replaces cumulative text in place and retains captions until navigation", () => {
    const { result } = renderHook(() => useBrowserCaptions("run-a"));
    act(() => result.current.onCaption(caption()));
    act(() => result.current.onCaption(caption("one", "첫 발화를 마쳤습니다")));
    expect(result.current.captions).toHaveLength(1);
    expect(result.current.captions[0].message).toBe("첫 발화를 마쳤습니다");
  });
  it("clears across conversations and ignores delayed callbacks from the previous conversation", () => {
    const { result, rerender, unmount } = renderHook(({ id }) => useBrowserCaptions(id), { initialProps: { id: "run-a" } });
    const stale = result.current.onCaption;
    act(() => stale(caption()));
    rerender({ id: "run-b" });
    expect(result.current.captions).toEqual([]);
    act(() => stale(caption("stale")));
    expect(result.current.captions).toEqual([]);
    const current = result.current.onCaption;
    act(() => current(caption("new")));
    expect(result.current.captions.map(row => row.id)).toEqual(["new"]);
    unmount();
    act(() => current(caption("after-unmount")));
  });
  it("bounds memory rather than retaining an unlimited browser transcript", () => {
    const { result } = renderHook(() => useBrowserCaptions("run-a"));
    act(() => {
      for (let index = 0; index < 520; index++) result.current.onCaption(caption(String(index)));
    });
    expect(result.current.captions).toHaveLength(500);
    expect(result.current.captions[0].id).toBe("20");
  });
});
