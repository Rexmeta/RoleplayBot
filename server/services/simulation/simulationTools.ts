export const SIMULATION_TOOLS = [
  {
    name: 'update_npc_affective_state',
    description: 'Update NPC affective state using delta values across four layers. Call this when the conversation affects the NPC\'s emotional or relational state. Maximum 2 calls per turn. Each delta is clamped to -30~+30.',
    parameters: {
      type: 'object',
      properties: {
        intensityDelta: {
          type: 'number',
          description: 'Change in emotional intensity / anger proxy (-30 to +30). Positive = more intense/angry.',
          minimum: -30,
          maximum: 30,
        },
        valenceDelta: {
          type: 'number',
          description: 'Change in emotional valence (-30 to +30). Positive = more pleasant, negative = more unpleasant.',
          minimum: -30,
          maximum: 30,
        },
        confusionDelta: {
          type: 'number',
          description: 'Change in cognitive confusion (-30 to +30). Positive = more confused.',
          minimum: -30,
          maximum: 30,
        },
        loadDelta: {
          type: 'number',
          description: 'Change in cognitive load / overwhelm (-30 to +30). Positive = more overwhelmed.',
          minimum: -30,
          maximum: 30,
        },
        trustDelta: {
          type: 'number',
          description: 'Change in relational trust (-30 to +30). Positive = more trusting.',
          minimum: -30,
          maximum: 30,
        },
        rapportDelta: {
          type: 'number',
          description: 'Change in perceived rapport / closeness (-30 to +30). Positive = closer.',
          minimum: -30,
          maximum: 30,
        },
        interestDelta: {
          type: 'number',
          description: 'Change in motivational interest (-30 to +30). Positive = more engaged.',
          minimum: -30,
          maximum: 30,
        },
        cooperativenessDelta: {
          type: 'number',
          description: 'Change in willingness to cooperate (-30 to +30). Positive = more cooperative.',
          minimum: -30,
          maximum: 30,
        },
        reason: {
          type: 'string',
          description: 'Brief explanation of why the affective state changed.',
        },
      },
      required: ['reason'],
    },
  },
  {
    name: 'update_scenario_state',
    description: 'Update the scenario stage or pressure level. Use this to advance the conversation scenario when appropriate. Pressure can only change by ±1 at a time.',
    parameters: {
      type: 'object',
      properties: {
        targetStage: {
          type: 'string',
          enum: ['intro', 'conflict', 'negotiation', 'escalation', 'resolution'],
          description: 'The scenario stage to transition to. Can only advance forward (intro → conflict → negotiation → escalation → resolution).',
        },
        pressureDelta: {
          type: 'number',
          minimum: -1,
          maximum: 1,
          description: 'Change in pressure level. Only -1, 0, or +1 allowed per call. Pressure stays between 1 and 5.',
        },
        reason: {
          type: 'string',
          description: 'Brief explanation of why the scenario state changed.',
        },
      },
      required: ['reason'],
    },
  },
  {
    name: 'trigger_incident',
    description: 'Trigger a dramatic incident in the scenario. Use sparingly - global cooldown of 60 seconds applies, and 120 seconds per incident type. Only one incident per turn is allowed.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: [
            'executive_join', 'customer_escalation', 'deadline_pressure',
            'new_evidence', 'competitor_offer', 'policy_constraint',
            'quality_issue', 'manager_interrupt', 'budget_cut', 'compliance_warning',
          ],
          description: 'Type of incident to trigger.',
        },
        severity: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Severity level of the incident.',
        },
        reason: {
          type: 'string',
          description: 'Brief explanation of why this incident is occurring now.',
        },
      },
      required: ['type', 'severity', 'reason'],
    },
  },
];

export const SWITCH_PERSONA_TOOL = {
  name: 'switch_persona',
  description: 'Switch the active conversation persona. Call this when the user expresses something that triggers a persona transition (e.g., escalates to a higher authority, mentions a decision is beyond their scope, or a triggerHint condition is met). Only available when the scenario has multiple personas.',
  parameters: {
    type: 'object',
    properties: {
      targetPersonaIndex: {
        type: 'number',
        description: 'Index (0-based) of the persona in the scenario personas array to switch to.',
      },
      reason: {
        type: 'string',
        description: 'Brief explanation of why the persona switch is occurring (internal context, not spoken).',
      },
      transitionLine: {
        type: 'string',
        description: 'The spoken line delivered during the transition (e.g., "Let me bring in my manager for this."). This will be the last thing the current persona says.',
      },
    },
    required: ['targetPersonaIndex', 'reason', 'transitionLine'],
  },
};

export function getSimulationToolsConfig() {
  return SIMULATION_TOOLS.map(tool => ({
    functionDeclarations: [tool],
  }));
}

export function getSimulationToolsWithPersonaSwitch() {
  return [...SIMULATION_TOOLS, SWITCH_PERSONA_TOOL].map(tool => ({
    functionDeclarations: [tool],
  }));
}
