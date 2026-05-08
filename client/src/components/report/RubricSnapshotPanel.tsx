import { useState, useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

interface ScoringRubricBand {
  score: number;
  label: string;
  description: string;
  behaviorAnchor?: string;
  positiveIndicators?: string[];
  negativeIndicators?: string[];
}

interface SnapshotDimension {
  key: string;
  name: string;
  weight: number;
  minScore?: number;
  maxScore?: number;
  icon?: string;
  color?: string;
  scoringRubric?: ScoringRubricBand[];
}

interface RubricSnapshotPanelProps {
  rubricSnapshot?: Record<string, any> | null;
  modelSnapshot?: Record<string, any> | null;
  criteriaSetVersion?: number | null;
}

function DimensionRow({ dim }: { dim: SnapshotDimension }) {
  const [open, setOpen] = useState(false);
  const hasBands = Array.isArray(dim.scoringRubric) && dim.scoringRubric.length > 0;

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <button
        type="button"
        onClick={() => hasBands && setOpen(v => !v)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left ${hasBands ? 'hover:bg-slate-50 cursor-pointer' : 'cursor-default'}`}
      >
        <span className="text-base flex-shrink-0">{dim.icon || '📌'}</span>
        <span className="font-medium text-slate-700 flex-1 text-xs">{dim.name}</span>
        <span className="text-[11px] text-slate-400 flex-shrink-0">가중치 {dim.weight}%</span>
        {dim.maxScore && (
          <span className="text-[10px] text-slate-300 flex-shrink-0 ml-1">{dim.minScore ?? 1}–{dim.maxScore}점</span>
        )}
        {hasBands && (
          <i className={`fas fa-chevron-${open ? 'up' : 'down'} text-[9px] text-slate-400 flex-shrink-0 ml-1`}></i>
        )}
      </button>

      {open && hasBands && (
        <div className="border-t border-slate-100 divide-y divide-slate-100">
          {(dim.scoringRubric as ScoringRubricBand[])
            .slice()
            .sort((a, b) => b.score - a.score)
            .map((band, idx) => {
              const pct = dim.maxScore ? Math.round((band.score / dim.maxScore) * 100) : null;
              const bandColor =
                pct !== null && pct >= 80 ? 'text-emerald-700 bg-emerald-50' :
                pct !== null && pct >= 60 ? 'text-blue-700 bg-blue-50' :
                pct !== null && pct >= 40 ? 'text-amber-700 bg-amber-50' :
                'text-rose-700 bg-rose-50';
              return (
                <div key={idx} className="px-3 py-2 text-[11px]">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${bandColor}`}>
                      {band.score}점 — {band.label}
                    </span>
                  </div>
                  <p className="text-slate-600 leading-snug">{band.description}</p>
                  {band.behaviorAnchor && (
                    <p className="text-slate-500 mt-0.5 italic">"{band.behaviorAnchor}"</p>
                  )}
                  {band.positiveIndicators && band.positiveIndicators.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {band.positiveIndicators.map((ind, ii) => (
                        <li key={ii} className="flex items-start gap-1 text-emerald-700">
                          <i className="fas fa-check text-[8px] mt-0.5 flex-shrink-0"></i>
                          <span>{ind}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {band.negativeIndicators && band.negativeIndicators.length > 0 && (
                    <ul className="mt-0.5 space-y-0.5">
                      {band.negativeIndicators.map((ind, ii) => (
                        <li key={ii} className="flex items-start gap-1 text-rose-600">
                          <i className="fas fa-xmark text-[8px] mt-0.5 flex-shrink-0"></i>
                          <span>{ind}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

export function RubricSnapshotPanel({ rubricSnapshot, modelSnapshot, criteriaSetVersion }: RubricSnapshotPanelProps) {
  const dims: SnapshotDimension[] = Array.isArray(rubricSnapshot?.dimensions) ? rubricSnapshot.dimensions : [];
  const anyHasBands = dims.some(d => Array.isArray(d.scoringRubric) && d.scoringRubric.length > 0);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.location.hash === "#rubric") {
      setOpen(true);
      setTimeout(() => {
        panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }, []);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="no-print">
      <div id="rubric" ref={panelRef} />
      <CollapsibleTrigger className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-700 transition-colors cursor-pointer select-none group w-full">
        <span className="flex items-center justify-center w-5 h-5 rounded bg-indigo-50 border border-indigo-100 flex-shrink-0">
          <i className="fas fa-clipboard-list text-indigo-400 text-[9px]"></i>
        </span>
        <span className="font-medium">평가에 사용된 루브릭</span>
        {rubricSnapshot?.name && (
          <span className="text-slate-400">— {rubricSnapshot.name}</span>
        )}
        {criteriaSetVersion != null && (
          <Badge variant="outline" className="text-[10px] py-0 h-4 border-indigo-200 text-indigo-600 ml-0.5">
            v{criteriaSetVersion}
          </Badge>
        )}
        {rubricSnapshot?.status && rubricSnapshot.status !== 'active' && (
          <Badge variant="outline" className="text-[10px] py-0 h-4 border-slate-200 text-slate-500 ml-0.5">
            {rubricSnapshot.status}
          </Badge>
        )}
        {anyHasBands && (
          <span className="ml-auto text-[10px] text-slate-400 group-data-[state=open]:hidden">
            클릭하여 기준 확인
          </span>
        )}
        <i className="fas fa-chevron-right group-data-[state=open]:rotate-90 transition-transform text-[10px] text-slate-400 ml-auto group-data-[state=open]:ml-0"></i>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3 text-xs text-slate-600">

          {rubricSnapshot && dims.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                평가 차원 ({dims.length}개){anyHasBands ? ' — 차원을 클릭하면 채점 기준을 확인할 수 있습니다' : ''}
              </p>
              <div className="space-y-1.5">
                {dims.map((dim, i) => (
                  <DimensionRow key={i} dim={dim} />
                ))}
              </div>
            </div>
          )}

          {rubricSnapshot && dims.length === 0 && (
            <p className="text-slate-400 italic">이 평가 기록에는 차원 정보가 포함되지 않았습니다.</p>
          )}

          {modelSnapshot && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 border-t border-slate-200">
              <div className="flex items-center gap-1.5">
                <i className="fas fa-robot text-slate-400"></i>
                <span className="text-slate-500">평가 모델:</span>
                <span className="font-mono text-slate-700">{modelSnapshot.model ?? '알 수 없음'}</span>
              </div>
              {modelSnapshot.capturedAt && (
                <span className="text-slate-400 text-[10px] ml-auto">
                  평가 시각: {new Date(modelSnapshot.capturedAt).toLocaleString('ko-KR')}
                </span>
              )}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
