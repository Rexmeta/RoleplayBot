import type { HTMLAttributes, ReactNode } from "react";

type VoiceChromeProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  children: ReactNode;
};

/** Shared voice-mode overlay treatment for persona details and lightweight actions. */
export function VoiceOverlayHeader({
  children,
  className,
  ...props
}: VoiceChromeProps) {
  return (
    <div
      {...props}
      className={`bg-black/50 text-white backdrop-blur-sm ${className ?? ""}`.trim()}
    >
      {children}
    </div>
  );
}

/** Shared translucent voice control tray; keep actions visually secondary to the conversation. */
export function VoiceControlSurface({
  children,
  className,
  ...props
}: VoiceChromeProps) {
  return (
    <div
      {...props}
      className={`rounded-2xl border border-white/10 bg-[#ffffff9c] text-slate-700 shadow-xl backdrop-blur-sm ${className ?? ""}`.trim()}
    >
      {children}
    </div>
  );
}
