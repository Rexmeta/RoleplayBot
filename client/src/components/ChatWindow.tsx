import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Scenario } from "@/lib/scenarios";
import type { Conversation, ConversationMessage } from "@shared/schema";

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

interface ChatWindowProps {
  scenario: Scenario;
  conversationId: string;
  onChatComplete: () => void;
  onExit: () => void;
}

export default function ChatWindow({ scenario, conversationId, onChatComplete, onExit }: ChatWindowProps) {
  const [userInput, setUserInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [voiceModeEnabled, setVoiceModeEnabled] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const speechSynthesisRef = useRef<SpeechSynthesis | null>(null);
  const lastSpokenMessageRef = useRef<string>("");

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const maxTurns = 10;

  const { data: conversation, error } = useQuery<Conversation>({
    queryKey: ["/api/conversations", conversationId],
    enabled: !!conversationId,
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (message: string) => {
      const response = await apiRequest("POST", `/api/conversations/${conversationId}/messages`, {
        message
      });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations", conversationId] });
      setIsLoading(false);
      
      // 음성 모드가 활성화되어 있고 AI 응답이 있으면 음성으로 읽기
      if (voiceModeEnabled && data.messages) {
        const lastMessage = data.messages[data.messages.length - 1];
        if (lastMessage && lastMessage.sender === 'ai') {
          speakMessage(lastMessage.message, true);
        }
      }
    },
    onError: () => {
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

    setIsLoading(true);
    setUserInput("");
    sendMessageMutation.mutate(message);
  };

  const handleSkipTurn = () => {
    if (isLoading) return;
    handleSendMessage();
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

  // TTS 기능들
  const speakMessage = (text: string, isAutoPlay: boolean = false) => {
    if (!speechSynthesisRef.current) return;
    
    // 음성 모드가 꺼져있고 자동재생인 경우 실행하지 않음
    if (!voiceModeEnabled && isAutoPlay) return;
    
    // 이미 같은 메시지를 재생했다면 중복 재생 방지 (자동재생의 경우만)
    if (isAutoPlay && lastSpokenMessageRef.current === text) return;
    
    // 기존 음성 정지
    speechSynthesisRef.current.cancel();
    
    // 텍스트 정리 (HTML 태그, 특수 문자 제거)
    const cleanText = text.replace(/<[^>]*>/g, '').replace(/[*#_`]/g, '');
    
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'ko-KR';
    utterance.rate = 0.9; // 조금 느리게
    utterance.pitch = 1.0;
    utterance.volume = 0.8;
    
    utterance.onstart = () => {
      setIsSpeaking(true);
      if (isAutoPlay) {
        lastSpokenMessageRef.current = text;
      }
    };
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => {
      setIsSpeaking(false);
      toast({
        title: "음성 재생 오류",
        description: "음성을 재생할 수 없습니다.",
        variant: "destructive"
      });
    };
    
    speechSynthesisRef.current.speak(utterance);
  };

  const stopSpeaking = () => {
    if (speechSynthesisRef.current) {
      speechSynthesisRef.current.cancel();
      setIsSpeaking(false);
    }
  };

  const toggleVoiceMode = () => {
    if (voiceModeEnabled) {
      stopSpeaking();
      lastSpokenMessageRef.current = ""; // 음성 모드 끌 때 재생 기록 초기화
    }
    setVoiceModeEnabled(!voiceModeEnabled);
  };

  // TTS 기능 초기화
  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      speechSynthesisRef.current = window.speechSynthesis;
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

  // 메시지 스크롤 및 음성 자동 재생
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    
    // 음성 모드가 켜져 있을 때 새로운 AI 메시지 자동 재생
    if (voiceModeEnabled && conversation?.messages) {
      const lastMessage = conversation.messages[conversation.messages.length - 1];
      if (lastMessage && lastMessage.sender === 'ai' && !isLoading) {
        // 약간의 지연을 두어 UI 업데이트 후 음성 재생
        setTimeout(() => {
          speakMessage(lastMessage.message, true);
        }, 500);
      }
    }
  }, [conversation?.messages, voiceModeEnabled, isLoading]);

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === "Enter" && e.ctrlKey) {
        handleSendMessage();
      }
    };

    document.addEventListener("keypress", handleKeyPress);
    return () => document.removeEventListener("keypress", handleKeyPress);
  }, [userInput, isLoading]);

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
    const messages = conversation.messages;
    const userMessages = messages.filter(m => m.sender === "user");
    
    if (userMessages.length === 0) return 0;
    
    let totalScore = 0;
    let scoreCount = 0;
    
    // 각 사용자 메시지에 대한 실시간 평가
    userMessages.forEach((message, index) => {
      let messageScore = 0;
      const content = message.message.toLowerCase();
      
      // 1. 메시지 길이 및 구조 (25점 만점)
      if (content.length >= 20) messageScore += 5; // 적절한 길이
      if (content.includes('?') || content.includes('요청') || content.includes('문의')) messageScore += 5; // 질문/요청 구조
      if (content.split('.').length > 1 || content.split(',').length > 1) messageScore += 5; // 문장 구조
      if (!/^[ㄱ-ㅎ가-힣a-zA-Z\s]+$/.test(content.replace(/[.?!,]/g, ''))) messageScore -= 5; // 이상한 문자 패턴 감점
      if (content.length < 5) messageScore -= 10; // 너무 짧은 메시지 대폭 감점
      
      // 2. 공감적 표현 (20점 만점)
      const empathyKeywords = ['이해', '죄송', '미안', '걱정', '힘드', '어려우', '도움', '지원', '함께'];
      const empathyCount = empathyKeywords.filter(keyword => content.includes(keyword)).length;
      messageScore += Math.min(20, empathyCount * 4);
      
      // 3. 전문성 및 해결책 제시 (25점 만점)
      const professionalKeywords = ['계획', '방안', '제안', '검토', '분석', '개선', '해결', '대안', '전략'];
      const professionalCount = professionalKeywords.filter(keyword => content.includes(keyword)).length;
      messageScore += Math.min(25, professionalCount * 5);
      
      // 4. 의사소통 적절성 (20점 만점)
      if (content.includes('습니다') || content.includes('입니다')) messageScore += 10; // 정중한 어투
      if (content.includes('~요') || content.includes('~네요')) messageScore += 5; // 친근한 어투
      if (content.includes('제가') || content.includes('저는')) messageScore += 5; // 주체 명확성
      
      // 5. 상황 적응력 (10점 만점)
      const scenarioKeywords: Record<string, string[]> = {
        'communication': ['보고', '전달', '설명'],
        'empathy': ['공감', '이해', '위로'],
        'negotiation': ['협상', '조정', '타협'],
        'presentation': ['발표', '설명', '제시'],
        'feedback': ['피드백', '조언', '개선'],
        'crisis': ['긴급', '대응', '해결']
      };
      
      const relevantKeywords = scenarioKeywords[scenario.id] || [];
      const relevanceCount = relevantKeywords.filter((keyword: string) => content.includes(keyword)).length;
      messageScore += Math.min(10, relevanceCount * 3);
      
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

  return (
    <div className="chat-window">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Chat Header */}
        <div className="bg-gradient-to-r from-corporate-600 to-corporate-700 px-6 py-4 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <img 
                src={scenario.image} 
                alt={scenario.name} 
                className="w-12 h-12 rounded-full border-2 border-white/20" 
                onError={(e) => {
                  (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${encodeURIComponent(scenario.name)}&background=6366f1&color=fff&size=48`;
                }}
              />
              <div>
                <h3 className="text-lg font-semibold">{scenario.name}과의 대화</h3>
                <p className="text-blue-100 text-sm">{scenario.skills.join(", ")} 훈련 시나리오</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="text-right">
                <div className="text-sm opacity-90">진행도</div>
                <div className="text-xl font-bold">{conversation.turnCount}/{maxTurns}</div>
              </div>
              
              {/* 음성 모드 토글 */}
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

        {/* Chat Messages Area */}
        <div className="h-96 overflow-y-auto p-6 space-y-4 bg-slate-50/50" data-testid="chat-messages">
          {conversation.messages.map((message: ConversationMessage, index: number) => (
            <div
              key={index}
              className={`flex items-start space-x-3 ${
                message.sender === "user" ? "justify-end" : ""
              }`}
            >
              {message.sender === "ai" && (
                <div className="relative">
                  <img 
                    src={scenario.image} 
                    alt="AI" 
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
                        onClick={() => speakMessage(message.message)}
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
              <img src={scenario.image} alt="AI" className="w-8 h-8 rounded-full" />
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
              <div className="text-sm text-slate-500">
                총 {conversation.turnCount}턴의 대화를 나누었습니다.
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
      </div>

      {/* Chat Controls & Info */}
      <div className="mt-6 grid md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg p-4 border border-slate-200">
          <h4 className="font-medium text-slate-900 mb-2 flex items-center">
            <i className="fas fa-target text-corporate-600 mr-2"></i>
            목표
          </h4>
          <p className="text-sm text-slate-600">
            {scenario.name}과 건설적인 대화를 통해 {scenario.skills.join(", ")} 역량을 개발하세요.
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
    </div>
  );
}
