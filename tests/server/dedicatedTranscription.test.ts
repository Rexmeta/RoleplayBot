import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ create: vi.fn(), setting: vi.fn(), files: [] as Buffer[] }));
vi.mock('../../server/storage', () => ({ storage: { getSystemSetting: mock.setting } }));
vi.mock('openai', () => ({
  default: class { audio = { transcriptions: { create: mock.create } }; },
  toFile: vi.fn(async (wav: Buffer) => { const file = Buffer.from(wav); mock.files.push(file); return file; }),
}));
import { transcribeKoreanUtterance, pcm16Wav, MAX_UTTERANCE_BYTES } from '../../server/services/voice/dedicatedTranscription';

describe('independent Korean STT provider contract', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mock.files.length = 0;
    vi.stubEnv('OPENAI_API_KEY', 'non-secret-test-key');
    mock.setting.mockResolvedValue({ value: 'gpt-4o-mini-transcribe' });
    mock.create.mockResolvedValue({ text: '네.' });
  });
  it('actually passes ko and PCM16 mono 16kHz WAV to the SDK', async () => {
    expect(await transcribeKoreanUtterance(Buffer.from([1, 0, 2, 0]))).toBe('네.');
    const args = mock.create.mock.calls[0][0];
    expect(args.language).toBe('ko');
    expect(args.model).toBe('gpt-4o-mini-transcribe');
    expect(mock.files[0].readUInt32LE(24)).toBe(16000);
    expect(mock.files[0].readUInt16LE(22)).toBe(1);
    expect(mock.files[0].subarray(44)).toEqual(Buffer.from([1, 0, 2, 0]));
  });
  it('preserves segment order without overlapping or inferring missing words', async () => {
    mock.create.mockResolvedValueOnce({ text: '첫 구간.' }).mockResolvedValueOnce({ text: '둘째 구간.' });
    const pcm = Buffer.alloc(20 * 32000 + 2); pcm.writeInt16LE(42, pcm.length - 2);
    const info = vi.fn();
    expect(await transcribeKoreanUtterance(pcm, info)).toBe('첫 구간.\n둘째 구간.');
    expect(info).toHaveBeenCalledWith({ model: 'gpt-4o-mini-transcribe', segments: 2 });
    expect(mock.files[1].subarray(44)).toEqual(Buffer.from([42, 0]));
  });
  it('does not silently use another model or Live text on misconfiguration/failure', async () => {
    mock.setting.mockResolvedValue({ value: 'unsupported' });
    await expect(transcribeKoreanUtterance(Buffer.alloc(2))).rejects.toThrow('unsupported_stt_model');
    expect(mock.create).not.toHaveBeenCalled();
    mock.setting.mockResolvedValue(null); mock.create.mockRejectedValue(new Error('provider failed'));
    await expect(transcribeKoreanUtterance(Buffer.alloc(2))).rejects.toThrow('provider failed');
  });
  it('enforces audio bounds and refuses empty provider results', async () => {
    expect(() => pcm16Wav(Buffer.alloc(MAX_UTTERANCE_BYTES + 2))).toThrow();
    expect(() => pcm16Wav(Buffer.alloc(1))).toThrow();
    mock.create.mockResolvedValue({ text: ' ' });
    await expect(transcribeKoreanUtterance(Buffer.alloc(2))).rejects.toThrow('empty_stt_result');
  });
});