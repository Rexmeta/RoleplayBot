import { useState, useRef, useCallback } from 'react';

const VOICE_THRESHOLD = 0.06;
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

  const setupVAD = useCallback(({
    audioContext,
    source,
    playbackContextRef,
    wsRef,
    isRecordingRef,
    expectedTurnSeqRef,
    stopPlayback,
  }: SetupVADParams) => {
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
        console.log(`🔊 RAW-VAD: RMS=${rms.toFixed(4)}, threshold=${VOICE_THRESHOLD}, playbackRunning=${isPlaybackRunning}`);
      }

      const normalizedRms = Math.min(1, rms * 10);
      setUserAudioAmplitude(normalizedRms);

      if (rms > VOICE_THRESHOLD) {
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
