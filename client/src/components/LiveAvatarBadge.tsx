import { Video, VideoOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface LiveAvatarBadgeProps {
  configured: boolean;
  /** inline: flows with surrounding badges; otherwise caller positions it over an image */
  inline?: boolean;
  className?: string;
}

export function LiveAvatarBadge({ configured, inline = false, className }: LiveAvatarBadgeProps) {
  const { t } = useTranslation();
  const label = configured
    ? t("scenario.liveAvatarAvailable", { defaultValue: "라이브 아바타 지원" })
    : t("scenario.liveAvatarUnavailable", { defaultValue: "라이브 아바타 미설정" });
  const Icon = configured ? Video : VideoOff;
  return (
    <span
      data-testid={configured ? "live-avatar-badge-on" : "live-avatar-badge-off"}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium",
        configured
          ? inline ? "bg-emerald-50 text-emerald-800" : "bg-emerald-600/95 text-white shadow-sm"
          : inline ? "bg-slate-100 text-slate-500" : "bg-white/90 text-slate-600 shadow-sm backdrop-blur",
        className,
      )}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {label}
    </span>
  );
}
