// @vitest-environment happy-dom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import GuestDemoPage from "../../client/src/pages/GuestDemoPage";
import { guestDemoRequest, GuestDemoError } from "../../client/src/lib/guestDemo";
import en from "../../client/src/locales/en.json";

const login = vi.hoisted(() => vi.fn(async () => ({ success: true })));
vi.mock("../../client/src/hooks/useAuth", () => ({ useAuth: () => ({ guestLogin: login }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({
  t: (key: string, options: Record<string, unknown> = {}) => {
    let copy: any = en;
    for (const part of key.split(".")) copy = copy?.[part];
    return String(copy ?? options.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_match, token) => String(options[token]));
  },
}) }));
vi.mock("../../client/src/lib/guestDemo", async importOriginal => ({
  ...await importOriginal<typeof import("../../client/src/lib/guestDemo")>(), guestDemoRequest: vi.fn(),
}));

const api = vi.mocked(guestDemoRequest);
const scenario = { id: "demo", title: "A new workplace", description: "Practice asking for help.", situation: "You are new.", partner: { name: "Sam", role: "Team lead" } };
const initial = { scenario, turnLimit: 1, turns: 0, messages: [] };

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { hook } = memoryLocation({ path: "/guest-demo" });
  return render(<QueryClientProvider client={client}><Router hook={hook}><GuestDemoPage /></Router></QueryClientProvider>);
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("renders public demos, sends a message, and links to registration after completing the trial", async () => {
  api.mockResolvedValueOnce({ scenarios: [scenario], progress: null });
  api.mockResolvedValueOnce(initial);
  api.mockResolvedValueOnce({ ...initial, turns: 1, messages: [
    { sender: "user", message: "Could you help me?", timestamp: "2026-11-21T00:00:00Z" },
    { sender: "ai", message: "Of course. What do you need?", timestamp: "2026-11-21T00:00:01Z" },
  ] });
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Start trial" }));
  expect(api).toHaveBeenCalledWith("/api/guest/demo/scenario", { scenarioId: "demo" });
  fireEvent.change(await screen.findByRole("textbox", { name: "Message" }), { target: { value: "Could you help me?" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByText("Of course. What do you need?")).toBeTruthy();
  expect(api).toHaveBeenCalledWith("/api/guest/demo/message", { message: "Could you help me?", turns: 0 });
  expect(screen.getByRole("link", { name: "Register Now" }).getAttribute("href")).toBe("/auth?mode=register");
});

it("lets a direct visitor start an anonymous trial without sending them to registration", async () => {
  api.mockRejectedValueOnce(new GuestDemoError("guest_session_required"));
  api.mockResolvedValueOnce({ scenarios: [scenario], progress: null });
  show();
  fireEvent.click(await screen.findByRole("button", { name: en.auth.guestLogin }));
  expect(await screen.findByText(scenario.title)).toBeTruthy();
  expect(login).toHaveBeenCalledOnce();
});
