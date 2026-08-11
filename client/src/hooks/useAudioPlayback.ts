import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

const DEFAULT_GAIN = 1.0;
const OUTPUT_DEVICE_KEY = 'realtime_voice_output_device_id';
// Tracks whether the user explicitly picked an output device so auto-selection
// on devicechange does not overwrite a deliberate choice.
const OUTPUT_USER_CHOSE_KEY = 'realtime_voice_output_user_chose';
// Tracks that the persisted selection was made automatically (Bluetooth
// auto-pick), so a newly connected Bluetooth device may still replace it.
const OUTPUT_AUTO_SELECTED_KEY = 'realtime_voice_output_auto_selected';

const AGC_TARGET_RMS = 0.15;
const AGC_SILENCE_THRESHOLD = 0.01;
const AGC_ATTACK_COEFF = 0.05;
const AGC_RELEASE_COEFF = 0.015;
const AGC_MIN_GAIN = 0.5;
const AGC_MAX_GAIN = 4.0;

export interface AgcConfig {
  targetRms: number;
  minGain: number;
  maxGain: number;
  attackCoeff: number;
  releaseCoeff: number;
}

export type AudioOutputKind = 'default' | 'speaker' | 'bluetooth' | 'wired' | 'other';

export interface AudioOutputDevice {
  deviceId: string;
  label: string;
  kind: AudioOutputKind;
}

export type AudioOutputStatus = 'supported' | 'unsupported' | 'selecting' | 'error';

const BLUETOOTH_LABEL_HINTS = ['bluetooth', 'airpods', 'buds', 'headset', 'headphone', 'wireless', '블루투스', '헤드셋', '이어폰', '무선'];
const SPEAKER_LABEL_HINTS = ['speaker', 'speakerphone', 'receiver', 'earpiece', '스피커', '수화'];
const WIRED_LABEL_HINTS = ['wired', 'headphones (', '3.5', 'usb', '유선'];

function classifyOutputLabel(label: string): AudioOutputKind {
  const lower = label.toLowerCase();
  if (BLUETOOTH_LABEL_HINTS.some(hint => lower.includes(hint))) return 'bluetooth';
  if (WIRED_LABEL_HINTS.some(hint => lower.includes(hint))) return 'wired';
  if (SPEAKER_LABEL_HINTS.some(hint => lower.includes(hint))) return 'speaker';
  return 'other';
}

// Browsers only expose real device labels after audio capture permission is granted.
// Until then enumerateDevices() returns a single unlabeled entry, which is why the
// picker can look "stuck" on the default device even with earbuds connected.
function describeOutputDevice(
  device: MediaDeviceInfo,
  index: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): AudioOutputDevice {
  const rawLabel = (device.label || '').trim();
  if (device.deviceId === 'default' || device.deviceId === '') {
    return {
      deviceId: device.deviceId,
      label: rawLabel
        ? t('audioOutput.defaultDeviceWithLabel', { label: rawLabel.replace(/^default\s*-\s*/i, '') })
        : t('audioOutput.defaultDevice'),
      kind: 'default',
    };
  }
  if (!rawLabel) {
    return { deviceId: device.deviceId, label: t('audioOutput.deviceN', { n: index + 1 }), kind: 'other' };
  }
  const kind = classifyOutputLabel(rawLabel);
  const prefix =
    kind === 'bluetooth' ? t('audioOutput.prefixBluetooth') :
    kind === 'speaker'   ? t('audioOutput.prefixSpeaker') :
    kind === 'wired'     ? t('audioOutput.prefixWired') : '';
  return { deviceId: device.deviceId, label: `${prefix}${rawLabel}`, kind };
}

const DEFAULT_AGC_CONFIG: AgcConfig = {
  targetRms: AGC_TARGET_RMS,
  minGain: AGC_MIN_GAIN,
  maxGain: AGC_MAX_GAIN,
  attackCoeff: AGC_ATTACK_COEFF,
  releaseCoeff: AGC_RELEASE_COEFF,
};

