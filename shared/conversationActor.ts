/** Resolve the runtime actor without letting legacy default index 0 replace the chosen actor. */
export function conversationActor<T extends { id?: string | number; personaRef?: string }>(
  personas: T[] | undefined,
  run: { personaId?: string | number; activePersonaIndex?: number | null; personaSwitchLog?: unknown },
): T | undefined {
  if (!personas?.length) return undefined;
  const id = String(run.personaId ?? "");
  const normalized = id.replace(/\.json$/i, "").toLowerCase();
  const byReference = personas.filter(p => p.personaRef?.replace(/\.json$/i, "").toLowerCase() === normalized);
  const initial = personas.find(p => String(p.id) === id) ??
    personas.find(p => String(p.id).toLowerCase() === normalized) ??
    (byReference.length === 1 ? byReference[0] : undefined);
  const index = run.activePersonaIndex;
  if (index == null) return initial;
  if (!Number.isInteger(index) || index < 0 || index >= personas.length) return undefined;
  const hasSwitch = Array.isArray(run.personaSwitchLog) && run.personaSwitchLog.length > 0;
  if (index === 0 && !initial && !hasSwitch) return undefined;
  // Older per-persona runs always persisted zero, even when the learner chose actor 2 or 3.
  if (index === 0 && initial && initial !== personas[0] &&
      !hasSwitch) return initial;
  return personas[index];
}
