// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TranscriptPanel } from "@/components/chat/TranscriptPanel";

const evidence = vi.hoisted(() => ({ data: [] as any[] }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/chat/RecognitionReview", () => ({
  useRecognitionEvidence: () => evidence,
  RecognitionReview: () => null,
}));

const props = {
  isOpen: true,
  onToggle: vi.fn(),
  onClose: vi.fn(),
  messages: [{
    sender: "user" as const, message: "실제로 표시할 대화 내용", voiceTurnId: "turn",
    timestamp: "2026-11-12T00:00:00Z",
  }],
  pendingAiMessage: false,
  pendingUserMessage: false,
  pendingUserText: "",
  personaName: "Persona",
  recognitionRunId: "run",
};

beforeEach(() => { evidence.data = []; });
afterEach(cleanup);

describe("conversation transcript recognition labels", () => {
  it.each(["processing", "needs_confirmation", "failed"])(
    "keeps the message without the Live-original prefix for %s evidence",
    status => {
      evidence.data = [{ id: "turn", status, canonicalText: "아직 확정되지 않은 후보" }];
      render(<TranscriptPanel {...props} />);
      expect(screen.getByText("실제로 표시할 대화 내용")).toBeTruthy();
      expect(screen.queryByText(/인식 확인 필요|Live 원문/)).toBeNull();
      expect(screen.queryByText("아직 확정되지 않은 후보")).toBeNull();
    },
  );

  it.each(["verified", "confirmed"])("preserves the canonical text for %s evidence", status => {
    evidence.data = [{ id: "turn", status, canonicalText: "확정된 대화 내용" }];
    render(<TranscriptPanel {...props} />);
    expect(screen.getByText("확정된 대화 내용")).toBeTruthy();
    expect(screen.queryByText("실제로 표시할 대화 내용")).toBeNull();
    expect(screen.queryByText(/인식 확인 필요|Live 원문/)).toBeNull();
  });

  it("preserves messages without recognition evidence", () => {
    render(<TranscriptPanel {...props} />);
    expect(screen.getByText("실제로 표시할 대화 내용")).toBeTruthy();
    expect(screen.queryByText(/인식 확인 필요|Live 원문/)).toBeNull();
  });
});
