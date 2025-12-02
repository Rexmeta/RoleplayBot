import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Card } from "@/components/ui/card";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Link, useLocation } from "wouter";
import type { ComplexScenario, ScenarioPersona } from "@/lib/scenario-system";
import type { Conversation, ConversationMessage } from "@shared/schema";
import { useRealtimeVoice } from "@/hooks/useRealtimeVoice";

// 감정별 캐릭터 이미지 import
import characterNeutral from "../../../attached_assets/characters/character-neutral.png";
import characterJoy from "../../../attached_assets/characters/character-joy.png";
import characterSad from "../../../attached_assets/characters/character-sad.png";
import characterAngry from "../../../attached_assets/characters/character-angry.png";
import characterSurprise from "../../../attached_assets/characters/character-surprise.png";
import characterCurious from "../../../attached_assets/characters/character-curious.jpg";
import characterAnxious from "../../../attached_assets/characters/character-anxious.jpg";
import characterTired from "../../../attached_assets/characters/character-tired.jpg";
import characterDisappointed from "../../../attached_assets/characters/character-disappointed.jpg";
import characterConfused from "../../../attached_assets/characters/character-confused.jpg";

// 공용 캐릭터 이미지 매핑 (폴백용)
const fallbackCharacterImages = {
  '중립': characterNeutral,
  '기쁨': characterJoy,
  '슬픔': characterSad,
  '분노': characterAngry,
  '놀람': characterSurprise,
  '호기심': characterCurious,
  '불안': characterAnxious,
  '피로': characterTired,
  '실망': characterDisappointed,
  '당혹': characterConfused
};

// 표정 한글 → 영어 매핑
const emotionToEnglish: Record<string, string> = {
  '중립': 'neutral',
  '기쁨': 'joy',
  '슬픔': 'sad',
  '분노': 'angry',
  '놀람': 'surprise',
  '호기심': 'curious',
  '불안': 'anxious',
  '피로': 'tired',
  '실망': 'disappointed',
  '당혹': 'confused'
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
  '중립': '😐',
  '호기심': '🤔',
  '불안': '😰',
  '피로': '😫',
  '실망': '😞',
  '당혹': '😕'
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
  onPersonaChange?: () => void;
}

