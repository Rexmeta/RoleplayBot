// @vitest-environment happy-dom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CultureProfileComparisonTray } from "@/components/admin/cultureMap/CultureProfileComparisonTray";
import { emptyCultureProfile } from "@/components/admin/cultureMap/CultureProfileForm";

const profile = {
  ...emptyCultureProfile(), id: "profile", name: "아주 긴 문화 프로필 이름 ".repeat(8),
  ownerId: "admin", version: 1, createdAt: "", updatedAt: "",
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Culture comparison tray bottom-space measurement", () => {
  it("measures actual height and reports wrapped-content resizing without introducing a vertical scroller", () => {
    let resize = () => {};
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resize = callback; }
      observe = observe;
      disconnect = disconnect;
    });
    const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 187.2 } as DOMRect);
    const onHeightChange = vi.fn();
    const view = render(<CultureProfileComparisonTray profiles={[profile]} onHeightChange={onHeightChange} onRemove={vi.fn()} onClear={vi.fn()} onCompare={vi.fn()} />);
    const tray = screen.getByRole("complementary", { name: "비교할 프로필 선택함" });
    expect(observe).toHaveBeenCalledWith(tray);
    expect(onHeightChange).toHaveBeenLastCalledWith(188);
    measure.mockReturnValue({ height: 384 } as DOMRect);
    act(() => resize());
    expect(onHeightChange).toHaveBeenLastCalledWith(384);
    expect(tray.className).toContain("bottom-0");
    expect(tray.className).toContain("safe-area-inset-bottom");
    expect(tray.className).not.toMatch(/max-h-|overflow-y-|overscroll-/);
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("keeps measuring on window resize when ResizeObserver is unavailable and cleans up the fallback", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 160 } as DOMRect);
    const onHeightChange = vi.fn();
    const view = render(<CultureProfileComparisonTray profiles={[profile]} onHeightChange={onHeightChange} onRemove={vi.fn()} onClear={vi.fn()} onCompare={vi.fn()} />);
    expect(onHeightChange).toHaveBeenLastCalledWith(160);
    measure.mockReturnValue({ height: 300 } as DOMRect);
    fireEvent(window, new Event("resize"));
    expect(onHeightChange).toHaveBeenLastCalledWith(300);
    view.unmount();
    const count = onHeightChange.mock.calls.length;
    fireEvent(window, new Event("resize"));
    expect(onHeightChange).toHaveBeenCalledTimes(count);
  });
});
