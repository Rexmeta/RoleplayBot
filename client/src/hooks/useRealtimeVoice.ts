import { useState, useEffect, useRef, useCallback } from 'react';

export type RealtimeVoiceStatus = 
  | 'disconnected' 
  | 'connecting' 
  | 'connected' 
  | 'error';

interface UseRealtimeVoiceProps {
  conversationId: string;
  scenarioId: string;
  personaId: string;
  enabled: boolean;
  onMessage?: (message: string) => void;
  onMessageComplete?: (message: string) => void;
  onUserTranscription?: (transcript: string) => void;
  onError?: (error: string) => void;
  onSessionTerminated?: (reason: string) => void;
}

interface UseRealtimeVoiceReturn {
  status: RealtimeVoiceStatus;
  isRecording: boolean;
  isAISpeaking: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  startRecording: () => void;
  stopRecording: () => void;
  sendTextMessage: (text: string) => void;
  error: string | null;
}

export function useRealtimeVoice({
  conversationId,
  scenarioId,
  personaId,
  enabled,
  onMessage,
  onMessageComplete,
  onUserTranscription,
  onError,
  onSessionTerminated,
}: UseRealtimeVoiceProps): UseRealtimeVoiceReturn {
  const [status, setStatus] = useState<RealtimeVoiceStatus>('disconnected');
  const [isRecording, setIsRecording] = useState(false);
  const [isAISpeaking, setIsAISpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const nextPlayTimeRef = useRef<number>(0); // Track when to play next chunk
  const aiMessageBufferRef = useRef<string>(''); // Buffer for AI message transcription
  
  // Store callbacks in refs to avoid recreating connect() on every render
  const onMessageRef = useRef(onMessage);
  const onMessageCompleteRef = useRef(onMessageComplete);
  const onUserTranscriptionRef = useRef(onUserTranscription);
  const onErrorRef = useRef(onError);
  const onSessionTerminatedRef = useRef(onSessionTerminated);
  
  useEffect(() => {
    onMessageRef.current = onMessage;
    onMessageCompleteRef.current = onMessageComplete;
    onUserTranscriptionRef.current = onUserTranscription;
    onErrorRef.current = onError;
    onSessionTerminatedRef.current = onSessionTerminated;
  }, [onMessage, onMessageComplete, onUserTranscription, onError, onSessionTerminated]);

  const getWebSocketUrl = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const token = localStorage.getItem('authToken');
    
    return `${protocol}//${host}/api/realtime-voice?conversationId=${conversationId}&scenarioId=${scenarioId}&personaId=${personaId}&token=${token}`;
  }, [conversationId, scenarioId, personaId]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setStatus('disconnected');
    setIsRecording(false);
    setIsAISpeaking(false);
  }, []);

  const connect = useCallback(async () => {
    setStatus('connecting');
    setError(null);

    try {
      const url = getWebSocketUrl();
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('🎙️ WebSocket connected for realtime voice');
        setStatus('connected');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('📨 WebSocket message:', data.type);

          switch (data.type) {
            case 'session.created':
              console.log('✅ Session created:', data.session);
              break;

            case 'conversation.item.created':
              console.log('💬 Conversation item created:', data.item);
              break;

            // 🎤 사용자 음성 전사 (텍스트 변환)
            case 'user.transcription':
              if (data.transcript && onUserTranscriptionRef.current) {
                console.log('🎤 User said:', data.transcript);
                onUserTranscriptionRef.current(data.transcript);
              }
              break;

            // 🔊 오디오 재생
            case 'audio.delta':
              if (data.delta) {
                setIsAISpeaking(true);
                playAudioDelta(data.delta);
              }
              break;

            case 'audio.done':
              console.log('✅ Audio playback complete');
              break;

            // 📝 AI 응답 스트리밍 (버퍼에 누적)
            case 'ai.transcription.delta':
              if (data.text) {
                aiMessageBufferRef.current += data.text;
                // 실시간 스트리밍 표시용 (선택적)
                if (onMessageRef.current) {
                  onMessageRef.current(data.text);
                }
              }
              break;

            case 'ai.transcription.done':
              console.log('✅ Transcription complete:', data.text);
              // 완전한 메시지를 onMessageComplete로 전달
              if (data.text && onMessageCompleteRef.current) {
                onMessageCompleteRef.current(data.text);
              }
              // 버퍼 초기화
              aiMessageBufferRef.current = '';
              break;

            case 'response.done':
              console.log('✅ Response complete');
              setIsAISpeaking(false);
              break;

            case 'session.terminated':
              console.log('🔌 Session terminated:', data.reason);
              if (onSessionTerminatedRef.current) {
                onSessionTerminatedRef.current(data.reason || 'Session ended');
              }
              disconnect();
              break;

            case 'error':
              console.error('❌ Server error:', data.error);
              setError(data.error);
              if (onErrorRef.current) {
                onErrorRef.current(data.error);
              }
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
        if (onErrorRef.current) {
          onErrorRef.current('Connection error');
        }
      };

      ws.onclose = (event) => {
        console.log('🔌 WebSocket closed:', event.code, event.reason);
        setStatus('disconnected');
        setIsRecording(false);
      };

    } catch (err) {
      console.error('Error connecting to WebSocket:', err);
      setError(err instanceof Error ? err.message : 'Connection failed');
      setStatus('error');
      if (onErrorRef.current) {
        onErrorRef.current(err instanceof Error ? err.message : 'Connection failed');
      }
    }
  }, [enabled, getWebSocketUrl, disconnect]);

  const playAudioDelta = useCallback(async (base64Audio: string) => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        nextPlayTimeRef.current = 0; // Reset play time
      }

      const audioContext = audioContextRef.current;
      
      // Decode base64 to raw bytes
      const binaryString = atob(base64Audio);
      const len = binaryString.length;
      const audioData = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        audioData[i] = binaryString.charCodeAt(i);
      }
      
      // Convert PCM16 (Int16) to Float32 for Web Audio API
      const pcm16 = new Int16Array(audioData.buffer);
      const float32 = new Float32Array(pcm16.length);
      
      // Normalize PCM16 values (-32768 to 32767) to Float32 (-1.0 to 1.0)
      for (let i = 0; i < pcm16.length; i++) {
        float32[i] = pcm16[i] / 32768.0;
      }

      // Create AudioBuffer manually for PCM16 data
      const audioBuffer = audioContext.createBuffer(1, float32.length, 24000);
      audioBuffer.getChannelData(0).set(float32);
      
      // Calculate when to play this chunk (sequential playback)
      const currentTime = audioContext.currentTime;
      const startTime = Math.max(currentTime, nextPlayTimeRef.current);
      
      // Play audio at scheduled time
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      
      // 발화 속도를 10% 빠르게 설정 (1.1배 속도)
      source.playbackRate.value = 1.1;
      
      source.connect(audioContext.destination);
      source.start(startTime);
      
      // Update next play time (current chunk start time + duration / playbackRate)
      nextPlayTimeRef.current = startTime + (audioBuffer.duration / 1.1);
      
      console.log('🔊 Playing audio chunk:', float32.length, 'samples', 'at', startTime.toFixed(3));
    } catch (err) {
      console.error('Error playing audio delta:', err);
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (status !== 'connected' || !wsRef.current) {
      console.warn('Cannot start recording: not connected');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 24000,
          echoCancellation: true,
          noiseSuppression: true,
        } 
      });
      
      micStreamRef.current = stream;

      // Create AudioContext for PCM16 conversion
      // Note: Browser may use different sample rate (e.g. 48000), we'll resample
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      const audioContext = audioContextRef.current;
      const source = audioContext.createMediaStreamSource(stream);
      
      console.log(`🎙️ AudioContext sample rate: ${audioContext.sampleRate}Hz`);
      
      // Use ScriptProcessorNode to process raw audio (4096 buffer size)
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      audioProcessorRef.current = processor;
      
      processor.onaudioprocess = (e) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          return;
        }

        const inputData = e.inputBuffer.getChannelData(0);
        
        // Resample to 24kHz if needed
        const targetSampleRate = 24000;
        const sourceSampleRate = audioContext.sampleRate;
        const ratio = sourceSampleRate / targetSampleRate;
        const targetLength = Math.floor(inputData.length / ratio);
        const resampledData = new Float32Array(targetLength);
        
        for (let i = 0; i < targetLength; i++) {
          const sourceIndex = Math.floor(i * ratio);
          resampledData[i] = inputData[sourceIndex];
        }
        
        // Convert Float32 (-1 to 1) to Int16 (PCM16)
        const pcm16 = new Int16Array(resampledData.length);
        for (let i = 0; i < resampledData.length; i++) {
          const s = Math.max(-1, Math.min(1, resampledData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        
        // Convert to base64
        const uint8Array = new Uint8Array(pcm16.buffer);
        let binaryString = '';
        for (let i = 0; i < uint8Array.length; i++) {
          binaryString += String.fromCharCode(uint8Array[i]);
        }
        const base64 = btoa(binaryString);
        
        // Send to OpenAI
        wsRef.current.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: base64,
        }));
      };
      
      source.connect(processor);
      // IMPORTANT: Don't connect to destination (would echo microphone to speakers)
      // Just connect to a dummy destination to keep the processor active
      const dummyGain = audioContext.createGain();
      dummyGain.gain.value = 0;
      processor.connect(dummyGain);
      dummyGain.connect(audioContext.destination);
      
      setIsRecording(true);
      console.log('🎤 Recording started (PCM16 24kHz)');
    } catch (err) {
      console.error('Error starting recording:', err);
      setError('Microphone access denied');
      if (onErrorRef.current) {
        onErrorRef.current('Microphone access denied');
      }
    }
  }, [status]);

  const stopRecording = useCallback(() => {
    console.log('🎤 Stopping recording...');
    
    // Stop sending audio first
    setIsRecording(false);
    
    // Small delay to ensure last audio chunks are sent
    setTimeout(() => {
      // Disconnect audio processor
      if (audioProcessorRef.current) {
        audioProcessorRef.current.disconnect();
        audioProcessorRef.current = null;
      }
      
      // Stop microphone stream
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach(track => track.stop());
        micStreamRef.current = null;
      }
      
      // Commit audio and request response
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        console.log('📤 Committing audio buffer and requesting response');
        wsRef.current.send(JSON.stringify({
          type: 'input_audio_buffer.commit',
        }));
        wsRef.current.send(JSON.stringify({
          type: 'response.create',
          response: {
            modalities: ['audio', 'text'],
          },
        }));
      }
      
      console.log('✅ Recording stopped and committed');
    }, 100); // 100ms delay
  }, []);

  const sendTextMessage = useCallback((text: string) => {
    if (!text.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.log('⚠️ Cannot send text message: invalid state');
      return;
    }

    console.log('📤 Sending text message:', text);

    // Add user transcription to local display
    if (onUserTranscriptionRef.current) {
      onUserTranscriptionRef.current(text);
    }

    // Send text as conversation item to OpenAI
    wsRef.current.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: text,
          }
        ]
      }
    }));

    // Request AI response
    wsRef.current.send(JSON.stringify({
      type: 'response.create',
      response: {
        modalities: ['audio', 'text'],
      },
    }));

    console.log('✅ Text message sent and response requested');
  }, []);

  useEffect(() => {
    if (enabled) {
      connect();
    }
    
    return () => {
      disconnect();
    };
  }, [enabled, connect, disconnect]);

  return {
    status,
    isRecording,
    isAISpeaking,
    connect,
    disconnect,
    startRecording,
    stopRecording,
    sendTextMessage,
    error,
  };
}
