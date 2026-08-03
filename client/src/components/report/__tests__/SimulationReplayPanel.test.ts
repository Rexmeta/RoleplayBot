import { describe, it, expect } from 'vitest';
import {
  computeEmotionTrend,
  computeEmotionDeltasByTurn,
} from '../SimulationReplayPanel';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeAffective(overrides: {
  intensity?: number;
  trust?: number;
  confusion?: number;
  interest?: number;
  rapport?: number;
  load?: number;
  cooperativeness?: number;
} = {}) {
  const { intensity = 10, trust = 60, confusion = 20, interest = 50, rapport = 70, load = 30, cooperativeness = 55 } = overrides;
  return {
    affective: { intensity, valence: 0.3 },
    cognitive: { confusion, load },
    relational: { trust, rapport },
    motivational: { interest, cooperativeness },
  };
}

function makeSimState(opts: {
  version?: number;
  affective?: ReturnType<typeof makeAffective> | null;
} = {}) {
  const { version = 1, affective = makeAffective() } = opts;
  const state: Record<string, unknown> = {
    version,
    recentIncidents: [],
  };
  if (affective !== null) {
    state.npcAffectiveState = affective;
  }
  return state;
}

function makeEvent(overrides: {
  turnIndex?: number;
  eventType?: string;
  stateBefore?: Record<string, unknown> | null;
  stateAfter?: Record<string, unknown> | null;
}): any {
  return {
    id: `ev-${Math.random().toString(36).slice(2)}`,
    eventType: overrides.eventType ?? 'auto_evaluation',
    turnIndex: overrides.turnIndex ?? 0,
    result: null,
    args: null,
    stateBefore: overrides.stateBefore ?? null,
    stateAfter: overrides.stateAfter ?? null,
    stateVersionAfter: null,
    includeInReport: true,
    createdAt: new Date().toISOString(),
  };
}

// ── computeEmotionTrend ────────────────────────────────────────────────────

describe('computeEmotionTrend', () => {
  it('returns empty array when there are no events', () => {
    expect(computeEmotionTrend([])).toEqual([]);
  });

  it('ignores events that are not auto_evaluation', () => {
    const ev = makeEvent({ eventType: 'tool_call', stateAfter: makeSimState() });
    expect(computeEmotionTrend([ev])).toEqual([]);
  });

  it('ignores auto_evaluation events with null stateAfter', () => {
    const ev = makeEvent({ stateAfter: null });
    expect(computeEmotionTrend([ev])).toEqual([]);
  });

  it('ignores auto_evaluation events with invalid stateAfter (missing npcAffectiveState)', () => {
    const ev = makeEvent({ stateAfter: { version: 1, recentIncidents: [] } });
    expect(computeEmotionTrend([ev])).toEqual([]);
  });

  it('extracts basic emotion values for a single turn', () => {
    const aff = makeAffective({ intensity: 15, trust: 65, confusion: 25, interest: 55 });
    const ev = makeEvent({ turnIndex: 0, stateAfter: makeSimState({ affective: aff }) });
    const trend = computeEmotionTrend([ev]);
    expect(trend).toHaveLength(1);
    expect(trend[0]).toMatchObject({ turnIndex: 0, anger: 15, trust: 65, confusion: 25, interest: 55 });
  });

  it('ignores events when stateAfter lacks npcAffectiveState', () => {
    const ev = makeEvent({ turnIndex: 1, stateAfter: makeSimState({ affective: null }) });
    const trend = computeEmotionTrend([ev]);
    expect(trend).toHaveLength(0);
  });

  it('extracts rapport, cognitiveLoad, cooperativeness when npcAffectiveState is present', () => {
    const aff = makeAffective({ rapport: 80, load: 40, cooperativeness: 60 });
    const ev = makeEvent({ turnIndex: 2, stateAfter: makeSimState({ affective: aff }) });
    const trend = computeEmotionTrend([ev]);
    expect(trend[0].rapport).toBe(80);
    expect(trend[0].cognitiveLoad).toBe(40);
    expect(trend[0].cooperativeness).toBe(60);
  });

  it('returns one point per turn, sorted ascending by turnIndex', () => {
    const ev0 = makeEvent({ turnIndex: 2, stateAfter: makeSimState() });
    const ev1 = makeEvent({ turnIndex: 0, stateAfter: makeSimState() });
    const ev2 = makeEvent({ turnIndex: 1, stateAfter: makeSimState() });
    const trend = computeEmotionTrend([ev0, ev1, ev2]);
    expect(trend.map((p) => p.turnIndex)).toEqual([0, 1, 2]);
  });

  it('latest entry wins when a turn has duplicate events', () => {
    const first = makeEvent({
      turnIndex: 0,
      stateAfter: makeSimState({ affective: makeAffective({ trust: 40 }) }),
    });
    const last = makeEvent({
      turnIndex: 0,
      stateAfter: makeSimState({ affective: makeAffective({ trust: 80 }) }),
    });
    const trend = computeEmotionTrend([first, last]);
    expect(trend).toHaveLength(1);
    expect(trend[0].trust).toBe(80);
  });

  it('ignores events without npcAffectiveState while processing those that have it', () => {
    const withAff = makeEvent({
      turnIndex: 0,
      stateAfter: makeSimState({ affective: makeAffective({ rapport: 70 }) }),
    });
    const withoutAff = makeEvent({
      turnIndex: 1,
      stateAfter: makeSimState({ affective: null }),
    });
    const trend = computeEmotionTrend([withAff, withoutAff]);
    expect(trend).toHaveLength(1);
    expect(trend[0].rapport).toBe(70);
  });

  it('correctly reads rapport from relational.rapport in npcAffectiveState', () => {
    const aff = makeAffective({ rapport: 55 });
    // Verify the field path: aff.relational.rapport
    expect(aff.relational.rapport).toBe(55);
    const ev = makeEvent({ stateAfter: makeSimState({ affective: aff }) });
    const trend = computeEmotionTrend([ev]);
    expect(trend[0].rapport).toBe(55);
  });

  it('correctly reads cognitiveLoad from cognitive.load in npcAffectiveState', () => {
    const aff = makeAffective({ load: 25 });
    const ev = makeEvent({ stateAfter: makeSimState({ affective: aff }) });
    const trend = computeEmotionTrend([ev]);
    expect(trend[0].cognitiveLoad).toBe(25);
  });

  it('correctly reads cooperativeness from motivational.cooperativeness in npcAffectiveState', () => {
    const aff = makeAffective({ cooperativeness: 90 });
    const ev = makeEvent({ stateAfter: makeSimState({ affective: aff }) });
    const trend = computeEmotionTrend([ev]);
    expect(trend[0].cooperativeness).toBe(90);
  });
});

