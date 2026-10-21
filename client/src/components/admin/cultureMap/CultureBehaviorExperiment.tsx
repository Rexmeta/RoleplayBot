import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Download, Play } from "lucide-react";
import {
  CULTURE_BEHAVIOR_CHECKS,
  CULTURE_EXPERIMENT_SITUATIONS,
  DEFAULT_EXPERIMENT_FIXED,
  type CultureExperimentRequest,
  type CultureExperimentResult,
  type ExperimentVariant,
} from "@shared/cultureExperiment";
import type { CultureProfile } from "@shared/cultureMap";

type ExperimentConfig = {
  policy: { provider: string; model: string };
  situations: typeof CULTURE_EXPERIMENT_SITUATIONS;
  notice: string;
  maxCalls: number;
};
type VariantDraft = { profileId: string; intensity: number };
type Observation = { value: string; evidence: string };
type ObservationMap = Record<string, Observation>;
type SavedRun = {
  result: CultureExperimentResult;
  request: CultureExperimentRequest;
  situations: ExperimentConfig["situations"];
  observations: ObservationMap;
};

const profileKey = ["/api/admin/culture-profiles"];
const configKey = ["/api/simulation/culture-experiment/config"];
const experimentKey = (situationId: string, variantId: string, repetition: number) =>
  `${situationId}::${variantId}::${repetition}`;
const observationKey = (caseKey: string, check: string) => `${caseKey}::${check}`;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "요청을 완료하지 못했습니다. 다시 시도해 주세요.";
}

function costText(value: number | null) {
  return value === null ? "알 수 없음" : `$${value.toFixed(6)} USD`;
}

function variantLabel(variant: ExperimentVariant) {
  return variant.label;
}

