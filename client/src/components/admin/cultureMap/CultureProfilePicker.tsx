import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, RotateCcw } from "lucide-react";
import type { CultureProfile } from "@shared/cultureMap";
import { matchesCultureProfile } from "@shared/cultureComparison";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CultureProfileTypeBadge } from "./CultureProfileTypeBadge";

type Props = {
  profiles: CultureProfile[];
  selectedId: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
  id: string;
};

type ProfileSourceType = "all" | "country" | "company" | "custom";

function profileSourceType(profile: CultureProfile): Exclude<ProfileSourceType, "all"> {
  if (profile.assessment?.kind === "organization_editorial_estimate") return "company";
  if (profile.origin) return "country";
  return "custom";
}

function profileSecondary(profile: CultureProfile) {
  const details = [profile.region, profile.country !== profile.name ? profile.country : undefined].filter(Boolean);
  return details.join(" · ");
}

export function CultureProfilePicker({ profiles, selectedId, onSelect, disabled, id }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [sourceType, setSourceType] = useState<ProfileSourceType>("all");
  const [region, setRegion] = useState("all");
  const [confidence, setConfidence] = useState("all");
  const regions = useMemo(
    () => Array.from(new Set(profiles.map((profile) => profile.region).filter(Boolean))).sort(),
    [profiles],
  );
  const filtered = useMemo(
    () => profiles.filter((profile) => (
      (sourceType === "all" || profileSourceType(profile) === sourceType)
      && matchesCultureProfile(profile, { search, region, confidence })
    )),
    [profiles, sourceType, search, region, confidence],
  );
  const selected = profiles.find((profile) => profile.id === selectedId);
  const hasFilters = Boolean(search.trim()) || sourceType !== "all" || region !== "all" || confidence !== "all";

  const resetFilters = () => {
    setSearch("");
    setSourceType("all");
    setRegion("all");
    setConfidence("all");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="문화 프로필 선택"
          disabled={disabled}
          className="mt-1 h-auto min-h-10 w-full justify-between gap-3 bg-white px-3 py-2 text-left font-normal"
        >
          <span className="min-w-0">
            {selected ? (
              <>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium text-slate-800">{selected.name}</span>
                  <CultureProfileTypeBadge profile={selected} />
                </span>
                {profileSecondary(selected) && <span className="block truncate text-xs text-slate-500">{profileSecondary(selected)}</span>}
              </>
            ) : (
              <span className="text-sm text-slate-500">프로필 선택</span>
            )}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        collisionPadding={12}
        className="max-h-[var(--radix-popover-content-available-height)] w-[var(--radix-popover-trigger-width)] min-w-[min(20rem,calc(100vw-1.5rem))] max-w-[calc(100vw-1.5rem)] overflow-hidden p-0"
      >
        <Command shouldFilter={false} className="max-h-[var(--radix-popover-content-available-height)]">
          <CommandInput
            autoFocus
            value={search}
            onValueChange={setSearch}
            placeholder="이름, 국가, 지역 검색"
            aria-label="프로필 검색"
          />
          <div className="grid grid-cols-2 gap-2 border-b border-slate-200 bg-slate-50 p-3">
            <label className="col-span-2 min-w-0 text-[11px] font-medium text-slate-600">
              프로필 유형
              <select
                value={sourceType}
                onChange={(event) => setSourceType(event.target.value as ProfileSourceType)}
                onKeyDown={(event) => { if (event.key !== "Escape") event.stopPropagation(); }}
                className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
                aria-label="프로필 유형 필터"
              >
                <option value="all">모든 유형</option>
                <option value="country">국가 기준</option>
                <option value="company">기업 추정</option>
                <option value="custom">사용자 정의</option>
              </select>
            </label>
            <label className="min-w-0 text-[11px] font-medium text-slate-600">
              지역
              <select
                value={region}
                onChange={(event) => setRegion(event.target.value)}
                onKeyDown={(event) => { if (event.key !== "Escape") event.stopPropagation(); }}
                className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
                aria-label="지역 필터"
              >
                <option value="all">모든 지역</option>
                {regions.map((value) => <option key={value} value={value}>{value}</option>)}
                <option value="__unspecified__">지역 미지정</option>
              </select>
            </label>
            <label className="min-w-0 text-[11px] font-medium text-slate-600">
              출처 신뢰도
              <select
                value={confidence}
                onChange={(event) => setConfidence(event.target.value)}
                onKeyDown={(event) => { if (event.key !== "Escape") event.stopPropagation(); }}
                className="mt-1 h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
                aria-label="출처 신뢰도 필터"
              >
                <option value="all">모든 신뢰도</option>
                <option value="low">낮음</option>
                <option value="medium">중간</option>
                <option value="high">높음</option>
                <option value="unspecified">미지정</option>
              </select>
            </label>
            <p className="col-span-2 text-[11px] leading-relaxed text-slate-500">
              신뢰도는 원본 자료의 자체 표기이며, 복제·수정 프로필의 검증을 뜻하지 않습니다.
            </p>
            {hasFilters && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                className="col-span-2 h-7 justify-start px-1 text-xs text-teal-800"
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                필터 초기화
              </Button>
            )}
          </div>
          <CommandList className="min-h-0 max-h-[min(15rem,calc(100dvh-16rem))] p-1">
            <CommandEmpty className="px-4 py-6 text-xs text-slate-500">
              {profiles.length ? "조건에 맞는 프로필이 없습니다." : "사용 가능한 문화 프로필이 없습니다."}
            </CommandEmpty>
            {filtered.map((profile) => (
              <CommandItem
                key={profile.id}
                value={profile.id}
                onSelect={() => {
                  onSelect(profile.id);
                  setOpen(false);
                }}
                className="min-h-12 cursor-pointer items-center justify-between gap-3 rounded-sm px-3 py-2 aria-selected:bg-teal-50 aria-selected:text-slate-900"
              >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{profile.name}</span>
                    {profileSecondary(profile) && <span className="block truncate text-xs text-slate-500">{profileSecondary(profile)}</span>}
                  </span>
                  <CultureProfileTypeBadge profile={profile} />
                </span>
                <Check
                  className={cn("h-4 w-4 shrink-0 text-teal-700", selectedId === profile.id ? "opacity-100" : "opacity-0")}
                  aria-hidden="true"
                />
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
