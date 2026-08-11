// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const VAD_SENSITIVITY_KEY = 'vad_sensitivity';
const VAD_SENSITIVITY_DEFAULT = 3;

vi.mock('../../client/src/hooks/useAudioPlayback', () => ({
  useAudioPlayback: () => ({
    playbackContextRef: { current: null },
    scheduledSourcesRef: { current: [] },
    nextPlayTimeRef: { current: 0 },
    analyserNodeRef: { current: null },
    gainNodeRef: { current: null },
    isAISpeaking: false,
    isAISpeakingRef: { current: false },
    isActuallyPlayingRef: { current: false },
    audioAmplitude: 0,
    setIsAISpeaking: vi.fn(),
    stopPlayback: vi.fn(),
    playAudioDelta: vi.fn(),
    startAmplitudeAnalysis: vi.fn(),
    stopAmplitudeAnalysis: vi.fn(),
    outputDevices: [],
    selectedOutputDeviceId: '',
    outputStatus: 'unsupported',
    outputMessage: null,
    outputNeedsPermission: false,
    outputListUnavailable: false,
    requestOutputDevicePermission: vi.fn(async () => false),
    selectOutputDevice: vi.fn(),
    refreshOutputDevices: vi.fn(),
    initializePlaybackContext: vi.fn(async () => null),
    resumePlayback: vi.fn(async () => true),
  }),
}));

vi.mock('../../client/src/hooks/useVoiceActivityDetection', () => ({
  useVoiceActivityDetection: () => ({
    vadProcessorRef: { current: null },
    voiceActivityStartRef: { current: null },
    bargeInTriggeredRef: { current: false },
    userAudioAmplitude: 0,
    setupVAD: vi.fn(),
    updateThresholds: vi.fn(),
  }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

class MockWebSocket {
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 3;
  onopen: (() => void) | null = null;
  onclose: ((e: any) => void) | null = null;
  onmessage: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  send = vi.fn();
  close = vi.fn();
}
(globalThis as any).WebSocket = MockWebSocket;
(globalThis as any).WebSocket.OPEN = 1;
(globalThis as any).WebSocket.CLOSING = 2;
(globalThis as any).WebSocket.CLOSED = 3;

import { useRealtimeVoice } from '../../client/src/hooks/useRealtimeVoice';

function buildProps(overrides: Record<string, unknown> = {}) {
  return {
    conversationId: 'conv-1',
    scenarioId: 1,
    personaId: 1,
    enabled: false,
    ...overrides,
  };
}

describe('useRealtimeVoice — VAD sensitivity localStorage persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('initialises vadSensitivity to the default (3) when localStorage has no saved value', () => {
    const { result } = renderHook(() => useRealtimeVoice(buildProps()));
    expect(result.current.vadSensitivity).toBe(VAD_SENSITIVITY_DEFAULT);
  });

  it('restores vadSensitivity from a valid value (5) saved in localStorage', () => {
    localStorage.setItem(VAD_SENSITIVITY_KEY, '5');
    const { result } = renderHook(() => useRealtimeVoice(buildProps()));
    expect(result.current.vadSensitivity).toBe(5);
  });

  it('restores vadSensitivity = 1 (minimum valid value) from localStorage', () => {
    localStorage.setItem(VAD_SENSITIVITY_KEY, '1');
    const { result } = renderHook(() => useRealtimeVoice(buildProps()));
    expect(result.current.vadSensitivity).toBe(1);
  });

  it('falls back to the default (3) when localStorage contains a non-numeric string', () => {
    localStorage.setItem(VAD_SENSITIVITY_KEY, 'corrupt');
    const { result } = renderHook(() => useRealtimeVoice(buildProps()));
    expect(result.current.vadSensitivity).toBe(VAD_SENSITIVITY_DEFAULT);
  });

  it('falls back to the default (3) when localStorage value is below the valid range (0)', () => {
    localStorage.setItem(VAD_SENSITIVITY_KEY, '0');
    const { result } = renderHook(() => useRealtimeVoice(buildProps()));
    expect(result.current.vadSensitivity).toBe(VAD_SENSITIVITY_DEFAULT);
  });

  it('falls back to the default (3) when localStorage value is above the valid range (6)', () => {
    localStorage.setItem(VAD_SENSITIVITY_KEY, '6');
    const { result } = renderHook(() => useRealtimeVoice(buildProps()));
    expect(result.current.vadSensitivity).toBe(VAD_SENSITIVITY_DEFAULT);
  });

  it('falls back to the default (3) when localStorage value is empty string', () => {
    localStorage.setItem(VAD_SENSITIVITY_KEY, '');
    const { result } = renderHook(() => useRealtimeVoice(buildProps()));
    expect(result.current.vadSensitivity).toBe(VAD_SENSITIVITY_DEFAULT);
  });

  it('setVadSensitivity updates vadSensitivity state and persists to localStorage', () => {
    const { result } = renderHook(() => useRealtimeVoice(buildProps()));

    expect(result.current.vadSensitivity).toBe(VAD_SENSITIVITY_DEFAULT);

    act(() => {
      result.current.setVadSensitivity(4);
    });

    expect(result.current.vadSensitivity).toBe(4);
    expect(localStorage.getItem(VAD_SENSITIVITY_KEY)).toBe('4');
  });

  it('setVadSensitivity clamps values below 1 to 1 and writes clamped value', () => {
    const { result } = renderHook(() => useRealtimeVoice(buildProps()));

    act(() => {
      result.current.setVadSensitivity(0);
    });

    expect(result.current.vadSensitivity).toBe(1);
    expect(localStorage.getItem(VAD_SENSITIVITY_KEY)).toBe('1');
  });

  it('setVadSensitivity clamps values above 5 to 5 and writes clamped value', () => {
    const { result } = renderHook(() => useRealtimeVoice(buildProps()));

    act(() => {
      result.current.setVadSensitivity(99);
    });

    expect(result.current.vadSensitivity).toBe(5);
    expect(localStorage.getItem(VAD_SENSITIVITY_KEY)).toBe('5');
  });

  it('persisted value survives a simulated reconnect (unmount + remount reads same localStorage)', () => {
    localStorage.setItem(VAD_SENSITIVITY_KEY, '2');

    const first = renderHook(() => useRealtimeVoice(buildProps()));
    expect(first.result.current.vadSensitivity).toBe(2);
    first.unmount();

    const second = renderHook(() => useRealtimeVoice(buildProps()));
    expect(second.result.current.vadSensitivity).toBe(2);
  });

  it('a value written by setVadSensitivity is picked up by the next mount (post-reconnect)', () => {
    const first = renderHook(() => useRealtimeVoice(buildProps()));

    act(() => {
      first.result.current.setVadSensitivity(1);
    });

    expect(localStorage.getItem(VAD_SENSITIVITY_KEY)).toBe('1');
    first.unmount();

    const second = renderHook(() => useRealtimeVoice(buildProps()));
    expect(second.result.current.vadSensitivity).toBe(1);
  });
});
