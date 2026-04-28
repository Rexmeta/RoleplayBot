import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CardInfo } from "./AdminCardInfo";
import type { AnalyticsOverview } from "./adminTypes";

interface OverviewTabProps {
  overview: AnalyticsOverview | undefined;
  scenarioPopularityData: Array<{ name: string; sessions: number }>;
  mbtiUsageData: Array<{ name: string; count: number }>;
}

export function OverviewTab({ overview }: OverviewTabProps) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="card-enhanced" data-testid="card-session-summary">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium"><CardInfo title="훈련 세션" description="완료한 세션 수 / 전체 시작한 세션 수. 사용자가 실제로 대화를 완료한 페르소나 실행 기준." /></CardTitle>
            <i className="fas fa-chart-line text-blue-600"></i>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="session-summary">
              {overview?.completedSessions || 0}/{overview?.totalSessions || 0}
            </div>
            <p className="text-xs text-slate-600">완료율 {overview?.completionRate || 0}%</p>
          </CardContent>
        </Card>

        <Card className="card-enhanced" data-testid="card-average-score">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium"><CardInfo title="평균 점수" description="모든 완료된 세션의 평가 점수 평균 (0-100점). AI가 사용자의 커뮤니케이션 능력을 평가한 종합 점수입니다." /></CardTitle>
            <i className="fas fa-star text-yellow-600"></i>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="average-score">{overview?.averageScore != null ? Number(overview.averageScore).toFixed(1) : '0.0'}점</div>
            <p className="text-xs text-slate-600">전체 세션 평균</p>
          </CardContent>
        </Card>

        <Card className="card-enhanced" data-testid="card-participation">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium"><CardInfo title="참여인수" description="실제 대화에 참여한 사용자 비율 (%). 시나리오를 시작한 활동 유저 기준으로 계산됩니다." /></CardTitle>
            <i className="fas fa-users text-green-600"></i>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="participation-rate">{overview?.participationRate || 0}%</div>
            <p className="text-xs text-slate-600">{overview?.activeUsers || 0}/{overview?.totalUsers || 0} 사용자</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="card-enhanced" data-testid="card-dau-wau-mau">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <i className="fas fa-calendar text-purple-600"></i>
              사용자 활동 기간
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="dau" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="dau" data-testid="tab-dau">일간</TabsTrigger>
                <TabsTrigger value="wau" data-testid="tab-wau">주간</TabsTrigger>
                <TabsTrigger value="mau" data-testid="tab-mau">월간</TabsTrigger>
              </TabsList>
              <TabsContent value="dau" className="mt-4">
                <div className="text-3xl font-bold text-purple-600" data-testid="dau-value">{overview?.dau || 0}명</div>
                <p className="text-sm text-slate-600 mt-2">오늘 활동한 사용자</p>
              </TabsContent>
              <TabsContent value="wau" className="mt-4">
                <div className="text-3xl font-bold text-indigo-600" data-testid="wau-value">{overview?.wau || 0}명</div>
                <p className="text-sm text-slate-600 mt-2">이번 주 활동한 사용자</p>
              </TabsContent>
              <TabsContent value="mau" className="mt-4">
                <div className="text-3xl font-bold text-teal-600" data-testid="mau-value">{overview?.mau || 0}명</div>
                <p className="text-sm text-slate-600 mt-2">이번 달 활동한 사용자</p>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        <Card className="card-enhanced" data-testid="card-sessions-per-user">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium"><CardInfo title="인당 세션" description="활동 유저당 평균 세션 수. (총 세션 수 / 활동 유저 수) 계산값입니다." /></CardTitle>
            <i className="fas fa-user-clock text-orange-600"></i>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="sessions-per-user-value">{overview?.sessionsPerUser || 0}회</div>
            <p className="text-xs text-slate-600">유저당 평균 세션 수</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="card-enhanced" data-testid="card-new-users">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium"><CardInfo title="신규 유저" description="정확히 1회의 세션을 완료한 사용자 수. 처음 참여했거나 한 번만 시도한 사용자입니다." /></CardTitle>
            <i className="fas fa-user-plus text-green-600"></i>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="new-users-value">{overview?.newUsers || 0}명</div>
            <p className="text-xs text-slate-600">1회 세션 참여 유저</p>
          </CardContent>
        </Card>

        <Card className="card-enhanced" data-testid="card-returning-users">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium"><CardInfo title="재방문 유저" description="2회 이상의 세션을 완료한 사용자 수. 앱을 반복적으로 사용하는 활성 사용자입니다." /></CardTitle>
            <i className="fas fa-user-check text-blue-600"></i>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="returning-users-value">{overview?.returningUsers || 0}명</div>
            <p className="text-xs text-slate-600">2회 이상 세션 참여</p>
          </CardContent>
        </Card>

        <Card className="card-enhanced" data-testid="card-returning-rate">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium"><CardInfo title="재방문율" description="재방문 유저 수를 전체 활동 유저로 나눈 비율 (%). 사용자 유지율을 나타냅니다." /></CardTitle>
            <i className="fas fa-redo text-yellow-600"></i>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="returning-rate-value">{overview?.returningRate || 0}%</div>
            <p className="text-xs text-slate-600">재방문 유저 비율</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="card-enhanced" data-testid="card-top-users">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <i className="fas fa-trophy text-yellow-500"></i>
              활동 유저 Top 5
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {overview?.topActiveUsers?.slice(0, 5).map((user, index) => (
                <div key={user.userId} className="flex justify-between items-center p-2 bg-slate-50 rounded" data-testid={`top-user-${index}`}>
                  <span className="flex items-center gap-2">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      index === 0 ? 'bg-yellow-400 text-yellow-900' :
                      index === 1 ? 'bg-gray-300 text-gray-700' :
                      index === 2 ? 'bg-orange-300 text-orange-800' :
                      'bg-slate-200 text-slate-600'
                    }`}>
                      {index + 1}
                    </span>
                    <span className="text-sm truncate max-w-[100px]">{user.userId.slice(0, 8)}...</span>
                  </span>
                  <span className="text-sm font-semibold text-corporate-600">{user.sessionCount}회</span>
                </div>
              )) || <p className="text-slate-500 text-sm">데이터 없음</p>}
            </div>
          </CardContent>
        </Card>

        <Card className="card-enhanced" data-testid="card-top-scenarios">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <i className="fas fa-fire text-red-500"></i>
              인기 시나리오 Top 5
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {overview?.topScenarios?.map((scenario, index) => (
                <div key={scenario.id} className="flex justify-between items-center p-2 bg-slate-50 rounded" data-testid={`top-scenario-${index}`}>
                  <span className="flex items-center gap-2">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      index === 0 ? 'bg-red-400 text-white' :
                      index === 1 ? 'bg-red-300 text-red-800' :
                      'bg-slate-200 text-slate-600'
                    }`}>
                      {index + 1}
                    </span>
                    <span className="text-sm truncate max-w-[120px]">{scenario.name}</span>
                  </span>
                  <span className="text-sm font-semibold text-green-600">{scenario.count}회</span>
                </div>
              )) || <p className="text-slate-500 text-sm">데이터 없음</p>}
            </div>
          </CardContent>
        </Card>

        <Card className="card-enhanced" data-testid="card-hardest-scenarios">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <i className="fas fa-skull text-slate-600"></i>
              어려운 시나리오 Top 5
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {overview?.hardestScenarios?.map((scenario, index) => (
                <div key={scenario.id} className="flex justify-between items-center p-2 bg-slate-50 rounded" data-testid={`hardest-scenario-${index}`}>
                  <span className="flex items-center gap-2">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      index === 0 ? 'bg-slate-700 text-white' :
                      index === 1 ? 'bg-slate-500 text-white' :
                      'bg-slate-200 text-slate-600'
                    }`}>
                      {index + 1}
                    </span>
                    <span className="text-sm truncate max-w-[120px]">{scenario.name}</span>
                  </span>
                  <span className="text-sm font-semibold text-red-600">{Number(scenario.averageScore).toFixed(1)}점</span>
                </div>
              )) || <p className="text-slate-500 text-sm">데이터 없음</p>}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
