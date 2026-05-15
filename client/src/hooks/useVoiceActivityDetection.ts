import { useState, useRef, useCallback } from 'react';

const DEFAULT_ENTRY_THRESHOLD = 0.06;
const DEFAULT_EXIT_THRESHOLD = DEFAULT_ENTRY_THRESHOLD * 0.6;
const BARGE_IN_DELAY_MS = 300;
const MIN_VOICE_DURATION_MS = 500;

interface SetupVADParams {
  audioContext: AudioContext;
  source: MediaStreamAudioSourceNode;
  playbackContextRef: React.MutableRefObject<AudioContext | null>;
  wsRef: React.MutableRefObject<WebSocket | null>;
  isRecordingRef: React.MutableRefObject<boolean>;
  expectedTurnSeqRef: React.MutableRefObject<number>;
  stopPlayback: () => void;
  entryThreshold?: number;
  exitThreshold?: number;
}

interface UseVADReturn {
  vadProcessorRef: React.MutableRefObject<ScriptProcessorNode | null>;
  voiceActivityStartRef: React.MutableRefObject<number | null>;
  bargeInTriggeredRef: React.MutableRefObject<boolean>;
  userAudioAmplitude: number;
  setupVAD: (params: SetupVADParams) => void;
}

export function useVoiceActivityDetection(): UseVADReturn {
  const [userAudioAmplitude, setUserAudioAmplitude] = useState(0);
  const vadProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const voiceActivityStartRef = useRef<number | null>(null);
  const bargeInTriggeredRef = useRef<boolean>(false);
  const isVoiceActiveRef = useRef<boolean>(false);

  const setupVAD = useCallback(({
    audioContext,
    source,
    playbackContextRef,
    wsRef,
    isRecordingRef,
    expectedTurnSeqRef,
    stopPlayback,
    entryThreshold,
    exitThreshold,
  }: SetupVADParams) => {
    const activeThreshold = entryThreshold ?? DEFAULT_ENTRY_THRESHOLD;
    const inactiveThreshold = exitThreshold ?? DEFAULT_EXIT_THRESHOLD;

    isVoiceActiveRef.current = false;

    const vadProcessor = audioContext.createScriptProcessor(4096, 1, 1);
    vadProcessorRef.current = vadProcessor;

    vadProcessor.onaudioprocess = (e) => {
      if (!isRecordingRef.current) return;

      const inputData = e.inputBuffer.getChannelData(0);

      let sum = 0;
      for (let i = 0; i < inputData.length; i++) {
        sum += inputData[i] * inputData[i];
      }
      const rms = Math.sqrt(sum / inputData.length);

      const isPlaybackRunning = playbackContextRef.current?.state === 'running';

      if (Math.random() < 0.05) {
        console.log(`🔊 RAW-VAD: RMS=${rms.toFixed(4)}, entry=${activeThreshold.toFixed(4)}, exit=${inactiveThreshold.toFixed(4)}, voiceActive=${isVoiceActiveRef.current}, playbackRunning=${isPlaybackRunning}`);
      }

      const normalizedRms = Math.min(1, rms * 10);
      setUserAudioAmplitude(normalizedRms);

      const thresholdForState = isVoiceActiveRef.current ? inactiveThreshold : activeThreshold;
      const voiceDetected = rms > thresholdForState;

      if (voiceDetected) {
        isVoiceActiveRef.current = true;

        if (voiceActivityStartRef.current === null) {
          voiceActivityStartRef.current = Date.now();
        }

        const voiceDuration = Date.now() - voiceActivityStartRef.current;

        if (voiceDuration >= MIN_VOICE_DURATION_MS && voiceDuration < MIN_VOICE_DURATION_MS + 100) {
          console.log(`🎤 Voice activity confirmed (${MIN_VOICE_DURATION_MS}ms sustained)`);
        }

        if (voiceDuration >= BARGE_IN_DELAY_MS && !bargeInTriggeredRef.current && isPlaybackRunning) {
          console.log(`🎤 ${BARGE_IN_DELAY_MS}ms voice detected - triggering barge-in`);
          bargeInTriggeredRef.current = true;

          stopPlayback();

          expectedTurnSeqRef.current++;
          console.log(`📊 Expected turn seq incremented to ${expectedTurnSeqRef.current}`);

          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'response.cancel' }));
            console.log('📤 Sent response.cancel to interrupt AI response');
          }
        }
      } else {
        if (isVoiceActiveRef.current) {
          isVoiceActiveRef.current = false;
        }
        if (bargeInTriggeredRef.current) {
          console.log('🔇 User stopped speaking - ready for new AI response');
          bargeInTriggeredRef.current = false;
        }
        voiceActivityStartRef.current = null;
      }
    };

    source.connect(vadProcessor);
    const vadDummyGain = audioContext.createGain();
    vadDummyGain.gain.value = 0;
    vadProcessor.connect(vadDummyGain);
    vadDummyGain.connect(audioContext.destination);
  }, []);

  return {
    vadProcessorRef,
    voiceActivityStartRef,
    bargeInTriggeredRef,
    userAudioAmplitude,
    setupVAD,
  };
}
