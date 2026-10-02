import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { isIOSWebKitAudioPlatform } from '@/lib/iosAudioSession';
import { requestMicrophonePermission, microphoneErrorKey, microphoneSettingsKey } from '@/lib/microphonePermission';

const INPUT_DEVICE_KEY = 'realtime_voice_input_device_id';
// Tracks whether the user explicitly picked a device so that auto-selection on
// devicechange does not overwrite a deliberate choice.
const INPUT_USER_CHOSE_KEY = 'realtime_voice_input_user_chose';
// Tracks that the persisted selection was made automatically (Bluetooth
// auto-pick), so a newly connected Bluetooth device may still replace it.
const INPUT_AUTO_SELECTED_KEY = 'realtime_voice_input_auto_selected';

export type AudioInputKind = 'default' | 'bluetooth' | 'wired' | 'builtin' | 'other';

export interface AudioInputDeviceOption {
  deviceId: string;
  label: string;
  kind: AudioInputKind;
}

export type AudioInputStatus = 'supported' | 'unsupported' | 'error';

const BLUETOOTH_LABEL_HINTS = ['bluetooth', 'airpods', 'buds', 'headset', 'wireless', '블루투스', '헤드셋', '이어폰', '무선'];
const WIRED_LABEL_HINTS = ['wired', '3.5', 'usb', '유선'];
// Android Chrome names microphone *sources* after output modes ("스피커폰",
// "Speakerphone") which users read as output devices — classify them as
// built-in phone mics so the list stays unambiguous.
const BUILTIN_LABEL_HINTS = ['built-in', 'builtin', 'internal', 'speakerphone', '스피커폰', 'iphone', 'ipad', '내장', '휴대폰', 'phone microphone'];

function classifyInputLabel(label: string): AudioInputKind {
  const lower = label.toLowerCase();
  if (BLUETOOTH_LABEL_HINTS.some(hint => lower.includes(hint))) return 'bluetooth';
  if (WIRED_LABEL_HINTS.some(hint => lower.includes(hint))) return 'wired';
  if (BUILTIN_LABEL_HINTS.some(hint => lower.includes(hint))) return 'builtin';
  return 'other';
}

// Browsers hide microphone labels until audio capture permission is granted, so
// a connected Bluetooth headset's mic never appears as its own labelled choice
// until the user grants permission once.
function describeInputDevice(
  device: MediaDeviceInfo,
  index: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): AudioInputDeviceOption {
  const rawLabel = (device.label || '').trim();
  if (device.deviceId === 'default' || device.deviceId === '') {
    return {
      deviceId: '',
      label: rawLabel
        ? t('audioInput.defaultMicWithLabel', { label: rawLabel.replace(/^default\s*-\s*/i, '') })
        : t('audioInput.defaultMic'),
      kind: 'default',
    };
  }
  if (!rawLabel) {
    return { deviceId: device.deviceId, label: t('audioInput.micN', { n: index + 1 }), kind: 'other' };
  }
  const kind = classifyInputLabel(rawLabel);
  const prefix =
    kind === 'bluetooth' ? t('audioInput.prefixBluetooth') :
    kind === 'wired'     ? t('audioInput.prefixWired') :
    kind === 'builtin'   ? t('audioInput.prefixBuiltin') : '';
  return { deviceId: device.deviceId, label: `${prefix}${rawLabel}`, kind };
}

// Pure helper shared with the recording path: applies the persisted microphone
// choice via `deviceId: { exact }` so a silent fallback to the wrong mic cannot
// masquerade as success. Callers catch the failure and fall back explicitly.
export function buildMicrophoneConstraints(deviceId: string): MediaTrackConstraints {
  return {
    channelCount: 1,
    sampleRate: 16000,
    echoCancellation: true,
    noiseSuppression: true,
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  };
}

