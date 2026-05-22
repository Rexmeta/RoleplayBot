import type { ScenarioPersona } from '@/lib/scenario-system';

export interface PersonaSwitchInfo {
  toIndex: number;
  newPersonaName?: string;
}

/**
 * Determines the new active persona after a speaker switch.
 *
 * Prefers a name-based lookup so the correct avatar is shown even when the
 * server-supplied toIndex and newPersonaName point to different entries.
 * Falls back to index-based lookup when newPersonaName is absent or does not
 * match any persona in the list.
 */
export function resolvePersonaAfterSwitch(
  personas: ScenarioPersona[] | undefined,
  info: PersonaSwitchInfo,
): ScenarioPersona | undefined {
  return (
    (info.newPersonaName
      ? personas?.find((p) => p.name === info.newPersonaName)
      : undefined) ?? personas?.[info.toIndex]
  );
}
