import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ScoringRubric } from "@shared/schema/types";

interface CriteriaDetails {
  id: string;
  name: string;
  description?: string | null;
  status?: string;
  dimensions: {
    id: string;
    key: string;
    name: string;
    description?: string | null;
    weight: number;
    minScore: number;
    maxScore: number;
    displayOrder?: number;
    isActive: boolean;
    scoringRubric?: ScoringRubric[] | null;
  }[];
}

/** Read-only authoring preview; never changes the selected rubric or its weights. */
export function ScenarioCriteriaPreview({ criteriaSetId }: { criteriaSetId?: string }) {
  const query = useQuery<CriteriaDetails>({
    queryKey: ["/api/admin/evaluation-criteria", criteriaSetId],
    enabled: !!criteriaSetId,
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/admin/evaluation-criteria/${encodeURIComponent(criteriaSetId!)}`);
      return response.json();
    },
  });

  if (!criteriaSetId) return (
    <p className="mt-3 text-xs text-slate-500">기본 기준 사용 시 카테고리에 연결된 평가 기준 또는 시스템 기본 기준이 적용됩니다. 특정 세트를 선택하면 하위 지표를 확인할 수 있습니다.</p>
  );
  if (query.isLoading) return <p role="status" className="mt-3 text-sm text-slate-500">평가 지표를 불러오는 중입니다…</p>;
  if (query.isError) return (
    <div role="alert" className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      평가 지표를 불러오지 못했습니다. 선택한 세트는 변경되지 않았습니다.
      <Button type="button" variant="outline" size="sm" className="ml-2" onClick={() => query.refetch()}>다시 시도</Button>
    </div>
  );
  if (!query.data) return null;
  const criteria = query.data;
  const dimensions = [...(criteria.dimensions ?? [])].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
  return (
    <section aria-label="선택한 평가 기준의 하위 지표" className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-slate-800">{criteria.name}</h4>
        <Badge variant="outline">하위 지표 {dimensions.length}개</Badge>
      </div>
      {criteria.description && <p className="whitespace-pre-wrap text-sm text-slate-600">{criteria.description}</p>}
      {criteria.status && criteria.status !== "approved" && (
        <p className="text-xs text-amber-700">아직 승인되지 않은 세트입니다. 실제 평가에서는 승인 정책에 따라 카테고리 또는 기본 기준이 사용될 수 있습니다.</p>
      )}
      {!dimensions.length && <p className="text-sm text-slate-500">등록된 하위 평가 지표가 없습니다.</p>}
      {dimensions.map(dimension => (
        <article key={dimension.id || dimension.key} className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-slate-800">{dimension.name}</span>
            <Badge variant="outline">가중치 {dimension.weight}</Badge>
            <span className="text-xs text-slate-500">점수 {dimension.minScore}–{dimension.maxScore}</span>
            {dimension.isActive === false && <Badge variant="secondary">비활성 · 평가 제외</Badge>}
          </div>
          {dimension.description && <p className="whitespace-pre-wrap text-sm text-slate-600">{dimension.description}</p>}
          {!!dimension.scoringRubric?.length && (
            <details className="text-sm">
              <summary className="cursor-pointer text-slate-700">점수별 기준 및 행동 지표 보기</summary>
              <ul className="mt-2 space-y-3 border-t pt-2">
                {dimension.scoringRubric.map((band, index) => (
                  <li key={`${band.score}-${index}`} className="space-y-1">
                    <p className="font-medium">{band.score}점 · {band.label}</p>
                    <p className="whitespace-pre-wrap text-slate-600">{band.description}</p>
                    {band.behaviorAnchor && <p className="whitespace-pre-wrap text-slate-600">행동 예시: {band.behaviorAnchor}</p>}
                    {!!band.positiveIndicators?.length && <p className="whitespace-pre-wrap text-slate-600">긍정 지표: {band.positiveIndicators.join(" · ")}</p>}
                    {!!band.negativeIndicators?.length && <p className="whitespace-pre-wrap text-slate-600">부정 지표: {band.negativeIndicators.join(" · ")}</p>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </article>
      ))}
    </section>
  );
}
