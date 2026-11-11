import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selects: [] as any[], updates: [] as any[], insert: vi.fn(), update: vi.fn(), bound: vi.fn(),
}));
vi.mock("../../server/storage/db", () => ({
  db: {
    select: () => {
      const chain: any = {
        from: () => chain, innerJoin: () => chain,
        where: () => Promise.resolve(mocks.selects.shift() ?? []),
      };
      return chain;
    },
    insert: () => ({ values: (values: any) => {
      mocks.insert(values);
      return { returning: async () => [{ id: "run", ...values }] };
    } }),
    update: () => ({ set: (values: any) => {
      mocks.update(values);
      return { where: () => ({ returning: async () => mocks.updates.shift() ?? [] }) };
    } }),
  },
}));
vi.mock("../../server/services/conversationLedger/transcript", () => ({
  ledgerRuntimeBinding: mocks.bound, hasLedgerProtocol: vi.fn(), ledgerChatMessages: vi.fn(),
}));
import { SessionsMixin } from "../../server/storage/sessions";
const Store = SessionsMixin(class {});

describe("persisted conversation language", () => {
  beforeEach(() => {
    mocks.selects.length = mocks.updates.length = 0;
    vi.clearAllMocks();
    mocks.bound.mockResolvedValue(null);
  });
  it("captures the owner's language at creation instead of relying on a Korean database default", async () => {
    mocks.selects.push([{ language: "ja" }]);
    const result = await new Store().createPersonaRun({ scenarioRunId: "scenario", personaId: "p", personaName: "P" });
    expect(result.language).toBe("ja");
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ language: "ja" }));
  });
  it("does not read a changed owner preference for an already pinned run", async () => {
    mocks.selects.push([{ id: "run", language: "zh" }]);
    expect((await new Store().getPersonaRun("run"))?.language).toBe("zh");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("preserves an explicit server-selected API language when there is no web user owner", async () => {
    const result = await new Store().createPersonaRun({
      scenarioRunId: "api-scenario", personaId: "p", personaName: "P", language: "zh",
    });
    expect(result.language).toBe("zh");
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ language: "zh" }));
  });
  it("pins historical ledger language before current profile preference", async () => {
    mocks.selects.push([{ id: "run", scenarioRunId: "sr", language: null, transcriptProtocol: "ledger-v1" }], [{ language: "en" }]);
    mocks.bound.mockResolvedValue({ language: "ko" });
    mocks.updates.push([{ id: "run", language: "ko" }]);
    expect((await new Store().getPersonaRun("run"))?.language).toBe("ko");
    expect(mocks.update).toHaveBeenCalledWith({ language: "ko" });
  });
  it("returns the concurrent winner instead of changing an already pinned legacy language", async () => {
    mocks.selects.push([{ id: "run", scenarioRunId: "sr", language: null, transcriptProtocol: "legacy" }],
      [{ language: "ja" }], [{ id: "run", language: "en" }]);
    mocks.updates.push([]);
    expect((await new Store().getPersonaRun("run"))?.language).toBe("en");
    expect(mocks.update).toHaveBeenCalledOnce();
  });
});
