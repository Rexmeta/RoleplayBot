import { ArrowRight } from "lucide-react";

export interface PersonaSwitchEvent {
  fromIndex: number;
  fromPersonaName?: string;
  toIndex: number;
  newPersonaName: string;
  reason: string;
  transitionLine: string;
  timestamp: string;
  turnIndex?: number;
}

interface PersonaSwitchCardProps {
  event: PersonaSwitchEvent;
}

export function PersonaSwitchCard({ event }: PersonaSwitchCardProps) {
  return (
    <div className="flex justify-center my-3 px-4">
      <div className="flex flex-col items-center gap-1.5 max-w-sm w-full">
        <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-full px-4 py-1.5 text-xs text-indigo-600 font-medium shadow-sm">
          {event.fromPersonaName ? (
            <>
              <span className="opacity-70">{event.fromPersonaName}</span>
              <ArrowRight className="w-3 h-3 shrink-0" />
              <span>{event.newPersonaName}</span>
            </>
          ) : (
            <>
              <ArrowRight className="w-3.5 h-3.5 shrink-0" />
              <span>{event.newPersonaName}</span>
            </>
          )}
        </div>
        {event.reason && (
          <p className="text-[10px] text-slate-400 text-center leading-relaxed px-2">
            {event.reason}
          </p>
        )}
        {event.transitionLine && (
          <p className="text-xs text-slate-500 italic text-center leading-relaxed px-2">
            "{event.transitionLine}"
          </p>
        )}
      </div>
    </div>
  );
}