// ── computeEmotionDeltasByTurn ─────────────────────────────────────────────

describe('computeEmotionDeltasByTurn', () => {
  it('returns empty map when there are no events', () => {
    expect(computeEmotionDeltasByTurn([])).toEqual(new Map());
  });

  it('ignores non-auto_evaluation events', () => {
    const ev = makeEvent({
      eventType: 'tool_call',
      stateBefore: makeSimState(),
      stateAfter: makeSimState(),
    });
    expect(computeEmotionDeltasByTurn([ev]).size).toBe(0);
  });

  it('ignores auto_evaluation events with null or invalid stateAfter', () => {
    const ev = makeEvent({ stateAfter: null });
    expect(computeEmotionDeltasByTurn([ev]).size).toBe(0);
  });

  it('ignores auto_evaluation events where stateBefore is null (no before to diff)', () => {
    const ev = makeEvent({ stateAfter: makeSimState(), stateBefore: null });
    expect(computeEmotionDeltasByTurn([ev]).size).toBe(0);
  });

  it('computes correct trust and anger deltas for a single turn', () => {
    const before = makeSimState({ affective: makeAffective({ trust: 40, intensity: 20 }) });
    const after  = makeSimState({ affective: makeAffective({ trust: 55, intensity: 10 }) });
    const ev = makeEvent({ turnIndex: 1, stateBefore: before, stateAfter: after });
    const deltas = computeEmotionDeltasByTurn([ev]);
    expect(deltas.get(1)?.trust).toBe(15);
    expect(deltas.get(1)?.anger).toBe(-10);
  });

  it('computes correct interest and confusion deltas', () => {
    const before = makeSimState({ affective: makeAffective({ interest: 30, confusion: 50 }) });
    const after  = makeSimState({ affective: makeAffective({ interest: 45, confusion: 35 }) });
    const ev = makeEvent({ turnIndex: 0, stateBefore: before, stateAfter: after });
    const deltas = computeEmotionDeltasByTurn([ev]);
    expect(deltas.get(0)?.interest).toBe(15);
    expect(deltas.get(0)?.confusion).toBe(-15);
  });

  it('ignores events where both states lack npcAffectiveState', () => {
    const before = makeSimState({ affective: null });
    const after  = makeSimState({ affective: null });
    const ev = makeEvent({ turnIndex: 0, stateBefore: before, stateAfter: after });
    const deltas = computeEmotionDeltasByTurn([ev]);
    expect(deltas.size).toBe(0);
  });

  it('ignores events where stateBefore lacks npcAffectiveState', () => {
    const before = makeSimState({ affective: null });
    const after  = makeSimState({ affective: makeAffective({ rapport: 70 }) });
    const ev = makeEvent({ turnIndex: 0, stateBefore: before, stateAfter: after });
    const deltas = computeEmotionDeltasByTurn([ev]);
    expect(deltas.size).toBe(0);
  });

  it('ignores events where stateAfter lacks npcAffectiveState', () => {
    const before = makeSimState({ affective: makeAffective({ rapport: 70 }) });
    const after  = makeSimState({ affective: null });
    const ev = makeEvent({ turnIndex: 0, stateBefore: before, stateAfter: after });
    const deltas = computeEmotionDeltasByTurn([ev]);
    expect(deltas.size).toBe(0);
  });

  it('computes correct rapport delta when both states have npcAffectiveState', () => {
    const before = makeSimState({ affective: makeAffective({ rapport: 50 }) });
    const after  = makeSimState({ affective: makeAffective({ rapport: 75 }) });
    const ev = makeEvent({ turnIndex: 2, stateBefore: before, stateAfter: after });
    const deltas = computeEmotionDeltasByTurn([ev]);
    expect(deltas.get(2)?.rapport).toBe(25);
  });

  it('computes correct cognitiveLoad delta', () => {
    const before = makeSimState({ affective: makeAffective({ load: 40 }) });
    const after  = makeSimState({ affective: makeAffective({ load: 20 }) });
    const ev = makeEvent({ turnIndex: 3, stateBefore: before, stateAfter: after });
    const deltas = computeEmotionDeltasByTurn([ev]);
    expect(deltas.get(3)?.cognitiveLoad).toBe(-20);
  });

  it('computes correct cooperativeness delta', () => {
    const before = makeSimState({ affective: makeAffective({ cooperativeness: 30 }) });
    const after  = makeSimState({ affective: makeAffective({ cooperativeness: 65 }) });
    const ev = makeEvent({ turnIndex: 4, stateBefore: before, stateAfter: after });
    const deltas = computeEmotionDeltasByTurn([ev]);
    expect(deltas.get(4)?.cooperativeness).toBe(35);
  });

  it('computes deltas for multiple turns independently', () => {
    const ev0 = makeEvent({
      turnIndex: 0,
      stateBefore: makeSimState({ affective: makeAffective({ trust: 40, rapport: 50 }) }),
      stateAfter:  makeSimState({ affective: makeAffective({ trust: 60, rapport: 70 }) }),
    });
    const ev1 = makeEvent({
      turnIndex: 1,
      stateBefore: makeSimState({ affective: makeAffective({ trust: 60, rapport: 70 }) }),
      stateAfter:  makeSimState({ affective: makeAffective({ trust: 50, rapport: 65 }) }),
    });
    const deltas = computeEmotionDeltasByTurn([ev0, ev1]);
    expect(deltas.get(0)?.trust).toBe(20);
    expect(deltas.get(0)?.rapport).toBe(20);
    expect(deltas.get(1)?.trust).toBe(-10);
    expect(deltas.get(1)?.rapport).toBe(-5);
  });

  it('overwrites earlier entry for the same turnIndex with later event', () => {
    const ev_first = makeEvent({
      turnIndex: 0,
      stateBefore: makeSimState({ affective: makeAffective({ trust: 10 }) }),
      stateAfter:  makeSimState({ affective: makeAffective({ trust: 20 }) }),
    });
    const ev_last = makeEvent({
      turnIndex: 0,
      stateBefore: makeSimState({ affective: makeAffective({ trust: 50 }) }),
      stateAfter:  makeSimState({ affective: makeAffective({ trust: 90 }) }),
    });
    const deltas = computeEmotionDeltasByTurn([ev_first, ev_last]);
    expect(deltas.size).toBe(1);
    expect(deltas.get(0)?.trust).toBe(40);
  });

  it('all three affective deltas are computed correctly in a single event', () => {
    const before = makeSimState({
      affective: makeAffective({ rapport: 60, load: 50, cooperativeness: 40 }),
    });
    const after = makeSimState({
      affective: makeAffective({ rapport: 80, load: 30, cooperativeness: 70 }),
    });
    const ev = makeEvent({ turnIndex: 5, stateBefore: before, stateAfter: after });
    const deltas = computeEmotionDeltasByTurn([ev]);
    expect(deltas.get(5)?.rapport).toBe(20);
    expect(deltas.get(5)?.cognitiveLoad).toBe(-20);
    expect(deltas.get(5)?.cooperativeness).toBe(30);
  });
});
