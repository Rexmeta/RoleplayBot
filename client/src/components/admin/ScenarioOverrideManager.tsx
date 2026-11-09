import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BarChart3, Plus, RefreshCw, Save, Trash2, X } from "lucide-react";
import { scenarioOverrideDataSchema, type ScenarioOverrideData } from "@shared/schema";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { ScenarioOverrideHistory } from "./ScenarioOverrideHistory";

type Organization = { id: string; name: string; companyId?: string | null; isActive: boolean; company?: { id: string; name: string; isActive: boolean } | null };
type Scenario = { id: string; title: string; organizationId?: string | null; categoryId?: string | null };
type OverrideRecord = { id: string; organizationId: string; scenarioId: string; override: ScenarioOverrideData; updatedAt: string };
type Preview = { base: ScenarioOverrideData; override: ScenarioOverrideData; effective: ScenarioOverrideData; dimensions: { key: string; name: string; baseWeight: number; weight: number; normalizedPercent: number }[]; errors: string[]; organizationActive: boolean };
type PreviewRequest = { pairKey: string; orgId: string; scenarioId: string; draft: ScenarioOverrideData };
type Options = { organizations: Organization[]; scenarios: Scenario[] };
const blank: ScenarioOverrideData = {};
const labels: Record<string, string> = { clarity: "명확성", empathy: "공감", logic: "논리", ownership: "책임감", actionPlan: "실행 계획" };
const arrayFields = [
  { key: "policyConstraints", label: "정책 제약", note: "응답 작성 지침입니다. 자동 감점이나 법적 준수 보장을 의미하지 않으며, 안전 우선 규칙을 낮출 수 없습니다." },
  { key: "forbiddenPhrases", label: "금지 표현", note: "응답 지침으로만 사용됩니다. 학습자 발화를 자동 감점하거나 차단하지 않습니다." },
  { key: "customIncidents", label: "추가 상황 지침", note: "기존 문자열 배열과 호환되는 상황 안내입니다. 사건을 자동으로 트리거하지 않습니다." },
] as const;

function normalizeRecord(value: any): OverrideRecord | null {
  if (!value) return null;
  return value.override ? value : { ...value, override: value };
}
function empty(data: ScenarioOverrideData) {
  return !Object.keys(data.terminology ?? {}).length && !(data.policyConstraints ?? []).length &&
    !(data.forbiddenPhrases ?? []).length && !Object.keys(data.evaluationWeights ?? {}).length &&
    !(data.customIncidents ?? []).length;
}
function hierarchy(org: Organization) {
  return `${org.company?.name ?? "회사 미지정"} / ${org.name}${org.isActive ? "" : " · 비활성"}`;
}
function json(value: unknown) { return JSON.stringify(value ?? {}); }
function readError(error: unknown) { return error instanceof Error ? error.message : "요청을 완료하지 못했습니다."; }

