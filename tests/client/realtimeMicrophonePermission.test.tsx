// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRealtimeVoice } from '../../client/src/hooks/useRealtimeVoice';
import { ChatInputBar } from '../../client/src/components/chat/ChatInputBar';

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(async () => null),
  refreshOutputs: vi.fn(async () => {}),
  playbackRef: { current: null },
  stop: vi.fn(),
  reset: vi.fn(),
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined }) }));
vi.mock('../../client/src/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.stop }) }));
vi.mock('react-i18next', () => {
  const ko = require('../../client/src/locales/ko.json');
  const t = (key: string) => key.split('.').reduce((value, part) => value?.[part], ko) ?? key;
  return { useTranslation: () => ({ t }) };
});
vi.mock('../../client/src/hooks/useAudioPlayback', () => {
  const playback = {
    playbackContextRef: mocks.playbackRef, scheduledSourcesRef: { current: [] },
    analyserNodeRef: { current: null }, gainNodeRef: { current: null },
    isAISpeaking: false, isAISpeakingRef: { current: false }, isActuallyPlayingRef: { current: false },
    audioAmplitude: 0, setIsAISpeaking: mocks.stop, stopPlayback: mocks.stop,
    playAudioDelta: mocks.stop, stopAmplitudeAnalysis: mocks.stop,
    outputDevices: [], selectedOutputDeviceId: '', outputAutoSelected: false,
    outputStatus: 'unsupported', outputMessage: null, outputNeedsPermission: false,
    outputListUnavailable: true, selectOutputDevice: mocks.stop, selectOutputDeviceByUser: mocks.stop,
    refreshOutputDevices: mocks.refreshOutputs, requestOutputDevicePermission: mocks.stop,
    initializePlaybackContext: mocks.initialize, resumePlayback: mocks.initialize,
  };
  return { useAudioPlayback: () => playback };
});
vi.mock('../../client/src/hooks/useVoiceActivityDetection', () => {
  const vad = {
    vadProcessorRef: { current: null }, voiceActivityStartRef: { current: null },
    bargeInTriggeredRef: { current: false }, userAudioAmplitude: 0,
    setupVAD: mocks.stop, updateThresholds: mocks.stop, resetVAD: mocks.reset,
  };
  return { useVoiceActivityDetection: () => vad };
});

class Socket {
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: Socket[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => { this.readyState = 3; });
  constructor() { Socket.instances.push(this); }
}
const props = { conversationId: 'permission-test', scenarioId: 'scenario', personaId: 'persona', enabled: false };
const stream = () => {
  const stop = vi.fn();
  return { stop, value: { getTracks: () => [{ stop }] } as unknown as MediaStream };
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.clearAllMocks();
  Socket.instances = [];
  vi.stubGlobal('WebSocket', Socket);
  localStorage.clear();
  localStorage.setItem('authToken', 'test-only-token');
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1');
  Object.defineProperty(navigator, 'audioSession', { configurable: true, value: { type: 'auto' } });
  (navigator as any).mediaDevices = {
    enumerateDevices: vi.fn(async () => [{ kind: 'audioinput', deviceId: 'default', label: '' }]),
    getUserMedia: vi.fn(async () => stream().value),
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (navigator as any).audioSession;
  delete (window as any).isSecureContext;
});

describe('iPhone voice-start microphone preparation', () => {
  it('does not request permission on mount, even with automatic warm-up enabled', async () => {
    renderHook(() => useRealtimeVoice({ ...props, enabled: true }));
    await act(async () => {});
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(Socket.instances).toHaveLength(0);
  });

  it.each(['missing', 'unsupported query', 'already granted'])('uses capture evidence when Permissions API is %s', async (permissionAPI) => {
    const query = vi.fn(() => {
      if (permissionAPI === 'unsupported query') return Promise.reject(new Error('unsupported'));
      return Promise.resolve({ state: 'granted' });
    });
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: permissionAPI === 'missing' ? undefined : { query } });
    const probe = stream();
    (navigator.mediaDevices.getUserMedia as any).mockImplementation(async () => {
      expect((navigator as any).audioSession.type).toBe('play-and-record');
      expect(mocks.initialize).not.toHaveBeenCalled();
      return probe.value;
    });
    const { result } = renderHook(() => useRealtimeVoice(props));
    await act(async () => { await result.current.connect(); });
    expect(query).not.toHaveBeenCalled();
    expect(probe.stop).toHaveBeenCalledOnce();
    expect(Socket.instances).toHaveLength(1);
    expect(result.current.inputNeedsPermission).toBe(false);
    expect(result.current.inputMessage).toBeNull(); // Labels may remain hidden after the probe stops.
    expect(result.current.isRecording).toBe(false); // Existing manual recording policy.
    expect(mocks.initialize).toHaveBeenCalledOnce();
    expect(mocks.refreshOutputs).toHaveBeenCalledOnce();
    expect((navigator as any).audioSession.type).toBe('play-and-record');
  });

  it('deduplicates rapid starts and a settings request while permission is pending', async () => {
    const pending = deferred<MediaStream>();
    const probe = stream();
    (navigator.mediaDevices.getUserMedia as any).mockReturnValue(pending.promise);
    const { result } = renderHook(() => useRealtimeVoice(props));
    let first!: Promise<void>, settings!: Promise<boolean>;
    act(() => {
      first = result.current.connect();
      void result.current.connect();
      settings = result.current.requestInputDevicePermission();
    });
    expect(result.current.inputPermissionPending).toBe(true);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce();
    expect(Socket.instances).toHaveLength(0);
    await act(async () => { pending.resolve(probe.value); await Promise.all([first, settings]); });
    expect(Socket.instances).toHaveLength(1);
    expect(probe.stop).toHaveBeenCalledOnce();
    expect(result.current.inputPermissionPending).toBe(false);
  });

  it('does not connect or report an old error after cancellation', async () => {
    const pending = deferred<MediaStream>();
    const probe = stream();
    (navigator.mediaDevices.getUserMedia as any).mockReturnValue(pending.promise);
    const { result } = renderHook(() => useRealtimeVoice(props));
    let connecting!: Promise<void>;
    act(() => { connecting = result.current.connect(); });
    act(() => { result.current.disconnect(); });
    await act(async () => { pending.resolve(probe.value); await connecting; });
    expect(Socket.instances).toHaveLength(0);
    expect(mocks.initialize).not.toHaveBeenCalled();
    expect(probe.stop).toHaveBeenCalledOnce();
    expect(result.current.status).toBe('disconnected');
    expect((navigator as any).audioSession.type).toBe('auto');
  });

  it('a restarted connection owns the pending result; the old attempt cannot connect or reset its audio session', async () => {
    const pending = deferred<MediaStream>();
    const probe = stream();
    (navigator.mediaDevices.getUserMedia as any).mockReturnValue(pending.promise);
    const { result } = renderHook(() => useRealtimeVoice(props));
    let old!: Promise<void>, current!: Promise<void>;
    act(() => { old = result.current.connect(); });
    act(() => { result.current.disconnect(); });
    act(() => { current = result.current.connect(); });
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce();
    await act(async () => { pending.resolve(probe.value); await Promise.all([old, current]); });
    expect(Socket.instances).toHaveLength(1);
    expect(result.current.status).toBe('connecting');
    expect((navigator as any).audioSession.type).toBe('play-and-record');
    expect(probe.stop).toHaveBeenCalledOnce();
  });

  it('stops a late permission stream after leaving the screen', async () => {
    const pending = deferred<MediaStream>();
    const probe = stream();
    (navigator.mediaDevices.getUserMedia as any).mockReturnValue(pending.promise);
    const { result, unmount } = renderHook(() => useRealtimeVoice(props));
    let connecting!: Promise<void>;
    act(() => { connecting = result.current.connect(); });
    unmount();
    await act(async () => { pending.resolve(probe.value); await connecting; });
    expect(probe.stop).toHaveBeenCalledOnce();
    expect(Socket.instances).toHaveLength(0);
    expect((navigator as any).audioSession.type).toBe('auto');
  });

  it('shows Safari settings after denial and only retries on an explicit action', async () => {
    (navigator.mediaDevices.getUserMedia as any).mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError'));
    const { result } = renderHook(() => useRealtimeVoice(props));
    await act(async () => { await result.current.connect(); });
    expect(result.current.microphoneError).toContain('Safari');
    expect(result.current.microphoneError).toContain('웹사이트 설정');
    expect(result.current.status).toBe('disconnected');
    expect(Socket.instances).toHaveLength(0);
    await act(async () => { await result.current.refreshInputDevices(); });
    expect(result.current.inputStatus).toBe('error');
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce();
    await act(async () => { await result.current.connect(); });
    expect(result.current.microphoneError).toBeNull();
    expect(result.current.inputNeedsPermission).toBe(false);
    expect(Socket.instances).toHaveLength(1);
  });

  it('provides browser-specific guidance for iPhone Chrome', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 CriOS/130.0 Mobile Safari/604.1');
    (navigator.mediaDevices.getUserMedia as any).mockRejectedValue(new DOMException('blocked', 'NotAllowedError'));
    const { result } = renderHook(() => useRealtimeVoice(props));
    await act(async () => { await result.current.connect(); });
    expect(result.current.microphoneError).toContain('해당 브라우저');
    expect(result.current.microphoneError).toContain('Safari에서');
  });

  it('refuses an insecure page without calling the capture API', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
    const { result } = renderHook(() => useRealtimeVoice(props));
    await act(async () => { await result.current.connect(); });
    expect(result.current.microphoneError).toContain('HTTPS');
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it('preserves the greeting handshake and starts manual capture with the system-default input', async () => {
    vi.useFakeTimers();
    const contexts: any[] = [];
    class CaptureContext {
      sampleRate = 48000;
      state = 'running';
      destination = {};
      close = vi.fn(async () => {});
      resume = vi.fn(async () => {});
      createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
      createGain = vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn() }));
      createScriptProcessor = vi.fn(() => {
        const node = { onaudioprocess: null as any, connect: vi.fn(), disconnect: vi.fn() };
        if (contexts.length === 1) setTimeout(() => {
          node.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(4096) } });
        }, 1500);
        return node;
      });
      constructor() {
        expect((navigator as any).audioSession.type).toBe('play-and-record');
        contexts.push(this);
      }
    }
    vi.stubGlobal('AudioContext', CaptureContext);
    const probe = stream(), capture = stream();
    (navigator.mediaDevices.getUserMedia as any)
      .mockResolvedValueOnce(probe.value).mockResolvedValueOnce(capture.value);
    const { result, unmount } = renderHook(() => useRealtimeVoice(props));
    try {
      await act(async () => { await result.current.connect(); });
      const socket = Socket.instances[0];
      act(() => { socket.onopen?.(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'client.ready' }));
      act(() => { socket.onmessage?.({ data: JSON.stringify({ type: 'session.ready' }) }); });
      expect(result.current.isRecording).toBe(false);
      let recording!: Promise<void>;
      act(() => { recording = result.current.startRecording() as unknown as Promise<void>; });
      await act(async () => { await vi.advanceTimersByTimeAsync(1500); await recording; });
      expect(result.current.isRecording).toBe(true);
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenLastCalledWith({
        audio: expect.objectContaining({ channelCount: 1, sampleRate: 16000 }),
      });
      expect((navigator.mediaDevices.getUserMedia as any).mock.calls[1][0].audio.deviceId).toBeUndefined();
      expect(probe.stop).toHaveBeenCalledOnce();
      expect(capture.stop).not.toHaveBeenCalled();
      unmount();
      expect(capture.stop).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('deduplicates recording clicks and stops a late capture result after ending', async () => {
    const { result } = renderHook(() => useRealtimeVoice(props));
    await act(async () => { await result.current.connect(); });
    act(() => { Socket.instances[0].onmessage?.({ data: JSON.stringify({ type: 'session.ready' }) }); });
    const pending = deferred<MediaStream>(), capture = stream();
    (navigator.mediaDevices.getUserMedia as any).mockReturnValue(pending.promise);
    let recording!: Promise<void>;
    act(() => {
      recording = result.current.startRecording() as unknown as Promise<void>;
      result.current.startRecording();
    });
    await act(async () => {});
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2); // Probe + one capture.
    act(() => { result.current.disconnect(); });
    await act(async () => { pending.resolve(capture.value); await recording; });
    expect(capture.stop).toHaveBeenCalledOnce();
    expect(result.current.isRecording).toBe(false);
    expect(result.current.status).toBe('disconnected');
  });

  it('does not acquire a recording stream after a cancelled settings prompt finishes', async () => {
    const { result } = renderHook(() => useRealtimeVoice(props));
    await act(async () => { await result.current.connect(); });
    act(() => { Socket.instances[0].onmessage?.({ data: JSON.stringify({ type: 'session.ready' }) }); });
    const pending = deferred<MediaStream>(), probe = stream();
    (navigator.mediaDevices.getUserMedia as any).mockReturnValue(pending.promise);
    let permission!: Promise<boolean>, recording!: Promise<void>;
    act(() => {
      permission = result.current.requestInputDevicePermission();
      recording = result.current.startRecording() as unknown as Promise<void>;
      result.current.disconnect();
    });
    await act(async () => { pending.resolve(probe.value); await Promise.all([permission, recording]); });
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2); // Two probes, no capture.
    expect(probe.stop).toHaveBeenCalledOnce();
    expect(result.current.isRecording).toBe(false);
  });

  it('shares a recording permission prompt with a restarted connection and disposes the old capture', async () => {
    const { result } = renderHook(() => useRealtimeVoice(props));
    await act(async () => { await result.current.connect(); });
    act(() => { Socket.instances[0].onmessage?.({ data: JSON.stringify({ type: 'session.ready' }) }); });
    const pending = deferred<MediaStream>(), capture = stream();
    (navigator.mediaDevices.getUserMedia as any).mockReturnValue(pending.promise);
    let recording!: Promise<void>, reconnecting!: Promise<void>;
    act(() => { recording = result.current.startRecording() as unknown as Promise<void>; });
    await act(async () => {});
    act(() => { result.current.disconnect(); });
    act(() => { reconnecting = result.current.connect(); });
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
    await act(async () => { pending.resolve(capture.value); await Promise.all([recording, reconnecting]); });
    expect(Socket.instances).toHaveLength(2);
    expect(capture.stop).toHaveBeenCalledOnce();
    expect(result.current.isRecording).toBe(false);
    expect((navigator as any).audioSession.type).toBe('play-and-record');
  });

  it.each([
    ['NotFoundError', '마이크가 없습니다'],
    ['NotReadableError', '다른 앱이나 통화'],
    ['SecurityError', 'HTTPS'],
    ['NotSupportedError', '지원되는 브라우저'],
  ])('distinguishes %s without creating a voice connection', async (name, text) => {
    (navigator.mediaDevices.getUserMedia as any).mockRejectedValue(new DOMException('failed', name));
    const { result } = renderHook(() => useRealtimeVoice(props));
    await act(async () => { await result.current.connect(); });
    expect(result.current.microphoneError).toContain(text);
    expect(Socket.instances).toHaveLength(0);
  });

  it.each(['Android Chrome', 'desktop'])('does not add a permission gate on %s', async (ua) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
    const { result } = renderHook(() => useRealtimeVoice(props));
    await act(async () => { await result.current.connect(); });
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(Socket.instances).toHaveLength(1);
  });
});

