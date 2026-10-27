import type { CultureProfile } from "@shared/cultureMap";

export function getCultureProfileTypeLabel(profile: Pick<CultureProfile, "assessment" | "origin">) {
  if (profile.assessment?.kind === "organization_editorial_estimate") return "기업 추정";
  if (profile.origin) return "국가 기준";
  return "사용자 정의";
}

export function CultureProfileTypeBadge({ profile }: { profile: Pick<CultureProfile, "assessment" | "origin"> }) {
  const label = getCultureProfileTypeLabel(profile);
  const colorClass = label === "기업 추정"
    ? "bg-amber-100 text-amber-900"
    : label === "국가 기준"
      ? "bg-teal-100 text-teal-900"
      : "bg-slate-100 text-slate-700";

  return (
    <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${colorClass}`}>
      {label}
    </span>
  );
}
