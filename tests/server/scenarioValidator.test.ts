import { describe, it, expect } from 'vitest';
import { validateScenario } from '../../server/services/scenarios/scenarioValidator';
import type { Scenario } from '@shared/schema';
import type { ScenarioTranslation } from '@shared/schema';

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: 'test-scenario',
    title: 'Test Scenario',
    description: 'A test scenario',
    sourceLocale: 'ko',
    difficulty: 2,
    estimatedTime: '10 minutes',
    skills: [],
    categoryId: null,
    image: null,
    imagePrompt: null,
    introVideoUrl: null,
    videoPrompt: null,
    objectiveType: null,
    context: null,
    objectives: [],
    successCriteria: { optimal: 'A', good: 'B', acceptable: 'C', failure: 'D' },
    personas: [
      {
        id: 'p1',
        name: 'Alice',
        department: 'Sales',
        position: 'Manager',
        experience: '5 years',
        personaRef: 'mbti-001',
        stance: 'neutral',
        goal: 'resolve issue',
        tradeoff: 'none',
        isPrimary: true,
      },
    ],
    recommendedFlow: [],
    flowGraph: null,
    personaSwitchRules: null,
    evaluationCriteriaSetId: null,
    targetDurationMinutes: 7,
    targetTurns: 10,
    minValidTurns: 4,
    evaluationHarness: null,
    terminationRules: null,
    playerConstraints: { authorityLevel: 'junior' },
    difficultyProfile: null,
    personaSwitchMode: null,
    simulationHarness: null,
    isDemo: false,
    isPublic: true,
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Scenario;
}

