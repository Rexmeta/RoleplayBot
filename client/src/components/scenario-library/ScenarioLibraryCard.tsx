import { Button } from "@/components/ui/button";
import { ComplexScenario } from "@/lib/scenario-system";
import { toMediaUrl } from "@/lib/mediaUrl";
import { Bookmark, BookmarkCheck, Clock, Folder, Play, Star, Users } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ScenarioLibraryCardProps {
  scenario: ComplexScenario;
  title: string;
  description: string;
  skills: string[];
  categoryName: string;
  isBookmarked: boolean;
  canBookmark: boolean;
  stats?: { completionCount: number; averageScore: number | null };
  onBookmarkToggle: (e: React.MouseEvent) => void;
  onOpenDetail: () => void;
  onStart: () => void;
}

export function ScenarioLibraryCard({
  scenario,
  title,
  description,
  skills,
  categoryName,
  isBookmarked,
  canBookmark,
  stats,
  onBookmarkToggle,
  onOpenDetail,
  onStart,
}: ScenarioLibraryCardProps) {
  const { t } = useTranslation();
  const image = toMediaUrl((scenario as any).thumbnail || scenario.image);
  const personaCount = (scenario.personas || []).length;

  return (
    <article
      className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(30,41,90,0.06)] transition-[box-shadow,border-color] duration-200 hover:border-indigo-200 hover:shadow-[0_8px_24px_-12px_rgba(49,46,129,0.28)] motion-reduce:transition-none"
      data-testid={`scenario-card-${scenario.id}`}
    >
      <div className="relative h-32 w-full overflow-hidden bg-gradient-to-br from-indigo-100 via-blue-50 to-slate-100">
        {image && (
          <img
            src={image}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900/45 via-transparent to-transparent" />
        {categoryName && (
          <span className="absolute left-3 bottom-3 inline-flex max-w-[70%] items-center gap-1 rounded-md bg-white/95 px-2 py-1 text-[11px] font-semibold text-indigo-800 shadow-sm">
            <Folder className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{categoryName}</span>
          </span>
        )}
        {canBookmark && (
          <button
            type="button"
            onClick={onBookmarkToggle}
            aria-pressed={isBookmarked}
            aria-label={isBookmarked ? t("scenario.removeBookmark", "즐겨찾기 해제") : t("scenario.addBookmark", "즐겨찾기 추가")}
            className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow-sm transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            data-testid={`button-bookmark-${scenario.id}`}
          >
            {isBookmarked ? (
              <BookmarkCheck className="h-4 w-4 text-amber-500" />
            ) : (
              <Bookmark className="h-4 w-4" />
            )}
          </button>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <button
          type="button"
          onClick={onOpenDetail}
          className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-md"
          data-testid={`button-open-detail-${scenario.id}`}
        >
          <h3 className="text-[15px] font-bold leading-snug text-slate-900 line-clamp-2 break-keep group-hover:text-indigo-800 transition-colors">
            {title}
          </h3>
          {description && (
            <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600 line-clamp-2 break-keep">
              {description}
            </p>
          )}
        </button>

        {skills.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label={t("scenario.coreSkill")}>
            {skills.slice(0, 2).map((skill) => (
              <span key={skill} className="rounded-md bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-800">{skill}</span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1">
            <Users className="h-3.5 w-3.5" aria-hidden />
            {t("scenario.personaCountN", { count: personaCount })}
          </span>
          {scenario.estimatedTime && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" aria-hidden />
              {scenario.estimatedTime}
            </span>
          )}
          {stats && stats.completionCount > 0 && (
            <span className="inline-flex items-center gap-1" data-testid={`scenario-stats-${scenario.id}`}>
              <Star className="h-3.5 w-3.5 text-amber-500" aria-hidden />
              {stats.completionCount}회 완료
              {stats.averageScore != null && ` · 평균 ${Number(stats.averageScore).toFixed(1)}점`}
            </span>
          )}
        </div>

        <div className="mt-auto flex gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onOpenDetail}
            className="h-10 flex-1 rounded-lg border-slate-200 text-slate-700 hover:bg-indigo-50 hover:text-indigo-800"
            data-testid={`button-detail-scenario-${scenario.id}`}
          >
            {t("scenario.viewDetail", "상세 내용 보기")}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={onStart}
            className="h-10 flex-1 rounded-lg bg-indigo-700 text-white hover:bg-indigo-800"
            data-testid={`button-start-scenario-${scenario.id}`}
          >
            <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {t("scenario.startScenario")}
          </Button>
        </div>
      </div>
    </article>
  );
}
