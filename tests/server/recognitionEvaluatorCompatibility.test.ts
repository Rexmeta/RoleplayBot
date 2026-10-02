import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateUserResponse } from '../../server/services/simulation/engine/evaluateUserResponse';
import { createDefaultSimulationState } from '../../server/services/simulation/simulationTypes';

const state = vi.hoisted(() => ({ run: {} as any, evidence: [] as any[] }));
vi.mock('../../server/storage', () => ({
  storage: {
    getPersonaRun: vi.fn(async () => state.run),
    getSystemSetting: vi.fn().mockResolvedValue(null),
  },
}));
vi.mock('../../server/services/voice/recognitionEvidence', () => ({
  listRecognitionEvidence: vi.fn(async () => state.evidence),
}));

const input = (language: 'ko' | 'en' | 'ja' | 'zh') => ({
  personaRunId: 'run', turnId: 'voice-user:session:1', turnIndex: 0,
  userText: 'I understand the problem and will confirm the next steps.',
  aiText: 'What will you do?', simulationState: createDefaultSimulationState(), language,
});

describe('recognition scope at the simulation evaluation boundary', () => {
  beforeEach(() => {
    state.run = { voiceRecognitionRequired: false };
    state.evidence = [];
    vi.stubEnv('GOOGLE_API_KEY', '');
    vi.stubEnv('GEMINI_API_KEY', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(['en', 'ja', 'zh', 'ko'] as const)('preserves %s/legacy voice evaluation without a recognition-required run', async language => {
    const result = await evaluateUserResponse(input(language));
    expect(result.method).toBe('rule');
    expect(result.skipped).toBe(false);
  });
  it('blocks an unregistered utterance in a recognition-required run regardless of caller language', async () => {
    state.run.voiceRecognitionRequired = true;
    await expect(evaluateUserResponse(input('en'))).rejects.toThrow('voice_recognition_confirmation_required');
  });
  it('blocks unresolved evidence even when a legacy run lacks the marker', async () => {
    state.evidence = [{ id: input('ko').turnId, status: 'needs_confirmation', canonicalText: null }];
    await expect(evaluateUserResponse(input('ko'))).rejects.toThrow('voice_recognition_confirmation_required');
  });
  it('evaluates server-approved canonical content, not supplied raw text', async () => {
    state.run.voiceRecognitionRequired = true;
    state.evidence = [{
      id: input('ko').turnId, status: 'confirmed',
      canonicalText: '제가 담당해서 확인하고 다음 주까지 조치하겠습니다.',
    }];
    const result = await evaluateUserResponse({ ...input('ko'), userText: 'hi' });
    expect(result.skipped).toBe(false);
    expect(result.method).toBe('rule');
  });
});