function makeTranslation(locale: string, scenarioId = 'test-scenario'): ScenarioTranslation {
  return {
    id: `tr-${locale}`,
    scenarioId,
    sourceLocale: 'ko',
    locale,
    isOriginal: false,
    title: `Title (${locale})`,
    description: null,
    situation: null,
    timeline: null,
    stakes: null,
    playerRole: null,
    objectives: null,
    successCriteriaOptimal: null,
    successCriteriaGood: null,
    successCriteriaAcceptable: null,
    successCriteriaFailure: null,
    skills: null,
    personaContexts: null,
    isMachineTranslated: false,
    isReviewed: false,
    reviewedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as ScenarioTranslation;
}

const VALID_PERSONA_IDS = new Set(['mbti-001', 'mbti-002']);

describe('validateScenario', () => {
  describe('perfect scenario — all 10 checks pass', () => {
    it('returns score 100 and no issues', () => {
      const result = validateScenario(makeScenario(), VALID_PERSONA_IDS, [], ['ko']);
      expect(result.score).toBe(100);
      expect(result.issues).toHaveLength(0);
      expect(result.hasFatalErrors).toBe(false);
    });
  });

  // ─── Check 1: exactly one primary persona ──────────────────────────────────

  describe('Check 1 — primary persona', () => {
    it('passes when exactly one persona has isPrimary=true', () => {
      const result = validateScenario(makeScenario(), VALID_PERSONA_IDS, [], ['ko']);
      expect(result.issues.find(i => i.check === 1)).toBeUndefined();
    });

    it('fails when no persona has isPrimary=true', () => {
      const scenario = makeScenario({
        personas: [{ id: 'p1', name: 'Alice', department: 'Sales', position: 'Mgr', experience: '1y', personaRef: 'mbti-001', stance: 'n', goal: 'g', tradeoff: 't', isPrimary: false }] as any,
      });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      const issue = result.issues.find(i => i.check === 1);
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('error');
      expect(issue!.key).toBe('primary_persona');
    });

    it('fails when more than one persona has isPrimary=true', () => {
      const scenario = makeScenario({
        personas: [
          { id: 'p1', name: 'Alice', department: 'Sales', position: 'Mgr', experience: '1y', personaRef: 'mbti-001', stance: 'n', goal: 'g', tradeoff: 't', isPrimary: true },
          { id: 'p2', name: 'Bob', department: 'Sales', position: 'Rep', experience: '1y', personaRef: 'mbti-002', stance: 'n', goal: 'g', tradeoff: 't', isPrimary: true },
        ] as any,
      });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      const issue = result.issues.find(i => i.check === 1);
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('error');
      expect(issue!.message).toContain('2');
    });

    it('marks hasFatalErrors=true when primary persona check fails', () => {
      const scenario = makeScenario({
        personas: [] as any,
      });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      expect(result.hasFatalErrors).toBe(true);
    });
  });

  // ─── Check 2: personaRef resolution ────────────────────────────────────────

  describe('Check 2 — personaRef resolution', () => {
    it('passes when all personaRefs exist in allMbtiPersonaIds', () => {
      const result = validateScenario(makeScenario(), VALID_PERSONA_IDS, [], ['ko']);
      expect(result.issues.find(i => i.check === 2)).toBeUndefined();
    });

    it('passes when a persona has no personaRef (optional)', () => {
      const scenario = makeScenario({
        personas: [{ id: 'p1', name: 'Alice', department: 'Sales', position: 'Mgr', experience: '1y', personaRef: '', stance: 'n', goal: 'g', tradeoff: 't', isPrimary: true }] as any,
      });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      expect(result.issues.find(i => i.check === 2)).toBeUndefined();
    });

    it('fails when a personaRef does not exist in allMbtiPersonaIds', () => {
      const scenario = makeScenario({
        personas: [{ id: 'p1', name: 'Alice', department: 'Sales', position: 'Mgr', experience: '1y', personaRef: 'mbti-999', stance: 'n', goal: 'g', tradeoff: 't', isPrimary: true }] as any,
      });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      const issue = result.issues.find(i => i.check === 2);
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('error');
      expect(issue!.key).toBe('persona_ref');
      expect(issue!.message).toContain('mbti-999');
    });

    it('lists multiple invalid refs in one issue', () => {
      const scenario = makeScenario({
        personas: [
          { id: 'p1', name: 'Alice', department: 'S', position: 'M', experience: '1y', personaRef: 'bad-1', stance: 'n', goal: 'g', tradeoff: 't', isPrimary: true },
          { id: 'p2', name: 'Bob', department: 'S', position: 'R', experience: '1y', personaRef: 'bad-2', stance: 'n', goal: 'g', tradeoff: 't', isPrimary: false },
        ] as any,
      });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      const issue = result.issues.find(i => i.check === 2);
      expect(issue).toBeDefined();
      expect(issue!.message).toContain('bad-1');
      expect(issue!.message).toContain('bad-2');
    });
  });

  // ─── Check 3: targetTurns >= minValidTurns ──────────────────────────────────

  describe('Check 3 — targetTurns vs minValidTurns', () => {
    it('passes when targetTurns equals minValidTurns', () => {
      const scenario = makeScenario({ targetTurns: 4, minValidTurns: 4 });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      expect(result.issues.find(i => i.check === 3)).toBeUndefined();
    });

    it('passes when targetTurns is greater than minValidTurns', () => {
      const scenario = makeScenario({ targetTurns: 10, minValidTurns: 4 });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      expect(result.issues.find(i => i.check === 3)).toBeUndefined();
    });

    it('fails when targetTurns is less than minValidTurns', () => {
      const scenario = makeScenario({ targetTurns: 2, minValidTurns: 5 });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      const issue = result.issues.find(i => i.check === 3);
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('warning');
      expect(issue!.key).toBe('turns_config');
      expect(issue!.message).toContain('2');
      expect(issue!.message).toContain('5');
    });
  });

  // ─── Check 4: successCriteria ───────────────────────────────────────────────

  describe('Check 4 — successCriteria', () => {
    it('passes when successCriteria has at least one field', () => {
      const result = validateScenario(makeScenario(), VALID_PERSONA_IDS, [], ['ko']);
      expect(result.issues.find(i => i.check === 4)).toBeUndefined();
    });

    it('fails when successCriteria is null', () => {
      const scenario = makeScenario({ successCriteria: null } as any);
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      const issue = result.issues.find(i => i.check === 4);
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('warning');
      expect(issue!.key).toBe('success_criteria');
    });

    it('fails when successCriteria is an empty object', () => {
      const scenario = makeScenario({ successCriteria: {} as any });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      const issue = result.issues.find(i => i.check === 4);
      expect(issue).toBeDefined();
    });

    it('passes when only one field of successCriteria is set', () => {
      const scenario = makeScenario({ successCriteria: { optimal: 'Great job', good: '', acceptable: '', failure: '' } });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      expect(result.issues.find(i => i.check === 4)).toBeUndefined();
    });
  });

  // ─── Check 5: objectives and evaluationHarness alignment ───────────────────

  describe('Check 5 — objectives / evaluationHarness alignment', () => {
    it('passes when there are no objectives (harness not required)', () => {
      const scenario = makeScenario({ objectives: [] });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      expect(result.issues.find(i => i.check === 5)).toBeUndefined();
    });

    it('passes when objectives and evaluationHarness are both present', () => {
      const scenario = makeScenario({
        objectives: ['communicate clearly'],
        evaluationHarness: { dimensions: [{ key: 'clarity', weight: 1 }] } as any,
      });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      expect(result.issues.find(i => i.check === 5)).toBeUndefined();
    });

    it('fails when objectives exist but evaluationHarness is null', () => {
      const scenario = makeScenario({ objectives: ['communicate clearly'], evaluationHarness: null });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      const issue = result.issues.find(i => i.check === 5);
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('info');
      expect(issue!.key).toBe('objectives_harness');
    });

    it('fails when objectives exist but evaluationHarness has no dimensions or passingRule', () => {
      const scenario = makeScenario({
        objectives: ['communicate clearly'],
        evaluationHarness: { dimensions: [] } as any,
      });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      expect(result.issues.find(i => i.check === 5)).toBeDefined();
    });

    it('passes when evaluationHarness has passingRule only (no dimensions)', () => {
      const scenario = makeScenario({
        objectives: ['communicate clearly'],
        evaluationHarness: { passingRule: { minAverageScore: 70 } } as any,
      });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      expect(result.issues.find(i => i.check === 5)).toBeUndefined();
    });
  });

  // ─── Check 6: triggerHints / switchRules conflict ───────────────────────────

  describe('Check 6 — triggerHints / switchRules conflict', () => {
    it('passes when there are no switchRules', () => {
      const result = validateScenario(makeScenario(), VALID_PERSONA_IDS, [], ['ko']);
      expect(result.issues.find(i => i.check === 6)).toBeUndefined();
    });

    it('passes when switchRules exist but no persona has both triggerHints and is a switch target', () => {
      const scenario = makeScenario({
        personas: [
          { id: 'p1', name: 'Alice', department: 'S', position: 'M', experience: '1y', personaRef: 'mbti-001', stance: 'n', goal: 'g', tradeoff: 't', isPrimary: true, triggerHints: ['hint1'] },
          { id: 'p2', name: 'Bob', department: 'S', position: 'R', experience: '1y', personaRef: 'mbti-002', stance: 'n', goal: 'g', tradeoff: 't', isPrimary: false },
        ] as any,
        personaSwitchRules: {
          rules: [{ id: 'rule1', targetPersonaIndex: 1, conditions: [{ metric: 'trust', operator: 'gte', value: 80 }], reason: 'high trust' }],
        } as any,
      });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      expect(result.issues.find(i => i.check === 6)).toBeUndefined();
    });

    it('fails when a persona with triggerHints is also a switchRule target', () => {
      const scenario = makeScenario({
        personas: [
          { id: 'p1', name: 'Alice', department: 'S', position: 'M', experience: '1y', personaRef: 'mbti-001', stance: 'n', goal: 'g', tradeoff: 't', isPrimary: true },
          { id: 'p2', name: 'Bob', department: 'S', position: 'R', experience: '1y', personaRef: 'mbti-002', stance: 'n', goal: 'g', tradeoff: 't', isPrimary: false, triggerHints: ['some_hint'] },
        ] as any,
        personaSwitchRules: {
          rules: [{ id: 'rule1', targetPersonaIndex: 1, conditions: [{ metric: 'trust', operator: 'gte', value: 80 }], reason: 'high trust' }],
        } as any,
      });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      const issue = result.issues.find(i => i.check === 6);
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('warning');
      expect(issue!.key).toBe('trigger_switch_conflict');
      expect(issue!.message).toContain('Bob');
    });
  });

  // ─── Check 7: incident types ────────────────────────────────────────────────

  describe('Check 7 — incident types', () => {
    it('passes when no simulationHarness is set', () => {
      const result = validateScenario(makeScenario({ simulationHarness: null }), VALID_PERSONA_IDS, [], ['ko']);
      expect(result.issues.find(i => i.check === 7)).toBeUndefined();
    });

    it('passes when no allowedTypes are defined', () => {
      const scenario = makeScenario({
        simulationHarness: { toolPolicy: { triggerIncident: {} } } as any,
      });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      expect(result.issues.find(i => i.check === 7)).toBeUndefined();
    });

    it('passes when all allowedTypes are known', () => {
      const scenario = makeScenario({
        simulationHarness: {
          toolPolicy: { triggerIncident: { allowedTypes: ['executive_join', 'budget_cut', 'quality_issue'] } },
        } as any,
      });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      expect(result.issues.find(i => i.check === 7)).toBeUndefined();
    });

    it('fails when an unknown incident type is used', () => {
      const scenario = makeScenario({
        simulationHarness: {
          toolPolicy: { triggerIncident: { allowedTypes: ['executive_join', 'alien_invasion'] } },
        } as any,
      });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      const issue = result.issues.find(i => i.check === 7);
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('warning');
      expect(issue!.key).toBe('incident_types');
      expect(issue!.message).toContain('alien_invasion');
    });

    it('lists multiple unknown types in the message', () => {
      const scenario = makeScenario({
        simulationHarness: {
          toolPolicy: { triggerIncident: { allowedTypes: ['ghost_event', 'alien_invasion'] } },
        } as any,
      });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      const issue = result.issues.find(i => i.check === 7);
      expect(issue).toBeDefined();
      expect(issue!.message).toContain('ghost_event');
      expect(issue!.message).toContain('alien_invasion');
    });
  });

  // ─── Check 8: playerConstraints ────────────────────────────────────────────

  describe('Check 8 — playerConstraints', () => {
    it('passes when playerConstraints has a non-empty field', () => {
      const scenario = makeScenario({ playerConstraints: { authorityLevel: 'junior' } });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      expect(result.issues.find(i => i.check === 8)).toBeUndefined();
    });

    it('passes when playerConstraints has a non-empty array', () => {
      const scenario = makeScenario({ playerConstraints: { canOffer: ['discount'] } });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      expect(result.issues.find(i => i.check === 8)).toBeUndefined();
    });

    it('fails when playerConstraints is null', () => {
      const scenario = makeScenario({ playerConstraints: null });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      const issue = result.issues.find(i => i.check === 8);
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('info');
      expect(issue!.key).toBe('player_constraints');
    });

    it('fails when playerConstraints is an empty object', () => {
      const scenario = makeScenario({ playerConstraints: {} as any });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      expect(result.issues.find(i => i.check === 8)).toBeDefined();
    });

    it('fails when all constraint arrays are empty', () => {
      const scenario = makeScenario({ playerConstraints: { canOffer: [], cannotOffer: [] } });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      expect(result.issues.find(i => i.check === 8)).toBeDefined();
    });
  });

  // ─── Check 9: flowGraph cycle and dead-end detection ───────────────────────

  describe('Check 9 — flowGraph cycle / dead-end detection', () => {
    it('passes when flowGraph is null (no graph to check)', () => {
      const result = validateScenario(makeScenario({ flowGraph: null }), VALID_PERSONA_IDS, [], ['ko']);
      expect(result.issues.find(i => i.check === 9)).toBeUndefined();
    });

    it('passes for a valid linear flow ending at terminal sentinel', () => {
      const scenario = makeScenario({
        flowGraph: {
          stages: [
            { id: 'intro', goal: 'g', exitConditions: [], nextStage: 'main' },
            { id: 'main', goal: 'g', exitConditions: [], nextStage: 'end' },
          ],
        } as any,
      });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      expect(result.issues.find(i => i.check === 9)).toBeUndefined();
    });

    it('passes for "done" and "finish" and "complete" terminal sentinels', () => {
      for (const sentinel of ['done', 'finish', 'complete', '']) {
        const scenario = makeScenario({
          flowGraph: {
            stages: [{ id: 'stage1', goal: 'g', exitConditions: [], nextStage: sentinel }],
          } as any,
        });
        const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
        expect(result.issues.find(i => i.check === 9)).toBeUndefined();
      }
    });

    it('detects a direct self-cycle (A → A)', () => {
      const scenario = makeScenario({
        flowGraph: {
          stages: [{ id: 'loop', goal: 'g', exitConditions: [], nextStage: 'loop' }],
        } as any,
      });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      const issue = result.issues.find(i => i.check === 9 && i.key === 'stage_cycle');
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('warning');
    });

    it('detects a two-node cycle (A → B → A)', () => {
      const scenario = makeScenario({
        flowGraph: {
          stages: [
            { id: 'a', goal: 'g', exitConditions: [], nextStage: 'b' },
            { id: 'b', goal: 'g', exitConditions: [], nextStage: 'a' },
          ],
        } as any,
      });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      expect(result.issues.find(i => i.check === 9 && i.key === 'stage_cycle')).toBeDefined();
    });

    it('detects a longer cycle (A → B → C → A)', () => {
      const scenario = makeScenario({
        flowGraph: {
          stages: [
            { id: 'a', goal: 'g', exitConditions: [], nextStage: 'b' },
            { id: 'b', goal: 'g', exitConditions: [], nextStage: 'c' },
            { id: 'c', goal: 'g', exitConditions: [], nextStage: 'a' },
          ],
        } as any,
      });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      expect(result.issues.find(i => i.check === 9 && i.key === 'stage_cycle')).toBeDefined();
    });

    it('detects a dead-end (broken nextStage pointer)', () => {
      const scenario = makeScenario({
        flowGraph: {
          stages: [
            { id: 'a', goal: 'g', exitConditions: [], nextStage: 'nonexistent' },
          ],
        } as any,
      });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      const issue = result.issues.find(i => i.check === 9 && i.key === 'stage_dead_end');
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('warning');
      expect(issue!.message).toContain('nonexistent');
    });

    it('detects unreachable stages', () => {
      const scenario = makeScenario({
        flowGraph: {
          stages: [
            { id: 'reachable', goal: 'g', exitConditions: [], nextStage: 'end' },
            { id: 'orphan', goal: 'g', exitConditions: [], nextStage: 'end' },
          ],
        } as any,
      });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      const issue = result.issues.find(i => i.check === 9 && i.key === 'stage_dead_end');
      expect(issue).toBeDefined();
      expect(issue!.message).toContain('orphan');
    });

    it('passes for a branching graph where all paths lead to a terminal', () => {
      const scenario = makeScenario({
        flowGraph: {
          stages: [
            { id: 'start', goal: 'g', exitConditions: [], nextStage: 'middle' },
            { id: 'middle', goal: 'g', exitConditions: [], nextStage: 'end' },
          ],
        } as any,
      });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      expect(result.issues.find(i => i.check === 9)).toBeUndefined();
    });
  });

  // ─── Check 10: sourceLocale and translation completeness ───────────────────

  describe('Check 10 — sourceLocale and translation completeness', () => {
    it('passes when sourceLocale is set and only one language is active', () => {
      const result = validateScenario(makeScenario(), VALID_PERSONA_IDS, [], ['ko']);
      expect(result.issues.find(i => i.check === 10)).toBeUndefined();
    });

    it('fails when sourceLocale is null/empty', () => {
      const scenario = makeScenario({ sourceLocale: '' as any });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      const issue = result.issues.find(i => i.check === 10);
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('info');
      expect(issue!.key).toBe('source_locale');
    });

    it('passes when translations cover all active languages except source locale', () => {
      const scenario = makeScenario({ sourceLocale: 'ko' });
      const translations = [makeTranslation('en'), makeTranslation('ja')];
      const result = validateScenario(scenario, VALID_PERSONA_IDS, translations, ['ko', 'en', 'ja']);
      expect(result.issues.find(i => i.check === 10)).toBeUndefined();
    });

    it('fails when translations are missing for some active languages', () => {
      const scenario = makeScenario({ sourceLocale: 'ko' });
      const translations = [makeTranslation('en')];
      const result = validateScenario(scenario, VALID_PERSONA_IDS, translations, ['ko', 'en', 'ja']);
      const issue = result.issues.find(i => i.check === 10 && i.key === 'missing_translations');
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('info');
      expect(issue!.message).toContain('ja');
    });

    it('does not flag sourceLocale itself as a missing translation', () => {
      const scenario = makeScenario({ sourceLocale: 'ko' });
      const translations: ScenarioTranslation[] = [];
      const result = validateScenario(scenario, VALID_PERSONA_IDS, translations, ['ko', 'en']);
      const issue = result.issues.find(i => i.check === 10 && i.key === 'missing_translations');
      expect(issue).toBeDefined();
      expect(issue!.message).not.toContain('ko');
      expect(issue!.message).toContain('en');
    });

    it('skips translation check when only one active language exists', () => {
      const scenario = makeScenario({ sourceLocale: 'ko' });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      expect(result.issues.find(i => i.check === 10)).toBeUndefined();
    });
  });

  // ─── Score calculation ──────────────────────────────────────────────────────

  describe('score calculation — 10 checks × 10 points each', () => {
    it('returns 100 when no checks fail', () => {
      const result = validateScenario(makeScenario(), VALID_PERSONA_IDS, [], ['ko']);
      expect(result.score).toBe(100);
    });

    it('returns 90 when exactly one check fails', () => {
      const scenario = makeScenario({ personas: [] as any });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      const failedChecks = new Set(result.issues.map(i => i.check)).size;
      expect(failedChecks).toBe(1);
      expect(result.score).toBe(90);
    });

    it('returns 80 when two distinct checks fail', () => {
      const scenario = makeScenario({
        personas: [] as any,
        successCriteria: null as any,
      });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      const failedChecks = new Set(result.issues.map(i => i.check)).size;
      expect(failedChecks).toBe(2);
      expect(result.score).toBe(80);
    });

    it('returns 0 when all 10 checks fail', () => {
      // Check 1: 2 primary personas (not exactly 1)
      // Check 2: both personas have invalid personaRefs
      // Check 6: persona at switch-target index 0 also has triggerHints → conflict
      const scenario = makeScenario({
        personas: [
          { id: 'p1', name: 'Alice', department: 'S', position: 'M', experience: '1y', personaRef: 'bad-ref-1', stance: 'n', goal: 'g', tradeoff: 't', isPrimary: true, triggerHints: ['hint'] },
          { id: 'p2', name: 'Bob', department: 'S', position: 'R', experience: '1y', personaRef: 'bad-ref-2', stance: 'n', goal: 'g', tradeoff: 't', isPrimary: true },
        ] as any,
        successCriteria: null as any,
        targetTurns: 1,
        minValidTurns: 10,
        objectives: ['goal'],
        evaluationHarness: null,
        personaSwitchRules: {
          rules: [{ id: 'r1', targetPersonaIndex: 0, conditions: [{ metric: 'm', operator: 'gte', value: 1 }], reason: 'r' }],
        } as any,
        simulationHarness: {
          toolPolicy: { triggerIncident: { allowedTypes: ['totally_unknown_type'] } },
        } as any,
        playerConstraints: null,
        flowGraph: {
          stages: [{ id: 'a', goal: 'g', exitConditions: [], nextStage: 'a' }],
        } as any,
        sourceLocale: '' as any,
      });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      const failedChecks = new Set(result.issues.map(i => i.check));
      expect(failedChecks.size).toBe(10);
      expect(result.score).toBe(0);
    });

    it('multiple issues for the same check do not double-count the deduction', () => {
      const scenario = makeScenario({
        personas: [
          { id: 'p1', name: 'Alice', department: 'S', position: 'M', experience: '1y', personaRef: 'bad-1', stance: 'n', goal: 'g', tradeoff: 't', isPrimary: true },
          { id: 'p2', name: 'Bob', department: 'S', position: 'R', experience: '1y', personaRef: 'bad-2', stance: 'n', goal: 'g', tradeoff: 't', isPrimary: true },
        ] as any,
      });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      const failedCheckNums = new Set(result.issues.map(i => i.check));
      expect(failedCheckNums.has(1)).toBe(true);
      expect(failedCheckNums.has(2)).toBe(true);
      const deduction = failedCheckNums.size * 10;
      expect(result.score).toBe(100 - deduction);
    });
  });

  // ─── Return shape ───────────────────────────────────────────────────────────

  describe('return shape', () => {
    it('returns correct scenarioId and scenarioTitle', () => {
      const scenario = makeScenario({ id: 'my-id', title: 'My Title' });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      expect(result.scenarioId).toBe('my-id');
      expect(result.scenarioTitle).toBe('My Title');
    });

    it('hasFatalErrors is false when only warnings/info are present', () => {
      const scenario = makeScenario({ successCriteria: null as any });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      expect(result.hasFatalErrors).toBe(false);
    });

    it('hasFatalErrors is true only when an error-severity issue exists', () => {
      const scenario = makeScenario({ personas: [] as any });
      const result = validateScenario(scenario, VALID_PERSONA_IDS, [], ['ko']);
      expect(result.hasFatalErrors).toBe(true);
    });
  });
});
