// @vitest-environment happy-dom
import React, { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileText } from "lucide-react";
import { AdminWorkspace, WorkspacePanel, type WorkspaceSectionDef } from "@/components/admin/contentEditor/AdminWorkspace";
const close = vi.fn();
const discard = vi.fn();
const sections: WorkspaceSectionDef[] = [
  { id: "one", label: "첫 번째", group: "관리", description: "첫 화면", icon: FileText },
  { id: "two", label: "두 번째", group: "관리", description: "다음 화면", icon: FileText },
];
function Fixture({ pending = false }: { pending?: boolean }) {
  const [active, setActive] = useState("one");
  const [dirty, setDirty] = useState(false);
  return <AdminWorkspace title="관리 화면" breadcrumb="관리" sections={sections} active={active}
    onActiveChange={setActive} onClose={close} dirty={dirty} pending={pending} keepVisited
    onDiscard={id => { discard(id); setDirty(false); }}>
    <WorkspacePanel id="one"><input aria-label="초안" defaultValue="원본" onChange={() => setDirty(true)} /></WorkspacePanel>
    <WorkspacePanel id="two"><div>다음 섹션 내용</div></WorkspacePanel>
  </AdminWorkspace>;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 1; });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("keeps workspace actions below the independently sticky app header", () => {
  let appHeight = 76;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { x: 0, y: 0, top: 0, left: 0, right: 390, bottom: 80, width: 390,
      height: this.hasAttribute("data-app-header") ? appHeight : 80, toJSON: () => ({}) };
  });
  render(<><header data-app-header style={{ position: "sticky" }}>앱 헤더</header><Fixture /></>);
  const root = document.querySelector<HTMLElement>(".admin-workspace")!;
  expect(root.style.getPropertyValue("--workspace-app-header-height")).toBe("76px");
  expect(root.style.scrollMarginTop).toBe("76px");
  appHeight = 100;
  fireEvent(window, new Event("resize"));
  expect(root.style.getPropertyValue("--workspace-app-header-height")).toBe("100px");
});

it("mounts expensive panels lazily and keeps already visited panels", () => {
  render(<Fixture />);
  expect(screen.queryByText("다음 섹션 내용")).toBeNull();
  fireEvent.click(screen.getByTestId("section-next"));
  expect(screen.getByText("다음 섹션 내용")).toBeTruthy();
  expect(screen.getByLabelText("초안").closest('[role="tabpanel"]')?.hasAttribute("hidden")).toBe(true);
  expect(screen.queryByRole("button", { name: "저장", exact: true })).toBeNull();
});

it("keeps drafts on cancel and resets only after an explicit discard", () => {
  render(<Fixture />);
  fireEvent.change(screen.getByLabelText("초안"), { target: { value: "미저장 초안" } });
  fireEvent.click(screen.getByTestId("section-next"));
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  fireEvent.click(screen.getByTestId("leave-cancel"));
  expect((screen.getByLabelText("초안") as HTMLInputElement).value).toBe("미저장 초안");
  fireEvent.click(screen.getByTestId("mobile-tab-two"));
  fireEvent.click(screen.getByTestId("leave-confirm"));
  expect(discard).toHaveBeenCalledWith("one");
  fireEvent.click(screen.getByTestId("section-prev"));
  expect((screen.getByLabelText("초안") as HTMLInputElement).value).toBe("원본");
});

it("guards closing and browser unload while drafts remain", () => {
  render(<Fixture />);
  fireEvent.change(screen.getByLabelText("초안"), { target: { value: "변경" } });
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByTestId("workspace-close"));
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("leave-confirm"));
  expect(close).toHaveBeenCalledOnce();
});

it("blocks section changes and close during a save", () => {
  render(<Fixture pending />);
  for (const id of ["workspace-close", "section-next", "section-prev", "tab-two", "mobile-tab-two"]) {
    expect((screen.getByTestId(id) as HTMLButtonElement).disabled).toBe(true);
  }
  fireEvent.keyDown(screen.getByTestId("tab-one"), { key: "ArrowDown" });
  expect(screen.getByTestId("tab-one").getAttribute("aria-selected")).toBe("true");
  expect(close).not.toHaveBeenCalled();
});
