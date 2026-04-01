import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { type ComplexScenario } from "@/lib/scenario-system";

interface DashboardSummary {
  resumeScenario: {
    scenarioRunId: string;
    scenarioId: string;
    scenarioName: string;
    startedAt: string;
  } | null;
  lastCompletedScenario: {
    scenarioRunId: string;
    scenarioId: string;
    scenarioName: string;
    completedAt: string;
    score: number | null;
  } | null;
  recommendedScenarioId: string | null;
  isRecommendationRechallenge: boolean;
  totalCompleted: number;
  totalScenarios: number;
  averageScore: number | null;
  totalPracticeCount: number;
  categoryScores: {
    categoryId: string;
    categoryName: string;
    averageScore: number;
    count: number;
  }[];
}

interface PersonalizedDashboardProps {
  onResumeScenario?: (scenarioRunId: string, scenarioId: string) => void;
  onRecommendedScenario?: (scenarioId: string) => void;
  scenarios?: ComplexScenario[];
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "오늘";
  if (diffDays === 1) return "어제";
  if (diffDays < 7) return `${diffDays}일 전`;
  return date.toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-slate-400 text-sm">점수 없음</span>;
  const color =
    score >= 80
      ? "text-green-600 bg-green-50"
      : score >= 60
      ? "text-yellow-600 bg-yellow-50"
      : "text-red-600 bg-red-50";
  return (
    <span className={`text-sm font-semibold px-2 py-0.5 rounded-full ${color}`}>
      {score}점
    </span>
  );
}

export default function PersonalizedDashboard({
  onResumeScenario,
  onRecommendedScenario,
  scenarios = [],
}: PersonalizedDashboardProps) {
  const { user } = useAuth();

  const { data: summary, isLoading } = useQuery<DashboardSummary>({
    queryKey: ["/api/dashboard/summary"],
    queryFn: async () => {
      const token = localStorage.getItem("authToken");
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch("/api/dashboard/summary", {
        credentials: "include",
        headers,
      });
      if (!res.ok) throw new Error("Failed to fetch dashboard summary");
      return res.json();
    },
    enabled: !!user && !user.isGuest,
    staleTime: 1000 * 60 * 5,
  });

  if (!user || user.isGuest) return null;

  if (isLoading) {
    return (
      <div className="mb-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-20 rounded-xl mb-4" />
        <Skeleton className="h-36 rounded-xl" />
      </div>
    );
  }

  if (!summary) return null;

  const recommendedScenario = summary.recommendedScenarioId
    ? scenarios.find((s) => s.id === summary.recommendedScenarioId)
    : null;

  const completionRate =
    summary.totalScenarios > 0
      ? Math.min(100, Math.round((summary.totalCompleted / summary.totalScenarios) * 100))
      : 0;

  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-lg font-bold text-slate-800">
          {user.name}님의 학습 현황
        </h2>
        <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
          개인화
        </span>
      </div>

      {/* 세 카드 행 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        {/* 이어하기 카드 */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col gap-2 shadow-sm">
          <div className="flex items-center gap-2 text-indigo-600 font-semibold text-sm">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            이어하기
          </div>
          {summary.resumeScenario ? (
            <>
              <p className="text-slate-800 font-medium text-sm leading-tight line-clamp-2">
                {summary.resumeScenario.scenarioName}
              </p>
              <p className="text-xs text-slate-400">
                {formatDate(summary.resumeScenario.startedAt)} 시작
              </p>
              <Button
                size="sm"
                className="mt-auto bg-indigo-600 hover:bg-indigo-700 text-white text-xs"
                onClick={() =>
                  onResumeScenario?.(
                    summary.resumeScenario!.scenarioRunId,
                    summary.resumeScenario!.scenarioId
                  )
                }
              >
                이어서 연습하기
              </Button>
            </>
          ) : (
            <p className="text-slate-400 text-sm mt-1">진행 중인 시나리오가 없습니다.</p>
          )}
        </div>

        {/* 최근 연습 카드 */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col gap-2 shadow-sm">
          <div className="flex items-center gap-2 text-emerald-600 font-semibold text-sm">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20z" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            마지막으로 연습한 시나리오
          </div>
          {summary.lastCompletedScenario ? (
            <>
              <p className="text-slate-800 font-medium text-sm leading-tight line-clamp-2">
                {summary.lastCompletedScenario.scenarioName}
              </p>
              <div className="flex items-center gap-2">
                <p className="text-xs text-slate-400">
                  {formatDate(summary.lastCompletedScenario.completedAt)} 완료
                </p>
                <ScoreBadge score={summary.lastCompletedScenario.score} />
              </div>
            </>
          ) : (
            <p className="text-slate-400 text-sm mt-1">아직 완료한 시나리오가 없습니다.</p>
          )}
        </div>

        {/* 오늘의 추천 카드 - 숨김 처리 */}
      </div>

      {/* 학습 진행률 통계 칩 */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4 shadow-sm">
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex items-center gap-2">
            <span className="text-slate-500 text-sm">완료</span>
            <span className="font-bold text-slate-800 text-sm">
              {summary.totalCompleted} / {summary.totalScenarios}
            </span>
            <div className="w-20 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all"
                style={{ width: `${completionRate}%` }}
              />
            </div>
            <span className="text-xs text-slate-400">{completionRate}%</span>
          </div>
          <div className="w-px h-5 bg-slate-200 hidden md:block" />
          <div className="flex items-center gap-2">
            <span className="text-slate-500 text-sm">평균 점수</span>
            <span className="font-bold text-slate-800 text-sm">
              {summary.averageScore !== null ? `${summary.averageScore}점` : "—"}
            </span>
          </div>
          <div className="w-px h-5 bg-slate-200 hidden md:block" />
          <div className="flex items-center gap-2">
            <span className="text-slate-500 text-sm">총 연습 횟수</span>
            <span className="font-bold text-slate-800 text-sm">
              {summary.totalPracticeCount}회
            </span>
          </div>
        </div>
      </div>

      {/* 스킬별 성장 바 그래프 */}
      {summary.categoryScores.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">카테고리별 평균 점수</h3>
          <div className="space-y-2.5">
            {summary.categoryScores.map((cat) => (
              <div key={cat.categoryId} className="flex items-center gap-3">
                <span className="text-xs text-slate-600 w-28 shrink-0 truncate" title={cat.categoryName}>
                  {cat.categoryName}
                </span>
                <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-400 rounded-full transition-all"
                    style={{ width: `${cat.averageScore}%` }}
                  />
                </div>
                <span className="text-xs font-semibold text-slate-600 w-10 text-right shrink-0">
                  {cat.averageScore}점
                </span>
                <span className="text-xs text-slate-400 w-10 shrink-0">
                  {cat.count}회
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
