import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Scenario } from "@/lib/scenarios";
import type { Conversation, ConversationMessage } from "@shared/schema";

interface ChatWindowProps {
  scenario: Scenario;
  conversationId: string;
  onChatComplete: () => void;
  onExit: () => void;
}

export default function ChatWindow({ scenario, conversationId, onChatComplete, onExit }: ChatWindowProps) {
  const [userInput, setUserInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
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
      if (data.isCompleted) {
        setTimeout(() => {
          onChatComplete();
        }, 1000);
      }
      setIsLoading(false);
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversation?.messages]);

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

  const currentScore = Math.min(10, Math.max(0, 8.5 - (conversation.turnCount * 0.2)));
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
        <div className="h-96 overflow-y-auto p-6 space-y-4" data-testid="chat-messages">
          {conversation.messages.map((message: ConversationMessage, index: number) => (
            <div
              key={index}
              className={`flex items-start space-x-3 ${
                message.sender === "user" ? "justify-end" : ""
              }`}
            >
              {message.sender === "ai" && (
                <img 
                  src={scenario.image} 
                  alt="AI" 
                  className="w-8 h-8 rounded-full" 
                />
              )}
              
              <div className={`flex-1 ${message.sender === "user" ? "flex justify-end" : ""}`}>
                <div className={`rounded-lg p-3 max-w-md ${
                  message.sender === "user"
                    ? "bg-corporate-600 text-white rounded-tr-none"
                    : "bg-slate-100 rounded-tl-none"
                }`}>
                  <p className={message.sender === "user" ? "text-white" : "text-slate-800"}>
                    {message.message}
                  </p>
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
              <div className="bg-slate-100 rounded-lg rounded-tl-none p-3 max-w-md">
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
          <div className="flex space-x-4">
            <div className="flex-1">
              <Textarea
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                placeholder="메시지를 입력하세요... (최대 200자)"
                maxLength={200}
                rows={3}
                className="resize-none"
                disabled={isLoading || conversation.status === "completed"}
                data-testid="input-message"
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-slate-500">{userInput.length}/200</span>
                <div className="flex items-center space-x-2 text-xs text-slate-500">
                  <span>팁: 구체적이고 예의 바른 답변을 해보세요</span>
                  <i className="fas fa-info-circle"></i>
                </div>
              </div>
            </div>
            <div className="flex flex-col space-y-2">
              <Button
                onClick={handleSendMessage}
                disabled={!userInput.trim() || isLoading || conversation.status === "completed"}
                data-testid="button-send-message"
              >
                <i className="fas fa-paper-plane mr-2"></i>
                전송
              </Button>
              <Button
                variant="outline"
                onClick={handleSkipTurn}
                disabled={isLoading || conversation.status === "completed"}
                data-testid="button-skip-turn"
              >
                건너뛰기
              </Button>
            </div>
          </div>
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
          <p className="text-2xl font-bold text-green-600">{currentScore.toFixed(1)}/10</p>
          <p className="text-xs text-slate-500">실시간 예상 점수</p>
        </div>
      </div>
    </div>
  );
}
