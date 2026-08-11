// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudioInputDevices, buildMicrophoneConstraints } from '../../client/src/hooks/useAudioInputDevices';

const INPUT_DEVICE_KEY = 'realtime_voice_input_device_id';
const INPUT_USER_CHOSE_KEY = 'realtime_voice_input_user_chose';
const INPUT_AUTO_SELECTED_KEY = 'realtime_voice_input_auto_selected';

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

  describe('Bluetooth auto-selection', () => {
    it('auto-selects a Bluetooth mic when there is no saved choice', async () => {
      (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
        { kind: 'audioinput', deviceId: 'default', label: 'Default - Phone microphone' },
        { kind: 'audioinput', deviceId: 'bt-mic', label: 'AirPods Pro Microphone' },
      ]);
      const { result } = renderHook(() => useAudioInputDevices());
      await act(async () => {});
      expect(result.current.selectedInputDeviceId).toBe('bt-mic');
      expect(result.current.inputAutoSelected).toBe(true);
      expect(localStorage.getItem(INPUT_DEVICE_KEY)).toBe('bt-mic');
      expect(localStorage.getItem(INPUT_AUTO_SELECTED_KEY)).toBe('1');
      expect(result.current.inputMessage).toContain('자동으로 선택');
    });

    it('keeps the OS/browser default when no Bluetooth mic exists', async () => {
      (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
        { kind: 'audioinput', deviceId: 'default', label: 'Default - Phone microphone' },
      ]);
      const { result } = renderHook(() => useAudioInputDevices());
      await act(async () => {});
      expect(result.current.selectedInputDeviceId).toBe('');
      expect(result.current.inputAutoSelected).toBe(false);
      expect(localStorage.getItem(INPUT_DEVICE_KEY)).toBeNull();
    });

    it('does not override a device the user explicitly chose', async () => {
      localStorage.setItem(INPUT_DEVICE_KEY, 'wired-mic');
      localStorage.setItem(INPUT_USER_CHOSE_KEY, '1');
      (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
        { kind: 'audioinput', deviceId: 'default', label: 'Default - Phone microphone' },
        { kind: 'audioinput', deviceId: 'wired-mic', label: 'USB Microphone' },
        { kind: 'audioinput', deviceId: 'bt-mic', label: 'Galaxy Buds3 Headset' },
      ]);
      const { result } = renderHook(() => useAudioInputDevices());
      await act(async () => {});
      expect(result.current.selectedInputDeviceId).toBe('wired-mic');
      expect(result.current.inputAutoSelected).toBe(false);
    });

    it('auto-switches to a newly connected Bluetooth mic on devicechange when nothing was chosen', async () => {
      let deviceChangeHandler: (() => void) | null = null;
      (navigator.mediaDevices.addEventListener as any).mockImplementation((event: string, handler: () => void) => {
        if (event === 'devicechange') deviceChangeHandler = handler;
      });
      (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
        { kind: 'audioinput', deviceId: 'default', label: 'Default - Phone microphone' },
      ]);
      const { result } = renderHook(() => useAudioInputDevices());
      await act(async () => {});
      expect(result.current.selectedInputDeviceId).toBe('');

      (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
        { kind: 'audioinput', deviceId: 'default', label: 'Default - Phone microphone' },
        { kind: 'audioinput', deviceId: 'bt-mic', label: 'AirPods Pro Microphone' },
      ]);
      await act(async () => { deviceChangeHandler?.(); });
      expect(result.current.selectedInputDeviceId).toBe('bt-mic');
      expect(result.current.inputAutoSelected).toBe(true);
    });

    it('replaces a previously auto-selected mic with a newly connected Bluetooth mic', async () => {
      localStorage.setItem(INPUT_DEVICE_KEY, 'old-bt-mic');
      localStorage.setItem(INPUT_AUTO_SELECTED_KEY, '1');
      (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
        { kind: 'audioinput', deviceId: 'default', label: 'Default - Phone microphone' },
        { kind: 'audioinput', deviceId: 'new-bt-mic', label: 'WF-1000XM5 Headset' },
      ]);
      const { result } = renderHook(() => useAudioInputDevices());
      await act(async () => {});
      expect(result.current.selectedInputDeviceId).toBe('new-bt-mic');
      expect(result.current.inputAutoSelected).toBe(true);
    });

    it('clears inputAutoSelected and localStorage keys when the auto-selected mic disconnects', async () => {
      // Pre-condition: a Bluetooth mic was auto-selected in a previous session.
      localStorage.setItem(INPUT_DEVICE_KEY, 'bt-mic');
      localStorage.setItem(INPUT_AUTO_SELECTED_KEY, '1');
      // The device is gone from the current enumeration.
      (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
        { kind: 'audioinput', deviceId: 'default', label: 'Default - Phone microphone' },
      ]);
      const { result } = renderHook(() => useAudioInputDevices());
      await act(async () => {});

      expect(result.current.selectedInputDeviceId).toBe('');
      expect(result.current.inputAutoSelected).toBe(false);
      expect(localStorage.getItem(INPUT_DEVICE_KEY)).toBeNull();
      expect(localStorage.getItem(INPUT_AUTO_SELECTED_KEY)).toBeNull();
      expect(result.current.inputMessage).toContain('기본 마이크로 전환');
    });

    it('re-auto-selects after fallback when the Bluetooth mic reconnects (round-trip)', async () => {
      let deviceChangeHandler: (() => void) | null = null;
      (navigator.mediaDevices.addEventListener as any).mockImplementation((event: string, handler: () => void) => {
        if (event === 'devicechange') deviceChangeHandler = handler;
      });

      // Start: auto-selected bt-mic is the only thing persisted, now gone.
      localStorage.setItem(INPUT_DEVICE_KEY, 'bt-mic');
      localStorage.setItem(INPUT_AUTO_SELECTED_KEY, '1');
      (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
        { kind: 'audioinput', deviceId: 'default', label: 'Default - Phone microphone' },
      ]);
      const { result } = renderHook(() => useAudioInputDevices());
      await act(async () => {});

      // After disconnect: fallen back to default, flags cleared.
      expect(result.current.selectedInputDeviceId).toBe('');
      expect(result.current.inputAutoSelected).toBe(false);
      expect(localStorage.getItem(INPUT_AUTO_SELECTED_KEY)).toBeNull();

      // Reconnect: bt-mic appears again via devicechange.
      (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
        { kind: 'audioinput', deviceId: 'default', label: 'Default - Phone microphone' },
        { kind: 'audioinput', deviceId: 'bt-mic', label: 'AirPods Pro Microphone' },
      ]);
      await act(async () => { deviceChangeHandler?.(); });

      expect(result.current.selectedInputDeviceId).toBe('bt-mic');
      expect(result.current.inputAutoSelected).toBe(true);
      expect(localStorage.getItem(INPUT_DEVICE_KEY)).toBe('bt-mic');
      expect(localStorage.getItem(INPUT_AUTO_SELECTED_KEY)).toBe('1');
    });

    it('calls onBluetoothAutoSelected when a Bluetooth mic is auto-selected', async () => {
      const onBluetoothAutoSelected = vi.fn();
      (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
        { kind: 'audioinput', deviceId: 'default', label: 'Default - Phone microphone' },
        { kind: 'audioinput', deviceId: 'bt-mic', label: 'AirPods Pro Microphone' },
      ]);
      const { result } = renderHook(() => useAudioInputDevices({ onBluetoothAutoSelected }));
      await act(async () => {});
      expect(result.current.selectedInputDeviceId).toBe('bt-mic');
      expect(onBluetoothAutoSelected).toHaveBeenCalledTimes(1);
      expect(onBluetoothAutoSelected).toHaveBeenCalledWith('bt-mic');
    });

    it('does not call onBluetoothAutoSelected when the user explicitly chose a device', async () => {
      localStorage.setItem(INPUT_DEVICE_KEY, 'wired-mic');
      localStorage.setItem(INPUT_USER_CHOSE_KEY, '1');
      const onBluetoothAutoSelected = vi.fn();
      (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
        { kind: 'audioinput', deviceId: 'default', label: 'Default - Phone microphone' },
        { kind: 'audioinput', deviceId: 'wired-mic', label: 'USB Microphone' },
        { kind: 'audioinput', deviceId: 'bt-mic', label: 'AirPods Pro Microphone' },
      ]);
      const { result } = renderHook(() => useAudioInputDevices({ onBluetoothAutoSelected }));
      await act(async () => {});
      expect(result.current.selectedInputDeviceId).toBe('wired-mic');
      expect(onBluetoothAutoSelected).not.toHaveBeenCalled();
    });

    it('calls onBluetoothAutoSelected when a Bluetooth mic connects mid-session via devicechange', async () => {
      let deviceChangeHandler: (() => void) | null = null;
      (navigator.mediaDevices.addEventListener as any).mockImplementation((event: string, handler: () => void) => {
        if (event === 'devicechange') deviceChangeHandler = handler;
      });
      (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
        { kind: 'audioinput', deviceId: 'default', label: 'Default - Phone microphone' },
      ]);
      const onBluetoothAutoSelected = vi.fn();
      const { result } = renderHook(() => useAudioInputDevices({ onBluetoothAutoSelected }));
      await act(async () => {});
      expect(onBluetoothAutoSelected).not.toHaveBeenCalled();

      (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
        { kind: 'audioinput', deviceId: 'default', label: 'Default - Phone microphone' },
        { kind: 'audioinput', deviceId: 'bt-mic', label: 'Galaxy Buds3 Headset' },
      ]);
      await act(async () => { deviceChangeHandler?.(); });
      expect(result.current.selectedInputDeviceId).toBe('bt-mic');
      expect(onBluetoothAutoSelected).toHaveBeenCalledTimes(1);
      expect(onBluetoothAutoSelected).toHaveBeenCalledWith('bt-mic');
    });


    it('persistInputSelectionByUser marks the choice explicit so auto-selection stays off', async () => {
      (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
        { kind: 'audioinput', deviceId: 'default', label: 'Default - Phone microphone' },
        { kind: 'audioinput', deviceId: 'bt-mic', label: 'AirPods Headset' },
      ]);
      const { result } = renderHook(() => useAudioInputDevices());
      await act(async () => {});
      // Auto-selected the Bluetooth mic first.
      expect(result.current.inputAutoSelected).toBe(true);

      act(() => { result.current.persistInputSelectionByUser('', null); });
      expect(result.current.inputAutoSelected).toBe(false);
      expect(localStorage.getItem(INPUT_USER_CHOSE_KEY)).toBe('1');

      // A later refresh must not re-grab the Bluetooth mic.
      await act(async () => { await result.current.refreshInputDevices(); });
      expect(result.current.selectedInputDeviceId).toBe('');
      expect(result.current.inputAutoSelected).toBe(false);
    });
  });

  it('reports a retryable error when device enumeration fails', async () => {
    (navigator.mediaDevices.enumerateDevices as any).mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useAudioInputDevices());
    await act(async () => {});
    expect(result.current.inputStatus).toBe('error');
    expect(result.current.inputMessage).toContain('다시 시도');
  });
});
