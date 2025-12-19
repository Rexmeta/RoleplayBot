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
  onMessageComplete?: (message: string, emotion?: string, emotionReason?: string) => void;
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
  const playbackContextRef = useRef<AudioContext | null>(null); // For AI audio playback
  const captureContextRef = useRef<AudioContext | null>(null); // For microphone capture (with echo cancellation)
  const vadContextRef = useRef<AudioContext | null>(null); // For VAD capture (NO echo cancellation)
  const audioChunksRef = useRef<Blob[]>([]);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const vadProcessorRef = useRef<ScriptProcessorNode | null>(null); // VAD processor (no echo cancellation)
  const micStreamRef = useRef<MediaStream | null>(null);
  const rawMicStreamRef = useRef<MediaStream | null>(null); // Raw mic stream for VAD (no echo cancellation)
  const nextPlayTimeRef = useRef<number>(0); // Track when to play next chunk
  const aiMessageBufferRef = useRef<string>(''); // Buffer for AI message transcription
  const isRecordingRef = useRef<boolean>(false); // Ref for recording state (for closures)
  const scheduledSourcesRef = useRef<AudioBufferSourceNode[]>([]); // Track scheduled audio sources for interruption
  const isInterruptedRef = useRef<boolean>(false); // Flag to ignore audio after barge-in until new response
  const expectedTurnSeqRef = useRef<number>(0); // Expected turn sequence for audio filtering
  const voiceActivityStartRef = useRef<number | null>(null); // Timestamp when voice activity started
  const bargeInTriggeredRef = useRef<boolean>(false); // Flag to prevent multiple barge-in triggers
  const serverVoiceDetectedTimeRef = useRef<number | null>(null); // Timestamp when server detected user speaking
  const isAISpeakingRef = useRef<boolean>(false); // Ref for isAISpeaking state (for closures)
  const isAudioPausedRef = useRef<boolean>(false); // Track if AI audio is paused due to user speaking
  
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

  const getWebSocketUrl = useCallback((token: string) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/api/realtime-voice?conversationId=${conversationId}&scenarioId=${scenarioId}&personaId=${personaId}&token=${token}`;
  }, [conversationId, scenarioId, personaId]);

  const getRealtimeToken = useCallback(async (): Promise<string> => {
    // localStorage에 authToken이 있으면 사용
    const storedToken = localStorage.getItem('authToken');
    if (storedToken) {
      console.log('✅ Using stored auth token');
      return storedToken;
    }

    // localStorage에 없으면 realtime-token API 호출 (쿠키 기반 인증)
    console.log('🔑 No stored token, requesting realtime token...');
    try {
      const response = await fetch('/api/auth/realtime-token', {
        method: 'POST',
        credentials: 'include', // 쿠키 포함
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('인증 토큰을 가져올 수 없습니다. 다시 로그인해주세요.');
      }

      const data = await response.json();
      console.log('✅ Realtime token received, expires in:', data.expiresIn, 'seconds');
      return data.token;
    } catch (error) {
      console.error('❌ Failed to get realtime token:', error);
      throw new Error('인증 토큰을 가져올 수 없습니다. 다시 로그인해주세요.');
    }
  }, []);

  // Stop all scheduled audio playback immediately (for barge-in/interruption)
  const stopCurrentPlayback = useCallback(() => {
    console.log('🔇 Stopping current AI audio playback (barge-in)');
    
    // Set interrupted flag to ignore incoming audio chunks until new response
    isInterruptedRef.current = true;
    
    // Stop all scheduled audio sources
    for (const source of scheduledSourcesRef.current) {
      try {
        source.stop();
        source.disconnect();
      } catch (err) {
        // Source may have already finished playing
      }
    }
    scheduledSourcesRef.current = [];
    
    // Suspend and close playback AudioContext to immediately halt all audio
    // This ensures no queued audio chunks can play
    // Note: Only close playback context, keep capture context intact for microphone
    if (playbackContextRef.current && playbackContextRef.current.state !== 'closed') {
      try {
        // Suspend immediately stops all processing
        playbackContextRef.current.suspend();
        // Close and create fresh context for next playback
        playbackContextRef.current.close();
        playbackContextRef.current = null;
        console.log('🔇 Playback AudioContext closed to flush audio queue');
      } catch (err) {
        console.warn('Error closing playback AudioContext:', err);
      }
    }
    
    // Reset playback timing
    nextPlayTimeRef.current = 0;
    
    // Reset AI message buffer
    aiMessageBufferRef.current = '';
    
    setIsAISpeaking(false);
    isAISpeakingRef.current = false;
  }, []);

  const disconnect = useCallback(() => {
    // Stop any playing audio first
    stopCurrentPlayback();
    
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (playbackContextRef.current) {
      playbackContextRef.current.close();
      playbackContextRef.current = null;
    }
    if (captureContextRef.current) {
      captureContextRef.current.close();
      captureContextRef.current = null;
    }
    if (vadContextRef.current) {
      vadContextRef.current.close();
      vadContextRef.current = null;
    }
    // Stop raw microphone stream
    if (rawMicStreamRef.current) {
      rawMicStreamRef.current.getTracks().forEach(track => track.stop());
      rawMicStreamRef.current = null;
    }
    setStatus('disconnected');
    setIsRecording(false);
    setIsAISpeaking(false);
  }, [stopCurrentPlayback]);

  const connect = useCallback(async () => {
    setStatus('connecting');
    setError(null);

    try {
      // 토큰 가져오기 (localStorage 또는 realtime-token API)
      const token = await getRealtimeToken();
      console.log('🔑 Token obtained for WebSocket');
      
      const url = getWebSocketUrl(token);
      console.log('🌐 WebSocket URL:', url);
      
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
              // Reset server voice detection after transcription is complete
              serverVoiceDetectedTimeRef.current = null;
              break;
            
            // 🎙️ 서버에서 사용자 음성 감지 시작 (barge-in용)
            case 'user.speaking.started':
              console.log('🎙️ Server detected user speaking');
              if (serverVoiceDetectedTimeRef.current === null) {
                serverVoiceDetectedTimeRef.current = Date.now();
              }
              // Check for barge-in after 1.5 seconds
              if (isAISpeakingRef.current && !bargeInTriggeredRef.current) {
                setTimeout(() => {
                  // Double-check conditions after delay
                  if (isAISpeakingRef.current && !bargeInTriggeredRef.current && serverVoiceDetectedTimeRef.current !== null) {
                    const duration = Date.now() - serverVoiceDetectedTimeRef.current;
                    if (duration >= 1500) {
                      console.log('🎤 1.5-second voice detected by server - triggering barge-in');
                      bargeInTriggeredRef.current = true;
                      
                      // Stop current AI audio playback
                      stopCurrentPlayback();
                      
                      // Increment expected turn seq to ignore audio from cancelled turn
                      expectedTurnSeqRef.current++;
                      
                      // Send cancel signal to server
                      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                        wsRef.current.send(JSON.stringify({
                          type: 'response.cancel',
                        }));
                        console.log('📤 Sent response.cancel after 1.5-second voice detection');
                      }
                    }
                  }
                }, 1500);
              }
              break;

            // 🔊 오디오 재생
            case 'audio.delta':
              if (data.delta) {
                // Filter by turn sequence if provided
                if (data.turnSeq !== undefined && data.turnSeq <= expectedTurnSeqRef.current) {
                  console.log(`🔇 Ignoring old audio (turnSeq ${data.turnSeq} <= expected ${expectedTurnSeqRef.current})`);
                  break;
                }
                setIsAISpeaking(true);
                isAISpeakingRef.current = true;
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
              console.log('😊 Emotion:', data.emotion, '|', data.emotionReason);
              // 완전한 메시지와 감정 정보를 onMessageComplete로 전달
              if (data.text && onMessageCompleteRef.current) {
                onMessageCompleteRef.current(data.text, data.emotion, data.emotionReason);
              }
              // 버퍼 초기화
              aiMessageBufferRef.current = '';
              break;

            case 'response.done':
              console.log('✅ Response complete');
              setIsAISpeaking(false);
              isAISpeakingRef.current = false;
              // Do NOT reset interrupted flag here - wait for response.started from a genuine new turn
              break;

            case 'response.interrupted':
              console.log('⚡ Response interrupted (barge-in acknowledged)');
              setIsAISpeaking(false);
              isAISpeakingRef.current = false;
              // Keep interrupted flag true until user finishes speaking and new response starts
              break;

            case 'response.ready':
              // Server confirms previous turn complete, update expected turn seq
              console.log('🔊 Previous turn complete, clearing barge-in flag');
              isInterruptedRef.current = false;
              bargeInTriggeredRef.current = false; // Reset barge-in trigger for next interaction
              serverVoiceDetectedTimeRef.current = null; // Reset server voice detection
              if (data.turnSeq !== undefined) {
                expectedTurnSeqRef.current = data.turnSeq - 1; // Accept audio from this turn onwards
              }
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
  }, [enabled, getRealtimeToken, getWebSocketUrl, disconnect]);

  const playAudioDelta = useCallback(async (base64Audio: string) => {
    // Ignore audio chunks if interrupted (barge-in active)
    if (isInterruptedRef.current) {
      console.log('🔇 Ignoring audio chunk (barge-in active)');
      return;
    }
    
    try {
      if (!playbackContextRef.current) {
        playbackContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        nextPlayTimeRef.current = 0; // Reset play time
      }

      const audioContext = playbackContextRef.current;
      
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

      // Create AudioBuffer for Gemini's 24kHz output
      const audioBuffer = audioContext.createBuffer(1, float32.length, 24000);
      audioBuffer.getChannelData(0).set(float32);
      
      // Calculate when to play this chunk (sequential playback)
      const currentTime = audioContext.currentTime;
      const startTime = Math.max(currentTime, nextPlayTimeRef.current);
      
      // Play audio at scheduled time
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      
      // 발화 속도를 10% 느리게 설정 (0.9배 속도 - 더 자연스럽고 이해하기 쉬움)
      source.playbackRate.value = 0.9;
      
      source.connect(audioContext.destination);
      source.start(startTime);
      
      // Track source for potential interruption (barge-in)
      scheduledSourcesRef.current.push(source);
      
      // Clean up finished sources
      source.onended = () => {
        const index = scheduledSourcesRef.current.indexOf(source);
        if (index > -1) {
          scheduledSourcesRef.current.splice(index, 1);
        }
      };
      
      // Update next play time (current chunk start time + duration / playbackRate)
      nextPlayTimeRef.current = startTime + (audioBuffer.duration / 0.9);
      
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

    // Barge-in: If AI is speaking, interrupt it
    if (isAISpeaking) {
      console.log('🎤 User starting to speak - interrupting AI (barge-in)');
      
      // Stop audio playback immediately
      stopCurrentPlayback();
      
      // Send interrupt signal to server to cancel current AI response
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'response.cancel',
        }));
        console.log('📤 Sent response.cancel to server');
      }
    }

    try {
      // Single mic stream - shared between Gemini and VAD
      // Note: We use echo cancellation for clean audio, and VAD uses the same stream
      // since the separate rawStream approach had issues with browser mic access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 16000, // Gemini Live API expects 16kHz input
          echoCancellation: true,
          noiseSuppression: true,
        } 
      });
      
      micStreamRef.current = stream;
      console.log('🎙️ Created single mic stream for Gemini + VAD');

      // Create AudioContext for PCM16 conversion
      if (!captureContextRef.current) {
        captureContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }

      const audioContext = captureContextRef.current;
      const source = audioContext.createMediaStreamSource(stream);
      
      console.log(`🎙️ AudioContext sample rate: ${audioContext.sampleRate}Hz`);
      
      // VAD Processor: Uses same stream for voice activity detection
      const vadProcessor = audioContext.createScriptProcessor(4096, 1, 1);
      vadProcessorRef.current = vadProcessor;
      
      vadProcessor.onaudioprocess = (e) => {
        if (!isRecordingRef.current) return;
        
        const inputData = e.inputBuffer.getChannelData(0);
        
        // Calculate RMS for voice activity detection
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);
        const VOICE_THRESHOLD = 0.003; // Lower threshold to detect voice reliably
        
        // Check if playback AudioContext is actually running (more reliable than isAISpeakingRef)
        const isPlaybackRunning = playbackContextRef.current?.state === 'running';
        
        // Debug logging
        if (Math.random() < 0.08) {
          console.log(`🔊 RAW-VAD: RMS=${rms.toFixed(4)}, threshold=${VOICE_THRESHOLD}, playbackRunning=${isPlaybackRunning}, audioPaused=${isAudioPausedRef.current}`);
        }
        
        if (rms > VOICE_THRESHOLD) {
          // User is speaking - cancel AI response immediately (only once per barge-in)
          if (!bargeInTriggeredRef.current && isPlaybackRunning) {
            console.log('🎤 User speaking detected - triggering barge-in (cancel AI response)');
            bargeInTriggeredRef.current = true;
            
            // 1. Stop current audio playback and clear buffer
            stopCurrentPlayback();
            
            // 2. Increment expected turn seq to ignore any remaining audio from old response
            expectedTurnSeqRef.current++;
            console.log(`📊 Expected turn seq incremented to ${expectedTurnSeqRef.current}`);
            
            // 3. Send response.cancel to server to stop Gemini from generating more audio
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({
                type: 'response.cancel',
              }));
              console.log('📤 Sent response.cancel to interrupt AI response');
            }
          }
          
          // Track voice activity start for logging
          if (voiceActivityStartRef.current === null) {
            voiceActivityStartRef.current = Date.now();
          }
        } else {
          // User stopped speaking - reset barge-in flag for next interruption
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
      
      // Main Audio Processor: Uses processed stream for Gemini
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      audioProcessorRef.current = processor;
      
      processor.onaudioprocess = (e) => {
        if (!isRecordingRef.current) return;
        
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          return;
        }

        const inputData = e.inputBuffer.getChannelData(0);
        
        // Resample to 16kHz for Gemini Live API
        const targetSampleRate = 16000;
        const sourceSampleRate = audioContext.sampleRate;
        const ratio = sourceSampleRate / targetSampleRate;
        const targetLength = Math.floor(inputData.length / ratio);
        const resampledData = new Float32Array(targetLength);
        
        for (let i = 0; i < targetLength; i++) {
          const sourceIndex = Math.floor(i * ratio);
          resampledData[i] = inputData[sourceIndex];
        }
        
        // Convert Float32 to Int16 (PCM16)
        const pcm16 = new Int16Array(resampledData.length);
        for (let i = 0; i < resampledData.length; i++) {
          const s = Math.max(-1, Math.min(1, resampledData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        
        // Convert to base64 and send
        const uint8Array = new Uint8Array(pcm16.buffer);
        let binaryString = '';
        for (let i = 0; i < uint8Array.length; i++) {
          binaryString += String.fromCharCode(uint8Array[i]);
        }
        const base64 = btoa(binaryString);
        
        wsRef.current.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: base64,
        }));
        
        if (Math.random() < 0.1) {
          console.log('🎤 Sending audio chunk:', pcm16.length, 'samples');
        }
      };
      
      source.connect(processor);
      const dummyGain = audioContext.createGain();
      dummyGain.gain.value = 0;
      processor.connect(dummyGain);
      dummyGain.connect(audioContext.destination);
      
      setIsRecording(true);
      isRecordingRef.current = true; // Update ref for onaudioprocess callback
      console.log('🎤 Recording started (PCM16 16kHz for Gemini)');
    } catch (err) {
      console.error('Error starting recording:', err);
      setError('Microphone access denied');
      if (onErrorRef.current) {
        onErrorRef.current('Microphone access denied');
      }
    }
  }, [status, isAISpeaking, stopCurrentPlayback]);

  const stopRecording = useCallback(() => {
    console.log('🎤 Stopping recording...');
    
    // Reset voice activity tracking
    voiceActivityStartRef.current = null;
    bargeInTriggeredRef.current = false;
    isAudioPausedRef.current = false;
    
    // Resume audio if it was paused
    if (playbackContextRef.current && playbackContextRef.current.state === 'suspended') {
      playbackContextRef.current.resume().catch(() => {});
    }
    
    // Stop sending audio first
    setIsRecording(false);
    isRecordingRef.current = false; // Update ref to stop onaudioprocess
    
    // Small delay to ensure last audio chunks are sent
    setTimeout(() => {
      // Disconnect audio processor
      if (audioProcessorRef.current) {
        audioProcessorRef.current.disconnect();
        audioProcessorRef.current = null;
      }
      
      // Disconnect VAD processor
      if (vadProcessorRef.current) {
        vadProcessorRef.current.disconnect();
        vadProcessorRef.current = null;
      }
      
      // Stop microphone stream
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach(track => track.stop());
        micStreamRef.current = null;
      }
      
      // Stop raw microphone stream (VAD)
      if (rawMicStreamRef.current) {
        rawMicStreamRef.current.getTracks().forEach(track => track.stop());
        rawMicStreamRef.current = null;
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

    // Send text as conversation item to Gemini
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
