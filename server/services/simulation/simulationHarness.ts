import { SimulationHarness } from '@shared/schema/scenarios';

export const ALL_INCIDENT_TYPES = [
  'executive_join', 'customer_escalation', 'deadline_pressure',
  'new_evidence', 'competitor_offer', 'policy_constraint',
  'quality_issue', 'manager_interrupt', 'budget_cut', 'compliance_warning',
] as const;

export const DEFAULT_SIMULATION_HARNESS: Required<SimulationHarness> = {
  emotionModel: ['anger', 'trust', 'confusion', 'interest'],
  toolPolicy: {
    updateNpcEmotion: {
      maxCallsPerTurn: 2,
      maxDeltaPerCall: 30,
    },
    triggerIncident: {
      allowedTypes: [...ALL_INCIDENT_TYPES],
      cooldownOverride: {
        globalCooldownSec: 60,
        perTypeCooldownSec: 120,
      },
    },
    updateScenarioState: {
      enabled: true,
    },
  },
  preferredSignals: {},
};

export function resolveHarness(scenario: { simulationHarness?: SimulationHarness | null } | null | undefined): Required<SimulationHarness> {
  const harness = scenario?.simulationHarness;
  if (!harness) return DEFAULT_SIMULATION_HARNESS;

  return {
    emotionModel: harness.emotionModel ?? DEFAULT_SIMULATION_HARNESS.emotionModel,
    toolPolicy: {
      updateNpcEmotion: {
        maxCallsPerTurn: harness.toolPolicy?.updateNpcEmotion?.maxCallsPerTurn ?? DEFAULT_SIMULATION_HARNESS.toolPolicy.updateNpcEmotion.maxCallsPerTurn,
        maxDeltaPerCall: harness.toolPolicy?.updateNpcEmotion?.maxDeltaPerCall ?? DEFAULT_SIMULATION_HARNESS.toolPolicy.updateNpcEmotion.maxDeltaPerCall,
      },
      triggerIncident: {
        allowedTypes: harness.toolPolicy?.triggerIncident?.allowedTypes ?? DEFAULT_SIMULATION_HARNESS.toolPolicy.triggerIncident.allowedTypes,
        cooldownOverride: {
          globalCooldownSec: harness.toolPolicy?.triggerIncident?.cooldownOverride?.globalCooldownSec ?? DEFAULT_SIMULATION_HARNESS.toolPolicy.triggerIncident.cooldownOverride.globalCooldownSec,
          perTypeCooldownSec: harness.toolPolicy?.triggerIncident?.cooldownOverride?.perTypeCooldownSec ?? DEFAULT_SIMULATION_HARNESS.toolPolicy.triggerIncident.cooldownOverride.perTypeCooldownSec,
        },
      },
      updateScenarioState: {
        enabled: harness.toolPolicy?.updateScenarioState?.enabled ?? DEFAULT_SIMULATION_HARNESS.toolPolicy.updateScenarioState.enabled,
      },
    },
    preferredSignals: harness.preferredSignals ?? DEFAULT_SIMULATION_HARNESS.preferredSignals,
  };
}
