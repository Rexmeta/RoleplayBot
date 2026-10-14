import type { LedgerPayload } from "../../../shared/conversationLedger";
import type { LedgerUtterance, LedgerRun } from "../../../shared/schema/conversationLedger";

export class LedgerError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); }
}

function reconcileRecognition(row: LedgerUtterance): void {
  if (row.recognitionState === "confirmed" || row.recognitionState === "not_required") return;
  if (row.reason && !["provider_incomplete", "candidate_disagreement"].includes(row.reason)) return;
  if (row.candidateText === null) return;
  const verified = row.captureState === "committed" && row.providerState === "final" &&
    !!row.candidateText.trim() &&
    row.providerText.replace(/\s/g, "") === row.candidateText.replace(/\s/g, "");
  row.recognitionState = verified ? "verified" : "needs_confirmation";
  row.canonicalText = verified ? row.candidateText : null;
  row.reason = verified ? null : row.providerState === "final" ? "candidate_disagreement" : "provider_incomplete";
}

/** Independent capture/finality/recognition/playback state; no content-based identity. */
export function transitionUtterance(current: LedgerUtterance, event: LedgerPayload): LedgerUtterance {
  const row = { ...current };
  switch (event.kind) {
    case "capture.commit":
      if (row.speaker !== "user" || row.mode !== "voice") throw new LedgerError("capture_not_applicable");
      if (row.captureState === "collecting") row.captureState = "committed";
      break;
    case "capture.gap":
      if (row.speaker !== "user" || row.mode !== "voice") throw new LedgerError("capture_not_applicable");
      row.captureState = "gap"; row.captureReason = event.reason;
      break;
    case "provider.final":
      if (row.providerState === "final" && row.providerText !== event.text) throw new LedgerError("final_text_immutable");
      if (row.providerState === "failed") throw new LedgerError("provider_terminal");
      if (row.providerEventId && event.providerEventId && row.providerEventId !== event.providerEventId) {
        throw new LedgerError("provider_identity_conflict");
      }
      row.providerState = "final"; row.providerText = event.text;
      row.providerEventId = event.providerEventId ?? row.providerEventId;
      if (event.metadata) row.metadata = event.metadata;
      if (row.recognitionState === "not_required") row.canonicalText = event.text;
      break;
    case "provider.interrupted":
      if (row.providerState === "final") throw new LedgerError("final_text_immutable");
      row.providerState = "interrupted"; row.providerText = event.text;
      if (row.recognitionState !== "confirmed") row.canonicalText = null;
      break;
    case "provider.failed":
      if (row.providerState === "final") throw new LedgerError("final_text_immutable");
      row.providerState = "failed";
      if (row.recognitionState !== "confirmed") row.canonicalText = null;
      break;
    case "recognition.stt":
      if (row.speaker !== "user" || row.mode !== "voice" || row.recognitionState === "not_required") {
        throw new LedgerError("recognition_not_applicable");
      }
      if (row.recognitionState === "confirmed" || row.candidateText !== null) return row;
      row.candidateText = event.text;
      row.recognitionSource = event.model ? `openai_stt:${event.model}` : "independent_stt";
      if (event.reason || !event.text?.trim()) {
        row.recognitionState = "needs_confirmation";
        row.reason = event.reason ?? "stt_failed";
        row.canonicalText = null;
      }
      break;
    case "recognition.confirm":
      if (row.speaker !== "user" || row.mode !== "voice" || row.recognitionState === "not_required") {
        throw new LedgerError("recognition_not_applicable");
      }
      if (event.expectedRevision !== row.revision) throw new LedgerError("utterance_revision_conflict");
      row.recognitionState = "confirmed"; row.canonicalText = event.text;
      row.reason = null; row.recognitionSource = "user_confirmation";
      break;
    case "playback.observed":
      if (row.speaker !== "ai" || row.mode !== "voice") throw new LedgerError("playback_not_applicable");
      if (["completed", "interrupted"].includes(row.playbackState) && row.playbackState !== event.state) {
        throw new LedgerError("playback_observation_terminal");
      }
      row.playbackState = event.state;
      break;
    default: throw new LedgerError("invalid_utterance_transition", 400);
  }
  reconcileRecognition(row);
  return row;
}

export function snapshotBlockers(run: LedgerRun, rows: LedgerUtterance[]): string[] {
  const blockers: string[] = [];
  if (run.status !== "closed") blockers.push("session_open");
  if (run.captureGaps) blockers.push("capture_sequence_gap");
  for (const row of rows) {
    if (row.captureState === "collecting" || row.captureState === "gap") blockers.push(`${row.id}:capture_${row.captureState}`);
    if (row.providerState !== "final" && row.recognitionState !== "confirmed") blockers.push(`${row.id}:provider_${row.providerState}`);
    if (!["verified", "confirmed", "not_required"].includes(row.recognitionState)) blockers.push(`${row.id}:recognition_pending`);
    if (row.speaker === "ai" && row.mode === "voice" && row.playbackState !== "completed") blockers.push(`${row.id}:playback_${row.playbackState}`);
    if (!row.canonicalText?.trim()) blockers.push(`${row.id}:canonical_missing`);
  }
  if (!rows.some(row => row.speaker === "user")) blockers.push("no_user_utterance");
  return blockers;
}
