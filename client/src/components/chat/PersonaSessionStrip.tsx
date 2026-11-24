import type { ReactNode } from "react";

export type PersonaSessionStripProps = {
  name: string;
  imageUrl?: string | null;
  description?: string | null;
  pending?: boolean;
  progressPercentage: number;
  progressBarClass: string;
  toneClass: string;
  statusLabel: ReactNode;
  elapsedLabel: string;
  endAction: ReactNode;
  extraAction?: ReactNode;
};

/** Compact persona identity + turn progress row that lives inside the bottom conversation settings surface. */
export function PersonaSessionStrip({
  name, imageUrl, description, pending, progressPercentage, progressBarClass,
  toneClass, statusLabel, elapsedLabel, endAction, extraAction,
}: PersonaSessionStripProps) {
  const pct = Math.max(0, Math.min(100, progressPercentage));
  return (
    <div className="border-b border-slate-200/60 bg-white/40 px-3 sm:px-4 pt-2.5 pb-2" data-testid="persona-session-strip">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="relative shrink-0">
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full overflow-hidden ring-2 ring-white/80 shadow-sm bg-slate-200">
            {imageUrl ? (
              <img src={imageUrl} alt={name} className="w-full h-full object-cover object-top" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[10px] font-bold text-white bg-emerald-600" data-testid="persona-strip-initials">
                {name.slice(0, 2)}
              </div>
            )}
          </div>
          {pending && <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-white animate-pulse" />}
        </div>
        <div className="flex flex-col min-w-0 flex-1 leading-tight">
          <span className="text-slate-800 text-sm font-semibold truncate" data-testid="persona-strip-name">{name}</span>
          {description && (
            <span className="text-slate-500 text-[11px] truncate" data-testid="persona-strip-description">{description}</span>
          )}
        </div>
        <div className={`hidden sm:flex flex-col items-end text-[11px] font-medium shrink-0 transition-colors duration-300 ${toneClass}`} data-testid="persona-strip-turns">
          <span>{statusLabel}</span>
          <span className="text-slate-400 font-normal tabular-nums">{elapsedLabel}</span>
        </div>
        {extraAction}
        <div className="shrink-0">{endAction}</div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="flex-1 bg-slate-300/50 rounded-full h-1 overflow-hidden">
          <div className={`h-1 rounded-full transition-all duration-500 ${progressBarClass}`} style={{ width: `${pct}%` }} data-testid="persona-strip-progress" />
        </div>
        <span className={`sm:hidden text-[10px] font-medium shrink-0 tabular-nums ${toneClass}`}>
          {statusLabel} · {elapsedLabel}
        </span>
      </div>
    </div>
  );
}
