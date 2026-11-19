import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bookmark, ChevronDown, ChevronUp, LayoutGrid } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface ScenarioFilters {
  difficulty: string;
  personaCount: string;
  searchText: string;
  department: string;
  skillType: string;
  categoryId: string;
  bookmarkedOnly: boolean;
}

export const SKILL_OPTIONS: { value: string; key: string }[] = [
  { value: "협상", key: "scenario.negotiation" },
  { value: "의사소통", key: "scenario.communication" },
  { value: "갈등해결", key: "scenario.conflictResolution" },
  { value: "리더십", key: "scenario.leadership" },
  { value: "문제해결", key: "scenario.problemSolving" },
  { value: "팀워크", key: "scenario.teamwork" },
];

export const DEPARTMENT_OPTIONS: { value: string; key: string }[] = [
  { value: "개발팀", key: "scenario.devTeam" },
  { value: "마케팅팀", key: "scenario.marketingTeam" },
  { value: "QA팀", key: "scenario.qaTeam" },
  { value: "고객서비스팀", key: "scenario.csTeam" },
  { value: "경영진", key: "scenario.management" },
  { value: "물류팀", key: "scenario.logisticsTeam" },
];

interface ScenarioFilterPanelProps {
  filters: ScenarioFilters;
  onChange: (patch: Partial<ScenarioFilters>) => void;
  categories: { id: string; name: string }[];
  categoryCounts: Record<string, number>;
  totalCount: number;
  bookmarkCount: number;
  canBookmark: boolean;
  /** Prefix keeps test ids unique when panel renders twice (desktop + drawer) */
  idPrefix?: string;
}

function NavRow({
  active,
  onClick,
  label,
  count,
  icon,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  icon?: React.ReactNode;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={`flex w-full min-h-[40px] items-center gap-2 rounded-lg px-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
        active ? "bg-indigo-700 text-white font-semibold" : "text-slate-700 hover:bg-indigo-50 hover:text-indigo-900"
      }`}
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && (
        <span className={`text-xs tabular-nums ${active ? "text-indigo-100" : "text-slate-400"}`}>{count}</span>
      )}
    </button>
  );
}

export function ScenarioFilterPanel({
  filters,
  onChange,
  categories,
  categoryCounts,
  totalCount,
  bookmarkCount,
  canBookmark,
  idPrefix = "",
}: ScenarioFilterPanelProps) {
  const { t } = useTranslation();
  const hasAdvanced = !!(filters.personaCount && filters.personaCount !== "all") || !!(filters.department && filters.department !== "all");
  const [showAdvanced, setShowAdvanced] = useState(hasAdvanced);
  const activeCategory = filters.categoryId && filters.categoryId !== "all" ? filters.categoryId : "";
  const tid = (id: string) => `${idPrefix}${id}`;

  return (
    <div className="space-y-6">
      <section aria-label={t("scenario.library", "라이브러리")}>
        <div className="space-y-0.5">
          <NavRow
            active={!filters.bookmarkedOnly}
            onClick={() => onChange({ bookmarkedOnly: false })}
            label={t("scenario.allScenarios", "전체 시나리오")}
            icon={<LayoutGrid className="h-4 w-4" aria-hidden />}
            count={totalCount}
            testId={tid("filter-all")}
          />
          {canBookmark && (
            <NavRow
              active={filters.bookmarkedOnly}
              onClick={() => onChange({ bookmarkedOnly: !filters.bookmarkedOnly })}
              label={t("scenario.favorites", "즐겨찾기")}
              icon={<Bookmark className="h-4 w-4" aria-hidden />}
              count={bookmarkCount}
              testId={tid("filter-bookmarked")}
            />
          )}
        </div>
      </section>

      <section>
        <h3 className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
          {t("scenario.category")}
        </h3>
        <div className="space-y-0.5" data-testid={tid("filter-category")}>
          <NavRow
            active={!activeCategory}
            onClick={() => onChange({ categoryId: "all" })}
            label={t("scenario.allCategories")}
            testId={tid("filter-category-all")}
          />
          {categories.map((c) => (
            <NavRow
              key={c.id}
              active={activeCategory === c.id}
              onClick={() => onChange({ categoryId: c.id })}
              label={c.name}
              count={categoryCounts[c.id] ?? 0}
              testId={tid(`filter-category-${c.id}`)}
            />
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-2 px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
          {t("scenario.coreSkill")}
        </h3>
        <div className="flex flex-wrap gap-1.5 px-1" data-testid={tid("filter-skill-type")}>
          {SKILL_OPTIONS.map((s) => {
            const active = filters.skillType === s.value;
            return (
              <button
                key={s.value}
                type="button"
                aria-pressed={active}
                onClick={() => onChange({ skillType: active ? "" : s.value })}
                data-testid={tid(`filter-skill-${s.value}`)}
                className={`min-h-[34px] rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                  active
                    ? "border-indigo-700 bg-indigo-700 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:text-indigo-800"
                }`}
              >
                {t(s.key)}
              </button>
            );
          })}
        </div>
      </section>

      <section className="border-t border-slate-200 pt-3">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          aria-expanded={showAdvanced}
          className="flex w-full min-h-[40px] items-center justify-between rounded-lg px-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          data-testid={tid("toggle-advanced-filters")}
        >
          {t("scenario.advancedSearch")}
          {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {showAdvanced && (
          <div className="mt-2 space-y-2 px-1">
            <Select value={filters.personaCount || undefined} onValueChange={(value) => onChange({ personaCount: value })}>
              <SelectTrigger data-testid={tid("filter-persona-count")} className="h-10 rounded-lg text-sm" aria-label={t("scenario.personaCount")}>
                <SelectValue placeholder={t("scenario.personaCount")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("scenario.all")}</SelectItem>
                {[1, 2, 3, 4, 5].map((n) => (
                  <SelectItem key={n} value={String(n)}>{t("scenario.personaCountN", { count: n })}</SelectItem>
                ))}
                <SelectItem value="6">{t("scenario.personaCount6Plus")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.department || undefined} onValueChange={(value) => onChange({ department: value })}>
              <SelectTrigger data-testid={tid("filter-department")} className="h-10 rounded-lg text-sm" aria-label={t("scenario.department")}>
                <SelectValue placeholder={t("scenario.department")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("scenario.all")}</SelectItem>
                {DEPARTMENT_OPTIONS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>{t(d.key)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </section>
    </div>
  );
}
