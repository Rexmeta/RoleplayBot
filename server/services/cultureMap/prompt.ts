import { CULTURE_DIMENSIONS, cultureSnapshotSchema } from "../../../shared/cultureMap";

const behaviors = {
  communicating: ["state the message explicitly with concrete detail", "attend to context and implicit meaning while keeping essential information clear"],
  evaluating: ["offer respectful, direct corrective feedback", "offer corrective feedback tactfully and indirectly without obscuring essential facts"],
  persuading: ["explain principles and reasoning before examples", "start with practical examples and applications"],
  leading: ["invite egalitarian participation", "acknowledge role hierarchy without sacrificing safety or respect"],
  deciding: ["seek consensus before committing", "expect the accountable decision-maker to make the final call"],
  trusting: ["build trust through reliable task delivery", "invest in rapport and relationships alongside task delivery"],
  disagreeing: ["allow respectful open disagreement", "raise disagreement carefully to preserve relationships without hiding problems"],
  scheduling: ["prefer sequential tasks and explicit schedules", "allow flexible timing and parallel priorities while honoring critical commitments"],
} as const;

/** Pure, snapshot-only layer. Source text and country names are never instructions. */
export function buildActorCultureLayer(actor: { id?: string; culture?: unknown }): string {
  const culture = actor.culture as any;
  if (culture == null || culture.enabled === false) return "";
  const parsed = cultureSnapshotSchema.safeParse(culture);
  if (!parsed.success) throw new Error("Invalid bound Actor culture snapshot");
  const snapshot = parsed.data;
  if (snapshot.intensity === 0) return "";
  const emphasis = snapshot.intensity <= 33 ? "light" : snapshot.intensity <= 66 ? "moderate" : "strong";
  const lines = CULTURE_DIMENSIONS.map(({ key }) => {
    const value = snapshot.dimensions[key];
    const tendency = value < 40 ? behaviors[key][0] : value > 60 ? behaviors[key][1]
      : `balance both approaches: ${behaviors[key][0]}; ${behaviors[key][1]}`;
    return `- ${key} (${value}/100 continuum, not probability): ${tendency}.`;
  });
  return `\n[CULTURE_CONTEXT actorId=${JSON.stringify(actor.id ?? "")} version=${snapshot.profileVersion}]
Apply ONLY when speaking as this Actor. This is a scenario-specific behavioral tendency, not a person's fixed personality, nationality stereotype, or ability.
Instruction emphasis: ${emphasis} (${snapshot.intensity}/100). This is NOT a deterministic probability of behavior.
Respect safety, explicit scenario constraints, the individual's goals and observed behavior over this layer. Never modify assessment scores because of cultural dimensions.
${snapshot.origin ? "These are unvalidated editorial estimates, NOT official Erin Meyer scores or individual measurements. Individual biography, professional role, organization and explicit overrides take precedence over this starting prior.\n" : ""}${lines.join("\n")}
[/CULTURE_CONTEXT]`;
}

export function buildScenarioCultureLayer(scenario: any, persona: { id: string }): string {
  if (!scenario || typeof scenario === "string") return "";
  const actors: any[] = scenario.personas ?? scenario.allPersonas ?? [];
  const active = actors.find(actor => actor.id === persona.id);
  return scenario.personaSwitchMode === "join"
    ? actors.map(buildActorCultureLayer).join("")
    : active ? buildActorCultureLayer(active) : "";
}
