import { beforeEach, describe, expect, it, vi } from "vitest";
import { newCultureValues } from "../../shared/cultureMap";
const store = vi.hoisted(() => ({
  getMbtiPersona: vi.fn(), getAllMbtiPersonas: vi.fn(), createMbtiPersona: vi.fn(),
  updateMbtiPersona: vi.fn(), deleteMbtiPersona: vi.fn(), createScenario: vi.fn(),
}));
vi.mock("../../server/storage", () => ({ storage: store }));
vi.mock("../../server/utils/mbtiLoader", () => ({ enrichPersonaWithMBTI: vi.fn(), enrichPersonaWithBasicMBTI: vi.fn() }));
import { fileManager } from "../../server/services/fileManager";
describe("Persona CRUD and scenario authoring remain independent", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  const persona = {
    id: "entj", mbti: "ENTJ", gender: "female", personality_traits: ["decisive"],
    communication_style: "direct", motivation: "teamwork", fears: [], background: {},
    communication_patterns: {}, images: null,
  };
  it("creates and updates Persona through unchanged storage fields with no culture property", async () => {
    store.getMbtiPersona.mockResolvedValue(undefined);
    expect(await fileManager.createMBTIPersona(persona)).toEqual(persona);
    const created = store.createMbtiPersona.mock.calls[0][0];
    expect(created).toMatchObject({ id: "entj", personalityTraits: ["decisive"], communicationStyle: "direct" });
    expect(created).not.toHaveProperty("culture");
    await fileManager.updateMBTIPersona("entj", { ...persona, communication_style: "collaborative" });
    expect(store.updateMbtiPersona).toHaveBeenCalledWith("entj", expect.objectContaining({ communicationStyle: "collaborative" }));
    expect(store.updateMbtiPersona.mock.calls[0][1]).not.toHaveProperty("culture");
  });
  it("lists, reads and deletes original Personas without involving culture services", async () => {
    const row = { id: "entj", mbti: "ENTJ", personalityTraits: ["decisive"], communicationStyle: "direct" };
    store.getMbtiPersona.mockResolvedValue(row);
    store.getAllMbtiPersonas.mockResolvedValue([row]);
    expect((await fileManager.getAllMBTIPersonas())[0].communication_style).toBe("direct");
    expect((await fileManager.getPersonaByMBTI("entj"))?.id).toBe("entj");
    await fileManager.deleteMBTIPersona("entj");
    expect(store.deleteMbtiPersona).toHaveBeenCalledWith("entj");
    expect(store.createScenario).not.toHaveBeenCalled();
  });
  it("preserves two Actor snapshots using one Persona template on scenario DB writes", async () => {
    const culture = {
      enabled: true, snapshotVersion: 1, profileId: "99dc1794-e6b9-4f84-8c70-d43cc57878d4",
      profileVersion: 1, name: "Custom", country: "Custom", region: "", sources: [],
      dimensions: newCultureValues(), intensity: 55, overrides: {},
    };
    await fileManager.createScenario({
      title: "Culture isolation test", description: "", difficulty: 2, estimatedTime: "5",
      skills: [], objectives: [], context: {}, successCriteria: {}, recommendedFlow: [],
      personas: [
        { id: "a", name: "A", personaRef: "entj", culture },
        { id: "b", name: "B", personaRef: "entj", culture: { ...culture, intensity: 90 } },
      ],
    } as any);
    const saved = store.createScenario.mock.calls[0][0];
    expect(saved.personas[0].culture.intensity).toBe(55);
    expect(saved.personas[1].culture.intensity).toBe(90);
    expect(store.updateMbtiPersona).not.toHaveBeenCalled();
    expect(store.createMbtiPersona).not.toHaveBeenCalled();
  });
});
