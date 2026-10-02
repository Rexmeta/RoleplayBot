import OpenAI, { toFile } from 'openai';
import { storage } from '../../storage';

export const MAX_UTTERANCE_BYTES = 16000 * 2 * 60;

export function pcm16Wav(pcm: Buffer): Buffer {
  if (!pcm.length || pcm.length % 2 || pcm.length > MAX_UTTERANCE_BYTES) throw new Error('invalid_utterance_audio');
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(pcm.length + 36, 4);
  header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export interface TranscriptionInfo { model: string; segments: number }
export async function transcribeKoreanUtterance(pcm: Buffer, onInfo?: (info: TranscriptionInfo) => void): Promise<string> {
  let settingsTimer: ReturnType<typeof setTimeout> | undefined;
  const setting = await Promise.race([
    storage.getSystemSetting('ai', 'model_voice_transcription'),
    new Promise<never>((_, reject) => { settingsTimer = setTimeout(() => reject(new Error('stt_configuration_timeout')), 5000); }),
  ]).finally(() => { if (settingsTimer) clearTimeout(settingsTimer); });
  const model = setting?.value || 'gpt-4o-mini-transcribe';
  // Do not inherit AI_MODEL/AI_PROVIDER or silently fall back to Live text.
  if (!['gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1'].includes(model)) {
    throw new Error('unsupported_stt_model');
  }
  if (!process.env.OPENAI_API_KEY) throw new Error('stt_not_configured');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20000, maxRetries: 0 });
  // Validate the complete capture before creating ordered, non-overlapping
  // segments. Segmented candidates always require user confirmation.
  if (!pcm.length || pcm.length % 2 || pcm.length > MAX_UTTERANCE_BYTES) throw new Error('invalid_utterance_audio');
  const segmentBytes = 16000 * 2 * 20;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  const segments: string[] = [];
  onInfo?.({ model, segments: Math.ceil(pcm.length / segmentBytes) });
  try {
    for (let offset = 0; offset < pcm.length; offset += segmentBytes) {
      const wav = pcm16Wav(pcm.subarray(offset, offset + segmentBytes));
      try {
        const result = await client.audio.transcriptions.create({
          model, file: await toFile(wav, 'utterance.wav', { type: 'audio/wav' }),
          language: 'ko', response_format: 'json',
        }, { signal: controller.signal });
        if (!result.text?.trim()) throw new Error('empty_stt_result');
        segments.push(result.text);
      } finally { wav.fill(0); }
    }
    return segments.join('\n'); // Ordered provider text, not repair or translation.
  } finally {
    clearTimeout(timer);
  }
}