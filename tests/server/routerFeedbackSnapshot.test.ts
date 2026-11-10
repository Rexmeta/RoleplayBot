import { describe, expect, it, vi } from "vitest";
vi.mock("../../server/storage/db", () => ({ db: {} }));
vi.mock("../../server/services/conversationLedger/transcript", () => ({
  hasLedgerProtocol: vi.fn(),
  ledgerChatMessage: (row: any) => ({ sender: row.speaker, message: row.canonicalText }),
}));
import { snapshotFeedbackInput } from "../../server/services/conversationLedger/feedbackBinding";
import { ledgerPayloadSchema } from "../../shared/conversationLedger";

describe("common router transcript in immutable feedback snapshots", () => {
  it.each(["anam", "tavus"] as const)("keeps %s original timestamps, voice mode and trusted provenance", provider => {
    const source = { provider, projectId: "project", sessionId: "router-session", revision: "a".repeat(64) };
    const timestamp = "2026-11-09T19:00:00+09:00";
    const result = snapshotFeedbackInput({ personaRunId: "run", personaId: "actor" } as any, {
      id: "snapshot", revision: 5, hash: "snapshot-hash",
      content: {
        boundContext: { scenarioSnapshot: { id: "scenario" }, personaSnapshot: { name: "Frozen actor" },
          evaluationHarnessSnapshot: { rubric: "frozen" } },
        utterances: [{
          id: "utterance", provider, speaker: "user", canonicalText: "납기를 확인하겠습니다.",
          createdAt: "2026-11-10T00:00:00Z",
          metadata: { sourceTimestamp: timestamp, routerTranscript: source },
        }],
      },
    } as any);
    expect(result.conversation.mode).toBe("realtime_voice");
    expect(result.conversation.messages[0].timestamp).toBe(timestamp);
    expect(result.conversation.transcriptSource).toMatchObject({
      provider, projectId: source.projectId, revision: source.revision, routerSessionId: source.sessionId,
    });
    expect(result.evaluationHarnessSnapshot).toEqual({ rubric: "frozen" });
    expect(result.transcriptSnapshot).toEqual({ id: "snapshot", revision: 5, hash: "snapshot-hash" });
    expect(ledgerPayloadSchema.safeParse({ kind: "provider.final",
      utteranceId: "c6212bc2-1a5b-4ed9-8bcf-231d7fd48950", text: "확인",
      metadata: { sourceTimestamp: timestamp, routerTranscript: source },
    }).success).toBe(true);
  });
});
