import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { type Conversation, type ConversationMessage } from "@shared/schema";
import { getComplexScenarioById, getPersonaById } from "@/lib/scenario-system";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { format } from "date-fns";

export default function ConversationView() {
  const [, params] = useRoute("/chat/:conversationId");
  const conversationId = params?.conversationId;

  const { data: conversation, isLoading } = useQuery<Conversation>({
    queryKey: ["/api/conversations", conversationId],
    enabled: !!conversationId,
  });

  if (isLoading || !conversation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">대화를 불러오는 중...</p>
        </div>
      </div>
    );
  }

  const scenario = getComplexScenarioById(conversation.scenarioId || "");
  const persona = getPersonaById(conversation.personaId || "");

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
              대화 기록 - {persona?.name || '알 수 없음'}
            </CardTitle>
            <div className="text-sm text-slate-600">
              {scenario?.title || conversation.scenarioId}
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
                        {persona?.name || 'AI'}
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
