import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { isSystemCultureProfile } from "@shared/cultureMap";
import type { CultureProfile, CultureProfileInput } from "@shared/cultureMap";
import { AlertTriangle, Plus } from "lucide-react";
import { CultureProfileForm, emptyCultureProfile as emptyInput, validateCultureProfile } from "./CultureProfileForm";
import { CultureProfileComparison } from "./CultureProfileComparison";
import { CultureProfileFilters } from "./CultureProfileFilters";
import { matchesCultureProfile } from "@shared/cultureComparison";
import { CultureProfileCard } from "./CultureProfileCard";
import { CultureProfileComparisonTray } from "./CultureProfileComparisonTray";

type VersionEntry = { version: number; content: CultureProfileInput; createdAt: string };
const listKey = ["/api/admin/culture-profiles"];
async function readError(error: unknown) {
  return error instanceof Error ? error.message : "요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

export function CultureProfilesManager({ showCreateAction = true }: { showCreateAction?: boolean } = {}) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [search, setSearch] = useState("");
  const [regionFilter, setRegionFilter] = useState("all");
  const [confidenceFilter, setConfidenceFilter] = useState("all");
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<"list" | "comparison">("list");
  const [trayHeight, setTrayHeight] = useState(240);
  const [editing, setEditing] = useState<CultureProfile | null>(null);
  const [draft, setDraft] = useState<CultureProfileInput>(emptyInput);
  const [errorText, setErrorText] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<CultureProfile | null>(null);
  const [historyTarget, setHistoryTarget] = useState<CultureProfile | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const dialogContentRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const comparisonHeadingRef = useRef<HTMLHeadingElement>(null);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);
  const listScrollYRef = useRef(0);
  const focusModeRef = useRef<"list" | "comparison" | null>(null);

  const requestDialogClose = (open: boolean) => {
    if (!open && saveMutation.isPending) return;
    setDialogOpen(open);
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
      setDialogOpen(false);
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
  useEffect(() => {
    if (!profilesQuery.isSuccess) return;
    const availableIds = new Set(profilesQuery.data.map((profile) => profile.id));
    setComparisonIds((current) => {
      const next = current.filter((id) => availableIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [profilesQuery.data, profilesQuery.isSuccess]);
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
  useEffect(() => {
    if (viewMode === "comparison" && comparedProfiles.length < 2) {
      focusModeRef.current = "list";
      setViewMode("list");
    }
  }, [viewMode, comparedProfiles.length]);
  useEffect(() => {
    if (!focusModeRef.current) return;
    const targetMode = focusModeRef.current;
    focusModeRef.current = null;
    const frame = requestAnimationFrame(() => {
      if (targetMode === "comparison") {
        comparisonHeadingRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
        comparisonHeadingRef.current?.focus({ preventScroll: true });
      } else {
        window.scrollTo({ top: listScrollYRef.current, behavior: "instant" as ScrollBehavior });
        listHeadingRef.current?.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [viewMode]);
  const toggleComparison = (profile: CultureProfile) => {
    setComparisonIds((current) => current.includes(profile.id)
      ? current.filter((id) => id !== profile.id)
      : current.length < 5 ? [...current, profile.id] : current);
  };
  const removeComparison = (id: string) => setComparisonIds((current) => current.filter((item) => item !== id));
  const enterComparison = () => {
    if (comparedProfiles.length < 2) return;
    listScrollYRef.current = window.scrollY;
    focusModeRef.current = "comparison";
    setViewMode("comparison");
  };
  const returnToList = () => {
    focusModeRef.current = "list";
    setViewMode("list");
  };
  const resetFilters = () => {
    setSearch("");
    setRegionFilter("all");
    setConfidenceFilter("all");
  };
  const beginCreate = () => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    setEditing(null);
    setDraft(emptyInput());
    setErrorText("");
    setDialogOpen(true);
  };
  const beginEdit = (profile: CultureProfile) => {
    if (!dialogOpen) returnFocusRef.current = document.activeElement as HTMLElement | null;
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
    setDialogOpen(true);
  };
  const save = () => {
    const error = validateCultureProfile(draft);
    if (error) { setErrorText(error); return; }
    saveMutation.mutate();
  };
  const createAction = (
    <Button
      ref={createButtonRef}
      type="button"
      aria-haspopup="dialog"
      onClick={beginCreate}
      className="min-h-11 gap-2 px-5 font-semibold"
    >
      <Plus className="h-4 w-4" aria-hidden="true" />새 프로필 만들기
    </Button>
  );

  return (
    <section
      className="space-y-5"
      aria-label="Culture Map 프로필 관리"
      style={{ paddingBottom: viewMode === "list" && comparisonIds.length > 0 ? trayHeight + 20 : undefined }}
    >
      {viewMode === "list" && showCreateAction && <header className="flex justify-end">{createAction}</header>}
      {errorText && !dialogOpen && !deleteTarget && <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{errorText}</div>}
      {viewMode === "comparison" ? (
        <div className="space-y-4" aria-label="선택한 문화 프로필 비교">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 ref={comparisonHeadingRef} tabIndex={-1} className="text-xl font-semibold text-teal-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">
              선택한 프로필 비교
            </h2>
            <Button type="button" variant="outline" className="min-h-11 border-teal-300 text-teal-900" onClick={returnToList}>
              목록으로 돌아가기
            </Button>
          </div>
          {comparedProfiles.length >= 2 && <CultureProfileComparison
            profiles={comparedProfiles}
            onRemove={removeComparison}
            onClear={() => setComparisonIds([])}
            onInspect={beginEdit}
            onDuplicate={(profile) => duplicateMutation.mutate(profile.id)}
            duplicatePending={duplicateMutation.isPending}
          />}
        </div>
      ) : (
      <div className="min-w-0 space-y-3">
          <h2 ref={listHeadingRef} tabIndex={-1} className="sr-only focus-visible:not-sr-only focus-visible:rounded focus-visible:bg-white focus-visible:px-2 focus-visible:py-1 focus-visible:text-teal-950">문화 프로필 목록</h2>
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
               : <><p className="text-xs text-slate-500">{filtered.length}개 표시 · {comparisonIds.length}개 비교 선택</p><ul aria-label="문화 프로필 목록" className="grid grid-cols-1 gap-2 pr-1 min-[560px]:grid-cols-2">{filtered.map((profile) => (
              <CultureProfileCard
                key={profile.id}
                profile={profile}
                selected={comparisonIds.includes(profile.id)}
                comparisonIndex={comparisonIds.indexOf(profile.id) + 1}
                comparisonLimitReached={comparisonIds.length >= 5}
                isOwner={profile.ownerId === user?.id}
                isAdmin={isAdmin}
                isEditing={dialogOpen && editing?.id === profile.id}
                duplicatePending={duplicateMutation.isPending}
                onToggleComparison={() => toggleComparison(profile)}
                onInspect={() => beginEdit(profile)}
                onDuplicate={() => duplicateMutation.mutate(profile.id)}
                onHistory={() => setHistoryTarget(profile)}
                onDelete={() => setDeleteTarget(profile)}
              />
            ))}</ul></>}
      </div>
      )}
      {viewMode === "list" && comparisonIds.length > 0 && (
        <CultureProfileComparisonTray
          profiles={comparedProfiles}
          onRemove={removeComparison}
          onClear={() => setComparisonIds([])}
          onCompare={enterComparison}
          onHeightChange={setTrayHeight}
        />
      )}
      <Dialog open={dialogOpen} onOpenChange={requestDialogClose}>
        <DialogContent
          ref={dialogContentRef}
          tabIndex={-1}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = returnFocusRef.current;
            if (target?.isConnected && target !== document.body) target.focus({ preventScroll: true });
            else createButtonRef.current?.focus({ preventScroll: true });
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            requestAnimationFrame(() => {
              if (!readOnly) nameInputRef.current?.focus({ preventScroll: true });
              else dialogContentRef.current?.focus({ preventScroll: true });
            });
          }}
          className="w-[calc(100%-1rem)] max-h-[min(92dvh,58rem)] max-w-4xl gap-0 overflow-hidden border-teal-200 bg-[#fbfdfb] p-0 sm:w-full"
          onEscapeKeyDown={(event) => { if (saveMutation.isPending) event.preventDefault(); }}
          onInteractOutside={(event) => { if (saveMutation.isPending) event.preventDefault(); }}
        >
          <div className="max-h-[min(92dvh,58rem)] overflow-y-auto overscroll-contain p-4 sm:p-7">
            <CultureProfileForm
              inDialog
              draft={draft}
              onChange={setDraft}
              editing={editing}
              readOnly={readOnly}
              isAdmin={isAdmin}
              saving={saveMutation.isPending}
              errorText={errorText}
              nameInputRef={nameInputRef}
              duplicatePending={duplicateMutation.isPending}
              onDuplicate={() => { if (editing) duplicateMutation.mutate(editing.id); }}
              onSave={save}
              onCancel={() => requestDialogClose(false)}
            />
          </div>
        </DialogContent>
      </Dialog>
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
