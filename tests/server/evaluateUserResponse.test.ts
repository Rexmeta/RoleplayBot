import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { evaluateUserResponse, type EvaluationInput } from '../../server/services/simulation/evaluateUserResponse';
import { createDefaultSimulationState } from '../../server/services/simulation/simulationTypes';

// ─── hoisted mock for the generateContent fn ─────────────────────────────────
const geminiMock = vi.hoisted(() => ({ generateContent: vi.fn() }));

// GoogleGenAI must be mocked with a regular function (not arrow) so `new` works
vi.mock('@google/genai', () => ({
  GoogleGenAI: function MockGoogleGenAI() {
    return { models: { generateContent: geminiMock.generateContent } };
  },
}));

// ─── helpers ─────────────────────────────────────────────────────────────────
function makeInput(overrides: Partial<EvaluationInput> = {}): EvaluationInput {
  return {
    personaRunId: 'run-001',
    turnId: 'turn-1',
    turnIndex: 0,
    userText: '네, 이해합니다. 제가 담당해서 확인하겠습니다. 해결 방법을 찾아보겠습니다.',
    aiText: '어떻게 생각하시나요?',
    simulationState: createDefaultSimulationState(),
    language: 'ko',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.GOOGLE_API_KEY;
  delete process.env.GEMINI_API_KEY;
});

afterEach(() => {
  delete process.env.GOOGLE_API_KEY;
  delete process.env.GEMINI_API_KEY;
});

// ─── skip logic ──────────────────────────────────────────────────────────────
describe('evaluateUserResponse – skip for very short input', () => {
  it('returns skipped: true with zero scores for text < 10 chars', async () => {
    const result = await evaluateUserResponse(makeInput({ userText: 'hi' }));
    expect(result.skipped).toBe(true);
    expect(result.method).toBe('skipped');
    expect(result.turnScore.total).toBe(0);
    expect(result.turnScore.clarity).toBe(0);
    expect(result.turnScore.empathy).toBe(0);
    expect(result.emotionDelta).toEqual({});
  });

  it('returns skipped: true for whitespace-only text', async () => {
    const result = await evaluateUserResponse(makeInput({ userText: '   ' }));
    expect(result.skipped).toBe(true);
  });

  it('preserves turnId and turnIndex in the skipped score', async () => {
    const result = await evaluateUserResponse(makeInput({ userText: 'ok', turnId: 'turn-5', turnIndex: 5 }));
    expect(result.turnScore.turnId).toBe('turn-5');
    expect(result.turnScore.turnIndex).toBe(5);
  });
});

// ─── rule-based fallback (no API key) ────────────────────────────────────────
describe('evaluateUserResponse – rule-based evaluation (no API key)', () => {
  it('returns a TurnScore with all 5 dimensions when GOOGLE_API_KEY is not set', async () => {
    const result = await evaluateUserResponse(makeInput());
    expect(result.method).toBe('rule');
    expect(result.skipped).toBe(false);
    const { turnScore } = result;
    expect(turnScore).toHaveProperty('clarity');
    expect(turnScore).toHaveProperty('empathy');
    expect(turnScore).toHaveProperty('logic');
    expect(turnScore).toHaveProperty('ownership');
    expect(turnScore).toHaveProperty('actionPlan');
    expect(turnScore).toHaveProperty('total');
    expect(turnScore.evaluationMethod).toBe('rule');
  });

  it('all score dimensions are in range [0, 100]', async () => {
    const result = await evaluateUserResponse(makeInput());
    const { turnScore } = result;
    for (const dim of ['clarity', 'empathy', 'logic', 'ownership', 'actionPlan', 'total'] as const) {
      const val = turnScore[dim] as number;
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(100);
    }
  });

  it('turnScore carries through the correct turnId and turnIndex', async () => {
    const result = await evaluateUserResponse(makeInput({ turnId: 'turn-99', turnIndex: 9 }));
    expect(result.turnScore.turnId).toBe('turn-99');
    expect(result.turnScore.turnIndex).toBe(9);
  });

  it('longer text with empathy keywords scores higher or equal empathy', async () => {
    const shortResult = await evaluateUserResponse(makeInput({ userText: 'I can help you with that.' }));
    const longEmpathyResult = await evaluateUserResponse(makeInput({
      userText: 'I understand your concern and I appreciate you bringing this to my attention. I will take responsibility and resolve this as soon as possible. I empathize with the difficulty you are facing. Thank you for your patience during this difficult time.',
    }));
    expect(longEmpathyResult.turnScore.empathy).toBeGreaterThanOrEqual(shortResult.turnScore.empathy);
  });

  it('text with logic connectors scores higher or equal logic', async () => {
    const baseResult = await evaluateUserResponse(makeInput({ userText: 'I will fix this now, please wait for me.' }));
    const logicResult = await evaluateUserResponse(makeInput({
      userText: 'Because of the system overload, therefore we need to scale up. As a result, we will resolve the issue. Since we have the resources, thus the plan is feasible and we can proceed.',
    }));
    expect(logicResult.turnScore.logic).toBeGreaterThanOrEqual(baseResult.turnScore.logic);
  });

  it('returns an emotionDelta object', async () => {
    const result = await evaluateUserResponse(makeInput());
    expect(typeof result.emotionDelta).toBe('object');
  });

  it('respects evaluationHarness dimension weights', async () => {
    const resultCustom = await evaluateUserResponse(makeInput({
      userText: 'I understand your concern. Because of these reasons, I will take full responsibility and implement a solution by Friday.',
      evaluationHarness: {
        dimensions: [
          { key: 'clarity', weight: 1.0 },
          { key: 'empathy', weight: 0.0 },
          { key: 'logic', weight: 0.0 },
          { key: 'ownership', weight: 0.0 },
          { key: 'actionPlan', weight: 0.0 },
        ],
      },
    }));

    expect(resultCustom.turnScore.total).toBe(resultCustom.turnScore.clarity);
  });
});

