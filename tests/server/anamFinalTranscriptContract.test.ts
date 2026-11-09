import { describe, expect, it } from "vitest";
import { supportsAvatarFinalTranscript } from "../../shared/avatar/personaAvatar";
import {
  proposedAnamTranscriptRevision, validateProposedAnamTranscript,
} from "../../server/services/liveAvatar/contracts/anamFinalTranscriptProposal";

const binding = {
  projectId: "project", userId: "opaque-user", sessionId: "router-session", providerSessionId: "provider-session",
};
function ready() {
  const envelope = {
    ...binding, version: 1 as const, source: "anam" as const, pipeline: "anam_full" as const,
    status: "ready" as const, final: true as const, authentication: "provider_server" as const,
    revision: "",
    messages: [
      { id: "m1", role: "assistant" as const, text: "안녕하세요", timestamp: "2026-11-09T01:00:00.000Z" },
      { id: "m2", role: "user" as const, text: "납기를 확인하고 싶습니다.", timestamp: "2026-11-09T01:00:02.000Z" },
    ],
  };
  envelope.revision = proposedAnamTranscriptRevision(envelope);
  return envelope;
}

describe("proposed Anam contract model — no runtime or paid-call certification", () => {
  it("accepts a bound final fixture and identical retries", () => {
    const envelope = ready();
    expect(validateProposedAnamTranscript(envelope, binding, envelope.revision)).toEqual(envelope);
    expect(validateProposedAnamTranscript(JSON.parse(JSON.stringify(envelope)), binding)).toEqual(envelope);
  });
  it.each(["projectId", "userId", "sessionId", "providerSessionId"] as const)(
    "rejects another %s even with a self-consistent hash", key => {
      const envelope = { ...ready(), [key]: "other" };
      envelope.revision = proposedAnamTranscriptRevision(envelope);
      expect(() => validateProposedAnamTranscript(envelope, binding)).toThrow("binding_mismatch");
    },
  );
  it.each([
    { source: "tavus" }, { pipeline: "tavus_full" }, { final: false },
    { authentication: "browser" }, { authentication: undefined }, { version: 2 },
    { captions: [] }, { revision: undefined },
  ])("rejects untrusted or unsupported envelopes %j", change => {
    expect(() => validateProposedAnamTranscript({ ...ready(), ...change }, binding)).toThrow();
  });
  it("rejects mutation and a newly hashed revision after the first import was pinned", () => {
    const envelope = ready();
    const pinned = envelope.revision;
    envelope.messages[0].text = "changed";
    expect(() => validateProposedAnamTranscript(envelope, binding)).toThrow("revision_mismatch");
    envelope.revision = proposedAnamTranscriptRevision(envelope);
    expect(() => validateProposedAnamTranscript(envelope, binding, pinned)).toThrow("revision_mismatch");
  });
  it("rejects duplicate IDs but preserves repeated spoken text with distinct IDs", () => {
    const envelope = ready();
    envelope.messages.push({ ...envelope.messages[1], id: "m3" });
    envelope.revision = proposedAnamTranscriptRevision(envelope);
    expect(validateProposedAnamTranscript(envelope, binding).status).toBe("ready");
    envelope.messages[2].id = "m2";
    envelope.revision = proposedAnamTranscriptRevision(envelope);
    expect(() => validateProposedAnamTranscript(envelope, binding)).toThrow("duplicate_message");
  });
  it.each(["pending", "unavailable"] as const)("does not confuse %s with an empty final", status => {
    const { messages, revision, final, authentication, ...base } = ready();
    expect(validateProposedAnamTranscript({ ...base, status }, binding).status).toBe(status);
    const empty = { ...ready(), messages: [] };
    empty.revision = proposedAnamTranscriptRevision(empty);
    expect(validateProposedAnamTranscript(empty, binding).status).toBe("ready");
  });
  it("does not enable Anam on a proposed feature or Tavus transcript support", () => {
    const features = ["anam_full_pipeline", "unified_client_connection", "hosted_browser_client",
      "anam_final_transcript_v1", "tavus_final_transcript_v1"];
    expect(supportsAvatarFinalTranscript("anam", features)).toBe(false);
    expect(supportsAvatarFinalTranscript("tavus", features)).toBe(true);
    expect(supportsAvatarFinalTranscript("tavus", [])).toBe(false);
  });
});
