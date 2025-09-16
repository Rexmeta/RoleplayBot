import { storage } from "./storage";
import type { ConversationMessage, EvaluationScore, DetailedFeedback } from "../shared/schema";

export async function createSampleData() {
  // Only create sample data if no data exists
  const existingConversations = await storage.getAllConversations();
  if (existingConversations.length > 0) {
    return; // Data already exists
  }

  console.log("Creating sample training data for demonstration...");

  // Sample conversation messages
  const sampleMessages: ConversationMessage[] = [
    { sender: "ai", message: "안녕하세요! 오늘 프로젝트 진행 상황에 대해 논의하고 싶습니다.", timestamp: new Date().toISOString(), emotion: "중립😐", emotionReason: "업무적인 대화를 시작하는 차분한 상태" },
    { sender: "user", message: "네, 좋습니다. 현재 진행 상황을 말씀드리겠습니다.", timestamp: new Date().toISOString() },
    { sender: "ai", message: "그런데 예상보다 진행이 늦은 것 같은데, 어떤 문제가 있나요?", timestamp: new Date().toISOString(), emotion: "걱정😟", emotionReason: "프로젝트 지연에 대한 우려가 나타남" },
    { sender: "user", message: "기술적인 이슈가 몇 가지 있었지만 거의 해결했습니다.", timestamp: new Date().toISOString() },
    { sender: "ai", message: "다행이네요. 앞으로 일정은 어떻게 관리할 계획인가요?", timestamp: new Date().toISOString(), emotion: "기쁨😊", emotionReason: "문제 해결 소식에 안도하는 모습" }
  ];

  // Sample evaluation scores
  const sampleScores: EvaluationScore[] = [
    { category: "clarity", name: "메시지 명확성", score: 4, feedback: "명확하고 체계적인 설명으로 상대방이 이해하기 쉽게 전달했습니다.", icon: "🎯", color: "blue" },
    { category: "adaptation", name: "청자 적응성", score: 3, feedback: "상대방의 입장을 어느 정도 고려했으나, 더 적극적인 배려가 필요합니다.", icon: "🤝", color: "green" },
    { category: "emotional", name: "감정적 반응성", score: 4, feedback: "상대방의 감정 변화를 잘 인식하고 적절히 대응했습니다.", icon: "❤️", color: "red" },
    { category: "structure", name: "대화 구조화", score: 3, feedback: "논리적인 구조를 갖추었으나 결론 부분이 더 강화되면 좋겠습니다.", icon: "🏗️", color: "purple" },
    { category: "professional", name: "전문성", score: 4, feedback: "업무 상황에 적합한 전문적이고 신뢰할 만한 커뮤니케이션을 보여주었습니다.", icon: "👔", color: "navy" }
  ];

  const sampleFeedback: DetailedFeedback = {
    overallScore: 65,
    scores: sampleScores,
    summary: "전반적으로 체계적이고 전문적인 커뮤니케이션을 보여주었습니다.",
    strengths: [
      "문제 상황에 대해 구체적이고 명확한 설명을 제공했습니다",
      "상대방의 감정 변화를 인식하고 적절히 반응했습니다",
      "전문적이면서도 친근한 톤을 유지했습니다"
    ],
    improvements: [
      "더 구체적인 해결 방안과 일정을 제시하면 좋겠습니다",
      "상대방의 우려사항에 대해 더 적극적으로 공감하고 안심시켜주세요",
      "결론 부분에서 다음 단계에 대한 명확한 계획을 제시해보세요"
    ],
    nextSteps: [
      "구체적인 프로젝트 일정과 마일스톤을 공유해보세요",
      "정기적인 진행 상황 보고 체계를 제안해보세요",
      "예상 리스크와 대응 방안을 미리 준비해보세요"
    ],
    ranking: "상급자 수준의 체계적인 커뮤니케이션 능력을 보여주었습니다. 몇 가지 개선사항을 보완하면 더욱 완성도 높은 대화가 될 것입니다."
  };

  // Create sample conversations for different scenarios
  // 실제 시나리오 파일에서 시나리오 정보 가져오기
  const fileManagerModule = await import('./services/fileManager');
  const realScenarios = await fileManagerModule.fileManager.getAllScenarios();
  
  // 실제 시나리오가 있으면 그것을 사용, 없으면 기본값 사용
  const scenarios = realScenarios.length > 0 ? realScenarios.map(s => ({ 
    id: s.id, 
    name: s.title 
  })) : [
    { id: "app-delay-crisis", name: "신규 스마트폰 앱 기능 출시 일정 지연 문제" }
  ];

  // 지난 30일 날짜 배열 생성 (일일 사용량 추이용)
  const last30Days = Array.from({ length: 30 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (29 - i));
    return date;
  });

  // Create multiple conversations with varying scores for realistic data
  for (const scenario of scenarios) {
    // 시나리오에서 첫 번째 페르소나 ID 가져오기
    const scenarioObj = realScenarios.find(s => s.id === scenario.id);
    const firstPersonaId = scenarioObj?.personas?.[0]?.id || "istj"; // 기본값으로 istj 사용
    
    for (let i = 0; i < Math.floor(Math.random() * 8) + 3; i++) { // 3-10 conversations per scenario
      // 시나리오의 다양한 페르소나를 랜덤하게 선택
      const personas = scenarioObj?.personas || [];
      const randomPersona = personas.length > 0 ? personas[Math.floor(Math.random() * personas.length)] : null;
      const personaId = (typeof randomPersona === 'object' && randomPersona?.id) ? randomPersona.id : firstPersonaId;
      
      // 랜덤한 과거 날짜 선택 (지난 30일 중)
      const randomDate = last30Days[Math.floor(Math.random() * last30Days.length)];
      // 해당 날짜의 랜덤한 시간 추가
      const randomTime = new Date(randomDate);
      randomTime.setHours(
        Math.floor(Math.random() * 24), 
        Math.floor(Math.random() * 60), 
        Math.floor(Math.random() * 60)
      );
      
      const conversation = await storage.createConversation({
        scenarioId: scenario.id,
        personaId: personaId, // personaId 추가
        scenarioName: scenario.name,
        messages: sampleMessages,
        turnCount: 10,
        status: Math.random() > 0.1 ? "completed" : "active" // 90% completion rate
      });
      
      // createdAt를 랜덤 날짜로 수동 설정
      conversation.createdAt = randomTime;

      // Create feedback for completed conversations
      if (conversation.status === "completed") {
        // Vary scores realistically
        const baseScore = Math.floor(Math.random() * 30) + 65; // 65-94 range
        const variedScores = sampleScores.map(score => ({
          ...score,
          score: Math.max(1, Math.min(5, Math.floor(score.score + (Math.random() - 0.5) * 2)))
        }));

        const overallScore = Math.floor((variedScores.reduce((acc, s) => acc + s.score, 0) / 5) * 20);

        const feedback = await storage.createFeedback({
          conversationId: conversation.id,
          overallScore,
          scores: variedScores,
          detailedFeedback: sampleFeedback
        });
        
        // 피드백도 대화와 동일한 날짜로 설정 (대화 완료 후 몇 분 뒤)
        const feedbackTime = new Date(randomTime);
        feedbackTime.setMinutes(feedbackTime.getMinutes() + Math.floor(Math.random() * 30) + 5); // 5-35분 후
        feedback.createdAt = feedbackTime;
      }
    }
  }

  console.log("Sample data created successfully!");
}