interface UseAudioInputDevicesOptions {
  // Fired when the persisted device disappears from the device list (e.g. the
  // Bluetooth headset was turned off) so a live recording can re-acquire the
  // default microphone instead of staying on a dead track.
  onSelectedDeviceLost?: () => void;
  // Fired when a Bluetooth device is automatically selected (e.g. connected
  // mid-session via devicechange) so a live recording can swap to it immediately.
  // Only fires for auto-selection events; explicit user choices go via selectInputDevice.
  // `previousDeviceId` is the device ID that was active before the auto-selection so
  // the caller can revert the persisted selection if the swap fails.
  onBluetoothAutoSelected?: (newDeviceId: string, previousDeviceId: string) => void;
}

export interface UseAudioInputDevicesReturn {
  inputDevices: AudioInputDeviceOption[];
  selectedInputDeviceId: string;
  selectedInputDeviceIdRef: React.MutableRefObject<string>;
  inputStatus: AudioInputStatus;
  inputMessage: string | null;
  inputNeedsPermission: boolean;
  /** Whether current selection was auto-chosen (not explicitly by the user). */
  inputAutoSelected: boolean;
  persistInputSelection: (deviceId: string, message?: string | null) => void;
  /** Like persistInputSelection but marks the choice as user-explicit,
   *  preventing future auto-overrides on devicechange. */
  persistInputSelectionByUser: (deviceId: string, message?: string | null) => void;
  reportInputError: (message: string) => void;
  refreshInputDevices: () => Promise<void>;
  requestInputDevicePermission: () => Promise<boolean>;
  cancelInputPermissionRequest: () => void;
  markInputPermissionGranted: () => Promise<void>;
  reportMicrophoneError: (error: unknown) => string;
  inputPermissionPending: boolean;
  microphoneError: string | null;
}

