import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ComplexScenario, ScenarioPersona } from "@/lib/scenario-system";
import type { Conversation, ConversationMessage } from "@shared/schema";
import { MessageSquare, Mic, Volume2, VolumeX, PhoneOff } from "lucide-react";

// 감정 이모지 매핑
const emotionEmojis: { [key: string]: string } = {
  '기쁨': '😊',
  '슬픔': '😢',
  '분노': '😠',
  '놀람': '😲',
  '중립': '😐'
};

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

interface TextChatWindowProps {
  scenario: ComplexScenario;
  persona: ScenarioPersona;
  conversationId: string;
  onChatComplete: () => void;
  onExit: () => void;
}

export default function TextChatWindow({
  scenario,
  persona,
  conversationId,
  onChatComplete,
  onExit,
}: TextChatWindowProps) {
  const [userInput, setUserInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [inputMode, setInputMode] = useState<'text' | 'tts'>('text');
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const lastSpokenMessageRef = useRef<string>("");

  const queryClient = useQueryClient();
  const { toast } = useToast();

  // 대화 데이터 조회
  const { data: conversation } = useQuery<Conversation>({
    queryKey: ['/api/conversations', conversationId],
    refetchInterval: inputMode === 'tts' ? 3000 : false,
  });

  // 시간 추적
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedTime(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Web Speech API 초기화
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      setSpeechSupported(true);
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'ko-KR';

      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setUserInput(prev => prev + (prev ? ' ' : '') + transcript);
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsRecording(false);
      };

      recognition.onend = () => {
        setIsRecording(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  // 메시지 자동 스크롤
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation?.messages]);

  // TTS 자동 재생
  useEffect(() => {
    if (inputMode !== 'tts' || !conversation?.messages) return;

    const lastMessage = conversation.messages[conversation.messages.length - 1];
    if (lastMessage?.sender === 'ai' && lastMessage.message !== lastSpokenMessageRef.current) {
      speakMessage(lastMessage.message, lastMessage.emotion);
    }
  }, [conversation?.messages, inputMode]);

  const speakMessage = async (text: string, emotion?: string) => {
    stopSpeaking();
    
    try {
      setIsSpeaking(true);
      lastSpokenMessageRef.current = text;

      const response = await fetch('/api/tts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          scenarioId: persona.id,
          emotion: emotion || '중립'
        }),
      });

      if (!response.ok) throw new Error('TTS 생성 실패');

      const data = await response.json();
      const audioBlob = new Blob(
        [Uint8Array.from(atob(data.audio), c => c.charCodeAt(0))], 
        { type: 'audio/mpeg' }
      );
      
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      currentAudioRef.current = audio;
      
      audio.onended = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
        currentAudioRef.current = null;
      };
      
      audio.onerror = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(audioUrl);
        currentAudioRef.current = null;
      };

      await audio.play();
    } catch (error) {
      setIsSpeaking(false);
      console.error('TTS 오류:', error);
    }
  };

  const stopSpeaking = () => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
      setIsSpeaking(false);
    }
  };

  const handleVoiceInput = () => {
    if (!recognitionRef.current) return;

    if (isRecording) {
      recognitionRef.current.stop();
    } else {
      recognitionRef.current.start();
      setIsRecording(true);
    }
  };

  const sendMessageMutation = useMutation({
    mutationFn: async (message: string) => {
      const response = await apiRequest("POST", `/api/conversations/${conversationId}/messages`, {
        message,
        sender: "user"
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/conversations', conversationId] });
      setUserInput("");
    },
    onError: (error) => {
      toast({
        title: "메시지 전송 실패",
        description: error instanceof Error ? error.message : "알 수 없는 오류",
        variant: "destructive"
      });
    },
  });

  const handleSendMessage = async () => {
    if (!userInput.trim()) return;

    setIsLoading(true);
    await sendMessageMutation.mutateAsync(userInput);
    setIsLoading(false);
  };

  const maxTurns = 10;
  const currentTurn = conversation?.turnCount || 0;
  const isConversationComplete = currentTurn >= maxTurns;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-gradient-to-r from-corporate-600 to-corporate-700 px-6 py-4 text-white">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <img 
              src={persona.image} 
              alt={persona.name} 
              className="w-12 h-12 rounded-full border-2 border-white/20" 
            />
            <div>
              <h3 className="text-lg font-semibold">{persona.name}과의 대화</h3>
              <p className="text-blue-100 text-sm">{scenario.title}</p>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 text-sm">
              <span>⏱️ {formatTime(elapsedTime)}</span>
              <span className="text-white/60">|</span>
              <span>💬 {currentTurn}/{maxTurns}턴</span>
            </div>
            <ToggleGroup 
              type="single" 
              value={inputMode} 
              onValueChange={(value) => value && setInputMode(value as 'text' | 'tts')}
            >
              <ToggleGroupItem value="text" aria-label="텍스트 모드">
                <MessageSquare className="w-4 h-4 mr-2" />
                텍스트
              </ToggleGroupItem>
              <ToggleGroupItem value="tts" aria-label="TTS 모드">
                <Volume2 className="w-4 h-4 mr-2" />
                음성
              </ToggleGroupItem>
            </ToggleGroup>
            <Button
              variant="outline"
              onClick={onExit}
              className="text-white border-white/20 hover:bg-white/10"
              data-testid="button-exit"
            >
              <PhoneOff className="w-4 h-4 mr-2" />
              종료
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl mx-auto w-full p-6 flex flex-col">
        {/* Progress Bar */}
        <div className="mb-4">
          <div className="w-full bg-slate-200 rounded-full h-2">
            <div 
              className="bg-corporate-600 h-2 rounded-full transition-all"
              style={{ width: `${(currentTurn / maxTurns) * 100}%` }}
            />
          </div>
        </div>

        {/* Messages */}
        <Card className="flex-1 p-6 overflow-y-auto mb-4 bg-white">
          <div className="space-y-4">
            {conversation?.messages?.map((message: ConversationMessage, index: number) => (
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
                      className="w-10 h-10 rounded-full" 
                    />
                    {message.emotion && (
                      <div 
                        className="absolute -bottom-1 -right-1 text-sm bg-white rounded-full w-6 h-6 flex items-center justify-center border border-gray-200"
                        title={message.emotionReason || message.emotion}
                      >
                        {emotionEmojis[message.emotion] || '😐'}
                      </div>
                    )}
                  </div>
                )}
                
                <div className={`flex-1 ${message.sender === "user" ? "flex justify-end" : ""}`}>
                  <div className={`rounded-lg p-4 max-w-lg ${
                    message.sender === "user"
                      ? "bg-corporate-600 text-white rounded-tr-none"
                      : "bg-slate-100 text-slate-800 rounded-tl-none"
                  }`}>
                    <p>{message.message}</p>
                    {message.sender === "ai" && inputMode === 'tts' && (
                      <button
                        onClick={() => speakMessage(message.message, message.emotion)}
                        className="mt-2 text-sm text-corporate-600 hover:text-corporate-700 flex items-center"
                        disabled={isSpeaking}
                      >
                        {isSpeaking ? (
                          <><VolumeX className="w-4 h-4 mr-1" /> 재생 중...</>
                        ) : (
                          <><Volume2 className="w-4 h-4 mr-1" /> 다시 듣기</>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </Card>

        {/* Input Area */}
        {!isConversationComplete && (
          <Card className="p-4">
            <div className="flex space-x-4">
              <div className="flex-1">
                <Textarea
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  placeholder="메시지를 입력하세요..."
                  maxLength={200}
                  rows={3}
                  className="resize-none"
                  disabled={isLoading}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  data-testid="input-message"
                />
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-slate-500">{userInput.length}/200</span>
                  {inputMode === 'tts' && (
                    <span className="text-xs text-green-600">🔊 음성 응답 활성화됨</span>
                  )}
                  {isRecording && (
                    <span className="text-xs text-red-600 animate-pulse">🎤 음성 인식 중...</span>
                  )}
                </div>
              </div>
              <div className="flex flex-col space-y-2">
                <Button
                  onClick={handleSendMessage}
                  disabled={!userInput.trim() || isLoading}
                  className="bg-corporate-600 hover:bg-corporate-700"
                  data-testid="button-send"
                >
                  <MessageSquare className="w-4 h-4 mr-2" />
                  전송
                </Button>
                {speechSupported && (
                  <Button
                    variant="outline"
                    onClick={handleVoiceInput}
                    disabled={isLoading}
                    className={isRecording ? 'bg-red-50 border-red-300 text-red-700 animate-pulse' : ''}
                    data-testid="button-voice-input"
                  >
                    <Mic className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
          </Card>
        )}

        {/* Completion Message */}
        {isConversationComplete && (
          <Card className="p-6 text-center bg-green-50 border-green-200">
            <h3 className="text-xl font-bold text-green-800 mb-2">🎉 대화 완료!</h3>
            <p className="text-green-700 mb-4">총 {currentTurn}턴의 대화를 마쳤습니다.</p>
            <Button onClick={onChatComplete} data-testid="button-view-feedback">
              피드백 확인하기
            </Button>
          </Card>
        )}
      </main>
    </div>
  );
}
