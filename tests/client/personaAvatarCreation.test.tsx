// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PersonaAvatarCreationPanel } from "../../client/src/components/admin/PersonaAvatarCreationPanel";
const api = vi.hoisted(() => vi.fn());
vi.mock("../../client/src/lib/queryClient", () => ({ apiRequest: api }));
afterEach(cleanup);
beforeEach(() => api.mockReset());

async function fill() {
  fireEvent.change(screen.getByPlaceholderText("예: 고객 상담 코치"), { target: { value: "상담 페르소나" } });
  const picker = document.querySelector('input[type="file"]')!;
  fireEvent.change(picker, { target: { files: [new File(["test image"], "avatar.png", { type: "image/png" })] } });
  await waitFor(() => expect(screen.getByText("avatar.png")).toBeTruthy());
  for (const checkbox of screen.getAllByRole("checkbox")) fireEvent.click(checkbox);
}

describe("explicit custom avatar creation UI", () => {
  it("uses the existing default image and scenario name only after explicit confirmation", async () => {
    const submitted = vi.fn();
    api.mockImplementation(async (method: string) => method === "GET"
      ? new Response(new Blob(["persona image"], { type: "image/webp" }))
      : { json: async () => ({ state: { stage: "submitted", uncertain: false, assetId: "asset" } }) });
    render(<PersonaAvatarCreationPanel onSubmitted={submitted} source={{
      image: "personas/infj/male/neutral.webp",
      names: [{ scenarioId: "scenario", scenarioTitle: "협상", name: "김민수" }],
    }} />);
    expect(api).not.toHaveBeenCalled();
    expect(screen.getByText("김민수")).toBeTruthy();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByPlaceholderText("예: 고객 상담 코치")).toBeNull();
    for (const checkbox of screen.getAllByRole("checkbox")) fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "커스텀 아바타 생성" }));
    await waitFor(() => expect(submitted).toHaveBeenCalledTimes(1));
    expect(api.mock.calls[0]).toEqual(["GET", "/objects?key=personas%2Finfj%2Fmale%2Fneutral.webp"]);
    expect(api.mock.calls[1]).toEqual(["POST", "/api/admin/personas/live-avatar/creation", expect.objectContaining({
      name: "김민수", likeness: "synthetic", imageBase64: expect.any(String),
    })]);
  });
  it("requires choosing a scenario when the persona has multiple scenario names", () => {
    render(<PersonaAvatarCreationPanel onSubmitted={vi.fn()} source={{
      image: "personas/base.webp",
      names: [
        { scenarioId: "one", scenarioTitle: "협상", name: "김민수" },
        { scenarioId: "two", scenarioTitle: "보고", name: "이서연" },
      ],
    }} />);
    for (const checkbox of screen.getAllByRole("checkbox")) fireEvent.click(checkbox);
    expect((screen.getByRole("button", { name: "커스텀 아바타 생성" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "two" } });
    expect(screen.getByText("이서연", { selector: "strong" })).toBeTruthy();
    expect(screen.getAllByRole("checkbox").every(box => !(box as HTMLInputElement).checked)).toBe(true);
    for (const checkbox of screen.getAllByRole("checkbox")) fireEvent.click(checkbox);
    expect((screen.getByRole("button", { name: "커스텀 아바타 생성" }) as HTMLButtonElement).disabled).toBe(false);
    expect(api).not.toHaveBeenCalled();
  });
  it("blocks missing source information and resets confirmations when the base image changes", () => {
    const names = [{ scenarioId: "one", scenarioTitle: "협상", name: "김민수" }];
    const { rerender } = render(<PersonaAvatarCreationPanel onSubmitted={vi.fn()} source={{ image: "", names }} />);
    for (const checkbox of screen.getAllByRole("checkbox")) fireEvent.click(checkbox);
    expect((screen.getByRole("button", { name: "커스텀 아바타 생성" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<PersonaAvatarCreationPanel onSubmitted={vi.fn()} source={{ image: "personas/base.webp", names }} />);
    expect(screen.getAllByRole("checkbox").every(box => !(box as HTMLInputElement).checked)).toBe(true);
    rerender(<PersonaAvatarCreationPanel onSubmitted={vi.fn()} source={{ image: "personas/base.webp", names: [] }} />);
    expect(screen.getByText(/이 페르소나를 사용하는 시나리오에 이름을 먼저 등록/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "커스텀 아바타 생성" }) as HTMLButtonElement).disabled).toBe(true);
    expect(api).not.toHaveBeenCalled();
  });
  it("does not provision or mark the job uncertain when reading the existing image fails", async () => {
    api.mockResolvedValue(new Response("", { status: 404 }));
    render(<PersonaAvatarCreationPanel onSubmitted={vi.fn()} source={{
      image: "personas/base.webp", names: [{ scenarioId: "one", scenarioTitle: "협상", name: "김민수" }],
    }} />);
    for (const checkbox of screen.getAllByRole("checkbox")) fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "커스텀 아바타 생성" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("기본 이미지를 읽지 못했습니다."));
    expect(api).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0][0]).toBe("GET");
    expect(screen.queryByText(/새 생성은 잠겼습니다/)).toBeNull();
  });
  it("never sends an image or creates an avatar on mount", () => {
    render(<PersonaAvatarCreationPanel onSubmitted={vi.fn()} />);
    expect(api).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "커스텀 아바타 생성" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("requires image and all three consents, sends only the explicit source, and permits a new image after submission", async () => {
    const submitted = vi.fn();
    api.mockResolvedValue({ json: async () => ({ state: { stage: "submitted", uncertain: false, assetId: "asset" } }) });
    render(<PersonaAvatarCreationPanel onSubmitted={submitted} />);
    await fill();
    const create = screen.getByRole("button", { name: "커스텀 아바타 생성" });
    expect((create as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(create);
    await waitFor(() => expect(submitted).toHaveBeenCalledTimes(1));
    expect(api.mock.calls[0]).toEqual(["POST", "/api/admin/personas/live-avatar/creation", expect.objectContaining({
      name: "상담 페르소나", likeness: "synthetic", rightsConfirmed: true, transferConfirmed: true, costConfirmed: true,
    })]);
    expect(api.mock.calls[0][2].imageBase64).not.toContain("data:");
    fireEvent.click(screen.getByRole("button", { name: "새 이미지로 생성 준비" }));
    expect(screen.queryByText("avatar.png")).toBeNull();
    expect((screen.getByRole("button", { name: "커스텀 아바타 생성" }) as HTMLButtonElement).disabled).toBe(true);
    expect(api).toHaveBeenCalledTimes(1);
  });
  it("locks an ambiguous request and only performs GET when reconciling", async () => {
    api.mockRejectedValueOnce(new Error("NetworkError"));
    render(<PersonaAvatarCreationPanel onSubmitted={vi.fn()} />);
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "커스텀 아바타 생성" }));
    await screen.findByText(/요청 결과가 불확실할 수 있습니다/);
    expect((screen.getByRole("button", { name: "커스텀 아바타 생성" }) as HTMLButtonElement).disabled).toBe(true);
    api.mockResolvedValueOnce({ json: async () => ({ stage: "provisioning", uncertain: true }) });
    fireEvent.click(screen.getByRole("button", { name: "작업 상태 조회" }));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    expect(api.mock.calls[1]).toEqual(["GET", "/api/admin/personas/live-avatar/creation"]);
  });
  it("blocks provider training during consent review", async () => {
    api.mockResolvedValue({ json: async () => ({ state: { stage: "image_ready", imageId: "image", uncertain: false, consentStatus: "pending_review" } }) });
    render(<PersonaAvatarCreationPanel onSubmitted={vi.fn()} />);
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "커스텀 아바타 생성" }));
    await screen.findByText(/동의 검토 대기 중입니다/);
    expect((screen.getByRole("button", { name: "커스텀 아바타 생성" }) as HTMLButtonElement).disabled).toBe(true);
    expect(api).toHaveBeenCalledTimes(1);
  });
});
