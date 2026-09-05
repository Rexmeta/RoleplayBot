import { describe, expect, it } from 'vitest';
import {
  EVALUATION_CRITERIA_SNAPSHOT_KEY,
  RUNTIME_PERSONA_PROFILE_KEY,
  assertImportedSnapshotComplete,
  buildRuntimePersonaProfile,
  findRuntimePersona,
  getSnapshotEvaluationCriteria,
  resolveRuntimeScenario,
} from '../../server/services/runtimeScenario';

describe('imported scenario runtime snapshots', () => {
  const published = {
    id: 'imported-scenario',
    title: 'Imported v1',
    personas: [{
      id: 'buyer',
      name: 'Version one buyer',
      personaRef: 'ENTJ.json',
      [RUNTIME_PERSONA_PROFILE_KEY]: {
        communication_style: 'Direct and evidence-led',
        personality_traits: ['decisive'],
        motivation: 'protect the renewal budget',
        fears: ['unproven value'],
        communication_patterns: {
          opening_style: 'ask for evidence',
          win_conditions: ['secure measurable ROI'],
        },
      },
    }],
    evaluationHarness: { passingRule: { minAverageScore: 70 } },
    [EVALUATION_CRITERIA_SNAPSHOT_KEY]: {
      id: 'criteria-v1',
      version: 1,
      dimensions: [{ key: 'discovery', isActive: true, weight: 100 }],
    },
  };

  it('keeps the bound published scenario, persona, harness, and rubric after live content changes', () => {
    const runtime = resolveRuntimeScenario({
      scenarioId: published.id,
      scenarioSnapshot: published,
      evaluationHarnessSnapshot: { passingRule: { minAverageScore: 80 } },
    }, {
      ...published,
      title: 'Imported v2',
      personas: [{ id: 'buyer', name: 'Version two buyer' }],
      [EVALUATION_CRITERIA_SNAPSHOT_KEY]: { id: 'criteria-v2', dimensions: [] },
    });

    expect(runtime?.title).toBe('Imported v1');
    expect(findRuntimePersona(runtime!, 'entj')?.name).toBe('Version one buyer');
    expect(runtime?.evaluationHarness.passingRule.minAverageScore).toBe(80);
    expect(getSnapshotEvaluationCriteria(runtime!)?.id).toBe('criteria-v1');
    const profile = buildRuntimePersonaProfile(
      findRuntimePersona(runtime!, 'buyer'),
      { communication_style: 'Changed live behavior' },
      true,
    );
    expect(profile.personality).toBe('Direct and evidence-led');
    expect(profile.responseStyle).toBe('ask for evidence');
    expect(profile.goals).toEqual(['secure measurable ROI']);
  });

  it('retains the live path for native legacy and unpublished runs', () => {
    const live = { id: 'native', title: 'Native live', personas: [{ id: 'native-persona' }] };
    const runtime = resolveRuntimeScenario({ scenarioId: 'native' }, live);
    expect(runtime).toEqual(live);
    expect(findRuntimePersona(runtime!, 'native-persona')?.id).toBe('native-persona');
  });

  it('rejects legacy imported versions that cannot provide their historical rubric', () => {
    expect(() => assertImportedSnapshotComplete({
      id: 'legacy-import',
      contentxPackageId: 'package-1',
      evaluationCriteriaSetId: 'mutable-live-criteria',
    })).toThrow('missing its published evaluation criteria');
  });

  it('rejects imported versions that cannot preserve their historical persona behavior', () => {
    expect(() => assertImportedSnapshotComplete({
      id: 'legacy-import',
      contentxPackageId: 'package-1',
      [EVALUATION_CRITERIA_SNAPSHOT_KEY]: { dimensions: [] },
      personas: [{ id: 'buyer', personaRef: 'entj.json' }],
    })).toThrow('missing a published persona runtime profile');
  });
});