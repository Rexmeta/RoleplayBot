// @vitest-environment happy-dom
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const state = vi.hoisted(() => ({
  feedback: undefined as any,
  retry: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }) =>
      typeof fallback === "string" ? fallback : fallback?.defaultValue ?? key,
  }),
}));
vi.mock("wouter", () => ({
  useRoute: () => [true, { conversationId: "run-1" }],
  useLocation: () => ["/feedback/run-1", vi.fn()],
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1", role: "user" } }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: any) => {
    if (queryKey[0] === "/api/conversations") {
      return {
        data: {
          id: "run-1",
          userId: "user-1",
          scenarioId: "scenario-1",
          personaId: "persona-1",
        },
        isLoading: false,
      };
    }
    if (queryKey[0] === "/api/scenarios") {
      return {
        data: {
          id: "scenario-1",
          personas: [{ id: "persona-1", name: "Persona" }],
        },
        isLoading: false,
        isError: false,
      };
    }
    return { data: undefined, isLoading: false };
  },
  useMutation: () => ({ mutate: state.retry, isPending: false }),
}));
vi.mock("@/lib/feedbackQuery", () => ({
  useFeedbackQuery: () => ({ data: state.feedback }),
  isFeedbackPending: (result: any) =>
    result?.status === "queued" || result?.status === "generating",
  feedbackQueryKey: (id: string) => ["/api/conversations", id, "feedback"],
}));
vi.mock("@/lib/queryClient", () => ({
  queryClient: { setQueryData: vi.fn() },
}));
vi.mock("@/components/PersonalDevelopmentReport", () => ({
  default: () => <div>completed report</div>,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children }: any) => <button>{children}</button>,
  TabsContent: ({ children }: any) => <div>{children}</div>,
}));

import FeedbackView from "../../client/src/pages/FeedbackView";

describe("FeedbackView durable status transitions", () => {
  beforeEach(() => {
    state.feedback = undefined;
    state.retry.mockClear();
  });

  it("rerenders through loading, pending, completed, error, and retry without changing hook order", () => {
    const view = render(<FeedbackView />);
    expect(screen.getByText("completed report")).toBeTruthy();

    state.feedback = { status: "queued" };
    expect(() => view.rerender(<FeedbackView />)).not.toThrow();
    expect(screen.getByText("feedback.loading")).toBeTruthy();

    state.feedback = { status: "generating" };
    expect(() => view.rerender(<FeedbackView />)).not.toThrow();

    state.feedback = { status: "completed" };
    expect(() => view.rerender(<FeedbackView />)).not.toThrow();
    expect(screen.getByText("completed report")).toBeTruthy();

    state.feedback = { status: "expired", message: "expired feedback" };
    expect(() => view.rerender(<FeedbackView />)).not.toThrow();
    expect(screen.getByText("expired feedback")).toBeTruthy();
    screen.getByText("다시 시도").click();
    expect(state.retry).toHaveBeenCalledOnce();
  });
});