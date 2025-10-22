import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import PersonalDevelopmentReport from "@/components/PersonalDevelopmentReport";
import { Button } from "@/components/ui/button";
import { type Conversation } from "@shared/schema";

export default function FeedbackView() {
  const [, params] = useRoute("/feedback/:conversationId");
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
          <p className="text-gray-600">피드백을 불러오는 중...</p>
        </div>
      </div>
    );
  }

  // 서버 데이터에서 시나리오와 페르소나 찾기
  const scenario = scenarios.find(s => s.id === conversation.scenarioId);
  const persona = scenario?.personas?.find((p: any) => p.id === conversation.personaId);

  if (!scenario || !persona) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <p className="text-red-600">시나리오 또는 페르소나를 찾을 수 없습니다.</p>
          <p className="text-sm text-gray-500 mt-2">
            Scenario ID: {conversation.scenarioId}, Persona ID: {conversation.personaId}
          </p>
          <Button 
            onClick={() => window.location.href = '/mypage'}
            className="mt-4"
          >
            마이페이지로 돌아가기
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
