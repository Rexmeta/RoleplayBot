/** Real production components with synthetic cached data; no auth or API access. */
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "../../client/src/lib/queryClient";
import i18n from "../../client/src/lib/i18n";
import "../../client/src/index.css";
import ScenarioSelector from "../../client/src/components/ScenarioSelector";
import PersonalizedDashboard from "../../client/src/components/PersonalizedDashboard";

void i18n.changeLanguage("ko");
const titles = ["팀 간 일정과 우선순위 조율하기", "고객의 불만에 공감하며 대응하기", "팀원에게 건설적인 피드백 전달하기", "새로운 제안을 근거로 설득하기"];
const scenarios = titles.map((title, index) => ({
  id: `review-${index}`, title,
  description: "서로 다른 입장을 이해하고, 현실적인 대안을 제시하며 합의점을 찾아보세요.",
  categoryId: index % 2 ? "customer" : "team",
  estimatedTime: "15분", skills: ["협상", "의사소통"],
  personas: [{ id: "actor", name: "상대역", department: "개발팀" }],
  context: { situation: "프로젝트를 진행하는 과정에서 구성원 간 의견 차이가 발생했습니다." },
}));
queryClient.setQueryData(["/api/scenarios"], scenarios);
queryClient.setQueryData(["/api/categories"], [
  { id: "team", name: "팀 협업" }, { id: "customer", name: "고객 응대" },
]);
queryClient.setQueryData(["/api/bookmarks", "library-review"], [{ id: "saved", scenarioId: "review-0" }]);
queryClient.setQueryData(["/api/scenarios/stats"], []);
queryClient.setQueryData(["/api/dashboard/summary"], {
  resumeScenario: { scenarioRunId: "run", scenarioId: "review-0", scenarioName: titles[0], startedAt: new Date().toISOString() },
  lastCompletedScenario: null, recommendedScenarioId: "review-1", isRecommendationRechallenge: false,
  totalCompleted: 2, totalScenarios: 4, averageScore: 81, totalPracticeCount: 5, categoryScores: [],
});
// Fail closed: even fixture button actions cannot reach the backend.
window.fetch = async () => { throw new Error("Visual review fixture: network access disabled"); };
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <div className="border-b border-slate-200 bg-white px-6 py-4 text-sm font-bold text-indigo-900">RoleplayX</div>
    <ScenarioSelector onScenarioSelect={() => {}}
      sidebarContent={<PersonalizedDashboard variant="sidebar" scenarios={scenarios as any} />} />
  </QueryClientProvider>,
);
