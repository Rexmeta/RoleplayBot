// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ api: vi.fn(), hook: vi.fn(), state: {} as any }));
vi.mock("../../client/src/lib/queryClient", () => ({ apiRequest: mocks.api }));
vi.mock("../../client/src/components/admin/avatarTest/useAdminAvatarTest", () => ({
  useAdminAvatarTest: (endpoint: string) => { mocks.hook(endpoint); return mocks.state; },
}));
vi.mock("../../client/src/components/admin/avatarTest/AvatarTestPreflightView", () => ({
  AvatarTestPreflightView: () => <button>아바타 연결</button>,
}));
vi.mock("../../client/src/components/admin/avatarTest/AvatarTestSessionView", () => ({
  AvatarTestSessionView: () => <div data-testid="connected-room" />,
}));
import { PersonaAvatarValidationPanel } from "../../client/src/components/admin/PersonaAvatarValidationPanel";
const assetId = "12345678-1234-4234-8234-123456789abc";
beforeEach(() => {
  mocks.api.mockReset(); mocks.hook.mockClear();
  mocks.state = { session: null, creating: false, stopping: false, terminal: false };
});
afterEach(cleanup);
describe("custom avatar connection without application playback certification", () => {
  it("only presents connection controls and never requests a playback report", () => {
    render(<PersonaAvatarValidationPanel assetId={assetId} assetName="선택 인물" />);
    expect(screen.getByRole("button", { name: "아바타 연결" })).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "재생 확인 보고" })).toBeNull();
    expect(mocks.hook).toHaveBeenCalledWith(`/api/admin/personas/live-avatar/assets/${assetId}/validation`);
    expect(mocks.api).not.toHaveBeenCalled();
  });
  it("shows a connected room without requiring frames, successful turns or operator verification", () => {
    mocks.state.session = { id: "session" };
    const activity = vi.fn(), reported = vi.fn();
    render(<PersonaAvatarValidationPanel assetId={assetId} assetName="선택 인물" onActivityChange={activity} onReported={reported} />);
    expect(screen.getByTestId("connected-room")).toBeTruthy();
    expect(activity).toHaveBeenCalledWith(true);
    expect(reported).not.toHaveBeenCalled();
    expect(mocks.api).not.toHaveBeenCalled();
  });
});
