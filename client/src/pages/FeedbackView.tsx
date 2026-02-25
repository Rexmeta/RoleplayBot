import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import PersonalDevelopmentReport from "@/components/PersonalDevelopmentReport";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";

export default function FeedbackView() {
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const [, params] = useRoute("/feedback/:conversationId");
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

  const { effectiveScenario, effectivePersona, isScenarioMissing } = useMemo(() => {
    if (!conversation) return { effectiveScenario: null, effectivePersona: null, isScenarioMissing: false };

    if (scenario) {
      const persona = scenario.personas?.find((p: any) => p.id === conversation.personaId);
      if (persona) {
        return { effectiveScenario: scenario, effectivePersona: persona, isScenarioMissing: false };
      }
      if (conversation.personaSnapshot) {
        return { effectiveScenario: scenario, effectivePersona: conversation.personaSnapshot, isScenarioMissing: false };
      }
    }

    if (conversation.personaSnapshot || conversation.scenarioName) {
      const fallbackScenario = {
        id: conversation.scenarioId,
        title: conversation.scenarioName || conversation.scenarioId || '삭제된 시나리오',
        description: '',
        difficulty: conversation.difficulty || 2,
        personas: conversation.personaSnapshot ? [conversation.personaSnapshot] : [],
        isDeleted: true,
      };
      const fallbackPersona = conversation.personaSnapshot || {
        id: conversation.personaId,
        name: '알 수 없는 페르소나',
      };
      return { effectiveScenario: fallbackScenario, effectivePersona: fallbackPersona, isScenarioMissing: true };
    }

    return { effectiveScenario: null, effectivePersona: null, isScenarioMissing: true };
  }, [conversation, scenario]);

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

  if (!effectiveScenario || !effectivePersona) {
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

  const showDeletedBanner = effectiveScenario.isDeleted || isScenarioMissing;

  const isAdminOrOperator = currentUser?.role === 'admin' || currentUser?.role === 'operator';
  const isViewingOtherUser = isAdminOrOperator && conversation?.userId && conversation.userId !== currentUser?.id;
  const isAdminView = !!isViewingOtherUser;

  return (
    <div>
      {isAdminView && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-2 flex items-center justify-between">
          <span className="text-sm text-blue-800">관리자 열람 모드 — 읽기 전용입니다.</span>
          <Button size="sm" variant="outline" onClick={() => window.history.back()}>뒤로 가기</Button>
        </div>
      )}
      {showDeletedBanner && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-2 text-center">
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 mr-2">삭제된 시나리오</Badge>
          <span className="text-sm text-yellow-800">이 시나리오는 삭제되었지만, 피드백 리포트는 계속 열람할 수 있습니다.</span>
        </div>
      )}
      <PersonalDevelopmentReport
        scenario={effectiveScenario}
        persona={effectivePersona}
        conversationId={conversationId || ""}
        onRetry={() => window.location.reload()}
        onSelectNewScenario={() => window.location.href = '/home'}
        isAdminView={isAdminView}
      />
    </div>
  );
}
