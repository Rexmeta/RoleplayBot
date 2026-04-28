import { useState, useEffect, useRef, useCallback } from 'react';
import { useAudioPlayback } from './useAudioPlayback';
import { useVoiceActivityDetection } from './useVoiceActivityDetection';

export type RealtimeVoiceStatus =
  | 'disconnected'
  | 'connecting'
  | 'reconnecting'
  | 'connected'
  | 'error';

export type ConversationPhase =
  | 'idle'
  | 'active'
  | 'interrupted'
  | 'ended';

interface PreviousMessage {
  role: 'user' | 'ai';
  content: string;
}

interface UseRealtimeVoiceProps {
  conversationId: string;
  scenarioId: string;
  personaId: string;
  enabled: boolean;
  onMessage?: (message: string) => void;
  onMessageComplete?: (message: string, emotion?: string, emotionReason?: string) => void;
  onUserTranscription?: (transcript: string) => void;
  onUserTranscriptionDelta?: (delta: string, accumulated: string) => void;
  onAiSpeakingStart?: () => void;
  onUserSpeakingStart?: () => void;
  onError?: (error: string) => void;
  onSessionTerminated?: (reason: string) => void;
}

interface UseRealtimeVoiceReturn {
  status: RealtimeVoiceStatus;
  conversationPhase: ConversationPhase;
  isRecording: boolean;
  isAISpeaking: boolean;
  isWaitingForGreeting: boolean;
  greetingRetryCount: number;
  greetingFailed: boolean;
  audioAmplitude: number;
  userAudioAmplitude: number;
  connect: (previousMessages?: PreviousMessage[]) => Promise<void>;
  disconnect: () => void;
  startRecording: () => void;
  stopRecording: () => void;
  sendTextMessage: (text: string) => void;
  resetPhase: () => void;
  error: string | null;
  sessionWarning: string | null;
}