export default function ChatWindow({ scenario, persona, conversationId, onChatComplete, onExit, onPersonaChange }: ChatWindowProps) {
  const [location, setLocation] = useLocation();
  const [userInput, setUserInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [inputMode, setInputMode] = useState<'text' | 'tts' | 'realtime-voice'>('realtime-voice');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [conversationStartTime, setConversationStartTime] = useState<Date | null>(null);
  const [localMessages, setLocalMessages] = useState<ConversationMessage[]>([]);
  const [chatMode, setChatMode] = useState<'messenger' | 'character'>('character');
  const [showInputMode, setShowInputMode] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isEmotionTransitioning, setIsEmotionTransitioning] = useState(false);
  const [imagesLoaded, setImagesLoaded] = useState<{[key: string]: boolean}>({});
  const [personaImagesAvailable, setPersonaImagesAvailable] = useState<{[key: string]: boolean}>({});
  const [currentEmotion, setCurrentEmotion] = useState<string>('중립');
  const [loadedImageUrl, setLoadedImageUrl] = useState<string>(''); // 성공적으로 로드된 이미지 URL
  const [isGoalsExpanded, setIsGoalsExpanded] = useState(false);
  const [showEndConversationDialog, setShowEndConversationDialog] = useState(false);
  const [showModeChangeDialog, setShowModeChangeDialog] = useState(false);
  const [pendingMode, setPendingMode] = useState<'text' | 'tts' | 'realtime-voice' | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const speechSynthesisRef = useRef<SpeechSynthesis | null>(null);
  const lastSpokenMessageRef = useRef<string>("");
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentAudioUrlRef = useRef<string | null>(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const realtimeVoice = useRealtimeVoice({
    conversationId,
    scenarioId: scenario.id,
    personaId: persona.id,
    enabled: false, // 자동 연결 비활성화, 수동 시작
    onMessageComplete: (message, emotion, emotionReason) => {
      console.log('✅ AI message complete:', message);
      console.log('😊 Emotion received:', emotion, '|', emotionReason);
      
      // 감정 상태 업데이트 (캐릭터 이미지 변경)
      if (emotion) {
        setIsEmotionTransitioning(true);
        setCurrentEmotion(emotion);
        setTimeout(() => setIsEmotionTransitioning(false), 150);
      }
      
      // 완전한 AI 메시지를 대화창에 추가
      setLocalMessages(prev => [...prev, {
        sender: 'ai',
        message: message,
        timestamp: new Date().toISOString(),
        emotion: emotion || '중립',
        emotionReason: emotionReason || '',
      }]);
    },
    onUserTranscription: (transcript) => {
      console.log('🎤 User transcript:', transcript);
      // 사용자 음성 전사를 대화창에 추가
      setLocalMessages(prev => [...prev, {
        sender: 'user',
        message: transcript,
        timestamp: new Date().toISOString(),
      }]);
    },
    onError: (error) => {
      toast({
        title: "음성 연결 오류",
        description: error,
        variant: "destructive"
      });
    },
    onSessionTerminated: (reason) => {
      toast({
        title: "음성 세션 종료",
        description: reason,
      });
      setInputMode('text');
    },
  });
  
  // 페르소나별 이미지 로딩 함수 (성별 폴더 포함, 폴백 포함)
  const getCharacterImage = (emotion: string): string => {
    const emotionEn = emotionToEnglish[emotion] || 'neutral';
    const genderFolder = persona.gender || 'male';
    const mbtiId = persona.mbti?.toLowerCase() || persona.id;
    
    // 페르소나별 이미지가 사용 가능한지 확인
    if (personaImagesAvailable[emotion]) {
      return `/personas/${mbtiId}/${genderFolder}/${emotionEn}.png`;
    }
    
    // 페르소나별 이미지가 없으면 폴백 이미지 사용
    return getFallbackImage(emotion);
  };

  // 이미지 폴백 처리 함수
  const getFallbackImage = (emotion: string): string => {
    return fallbackCharacterImages[emotion as keyof typeof fallbackCharacterImages] || fallbackCharacterImages['중립'];
  };

  // 페르소나별 이미지 체크 및 공용 이미지 프리로딩, 초기 이미지 설정
  useEffect(() => {
    const checkPersonaImages = async () => {
      const genderFolder = persona.gender || 'male';
      const mbtiId = persona.mbti?.toLowerCase() || persona.id;
      // 페르소나별 이미지 체크
      const checkPromises = Object.entries(emotionToEnglish).map(([emotionKr, emotionEn]) => {
        return new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            setPersonaImagesAvailable(prev => ({ ...prev, [emotionKr]: true }));
            console.log(`✅ 페르소나별 이미지 로딩 성공: ${emotionKr} (${mbtiId}/${genderFolder})`);
            resolve();
          };
          img.onerror = () => {
            setPersonaImagesAvailable(prev => ({ ...prev, [emotionKr]: false }));
            console.log(`⚠️ 페르소나별 이미지 없음, 공용 이미지 사용: ${emotionKr}`);
            resolve();
          };
          img.src = `/personas/${mbtiId}/${genderFolder}/${emotionEn}.png`;
        });
      });

      // 공용 이미지 프리로딩
      const fallbackPromises = Object.entries(fallbackCharacterImages).map(([emotion, src]) => {
        return new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            setImagesLoaded(prev => ({ ...prev, [emotion]: true }));
            resolve();
          };
          img.onerror = () => {
            console.warn(`Failed to preload fallback image for emotion: ${emotion}`);
            setImagesLoaded(prev => ({ ...prev, [emotion]: false }));
            resolve();
          };
          img.src = src;
        });
      });
      
      await Promise.all([...checkPromises, ...fallbackPromises]);
      console.log('🎨 모든 캐릭터 이미지 체크 및 프리로딩 완료');
    };
    
    checkPersonaImages();
  }, [persona.id, persona.mbti, persona.gender]);
  
  // 초기 이미지 설정 - getFallbackImage가 정의된 후 호출
  useEffect(() => {
    const initialImageUrl = getCharacterImage('중립');
    setLoadedImageUrl(initialImageUrl);
  }, []);

  // 리얼타임 음성 모드에서는 턴 제한 없음, 다른 모드에서는 3턴
  const maxTurns = inputMode === 'realtime-voice' ? 999 : 3;

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

    // 실시간 음성 모드일 때는 WebSocket으로 텍스트 전송
    if (inputMode === 'realtime-voice' && realtimeVoice.status === 'connected') {
      setUserInput("");
      realtimeVoice.sendTextMessage(message);
      return;
    }

    // 일반 모드 (텍스트/TTS)
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

  const handleEndRealtimeConversation = () => {
    // 실시간 음성 대화 종료 확인 다이얼로그 표시
    setShowEndConversationDialog(true);
  };

  const confirmEndConversation = async () => {
    try {
      setShowEndConversationDialog(false);
      
      // 실시간 음성 연결 해제
      realtimeVoice.disconnect();
      
      // localMessages를 DB에 일괄 저장
      if (localMessages.length > 0) {
        console.log(`💾 Saving ${localMessages.length} realtime messages to database...`);
        
        // 새로운 일괄 저장 엔드포인트 사용
        const res = await apiRequest(
          'POST',
          `/api/conversations/${conversationId}/realtime-messages`,
          {
            messages: localMessages.map(msg => ({
              sender: msg.sender,
              message: msg.message,
              timestamp: msg.timestamp,
              emotion: msg.emotion,
              emotionReason: msg.emotionReason,
            })),
          }
        );
        
        const result = await res.json();
        console.log(`✅ Saved ${result.messagesSaved} messages, turn count: ${result.turnCount}`);
        
        // 캐시 무효화하여 최신 대화 내용 반영
        await queryClient.invalidateQueries({ queryKey: [`/api/conversations/${conversationId}`] });
        // ✅ MyPage에서 업데이트된 대화 기록을 보여주기 위해 scenario-runs 캐시도 무효화
        await queryClient.invalidateQueries({ queryKey: ['/api/scenario-runs'] });
        console.log('🔄 캐시 무효화 완료: conversations, scenario-runs');
      }
      
      // 대화 완료 처리 - 피드백 생성
      onChatComplete();
    } catch (error) {
      console.error('❌ Error saving realtime messages:', error);
      toast({
        title: "메시지 저장 오류",
        description: "대화 내용을 저장하는 중 오류가 발생했습니다.",
        variant: "destructive"
      });
    }
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

  // 페르소나별 성별 정보 - 시나리오 JSON에서 gender 필드 가져오기
  const getPersonaGender = (): 'male' | 'female' => {
    if (persona.gender) {
      console.log(`👤 성별 정보 사용: ${persona.name} (${persona.id}) → ${persona.gender}`);
      return persona.gender;
    }
    
    // 기본값 (시나리오에 gender가 항상 있어야 함)
    console.warn(`⚠️ ${persona.name}의 성별 정보가 없습니다. 기본값 'male' 사용`);
    return 'male';
  };

  // 감정에 따른 음성 설정
  const getVoiceSettings = (emotion: string = '중립', gender: 'male' | 'female' = 'male') => {
    const baseSettings = {
      lang: 'ko-KR',
      volume: 0.8,
    };

    // 성별에 따른 기본 설정
    const genderSettings = gender === 'female' 
      ? { rate: 1.15, pitch: 1.4 }  // 여성: 약간 빠르고 높은 음조
      : { rate: 1.05, pitch: 1.2 }; // 남성: 약간 느리고 낮은 음조

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
    if (inputMode === 'text' && isAutoPlay) return;
    
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

  // 비동기 음성 로딩 대기 함수
  const waitForVoices = (): Promise<SpeechSynthesisVoice[]> => {
    return new Promise((resolve) => {
      const voices = speechSynthesisRef.current?.getVoices() || [];
      if (voices.length > 0) {
        resolve(voices);
      } else {
        const onVoicesChanged = () => {
          const newVoices = speechSynthesisRef.current?.getVoices() || [];
          if (newVoices.length > 0) {
            speechSynthesisRef.current?.removeEventListener('voiceschanged', onVoicesChanged);
            resolve(newVoices);
          }
        };
        speechSynthesisRef.current?.addEventListener('voiceschanged', onVoicesChanged);
        // 타임아웃 설정 (3초 후 빈 배열이라도 반환)
        setTimeout(() => {
          speechSynthesisRef.current?.removeEventListener('voiceschanged', onVoicesChanged);
          resolve(speechSynthesisRef.current?.getVoices() || []);
        }, 3000);
      }
    });
  };

  // 성별에 따른 한국어 음성 선택 함수
  const selectKoreanVoice = (voices: SpeechSynthesisVoice[], gender: string): SpeechSynthesisVoice | null => {
    // 먼저 한국어 음성들을 필터링
    const koreanVoices = voices.filter(voice => 
      voice.lang === 'ko-KR' || voice.lang.startsWith('ko')
    );

    console.log(`🎯 한국어 음성 ${koreanVoices.length}개 발견:`, koreanVoices.map(v => v.name));

    if (koreanVoices.length === 0) {
      console.log('⚠️ 한국어 음성이 없습니다. 기본 음성을 사용합니다.');
      return null;
    }

    let selectedVoice: SpeechSynthesisVoice | null = null;

    if (gender === 'male') {
      // 남성 음성 우선 선택
      selectedVoice = koreanVoices.find(voice => {
        const name = voice.name.toLowerCase();
        return name.includes('injoon') || 
               name.includes('남성') ||
               name.includes('male') ||
               name.includes('man');
      }) || null;
      
      console.log(`👨 남성 음성 선택 시도:`, selectedVoice?.name || '남성 음성 없음');
    } else {
      // 여성 음성 우선 선택  
      selectedVoice = koreanVoices.find(voice => {
        const name = voice.name.toLowerCase();
        return name.includes('heami') || 
               name.includes('yuna') ||
               name.includes('여성') ||
               name.includes('female') ||
               name.includes('woman') ||
               name.includes('google');
      }) || null;

      console.log(`👩 여성 음성 선택 시도:`, selectedVoice?.name || '여성 음성 없음');
    }

    // 성별별 음성이 없으면 첫 번째 한국어 음성 사용
    if (!selectedVoice) {
      selectedVoice = koreanVoices[0];
      console.log(`🔄 기본 한국어 음성 사용:`, selectedVoice.name);
    }

    return selectedVoice;
  };

  // 백업 TTS (개선된 Web Speech API)
  const fallbackToWebSpeechAPI = async (text: string, emotion?: string) => {
    console.log('🔧 브라우저 TTS 백업 시작');
    
    // speechSynthesis 브라우저 지원 확인
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || !window.speechSynthesis) {
      console.error('❌ 브라우저가 Speech Synthesis API를 지원하지 않습니다');
      toast({
        title: "음성 재생 불가",
        description: "브라우저가 음성 합성을 지원하지 않습니다.",
        variant: "destructive"
      });
      return;
    }
    
    // speechSynthesisRef 초기화
    if (!speechSynthesisRef.current) {
      speechSynthesisRef.current = window.speechSynthesis;
    }
    
    // 기존 음성 재생 중단
    speechSynthesisRef.current.cancel();
    
    try {
      // 텍스트 정리
      const cleanText = text.replace(/<[^>]*>/g, '').replace(/[*#_`]/g, '');
      const gender = getPersonaGender();
      const voiceSettings = getVoiceSettings(emotion, gender);
      
      console.log(`🎭 캐릭터 성별: ${gender}, 감정: ${emotion || '중립'}`);
      
      // 음성 로딩 대기
      console.log('⏳ 음성 목록 로딩 중...');
      const voices = await waitForVoices();
      console.log(`🎵 총 ${voices.length}개 음성 사용 가능`);
      
      // 성별에 맞는 한국어 음성 선택
      const selectedVoice = selectKoreanVoice(voices, gender);
      
      // SpeechSynthesisUtterance 생성
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = voiceSettings.lang;
      utterance.rate = voiceSettings.rate;
      utterance.pitch = voiceSettings.pitch;
      utterance.volume = voiceSettings.volume;
      
      // 선택된 음성 적용
      if (selectedVoice) {
        utterance.voice = selectedVoice;
        console.log(`🎯 선택된 음성: ${selectedVoice.name} (${gender === 'male' ? '남성' : '여성'})`);
      } else {
        console.log('🔄 기본 브라우저 음성 사용');
      }
      
      // 이벤트 핸들러 설정
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
      
      // 음성 재생 시작
      console.log('🚀 음성 재생 시작');
      speechSynthesisRef.current.speak(utterance);
      
    } catch (error) {
      console.error('❌ 브라우저 TTS 처리 중 오류:', error);
      setIsSpeaking(false);
      toast({
        title: "음성 처리 오류",
        description: "음성 처리 중 문제가 발생했습니다.",
        variant: "destructive"
      });
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

  const handleModeChange = (newMode: 'text' | 'tts' | 'realtime-voice') => {
    // 실시간 음성 모드와 다른 모드 간 전환 시 확인 필요
    const isRealtimeToOther = inputMode === 'realtime-voice' && newMode !== 'realtime-voice';
    const isOtherToRealtime = inputMode !== 'realtime-voice' && newMode === 'realtime-voice';
    
    if (isRealtimeToOther || isOtherToRealtime) {
      setPendingMode(newMode);
      setShowModeChangeDialog(true);
      return;
    }
    
    // 동일 카테고리 내 전환은 바로 진행 (text <-> tts)
    performModeChange(newMode);
  };

  const performModeChange = (newMode: 'text' | 'tts' | 'realtime-voice') => {
    if (inputMode === 'tts') {
      stopSpeaking();
      lastSpokenMessageRef.current = "";
    }
    
    if (inputMode === 'realtime-voice') {
      realtimeVoice.disconnect();
    }

    setInputMode(newMode);

    if (newMode === 'tts') {
      if (conversation?.messages) {
        const lastMessage = conversation.messages[conversation.messages.length - 1];
        if (lastMessage && lastMessage.sender === 'ai') {
          lastSpokenMessageRef.current = lastMessage.message;
          setTimeout(() => {
            speakMessage(lastMessage.message, false, lastMessage.emotion);
          }, 300);
        }
      }
    }
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
    if (inputMode === 'tts' && localMessages.length > 0) {
      const lastMessage = localMessages[localMessages.length - 1];
      if (lastMessage && lastMessage.sender === 'ai' && !isLoading) {
        // 약간의 지연을 두어 UI 업데이트 후 음성 재생
        setTimeout(() => {
          speakMessage(lastMessage.message, true, lastMessage.emotion);
        }, 500);
      }
    }
  }, [localMessages, inputMode, isLoading]);

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
        // 캐릭터 모드에서는 부드러운 배경 전환 (새 이미지가 로드될 때까지 기존 이미지 유지)
        setIsEmotionTransitioning(true);
        setCurrentEmotion(newEmotion);
        
        // 새 이미지 프리로드 - 로드 완료 후 배경 이미지 업데이트
        const newImageUrl = getCharacterImage(newEmotion);
        preloadImage(newImageUrl);
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
    
    // 페르소나별 이미지 우선, 실패하면 폴백
    return getCharacterImage(targetEmotion);
  };

  // 이미지 프리로드 함수 - 새 이미지 로드 완료 후 상태 업데이트 (기존 이미지 유지하다가 새 이미지 로드 완료 후 교체)
  const preloadImage = (imageUrl: string) => {
    const img = new Image();
    img.onload = () => {
      console.log(`✅ 표정 이미지 로드 완료: ${imageUrl}`);
      // 약간의 지연으로 부드러운 전환 효과 적용
      setTimeout(() => {
        setLoadedImageUrl(imageUrl); // 로드 완료 후 배경 이미지 업데이트
        setIsEmotionTransitioning(false);
      }, 100);
    };
    img.onerror = () => {
      console.log(`⚠️ 표정 이미지 로드 실패: ${imageUrl}, 기존 이미지 유지`);
      setIsEmotionTransitioning(false); // 로드 실패해도 전환 종료
    };
    img.src = imageUrl;
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
                  <h3 className="text-lg font-semibold">{persona.department} {persona.role} {persona.name}과의 대화</h3>
                  <p className="text-blue-100 text-sm">{scenario.title}</p>
                </button>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              {/* 입력 모드 선택 */}
              <div className="relative group">
                <ToggleGroup
                  type="single"
                  value={inputMode}
                  onValueChange={(value: 'text' | 'tts' | 'realtime-voice') => {
                    if (value) handleModeChange(value);
                  }}
                  className="bg-white/10 rounded-lg p-1"
                  data-testid="toggle-input-mode"
                >
                  <ToggleGroupItem 
                    value="text" 
                    className="text-white/80 hover:text-white data-[state=on]:bg-white/20 data-[state=on]:text-white px-2 py-1 text-xs"
                    data-testid="mode-text"
                    title="텍스트 입력"
                  >
                    💬
                  </ToggleGroupItem>
                  <ToggleGroupItem 
                    value="tts" 
                    className="text-white/80 hover:text-white data-[state=on]:bg-white/20 data-[state=on]:text-white px-2 py-1 text-xs"
                    data-testid="mode-tts"
                    title="텍스트 입력 + AI 음성 재생"
                  >
                    🔊
                  </ToggleGroupItem>
                  <ToggleGroupItem 
                    value="realtime-voice" 
                    className="text-white/80 hover:text-white data-[state=on]:bg-white/20 data-[state=on]:text-white px-2 py-1 text-xs"
                    data-testid="mode-realtime-voice"
                    title="실시간 음성 대화 (Gemini Live)"
                  >
                    🎙️
                  </ToggleGroupItem>
                </ToggleGroup>
                {inputMode === 'tts' && isSpeaking && (
                  <div className="absolute -top-1 -right-1 w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                )}
                {inputMode === 'realtime-voice' && realtimeVoice.status === 'connected' && (
                  <div className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                )}
              </div>

              {/* 캐릭터 모드 버튼 */}
              <Button
                onClick={() => {
                  if (!isTransitioning && chatMode === 'messenger') {
                    handleCharacterModeTransition();
                  }
                }}
                variant="ghost"
                size="sm"
                className={`text-white/80 hover:text-white hover:bg-white/10 px-3 py-1 text-xs ${
                  chatMode === 'character' ? 'bg-white/20 text-white' : ''
                }`}
                disabled={isTransitioning || chatMode === 'character'}
                data-testid="button-character-mode"
              >
                캐릭터
              </Button>
            </div>
          </div>
          
          {/* Progress Bar with Stats */}
          <div className="mt-4 flex items-center space-x-3">
            <div className="flex-1 bg-white/20 rounded-full h-2">
              <div 
                className="bg-white rounded-full h-2 transition-all duration-300" 
                style={{ width: `${progressPercentage}%` }}
              ></div>
            </div>
            <div className="flex items-center space-x-3 text-white/90 text-sm">
              <div className="flex items-center space-x-1">
                <i className="fas fa-clock text-xs"></i>
                <span data-testid="elapsed-time">{formatElapsedTime(elapsedTime)}</span>
              </div>
              <div className="flex items-center space-x-1">
                <i className="fas fa-tasks text-xs"></i>
                <span>{conversation.turnCount}/{maxTurns}</span>
              </div>
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
                ) : inputMode === 'realtime-voice' ? (
                  <>
                    {/* 대화 시작 전 상태 */}
                    {realtimeVoice.status === 'disconnected' && (
                      <div className="text-center space-y-4 py-4">
                        <p className="text-sm text-slate-600">실시간 음성 대화를 시작하세요</p>
                        <Button
                          onClick={() => realtimeVoice.connect()}
                          className="bg-purple-600 hover:bg-purple-700 text-white px-8 py-3 rounded-full shadow-lg"
                          data-testid="button-start-voice-messenger"
                        >
                          <i className="fas fa-phone mr-2"></i>
                          대화 시작하기
                        </Button>
                      </div>
                    )}
                    
                    {/* 연결 중 상태 */}
                    {realtimeVoice.status === 'connecting' && (
                      <div className="flex items-center justify-center space-x-2 py-4">
                        <div className="w-3 h-3 bg-purple-400 rounded-full animate-bounce"></div>
                        <div className="w-3 h-3 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }}></div>
                        <div className="w-3 h-3 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }}></div>
                        <span className="ml-2 text-slate-600">음성 연결 중...</span>
                      </div>
                    )}
                    
                    {/* 연결 완료 - 텍스트 입력창 + 음성 버튼 */}
                    {realtimeVoice.status === 'connected' && (
                      <div className="flex space-x-4">
                        <div className="flex-1">
                          <Textarea
                            value={userInput}
                            onChange={(e) => setUserInput(e.target.value)}
                            placeholder="메시지를 입력하거나 마이크를 눌러 음성으로 대화하세요... (최대 200자)"
                            maxLength={200}
                            rows={3}
                            className="resize-none"
                            disabled={realtimeVoice.isRecording || realtimeVoice.isAISpeaking}
                            data-testid="input-message-realtime-messenger"
                          />
                          <div className="flex items-center justify-between mt-2">
                            <span className="text-xs text-slate-500">{userInput.length}/200</span>
                            {/* 상태 표시 */}
                            {(realtimeVoice.isRecording || realtimeVoice.isAISpeaking) && (
                              <div className="text-xs">
                                {realtimeVoice.isRecording && (
                                  <span className="text-red-600 font-medium animate-pulse">
                                    🔴 녹음 중...
                                  </span>
                                )}
                                {realtimeVoice.isAISpeaking && (
                                  <span className="text-blue-600 font-medium animate-pulse">
                                    🔵 AI 응답 중...
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col space-y-2">
                          <Button
                            onClick={handleSendMessage}
                            disabled={!userInput.trim() || realtimeVoice.isRecording || realtimeVoice.isAISpeaking}
                            className="bg-purple-600 hover:bg-purple-700 text-white"
                            data-testid="button-send-message-realtime-messenger"
                          >
                            <i className="fas fa-paper-plane mr-2"></i>
                            전송
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => {
                              if (realtimeVoice.isRecording) {
                                realtimeVoice.stopRecording();
                              } else {
                                realtimeVoice.startRecording();
                              }
                            }}
                            disabled={realtimeVoice.isAISpeaking}
                            className={`${
                              realtimeVoice.isRecording 
                                ? 'bg-red-50 border-red-300 text-red-700 animate-pulse' 
                                : realtimeVoice.isAISpeaking
                                ? 'bg-blue-50 border-blue-300 text-blue-700'
                                : ''
                            }`}
                            data-testid="button-realtime-voice-messenger"
                            title={realtimeVoice.isRecording ? "음성 입력을 중지하려면 클릭하세요" : "음성 입력을 시작하려면 클릭하세요"}
                          >
                            <i className={`fas ${
                              realtimeVoice.isRecording 
                                ? 'fa-stop text-red-500 mr-2' 
                                : realtimeVoice.isAISpeaking
                                ? 'fa-volume-up text-blue-500 mr-2'
                                : 'fa-microphone mr-2'
                            }`}></i>
                            {realtimeVoice.isRecording ? '중지' : realtimeVoice.isAISpeaking ? '응답 중' : '음성'}
                          </Button>
                          <Button
                            variant="destructive"
                            onClick={handleEndRealtimeConversation}
                            disabled={realtimeVoice.isRecording || realtimeVoice.isAISpeaking}
                            data-testid="button-end-conversation-messenger"
                          >
                            <i className="fas fa-stop-circle mr-2"></i>
                            대화 종료
                          </Button>
                        </div>
                      </div>
                    )}
                    
                    {/* 에러 메시지 */}
                    {realtimeVoice.error && (
                      <p className="text-sm text-red-600 text-center mt-2">
                        {realtimeVoice.error}
                      </p>
                    )}
                  </>
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
                          {speechSupported && inputMode === 'text' && (
                            <span className="text-corporate-600">• 음성 입력 지원 (클릭하여 반복 가능)</span>
                          )}
                          {inputMode === 'tts' && (
                            <span className="text-green-600">• 음성 재생 활성화됨</span>
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
                  <h4 className="font-medium text-slate-900 mb-3 flex items-center">
                    <i className="fas fa-user-tie text-corporate-600 mr-2"></i>
                    당신의 역할과 목표
                  </h4>
                  <div className="text-sm space-y-3">
                    {/* 역할 섹션 */}
                    {scenario.context?.playerRole?.responsibility && (
                      <div>
                        <div className="text-xs font-semibold text-corporate-600 mb-1 flex items-center justify-between">
                          <span>👤 당신의 역할</span>
                          <span className="text-slate-500 font-normal">
                            {scenario.context.playerRole.position}
                            {scenario.context.playerRole.experience && ` (${scenario.context.playerRole.experience})`}
                          </span>
                        </div>
                        <div className="text-slate-700 bg-slate-50 rounded px-2 py-1.5">
                          {scenario.context.playerRole.responsibility}
                        </div>
                      </div>
                    )}
                    
                    {/* 목표 섹션 */}
                    {scenario.objectives && scenario.objectives.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-blue-600 mb-1">🎯 달성 목표</div>
                        <div className="space-y-1">
                          {scenario.objectives.slice(0, 2).map((objective: string, index: number) => (
                            <div key={index} className="flex items-start space-x-2">
                              <span className="text-blue-500 text-xs mt-0.5">•</span>
                              <span className="flex-1 text-slate-600">{objective}</span>
                            </div>
                          ))}
                          {scenario.objectives.length > 2 && (
                            <div className="text-xs text-slate-500 mt-1 pl-4">
                              외 {scenario.objectives.length - 2}개 목표 더...
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
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
                isEmotionTransitioning ? 'brightness-95 scale-[1.02]' : 'brightness-110 scale-100'
              }`}
              style={{
                backgroundImage: `url(${loadedImageUrl})`,
                backgroundColor: '#f5f5f5'
              }}
              data-testid="character-mode"
            >
              
              {/* Top Left Area */}
              <div className="absolute top-4 left-4 z-20 space-y-3">
                {/* Character Info Bar */}
                <div className="bg-white/90 backdrop-blur-sm rounded-full px-4 py-2 shadow-lg">
                  <div className="flex items-center space-x-3">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm font-medium text-slate-700">{persona.department} {persona.role} {persona.name}</span>
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
                      {/* Input Mode Indicator */}
                      <span className="text-slate-300">•</span>
                      <span className="text-xs">
                        {inputMode === 'text' && '💬 텍스트'}
                        {inputMode === 'tts' && (
                          <span className="text-green-600">🔊 TTS {isSpeaking && '재생중...'}</span>
                        )}
                        {inputMode === 'realtime-voice' && (
                          <span className="text-blue-600">🎙️ 실시간 {realtimeVoice.isRecording && '녹음중...'}</span>
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Goals Display - Collapsible */}
                {(scenario?.objectives || scenario?.context?.playerRole?.responsibility) && (
                  <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-lg transition-all duration-300 max-w-sm">
                    <button
                      onClick={() => setIsGoalsExpanded(!isGoalsExpanded)}
                      className="w-full p-2 flex items-center justify-between hover:bg-white/90 transition-all duration-200 rounded-lg"
                      data-testid="button-toggle-goals"
                    >
                      <div className="flex items-center space-x-2">
                        <i className="fas fa-user-tie text-corporate-600 text-sm"></i>
                        <span className="text-sm font-medium text-slate-800">당신의 역할과 목표</span>
                      </div>
                      <i className={`fas ${isGoalsExpanded ? 'fa-chevron-up' : 'fa-chevron-down'} text-slate-600 text-xs transition-transform duration-200`}></i>
                    </button>
                    
                    {isGoalsExpanded && (
                      <div className="px-3 pb-3 border-t border-slate-100/50">
                        <div className="text-xs leading-relaxed space-y-3 mt-3">
                          {/* 역할 섹션 */}
                          {scenario.context?.playerRole?.responsibility && (
                            <div>
                              <div className="font-semibold text-corporate-600 mb-1.5 flex items-center justify-between">
                                <span>👤 당신의 역할</span>
                                <span className="text-slate-500 font-normal">
                                  {scenario.context.playerRole.position}
                                  {scenario.context.playerRole.experience && ` (${scenario.context.playerRole.experience})`}
                                </span>
                              </div>
                              <div className="bg-slate-50 text-slate-700 rounded px-2 py-1.5">
                                {scenario.context.playerRole.responsibility}
                              </div>
                            </div>
                          )}
                          
                          {/* 목표 섹션 */}
                          {scenario.objectives && scenario.objectives.length > 0 && (
                            <div>
                              <div className="font-semibold text-blue-600 mb-1.5">🎯 달성 목표</div>
                              <div className="space-y-1.5">
                                {scenario.objectives.map((objective: string, index: number) => (
                                  <div key={index} className="flex items-start space-x-2">
                                    <span className="text-blue-500 text-xs mt-0.5">•</span>
                                    <span className="flex-1 text-slate-700">{objective}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Top Center - 실시간 음성 대화 내역 (캐릭터 모드에서는 숨김) */}
              {false && inputMode === 'realtime-voice' && localMessages.length > 0 && (
                <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-20 w-full max-w-2xl px-4">
                  <div className="bg-white/90 backdrop-blur-sm rounded-lg shadow-lg max-h-60 overflow-y-auto p-4 space-y-2">
                    <h3 className="text-sm font-semibold text-slate-700 mb-2 sticky top-0 bg-white/90">대화 내역</h3>
                    {localMessages.map((msg, index) => (
                      <div
                        key={index}
                        className={`text-sm p-2 rounded ${
                          msg.sender === 'user'
                            ? 'bg-blue-100 text-blue-900 ml-8'
                            : 'bg-slate-100 text-slate-900 mr-8'
                        }`}
                      >
                        <span className="font-semibold text-xs">
                          {msg.sender === 'user' ? '나' : persona.name}:
                        </span>{' '}
                        {msg.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Top Right - Control Buttons */}
              <div className="absolute top-4 right-4 z-20 flex items-center space-x-2">
                {/* 입력 모드 선택 */}
                <div className="bg-white/90 rounded-full shadow-lg p-1">
                  <ToggleGroup
                    type="single"
                    value={inputMode}
                    onValueChange={(value: 'text' | 'tts' | 'realtime-voice') => {
                      if (value) handleModeChange(value);
                    }}
                    className="bg-transparent"
                    data-testid="toggle-input-mode-character"
                  >
                    <ToggleGroupItem 
                      value="text" 
                      className="text-slate-600 hover:text-slate-900 data-[state=on]:bg-slate-100 data-[state=on]:text-slate-900 px-2 py-1 text-xs rounded-full"
                      title="텍스트 입력"
                    >
                      💬
                    </ToggleGroupItem>
                    <ToggleGroupItem 
                      value="tts" 
                      className="text-slate-600 hover:text-slate-900 data-[state=on]:bg-green-100 data-[state=on]:text-green-700 px-2 py-1 text-xs rounded-full"
                      title="텍스트 입력 + AI 음성 재생"
                    >
                      🔊
                    </ToggleGroupItem>
                    <ToggleGroupItem 
                      value="realtime-voice" 
                      className="text-slate-600 hover:text-slate-900 data-[state=on]:bg-blue-100 data-[state=on]:text-blue-700 px-2 py-1 text-xs rounded-full"
                      title="실시간 음성 대화"
                    >
                      🎙️
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>
                
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
              <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-20 w-full max-w-4xl lg:max-w-6xl xl:max-w-[90%] px-4 bg-[#00000000]">
                <Card className="rounded-2xl overflow-hidden text-card-foreground backdrop-blur-sm shadow-xl border border-white/10 bg-[#ffffff9c]">
                  
                  {/* 실시간 음성 모드 */}
                  {inputMode === 'realtime-voice' ? (
                    <>
                      {/* 대화 시작 전 상태 */}
                      {realtimeVoice.status === 'disconnected' && (
                        <div className="p-4 bg-[#ffffff9c]">
                          <div className="flex flex-col items-center space-y-4 py-4">
                            <p className="text-sm text-slate-600">실시간 음성 대화를 시작하세요</p>
                            <Button
                              onClick={() => realtimeVoice.connect()}
                              className="bg-purple-600 hover:bg-purple-700 text-white px-8 py-6 text-lg font-semibold rounded-full shadow-lg"
                              data-testid="button-start-voice"
                            >
                              <i className="fas fa-phone mr-2"></i>
                              대화 시작하기
                            </Button>
                          </div>
                        </div>
                      )}
                      
                      {/* 연결 중 상태 */}
                      {realtimeVoice.status === 'connecting' && (
                        <div className="p-4 bg-[#ffffff9c]">
                          <div className="flex items-center justify-center space-x-2 py-4">
                            <div className="w-3 h-3 bg-purple-400 rounded-full animate-bounce"></div>
                            <div className="w-3 h-3 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }}></div>
                            <div className="w-3 h-3 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }}></div>
                            <span className="ml-2 text-slate-600">음성 연결 중...</span>
                          </div>
                        </div>
                      )}
                      
                      {/* 연결 완료 - 텍스트 입력창 + 음성 버튼 */}
                      {realtimeVoice.status === 'connected' && (
                        <div className="border-t border-slate-200/30 p-4">
                          <div className="flex items-start space-x-3">
                            {/* Text Input Area */}
                            <div className="flex-1">
                              <Textarea
                                value={userInput}
                                onChange={(e) => setUserInput(e.target.value)}
                                placeholder="메시지를 입력하거나 마이크를 눌러 음성으로 대화하세요... (최대 200자)"
                                maxLength={200}
                                rows={2}
                                className="resize-none text-sm"
                                disabled={realtimeVoice.isRecording || realtimeVoice.isAISpeaking}
                                data-testid="input-message-realtime"
                              />
                              <div className="text-xs text-slate-500 mt-1">{userInput.length}/200</div>
                            </div>
                            
                            {/* Button Panel - Right Side */}
                            <div className="grid grid-cols-2 gap-1 w-20">
                              {/* Send button */}
                              <Button
                                onClick={handleSendMessage}
                                disabled={!userInput.trim() || realtimeVoice.isRecording || realtimeVoice.isAISpeaking}
                                className="bg-purple-600 hover:bg-purple-700 text-white"
                                size="sm"
                                data-testid="button-send-message-realtime"
                              >
                                <i className="fas fa-paper-plane"></i>
                              </Button>
                              
                              {/* Realtime Voice button */}
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  if (realtimeVoice.isRecording) {
                                    realtimeVoice.stopRecording();
                                  } else {
                                    realtimeVoice.startRecording();
                                  }
                                }}
                                disabled={realtimeVoice.isAISpeaking}
                                className={`${
                                  realtimeVoice.isRecording 
                                    ? 'bg-red-50 border-red-300 text-red-700 animate-pulse' 
                                    : realtimeVoice.isAISpeaking
                                    ? 'bg-blue-50 border-blue-300 text-blue-700'
                                    : ''
                                }`}
                                data-testid="button-realtime-voice-record"
                                title={realtimeVoice.isRecording ? "음성 입력을 중지하려면 클릭하세요" : "음성 입력을 시작하려면 클릭하세요"}
                              >
                                <i className={`fas ${
                                  realtimeVoice.isRecording 
                                    ? 'fa-stop text-red-500' 
                                    : realtimeVoice.isAISpeaking
                                    ? 'fa-volume-up text-blue-500'
                                    : 'fa-microphone'
                                }`}></i>
                              </Button>
                              
                              {/* 대화 종료 button (spans 2 columns) */}
                              <Button
                                variant="destructive" 
                                size="sm"
                                onClick={handleEndRealtimeConversation}
                                disabled={realtimeVoice.isRecording || realtimeVoice.isAISpeaking}
                                data-testid="button-end-conversation-realtime"
                                className="col-span-2"
                              >
                                <i className="fas fa-stop-circle mr-1"></i>
                                대화 종료
                              </Button>
                            </div>
                          </div>
                          
                          {/* 상태 표시 */}
                          {(realtimeVoice.isRecording || realtimeVoice.isAISpeaking) && (
                            <div className="text-center mt-2">
                              {realtimeVoice.isRecording && (
                                <p className="text-sm text-red-600 font-medium animate-pulse">
                                  🔴 녹음 중...
                                </p>
                              )}
                              {realtimeVoice.isAISpeaking && (
                                <p className="text-sm text-blue-600 font-medium animate-pulse">
                                  🔵 AI 응답 중...
                                </p>
                              )}
                            </div>
                          )}
                          
                          {/* 에러 메시지 */}
                          {realtimeVoice.error && (
                            <p className="text-sm text-red-600 text-center mt-2">
                              {realtimeVoice.error}
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      {/* AI Message Section - Full Width */}
                      <div className="p-4 bg-[#ffffff9c]">
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
                        {onPersonaChange && (
                          <Button
                            onClick={onPersonaChange}
                            className="bg-blue-600 hover:bg-blue-700 text-white"
                            data-testid="button-change-persona"
                            size="sm"
                          >
                            <i className="fas fa-user-friends mr-1"></i>
                            다른 상대와 대화
                          </Button>
                        )}
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
                    </>
                  )}
                </Card>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 입력 모드 변경 확인 다이얼로그 */}
      <AlertDialog open={showModeChangeDialog} onOpenChange={setShowModeChangeDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>입력 모드를 변경하시겠습니까?</AlertDialogTitle>
          </AlertDialogHeader>
          <div className="space-y-2 mb-4">
            <p className="font-semibold text-amber-600">⚠️ 주의사항:</p>
            <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
              <li>입력 모드를 변경하면 <strong>대화가 처음부터 다시 시작</strong>됩니다.</li>
              <li>지금까지 진행한 <strong>대화 내용은 저장되지 않고 삭제</strong>됩니다.</li>
              <li>새로운 모드로 대화를 시작하려면 확인 버튼을 눌러주세요.</li>
            </ul>
          </div>
        <AlertDialogFooter>
            <AlertDialogCancel 
              onClick={() => {
                setPendingMode(null);
                setShowModeChangeDialog(false);
              }}
              data-testid="button-cancel-mode-change"
            >
              취소
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => {
                if (pendingMode) {
                  performModeChange(pendingMode);
                  setPendingMode(null);
                }
                setShowModeChangeDialog(false);
                
                // 대화 내용 초기화
                setLocalMessages([]);
                setUserInput("");
                
                // 쿼리 캐시의 대화 데이터도 초기화 (메시지 삭제)
                queryClient.setQueryData(['/api/conversations', conversationId], (oldData: any) => {
                  if (oldData) {
                    return {
                      ...oldData,
                      messages: [],
                      turnCount: 0
                    };
                  }
                  return oldData;
                });
                
                toast({
                  title: "입력 모드 변경됨",
                  description: "새로운 모드로 대화를 시작하세요.",
                });
              }}
              data-testid="button-confirm-mode-change"
              className="bg-amber-600 hover:bg-amber-700"
            >
              확인, 모드 변경
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 대화 종료 확인 다이얼로그 */}
      <AlertDialog open={showEndConversationDialog} onOpenChange={setShowEndConversationDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>대화를 종료하시겠습니까?</AlertDialogTitle>
            <AlertDialogDescription>
              대화를 종료하고 최종 피드백을 생성하시겠습니까?
              <br />
              지금까지의 대화 내용을 바탕으로 상세한 분석과 점수를 제공합니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-end-conversation">
              취소
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmEndConversation}
              data-testid="button-confirm-end-conversation"
              className="bg-purple-600 hover:bg-purple-700"
            >
              예, 피드백 생성
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
