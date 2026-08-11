// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudioInputDevices, buildMicrophoneConstraints } from '../../client/src/hooks/useAudioInputDevices';

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
      // No previous device was active; previousDeviceId is the empty string.
      expect(onBluetoothAutoSelected).toHaveBeenCalledWith('bt-mic', '');
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
      // No prior device was selected; previousDeviceId is the empty string.
      expect(onBluetoothAutoSelected).toHaveBeenCalledWith('bt-mic', '');
    });

    it('passes the previously active device ID to onBluetoothAutoSelected so callers can revert on failure', async () => {
      let deviceChangeHandler: (() => void) | null = null;
      (navigator.mediaDevices.addEventListener as any).mockImplementation((event: string, handler: () => void) => {
        if (event === 'devicechange') deviceChangeHandler = handler;
      });
      // Start with a wired mic that was auto-selected in a previous session.
      localStorage.setItem(INPUT_DEVICE_KEY, 'wired-mic');
      localStorage.setItem(INPUT_AUTO_SELECTED_KEY, '1');
      (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
        { kind: 'audioinput', deviceId: 'default', label: 'Default - Phone microphone' },
        { kind: 'audioinput', deviceId: 'wired-mic', label: 'USB Microphone' },
      ]);
      const onBluetoothAutoSelected = vi.fn();
      const { result } = renderHook(() => useAudioInputDevices({ onBluetoothAutoSelected }));
      await act(async () => {});
      // No BT device yet; wired-mic remains selected.
      expect(result.current.selectedInputDeviceId).toBe('wired-mic');

      // Bluetooth mic appears mid-session.
      (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
        { kind: 'audioinput', deviceId: 'default', label: 'Default - Phone microphone' },
        { kind: 'audioinput', deviceId: 'wired-mic', label: 'USB Microphone' },
        { kind: 'audioinput', deviceId: 'bt-mic', label: 'AirPods Pro Microphone' },
      ]);
      await act(async () => { deviceChangeHandler?.(); });

      // The callback receives both IDs so the handler can roll back on failure.
      expect(onBluetoothAutoSelected).toHaveBeenCalledWith('bt-mic', 'wired-mic');
      expect(result.current.selectedInputDeviceId).toBe('bt-mic');
    });

    it('reverts selectedInputDeviceId to the previous device when the caller signals a swap failure', async () => {
      // Simulate the scenario from useRealtimeVoice: a Bluetooth mic connects
      // mid-session while getUserMedia throws, so the handler must roll back the
      // persisted selection to the device that was actually in use before the
      // auto-selection occurred.
      //
      // Setup: no BT mic initially; the recording is using the default device
      // (selectedInputDeviceId = '').  A BT mic then connects, triggering
      // auto-selection.  The handler simulates swapMicrophoneStream failing and
      // calls persistInputSelection with the previousDeviceId ('' = default).
      let deviceChangeHandler: (() => void) | null = null;
      (navigator.mediaDevices.addEventListener as any).mockImplementation((event: string, handler: () => void) => {
        if (event === 'devicechange') deviceChangeHandler = handler;
      });

      (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
        { kind: 'audioinput', deviceId: 'default', label: 'Default - Phone microphone' },
      ]);

      // The callback simulates swapMicrophoneStream failing: it receives
      // previousDeviceId and immediately reverts via persistInputSelection.
      let capturedPersist: ((id: string, msg: string | null) => void) | null = null;
      const onBluetoothAutoSelected = vi.fn((newId: string, previousId: string) => {
        // getUserMedia threw — roll back to the device that is actually open.
        capturedPersist?.(previousId, null);
      });

      const { result } = renderHook(() => useAudioInputDevices({ onBluetoothAutoSelected }));
      capturedPersist = result.current.persistInputSelection;
      await act(async () => {});

      // No BT device yet; default device in use.
      expect(result.current.selectedInputDeviceId).toBe('');
      expect(onBluetoothAutoSelected).not.toHaveBeenCalled();

      // BT mic connects mid-session — auto-selected, then immediately reverted by
      // the callback simulating a getUserMedia failure.
      (navigator.mediaDevices.enumerateDevices as any).mockResolvedValue([
        { kind: 'audioinput', deviceId: 'default', label: 'Default - Phone microphone' },
        { kind: 'audioinput', deviceId: 'bt-mic', label: 'AirPods Pro Microphone' },
      ]);
      await act(async () => { deviceChangeHandler?.(); });

      // The callback was invoked with the new and previous device IDs.
      expect(onBluetoothAutoSelected).toHaveBeenCalledWith('bt-mic', '');
      // After the simulated swap failure the persisted selection must be back to
      // the device that is actually in use, not the one that failed.
      expect(result.current.selectedInputDeviceId).toBe('');
      expect(localStorage.getItem(INPUT_DEVICE_KEY)).toBeNull();
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