describe('visible voice-start permission controls', () => {
  const inputProps = {
    userInput: '', onUserInputChange: vi.fn(), onSendMessage: vi.fn(), onVoiceInput: vi.fn(),
    onSkipTurn: vi.fn(), isLoading: false, isRecording: false, speechSupported: false,
    mode: 'realtime-voice' as const,
  };
  const voiceProps = {
    status: 'disconnected', isRecording: false, isAISpeaking: false, isWaitingForGreeting: false,
    greetingFailed: false, greetingRetryCount: 0, conversationPhase: 'idle', showMicPrompt: false,
    onConnect: vi.fn(), onStartRecording: vi.fn(), onStopRecording: vi.fn(), onEndConversation: vi.fn(),
  };
  it('renders the permission error and explicit retry outside settings', () => {
    render(<ChatInputBar {...inputProps} realtimeVoiceProps={{ ...voiceProps, microphoneError: 'Safari에서 마이크를 허용하세요.' }} />);
    expect(screen.getByRole('alert').textContent).toContain('Safari');
    fireEvent.click(screen.getByTestId('button-retry-microphone'));
    expect(voiceProps.onConnect).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('button-audio-settings')).toBeNull();
  });
  it('shows permission progress and an immediate cancel control', () => {
    const cancel = vi.fn();
    render(<ChatInputBar {...inputProps} realtimeVoiceProps={{ ...voiceProps, status: 'connecting', inputPermissionPending: true, onCancelVoiceStart: cancel }} />);
    expect(screen.getByText('마이크 권한 확인 중...')).toBeTruthy();
    expect(screen.queryByTestId('button-start-voice')).toBeNull();
    fireEvent.click(screen.getByTestId('button-cancel-voice-start'));
    expect(cancel).toHaveBeenCalledOnce();
  });
});