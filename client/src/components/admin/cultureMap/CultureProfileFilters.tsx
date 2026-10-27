import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Search, SlidersHorizontal } from "lucide-react";
import type { ChangeEvent } from "react";

type CultureProfileFiltersProps = {
  profileType: "all" | "country" | "company" | "custom";
  onProfileTypeChange: (value: "all" | "country" | "company" | "custom") => void;
  search: string;
  onSearchChange: (value: string) => void;
  region: string;
  onRegionChange: (value: string) => void;
  regions: string[];
  confidence: string;
  onConfidenceChange: (value: string) => void;
};

export function CultureProfileFilters({
  profileType,
  onProfileTypeChange,
  search,
  onSearchChange,
  region,
  onRegionChange,
  regions,
  confidence,
  onConfidenceChange,
}: CultureProfileFiltersProps) {
  const handleSearch = (event: ChangeEvent<HTMLInputElement>) => onSearchChange(event.target.value);

  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50/80 p-3">
      <label className="relative block">
        <Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          aria-label="국가, 지역, 프로필 검색"
          value={search}
          onChange={handleSearch}
          placeholder="국가·지역·프로필 검색"
          className="bg-white pl-9"
        />
      </label>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
        <div>
          <Label htmlFor="culture-filter-type" className="mb-1 block text-xs text-slate-600">프로필 유형</Label>
          <select
            id="culture-filter-type"
            value={profileType}
            onChange={(event) => onProfileTypeChange(event.target.value as "all" | "country" | "company" | "custom")}
            className="h-9 w-full rounded-md border border-input bg-white px-3 text-sm text-slate-800 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">모든 유형</option>
            <option value="country">국가 기준</option>
            <option value="company">기업 추정</option>
            <option value="custom">사용자 정의</option>
          </select>
        </div>
        <div>
          <Label htmlFor="culture-filter-region" className="mb-1 flex items-center gap-1 text-xs text-slate-600">
            <SlidersHorizontal aria-hidden="true" className="h-3.5 w-3.5" />지역
          </Label>
          <select
            id="culture-filter-region"
            value={region}
            onChange={(event) => onRegionChange(event.target.value)}
            className="h-9 w-full rounded-md border border-input bg-white px-3 text-sm text-slate-800 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">모든 지역</option>
            {regions.map((item) => item === "__unspecified__"
              ? <option key={item} value={item}>지역 미지정</option>
              : <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="culture-filter-confidence" className="mb-1 block text-xs text-slate-600">출처 신뢰도</Label>
          <select
            id="culture-filter-confidence"
            value={confidence}
            onChange={(event) => onConfidenceChange(event.target.value)}
            className="h-9 w-full rounded-md border border-input bg-white px-3 text-sm text-slate-800 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">모든 신뢰도</option>
            <option value="low">낮음</option>
            <option value="medium">중간</option>
            <option value="high">높음</option>
            <option value="unspecified">미지정</option>
          </select>
        </div>
      </div>
    </div>
  );
}
