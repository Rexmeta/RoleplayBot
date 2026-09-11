import { describe, expect, it } from 'vitest';
import {
  StreamingPcm16Resampler,
  trimPcmPreroll,
} from '../../client/src/lib/streamingPcmResampler';

function tone(rate: number, frequency: number, seconds: number, amplitude = 0.5): Float32Array {
  return Float32Array.from(
    { length: Math.round(rate * seconds) },
    (_, i) => amplitude * Math.sin(2 * Math.PI * frequency * i / rate),
  );
}

describe('StreamingPcm16Resampler', () => {
  it.each([44_100, 48_000])('preserves duration and level from %i Hz', (sourceRate) => {
    const resampler = new StreamingPcm16Resampler(sourceRate);
    const input = tone(sourceRate, 440, 1);
    const chunks = [input.slice(0, 137), input.slice(137, 4221), input.slice(4221)];
    const output = chunks.flatMap(chunk => Array.from(resampler.process(chunk).pcm16));

    expect(output.length).toBeGreaterThanOrEqual(15_999);
    expect(output.length).toBeLessThanOrEqual(16_000);
    const rms = Math.sqrt(output.reduce((sum, value) => sum + (value / 32768) ** 2, 0) / output.length);
    expect(rms).toBeGreaterThan(0.34);
    expect(rms).toBeLessThan(0.36);
  });

  it('does not duplicate or lose samples across Bluetooth-sized callback boundaries', () => {
    const rate = 48_000;
    const resampler = new StreamingPcm16Resampler(rate);
    const input = new Float32Array(rate).fill(0.25);
    let count = 0;
    for (let offset = 0; offset < input.length; offset += 128) {
      count += resampler.process(input.slice(offset, offset + 128)).pcm16.length;
    }
    expect(count).toBe(16_000);
  });

  it.each([9_000, 12_000, 18_000])(
    'attenuates %i Hz before 48 kHz downsampling',
    (frequency) => {
      const resampler = new StreamingPcm16Resampler(48_000);
      const output = resampler.process(tone(48_000, frequency, 0.2, 0.9)).pcm16;
      const settled = output.slice(100);
      const rms = Math.sqrt(
        Array.from(settled, value => value ** 2).reduce((sum, value) => sum + value, 0) /
        settled.length,
      );
      expect(rms).toBeLessThan(1_500);
    },
  );
});

describe('trimPcmPreroll', () => {
  it.each([44_100, 48_000])(
    'retains the full 350ms barge-in window at %i Hz callback granularity',
    (sourceRate) => {
      const resampler = new StreamingPcm16Resampler(sourceRate);
      const callback = new Float32Array(4096).fill(0.1);
      const chunks: Array<{ samples: number; onset: boolean }> = [];
      let total = 0;

      for (let index = 0; index < 8; index++) {
        const samples = resampler.process(callback).pcm16.length;
        chunks.push({ samples, onset: index === 4 });
        total += samples;
        total = trimPcmPreroll(chunks, total, 5_600);
      }

      expect(total).toBeGreaterThanOrEqual(5_600);
      expect(total).toBeLessThan(5_600 + Math.ceil(4096 * 16_000 / sourceRate));
      expect(chunks.some(chunk => chunk.onset)).toBe(true);
    },
  );
});