interface UseAudioPlaybackReturn {
  playbackContextRef: React.MutableRefObject<AudioContext | null>;
  scheduledSourcesRef: React.MutableRefObject<AudioBufferSourceNode[]>;
  nextPlayTimeRef: React.MutableRefObject<number>;
  analyserNodeRef: React.MutableRefObject<AnalyserNode | null>;
  gainNodeRef: React.MutableRefObject<GainNode | null>;
  isAISpeaking: boolean;
  isAISpeakingRef: React.MutableRefObject<boolean>;
  isActuallyPlayingRef: React.MutableRefObject<boolean>;
  audioAmplitude: number;
  outputDevices: AudioOutputDevice[];
  selectedOutputDeviceId: string;
  /** Whether current selection was auto-chosen (not explicitly by the user). */
  outputAutoSelected: boolean;
  outputStatus: AudioOutputStatus;
  outputMessage: string | null;
  outputNeedsPermission: boolean;
  outputListUnavailable: boolean;
  requestOutputDevicePermission: () => Promise<boolean>;
  setIsAISpeaking: React.Dispatch<React.SetStateAction<boolean>>;
  stopPlayback: () => void;
  playAudioDelta: (base64: string) => Promise<void>;
  startAmplitudeAnalysis: () => void;
  stopAmplitudeAnalysis: () => void;
  selectOutputDevice: (deviceId: string) => Promise<boolean>;
  /** Like selectOutputDevice but marks the choice as user-explicit,
   *  preventing future auto-overrides on devicechange. */
  selectOutputDeviceByUser: (deviceId: string) => Promise<boolean>;
  refreshOutputDevices: () => Promise<void>;
  initializePlaybackContext: () => Promise<AudioContext | null>;
  resumePlayback: () => Promise<boolean>;
}