export function useRealtimeVoice({
  conversationId,
  scenarioId,
  personaId,
  enabled,
  onMessage,
  onMessageComplete,
  onUserTranscription,
  onUserTranscriptionDelta,
  onAiSpeakingStart,
  onUserSpeakingStart,
  onError,
  onSessionTerminated,
}: UseRealtimeVoiceProps): UseRealtimeVoiceReturn {
  const [status, setStatus] = useState<RealtimeVoiceStatus>('disconnected');
  const [conversationPhase, setConversationPhase] = useState<ConversationPhase>('idle');
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isWaitingForGreeting, setIsWaitingForGreeting] = useState(false);
  const [greetingRetryCount, setGreetingRetryCount] = useState(0);
  const [greetingFailed, setGreetingFailed] = useState(false);
  const [sessionWarning, setSessionWarning] = useState<string | null>(null);

  const hasConversationStartedRef = useRef<boolean>(false);
  const wsRef = useRef<WebSocket | null>(null);
  const captureContextRef = useRef<AudioContext | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const rawMicStreamRef = useRef<MediaStream | null>(null);
  const isRecordingRef = useRef<boolean>(false);
  const isInterruptedRef = useRef<boolean>(false);
  const expectedTurnSeqRef = useRef<number>(0);
  const serverVoiceDetectedTimeRef = useRef<number | null>(null);
  const aiMessageBufferRef = useRef<string>('');
  const audioResponseStartTimeRef = useRef<number | null>(null);
  const totalScheduledAudioDurationRef = useRef<number>(0);
  const textBufferQueueRef = useRef<string[]>([]);
  const lastTextDisplayTimeRef = useRef<number>(0);
  const textSyncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const aiSpeakingCallbackFiredRef = useRef(false);

  const autoReconnectCountRef = useRef(0);
  const autoReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const accumulatedMessagesRef = useRef<PreviousMessage[]>([]);
  const conversationPhaseRef = useRef<ConversationPhase>('idle');
  const connectRef = useRef<((previousMessages?: PreviousMessage[]) => Promise<void>) | null>(null);
  const wasRecordingBeforeReconnectRef = useRef<boolean>(false);
  const reconnectInProgressRef = useRef<boolean>(false);

  const MAX_AUTO_RECONNECT = 8;
  const sessionStorageKeyRef = useRef(`realtime_voice_messages_${conversationId}`);
  sessionStorageKeyRef.current = `realtime_voice_messages_${conversationId}`;

  const onMessageRef = useRef(onMessage);
  const onMessageCompleteRef = useRef(onMessageComplete);
  const onUserTranscriptionRef = useRef(onUserTranscription);
  const onUserTranscriptionDeltaRef = useRef(onUserTranscriptionDelta);
  const onAiSpeakingStartRef = useRef(onAiSpeakingStart);
  const onUserSpeakingStartRef = useRef(onUserSpeakingStart);
  const onErrorRef = useRef(onError);
  const onSessionTerminatedRef = useRef(onSessionTerminated);

  useEffect(() => {
    onMessageRef.current = onMessage;
    onMessageCompleteRef.current = onMessageComplete;
    onUserTranscriptionRef.current = onUserTranscription;
    onUserTranscriptionDeltaRef.current = onUserTranscriptionDelta;
    onAiSpeakingStartRef.current = onAiSpeakingStart;
    onUserSpeakingStartRef.current = onUserSpeakingStart;
    onErrorRef.current = onError;
    onSessionTerminatedRef.current = onSessionTerminated;
  }, [onMessage, onMessageComplete, onUserTranscription, onUserTranscriptionDelta, onAiSpeakingStart, onUserSpeakingStart, onError, onSessionTerminated]);

  useEffect(() => {
    conversationPhaseRef.current = conversationPhase;
  }, [conversationPhase]);

  const {
    playbackContextRef,
    scheduledSourcesRef,
    isAISpeaking,
    isAISpeakingRef,
    audioAmplitude,
    setIsAISpeaking,
    stopPlayback,
    playAudioDelta,
    stopAmplitudeAnalysis,
    analyserNodeRef,
    gainNodeRef,
  } = useAudioPlayback(isInterruptedRef);

  const {
    vadProcessorRef,
    voiceActivityStartRef,
    bargeInTriggeredRef,
    userAudioAmplitude,
    setupVAD,
  } = useVoiceActivityDetection();

  const stopCurrentPlayback = useCallback(() => {
    stopPlayback();
    aiMessageBufferRef.current = '';
    audioResponseStartTimeRef.current = null;
    totalScheduledAudioDurationRef.current = 0;
    textBufferQueueRef.current = [];
    lastTextDisplayTimeRef.current = 0;
    if (textSyncIntervalRef.current) {
      clearInterval(textSyncIntervalRef.current);
      textSyncIntervalRef.current = null;
    }
  }, [stopPlayback]);

  const getWebSocketUrl = useCallback((token: string) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/api/realtime-voice?conversationId=${conversationId}&scenarioId=${scenarioId}&personaId=${personaId}&token=${token}`;
  }, [conversationId, scenarioId, personaId]);

  const getRealtimeToken = useCallback(async (): Promise<string> => {
    const storedToken = localStorage.getItem('authToken');
    if (storedToken) {
      console.log('✅ Using stored auth token');
      return storedToken;
    }

    console.log('🔑 No stored token, requesting realtime token...');
    try {
      const response = await fetch('/api/auth/realtime-token', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) throw new Error('인증 토큰을 가져올 수 없습니다. 다시 로그인해주세요.');
      const data = await response.json();
      console.log('✅ Realtime token received, expires in:', data.expiresIn, 'seconds');
      return data.token;
    } catch (error) {
      console.error('❌ Failed to get realtime token:', error);
      throw new Error('인증 토큰을 가져올 수 없습니다. 다시 로그인해주세요.');
    }
  }, []);

  const disconnect = useCallback(() => {
    stopCurrentPlayback();

    if (textSyncIntervalRef.current) {
      clearInterval(textSyncIntervalRef.current);
      textSyncIntervalRef.current = null;
    }

    isInterruptedRef.current = false;

    stopAmplitudeAnalysis();

    if (analyserNodeRef.current) {
      analyserNodeRef.current.disconnect();
      analyserNodeRef.current = null;
    }
    if (gainNodeRef.current) {
      gainNodeRef.current.disconnect();
      gainNodeRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (playbackContextRef.current) {
      playbackContextRef.current.close();
      playbackContextRef.current = null;
    }
    if (captureContextRef.current) {
      captureContextRef.current.close();
      captureContextRef.current = null;
    }
    if (rawMicStreamRef.current) {
      rawMicStreamRef.current.getTracks().forEach(track => track.stop());
      rawMicStreamRef.current = null;
    }
    if (autoReconnectTimerRef.current) {
      clearTimeout(autoReconnectTimerRef.current);
      autoReconnectTimerRef.current = null;
    }
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }

    autoReconnectCountRef.current = MAX_AUTO_RECONNECT;
    try { sessionStorage.removeItem(sessionStorageKeyRef.current); } catch {}
    setStatus('disconnected');
    setIsRecording(false);
    setIsAISpeaking(false);
    setIsWaitingForGreeting(false);
    setGreetingRetryCount(0);
    setGreetingFailed(false);
  }, [stopCurrentPlayback, stopAmplitudeAnalysis, analyserNodeRef, gainNodeRef, playbackContextRef, setIsAISpeaking]);

  const previousMessagesRef = useRef<PreviousMessage[] | undefined>(undefined);

  const connect = useCallback(async (previousMessages?: PreviousMessage[]) => {
    previousMessagesRef.current = previousMessages;

    setStatus('connecting');
    setError(null);
    setGreetingFailed(false);
    isInterruptedRef.current = false;
    expectedTurnSeqRef.current = 0;

    try {
      if (!playbackContextRef.current || playbackContextRef.current.state === 'closed') {
        playbackContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        console.log('🔊 Pre-created playback AudioContext for first greeting');
      }

      if (playbackContextRef.current.state === 'suspended') {
        try {
          await playbackContextRef.current.resume();
          console.log('🔊 AudioContext resumed for first greeting playback');
        } catch (err) {
          console.warn('⚠️ Failed to resume AudioContext:', err);
        }
      }

      const token = await getRealtimeToken();
      const url = getWebSocketUrl(token);
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('🎙️ WebSocket connected for realtime voice');
        setStatus('connected');
        setConversationPhase('active');
        autoReconnectCountRef.current = 0;

        const resuming = previousMessagesRef.current && previousMessagesRef.current.length > 0;
        if (!resuming) setIsWaitingForGreeting(true);
        setGreetingRetryCount(0);

        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            const readyMessage: any = { type: 'client.ready' };
            if (previousMessagesRef.current && previousMessagesRef.current.length > 0) {
              readyMessage.previousMessages = previousMessagesRef.current;
              readyMessage.isResuming = true;
              console.log(`📤 Sending client.ready with ${previousMessagesRef.current.length} previous messages (resuming)`);
            } else {
              console.log('📤 Sent client.ready signal to server');
            }
            ws.send(JSON.stringify(readyMessage));
          }
        }, 100);

        if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25000);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          switch (data.type) {
            case 'pong':
              break;
            case 'session.created':
            case 'conversation.item.created':
              break;

            case 'user.transcription':
              if (data.transcript && onUserTranscriptionRef.current) {
                onUserTranscriptionRef.current(data.transcript);
              }
              if (data.transcript) {
                accumulatedMessagesRef.current.push({ role: 'user', content: data.transcript });
                if (accumulatedMessagesRef.current.length > 10) accumulatedMessagesRef.current.shift();
                try { sessionStorage.setItem(sessionStorageKeyRef.current, JSON.stringify(accumulatedMessagesRef.current)); } catch {}
              }
              serverVoiceDetectedTimeRef.current = null;
              break;

            case 'user.transcription.delta':
              if (data.accumulated && onUserTranscriptionDeltaRef.current) {
                onUserTranscriptionDeltaRef.current(data.text, data.accumulated);
              }
              break;

            case 'user.speaking.started':
              console.log('🎙️ Server detected user speaking');
              if (serverVoiceDetectedTimeRef.current === null) {
                serverVoiceDetectedTimeRef.current = Date.now();
                if (onUserSpeakingStartRef.current) onUserSpeakingStartRef.current();
              }
              if (isAISpeakingRef.current && !bargeInTriggeredRef.current) {
                setTimeout(() => {
                  if (isAISpeakingRef.current && !bargeInTriggeredRef.current && serverVoiceDetectedTimeRef.current !== null) {
                    const duration = Date.now() - serverVoiceDetectedTimeRef.current;
                    if (duration >= 1500) {
                      console.log('🎤 1.5-second voice detected by server - triggering barge-in');
                      bargeInTriggeredRef.current = true;
                      stopCurrentPlayback();
                      expectedTurnSeqRef.current++;
                      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                        wsRef.current.send(JSON.stringify({ type: 'response.cancel' }));
                      }
                    }
                  }
                }, 1500);
              }
              break;

            case 'audio.delta':
              if (data.delta) {
                if (data.turnSeq !== undefined && data.turnSeq < expectedTurnSeqRef.current) {
                  console.log(`🔇 Ignoring old audio (turnSeq ${data.turnSeq} < expected ${expectedTurnSeqRef.current})`);
                  break;
                }
                if (isInterruptedRef.current) {
                  console.log('🔊 New AI response started - resetting barge-in interrupted flag');
                  isInterruptedRef.current = false;
                }
                if (!aiSpeakingCallbackFiredRef.current) {
                  aiSpeakingCallbackFiredRef.current = true;
                  if (onAiSpeakingStartRef.current) onAiSpeakingStartRef.current();
                }
                setIsAISpeaking(true);
                isAISpeakingRef.current = true;
                playAudioDelta(data.delta);
              }
              break;

            case 'audio.done':
              console.log('✅ Audio playback complete');
              break;

            case 'ai.transcription.delta':
              if (data.text) {
                aiMessageBufferRef.current += data.text;
                if (onMessageRef.current) onMessageRef.current(data.text);
              }
              break;

            case 'ai.transcription.done':
              hasConversationStartedRef.current = true;
              setIsWaitingForGreeting(false);
              setGreetingRetryCount(0);
              setGreetingFailed(false);
              if (data.text && onMessageCompleteRef.current) {
                onMessageCompleteRef.current(data.text, data.emotion, data.emotionReason);
              }
              if (data.text) {
                accumulatedMessagesRef.current.push({ role: 'ai', content: data.text });
                if (accumulatedMessagesRef.current.length > 10) accumulatedMessagesRef.current.shift();
                try { sessionStorage.setItem(sessionStorageKeyRef.current, JSON.stringify(accumulatedMessagesRef.current)); } catch {}
              }
              aiMessageBufferRef.current = '';
              break;

            case 'response.done':
              setIsAISpeaking(false);
              isAISpeakingRef.current = false;
              setGreetingFailed(false);
              audioResponseStartTimeRef.current = null;
              totalScheduledAudioDurationRef.current = 0;
              lastTextDisplayTimeRef.current = 0;
              aiSpeakingCallbackFiredRef.current = false;
              break;

            case 'response.interrupted':
              setIsAISpeaking(false);
              isAISpeakingRef.current = false;
              break;

            case 'response.ready':
              isInterruptedRef.current = false;
              bargeInTriggeredRef.current = false;
              serverVoiceDetectedTimeRef.current = null;
              if (data.turnSeq !== undefined) {
                expectedTurnSeqRef.current = data.turnSeq - 1;
              }
              break;

            case 'session.warning':
              setSessionWarning(data.message || '연결이 곧 종료됩니다. 대화를 마무리해 주세요.');
              break;

            case 'session.refreshing':
              setSessionWarning('연결을 자동으로 갱신하고 있습니다...');
              break;

            case 'session.reconnecting':
              setError(`AI 연결 재시도 중... (${data.attempt}/${data.maxAttempts})`);
              break;

            case 'session.reconnected':
              setError(null);
              setSessionWarning(null);
              break;

            case 'greeting.retry':
              setGreetingRetryCount(data.retryCount);
              break;

            case 'greeting.failed':
              setIsWaitingForGreeting(false);
              if (!hasConversationStartedRef.current) setGreetingFailed(true);
              break;

            case 'session.terminated':
              setConversationPhase('ended');
              if (onSessionTerminatedRef.current) onSessionTerminatedRef.current(data.reason || 'Session ended');
              disconnect();
              break;

            case 'error':
              console.error('❌ Server error:', data.error);
              setError(data.error);
              if (onErrorRef.current) onErrorRef.current(data.error);
              break;

            default:
              console.log('📨 Unhandled message type:', data.type);
          }
        } catch (err) {
          console.error('Error parsing WebSocket message:', err);
        }
      };

      ws.onerror = (event) => {
        console.error('❌ WebSocket error:', event);
        setError('WebSocket connection error');
        setStatus('error');
        setIsWaitingForGreeting(false);
        setGreetingRetryCount(0);
        setGreetingFailed(false);
        if (onErrorRef.current) onErrorRef.current('Connection error');
      };

      ws.onclose = (event) => {
        console.log('🔌 WebSocket closed:', event.code, event.reason);
        if (heartbeatTimerRef.current) {
          clearInterval(heartbeatTimerRef.current);
          heartbeatTimerRef.current = null;
        }
        setIsRecording(false);
        setIsWaitingForGreeting(false);
        setGreetingRetryCount(0);
        setGreetingFailed(false);

        setConversationPhase((currentPhase) => {
          if (currentPhase === 'ended') return 'ended';
          if (hasConversationStartedRef.current) return 'interrupted';
          return 'idle';
        });

        const currentPhase = conversationPhaseRef.current;
        const shouldAutoReconnect =
          hasConversationStartedRef.current &&
          currentPhase !== 'ended' &&
          autoReconnectCountRef.current < MAX_AUTO_RECONNECT &&
          connectRef.current !== null;

        if (shouldAutoReconnect) {
          const backoffDelay = Math.min(1500 * Math.pow(2, autoReconnectCountRef.current), 60000);
          setStatus('reconnecting');

          autoReconnectTimerRef.current = setTimeout(() => {
            autoReconnectCountRef.current += 1;

            let savedMessages: PreviousMessage[] = [];
            try {
              const saved = sessionStorage.getItem(sessionStorageKeyRef.current);
              if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) savedMessages = parsed;
              }
            } catch {}

            const base = previousMessagesRef.current || [];
            const accumulated = savedMessages.length > 0 ? savedMessages : accumulatedMessagesRef.current;
            const combined: PreviousMessage[] = [...base, ...accumulated];

            if (connectRef.current) {
              connectRef.current(combined.length > 0 ? combined : undefined);
            }
          }, backoffDelay);
          return;
        }

        setStatus('disconnected');
      };

    } catch (err) {
      console.error('Error connecting to WebSocket:', err);
      setError(err instanceof Error ? err.message : 'Connection failed');
      setStatus('error');
      setIsWaitingForGreeting(false);
      setGreetingRetryCount(0);
      setGreetingFailed(false);
      if (onErrorRef.current) onErrorRef.current(err instanceof Error ? err.message : 'Connection failed');
    }
  }, [enabled, getRealtimeToken, getWebSocketUrl, disconnect, stopCurrentPlayback, playAudioDelta, setIsAISpeaking, isAISpeakingRef, bargeInTriggeredRef]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const startRecordingRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (status === 'reconnecting') {
      wasRecordingBeforeReconnectRef.current = isRecordingRef.current;
      reconnectInProgressRef.current = true;
    } else if (status === 'connected' && reconnectInProgressRef.current) {
      reconnectInProgressRef.current = false;
      if (wasRecordingBeforeReconnectRef.current) {
        wasRecordingBeforeReconnectRef.current = false;
        setTimeout(() => {
          if (startRecordingRef.current) startRecordingRef.current();
        }, 300);
      }
    } else if (status === 'disconnected' || status === 'error') {
      reconnectInProgressRef.current = false;
      wasRecordingBeforeReconnectRef.current = false;
    }
  }, [status]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;

      if (playbackContextRef.current?.state === 'suspended') {
        playbackContextRef.current.resume().catch(() => {});
      }

      const wsState = wsRef.current?.readyState;
      const isClosed = wsState === WebSocket.CLOSED || wsState === WebSocket.CLOSING || wsRef.current === null;
      const isActiveConversation = hasConversationStartedRef.current && conversationPhaseRef.current !== 'ended';

      if (isClosed && isActiveConversation && connectRef.current !== null) {
        console.log('📱 화면 잠금 해제: WebSocket 재연결 시작');
        autoReconnectCountRef.current = 0;
        if (autoReconnectTimerRef.current) {
          clearTimeout(autoReconnectTimerRef.current);
          autoReconnectTimerRef.current = null;
        }
        setStatus('reconnecting');

        let savedMessages: PreviousMessage[] = [];
        try {
          const saved = sessionStorage.getItem(sessionStorageKeyRef.current);
          if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) savedMessages = parsed;
          }
        } catch {}

        const base = previousMessagesRef.current || [];
        const accumulated = savedMessages.length > 0 ? savedMessages : accumulatedMessagesRef.current;
        const combined: PreviousMessage[] = [...base, ...accumulated];

        autoReconnectCountRef.current = 1;
        connectRef.current(combined.length > 0 ? combined : undefined);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startRecording = useCallback(async () => {
    if (status !== 'connected' || !wsRef.current) {
      console.warn('Cannot start recording: not connected');
      return;
    }

    if (isAISpeaking) {
      console.log('🎤 User starting to speak - interrupting AI (barge-in)');
      stopCurrentPlayback();
      bargeInTriggeredRef.current = true;
      expectedTurnSeqRef.current++;
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'response.cancel' }));
      }
    }

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });

      micStreamRef.current = stream;
      console.log('🎙️ Created single mic stream for Gemini + VAD');

      if (!captureContextRef.current) {
        captureContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      const audioContext = captureContextRef.current;
      const source = audioContext.createMediaStreamSource(stream);

      setupVAD({
        audioContext,
        source,
        playbackContextRef,
        wsRef,
        isRecordingRef,
        expectedTurnSeqRef,
        stopPlayback,
      });

      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      audioProcessorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!isRecordingRef.current) return;
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        const inputData = e.inputBuffer.getChannelData(0);
        const targetSampleRate = 16000;
        const sourceSampleRate = audioContext.sampleRate;
        const ratio = sourceSampleRate / targetSampleRate;
        const targetLength = Math.floor(inputData.length / ratio);
        const resampledData = new Float32Array(targetLength);

        for (let i = 0; i < targetLength; i++) {
          resampledData[i] = inputData[Math.floor(i * ratio)];
        }

        const pcm16 = new Int16Array(resampledData.length);
        for (let i = 0; i < resampledData.length; i++) {
          const s = Math.max(-1, Math.min(1, resampledData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        const uint8Array = new Uint8Array(pcm16.buffer);
        let binaryString = '';
        for (let i = 0; i < uint8Array.length; i++) {
          binaryString += String.fromCharCode(uint8Array[i]);
        }
        const base64 = btoa(binaryString);

        wsRef.current.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: base64 }));
      };

      source.connect(processor);
      const dummyGain = audioContext.createGain();
      dummyGain.gain.value = 0;
      processor.connect(dummyGain);
      dummyGain.connect(audioContext.destination);

      setIsRecording(true);
      isRecordingRef.current = true;
      console.log('🎤 Recording started (PCM16 16kHz for Gemini)');
    } catch (err) {
      console.error('Error starting recording:', err);
      setError('Microphone access denied');
      if (onErrorRef.current) onErrorRef.current('Microphone access denied');
    }
  }, [status, isAISpeaking, stopCurrentPlayback, stopPlayback, setupVAD, playbackContextRef, bargeInTriggeredRef]);

  const stopRecording = useCallback(() => {
    console.log('🎤 Stopping recording...');

    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }

    voiceActivityStartRef.current = null;
    bargeInTriggeredRef.current = false;

    if (playbackContextRef.current && playbackContextRef.current.state === 'suspended') {
      playbackContextRef.current.resume().catch(() => {});
    }

    setIsRecording(false);
    isRecordingRef.current = false;

    setTimeout(() => {
      if (audioProcessorRef.current) {
        audioProcessorRef.current.disconnect();
        audioProcessorRef.current = null;
      }
      if (vadProcessorRef.current) {
        vadProcessorRef.current.disconnect();
        vadProcessorRef.current = null;
      }
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach(track => track.stop());
        micStreamRef.current = null;
      }
      if (rawMicStreamRef.current) {
        rawMicStreamRef.current.getTracks().forEach(track => track.stop());
        rawMicStreamRef.current = null;
      }
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
        wsRef.current.send(JSON.stringify({ type: 'response.create', response: { modalities: ['audio', 'text'] } }));
      }
    }, 100);
  }, [playbackContextRef, voiceActivityStartRef, bargeInTriggeredRef, vadProcessorRef]);

  const sendTextMessage = useCallback((text: string) => {
    if (!text.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    if (onUserTranscriptionRef.current) onUserTranscriptionRef.current(text);

    wsRef.current.send(JSON.stringify({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }
    }));
    wsRef.current.send(JSON.stringify({ type: 'response.create', response: { modalities: ['audio', 'text'] } }));
  }, []);

  useEffect(() => {
    startRecordingRef.current = startRecording;
  }, [startRecording]);

  useEffect(() => {
    if (enabled) connect();
    return () => { disconnect(); };
  }, [enabled, connect, disconnect]);

  const resetPhase = useCallback(() => {
    setConversationPhase('idle');
    hasConversationStartedRef.current = false;
    accumulatedMessagesRef.current = [];
    try { sessionStorage.removeItem(sessionStorageKeyRef.current); } catch {}
    autoReconnectCountRef.current = 0;
    if (autoReconnectTimerRef.current) {
      clearTimeout(autoReconnectTimerRef.current);
      autoReconnectTimerRef.current = null;
    }
  }, []);

  return {
    status,
    conversationPhase,
    isRecording,
    isAISpeaking,
    isWaitingForGreeting,
    greetingRetryCount,
    greetingFailed,
    audioAmplitude,
    userAudioAmplitude,
    connect,
    disconnect,
    startRecording,
    stopRecording,
    sendTextMessage,
    resetPhase,
    error,
    sessionWarning,
  };
}
