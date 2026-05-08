import { describe, it, expect } from 'vitest';
import {
  applyEvidenceScoreCap,
  makeInsufficientEvidenceFallback,
  isValidEvidenceItem,
  NO_EVIDENCE_SCORE_CAP,
} from '../../server/services/evaluationEngine';

describe('applyEvidenceScoreCap', () => {
  const dims = [{ key: 'clarityLogic' }, { key: 'listeningEmpathy' }];

  it('does not cap a dimension when evidence is present', () => {
    const scores = { clarityLogic: 9, listeningEmpathy: 8 };
    const evidenceMap = {
      clarityLogic: [{ turnIndex: 1, quote: 'test', behaviorObserved: 'obs', rubricBand: '9점', reason: 'r' }],
      listeningEmpathy: [{ turnIndex: 2, quote: 'test2', behaviorObserved: 'obs2', rubricBand: '8점', reason: 'r2' }],
    };
    const result = applyEvidenceScoreCap(scores, evidenceMap, dims);
    expect(result.scores.clarityLogic).toBe(9);
    expect(result.scores.listeningEmpathy).toBe(8);
    expect(result.cappedDimensions).toHaveLength(0);
  });

  it('caps a dimension score to NO_EVIDENCE_SCORE_CAP when evidence is empty', () => {
    const scores = { clarityLogic: 7, listeningEmpathy: 9 };
    const evidenceMap = {
      clarityLogic: [],
      listeningEmpathy: [],
    };
    const result = applyEvidenceScoreCap(scores, evidenceMap, dims);
    expect(result.scores.clarityLogic).toBe(NO_EVIDENCE_SCORE_CAP);
    expect(result.scores.listeningEmpathy).toBe(NO_EVIDENCE_SCORE_CAP);
    expect(result.cappedDimensions).toContain('clarityLogic');
    expect(result.cappedDimensions).toContain('listeningEmpathy');
  });

  it('does not cap a score already at or below the cap', () => {
    const scores = { clarityLogic: 3, listeningEmpathy: 4 };
    const evidenceMap = { clarityLogic: [], listeningEmpathy: [] };
    const result = applyEvidenceScoreCap(scores, evidenceMap, dims);
    expect(result.scores.clarityLogic).toBe(3);
    expect(result.scores.listeningEmpathy).toBe(4);
    expect(result.cappedDimensions).toHaveLength(0);
  });

  it('caps only the dimensions missing evidence, not those with evidence', () => {
    const scores = { clarityLogic: 9, listeningEmpathy: 9 };
    const evidenceMap = {
      clarityLogic: [{ turnIndex: 1, quote: 'hello', behaviorObserved: 'obs', rubricBand: '9점', reason: 'r' }],
      listeningEmpathy: [],
    };
    const result = applyEvidenceScoreCap(scores, evidenceMap, dims);
    expect(result.scores.clarityLogic).toBe(9);
    expect(result.scores.listeningEmpathy).toBe(NO_EVIDENCE_SCORE_CAP);
    expect(result.cappedDimensions).toEqual(['listeningEmpathy']);
  });
});

describe('makeInsufficientEvidenceFallback', () => {
  it('returns an object with isSystemFallback: true', () => {
    const fallback = makeInsufficientEvidenceFallback(false);
    expect(fallback.isSystemFallback).toBe(true);
  });

  it('has turnIndex -1 as sentinel indicating no real conversation turn', () => {
    const fallback = makeInsufficientEvidenceFallback(false);
    expect(fallback.turnIndex).toBe(-1);
  });

  it('has empty quote (no fabricated conversation content)', () => {
    const fallback = makeInsufficientEvidenceFallback(false);
    expect(fallback.quote).toBe('');
  });

  it('when wasCapped=true rubricBand mentions the cap limit', () => {
    const fallback = makeInsufficientEvidenceFallback(true);
    expect(fallback.rubricBand).toContain(String(NO_EVIDENCE_SCORE_CAP));
  });

  it('when wasCapped=false rubricBand does not mention the cap limit', () => {
    const fallback = makeInsufficientEvidenceFallback(false);
    expect(fallback.rubricBand).not.toContain(String(NO_EVIDENCE_SCORE_CAP));
  });

  it('returned object satisfies the EvaluationEvidence shape (all required fields present)', () => {
    const fallback = makeInsufficientEvidenceFallback(true);
    expect(typeof fallback.behaviorObserved).toBe('string');
    expect(fallback.behaviorObserved.length).toBeGreaterThan(0);
    expect(typeof fallback.reason).toBe('string');
    expect(fallback.reason.length).toBeGreaterThan(0);
  });
});

describe('isValidEvidenceItem', () => {
  it('accepts an item with valid turnIndex and non-empty quote', () => {
    expect(isValidEvidenceItem({ turnIndex: 1, quote: '안녕하세요', reason: '' })).toBe(true);
  });

  it('accepts an item with valid turnIndex and non-empty reason (even if quote is empty)', () => {
    expect(isValidEvidenceItem({ turnIndex: 2, quote: '', reason: '명확한 설명을 제공함' })).toBe(true);
  });

  it('rejects an item where both quote and reason are empty strings', () => {
    expect(isValidEvidenceItem({ turnIndex: 1, quote: '', reason: '' })).toBe(false);
  });

  it('rejects an item with turnIndex < 0 (sentinel for system-generated items)', () => {
    expect(isValidEvidenceItem({ turnIndex: -1, quote: '실제 발화', reason: '이유' })).toBe(false);
  });

  it('rejects an item marked isSystemFallback even if other fields are populated', () => {
    expect(isValidEvidenceItem({ turnIndex: 1, quote: '발화', reason: '이유', isSystemFallback: true })).toBe(false);
  });

  it('fallback items produced by makeInsufficientEvidenceFallback always fail validation', () => {
    expect(isValidEvidenceItem(makeInsufficientEvidenceFallback(true))).toBe(false);
    expect(isValidEvidenceItem(makeInsufficientEvidenceFallback(false))).toBe(false);
  });
});
