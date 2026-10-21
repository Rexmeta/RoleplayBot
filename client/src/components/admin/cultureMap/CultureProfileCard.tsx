import { CULTURE_DIMENSIONS, isSystemCultureProfile } from "@shared/cultureMap";
import type { CultureProfile } from "@shared/cultureMap";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Copy, Ellipsis, History, Trash2 } from "lucide-react";

type CultureProfileCardProps = {
  profile: CultureProfile;
  selected: boolean;
  comparisonIndex: number;
  comparisonLimitReached: boolean;
  isOwner: boolean;
  isAdmin: boolean;
  isEditing: boolean;
  duplicatePending: boolean;
  onToggleComparison: () => void;
  onInspect: () => void;
  onDuplicate: () => void;
  onHistory: () => void;
  onDelete: () => void;
};

const confidenceLabel = { low: "낮음", medium: "중간", high: "높음" } as const;

export function CultureProfileCard({
  profile,
  selected,
  comparisonIndex,
  comparisonLimitReached,
  isOwner,
  isAdmin,
  isEditing,
  duplicatePending,
  onToggleComparison,
  onInspect,
  onDuplicate,
  onHistory,
  onDelete,
}: CultureProfileCardProps) {
  const canDelete = !isSystemCultureProfile(profile) && (isAdmin || isOwner);
  const deleteLabel = canDelete ? "삭제" : "삭제할 수 없음";

  return (
    <li className={`min-w-0 rounded-lg border p-3 transition-colors ${isEditing ? "border-teal-500 bg-teal-50/60" : "border-slate-200 bg-white hover:border-slate-300"}`}>
      <div className="mb-2 flex min-w-0 items-center gap-2 border-b border-slate-100 pb-2">
        <button
          type="button"
          onClick={onInspect}
          className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-slate-900 underline-offset-4 hover:text-teal-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2"
          aria-label={`${profile.name} 프로필 미리보기 및 편집`}
        >
          {profile.name}
        </button>
        <span className="shrink-0 font-mono text-[11px] text-slate-500">v{profile.version}</span>
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-1 py-1 text-xs font-medium text-slate-700 hover:bg-teal-50">
          <span>비교</span>
          <input
            type="checkbox"
            checked={selected}
            disabled={!selected && comparisonLimitReached}
            onChange={onToggleComparison}
            aria-label={`${profile.country} ${profile.name} 비교에 ${selected ? "포함됨" : "추가"}`}
            className="h-4 w-4 accent-teal-700"
          />
        </label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={`${profile.name} 프로필 메뉴`}>
              <Ellipsis className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onSelect={onDuplicate} disabled={duplicatePending}>
              <Copy aria-hidden="true" />
              복제
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onHistory}>
              <History aria-hidden="true" />
              기록
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onDelete} disabled={!canDelete} className="text-red-700 focus:text-red-800">
              <Trash2 aria-hidden="true" />
              {deleteLabel}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <button type="button" onClick={onInspect} className="mb-3 block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2">
        <span className="block truncate text-xs text-slate-600">{profile.country}{profile.region ? ` · ${profile.region}` : ""}</span>
        <span className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{profile.visibility === "shared" ? "공유" : "비공개"}</span>
      </button>

      <div aria-label={`${profile.name}의 8개 문화 행동 차원`} className="space-y-2 border-t border-slate-100 pt-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">행동 경향</p>
          <p className="text-[10px] text-slate-500">0–100 · 공통 척도</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
          {CULTURE_DIMENSIONS.map((dimension) => {
            const value = profile.dimensions[dimension.key];
            return (
              <div key={dimension.key} className="min-w-0" title={`${dimension.label} ${value}/100 · 0: ${dimension.low} ↔ 100: ${dimension.high}`}>
                <div className="flex items-center justify-between gap-1 text-[10px] leading-tight">
                  <dt className="truncate font-medium text-slate-700">{dimension.label}</dt>
                  <dd className="shrink-0 font-mono tabular-nums text-slate-800">{value}</dd>
                </div>
                <div
                  className="relative mt-1 h-1.5 rounded-full bg-slate-100"
                  role="meter"
                  aria-label={dimension.label}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={value}
                  aria-valuetext={`${value}/100 · 0: ${dimension.low}, 100: ${dimension.high}`}
                >
                  <span className="absolute inset-y-0 left-0 rounded-full bg-teal-700/50" style={{ width: `${value}%` }} />
                  <span className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-teal-800 bg-white" style={{ left: `${value}%` }} />
                </div>
                <div className="mt-0.5 flex justify-between gap-1 text-[9px] leading-tight text-slate-500">
                  <span className="truncate">{dimension.low}</span>
                  <span className="truncate text-right">{dimension.high}</span>
                </div>
              </div>
            );
          })}
        </dl>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-slate-100 pt-2 text-[10px] leading-relaxed text-slate-600">
        {selected && <span className="font-medium text-teal-800">비교 {comparisonIndex}번</span>}
        {comparisonLimitReached && !selected && <span className="text-amber-800">최대 5개 선택됨 · 비교를 해제하면 추가 가능</span>}
        {profile.origin ? (
          <span title={profile.origin.importantNotice}>
            {isSystemCultureProfile(profile) ? "시스템 기본 · 자체 추정" : "자체 추정 자료에서 복제"} · 검토 필요 · 신뢰도 {confidenceLabel[profile.origin.originalProfile.confidence]} · 자료 v{profile.origin.originalProfile.profileVersion}
          </span>
        ) : (
          <span>{profile.sources.length ? `출처 ${profile.sources.length}개` : "출처 미등록"}</span>
        )}
      </div>
    </li>
  );
}