// ─── LLM path ────────────────────────────────────────────────────────────────
describe('evaluateUserResponse – LLM evaluation when API key is available', () => {
  beforeEach(() => {
    process.env.GOOGLE_API_KEY = 'fake-key-for-test';
  });

  it('uses LLM scores when generateContent returns valid JSON', async () => {
    geminiMock.generateContent.mockResolvedValueOnce({
      candidates: [{
        content: {
          parts: [{ text: JSON.stringify({ clarity: 75, empathy: 80, logic: 70, ownership: 65, actionPlan: 60, confidence: 85 }) }],
        },
      }],
    });

    const result = await evaluateUserResponse(makeInput());
    expect(result.method).toBe('llm');
    expect(result.skipped).toBe(false);
    expect(result.turnScore.evaluationMethod).toBe('llm');
    expect(result.turnScore.clarity).toBe(75);
    expect(result.turnScore.empathy).toBe(80);
    expect(result.turnScore.logic).toBe(70);
    expect(result.turnScore.ownership).toBe(65);
    expect(result.turnScore.actionPlan).toBe(60);
  });

  it('clamps LLM scores that are out of range', async () => {
    geminiMock.generateContent.mockResolvedValueOnce({
      candidates: [{
        content: {
          parts: [{ text: JSON.stringify({ clarity: 150, empathy: -10, logic: 50, ownership: 50, actionPlan: 50, confidence: 80 }) }],
        },
      }],
    });

    const result = await evaluateUserResponse(makeInput());
    expect(result.method).toBe('llm');
    expect(result.turnScore.clarity).toBe(100);
    expect(result.turnScore.empathy).toBe(0);
  });

  it('falls back to rule-based when generateContent throws', async () => {
    geminiMock.generateContent.mockRejectedValueOnce(new Error('Network error'));
    const result = await evaluateUserResponse(makeInput());
    expect(result.method).toBe('rule');
    expect(result.skipped).toBe(false);
  });

  it('falls back to rule-based when LLM returns invalid JSON', async () => {
    geminiMock.generateContent.mockResolvedValueOnce({
      candidates: [{
        content: { parts: [{ text: 'not valid json {{{}' }] },
      }],
    });
    const result = await evaluateUserResponse(makeInput());
    expect(result.method).toBe('rule');
  });

  it('falls back to rule-based when LLM times out', async () => {
    geminiMock.generateContent.mockRejectedValueOnce(new Error('LLM evaluation timeout'));
    const result = await evaluateUserResponse(makeInput());
    expect(result.method).toBe('rule');
  });

  it('returns hint from LLM when provided', async () => {
    geminiMock.generateContent.mockResolvedValueOnce({
      candidates: [{
        content: {
          parts: [{ text: JSON.stringify({ clarity: 70, empathy: 70, logic: 70, ownership: 70, actionPlan: 70, confidence: 80, hint: 'Be more specific' }) }],
        },
      }],
    });

    const result = await evaluateUserResponse(makeInput());
    expect(result.turnScore.hint).toBe('Be more specific');
  });
});
