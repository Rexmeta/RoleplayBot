import { CultureOriginNotice } from "./CultureOriginNotice";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { CULTURE_DIMENSIONS, CULTURE_DISCLAIMER } from "@shared/cultureMap";
import { matchesCultureProfile } from "@shared/cultureComparison";
import type { ActorCulture, CultureProfile, CultureProfileInput, CultureSelection, CultureValues } from "@shared/cultureMap";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";

type VersionEntry = { version: number; content: CultureProfileInput; createdAt: string };
type Props = {
  value?: ActorCulture;
  onChange: (value: ActorCulture) => void;
  onValidityChange?: (incomplete: boolean) => void;
  actorKey: string;
};

export function ActorCultureEditor({ value, onChange, onValidityChange, actorKey }: Props) {
  const existingEnabled = value && "enabled" in value && value.enabled === true ? value : undefined;
  const [enabled, setEnabled] = useState(Boolean(existingEnabled));
  const [profileId, setProfileId] = useState(existingEnabled ? existingEnabled.profileId : "");
  const [version, setVersion] = useState(existingEnabled ? existingEnabled.profileVersion : 0);
  const [intensity, setIntensity] = useState(existingEnabled ? existingEnabled.intensity : 70);
  const [overrides, setOverrides] = useState<Partial<CultureValues>>(existingEnabled ? existingEnabled.overrides : {});
  const [filter, setFilter] = useState("");
  const [region, setRegion] = useState("all");
  const [confidence, setConfidence] = useState("all");
  const profilesQuery = useQuery<CultureProfile[]>({
    queryKey: ["/api/admin/culture-profiles"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/culture-profiles")).json(),
  });
  const versionsQuery = useQuery<VersionEntry[]>({
    queryKey: ["/api/admin/culture-profiles", profileId, "versions"],
    enabled: !!profileId,
    queryFn: async () => (await apiRequest("GET", `/api/admin/culture-profiles/${profileId}/versions`)).json(),
  });
  const profile = profilesQuery.data?.find((item) => item.id === profileId);
  const versions = useMemo(() => {
    const entries = versionsQuery.data ?? [];
    const hasCurrent = entries.some((entry) => entry.version === profile?.version);
    return hasCurrent || !profile ? entries : [...entries, { version: profile.version, content: profile, createdAt: profile.updatedAt }];
  }, [versionsQuery.data, profile]);
  const selectedVersion = version || profile?.version || 0;
  const selectedContent = versions.find((entry) => entry.version === selectedVersion)?.content
    ?? (profile?.version === selectedVersion ? profile : undefined);
  const snapshot = value && "snapshotVersion" in value ? value : undefined;
  const displayedSnapshotDimensions = snapshot
    ? { ...snapshot.dimensions, ...snapshot.overrides }
    : undefined;
  const regions = Array.from(new Set((profilesQuery.data ?? []).map(item => item.region).filter(Boolean))).sort();
  const filtered = (profilesQuery.data ?? []).filter(item =>
    matchesCultureProfile(item, { search: filter, region, confidence }));

  const setIncomplete = (incomplete: boolean) => onValidityChange?.(incomplete);
  const toggle = (checked: boolean) => {
    setEnabled(checked);
    if (!checked) {
      setIncomplete(false);
      onChange({ enabled: false });
    } else if (profileId && selectedVersion > 0) {
      setIncomplete(false);
      onChange({ enabled: true, profileId, profileVersion: selectedVersion, intensity, overrides });
    } else {
      setIncomplete(true);
    }
  };
  const update = (next: Partial<CultureSelection>) => {
    const nextProfileId = next.profileId ?? profileId;
    const nextVersion = next.profileVersion ?? selectedVersion;
    const nextIntensity = next.intensity ?? intensity;
    const nextOverrides = next.overrides ?? overrides;
    if (!nextProfileId || nextVersion < 1) {
      setIncomplete(true);
      return;
    }
    setIncomplete(false);
    onChange({ enabled: true, profileId: nextProfileId, profileVersion: nextVersion, intensity: nextIntensity, overrides: nextOverrides });
  };
  const chooseProfile = (id: string) => {
    const chosen = profilesQuery.data?.find((item) => item.id === id);
    if (!chosen) return;
    const changedProfile = id !== profileId;
    const nextOverrides = changedProfile ? {} : overrides;
    setProfileId(id);
    setVersion(chosen.version);
    setOverrides(nextOverrides);
    if (enabled) {
      setIncomplete(false);
      onChange({ enabled: true, profileId: id, profileVersion: chosen.version, intensity, overrides: nextOverrides });
    }
  };
  const chooseVersion = (rawVersion: string) => {
    const nextVersion = Number(rawVersion);
    setVersion(nextVersion);
    if (enabled) update({ profileVersion: nextVersion });
  };
  const setOverride = (key: keyof CultureValues, rawValue: string) => {
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric)) return;
    const next = { ...overrides, [key]: Math.max(0, Math.min(100, numeric)) };
    setOverrides(next);
    if (enabled) update({ overrides: next });
  };
  const clearOverride = (key: keyof CultureValues) => {
    const next = { ...overrides };
    delete next[key];
    setOverrides(next);
    if (enabled) update({ overrides: next });
  };
  const refreshSnapshotToLatest = () => {
    if (!profile) return;
    setVersion(profile.version);
    setIncomplete(false);
    onChange({ enabled: true, profileId: profile.id, profileVersion: profile.version, intensity, overrides });
  };

  return <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
    <div className="flex items-center justify-between gap-3">
      <div><Label htmlFor={`culture-enabled-${actorKey}`} className="font-medium">문화적 특성 추가</Label><p className="text-xs text-slate-500">Persona identity와 독립적으로 설정합니다.</p></div>
      <input id={`culture-enabled-${actorKey}`} type="checkbox" checked={enabled} onChange={(event) => toggle(event.target.checked)} aria-label="문화적 특성 추가" className="h-4 w-4 accent-teal-700" />
    </div>

    {snapshot && <section aria-label="저장된 문화 스냅샷" className="mt-3 rounded border border-teal-200 bg-white p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h4 className="font-medium text-slate-800">{snapshot.name}</h4><div className="flex items-center gap-2"><span className="text-xs text-slate-500">저장된 스냅샷 · v{snapshot.profileVersion}</span>{profile && profile.version !== snapshot.profileVersion && <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={refreshSnapshotToLatest}>최신 버전으로 갱신</Button>}</div></div>
      <p className="mt-1 text-sm text-slate-600">{snapshot.country}{snapshot.region ? ` · ${snapshot.region}` : ""}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">{CULTURE_DIMENSIONS.map((dimension) => <div key={dimension.key} className="flex justify-between gap-2 text-xs"><dt className="text-slate-500">{dimension.label}</dt><dd className="font-mono text-slate-800">{displayedSnapshotDimensions?.[dimension.key]}</dd></div>)}</dl>
      <p className="mt-2 text-xs text-slate-500">이 기록은 프로필이 삭제되었거나 최신 버전과 달라도 변경하지 않는 한 그대로 보존됩니다.</p>
    </section>}

    {enabled && <div className="mt-4 space-y-4">
      {profilesQuery.isLoading ? <div className="h-10 animate-pulse rounded bg-slate-200" aria-label="문화 프로필 로딩 중" />
        : profilesQuery.isError ? <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">문화 프로필을 불러오지 못했습니다.<Button type="button" variant="link" onClick={() => profilesQuery.refetch()}>다시 시도</Button></div>
        : <div className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor={`culture-filter-${actorKey}`}>국가·지역 검색</Label><input id={`culture-filter-${actorKey}`} value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="국가, 지역, 이름" className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm" />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-600" htmlFor={`culture-region-filter-${actorKey}`}>지역
                <select id={`culture-region-filter-${actorKey}`} value={region} onChange={event => setRegion(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm">
                  <option value="all">모든 지역</option>
                  {regions.map(value => <option key={value} value={value}>{value}</option>)}
                  <option value="__unspecified__">지역 미지정</option>
                </select>
              </label>
              <label className="text-xs text-slate-600" htmlFor={`culture-confidence-filter-${actorKey}`}>출처 신뢰도
                <select id={`culture-confidence-filter-${actorKey}`} value={confidence} onChange={event => setConfidence(event.target.value)} className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm">
                  <option value="all">모든 신뢰도</option><option value="low">낮음</option><option value="medium">중간</option><option value="high">높음</option><option value="unspecified">미지정</option>
                </select>
              </label>
            </div>
            <p className="mt-1 text-xs text-slate-500">신뢰도는 원본 자료의 자체 표기입니다. 복제·수정한 프로필의 검증을 의미하지 않습니다. 필터는 현재 선택이나 저장된 스냅샷을 변경하지 않습니다.</p>
            {(filter || region !== "all" || confidence !== "all") && <Button type="button" variant="link" size="sm" onClick={() => { setFilter(""); setRegion("all"); setConfidence("all"); }}>선택 필터 초기화</Button>}
            <Label htmlFor={`culture-profile-${actorKey}`} className="mt-2 block">프로필</Label>
            <Select value={profileId} onValueChange={chooseProfile}>
              <SelectTrigger id={`culture-profile-${actorKey}`} className="bg-white"><SelectValue placeholder="프로필 선택" /></SelectTrigger>
              <SelectContent>{filtered.map((item) => <SelectItem key={item.id} value={item.id}>{item.country}{item.region ? ` · ${item.region}` : ""} — {item.name}</SelectItem>)}</SelectContent>
            </Select>
            {!filtered.length && <p className="mt-1 text-xs text-slate-500">{profilesQuery.data?.length ? "검색 결과가 없습니다." : "사용 가능한 문화 프로필이 없습니다."}</p>}
          </div>
          <div><Label htmlFor={`culture-version-${actorKey}`}>적용 버전</Label>
            <Select value={String(selectedVersion || "")} onValueChange={chooseVersion} disabled={!profileId || versionsQuery.isLoading}>
              <SelectTrigger id={`culture-version-${actorKey}`} className="bg-white"><SelectValue placeholder={versionsQuery.isLoading ? "버전 조회 중…" : "버전 선택"} /></SelectTrigger>
              <SelectContent>{versions.map((entry) => <SelectItem key={entry.version} value={String(entry.version)}>v{entry.version}{entry.version === profile?.version ? " · 최신" : ""}</SelectItem>)}</SelectContent>
            </Select>
            {versionsQuery.isLoading && <p role="status" className="mt-1 text-xs text-slate-500">버전 기록 조회 중…</p>}
            {versionsQuery.isError && <p role="alert" className="mt-1 text-xs text-red-700">버전 기록을 불러오지 못했습니다. <Button type="button" variant="link" className="h-auto p-0" onClick={() => versionsQuery.refetch()}>다시 시도</Button></p>}
            {profileId && !profile && !versionsQuery.isLoading && !versionsQuery.isError && <p role="status" className="mt-1 text-xs text-amber-800">선택된 프로필을 찾을 수 없습니다. 저장된 스냅샷은 보존됩니다. 새 프로필을 선택하거나 Culture Map에서 복제하세요.</p>}
          </div>
        </div>}

      {enabled && !profileId && <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">프로필을 선택해야 시나리오를 저장할 수 있습니다.</p>}
      {enabled && profileId && !selectedContent && !versionsQuery.isLoading && <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">선택한 버전의 내용을 불러올 수 없습니다. 기록을 다시 시도하거나 다른 버전을 선택하세요.</p>}
      <CultureOriginNotice origin={selectedContent?.origin ?? snapshot?.origin} />
      {selectedContent && <div className="rounded border border-slate-200 bg-white p-3">
        <div className="flex items-baseline justify-between gap-2"><h4 className="text-sm font-semibold">{selectedContent.name}</h4><span className="text-xs text-slate-500">v{selectedVersion} 기준 차원</span></div>
        <p className="text-xs text-slate-500">{selectedContent.country}{selectedContent.region ? ` · ${selectedContent.region}` : ""}</p>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">{CULTURE_DIMENSIONS.map((dimension) => <div key={dimension.key} className="flex justify-between gap-2 text-xs"><dt className="text-slate-500">{dimension.label}</dt><dd className="font-mono">{selectedContent.dimensions[dimension.key]}</dd></div>)}</dl>
      </div>}
      <div>
        <div className="mb-1 flex items-center justify-between"><Label htmlFor={`culture-intensity-${actorKey}`}>반영 강도</Label><output className="font-mono text-xs">{intensity}</output></div>
        <Slider id={`culture-intensity-${actorKey}`} min={0} max={100} step={1} value={[intensity]} onValueChange={(values) => { const next = values[0] ?? 70; setIntensity(next); if (enabled) update({ intensity: next }); }} disabled={!profileId || !selectedContent} aria-label="문화 반영 강도" />
        <p className="mt-1 text-xs text-slate-500">행동 지침의 강조 수준이며 확률이나 평가 점수가 아닙니다.</p>
      </div>
      {selectedContent && <details className="rounded border border-slate-200 bg-white p-3">
        <summary className="cursor-pointer text-sm font-medium">차원별 override (선택)</summary>
        <p className="my-2 text-xs text-slate-500">선택한 버전의 값보다 우선 적용됩니다.</p>
        <div className="grid gap-3 sm:grid-cols-2">{CULTURE_DIMENSIONS.map((dimension) => {
          const valueForDimension = overrides[dimension.key] ?? selectedContent.dimensions[dimension.key];
          return <div key={dimension.key}>
            <div className="mb-1 flex items-center justify-between gap-2"><Label htmlFor={`override-${actorKey}-${dimension.key}`}>{dimension.label}</Label><output className="font-mono text-xs">{overrides[dimension.key] === undefined ? "프로필" : overrides[dimension.key]}</output></div>
            <Slider id={`override-slider-${actorKey}-${dimension.key}`} min={0} max={100} step={1} value={[valueForDimension]} onValueChange={(values) => setOverride(dimension.key, String(values[0] ?? valueForDimension))} aria-label={`${dimension.label} override 슬라이더`} />
            <div className="flex justify-between text-[11px] text-slate-500"><span>{dimension.low}</span><span>{dimension.high}</span></div>
            <div className="mt-2 flex items-center gap-2">
              <input id={`override-${actorKey}-${dimension.key}`} type="number" min={0} max={100} step={1} value={valueForDimension} aria-label={`${dimension.label} override 값`} onChange={(event) => setOverride(dimension.key, event.target.value)} className="h-8 w-20 rounded border border-slate-300 px-2 text-sm" />
              <span className="text-xs text-slate-500">0–100</span>
              {overrides[dimension.key] !== undefined && <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={() => clearOverride(dimension.key)}>프로필 값 사용</Button>}
            </div>
          </div>;
        })}</div>
      </details>}
      <p className="text-xs leading-relaxed text-slate-600">{CULTURE_DISCLAIMER}</p>
    </div>}
  </div>;
}
