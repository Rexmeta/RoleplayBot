import { describe, it, expect, vi, beforeEach } from 'vitest';
import { evaluateUserResponse } from '../../../server/services/simulation/engine/evaluateUserResponse';
import { createDefaultSimulationState } from '../../../server/services/simulation/simulationTypes';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('evaluateUserResponse (engine re-export)', () => {
  it('skips scoring for very short input', async () => {
    const state = createDefaultSimulationState();
    const result = await evaluateUserResponse({
      personaRunId: 'eval-test-001',
      turnId: 'turn-1',
      turnIndex: 0,
      userText: 'ok',
      aiText: 'How can I help you?',
      simulationState: state,
      language: 'en',
    });
    expect(result.skipped).toBe(true);
    expect(result.method).toBe('skipped');
    expect(result.turnScore.total).toBe(0);
  });

  it('uses rule-based fallback when GOOGLE_API_KEY is absent', async () => {
    const originalKey = process.env.GOOGLE_API_KEY;
    const originalGemini = process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_API_KEY;

    const state = createDefaultSimulationState();
    const result = await evaluateUserResponse({
      personaRunId: 'eval-test-002',
      turnId: 'turn-2',
      turnIndex: 1,
      userText: 'I understand your concern. Because of these reasons, I will take full responsibility and implement a solution by Friday.',
      aiText: 'What do you propose?',
      simulationState: state,
      language: 'en',
    });

    expect(result.skipped).toBe(false);
    expect(result.method).toBe('rule');
    expect(result.turnScore.total).toBeGreaterThan(0);
    expect(result.emotionDelta).toBeDefined();

    if (originalKey !== undefined) process.env.GOOGLE_API_KEY = originalKey;
    if (originalGemini !== undefined) process.env.GEMINI_API_KEY = originalGemini;
  });

  it('produces an emotion delta from rule-based evaluation', async () => {
    const originalKey = process.env.GOOGLE_API_KEY;
    const originalGemini = process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_API_KEY;

    const state = createDefaultSimulationState();
    const result = await evaluateUserResponse({
      personaRunId: 'eval-test-003',
      turnId: 'turn-3',
      turnIndex: 2,
      userText: 'I sincerely apologize and understand your frustration. I will resolve this immediately.',
      aiText: 'This is unacceptable.',
      simulationState: state,
      language: 'en',
    });

    expect(result.emotionDelta).toBeDefined();
    expect(typeof result.emotionDelta).toBe('object');

    if (originalKey !== undefined) process.env.GOOGLE_API_KEY = originalKey;
    if (originalGemini !== undefined) process.env.GEMINI_API_KEY = originalGemini;
  });

  it('respects evaluationHarness dimension weights', async () => {
    const originalKey = process.env.GOOGLE_API_KEY;
    const originalGemini = process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_API_KEY;

    const state = createDefaultSimulationState();
    const resultDefault = await evaluateUserResponse({
      personaRunId: 'eval-test-004a',
      turnId: 'turn-4a',
      turnIndex: 3,
      userText: 'I understand your concern. Because of these reasons, I will take full responsibility and implement a solution by Friday.',
      aiText: 'What do you propose?',
      simulationState: state,
      language: 'en',
    });

    const resultCustom = await evaluateUserResponse({
      personaRunId: 'eval-test-004b',
      turnId: 'turn-4b',
      turnIndex: 3,
      userText: 'I understand your concern. Because of these reasons, I will take full responsibility and implement a solution by Friday.',
      aiText: 'What do you propose?',
      simulationState: state,
      language: 'en',
      evaluationHarness: {
        dimensions: [
          { key: 'clarity', weight: 1.0 },
          { key: 'empathy', weight: 0.0 },
          { key: 'logic', weight: 0.0 },
          { key: 'ownership', weight: 0.0 },
          { key: 'actionPlan', weight: 0.0 },
        ],
      },
    });

    // With clarity-only harness, total should equal the clarity score
    expect(resultCustom.turnScore.total).toBe(resultCustom.turnScore.clarity);

    if (originalKey !== undefined) process.env.GOOGLE_API_KEY = originalKey;
    if (originalGemini !== undefined) process.env.GEMINI_API_KEY = originalGemini;
  });
});
