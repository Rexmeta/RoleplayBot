// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RecognitionReview, type Evidence } from "@/components/chat/RecognitionReview";
import { readFileSync } from "node:fs";

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: api }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/components/chat/PersonaSwitchCard", () => ({
  PersonaSwitchCard: () => <div data-testid="persona-switch" />,
}));

const key = ["/api/conversations", "run", "voice-recognition"];
let rows: Evidence[];
let messages: any[];
let client: QueryClient;
const response = (value: unknown) => ({ json: async () => structuredClone(value) });
beforeEach(() => {
  rows = ["one", "two"].map((id, i) => ({
    id, revision: i + 1, status: "needs_confirmation", providerText: `원문 ${i + 1}`,
    candidateText: `별도 후보 ${i + 1}`, canonicalText: null, reason: null, language: "ko",
    createdAt: `2026-11-12T00:00:0${i * 2}Z`,
  }));
  messages = [
    { sender: "user", voiceTurnId: "one", message: "원문 1", timestamp: "2026-11-12T00:00:00Z" },
    { sender: "ai", message: "AI 응답", timestamp: "2026-11-12T00:00:01Z" },
    { sender: "user", voiceTurnId: "two", message: "원문 2", timestamp: "2026-11-12T00:00:02Z" },
  ];
  api.mockReset();
  api.mockImplementation(async (method: string, path: string, body?: any) => {
    if (method === "GET" && path.endsWith("/voice-recognition")) return response(rows);
    if (method === "GET" && path === "/api/conversations/run") return response({ messages });
    if (method === "POST" && path.endsWith("/confirm")) {
      const id = path.split("/").at(-2)!;
      const index = rows.findIndex(row => row.id === id);
      if (rows[index].revision !== body.revision) throw new Error("409: voice_revision_conflict");
      rows[index] = { ...rows[index], status: "confirmed", revision: body.revision + 1, canonicalText: body.text };
      return response(rows[index]);
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => { cleanup(); client.clear(); });

function view(onSubmitted = vi.fn()) {
  render(<QueryClientProvider client={client}>
    <RecognitionReview runId="run" personaName="김 팀장" onSubmitted={onSubmitted} />
  </QueryClientProvider>);
  return onSubmitted;
}
const posts = () => api.mock.calls.filter(([method]) => method === "POST");

describe("inline transcript correction before feedback", () => {
  it("edits the existing bubbles once, leaves AI read-only, and submits all turns with one click", async () => {
    const feedback = view();
    const first = await screen.findByTestId("recognition-edit-one");
    const second = screen.getByTestId("recognition-edit-two");
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    expect((first as HTMLTextAreaElement).value).toBe("원문 1");
    expect(screen.getByText("AI 응답")).toBeTruthy();
    expect(screen.queryByText(/Live 원문|원음 기반 STT 후보|이 발화 내용 확인/)).toBeNull();
    expect(posts()).toHaveLength(0);
    fireEvent.change(first, { target: { value: "수정된 첫 발화" } });
    fireEvent.change(second, { target: { value: "수정된 둘째 발화" } });
    fireEvent.click(screen.getByTestId("submit-recognition-review"));
    await waitFor(() => expect(feedback).toHaveBeenCalledOnce());
    expect(posts().map(([, path, body]) => ({ path, body }))).toEqual([
      { path: "/api/conversations/run/voice-recognition/one/confirm", body: { revision: 1, text: "수정된 첫 발화" } },
      { path: "/api/conversations/run/voice-recognition/two/confirm", body: { revision: 2, text: "수정된 둘째 발화" } },
    ]);
    expect(rows.every(row => row.status === "confirmed")).toBe(true);
  });

  it("keeps drafts after polling updates and does not make confirmations for blank edits", async () => {
    view();
    const first = await screen.findByTestId("recognition-edit-one");
    fireEvent.change(first, { target: { value: "내가 수정한 내용" } });
    act(() => client.setQueryData(key, rows.map(row => ({ ...row, candidateText: "갱신된 STT" }))));
    expect((screen.getByTestId("recognition-edit-one") as HTMLTextAreaElement).value).toBe("내가 수정한 내용");
    fireEvent.change(first, { target: { value: "   \n" } });
    const button = screen.getByTestId("submit-recognition-review") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(posts()).toHaveLength(0);
  });

  it("preserves failed edits after partial saving and retries only the remaining turn", async () => {
    const normal = api.getMockImplementation()!;
    let fail = true;
    api.mockImplementation(async (...args) => {
      if (fail && args[0] === "POST" && String(args[1]).includes("/two/confirm")) throw new Error("network");
      return normal(...args);
    });
    const feedback = view();
    fireEvent.change(await screen.findByTestId("recognition-edit-two"), { target: { value: "보존할 수정" } });
    fireEvent.click(screen.getByTestId("submit-recognition-review"));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(feedback).not.toHaveBeenCalled();
    expect(rows[0].status).toBe("confirmed");
    expect((screen.getByTestId("recognition-edit-two") as HTMLTextAreaElement).value).toBe("보존할 수정");
    fail = false;
    fireEvent.click(screen.getByTestId("submit-recognition-review"));
    await waitFor(() => expect(feedback).toHaveBeenCalledOnce());
    expect(posts().filter(([, path]) => String(path).includes("/one/confirm"))).toHaveLength(1);
    expect(rows[1].canonicalText).toBe("보존할 수정");
  });

  it("does not generate feedback when the server rejects a stale revision", async () => {
    const feedback = view();
    fireEvent.change(await screen.findByTestId("recognition-edit-one"), { target: { value: "수정 보존" } });
    rows[0] = { ...rows[0], revision: 9 };
    fireEvent.click(screen.getByTestId("submit-recognition-review"));
    await screen.findByRole("alert");
    expect(feedback).not.toHaveBeenCalled();
    expect(rows[0].status).toBe("needs_confirmation");
    expect((screen.getByTestId("recognition-edit-one") as HTMLTextAreaElement).value).toBe("수정 보존");
  });

  it("prevents duplicate confirmations and waits for all saves before feedback", async () => {
    const normal = api.getMockImplementation()!;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    api.mockImplementation(async (...args) => {
      if (args[0] === "POST") await held;
      return normal(...args);
    });
    const feedback = view();
    await screen.findByTestId("recognition-edit-one");
    const button = screen.getByTestId("submit-recognition-review");
    fireEvent.click(button);
    fireEvent.click(button);
    expect(feedback).not.toHaveBeenCalled();
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { release(); });
    await waitFor(() => expect(feedback).toHaveBeenCalledOnce());
    expect(posts()).toHaveLength(2);
  });

  it("keeps confirmed text canonical and avoids resubmitting untouched confirmed turns", async () => {
    rows[0] = { ...rows[0], status: "confirmed", canonicalText: "확정된 내용" };
    const feedback = view();
    expect((await screen.findByTestId("recognition-edit-one") as HTMLTextAreaElement).value).toBe("확정된 내용");
    fireEvent.click(screen.getByTestId("submit-recognition-review"));
    await waitFor(() => expect(feedback).toHaveBeenCalledOnce());
    expect(posts()).toHaveLength(1);
    expect(String(posts()[0][1])).toContain("/two/confirm");
  });

  it("does not generate feedback when new unresolved evidence arrives during submission", async () => {
    const normal = api.getMockImplementation()!;
    api.mockImplementation(async (...args) => {
      const result = await normal(...args);
      if (args[0] === "POST" && String(args[1]).includes("/two/confirm")) {
        rows.push({ ...rows[0], id: "late", revision: 1, status: "processing", canonicalText: null });
      }
      return result;
    });
    const feedback = view();
    await screen.findByTestId("recognition-edit-one");
    fireEvent.click(screen.getByTestId("submit-recognition-review"));
    await screen.findByRole("alert");
    expect(feedback).not.toHaveBeenCalled();
    expect(await screen.findByTestId("recognition-edit-late")).toBeTruthy();
  });

  it("shows capture-only turns as one bubble and deduplicates repeated voice identities", async () => {
    messages = [...messages.slice(0, 2), { ...messages[0], message: "가장 최근 저장본" }];
    view();
    expect((await screen.findByTestId("recognition-edit-one") as HTMLTextAreaElement).value).toBe("가장 최근 저장본");
    expect(screen.getAllByTestId("recognition-edit-one")).toHaveLength(1);
    expect((screen.getByTestId("recognition-edit-two") as HTMLTextAreaElement).value).toBe("원문 2");
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
  });

  it("fails visibly on a history load error without allowing submission", async () => {
    const normal = api.getMockImplementation()!;
    api.mockImplementation(async (...args) => {
      if (args[0] === "GET" && args[1] === "/api/conversations/run") throw new Error("history unavailable");
      return normal(...args);
    });
    const feedback = view();
    await screen.findByRole("alert");
    expect(screen.queryByTestId("submit-recognition-review")).toBeNull();
    expect(feedback).not.toHaveBeenCalled();
    expect(posts()).toHaveLength(0);
  });

  it("wires both report hold paths to a single submission and removes duplicate cards from live history", () => {
    const report = readFileSync("client/src/components/PersonalDevelopmentReport.tsx", "utf8");
    expect(report.match(/onSubmitted=\{handleSubmitRecognition\}/g)).toHaveLength(2);
    expect(report).not.toContain(">확인한 기록으로 재평가</Button>");
    const transcript = readFileSync("client/src/components/chat/TranscriptPanel.tsx", "utf8");
    expect(transcript).not.toContain("<RecognitionReview");
  });
});
