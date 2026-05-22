import { v4 as uuidv4 } from 'uuid';
import type { SimulationState, Incident, IncidentType } from '../simulationTypes';
import { checkIncidentCooldown } from '../simulationEngine';
import { renderIncidentMessage } from '../incidentTemplates';
import type { DifficultyProfile } from '../../../../shared/schema/scenarios';

/**
 * Evaluates heuristic rules to determine if an incident should fire this turn.
 * Returns a fully constructed Incident ready to be added to the state, or null.
 */
export function inferIncidentCandidate(
  state: SimulationState,
  personaRunId: string,
  currentTurnIndex: number,
  language: 'ko' | 'en' | 'ja' | 'zh' = 'ko',
  scenarioContext = ''
): Incident | null {
  const { anger, trust } = state.npcEmotions;
  const pressure = state.pressureLevel;

  let type: IncidentType | null = null;
  let severity: 'low' | 'medium' | 'high' = 'medium';

  if (anger >= 85 && trust <= 20) {
    type = 'customer_escalation';
    severity = 'high';
  } else if (pressure >= 4 && state.stage === 'negotiation') {
    type = 'deadline_pressure';
    severity = 'medium';
  } else if (anger >= 70 && state.summary.totalTurns >= 5) {
    type = 'manager_interrupt';
    severity = 'medium';
  } else if (trust <= 25 && pressure >= 3) {
    type = 'compliance_warning';
    severity = 'low';
  }

  if (!type) return null;

  const cooldown = checkIncidentCooldown(personaRunId, type);
  if (!cooldown.allowed) return null;

  const message = renderIncidentMessage(type, severity, scenarioContext, language);

  return {
    id: uuidv4(),
    type,
    severity,
    message,
    turnIndex: currentTurnIndex,
    triggeredBy: 'server_rule',
    createdAt: new Date().toISOString(),
    resolved: false,
  };
}

/**
 * Scales incident probability using difficultyProfile.incidentProbability.
 * incidentProbability > 1.0 → more incidents (lower effective threshold)
 * incidentProbability < 1.0 → fewer incidents (random suppression)
 */
export function evaluateIncidentProbability(
  baseAllowed: boolean,
  difficultyProfile: DifficultyProfile | undefined | null
): boolean {
  if (!baseAllowed) return false;
  const prob = difficultyProfile?.incidentProbability ?? 1.0;
  if (prob >= 1.0) return true;
  return Math.random() < prob;
}
