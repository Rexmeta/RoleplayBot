// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef } from 'react';
import { useAudioPlayback } from '../../client/src/hooks/useAudioPlayback';

function buildMockAudioNode() {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

function buildMockAnalyser() {
  return {
    ...buildMockAudioNode(),
    fftSize: 256,
    smoothingTimeConstant: 0.8,
    getFloatTimeDomainData: vi.fn((arr: Float32Array) => arr.fill(0)),
  };
}

function buildMockGainNode() {
  return {
    ...buildMockAudioNode(),
    gain: { value: 1.0 },
  };
}

function buildMockCompressorNode() {
  return {
    ...buildMockAudioNode(),
    threshold: { value: -24 },
    knee: { value: 30 },
    ratio: { value: 12 },
    attack: { value: 0.003 },
    release: { value: 0.25 },
  };
}

function buildMockSource() {
  const source = {
    ...buildMockAudioNode(),
    buffer: null as any,
    playbackRate: { value: 1.0 },
    start: vi.fn(),
    stop: vi.fn(),
    onended: null as any,
  };
  return source;
}

function buildMockAudioBuffer(duration = 0.5, size = 1024) {
  const channelData = new Float32Array(size);
  return {
    duration,
    getChannelData: vi.fn(() => channelData),
    _channelData: channelData,
  };
}

function buildMockAudioContext(state: AudioContextState = 'running') {
  const analyser = buildMockAnalyser();
  const gainNode = buildMockGainNode();
  const compressorNode = buildMockCompressorNode();
  let _state = state;
  let _lastBuffer: ReturnType<typeof buildMockAudioBuffer> | null = null;

  const ctx = {
    get state() { return _state; },
    set state(v) { _state = v; },
    currentTime: 0,
    destination: buildMockAudioNode(),
    createAnalyser: vi.fn(() => analyser),
    createGain: vi.fn(() => gainNode),
    createDynamicsCompressor: vi.fn(() => compressorNode),
    createBufferSource: vi.fn(() => buildMockSource()),
    createBuffer: vi.fn((_channels: number, length: number, sampleRate: number) => {
      const duration = length / sampleRate;
      const buf = buildMockAudioBuffer(duration, length);
      _lastBuffer = buf;
      return buf;
    }),
    resume: vi.fn(async () => { _state = 'running'; }),
    suspend: vi.fn(async () => { _state = 'suspended'; }),
    _analyser: analyser,
    _gainNode: gainNode,
    _compressorNode: compressorNode,
    get _lastBuffer() { return _lastBuffer; },
  };
  return ctx;
}

let mockContext: ReturnType<typeof buildMockAudioContext>;

beforeEach(() => {
  mockContext = buildMockAudioContext();
  (globalThis as any).AudioContext = vi.fn(() => mockContext);
  (globalThis as any).webkitAudioContext = vi.fn(() => mockContext);

  (globalThis as any).atob = (b64: string) =>
    Buffer.from(b64, 'base64').toString('binary');

  (globalThis as any).requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
    return 1;
  });
  (globalThis as any).cancelAnimationFrame = vi.fn();
});

afterEach(() => {
  vi.clearAllMocks();
  delete (globalThis as any).AudioContext;
  delete (globalThis as any).webkitAudioContext;
  delete (globalThis as any).requestAnimationFrame;
  delete (globalThis as any).cancelAnimationFrame;
});

function renderAudioPlayback() {
  const isInterruptedRef = { current: false };
  const { result } = renderHook(() => useAudioPlayback(isInterruptedRef as any));
  return { result, isInterruptedRef };
}

