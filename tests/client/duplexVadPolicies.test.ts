// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoiceActivityDetection } from '../../client/src/hooks/useVoiceActivityDetection';
import { duplexVadCases } from '../fixtures/duplexVadCases';

afterEach(() => vi.useRealTimers());
describe('matched synthetic VAD policy comparison (not real-device/provider latency)', () => {
  it.each(['gemini', 'openai'])('uses the same labelled inputs and capture route for %s', () => {
    vi.useFakeTimers();
    const counts: Record<string, { valid: number; falseInterruptions: number }> = {};
    for (const policy of ['baseline', 'candidate', 'confirmed'] as const) {
      counts[policy] = { valid: 0, falseInterruptions: 0 };
      for (const sample of duplexVadCases) {
        vi.setSystemTime(100000);
        const hook = renderHook(() => useVoiceActivityDetection());
        const processor = { onaudioprocess: null as any, connect: vi.fn() };
        const context = {
          createScriptProcessor: () => processor,
          createGain: () => ({ gain: { value: 0 }, connect: vi.fn() }),
          destination: {},
        };
        const playing = { current: true };
        const recording = { current: true };
        const stop = vi.fn(() => { playing.current = false; });
        const send = vi.fn();
        act(() => hook.result.current.setupVAD({
          audioContext: context as any, source: { connect: vi.fn() } as any,
          isActuallyPlayingRef: playing, isRecordingRef: recording,
          wsRef: { current: { readyState: WebSocket.OPEN, send } as any },
          expectedTurnSeqRef: { current: 0 }, stopPlayback: stop,
          bargeInPolicy: policy,
        }));
        for (let time = 0; time < sample.durationMs; time += 50) {
          act(() => {
            processor.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(4096).fill(0.1) } });
            vi.advanceTimersByTime(50);
          });
        }
        if (stop.mock.calls.length) {
          counts[policy][sample.label === 'valid' ? 'valid' : 'falseInterruptions']++;
          expect(stop.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]);
        }
        expect(recording.current).toBe(true);
        hook.unmount();
      }
    }
    // Same N=8 per policy: 2 valid utterances; 6 non-interrupting examples.
    // Sustained acoustic energy cannot semantically distinguish long echo.
    expect(counts).toEqual({
      baseline: { valid: 2, falseInterruptions: 2 },
      candidate: { valid: 2, falseInterruptions: 6 },
      confirmed: { valid: 2, falseInterruptions: 1 },
    });
  });
});
