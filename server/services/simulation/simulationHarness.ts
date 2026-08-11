import { SimulationHarness } from '@shared/schema/scenarios';

/**
 * Normalizes a raw persisted SimulationHarness object, migrating legacy field names
 * produced before the affective-layer rename:
 *   emotionModel            → affectiveAxes
 *   toolPolicy.updateNpcEmotion → toolPolicy.npcAffectiveStateDelta
 *
 * Safe to call on already-migrated objects (no-op if new keys are present).
 */
export function normalizeSimulationHarness(raw: any): SimulationHarness {
  if (!raw || typeof raw !== 'object') return raw;
  const out: any = { ...raw };

  // emotionModel → affectiveAxes
  if ('emotionModel' in out && !('affectiveAxes' in out)) {
    out.affectiveAxes = out.emotionModel;
    delete out.emotionModel;
  }

  // toolPolicy.updateNpcEmotion → toolPolicy.npcAffectiveStateDelta
  if (out.toolPolicy && typeof out.toolPolicy === 'object') {
    const tp: any = { ...out.toolPolicy };
    if ('updateNpcEmotion' in tp && !('npcAffectiveStateDelta' in tp)) {
      tp.npcAffectiveStateDelta = tp.updateNpcEmotion;
      delete tp.updateNpcEmotion;
    }
    out.toolPolicy = tp;
  }

  return out as SimulationHarness;
}

export const ALL_INCIDENT_TYPES = [
  'executive_join', 'customer_escalation', 'deadline_pressure',
  'new_evidence', 'competitor_offer', 'policy_constraint',
  'quality_issue', 'manager_interrupt', 'budget_cut', 'compliance_warning',
] as const;

export const DEFAULT_SIMULATION_HARNESS: Required<SimulationHarness> = {
  affectiveAxes: ['affective.intensity', 'relational.trust', 'cognitive.confusion', 'motivational.interest'],
  toolPolicy: {
    npcAffectiveStateDelta: {
      maxCallsPerTurn: 2,
      maxDeltaPerCall: 30,
    },
    triggerIncident: {
      allowedTypes: [...ALL_INCIDENT_TYPES],
      cooldownOverride: {
        globalCooldownSec: 60,
        perTypeCooldownSec: 120,
      },
      cooldowns: {},
    },
    updateScenarioState: {
      enabled: true,
    },
  },
  preferredSignals: {},
};

export function resolveHarness(scenario: { simulationHarness?: SimulationHarness | null } | null | undefined): Required<SimulationHarness> {
  const rawHarness = scenario?.simulationHarness;
  if (!rawHarness) return DEFAULT_SIMULATION_HARNESS;
  const harness = normalizeSimulationHarness(rawHarness);

  return {
    affectiveAxes: harness.affectiveAxes ?? DEFAULT_SIMULATION_HARNESS.affectiveAxes,
    toolPolicy: {
      npcAffectiveStateDelta: {
        maxCallsPerTurn: harness.toolPolicy?.npcAffectiveStateDelta?.maxCallsPerTurn ?? DEFAULT_SIMULATION_HARNESS.toolPolicy.npcAffectiveStateDelta!.maxCallsPerTurn,
        maxDeltaPerCall: harness.toolPolicy?.npcAffectiveStateDelta?.maxDeltaPerCall ?? DEFAULT_SIMULATION_HARNESS.toolPolicy.npcAffectiveStateDelta!.maxDeltaPerCall,
      },
      triggerIncident: {
        allowedTypes: harness.toolPolicy?.triggerIncident?.allowedTypes ?? DEFAULT_SIMULATION_HARNESS.toolPolicy.triggerIncident!.allowedTypes,
        cooldownOverride: {
          globalCooldownSec: harness.toolPolicy?.triggerIncident?.cooldownOverride?.globalCooldownSec ?? DEFAULT_SIMULATION_HARNESS.toolPolicy.triggerIncident!.cooldownOverride!.globalCooldownSec,
          perTypeCooldownSec: harness.toolPolicy?.triggerIncident?.cooldownOverride?.perTypeCooldownSec ?? DEFAULT_SIMULATION_HARNESS.toolPolicy.triggerIncident!.cooldownOverride!.perTypeCooldownSec,
        },
        cooldowns: {
          ...DEFAULT_SIMULATION_HARNESS.toolPolicy.triggerIncident!.cooldowns,
          ...(harness.toolPolicy?.triggerIncident?.cooldowns ?? {}),
        },
      },
      updateScenarioState: {
        enabled: harness.toolPolicy?.updateScenarioState?.enabled ?? DEFAULT_SIMULATION_HARNESS.toolPolicy.updateScenarioState!.enabled,
      },
    },
    preferredSignals: harness.preferredSignals ?? DEFAULT_SIMULATION_HARNESS.preferredSignals,
  };
}

export function resolveCooldownsForType(
  h: Required<SimulationHarness>,
  incidentType: string
): { globalCooldownMs: number; perTypeCooldownMs: number } {
  const typeOverride = h.toolPolicy.triggerIncident?.cooldowns?.[incidentType];
  const globalCooldownSec = typeOverride?.globalCooldownSec
    ?? h.toolPolicy.triggerIncident?.cooldownOverride?.globalCooldownSec
    ?? 60;
  const perTypeCooldownSec = typeOverride?.perTypeCooldownSec
    ?? h.toolPolicy.triggerIncident?.cooldownOverride?.perTypeCooldownSec
    ?? 120;
  return {
    globalCooldownMs: globalCooldownSec * 1000,
    perTypeCooldownMs: perTypeCooldownSec * 1000,
  };
}
