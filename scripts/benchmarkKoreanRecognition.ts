/**
 * Synthetic, non-personal speech benchmark; no raw audio is written to disk.
 * Explicit opt-in: npx tsx scripts/benchmarkKoreanRecognition.ts --synthetic
 * API calls incur provider charges. Results are NOT device/human validation.
 */
import OpenAI, { toFile } from 'openai';
import { GoogleGenAI, Modality } from '@google/genai';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { pcm16Wav } from '../server/services/voice/dedicatedTranscription';
import { pool } from '../server/storage/db';

function editDistance(a: string, b: string) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(
      next[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
    );
    previous = next;
  }
  return previous[b.length];
}

function normalize(s: string) { return s.normalize('NFC').replace(/[\s.,!?]/g, ''); }

async function liveTranscribe(pcm: Buffer) {
  if (!process.env.GEMINI_API_KEY) throw new Error('gemini_not_configured');
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { apiVersion: 'v1beta' } });
  let text = ''; let completions = 0; let usage: unknown;
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const finished = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
  const timer = setTimeout(() => reject(new Error('live_timeout')), 30000);
  // Attach a handler immediately to avoid an early close causing an unhandled rejection.
  void finished.catch(() => {});
  let session: Awaited<ReturnType<typeof ai.live.connect>> | undefined;
  try {
    session = await ai.live.connect({
      model: 'gemini-3.1-flash-live-preview',
      config: {
        responseModalities: [Modality.AUDIO], inputAudioTranscription: {}, outputAudioTranscription: {},
        systemInstruction: '한국어 업무 대화입니다. 사용자의 말을 듣고 한국어로 짧게 답하세요.',
      },
      callbacks: {
        onmessage(message) {
          if (message.serverContent?.inputTranscription?.text) text += message.serverContent.inputTranscription.text;
          if (message.usageMetadata) usage = message.usageMetadata;
          if (message.serverContent?.turnComplete) { completions++; resolve(); }
        },
        onerror() { reject(new Error('live_provider_error')); },
        onclose() { if (!completions) reject(new Error('live_closed_without_completion')); },
      },
    });
    for (let offset = 0; offset < pcm.length; offset += 1600) {
      session.sendRealtimeInput({ audio: { data: pcm.subarray(offset, offset + 1600).toString('base64'), mimeType: 'audio/pcm;rate=16000' } });
      await new Promise(r => setTimeout(r, 50));
    }
    session.sendRealtimeInput({ audio: { data: Buffer.alloc(22400).toString('base64'), mimeType: 'audio/pcm;rate=16000' } });
    session.sendRealtimeInput({ audioStreamEnd: true });
    await finished;
    return { text, completions, usage };
  } finally { clearTimeout(timer); session?.close(); }
}

