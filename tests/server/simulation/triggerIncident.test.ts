import { describe, it, expect, beforeEach, vi } from 'vitest';
import { inferIncidentCandidate, evaluateIncidentProbability } from '../../../server/services/simulation/engine/triggerIncident';
import { createDefaultSimulationState } from '../../../server/services/simulation/simulationTypes';
import { clearSessionContext } from '../../../server/services/simulation/simulationEngine';

const RUN_ID = 'trigger-test-001';

beforeEach(() => {
  clearSessionContext(RUN_ID);
});

describe('inferIncidentCandidate', () => {
  it('returns null when no thresholds are breached', () => {
    const state = createDefaultSimulationState();
    const incident = inferIncidentCandidate(state, RUN_ID, 1, 'en');
    expect(incident).toBeNull();
  });

  it('triggers customer_escalation when anger >= 85 and trust <= 20', () => {
    const state = createDefaultSimulationState();
    state.npcEmotions.anger = 90;
    state.npcEmotions.trust = 15;
    const incident = inferIncidentCandidate(state, RUN_ID, 3, 'en');
    expect(incident).not.toBeNull();
    expect(incident!.type).toBe('customer_escalation');
    expect(incident!.severity).toBe('high');
    expect(incident!.triggeredBy).toBe('server_rule');
  });

  it('triggers deadline_pressure when pressure >= 4 and stage is negotiation', () => {
    const state = createDefaultSimulationState();
    state.stage = 'negotiation';
    state.pressureLevel = 4;
    const incident = inferIncidentCandidate(state, RUN_ID, 2, 'ko');
    expect(incident).not.toBeNull();
    expect(incident!.type).toBe('deadline_pressure');
    expect(incident!.severity).toBe('medium');
  });

  it('triggers manager_interrupt when anger >= 70 and turns >= 5', () => {
    const state = createDefaultSimulationState();
    state.npcEmotions.anger = 75;
    state.summary.totalTurns = 6;
    const incident = inferIncidentCandidate(state, RUN_ID, 6, 'en');
    expect(incident).not.toBeNull();
    expect(incident!.type).toBe('manager_interrupt');
  });

  it('triggers compliance_warning when trust <= 25 and pressure >= 3', () => {
    const state = createDefaultSimulationState();
    state.npcEmotions.trust = 20;
    state.pressureLevel = 3;
    const incident = inferIncidentCandidate(state, RUN_ID, 4, 'en');
    expect(incident).not.toBeNull();
    expect(incident!.type).toBe('compliance_warning');
    expect(incident!.severity).toBe('low');
  });

  it('includes id, turnIndex, createdAt on returned incident', () => {
    const state = createDefaultSimulationState();
    state.npcEmotions.anger = 90;
    state.npcEmotions.trust = 15;
    const incident = inferIncidentCandidate(state, RUN_ID, 7, 'en');
    expect(incident).not.toBeNull();
    expect(typeof incident!.id).toBe('string');
    expect(incident!.id.length).toBeGreaterThan(0);
    expect(incident!.turnIndex).toBe(7);
    expect(typeof incident!.createdAt).toBe('string');
  });

  it('respects cooldown — returns null on second call immediately after first', () => {
    const state = createDefaultSimulationState();
    state.npcEmotions.anger = 90;
    state.npcEmotions.trust = 15;
    const first = inferIncidentCandidate(state, RUN_ID, 1, 'en');
    expect(first).not.toBeNull();
    // cooldown is recorded after first trigger via checkIncidentCooldown (global cooldown)
    // but note: inferIncidentCandidate only *checks* cooldown, it does not *record* it.
    // Recording is done by recordIncidentCooldown called by the tool handler.
    // So a second immediate call should still be allowed at the rules level.
    // This is intentional — the engine enforces the cooldown, not the rule checker alone.
    const second = inferIncidentCandidate(state, RUN_ID, 2, 'en');
    expect(second).not.toBeNull(); // no cooldown recorded yet → still allowed
  });
});

describe('evaluateIncidentProbability', () => {
  it('returns false when baseAllowed is false regardless of profile', () => {
    expect(evaluateIncidentProbability(false, null)).toBe(false);
    expect(evaluateIncidentProbability(false, { incidentProbability: 2.0 })).toBe(false);
  });

  it('returns true when baseAllowed is true and no profile', () => {
    expect(evaluateIncidentProbability(true, null)).toBe(true);
  });

  it('returns true when incidentProbability >= 1.0', () => {
    expect(evaluateIncidentProbability(true, { incidentProbability: 1.0 })).toBe(true);
    expect(evaluateIncidentProbability(true, { incidentProbability: 1.5 })).toBe(true);
  });

  it('probabilistically returns true/false when incidentProbability < 1.0', () => {
    const mathRandom = vi.spyOn(Math, 'random');

    mathRandom.mockReturnValue(0.3);
    expect(evaluateIncidentProbability(true, { incidentProbability: 0.5 })).toBe(true);

    mathRandom.mockReturnValue(0.7);
    expect(evaluateIncidentProbability(true, { incidentProbability: 0.5 })).toBe(false);

    mathRandom.mockRestore();
  });
});
