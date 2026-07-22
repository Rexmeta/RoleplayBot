import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { authFetch } from "@/lib/authFetch";
import type { EmotionData, ScenarioEmotionData, DifficultyEmotionData, PersonaEmotionData } from "./adminTypes";

const EMOTION_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4', '#6366f1', '#84cc16', '#14b8a6'];

const INSIGHT_THRESHOLD = 15;

type PersonaType = 'mbti' | 'user' | 'all';

function computeInsightBadges(
  personaEmotions: Array<{ emotion: string; percentage: number }>,
  globalAverages: Record<string, number>
): Array<{ emotion: string; diff: number }> {
  return personaEmotions
    .filter(e => {
      const avg = globalAverages[e.emotion] ?? 0;
      return e.percentage - avg >= INSIGHT_THRESHOLD;
    })
    .map(e => ({ emotion: e.emotion, diff: e.percentage - (globalAverages[e.emotion] ?? 0) }))
    .sort((a, b) => b.diff - a.diff);
}

interface EmotionsTabProps {
  emotions: EmotionData | undefined;
  scenarioEmotions: ScenarioEmotionData | undefined;
  difficultyEmotions: DifficultyEmotionData | undefined;
  selectedCategoryId?: string;
}

type TimeWindow = 'all' | '30d';

