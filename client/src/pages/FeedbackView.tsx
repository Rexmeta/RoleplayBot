import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import PersonalDevelopmentReport from "@/components/PersonalDevelopmentReport";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { type Conversation } from "@shared/schema";
import { useTranslation } from "react-i18next";

export default function FeedbackView() {
  const { t } = useTranslation();
  const [, params] = useRoute("/feedback/:conversationId");
  const conversationId = params?.conversationId;

  const { data: conversation, isLoading: conversationLoading } = useQuery<Conversation>({
    queryKey: ["/api/conversations", conversationId],
    enabled: !!conversationId,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  });

  const { data: scenario, isLoading: scenarioLoading } = useQuery<any>({
    queryKey: ["/api/scenarios", conversation?.scenarioId],
    enabled: !!conversation?.scenarioId,
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
  });

  const isLoading = conversationLoading || scenarioLoading;

  if (isLoading || !conversation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">{t('feedback.loading')}</p>
        </div>
      </div>
    );
  }

  const persona = scenario?.personas?.find((p: any) => p.id === conversation.personaId);

  if (!scenario || !persona) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <p className="text-red-600">{t('feedback.scenarioNotFound')}</p>
          <p className="text-sm text-gray-500 mt-2">
            Scenario ID: {conversation.scenarioId}, Persona ID: {conversation.personaId}
          </p>
          <Button 
            onClick={() => window.location.href = '/mypage'}
            className="mt-4"
          >
            {t('conversation.backToMyPage')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {scenario.isDeleted && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-2 text-center">
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 mr-2">삭제된 시나리오</Badge>
          <span className="text-sm text-yellow-800">이 시나리오는 삭제되었지만, 피드백 리포트는 계속 열람할 수 있습니다.</span>
        </div>
      )}
      <PersonalDevelopmentReport
        scenario={scenario}
        persona={persona}
        conversationId={conversationId || ""}
        onRetry={() => window.location.reload()}
        onSelectNewScenario={() => window.location.href = '/home'}
      />
    </div>
  );
}
