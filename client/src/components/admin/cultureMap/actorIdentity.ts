export type ActorTemplateReference = {
  id?: string;
  personaRef?: string;
};

/** Resolve a saved Actor's selected Persona template, not its unique Actor id. */
export function getScenarioPersonaTemplateId(actor: ActorTemplateReference): string {
  const reference = actor.personaRef?.trim() || actor.id?.trim() || "";
  const filename = reference.split("/").pop() ?? reference;
  return filename.replace(/\.json$/i, "");
}

/**
 * Preserve a saved Actor id. For newly selected slots, use the template id
 * when free and append a deterministic suffix for duplicate template Actors.
 */
export function stableActorIdForTemplate(
  templateId: string,
  currentActor: ActorTemplateReference,
  actors: readonly ActorTemplateReference[],
): string {
  if (currentActor.id?.trim()) return currentActor.id;
  const usedIds = new Set(actors.map((actor) => actor.id?.trim()).filter((id): id is string => Boolean(id)));
  if (!usedIds.has(templateId)) return templateId;
  let suffix = 2;
  while (usedIds.has(`${templateId}__actor_${suffix}`)) suffix += 1;
  return `${templateId}__actor_${suffix}`;
}
