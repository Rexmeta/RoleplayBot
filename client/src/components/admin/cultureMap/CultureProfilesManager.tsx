import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CULTURE_DIMENSIONS, isSystemCultureProfile, newCultureValues } from "@shared/cultureMap";
import type { CultureProfile, CultureProfileInput, CultureSource, CultureValues } from "@shared/cultureMap";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { CultureOriginNotice } from "./CultureOriginNotice";
import { CultureProfileComparison } from "./CultureProfileComparison";
import { CultureProfileFilters } from "./CultureProfileFilters";
import { matchesCultureProfile } from "@shared/cultureComparison";
import { CultureProfileCard } from "./CultureProfileCard";

type VersionEntry = { version: number; content: CultureProfileInput; createdAt: string };
const emptyInput = (): CultureProfileInput => ({
  name: "", country: "", region: "", description: "", dimensions: newCultureValues(), sources: [], visibility: "private",
});
const listKey = ["/api/admin/culture-profiles"];
async function readError(error: unknown) {
  return error instanceof Error ? error.message : "요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

export function CultureProfilesManager() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [search, setSearch] = useState("");
  const [regionFilter, setRegionFilter] = useState("all");
  const [confidenceFilter, setConfidenceFilter] = useState("all");
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<CultureProfile | null>(null);
  const [draft, setDraft] = useState<CultureProfileInput>(emptyInput);
  const [errorText, setErrorText] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<CultureProfile | null>(null);
  const [historyTarget, setHistoryTarget] = useState<CultureProfile | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const revealEditor = () => {
    requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      if (nameInputRef.current && !nameInputRef.current.disabled) nameInputRef.current.focus({ preventScroll: true });
      else editorRef.current?.focus({ preventScroll: true });
    });
  };

  const profilesQuery = useQuery<CultureProfile[]>({
    queryKey: listKey,
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/admin/culture-profiles");
      return response.json();
    },
  });
  const historyQuery = useQuery<VersionEntry[]>({
    queryKey: [...listKey, historyTarget?.id, "versions"],
    enabled: !!historyTarget,
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/admin/culture-profiles/${historyTarget!.id}/versions`);
      return response.json();
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const response = editing
        ? await apiRequest("PUT", `/api/admin/culture-profiles/${editing.id}`, { ...draft, expectedVersion: editing.version })
        : await apiRequest("POST", "/api/admin/culture-profiles", draft);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listKey });
      setEditing(null);
      setDraft(emptyInput());
      setErrorText("");
    },
    onError: async (error) => setErrorText(await readError(error)),
  });
  const duplicateMutation = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/admin/culture-profiles/${id}/duplicate`)).json(),
    onSuccess: (clone: CultureProfile) => {
      queryClient.invalidateQueries({ queryKey: listKey });
      beginEdit(clone);
    },
    onError: async (error) => setErrorText(await readError(error)),
  });
  const deleteMutation = useMutation({
    mutationFn: async (profile: CultureProfile) => apiRequest("DELETE", `/api/admin/culture-profiles/${profile.id}`, { expectedVersion: profile.version }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listKey });
      setDeleteTarget(null);
      if (deleteTarget) setComparisonIds((current) => current.filter((id) => id !== deleteTarget.id));
      if (editing?.id === deleteTarget?.id) setEditing(null);
    },
    onError: async (error) => setErrorText(await readError(error)),
  });

  const profiles = profilesQuery.data ?? [];
  const readOnly = !!editing && (isSystemCultureProfile(editing) || (!isAdmin && editing.ownerId !== user?.id));
  const filtered = useMemo(
    () => profiles.filter((profile) => matchesCultureProfile(profile, {
      search,
      region: regionFilter,
      confidence: confidenceFilter,
    })),
    [profiles, search, regionFilter, confidenceFilter],
  );
  const regions = useMemo(() => {
    const values = profiles.map((profile) => profile.region.trim() || "__unspecified__");
    return Array.from(new Set(values)).sort((a, b) => {
      if (a === "__unspecified__") return 1;
      if (b === "__unspecified__") return -1;
      return a.localeCompare(b, "ko");
    });
  }, [profiles]);
  const comparedProfiles = useMemo(
    () => comparisonIds.map((id) => profiles.find((profile) => profile.id === id)).filter((profile): profile is CultureProfile => !!profile),
    [comparisonIds, profiles],
  );
  const toggleComparison = (profile: CultureProfile) => {
    setComparisonIds((current) => current.includes(profile.id)
      ? current.filter((id) => id !== profile.id)
      : current.length < 5 ? [...current, profile.id] : current);
  };
  const removeComparison = (id: string) => setComparisonIds((current) => current.filter((item) => item !== id));
  const resetFilters = () => {
    setSearch("");
    setRegionFilter("all");
    setConfidenceFilter("all");
  };
  const setField = <K extends keyof CultureProfileInput>(key: K, value: CultureProfileInput[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const beginCreate = () => {
    setEditing(null);
    setDraft(emptyInput());
    setErrorText("");
    revealEditor();
  };
  const beginEdit = (profile: CultureProfile) => {
    setEditing(profile);
    setDraft({
      name: profile.name,
      country: profile.country,
      region: profile.region,
      description: profile.description,
      dimensions: { ...profile.dimensions },
      sources: profile.sources.map(({ title, url, locator, note }) => ({ title, url, locator, note })),
      visibility: profile.visibility,
      ...(profile.origin ? { origin: profile.origin } : {}),
    });
    setErrorText("");
    revealEditor();
  };
  const save = () => {
    const missing = !draft.name.trim() || !draft.country.trim();
    if (missing) { setErrorText("프로필 이름과 국가/지역을 입력해 주세요."); return; }
    if (draft.sources.some((source) => !source.title.trim() || !/^https?:\/\//i.test(source.url))) {
      setErrorText("출처 제목과 유효한 HTTP(S) URL을 확인해 주세요."); return;
    }
    saveMutation.mutate();
  };
  const updateDimension = (key: keyof CultureValues, value: number) =>
    setDraft((current) => ({ ...current, dimensions: { ...current.dimensions, [key]: value } }));
  const updateSource = (index: number, patch: Partial<CultureSource>) =>
    setDraft((current) => ({ ...current, sources: current.sources.map((source, i) => i === index ? { ...source, ...patch } : source) }));

  return (
    <section className="space-y-5" aria-label="Culture Map 프로필 관리">
      <header className="flex justify-end">
        <Button type="button" onClick={beginCreate} className="min-h-11 gap-2 px-5 font-semibold"><Plus className="h-4 w-4" />새 프로필 만들기</Button>
      </header>
      {errorText && <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{errorText}</div>}
      {comparedProfiles.length === 0 ? (
        <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">목록에서 프로필을 선택하면 비교를 시작합니다. (최대 5개)</p>
      ) : <CultureProfileComparison
        profiles={comparedProfiles}
        onRemove={removeComparison}
        onClear={() => setComparisonIds([])}
        onInspect={beginEdit}
        onDuplicate={(profile) => duplicateMutation.mutate(profile.id)}
        duplicatePending={duplicateMutation.isPending}
      />}
      <div className="grid gap-5 lg:grid-cols-2">
        <aside className="order-2 min-w-0 space-y-3 lg:order-1">
          <CultureProfileFilters
            search={search}
            onSearchChange={setSearch}
            region={regionFilter}
            onRegionChange={setRegionFilter}
            regions={regions}
            confidence={confidenceFilter}
            onConfidenceChange={setConfidenceFilter}
          />
          {profilesQuery.isLoading ? <div className="space-y-2" aria-label="프로필 로딩 중">{[0, 1, 2].map((item) => <div key={item} className="h-20 animate-pulse rounded-md bg-slate-100" />)}</div>
            : profilesQuery.isError ? <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">프로필을 불러오지 못했습니다.<Button variant="link" onClick={() => profilesQuery.refetch()}>다시 시도</Button></div>
            : filtered.length === 0 ? <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center"><p className="font-medium text-slate-700">{profiles.length ? "조건에 맞는 프로필이 없습니다" : "아직 프로필이 없습니다"}</p><p className="mt-1 text-sm text-slate-500">{profiles.length ? "검색어, 지역 또는 신뢰도 조건을 바꿔 보세요. 비교 선택은 유지됩니다." : "직접 정의한 문화 행동 컨텍스트를 추가하세요."}</p>{profiles.length > 0 && <Button type="button" variant="link" className="mt-2" onClick={resetFilters}>필터 모두 초기화</Button>}</div>
             : <><p className="text-xs text-slate-500">{filtered.length}개 표시 · {comparisonIds.length}개 비교 선택</p><ul aria-label="문화 프로필 목록" className="grid max-h-[min(68dvh,46rem)] grid-cols-1 gap-2 overflow-y-auto overscroll-contain pr-1 min-[560px]:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">{filtered.map((profile) => (
              <CultureProfileCard
                key={profile.id}
                profile={profile}
                selected={comparisonIds.includes(profile.id)}
                comparisonIndex={comparisonIds.indexOf(profile.id) + 1}
                comparisonLimitReached={comparisonIds.length >= 5}
                isOwner={profile.ownerId === user?.id}
                isAdmin={isAdmin}
                isEditing={editing?.id === profile.id}
                duplicatePending={duplicateMutation.isPending}
                onToggleComparison={() => toggleComparison(profile)}
                onInspect={() => beginEdit(profile)}
                onDuplicate={() => duplicateMutation.mutate(profile.id)}
                onHistory={() => setHistoryTarget(profile)}
                onDelete={() => setDeleteTarget(profile)}
              />
            ))}</ul></>}
        </aside>
        <div ref={editorRef} tabIndex={-1} aria-label="문화 프로필 편집기" className="order-1 min-w-0 scroll-mt-4 rounded-md border border-slate-200 bg-white p-4 sm:p-6 lg:order-2">
          <div className="mb-5 flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
            <div><h3 className="text-lg font-semibold text-slate-900">{editing ? "프로필 편집" : "새 프로필"}</h3><p className="text-sm text-slate-500">8개 차원은 프로필의 행동 경향을 정의합니다.</p></div>
            {isAdmin && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.visibility === "shared"} disabled={readOnly} onChange={(event) => setField("visibility", event.target.checked ? "shared" : "private")} />공유 프로필</label>}
          </div>
          <div className="mb-4"><CultureOriginNotice origin={draft.origin} /></div>
          {editing && isSystemCultureProfile(editing) && <div className="mb-4 flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-slate-50 p-3 text-sm"><span>시스템 기본 프로필은 읽기 전용입니다. 수정하려면 복제하세요.</span><Button type="button" variant="outline" size="sm" disabled={duplicateMutation.isPending} onClick={() => duplicateMutation.mutate(editing.id)}>복제 후 편집</Button></div>}
          <div className="grid gap-4 sm:grid-cols-2">
             <div><Label htmlFor="culture-name">프로필 이름 *</Label><Input ref={nameInputRef} id="culture-name" value={draft.name} maxLength={150} disabled={readOnly} onChange={(event) => setField("name", event.target.value)} /></div>
            <div><Label htmlFor="culture-country">국가/문화권 *</Label><Input id="culture-country" value={draft.country} maxLength={100} disabled={readOnly} onChange={(event) => setField("country", event.target.value)} /></div>
            <div><Label htmlFor="culture-region">지역/맥락</Label><Input id="culture-region" value={draft.region} maxLength={100} disabled={readOnly} onChange={(event) => setField("region", event.target.value)} /></div>
            <div className="sm:col-span-2"><Label htmlFor="culture-description">설명</Label><Textarea id="culture-description" value={draft.description} maxLength={2000} rows={3} disabled={readOnly} onChange={(event) => setField("description", event.target.value)} /></div>
          </div>
          <div className="mt-6 space-y-4">
            <h4 className="font-semibold text-slate-800">행동 차원 <span className="text-xs font-normal text-slate-500">(0–100)</span></h4>
            <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">{CULTURE_DIMENSIONS.map((dimension) => (
              <div key={dimension.key}>
                <div className="mb-1 flex justify-between text-sm"><Label htmlFor={`dimension-${dimension.key}`}>{dimension.label}</Label><output htmlFor={`dimension-${dimension.key}`} className="font-mono text-xs text-slate-600">{draft.dimensions[dimension.key]}</output></div>
                <input id={`dimension-${dimension.key}`} aria-label={`${dimension.label} 점수`} type="range" min="0" max="100" step="1" value={draft.dimensions[dimension.key]} disabled={readOnly} onChange={(event) => updateDimension(dimension.key, Number(event.target.value))} className="w-full accent-teal-700" />
                <div className="flex justify-between text-[11px] text-slate-500"><span>{dimension.low}</span><span>{dimension.high}</span></div>
              </div>
            ))}</div>
          </div>
          <div className="mt-7 space-y-3">
            <div className="flex items-center justify-between"><div><h4 className="font-semibold text-slate-800">근거 자료</h4><p className="text-xs text-slate-500">직접 조사한 출처를 기록하세요. 최대 20개.</p></div><Button type="button" variant="outline" size="sm" disabled={readOnly || draft.sources.length >= 20} onClick={() => setField("sources", [...draft.sources, { title: "", url: "", locator: "", note: "" }])}><Plus className="mr-1 h-4 w-4" />출처 추가</Button></div>
            {draft.sources.map((source, index) => <div key={index} className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
              <Input aria-label={`출처 ${index + 1} 제목`} value={source.title} placeholder="자료 제목" disabled={readOnly} onChange={(event) => updateSource(index, { title: event.target.value })} />
              <Input aria-label={`출처 ${index + 1} URL`} type="url" value={source.url} placeholder="https://" disabled={readOnly} onChange={(event) => updateSource(index, { url: event.target.value })} />
              <Input aria-label={`출처 ${index + 1} 위치`} value={source.locator} placeholder="페이지·절·위치" disabled={readOnly} onChange={(event) => updateSource(index, { locator: event.target.value })} />
              <div className="flex gap-2"><Input aria-label={`출처 ${index + 1} 메모`} value={source.note} placeholder="메모" disabled={readOnly} onChange={(event) => updateSource(index, { note: event.target.value })} /><Button type="button" variant="ghost" aria-label={`출처 ${index + 1} 삭제`} disabled={readOnly} onClick={() => setField("sources", draft.sources.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button></div>
            </div>)}
          </div>
          <div className="mt-6 flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
            {readOnly && <p className="self-center text-sm text-slate-600">{editing && isSystemCultureProfile(editing) ? "시스템 기본 프로필은 복제 후 수정할 수 있습니다." : "공유 프로필은 관리자만 수정할 수 있습니다."}</p>}
            <Button type="button" onClick={save} disabled={readOnly || saveMutation.isPending}>{saveMutation.isPending ? "저장 중…" : editing ? "변경 저장" : "프로필 생성"}</Button>
          </div>
          {editing && <p className="mt-2 text-right text-xs text-slate-500">수정 시 v{editing.version}을 기준으로 저장합니다.</p>}
        </div>
      </div>
      {historyTarget && <div role="dialog" aria-modal="true" aria-labelledby="culture-history-title" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setHistoryTarget(null); }}>
        <div className="max-h-[80dvh] w-full max-w-xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
          <div className="flex items-center justify-between"><h3 id="culture-history-title" className="text-lg font-semibold">{historyTarget.name} · 버전 기록</h3><Button variant="ghost" onClick={() => setHistoryTarget(null)}>닫기</Button></div>
          {historyQuery.isLoading ? <p className="py-6 text-sm text-slate-500">기록을 불러오는 중…</p>
            : historyQuery.isError ? <div role="alert" className="py-5 text-sm text-red-700">버전 기록을 불러오지 못했습니다.<Button variant="link" onClick={() => historyQuery.refetch()}>다시 시도</Button></div>
            : <ol className="mt-4 space-y-3">{(historyQuery.data ?? []).map((entry) => <li key={entry.version} className="rounded border border-slate-200 p-3"><div className="flex justify-between font-medium"><span>버전 {entry.version} · {entry.content.name}</span><time className="text-xs font-normal text-slate-500">{new Date(entry.createdAt).toLocaleString()}</time></div><p className="mt-1 text-sm text-slate-600">{entry.content.country}{entry.content.region ? ` · ${entry.content.region}` : ""} — {entry.content.description}</p></li>)}</ol>}
        </div>
      </div>}
      {deleteTarget && <div role="alertdialog" aria-modal="true" aria-labelledby="culture-delete-title" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
        <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"><h3 id="culture-delete-title" className="text-lg font-semibold">프로필을 삭제할까요?</h3><p className="mt-2 text-sm text-slate-600">“{deleteTarget.name}” 프로필을 삭제합니다. 기존 시나리오의 저장된 문화 스냅샷은 별도로 보존됩니다.</p>{errorText && <p role="alert" className="mt-2 text-sm text-red-700">{errorText}</p>}<div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => { setDeleteTarget(null); setErrorText(""); }}>취소</Button><Button variant="destructive" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(deleteTarget)}>{deleteMutation.isPending ? "삭제 중…" : "삭제"}</Button></div></div>
      </div>}
    </section>
  );
}
