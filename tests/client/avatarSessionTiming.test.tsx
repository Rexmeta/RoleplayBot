// @vitest-environment happy-dom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AvatarSessionTiming } from "../../client/src/components/chat/AvatarSessionTiming";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ i18n: { language: "ko" } }) }));
afterEach(cleanup);
it("does not infer playback for missing or historical reports", () => {
  const { rerender } = render(<AvatarSessionTiming />);
  expect(screen.getByText(/영상 보고 없음/)).toBeTruthy();
  rerender(<AvatarSessionTiming timing={{ routerElapsedSeconds: 600, clientVideoReportedAt: null,
    preparationSeconds: null, connectedSeconds: null, evidence: "not_reported" }} />);
  expect(screen.getByText("10:00")).toBeTruthy();
  expect(screen.getAllByText("—")).toHaveLength(2);
});
it("renders server times without a wall-clock increment and warns separately on report failure", () => {
  vi.useFakeTimers();
  const timing = { routerElapsedSeconds: 26, clientVideoReportedAt: "2026-11-13T00:00:09Z",
    preparationSeconds: 9, connectedSeconds: 17, evidence: "authenticated_client_report" as const };
  const { rerender } = render(<AvatarSessionTiming timing={timing} reportFailed />);
  expect(screen.getByText("0:09")).toBeTruthy();
  expect(screen.getByText("0:17")).toBeTruthy();
  expect(screen.getByText(/청구 시간이 아닙니다/)).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("재생은 유지");
  vi.advanceTimersByTime(60000);
  rerender(<AvatarSessionTiming timing={timing} />);
  expect(screen.getByText("0:17")).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
  vi.useRealTimers();
});