export function ScenarioOverrideManager() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { toast } = useToast();
  const client = useQueryClient();
  const [orgId, setOrgId] = useState("");
  const [scenarioId, setScenarioId] = useState("");
  const [draft, setDraft] = useState<ScenarioOverrideData>(blank);
  const [baseline, setBaseline] = useState<ScenarioOverrideData>(blank);
  const [baselineVersion, setBaselineVersion] = useState<string | null>(null);
  const [baselineRecordId, setBaselineRecordId] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<OverrideRecord | null | undefined>(undefined);
  const [refreshingConflict, setRefreshingConflict] = useState(false);
  const [initializedKey, setInitializedKey] = useState("");
  const [termKey, setTermKey] = useState("");
  const [termValue, setTermValue] = useState("");
  const [listInputs, setListInputs] = useState<Record<string, string>>({});
  const [weightKey, setWeightKey] = useState("");
  const [weightValue, setWeightValue] = useState("");
  const [filterOrg, setFilterOrg] = useState("");
  const [filterScenario, setFilterScenario] = useState("");

  const optionsQuery = useQuery<Options>({ queryKey: ["/api/admin/scenario-overrides/options"] });
  const orgs = optionsQuery.data?.organizations ?? [];
  const scenarios = optionsQuery.data?.scenarios ?? [];
  const org = orgs.find(item => item.id === orgId);
  const companyActive = org?.company?.isActive !== false;
  const eligibleScenarios = scenarios.filter(item => !item.organizationId || item.organizationId === orgId);
  const selectedScenario = scenarios.find(item => item.id === scenarioId);
  const validPair = !!orgId && !!scenarioId && !!org && !!selectedScenario &&
    (!selectedScenario.organizationId || selectedScenario.organizationId === orgId);
  const detailKey = ["/api/admin/scenario-overrides", orgId, scenarioId];
  const detailQuery = useQuery<OverrideRecord | null>({
    queryKey: detailKey,
    enabled: validPair,
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/admin/scenario-overrides/${encodeURIComponent(orgId)}/${encodeURIComponent(scenarioId)}`);
      return normalizeRecord(await response.json());
    },
  });
  const record = detailQuery.data ?? null;
  const key = `${orgId}::${scenarioId}`;
  const inputDirty = !!(termKey || termValue || weightKey || weightValue || Object.values(listInputs).some(Boolean));
  const dirty = key === initializedKey && (json(draft) !== json(baseline) || inputDirty);

  useEffect(() => {
    if (!validPair || detailQuery.isLoading || detailQuery.isError || initializedKey === key) return;
    const initial = record?.override ?? blank;
    setDraft(initial);
    setBaseline(initial);
    setBaselineVersion(record?.updatedAt ?? null);
    setBaselineRecordId(record?.id ?? null);
    setTermKey(""); setTermValue(""); setWeightKey(""); setWeightValue(""); setListInputs({});
    setInitializedKey(key);
  }, [validPair, detailQuery.isLoading, detailQuery.isError, record, initializedKey, key]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("scenario-override-dirty", { detail: dirty }));
  }, [dirty]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const previewMutation = useMutation({
    mutationFn: async (request: PreviewRequest) => {
      const response = await apiRequest("POST", `/api/admin/scenario-overrides/${encodeURIComponent(request.orgId)}/${encodeURIComponent(request.scenarioId)}/preview`, request.draft);
      return response.json() as Promise<Preview>;
    },
  });
  useEffect(() => {
    if (!validPair || key !== initializedKey || detailQuery.isLoading || detailQuery.isError) return;
    const request = { pairKey: key, orgId, scenarioId, draft };
    const timer = window.setTimeout(() => previewMutation.mutate(request), 350);
    return () => window.clearTimeout(timer);
  // Mutation's mutate function is stable; pair/draft determine the preview.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validPair, key, orgId, scenarioId, initializedKey, detailQuery.isLoading, detailQuery.isError, json(draft)]);

  const invalidateLists = useCallback(async () => {
    await client.invalidateQueries({ queryKey: ["/api/admin/scenario-overrides"] });
  }, [client]);
  const refreshConflict = async () => {
    setRefreshingConflict(true);
    setLatest(undefined);
    try {
      const result = await detailQuery.refetch();
      if (result.isError) throw result.error;
      setLatest(result.data ?? null);
    } catch (error) {
      toast({ title: "최신 설정 조회 실패", description: readError(error), variant: "destructive" });
    } finally { setRefreshingConflict(false); }
  };
  const mutationError = (error: unknown, title: string) => {
    if (readError(error).includes('"OVERRIDE_CONFLICT"')) {
      setConflict(true);
      void refreshConflict();
      toast({ title: "다른 관리자의 변경과 충돌했습니다", description: "입력한 초안은 보존했습니다. 최신 설정을 확인한 뒤 다시 저장하거나 삭제하세요.", variant: "destructive" });
    } else toast({ title, description: readError(error), variant: "destructive" });
  };
  const resolveConflict = (keepDraft: boolean) => {
    if (latest === undefined || refreshingConflict) return;
    if (!keepDraft && !window.confirm("현재 초안과 추가 전 입력을 버리고 최신 설정으로 바꿀까요?")) return;
    setBaseline(latest?.override ?? blank);
    setBaselineVersion(latest?.updatedAt ?? null);
    setBaselineRecordId(latest?.id ?? null);
    if (!keepDraft) {
      setDraft(latest?.override ?? blank);
      setTermKey(""); setTermValue(""); setWeightKey(""); setWeightValue(""); setListInputs({});
    }
    setConflict(false);
  };
  const saveMutation = useMutation({
    mutationFn: async (payload: ScenarioOverrideData) => {
      const response = await apiRequest("PUT", `/api/admin/scenario-overrides/${encodeURIComponent(orgId)}/${encodeURIComponent(scenarioId)}`, { ...payload, expectedUpdatedAt: baselineVersion, expectedOverrideId: baselineRecordId });
      return response.json() as Promise<OverrideRecord>;
    },
    onSuccess: async (saved, variables) => {
      setDraft(variables);
      setBaseline(variables);
      setBaselineVersion(saved.updatedAt);
      setBaselineRecordId(saved.id);
      client.setQueryData(detailKey, saved);
      setInitializedKey(key);
      await invalidateLists();
      await client.invalidateQueries({ queryKey: detailKey });
      toast({ title: "저장 완료", description: "선택한 조직의 새 실행부터 설정이 적용됩니다." });
    },
    onError: error => mutationError(error, "저장 실패"),
  });
  const deleteMutation = useMutation({
    mutationFn: async () => apiRequest("DELETE", `/api/admin/scenario-overrides/${encodeURIComponent(orgId)}/${encodeURIComponent(scenarioId)}`, { expectedUpdatedAt: baselineVersion, expectedOverrideId: baselineRecordId }),
    onSuccess: async () => {
      await invalidateLists();
      await client.invalidateQueries({ queryKey: detailKey });
      setDraft(blank); setBaseline(blank); setInitializedKey(key);
      setBaselineVersion(null);
      setBaselineRecordId(null);
      setTermKey(""); setTermValue(""); setWeightKey(""); setWeightValue(""); setListInputs({});
      toast({ title: "삭제 완료", description: "새 실행은 기본 설정으로 돌아갑니다. 기존 실행은 변경되지 않습니다." });
    },
    onError: error => mutationError(error, "삭제 실패"),
  });
  const mutationsPending = saveMutation.isPending || deleteMutation.isPending || refreshingConflict;
  const reportQuery = useQuery<OverrideRecord[]>({
    queryKey: ["/api/admin/scenario-overrides", "report", filterOrg, filterScenario],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filterOrg) params.set("organizationId", filterOrg);
      if (filterScenario) params.set("scenarioId", filterScenario);
      const response = await apiRequest("GET", "/api/admin/scenario-overrides" + (params.size ? "?" + params.toString() : ""));
      return response.json();
    },
  });

  const choose = (nextOrg: string, nextScenario: string) => {
    if (mutationsPending) return;
    if (dirty && !window.confirm("저장되지 않은 변경 사항이 있습니다. 버리고 선택을 바꾸시겠습니까?")) return;
    setOrgId(nextOrg); setScenarioId(nextScenario); setInitializedKey("");
    setDraft(blank); setBaseline(blank);
    setConflict(false); setLatest(undefined); setBaselineVersion(null); setBaselineRecordId(null);
  };
  const chooseOrg = (value: string) => {
    const nextScenario = scenarios.some(item => item.id === scenarioId && (!item.organizationId || item.organizationId === value)) ? scenarioId : "";
    choose(value, nextScenario);
  };
  const chooseScenario = (value: string) => choose(orgId, value);
  const addTerm = () => {
    if (mutationsPending) return;
    const k = termKey.trim(); const v = termValue.trim();
    if (!k || !v) { toast({ title: "용어와 대체 지침을 모두 입력하세요.", variant: "destructive" }); return; }
    const exists = Object.prototype.hasOwnProperty.call(draft.terminology ?? {}, k);
    if (exists && !window.confirm(`“${k}” 지침을 기존 값에서 새 값으로 교체하시겠습니까?`)) return;
    setDraft(prev => ({ ...prev, terminology: { ...(prev.terminology ?? {}), [k]: v } }));
    setTermKey(""); setTermValue("");
  };
  const addList = (field: typeof arrayFields[number]["key"]) => {
    if (mutationsPending) return;
    const value = (listInputs[field] ?? "").trim();
    if (!value) return;
    const current = draft[field] ?? [];
    if (!current.includes(value)) setDraft(prev => ({ ...prev, [field]: [...(prev[field] ?? []), value] }));
    setListInputs(prev => ({ ...prev, [field]: "" }));
  };
  const addWeight = () => {
    if (mutationsPending) return;
    const value = Number(weightValue);
    if (!weightKey || !weightValue || !Number.isFinite(value) || value < 0 || value > 10) {
      toast({ title: "평가 항목과 0~10 사이의 유한한 가중치를 입력하세요.", variant: "destructive" }); return;
    }
    if (!preview?.dimensions.some(item => item.key === weightKey)) {
      toast({ title: "이 시나리오의 실제 평가 항목이 아닙니다.", variant: "destructive" }); return;
    }
    setDraft(prev => ({ ...prev, evaluationWeights: { ...(prev.evaluationWeights ?? {}), [weightKey]: value } }));
    setWeightKey(""); setWeightValue("");
  };
  const save = () => {
    if (conflict || key !== initializedKey) return;
    if (inputDirty) {
      toast({ title: "아직 추가하지 않은 입력이 있습니다.", description: "각 입력의 추가 버튼을 눌러 초안에 반영한 뒤 저장하세요.", variant: "destructive" }); return;
    }
    const parsed = scenarioOverrideDataSchema.safeParse(draft);
    const errors = preview?.errors ?? [];
    if (!parsed.success) {
      toast({ title: "설정을 확인하세요", description: parsed.error.issues.map(issue => issue.message).join(", "), variant: "destructive" }); return;
    }
    if (empty(parsed.data)) {
      toast({ title: record ? "기존 설정 전체 삭제는 명시적 삭제를 이용하세요." : "빈 설정은 저장할 수 없습니다.", variant: "destructive" }); return;
    }
    if (errors.length || preview?.dimensions.some(item => !Number.isFinite(item.normalizedPercent)) ||
      (preview?.dimensions.length && preview.dimensions.reduce((sum, item) => sum + item.weight, 0) <= 0)) {
      toast({ title: "미리보기 오류를 해결한 뒤 저장하세요.", description: errors.join(" "), variant: "destructive" }); return;
    }
    if (!isAdmin || detailQuery.isLoading || detailQuery.isError || !org?.isActive || !companyActive || !preview?.organizationActive || previewMutation.isError || !validPair) return;
    saveMutation.mutate(parsed.data);
  };
  const currentPreviewRequest = previewMutation.variables;
  const preview = currentPreviewRequest?.pairKey === key &&
    currentPreviewRequest.orgId === orgId && currentPreviewRequest.scenarioId === scenarioId &&
    json(currentPreviewRequest.draft) === json(draft) ? previewMutation.data : undefined;
  const reportRows = reportQuery.data ?? [];
  const orgMap = useMemo(() => Object.fromEntries(orgs.map(item => [item.id, item])), [orgs]);
  const scenarioMap = useMemo(() => Object.fromEntries(scenarios.map(item => [item.id, item.title])), [scenarios]);
  const baseSum = preview?.dimensions.reduce((sum, item) => sum + item.baseWeight, 0) ?? 0;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold">조직별 시나리오 Override</h2>
        <p className="text-sm text-muted-foreground">기본 시나리오를 보존하면서 조직별 응답 지침과 평가 비중을 설정합니다.</p>
      </header>
      {!isAdmin && <Alert><AlertTriangle className="h-4 w-4" /><AlertDescription>운영자 읽기 전용입니다. 위임 조직의 기존 설정만 확인할 수 있으며 변경·저장·삭제할 수 없습니다.</AlertDescription></Alert>}
      {optionsQuery.isError && <Alert variant="destructive"><AlertDescription>조직 및 시나리오 목록을 불러오지 못했습니다. {readError(optionsQuery.error)} <Button variant="outline" size="sm" onClick={() => optionsQuery.refetch()}>다시 시도</Button></AlertDescription></Alert>}
      {optionsQuery.isLoading && <div className="space-y-3"><div className="h-10 animate-pulse rounded bg-muted" /><div className="h-24 animate-pulse rounded bg-muted" /></div>}
      {!optionsQuery.isLoading && !optionsQuery.isError && (
        <>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="h-4 w-4" />적용 현황</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <label className="min-w-[180px] flex-1 text-xs text-muted-foreground">회사 / 조직
                  <Select value={filterOrg || "all"} onValueChange={value => setFilterOrg(value === "all" ? "" : value)}>
                    <SelectTrigger><SelectValue placeholder="전체 조직" /></SelectTrigger><SelectContent><SelectItem value="all">전체 조직</SelectItem>{orgs.map(item => <SelectItem key={item.id} value={item.id}>{hierarchy(item)}</SelectItem>)}</SelectContent>
                  </Select>
                </label>
                <label className="min-w-[180px] flex-1 text-xs text-muted-foreground">시나리오
                  <Select value={filterScenario || "all"} onValueChange={value => setFilterScenario(value === "all" ? "" : value)}>
                    <SelectTrigger><SelectValue placeholder="전체 시나리오" /></SelectTrigger><SelectContent><SelectItem value="all">전체 시나리오</SelectItem>{scenarios.map(item => <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>)}</SelectContent>
                  </Select>
                </label>
                {(filterOrg || filterScenario) && <Button variant="ghost" size="sm" onClick={() => { setFilterOrg(""); setFilterScenario(""); }}>필터 초기화</Button>}
              </div>
              {reportQuery.isLoading ? <div className="h-20 animate-pulse rounded bg-muted" /> :
                reportQuery.isError ? <Alert variant="destructive"><AlertDescription>현황을 불러오지 못했습니다. {readError(reportQuery.error)} <Button size="sm" variant="outline" onClick={() => reportQuery.refetch()}>다시 시도</Button></AlertDescription></Alert> :
                reportRows.length === 0 ? <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  {filterOrg || filterScenario ? "선택한 조건에 해당하는 설정이 없습니다." : "등록된 조직 Override가 없습니다."}
                  {!filterOrg && !filterScenario && <p className="mt-2 text-xs">과거에 저장된 빈 설정은 기존 목록 조회가 호환되는지 확인이 필요합니다.</p>}
                </div> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>회사 / 조직</TableHead><TableHead>시나리오</TableHead><TableHead>설정 수</TableHead><TableHead>최종 수정</TableHead></TableRow></TableHeader><TableBody>
                  {reportRows.map(row => {
                    const data = row.override ?? blank;
                    const count = Object.keys(data.terminology ?? {}).length + (data.policyConstraints?.length ?? 0) + (data.forbiddenPhrases?.length ?? 0) + Object.keys(data.evaluationWeights ?? {}).length + (data.customIncidents?.length ?? 0);
                    return (
                      <TableRow
                        key={row.id}
                        className="cursor-pointer"
                        onClick={() => {
                          choose(row.organizationId, row.scenarioId);
                          document.getElementById("override-editor-section")?.scrollIntoView({ behavior: "smooth" });
                        }}
                      >
                        <TableCell>{orgMap[row.organizationId] ? hierarchy(orgMap[row.organizationId]) : row.organizationId}</TableCell>
                        <TableCell>{scenarioMap[row.scenarioId] ?? row.scenarioId}</TableCell>
                        <TableCell>{count === 0 ? <Badge variant="outline" className="text-amber-700">과거 빈 설정</Badge> : `${count}개`}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{row.updatedAt ? new Date(row.updatedAt).toLocaleString("ko-KR") : "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody></Table></div>}
            </CardContent>
          </Card>
          <div id="override-editor-section">
            <Card><CardHeader><CardTitle className="text-base">대상 선택</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-2">
              <label className="text-sm font-medium">회사 / 조직<Select value={orgId} onValueChange={chooseOrg} disabled={mutationsPending}><SelectTrigger><SelectValue placeholder="조직 선택" /></SelectTrigger><SelectContent>{orgs.map(item => <SelectItem key={item.id} value={item.id}>{hierarchy(item)}</SelectItem>)}</SelectContent></Select></label>
              <label className="text-sm font-medium">시나리오<Select value={scenarioId} onValueChange={chooseScenario} disabled={mutationsPending}><SelectTrigger><SelectValue placeholder="시나리오 선택" /></SelectTrigger><SelectContent>{eligibleScenarios.map(item => <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>)}</SelectContent></Select></label>
            </CardContent></Card>
          </div>
          {orgId && <ScenarioOverrideHistory key={`${orgId}:${scenarioId}`} organizationId={orgId} scenarioId={scenarioId} />}
          {validPair && <div className="space-y-4">
            {conflict && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertDescription>
              <p>다른 관리자가 설정을 변경하거나 삭제했습니다. 내 초안과 추가 전 입력은 보존되어 있습니다. 최신 설정과 비교한 후 처리 방법을 선택하세요.</p>
              {latest !== undefined && <section className="my-3"><h4 className="font-medium">최신 저장 설정</h4><p className="text-xs">{latest ? `수정시각: ${new Date(latest.updatedAt).toLocaleString("ko-KR")}` : "현재 저장된 설정이 없습니다."}</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(latest?.override ?? {}, null, 2)}</pre></section>}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" disabled={refreshingConflict} onClick={() => void refreshConflict()}>{refreshingConflict ? "조회 중…" : "최신 설정 다시 조회"}</Button>
                <Button variant="outline" size="sm" disabled={latest === undefined || refreshingConflict} onClick={() => resolveConflict(true)}>최신 설정 확인 · 내 초안 유지</Button>
                <Button variant="outline" size="sm" disabled={latest === undefined || refreshingConflict} onClick={() => resolveConflict(false)}>초안 버리고 최신 설정 사용</Button>
              </div>
            </AlertDescription></Alert>}
            {detailQuery.isLoading && <Card><CardContent className="space-y-3 p-6"><div className="h-5 w-1/3 animate-pulse rounded bg-muted" /><div className="h-20 animate-pulse rounded bg-muted" /></CardContent></Card>}
            {detailQuery.isError && <Alert variant="destructive"><AlertDescription>설정 조회에 실패했습니다. 빈 설정으로 처리하지 않았습니다. {readError(detailQuery.error)} <Button size="sm" variant="outline" onClick={() => detailQuery.refetch()}><RefreshCw className="mr-2 h-4 w-4" />다시 시도</Button></AlertDescription></Alert>}
            {!detailQuery.isLoading && !detailQuery.isError && <>
              {org && (!org.isActive || !companyActive) && <Alert><AlertTriangle className="h-4 w-4" /><AlertDescription>조직 또는 소속 회사가 비활성 상태입니다. 기존 설정은 조회할 수 있지만 신규 적용·저장은 차단됩니다.</AlertDescription></Alert>}
              {record && empty(record.override) && <Alert><AlertTriangle className="h-4 w-4" /><AlertDescription>과거의 빈 설정입니다. 항목을 추가하거나 명시적으로 삭제하세요.</AlertDescription></Alert>}
              <Card><CardHeader><CardTitle className="text-sm">용어 사용 지침</CardTitle></CardHeader><CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">AI 응답 작성 시 용어 선택을 안내합니다. 콘텐츠 원문이나 학습자의 발화를 문자열로 치환하지 않습니다.</p>
                <div className="flex flex-wrap gap-2">{Object.entries(draft.terminology ?? {}).map(([from, to]) => <Badge key={from} variant="secondary" className="gap-2 py-1">{from}<span aria-hidden="true">→</span>{to}<button type="button" aria-label={`${from} 지침 삭제`} disabled={!isAdmin || mutationsPending} onClick={() => setDraft(prev => { const next = { ...(prev.terminology ?? {}) }; delete next[from]; return { ...prev, terminology: next }; })}><X className="h-3 w-3" /></button></Badge>)}</div>
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><Input aria-label="원래 용어" placeholder="원래 용어" value={termKey} onChange={event => setTermKey(event.target.value)} disabled={!isAdmin || mutationsPending} /><Input aria-label="조직 용어 지침" placeholder="조직에서 권장하는 용어" value={termValue} onChange={event => setTermValue(event.target.value)} disabled={!isAdmin || mutationsPending} /><Button type="button" variant="outline" onClick={addTerm} disabled={!isAdmin || mutationsPending}><Plus className="mr-1 h-4 w-4" />추가 / 교체</Button></div>
              </CardContent></Card>
              {arrayFields.map(field => <Card key={field.key}><CardHeader><CardTitle className="text-sm">{field.label}</CardTitle></CardHeader><CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">{field.note}</p>
                <ul className="space-y-2">{(draft[field.key] ?? []).map((value, index) => <li key={`${value}-${index}`} className="flex items-start gap-2 rounded bg-muted/40 px-3 py-2 text-sm"><span className="flex-1">{value}</span><button type="button" aria-label={`${field.label} 항목 삭제`} disabled={!isAdmin || mutationsPending} onClick={() => setDraft(prev => ({ ...prev, [field.key]: (prev[field.key] ?? []).filter((_, i) => i !== index) }))}><X className="h-4 w-4" /></button></li>)}</ul>
                <div className="flex gap-2"><Input placeholder={`${field.label} 추가`} value={listInputs[field.key] ?? ""} onChange={event => setListInputs(prev => ({ ...prev, [field.key]: event.target.value }))} disabled={!isAdmin || mutationsPending} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addList(field.key); } }} /><Button type="button" variant="outline" onClick={() => addList(field.key)} disabled={!isAdmin || mutationsPending}><Plus className="mr-1 h-4 w-4" />추가</Button></div>
              </CardContent></Card>)}
              <Card><CardHeader><CardTitle className="text-sm">평가 가중치</CardTitle></CardHeader><CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">값은 상대 가중치(0~10)입니다. 입력하지 않은 항목은 기본 상대값을 유지합니다. 최종 비중은 정규화 기준이며 합계 0이나 실제 평가에 없는 항목은 저장할 수 없습니다.</p>
                <div className="flex flex-wrap gap-2">{Object.entries(draft.evaluationWeights ?? {}).map(([keyName, value]) => <Badge key={keyName} variant="outline" className="gap-2">{labels[keyName] ?? keyName}: {value}<button type="button" aria-label={`${labels[keyName] ?? keyName} 가중치 삭제`} disabled={!isAdmin || mutationsPending} onClick={() => setDraft(prev => { const next = { ...(prev.evaluationWeights ?? {}) }; delete next[keyName]; return { ...prev, evaluationWeights: next }; })}><X className="h-3 w-3" /></button></Badge>)}</div>
                <div className="grid gap-2 sm:grid-cols-[1fr_140px_auto]">
                  <Select value={weightKey} onValueChange={setWeightKey} disabled={!isAdmin || mutationsPending || !preview?.dimensions.length}><SelectTrigger><SelectValue placeholder="미리보기의 평가 항목" /></SelectTrigger><SelectContent>{(preview?.dimensions ?? []).map(item => <SelectItem key={item.key} value={item.key}>{item.name || labels[item.key] || item.key}</SelectItem>)}</SelectContent></Select>
                  <Input type="number" min="0" max="10" step="0.1" value={weightValue} onChange={event => setWeightValue(event.target.value)} placeholder="0–10" disabled={!isAdmin || mutationsPending} />
                  <Button type="button" variant="outline" onClick={addWeight} disabled={!isAdmin || mutationsPending}><Plus className="mr-1 h-4 w-4" />추가 / 교체</Button>
                </div>
                {previewMutation.isPending ? <div className="h-10 animate-pulse rounded bg-muted" /> : previewMutation.isError && !preview ? <Alert variant="destructive"><AlertDescription>적용 미리보기를 불러오지 못했습니다. {readError(previewMutation.error)} <Button size="sm" variant="outline" onClick={() => previewMutation.mutate({ pairKey: key, orgId, scenarioId, draft })}>다시 시도</Button></AlertDescription></Alert> : preview ? <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>평가 항목</TableHead><TableHead>기본 상대값</TableHead><TableHead>최종 상대값</TableHead><TableHead>최종 비중</TableHead></TableRow></TableHeader><TableBody>{preview.dimensions.map(item => <TableRow key={item.key}><TableCell>{item.name || labels[item.key] || item.key}</TableCell><TableCell>{item.baseWeight}</TableCell><TableCell>{item.weight}</TableCell><TableCell>{Number.isFinite(item.normalizedPercent) ? `${item.normalizedPercent.toFixed(1)}%` : "적용 불가"}</TableCell></TableRow>)}</TableBody></Table><p className="mt-2 text-xs text-muted-foreground">기본 상대 가중치 합계 {baseSum.toFixed(2)} · 최종 비중은 전체 상대값을 기준으로 정규화됩니다.</p></div> : <p className="text-sm text-muted-foreground">현재 초안의 평가 미리보기를 준비 중입니다.</p>}
              </CardContent></Card>
              {previewMutation.isError && <Alert variant="destructive"><AlertDescription>최종 적용 내용을 확인할 수 없어 저장할 수 없습니다.</AlertDescription></Alert>}
              {preview?.errors?.length ? <Alert variant="destructive"><AlertDescription>{preview.errors.join(" ")}</AlertDescription></Alert> : null}
              {preview && <Card><CardHeader><CardTitle className="text-sm">최종 적용 내용 미리보기</CardTitle></CardHeader><CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">미지정 항목은 기본값을 유지합니다. 설정을 삭제하면 다음 실행부터 기본값으로 돌아가며, 기존 실행에는 영향이 없습니다. 지침의 실제 모델 준수를 보장하지 않습니다.</p>
                <div className="grid gap-3 lg:grid-cols-3">{([{ title: "공통 기본값", data: preview.base }, { title: "조직 설정", data: preview.override }, { title: "최종 적용", data: preview.effective }] as const).map(panel => <section key={panel.title} className="min-w-0 rounded-md border p-3"><h4 className="mb-2 font-medium">{panel.title}</h4><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(panel.data, null, 2)}</pre></section>)}</div>
                {!preview.organizationActive && <p className="text-sm text-destructive">비활성 조직에는 신규 적용할 수 없습니다.</p>}
              </CardContent></Card>}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                {record && <Button type="button" variant="destructive" disabled={!isAdmin || conflict || mutationsPending || detailQuery.isLoading || detailQuery.isError || key !== initializedKey} onClick={() => { if (window.confirm("이 조직 Override를 삭제할까요? 새 실행은 기본 설정을 사용하며 기존 실행은 변경되지 않습니다.")) deleteMutation.mutate(); }}><Trash2 className="mr-2 h-4 w-4" />{deleteMutation.isPending ? "삭제 중…" : "Override 삭제"}</Button>}
                <Button type="button" onClick={save} disabled={!isAdmin || conflict || mutationsPending || detailQuery.isLoading || detailQuery.isError || key !== initializedKey || !org?.isActive || !companyActive || !preview || previewMutation.isPending || previewMutation.isError || !!preview.errors.length || preview.organizationActive === false || !dirty || inputDirty || empty(draft)}><Save className="mr-2 h-4 w-4" />{saveMutation.isPending ? "저장 중…" : record ? "변경 사항 저장" : "새 Override 저장"}</Button>
              </div>
            </>}
          </div>}
        </>
      )}
    </div>
  );
}
