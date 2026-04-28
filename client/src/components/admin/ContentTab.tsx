import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CardInfo } from "./AdminCardInfo";
import type { AnalyticsOverview } from "./adminTypes";

interface ContentTabProps {
  scenarios: any[];
  personas: any[];
  overview: AnalyticsOverview | undefined;
}

export function ContentTab({ scenarios, personas, overview }: ContentTabProps) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="card-enhanced" data-testid="card-total-scenarios">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium"><CardInfo title="총 시나리오" description="시스템에 등록된 전체 시나리오 개수. 사용자에게 제공되는 대화 훈련 주제의 총 개수입니다." /></CardTitle>
            <i className="fas fa-folder text-blue-600"></i>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{scenarios.length}개</div>
            <p className="text-xs text-slate-600">등록된 시나리오 수</p>
          </CardContent>
        </Card>

        <Card className="card-enhanced" data-testid="card-total-personas">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium"><CardInfo title="총 페르소나" description="시스템에 등록된 전체 MBTI 페르소나 개수. 사용자가 대화할 수 있는 개별 AI 캐릭터의 총 개수입니다." /></CardTitle>
            <i className="fas fa-user-circle text-purple-600"></i>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">{personas.length}개</div>
            <p className="text-xs text-slate-600">등록된 MBTI 페르소나 수</p>
          </CardContent>
        </Card>

        <Card className="card-enhanced" data-testid="card-avg-personas-per-scenario">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium"><CardInfo title="평균 페르소나/시나리오" description="각 시나리오당 포함된 페르소나의 평균 개수. (전체 페르소나 수 / 시나리오 수) 계산값입니다." /></CardTitle>
            <i className="fas fa-users-cog text-green-600"></i>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {scenarios.length > 0
                ? (scenarios.reduce((sum: number, s: any) => sum + (s.personas?.length || 0), 0) / scenarios.length).toFixed(1)
                : 0}명
            </div>
            <p className="text-xs text-slate-600">시나리오당 평균 페르소나</p>
          </CardContent>
        </Card>

        <Card className="card-enhanced" data-testid="card-recent-update">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium"><CardInfo title="최근 업데이트" description="마지막으로 시나리오 또는 페르소나 콘텐츠가 수정되거나 추가된 날짜와 시간입니다." /></CardTitle>
            <i className="fas fa-clock text-teal-600"></i>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-teal-600">
              {overview?.lastContentUpdate
                ? new Date(overview.lastContentUpdate).toLocaleDateString('ko-KR', { year: '2-digit', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                : '업데이트 없음'}
            </div>
            <p className="text-xs text-slate-600">마지막 콘텐츠 수정 일시</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card data-testid="card-scenario-list">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <i className="fas fa-list text-blue-600"></i>
              <CardInfo title="시나리오 목록" description="전체 시나리오의 정보. 포함된 페르소나 수, 평균 점수, 사용 횟수를 확인할 수 있습니다." />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 sticky top-0">
                  <tr>
                    <th className="p-2 text-left">시나리오명</th>
                    <th className="p-2 text-center">페르소나</th>
                    <th className="p-2 text-center">평균 점수</th>
                    <th className="p-2 text-center">사용 횟수</th>
                  </tr>
                </thead>
                <tbody>
                  {scenarios.map((scenario: any, index: number) => {
                    const usageCount = overview?.scenarioStats?.[scenario.id]?.count || 0;
                    const avgScore = overview?.scenarioAverages?.find((s: any) => s.id === scenario.id)?.averageScore || 0;
                    return (
                      <tr key={scenario.id} className="border-b hover:bg-slate-50" data-testid={`content-scenario-row-${index}`}>
                        <td className="p-2 font-medium truncate max-w-[180px]" title={scenario.title}>
                          {scenario.title}
                        </td>
                        <td className="p-2 text-center">{scenario.personas?.length || 0}명</td>
                        <td className="p-2 text-center font-semibold text-corporate-600">{avgScore > 0 ? avgScore.toFixed(1) : '-'}점</td>
                        <td className="p-2 text-center font-semibold text-slate-600">{usageCount}회</td>
                      </tr>
                    );
                  })}
                  {scenarios.length === 0 && (
                    <tr><td colSpan={4} className="p-4 text-center text-slate-500">등록된 시나리오가 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-persona-list">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <i className="fas fa-users text-purple-600"></i>
              <CardInfo title="MBTI 페르소나 목록" description="전체 MBTI 페르소나의 정보. 평균 점수와 사용 횟수를 통해 각 페르소나의 인기도와 성과를 확인할 수 있습니다." />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 sticky top-0">
                  <tr>
                    <th className="p-2 text-left">MBTI</th>
                    <th className="p-2 text-left">이름</th>
                    <th className="p-2 text-center">평균 점수</th>
                    <th className="p-2 text-center">사용 횟수</th>
                  </tr>
                </thead>
                <tbody>
                  {personas.map((persona: any, index: number) => {
                    const mbtiKey = persona.mbti ? persona.mbti.toLowerCase() : '';
                    const usageCount = mbtiKey ? (overview?.mbtiUsage?.[mbtiKey] || 0) : 0;
                    const avgScore = overview?.mbtiAverages?.find((m: any) => m.mbti.toLowerCase() === mbtiKey)?.averageScore || 0;
                    return (
                      <tr key={persona.id || index} className="border-b hover:bg-slate-50" data-testid={`content-persona-row-${index}`}>
                        <td className="p-2">
                          <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs font-bold">
                            {persona.mbti?.toUpperCase() || 'N/A'}
                          </span>
                        </td>
                        <td className="p-2 font-medium">{persona.name || persona.mbti?.toUpperCase()}</td>
                        <td className="p-2 text-center font-semibold text-corporate-600">{avgScore > 0 ? avgScore.toFixed(1) : '-'}점</td>
                        <td className="p-2 text-center font-semibold text-slate-600">{usageCount}회</td>
                      </tr>
                    );
                  })}
                  {personas.length === 0 && (
                    <tr><td colSpan={4} className="p-4 text-center text-slate-500">등록된 페르소나가 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
