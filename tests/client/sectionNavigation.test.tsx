// @vitest-environment happy-dom
import React, { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileText } from "lucide-react";
import { SectionMobileNav, SectionPager, SectionSidebar, type SectionDef } from "@/components/admin/contentEditor/sectionNavigation";

const sections: SectionDef[] = [
  { id: "users", label: "사용자", description: "", group: "관리", icon: FileText },
  { id: "settings", label: "설정", description: "", group: "관리", icon: FileText },
  { id: "usage", label: "사용량", description: "", group: "조회", icon: FileText },
];
function Fixture({ disabled = false }: { disabled?: boolean }) {
  const [active, setActive] = useState("users");
  const props = { sections, active, onSelect: setActive, tabs: { idPrefix: "review", testIdPrefix: "tab-" }, disabled };
  return <>
    <SectionSidebar {...props} label="데스크톱 섹션" />
    <SectionMobileNav {...props} label="모바일 섹션" />
    <SectionPager sections={sections} active={active} onSelect={setActive} disabled={disabled} />
  </>;
}
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 1; });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("synchronizes desktop, mobile and previous/next using one section selection", () => {
  render(<Fixture />);
  expect((screen.getByTestId("section-prev") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByTestId("section-next"));
  expect(screen.getByTestId("tab-settings").getAttribute("aria-selected")).toBe("true");
  expect(screen.getByTestId("mobile-tab-settings").getAttribute("aria-selected")).toBe("true");
  fireEvent.click(screen.getByTestId("mobile-tab-usage"));
  expect(screen.getByTestId("tab-usage").getAttribute("aria-selected")).toBe("true");
  expect((screen.getByTestId("section-next") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByTestId("section-prev"));
  expect(screen.getByTestId("tab-settings").getAttribute("aria-selected")).toBe("true");
});

it("supports arrow and home/end keys with one tab stop per navigation", () => {
  render(<Fixture />);
  const desktop = screen.getByRole("tablist", { name: "데스크톱 섹션" });
  const first = within(desktop).getByRole("tab", { name: "사용자" });
  first.focus();
  fireEvent.keyDown(first, { key: "ArrowDown" });
  expect(screen.getByTestId("tab-settings").getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(screen.getByTestId("tab-settings"));
  fireEvent.keyDown(document.activeElement!, { key: "End" });
  expect(document.activeElement).toBe(screen.getByTestId("tab-usage"));
  fireEvent.keyDown(document.activeElement!, { key: "Home" });
  expect(document.activeElement).toBe(first);
  expect(within(desktop).getAllByRole("tab").filter(tab => tab.tabIndex === 0)).toHaveLength(1);
});

it("links distinct desktop/mobile tabs to the same panel without duplicate ids", () => {
  render(<Fixture />);
  const desktop = screen.getByTestId("tab-users");
  const mobile = screen.getByTestId("mobile-tab-users");
  expect(desktop.id).not.toBe(mobile.id);
  expect(desktop.getAttribute("aria-controls")).toBe("review-panel-users");
  expect(mobile.getAttribute("aria-controls")).toBe(desktop.getAttribute("aria-controls"));
});

it("disables navigation and the pager while saving", () => {
  render(<Fixture disabled />);
  for (const tab of screen.getAllByRole("tab")) expect((tab as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByTestId("section-next"));
  expect(screen.getByTestId("tab-users").getAttribute("aria-selected")).toBe("true");
});
