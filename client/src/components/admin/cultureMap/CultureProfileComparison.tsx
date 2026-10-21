import { useMemo, useState } from "react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import { Button } from "@/components/ui/button";
import { CULTURE_DIMENSIONS, EDITORIAL_CULTURE_NOTICE } from "@shared/cultureMap";
import type { CultureProfile } from "@shared/cultureMap";
import { compareCultureProfiles, cultureProfileConfidence, CULTURE_SIMILARITY_THRESHOLD } from "@shared/cultureComparison";
import { Copy, Eye, X } from "lucide-react";

type CultureProfileComparisonProps = {
  profiles: CultureProfile[];
  onRemove: (id: string) => void;
  onClear: () => void;
  onInspect: (profile: CultureProfile) => void;
  onDuplicate: (profile: CultureProfile) => void;
  duplicatePending: boolean;
};

const SERIES_COLORS = ["#61A9BD", "#CED14E", "#DD83C9", "#1F74AD", "#E98E2E"];
const confidenceLabel: Record<string, string> = {
  low: "낮음",
  medium: "중간",
  high: "높음",
  unspecified: "미지정",
};

export function CultureProfileComparison({
  profiles,
  onRemove,
  onClear,
  onInspect,
  onDuplicate,
  duplicatePending,
}: CultureProfileComparisonProps) {
  const [referenceId, setReferenceId] = useState(profiles[0]?.id ?? "");
  const validReferenceId = profiles.some((profile) => profile.id === referenceId) ? referenceId : profiles[0]?.id ?? "";
  const reference = profiles.find((profile) => profile.id === validReferenceId) ?? profiles[0];
  const comparisons = useMemo(
    () => reference ? profiles.filter((profile) => profile.id !== reference.id).map((profile) => ({
      profile,
      dimensions: compareCultureProfiles(reference, profile),
    })) : [],
    [profiles, reference],
  );
  const chartData = useMemo(() => CULTURE_DIMENSIONS.map((dimension) => {
    const row: Record<string, string | number> = { dimension: dimension.label };
    profiles.forEach((profile) => { row[profile.id] = profile.dimensions[dimension.key]; });
    return row;
  }), [profiles]);

  if (!profiles.length) {
    return (
      <section aria-labelledby="culture-compare-title" className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-teal-700">비교 작업대</p>
          <h3 id="culture-compare-title" className="mt-1 text-base font-semibold text-slate-900">프로필을 나란히 살펴보기</h3>
        </div>
        <div className="px-4 py-8 text-center">
          <p className="font-medium text-slate-700">비교할 저장 프로필을 선택하세요</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">목록에서 2–5개를 고르면 여덟 행동 차원과 기준 프로필 대비 차이를 확인할 수 있습니다. 편집 중인 초안은 비교에 포함되지 않습니다.</p>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="culture-compare-title" className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-teal-700">비교 작업대 · {profiles.length}/5</p>
          <h3 id="culture-compare-title" className="mt-1 text-base font-semibold text-slate-900">문화 행동 프로필 비교</h3>
        </div>
        <Button type="button" variant="ghost" size="sm" className="h-8 self-start text-slate-600 sm:self-auto" onClick={onClear}>
          선택 모두 지우기
        </Button>
      </div>
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2" aria-label="비교 프로필">
          {profiles.map((profile) => (
            <span key={profile.id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs text-teal-950">
              <span className="truncate font-medium">{profile.country} · {profile.name}</span>
              <button type="button" aria-label={`${profile.name} 비교에서 제거`} onClick={() => onRemove(profile.id)} className="rounded-full p-0.5 hover:bg-teal-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">
                <X aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
        {profiles.length < 2 ? (
          <div className="rounded border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center text-sm text-slate-600">
            한 프로필이 선택되었습니다. 비교하려면 목록에서 프로필을 하나 더 선택하세요.
          </div>
        ) : (
          <>
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.95fr)]">
              <div className="min-w-0 rounded-md border border-slate-100 bg-[#fbfcfa] p-2 sm:p-4">
                <div className="mb-2 flex flex-wrap items-end justify-between gap-2 px-2">
                  <div>
                    <h4 className="text-sm font-semibold text-slate-800">여덟 차원의 상대 위치</h4>
                    <p className="text-xs text-slate-500">모든 축은 앱에 적용되는 0–100 점수입니다.</p>
                  </div>
                </div>
                <div className="h-[320px] min-w-0 sm:h-[380px]" role="img" aria-label={`${profiles.map((profile) => `${profile.country} ${profile.name}`).join(", ")} 문화 프로필의 여덟 차원 레이더 차트. 정확한 값은 아래 표에 있습니다.`}>
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={chartData} outerRadius="68%">
                      <PolarGrid stroke="#d9e2dc" />
                      <PolarAngleAxis dataKey="dimension" tick={{ fill: "#475569", fontSize: 11 }} />
                      <PolarRadiusAxis angle={90} domain={[0, 100]} tickCount={6} tick={{ fill: "#64748b", fontSize: 10 }} />
                      {profiles.map((profile, index) => (
                        <Radar
                          key={profile.id}
                          name={`${profile.country} · ${profile.name}`}
                          dataKey={profile.id}
                          stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
                          fill={SERIES_COLORS[index % SERIES_COLORS.length]}
                          fillOpacity={0.09}
                          strokeWidth={2}
                          dot={{ r: 2.5, fill: SERIES_COLORS[index % SERIES_COLORS.length] }}
                        />
                      ))}
                      <Tooltip formatter={(value: number, name: string) => [`${value} / 100`, name]} />
                      <Legend wrapperStyle={{ fontSize: "11px", paddingTop: 8 }} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="space-y-3">
                <div className="rounded-md border border-slate-200 p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-800">차이 읽기</h4>
                      <p className="text-xs text-slate-500">기준 프로필을 바꾸면 아래 델타의 방향도 함께 바뀝니다.</p>
                    </div>
                    <div className="min-w-48">
                      <label className="text-xs font-medium text-slate-600">
                        기준 프로필
                        <select
                          aria-label="차이 비교 기준 프로필"
                          value={reference?.id}
                          onChange={(event) => {
                            setReferenceId(event.target.value);
                          }}
                          className="mt-1 block h-9 w-full rounded-md border border-input bg-white px-2 text-sm"
                        >
                          {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.country} · {profile.name}</option>)}
                        </select>
                      </label>
                      {reference && <p className="mt-1 text-xs text-slate-500">기준 출처 신뢰도: {confidenceLabel[cultureProfileConfidence(reference)]}</p>}
                      {reference && <div className="mt-1.5 flex justify-end gap-1">
                        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => onInspect(reference)}><Eye className="h-3 w-3" />살펴보기</Button>
                        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" disabled={duplicatePending} onClick={() => onDuplicate(reference)}><Copy className="h-3 w-3" />복제</Button>
                      </div>}
                    </div>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-500">±{CULTURE_SIMILARITY_THRESHOLD}점 이내는 이 화면에서 ‘비슷함’으로 표시하는 UI 기준일 뿐, 통계적 유의성이나 검증된 문화 차이를 뜻하지 않습니다.</p>
                </div>
                <div className="space-y-3">
                  {comparisons.map(({ profile, dimensions }) => (
                    <article key={profile.id} className="rounded-md border border-slate-200 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h5 className="font-semibold text-slate-900">{profile.country} <span className="font-normal text-slate-500">· {profile.name}</span></h5>
                          <p className="mt-0.5 text-xs text-slate-500">출처 신뢰도: {confidenceLabel[cultureProfileConfidence(profile)]}</p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button type="button" variant="outline" size="sm" className="h-8 gap-1 px-2" onClick={() => onInspect(profile)}><Eye className="h-3.5 w-3.5" />살펴보기</Button>
                          <Button type="button" variant="outline" size="sm" className="h-8 gap-1 px-2" disabled={duplicatePending} onClick={() => onDuplicate(profile)}><Copy className="h-3.5 w-3.5" />복제</Button>
                          <Button type="button" variant="ghost" size="sm" aria-label={`${profile.name} 비교에서 제거`} className="h-8 w-8 p-0" onClick={() => onRemove(profile.id)}><X className="h-4 w-4" /></Button>
                        </div>
                      </div>
                      <div className="mt-3 overflow-x-auto">
                        <table className="w-full min-w-[440px] text-left text-xs">
                          <caption className="sr-only">{reference?.name} 기준 {profile.name}의 행동 차원 점수와 차이</caption>
                          <thead><tr className="border-b border-slate-100 text-slate-500"><th className="py-2 pr-2 font-medium">차원 · 낮음 ↔ 높음</th><th className="px-2 py-2 text-right font-medium">기준</th><th className="px-2 py-2 text-right font-medium">프로필</th><th className="px-2 py-2 text-right font-medium">차이</th><th className="py-2 pl-2 text-right font-medium">해석</th></tr></thead>
                          <tbody>
                            {dimensions.map((item) => (
                              <tr key={item.key} className="border-b border-slate-50 last:border-0">
                                <th scope="row" className="py-2 pr-2 font-medium text-slate-800">
                                  <span className="block">{item.label}</span>
                                  <span className="font-normal text-slate-500">{item.low} ↔ {item.high}</span>
                                </th>
                                <td className="px-2 py-2 text-right font-mono tabular-nums text-slate-600">{item.referenceValue}</td>
                                <td className="px-2 py-2 text-right font-mono tabular-nums text-slate-800">{item.value}</td>
                                <td className={`px-2 py-2 text-right font-mono tabular-nums ${item.similar ? "text-slate-500" : "font-semibold text-teal-800"}`}>{item.delta > 0 ? "+" : ""}{item.delta}</td>
                                <td className="py-2 pl-2 text-right text-slate-600">{item.similar ? "비슷함" : "차이 있음"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p className="mt-2 text-xs leading-relaxed text-slate-600">{dimensions.map((item) => item.description).join(" ")}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </div>
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-950">
              <p><strong>공식 Erin Meyer 수치가 아닙니다</strong> — {EDITORIAL_CULTURE_NOTICE} 자체 추정 자료에서 가져온 프로필은 검증 전 초안이며, 직접 작성한 프로필은 작성자의 정의입니다. 점수 크기나 차트 면적은 문화적 우열이나 적합도 순위를 뜻하지 않습니다.</p>
              <p className="mt-1">복제 프로필은 원본의 출처 신뢰도를 이어받으며, 복제 과정에서 재검증되지 않습니다. 오차 범위나 불확실성 구간은 제공하지 않습니다.</p>
            </div>
            <p className="text-xs leading-relaxed text-slate-500">비교 또는 살펴보기는 페르소나에 자동 적용되지 않습니다. 시나리오 작성자가 목적에 맞는 프로필을 별도로 선택해야 합니다.</p>
          </>
        )}
      </div>
    </section>
  );
}
