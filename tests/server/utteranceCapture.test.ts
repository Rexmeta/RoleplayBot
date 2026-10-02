import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  register: vi.fn(), record: vi.fn(), transcribe: vi.fn(), settings: vi.fn(),
}));
vi.mock('../../server/services/voice/recognitionEvidence', () => ({
  registerUtterance: mocks.register,
  recordSttEvidence: mocks.record,
}));
vi.mock('../../server/services/voice/dedicatedTranscription', () => ({
  MAX_UTTERANCE_BYTES: 1920000, transcribeKoreanUtterance: mocks.transcribe,
}));
vi.mock('../../server/storage', () => ({ storage: { getSystemSetting: mocks.settings } }));
import { beginRecognitionCapture, appendRecognitionAudio, finishRecognitionCapture } from '../../server/services/voice/utteranceCapture';

const session = () => ({
  id: 'capture-test', personaRunId: 'run-test', userLanguage: 'ko',
  realtimeModel: 'gemini-3.1-flash-live-preview', voiceRecognitionRequired: true,
  currentClientCaptureGeneration: 2, currentClientSpeechSeq: 1,
} as any);

describe('bounded same-utterance recognition audio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.register.mockResolvedValue(undefined);
    mocks.settings.mockResolvedValue({ value: 'true' });
    mocks.transcribe.mockResolvedValue('네');
    mocks.record.mockResolvedValue({ status: 'needs_confirmation', reason: 'candidate_disagreement' });
  });
  it('captures pre-roll, speech and tail in order, once, and clears request buffers', async () => {
    const s = session(); const send = vi.fn();
    beginRecognitionCapture(s, send); beginRecognitionCapture(s, send);
    expect(mocks.register).toHaveBeenCalledTimes(1);
    const source = Buffer.from([1, 0, 2, 0, 3, 0]);
    appendRecognitionAudio(s, source.subarray(0, 2).toString('base64'));
    appendRecognitionAudio(s, source.subarray(2).toString('base64'));
    let observed: Buffer;
    mocks.transcribe.mockImplementationOnce(async (pcm: Buffer) => { observed = Buffer.from(pcm); return '네'; });
    finishRecognitionCapture(s, send); finishRecognitionCapture(s, send);
    await vi.waitFor(() => expect(mocks.record).toHaveBeenCalledTimes(1));
    expect(observed!).toEqual(source);
    expect(s.recognitionCapture).toBeUndefined();
    await vi.waitFor(() => expect(mocks.transcribe.mock.calls[0][0].every((b: number) => b === 0)).toBe(true));
  });
  it('does not fall back to Live text when disabled or on provider failure', async () => {
    mocks.settings.mockResolvedValue({ value: 'false' });
    const s = session(); const send = vi.fn();
    beginRecognitionCapture(s, send); appendRecognitionAudio(s, 'AQACAA==');
    finishRecognitionCapture(s, send);
    await vi.waitFor(() => expect(mocks.record).toHaveBeenCalledWith(expect.any(String), null, 'stt_rollout_disabled', undefined));
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });
  it('rejects oversized, malformed and incomplete captures', async () => {
    const s = session(); const send = vi.fn();
    beginRecognitionCapture(s, send); appendRecognitionAudio(s, 'invalid-audio');
    finishRecognitionCapture(s, send);
    await vi.waitFor(() => expect(mocks.record).toHaveBeenCalledWith(expect.any(String), null, 'invalid_audio', undefined));
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });
});