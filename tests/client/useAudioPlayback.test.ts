// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRef } from 'react';
import { useAudioPlayback } from '../../client/src/hooks/useAudioPlayback';

// Provide a minimal react-i18next mock that resolves real Korean translations
// so message assertions remain meaningful across i18n refactors.
// The factory must be async and self-contained because vitest hoists vi.mock calls
// before module-scope code runs, so top-level imports cannot be referenced here.
vi.mock('react-i18next', () => {
  // require() is synchronous — safe inside a vi.mock factory (no dynamic import hang).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ko = require('../../client/src/locales/ko.json') as Record<string, unknown>;

  function resolveDotKey(obj: Record<string, unknown>, key: string): string {
    const parts = key.split('.');
    let val: unknown = obj;
    for (const p of parts) {
      if (val && typeof val === 'object') val = (val as Record<string, unknown>)[p];
      else return key;
    }
    return typeof val === 'string' ? val : key;
  }

  // t must be a stable reference so useCallback([..., t]) deps don't change
  // every render and cause an infinite re-render loop.
  const t = (key: string, opts?: Record<string, unknown>) => {
    const raw = resolveDotKey(ko, key);
    return raw.replace(/\{\{(\w+)\}\}/g, (_: string, k: string) => String((opts ?? {})[k] ?? `{{${k}}}`));
  };

  return {
    useTranslation: () => ({ t }),
  };
});

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
    threshold: { value: -10 },
    knee: { value: 40 },
    ratio: { value: 4 },
    attack: { value: 0.008 },
    release: { value: 0.1 },
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
    setSinkId: undefined as undefined | ((deviceId: string) => Promise<void>),
    _analyser: analyser,
    _gainNode: gainNode,
    _compressorNode: compressorNode,
    get _lastBuffer() { return _lastBuffer; },
  };
  return ctx;
}

let mockContext: ReturnType<typeof buildMockAudioContext>;

