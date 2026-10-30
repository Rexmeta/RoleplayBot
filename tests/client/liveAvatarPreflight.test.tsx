// @vitest-environment happy-dom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
vi.mock("../../client/src/lib/queryClient", () => ({ apiRequest: vi.fn() }));
import { apiRequest } from "../../client/src/lib/queryClient";
import { LiveAvatarPreflightPanel } from "../../client/src/components/admin/LiveAvatarPreflightPanel";

const result = {
  checkedAt: "2026-01-01T00:00:00Z", projectId: "project", projectName: "Development",
  available: false, sessionCreated: false, externalMediaSent: false,
  candidate: { assetId: "11111111-1111-4111-8111-111111111111", name: "Custom one",
    providerId: "tavus", liveValidated: true, runtimeSupported: true },
  capacity: { workerReady: true, cleanupPending: 0, userRemainingSeconds: 120, globalRemainingSeconds: 240, providerCredits: "unknown" },
  missingScopes: [], blockers: ["persona_binding_unverified", "paid_media_validation_not_authorized"],
};
const mount = (configured = true) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
  <LiveAvatarPreflightPanel configured={configured} />
</QueryClientProvider>);
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("free avatar preflight control", () => {
  it("never calls upstream on mount and disables the action when unconfigured", () => {
    mount(false);
    expect((screen.getByRole("button", { name: "무료 사전 점검 실행" }) as HTMLButtonElement).disabled).toBe(true);
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("shows a diagnostic candidate without an activation/create action", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ json: async () => result } as Response);
    mount();
    fireEvent.click(screen.getByRole("button", { name: "무료 사전 점검 실행" }));
    await screen.findByRole("status");
    expect(screen.getByText(/Tavus 후보: Custom one/)).toBeTruthy();
    expect(screen.getByText(/일반 대화 라이브는 아직 사용 불가/)).toBeTruthy();
    expect(screen.getByText(/현재 이미지 hash\/version/)).toBeTruthy();
    expect(apiRequest).toHaveBeenCalledExactlyOnceWith("POST", "/api/live-avatar/runtime/preflight", {});
    expect(screen.queryByRole("button", { name: /세션 생성|시작/ })).toBeNull();
  });

  it("hides stale results during a recheck and after failure, with no automatic retry", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ json: async () => result } as Response);
    mount();
    fireEvent.click(screen.getByRole("button"));
    await screen.findByRole("status");
    let reject!: (reason: unknown) => void;
    vi.mocked(apiRequest).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    reject(new Error("upstream private detail"));
    await screen.findByRole("alert");
    expect(screen.queryByText(/Custom one/)).toBeNull();
    expect(screen.queryByText(/upstream private detail/)).toBeNull();
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it("rejects a response claiming readiness rather than showing false success", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ json: async () => ({ ...result, available: true }) } as Response);
    mount();
    fireEvent.click(screen.getByRole("button"));
    await screen.findByRole("alert");
    expect(screen.queryByRole("status")).toBeNull();
  });
});
