import { ArrowRight, ChevronsDown } from "lucide-react";

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
  targetIndex?: number;
}

export function PersonaSwitchCard({ event, targetIndex }: PersonaSwitchCardProps) {
  const handleJump = () => {
    if (targetIndex == null) return;
    const el = document.getElementById(`message-${targetIndex}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const isClickable = targetIndex != null;

  return (
    <div className="flex justify-center my-3 px-4">
      <div className="flex flex-col items-center gap-1.5 max-w-sm w-full">
        <div
          className={`flex items-center gap-2 bg-indigo-50 border border-indigo-200 rounded-full px-4 py-1.5 text-xs text-indigo-600 font-medium shadow-sm transition-colors ${
            isClickable
              ? "cursor-pointer hover:bg-indigo-100 hover:border-indigo-300 active:bg-indigo-200"
              : ""
          }`}
          onClick={isClickable ? handleJump : undefined}
          title={isClickable ? "Click to jump to this persona's first message" : undefined}
        >
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
          {isClickable && <ChevronsDown className="w-3 h-3 shrink-0 opacity-60" />}
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