export function CultureBehaviorExperiment() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [fixed, setFixed] = useState({ ...DEFAULT_EXPERIMENT_FIXED });
  const [variants, setVariants] = useState<VariantDraft[]>([{ profileId: "", intensity: 50 }]);
  const [repetitions, setRepetitions] = useState(1);
  const [confirmPaidRun, setConfirmPaidRun] = useState(false);
  const [runError, setRunError] = useState("");
  const [savedRun, setSavedRun] = useState<SavedRun | null>(null);
  const [observations, setObservations] = useState<ObservationMap>({});

  const profilesQuery = useQuery<CultureProfile[]>({
    queryKey: profileKey,
    queryFn: async () => (await apiRequest("GET", "/api/admin/culture-profiles")).json(),
    enabled: isAdmin,
  });
  const configQuery = useQuery<ExperimentConfig>({
    queryKey: configKey,
    queryFn: async () => (await apiRequest("GET", "/api/simulation/culture-experiment/config")).json(),
    enabled: isAdmin,
  });
  const selectedProfiles = useMemo(
    () => variants.map((variant) => profilesQuery.data?.find((profile) => profile.id === variant.profileId)),
    [variants, profilesQuery.data],
  );

  const runMutation = useMutation({
    mutationFn: async (variables: { request: CultureExperimentRequest; situations: ExperimentConfig["situations"] }) =>
      (await apiRequest("POST", "/api/simulation/culture-experiment", variables.request)).json() as Promise<CultureExperimentResult>,
    onSuccess: (result, variables) => {
      setSavedRun({ result, request: variables.request, situations: variables.situations, observations: {} });
      setObservations({});
      setRunError("");
    },
    onError: (error) => setRunError(errorMessage(error)),
  });

  if (!isAdmin) return null;

  const busy = runMutation.isPending;
  const config = configQuery.data;
  const fixedValid = Object.values(fixed).every((value) => value.trim().length > 0);
  const variantsValid = variants.length >= 1 && variants.every((variant) =>
    !!profilesQuery.data?.some((profile) => profile.id === variant.profileId)
      && Number.isFinite(variant.intensity)
      && variant.intensity >= 0
      && variant.intensity <= 100,
  );
  const canRun = !!config && fixedValid && variantsValid && !busy && !profilesQuery.isLoading;

  const updateFixed = (key: keyof typeof DEFAULT_EXPERIMENT_FIXED, value: string) =>
    setFixed((current) => ({ ...current, [key]: value }));
  const updateVariant = (index: number, patch: Partial<VariantDraft>) =>
    setVariants((current) => current.map((item, position) => position === index ? { ...item, ...patch } : item));
  const submit = (mode: "mock" | "provider") => {
    if (!canRun) return;
    if (mode === "provider" && !confirmPaidRun) return;
    const request: CultureExperimentRequest = {
      mode,
      confirmPaidRun: mode === "provider" && confirmPaidRun,
      fixed: { ...fixed },
      variants: variants.map((variant, index) => ({
        enabled: true,
        profileId: variant.profileId,
        profileVersion: selectedProfiles[index]!.version,
        intensity: variant.intensity,
        overrides: {},
      })),
      repetitions,
    };
    setRunError("");
    runMutation.mutate({ request, situations: config!.situations });
  };
  const updateObservation = (key: string, patch: Partial<Observation>) => {
    setObservations((current) => ({
      ...current,
      [key]: { ...{ value: "", evidence: "" }, ...current[key], ...patch },
    }));
  };
  const downloadResult = () => {
    if (!savedRun) return;
    const payload = {
      ...savedRun,
      observations,
      exportedAt: new Date().toISOString(),
      persistence: "다운로드 파일에만 포함됩니다. 서버에 저장되지 않습니다.",
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `culture-experiment-${savedRun.result.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const currentResultIsPrevious = !!savedRun && !!runError;
  const result = savedRun?.result;
  const situations = result && savedRun ? savedRun.situations : config?.situations ?? CULTURE_EXPERIMENT_SITUATIONS;
  const groupedCases = result ? situations.map((situation) => ({
    situation,
    repetitions: Array.from({ length: result.repetitions }, (_, index) => ({
      repetition: index + 1,
      cases: result.cases.filter((item) => item.situationId === situation.id && item.repetition === index + 1),
    })),
  })).filter((group) => group.repetitions.some((entry) => entry.cases.length > 0)) : [];

  return (
    <section className="space-y-5" aria-label="Culture Map 행동 실험" data-testid="culture-behavior-experiment">
      <header className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-700">Controlled comparison</p>
          <h2 className="mt-1 text-2xl font-semibold text-slate-900">문화 행동 실험</h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-600">
            같은 업무 상황을 문화 OFF와 선택한 프로필로 비교합니다. 정체성, 조직, 역할, 모델은 고정하고 응답은 짝별로 읽습니다.
          </p>
        </div>
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
          <span className="text-slate-500">현재 설정 모델</span>
          <p className="font-medium text-slate-800" data-testid="experiment-current-model">
            {config ? `${config.policy.provider} · ${config.policy.model}` : "설정 확인 중"}
          </p>
        </div>
      </header>

      <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm leading-relaxed text-amber-950" role="note">
        <p><strong>해석 범위.</strong> {config?.notice ?? "국가별 실측 검증이 아닌 통제된 프롬프트 비교입니다."}</p>
        <ul className="list-disc space-y-1 pl-5 text-xs text-amber-900">
          <li>프로필의 국가 점수는 검증되지 않은 편집 추정치이며, 실제 국가 행동 측정값이 아닙니다.</li>
          <li>인접 점수의 정밀한 차이를 주장하지 마세요. 강도는 행동 확률이 아닙니다.</li>
          <li>한 번의 응답은 인과 증거가 아니며 무작위 생성의 영향을 받을 수 있습니다.</li>
          <li>이 텍스트 실험은 음성 행동을 검증하지 않으며 학습자 평가 점수와 분리됩니다.</li>
        </ul>
      </div>

      {configQuery.isLoading && <div className="h-16 animate-pulse rounded-md bg-slate-100" aria-label="실험 설정 로딩 중" data-testid="experiment-config-loading" />}
      {configQuery.isError && (
        <div role="alert" className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>실험 설정을 불러오지 못했습니다. 실행은 설정을 확인한 뒤 가능합니다.</span>
          <Button type="button" variant="link" className="ml-auto" onClick={() => configQuery.refetch()}>다시 시도</Button>
        </div>
      )}
      {profilesQuery.isLoading && <div className="h-16 animate-pulse rounded-md bg-slate-100" aria-label="문화 프로필 로딩 중" data-testid="experiment-profiles-loading" />}
      {profilesQuery.isError && (
        <div role="alert" className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 shrink-0" /><span>문화 프로필을 불러오지 못했습니다.</span>
          <Button type="button" variant="link" className="ml-auto" onClick={() => profilesQuery.refetch()}>다시 시도</Button>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.72fr)]">
        <div className="space-y-5">
          <fieldset disabled={busy} className="space-y-4 rounded-md border border-slate-200 bg-white p-4 sm:p-5">
            <legend className="px-1 text-base font-semibold text-slate-900">비교 조건</legend>
            <p className="-mt-1 text-xs text-slate-500">동일한 고정 입력이 모든 상황과 변형에 적용됩니다.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label htmlFor="experiment-name">이름 / 페르소나 정체성</Label><Input id="experiment-name" data-testid="experiment-fixed-name" value={fixed.name} maxLength={100} onChange={(event) => updateFixed("name", event.target.value)} /></div>
              <div><Label htmlFor="experiment-role">Actor 역할</Label><Input id="experiment-role" data-testid="experiment-fixed-role" value={fixed.role} maxLength={200} onChange={(event) => updateFixed("role", event.target.value)} /></div>
              <div><Label htmlFor="experiment-player-role">학습자 역할</Label><Input id="experiment-player-role" data-testid="experiment-fixed-player-role" value={fixed.playerRole} maxLength={200} onChange={(event) => updateFixed("playerRole", event.target.value)} /></div>
              <div><Label htmlFor="experiment-organization">조직</Label><Input id="experiment-organization" data-testid="experiment-fixed-organization" value={fixed.organization} maxLength={500} onChange={(event) => updateFixed("organization", event.target.value)} /></div>
              <div className="sm:col-span-2"><Label htmlFor="experiment-personality">성격 / 행동 기반</Label><Textarea id="experiment-personality" data-testid="experiment-fixed-personality" value={fixed.personality} maxLength={1000} rows={3} onChange={(event) => updateFixed("personality", event.target.value)} /></div>
            </div>
            <div className="space-y-3 border-t border-slate-100 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><h3 className="text-sm font-semibold text-slate-800">문화 변형</h3><p className="text-xs text-slate-500">서버가 항상 OFF 기준 응답을 추가합니다. 선택은 1–3개이며 같은 프로필의 강도만 바꿔 비교할 수도 있습니다.</p></div>
                <Button type="button" variant="outline" size="sm" data-testid="experiment-add-variant" disabled={variants.length >= 3 || profilesQuery.isLoading} onClick={() => setVariants((current) => [...current, { profileId: "", intensity: 50 }])}>변형 추가</Button>
              </div>
              {variants.map((variant, index) => {
                const selected = selectedProfiles[index];
                return <div key={index} className="grid gap-3 rounded-md border border-slate-200 bg-slate-50/70 p-3 sm:grid-cols-[minmax(0,1fr)_170px_auto] sm:items-end">
                  <div>
                    <Label htmlFor={`experiment-profile-${index}`}>변형 {index + 1} · 국가/프로필</Label>
                    <select id={`experiment-profile-${index}`} data-testid={`experiment-profile-${index}`} value={variant.profileId} onChange={(event) => updateVariant(index, { profileId: event.target.value })} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm" required>
                      <option value="">프로필 선택</option>
                      {(profilesQuery.data ?? []).map((profile) => <option key={profile.id} value={profile.id}>{profile.country} · {profile.name} (v{profile.version})</option>)}
                    </select>
                    {selected && <p className="mt-1 text-xs text-slate-500">{selected.region || "지역 미기재"} · 선택 시 v{selected.version} 고정</p>}
                  </div>
                  <div>
                    <Label htmlFor={`experiment-intensity-${index}`}>반영 강도 <span className="font-mono text-xs text-slate-500">{variant.intensity}</span></Label>
                    <input id={`experiment-intensity-${index}`} data-testid={`experiment-intensity-${index}`} aria-label={`변형 ${index + 1} 반영 강도`} type="range" min="0" max="100" step="1" value={variant.intensity} onChange={(event) => updateVariant(index, { intensity: Number(event.target.value) })} className="mt-2 w-full accent-teal-700" />
                  </div>
                  <Button type="button" variant="ghost" size="sm" aria-label={`변형 ${index + 1} 제거`} data-testid={`experiment-remove-variant-${index}`} disabled={variants.length <= 1} onClick={() => setVariants((current) => current.filter((_, position) => position !== index))}>제거</Button>
                </div>;
              })}
              {profilesQuery.data?.length === 0 && <p className="rounded border border-dashed border-slate-300 p-3 text-sm text-slate-600">사용 가능한 프로필이 없습니다. 먼저 Culture Map에서 프로필을 만드세요.</p>}
            </div>
            <div className="max-w-xs">
              <Label htmlFor="experiment-repetitions">반복 횟수</Label>
              <select id="experiment-repetitions" data-testid="experiment-repetitions" value={repetitions} onChange={(event) => setRepetitions(Number(event.target.value))} className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                <option value={1}>1회</option><option value={2}>2회</option>
              </select>
            </div>
          </fieldset>

          <section className="rounded-md border border-slate-200 bg-white p-4 sm:p-5" aria-labelledby="experiment-situations-heading">
            <h3 id="experiment-situations-heading" className="font-semibold text-slate-900">고정 업무 상황</h3>
            <p className="mb-3 mt-1 text-xs text-slate-500">각 조건에 같은 학습자 발화를 사용합니다.</p>
            <ol className="space-y-2">
              {situations.map((item, index) => <li key={item.id} className="grid gap-1 rounded-md bg-slate-50 p-3 sm:grid-cols-[30px_minmax(0,1fr)]">
                <span className="font-mono text-xs text-teal-800">0{index + 1}</span>
                <div><h4 className="text-sm font-semibold text-slate-800">{item.title}</h4><p className="mt-1 text-sm text-slate-600">{item.situation}</p><p className="mt-2 border-l-2 border-teal-300 pl-2 text-sm text-slate-700">“{item.userMessage}”</p></div>
              </li>)}
            </ol>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-md border border-slate-200 bg-white p-4 sm:p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">실행 전 확인</p>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-3"><span className="text-slate-600">고정 정책 모델</span><strong className="text-right text-slate-800">{config ? `${config.policy.provider} / ${config.policy.model}` : "확인 필요"}</strong></div>
              <div className="flex justify-between gap-3"><span className="text-slate-600">비교 사례 수</span><strong className="font-mono text-slate-800">{(variants.length + 1) * situations.length * repetitions}</strong></div>
              {config && <p className="border-t border-slate-100 pt-2 text-xs text-slate-500">최대 {config.maxCalls}개 사례 · OFF 포함 · 제공자 내부 재시도 시 실제 호출 수는 늘어날 수 있습니다.</p>}
            </div>
            <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
              <Button type="button" className="w-full gap-2" data-testid="experiment-run-mock" disabled={!canRun} onClick={() => submit("mock")}>
                <Play className="h-4 w-4" />{busy ? "실행 중…" : "Mock 비교 실행"}
              </Button>
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm font-semibold text-amber-950">Provider 실행 · 비용이 발생할 수 있습니다</p>
                <p className="mt-1 text-xs leading-relaxed text-amber-900">요금은 사전에 알 수 없으며 비용 상한을 보장하지 않습니다. 실패하거나 재시도된 호출도 과금될 수 있고, 그 비용은 추정치에 잡히지 않을 수 있습니다. 실행할 때만 Provider가 호출됩니다.</p>
                <label className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-amber-950">
                  <input type="checkbox" data-testid="experiment-paid-acknowledgement" checked={confirmPaidRun} disabled={busy} onChange={(event) => setConfirmPaidRun(event.target.checked)} className="mt-0.5 h-4 w-4 accent-amber-800" />
                  <span>실제 Provider 호출과 비용 발생 가능성을 이해했으며, 알 수 없는 비용을 확인했습니다.</span>
                </label>
                <Button type="button" variant="outline" className="mt-3 w-full border-amber-400 bg-white text-amber-950 hover:bg-amber-100" data-testid="experiment-run-provider" disabled={!canRun || !confirmPaidRun} onClick={() => submit("provider")}>
                  {busy ? "실행 중…" : "확인 후 Provider 실행"}
                </Button>
              </div>
            </div>
            {busy && <div role="status" className="mt-3 space-y-2" data-testid="experiment-running">
              <div className="h-2 animate-pulse rounded bg-teal-100" /><p className="text-xs text-slate-600">상황별 비교 응답을 생성하고 있습니다. 이 화면을 닫지 마세요.</p>
            </div>}
          </section>
          {runError && <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" data-testid="experiment-run-error"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div><strong>이번 요청 실패</strong><p className="mt-1">{runError}</p>{savedRun && <p className="mt-1 text-xs">아래 결과는 이전 실행이며 변경되지 않았습니다.</p>}</div></div>}
        </aside>
      </div>

      {result && savedRun && <section className="space-y-4 border-t border-slate-200 pt-5" aria-labelledby="experiment-result-heading" data-testid="experiment-result">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="experiment-result-heading" className="text-xl font-semibold text-slate-900">실험 결과</h2>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${result.mode === "provider" ? "bg-amber-100 text-amber-900" : "bg-teal-100 text-teal-900"}`} data-testid="experiment-result-mode">{result.mode === "provider" ? "PROVIDER · 실제 호출" : "MOCK · 모의 결과"}</span>
              {currentResultIsPrevious && <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700">이전 실행 결과</span>}
            </div>
            <p className="mt-1 text-sm text-slate-600">실행 ID {result.id} · {new Date(result.startedAt).toLocaleString()} · {result.policy.provider} / {result.policy.model}</p>
          </div>
          <Button type="button" variant="outline" className="gap-2" data-testid="experiment-download-json" onClick={downloadResult}><Download className="h-4 w-4" />JSON 다운로드</Button>
        </header>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">성공 / 실패 사례</p><p className="mt-1 font-mono text-lg font-semibold text-slate-900">{result.cases.filter((item) => item.status === "completed").length} / {result.cases.filter((item) => item.status === "failed").length}</p></div>
          <div className="rounded-md border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">확인 가능한 예상 비용</p><p className="mt-1 font-mono text-lg font-semibold text-slate-900">{costText(result.knownEstimatedCostUsd)}</p></div>
          <div className="rounded-md border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">비용 미확인 사례</p><p className="mt-1 font-mono text-lg font-semibold text-slate-900">{result.unknownCostCases}건</p></div>
        </div>
        <p className="rounded-md bg-slate-100 p-3 text-xs leading-relaxed text-slate-600">{result.costNotice} 알려진 예상치 합계는 전체 비용 보장이 아닙니다.</p>
        <details className="rounded-md border border-slate-200 bg-white p-4" data-testid="experiment-frozen-details">
          <summary className="cursor-pointer text-sm font-semibold text-slate-800">이 실행의 고정 입력과 출처 보기</summary>
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            <div><h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">고정 정체성 · 요청 스냅샷</h3><pre className="mt-2 overflow-x-auto rounded bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">{JSON.stringify(savedRun.request.fixed, null, 2)}</pre><p className="mt-2 text-xs text-slate-500">반복 {result.repetitions}회 · {result.mode} 모드 · 실행 시 선택한 프로필 버전은 요청과 아래 문화 스냅샷에 보존됩니다.</p></div>
            <div><h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">모델 · 문화 프로필 스냅샷 · provenance</h3><pre className="mt-2 max-h-96 overflow-auto rounded bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">{JSON.stringify({ policy: result.policy, variants: result.variants }, null, 2)}</pre></div>
          </div>
          <p className="mt-3 text-xs text-slate-500">결과 입력은 이번 실행의 스냅샷입니다. 현재 설정을 이전 결과의 조건으로 간주하지 않습니다. 이 UI는 결과를 서버에 저장한다고 주장하지 않습니다.</p>
        </details>

        <div className="space-y-4">
          {groupedCases.map(({ situation, repetitions: repetitionGroups }) => <article key={situation.id} className="overflow-hidden rounded-md border border-slate-200 bg-white">
            <header className="border-b border-slate-200 bg-slate-50 px-4 py-3"><h3 className="font-semibold text-slate-900">{situation.title}</h3><p className="mt-1 text-sm text-slate-600">{situation.situation}</p><p className="mt-1 text-xs text-slate-500">학습자 발화: “{situation.userMessage}”</p></header>
            <div className="space-y-4 p-4">
              {repetitionGroups.map(({ repetition, cases }) => <section key={repetition} className="space-y-3" aria-label={`${situation.title} 반복 ${repetition}`}>
                <h4 className="border-l-2 border-teal-600 pl-2 text-sm font-semibold text-slate-800">반복 {repetition}</h4>
                <div className="space-y-3">
                  {result.variants.map((variant) => {
                    const item = cases.find((entry) => entry.variantId === variant.id);
                    if (!item) return <div key={variant.id} className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800"><strong>{variantLabel(variant)}</strong><p className="mt-1">이 사례 결과를 찾을 수 없습니다.</p></div>;
                    const caseKey = experimentKey(situation.id, variant.id, repetition);
                    return <div key={variant.id} className={`rounded-md border p-3 ${item.status === "failed" ? "border-red-200 bg-red-50/70" : "border-slate-200 bg-white"}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2"><h5 className="font-semibold text-slate-900">{variantLabel(variant)}</h5><span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${item.status === "completed" ? "bg-teal-50 text-teal-800" : "bg-red-100 text-red-800"}`}>{item.status === "completed" ? "완료" : "실패"}</span></div>
                        <span className="font-mono text-xs text-slate-500">{item.durationMs} ms · 비용 {costText(item.estimatedCostUsd)}{item.usage ? ` · 입력 ${item.usage.inputTokens} / 출력 ${item.usage.outputTokens} tokens` : " · 토큰 미제공"}</span>
                      </div>
                      {item.status === "failed" ? <div role="alert" className="mt-3 rounded border border-red-200 bg-white/70 p-3 text-sm text-red-800"><strong>이 사례 생성 실패</strong><p className="mt-1">{item.error || "서버가 실패 사유를 제공하지 않았습니다."}</p>{item.content && <div className="mt-2 whitespace-pre-wrap border-t border-red-100 pt-2"><p className="text-xs font-semibold">실패 전 수신된 부분 응답 · 완성된 결과 아님</p>{item.content}</div>}</div>
                        : <div className="mt-3 whitespace-pre-wrap rounded bg-slate-50 p-3 text-sm leading-relaxed text-slate-800">{item.content || "응답 내용이 비어 있습니다."}</div>}
                      <details className="mt-3 rounded border border-slate-200 bg-white p-3">
                        <summary className="cursor-pointer text-sm font-semibold text-slate-800">수동 행동 관찰 · 학습자 점수 아님</summary>
                        <p className="mb-3 mt-2 text-xs leading-relaxed text-slate-500">관찰은 정성 기록입니다. 아래 질문에 근거가 되는 Actor 발화의 짧은 인용을 기록하세요. 평가 점수로 환산하지 않습니다.</p>
                        <div className="space-y-3">
                          {CULTURE_BEHAVIOR_CHECKS.map((check) => {
                            const current = observations[observationKey(caseKey, check.key)] ?? { value: "", evidence: "" };
                            return <div key={check.key} className="grid gap-2 border-t border-slate-100 pt-3 md:grid-cols-[minmax(0,1fr)_minmax(180px,0.8fr)]">
                              <div><Label htmlFor={`obs-${caseKey}-${check.key}`}>{check.label}</Label><p className="mt-1 text-xs text-slate-600">{check.question}</p>
                                <Textarea id={`obs-${caseKey}-${check.key}`} data-testid={`observation-${situation.id}-${variant.id}-${repetition}-${check.key}`} aria-label={`${check.label} 수동 관찰`} rows={2} value={current.value} disabled={busy} placeholder="정성 관찰 메모 (선택)" onChange={(event) => updateObservation(observationKey(caseKey, check.key), { value: event.target.value })} />
                              </div>
                              <div><Label htmlFor={`evidence-${caseKey}-${check.key}`}>근거 인용</Label><Textarea id={`evidence-${caseKey}-${check.key}`} data-testid={`evidence-${situation.id}-${variant.id}-${repetition}-${check.key}`} rows={2} value={current.evidence} disabled={busy} placeholder="응답에서 근거가 되는 짧은 구절 (선택)" onChange={(event) => updateObservation(observationKey(caseKey, check.key), { evidence: event.target.value })} /></div>
                            </div>;
                          })}
                        </div>
                      </details>
                    </div>;
                  })}
                </div>
              </section>)}
            </div>
          </article>)}
        </div>
        <p className="text-xs text-slate-500">수동 관찰과 증거 인용은 이 브라우저 화면 상태에만 보관됩니다. JSON 다운로드에 포함할 수 있으며 자동 저장은 하지 않습니다.</p>
      </section>}
    </section>
  );
}
