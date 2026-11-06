import { Card, CardContent } from "@/components/ui/card";

export type OrganizationOverrideMetadata = {
  organizationId?: string;
  overrideId?: string | null;
  updatedAt?: string | null;
  capturedAt?: string | null;
  override?: Record<string, unknown>;
  dimensions?: { key: string; name?: string; normalizedPercent?: number }[];
  itemCount?: number;
} | null;

export function ScenarioOverrideSummary({ metadata, title = "이 실행의 조직 설정" }: { metadata: OrganizationOverrideMetadata; title?: string }) {
  const known = !!metadata;
  const isEmpty = known && (!metadata.override || Object.values(metadata.override).every(value =>
    Array.isArray(value) ? value.length === 0 : value && typeof value === "object" ? Object.keys(value).length === 0 : !value
  ));
  return (
    <Card className="border-slate-200 bg-slate-50/80 shadow-none" data-testid="organization-override-summary">
      <CardContent className="space-y-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${!known ? "bg-amber-100 text-amber-800" : isEmpty ? "bg-slate-200 text-slate-700" : "bg-teal-100 text-teal-800"}`}>
            {!known ? "과거 실행 — 적용 기록 확인 불가" : isEmpty ? "조직 설정 없음 — 기본값 사용" : "조직 설정 적용"}
          </span>
        </div>
        {known && <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
          <span>조직 ID: {metadata.organizationId || "무소속"}</span>
          <span>적용 시각: {metadata.capturedAt ? new Date(metadata.capturedAt).toLocaleString("ko-KR") : "기록 없음"}</span>
          <span>설정 항목: {metadata.itemCount ?? 0}개</span>
        </div>}
        {known && !!metadata.dimensions?.length && <div className="flex flex-wrap gap-2 pt-1">
          {metadata.dimensions.map(dimension => <span key={dimension.key} className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700">
            {dimension.name || dimension.key} <strong className="ml-1 font-semibold">{Number.isFinite(dimension.normalizedPercent) ? `${dimension.normalizedPercent!.toFixed(1)}%` : "적용 비중 미상"}</strong>
          </span>)}
        </div>}
      </CardContent>
    </Card>
  );
}