beforeEach(() => {
  localStorage.clear();
  mockContext = buildMockAudioContext();
  (globalThis as any).AudioContext = vi.fn(function () { return mockContext; });
  (globalThis as any).webkitAudioContext = vi.fn(function () { return mockContext; });

  (globalThis as any).atob = (b64: string) =>
    Buffer.from(b64, 'base64').toString('binary');

  (globalThis as any).requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
    return 1;
  });
  (globalThis as any).cancelAnimationFrame = vi.fn();
  (navigator as any).mediaDevices = {
    enumerateDevices: vi.fn(async () => []),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
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
  describe('audio output device management', () => {
    it('reports unsupported status without the browser output-selection API', async () => {
      const { result } = renderAudioPlayback();
      await act(async () => { await result.current.refreshOutputDevices(); });
      expect(result.current.outputStatus).toBe('unsupported');
      await act(async () => {
        await expect(result.current.selectOutputDevice('bluetooth-1')).resolves.toBe(false);
      });
      expect(result.current.outputMessage).toContain('직접 선택할 수 없습니다');
    });

    it('uses the iOS system route, clears stale output choices, and activates the call audio session', async () => {
      const userAgent = vi.spyOn(navigator, 'userAgent', 'get')
        .mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15');
      const audioSession = { type: 'auto' };
      Object.defineProperty(navigator, 'audioSession', {
        configurable: true,
        value: audioSession,
      });
      const audioContextConstructor = vi.fn(function MockIOSAudioContext() {
        expect(audioSession.type).toBe('play-and-record');
        return mockContext;
      });
      (globalThis as any).AudioContext = audioContextConstructor;
      (globalThis as any).webkitAudioContext = audioContextConstructor;
      (window as any).AudioContext = audioContextConstructor;
      (window as any).webkitAudioContext = audioContextConstructor;
      localStorage.setItem('realtime_voice_output_device_id', 'stale-airpods-output');
      localStorage.setItem('realtime_voice_output_auto_selected', '1');
      localStorage.setItem('realtime_voice_output_user_chose', '1');

      const { result } = renderAudioPlayback();
      await act(async () => {});

      expect(result.current.selectedOutputDeviceId).toBe('');
      expect(result.current.outputDevices).toEqual([]);
      expect(result.current.outputListUnavailable).toBe(true);
      expect(result.current.outputMessage).toContain('iOS가 함께 제어');
      expect(localStorage.getItem('realtime_voice_output_device_id')).toBeNull();
      expect(localStorage.getItem('realtime_voice_output_auto_selected')).toBeNull();
      expect(localStorage.getItem('realtime_voice_output_user_chose')).toBeNull();

      await act(async () => {
        await result.current.initializePlaybackContext();
      });
      expect(audioSession.type).toBe('play-and-record');

      audioSession.type = 'auto';
      mockContext.state = 'suspended';
      await act(async () => {
        await expect(result.current.resumePlayback()).resolves.toBe(true);
      });
      expect(audioSession.type).toBe('play-and-record');

      userAgent.mockRestore();
      delete (navigator as any).audioSession;
    });

    it('lists output devices and persists a supported selected device', async () => {
      mockContext.setSinkId = vi.fn(async () => {});
      (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
        { kind: 'audiooutput', deviceId: 'default', label: 'Phone speaker' },
        { kind: 'audiooutput', deviceId: 'bluetooth-1', label: 'My earbuds' },
      ]);
      const { result } = renderAudioPlayback();
      result.current.playbackContextRef.current = mockContext as unknown as AudioContext;
      await act(async () => {
        await result.current.refreshOutputDevices();
        await result.current.selectOutputDevice('bluetooth-1');
      });
      expect(result.current.outputDevices).toHaveLength(2);
      expect(mockContext.setSinkId).toHaveBeenCalledWith('bluetooth-1');
      expect(localStorage.getItem('realtime_voice_output_device_id')).toBe('bluetooth-1');
    });

    it('keeps a saved device while the device list is still permission-gated', async () => {
      mockContext.setSinkId = vi.fn(async () => {});
      localStorage.setItem('realtime_voice_output_device_id', 'bluetooth-1');
      (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
        { kind: 'audiooutput', deviceId: '', label: '' },
      ]);
      const { result } = renderAudioPlayback();
      result.current.playbackContextRef.current = mockContext as unknown as AudioContext;
      await act(async () => { await result.current.refreshOutputDevices(); });
      expect(result.current.selectedOutputDeviceId).toBe('bluetooth-1');
      expect(localStorage.getItem('realtime_voice_output_device_id')).toBe('bluetooth-1');
    });

    it('falls back to default when the saved output disappears after devicechange', async () => {
      mockContext.setSinkId = vi.fn(async () => {});
      localStorage.setItem('realtime_voice_output_device_id', 'bluetooth-1');
      (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
        { kind: 'audiooutput', deviceId: 'default', label: 'Phone speaker' },
      ]);
      const { result } = renderAudioPlayback();
      result.current.playbackContextRef.current = mockContext as unknown as AudioContext;
      await act(async () => { await result.current.refreshOutputDevices(); });
      expect(mockContext.setSinkId).toHaveBeenCalledWith('');
      expect(result.current.selectedOutputDeviceId).toBe('');
      expect(result.current.outputMessage).toContain('연결 해제');
    });

    it('surfaces an AudioContext resume failure for retry', async () => {
      Object.defineProperty(mockContext, 'state', { get: () => 'suspended', configurable: true });
      mockContext.resume = vi.fn(async () => { throw new Error('blocked'); });
      const { result } = renderAudioPlayback();
      result.current.playbackContextRef.current = mockContext as unknown as AudioContext;
      await act(async () => {
        await expect(result.current.resumePlayback()).resolves.toBe(false);
      });
      expect(result.current.outputStatus).toBe('error');
      expect(result.current.outputMessage).toContain('다시 시작하지 못했습니다');
    });

    it('lists phone speaker and Bluetooth outputs as separate labelled choices', async () => {
      mockContext.setSinkId = vi.fn(async () => {});
      (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
        { kind: 'audiooutput', deviceId: 'default', label: 'Default - Speakerphone' },
        { kind: 'audiooutput', deviceId: 'speaker-1', label: 'Speaker' },
        { kind: 'audiooutput', deviceId: 'bt-1', label: 'Galaxy Buds Pro (Bluetooth)' },
      ]);
      const { result } = renderAudioPlayback();
      result.current.playbackContextRef.current = mockContext as unknown as AudioContext;
      await act(async () => { await result.current.refreshOutputDevices(); });

      expect(result.current.outputNeedsPermission).toBe(false);
      expect(result.current.outputDevices.map((d: any) => d.kind)).toEqual(['default', 'speaker', 'bluetooth']);
      expect(result.current.outputDevices[2].label).toContain('블루투스');

      await act(async () => { await result.current.selectOutputDevice('bt-1'); });
      expect(mockContext.setSinkId).toHaveBeenCalledWith('bt-1');
      expect(result.current.selectedOutputDeviceId).toBe('bt-1');
    });

    it('reports outputs unavailable when permission is granted but the browser exposes no outputs', async () => {
      // Android Chrome: mic label visible (permission granted) but no audiooutput entries.
      mockContext.setSinkId = vi.fn(async () => {});
      (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
        { kind: 'audioinput', deviceId: 'mic-1', label: 'Phone microphone' },
      ]);
      const { result } = renderAudioPlayback();
      result.current.playbackContextRef.current = mockContext as unknown as AudioContext;
      await act(async () => { await result.current.refreshOutputDevices(); });

      expect(result.current.outputNeedsPermission).toBe(false);
      expect(result.current.outputListUnavailable).toBe(true);
      expect(result.current.outputStatus).toBe('supported');
      expect(result.current.outputMessage).toContain('제공하지 않아');
    });

    it('keeps asking for permission only while no device label at all is visible', async () => {
      mockContext.setSinkId = vi.fn(async () => {});
      (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
        { kind: 'audioinput', deviceId: '', label: '' },
        { kind: 'audiooutput', deviceId: '', label: '' },
      ]);
      const { result } = renderAudioPlayback();
      result.current.playbackContextRef.current = mockContext as unknown as AudioContext;
      await act(async () => { await result.current.refreshOutputDevices(); });

      expect(result.current.outputNeedsPermission).toBe(true);
      expect(result.current.outputListUnavailable).toBe(false);
    });

    it('flags missing permission and loads real devices once permission is granted', async () => {
      mockContext.setSinkId = vi.fn(async () => {});
      (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
        { kind: 'audiooutput', deviceId: '', label: '' },
      ]);
      const stopTrack = vi.fn();
      (navigator.mediaDevices as any).getUserMedia = vi.fn(async () => ({
        getTracks: () => [{ stop: stopTrack }],
      }));
      const { result } = renderAudioPlayback();
      result.current.playbackContextRef.current = mockContext as unknown as AudioContext;
      await act(async () => { await result.current.refreshOutputDevices(); });

      expect(result.current.outputNeedsPermission).toBe(true);
      expect(result.current.outputDevices).toHaveLength(1);
      expect(result.current.outputMessage).toContain('마이크 권한');
      // A permission-gated list must not be treated as proof the saved device vanished.
      expect(mockContext.setSinkId).not.toHaveBeenCalledWith('');

      (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
        { kind: 'audiooutput', deviceId: 'default', label: 'Default - Speaker' },
        { kind: 'audiooutput', deviceId: 'bt-1', label: 'AirPods Pro' },
      ]);
      await act(async () => {
        await expect(result.current.requestOutputDevicePermission()).resolves.toBe(true);
      });

      expect(stopTrack).toHaveBeenCalled();
      expect(result.current.outputNeedsPermission).toBe(false);
      expect(result.current.outputDevices.map((d: any) => d.deviceId)).toEqual(['', 'bt-1']);
    });

    it('surfaces a retryable message when device permission is denied', async () => {
      mockContext.setSinkId = vi.fn(async () => {});
      (navigator.mediaDevices as any).getUserMedia = vi.fn(async () => { throw new Error('denied'); });
      const { result } = renderAudioPlayback();
      result.current.playbackContextRef.current = mockContext as unknown as AudioContext;
      await act(async () => {
        await expect(result.current.requestOutputDevicePermission()).resolves.toBe(false);
      });
      expect(result.current.outputStatus).toBe('error');
      expect(result.current.outputMessage).toContain('권한');
    });

    it('picks up a Bluetooth headset connected mid-session on devicechange', async () => {
      mockContext.setSinkId = vi.fn(async () => {});
      (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
        { kind: 'audiooutput', deviceId: 'default', label: 'Default - Speaker' },
      ]);
      const { result } = renderAudioPlayback();
      result.current.playbackContextRef.current = mockContext as unknown as AudioContext;
      await act(async () => { await result.current.refreshOutputDevices(); });
      expect(result.current.outputDevices).toHaveLength(1);

      (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
        { kind: 'audiooutput', deviceId: 'default', label: 'Default - Speaker' },
        { kind: 'audiooutput', deviceId: 'bt-1', label: 'WF-1000XM5 Bluetooth' },
      ]);
      await act(async () => { await result.current.refreshOutputDevices(); });

      expect(result.current.outputDevices.map((d: any) => d.deviceId)).toEqual(['', 'bt-1']);
      expect(result.current.outputDevices[1].kind).toBe('bluetooth');
    });

    it('keeps simultaneous initial chunks in arrival order while applying a saved output', async () => {
      localStorage.setItem('realtime_voice_output_device_id', 'bluetooth-1');
      let resolveSinkChange: (() => void) | undefined;
      mockContext.setSinkId = vi.fn(() => new Promise<void>(resolve => { resolveSinkChange = resolve; }));
      const createdSources: ReturnType<typeof buildMockSource>[] = [];
      mockContext.createBufferSource = vi.fn(() => {
        const source = buildMockSource();
        createdSources.push(source);
        return source;
      });
      const { result } = renderAudioPlayback();
      const first = Buffer.from(new Int16Array([1000]).buffer).toString('base64');
      const second = Buffer.from(new Int16Array([2000, 2000]).buffer).toString('base64');

      let firstPromise!: Promise<void>;
      let secondPromise!: Promise<void>;
      await act(async () => {
        firstPromise = result.current.playAudioDelta(first);
        secondPromise = result.current.playAudioDelta(second);
        await Promise.resolve();
      });
      expect(mockContext.setSinkId).toHaveBeenCalledWith('bluetooth-1');
      expect(mockContext.createBufferSource).not.toHaveBeenCalled();

      await act(async () => {
        resolveSinkChange?.();
        await Promise.all([firstPromise, secondPromise]);
      });
      expect(createdSources).toHaveLength(2);
      expect((createdSources[0].buffer as any).getChannelData(0).length).toBe(1);
      expect((createdSources[1].buffer as any).getChannelData(0).length).toBe(2);
      expect(createdSources[0].start.mock.invocationCallOrder[0])
        .toBeLessThan(createdSources[1].start.mock.invocationCallOrder[0]);
    });

    it('does not schedule a chunk cancelled while its saved output is being applied', async () => {
      localStorage.setItem('realtime_voice_output_device_id', 'bluetooth-1');
      let resolveSinkChange: (() => void) | undefined;
      mockContext.setSinkId = vi.fn(() => new Promise<void>(resolve => { resolveSinkChange = resolve; }));
      const { result, isInterruptedRef } = renderAudioPlayback();
      const chunk = Buffer.from(new Int16Array([1000]).buffer).toString('base64');

      const playback = result.current.playAudioDelta(chunk);
      await act(async () => { await Promise.resolve(); });
      isInterruptedRef.current = true;
      await act(async () => {
        resolveSinkChange?.();
        await playback;
      });
      expect(mockContext.createBufferSource).not.toHaveBeenCalled();
    });

    describe('Bluetooth auto-selection', () => {
      const OUTPUT_DEVICE_KEY = 'realtime_voice_output_device_id';
      const OUTPUT_USER_CHOSE_KEY = 'realtime_voice_output_user_chose';
      const OUTPUT_AUTO_SELECTED_KEY = 'realtime_voice_output_auto_selected';

      it('auto-selects a Bluetooth output when there is no saved choice', async () => {
        mockContext.setSinkId = vi.fn(async () => {});
        (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
          { kind: 'audiooutput', deviceId: 'default', label: 'Default - Speaker' },
          { kind: 'audiooutput', deviceId: 'bt-1', label: 'AirPods Pro' },
        ]);
        const { result } = renderAudioPlayback();
        result.current.playbackContextRef.current = mockContext as unknown as AudioContext;
        await act(async () => { await result.current.refreshOutputDevices(); });

        expect(result.current.selectedOutputDeviceId).toBe('bt-1');
        expect(result.current.outputAutoSelected).toBe(true);
        expect(mockContext.setSinkId).toHaveBeenCalledWith('bt-1');
        expect(localStorage.getItem(OUTPUT_DEVICE_KEY)).toBe('bt-1');
        expect(localStorage.getItem(OUTPUT_AUTO_SELECTED_KEY)).toBe('1');
        expect(result.current.outputMessage).toContain('자동으로 선택');
      });

      it('keeps the OS/browser default when no Bluetooth output exists', async () => {
        mockContext.setSinkId = vi.fn(async () => {});
        (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
          { kind: 'audiooutput', deviceId: 'default', label: 'Default - Speaker' },
          { kind: 'audiooutput', deviceId: 'speaker-1', label: 'Speaker' },
        ]);
        const { result } = renderAudioPlayback();
        result.current.playbackContextRef.current = mockContext as unknown as AudioContext;
        await act(async () => { await result.current.refreshOutputDevices(); });

        expect(result.current.selectedOutputDeviceId).toBe('');
        expect(result.current.outputAutoSelected).toBe(false);
        expect(localStorage.getItem(OUTPUT_DEVICE_KEY)).toBeNull();
      });

      it('does not override an output the user explicitly chose', async () => {
        mockContext.setSinkId = vi.fn(async () => {});
        localStorage.setItem(OUTPUT_DEVICE_KEY, 'speaker-1');
        localStorage.setItem(OUTPUT_USER_CHOSE_KEY, '1');
        (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
          { kind: 'audiooutput', deviceId: 'default', label: 'Default - Speaker' },
          { kind: 'audiooutput', deviceId: 'speaker-1', label: 'Speaker' },
          { kind: 'audiooutput', deviceId: 'bt-1', label: 'Galaxy Buds Pro (Bluetooth)' },
        ]);
        const { result } = renderAudioPlayback();
        result.current.playbackContextRef.current = mockContext as unknown as AudioContext;
        await act(async () => { await result.current.refreshOutputDevices(); });

        expect(result.current.selectedOutputDeviceId).toBe('speaker-1');
        expect(result.current.outputAutoSelected).toBe(false);
        expect(mockContext.setSinkId).not.toHaveBeenCalledWith('bt-1');
      });

      it('replaces a previously auto-selected output with a newly connected Bluetooth device', async () => {
        mockContext.setSinkId = vi.fn(async () => {});
        localStorage.setItem(OUTPUT_DEVICE_KEY, 'old-bt');
        localStorage.setItem(OUTPUT_AUTO_SELECTED_KEY, '1');
        (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
          { kind: 'audiooutput', deviceId: 'default', label: 'Default - Speaker' },
          { kind: 'audiooutput', deviceId: 'old-bt', label: 'Old Buds (Bluetooth)' },
          { kind: 'audiooutput', deviceId: 'new-bt', label: 'AirPods Pro' },
        ]);
        const { result } = renderAudioPlayback();
        result.current.playbackContextRef.current = mockContext as unknown as AudioContext;
        await act(async () => { await result.current.refreshOutputDevices(); });

        // First matching Bluetooth device in list order wins; the point is the
        // auto-selected slot stays auto and is re-evaluated on devicechange.
        expect(result.current.outputAutoSelected).toBe(true);
        expect(['old-bt', 'new-bt']).toContain(result.current.selectedOutputDeviceId);
      });

      it('clears outputAutoSelected and localStorage keys when the auto-selected output disconnects', async () => {
        mockContext.setSinkId = vi.fn(async () => {});
        // Pre-condition: a Bluetooth output was auto-selected in a previous session.
        localStorage.setItem(OUTPUT_DEVICE_KEY, 'bt-1');
        localStorage.setItem(OUTPUT_AUTO_SELECTED_KEY, '1');
        // The device is gone from the current enumeration.
        (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
          { kind: 'audiooutput', deviceId: 'default', label: 'Default - Speaker' },
        ]);
        const { result } = renderAudioPlayback();
        result.current.playbackContextRef.current = mockContext as unknown as AudioContext;
        await act(async () => { await result.current.refreshOutputDevices(); });

        expect(result.current.selectedOutputDeviceId).toBe('');
        expect(result.current.outputAutoSelected).toBe(false);
        expect(localStorage.getItem(OUTPUT_AUTO_SELECTED_KEY)).toBeNull();
        expect(result.current.outputMessage).toContain('연결 해제');
        // setSinkId must have been called with '' to route audio to the default device.
        expect(mockContext.setSinkId).toHaveBeenCalledWith('');
      });

      it('re-auto-selects after fallback when the Bluetooth output reconnects (round-trip)', async () => {
        mockContext.setSinkId = vi.fn(async () => {});
        // Start: auto-selected bt-1 is persisted but now gone.
        localStorage.setItem(OUTPUT_DEVICE_KEY, 'bt-1');
        localStorage.setItem(OUTPUT_AUTO_SELECTED_KEY, '1');
        (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
          { kind: 'audiooutput', deviceId: 'default', label: 'Default - Speaker' },
        ]);
        const { result } = renderAudioPlayback();
        result.current.playbackContextRef.current = mockContext as unknown as AudioContext;
        await act(async () => { await result.current.refreshOutputDevices(); });

        // After disconnect: fallen back to default, flags cleared.
        expect(result.current.selectedOutputDeviceId).toBe('');
        expect(result.current.outputAutoSelected).toBe(false);
        expect(localStorage.getItem(OUTPUT_AUTO_SELECTED_KEY)).toBeNull();

        // Reconnect: bt-1 appears again.
        (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
          { kind: 'audiooutput', deviceId: 'default', label: 'Default - Speaker' },
          { kind: 'audiooutput', deviceId: 'bt-1', label: 'AirPods Pro' },
        ]);
        await act(async () => { await result.current.refreshOutputDevices(); });

        expect(result.current.selectedOutputDeviceId).toBe('bt-1');
        expect(result.current.outputAutoSelected).toBe(true);
        expect(localStorage.getItem(OUTPUT_DEVICE_KEY)).toBe('bt-1');
        expect(localStorage.getItem(OUTPUT_AUTO_SELECTED_KEY)).toBe('1');
        expect(mockContext.setSinkId).toHaveBeenCalledWith('bt-1');
      });

      it('selectOutputDeviceByUser marks the choice explicit so auto-selection stays off', async () => {
        mockContext.setSinkId = vi.fn(async () => {});
        (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
          { kind: 'audiooutput', deviceId: 'default', label: 'Default - Speaker' },
          { kind: 'audiooutput', deviceId: 'bt-1', label: 'AirPods Pro' },
        ]);
        const { result } = renderAudioPlayback();
        result.current.playbackContextRef.current = mockContext as unknown as AudioContext;
        await act(async () => { await result.current.refreshOutputDevices(); });
        expect(result.current.outputAutoSelected).toBe(true);

        await act(async () => { await result.current.selectOutputDeviceByUser(''); });
        expect(result.current.outputAutoSelected).toBe(false);
        expect(localStorage.getItem(OUTPUT_USER_CHOSE_KEY)).toBe('1');

        // A later refresh must not re-grab the Bluetooth output.
        await act(async () => { await result.current.refreshOutputDevices(); });
        expect(result.current.selectedOutputDeviceId).toBe('');
        expect(result.current.outputAutoSelected).toBe(false);
      });
    });

    it('keeps the output error when fallback to the default device fails', async () => {
      mockContext.setSinkId = vi.fn(async () => { throw new Error('default unavailable'); });
      localStorage.setItem('realtime_voice_output_device_id', 'bluetooth-1');
      (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
        { kind: 'audiooutput', deviceId: 'default', label: 'Phone speaker' },
      ]);
      const { result } = renderAudioPlayback();
      result.current.playbackContextRef.current = mockContext as unknown as AudioContext;
      await act(async () => { await result.current.refreshOutputDevices(); });
      expect(result.current.outputStatus).toBe('error');
      expect(result.current.outputMessage).toContain('변경하지 못했습니다');
    });
  });

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

    it('initializes DynamicsCompressorNode with fine-tuned parameters', async () => {
      const { result } = renderAudioPlayback();
      result.current.playbackContextRef.current = mockContext as unknown as AudioContext;

      const pcm16 = new Int16Array([1000]);
      const b64 = Buffer.from(pcm16.buffer).toString('base64');

      await act(async () => {
        await result.current.playAudioDelta(b64);
      });

      const compressor = mockContext._compressorNode;
      // threshold=-10 dBFS: sits above AGC steady-state (~-16 dBFS), engages only on transients
      expect(compressor.threshold.value).toBe(-10);
      // knee=40 dB: wide soft-knee for a gradual, transparent onset
      expect(compressor.knee.value).toBe(40);
      // ratio=4:1: gentle limiting (not brick-wall); AGC already normalises level
      expect(compressor.ratio.value).toBe(4);
      // attack=8 ms: lets natural transients through before clamping
      expect(compressor.attack.value).toBeCloseTo(0.008, 4);
      // release=100 ms: recovers fast enough to avoid pumping between words
      expect(compressor.release.value).toBeCloseTo(0.1, 4);
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

  describe('cross-chunk AGC', () => {
    it('writes AGC-scaled samples to AudioBuffer after playAudioDelta (behavior-level)', async () => {
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
      // AGC should scale samples — result must stay within [-1, 1]
      for (let i = 0; i < channelData.length; i++) {
        expect(Math.abs(channelData[i])).toBeLessThanOrEqual(1.0);
      }
      // At least one sample should be non-zero (audio was not silenced)
      const anyNonZero = Array.from(channelData).some(v => Math.abs(v) > 0.001);
      expect(anyNonZero).toBe(true);
    });

    it('AGC math scales non-silent chunks toward target RMS 0.15', () => {
      const AGC_TARGET_RMS = 0.15;
      const AGC_SILENCE_THRESHOLD = 0.01;
      const AGC_ATTACK_COEFF = 0.05;
      const AGC_RELEASE_COEFF = 0.015;
      const AGC_MIN_GAIN = 0.5;
      const AGC_MAX_GAIN = 4.0;

      const pcm16Values = [16384, -16384];
      const pcm16 = new Int16Array(pcm16Values);
      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 32768.0;
      }

      let sumSq = 0;
      for (let i = 0; i < float32.length; i++) sumSq += float32[i] * float32[i];
      const chunkRms = Math.sqrt(sumSq / float32.length);

      let agcRms = AGC_TARGET_RMS;
      if (chunkRms >= AGC_SILENCE_THRESHOLD) {
        const coeff = chunkRms > agcRms ? AGC_ATTACK_COEFF : AGC_RELEASE_COEFF;
        agcRms = agcRms * (1 - coeff) + chunkRms * coeff;
      }

      const agcGain = Math.min(AGC_MAX_GAIN, Math.max(AGC_MIN_GAIN, AGC_TARGET_RMS / agcRms));
      for (let i = 0; i < float32.length; i++) {
        float32[i] = Math.max(-1.0, Math.min(1.0, float32[i] * agcGain));
      }

      // Gain should be within allowed bounds
      expect(agcGain).toBeGreaterThanOrEqual(AGC_MIN_GAIN);
      expect(agcGain).toBeLessThanOrEqual(AGC_MAX_GAIN);
      // Samples remain clipped to [-1, 1]
      for (let i = 0; i < float32.length; i++) {
        expect(Math.abs(float32[i])).toBeLessThanOrEqual(1.0);
      }
    });

    it('skips AGC scaling for near-silent chunks to prevent noise amplification', () => {
      const AGC_TARGET_RMS = 0.15;
      const AGC_SILENCE_THRESHOLD = 0.01;
      const AGC_ATTACK_COEFF = 0.05;
      const AGC_RELEASE_COEFF = 0.015;
      const AGC_MIN_GAIN = 0.5;
      const AGC_MAX_GAIN = 4.0;

      const silentFloat32 = new Float32Array([0.001, -0.001, 0.0005]);
      const original = new Float32Array(silentFloat32);

      let sumSq = 0;
      for (let i = 0; i < silentFloat32.length; i++) sumSq += silentFloat32[i] * silentFloat32[i];
      const chunkRms = Math.sqrt(sumSq / silentFloat32.length);

      // chunk RMS is below silence threshold — AGC state should NOT update
      let agcRms = AGC_TARGET_RMS;
      if (chunkRms >= AGC_SILENCE_THRESHOLD) {
        const coeff = chunkRms > agcRms ? AGC_ATTACK_COEFF : AGC_RELEASE_COEFF;
        agcRms = agcRms * (1 - coeff) + chunkRms * coeff;
      }

      // agcRms should remain at target (no update for silent chunk)
      expect(agcRms).toBeCloseTo(AGC_TARGET_RMS, 5);

      // Gain is still applied but samples stay within [-1, 1]
      if (agcRms >= AGC_SILENCE_THRESHOLD) {
        const agcGain = Math.min(AGC_MAX_GAIN, Math.max(AGC_MIN_GAIN, AGC_TARGET_RMS / agcRms));
        for (let i = 0; i < silentFloat32.length; i++) {
          silentFloat32[i] = Math.max(-1.0, Math.min(1.0, silentFloat32[i] * agcGain));
        }
      }

      for (let i = 0; i < silentFloat32.length; i++) {
        expect(Math.abs(silentFloat32[i])).toBeLessThanOrEqual(1.0);
      }
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

  describe('isActuallyPlayingRef lifecycle', () => {
    it('starts as false before any audio has been played', () => {
      const { result } = renderAudioPlayback();
      expect(result.current.isActuallyPlayingRef.current).toBe(false);
    });

    it('is true after playAudioDelta receives a valid chunk', async () => {
      const { result } = renderAudioPlayback();
      result.current.playbackContextRef.current = mockContext as unknown as AudioContext;

      const pcm16 = new Int16Array([1000, -1000]);
      const b64 = Buffer.from(pcm16.buffer).toString('base64');

      await act(async () => {
        await result.current.playAudioDelta(b64);
      });

      expect(result.current.isActuallyPlayingRef.current).toBe(true);
    });

    it('is false after stopPlayback (barge-in)', async () => {
      const { result } = renderAudioPlayback();
      result.current.playbackContextRef.current = mockContext as unknown as AudioContext;

      const pcm16 = new Int16Array([1000, -1000]);
      const b64 = Buffer.from(pcm16.buffer).toString('base64');

      await act(async () => {
        await result.current.playAudioDelta(b64);
      });

      expect(result.current.isActuallyPlayingRef.current).toBe(true);

      await act(async () => {
        result.current.stopPlayback();
      });

      expect(result.current.isActuallyPlayingRef.current).toBe(false);
    });

    it('remains false if playAudioDelta is called while isInterrupted is true', async () => {
      const { result, isInterruptedRef } = renderAudioPlayback();
      isInterruptedRef.current = true;

      const b64 = Buffer.from('silenced').toString('base64');

      await act(async () => {
        await result.current.playAudioDelta(b64);
      });

      expect(result.current.isActuallyPlayingRef.current).toBe(false);
    });

    it('is set to false by the response.done handler (orchestrator sets ref directly)', async () => {
      // In useRealtimeVoice, the response.done WebSocket message handler sets
      // isActuallyPlayingRef.current = false directly without calling stopPlayback.
      // This test verifies the ref is mutable externally, which is the contract
      // the orchestration layer depends on.
      const { result } = renderAudioPlayback();
      result.current.playbackContextRef.current = mockContext as unknown as AudioContext;

      const pcm16 = new Int16Array([1000, -1000]);
      const b64 = Buffer.from(pcm16.buffer).toString('base64');

      await act(async () => {
        await result.current.playAudioDelta(b64);
      });
      expect(result.current.isActuallyPlayingRef.current).toBe(true);

      // Simulate response.done: orchestrator sets the ref to false directly
      act(() => {
        result.current.isActuallyPlayingRef.current = false;
      });

      expect(result.current.isActuallyPlayingRef.current).toBe(false);
    });

    it('is true → false → true across a barge-in / resume cycle', async () => {
      const { result, isInterruptedRef } = renderAudioPlayback();
      result.current.playbackContextRef.current = mockContext as unknown as AudioContext;

      const pcm16 = new Int16Array([500, -500]);
      const b64 = Buffer.from(pcm16.buffer).toString('base64');

      await act(async () => {
        await result.current.playAudioDelta(b64);
      });
      expect(result.current.isActuallyPlayingRef.current).toBe(true);

      await act(async () => {
        result.current.stopPlayback();
      });
      expect(result.current.isActuallyPlayingRef.current).toBe(false);

      // Simulate response.ready clearing the barge-in flag and AudioContext resuming
      isInterruptedRef.current = false;
      await act(async () => {
        await mockContext.resume();
      });
      await act(async () => {
        await result.current.playAudioDelta(b64);
      });
      expect(result.current.isActuallyPlayingRef.current).toBe(true);
    });
  });
});