export function useAudioInputDevices(options?: UseAudioInputDevicesOptions): UseAudioInputDevicesReturn {
  const { t } = useTranslation();

  const [inputDevices, setInputDevices] = useState<AudioInputDeviceOption[]>([]);
  const [selectedInputDeviceId, setSelectedInputDeviceId] = useState('');
  const [inputStatus, setInputStatus] = useState<AudioInputStatus>('supported');
  const [inputMessage, setInputMessage] = useState<string | null>(null);
  const [inputNeedsPermission, setInputNeedsPermission] = useState(false);
  const [inputAutoSelected, setInputAutoSelected] = useState(false);
  const [inputPermissionPending, setInputPermissionPending] = useState(false);
  const [microphoneError, setMicrophoneError] = useState<string | null>(null);
  const permissionGrantedRef = useRef(false);
  const permissionErrorRef = useRef<string | null>(null);
  const permissionEpochRef = useRef(0);
  const enumerationRef = useRef(0);
  const mountedRef = useRef(true);

  const selectedInputDeviceIdRef = useRef('');
  // True once the user explicitly picked a device; suppresses auto-bluetooth selection.
  const userChoseInputRef = useRef(false);
  // True while the current persisted selection came from auto-selection, so a
  // newer Bluetooth device may still replace it.
  const inputAutoSelectedRef = useRef(false);
  const onSelectedDeviceLostRef = useRef(options?.onSelectedDeviceLost);
  const onBluetoothAutoSelectedRef = useRef(options?.onBluetoothAutoSelected);
  useEffect(() => {
    onSelectedDeviceLostRef.current = options?.onSelectedDeviceLost;
    onBluetoothAutoSelectedRef.current = options?.onBluetoothAutoSelected;
  });

  const reportInputError = useCallback((message: string) => {
    setInputStatus('error');
    setInputMessage(message);
    console.warn(`🎙️ ${message}`);
  }, []);

  const persistInputSelection = useCallback((deviceId: string, message?: string | null) => {
    selectedInputDeviceIdRef.current = deviceId;
    setSelectedInputDeviceId(deviceId);
    inputAutoSelectedRef.current = false;
    setInputAutoSelected(false);
    try {
      if (deviceId) localStorage.setItem(INPUT_DEVICE_KEY, deviceId);
      else localStorage.removeItem(INPUT_DEVICE_KEY);
      localStorage.removeItem(INPUT_AUTO_SELECTED_KEY);
    } catch {}
    setInputStatus('supported');
    if (message !== undefined) setInputMessage(message);
  }, []);

  const persistInputSelectionByUser = useCallback((deviceId: string, message?: string | null) => {
    userChoseInputRef.current = true;
    setInputAutoSelected(false);
    try {
      localStorage.setItem(INPUT_USER_CHOSE_KEY, '1');
    } catch {}
    persistInputSelection(deviceId, message);
  }, [persistInputSelection]);

  const refreshInputDevices = useCallback(async () => {
    const enumeration = ++enumerationRef.current;
    if (!navigator.mediaDevices?.enumerateDevices || !navigator.mediaDevices?.getUserMedia) {
      setInputStatus('unsupported');
      setInputDevices([]);
      setInputNeedsPermission(false);
      setInputMessage(t('audioInput.unsupported'));
      return;
    }
    try {
      const inputs = (await navigator.mediaDevices.enumerateDevices())
        .filter(device => device.kind === 'audioinput');
      if (!mountedRef.current || enumeration !== enumerationRef.current) return;
      const described = inputs.map((device, index) => describeInputDevice(device, index, t));
      const normalized = described.some(device => device.deviceId === 'default' || device.deviceId === '')
        ? described
        : [{ deviceId: '', label: t('audioInput.defaultMic'), kind: 'default' as const }, ...described];
      setInputDevices(normalized);
      if (permissionErrorRef.current) {
        setInputStatus('error');
        setInputMessage(permissionErrorRef.current);
        return;
      }

      const labelsHidden = inputs.length === 0 || inputs.every(device => !(device.label || '').trim());
      const exposesIndividualInputs = inputs.some(device =>
        device.deviceId !== 'default' && device.deviceId !== '',
      );

      // iOS may expose only its default input even when a Bluetooth headset is
      // routed by the system. A stale exact deviceId would fight that route and
      // make getUserMedia fail, so fall back to the OS-managed default.
      if (
        isIOSWebKitAudioPlatform()
        && !labelsHidden
        && !exposesIndividualInputs
        && selectedInputDeviceIdRef.current
      ) {
        persistInputSelection('', t('audioInput.deviceLost'));
        onSelectedDeviceLostRef.current?.();
      }

      if (labelsHidden) {
        // Permission-gated list: the saved device is not proven gone, keep it.
        setInputNeedsPermission(!permissionGrantedRef.current);
        setInputStatus(permissionErrorRef.current ? 'error' : 'supported');
        setInputMessage(permissionErrorRef.current ?? (permissionGrantedRef.current ? null : t('audioInput.permissionNeeded')));
        return;
      }

      setInputNeedsPermission(false);
      if (!permissionErrorRef.current) setInputMessage(null);

      // Auto-select Bluetooth when the user never explicitly chose a device and
      // either (a) nothing is selected yet, or (b) the current selection was
      // itself auto-picked — so a newly connected Bluetooth device can take over.
      const hasPersistedChoice = !!(selectedInputDeviceIdRef.current);
      if (!userChoseInputRef.current && (!hasPersistedChoice || inputAutoSelectedRef.current)) {
        const btDevice = normalized.find(d => d.kind === 'bluetooth');
        if (btDevice && btDevice.deviceId !== selectedInputDeviceIdRef.current) {
          // Capture the previous device ID before updating so the caller can
          // revert the persisted selection if the mic swap fails.
          const previousDeviceId = selectedInputDeviceIdRef.current;
          selectedInputDeviceIdRef.current = btDevice.deviceId;
          setSelectedInputDeviceId(btDevice.deviceId);
          inputAutoSelectedRef.current = true;
          setInputAutoSelected(true);
          try {
            localStorage.setItem(INPUT_DEVICE_KEY, btDevice.deviceId);
            localStorage.setItem(INPUT_AUTO_SELECTED_KEY, '1');
          } catch {}
          setInputStatus('supported');
          setInputMessage(t('audioInput.bluetoothAutoSelected', { label: btDevice.label }));
          console.log(`🎙️ Auto-selected Bluetooth input: ${btDevice.label}`);
          // Notify the parent so a live recording can swap its mic stream immediately.
          // previousDeviceId is passed so the caller can revert on swap failure.
          onBluetoothAutoSelectedRef.current?.(btDevice.deviceId, previousDeviceId);
          return;
        }
      }

      if (selectedInputDeviceIdRef.current && !normalized.some(device => device.deviceId === selectedInputDeviceIdRef.current)) {
        persistInputSelection('', t('audioInput.deviceLost'));
        onSelectedDeviceLostRef.current?.();
      } else {
        setInputStatus('supported');
      }
    } catch {
      if (mountedRef.current && enumeration === enumerationRef.current) reportInputError(t('audioInput.enumError'));
    }
  }, [persistInputSelection, reportInputError, t]);

  const markInputPermissionGranted = useCallback(async () => {
    permissionGrantedRef.current = true;
    permissionErrorRef.current = null;
    setMicrophoneError(null);
    setInputNeedsPermission(false);
    setInputStatus('supported');
    setInputMessage(null);
    await refreshInputDevices();
  }, [refreshInputDevices]);

  const reportMicrophoneError = useCallback((error: unknown) => {
    const key = microphoneErrorKey(error);
    const message = t(`microphone.${key}`) + (key === 'denied' ? ` ${t(`microphone.${microphoneSettingsKey()}`)}` : '');
    permissionGrantedRef.current = false;
    permissionErrorRef.current = message;
    setMicrophoneError(message);
    setInputNeedsPermission(key === 'denied');
    reportInputError(message);
    return message;
  }, [reportInputError, t]);

  const cancelInputPermissionRequest = useCallback(() => {
    permissionEpochRef.current++;
    enumerationRef.current++;
    setInputPermissionPending(false);
  }, []);

  const requestInputDevicePermission = useCallback(async () => {
    const epoch = permissionEpochRef.current;
    setInputPermissionPending(true);
    setMicrophoneError(null);
    try {
      await requestMicrophonePermission();
      if (!mountedRef.current || epoch !== permissionEpochRef.current) return false;
      await markInputPermissionGranted();
      return mountedRef.current && epoch === permissionEpochRef.current;
    } catch (error) {
      if (mountedRef.current && epoch === permissionEpochRef.current) reportMicrophoneError(error);
      return false;
    } finally {
      if (mountedRef.current && epoch === permissionEpochRef.current) setInputPermissionPending(false);
    }
  }, [markInputPermissionGranted, reportMicrophoneError]);

  useEffect(() => {
    mountedRef.current = true;
    try {
      const saved = localStorage.getItem(INPUT_DEVICE_KEY) || '';
      selectedInputDeviceIdRef.current = saved;
      setSelectedInputDeviceId(saved);
      userChoseInputRef.current = !!(localStorage.getItem(INPUT_USER_CHOSE_KEY));
      const savedAuto = !!saved && !userChoseInputRef.current && !!(localStorage.getItem(INPUT_AUTO_SELECTED_KEY));
      inputAutoSelectedRef.current = savedAuto;
      setInputAutoSelected(savedAuto);
    } catch {}
    refreshInputDevices();
    const onDeviceChange = () => { refreshInputDevices(); };
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);
    return () => {
      mountedRef.current = false;
      permissionEpochRef.current++;
      enumerationRef.current++;
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
    };
  }, [refreshInputDevices]);

  return {
    inputDevices,
    selectedInputDeviceId,
    selectedInputDeviceIdRef,
    inputStatus,
    inputMessage,
    inputNeedsPermission,
    inputAutoSelected,
    persistInputSelection,
    persistInputSelectionByUser,
    reportInputError,
    refreshInputDevices,
    requestInputDevicePermission,
    cancelInputPermissionRequest,
    markInputPermissionGranted,
    reportMicrophoneError,
    inputPermissionPending,
    microphoneError,
  };
}
