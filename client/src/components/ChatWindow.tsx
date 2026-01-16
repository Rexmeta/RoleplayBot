import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { MessageSquare, User } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
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
import { AISpeechParticleLayer } from "@/components/AISpeechParticleLayer";
import { UserSpeechParticleLayer } from "@/components/UserSpeechParticleLayer";

const getSpeechSynthesisLang = (langCode: string): string => {
  const langMap: Record<string, string> = {
    'ko': 'ko-KR',
    'en': 'en-US',
    'ja': 'ja-JP',
    'zh': 'zh-CN'
  };
  return langMap[langCode] || 'ko-KR';
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
  '단호': 'determined',
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
  '단호': '😤',
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
  onReady?: () => void;
  onConversationEnding?: () => void;
}

export default function ChatWindow({ scenario, persona, conversationId, onChatComplete, onExit, onPersonaChange, onReady, onConversationEnding }: ChatWindowProps) {
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
  const [isWideScreen, setIsWideScreen] = useState(false);
  const [showInputMode, setShowInputMode] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isEmotionTransitioning, setIsEmotionTransitioning] = useState(false);
    const [personaImagesAvailable, setPersonaImagesAvailable] = useState<{[key: string]: boolean}>({});
  const [currentEmotion, setCurrentEmotion] = useState<string>('중립');
  const [loadedImageUrl, setLoadedImageUrl] = useState<string>(''); // 성공적으로 로드된 이미지 URL
  const [isGoalsExpanded, setIsGoalsExpanded] = useState(false);
  const [showEndConversationDialog, setShowEndConversationDialog] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isOverlayFading, setIsOverlayFading] = useState(false);
  const [showMicPrompt, setShowMicPrompt] = useState(false); // AI 첫 응답 후 마이크 안내 애니메이션
  const [isInputExpanded, setIsInputExpanded] = useState(false); // 텍스트 입력창 확대 상태
  const hasUserSpokenRef = useRef(false); // 사용자가 마이크를 사용했는지 추적
  const initialLoadCompletedRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const speechSynthesisRef = useRef<SpeechSynthesis | null>(null);
  const lastSpokenMessageRef = useRef<string>("");
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentAudioUrlRef = useRef<string | null>(null);
  const onReadyRef = useRef(onReady); // onReady 콜백을 ref로 저장하여 의존성 배열에서 제외

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const { i18n, t } = useTranslation();

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
      
      // AI 응답 완료 후 사용자가 아직 마이크를 사용하지 않았다면 마이크 안내 애니메이션 표시
      if (!hasUserSpokenRef.current) {
        setShowMicPrompt(true);
      }
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
        title: t('voice.connectionError'),
        description: error,
        variant: "destructive"
      });
    },
    onSessionTerminated: (reason) => {
      toast({
        title: t('voice.sessionEnded'),
        description: reason,
      });
      setInputMode('text');
    },
  });
  
  // 페르소나별 이미지 로딩 함수 (성별 폴더 포함, WebP 최적화)
  const getCharacterImage = (emotion: string): string | null => {
    const emotionEn = emotionToEnglish[emotion] || 'neutral';
    const genderFolder = persona.gender || 'male';
    const mbtiId = persona.mbti?.toLowerCase() || persona.id;
    
    // 페르소나별 이미지가 사용 가능한지 확인 (WebP 최적화 이미지 사용)
    if (personaImagesAvailable[emotion]) {
      return `/personas/${mbtiId}/${genderFolder}/${emotionEn}.webp`;
    }
    
    // 페르소나별 이미지가 없으면 null 반환
    return null;
  };
  
  // 모든 감정에 대해 이미지가 없는지 확인
  const hasNoPersonaImages = Object.values(personaImagesAvailable).every(v => v === false) && 
    Object.keys(personaImagesAvailable).length === Object.keys(emotionToEnglish).length;

  // 페르소나별 이미지 체크 (conversationId도 의존성에 포함하여 대화 재개 시에도 체크 실행)
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
            console.log(`⚠️ 페르소나별 이미지 없음: ${emotionKr}`);
            resolve();
          };
          img.src = `/personas/${mbtiId}/${genderFolder}/${emotionEn}.webp`;
        });
      });
      
      await Promise.all(checkPromises);
      console.log('🎨 페르소나 이미지 체크 완료');
    };
    
    checkPersonaImages();
  }, [persona.id, persona.mbti, persona.gender, conversationId]);
  
  // onReady ref 동기화
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  // 페르소나가 변경되면 로딩 상태 및 이미지 상태 리셋
  useEffect(() => {
    initialLoadCompletedRef.current = false;
    setIsInitialLoading(true);
    setIsOverlayFading(false);
    setPersonaImagesAvailable({});
    setLoadedImageUrl('');
    
    // 타임아웃 가드: 3초 후에도 초기 로딩이 완료되지 않으면 강제 해제
    // (이미지 로딩 실패 시 블랙 화면 방지)
    const timeoutId = setTimeout(() => {
      if (!initialLoadCompletedRef.current) {
        console.log('⚠️ ChatWindow 초기 로딩 타임아웃 - 폴백 이미지 설정 및 오버레이 강제 해제');
        initialLoadCompletedRef.current = true;
        // 폴백 이미지 설정 (캐릭터 모드에서 이미지가 없으면 안됨)
        const fallbackUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(persona.name)}&background=6366f1&color=fff&size=400`;
        setLoadedImageUrl(fallbackUrl);
        setIsOverlayFading(true);
        onReadyRef.current?.();
        setTimeout(() => {
          setIsInitialLoading(false);
        }, 500);
      }
    }, 3000);
    
    return () => clearTimeout(timeoutId);
  }, [persona.id, persona.name, conversationId]);

  // 화면 너비 추적 (레이아웃 힌트용, 모드 강제 전환하지 않음)
  useEffect(() => {
    const checkScreenWidth = () => {
      const isWide = window.innerWidth >= 1920;
      setIsWideScreen(isWide);
      // 사용자가 선택한 chatMode를 유지 - 강제 전환하지 않음
    };

    checkScreenWidth();
    window.addEventListener('resize', checkScreenWidth);
    return () => window.removeEventListener('resize', checkScreenWidth);
  }, []);

  // personaImagesAvailable이 업데이트될 때 초기 이미지 설정 및 로딩 오버레이 해제
  useEffect(() => {
    if (initialLoadCompletedRef.current) return;
    
    const allEmotionsChecked = Object.keys(personaImagesAvailable).length === Object.keys(emotionToEnglish).length;
    if (!allEmotionsChecked) return;

    const initialImageUrl = getCharacterImage('중립');
    console.log(`🖼️ 초기 이미지 설정: ${initialImageUrl}`);
    
    const completeInitialLoad = (imageUrl?: string) => {
      if (initialLoadCompletedRef.current) return;
      initialLoadCompletedRef.current = true;
      
      if (imageUrl) {
        setLoadedImageUrl(imageUrl);
      }
      setIsOverlayFading(true);
      onReadyRef.current?.();
      setTimeout(() => {
        setIsInitialLoading(false);
      }, 500);
    };

    if (initialImageUrl) {
      const img = new Image();
      img.onload = () => {
        console.log('✅ ChatWindow: 초기 페르소나 이미지 로드 완료, 오버레이 페이드아웃');
        completeInitialLoad(initialImageUrl);
      };
      img.onerror = () => {
        console.log('⚠️ ChatWindow: 초기 페르소나 이미지 로드 실패, 폴백 이미지 사용');
        const fallbackUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(persona.name)}&background=6366f1&color=fff&size=400`;
        setLoadedImageUrl(fallbackUrl);
        completeInitialLoad();
      };
      img.src = initialImageUrl;
    } else {
      console.log('⚠️ ChatWindow: 페르소나 이미지 없음, 폴백 이미지 사용');
      const fallbackUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(persona.name)}&background=6366f1&color=fff&size=400`;
      setLoadedImageUrl(fallbackUrl);
      completeInitialLoad();
    }
  }, [personaImagesAvailable, persona.id, persona.gender, persona.mbti, persona.name]);
  
  // 감정 변화 시 이미지 업데이트 - preloadImage 함수가 로드 완료 후 setLoadedImageUrl 호출
  // 중립 표정으로 돌아올 때도 이미지가 업데이트되도록 조건 제거
  useEffect(() => {
    if (currentEmotion) {
      const newImageUrl = getCharacterImage(currentEmotion);
      console.log(`🖼️ 감정 변화 이미지: ${currentEmotion} → ${newImageUrl}`);
      if (newImageUrl) {
        preloadImage(newImageUrl);
      }
    }
  }, [currentEmotion]);

  // 모든 모드에서 턴 제한 없음 (999턴)
  const maxTurns = 999;

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
        title: t('toast.error'),
        description: t('voice.sendError'),
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

  // 텍스트/TTS 모드에서 피드백 화면으로 이동 시 즉시 오버레이 표시
  const handleGoToFeedback = () => {
    onConversationEnding?.(); // 즉시 전환 오버레이 표시
    onChatComplete(); // 피드백 화면으로 이동
  };

  const confirmEndConversation = async () => {
    try {
      setShowEndConversationDialog(false);
      
      // 즉시 전환 오버레이 표시 (부모에게 알림)
      onConversationEnding?.();
      
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
        title: t('voice.saveError'),
        description: t('voice.saveError'),
        variant: "destructive"
      });
    }
  };

  // 대화 초기화 핸들러
  const handleResetConversation = async () => {
    try {
      setShowEndConversationDialog(false);
      
      // 실시간 음성 연결 해제
      realtimeVoice.disconnect();
      
      // 서버에서 메시지 삭제 및 상태 리셋
      await apiRequest('DELETE', `/api/conversations/${conversationId}/messages`);
      
      // 로컬 메시지 초기화
      setLocalMessages([]);
      
      // 대화 단계 리셋
      realtimeVoice.resetPhase();
      
      // 캐시 무효화
      await queryClient.invalidateQueries({ queryKey: [`/api/conversations/${conversationId}`] });
      
      // 대화 시작 시간 리셋
      setConversationStartTime(null);
      setElapsedTime(0);
      
      // 사용자 발화 상태 리셋
      hasUserSpokenRef.current = false;
      setShowMicPrompt(false);
      
      toast({
        title: t('voice.resetSuccess'),
        description: t('voice.resetDescription'),
      });
      
      console.log('🔄 Conversation reset complete');
    } catch (error) {
      console.error('❌ Error resetting conversation:', error);
      toast({
        title: t('voice.resetError'),
        description: t('voice.resetError'),
        variant: "destructive"
      });
    }
  };

  const handleVoiceInput = () => {
    if (!speechSupported) {
      toast({
        title: t('voice.notSupported'),
        description: t('voice.notSupported'),
        variant: "destructive"
      });
      return;
    }

    if (isRecording) {
      recognitionRef.current?.stop();
      toast({
        title: t('voice.inputComplete'),
        description: t('voice.inputCompleteDesc'),
      });
    } else {
      try {
        recognitionRef.current?.start();
        toast({
          title: t('voice.inputStart'),
          description: t('voice.inputStartDesc'),
        });
      } catch (error) {
        console.error('음성 인식 시작 실패:', error);
        toast({
          title: t('voice.inputError'),
          description: t('voice.inputErrorDesc'),
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
      lang: getSpeechSynthesisLang(i18n.language),
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
          title: t('voice.playError'),
          description: t('voice.playErrorDesc'),
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
            title: t('voice.serviceError'),
            description: t('voice.serviceErrorDesc'),
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
        title: t('voice.notAvailable'),
        description: t('voice.notAvailableDesc'),
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
          title: t('voice.playError'),
          description: t('voice.playErrorDesc'),
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
        title: t('voice.processingError'),
        description: t('voice.processingErrorDesc'),
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

  const VOICE_INPUT_MARKER = '🎤';
  
  const removeInterimText = (text: string): string => {
    const markerPattern = new RegExp(`\\[${VOICE_INPUT_MARKER}.*?\\].*$`);
    return text.replace(markerPattern, '').trim();
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        setSpeechSupported(true);
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = getSpeechSynthesisLang(i18n.language);
        recognition.maxAlternatives = 1;
        
        recognition.onstart = () => {
          setIsRecording(true);
        };

        recognition.onresult = (event: any) => {
          const result = event.results[0];
          const transcript = result[0].transcript;
          
          if (result.isFinal) {
            setUserInput(prev => {
              const currentText = removeInterimText(prev);
              return currentText + (currentText ? ' ' : '') + transcript.trim();
            });
          } else {
            setUserInput(prev => {
              const currentText = removeInterimText(prev);
              return currentText + (currentText ? ' ' : '') + `[${VOICE_INPUT_MARKER}] ${transcript.trim()}`;
            });
          }
        };

        recognition.onerror = (event: any) => {
          console.error('Speech recognition error:', event.error);
          setIsRecording(false);
          
          let errorMessage = t('voice.recognitionFailed');
          if (event.error === 'no-speech') {
            errorMessage = t('voice.noSpeech');
          } else if (event.error === 'not-allowed') {
            errorMessage = t('voice.notAllowed');
          } else if (event.error === 'network') {
            errorMessage = t('voice.networkError');
          }
          
          toast({
            title: t('voice.recognitionError'),
            description: errorMessage,
            variant: "destructive"
          });
          
          setUserInput(prev => removeInterimText(prev));
        };

        recognition.onend = () => {
          setIsRecording(false);
          setUserInput(prev => removeInterimText(prev));
        };

        recognitionRef.current = recognition;
      } else {
        setSpeechSupported(false);
      }
    }
  }, [toast, i18n.language, t]);

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
        if (newImageUrl) {
          preloadImage(newImageUrl);
        }
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
    <div className="chat-window relative">
      {isInitialLoading && (
        <div 
          className={`fixed inset-0 z-50 bg-black flex items-center justify-center transition-opacity duration-500 ${
            isOverlayFading ? 'opacity-0' : 'opacity-100'
          }`}
          data-testid="chat-loading-overlay"
        >
          <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin" />
        </div>
      )}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Chat Header */}
        <div className="bg-gradient-to-r from-corporate-600 to-corporate-700 px-4 sm:px-6 py-3 sm:py-4 text-white">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center space-x-3 sm:space-x-4 min-w-0 flex-1">
              <div 
                className="flex-shrink-0" 
                data-testid="chat-header-persona-image"
              >
                <div className="w-14 h-14 sm:w-12 sm:h-12 rounded-xl border-2 border-white/30 overflow-hidden bg-gradient-to-br from-slate-100 to-slate-200 shadow-lg">
                  <img 
                    src={getCharacterImage(currentEmotion) || persona.image} 
                    alt={persona.name} 
                    className="w-full h-full object-cover object-[center_15%] transition-all duration-200 scale-110" 
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(persona.name)}&background=6366f1&color=fff&size=64`;
                    }}
                  />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div 
                  className="text-left w-full" 
                  data-testid="chat-header-persona-info"
                >
                  <h3 className="text-base sm:text-lg font-semibold truncate">{persona.name} ({persona.department})</h3>
                  <p className="text-blue-100 text-xs sm:text-sm truncate">{scenario.title}</p>
                </div>
              </div>
            </div>
            <div className="flex items-center">
              {/* 모드 토글 버튼 */}
              <div className="flex items-center bg-white/10 rounded-lg p-0.5">
                <button
                  onClick={() => {
                    if (!isTransitioning && chatMode === 'character') {
                      setChatMode('messenger');
                    }
                  }}
                  className={`p-2 rounded-md transition-all duration-200 ${
                    chatMode === 'messenger' 
                      ? 'bg-white text-corporate-600 shadow-sm' 
                      : 'text-white/70 hover:text-white hover:bg-white/10'
                  }`}
                  disabled={isTransitioning || chatMode === 'messenger'}
                  data-testid="button-messenger-mode"
                  title="메신저 모드"
                >
                  <MessageSquare className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    if (!isTransitioning && chatMode === 'messenger') {
                      handleCharacterModeTransition();
                    }
                  }}
                  className={`p-2 rounded-md transition-all duration-200 ${
                    chatMode === 'character' 
                      ? 'bg-white text-corporate-600 shadow-sm' 
                      : 'text-white/70 hover:text-white hover:bg-white/10'
                  }`}
                  disabled={isTransitioning || chatMode === 'character'}
                  data-testid="button-character-mode"
                  title="캐릭터 모드"
                >
                  <User className="w-4 h-4" />
                </button>
              </div>
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
              {chatMode === 'messenger' && (
                <div className="flex items-center space-x-1">
                  <i className="fas fa-tasks text-xs"></i>
                  <span>{conversation.turnCount}/{maxTurns}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="relative flex-1 flex flex-col">
          {/* Chat Messages Area */}
          {chatMode === 'messenger' && (
            <>
              <div className="h-96 overflow-y-auto p-6 space-y-5 bg-gradient-to-b from-slate-50 to-white scroll-smooth" data-testid="chat-messages">
                {localMessages.map((message: ConversationMessage, index: number) => (
                <div
                  key={index}
                  className={`flex items-end space-x-3 ${
                    message.sender === "user" ? "justify-end" : ""
                  }`}
                >
                  {message.sender === "ai" && (
                    <div className="relative flex-shrink-0 self-stretch flex items-end">
                      <div className="w-16 h-full min-h-[4rem] rounded-xl ring-2 ring-white shadow-lg overflow-hidden bg-slate-100">
                        <img 
                          src={getCharacterImage(message.emotion || '중립') || persona.image} 
                          alt={persona.name} 
                          className="w-full h-full object-cover object-top" 
                        />
                      </div>
                      {message.emotion && (
                        <div 
                          className="absolute -bottom-1 -right-1 text-xs bg-white rounded-lg w-6 h-6 flex items-center justify-center shadow-sm border-2 border-white"
                          title={message.emotionReason || message.emotion}
                        >
                          {emotionEmojis[message.emotion] || '😐'}
                        </div>
                      )}
                    </div>
                  )}
                  
                  <div className={`flex flex-col ${message.sender === "user" ? "items-end" : "items-start"} max-w-[70%]`}>
                    {message.sender === "ai" && (
                      <span className="text-xs text-slate-500 mb-1 ml-1 font-medium">{persona.name}</span>
                    )}
                    <div className={`rounded-2xl px-4 py-3 shadow-sm ${
                      message.sender === "user"
                        ? "bg-gradient-to-br from-corporate-600 to-corporate-700 text-white rounded-br-md"
                        : `bg-white border border-slate-100 rounded-bl-md shadow-md ${
                            message.emotion === '분노' ? 'border-l-4 border-l-red-400' :
                            message.emotion === '슬픔' ? 'border-l-4 border-l-blue-400' :
                            message.emotion === '기쁨' ? 'border-l-4 border-l-green-400' :
                            message.emotion === '놀람' ? 'border-l-4 border-l-yellow-400' :
                            message.emotion === '호기심' ? 'border-l-4 border-l-purple-400' :
                            message.emotion === '불안' ? 'border-l-4 border-l-orange-400' :
                            message.emotion === '단호' ? 'border-l-4 border-l-slate-400' :
                            message.emotion === '실망' ? 'border-l-4 border-l-indigo-400' :
                            message.emotion === '당혹' ? 'border-l-4 border-l-pink-400' :
                            message.emotion === '중립' ? 'border-l-4 border-l-gray-300' : ''
                          }`
                    }`}>
                      <p className={`leading-relaxed ${message.sender === "user" ? "text-white" : "text-slate-700"}`}>
                        {message.message}
                      </p>
                    </div>
                    <span className="text-[10px] text-slate-400 mt-1 mx-1">
                      {new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  {message.sender === "user" && (
                    <div className="w-10 h-10 bg-gradient-to-br from-corporate-500 to-corporate-700 rounded-full flex items-center justify-center text-white text-sm font-semibold shadow-md ring-2 ring-white flex-shrink-0">
                      나
                    </div>
                  )}
                </div>
              ))}

              {isLoading && (
                <div className="flex items-start space-x-3">
                  <div className="w-14 h-14 rounded-xl ring-2 ring-white shadow-lg overflow-hidden bg-slate-100 flex-shrink-0">
                    <img src={getCharacterImage('중립') || persona.image} alt={persona.name} className="w-full h-full object-cover object-top scale-110" />
                  </div>
                  <div className="bg-white rounded-2xl rounded-bl-md px-4 py-3 shadow-md border border-slate-100 mt-1">
                    <div className="flex space-x-1.5">
                      <div className="w-2.5 h-2.5 bg-slate-300 rounded-full animate-bounce"></div>
                      <div className="w-2.5 h-2.5 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: "0.15s" }}></div>
                      <div className="w-2.5 h-2.5 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: "0.3s" }}></div>
                    </div>
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
              </div>

              {/* Chat Input Area */}
              <div className="border-t border-slate-100 bg-white p-6 shadow-[0_-4px_20px_-8px_rgba(0,0,0,0.1)]">
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
                        onClick={handleGoToFeedback}
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
                    {/* 대화 시작 전 또는 끊김 상태 */}
                    {realtimeVoice.status === 'disconnected' && (
                      <div className="text-center space-y-4 py-4">
                        {realtimeVoice.conversationPhase === 'interrupted' ? (
                          <>
                            <p className="text-sm text-orange-600">연결이 끊겼습니다. 이어서 대화할 수 있습니다.</p>
                            <Button
                              onClick={() => {
                                // 이전 대화 기록을 전달하여 컨텍스트 유지 (user/ai만 필터링)
                                const previousMessages = localMessages
                                  .filter(m => m.sender === 'user' || m.sender === 'ai')
                                  .map(m => ({
                                    role: m.sender as 'user' | 'ai',
                                    content: m.message
                                  }));
                                realtimeVoice.connect(previousMessages);
                              }}
                              className="bg-orange-500 hover:bg-orange-600 text-white px-8 py-3 rounded-full shadow-lg"
                              data-testid="button-resume-voice-messenger"
                            >
                              <i className="fas fa-redo mr-2"></i>
                              이어서 하기
                            </Button>
                          </>
                        ) : (
                          <>
                            <p className="text-sm text-slate-600">실시간 음성 대화를 시작하세요</p>
                            <Button
                              onClick={() => realtimeVoice.connect()}
                              className="bg-purple-600 hover:bg-purple-700 text-white px-8 py-3 rounded-full shadow-lg"
                              data-testid="button-start-voice-messenger"
                            >
                              <i className="fas fa-phone mr-2"></i>
                              대화 시작하기
                            </Button>
                          </>
                        )}
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
                    
                    {/* AI 인사 준비 중 상태 (메신저 모드) */}
                    {realtimeVoice.status === 'connected' && realtimeVoice.isWaitingForGreeting && (
                      <div className="flex flex-col items-center justify-center gap-3 py-4">
                        <div className="flex items-center justify-center space-x-2">
                          <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce"></div>
                          <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                          <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                          <span className="ml-2 text-slate-600 text-sm">
                            {realtimeVoice.greetingRetryCount > 0 
                              ? `${persona.department} ${persona.role} ${persona.name}님이 인사를 준비하고 있습니다... (재시도 ${realtimeVoice.greetingRetryCount}/3)`
                              : `${persona.department} ${persona.role} ${persona.name}님이 인사를 준비하고 있습니다...`}
                          </span>
                        </div>
                        <Button
                          onClick={() => {
                            hasUserSpokenRef.current = true;
                            setShowMicPrompt(false);
                            setIsInputExpanded(false);
                            realtimeVoice.startRecording();
                          }}
                          size="sm"
                          className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-full text-sm"
                          data-testid="button-start-greeting-messenger"
                        >
                          <i className="fas fa-microphone mr-1.5"></i>
                          대화 시작하기
                        </Button>
                      </div>
                    )}
                    
                    {/* AI 인사 실패 - 사용자가 먼저 시작하도록 안내 (메신저 모드) */}
                    {realtimeVoice.status === 'connected' && realtimeVoice.greetingFailed && (
                      <div className="flex items-center justify-center py-4">
                        <span className="text-orange-600 text-sm font-medium">
                          {user?.name || '회원'}님, {persona.name}님에게 먼저 인사를 건네보세요!
                        </span>
                      </div>
                    )}
                    
                    {/* 연결 완료 - 마이크 중심 레이아웃 (메신저 모드) */}
                    {realtimeVoice.status === 'connected' && !realtimeVoice.isWaitingForGreeting && (
                      <div className="flex items-center justify-center gap-4 py-2">
                        {/* 대화 종료 버튼 - 왼쪽 */}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleEndRealtimeConversation}
                          disabled={realtimeVoice.isRecording || realtimeVoice.isAISpeaking}
                          data-testid="button-end-conversation-messenger"
                          className="text-red-600 border-red-200 hover:bg-red-50 shrink-0"
                        >
                          <i className="fas fa-stop-circle mr-1"></i>
                          종료
                        </Button>
                        
                        {/* 중앙 마이크 버튼 - 크고 강조 */}
                        <button
                          onClick={() => {
                            if (realtimeVoice.isRecording) {
                              realtimeVoice.stopRecording();
                            } else {
                              hasUserSpokenRef.current = true;
                              setShowMicPrompt(false);
                              setIsInputExpanded(false);
                              realtimeVoice.startRecording();
                            }
                          }}
                          disabled={realtimeVoice.isAISpeaking}
                          className={`relative w-14 h-14 rounded-full flex items-center justify-center transition-all duration-300 shadow-lg ${
                            realtimeVoice.isRecording 
                              ? 'bg-red-500 text-white scale-110' 
                              : realtimeVoice.isAISpeaking
                              ? 'bg-blue-500 text-white'
                              : showMicPrompt
                              ? 'bg-gradient-to-r from-blue-500 to-purple-500 text-white animate-bounce'
                              : 'bg-gradient-to-r from-purple-500 to-indigo-500 text-white hover:scale-105'
                          }`}
                          data-testid="button-realtime-voice-messenger"
                          title={realtimeVoice.isRecording ? "음성 입력을 중지하려면 클릭하세요" : "음성 입력을 시작하려면 클릭하세요"}
                        >
                          {/* 펄스 링 효과 */}
                          {(showMicPrompt || realtimeVoice.isRecording) && !realtimeVoice.isAISpeaking && (
                            <>
                              <span className="absolute inset-0 rounded-full bg-current animate-ping opacity-20"></span>
                              <span className="absolute -inset-2 rounded-full bg-current opacity-10 blur-md animate-pulse"></span>
                            </>
                          )}
                          <i className={`fas text-xl ${
                            realtimeVoice.isRecording 
                              ? 'fa-stop' 
                              : realtimeVoice.isAISpeaking
                              ? 'fa-volume-up animate-pulse'
                              : 'fa-microphone'
                          }`}></i>
                        </button>
                        
                        {/* 텍스트 입력 영역 - 동적 확장 (브라우저 너비에 맞춤) */}
                        <div className={`flex items-center gap-2 transition-all duration-300 ease-in-out overflow-hidden flex-1 ${
                          isInputExpanded ? 'max-w-full' : 'max-w-[200px]'
                        }`}>
                          <div className="relative flex-1">
                            <input
                              type="text"
                              value={userInput}
                              onChange={(e) => setUserInput(e.target.value.slice(0, 200))}
                              onFocus={() => setIsInputExpanded(true)}
                              onBlur={() => {
                                if (!userInput.trim()) {
                                  setIsInputExpanded(false);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey && userInput.trim()) {
                                  e.preventDefault();
                                  handleSendMessage();
                                  setIsInputExpanded(false);
                                }
                              }}
                              placeholder={isInputExpanded ? "메시지 입력... (Enter로 전송)" : "텍스트로 대화"}
                              className={`w-full px-3 py-2 text-sm border rounded-full bg-white focus:outline-none focus:ring-2 focus:ring-purple-400 transition-all ${
                                isInputExpanded ? 'border-purple-300' : 'border-slate-200'
                              }`}
                              disabled={realtimeVoice.isRecording || realtimeVoice.isAISpeaking}
                              data-testid="input-message-realtime-messenger"
                            />
                            {isInputExpanded && userInput.length > 0 && (
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                                {userInput.length}/200
                              </span>
                            )}
                          </div>
                          {isInputExpanded && userInput.trim() && (
                            <Button
                              onClick={() => {
                                handleSendMessage();
                                setIsInputExpanded(false);
                              }}
                              disabled={!userInput.trim() || realtimeVoice.isRecording || realtimeVoice.isAISpeaking}
                              className="bg-purple-600 hover:bg-purple-700 text-white rounded-full w-8 h-8 p-0 shrink-0"
                              size="sm"
                              data-testid="button-send-message-realtime-messenger"
                            >
                              <i className="fas fa-paper-plane text-xs"></i>
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                    
                    {/* 상태 표시 */}
                    {realtimeVoice.status === 'connected' && (realtimeVoice.isRecording || realtimeVoice.isAISpeaking) && (
                      <div className="text-center mt-2">
                        {realtimeVoice.isRecording && (
                          <p className="text-sm text-red-600 font-medium animate-pulse">
                            🔴 녹음 중... 말씀이 끝나면 자동으로 전송됩니다
                          </p>
                        )}
                        {realtimeVoice.isAISpeaking && (
                          <p className="text-sm text-blue-600 font-medium animate-pulse">
                            🔵 AI가 응답하고 있습니다...
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
                  </>
                ) : (
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <div className="relative">
                        <Textarea
                          value={userInput}
                          onChange={(e) => setUserInput(e.target.value)}
                          placeholder={`메시지를 입력하세요... (최대 200자)`}
                          maxLength={200}
                          rows={3}
                          className="resize-none rounded-xl border-slate-200 focus:border-corporate-400 focus:ring-corporate-400/20 focus:ring-4 transition-all duration-200 pr-12"
                          disabled={isLoading}
                          data-testid="input-message"
                        />
                        <div className="absolute bottom-3 right-3 text-xs text-slate-400 bg-white/80 px-1.5 py-0.5 rounded">
                          {userInput.length}/200
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-2 px-1">
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <i className="fas fa-lightbulb text-amber-400"></i>
                          <span>팁: 구체적이고 예의 바른 답변을 해보세요</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          {isRecording && (
                            <span className="text-red-600 animate-pulse flex items-center gap-1">
                              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                              음성 인식 중...
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Button
                        onClick={handleSendMessage}
                        disabled={!userInput.trim() || isLoading}
                        className="bg-gradient-to-r from-corporate-600 to-corporate-700 hover:from-corporate-700 hover:to-corporate-800 shadow-md hover:shadow-lg transition-all duration-200 rounded-xl h-12"
                        data-testid="button-send-message"
                      >
                        <i className="fas fa-paper-plane mr-2"></i>
                        전송
                      </Button>
                      <Button
                        variant="outline"
                        onClick={handleVoiceInput}
                        disabled={isLoading || !speechSupported}
                        className={`rounded-xl h-10 transition-all duration-200 ${
                          isRecording 
                            ? 'bg-red-50 border-red-300 text-red-700 animate-pulse shadow-md' 
                            : 'hover:bg-slate-50 hover:border-slate-300 hover:shadow-sm'
                        } ${!speechSupported ? 'opacity-50 cursor-not-allowed' : ''}`}
                        data-testid="button-voice-input"
                        title={!speechSupported ? "현재 브라우저에서 음성 입력을 지원하지 않습니다" : isRecording ? "음성 입력을 중지하려면 클릭하세요" : "음성 입력을 시작하려면 클릭하세요"}
                      >
                        <i className={`fas ${isRecording ? 'fa-stop' : 'fa-microphone'} mr-2 ${isRecording ? 'text-red-500' : 'text-corporate-600'}`}></i>
                        {isRecording ? '완료' : '음성'}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={handleSkipTurn}
                        disabled={isLoading}
                        className="rounded-xl h-10 text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                        data-testid="button-skip-turn"
                      >
                        <i className="fas fa-forward mr-2"></i>
                        건너뛰기
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Chat Controls & Info */}
              <div className="mt-8 space-y-5 px-2">
                <div className="grid md:grid-cols-3 gap-4">
                  <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm hover:shadow-md transition-all duration-300 group">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-semibold text-slate-700 text-sm flex items-center">
                        <div className="w-8 h-8 bg-blue-100 rounded-xl flex items-center justify-center mr-2 group-hover:scale-110 transition-transform duration-300">
                          <i className="fas fa-stopwatch text-blue-600 text-sm"></i>
                        </div>
                        경과 시간
                      </h4>
                    </div>
                    <p className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-blue-500 bg-clip-text text-transparent" data-testid="sidebar-elapsed-time">
                      {formatElapsedTime(elapsedTime)}
                    </p>
                    <p className="text-xs text-slate-500 mt-2 flex items-center gap-1">
                      <span className={`w-2 h-2 rounded-full ${
                        elapsedTime < 300 ? 'bg-green-400' : 
                        elapsedTime < 600 ? 'bg-blue-400' : 
                        elapsedTime < 900 ? 'bg-amber-400' : 'bg-red-400'
                      }`}></span>
                      {elapsedTime < 300 ? '효율적으로 진행 중' : 
                       elapsedTime < 600 ? '적절한 속도' : 
                       elapsedTime < 900 ? '시간 관리 주의' : '신속한 마무리 권장'}
                    </p>
                  </div>
                  <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm hover:shadow-md transition-all duration-300 group">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-semibold text-slate-700 text-sm flex items-center">
                        <div className="w-8 h-8 bg-amber-100 rounded-xl flex items-center justify-center mr-2 group-hover:scale-110 transition-transform duration-300">
                          <i className="fas fa-sync-alt text-amber-600 text-sm"></i>
                        </div>
                        남은 턴
                      </h4>
                    </div>
                    <p className="text-3xl font-bold bg-gradient-to-r from-amber-600 to-amber-500 bg-clip-text text-transparent">{maxTurns - conversation.turnCount}</p>
                    <p className="text-xs text-slate-500 mt-2">턴이 끝나면 자동으로 평가됩니다</p>
                  </div>
                  <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm hover:shadow-md transition-all duration-300 group">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-semibold text-slate-700 text-sm flex items-center">
                        <div className="w-8 h-8 bg-green-100 rounded-xl flex items-center justify-center mr-2 group-hover:scale-110 transition-transform duration-300">
                          <i className="fas fa-chart-line text-green-600 text-sm"></i>
                        </div>
                        현재 점수
                      </h4>
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                        currentScore >= 80 ? 'bg-green-100 text-green-700' :
                        currentScore >= 60 ? 'bg-blue-100 text-blue-700' :
                        currentScore >= 40 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {currentScore >= 80 ? '우수' :
                         currentScore >= 60 ? '보통' :
                         currentScore >= 40 ? '개선 필요' : '미흡'}
                      </span>
                    </div>
                    <div className="space-y-2">
                      <p className="text-3xl font-bold bg-gradient-to-r from-green-600 to-green-500 bg-clip-text text-transparent">{currentScore}<span className="text-lg text-slate-400">/100</span></p>
                      <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                        <div 
                          className={`h-2.5 rounded-full transition-all duration-700 ease-out ${
                            currentScore >= 80 ? 'bg-gradient-to-r from-green-400 to-green-500' :
                            currentScore >= 60 ? 'bg-gradient-to-r from-blue-400 to-blue-500' :
                            currentScore >= 40 ? 'bg-gradient-to-r from-yellow-400 to-yellow-500' : 'bg-gradient-to-r from-red-400 to-red-500'
                          }`}
                          style={{ width: `${Math.max(3, currentScore)}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm hover:shadow-md transition-all duration-300">
                  <h4 className="font-semibold text-slate-700 mb-4 flex items-center text-sm">
                    <div className="w-8 h-8 bg-corporate-100 rounded-xl flex items-center justify-center mr-2">
                      <i className="fas fa-user-tie text-corporate-600 text-sm"></i>
                    </div>
                    당신의 역할과 목표
                  </h4>
                  <div className="text-sm grid md:grid-cols-2 gap-4">
                    {scenario.context?.playerRole?.responsibility && (
                      <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 rounded-xl p-4">
                        <div className="text-xs font-semibold text-corporate-600 mb-2 flex items-center justify-between">
                          <span className="flex items-center gap-1.5">
                            <i className="fas fa-id-badge"></i>
                            당신의 역할
                          </span>
                          <span className="text-slate-500 font-normal bg-white px-2 py-0.5 rounded-full">
                            {scenario.context.playerRole.position}
                          </span>
                        </div>
                        <div className="text-slate-700 leading-relaxed">
                          {scenario.context.playerRole.responsibility}
                        </div>
                      </div>
                    )}
                    
                    {scenario.objectives && scenario.objectives.length > 0 && (
                      <div className="bg-gradient-to-br from-blue-50 to-blue-100/30 rounded-xl p-4">
                        <div className="text-xs font-semibold text-blue-600 mb-2 flex items-center gap-1.5">
                          <i className="fas fa-bullseye"></i>
                          달성 목표
                        </div>
                        <div className="space-y-2">
                          {scenario.objectives.slice(0, 2).map((objective: string, index: number) => (
                            <div key={index} className="flex items-start gap-2">
                              <span className="w-5 h-5 bg-blue-500 text-white rounded-full flex items-center justify-center text-xs flex-shrink-0 mt-0.5">{index + 1}</span>
                              <span className="flex-1 text-slate-700 leading-relaxed">{objective}</span>
                            </div>
                          ))}
                          {scenario.objectives.length > 2 && (
                            <div className="text-xs text-slate-500 pl-7">
                              +{scenario.objectives.length - 2}개 목표 더...
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          {chatMode === 'character' && (
            <div 
              className="fixed inset-0 z-10 flex"
              data-testid="character-mode"
            >
              {/* Wide Screen Left Sidebar - Goals Panel (visible on xl+) */}
              <div className="hidden xl:flex flex-col w-[480px] 2xl:w-[560px] bg-gradient-to-b from-slate-50 to-slate-100 border-r border-slate-200 p-4 overflow-y-auto z-30">
                {/* Character Info */}
                <div className="bg-white rounded-xl px-4 py-3 shadow-sm border border-slate-100 mb-4">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-semibold text-slate-800">{persona.department} {persona.role} {persona.name}</span>
                    {latestAiMessage?.emotion && (
                      <span className="text-lg">{emotionEmojis[latestAiMessage.emotion] || '😐'}</span>
                    )}
                  </div>
                  <div className="flex items-center space-x-3 text-xs text-slate-500 mt-2">
                    <span className="flex items-center" data-testid="text-elapsed-time-sidebar">
                      <i className="fas fa-clock mr-1"></i>
                      {formatElapsedTime(elapsedTime)}
                    </span>
                  </div>
                </div>
                
                {/* Goals Panel - Always Expanded */}
                {(scenario?.objectives || scenario?.context?.playerRole?.responsibility) && (
                  <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 flex-1">
                    <h4 className="font-semibold text-slate-800 mb-4 flex items-center">
                      <i className="fas fa-user-tie text-corporate-600 mr-2"></i>
                      당신의 역할과 목표
                    </h4>
                    <div className="text-sm leading-relaxed space-y-4">
                      {/* 역할 섹션 */}
                      {scenario.context?.playerRole?.responsibility && (
                        <div>
                          <div className="font-semibold text-corporate-600 mb-2 flex items-center justify-between text-xs">
                            <span>👤 당신의 역할</span>
                            <span className="text-slate-500 font-normal">
                              {scenario.context.playerRole.position}
                              {scenario.context.playerRole.experience && ` (${scenario.context.playerRole.experience})`}
                            </span>
                          </div>
                          <div className="bg-slate-50 text-slate-700 rounded-lg px-3 py-2 text-sm">
                            {scenario.context.playerRole.responsibility}
                          </div>
                        </div>
                      )}
                      
                      {/* 목표 섹션 */}
                      {scenario.objectives && scenario.objectives.length > 0 && (
                        <div>
                          <div className="font-semibold text-blue-600 mb-2 text-xs">🎯 달성 목표</div>
                          <div className="space-y-2">
                            {scenario.objectives.map((objective: string, index: number) => (
                              <div key={index} className="flex items-start space-x-2 bg-blue-50/50 rounded-lg px-3 py-2">
                                <span className="text-blue-500 text-xs mt-0.5 font-bold">{index + 1}</span>
                                <span className="flex-1 text-slate-700 text-sm">{objective}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Character Image Area with max-width constraint */}
              <div className="flex-1 flex justify-center bg-slate-100">
                <div 
                  className={`relative w-full max-w-[800px] xl:max-w-[900px] h-full bg-cover bg-center bg-no-repeat transition-all duration-300 ${
                    isEmotionTransitioning ? 'brightness-95 scale-[1.02]' : 'brightness-110 scale-100'
                  }`}
                  style={{
                    backgroundImage: loadedImageUrl ? `url(${loadedImageUrl})` : 'none',
                    backgroundColor: '#f5f5f5'
                  }}
                >
              
              {/* AI 음성 파티클 시각화 레이어 (상단) */}
              <AISpeechParticleLayer 
                amplitude={realtimeVoice.audioAmplitude} 
                isActive={realtimeVoice.isAISpeaking} 
              />
              
              {/* 사용자 음성 파티클 시각화 레이어 (하단 마이크 중심) */}
              <UserSpeechParticleLayer 
                amplitude={realtimeVoice.userAudioAmplitude} 
                isActive={realtimeVoice.isRecording && !realtimeVoice.isAISpeaking} 
              />
              
              {/* AI 첫 인사 준비 중 오버레이 (캐릭터 모드) - 하단에만 표시하도록 제거 */}

              {/* 페르소나 이미지가 없을 때 안내 메시지 */}
              {hasNoPersonaImages && (
                <div className="absolute inset-0 flex items-center justify-center z-5">
                  <div className="bg-white/95 backdrop-blur-sm rounded-2xl px-8 py-6 shadow-xl max-w-md text-center">
                    <div className="text-4xl mb-4">🖼️</div>
                    <h3 className="text-lg font-semibold text-slate-800 mb-2">페르소나 이미지가 존재하지 않습니다</h3>
                    <p className="text-sm text-slate-600">운영자에게 문의해 주세요.</p>
                  </div>
                </div>
              )}
              
              {/* Top Left Area - Hidden on 2xl (shown in sidebar) */}
              <div className="absolute top-4 left-4 z-20 space-y-3 xl:hidden">
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
                    </div>
                  </div>
                </div>

                {/* Goals Display - Collapsible (Hidden on 2xl where sidebar is visible) */}
                {(scenario?.objectives || scenario?.context?.playerRole?.responsibility) && (
                  <div className="bg-white/80 backdrop-blur-sm rounded-lg shadow-lg transition-all duration-300 max-w-sm xl:hidden">
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
              <div className="absolute top-4 right-4 z-20 flex items-center">
                {/* 모드 토글 버튼 */}
                <div className="flex items-center bg-white/20 backdrop-blur-sm rounded-lg p-0.5 shadow-lg">
                  <button
                    onClick={() => setChatMode('messenger')}
                    className={`p-2 rounded-md transition-all duration-200 text-white/80 hover:text-white hover:bg-white/20`}
                    disabled={isTransitioning}
                    data-testid="button-messenger-mode"
                    title="메신저 모드"
                  >
                    <MessageSquare className="w-4 h-4" />
                  </button>
                  <button
                    className={`p-2 rounded-md transition-all duration-200 bg-white text-corporate-600 shadow-sm`}
                    disabled={true}
                    data-testid="button-character-mode"
                    title="캐릭터 모드"
                  >
                    <User className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Bottom Interactive Box - AI Message Focused */}
              <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-20 w-full max-w-4xl lg:max-w-6xl xl:max-w-[90%] px-4 bg-[#00000000]">
                {/* 최근 대화 내용 (최대 5턴) */}
                {localMessages.length > 0 && (
                  <div className="mb-2 space-y-1 max-h-32 overflow-y-auto px-2">
                    {localMessages.slice(-5).map((msg, index) => (
                      <div
                        key={index}
                        className={`text-sm ${
                          msg.sender === 'user'
                            ? 'text-right'
                            : 'text-left'
                        }`}
                      >
                        <span className={`inline-block max-w-[85%] ${
                          msg.sender === 'user'
                            ? 'text-blue-600'
                            : 'text-purple-700'
                        }`}>
                          <span className="font-semibold text-xs opacity-70">
                            {msg.sender === 'user' ? '나' : persona.name}:
                          </span>{' '}
                          <span className="drop-shadow-sm">{msg.message}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <Card className="rounded-2xl overflow-hidden text-card-foreground backdrop-blur-sm shadow-xl border border-white/10 bg-[#ffffff9c]">
                  
                  {/* 실시간 음성 모드 */}
                  {inputMode === 'realtime-voice' ? (
                    <>
                      {/* 대화 시작 전 또는 끊김 상태 */}
                      {realtimeVoice.status === 'disconnected' && (
                        <div className="p-4 bg-[#ffffff9c]">
                          <div className="flex flex-col items-center space-y-4 py-4">
                            {realtimeVoice.conversationPhase === 'interrupted' ? (
                              <>
                                <p className="text-sm text-orange-600">연결이 끊겼습니다. 이어서 대화할 수 있습니다.</p>
                                <Button
                                  onClick={() => {
                                    // 이전 대화 기록을 전달하여 컨텍스트 유지 (user/ai만 필터링)
                                    const previousMessages = localMessages
                                      .filter(m => m.sender === 'user' || m.sender === 'ai')
                                      .map(m => ({
                                        role: m.sender as 'user' | 'ai',
                                        content: m.message
                                      }));
                                    realtimeVoice.connect(previousMessages);
                                  }}
                                  className="bg-orange-500 hover:bg-orange-600 text-white px-8 py-6 text-lg font-semibold rounded-full shadow-lg"
                                  data-testid="button-resume-voice"
                                >
                                  <i className="fas fa-redo mr-2"></i>
                                  이어서 하기
                                </Button>
                              </>
                            ) : (
                              <>
                                <p className="text-sm text-slate-600">실시간 음성 대화를 시작하세요</p>
                                <Button
                                  onClick={() => realtimeVoice.connect()}
                                  className="bg-purple-600 hover:bg-purple-700 text-white px-8 py-6 text-lg font-semibold rounded-full shadow-lg"
                                  data-testid="button-start-voice"
                                >
                                  <i className="fas fa-phone mr-2"></i>
                                  대화 시작하기
                                </Button>
                              </>
                            )}
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
                      
                      {/* AI 인사 준비 중 상태 (캐릭터 모드 하단) */}
                      {realtimeVoice.status === 'connected' && realtimeVoice.isWaitingForGreeting && (
                        <div className="p-4 bg-[#ffffff9c]">
                          <div className="flex flex-col items-center justify-center gap-3 py-4">
                            <div className="flex items-center justify-center space-x-2">
                              <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce"></div>
                              <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                              <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                              <span className="ml-2 text-slate-600 text-sm">
                                {realtimeVoice.greetingRetryCount > 0 
                                  ? `${persona.department} ${persona.role} ${persona.name}님이 인사를 준비하고 있습니다... (재시도 ${realtimeVoice.greetingRetryCount}/3)`
                                  : `${persona.department} ${persona.role} ${persona.name}님이 인사를 준비하고 있습니다...`}
                              </span>
                            </div>
                            <Button
                              onClick={() => {
                                hasUserSpokenRef.current = true;
                                setShowMicPrompt(false);
                                setIsInputExpanded(false);
                                realtimeVoice.startRecording();
                              }}
                              size="sm"
                              className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-full text-sm"
                              data-testid="button-start-greeting-character"
                            >
                              <i className="fas fa-microphone mr-1.5"></i>
                              대화 시작하기
                            </Button>
                          </div>
                        </div>
                      )}
                      
                      {/* AI 인사 실패 - 사용자가 먼저 시작하도록 안내 (캐릭터 모드 하단) */}
                      {realtimeVoice.status === 'connected' && realtimeVoice.greetingFailed && (
                        <div className="p-4 bg-[#ffffff9c]">
                          <div className="flex items-center justify-center py-4">
                            <span className="text-orange-600 text-sm font-medium">
                              {user?.name || '회원'}님, {persona.name}님에게 먼저 인사를 건네보세요!
                            </span>
                          </div>
                        </div>
                      )}
                      
                      {/* 연결 완료 - 마이크 중심 레이아웃 */}
                      {realtimeVoice.status === 'connected' && !realtimeVoice.isWaitingForGreeting && (
                        <div className="border-t border-slate-200/30 p-4">
                          <div className="flex items-center justify-center gap-4">
                            {/* 대화 종료 버튼 - 왼쪽 */}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleEndRealtimeConversation}
                              disabled={realtimeVoice.isRecording || realtimeVoice.isAISpeaking}
                              data-testid="button-end-conversation-realtime"
                              className="text-red-600 border-red-200 hover:bg-red-50 shrink-0"
                            >
                              <i className="fas fa-stop-circle mr-1"></i>
                              종료
                            </Button>
                            
                            {/* 중앙 마이크 버튼 - 크고 강조 */}
                            <button
                              onClick={() => {
                                if (realtimeVoice.isRecording) {
                                  realtimeVoice.stopRecording();
                                } else {
                                  hasUserSpokenRef.current = true;
                                  setShowMicPrompt(false);
                                  setIsInputExpanded(false);
                                  realtimeVoice.startRecording();
                                }
                              }}
                              disabled={realtimeVoice.isAISpeaking}
                              className={`relative w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 shadow-lg ${
                                realtimeVoice.isRecording 
                                  ? 'bg-red-500 text-white scale-110' 
                                  : realtimeVoice.isAISpeaking
                                  ? 'bg-blue-500 text-white'
                                  : showMicPrompt
                                  ? 'bg-gradient-to-r from-blue-500 to-purple-500 text-white animate-bounce'
                                  : 'bg-gradient-to-r from-purple-500 to-indigo-500 text-white hover:scale-105'
                              }`}
                              data-testid="button-realtime-voice-record"
                              title={realtimeVoice.isRecording ? "음성 입력을 중지하려면 클릭하세요" : "음성 입력을 시작하려면 클릭하세요"}
                            >
                              {/* 펄스 링 효과 */}
                              {(showMicPrompt || realtimeVoice.isRecording) && !realtimeVoice.isAISpeaking && (
                                <>
                                  <span className="absolute inset-0 rounded-full bg-current animate-ping opacity-20"></span>
                                  <span className="absolute -inset-2 rounded-full bg-current opacity-10 blur-md animate-pulse"></span>
                                </>
                              )}
                              <i className={`fas text-2xl ${
                                realtimeVoice.isRecording 
                                  ? 'fa-stop' 
                                  : realtimeVoice.isAISpeaking
                                  ? 'fa-volume-up animate-pulse'
                                  : 'fa-microphone'
                              }`}></i>
                            </button>
                            
                            {/* 텍스트 입력 영역 - 동적 확장 (브라우저 너비에 맞춤) */}
                            <div className={`flex items-center gap-2 transition-all duration-300 ease-in-out overflow-hidden flex-1 ${
                              isInputExpanded ? 'max-w-full' : 'max-w-[180px]'
                            }`}>
                              <div className="relative flex-1">
                                <input
                                  type="text"
                                  value={userInput}
                                  onChange={(e) => setUserInput(e.target.value.slice(0, 200))}
                                  onFocus={() => setIsInputExpanded(true)}
                                  onBlur={() => {
                                    if (!userInput.trim()) {
                                      setIsInputExpanded(false);
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey && userInput.trim()) {
                                      e.preventDefault();
                                      handleSendMessage();
                                      setIsInputExpanded(false);
                                    }
                                  }}
                                  placeholder={isInputExpanded ? "메시지 입력... (Enter로 전송)" : "텍스트로 대화"}
                                  className={`w-full px-3 py-2 text-sm border rounded-full bg-white/80 focus:outline-none focus:ring-2 focus:ring-purple-400 transition-all ${
                                    isInputExpanded ? 'border-purple-300' : 'border-slate-200'
                                  }`}
                                  disabled={realtimeVoice.isRecording || realtimeVoice.isAISpeaking}
                                  data-testid="input-message-realtime"
                                />
                                {isInputExpanded && userInput.length > 0 && (
                                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                                    {userInput.length}/200
                                  </span>
                                )}
                              </div>
                              {isInputExpanded && userInput.trim() && (
                                <Button
                                  onClick={() => {
                                    handleSendMessage();
                                    setIsInputExpanded(false);
                                  }}
                                  disabled={!userInput.trim() || realtimeVoice.isRecording || realtimeVoice.isAISpeaking}
                                  className="bg-purple-600 hover:bg-purple-700 text-white rounded-full w-8 h-8 p-0 shrink-0"
                                  size="sm"
                                  data-testid="button-send-message-realtime"
                                >
                                  <i className="fas fa-paper-plane text-xs"></i>
                                </Button>
                              )}
                            </div>
                          </div>
                          
                          {/* 상태 표시 */}
                          {(realtimeVoice.isRecording || realtimeVoice.isAISpeaking) && (
                            <div className="text-center mt-3">
                              {realtimeVoice.isRecording && (
                                <p className="text-sm text-red-600 font-medium animate-pulse">
                                  🔴 녹음 중... 말씀이 끝나면 자동으로 전송됩니다
                                </p>
                              )}
                              {realtimeVoice.isAISpeaking && (
                                <p className="text-sm text-blue-600 font-medium animate-pulse">
                                  🔵 AI가 응답하고 있습니다...
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
                          onClick={handleGoToFeedback}
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
              </div>
            </div>
          )}
        </div>
      </div>

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
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel data-testid="button-cancel-end-conversation">
              취소
            </AlertDialogCancel>
            <Button
              variant="outline"
              onClick={handleResetConversation}
              data-testid="button-reset-conversation"
              className="border-orange-300 text-orange-600 hover:bg-orange-50"
            >
              <i className="fas fa-redo mr-1"></i>
              대화 초기화
            </Button>
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
