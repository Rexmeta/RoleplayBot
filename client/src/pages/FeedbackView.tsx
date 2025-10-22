import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import PersonalDevelopmentReport from "@/components/PersonalDevelopmentReport";
import { type Conversation } from "@shared/schema";
import { getComplexScenarioById, getPersonaById } from "@/lib/scenario-system";

export default function FeedbackView() {
  const [, params] = useRoute("/feedback/:conversationId");
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
          <p className="text-gray-600">피드백을 불러오는 중...</p>
        </div>
      </div>
    );
  }

  const scenario = getComplexScenarioById(conversation.scenarioId || "");
  const persona = getPersonaById(conversation.personaId || "");

  if (!scenario || !persona) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <p className="text-red-600">시나리오 또는 페르소나를 찾을 수 없습니다.</p>
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
