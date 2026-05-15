import { useState, useRef, useCallback } from 'react';

const PEAK_NORMALIZATION_TARGET = 0.8;
const PEAK_NORMALIZATION_SILENCE_THRESHOLD = 0.01;
const DEFAULT_GAIN = 1.0;

interface UseAudioPlaybackReturn {
  playbackContextRef: React.MutableRefObject<AudioContext | null>;
  scheduledSourcesRef: React.MutableRefObject<AudioBufferSourceNode[]>;
  nextPlayTimeRef: React.MutableRefObject<number>;
  analyserNodeRef: React.MutableRefObject<AnalyserNode | null>;
  gainNodeRef: React.MutableRefObject<GainNode | null>;
  isAISpeaking: boolean;
  isAISpeakingRef: React.MutableRefObject<boolean>;
  audioAmplitude: number;
  setIsAISpeaking: React.Dispatch<React.SetStateAction<boolean>>;
  stopPlayback: () => void;
  playAudioDelta: (base64: string) => Promise<void>;
  startAmplitudeAnalysis: () => void;
  stopAmplitudeAnalysis: () => void;
}

export function useAudioPlayback(
  isInterruptedRef: React.MutableRefObject<boolean>
): UseAudioPlaybackReturn {
  const [isAISpeaking, setIsAISpeaking] = useState(false);
  const [audioAmplitude, setAudioAmplitude] = useState(0);

  const playbackContextRef = useRef<AudioContext | null>(null);
  const scheduledSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const nextPlayTimeRef = useRef<number>(0);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const compressorNodeRef = useRef<DynamicsCompressorNode | null>(null);
  const amplitudeAnimationRef = useRef<number | null>(null);
  const isAISpeakingRef = useRef<boolean>(false);

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
    setIsAISpeaking(false);
    isAISpeakingRef.current = false;
  }, [isInterruptedRef]);

  const playAudioDelta = useCallback(async (base64Audio: string) => {
    if (isInterruptedRef.current) {
      console.log('🔇 Ignoring audio chunk (barge-in active)');
      return;
    }

    try {
      if (!playbackContextRef.current) {
        playbackContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        nextPlayTimeRef.current = 0;
        console.log('🔊 Created new playback AudioContext');
      }

      const audioContext = playbackContextRef.current;

      if (audioContext.state === 'suspended') {
        console.log('🔊 Resuming suspended AudioContext for playback');
        await audioContext.resume();
      }

      if (!analyserNodeRef.current) {
        analyserNodeRef.current = audioContext.createAnalyser();
        analyserNodeRef.current.fftSize = 256;
        analyserNodeRef.current.smoothingTimeConstant = 0.8;

        compressorNodeRef.current = audioContext.createDynamicsCompressor();
        compressorNodeRef.current.threshold.value = -24;
        compressorNodeRef.current.knee.value = 30;
        compressorNodeRef.current.ratio.value = 12;
        compressorNodeRef.current.attack.value = 0.003;
        compressorNodeRef.current.release.value = 0.25;

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

      let peak = 0;
      for (let i = 0; i < float32.length; i++) {
        const abs = Math.abs(float32[i]);
        if (abs > peak) peak = abs;
      }
      if (peak >= PEAK_NORMALIZATION_SILENCE_THRESHOLD) {
        const scale = PEAK_NORMALIZATION_TARGET / peak;
        for (let i = 0; i < float32.length; i++) {
          float32[i] *= scale;
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
  }, [isInterruptedRef, startAmplitudeAnalysis]);

  return {
    playbackContextRef,
    scheduledSourcesRef,
    nextPlayTimeRef,
    analyserNodeRef,
    gainNodeRef,
    isAISpeaking,
    isAISpeakingRef,
    audioAmplitude,
    setIsAISpeaking,
    stopPlayback,
    playAudioDelta,
    startAmplitudeAnalysis,
    stopAmplitudeAnalysis,
  };
}
