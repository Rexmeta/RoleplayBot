// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoiceActivityDetection } from '../../client/src/hooks/useVoiceActivityDetection';

const VOICE_THRESHOLD = 0.06;
const BARGE_IN_DELAY_MS = 300;

function buildSilentBuffer(size = 4096): Float32Array {
  return new Float32Array(size);
}

function buildVoiceBuffer(rmsTarget: number, size = 4096): Float32Array {
  const buf = new Float32Array(size);
  const value = Math.sqrt(rmsTarget * rmsTarget);
  buf.fill(value);
  return buf;
}

function computeRms(buffer: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    sum += buffer[i] * buffer[i];
  }
  return Math.sqrt(sum / buffer.length);
}

function buildMockScriptProcessor() {
  return {
    onaudioprocess: null as ((e: any) => void) | null,
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
}

function buildMockAudioContext() {
  const processor = buildMockScriptProcessor();
  const destination = { connect: vi.fn() };
  const gain = {
    gain: { value: 0 },
    connect: vi.fn(),
  };

  const ctx = {
    createScriptProcessor: vi.fn(() => processor),
    createGain: vi.fn(() => gain),
    destination,
    sampleRate: 16000,
    _processor: processor,
  };

  return ctx;
}

function buildMockMediaStreamSource() {
  return { connect: vi.fn() };
}

function makeWs(readyState: number = WebSocket.OPEN) {
  return {
    readyState,
    send: vi.fn(),
  };
}

describe('useVoiceActivityDetection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('starts with userAudioAmplitude = 0', () => {
      const { result } = renderHook(() => useVoiceActivityDetection());
      expect(result.current.userAudioAmplitude).toBe(0);
    });

    it('starts with bargeInTriggeredRef = false', () => {
      const { result } = renderHook(() => useVoiceActivityDetection());
      expect(result.current.bargeInTriggeredRef.current).toBe(false);
    });

    it('starts with voiceActivityStartRef = null', () => {
      const { result } = renderHook(() => useVoiceActivityDetection());
      expect(result.current.voiceActivityStartRef.current).toBeNull();
    });
  });

  describe('setupVAD', () => {
    it('creates a ScriptProcessorNode and stores it in vadProcessorRef', () => {
      const { result } = renderHook(() => useVoiceActivityDetection());
      const ctx = buildMockAudioContext();
      const source = buildMockMediaStreamSource();
      const wsRef = { current: makeWs() as any };
      const isRecordingRef = { current: true };
      const expectedTurnSeqRef = { current: 0 };
      const isActuallyPlayingRef = { current: false };
      const stopPlayback = vi.fn();

      act(() => {
        result.current.setupVAD({
          audioContext: ctx as unknown as AudioContext,
          source: source as unknown as MediaStreamAudioSourceNode,
          isActuallyPlayingRef,
          wsRef,
          isRecordingRef,
          expectedTurnSeqRef,
          stopPlayback,
        });
      });

      expect(ctx.createScriptProcessor).toHaveBeenCalled();
      expect(result.current.vadProcessorRef.current).not.toBeNull();
    });

    it('connects the source to the processor', () => {
      const { result } = renderHook(() => useVoiceActivityDetection());
      const ctx = buildMockAudioContext();
      const source = buildMockMediaStreamSource();
      const wsRef = { current: makeWs() as any };
      const isRecordingRef = { current: true };
      const expectedTurnSeqRef = { current: 0 };
      const isActuallyPlayingRef = { current: false };
      const stopPlayback = vi.fn();

      act(() => {
        result.current.setupVAD({
          audioContext: ctx as unknown as AudioContext,
          source: source as unknown as MediaStreamAudioSourceNode,
          isActuallyPlayingRef,
          wsRef,
          isRecordingRef,
          expectedTurnSeqRef,
          stopPlayback,
        });
      });

      expect(source.connect).toHaveBeenCalledWith(ctx._processor);
    });
  });

  describe('VAD RMS calculation', () => {
    it('correctly computes zero RMS for silent buffer', () => {
      const silent = buildSilentBuffer();
      const rms = computeRms(silent);
      expect(rms).toBe(0);
    });

    it('computes correct RMS for a uniform-value buffer', () => {
      const buf = new Float32Array(4);
      buf.fill(0.1);
      const rms = computeRms(buf);
      expect(rms).toBeCloseTo(0.1, 5);
    });

    it('produces rms above threshold for loud voice', () => {
      const voiceBuf = buildVoiceBuffer(0.1);
      const rms = computeRms(voiceBuf);
      expect(rms).toBeGreaterThan(VOICE_THRESHOLD);
    });

    it('produces rms below threshold for quiet input', () => {
      const quietBuf = buildVoiceBuffer(0.01);
      const rms = computeRms(quietBuf);
      expect(rms).toBeLessThan(VOICE_THRESHOLD);
    });
  });

  describe('onaudioprocess – silence', () => {
    function setupAndGetProcessor(overrides: {
      isRecordingRef?: { current: boolean };
      wsReadyState?: number;
    } = {}) {
      const { result } = renderHook(() => useVoiceActivityDetection());
      const ctx = buildMockAudioContext();
      const source = buildMockMediaStreamSource();
      const wsRef = { current: makeWs(overrides.wsReadyState ?? WebSocket.OPEN) as any };
      const isRecordingRef = overrides.isRecordingRef ?? { current: true };
      const expectedTurnSeqRef = { current: 0 };
      const isActuallyPlayingRef = { current: true };
      const stopPlayback = vi.fn();

      act(() => {
        result.current.setupVAD({
          audioContext: ctx as unknown as AudioContext,
          source: source as unknown as MediaStreamAudioSourceNode,
          isActuallyPlayingRef,
          wsRef,
          isRecordingRef,
          expectedTurnSeqRef,
          stopPlayback,
        });
      });

      return { result, processor: ctx._processor, wsRef, expectedTurnSeqRef, stopPlayback };
    }

    function fireAudioProcess(processor: ReturnType<typeof buildMockScriptProcessor>, buffer: Float32Array) {
      const event = {
        inputBuffer: { getChannelData: () => buffer },
      };
      processor.onaudioprocess?.(event);
    }

    it('does not trigger barge-in when input is silent', () => {
      const { processor, stopPlayback } = setupAndGetProcessor();
      const silent = buildSilentBuffer();

      act(() => {
        fireAudioProcess(processor, silent);
        vi.advanceTimersByTime(BARGE_IN_DELAY_MS + 100);
        fireAudioProcess(processor, silent);
      });

      expect(stopPlayback).not.toHaveBeenCalled();
    });

    it('resets voiceActivityStartRef when RMS drops below threshold', () => {
      const { result, processor } = setupAndGetProcessor();

      act(() => {
        const voice = buildVoiceBuffer(0.1);
        fireAudioProcess(processor, voice);
      });
      expect(result.current.voiceActivityStartRef.current).not.toBeNull();

      act(() => {
        const silent = buildSilentBuffer();
        fireAudioProcess(processor, silent);
      });
      expect(result.current.voiceActivityStartRef.current).toBeNull();
    });

    it('does nothing when isRecording is false', () => {
      const { processor, stopPlayback } = setupAndGetProcessor({
        isRecordingRef: { current: false },
      });
      const voice = buildVoiceBuffer(0.5);

      act(() => {
        vi.advanceTimersByTime(BARGE_IN_DELAY_MS + 100);
        fireAudioProcess(processor, voice);
      });

      expect(stopPlayback).not.toHaveBeenCalled();
    });
  });

  describe('onaudioprocess – voice detection and barge-in', () => {
    function setupFull() {
      const { result } = renderHook(() => useVoiceActivityDetection());
      const ctx = buildMockAudioContext();
      const source = buildMockMediaStreamSource();
      const wsRef = { current: makeWs() as any };
      const isRecordingRef = { current: true };
      const expectedTurnSeqRef = { current: 2 };
      const isActuallyPlayingRef = { current: true };
      const stopPlayback = vi.fn();

      act(() => {
        result.current.setupVAD({
          audioContext: ctx as unknown as AudioContext,
          source: source as unknown as MediaStreamAudioSourceNode,
          isActuallyPlayingRef,
          wsRef,
          isRecordingRef,
          expectedTurnSeqRef,
          stopPlayback,
        });
      });

      const processor = ctx._processor;
      const fireVoice = () => {
        const voice = buildVoiceBuffer(0.1);
        processor.onaudioprocess?.({
          inputBuffer: { getChannelData: () => voice },
        });
      };
      const fireSilence = () => {
        const silent = buildSilentBuffer();
        processor.onaudioprocess?.({
          inputBuffer: { getChannelData: () => silent },
        });
      };

      return { result, processor, wsRef, expectedTurnSeqRef, stopPlayback, fireVoice, fireSilence };
    }

    it('sets voiceActivityStartRef on first voice frame above threshold', () => {
      const { result, fireVoice } = setupFull();

      act(() => { fireVoice(); });

      expect(result.current.voiceActivityStartRef.current).not.toBeNull();
    });

    it('triggers barge-in after sustained voice above BARGE_IN_DELAY_MS', () => {
      const { stopPlayback, fireVoice } = setupFull();

      act(() => {
        fireVoice();
        vi.advanceTimersByTime(BARGE_IN_DELAY_MS + 50);
        fireVoice();
      });

      expect(stopPlayback).toHaveBeenCalled();
    });

    it('increments expectedTurnSeqRef on barge-in', () => {
      const { expectedTurnSeqRef, fireVoice } = setupFull();
      const before = expectedTurnSeqRef.current;

      act(() => {
        fireVoice();
        vi.advanceTimersByTime(BARGE_IN_DELAY_MS + 50);
        fireVoice();
      });

      expect(expectedTurnSeqRef.current).toBe(before + 1);
    });

    it('sends response.cancel to WebSocket on barge-in', () => {
      const { wsRef, fireVoice } = setupFull();

      act(() => {
        fireVoice();
        vi.advanceTimersByTime(BARGE_IN_DELAY_MS + 50);
        fireVoice();
      });

      expect(wsRef.current.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'response.cancel' })
      );
    });

    it('sets bargeInTriggeredRef to true on barge-in', () => {
      const { result, fireVoice } = setupFull();

      act(() => {
        fireVoice();
        vi.advanceTimersByTime(BARGE_IN_DELAY_MS + 50);
        fireVoice();
      });

      expect(result.current.bargeInTriggeredRef.current).toBe(true);
    });

    it('does not trigger barge-in twice for the same continuous voice event', () => {
      const { stopPlayback, fireVoice } = setupFull();

      act(() => {
        fireVoice();
        vi.advanceTimersByTime(BARGE_IN_DELAY_MS + 50);
        fireVoice();
        vi.advanceTimersByTime(200);
        fireVoice();
      });

      expect(stopPlayback).toHaveBeenCalledTimes(1);
    });

    it('resets bargeInTriggeredRef when voice stops', () => {
      const { result, fireVoice, fireSilence } = setupFull();

      act(() => {
        fireVoice();
        vi.advanceTimersByTime(BARGE_IN_DELAY_MS + 50);
        fireVoice();
      });
      expect(result.current.bargeInTriggeredRef.current).toBe(true);

      act(() => { fireSilence(); });

      expect(result.current.bargeInTriggeredRef.current).toBe(false);
    });

    it('does not trigger barge-in when voice duration is below BARGE_IN_DELAY_MS', () => {
      const { stopPlayback, fireVoice } = setupFull();

      act(() => {
        fireVoice();
        vi.advanceTimersByTime(BARGE_IN_DELAY_MS - 100);
        fireVoice();
      });

      expect(stopPlayback).not.toHaveBeenCalled();
    });

    it('does not trigger barge-in when playback context is not running', () => {
      const { result } = renderHook(() => useVoiceActivityDetection());
      const ctx = buildMockAudioContext();
      const source = buildMockMediaStreamSource();
      const wsRef = { current: makeWs() as any };
      const isRecordingRef = { current: true };
      const expectedTurnSeqRef = { current: 0 };
      const isActuallyPlayingRef = { current: false };
      const stopPlayback = vi.fn();

      act(() => {
        result.current.setupVAD({
          audioContext: ctx as unknown as AudioContext,
          source: source as unknown as MediaStreamAudioSourceNode,
          isActuallyPlayingRef,
          wsRef,
          isRecordingRef,
          expectedTurnSeqRef,
          stopPlayback,
        });
      });

      const voice = buildVoiceBuffer(0.1);
      act(() => {
        ctx._processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => voice } });
        vi.advanceTimersByTime(BARGE_IN_DELAY_MS + 50);
        ctx._processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => voice } });
      });

      expect(stopPlayback).not.toHaveBeenCalled();
    });

    it('does not trigger second barge-in after context suspends and bargeInTriggeredRef resets on silence', () => {
      const { result } = renderHook(() => useVoiceActivityDetection());
      const ctx = buildMockAudioContext();
      const source = buildMockMediaStreamSource();
      const wsRef = { current: makeWs() as any };
      const isRecordingRef = { current: true };
      const expectedTurnSeqRef = { current: 2 };
      const isActuallyPlayingRef = { current: true };
      const stopPlayback = vi.fn(() => {
        isActuallyPlayingRef.current = false;
      });

      act(() => {
        result.current.setupVAD({
          audioContext: ctx as unknown as AudioContext,
          source: source as unknown as MediaStreamAudioSourceNode,
          isActuallyPlayingRef,
          wsRef,
          isRecordingRef,
          expectedTurnSeqRef,
          stopPlayback,
        });
      });

      const voice = buildVoiceBuffer(0.1);
      const silent = buildSilentBuffer();
      const fire = (buf: Float32Array) =>
        ctx._processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => buf } });

      act(() => {
        fire(voice);
        vi.advanceTimersByTime(BARGE_IN_DELAY_MS + 50);
        fire(voice);
      });
      expect(stopPlayback).toHaveBeenCalledTimes(1);
      expect(expectedTurnSeqRef.current).toBe(3);

      act(() => { fire(silent); });
      expect(result.current.bargeInTriggeredRef.current).toBe(false);

      act(() => {
        fire(voice);
        vi.advanceTimersByTime(BARGE_IN_DELAY_MS + 50);
        fire(voice);
      });

      expect(stopPlayback).toHaveBeenCalledTimes(1);
      expect(expectedTurnSeqRef.current).toBe(3);
    });

    it('does not send WebSocket message when WS is not open', () => {
      const { result } = renderHook(() => useVoiceActivityDetection());
      const ctx = buildMockAudioContext();
      const source = buildMockMediaStreamSource();
      const closedWs = makeWs(WebSocket.CLOSED);
      const wsRef = { current: closedWs as any };
      const isRecordingRef = { current: true };
      const expectedTurnSeqRef = { current: 0 };
      const isActuallyPlayingRef = { current: true };
      const stopPlayback = vi.fn();

      act(() => {
        result.current.setupVAD({
          audioContext: ctx as unknown as AudioContext,
          source: source as unknown as MediaStreamAudioSourceNode,
          isActuallyPlayingRef,
          wsRef,
          isRecordingRef,
          expectedTurnSeqRef,
          stopPlayback,
        });
      });

      const voice = buildVoiceBuffer(0.1);
      act(() => {
        ctx._processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => voice } });
        vi.advanceTimersByTime(BARGE_IN_DELAY_MS + 50);
        ctx._processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => voice } });
      });

      expect(closedWs.send).not.toHaveBeenCalled();
    });
  });
});
