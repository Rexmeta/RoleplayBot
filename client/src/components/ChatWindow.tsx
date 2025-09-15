import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Card } from "@/components/ui/card";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Link, useLocation } from "wouter";
import type { ComplexScenario, ScenarioPersona } from "@/lib/scenario-system";
import type { Conversation, ConversationMessage } from "@shared/schema";

// 감정별 캐릭터 이미지 import
import characterNeutral from "../../../attached_assets/characters/character-neutral.png";
import characterJoy from "../../../attached_assets/characters/character-joy.png";
import characterSad from "../../../attached_assets/characters/character-sad.png";
import characterAngry from "../../../attached_assets/characters/character-angry.png";
import characterSurprise from "../../../attached_assets/characters/character-surprise.png";

// 모든 캐릭터 이미지 매핑
const characterImages = {
  '중립': characterNeutral,
  '기쁨': characterJoy,
  '슬픔': characterSad,
  '분노': characterAngry,
  '놀람': characterSurprise
};

// Web Speech API 타입 확장
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

// 감정 이모지 매핑
const emotionEmojis: { [key: string]: string } = {
  '기쁨': '😊',
  '슬픔': '😢',
  '분노': '😠',
  '놀람': '😲',
  '중립': '😐'
};

// 경과 시간 포맷팅 함수
const formatElapsedTime = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

interface ChatWindowProps {
  scenario: ComplexScenario;
  persona: ScenarioPersona;
  conversationId: string;
  onChatComplete: () => void;
  onExit: () => void;
}

