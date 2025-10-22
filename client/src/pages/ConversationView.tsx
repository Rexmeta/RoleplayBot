import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { type Conversation, type ConversationMessage } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { format } from "date-fns";

export default function ConversationView() {
  const [, params] = useRoute("/chat/:conversationId");
  const conversationId = params?.conversationId;

  const { data: conversation, isLoading: conversationLoading } = useQuery<Conversation>({
    queryKey: ["/api/conversations", conversationId],
    enabled: !!conversationId,
  });

  // 서버에서 모든 시나리오 데이터 가져오기
  const { data: scenarios, isLoading: scenariosLoading } = useQuery<any[]>({
    queryKey: ["/api/scenarios"],
  });

  const isLoading = conversationLoading || scenariosLoading;

  if (isLoading || !conversation || !scenarios) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">대화를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  // 서버 데이터에서 시나리오와 페르소나 찾기
  const scenario = scenarios.find(s => s.id === conversation.scenarioId);
  const persona = scenario?.personas?.find((p: any) => p.id === conversation.personaId);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="max-w-4xl mx-auto p-6">
        <div className="mb-6 flex items-center justify-between">
          <Button
            variant="outline"
            onClick={() => window.location.href = '/mypage'}
            data-testid="back-button"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            마이페이지로 돌아가기
          </Button>
          {conversation.status === 'completed' && (
            <Button
              onClick={() => window.location.href = `/feedback/${conversationId}`}
              data-testid="view-feedback-button"
            >
              피드백 보기
            </Button>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5" />
              대화 기록 - {scenario?.title || conversation.scenarioId || '시나리오'}
            </CardTitle>
            <div className="text-sm text-slate-600">
              대화 상대: {persona ? [persona.department, persona.name, persona.role].filter(Boolean).join(' ') : '알 수 없음'}
            </div>
            <div className="text-xs text-slate-500">
              {format(new Date(conversation.createdAt), 'yyyy년 MM월 dd일 HH:mm')}
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {conversation.messages.map((message: ConversationMessage, index: number) => (
                <div
                  key={index}
                  className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                  data-testid={`message-${index}`}
                >
                  <div
                    className={`max-w-[70%] rounded-lg px-4 py-3 ${
                      message.sender === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 text-slate-900'
                    }`}
                  >
                    {message.sender !== 'user' && (
                      <div className="font-semibold text-sm mb-1">
                        {persona ? [persona.department, persona.name, persona.role].filter(Boolean).join(' ') : '대화 상대'}
                      </div>
                    )}
                    <div className="whitespace-pre-wrap">{message.message}</div>
                    {message.emotion && message.sender !== 'user' && (
                      <div className="text-xs mt-2 opacity-75">
                        감정: {message.emotion}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
