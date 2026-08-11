// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudioInputDevices, buildMicrophoneConstraints } from '../../client/src/hooks/useAudioInputDevices';

const INPUT_DEVICE_KEY = 'realtime_voice_input_device_id';

beforeEach(() => {
  localStorage.clear();
  (navigator as any).mediaDevices = {
    enumerateDevices: vi.fn(async () => []),
    getUserMedia: vi.fn(async () => ({ getTracks: () => [] })),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
});

afterEach(() => {
  vi.clearAllMocks();
  delete (navigator as any).mediaDevices;
});

describe('buildMicrophoneConstraints', () => {
  it('uses exact deviceId so a wrong-mic fallback cannot silently pass as success', () => {
    expect(buildMicrophoneConstraints('bt-mic-1')).toMatchObject({
      deviceId: { exact: 'bt-mic-1' },
      channelCount: 1,
      sampleRate: 16000,
      echoCancellation: true,
      noiseSuppression: true,
    });
  });

  it('omits deviceId entirely for the default microphone', () => {
    const constraints = buildMicrophoneConstraints('');
    expect('deviceId' in constraints).toBe(false);
    expect(constraints).toMatchObject({ channelCount: 1, sampleRate: 16000 });
  });
});

describe('useAudioInputDevices', () => {
  it('reports unsupported when mediaDevices APIs are missing', async () => {
    delete (navigator as any).mediaDevices;
    const { result } = renderHook(() => useAudioInputDevices());
    await act(async () => {});
    expect(result.current.inputStatus).toBe('unsupported');
    expect(result.current.inputDevices).toEqual([]);
  });

  it('lists phone and Bluetooth microphones as separate labelled choices', async () => {
    (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
      { kind: 'audioinput', deviceId: 'default', label: 'Default - Built-in Microphone' },
      { kind: 'audioinput', deviceId: 'bt-mic', label: 'AirPods Pro Microphone' },
      { kind: 'audiooutput', deviceId: 'out-1', label: 'Speaker' },
    ]);
    const { result } = renderHook(() => useAudioInputDevices());
    await act(async () => {});
    expect(result.current.inputStatus).toBe('supported');
    expect(result.current.inputDevices).toHaveLength(2);
    expect(result.current.inputDevices[0]).toMatchObject({ deviceId: 'default', kind: 'default' });
    expect(result.current.inputDevices[1]).toMatchObject({ deviceId: 'bt-mic', kind: 'bluetooth' });
    expect(result.current.inputDevices[1].label).toContain('블루투스');
    expect(result.current.inputNeedsPermission).toBe(false);
  });

  it('asks for permission while the device list is label-hidden and keeps the saved mic', async () => {
    localStorage.setItem(INPUT_DEVICE_KEY, 'bt-mic');
    (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
      { kind: 'audioinput', deviceId: '', label: '' },
    ]);
    const { result } = renderHook(() => useAudioInputDevices());
    await act(async () => {});
    expect(result.current.inputNeedsPermission).toBe(true);
    expect(result.current.selectedInputDeviceId).toBe('bt-mic');
    expect(result.current.inputMessage).toContain('마이크 권한');
  });

  it('loads labelled microphones after permission is granted', async () => {
    (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
      { kind: 'audioinput', deviceId: '', label: '' },
    ]);
    const { result } = renderHook(() => useAudioInputDevices());
    await act(async () => {});
    expect(result.current.inputNeedsPermission).toBe(true);

    (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
      { kind: 'audioinput', deviceId: 'default', label: 'Default - Phone microphone' },
      { kind: 'audioinput', deviceId: 'bt-mic', label: 'WF-1000XM5 Headset' },
    ]);
    let granted = false;
    await act(async () => { granted = await result.current.requestInputDevicePermission(); });
    expect(granted).toBe(true);
    expect(result.current.inputNeedsPermission).toBe(false);
    expect(result.current.inputDevices.map(d => d.deviceId)).toEqual(['default', 'bt-mic']);
  });

  it('surfaces a retryable error when the permission request is denied', async () => {
    (navigator.mediaDevices as any).getUserMedia = vi.fn(async () => { throw new Error('denied'); });
    const { result } = renderHook(() => useAudioInputDevices());
    await act(async () => {});
    let granted = true;
    await act(async () => { granted = await result.current.requestInputDevicePermission(); });
    expect(granted).toBe(false);
    expect(result.current.inputStatus).toBe('error');
    expect(result.current.inputMessage).toContain('권한');
  });

  it('falls back to the default mic and notifies when the saved mic disappears', async () => {
    localStorage.setItem(INPUT_DEVICE_KEY, 'bt-mic');
    const onSelectedDeviceLost = vi.fn();
    (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
      { kind: 'audioinput', deviceId: 'default', label: 'Default - Phone microphone' },
    ]);
    const { result } = renderHook(() => useAudioInputDevices({ onSelectedDeviceLost }));
    await act(async () => {});
    expect(result.current.selectedInputDeviceId).toBe('');
    expect(localStorage.getItem(INPUT_DEVICE_KEY)).toBeNull();
    expect(result.current.inputMessage).toContain('기본 마이크로 전환');
    expect(onSelectedDeviceLost).toHaveBeenCalledTimes(1);
  });

  it('picks up a Bluetooth mic connected mid-session on devicechange', async () => {
    let deviceChangeHandler: (() => void) | null = null;
    (navigator.mediaDevices.addEventListener as any).mockImplementation((event: string, handler: () => void) => {
      if (event === 'devicechange') deviceChangeHandler = handler;
    });
    (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
      { kind: 'audioinput', deviceId: 'default', label: 'Default - Phone microphone' },
    ]);
    const { result } = renderHook(() => useAudioInputDevices());
    await act(async () => {});
    expect(result.current.inputDevices).toHaveLength(1);

    (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
      { kind: 'audioinput', deviceId: 'default', label: 'Default - Phone microphone' },
      { kind: 'audioinput', deviceId: 'bt-mic', label: 'Galaxy Buds3 Headset' },
    ]);
    await act(async () => { deviceChangeHandler?.(); });
    expect(result.current.inputDevices).toHaveLength(2);
    expect(result.current.inputDevices[1]).toMatchObject({ deviceId: 'bt-mic', kind: 'bluetooth' });
  });

  it('persists the selection for the next conversation', async () => {
    (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
      { kind: 'audioinput', deviceId: 'default', label: 'Default - Phone microphone' },
      { kind: 'audioinput', deviceId: 'bt-mic', label: 'AirPods Headset' },
    ]);
    const { result } = renderHook(() => useAudioInputDevices());
    await act(async () => {});
    act(() => { result.current.persistInputSelection('bt-mic', null); });
    expect(localStorage.getItem(INPUT_DEVICE_KEY)).toBe('bt-mic');

    const { result: second } = renderHook(() => useAudioInputDevices());
    await act(async () => {});
    expect(second.current.selectedInputDeviceId).toBe('bt-mic');
  });

  it('reports a retryable error when device enumeration fails', async () => {
    (navigator.mediaDevices.enumerateDevices as any).mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useAudioInputDevices());
    await act(async () => {});
    expect(result.current.inputStatus).toBe('error');
    expect(result.current.inputMessage).toContain('다시 시도');
  });
});