export function EmotionsTab({ emotions, scenarioEmotions, difficultyEmotions, selectedCategoryId = 'all' }: EmotionsTabProps) {
  const [, navigate] = useLocation();
  const [expandedPersonaId, setExpandedPersonaId] = useState<string | null>(null);
  const [personaType, setPersonaType] = useState<PersonaType>('mbti');
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('all');

  const buildPersonaUrl = () => {
    const params = new URLSearchParams();
    if (selectedCategoryId && selectedCategoryId !== 'all') params.set('categoryId', selectedCategoryId);
    params.set('personaType', personaType);
    if (timeWindow === '30d') params.set('since', '30d');
    const qs = params.toString();
    return `/api/admin/analytics/emotions/by-persona${qs ? `?${qs}` : ''}`;
  };

  const { data: personaEmotions, isFetching: personaEmotionsFetching } = useQuery<PersonaEmotionData>({
    queryKey: ["/api/admin/analytics/emotions/by-persona", selectedCategoryId, personaType, timeWindow],
    queryFn: () => authFetch(buildPersonaUrl()),
    staleTime: 1000 * 60 * 2,
    gcTime: 1000 * 60 * 30,
  });

  const activePersonaEmotions = personaEmotions;

  const globalAverages: Record<string, number> = {};
  if (timeWindow === '30d' && personaEmotions?.personaStats?.length) {
    const aggregated: Record<string, number> = {};
    let total = 0;
    for (const persona of personaEmotions.personaStats) {
      for (const e of persona.emotions) {
        aggregated[e.emotion] = (aggregated[e.emotion] ?? 0) + e.count;
        total += e.count;
      }
    }
    if (total > 0) {
      for (const [emotion, count] of Object.entries(aggregated)) {
        globalAverages[emotion] = Math.round((count / total) * 100);
      }
    }
  } else if (emotions?.emotions) {
    const total = emotions.totalEmotions || 1;
    emotions.emotions.forEach(e => {
      globalAverages[e.emotion] = Math.round((e.count / total) * 100);
    });
  }

  const personaTypeLabels: Record<PersonaType, string> = {
    mbti: 'MBTI 페르소나',
    user: '사용자 생성 (PersonaX)',
    all: '전체',
  };

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

      <div className="border-t pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <i className="fas fa-user-circle text-indigo-500"></i>
            페르소나별 감정 분석
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
              {(['mbti', 'user', 'all'] as PersonaType[]).map((type) => (
                <button
                  key={type}
                  onClick={() => { setPersonaType(type); setExpandedPersonaId(null); }}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    personaType === type
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {personaTypeLabels[type]}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
              <button
                className={`px-3 py-1 text-xs rounded-md transition-colors ${timeWindow === 'all' ? 'bg-white text-slate-800 shadow-sm font-medium' : 'text-slate-500 hover:text-slate-700'}`}
                onClick={() => setTimeWindow('all')}
              >
                전체 기간
              </button>
              <button
                className={`px-3 py-1 text-xs rounded-md transition-colors ${timeWindow === '30d' ? 'bg-white text-slate-800 shadow-sm font-medium' : 'text-slate-500 hover:text-slate-700'}`}
                onClick={() => setTimeWindow('30d')}
              >
                최근 30일
              </button>
            </div>
          </div>
        </div>

        {personaEmotionsFetching && !activePersonaEmotions ? (
          <div className="text-center py-8 text-slate-400 text-sm">불러오는 중...</div>
        ) : !activePersonaEmotions?.personaStats?.length ? (
          <div className="text-center py-8 text-slate-500">
            {personaType === 'user'
              ? 'PersonaX 사용자 생성 페르소나의 감정 데이터가 없습니다.'
              : timeWindow === '30d' ? '최근 30일간 페르소나 감정 데이터가 없습니다.'
              : '페르소나 감정 데이터가 없습니다.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {activePersonaEmotions.personaStats.map((persona) => {
              const insights = computeInsightBadges(persona.emotions, globalAverages);
              const isExpanded = expandedPersonaId === persona.personaId;
              const top5 = persona.emotions.slice(0, 5);
              const isUserPersona = persona.personaId.startsWith('__user_persona__');

              return (
                <div
                  key={persona.personaId}
                  className="border rounded-lg p-4 bg-white shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => setExpandedPersonaId(isExpanded ? null : persona.personaId)}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h4 className="font-semibold text-slate-900 text-base">{persona.personaName}</h4>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        {persona.mbtiType && (
                          <span className="text-xs text-indigo-600 font-medium bg-indigo-50 px-1.5 py-0.5 rounded inline-block">
                            {persona.mbtiType}
                          </span>
                        )}
                        {isUserPersona && (
                          <span className="text-xs text-emerald-600 font-medium bg-emerald-50 px-1.5 py-0.5 rounded inline-block">
                            PersonaX
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-500">총 {persona.totalCount}회</p>
                      {persona.topEmotion && (
                        <span className="text-xl" title={persona.topEmotion.emotion}>{persona.topEmotion.emoji}</span>
                      )}
                    </div>
                  </div>

                  {insights.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {insights.map(ins => (
                        <Badge key={ins.emotion} variant="destructive" className="text-xs px-2 py-0.5">
                          ⚠️ {ins.emotion} 빈번 → 설정 검토 권장
                        </Badge>
                      ))}
                    </div>
                  )}

                  {persona.topEmotion && (
                    <p className="text-sm text-slate-600 mb-3">
                      최다: <span className="font-medium">{persona.topEmotion.emoji} {persona.topEmotion.emotion}</span>
                      <span className="text-slate-400 ml-1">({persona.topEmotion.percentage}%)</span>
                    </p>
                  )}

                  <div className="space-y-1.5 mb-3">
                    {top5.map((e, i) => (
                      <div key={e.emotion} className="flex items-center gap-2 text-xs">
                        <span className="w-14 text-right text-slate-500 shrink-0">{e.emoji} {e.emotion}</span>
                        <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                          <div
                            className="h-2 rounded-full"
                            style={{ width: `${e.percentage}%`, backgroundColor: EMOTION_COLORS[i % EMOTION_COLORS.length] }}
                          />
                        </div>
                        <span className="w-8 text-slate-500 shrink-0">{e.percentage}%</span>
                      </div>
                    ))}
                  </div>

                  {isExpanded && (
                    <div className="mt-3 border-t pt-3" onClick={e => e.stopPropagation()}>
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie
                            data={persona.emotions.map((e, i) => ({
                              name: `${e.emoji} ${e.emotion}`,
                              value: e.count,
                              fill: EMOTION_COLORS[i % EMOTION_COLORS.length]
                            }))}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            outerRadius={70}
                            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                            labelLine={false}
                          >
                            {persona.emotions.map((_, i) => (
                              <Cell key={`cell-${i}`} fill={EMOTION_COLORS[i % EMOTION_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(value: number) => [`${value}회`, '빈도']} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  <div className="mt-3 flex justify-between items-center" onClick={e => e.stopPropagation()}>
                    <span className="text-xs text-slate-400">
                      {isExpanded ? '▲ 접기' : '▼ 상세 보기'}
                    </span>
                    {!isUserPersona && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs h-7"
                        onClick={() => navigate(`/persona/${persona.personaId}`)}
                      >
                        <i className="fas fa-external-link-alt mr-1"></i>
                        페르소나 설정으로 이동
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