export function useAudioPlayback(
  isInterruptedRef: React.MutableRefObject<boolean>,
  agcConfig?: Partial<AgcConfig>
): UseAudioPlaybackReturn {
  const { t } = useTranslation();

  const [isAISpeaking, setIsAISpeaking] = useState(false);
  const [audioAmplitude, setAudioAmplitude] = useState(0);
  const [outputDevices, setOutputDevices] = useState<AudioOutputDevice[]>([]);
  const [selectedOutputDeviceId, setSelectedOutputDeviceId] = useState('');
  const [outputAutoSelected, setOutputAutoSelected] = useState(false);
  const [outputStatus, setOutputStatus] = useState<AudioOutputStatus>('unsupported');
  const [outputMessage, setOutputMessage] = useState<string | null>(null);
  const [outputNeedsPermission, setOutputNeedsPermission] = useState(false);
  const [outputListUnavailable, setOutputListUnavailable] = useState(false);

  const playbackContextRef = useRef<AudioContext | null>(null);
  const scheduledSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextPlayTimeRef = useRef<number>(0);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const compressorNodeRef = useRef<DynamicsCompressorNode | null>(null);
  const amplitudeAnimationRef = useRef<number | null>(null);
  const isAISpeakingRef = useRef<boolean>(false);
  const isActuallyPlayingRef = useRef<boolean>(false);
  const agcRmsRef = useRef<number>(AGC_TARGET_RMS);

  const agcConfigRef = useRef<AgcConfig>({ ...DEFAULT_AGC_CONFIG, ...agcConfig });
  const selectedOutputDeviceIdRef = useRef('');
  // True once the user explicitly picked an output device; suppresses auto-bluetooth selection.
  const userChoseOutputRef = useRef(false);
  // True while the current persisted selection came from auto-selection, so a
  // newer Bluetooth device may still replace it.
  const outputAutoSelectedRef = useRef(false);
  const playbackQueueRef = useRef<Promise<void>>(Promise.resolve());

  const reportOutputError = useCallback((message: string) => {
    setOutputStatus('error');
    setOutputMessage(message);
    console.warn(`🔊 ${message}`);
  }, []);

  const supportsOutputSelection = useCallback(() => {
    const context = playbackContextRef.current as any;
    const AudioContextConstructor = typeof window !== 'undefined'
      ? ((window as any).AudioContext || (window as any).webkitAudioContext)
      : undefined;
    return typeof context?.setSinkId === 'function'
      || typeof AudioContextConstructor?.prototype?.setSinkId === 'function';
  }, []);

  const resumePlayback = useCallback(async () => {
    const context = playbackContextRef.current;
    if (!context || context.state === 'running') return true;
    try {
      await context.resume();
      if ((context as AudioContext).state !== 'running') throw new Error('AudioContext did not resume');
      return true;
    } catch {
      reportOutputError(t('audioOutput.resumeError'));
      return false;
    }
  }, [reportOutputError, t]);

  const selectOutputDevice = useCallback(async (deviceId: string) => {
    if (!supportsOutputSelection()) {
      setOutputStatus('unsupported');
      setOutputMessage(t('audioOutput.unsupportedError'));
      return false;
    }
    const context = playbackContextRef.current as any;
    if (!context) {
      selectedOutputDeviceIdRef.current = deviceId;
      setSelectedOutputDeviceId(deviceId);
      outputAutoSelectedRef.current = false;
      setOutputAutoSelected(false);
      try {
        localStorage.setItem(OUTPUT_DEVICE_KEY, deviceId);
        localStorage.removeItem(OUTPUT_AUTO_SELECTED_KEY);
      } catch {}
      setOutputStatus('supported');
      setOutputMessage(deviceId ? t('audioOutput.pendingApply') : t('audioOutput.usingDefault'));
      return true;
    }
    setOutputStatus('selecting');
    try {
      await context.setSinkId(deviceId);
      selectedOutputDeviceIdRef.current = deviceId;
      setSelectedOutputDeviceId(deviceId);
      outputAutoSelectedRef.current = false;
      setOutputAutoSelected(false);
      try {
        localStorage.setItem(OUTPUT_DEVICE_KEY, deviceId);
        localStorage.removeItem(OUTPUT_AUTO_SELECTED_KEY);
      } catch {}
      setOutputStatus('supported');
      setOutputMessage(deviceId ? t('audioOutput.playingSelected') : t('audioOutput.playingDefault'));
      return true;
    } catch {
      reportOutputError(t('audioOutput.changeError'));
      return false;
    }
  }, [reportOutputError, supportsOutputSelection, t]);

  // User-explicit selection: marks userChoseOutput so auto-BT logic won't override.
  const selectOutputDeviceByUser = useCallback(async (deviceId: string) => {
    userChoseOutputRef.current = true;
    setOutputAutoSelected(false);
    try { localStorage.setItem(OUTPUT_USER_CHOSE_KEY, '1'); } catch {}
    return selectOutputDevice(deviceId);
  }, [selectOutputDevice]);

  const refreshOutputDevices = useCallback(async () => {
    if (!supportsOutputSelection() || !navigator.mediaDevices?.enumerateDevices) {
      setOutputStatus('unsupported');
      setOutputDevices([]);
      setOutputNeedsPermission(false);
      setOutputListUnavailable(false);
      return;
    }
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const outputs = allDevices.filter(device => device.kind === 'audiooutput');
      const described = outputs.map((device, index) => describeOutputDevice(device, index, t));
      const normalized = described.some(device => device.deviceId === 'default' || device.deviceId === '')
        ? described
        : [{ deviceId: '', label: t('audioOutput.defaultDevice'), kind: 'default' as const }, ...described];
      setOutputDevices(normalized);

      // Browsers hide labels and extra outputs until audio capture permission is
      // granted, so a connected Bluetooth headset never appears as its own choice.
      const outputsHidden = outputs.length === 0 || outputs.every(device => !device.label);
      // If ANY device (e.g. the microphone) already exposes a label, capture
      // permission has been granted. An output list that is still empty at that
      // point is not permission-gated — the browser or embedding context simply
      // does not expose audio outputs (Android Chrome, restrictive iframes).
      const permissionGranted = allDevices.some(device => !!(device.label || '').trim());

      if (outputsHidden && !permissionGranted) {
        setOutputNeedsPermission(true);
        setOutputListUnavailable(false);
        // The list is permission-gated, not authoritative: a saved device is not
        // proven gone here, so keep the preference instead of dropping it.
        setOutputStatus('supported');
        setOutputMessage(t('audioOutput.permissionNeeded'));
      } else if (outputsHidden) {
        setOutputNeedsPermission(false);
        setOutputListUnavailable(true);
        setOutputStatus('supported');
        setOutputMessage(t('audioOutput.listUnavailable'));
      } else if (selectedOutputDeviceIdRef.current && !normalized.some(device => device.deviceId === selectedOutputDeviceIdRef.current)) {
        setOutputNeedsPermission(false);
        setOutputListUnavailable(false);
        const fellBack = await selectOutputDevice('');
        if (fellBack) {
          setOutputAutoSelected(false);
          setOutputMessage(t('audioOutput.deviceLost'));
        }
      } else {
        setOutputNeedsPermission(false);
        setOutputListUnavailable(false);

        // Auto-select Bluetooth when the user never explicitly chose a device and
        // either (a) nothing is selected yet, or (b) the current selection was
        // itself auto-picked — so a newly connected Bluetooth device can take over.
        const hasPersistedChoice = !!(selectedOutputDeviceIdRef.current);
        if (!userChoseOutputRef.current && (!hasPersistedChoice || outputAutoSelectedRef.current)) {
          const btDevice = normalized.find(d => d.kind === 'bluetooth');
          if (btDevice && btDevice.deviceId !== selectedOutputDeviceIdRef.current) {
            const selected = await selectOutputDevice(btDevice.deviceId);
            if (selected) {
              outputAutoSelectedRef.current = true;
              setOutputAutoSelected(true);
              try { localStorage.setItem(OUTPUT_AUTO_SELECTED_KEY, '1'); } catch {}
              setOutputMessage(t('audioOutput.bluetoothAutoSelected', { label: btDevice.label }));
              console.log(`🔊 Auto-selected Bluetooth output: ${btDevice.label}`);
              return;
            }
          }
        }

        setOutputStatus('supported');
      }
    } catch {
      reportOutputError(t('audioOutput.enumError'));
    }
  }, [reportOutputError, selectOutputDevice, supportsOutputSelection, t]);

  const requestOutputDevicePermission = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      reportOutputError(t('audioOutput.listUnsupported'));
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
    } catch {
      reportOutputError(t('audioOutput.permissionDenied'));
      return false;
    }
    await refreshOutputDevices();
    return true;
  }, [refreshOutputDevices, reportOutputError, t]);

  const ensureOutputDevice = useCallback(async (context: AudioContext) => {
    if (!selectedOutputDeviceIdRef.current || typeof (context as any).setSinkId !== 'function') return;
    try {
      await (context as any).setSinkId(selectedOutputDeviceIdRef.current);
    } catch {
      selectedOutputDeviceIdRef.current = '';
      setSelectedOutputDeviceId('');
      try { localStorage.removeItem(OUTPUT_DEVICE_KEY); } catch {}
      reportOutputError(t('audioOutput.savedDeviceFailed'));
    }
  }, [reportOutputError, t]);

  const initializePlaybackContext = useCallback(async () => {
    if (!playbackContextRef.current || playbackContextRef.current.state === 'closed') {
      playbackContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      await ensureOutputDevice(playbackContextRef.current);
      nextPlayTimeRef.current = 0;
      console.log('🔊 Created new playback AudioContext');
    }
    return playbackContextRef.current;
  }, [ensureOutputDevice]);

  useEffect(() => {
    agcConfigRef.current = { ...DEFAULT_AGC_CONFIG, ...agcConfig };
    agcRmsRef.current = agcConfigRef.current.targetRms;
  }, [
    agcConfig?.targetRms,
    agcConfig?.minGain,
    agcConfig?.maxGain,
    agcConfig?.attackCoeff,
    agcConfig?.releaseCoeff,
  ]);

  useEffect(() => {
    try {
      selectedOutputDeviceIdRef.current = localStorage.getItem(OUTPUT_DEVICE_KEY) || '';
      setSelectedOutputDeviceId(selectedOutputDeviceIdRef.current);
      userChoseOutputRef.current = !!(localStorage.getItem(OUTPUT_USER_CHOSE_KEY));
      const savedAuto = !!selectedOutputDeviceIdRef.current && !userChoseOutputRef.current && !!(localStorage.getItem(OUTPUT_AUTO_SELECTED_KEY));
      outputAutoSelectedRef.current = savedAuto;
      setOutputAutoSelected(savedAuto);
    } catch {}
    refreshOutputDevices();
    const onDeviceChange = () => { refreshOutputDevices(); };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshOutputDevices();
        resumePlayback();
      }
    };
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refreshOutputDevices, resumePlayback]);

  const startAmplitudeAnalysis = useCallback(() => {
    if (amplitudeAnimationRef.current) return;

    let smoothedAmplitude = 0;

    const analyzeAmplitude = () => {
      const isPlaying = isAISpeakingRef.current || scheduledSourcesRef.current.length > 0;

      if (analyserNodeRef.current && isPlaying) {
        const timeData = new Float32Array(analyserNodeRef.current.fftSize);
        analyserNodeRef.current.getFloatTimeDomainData(timeData);

        let sum = 0;
        let peak = 0;
        for (let i = 0; i < timeData.length; i++) {
          const value = Math.abs(timeData[i]);
          sum += value * value;
          peak = Math.max(peak, value);
        }
        const rms = Math.sqrt(sum / timeData.length);
        const rawAmplitude = rms * 0.7 + peak * 0.3;
        const amplified = Math.min(1.0, rawAmplitude * 8);

        if (amplified > smoothedAmplitude) {
          smoothedAmplitude = smoothedAmplitude * 0.3 + amplified * 0.7;
        } else {
          smoothedAmplitude = smoothedAmplitude * 0.92 + amplified * 0.08;
        }
        setAudioAmplitude(smoothedAmplitude);
      } else {
        smoothedAmplitude = smoothedAmplitude * 0.96;
        setAudioAmplitude(smoothedAmplitude);
      }

      amplitudeAnimationRef.current = requestAnimationFrame(analyzeAmplitude);
    };

    amplitudeAnimationRef.current = requestAnimationFrame(analyzeAmplitude);
  }, []);

  const stopAmplitudeAnalysis = useCallback(() => {
    if (amplitudeAnimationRef.current) {
      cancelAnimationFrame(amplitudeAnimationRef.current);
      amplitudeAnimationRef.current = null;
    }
    setAudioAmplitude(0);
  }, []);

  const stopPlayback = useCallback(() => {
    console.log('🔇 Stopping current AI audio playback (barge-in)');

    isInterruptedRef.current = true;
    isActuallyPlayingRef.current = false;

    for (const source of scheduledSourcesRef.current) {
      try {
        source.stop();
        source.disconnect();
      } catch (err) {}
    }
    scheduledSourcesRef.current = [];

    if (playbackContextRef.current && playbackContextRef.current.state === 'running') {
      try {
        playbackContextRef.current.suspend();
        console.log('🔇 Playback AudioContext suspended to halt audio (WS kept alive)');
      } catch (err) {
        console.warn('Error suspending playback AudioContext:', err);
      }
    }

    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = DEFAULT_GAIN;
    }

    nextPlayTimeRef.current = 0;
    agcRmsRef.current = agcConfigRef.current.targetRms;
    setIsAISpeaking(false);
    isAISpeakingRef.current = false;
  }, [isInterruptedRef]);

  const scheduleAudioDelta = useCallback(async (base64Audio: string) => {
    if (isInterruptedRef.current) {
      console.log('🔇 Ignoring audio chunk (barge-in active)');
      return;
    }

    try {
      const audioContext = await initializePlaybackContext();
      if (!audioContext || isInterruptedRef.current) return;

      if (audioContext.state === 'suspended') {
        console.log('🔊 Resuming suspended AudioContext for playback');
        if (!await resumePlayback()) return;
        if (isInterruptedRef.current) return;
      }

      if (!isActuallyPlayingRef.current) {
        isActuallyPlayingRef.current = true;
      }

      if (!analyserNodeRef.current) {
        analyserNodeRef.current = audioContext.createAnalyser();
        analyserNodeRef.current.fftSize = 256;
        analyserNodeRef.current.smoothingTimeConstant = 0.8;

        // Compressor acts as a peak safety-net AFTER AGC pre-conditions the signal
        // to ~-16 dBFS RMS (AGC_TARGET_RMS = 0.15). Settings rationale:
        //   threshold=-10: sits above the AGC steady-state so the compressor only
        //     engages on genuine transients/peaks, not on every chunk of speech.
        //   ratio=4: gentle limiting; AGC already handles normalisation, so we
        //     only need a soft ceiling rather than hard brick-wall compression.
        //   knee=40: wide soft-knee avoids an abrupt onset at threshold.
        //   attack=8ms: lets short transients pass naturally before clamping.
        //   release=100ms: fast enough to not leave residual gain reduction
        //     between words (preventing the pumping that the old 250ms caused).
        compressorNodeRef.current = audioContext.createDynamicsCompressor();
        compressorNodeRef.current.threshold.value = -10;
        compressorNodeRef.current.knee.value = 40;
        compressorNodeRef.current.ratio.value = 4;
        compressorNodeRef.current.attack.value = 0.008;
        compressorNodeRef.current.release.value = 0.1;

        gainNodeRef.current = audioContext.createGain();
        gainNodeRef.current.gain.value = DEFAULT_GAIN;

        analyserNodeRef.current.connect(compressorNodeRef.current);
        compressorNodeRef.current.connect(gainNodeRef.current);
        gainNodeRef.current.connect(audioContext.destination);

        startAmplitudeAnalysis();
        console.log('🎵 Audio graph ready: source → analyser → compressor → gain → destination');
      }

      const binaryString = atob(base64Audio);
      const len = binaryString.length;
      const audioData = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        audioData[i] = binaryString.charCodeAt(i);
      }

      const pcm16 = new Int16Array(audioData.buffer);
      const float32 = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 32768.0;
      }

      let sumSq = 0;
      for (let i = 0; i < float32.length; i++) {
        sumSq += float32[i] * float32[i];
      }
      const chunkRms = Math.sqrt(sumSq / float32.length);

      const cfg = agcConfigRef.current;

      if (chunkRms >= AGC_SILENCE_THRESHOLD) {
        const coeff = chunkRms > agcRmsRef.current ? cfg.attackCoeff : cfg.releaseCoeff;
        agcRmsRef.current = agcRmsRef.current * (1 - coeff) + chunkRms * coeff;
      }

      if (agcRmsRef.current >= AGC_SILENCE_THRESHOLD) {
        const agcGain = Math.min(cfg.maxGain, Math.max(cfg.minGain, cfg.targetRms / agcRmsRef.current));
        for (let i = 0; i < float32.length; i++) {
          float32[i] = Math.max(-1.0, Math.min(1.0, float32[i] * agcGain));
        }
      }

      const audioBuffer = audioContext.createBuffer(1, float32.length, 24000);
      audioBuffer.getChannelData(0).set(float32);

      const currentTime = audioContext.currentTime;
      const startTime = Math.max(currentTime, nextPlayTimeRef.current);

      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.playbackRate.value = 1.0;
      source.connect(analyserNodeRef.current!);
      source.start(startTime);

      scheduledSourcesRef.current.push(source);

      source.onended = () => {
        const index = scheduledSourcesRef.current.indexOf(source);
        if (index > -1) {
          scheduledSourcesRef.current.splice(index, 1);
        }
      };

      const chunkDuration = audioBuffer.duration;
      nextPlayTimeRef.current = startTime + chunkDuration;

    } catch (err) {
      console.error('Error playing audio delta:', err);
    }
  }, [initializePlaybackContext, isInterruptedRef, resumePlayback, startAmplitudeAnalysis]);

  const playAudioDelta = useCallback((base64Audio: string) => {
    const scheduled = playbackQueueRef.current.then(() => scheduleAudioDelta(base64Audio));
    // Keep the queue usable after one malformed chunk or a recoverable browser failure.
    playbackQueueRef.current = scheduled.catch(() => {});
    return scheduled;
  }, [scheduleAudioDelta]);

  return {
    playbackContextRef,
    scheduledSourcesRef,
    nextPlayTimeRef,
    analyserNodeRef,
    gainNodeRef,
    isAISpeaking,
    isAISpeakingRef,
    isActuallyPlayingRef,
    audioAmplitude,
    outputDevices,
    selectedOutputDeviceId,
    outputAutoSelected,
    outputStatus,
    outputMessage,
    outputNeedsPermission,
    outputListUnavailable,
    requestOutputDevicePermission,
    setIsAISpeaking,
    stopPlayback,
    playAudioDelta,
    startAmplitudeAnalysis,
    stopAmplitudeAnalysis,
    selectOutputDevice,
    selectOutputDeviceByUser,
    refreshOutputDevices,
    initializePlaybackContext,
    resumePlayback,
  };
}
