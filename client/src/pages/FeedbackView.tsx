import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import PersonalDevelopmentReport from "@/components/PersonalDevelopmentReport";
import { Button } from "@/components/ui/button";
import { type Conversation } from "@shared/schema";
import { useTranslation } from "react-i18next";

export default function FeedbackView() {
  const { t } = useTranslation();
  const [, params] = useRoute("/feedback/:conversationId");
  const conversationId = params?.conversationId;

  const { data: conversation, isLoading: conversationLoading } = useQuery<Conversation>({
    queryKey: ["/api/conversations", conversationId],
    enabled: !!conversationId,
    staleTime: 1000 * 60 * 5, // 5분간 캐시 유지
    gcTime: 1000 * 60 * 10,   // 10분간 메모리 유지
  });

  // 서버에서 모든 시나리오 데이터 가져오기
  const { data: scenarios = [], isLoading: scenariosLoading } = useQuery<any[]>({
    queryKey: ["/api/scenarios"],
    staleTime: 1000 * 60 * 30, // 30분간 캐시 유지 (시나리오는 자주 변경되지 않음)
    gcTime: 1000 * 60 * 60,     // 1시간 메모리 유지
  });

  // ⚡ 성능 최적화: Map 기반 O(1) 조회
  const scenariosMap = useMemo(() => 
    new Map(scenarios.map(s => [s.id, s])),
    [scenarios]
  );

  const isLoading = conversationLoading || scenariosLoading;

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

  // ⚡ 서버 데이터에서 시나리오와 페르소나 찾기 (O(1) 조회)
  const scenario = scenariosMap.get(conversation.scenarioId);
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
    <PersonalDevelopmentReport
      scenario={scenario}
      persona={persona}
      conversationId={conversationId || ""}
      onRetry={() => window.location.reload()}
      onSelectNewScenario={() => window.location.href = '/home'}
    />
  );
}