export default function ChatWindow({ scenario, persona, conversationId, onChatComplete, onExit }: ChatWindowProps) {
  const [location, setLocation] = useLocation();
  const [userInput, setUserInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [voiceModeEnabled, setVoiceModeEnabled] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [conversationStartTime, setConversationStartTime] = useState<Date | null>(null);
  const [localMessages, setLocalMessages] = useState<ConversationMessage[]>([]);
  const [chatMode, setChatMode] = useState<'messenger' | 'character'>('messenger');
  const [showInputMode, setShowInputMode] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isEmotionTransitioning, setIsEmotionTransitioning] = useState(false);
  const [imagesLoaded, setImagesLoaded] = useState<{[key: string]: boolean}>({});
  const [currentEmotion, setCurrentEmotion] = useState<string>('중립');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const speechSynthesisRef = useRef<SpeechSynthesis | null>(null);
  const lastSpokenMessageRef = useRef<string>("");
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentAudioUrlRef = useRef<string | null>(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  // 이미지 프리로딩 및 전환 초기화
  useEffect(() => {
    const preloadImages = async () => {
      const loadPromises = Object.entries(characterImages).map(([emotion, src]) => {
        return new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            setImagesLoaded(prev => ({ ...prev, [emotion]: true }));
            resolve();
          };
          img.onerror = () => {
            console.warn(`Failed to preload image for emotion: ${emotion}`);
            setImagesLoaded(prev => ({ ...prev, [emotion]: false }));
            resolve(); // Continue even if one image fails
          };
          img.src = src;
        });
      });
      
      await Promise.all(loadPromises);
      console.log('🎨 모든 캐릭터 이미지 프리로딩 완료');
    };
    
    preloadImages();
  }, []);

  const maxTurns = 10;

  const { data: conversation, error } = useQuery<Conversation>({
    queryKey: ["/api/conversations", conversationId],
    enabled: !!conversationId,
  });

  // 대화 시작 시간 설정 및 타이머 효과
  useEffect(() => {
    if (conversation && conversation.createdAt && !conversationStartTime) {
      setConversationStartTime(new Date(conversation.createdAt));
    }
  }, [conversation, conversationStartTime]);

  // 경과 시간 업데이트 타이머
  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    // 대화가 완료되었으면 타이머 정지
    if (conversationStartTime && conversation && conversation.turnCount < maxTurns) {
      interval = setInterval(() => {
        const now = new Date();
        const elapsed = Math.floor((now.getTime() - conversationStartTime.getTime()) / 1000);
        setElapsedTime(elapsed);
      }, 1000);
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [conversationStartTime, conversation]);

  const sendMessageMutation = useMutation({
    mutationFn: async (message: string) => {
      const response = await apiRequest("POST", `/api/conversations/${conversationId}/messages`, {
        message
      });
      return response.json();
    },
    onSuccess: (data) => {
      // AI 응답만 로컬 메시지에 추가
      if (data.messages && data.messages.length > 0) {
        const latestMessage = data.messages[data.messages.length - 1];
        if (latestMessage.sender === 'ai') {
          setLocalMessages(prev => [...prev, latestMessage]);
        }
      }
      
      // 서버 데이터 동기화는 별도로 처리
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversationId] });
      setIsLoading(false);
    },
    onError: () => {
      // 오류 시 사용자 메시지 제거
      setLocalMessages(prev => {
        if (prev.length > 0 && prev[prev.length - 1].sender === 'user') {
          return prev.slice(0, -1);
        }
        return prev;
      });
      
      toast({
        title: "오류",
        description: "메시지를 전송할 수 없습니다. 다시 시도해주세요.",
        variant: "destructive"
      });
      setIsLoading(false);
    }
  });

  const handleSendMessage = () => {
    const message = userInput.trim();
    if (!message || isLoading) return;

    // 사용자 메시지를 즉시 로컬 상태에 추가
    const userMessage: ConversationMessage = {
      sender: 'user',
      message: message,
      timestamp: new Date().toISOString()
    };
    
    setLocalMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setUserInput("");
    setShowInputMode(false); // 메시지 전송 후 입력창 숨기기
    
    // API 호출은 별도로 진행
    sendMessageMutation.mutate(message);
  };

  const handleSkipTurn = () => {
    if (isLoading) return;
    
    // 건너뛰기: 빈 메시지로 AI 응답 유도
    setIsLoading(true);
    setShowInputMode(false); // Skip 후 입력창 숨기기
    sendMessageMutation.mutate("");
  };

  const handleVoiceInput = () => {
    if (!speechSupported) {
      toast({
        title: "음성 인식 미지원",
        description: "현재 브라우저에서는 음성 인식을 지원하지 않습니다.",
        variant: "destructive"
      });
      return;
    }

    if (isRecording) {
      recognitionRef.current?.stop();
      toast({
        title: "음성 입력 완료",
        description: "음성이 텍스트로 변환되었습니다.",
      });
    } else {
      try {
        recognitionRef.current?.start();
        toast({
          title: "음성 입력 시작",
          description: "말씀하세요. 완료 후 다시 클릭하여 계속 추가할 수 있습니다.",
        });
      } catch (error) {
        console.error('음성 인식 시작 실패:', error);
        toast({
          title: "음성 입력 오류",
          description: "음성 인식을 시작할 수 없습니다. 다시 시도해주세요.",
          variant: "destructive"
        });
      }
    }
  };

  // 페르소나별 성별 정보
  const getPersonaGender = (scenarioId: string): 'male' | 'female' => {
    const femalePersonas = ['empathy', 'presentation', 'crisis']; // 이선영, 정미경, 한지연
    return femalePersonas.includes(scenarioId) ? 'female' : 'male';
  };

  // 감정에 따른 음성 설정
  const getVoiceSettings = (emotion: string = '중립', gender: 'male' | 'female' = 'male') => {
    const baseSettings = {
      lang: 'ko-KR',
      volume: 0.8,
    };

    // 성별에 따른 기본 설정
    const genderSettings = gender === 'female' 
      ? { rate: 0.95, pitch: 1.2 }  // 여성: 약간 빠르고 높은 음조
      : { rate: 0.85, pitch: 0.8 }; // 남성: 약간 느리고 낮은 음조

    // 감정에 따른 추가 조정
    const emotionAdjustments: Record<string, { rate: number; pitch: number }> = {
      '기쁨': { rate: genderSettings.rate + 0.1, pitch: genderSettings.pitch + 0.1 },
      '슬픔': { rate: genderSettings.rate - 0.15, pitch: genderSettings.pitch - 0.2 },
      '분노': { rate: genderSettings.rate + 0.05, pitch: genderSettings.pitch - 0.1 },
      '놀람': { rate: genderSettings.rate + 0.2, pitch: genderSettings.pitch + 0.2 },
      '중립': genderSettings
    };

    return {
      ...baseSettings,
      ...(emotionAdjustments[emotion] || genderSettings)
    };
  };

  // ElevenLabs TTS 기능들
  const speakMessage = async (text: string, isAutoPlay: boolean = false, emotion?: string) => {
    // 음성 모드가 꺼져있고 자동재생인 경우 실행하지 않음
    if (!voiceModeEnabled && isAutoPlay) return;
    
    // 이미 같은 메시지를 재생했다면 중복 재생 방지 (자동재생의 경우만)
    if (isAutoPlay && lastSpokenMessageRef.current === text) return;
    
    // 기존 오디오 정지
    stopSpeaking();
    
    try {
      setIsSpeaking(true);
      
      console.log(`🎤 ElevenLabs TTS 요청: ${persona.name}, 감정: ${emotion}`);
      
      // ElevenLabs API 호출
      const response = await fetch('/api/tts/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text,
          scenarioId: persona.id,
          emotion: emotion || '중립'
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || 'TTS 생성 실패');
      }

      const data = await response.json();
      
      // TTS 제공자 정보 로깅
      console.log(`🎵 TTS 제공자: ${data.metadata?.provider || 'unknown'}`);
      
      // Base64 오디오 데이터를 Blob으로 변환
      const audioBlob = new Blob(
        [Uint8Array.from(atob(data.audio), c => c.charCodeAt(0))], 
        { type: 'audio/mpeg' }
      );
      
      // 오디오 URL 생성 및 재생
      const audioUrl = URL.createObjectURL(audioBlob);
      currentAudioUrlRef.current = audioUrl; // URL 추적 (메모리 누수 방지)
      const audio = new Audio(audioUrl);
      currentAudioRef.current = audio;
      
      audio.onended = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl); // 메모리 정리
        currentAudioRef.current = null;
        currentAudioUrlRef.current = null;
      };
      
      audio.onerror = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
        currentAudioRef.current = null;
        currentAudioUrlRef.current = null;
        toast({
          title: "음성 재생 오류",
          description: "오디오 재생에 실패했습니다.",
          variant: "destructive"
        });
      };

      // 재생 추적
      if (isAutoPlay) {
        lastSpokenMessageRef.current = text;
      }
      
      await audio.play();
      
    } catch (error) {
      setIsSpeaking(false);
      console.error('ElevenLabs TTS 오류:', error);
      
      // 백업: Web Speech API 사용
      console.log('백업 TTS 사용 중...');
      try {
        await fallbackToWebSpeechAPI(text, emotion);
      } catch (fallbackError) {
        console.error('백업 TTS도 실패:', fallbackError);
        // 자동재생이 아닌 경우에만 오류 메시지 표시
        if (!isAutoPlay) {
          toast({
            title: "음성 서비스 오류",
            description: "음성 재생이 일시적으로 불가능합니다.",
            variant: "destructive"
          });
        }
      }
    }
  };

  // 백업 TTS (기존 Web Speech API)
  const fallbackToWebSpeechAPI = async (text: string, emotion?: string) => {
    console.log('🔧 fallbackToWebSpeechAPI 시작');
    
    if (!speechSynthesisRef.current) {
      console.error('❌ speechSynthesisRef.current가 null입니다');
      return;
    }
    
    console.log('✅ speechSynthesis 사용 가능:', !!speechSynthesisRef.current);
    
    speechSynthesisRef.current.cancel();
    
    const cleanText = text.replace(/<[^>]*>/g, '').replace(/[*#_`]/g, '');
    console.log('🎯 정리된 텍스트:', cleanText.substring(0, 50) + '...');
    
    const gender = getPersonaGender(scenario.id);
    const voiceSettings = getVoiceSettings(emotion, gender);
    console.log('🔊 음성 설정:', voiceSettings);
    
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = voiceSettings.lang;
    utterance.rate = voiceSettings.rate;
    utterance.pitch = voiceSettings.pitch;
    utterance.volume = voiceSettings.volume;
    
    console.log('📢 utterance 생성 완료:', {
      lang: utterance.lang,
      rate: utterance.rate,
      pitch: utterance.pitch,
      volume: utterance.volume,
      text: utterance.text.substring(0, 50) + '...'
    });
    
    utterance.onstart = () => {
      console.log('🎤 음성 재생 시작');
      setIsSpeaking(true);
    };
    
    utterance.onend = () => {
      console.log('✅ 음성 재생 완료');
      setIsSpeaking(false);
    };
    
    utterance.onerror = (event) => {
      console.error('❌ 음성 재생 오류:', event);
      setIsSpeaking(false);
      toast({
        title: "음성 재생 오류",
        description: "음성을 재생할 수 없습니다.",
        variant: "destructive"
      });
    };
    
    console.log('🚀 speechSynthesis.speak() 호출 중...');
    speechSynthesisRef.current.speak(utterance);
    
    // 음성 목록 확인
    const voices = speechSynthesisRef.current.getVoices();
    console.log('🎵 사용 가능한 음성 수:', voices.length);
    if (voices.length > 0) {
      console.log('🎵 첫 번째 음성:', voices[0].name, voices[0].lang);
    }
  };

  const stopSpeaking = () => {
    // ElevenLabs 오디오 정지
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
    }
    
    // 오디오 URL 정리 (메모리 누수 방지)
    if (currentAudioUrlRef.current) {
      URL.revokeObjectURL(currentAudioUrlRef.current);
      currentAudioUrlRef.current = null;
    }
    
    // 백업 Web Speech API 정지
    if (speechSynthesisRef.current) {
      speechSynthesisRef.current.cancel();
    }
    
    setIsSpeaking(false);
  };

  const toggleVoiceMode = () => {
    if (voiceModeEnabled) {
      stopSpeaking();
      lastSpokenMessageRef.current = ""; // 음성 모드 끌 때 재생 기록 초기화
    } else {
      // 음성 모드를 켤 때 최신 AI 메시지만 재생
      if (conversation?.messages) {
        const lastMessage = conversation.messages[conversation.messages.length - 1];
        if (lastMessage && lastMessage.sender === 'ai') {
          // 최신 메시지를 이미 재생했다고 표시하여 중복 재생 방지
          lastSpokenMessageRef.current = lastMessage.message;
          // 약간의 지연을 두어 UI 업데이트 후 음성 재생
          setTimeout(() => {
            speakMessage(lastMessage.message, false, lastMessage.emotion);
          }, 300);
        }
      }
    }
    setVoiceModeEnabled(!voiceModeEnabled);
  };

  // TTS 기능 초기화 및 음성 목록 확인
  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      speechSynthesisRef.current = window.speechSynthesis;
      
      // 사용 가능한 음성 목록 로깅 (디버깅용)
      const logAvailableVoices = () => {
        const voices = speechSynthesisRef.current?.getVoices() || [];
        console.log('사용 가능한 TTS 음성 목록:');
        voices.forEach((voice, index) => {
          console.log(`${index + 1}. ${voice.name} (${voice.lang})`);
        });
        
        const koreanVoices = voices.filter(voice => voice.lang.includes('ko'));
        console.log('한국어 음성:', koreanVoices.length, '개');
        koreanVoices.forEach(voice => {
          console.log(`- ${voice.name} (${voice.lang})`);
        });
      };
      
      // 음성 목록이 로드될 때까지 기다림
      if (speechSynthesisRef.current.getVoices().length === 0) {
        speechSynthesisRef.current.addEventListener('voiceschanged', logAvailableVoices);
      } else {
        logAvailableVoices();
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        setSpeechSupported(true);
        const recognition = new SpeechRecognition();
        recognition.continuous = false;  // 단일 음성 입력으로 변경
        recognition.interimResults = true;  // 중간 결과 표시 활성화
        recognition.lang = 'ko-KR';
        recognition.maxAlternatives = 1;
        
        recognition.onstart = () => {
          setIsRecording(true);
        };

        recognition.onresult = (event: any) => {
          const result = event.results[0];
          const transcript = result[0].transcript;
          
          if (result.isFinal) {
            // final 결과: 기존 텍스트에 추가
            setUserInput(prev => {
              const currentText = prev.replace(/\[음성 입력 중\.\.\.\].*$/, '').trim();
              return currentText + (currentText ? ' ' : '') + transcript.trim();
            });
          } else {
            // interim 결과: 임시 표시
            setUserInput(prev => {
              const currentText = prev.replace(/\[음성 입력 중\.\.\.\].*$/, '').trim();
              return currentText + (currentText ? ' ' : '') + `[음성 입력 중...] ${transcript.trim()}`;
            });
          }
        };

        recognition.onerror = (event: any) => {
          console.error('Speech recognition error:', event.error);
          setIsRecording(false);
          
          // 특정 오류에 대한 맞춤형 메시지
          let errorMessage = "음성을 인식할 수 없습니다. 다시 시도해주세요.";
          if (event.error === 'no-speech') {
            errorMessage = "음성이 감지되지 않았습니다. 마이크를 확인하고 다시 시도해주세요.";
          } else if (event.error === 'not-allowed') {
            errorMessage = "마이크 권한이 거부되었습니다. 브라우저 설정에서 마이크 권한을 허용해주세요.";
          } else if (event.error === 'network') {
            errorMessage = "네트워크 오류로 음성 인식에 실패했습니다.";
          }
          
          toast({
            title: "음성 인식 오류",
            description: errorMessage,
            variant: "destructive"
          });
          
          // 임시 텍스트 제거
          setUserInput(prev => prev.replace(/\[음성 입력 중\.\.\.\].*$/, '').trim());
        };

        recognition.onend = () => {
          setIsRecording(false);
          // 음성 입력 종료 시 임시 표시 제거
          setUserInput(prev => prev.replace(/\[음성 입력 중\.\.\.\].*$/, '').trim());
        };

        recognitionRef.current = recognition;
      } else {
        setSpeechSupported(false);
      }
    }
  }, [toast]);

  // 로컬 메시지와 서버 메시지 동기화
  useEffect(() => {
    if (conversation?.messages) {
      setLocalMessages(conversation.messages);
    }
  }, [conversation?.messages]);

  // 자동 스크롤 기능
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'end' 
      });
    }
  }, [localMessages]);

  // 음성 자동 재생
  useEffect(() => {
    // 음성 모드가 켜져 있을 때 새로운 AI 메시지 자동 재생
    if (voiceModeEnabled && localMessages.length > 0) {
      const lastMessage = localMessages[localMessages.length - 1];
      if (lastMessage && lastMessage.sender === 'ai' && !isLoading) {
        // 약간의 지연을 두어 UI 업데이트 후 음성 재생
        setTimeout(() => {
          speakMessage(lastMessage.message, true, lastMessage.emotion);
        }, 500);
      }
    }
  }, [localMessages, voiceModeEnabled, isLoading]);

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === "Enter" && e.ctrlKey) {
        handleSendMessage();
      }
    };

    document.addEventListener("keypress", handleKeyPress);
    return () => document.removeEventListener("keypress", handleKeyPress);
  }, [userInput, isLoading]);

  // 최신 AI 메시지 찾기 (캐릭터 모드용) - hooks 순서 보장을 위해 early return 이전에 위치
  const latestAiMessage = localMessages.slice().reverse().find(msg => msg.sender === 'ai');
  
  // 감정 변화 감지 및 전환 처리 - hooks 순서 보장을 위해 early return 이전에 위치
  useEffect(() => {
    const newEmotion = latestAiMessage?.emotion || '중립';
    
    // 감정이 변경되었을 때만 처리
    if (newEmotion !== currentEmotion) {
      if (chatMode === 'character') {
        // 캐릭터 모드에서는 부드러운 배경 전환 (모드 전환과 분리된 상태 사용)
        setIsEmotionTransitioning(true);
        
        // 즉시 새로운 감정으로 업데이트하고 짧은 전환 효과만 적용
        setCurrentEmotion(newEmotion);
        
        // 짧은 전환 효과만 적용 (200ms)
        const transitionTimeout = setTimeout(() => {
          setIsEmotionTransitioning(false);
        }, 200);
        
        // cleanup 함수에서 timeout 정리
        return () => {
          clearTimeout(transitionTimeout);
        };
      } else {
        // 메신저 모드에서는 즉시 업데이트
        setCurrentEmotion(newEmotion);
      }
    }
  }, [latestAiMessage?.emotion, currentEmotion, chatMode]);

  // 컴포넌트 언마운트 시 리소스 정리 (메모리 누수 방지)
  useEffect(() => {
    return () => {
      // 오디오 정리
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
      
      // 오디오 URL 정리
      if (currentAudioUrlRef.current) {
        URL.revokeObjectURL(currentAudioUrlRef.current);
        currentAudioUrlRef.current = null;
      }
      
      // 음성 인식 정리
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      
      // 음성 합성 정리
      if (speechSynthesisRef.current) {
        speechSynthesisRef.current.cancel();
        speechSynthesisRef.current = null;
      }
    };
  }, []);

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-600">대화를 불러올 수 없습니다.</p>
        <Button onClick={onExit} className="mt-4">
          시나리오 선택으로 돌아가기
        </Button>
      </div>
    );
  }

  if (!conversation) {
    return <div className="text-center py-8">로딩 중...</div>;
  }

  // 과학적 실시간 스코어링 시스템 (ComOn Check 연구 기반)
  const calculateRealTimeScore = () => {
    const messages = localMessages;
    const userMessages = messages.filter(m => m.sender === "user");
    
    if (userMessages.length === 0) return 0;
    
    let totalScore = 0;
    let scoreCount = 0;
    
    // 각 사용자 메시지에 대한 실시간 평가
    userMessages.forEach((message, index) => {
      let messageScore = 0;
      const content = message.message.toLowerCase();
      
      // 1. 명확성 & 논리성 (20점 만점)
      if (content.length >= 20) messageScore += 4; // 적절한 길이
      if (content.includes('?') || content.includes('요청') || content.includes('문의')) messageScore += 4; // 질문/요청 구조
      if (content.split('.').length > 1 || content.split(',').length > 1) messageScore += 4; // 문장 구조
      if (!/^[ㄱ-ㅎ가-힣a-zA-Z\s]+$/.test(content.replace(/[.?!,]/g, ''))) messageScore -= 4; // 이상한 문자 패턴 감점
      if (content.length < 5) messageScore -= 8; // 너무 짧은 메시지 대폭 감점
      
      // 2. 경청 & 공감 (20점 만점)
      const empathyKeywords = ['이해', '죄송', '미안', '걱정', '힘드', '어려우', '도움', '지원', '함께', '경청', '재진술', '요약'];
      const empathyCount = empathyKeywords.filter(keyword => content.includes(keyword)).length;
      messageScore += Math.min(20, empathyCount * 4);
      
      // 3. 적절성 & 상황 대응 (20점 만점)
      if (content.includes('습니다') || content.includes('입니다')) messageScore += 8; // 정중한 어투
      if (content.includes('~요') || content.includes('~네요')) messageScore += 4; // 친근한 어투
      if (content.includes('제가') || content.includes('저는')) messageScore += 4; // 주체 명확성
      if (content.includes('상황') || content.includes('맥락')) messageScore += 4; // 상황 인식
      
      // 4. 설득력 & 영향력 (20점 만점)
      const persuasionKeywords = ['근거', '사례', '데이터', '비유', '예를들어', '결론적으로', '따라서', '그러므로'];
      const persuasionCount = persuasionKeywords.filter(keyword => content.includes(keyword)).length;
      messageScore += Math.min(20, persuasionCount * 4);
      
      // 5. 전략적 커뮤니케이션 (20점 만점)
      const scenarioKeywords: Record<string, string[]> = {
        'communication': ['보고', '전달', '설명'],
        'empathy': ['공감', '이해', '위로'],
        'negotiation': ['협상', '조정', '타협'],
        'presentation': ['발표', '설명', '제시'],
        'feedback': ['피드백', '조언', '개선'],
        'crisis': ['긴급', '대응', '해결']
      };
      
      const strategicKeywords = ['목표', '계획', '방안', '전략', '조율', '협상', '주도', '질문', '피드백'];
      const strategicCount = strategicKeywords.filter(keyword => content.includes(keyword)).length;
      messageScore += Math.min(20, strategicCount * 4);
      
      // 대화 진행에 따른 가중치 적용
      const progressWeight = 1 + (index * 0.1); // 후반으로 갈수록 가중치 증가
      messageScore = Math.min(100, messageScore * progressWeight);
      
      totalScore += Math.max(0, messageScore);
      scoreCount++;
    });
    
    return scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0;
  };

  const currentScore = calculateRealTimeScore();
  const progressPercentage = (conversation.turnCount / maxTurns) * 100;

  // 캐릭터 모드 전환 처리
  const handleCharacterModeTransition = () => {
    setIsTransitioning(true);
    
    // 짧은 딩레이로 전환 시작
    setTimeout(() => {
      setChatMode('character');
      setTimeout(() => {
        setIsTransitioning(false);
      }, 300); // Character mode 로딩 시간
    }, 200);
  };
  
  // 감정별 이미지 매핑
  const getEmotionImage = (emotion?: string) => {
    const targetEmotion = emotion || '중립';
    const validEmotions = ['중립', '기쁨', '슬픔', '분노', '놀람'];
    const safeEmotion = validEmotions.includes(targetEmotion) ? targetEmotion : '중립';
    return characterImages[safeEmotion as keyof typeof characterImages];
  };

  return (
    <div className="chat-window">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Chat Header */}
        <div className="bg-gradient-to-r from-corporate-600 to-corporate-700 px-6 py-4 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button 
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  console.log("페르소나 이미지 클릭됨");
                  console.log("현재 위치:", location);
                  try {
                    console.log("onExit 함수 직접 호출");
                    onExit(); // 시나리오 선택 화면으로 돌아가기
                  } catch (error) {
                    console.error("onExit 오류:", error);
                    // 최후 수단: 브라우저 새로고침
                    window.location.reload();
                  }
                }}
                className="hover:opacity-80 transition-opacity bg-transparent border-none" 
                data-testid="chat-header-home-link"
              >
                <img 
                  src={persona.image} 
                  alt={persona.name} 
                  className="w-12 h-12 rounded-full border-2 border-white/20 hover:border-white/40 cursor-pointer" 
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(persona.name)}&background=6366f1&color=fff&size=48`;
                  }}
                />
              </button>
              <div>
                <button 
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log("제목 클릭됨");
                    try {
                      console.log("제목에서 onExit 함수 직접 호출");
                      onExit(); // 시나리오 선택 화면으로 돌아가기
                    } catch (error) {
                      console.error("제목에서 onExit 오류:", error);
                      window.location.reload();
                    }
                  }}
                  className="hover:opacity-90 transition-opacity cursor-pointer text-left bg-transparent border-none" 
                  data-testid="chat-title-home-link"
                >
                  <h3 className="text-lg font-semibold">{persona.name}과의 대화</h3>
                  <p className="text-blue-100 text-sm">{persona.role} · {persona.department} · {scenario.title}</p>
                </button>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              {/* 경과 시간 표시 */}
              <div className="text-right">
                <div className="text-sm opacity-90">경과 시간</div>
                <div className="text-xl font-bold" data-testid="elapsed-time">
                  {formatElapsedTime(elapsedTime)}
                </div>
              </div>
              
              <div className="text-right">
                <div className="text-sm opacity-90">진행도</div>
                <div className="text-xl font-bold">{conversation.turnCount}/{maxTurns}</div>
              </div>
              
              
              {/* 채팅 모드 선택 */}
              <div className="flex items-center space-x-2">
                <ToggleGroup
                  type="single"
                  value={chatMode}
                  onValueChange={(value: 'messenger' | 'character') => {
                    if (value && !isTransitioning) {
                      if (value === 'character') {
                        handleCharacterModeTransition();
                      } else {
                        setChatMode(value);
                      }
                    }
                  }}
                  className="bg-white/10 rounded-lg p-1"
                  data-testid="toggle-chat-mode"
                >
                  <ToggleGroupItem 
                    value="messenger" 
                    className="text-white/80 hover:text-white data-[state=on]:bg-white/20 data-[state=on]:text-white px-2 py-1 text-xs"
                    data-testid="mode-messenger"
                  >
                    메신저
                  </ToggleGroupItem>
                  <ToggleGroupItem 
                    value="character" 
                    className="text-white/80 hover:text-white data-[state=on]:bg-white/20 data-[state=on]:text-white px-2 py-1 text-xs"
                    data-testid="mode-character"
                  >
                    캐릭터
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>

              {/* 음성 모드 토글 */}
              <div className="relative group">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={toggleVoiceMode}
                  className={`text-white/80 hover:text-white hover:bg-white/10 ${voiceModeEnabled ? 'bg-white/20' : ''}`}
                  data-testid="button-toggle-voice-mode"
                  title={voiceModeEnabled ? "음성 모드 끄기" : "음성 모드 켜기"}
                >
                  <i className={`fas ${voiceModeEnabled ? 'fa-volume-up' : 'fa-volume-mute'}`}></i>
                  {voiceModeEnabled && isSpeaking && (
                    <span className="ml-1 text-xs animate-pulse">재생중</span>
                  )}
                </Button>
                
                {/* 음성 기능 정보 툴팁 */}
                <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-slate-200 rounded-lg shadow-lg p-4 text-sm text-slate-600 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                  <div className="font-semibold text-slate-800 mb-2 flex items-center">
                    🎤 <span className="ml-1">음성 기능 정보</span>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <strong className="text-slate-700">현재 상태:</strong> 
                      <span className={`ml-1 ${voiceModeEnabled ? 'text-green-600' : 'text-gray-500'}`}>
                        {voiceModeEnabled ? '활성화됨' : '비활성화됨'}
                      </span>
                    </div>
                    
                    <div>
                      <strong className="text-slate-700">🎉 커스텀 TTS 기능:</strong>
                      <ul className="ml-3 mt-1 text-xs space-y-1 text-green-600">
                        <li>✓ XTTS-v2 기반 고품질 음성 합성</li>
                        <li>✓ 페르소나별 전용 스피커 음성 (5가지)</li>
                        <li>✓ 실감나는 감정 표현 및 톤 조절</li>
                        <li>✓ 자연스러운 한국어 발음</li>
                        <li>✓ 이중 백업 시스템 (ElevenLabs + Web Speech)</li>
                      </ul>
                    </div>
                    
                    <div>
                      <strong className="text-slate-700">페르소나 음성 매핑:</strong>
                      <ul className="ml-3 mt-1 text-xs space-y-1 text-slate-600">
                        <li>• 김태훈 (남성): 전문적이고 안정적인 목소리</li>
                        <li>• 이선영 (여성): 따뜻하고 공감적인 목소리</li>
                        <li>• 박준호 (남성): 자신감 있고 강인한 목소리</li>
                        <li>• 정미경 (여성): 전문적이고 명확한 목소리</li>
                        <li>• 최민수 (남성): 젊고 친근한 목소리</li>
                      </ul>
                    </div>
                    
                    <div className="text-xs bg-blue-50 p-2 rounded border-l-2 border-blue-300">
                      <strong className="text-blue-700">🚀 최신 기술:</strong>
                      <br />Google Colab XTTS-v2 서버 연동! 실제 성우와 같은 자연스럽고 개성 있는 음성을 경험하세요.
                    </div>
                  </div>
                </div>
              </div>
              
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={onExit}
                className="text-white/80 hover:text-white hover:bg-white/10"
                data-testid="button-exit-chat"
              >
                <i className="fas fa-times"></i>
              </Button>
            </div>
          </div>
          
          {/* Progress Bar */}
          <div className="mt-4">
            <div className="w-full bg-white/20 rounded-full h-2">
              <div 
                className="bg-white rounded-full h-2 transition-all duration-300" 
                style={{ width: `${progressPercentage}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="relative flex-1 flex flex-col">
          {/* Chat Messages Area */}
          {chatMode === 'messenger' && (
            <>
              <div className="h-96 overflow-y-auto p-6 space-y-4 bg-slate-50/50 scroll-smooth" data-testid="chat-messages">
                {localMessages.map((message: ConversationMessage, index: number) => (
                <div
                  key={index}
                  className={`flex items-start space-x-3 ${
                    message.sender === "user" ? "justify-end" : ""
                  }`}
                >
                  {message.sender === "ai" && (
                    <div className="relative">
                      <img 
                        src={persona.image} 
                        alt={persona.name} 
                        className="w-8 h-8 rounded-full" 
                      />
                      {/* 감정 이모지 표시 */}
                      {message.emotion && (
                        <div 
                          className="absolute -bottom-1 -right-1 text-sm bg-white rounded-full w-5 h-5 flex items-center justify-center border border-gray-200"
                          title={message.emotionReason || message.emotion}
                        >
                          {emotionEmojis[message.emotion] || '😐'}
                        </div>
                      )}
                    </div>
                  )}
                  
                  <div className={`flex-1 ${message.sender === "user" ? "flex justify-end" : ""}`}>
                    <div className={`rounded-lg p-3 max-w-md ${
                      message.sender === "user"
                        ? "bg-corporate-600 text-white rounded-tr-none"
                        : `message-card rounded-tl-none ${
                            message.emotion === '분노' ? 'border-l-4 border-red-400' :
                            message.emotion === '슬픔' ? 'border-l-4 border-blue-400' :
                            message.emotion === '기쁨' ? 'border-l-4 border-green-400' :
                            message.emotion === '놀람' ? 'border-l-4 border-yellow-400' : ''
                          }`
                    }`}>
                      <p className={message.sender === "user" ? "text-white" : "text-slate-800"}>
                        {message.message}
                      </p>
                      {/* AI 메시지에 감정 정보와 음성 버튼 표시 */}
                      {message.sender === "ai" && (
                        <div className="mt-2 flex items-center justify-between">
                          {message.emotion && (
                            <div className="text-xs text-slate-500 flex items-center">
                              <span className="mr-1">{emotionEmojis[message.emotion]}</span>
                              <span>{message.emotion}</span>
                              {message.emotionReason && (
                                <span className="ml-2 text-slate-400">- {message.emotionReason}</span>
                              )}
                            </div>
                          )}
                          
                          {/* 음성 재생 버튼 */}
                          <button
                            onClick={() => speakMessage(message.message, false, message.emotion)}
                            className="text-xs text-slate-400 hover:text-corporate-600 transition-colors flex items-center space-x-1"
                            title="이 메시지 듣기"
                            data-testid={`button-speak-message-${index}`}
                          >
                            <i className="fas fa-volume-up"></i>
                            <span>듣기</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {message.sender === "user" && (
                    <div className="w-8 h-8 bg-corporate-600 rounded-full flex items-center justify-center text-white text-sm font-medium">
                      나
                    </div>
                  )}
                </div>
              ))}

              {isLoading && (
                <div className="flex items-start space-x-3">
                  <img src={persona.image} alt={persona.name} className="w-8 h-8 rounded-full" />
                  <div className="message-card rounded-lg rounded-tl-none p-3 max-w-md">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }}></div>
                      <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }}></div>
                    </div>
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
              </div>

              {/* Chat Input Area */}
              <div className="border-t border-slate-200 p-6">
                {conversation.turnCount >= maxTurns ? (
                  <div className="text-center space-y-4">
                    <div className="text-lg font-semibold text-slate-700">
                      대화가 완료되었습니다!
                    </div>
                    <div className="text-sm text-slate-500 space-y-1">
                      <div>총 {conversation.turnCount}턴의 대화를 나누었습니다.</div>
                      <div>대화 시간: {formatElapsedTime(elapsedTime)}</div>
                    </div>
                    <div className="flex justify-center space-x-4">
                      <Button
                        onClick={onChatComplete}
                        className="bg-corporate-600 hover:bg-corporate-700"
                        data-testid="button-final-feedback"
                      >
                        <i className="fas fa-chart-bar mr-2"></i>
                        최종 피드백 보기
                      </Button>
                      <Button
                        onClick={onExit}
                        variant="outline"
                        data-testid="button-exit-completed"
                      >
                        <i className="fas fa-home mr-2"></i>
                        홈으로 이동
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex space-x-4">
                    <div className="flex-1">
                      <Textarea
                        value={userInput}
                        onChange={(e) => setUserInput(e.target.value)}
                        placeholder={`메시지를 입력하거나 음성 입력 버튼을 사용하세요... (최대 200자)${!speechSupported ? ' - 음성 입력 미지원 브라우저' : ''}`}
                        maxLength={200}
                        rows={3}
                        className="resize-none"
                        disabled={isLoading}
                        data-testid="input-message"
                      />
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs text-slate-500">{userInput.length}/200</span>
                        <div className="flex items-center space-x-2 text-xs text-slate-500">
                          <span>팁: 구체적이고 예의 바른 답변을 해보세요</span>
                          {speechSupported && (
                            <span className="text-corporate-600">• 음성 입력 지원 (클릭하여 반복 가능)</span>
                          )}
                          {isRecording && (
                            <span className="text-red-600 animate-pulse">🎤 음성 인식 중...</span>
                          )}
                          <i className="fas fa-info-circle"></i>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col space-y-2">
                      <Button
                        onClick={handleSendMessage}
                        disabled={!userInput.trim() || isLoading}
                        data-testid="button-send-message"
                      >
                        <i className="fas fa-paper-plane mr-2"></i>
                        전송
                      </Button>
                      <Button
                        variant="outline"
                        onClick={handleVoiceInput}
                        disabled={isLoading || !speechSupported}
                        className={`${isRecording ? 'bg-red-50 border-red-300 text-red-700 animate-pulse' : ''} ${!speechSupported ? 'opacity-50 cursor-not-allowed' : ''}`}
                        data-testid="button-voice-input"
                        title={!speechSupported ? "현재 브라우저에서 음성 입력을 지원하지 않습니다" : isRecording ? "음성 입력을 중지하려면 클릭하세요" : "음성 입력을 시작하려면 클릭하세요"}
                      >
                        <i className={`fas ${isRecording ? 'fa-stop' : 'fa-microphone'} mr-2 ${isRecording ? 'text-red-500' : ''}`}></i>
                        {isRecording ? '입력 완료' : '음성 입력'}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={handleSkipTurn}
                        disabled={isLoading}
                        data-testid="button-skip-turn"
                      >
                        건너뛰기
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Chat Controls & Info */}
              <div className="mt-6 grid md:grid-cols-3 gap-4">
                <div className="bg-white rounded-lg p-4 border border-slate-200">
                  <h4 className="font-medium text-slate-900 mb-2 flex items-center">
                    <i className="fas fa-target text-corporate-600 mr-2"></i>
                    목표
                  </h4>
                  <p className="text-sm text-slate-600">
                    {persona.name}과 건설적인 대화를 통해 {scenario.skills.join(", ")} 역량을 개발하세요.
                  </p>
                </div>
                <div className="bg-white rounded-lg p-4 border border-slate-200">
                  <h4 className="font-medium text-slate-900 mb-2 flex items-center">
                    <i className="fas fa-stopwatch text-blue-600 mr-2"></i>
                    경과 시간
                  </h4>
                  <p className="text-2xl font-bold text-blue-600" data-testid="sidebar-elapsed-time">
                    {formatElapsedTime(elapsedTime)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {elapsedTime < 300 ? '효율적으로 진행 중' : 
                     elapsedTime < 600 ? '적절한 속도' : 
                     elapsedTime < 900 ? '시간 관리 주의' : '신속한 마무리 권장'}
                  </p>
                </div>
                <div className="bg-white rounded-lg p-4 border border-slate-200">
                  <h4 className="font-medium text-slate-900 mb-2 flex items-center">
                    <i className="fas fa-clock text-amber-600 mr-2"></i>
                    남은 턴
                  </h4>
                  <p className="text-2xl font-bold text-amber-600">{maxTurns - conversation.turnCount}</p>
                  <p className="text-xs text-slate-500">턴이 끝나면 자동으로 평가됩니다</p>
                </div>
                <div className="bg-white rounded-lg p-4 border border-slate-200">
                  <h4 className="font-medium text-slate-900 mb-2 flex items-center">
                    <i className="fas fa-chart-line text-green-600 mr-2"></i>
                    현재 점수
                  </h4>
                  <div className="space-y-1">
                    <p className="text-2xl font-bold text-green-600">{currentScore}/100</p>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full transition-all duration-500 ${
                          currentScore >= 80 ? 'bg-green-500' :
                          currentScore >= 60 ? 'bg-blue-500' :
                          currentScore >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${Math.max(2, currentScore)}%` }}
                      ></div>
                    </div>
                    <p className="text-xs text-slate-500">
                      {currentScore >= 80 ? '우수' :
                       currentScore >= 60 ? '보통' :
                       currentScore >= 40 ? '개선 필요' : '미흡'}
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}

          {chatMode === 'character' && (
            <div 
              className={`fixed inset-0 z-10 bg-cover bg-center bg-no-repeat transition-all duration-300 ${
                isEmotionTransitioning ? 'brightness-90 scale-[1.02]' : 'brightness-100 scale-100'
              }`}
              style={{
                backgroundImage: `url(${getEmotionImage(currentEmotion)})`
              }}
              data-testid="character-mode"
            >
              {/* Background overlay for better text readability */}
              <div className="absolute inset-0 bg-black/20"></div>
              
              {/* Top Left Area */}
              <div className="absolute top-4 left-4 z-20 space-y-3">
                {/* Character Info Bar */}
                <div className="bg-white/90 backdrop-blur-sm rounded-full px-4 py-2 shadow-lg">
                  <div className="flex items-center space-x-3">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-medium text-slate-700">{persona.name}</span>
                      {latestAiMessage?.emotion && (
                        <span className="text-lg">
                          {emotionEmojis[latestAiMessage.emotion] || '😐'}
                        </span>
                      )}
                    </div>
                    {/* Time, Turn Info and Voice Toggle */}
                    <div className="flex items-center space-x-2 text-xs text-slate-500">
                      <span className="flex items-center" data-testid="text-elapsed-time">
                        <i className="fas fa-clock mr-1 text-xs"></i>
                        {formatElapsedTime(elapsedTime)}
                      </span>
                      <span className="text-slate-300">•</span>
                      <span className="flex items-center" data-testid="text-remaining-turns">
                        <i className="fas fa-redo mr-1 text-xs"></i>
                        {Math.max(0, maxTurns - (conversation?.turnCount ?? 0))}턴 남음
                      </span>
                      {/* Voice Toggle */}
                      {lastSpokenMessageRef.current && (
                        <>
                          <span className="text-slate-300">•</span>
                          <button
                            onClick={toggleVoiceMode}
                            className={`p-1 rounded text-xs transition-all duration-200 ${
                              voiceModeEnabled 
                                ? 'text-green-600 hover:text-green-700' 
                                : 'text-slate-400 hover:text-slate-600'
                            }`}
                            data-testid="button-toggle-voice-inline"
                            title={voiceModeEnabled ? "음성 비활성화" : "음성 활성화"}
                          >
                            <i className={voiceModeEnabled ? "fas fa-volume-up" : "fas fa-volume-mute"}></i>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Goals Display - Moved to Top Left */}
                {(scenario?.objectives || scenario?.context?.playerRole?.responsibility) && (
                  <div className="bg-white/80 backdrop-blur-sm rounded-lg p-2 shadow-lg hover:bg-white/90 transition-all duration-300 group cursor-pointer max-w-sm">
                    <div className="flex items-start space-x-2">
                      <i className="fas fa-bullseye text-blue-600 mt-0.5 text-sm"></i>
                      <div className="flex-1">
                        <div className="text-[10px] font-medium text-blue-800 mb-1 flex items-center">
                          목표
                          <span className="text-blue-500 ml-1 text-[9px] opacity-60 group-hover:opacity-100">
                            (hover로 전체 보기)
                          </span>
                        </div>
                        <div className="text-[10px] text-blue-700 leading-relaxed">
                          {(() => {
                            const allGoals = [
                              ...(scenario.context?.playerRole?.responsibility ? [`${scenario.context.playerRole.responsibility}`] : []),
                              ...(scenario.objectives || [])
                            ];
                            const displayGoals = allGoals.slice(0, 2);
                            const remainingGoals = allGoals.slice(2);
                            const hasMore = allGoals.length > 2;
                            
                            return (
                              <div className="space-y-1">
                                {/* 기본 2개 목표 */}
                                {displayGoals.map((goal: string, index: number) => (
                                  <div key={index}>• {goal}</div>
                                ))}
                                
                                {/* 더보기 표시 */}
                                {hasMore && (
                                  <div className="text-blue-500 group-hover:hidden">
                                    • ... (+{remainingGoals.length}개 더)
                                  </div>
                                )}
                                
                                {/* 호버 시 나머지 목표만 추가 표시 */}
                                {hasMore && (
                                  <div className="hidden group-hover:block">
                                    {remainingGoals.map((goal: string, index: number) => (
                                      <div key={`remaining-${index}`}>• {goal}</div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Top Right - Control Buttons */}
              <div className="absolute top-4 right-4 z-20 flex items-center space-x-2">
                {/* TTS 온오프 버튼 */}
                <button
                  onClick={toggleVoiceMode}
                  className={`px-3 py-2 rounded-full shadow-lg transition-all duration-200 text-sm font-medium flex items-center space-x-1 ${
                    voiceModeEnabled 
                      ? 'bg-green-500/90 text-white hover:bg-green-600' 
                      : 'bg-white/90 text-slate-700 hover:bg-white'
                  }`}
                  data-testid="button-toggle-voice-character"
                  title={voiceModeEnabled ? "음성 모드 끄기" : "음성 모드 켜기"}
                >
                  <i className={`fas ${voiceModeEnabled ? 'fa-volume-up' : 'fa-volume-mute'}`}></i>
                  {voiceModeEnabled && isSpeaking && (
                    <span className="text-xs animate-pulse">재생중</span>
                  )}
                  {!isSpeaking && (
                    <span className="text-xs">{voiceModeEnabled ? '음성' : '음성'}</span>
                  )}
                </button>
                
                {/* 메신저 모드 전환 버튼 */}
                <button
                  onClick={() => setChatMode('messenger')}
                  className="px-4 py-2 bg-white/90 text-slate-700 rounded-full shadow-lg hover:bg-white transition-all duration-200 text-sm font-medium"
                  data-testid="button-exit-character"
                >
                  메신저
                </button>
              </div>

              {/* Bottom Interactive Box - AI Message Focused */}
              <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-20 w-full max-w-4xl lg:max-w-6xl xl:max-w-[90%] px-4">
                <Card className="bg-white/40 backdrop-blur-sm shadow-xl border border-white/10">
                  {/* AI Message Section - Full Width */}
                  <div className="p-4">
                    {isLoading ? (
                      <div className="flex items-center justify-center space-x-2" data-testid="status-typing">
                        <div className="w-3 h-3 bg-purple-400 rounded-full animate-bounce"></div>
                        <div className="w-3 h-3 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }}></div>
                        <div className="w-3 h-3 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }}></div>
                        <span className="ml-2 text-slate-600">대화 생성 중...</span>
                      </div>
                    ) : latestAiMessage ? (
                      <div className="space-y-3">
                        <p className="text-slate-800 leading-relaxed text-base" data-testid="text-ai-line">
                          {latestAiMessage.message}
                        </p>
                        
                        {/* AI 메시지 하단 정보 영역 */}
                        <div className="flex items-center justify-between pt-2">
                          {/* 감정 정보 */}
                          {latestAiMessage.emotion && latestAiMessage.emotionReason && (
                            <div className="text-xs text-slate-500 flex items-center">
                              <span className="mr-1">{emotionEmojis[latestAiMessage.emotion]}</span>
                              <span>{latestAiMessage.emotionReason}</span>
                            </div>
                          )}
                          
                          {/* TTS 스피커 아이콘 */}
                          <button
                            onClick={() => speakMessage(latestAiMessage.message, false, latestAiMessage.emotion)}
                            className="text-xs text-slate-400 hover:text-purple-600 transition-colors flex items-center space-x-1 ml-auto"
                            title="이 메시지 듣기"
                            data-testid="button-speak-message-character"
                          >
                            <i className="fas fa-volume-up"></i>
                            <span>듣기</span>
                          </button>
                        </div>
                        
                        {/* Inline Chat Button - Minimal Space */}
                        {!showInputMode && (
                          <div className="flex justify-end pt-2">
                            <Button
                              onClick={() => setShowInputMode(true)}
                              className="bg-purple-600 hover:bg-purple-700 text-white"
                              data-testid="button-start-chat-inline"
                              size="sm"
                            >
                              <i className="fas fa-comment mr-1"></i>
                              대화하기
                            </Button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-center text-slate-600 py-4">
                        <i className="fas fa-comment-dots text-2xl text-purple-400 mb-2"></i>
                        <p>대화를 시작해보세요</p>
                        
                        {/* First Chat Button */}
                        <div className="mt-4">
                          <Button
                            onClick={() => setShowInputMode(true)}
                            className="bg-purple-600 hover:bg-purple-700 text-white"
                            data-testid="button-start-chat-first"
                            size="sm"
                          >
                            <i className="fas fa-comment mr-2"></i>
                            대화하기
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  
                  {/* Input Section - Only When Active */}
                  {showInputMode && conversation.turnCount < maxTurns && (
                    <div className="border-t border-slate-200/30 p-4">
                      <div className="flex items-start space-x-3">
                        {/* Text Input Area */}
                        <div className="flex-1">
                          <Textarea
                            value={userInput}
                            onChange={(e) => setUserInput(e.target.value)}
                            placeholder={`메시지를 입력하거나 음성 입력을 사용하세요... (최대 200자)${!speechSupported ? ' - 음성 입력 미지원' : ''}`}
                            maxLength={200}
                            rows={2}
                            className="resize-none text-sm"
                            disabled={isLoading}
                            data-testid="input-message-character"
                          />
                          <div className="text-xs text-slate-500 mt-1">{userInput.length}/200</div>
                        </div>
                        
                        {/* Button Panel - Right Side */}
                        <div className="grid grid-cols-2 gap-1 w-20">
                          {/* Top Row: Send and Voice */}
                          <Button
                            onClick={handleSendMessage}
                            disabled={!userInput.trim() || isLoading}
                            className="bg-purple-600 hover:bg-purple-700 text-white"
                            size="sm"
                            data-testid="button-send-message-character"
                          >
                            <i className="fas fa-paper-plane"></i>
                          </Button>
                          
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleVoiceInput}
                            disabled={isLoading || !speechSupported}
                            className={`${isRecording ? 'bg-red-50 border-red-300 text-red-700 animate-pulse' : ''} ${!speechSupported ? 'opacity-50' : ''}`}
                            data-testid="button-voice-input-character"
                            title={!speechSupported ? "현재 브라우저에서 음성 입력을 지원하지 않습니다" : isRecording ? "음성 입력을 중지하려면 클릭하세요" : "음성 입력을 시작하려면 클릭하세요"}
                          >
                            <i className={`fas ${isRecording ? 'fa-stop' : 'fa-microphone'} ${isRecording ? 'text-red-500' : ''}`}></i>
                          </Button>
                          
                          {/* Bottom Row: Skip (spans 2 columns) */}
                          <Button
                            variant="outline" 
                            size="sm"
                            onClick={handleSkipTurn}
                            disabled={isLoading}
                            data-testid="button-skip-turn-character"
                            className="col-span-2"
                          >
                            Skip
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* Conversation Complete */}
                  {conversation.turnCount >= maxTurns && (
                    <div className="border-t border-slate-200/30 p-4 text-center space-y-3">
                      <div className="text-sm font-medium text-slate-700">
                        대화가 완료되었습니다! (총 {conversation.turnCount}턴)
                      </div>
                      <div className="flex justify-center space-x-3">
                        <Button
                          onClick={onChatComplete}
                          className="bg-purple-600 hover:bg-purple-700 text-white"
                          data-testid="button-final-feedback"
                          size="sm"
                        >
                          <i className="fas fa-chart-bar mr-1"></i>
                          최종 피드백
                        </Button>
                        <Button
                          onClick={onExit}
                          variant="outline"
                          data-testid="button-exit-completed"
                          size="sm"
                        >
                          <i className="fas fa-home mr-1"></i>
                          홈으로
                        </Button>
                      </div>
                    </div>
                  )}
                </Card>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
