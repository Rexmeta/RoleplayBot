import { beforeEach, describe, expect, it, vi } from "vitest";
import { newCultureValues } from "../../shared/cultureMap";
const mocks = vi.hoisted(() => ({ persona: vi.fn(), criteria: vi.fn(), personaRun: vi.fn(), run: vi.fn() }));
vi.mock("../../server/services/fileManager", () => ({ fileManager: { getPersonaByMBTI: mocks.persona } }));
vi.mock("../../server/routes/routerHelpers", () => ({ loadEvaluationCriteria: mocks.criteria }));
vi.mock("../../server/storage", () => ({ storage: { getPersonaRun: mocks.personaRun, getScenarioRun: mocks.run } }));
import { captureCultureRunSnapshot, resolveAgentCultureScenario } from "../../server/services/cultureMap/runSnapshot";
import { RUNTIME_PERSONA_PROFILE_KEY, EVALUATION_CRITERIA_SNAPSHOT_KEY } from "../../server/services/runtimeScenario";

const culture = () => ({
  enabled: true, snapshotVersion: 1, profileId: "99dc1794-e6b9-4f84-8c70-d43cc57878d4",
  profileVersion: 1, name: "Custom", country: "Custom", region: "", sources: [],
  dimensions: newCultureValues(), intensity: 55, overrides: {},
});
describe("culture-enabled runtime binding", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.persona.mockResolvedValue({ communication_style: "direct", personality_traits: ["calm"] });
    mocks.criteria.mockResolvedValue({ id: "rubric", dimensions: [{ key: "communication", weight: 100 }] });
  });
  it("keeps OFF creation on the original path without Persona/rubric lookups", async () => {
    expect(await captureCultureRunSnapshot({ personas: [{ id: "a" }] })).toBeNull();
    expect(await captureCultureRunSnapshot({ personas: [{ id: "a", culture: { enabled: false } }] })).toBeNull();
    expect(mocks.persona).not.toHaveBeenCalled();
    expect(mocks.criteria).not.toHaveBeenCalled();
  });
  it("freezes all Actors, cultural values, runtime profiles and existing rubric without mutating authoring data", async () => {
    const source = { id: "s", personas: [{ id: "a", personaRef: "entj.json", culture: culture() }, { id: "b", personaRef: "entj.json" }] };
    const frozen = await captureCultureRunSnapshot(source, "ko");
    expect(frozen.personas[0].culture.dimensions).toEqual(newCultureValues());
    expect(frozen.personas[1][RUNTIME_PERSONA_PROFILE_KEY].communication_style).toBe("direct");
    expect(frozen[EVALUATION_CRITERIA_SNAPSHOT_KEY].dimensions[0].weight).toBe(100);
    source.personas[0].culture!.intensity = 95;
    expect(frozen.personas[0].culture.intensity).toBe(55);
    expect((source.personas[1] as any)[RUNTIME_PERSONA_PROFILE_KEY]).toBeUndefined();
    expect(mocks.criteria).toHaveBeenCalledWith(source, "ko");
  });
  it("fails malformed active snapshots rather than silently using live context", async () => {
    await expect(captureCultureRunSnapshot({ personas: [{ id: "a", culture: { enabled: true } }] })).rejects.toThrow();
    expect(mocks.persona).not.toHaveBeenCalled();
  });
  it("reuses Agent API run context after authoring changes/deletion and strips unbound legacy culture", async () => {
    const frozen = { id: "s", personas: [{ id: "a", culture: culture() }] };
    mocks.personaRun.mockResolvedValue({ scenarioRunId: "run" });
    mocks.run.mockResolvedValue({ scenarioId: "s", scenarioSnapshot: frozen });
    const session = { personaRunId: "p", scenarioId: "s" };
    expect((await resolveAgentCultureScenario(session, null))?.personas[0].culture.intensity).toBe(55);
    mocks.run.mockResolvedValue({ scenarioId: "s", scenarioSnapshot: null });
    expect((await resolveAgentCultureScenario(session, frozen))?.personas[0].culture).toBeUndefined();
  });
});
