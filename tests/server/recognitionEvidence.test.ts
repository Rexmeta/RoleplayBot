import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  row: null as any, messages: [] as any[], run: {} as any, tail: Promise.resolve() as Promise<any>,
}));
vi.mock('../../server/services/voice/evaluateRecognition', () => ({ evaluateRecognition: vi.fn() }));
vi.mock('../../server/services/realtimeVoiceService', () => ({
  realtimeVoiceService: { refreshRecognitionHistory: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../server/storage', async () => {
  const { voiceUtterances, personaRuns } = await import('@shared/schema');
  const db: any = {
    execute: vi.fn().mockResolvedValue(undefined),
    select: () => ({
      from: (table: any) => ({
        where: () => {
          const rows = table === voiceUtterances ? state.row ? [{ ...state.row }] : [] : [{ ...state.run }];
          return { then: (ok: any, fail: any) => Promise.resolve(rows).then(ok, fail), limit: async () => rows };
        },
      }),
    }),
    update: (table: any) => ({
      set: (patch: any) => ({
        where: () => {
          const apply = () => {
            const target = table === personaRuns ? state.run : state.row;
            Object.assign(target, patch);
            return [{ ...target }];
          };
          return { returning: async () => apply(), then: (ok: any, fail: any) => Promise.resolve(apply()).then(ok, fail) };
        },
      }),
    }),
  };
  db.transaction = (callback: any) => {
    const result = state.tail.then(() => callback(db));
    state.tail = result.catch(() => {});
    return result;
  };
  return {
    db, storage: {
      getPersonaRun: async () => state.run,
      getChatMessagesByPersonaRun: async () => state.messages,
      upsertVoiceTranscript: vi.fn(async (message: any) => {
        const existing = state.messages.find(m => m.voiceTurnId === message.voiceTurnId);
        if (!existing) state.messages.push(message);
        return existing ?? message;
      }),
    },
  };
});
import { confirmRecognition, recordSttEvidence, recordProviderEvidence, guardRecognitionReport, prepareRecognitionConversation } from '../../server/services/voice/recognitionEvidence';
import { recognitionRevision } from '../../server/services/voice/recognitionPolicy';
import { evaluateRecognition } from '../../server/services/voice/evaluateRecognition';

describe('server-owned recognition revisions and evaluation eligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.tail = Promise.resolve();
    state.row = {
      id: 'voice-user:test:1', personaRunId: 'run', revision: 1,
      providerText: 'Hola', providerFinal: true, candidateText: null, canonicalText: null,
      status: 'processing', source: null,
    };
    state.messages = [{ sender: 'user', voiceTurnId: state.row.id, message: 'Hola' }];
    state.run = { voiceRecognitionRequired: true, score: 85, feedbackStatus: 'completed' };
  });
  it('preserves raw provider text; different STT text does not become evidence for a score', async () => {
    const row = await recordSttEvidence(state.row.id, '안녕하세요', undefined, 'gpt-4o-mini-transcribe');
    expect(row.providerText).toBe('Hola');
    expect(row.candidateText).toBe('안녕하세요');
    expect(row.canonicalText).toBeNull();
    expect(row.status).toBe('needs_confirmation');
    expect(state.run.score).toBeNull();
    await expect(prepareRecognitionConversation('run', { messages: [] })).rejects.toThrow('voice_recognition_confirmation_required');
  });
  it('ignores duplicate STT and late failures after a user confirmation', async () => {
    await recordSttEvidence(state.row.id, '안녕하세요');
    await confirmRecognition('run', state.row.id, state.row.revision, '실제로 말한 문장');
    const revision = state.row.revision;
    await recordSttEvidence(state.row.id, '늦은 후보');
    await recordSttEvidence(state.row.id, null, 'stt_failed');
    expect(state.row.canonicalText).toBe('실제로 말한 문장');
    expect(state.row.revision).toBe(revision);
    expect(state.row.source).toBe('user_confirmation');
  });
  it('does not promote a failed/incomplete capture after a late success', async () => {
    await recordSttEvidence(state.row.id, null, 'overlapping_capture');
    const revision = state.row.revision;
    await recordSttEvidence(state.row.id, 'Hola');
    expect(state.row.status).toBe('needs_confirmation');
    expect(state.row.canonicalText).toBeNull();
    expect(state.row.revision).toBe(revision);
  });
  it('holds old reports if a required voice utterance has no stored evidence', async () => {
    state.row = null;
    const report = await guardRecognitionReport({ personaRunId: 'run', overallScore: 85 });
    expect(report.reportStatus).toBe('recognition_pending');
    expect(report.overallScore).toBeNull();
  });
  it('keeps segmented capture confirmation mandatory after matching Live completion', async () => {
    state.row.providerText = null;
    state.row.providerFinal = false;
    await recordSttEvidence(state.row.id, '이름은 민준입니다.\n다음 주에 만나겠습니다.',
      'segmented_utterance_confirmation_required');
    const row = await recordProviderEvidence(state.row.id, '이름은 민준입니다. 다음 주에 만나겠습니다.', true);
    expect(row.providerFinal).toBe(true);
    expect(row.providerText).toBe('이름은 민준입니다. 다음 주에 만나겠습니다.');
    expect(row.status).toBe('needs_confirmation');
    expect(row.reason).toBe('segmented_utterance_confirmation_required');
    expect(row.canonicalText).toBeNull();
    await expect(prepareRecognitionConversation('run', { messages: [] })).rejects.toThrow('voice_recognition_confirmation_required');
    await confirmRecognition('run', row.id, row.revision, row.candidateText!);
    expect(state.row.status).toBe('confirmed');
  });
  it('schedules canonical evaluation when STT completes before Live finality', async () => {
    state.row.providerText = null;
    state.row.providerFinal = false;
    await recordSttEvidence(state.row.id, '확인하고 연락하겠습니다.');
    expect(state.row.status).toBe('needs_confirmation');
    expect(state.row.reason).toBe('provider_incomplete');
    const row = await recordProviderEvidence(state.row.id, '확인하고 연락하겠습니다.', true);
    expect(row.status).toBe('verified');
    expect(row.canonicalText).toBe('확인하고 연락하겠습니다.');
    await vi.waitFor(() => expect(evaluateRecognition).toHaveBeenCalledWith(row.id));
  });
  it('does not overwrite provider-final raw text, even after confirmation', async () => {
    await confirmRecognition('run', state.row.id, 1, '안녕하세요');
    await recordProviderEvidence(state.row.id, 'changed', true);
    expect(state.row.providerText).toBe('Hola');
    expect(state.row.canonicalText).toBe('안녕하세요');
  });
  it('rejects a stale confirmation and simultaneous confirmations use CAS', async () => {
    const results = await Promise.allSettled([
      confirmRecognition('run', state.row.id, 1, '네'),
      confirmRecognition('run', state.row.id, 1, '아니요'),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    await expect(confirmRecognition('run', state.row.id, 1, 'later')).rejects.toThrow('voice_revision_conflict');
  });
  it('uses server canonical text, not eligibility/canonical values supplied by a client', async () => {
    await confirmRecognition('run', state.row.id, 1, '네');
    const result = await prepareRecognitionConversation('run', {
      messages: [{ sender: 'user', message: 'client fabricated', status: 'verified' }],
    });
    expect(result.conversation.messages[0].message).toBe('네');
    expect(state.messages[0].message).toBe('Hola');
  });
  it('holds an affected report without exposing old quotes, penalties or passing decisions', async () => {
    const original = { id: 'report', personaRunId: 'run', overallScore: 85, passed: true, summary: 'old judgment', detailedFeedback: { quote: 'Hola' } };
    const guarded = await guardRecognitionReport(original);
    expect(guarded.overallScore).toBeNull();
    expect((guarded as any).passed).toBeUndefined();
    expect(JSON.stringify(guarded)).not.toContain('Hola');
    expect(JSON.stringify(guarded)).not.toContain('old judgment');
    expect(original.overallScore).toBe(85);
  });
  it('reuses only a report stamped with the current canonical revision', async () => {
    await confirmRecognition('run', state.row.id, 1, '네');
    const report = { personaRunId: 'run', overallScore: 85, evaluationPromptSnapshot: { recognitionRevision: recognitionRevision([state.row]) } };
    expect(await guardRecognitionReport(report)).toBe(report);
    await confirmRecognition('run', state.row.id, state.row.revision, '아니요');
    expect((await guardRecognitionReport(report)).overallScore).toBeNull();
  });
  it('fails closed on missing audio evidence while preserving historical legacy compatibility', async () => {
    state.row = null;
    await expect(prepareRecognitionConversation('run', { messages: [] })).rejects.toThrow('voice_recognition_confirmation_required');
    state.run.voiceRecognitionRequired = false;
    const legacy = { messages: [{ sender: 'user', message: 'historical text' }] };
    expect((await prepareRecognitionConversation('run', legacy)).conversation).toBe(legacy);
  });
});