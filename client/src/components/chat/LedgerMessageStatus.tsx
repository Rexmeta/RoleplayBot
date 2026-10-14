import type { LedgerUtterance } from "@shared/schema/conversationLedger";

export function ledgerStatusLabels(row: LedgerUtterance): string[] {
  const labels = ["저장 확인"];
  if (row.providerState === "pending") labels.push("전사 중");
  if (!["not_required", "verified", "confirmed"].includes(row.recognitionState)) labels.push("인식 확인 필요");
  if (row.captureState === "gap") labels.push("기록 누락");
  if (row.speaker === "ai" && row.mode === "voice" && row.playbackState !== "completed") {
    labels.push(row.playbackState === "interrupted" ? "재생 중단 · 전달 확인 필요" : "재생 미확인");
  }
  if (row.providerState === "interrupted") labels.push("제공자 응답 중단");
  if (row.providerState === "failed") labels.push("제공자 응답 실패");
  return labels;
}

export function LedgerMessageStatus({ row }: { row?: LedgerUtterance }) {
  if (!row) return null;
  return <div className="flex flex-wrap gap-1 mt-1" aria-label="발화 기록 상태">
    {ledgerStatusLabels(row).map((label, i) =>
      <span key={label} className={`text-[10px] px-1.5 py-0.5 rounded ${i === 0 ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-800"}`}>{label}</span>
    )}
  </div>;
}
