import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { type ConversationMessage } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";

export default function ConversationView() {
  const { t } = useTranslation();
  const [, params] = useRoute("/chat/:conversationId");
  const conversationId = params?.conversationId;

  const { data: conversation, isLoading: conversationLoading } = useQuery<any>({
    queryKey: ["/api/conversations", conversationId],
    enabled: !!conversationId,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  });

  const { data: scenario, isLoading: scenarioLoading, isError: scenarioError } = useQuery<any>({
    queryKey: ["/api/scenarios", conversation?.scenarioId],
    enabled: !!conversation?.scenarioId,
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
    retry: false,
  });

  const isLoading = conversationLoading || (scenarioLoading && !scenarioError);

  const { effectiveTitle, effectivePersonaLabel, isScenarioMissing } = useMemo(() => {
    if (!conversation) return { effectiveTitle: '', effectivePersonaLabel: '', isScenarioMissing: false };

    let title = '';
    let personaLabel = '';
    let missing = false;

    if (scenario) {
      title = scenario.title;
      const persona = scenario.personas?.find((p: any) => p.id === conversation.personaId);
      if (persona) {
        personaLabel = [persona.department, persona.name, persona.role].filter(Boolean).join(' ');
      }
    }

    if (!title) {
      title = conversation.scenarioName || conversation.scenarioId || '삭제된 시나리오';
      missing = true;
    }

    if (!personaLabel && conversation.personaSnapshot) {
      const ps = conversation.personaSnapshot;
      personaLabel = [ps.department, ps.name, ps.role].filter(Boolean).join(' ');
    }

    if (!personaLabel) {
      personaLabel = t('common.unknown');
    }

    return { effectiveTitle: title, effectivePersonaLabel: personaLabel, isScenarioMissing: missing };
  }, [conversation, scenario, t]);

  if (isLoading || !conversation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">{t('conversation.loading')}</p>
        </div>
      </div>
    );
  }

  const showDeletedBanner = scenario?.isDeleted || isScenarioMissing;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="max-w-4xl mx-auto p-6">
        {showDeletedBanner && (
          <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2 text-center">
            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 mr-2">삭제된 시나리오</Badge>
            <span className="text-sm text-yellow-800">이 시나리오는 삭제되었지만, 대화 기록은 계속 열람할 수 있습니다.</span>
          </div>
        )}
        <div className="mb-6 flex items-center justify-between">
          <Button
            variant="outline"
            onClick={() => window.location.href = '/mypage'}
            data-testid="back-button"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            {t('conversation.backToMyPage')}
          </Button>
          {conversation.status === 'completed' && (
            <Button
              onClick={() => window.location.href = `/feedback/${conversationId}`}
              data-testid="view-feedback-button"
            >
              {t('conversation.viewFeedback')}
            </Button>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5" />
              {t('conversation.history')} - {effectiveTitle}
            </CardTitle>
            <div className="text-sm text-slate-600">
              {t('conversation.partner')}: {effectivePersonaLabel}
            </div>
            <div className="text-xs text-slate-500">
              {format(new Date(conversation.createdAt), 'yyyy년 MM월 dd일 HH:mm')}
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {conversation.messages.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p className="text-lg font-medium">{t('conversation.noMessages')}</p>
                  <p className="text-sm mt-2">{t('conversation.noMessagesHint')}</p>
                </div>
              ) : (
                conversation.messages.map((message: ConversationMessage, index: number) => (
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
                          {effectivePersonaLabel}
                        </div>
                      )}
                      <div className="whitespace-pre-wrap">{message.message}</div>
                      {message.emotion && message.sender !== 'user' && (
                        <div className="text-xs mt-2 opacity-75">
                          {t('conversation.emotion')}: {message.emotion}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
