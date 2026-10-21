// @vitest-environment happy-dom
import React, { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { authState, experimentMount, experimentUnmount, startExperiment } = vi.hoisted(() => ({
  authState: { user: { role: "admin" } },
  experimentMount: vi.fn(),
  experimentUnmount: vi.fn(),
  startExperiment: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => authState }));
vi.mock("@/components/admin/cultureMap/CultureProfilesManager", () => ({
  CultureProfilesManager: () => {
    const [draft, setDraft] = useState("");
    return <input aria-label="작성 중인 프로필" value={draft} onChange={event => setDraft(event.target.value)} />;
  },
}));
vi.mock("@/components/admin/cultureMap/CultureBehaviorExperiment", () => ({
  CultureBehaviorExperiment: () => {
    const [result, setResult] = useState("");
    useEffect(() => { experimentMount(); return () => { experimentUnmount(); }; }, []);
    return <div><button onClick={() => { startExperiment(); setResult("실험 결과 보존"); }}>실험 시작 테스트</button>{result}</div>;
  },
}));
import { CultureMapWorkspace } from "@/components/admin/cultureMap/CultureMapWorkspace";

describe("Culture Map workspace navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { role: "admin" };
  });
  afterEach(cleanup);

  it("makes both features discoverable and preserves drafts and results without auto-running", async () => {
    const user = userEvent.setup();
    render(<CultureMapWorkspace />);
    expect(screen.getByRole("tab", { name: /프로필 관리/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: /문화 행동 실험/ }).textContent).toContain("비용");
    await user.type(screen.getByLabelText("작성 중인 프로필"), "작성 중");
    await user.click(screen.getByRole("tab", { name: /문화 행동 실험/ }));
    expect(startExperiment).not.toHaveBeenCalled();
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "실험 시작 테스트" }));
    await user.click(screen.getByRole("tab", { name: /프로필 관리/ }));
    expect((screen.getByLabelText("작성 중인 프로필") as HTMLInputElement).value).toBe("작성 중");
    await user.click(screen.getByRole("tab", { name: /문화 행동 실험/ }));
    expect(screen.getByText("실험 결과 보존")).toBeTruthy();
    expect(experimentMount).toHaveBeenCalledTimes(1);
    expect(experimentUnmount).not.toHaveBeenCalled();
    expect(startExperiment).toHaveBeenCalledTimes(1);
  });

  it("supports arrow-key navigation between feature tabs", async () => {
    const user = userEvent.setup();
    render(<CultureMapWorkspace />);
    screen.getByRole("tab", { name: /프로필 관리/ }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: /문화 행동 실험/ }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: /문화 행동 실험/ }));
  });

  it("does not expose or mount experiments for non-admins and recovers after a role change", async () => {
    const user = userEvent.setup();
    const view = render(<CultureMapWorkspace />);
    await user.click(screen.getByRole("tab", { name: /문화 행동 실험/ }));
    authState.user = { role: "operator" };
    view.rerender(<CultureMapWorkspace />);
    expect(screen.queryByRole("tab", { name: /문화 행동 실험/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "실험 시작 테스트", hidden: true })).toBeNull();
    expect(screen.getByRole("tab", { name: /프로필 관리/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText("작성 중인 프로필")).toBeTruthy();
    expect(experimentUnmount).toHaveBeenCalledTimes(1);
    cleanup();
    experimentMount.mockClear();
    render(<CultureMapWorkspace />);
    expect(experimentMount).not.toHaveBeenCalled();
  });
});
