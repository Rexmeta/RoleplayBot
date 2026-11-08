import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { OverrideAuditEntry, OverrideAuditSummary } from "@shared/organizationOverrideAudit";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const labels: Record<string, string> = {
  terminology: "용어", policyConstraints: "정책 제약", forbiddenPhrases: "금지 표현",
  customIncidents: "추가 상황", evaluationWeights: "평가 비중",
};
function summary(value: OverrideAuditSummary) {
  if (!value.configured) return "조직 설정 없음";
  return Object.entries(value.counts).map(([field, count]) => `${labels[field] ?? field} ${count}개`).join(" · ")
    + (Object.keys(value.evaluationWeights).length ? ` / 상대 비중: ${JSON.stringify(value.evaluationWeights)}` : "");
}

/** Remount on organization/filter changes so pagination never crosses scopes. */
export function ScenarioOverrideHistory({ organizationId, scenarioId }: { organizationId: string; scenarioId: string }) {
  const [offset, setOffset] = useState(0);
  const query = useQuery<{ entries: OverrideAuditEntry[]; hasMore: boolean }>({
    queryKey: ["/api/admin/scenario-overrides", "audit-logs", organizationId, scenarioId, offset],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "25", offset: String(offset) });
      if (scenarioId) params.set("scenarioId", scenarioId);
      const response = await apiRequest("GET", `/api/admin/scenario-overrides/organization/${encodeURIComponent(organizationId)}/audit-logs?${params}`);
      return response.json();
    },
  });
  return <Card>
    <CardHeader><CardTitle>조직 설정 변경 이력</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      <p className="text-sm text-muted-foreground">성공한 저장·삭제만 표시합니다. 관리자 식별자와 항목별 요약만 기록하며 지침 원문은 보관하지 않습니다. 기존 실행 스냅샷은 변경되지 않습니다.</p>
      <Button variant="outline" size="sm" onClick={() => query.refetch()} disabled={query.isFetching}>이력 새로고침</Button>
      {query.isLoading ? <p role="status">변경 이력을 불러오는 중입니다.</p>
        : query.isError ? <p role="alert">변경 이력을 불러오지 못했습니다. 다시 시도하세요.</p>
        : !query.data?.entries.length ? <p>기록된 변경 이력이 없습니다.</p>
        : <Table><TableHeader><TableRow>
          <TableHead>변경 시각</TableHead><TableHead>변경한 관리자</TableHead><TableHead>행위 / 시나리오</TableHead><TableHead>변경 전후 요약</TableHead>
        </TableRow></TableHeader><TableBody>{query.data.entries.map(entry => <TableRow key={entry.id}>
          <TableCell>{new Date(entry.createdAt).toLocaleString("ko-KR")}</TableCell>
          <TableCell className="break-all">{entry.actorName ?? "이름 정보 없음"}<div className="text-xs text-muted-foreground">{entry.actorUserId ?? "삭제된 관리자"}</div></TableCell>
          <TableCell>{entry.action === "scenario_override_deleted" ? "삭제" : "저장"}<div className="break-all text-xs">{entry.targetId}</div></TableCell>
          <TableCell>
            <div>변경 항목: {entry.metadata.changedFields.map(field => labels[field] ?? field).join(", ") || "내용 변경 없음"}</div>
            <div>이전: {summary(entry.metadata.before)}</div><div>이후: {summary(entry.metadata.after)}</div>
          </TableCell>
        </TableRow>)}</TableBody></Table>}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={!offset || query.isFetching} onClick={() => setOffset(value => Math.max(0, value - 25))}>이전 이력</Button>
        <Button variant="outline" size="sm" disabled={!query.data?.hasMore || query.isFetching || query.isError} onClick={() => setOffset(value => value + 25)}>다음 이력</Button>
      </div>
    </CardContent>
  </Card>;
}