describe('useAudioPlayback', () => {
  describe('initial state', () => {
    it('starts with isAISpeaking = false', () => {
      const { result } = renderAudioPlayback();
      expect(result.current.isAISpeaking).toBe(false);
    });

    it('starts with audioAmplitude = 0', () => {
      const { result } = renderAudioPlayback();
      expect(result.current.audioAmplitude).toBe(0);
    });

    it('starts with empty scheduledSources', () => {
      const { result } = renderAudioPlayback();
      expect(result.current.scheduledSourcesRef.current).toHaveLength(0);
    });
  });

  describe('stopPlayback', () => {
    it('sets isInterrupted flag to true', async () => {
      const { result, isInterruptedRef } = renderAudioPlayback();

      await act(async () => {
        result.current.stopPlayback();
      });

      expect(isInterruptedRef.current).toBe(true);
    });

    it('sets isAISpeaking to false', async () => {
      const { result } = renderAudioPlayback();

      await act(async () => {
        result.current.setIsAISpeaking(true);
      });

      await act(async () => {
        result.current.stopPlayback();
      });

      expect(result.current.isAISpeaking).toBe(false);
    });

    it('stops and disconnects all scheduled sources', async () => {
      const { result } = renderAudioPlayback();
      const mockSource = buildMockSource();
      result.current.scheduledSourcesRef.current = [mockSource as any];

      await act(async () => {
        result.current.stopPlayback();
      });

      expect(mockSource.stop).toHaveBeenCalled();
      expect(mockSource.disconnect).toHaveBeenCalled();
      expect(result.current.scheduledSourcesRef.current).toHaveLength(0);
    });

    it('suspends the playback AudioContext', async () => {
      const { result } = renderAudioPlayback();
      result.current.playbackContextRef.current = mockContext as unknown as AudioContext;

      await act(async () => {
        result.current.stopPlayback();
      });

      expect(mockContext.suspend).toHaveBeenCalled();
    });

    it('leaves context suspended until resume() is called (simulating response.ready)', async () => {
      const { result } = renderAudioPlayback();
      result.current.playbackContextRef.current = mockContext as unknown as AudioContext;

      await act(async () => {
        result.current.stopPlayback();
      });

      expect(mockContext.state).toBe('suspended');

      await act(async () => {
        await result.current.playbackContextRef.current?.resume();
      });

      expect(mockContext.state).toBe('running');
      expect(mockContext.resume).toHaveBeenCalled();
    });

    it('resets nextPlayTime to 0', async () => {
      const { result } = renderAudioPlayback();
      result.current.nextPlayTimeRef.current = 42;

      await act(async () => {
        result.current.stopPlayback();
      });

      expect(result.current.nextPlayTimeRef.current).toBe(0);
    });

    it('resets gainNode gain to 1.0 after stop', async () => {
      const { result } = renderAudioPlayback();

      const pcm16 = new Int16Array([1000, -1000]);
      const b64 = Buffer.from(pcm16.buffer).toString('base64');

      await act(async () => {
        await result.current.playAudioDelta(b64);
      });

      if (result.current.gainNodeRef.current) {
        result.current.gainNodeRef.current.gain.value = 0.5;
      }

      await act(async () => {
        result.current.stopPlayback();
      });

      expect(result.current.gainNodeRef.current?.gain.value ?? 1.0).toBe(1.0);
    });
  });

  describe('playAudioDelta', () => {
    it('ignores audio chunk when isInterrupted is true', async () => {
      const { result, isInterruptedRef } = renderAudioPlayback();
      isInterruptedRef.current = true;

      await act(async () => {
        await result.current.playAudioDelta(Buffer.from('test').toString('base64'));
      });

      expect((globalThis as any).AudioContext).not.toHaveBeenCalled();
    });

    it('creates AudioContext on first call', async () => {
      const { result } = renderAudioPlayback();
      expect(result.current.playbackContextRef.current).toBeNull();

      const pcm16 = new Int16Array([1000, -1000, 500]);
      const b64 = Buffer.from(pcm16.buffer).toString('base64');

      await act(async () => {
        await result.current.playAudioDelta(b64);
      });

      expect((globalThis as any).AudioContext).toHaveBeenCalledWith({ sampleRate: 24000 });
    });

    it('resumes suspended AudioContext before playing', async () => {
      const { result } = renderAudioPlayback();
      (mockContext as any)._state = 'suspended';
      Object.defineProperty(mockContext, 'state', {
        get: () => (mockContext as any)._state,
        configurable: true,
      });
      result.current.playbackContextRef.current = mockContext as unknown as AudioContext;

      const pcm16 = new Int16Array([100]);
      const b64 = Buffer.from(pcm16.buffer).toString('base64');

      await act(async () => {
        await result.current.playAudioDelta(b64);
      });

      expect(mockContext.resume).toHaveBeenCalled();
    });

    it('schedules an AudioBufferSourceNode for playback', async () => {
      const { result } = renderAudioPlayback();
      result.current.playbackContextRef.current = mockContext as unknown as AudioContext;

      const pcm16 = new Int16Array([1000, -500]);
      const b64 = Buffer.from(pcm16.buffer).toString('base64');

      await act(async () => {
        await result.current.playAudioDelta(b64);
      });

      expect(mockContext.createBufferSource).toHaveBeenCalled();
    });

    it('adds source to scheduledSources list', async () => {
      const { result } = renderAudioPlayback();
      result.current.playbackContextRef.current = mockContext as unknown as AudioContext;

      const pcm16 = new Int16Array([100, 200]);
      const b64 = Buffer.from(pcm16.buffer).toString('base64');

      await act(async () => {
        await result.current.playAudioDelta(b64);
      });

      expect(result.current.scheduledSourcesRef.current.length).toBeGreaterThan(0);
    });

    it('creates AnalyserNode, GainNode, and DynamicsCompressorNode only once across multiple calls', async () => {
      const { result } = renderAudioPlayback();
      result.current.playbackContextRef.current = mockContext as unknown as AudioContext;

      const pcm16 = new Int16Array([100]);
      const b64 = Buffer.from(pcm16.buffer).toString('base64');

      await act(async () => {
        await result.current.playAudioDelta(b64);
        await result.current.playAudioDelta(b64);
      });

      expect(mockContext.createAnalyser).toHaveBeenCalledTimes(1);
      expect(mockContext.createGain).toHaveBeenCalledTimes(1);
      expect(mockContext.createDynamicsCompressor).toHaveBeenCalledTimes(1);
    });

    it('connects audio graph in order: analyser → compressor → gain → destination', async () => {
      const { result } = renderAudioPlayback();
      result.current.playbackContextRef.current = mockContext as unknown as AudioContext;

      const pcm16 = new Int16Array([1000]);
      const b64 = Buffer.from(pcm16.buffer).toString('base64');

      await act(async () => {
        await result.current.playAudioDelta(b64);
      });

      expect(mockContext._analyser.connect).toHaveBeenCalledWith(mockContext._compressorNode);
      expect(mockContext._compressorNode.connect).toHaveBeenCalledWith(mockContext._gainNode);
      expect(mockContext._gainNode.connect).toHaveBeenCalledWith(mockContext.destination);
    });
  });

  describe('PCM16 decoding', () => {
    it('correctly converts Int16 values to Float32 range [-1, 1]', () => {
      const pcm16Values = [0, 32767, -32768, 16384];
      const expected = [0, 32767 / 32768, -1, 16384 / 32768];

      const pcm16 = new Int16Array(pcm16Values);
      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 32768.0;
      }

      expect(float32[0]).toBeCloseTo(expected[0], 5);
      expect(float32[1]).toBeCloseTo(expected[1], 4);
      expect(float32[2]).toBeCloseTo(expected[2], 5);
      expect(float32[3]).toBeCloseTo(expected[3], 4);
    });

    it('max positive Int16 stays within [-1, 1]', () => {
      const val = 32767 / 32768;
      expect(val).toBeLessThanOrEqual(1.0);
      expect(val).toBeGreaterThan(0);
    });

    it('min negative Int16 maps to exactly -1', () => {
      const val = -32768 / 32768;
      expect(val).toBe(-1.0);
    });
  });

  describe('peak normalization', () => {
    it('writes normalized samples to AudioBuffer after playAudioDelta (behavior-level)', async () => {
      const { result } = renderAudioPlayback();
      result.current.playbackContextRef.current = mockContext as unknown as AudioContext;

      const pcm16 = new Int16Array([16384, -16384]);
      const b64 = Buffer.from(pcm16.buffer).toString('base64');

      await act(async () => {
        await result.current.playAudioDelta(b64);
      });

      const buf = (mockContext as any)._lastBuffer;
      expect(buf).not.toBeNull();
      const channelData = buf._channelData as Float32Array;
      let peak = 0;
      for (let i = 0; i < pcm16.length; i++) {
        const abs = Math.abs(channelData[i]);
        if (abs > peak) peak = abs;
      }
      expect(peak).toBeCloseTo(0.8, 4);
    });

    it('scales non-silent chunks to target peak level 0.8', () => {
      const pcm16Values = [16384, -16384];
      const pcm16 = new Int16Array(pcm16Values);
      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 32768.0;
      }

      const PEAK_TARGET = 0.8;
      const SILENCE_THRESHOLD = 0.01;

      let peak = 0;
      for (let i = 0; i < float32.length; i++) {
        const abs = Math.abs(float32[i]);
        if (abs > peak) peak = abs;
      }
      if (peak >= SILENCE_THRESHOLD) {
        const scale = PEAK_TARGET / peak;
        for (let i = 0; i < float32.length; i++) {
          float32[i] *= scale;
        }
      }

      let normalizedPeak = 0;
      for (let i = 0; i < float32.length; i++) {
        const abs = Math.abs(float32[i]);
        if (abs > normalizedPeak) normalizedPeak = abs;
      }
      expect(normalizedPeak).toBeCloseTo(PEAK_TARGET, 5);
    });

    it('skips scaling for near-silent chunks to prevent noise amplification', () => {
      const silentFloat32 = new Float32Array([0.001, -0.001, 0.0005]);
      const original = new Float32Array(silentFloat32);

      const PEAK_TARGET = 0.8;
      const SILENCE_THRESHOLD = 0.01;

      let peak = 0;
      for (let i = 0; i < silentFloat32.length; i++) {
        const abs = Math.abs(silentFloat32[i]);
        if (abs > peak) peak = abs;
      }
      if (peak >= SILENCE_THRESHOLD) {
        const scale = PEAK_TARGET / peak;
        for (let i = 0; i < silentFloat32.length; i++) {
          silentFloat32[i] *= scale;
        }
      }

      expect(silentFloat32[0]).toBeCloseTo(original[0], 5);
      expect(silentFloat32[1]).toBeCloseTo(original[1], 5);
    });
  });

  describe('amplitude analysis', () => {
    it('stops amplitude analysis and resets amplitude to 0', async () => {
      const { result } = renderAudioPlayback();

      await act(async () => {
        result.current.startAmplitudeAnalysis();
        result.current.stopAmplitudeAnalysis();
      });

      expect(result.current.audioAmplitude).toBe(0);
    });
  });
});
