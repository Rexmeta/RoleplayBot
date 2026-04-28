import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { CardInfo } from "./AdminCardInfo";
import type { EmotionData, ScenarioEmotionData, DifficultyEmotionData } from "./adminTypes";

const EMOTION_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4', '#6366f1', '#84cc16', '#14b8a6'];

interface EmotionsTabProps {
  emotions: EmotionData | undefined;
  scenarioEmotions: ScenarioEmotionData | undefined;
  difficultyEmotions: DifficultyEmotionData | undefined;
}

export function EmotionsTab({ emotions, scenarioEmotions, difficultyEmotions }: EmotionsTabProps) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="card-enhanced" data-testid="card-total-emotions">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium"><CardInfo title="총 감정 표현" description="AI가 대화 중 표현한 총 감정 횟수입니다." /></CardTitle>
            <i className="fas fa-heart text-pink-600"></i>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-pink-600">{emotions?.totalEmotions || 0}회</div>
            <p className="text-xs text-slate-600">기록된 감정 표현</p>
          </CardContent>
        </Card>

        <Card className="card-enhanced" data-testid="card-unique-emotions">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium"><CardInfo title="감정 종류" description="AI가 표현한 고유한 감정 종류의 개수입니다." /></CardTitle>
            <i className="fas fa-theater-masks text-purple-600"></i>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">{emotions?.uniqueEmotions || 0}종류</div>
            <p className="text-xs text-slate-600">다양한 감정 표현</p>
          </CardContent>
        </Card>

        <Card className="card-enhanced" data-testid="card-top-emotion">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium"><CardInfo title="최다 감정" description="가장 많이 표현된 감정입니다." /></CardTitle>
            <i className="fas fa-star text-yellow-600"></i>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">
              {emotions?.emotions?.[0] ? `${emotions.emotions[0].emoji} ${emotions.emotions[0].emotion}` : '-'}
            </div>
            <p className="text-xs text-slate-600">
              {emotions?.emotions?.[0] ? `${emotions.emotions[0].count}회 (${emotions.emotions[0].percentage}%)` : '데이터 없음'}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-emotion-distribution">
        <CardHeader>
          <CardTitle><CardInfo title="감정 분포" description="전체 감정 표현의 비율을 보여줍니다." /></CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={emotions?.emotions?.map((e, i) => ({
                  name: `${e.emoji} ${e.emotion}`,
                  value: e.count,
                  fill: EMOTION_COLORS[i % EMOTION_COLORS.length]
                })) || []}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={100}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              >
                {emotions?.emotions?.map((_, i) => (
                  <Cell key={`cell-${i}`} fill={EMOTION_COLORS[i % EMOTION_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number) => [`${value}회`, '빈도']} />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="border-t pt-6">
        <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <i className="fas fa-signal text-orange-500"></i>
          난이도별 감정 분석
        </h3>

        {!difficultyEmotions?.difficultyStats?.length ? (
          <div className="text-center py-8 text-slate-500">난이도별 감정 데이터가 없습니다.</div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              {difficultyEmotions.difficultyStats.map((diff) => {
                const difficultyColors: Record<number, string> = {
                  1: 'bg-green-100 border-green-300',
                  2: 'bg-blue-100 border-blue-300',
                  3: 'bg-orange-100 border-orange-300',
                  4: 'bg-red-100 border-red-300'
                };
                return (
                  <div key={diff.difficulty} className={`border-2 rounded-lg p-4 ${difficultyColors[diff.difficulty] || 'bg-slate-100 border-slate-300'}`}>
                    <div className="flex justify-between items-center mb-3">
                      <div>
                        <span className="font-bold text-lg">{diff.difficultyName}</span>
                        <span className="ml-2 text-sm text-slate-500">Lv.{diff.difficulty}</span>
                      </div>
                      {diff.topEmotion && (
                        <span className="text-2xl" title={`주요 감정: ${diff.topEmotion.emotion}`}>
                          {diff.topEmotion.emoji}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-600 mb-3">총 {diff.totalCount}회 감정 표현</p>
                    <div className="flex flex-wrap gap-2">
                      {diff.emotions.slice(0, 4).map((e) => (
                        <span
                          key={e.emotion}
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-white/80 text-slate-700"
                        >
                          {e.emoji} {e.percentage}%
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <Card data-testid="card-difficulty-emotion-chart">
              <CardHeader>
                <CardTitle><CardInfo title="난이도별 감정 빈도 비교" description="난이도별로 총 감정 표현 횟수를 비교합니다." /></CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={difficultyEmotions.difficultyStats.map(d => ({
                    name: d.difficultyName,
                    count: d.totalCount,
                    topEmotion: d.topEmotion?.emoji || ''
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip
                      formatter={(value: number) => [`${value}회`, '감정 표현 횟수']}
                      labelFormatter={(label) => {
                        const diff = difficultyEmotions.difficultyStats.find(d => d.difficultyName === label);
                        return diff?.topEmotion ? `${label} (주요: ${diff.topEmotion.emoji} ${diff.topEmotion.emotion})` : label;
                      }}
                    />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {difficultyEmotions.difficultyStats.map((d, idx) => {
                        const colors = ['#22c55e', '#3b82f6', '#f97316', '#ef4444'];
                        return <Cell key={`cell-${idx}`} fill={colors[d.difficulty - 1] || '#8b5cf6'} />;
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <div className="border-t pt-6">
        <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <i className="fas fa-folder-open text-purple-500"></i>
          시나리오별 감정 분석
        </h3>

        {!scenarioEmotions?.scenarios?.length ? (
          <div className="text-center py-8 text-slate-500">시나리오 감정 데이터가 없습니다.</div>
        ) : (
          <>
            <div className="space-y-4 mb-6">
              {scenarioEmotions.scenarios.slice(0, 6).map((scenario) => (
                <div key={scenario.scenarioId} className="border rounded-lg p-4">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h4 className="font-medium text-slate-900">{scenario.scenarioName}</h4>
                      <p className="text-sm text-slate-500">총 {scenario.totalCount}회 감정 표현</p>
                    </div>
                    {scenario.topEmotion && (
                      <div className="text-right">
                        <span className="text-2xl">{scenario.topEmotion.emoji}</span>
                        <p className="text-xs text-slate-500">주요 감정: {scenario.topEmotion.emotion}</p>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {scenario.emotions.slice(0, 5).map((e) => (
                      <span
                        key={e.emotion}
                        className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800"
                      >
                        {e.emoji} {e.emotion} ({e.percentage}%)
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <Card data-testid="card-scenario-emotion-chart">
              <CardHeader>
                <CardTitle><CardInfo title="시나리오별 감정 빈도 비교" description="시나리오별로 총 감정 표현 횟수를 비교합니다." /></CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={scenarioEmotions.scenarios.slice(0, 8).map(s => ({
                    name: s.scenarioName.length > 15 ? s.scenarioName.slice(0, 15) + '...' : s.scenarioName,
                    count: s.totalCount,
                    topEmotion: s.topEmotion?.emoji || ''
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" angle={-15} textAnchor="end" height={80} />
                    <YAxis />
                    <Tooltip formatter={(value: number) => [`${value}회`, '감정 표현 횟수']} />
                    <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
