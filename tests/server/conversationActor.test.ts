import { describe, expect, it } from "vitest";
import { conversationActor } from "../../shared/conversationActor";

const personas = [{ id: "first" }, { id: "live" }, { id: "third" }];
describe("conversation runtime actor", () => {
  it.each(["first", "live", "third"])("keeps legacy zero defaults on the originally selected %s", personaId => {
    expect(conversationActor(personas, { personaId, activePersonaIndex: 0 })?.id).toBe(personaId);
  });
  it("uses a real switch instead of the original persona", () => {
    expect(conversationActor(personas, { personaId: "first", activePersonaIndex: 1 })?.id).toBe("live");
    expect(conversationActor(personas, { personaId: "live", activePersonaIndex: 0,
      personaSwitchLog: [{ fromIndex: 1, toIndex: 0 }] })?.id).toBe("first");
  });
  it("preserves a uniquely referenced legacy persona without falling back to the first actor", () => {
    expect(conversationActor([{ id: "first" }, { id: "assigned", personaRef: "ENTJ.json" }],
      { personaId: "entj", activePersonaIndex: 0 })?.id).toBe("assigned");
    expect(conversationActor(personas, { personaId: "missing", activePersonaIndex: 0 })).toBeUndefined();
  });
  it.each([-1, 3, 1.5, NaN])("does not fall back from invalid index %s", activePersonaIndex => {
    expect(conversationActor(personas, { personaId: "live", activePersonaIndex })).toBeUndefined();
  });
});