async function main() {
  if (!process.argv.includes('--synthetic')) throw new Error('explicit_synthetic_opt_in_required');
  const api = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 25000 });
  const cases = [
    { id: 'short', reference: '네.', filter: '', inputRate: 44100 },
    { id: 'normal', reference: '다음 회의에서 일정과 예산을 다시 확인하겠습니다.', filter: '', inputRate: 48000 },
    { id: 'numbers', reference: '삼십오 개를 다음 주 수요일까지 보내 주세요.', filter: '', inputRate: 44100 },
    { id: 'mixed', reference: 'CRM과 API 연결은 테스트 제품으로 확인했어요.', filter: '', inputRate: 48000 },
    { id: 'quiet', reference: '네, 알겠습니다.', filter: 'volume=0.08', inputRate: 48000 },
    { id: 'echo', reference: '먼저 담당자에게 확인해 보겠습니다.', filter: 'aecho=0.8:0.7:80:0.35', inputRate: 44100 },
    { id: 'names', reference: '테스트 담당자의 이름은 김민준입니다.', filter: '', inputRate: 48000 },
    { id: 'noise', reference: '회의실에서 일정과 예산을 확인하겠습니다.', filter: 'aeval=val(0)+0.02*(2*random(0)-1)', inputRate: 44100 },
  ];
  const rows: any[] = [];
  for (const c of process.argv.includes('--supplement') ? cases.slice(-2) : cases) {
    const generated = await api.audio.speech.create({
      model: 'gpt-4o-mini-tts', voice: 'alloy', input: c.reference, response_format: 'pcm',
    });
    const raw = Buffer.from(await generated.arrayBuffer());
    const input = spawnSync('ffmpeg', ['-v', 'error', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', 'pipe:0',
      ...(c.filter ? ['-af', c.filter] : []), '-f', 's16le', '-ar', String(c.inputRate), 'pipe:1'], { input: raw });
    raw.fill(0);
    if (input.status !== 0) throw new Error('fixture_conversion_failed');
    const converted = spawnSync('ffmpeg', ['-v', 'error', '-f', 's16le', '-ar', String(c.inputRate), '-ac', '1',
      '-i', 'pipe:0', '-f', 's16le', '-ar', '16000', 'pipe:1'], { input: input.stdout });
    input.stdout.fill(0);
    if (converted.status !== 0) throw new Error('fixture_conversion_failed');
    const pcm = converted.stdout;
    const wav = pcm16Wav(pcm);
    const started = Date.now();
    const file = await toFile(wav, 'synthetic.wav', { type: 'audio/wav' });
    const transcribe = async (model: string) => {
      const start = Date.now();
      const result = await api.audio.transcriptions.create({
        file, model, language: 'ko', response_format: 'json',
      });
      return { text: result.text, latencyMs: Date.now() - start, usage: (result as any).usage };
    };
    const [live, stt, fullStt, whisper] = await Promise.allSettled([
      (async () => { const start = Date.now(); return { ...await liveTranscribe(pcm), latencyMs: Date.now() - start }; })(),
      transcribe('gpt-4o-mini-transcribe'),
      transcribe('gpt-4o-transcribe'),
      transcribe('whisper-1'),
    ]);
    const metric = (result: PromiseSettledResult<any>) => {
      if (result.status === 'rejected') return { status: 'failed', reason: 'provider_request_failed' };
      const actual = normalize(result.value.text), reference = normalize(c.reference);
      return {
        status: 'completed', ...result.value, characterErrorRate: editDistance(reference, actual) / reference.length,
        omitted: !actual, exactMatch: actual === reference,
        foreignOnly: /^[^\uAC00-\uD7AF]*$/.test(actual) && !/\d|[A-Z]{2,}/.test(actual),
      };
    };
    rows.push({
      id: c.id, reference: c.reference, synthetic: true, inputRate: c.inputRate,
      audioMs: pcm.length / 32, elapsedMs: Date.now() - started,
      live: metric(live), stt: metric(stt), fullStt: metric(fullStt), whisper: metric(whisper),
      // Public per-minute estimate, not an invoice. See the report for pricing source.
      estimatedSttUsd: pcm.length / 32000 / 60 * 0.003,
    });
    pcm.fill(0); wav.fill(0);
    console.log(JSON.stringify({ id: c.id, live: live.status, stt: stt.status }));
  }
  const successful = rows.filter(r => r.live.status === 'completed' && r.stt.status === 'completed');
  const result = {
    date: new Date().toISOString(), fixtures: 'synthetic OpenAI TTS, in-memory only',
    liveModel: 'gemini-3.1-flash-live-preview', sttModel: 'gpt-4o-mini-transcribe', sttLanguage: 'ko',
    confirmationRequestRate: successful.length ? successful.filter(r => r.live.text.replace(/\s/g, '') !== r.stt.text.replace(/\s/g, '')).length / successful.length : null,
    limitations: ['No real microphone, Bluetooth, noise or human accent validation.', 'Synthetic echo/quiet and resampling are not hardware tests.',
      'Foreign-only flag is a diagnostic for these annotated fixtures, never an eligibility policy.',
      'Missing/duplicate logical capture tests are separate from acoustic accuracy. Costs are estimates; actual Gemini charge is not measured.'],
    rows,
  };
  await writeFile(process.argv.includes('--supplement')
    ? 'docs/korean-recognition-synthetic-supplement.json' : 'docs/korean-recognition-synthetic-results.json',
    JSON.stringify(result, null, 2));
}

main().catch(() => { console.error('Benchmark did not complete; no audio or credential details logged.'); process.exitCode = 1; })
  .finally(() => pool.end());