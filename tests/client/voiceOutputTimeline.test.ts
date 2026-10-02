// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { useRealtimeVoice } from '../../client/src/hooks/useRealtimeVoice';
import { voiceOutputDiagnostic, takeVoiceOutputTrace } from '../../client/src/lib/voiceOutputDiagnostic';

vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined }) }));
vi.mock('../../client/src/hooks/use-toast', () => ({ useToast: () => ({ toast: () => {} }) }));
vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});

class Socket {
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: Socket[] = [];
  readyState = 1;
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: (event: any) => void;
  send = vi.fn();
  close = vi.fn();
  constructor() { Socket.instances.push(this); }
  receive(message: object) { this.onmessage?.({ data: JSON.stringify(message) }); }
}
const sources: any[] = [];
let context: any;
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem('authToken', 'synthetic-not-a-token');
  Socket.instances = [];
  sources.length = 0;
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  context = {
    state: 'running', currentTime: 0, destination: node(),
    resume: vi.fn(async () => { context.state = 'running'; }),
    suspend: vi.fn(async () => { context.state = 'suspended'; }),
    close: vi.fn(async () => { context.state = 'closed'; }),
    createAnalyser: () => ({ ...node(), fftSize: 256, getFloatTimeDomainData: vi.fn() }),
    createGain: () => ({ ...node(), gain: { value: 1 } }),
    createDynamicsCompressor: () => ({ ...node(), threshold: {}, knee: {}, ratio: {}, attack: {}, release: {} }),
    createBuffer: (_c: number, n: number, rate: number) => ({ duration: n / rate, getChannelData: () => new Float32Array(n) }),
    createBufferSource: () => {
      const source = { ...node(), buffer: null, playbackRate: {}, start: vi.fn(), stop: vi.fn(), onended: null };
      sources.push(source);
      return source;
    },
  };
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('AudioContext', vi.fn(function () { return context; }));
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    enumerateDevices: vi.fn(async () => []), addEventListener: vi.fn(), removeEventListener: vi.fn(),
  } });
});
afterEach(() => {
  voiceOutputDiagnostic.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const props = { conversationId: 'synthetic', scenarioId: 'synthetic', personaId: 'synthetic', enabled: false };
const pcm = Buffer.alloc(9600).toString('base64');

describe('real voice + playback hooks; mocked WebAudio, no acoustic claims', () => {
  it('provider completion clears the VAD playback flag while a 600ms scheduled tail survives', async () => {
    const hook = renderHook(() => useRealtimeVoice(props));
    try {
      voiceOutputDiagnostic.armNextSession();
      await act(async () => { await hook.result.current.connect(); });
      const socket = Socket.instances.at(-1)!;
      await act(async () => { socket.onopen?.(); await vi.advanceTimersByTimeAsync(100); });
      expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'client.ready', outputDiagnostic: true }));
      for (let chunkSeq = 1; chunkSeq <= 3; chunkSeq++) {
        await act(async () => { socket.receive({ type: 'audio.delta', delta: pcm, turnSeq: 0,
          diagnostic: { chunkSeq, frameSeq: chunkSeq, providerAtMs: 1000, serverAtMs: 1001 } }); });
      }
      expect(sources).toHaveLength(3);
      expect(sources[2].start).toHaveBeenCalledWith(0.4);
      await act(async () => { socket.receive({ type: 'response.done' }); });
      expect(hook.result.current.isAISpeaking).toBe(false);
      expect(sources.every(source => source.stop.mock.calls.length === 0)).toBe(true);
      const done = voiceOutputDiagnostic.snapshot()!.rows.find(row => row.event === 'provider-done')!;
      expect(done).toMatchObject({ pendingSources: 3, actuallyPlaying: 1, contextTimeMs: 0 });
      act(() => socket.receive({ type: 'response.done' }));
      expect(voiceOutputDiagnostic.snapshot()!.rows.filter(row => row.event === 'provider-done').at(-1))
        .toMatchObject({ pendingSources: 3, actuallyPlaying: 0 });
      // Scheduling survives provider completion. Callback time is modeled, not acoustic playback.
      context.currentTime = 0.6;
      act(() => sources.forEach(source => source.onended?.()));
      expect(voiceOutputDiagnostic.snapshot()!.rows.filter(row => row.event === 'ended')).toHaveLength(3);
      voiceOutputDiagnostic.snapshot()!.rows.filter(row => row.event === 'schedule')
        .forEach((row, i) => expect(row.endMs).toBeCloseTo((i + 1) * 200, 6));
      expect(takeVoiceOutputTrace()).toBeUndefined(); // cannot auto-arm a reconnect
    } finally { hook.unmount(); }
    expect(voiceOutputDiagnostic.snapshot()!.active).toBe(false);
  });
  it('filters old turn bytes but accepts residual bytes relabelled by response.ready', async () => {
    const hook = renderHook(() => useRealtimeVoice(props));
    try {
      voiceOutputDiagnostic.armNextSession();
      await act(async () => { await hook.result.current.connect(); });
      const socket = Socket.instances.at(-1)!;
      await act(async () => {
        socket.receive({ type: 'response.ready', turnSeq: 19 });
        socket.receive({ type: 'audio.delta', turnSeq: 18, delta: pcm });
      });
      expect(sources).toHaveLength(0);
      await act(async () => { socket.receive({ type: 'audio.delta', turnSeq: 19, delta: pcm }); });
      expect(sources).toHaveLength(1);
      expect(voiceOutputDiagnostic.snapshot()!.rows.find(row => row.event === 'drop')).toMatchObject({ reason: 7 });
    } finally { hook.unmount(); }
  });
  it('unarmed sessions add no metadata traffic or diagnostic records', async () => {
    const hook = renderHook(() => useRealtimeVoice(props));
    try {
      await act(async () => { await hook.result.current.connect(); });
      const socket = Socket.instances.at(-1)!;
      await act(async () => { socket.onopen?.(); await vi.advanceTimersByTimeAsync(100); });
      expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'client.ready' }));
    } finally { hook.unmount(); }
  });
});