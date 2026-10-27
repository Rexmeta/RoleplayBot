import { useEffect, useRef } from "react";
import type { CultureProfile } from "@shared/cultureMap";
import { Button } from "@/components/ui/button";
import { ArrowRight, X } from "lucide-react";
import { CultureProfileTypeBadge } from "./CultureProfileTypeBadge";

type CultureProfileComparisonTrayProps = {
  profiles: CultureProfile[];
  onRemove: (id: string) => void;
  onClear: () => void;
  onCompare: () => void;
  onHeightChange: (height: number) => void;
};

export function CultureProfileComparisonTray({
  profiles,
  onRemove,
  onClear,
  onCompare,
  onHeightChange,
}: CultureProfileComparisonTrayProps) {
  const trayRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const tray = trayRef.current;
    if (!tray) return;
    const reportHeight = () => {
      const height = tray.getBoundingClientRect().height;
      if (height > 0) onHeightChange(Math.ceil(height));
    };

    reportHeight();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(reportHeight);
      observer.observe(tray);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", reportHeight);
    return () => window.removeEventListener("resize", reportHeight);
  }, [onHeightChange, profiles]);

  const canCompare = profiles.length >= 2;

  return (
    <aside
      ref={trayRef}
      aria-label="비교할 프로필 선택함"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-teal-200 bg-[#f4faf7]/[.97] px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(19,78,70,0.09)] backdrop-blur-sm sm:px-6"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h2 className="text-sm font-semibold text-teal-950">비교할 프로필</h2>
            <span aria-live="polite" className="text-xs tabular-nums text-teal-800">{profiles.length}/5개 선택</span>
          </div>
          <ul aria-label="비교 선택 프로필 이름" className="mt-2 flex flex-wrap gap-1.5">
            {profiles.map((profile) => (
              <li key={profile.id} aria-label={`선택된 프로필 이름: ${profile.name}`} className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border border-teal-200 bg-white px-2 py-1 text-xs text-teal-950 transition-colors duration-150">
                <span className="min-w-0 break-all font-medium">{profile.name}</span>
                <CultureProfileTypeBadge profile={profile} />
                <button
                  type="button"
                  aria-label={`${profile.name} 비교에서 제거`}
                  onClick={() => onRemove(profile.id)}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-teal-800 hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 sm:shrink-0">
          {!canCompare && <p className="mr-auto text-xs text-slate-600 sm:mr-1">비교하려면 프로필을 하나 더 선택하세요.</p>}
          <Button type="button" variant="ghost" className="min-h-10 text-teal-900" onClick={onClear}>
            선택 모두 지우기
          </Button>
          <Button
            type="button"
            disabled={!canCompare}
            onClick={onCompare}
            className="min-h-10 gap-2 bg-teal-800 text-white hover:bg-teal-900"
          >
            비교하기 <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
