export interface PcmDiagnostics {
  sourceSampleRate: number;
  targetSampleRate: number;
  inputSamples: number;
  outputSamples: number;
  peak: number;
  rms: number;
  clippedSamples: number;
  silentSamples: number;
}

/**
 * Stateful area resampler. Each output sample is the weighted average of the
 * source interval it represents, which provides anti-alias filtering while
 * preserving fractional callback-boundary state.
 */
export class StreamingPcm16Resampler {
  private readonly sourcePerOutput: number;
  private readonly filter: Float64Array;
  private readonly history: Float64Array;
  private historyIndex = 0;
  private sourceIndex = -1;
  private nextOutputPosition = 0;
  private previousFiltered = 0;

  constructor(
    readonly sourceSampleRate: number,
    readonly targetSampleRate = 16_000,
  ) {
    if (sourceSampleRate <= 0 || targetSampleRate <= 0 || sourceSampleRate < targetSampleRate) {
      throw new Error(`Unsupported resampling rate ${sourceSampleRate} -> ${targetSampleRate}`);
    }
    this.sourcePerOutput = sourceSampleRate / targetSampleRate;
    const taps = 63;
    const cutoff = (targetSampleRate / 2) * 0.92 / sourceSampleRate;
    const midpoint = (taps - 1) / 2;
    this.filter = new Float64Array(taps);
    this.history = new Float64Array(taps);
    let coefficientSum = 0;
    for (let i = 0; i < taps; i++) {
      const offset = i - midpoint;
      const sinc = offset === 0
        ? 2 * cutoff
        : Math.sin(2 * Math.PI * cutoff * offset) / (Math.PI * offset);
      const hann = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (taps - 1));
      this.filter[i] = sinc * hann;
      coefficientSum += this.filter[i];
    }
    for (let i = 0; i < taps; i++) this.filter[i] /= coefficientSum;
  }

  process(input: Float32Array): { pcm16: Int16Array; diagnostics: PcmDiagnostics } {
    const output: number[] = [];
    let peak = 0;
    let squareSum = 0;
    let clippedSamples = 0;
    let silentSamples = 0;

    for (let i = 0; i < input.length; i++) {
      const sample = Number.isFinite(input[i]) ? input[i] : 0;
      const magnitude = Math.abs(sample);
      peak = Math.max(peak, magnitude);
      squareSum += sample * sample;
      if (magnitude >= 1) clippedSamples++;
      if (magnitude < 0.0005) silentSamples++;

      this.history[this.historyIndex] = sample;
      let filtered = 0;
      let cursor = this.historyIndex;
      for (let tap = 0; tap < this.filter.length; tap++) {
        filtered += this.filter[tap] * this.history[cursor];
        cursor = cursor === 0 ? this.history.length - 1 : cursor - 1;
      }
      this.historyIndex = (this.historyIndex + 1) % this.history.length;
      this.sourceIndex++;

      while (this.nextOutputPosition <= this.sourceIndex + 1e-10) {
        const fraction = this.sourceIndex === 0
          ? 1
          : this.nextOutputPosition - (this.sourceIndex - 1);
        output.push(
          this.sourceIndex === 0
            ? filtered
            : this.previousFiltered + fraction * (filtered - this.previousFiltered),
        );
        this.nextOutputPosition += this.sourcePerOutput;
      }
      this.previousFiltered = filtered;
    }

    const pcm16 = new Int16Array(output.length);
    for (let i = 0; i < output.length; i++) {
      const sample = Math.max(-1, Math.min(1, output[i]));
      pcm16[i] = Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff);
    }

    return {
      pcm16,
      diagnostics: {
        sourceSampleRate: this.sourceSampleRate,
        targetSampleRate: this.targetSampleRate,
        inputSamples: input.length,
        outputSamples: pcm16.length,
        peak,
        rms: input.length ? Math.sqrt(squareSum / input.length) : 0,
        clippedSamples,
        silentSamples,
      },
    };
  }
}

export function pcm16ToBase64(pcm16: Int16Array): string {
  const bytes = new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * Drops only chunks whose removal still leaves at least the requested window.
 * This intentionally permits at most one callback chunk of bounded overshoot.
 */
export function trimPcmPreroll<T extends { samples: number }>(
  chunks: T[],
  totalSamples: number,
  minimumSamples: number,
): number {
  while (
    chunks.length > 1 &&
    totalSamples - chunks[0].samples >= minimumSamples
  ) {
    totalSamples -= chunks.shift()!.samples;
  }
  return totalSamples;
}